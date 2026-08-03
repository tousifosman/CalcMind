// The `=` cell (§1.1, §6): fixed-width, purple. Appending one to a valid chain is what creates
// the chain's result node (§9) - this component only renders the `=` itself.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { tokens, rolePalette, glyphColor } from '../ui/tokens';
import { Cell, glyphTextStyle } from './Cell';

interface EqualsNodeProps {
  id: NodeId;
}

function EqualsNodeComponent({ id }: EqualsNodeProps) {
  const node = useNode(id);
  if (!node || node.kind !== 'equals') return null;

  const palette = rolePalette.equals;

  return (
    <Cell
      testID={`equals-node-${id}`}
      width={tokens.equalsWidth}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      <Text style={[glyphTextStyle, { color: glyphColor }]}>=</Text>
    </Cell>
  );
}

export const EqualsNode = React.memo(EqualsNodeComponent);
