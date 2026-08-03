// The result cell (§1.1, §6, §11.3): derived, read-only, never directly editable. v1 renders
// solid fill + border band only - the hue and border already say "not yours to edit," and the
// dot texture is decorative, deferred to P7.3 (decision #9). Read-only-ness itself is enforced
// where every mutation has to pass regardless of which view is on screen: `setNodeRaw`
// (store/commands.ts) throws rather than silently no-opping when the target isn't a number node.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { rolePalette, glyphColor } from '../ui/tokens';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';
import { Cell, glyphTextStyle } from './Cell';

interface ResultNodeProps {
  id: NodeId;
}

function ResultNodeComponent({ id }: ResultNodeProps) {
  const node = useNode(id);
  if (!node || node.kind !== 'result') return null;

  const locale = getDeviceLocale();
  const palette = rolePalette.result;

  return (
    <Cell
      testID={`result-node-${id}`}
      width={widthOf(node, locale)}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      <Text style={[glyphTextStyle, { color: glyphColor }]} numberOfLines={1}>
        {node.derived?.display ?? ''}
      </Text>
    </Cell>
  );
}

export const ResultNode = React.memo(ResultNodeComponent);
