// Reference cell (§8.7 / §11.2): shows another node's live value, or — when the
// target is gone — a neutral struck-through cell with the last known value dimmed
// (P6.4). Identity hue and connector styling are P6.5/P6.6; until then live refs
// stay a neutral outlined pill (P4.9: "A reference with no hue yet is correct here").
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { useDocumentStore } from '../store/documentStore';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';
import { glyphColor, tokens } from '../ui/tokens';
import { Cell, glyphTextStyle } from './Cell';
import { referenceCellContent } from '../engine/reference';

/** Interim no-hue palette — distinct from role fills so an unassigned reference is
 *  not mistaken for a number/result, and not an identityHue (those are P6.5). */
const REFERENCE_NEUTRAL = { fill: '#4B5563', border: '#9CA3AF' } as const;

/** Dangling palette: still neutral, but quieter so the struck-through value reads as
 *  "was a link" rather than a live cell (§11.2). */
const REFERENCE_DANGLING = { fill: '#6B7280', border: '#9CA3AF' } as const;

/** Opacity for a dangling last-known value — same budget as §9 Stale results. */
export const DANGLING_REFERENCE_OPACITY = 0.45;

interface ReferenceNodeProps {
  id: NodeId;
}

function ReferenceNodeComponent({ id }: ReferenceNodeProps) {
  const node = useNode(id);
  const nodes = useDocumentStore((s) => s.document.nodes);
  if (!node || node.kind !== 'reference') return null;

  const locale = getDeviceLocale();
  const content = referenceCellContent(node, nodes, locale);
  const palette = content.mode === 'dangling' ? REFERENCE_DANGLING : REFERENCE_NEUTRAL;

  return (
    <Cell
      testID={`reference-node-${id}`}
      width={widthOf(node, locale, tokens.numeralFontSize, nodes)}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      <Text
        testID={`reference-node-${id}-content`}
        accessibilityLabel={
          content.text === ''
            ? content.mode === 'dangling'
              ? 'Broken link'
              : undefined
            : content.mode === 'dangling'
              ? `Broken link, last value ${content.text}`
              : content.text
        }
        style={[
          glyphTextStyle,
          { color: glyphColor },
          content.mode === 'dangling' ? styles.danglingGlyph : null,
        ]}
        numberOfLines={1}
      >
        {content.text}
      </Text>
    </Cell>
  );
}

export const ReferenceNode = React.memo(ReferenceNodeComponent);

const styles = StyleSheet.create({
  danglingGlyph: {
    opacity: DANGLING_REFERENCE_OPACITY,
    textDecorationLine: 'line-through',
  },
});
