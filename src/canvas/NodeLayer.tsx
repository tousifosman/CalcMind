// Puts every node on the canvas at its world position. See docs/ARCHITECTURE.md §7 (the
// transform Canvas already applies to its children - this layer adds no arithmetic of its
// own, per the comment at the top of Canvas.tsx), §8.1 (`position` is the field to read) and
// §11.4 (re-render scope).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { NodeId, NodeKind } from '../model/types';
import { useNode, useNodeIds } from '../store/selectors';
import { NumberNode } from '../nodes/NumberNode';
import { OperatorNode } from '../nodes/OperatorNode';
import { ParenNode } from '../nodes/ParenNode';
import { EqualsNode } from '../nodes/EqualsNode';
import { ResultNode } from '../nodes/ResultNode';

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
      // Not created before P6 (§6) - nothing to render yet.
      return null;
  }
}

function PositionedNodeComponent({ id }: { id: NodeId }) {
  const node = useNode(id);
  if (!node) return null;

  return (
    <View style={[styles.positioned, { left: node.position.x, top: node.position.y }]}>
      {renderByKind(id, node.kind)}
    </View>
  );
}

// Each node subscribes to its own slice via useNode above, so this only guards against
// re-rendering when the *list* of ids changes (a sibling being added/removed) - the actual
// content update for one node is already scoped by the store subscription, not by this memo.
const PositionedNode = React.memo(PositionedNodeComponent);

export function NodeLayer() {
  // Subscribes to the id list only, not to the node map (§11.4) - see useNodeIds' own comment
  // for why that needs useShallow to hold.
  const nodeIds = useNodeIds();

  return (
    <View style={styles.fill} pointerEvents="box-none">
      {nodeIds.map((id) => (
        <PositionedNode key={id} id={id} />
      ))}
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
});
