// The paren cell (§1.1, §6, §10.2). No dedicated role in §1.2's palette table - like
// `chains/measure.ts#widthOf`, it shares the operator's fixed width and colour, since visually
// it's a single fixed glyph exactly like an operator.
//
// `depth` renders as a subtle lightening step so nesting is legible (§10.2's acceptance
// criterion), but computing *actual* depth from a chain's balanced parens is chain-layout's job
// (§9), not built until P3/P4 - this component only knows how to paint whatever depth it's told.
import React from 'react';
import { Text } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { tokens, rolePalette, glyphColor, lightenHex } from '../ui/tokens';
import { Cell, glyphTextStyle } from './Cell';
import { useSourceIdentityHue } from './useIdentityHue';

interface ParenNodeProps {
  id: NodeId;
  /** Nesting depth of this paren within its chain, 0 for the outermost pair. Defaults to 0 until
   *  a chain-aware caller (P3/P4) computes and passes the real value. */
  depth?: number;
}

/** Beyond a few steps a lightening tint reads as flat rather than progressively deeper, and gets
 *  close enough to white to wash out the glyph (§1.2's white numerals) - so depth is clamped
 *  rather than left to fade indefinitely. */
const MAX_TINT_DEPTH = 4;
const TINT_STEP = 0.12;

/** Exported for direct unit testing of the colour math, separate from rendering. */
export function tintForDepth(hex: string, depth: number): string {
  const steps = Math.min(Math.max(depth, 0), MAX_TINT_DEPTH);
  return steps === 0 ? hex : lightenHex(hex, steps * TINT_STEP);
}

function ParenNodeComponent({ id, depth = 0 }: ParenNodeProps) {
  const node = useNode(id);
  const identityHue = useSourceIdentityHue(id);
  if (!node || node.kind !== 'paren') return null;

  const palette = rolePalette.operator;

  return (
    <Cell
      testID={`paren-node-${id}`}
      width={tokens.operatorWidth}
      fill={tintForDepth(palette.fill, depth)}
      border={tintForDepth(palette.border, depth)}
      label={node.label}
      identityHue={identityHue}
    >
      <Text style={[glyphTextStyle, { color: glyphColor }]}>
        {node.side === 'open' ? '(' : ')'}
      </Text>
    </Cell>
  );
}

export const ParenNode = React.memo(ParenNodeComponent);
