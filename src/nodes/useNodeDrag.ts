// Node drag gesture (§8.2, P3.5 / P3.7). Position lives in Reanimated shared values every
// frame; the document store is written only on release via P3.4 / P3.7 commands (§11.4).
// Snap candidates are recomputed on the JS thread each update and published to
// `uiStore.dragSnap` — ephemeral, outside undo. NodeLayer reads that feed for the
// §8.3 insertion gap + caret (P3.6); this hook never writes document positions
// mid-drag, so the preview can open and close without touching undo history.
//
// MovingChain (P3.7): hold then drag (heldMs from onBegin→onStart ≥ CHAIN_MOVE_HOLD_MS)
// lifts the whole chain (anchor update); a plain drag detaches the member.
// `Select group` is the other move-chain route (§8.6). `Select all` (multi-unit
// group selection) uses `moveSelection` so every selected chain and free node
// translate together. Context menu at 500 ms wins — never enter moveChain while
// `contextMenu !== null`.
import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { makeSnappingNeighbours, type SnappingNeighbours } from '../chains/bounds';
import { resolveSnapCandidate, type SnapOutcome } from '../chains/snapping';
import type { ChainId, NodeId, Vec2 } from '../model/types';
import {
  commitSnapOutcome,
  detachNode,
  moveChain,
  moveFreeNode,
  moveSelection,
} from '../store/commands';
import { useDocumentStore } from '../store/documentStore';
import { useNode } from '../store/selectors';
import { useUiStore } from '../store/uiStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { getDeviceLocale } from '../ui/locale';
import { useCanvasViewport } from '../canvas/ViewportContext';
import {
  chainDragChainId,
  chainDragDx,
  chainDragDy,
  resetChainDragShared,
  resetSelectionDragShared,
  selectionDragActive,
  selectionDragDx,
  selectionDragDy,
  selectionDragFollowers,
} from './chainDragShared';
import {
  crossedDetachDistance,
  decideDragRelease,
  isMultiUnitSelection,
  resolveNodeDragMode,
  resolveSelectionUnits,
  snapProbeChainId,
  type NodeDragMode,
  type SelectionUnits,
} from './dragLifecycle';
import { useNodeSelected } from './useNodeSelected';

/** Screen pixels of movement before a press becomes a node drag. Below this,
 *  Canvas's Tap still wins (select / create); above it, the node claims the gesture
 *  and should stop the canvas pan from also moving. */
const NODE_DRAG_ACTIVATION_DISTANCE = 6;

/** Idle selected / group-selected node stacks above flush chain neighbours so
 *  Cell's outset focus ring is not painted under the next member (P7.2 follow-up).
 *  Below connectors (500) and a live drag (1000). */
export const SELECTED_NODE_Z_INDEX = 10;

export interface NodeDragHandle {
  gesture: ReturnType<typeof Gesture.Pan>;
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  /** Shared flag: 1 while this node is mid-drag. */
  dragging: SharedValue<number>;
}

function publishDragSnap(
  nodeId: NodeId,
  position: Vec2,
  candidate: SnapOutcome | null,
  movingChainId: ChainId | null = null,
  movingSelection: SelectionUnits | null = null,
): void {
  useUiStore.getState().setDragSnap({
    nodeId,
    position,
    candidate,
    movingChainId,
    movingSelection,
  });
}

function clearDragSnap(): void {
  useUiStore.getState().setDragSnap(null);
}

