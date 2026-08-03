// The number cell (§1.1, §6). Displays `raw` through the locale display layer (§10.3/P2.1) -
// storage stays canonical, only this render step ever formats it for a human. In-place editing
// (caret, keypad input) is P2.6/P2.8; this component only ever shows the committed value.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { formatForDisplay } from '../engine/format';
import { widthOf } from '../chains/measure';
import { rolePalette, glyphColor } from '../ui/tokens';
import { getDeviceLocale } from '../ui/locale';
import { Cell, glyphTextStyle } from './Cell';

interface NumberNodeProps {
  id: NodeId;
}

function NumberNodeComponent({ id }: NumberNodeProps) {
  const node = useNode(id);
  if (!node || node.kind !== 'number') return null;

  const locale = getDeviceLocale();
  const palette = rolePalette.number;

  return (
    <Cell
      testID={`number-node-${id}`}
      width={widthOf(node, locale)}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      <Text style={[glyphTextStyle, { color: glyphColor }]} numberOfLines={1}>
        {formatForDisplay(node.raw, locale)}
      </Text>
    </Cell>
  );
}

export const NumberNode = React.memo(NumberNodeComponent);
