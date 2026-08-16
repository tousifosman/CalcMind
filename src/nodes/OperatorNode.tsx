// The operator cell (§1.1, §6): fixed-width, amber, one of the four `OperatorSymbol` glyphs.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { tokens, rolePalette, glyphColor } from '../ui/tokens';
import { Cell, useGlyphTextStyle } from './Cell';
import { useSourceIdentityHue } from './useIdentityHue';
import { useNodeSelected } from './useNodeSelected';

interface OperatorNodeProps {
  id: NodeId;
}

function OperatorNodeComponent({ id }: OperatorNodeProps) {
  const node = useNode(id);
  const identityHue = useSourceIdentityHue(id);
  const selected = useNodeSelected(id);
  const glyphTextStyle = useGlyphTextStyle();
  if (!node || node.kind !== 'operator') return null;

  const palette = rolePalette.operator;

  return (
    <Cell
      testID={`operator-node-${id}`}
      width={tokens.operatorWidth}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
      identityHue={identityHue}
      selected={selected}
    >
      <Text style={[glyphTextStyle, { color: glyphColor }]}>{node.op}</Text>
    </Cell>
  );
}

export const OperatorNode = React.memo(OperatorNodeComponent);