export function useNodeDrag(nodeId: NodeId): NodeDragHandle {
  const { zoom } = useCanvasViewport();
  const node = useNode(nodeId);
  const editingThis = useUiStore((state) => state.editingNodeId === nodeId);
  // Selection elevates idle z-index (see SELECTED_NODE_Z_INDEX). Read here rather
  // than in NodeLayer so the animated style can clear it explicitly on every frame —
  // omitting zIndex after a drag would leave 1000 stuck, same class of bug as the
  // transform reset below.
  const selected = useNodeSelected(nodeId);

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const pressStartMs = useSharedValue(0);
  /** Mirror of `node.chainId` for the UI-thread follower style (MovingChain siblings). */
  const chainIdSV = useSharedValue<ChainId | null>(node?.chainId ?? null);

  // Sync home coordinates from the store while idle. Done in an effect (not during
  // render) — Reanimated strict mode forbids reading/writing `.value` while React
  // is rendering, and that path also raced onStart against the first onUpdate.
  useEffect(() => {
    if (!node || dragging.value !== 0) return;
    startX.value = node.position.x;
    startY.value = node.position.y;
    dragX.value = node.position.x;
    dragY.value = node.position.y;
  }, [node, node?.position.x, node?.position.y, dragging, startX, startY, dragX, dragY]);

  useEffect(() => {
    chainIdSV.value = node?.chainId ?? null;
  }, [node?.chainId, chainIdSV]);

  const session = useRef<{
    home: Vec2;
    wasChained: boolean;
    detached: boolean;
    mode: NodeDragMode;
    chainId: ChainId | null;
    homeAnchor: Vec2 | null;
    selectionUnits: SelectionUnits | null;
    /** Built once at drag start — document is immutable mid-drag (§11.4 commit
     *  on release), so rebuilding the §8.4 spatial hash every frame would pay
     *  O(n) bounds work for nothing. Query still runs per frame with the live
     *  probe position. */
    neighbours: SnappingNeighbours | null;
    locale: string;
    /** Captured once alongside `neighbours` (§1.2 P7): every frame's
     *  `resolveSnapCandidate` must agree with whatever font size `neighbours`
     *  was built from, or its bounds and this session's own would disagree
     *  about where things are. */
    fontSize: number;
  } | null>(null);

  const beginDrag = useCallback(
    (heldMs: number) => {
      const { document } = useDocumentStore.getState();
      const current = document.nodes[nodeId];
      if (!current) return;

      const ui = useUiStore.getState();
      const inGroup = ui.groupSelectedIds.has(nodeId);
      const selectionUnits = inGroup
        ? resolveSelectionUnits(ui.groupSelectedIds, document.nodes)
        : null;
      // Select all (and any multi-chain / free+chain group) must translate every
      // unit together. A single-chain Select group stays on moveChain.
      const mode: NodeDragMode =
        selectionUnits && isMultiUnitSelection(selectionUnits)
          ? 'moveSelection'
          : resolveNodeDragMode({
              wasChained: current.chainId !== null,
              heldMs,
              groupSelected: inGroup && current.chainId !== null,
              contextMenuOpen: ui.contextMenu !== null,
            });

      let homeAnchor: Vec2 | null = null;
      if (mode === 'moveChain' && current.chainId) {
        const chain = document.chains[current.chainId];
        if (!chain) return;
        homeAnchor = { x: chain.anchor.x, y: chain.anchor.y };
        chainDragChainId.value = current.chainId;
        chainDragDx.value = 0;
        chainDragDy.value = 0;
      }

      if (mode === 'moveSelection' && selectionUnits) {
        const followers: Record<string, number> = {};
        for (const id of ui.groupSelectedIds) {
          if (id !== nodeId && document.nodes[id]) followers[id] = 1;
        }
        // Ensure every member of a selected chain follows, even if the group set
        // somehow omitted a sibling (Select all already includes them).
        for (const chainId of selectionUnits.chainIds) {
          const chain = document.chains[chainId];
          if (!chain) continue;
          for (const memberId of chain.members) {
            if (memberId !== nodeId) followers[memberId] = 1;
          }
        }
        selectionDragFollowers.value = followers;
        selectionDragDx.value = 0;
        selectionDragDy.value = 0;
        selectionDragActive.value = 1;
      }

      const locale = getDeviceLocale();
      const fontSize = usePreferencesStore.getState().numeralFontSize;
      // Index once; whole-selection / chain moves never query it.
      const neighbours =
        mode === 'moveChain' || mode === 'moveSelection'
          ? null
          : makeSnappingNeighbours(document.chains, document.nodes, locale, fontSize);

      session.current = {
        home: { x: current.position.x, y: current.position.y },
        wasChained: current.chainId !== null,
        detached: false,
        mode,
        chainId: current.chainId,
        homeAnchor,
        selectionUnits: mode === 'moveSelection' ? selectionUnits : null,
        neighbours,
        locale,
        fontSize,
      };
      // Re-seed from the store at press time so a stale effect sync can't skew the delta.
      startX.value = current.position.x;
      startY.value = current.position.y;
      dragX.value = current.position.x;
      dragY.value = current.position.y;
      dragging.value = 1;
      // Always publish so ConnectorLayer can track the live endpoint (P6.6). Snap
      // candidates stay null in moveChain / moveSelection — insertionFeedback no-ops.
      publishDragSnap(
        nodeId,
        current.position,
        null,
        mode === 'moveChain' ? current.chainId : null,
        mode === 'moveSelection' ? selectionUnits : null,
      );
    },
    [nodeId, dragging, startX, startY, dragX, dragY],
  );

  const updateDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      if (!sess) return;
      const position = { x: worldX, y: worldY };

      // MovingChain / moveSelection: no snap search — keep the ephemeral position
      // feed current so connector curves follow (siblings still move on the UI
      // thread via shared dx/dy; this runOnJS path is for React consumers only).
      if (sess.mode === 'moveChain') {
        publishDragSnap(nodeId, position, null, sess.chainId, null);
        return;
      }
      if (sess.mode === 'moveSelection') {
        publishDragSnap(nodeId, position, null, null, sess.selectionUnits);
        return;
      }

      if (sess.wasChained && !sess.detached && crossedDetachDistance(sess.home, position)) {
        sess.detached = true;
      }

      const { document } = useDocumentStore.getState();
      const current = document.nodes[nodeId];
      if (!current || !sess.neighbours) return;

      // Probe chainId: null once detached for ordinary members (§8.2 hysteresis);
      // results keep theirs (P6.7 — see snapProbeChainId).
      const probe = {
        ...current,
        position,
        chainId: snapProbeChainId({
          storeChainId: current.chainId,
          detached: sess.detached,
          kind: current.kind,
        }),
      };
      const candidate = resolveSnapCandidate(
        probe,
        sess.neighbours,
        document.nodes,
        sess.locale,
        sess.fontSize,
      );
      publishDragSnap(nodeId, position, candidate, null, null);
    },
    [nodeId],
  );

  const endDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      session.current = null;
      dragging.value = 0;

      const position = { x: worldX, y: worldY };
      const delta = { x: worldX - (sess?.home.x ?? worldX), y: worldY - (sess?.home.y ?? worldY) };

      if (sess?.mode === 'moveChain' && sess.chainId && sess.homeAnchor) {
        resetChainDragShared();
        resetSelectionDragShared();
        clearDragSnap();
        moveChain(sess.chainId, {
          x: sess.homeAnchor.x + delta.x,
          y: sess.homeAnchor.y + delta.y,
        });
        return;
      }

      if (sess?.mode === 'moveSelection' && sess.selectionUnits) {
        resetChainDragShared();
        resetSelectionDragShared();
        clearDragSnap();
        moveSelection(sess.selectionUnits, delta);
        return;
      }

      // Candidate comes from uiStore rather than the session ref: every onUpdate
      // publishes via runOnJS(updateDrag), and onEnd's runOnJS(endDrag) is queued
      // after those — Reanimated's JS runtime is FIFO, so the last frame's candidate
      // is already in dragSnap by the time this runs.
      const candidate = useUiStore.getState().dragSnap?.candidate ?? null;
      clearDragSnap();

      if (!sess) return;

      const dragged = useDocumentStore.getState().document.nodes[nodeId];
      const decision = decideDragRelease({
        wasChained: sess.wasChained,
        detached: sess.detached,
        candidate,
        position,
        isResult: dragged?.kind === 'result',
      });

      switch (decision.kind) {
        case 'snap':
          // Result → reference substitution lives in commitSnapOutcome (P6.7 / §11).
          commitSnapOutcome(nodeId, decision.outcome, position);
          break;
        case 'detach':
          detachNode(nodeId, decision.position);
          break;
        case 'move':
          moveFreeNode(nodeId, decision.position);
          break;
        case 'cancel':
          break;
      }
    },
    [nodeId, dragging],
  );

  const cancelDrag = useCallback(() => {
    session.current = null;
    resetChainDragShared();
    resetSelectionDragShared();
    clearDragSnap();
  }, []);

  const gesture = Gesture.Pan()
    .maxPointers(1)
    .minDistance(NODE_DRAG_ACTIVATION_DISTANCE)
    .enabled(!editingThis)
    .onBegin(() => {
      'worklet';
      pressStartMs.value = Date.now();
    })
    .onStart(() => {
      'worklet';
      const heldMs = Date.now() - pressStartMs.value;
      runOnJS(beginDrag)(heldMs);
    })
    .onUpdate((e) => {
      'worklet';
      // translationX/Y are screen pixels (Playwright confirmed: at zoom 0.25 a 20px
      // screen drag moved the node ~14 world units without `/zoom`, and ~screen/zoom
      // with it). Convert to world so SNAP_DISTANCE stays zoom-invariant (§7).
      const z = zoom.value === 0 ? 1 : zoom.value;
      const nextX = startX.value + e.translationX / z;
      const nextY = startY.value + e.translationY / z;
      dragX.value = nextX;
      dragY.value = nextY;
      // Sibling / selection follow must stay on the UI thread with the primary's
      // translate. Writing dx/dy via runOnJS(updateDrag) lagged followers by ≥1
      // frame (PR #61 review).
      const dx = nextX - startX.value;
      const dy = nextY - startY.value;
      if (chainDragChainId.value !== null) {
        chainDragDx.value = dx;
        chainDragDy.value = dy;
      }
      if (selectionDragActive.value === 1) {
        selectionDragDx.value = dx;
        selectionDragDy.value = dy;
      }
      // Always publish the live world point for ConnectorLayer / insertion caret.
      // Sibling follow stays on the UI thread above; this is the React-side feed.
      runOnJS(updateDrag)(nextX, nextY);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(endDrag)(dragX.value, dragY.value);
    })
    .onFinalize((_e, success) => {
      'worklet';
      // Cancelled / interrupted: drop ephemeral state and let the visual snap back.
      if (!success && dragging.value) {
        dragging.value = 0;
        runOnJS(cancelDrag)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    // Always set transform *and* zIndex explicitly — returning `{}` leaves the
    // previous translate stuck on the view after release (seen in Playwright:
    // left updated, matrix remained), and the same applies to a drag-time zIndex
    // of 1000 if idle frames omit it.
    if (dragging.value) {
      return {
        zIndex: 1000,
        transform: [
          { translateX: dragX.value - startX.value },
          { translateY: dragY.value - startY.value },
        ],
      };
    }
    // Sibling members of a chain being moved: follow the same delta without each
    // owning a drag gesture (§8.2 MovingChain).
    const cid = chainIdSV.value;
    if (cid !== null && chainDragChainId.value === cid) {
      return {
        zIndex: 999,
        transform: [{ translateX: chainDragDx.value }, { translateY: chainDragDy.value }],
      };
    }
    // Other units in a Select-all selection: same delta, keyed by node id (§8.6).
    if (selectionDragFollowers.value[nodeId] === 1) {
      return {
        zIndex: 999,
        transform: [
          { translateX: selectionDragDx.value },
          { translateY: selectionDragDy.value },
        ],
      };
    }
    return {
      zIndex: selected ? SELECTED_NODE_Z_INDEX : 0,
      transform: [{ translateX: 0 }, { translateY: 0 }],
    };
  }, [selected]);

  return { gesture, animatedStyle, dragging };
}
