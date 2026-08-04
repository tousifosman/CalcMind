// Node drag gesture (§8.2, P3.5). Position lives in Reanimated shared values every
// frame; the document store is written only on release via P3.4 commands (§11.4).
// Snap candidates are recomputed on the JS thread each update and published to
// `uiStore.dragSnap` for the insertion caret (P3.6) — ephemeral, outside undo.
import { useCallback, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { makeSnappingNeighbours } from '../chains/bounds';
import { resolveSnapCandidate, type SnapOutcome } from '../chains/snapping';
import type { NodeId, Vec2 } from '../model/types';
import {
  commitSnapOutcome,
  detachNode,
  moveFreeNode,
} from '../store/commands';
import { useDocumentStore } from '../store/documentStore';
import { useNode } from '../store/selectors';
import { useUiStore } from '../store/uiStore';
import { getDeviceLocale } from '../ui/locale';
import { useCanvasViewport } from '../canvas/ViewportContext';
import {
  crossedDetachDistance,
  decideDragRelease,
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

  const dragX = useSharedValue(node?.position.x ?? 0);
  const dragY = useSharedValue(node?.position.y ?? 0);
  const startX = useSharedValue(node?.position.x ?? 0);
  const startY = useSharedValue(node?.position.y ?? 0);
  const dragging = useSharedValue(0);

  // Keep start/drag shared values aligned with the store position while idle so
  // onStart → onUpdate has no JS-thread race on the home coordinates.
  if (node && dragging.value === 0) {
    startX.value = node.position.x;
    startY.value = node.position.y;
    dragX.value = node.position.x;
    dragY.value = node.position.y;
  }

  const session = useRef<{
    home: Vec2;
    wasChained: boolean;
    detached: boolean;
  } | null>(null);

  const beginDrag = useCallback(() => {
    const current = useDocumentStore.getState().document.nodes[nodeId];
    if (!current) return;
    session.current = {
      home: { x: current.position.x, y: current.position.y },
      wasChained: current.chainId !== null,
      detached: false,
    };
    dragging.value = 1;
    publishDragSnap(nodeId, current.position, null);
  }, [nodeId, dragging]);

  const updateDrag = useCallback(
    (worldX: number, worldY: number) => {
      const sess = session.current;
      if (!sess) return;
      const position = { x: worldX, y: worldY };

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

  const gesture = Gesture.Pan()
    .maxPointers(1)
    .minDistance(NODE_DRAG_ACTIVATION_DISTANCE)
    .enabled(!editingThis)
    .onStart(() => {
      'worklet';
      runOnJS(beginDrag)();
    })
    .onUpdate((e) => {
      'worklet';
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
        runOnJS(clearDragSnap)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    if (!dragging.value) {
      return { zIndex: 0 };
    }
    return {
      zIndex: 1000,
      transform: [
        { translateX: dragX.value - startX.value },
        { translateY: dragY.value - startY.value },
      ],
    };
  });

  return { gesture, animatedStyle, dragging };
}
