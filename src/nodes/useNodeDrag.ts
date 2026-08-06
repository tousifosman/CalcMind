// Node drag gesture (§8.2, P3.5 / P3.7). Position lives in Reanimated shared values every
// frame; the document store is written only on release via P3.4 / P3.7 commands (§11.4).
// Snap candidates are recomputed on the JS thread each update and published to
// `uiStore.dragSnap` — ephemeral, outside undo. NodeLayer reads that feed for the
// §8.3 insertion gap + caret (P3.6); this hook never writes document positions
// mid-drag, so the preview can open and close without touching undo history.
//
// MovingChain (P3.7): hold then drag (heldMs from onBegin→onStart ≥ CHAIN_MOVE_HOLD_MS)
// lifts the whole chain (anchor update); a plain drag detaches the member.
// `Select group` is the other move-chain route (§8.6). Context menu at 500 ms wins —
// never enter moveChain while `contextMenu !== null`.
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
} from '../store/commands';
import { useDocumentStore } from '../store/documentStore';
import { useNode } from '../store/selectors';
import { useUiStore } from '../store/uiStore';
import { getDeviceLocale } from '../ui/locale';
import { useCanvasViewport } from '../canvas/ViewportContext';
import {
  chainDragChainId,
  chainDragDx,
  chainDragDy,
  resetChainDragShared,
} from './chainDragShared';
import {
  crossedDetachDistance,
  decideDragRelease,
  resolveNodeDragMode,
  snapProbeChainId,
  type NodeDragMode,
} from './dragLifecycle';

/** Screen pixels of movement before a press becomes a node drag. Below this,
 *  Canvas's Tap still wins (select / create); above it, the node claims the gesture
 *  and should stop the canvas pan from also moving. */
const NODE_DRAG_ACTIVATION_DISTANCE = 6;

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
): void {
  useUiStore.getState().setDragSnap({
    nodeId,
    position,
    candidate,
    movingChainId,
  });
}

function clearDragSnap(): void {
  useUiStore.getState().setDragSnap(null);
}

export function useNodeDrag(nodeId: NodeId): NodeDragHandle {
  const { zoom } = useCanvasViewport();
  const node = useNode(nodeId);
  const editingThis = useUiStore((state) => state.editingNodeId === nodeId);

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
    /** Built once at drag start — document is immutable mid-drag (§11.4 commit
     *  on release), so rebuilding the §8.4 spatial hash every frame would pay
     *  O(n) bounds work for nothing. Query still runs per frame with the live
     *  probe position. */
    neighbours: SnappingNeighbours | null;
    locale: string;
  } | null>(null);

  const beginDrag = useCallback(
    (heldMs: number) => {
      const current = useDocumentStore.getState().document.nodes[nodeId];
      if (!current) return;

      const ui = useUiStore.getState();
      const groupSelected =
        current.chainId !== null && ui.groupSelectedIds.has(nodeId);
      const mode = resolveNodeDragMode({
        wasChained: current.chainId !== null,
        heldMs,
        groupSelected,
        contextMenuOpen: ui.contextMenu !== null,
      });

      let homeAnchor: Vec2 | null = null;
      if (mode === 'moveChain' && current.chainId) {
        const chain = useDocumentStore.getState().document.chains[current.chainId];
        if (!chain) return;
        homeAnchor = { x: chain.anchor.x, y: chain.anchor.y };
        chainDragChainId.value = current.chainId;
        chainDragDx.value = 0;
        chainDragDy.value = 0;
      }

      const { document } = useDocumentStore.getState();
      const locale = getDeviceLocale();
      // Index once; moveChain never queries it.
      const neighbours =
        mode === 'moveChain'
          ? null
          : makeSnappingNeighbours(document.chains, document.nodes, locale);

      session.current = {
        home: { x: current.position.x, y: current.position.y },
        wasChained: current.chainId !== null,
        detached: false,
        mode,
        chainId: current.chainId,
        homeAnchor,
        neighbours,
        locale,
      };
      // Re-seed from the store at press time so a stale effect sync can't skew the delta.
      startX.value = current.position.x;
      startY.value = current.position.y;
      dragX.value = current.position.x;
      dragY.value = current.position.y;
      dragging.value = 1;
      // Always publish so ConnectorLayer can track the live endpoint (P6.6). Snap
      // candidates stay null in moveChain — insertionFeedback no-ops on null.
      publishDragSnap(
        nodeId,
        current.position,
        null,
        mode === 'moveChain' ? current.chainId : null,
      );
    },
    [nodeId, dragging, startX, startY, dragX, dragY],
  );

  const updateDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      if (!sess) return;
      const position = { x: worldX, y: worldY };

      // MovingChain: no snap search — just keep the ephemeral position feed current
      // so connector curves follow the chain (siblings still move on the UI thread
      // via chainDragDx/Dy; this runOnJS path is for React consumers only).
      if (sess.mode === 'moveChain') {
        publishDragSnap(nodeId, position, null, sess.chainId);
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
      );
      publishDragSnap(nodeId, position, candidate, null);
    },
    [nodeId],
  );

  const endDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      session.current = null;
      dragging.value = 0;

      const position = { x: worldX, y: worldY };

      if (sess?.mode === 'moveChain' && sess.chainId && sess.homeAnchor) {
        resetChainDragShared();
        clearDragSnap();
        moveChain(sess.chainId, {
          x: sess.homeAnchor.x + (worldX - sess.home.x),
          y: sess.homeAnchor.y + (worldY - sess.home.y),
        });
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
      // Sibling follow must stay on the UI thread with the primary's translate. Writing
      // chainDragDx/Dy via runOnJS(updateDrag) lagged followers by ≥1 frame (PR #61 review).
      if (chainDragChainId.value !== null) {
        chainDragDx.value = nextX - startX.value;
        chainDragDy.value = nextY - startY.value;
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
    // Always set transform explicitly — returning `{}` leaves the previous translate
    // stuck on the view after release (seen in Playwright: left updated, matrix remained).
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
    return { zIndex: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
  });

  return { gesture, animatedStyle, dragging };
}
