// Reference cell (P4.9 / §8.7 / P6.5): shows another node's live value, filled with
// that value's identity hue so two cells sharing a hue are the same value wherever
// they sit (§11.1). A dangling / unassigned target keeps the neutral outlined pill —
// colour is spent only where an identity exists.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { useDocumentStore } from '../store/documentStore';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';
import { glyphColor, tokens } from '../ui/tokens';
import { Cell, glyphTextStyle } from './Cell';
import { referenceDisplayText } from '../chains/referenceDisplay';
import { useReferenceIdentityHue } from './useIdentityHue';

/** No-identity palette — distinct from role fills so an uncoloured reference is
 *  not mistaken for a number/result (dangling target, or hue not yet assigned). */
const REFERENCE_NEUTRAL = { fill: '#4B5563', border: '#9CA3AF' } as const;

interface ReferenceNodeProps {
  id: NodeId;
}

function ReferenceNodeComponent({ id }: ReferenceNodeProps) {
  const node = useNode(id);
  const nodes = useDocumentStore((s) => s.document.nodes);
  const identityHue = useReferenceIdentityHue(id);
  if (!node || node.kind !== 'reference') return null;

  const locale = getDeviceLocale();
  const text = referenceDisplayText(node, nodes, locale);
  // Declaring cells draw a ring; references fill with the hue (§11.1 / linking-model.svg).
  const fill = identityHue ?? REFERENCE_NEUTRAL.fill;
  const border = identityHue ?? REFERENCE_NEUTRAL.border;

  return (
    <Cell
      testID={`reference-node-${id}`}
      width={widthOf(node, locale, tokens.numeralFontSize, nodes)}
      fill={fill}
      border={border}
      label={node.label}
    >
      <Text
        testID={`reference-node-${id}-content`}
        accessibilityLabel={text === '' ? undefined : text}
        style={[glyphTextStyle, { color: glyphColor }]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </Cell>
  );
}

export const ReferenceNode = React.memo(ReferenceNodeComponent);
