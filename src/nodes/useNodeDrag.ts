// Node drag gesture (§8.2, P3.5 / P3.7). Position lives in Reanimated shared values every
// frame; the document store is written only on release via P3.4 / P3.7 commands (§11.4).
// Snap candidates are recomputed on the JS thread each update and published to
// `uiStore.dragSnap` for the insertion caret (P3.6) — ephemeral, outside undo.
//
// MovingChain (P3.7): a ≥200 ms dwell then move lifts the whole chain (anchor update);
// a plain drag detaches the member. `Select group` is the other move-chain route (§8.6).
// Context menu at 500 ms wins — never enter moveChain while `contextMenu !== null`.
import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { makeSnappingNeighbours } from '../chains/bounds';
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
): void {
  useUiStore.getState().setDragSnap({ nodeId, position, candidate });
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

      session.current = {
        home: { x: current.position.x, y: current.position.y },
        wasChained: current.chainId !== null,
        detached: false,
        mode,
        chainId: current.chainId,
        homeAnchor,
      };
      // Re-seed from the store at press time so a stale effect sync can't skew the delta.
      startX.value = current.position.x;
      startY.value = current.position.y;
      dragX.value = current.position.x;
      dragY.value = current.position.y;
      dragging.value = 1;
      if (mode !== 'moveChain') {
        publishDragSnap(nodeId, current.position, null);
      }
    },
    [nodeId, dragging, startX, startY, dragX, dragY],
  );

  const updateDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      if (!sess) return;
      const position = { x: worldX, y: worldY };

      if (sess.mode === 'moveChain' && sess.homeAnchor) {
        const dx = worldX - sess.home.x;
        const dy = worldY - sess.home.y;
        chainDragDx.value = dx;
        chainDragDy.value = dy;
        return;
      }

      if (sess.wasChained && !sess.detached && crossedDetachDistance(sess.home, position)) {
        sess.detached = true;
      }

      const { document } = useDocumentStore.getState();
      const current = document.nodes[nodeId];
      if (!current) return;

      // Once past DETACH_DISTANCE, probe as free so the vacated chain can become a
      // candidate again — hysteresis (DETACH > SNAP) stops an immediate re-snap (§8.2).
      const probe = {
        ...current,
        position,
        chainId: sess.detached ? null : current.chainId,
      };
      const locale = getDeviceLocale();
      const neighbours = makeSnappingNeighbours(document.chains, document.nodes, locale);
      const candidate = resolveSnapCandidate(probe, neighbours, document.nodes, locale);
      publishDragSnap(nodeId, position, candidate);
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

      const decision = decideDragRelease({
        wasChained: sess.wasChained,
        detached: sess.detached,
        candidate,
        position,
      });

      switch (decision.kind) {
        case 'snap':
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
