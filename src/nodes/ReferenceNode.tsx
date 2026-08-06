// Reference cell (§8.7 / §11.1 / §11.2): shows another node's live value, filled with
// that value's identity hue so two cells sharing a hue are the same value wherever
// they sit (P6.5). The identity caption is looked up on the source and drawn here too
// (P6b.1 / §11.1) — editing the source updates every reference together. When the
// target is gone, a neutral struck-through cell keeps the last known value dimmed
// (P6.4) — colour is spent only where an identity still exists.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { useDocumentStore } from '../store/documentStore';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';
import { glyphColor, identityBorderFor, tokens } from '../ui/tokens';
import { Cell, glyphTextStyle } from './Cell';
import { referenceCellContent } from '../engine/reference';
import { labelForNode } from '../engine/identity';
import { useReferenceIdentityHue } from './useIdentityHue';
import { useNodeSelected } from './useNodeSelected';

/** No-identity palette — distinct from role fills so an uncoloured reference is
 *  not mistaken for a number/result (dangling target, or hue not yet assigned). */
const REFERENCE_NEUTRAL = { fill: '#4B5563', border: '#9CA3AF' } as const;

/** Dangling palette: still neutral, but quieter so the struck-through value reads as
 *  "was a link" rather than a live cell (§11.2). Identity hue is withheld — the
 *  source identity is gone. */
const REFERENCE_DANGLING = { fill: '#6B7280', border: '#9CA3AF' } as const;

/** Opacity for a dangling last-known value — same budget as §9 Stale results. */
export const DANGLING_REFERENCE_OPACITY = 0.45;

interface ReferenceNodeProps {
  id: NodeId;
}

function ReferenceNodeComponent({ id }: ReferenceNodeProps) {
  const node = useNode(id);
  const nodes = useDocumentStore((s) => s.document.nodes);
  const identityHue = useReferenceIdentityHue(id);
  const selected = useNodeSelected(id);
  if (!node || node.kind !== 'reference') return null;

  const locale = getDeviceLocale();
  const content = referenceCellContent(node, nodes, locale);
  const identityLabel = labelForNode(nodes, id);

  let fill: string;
  let border: string;
  if (content.mode === 'dangling') {
    fill = REFERENCE_DANGLING.fill;
    border = REFERENCE_DANGLING.border;
  } else if (identityHue) {
    // Declaring cells draw a ring; references fill with the hue (§11.1). Border is
    // a lightened twin of the fill (rolePalette pattern) so the cell stays bounded
    // on the dark canvas — linking-model.svg paints both the same, which reads flat.
    fill = identityHue;
    border = identityBorderFor(identityHue);
  } else {
    fill = REFERENCE_NEUTRAL.fill;
    border = REFERENCE_NEUTRAL.border;
  }

  return (
    <Cell
      testID={`reference-node-${id}`}
      width={widthOf(node, locale, tokens.numeralFontSize, nodes)}
      fill={fill}
      border={border}
      label={identityLabel}
      // Caption uses the identity hue without drawing a declaring-cell ring.
      labelHue={identityHue}
      selected={selected}
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
