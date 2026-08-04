// The result cell (§1.1, §6, §11.3): derived, read-only, never directly editable. v1 renders
// solid fill + border band only - the hue and border already say "not yours to edit," and the
// dot texture is decorative, deferred to P7.3 (decision #9). Read-only-ness itself is enforced
// where every mutation has to pass regardless of which view is on screen: `setNodeRaw`
// (store/commands.ts) throws rather than silently no-opping when the target isn't a number node.
//
// §10.4 / §9 presentation: successful values render normally; `stale` keeps the previous value
// dimmed rather than flashing empty; engine errors render as explanations from
// `explainEngineError`, never as a bare glyph (§11.2).
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { rolePalette, glyphColor } from '../ui/tokens';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';
import { resultCellContent, RESULT_ERROR_FONT_SIZE } from '../engine/errors';
import { Cell, glyphTextStyle } from './Cell';

/** Opacity for a §9 Stale result — previous value stays readable but clearly not current. */
export const STALE_RESULT_OPACITY = 0.45;

interface ResultNodeProps {
  id: NodeId;
}

function ResultNodeComponent({ id }: ResultNodeProps) {
  const node = useNode(id);
  if (!node || node.kind !== 'result') return null;

  const locale = getDeviceLocale();
  const palette = rolePalette.result;
  const content = resultCellContent(node.derived);

  const textStyle =
    content.mode === 'error'
      ? [styles.errorGlyph, { color: glyphColor }]
      : [
          glyphTextStyle,
          { color: glyphColor, opacity: content.mode === 'stale' ? STALE_RESULT_OPACITY : 1 },
        ];

  return (
    <Cell
      testID={`result-node-${id}`}
      width={widthOf(node, locale)}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      <Text
        testID={`result-node-${id}-content`}
        accessibilityLabel={content.text === '' ? undefined : content.text}
        style={textStyle}
        numberOfLines={1}
      >
        {content.text}
      </Text>
    </Cell>
  );
}

export const ResultNode = React.memo(ResultNodeComponent);

const styles = StyleSheet.create({
  errorGlyph: {
    fontSize: RESULT_ERROR_FONT_SIZE,
    fontWeight: '800',
    marginTop: 0,
  },
});
