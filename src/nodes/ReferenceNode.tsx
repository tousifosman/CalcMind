// Reference cell (P4.9 / §8.7): shows another node's live value. Identity hue and
// connector styling are P6.5/P6.6 — until then the cell is a neutral outlined pill so
// it reads as "a value from elsewhere" without inventing a hue the palette hasn't
// assigned yet (P4.9: "A reference with no hue yet is correct here").
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

/** Interim no-hue palette — distinct from role fills so an unassigned reference is
 *  not mistaken for a number/result, and not an identityHue (those are P6.5). */
const REFERENCE_NEUTRAL = { fill: '#4B5563', border: '#9CA3AF' } as const;

interface ReferenceNodeProps {
  id: NodeId;
}

function ReferenceNodeComponent({ id }: ReferenceNodeProps) {
  const node = useNode(id);
  const nodes = useDocumentStore((s) => s.document.nodes);
  if (!node || node.kind !== 'reference') return null;

  const locale = getDeviceLocale();
  const text = referenceDisplayText(node, nodes, locale);

  return (
    <Cell
      testID={`reference-node-${id}`}
      width={widthOf(node, locale, tokens.numeralFontSize, nodes)}
      fill={REFERENCE_NEUTRAL.fill}
      border={REFERENCE_NEUTRAL.border}
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
