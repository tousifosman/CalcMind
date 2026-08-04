// Puts every node on the canvas at its world position. See docs/ARCHITECTURE.md §7 (the
// transform Canvas already applies to its children - this layer adds no arithmetic of its
// own, per the comment at the top of Canvas.tsx), §8.1 (`position` is the field to read) and
// §11.4 (re-render scope). Drag (P3.5) wraps each node in its own Pan gesture; mid-drag
// position is a Reanimated transform, store writes happen only on release.
//
// P3.6: while a snap candidate is live, members of the target open a gap via a temporary
// `left` offset (not a document write) and an insertion caret is drawn at the slot. Both
// clear when `dragSnap` is null, so dropping out of range closes the gap without a jump.
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { insertionFeedback, type InsertionCaret } from '../chains/layout';
import { NodeId, NodeKind } from '../model/types';
import { useNode, useNodeIds } from '../store/selectors';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { NumberNode } from '../nodes/NumberNode';
import { OperatorNode } from '../nodes/OperatorNode';
import { ParenNode } from '../nodes/ParenNode';
import { EqualsNode } from '../nodes/EqualsNode';
import { ResultNode } from '../nodes/ResultNode';
import { ReferenceNode } from '../nodes/ReferenceNode';
import { useNodeDrag } from '../nodes/useNodeDrag';
import { getDeviceLocale } from '../ui/locale';
import { insertionCaretColor } from '../ui/tokens';

function renderByKind(id: NodeId, kind: NodeKind): React.ReactElement | null {
  switch (kind) {
    case 'number':
      return <NumberNode id={id} />;
    case 'operator':
      return <OperatorNode id={id} />;
    case 'paren':
      return <ParenNode id={id} />;
    case 'equals':
      return <EqualsNode id={id} />;
    case 'result':
      return <ResultNode id={id} />;
    case 'reference':
      return <ReferenceNode id={id} />;
  }
}

function PositionedNodeComponent({
  id,
  gapOffset,
}: {
  id: NodeId;
  /** Temporary world-space shift while a snap candidate holds (§8.3). Zero when idle. */
  gapOffset: { x: number; y: number };
}) {
  const node = useNode(id);
  const { gesture, animatedStyle } = useNodeDrag(id);
  if (!node) return null;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.positioned,
          {
            left: node.position.x + gapOffset.x,
            top: node.position.y + gapOffset.y,
          },
          animatedStyle,
        ]}
        testID={`positioned-node-${id}`}
      >
        {renderByKind(id, node.kind)}
      </Animated.View>
    </GestureDetector>
  );
}

// Each node subscribes to its own slice via useNode above, so this only guards against
// re-rendering when the *list* of ids changes (a sibling being added/removed) - the actual
// content update for one node is already scoped by the store subscription, not by this memo.
// `gapOffset` is part of the props comparison so an insertion preview re-renders only the
// members that actually shift (and those whose offset returns to 0 when the gap closes).
const PositionedNode = React.memo(PositionedNodeComponent);

function InsertionCaretView({ caret }: { caret: InsertionCaret }) {
  return (
    <View
      pointerEvents="none"
      testID="insertion-caret"
      style={[
        styles.caret,
        {
          left: caret.x,
          top: caret.y,
          width: caret.width,
          height: caret.height,
          backgroundColor: insertionCaretColor,
        },
      ]}
    />
  );
}

export function NodeLayer() {
  // Subscribes to the id list only, not to the node map (§11.4) - see useNodeIds' own comment
  // for why that needs useShallow to hold.
  const nodeIds = useNodeIds();
  // Ephemeral drag feed from P3.5. Document is read via getState inside the memo so a
  // mid-drag candidate update does not subscribe this layer to every node mutation —
  // the document is frozen for the duration of a drag (commits only on release).
  const dragSnap = useUiStore((state) => state.dragSnap);

  const feedback = useMemo(() => {
    if (!dragSnap) {
      return {
        caret: null as InsertionCaret | null,
        offsets: {} as Record<NodeId, { x: number; y: number }>,
      };
    }
    const { document } = useDocumentStore.getState();
    const dragged = document.nodes[dragSnap.nodeId];
    if (!dragged) {
      return {
        caret: null as InsertionCaret | null,
        offsets: {} as Record<NodeId, { x: number; y: number }>,
      };
    }
    // Pass the live drag position so newChain-with-dragged-as-left previews against
    // the release-point anchor formNewChain will commit (PR #63 review).
    return insertionFeedback(
      dragSnap.candidate,
      dragged,
      document.chains,
      document.nodes,
      getDeviceLocale(),
      dragSnap.position,
    );
  }, [dragSnap]);

  return (
    <View style={styles.fill} pointerEvents="box-none">
      {nodeIds.map((id) => {
        // Never shift the node under the finger — its motion is the drag transform alone.
        const gapOffset =
          dragSnap && id === dragSnap.nodeId
            ? { x: 0, y: 0 }
            : (feedback.offsets[id] ?? { x: 0, y: 0 });
        return <PositionedNode key={id} id={id} gapOffset={gapOffset} />;
      })}
      {feedback.caret ? <InsertionCaretView caret={feedback.caret} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  positioned: {
    position: 'absolute',
  },
  caret: {
    position: 'absolute',
    borderRadius: 1,
    zIndex: 1100, // above the dragged node (zIndex 1000) so the hairline stays visible in the gap
  },
});
