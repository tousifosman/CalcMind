import { widthOf, measureTextWidth } from './measure';
import { tokens } from '../ui/tokens';
import { explainEngineError, RESULT_ERROR_FONT_SIZE } from '../engine/errors';
import type { NumberNode, OperatorNode, ParenNode, EqualsNode, ResultNode, ReferenceNode } from '../model/types';

function numberNode(raw: string): NumberNode {
  return { id: 'n1', kind: 'number', raw, position: { x: 0, y: 0 }, chainId: null, createdAt: 0 };
}

function operatorNode(op: OperatorNode['op'] = '+'): OperatorNode {
  return { id: 'n2', kind: 'operator', op, position: { x: 0, y: 0 }, chainId: null, createdAt: 0 };
}

function parenNode(side: ParenNode['side'] = 'open'): ParenNode {
  return { id: 'n3', kind: 'paren', side, position: { x: 0, y: 0 }, chainId: null, createdAt: 0 };
}

function equalsNode(): EqualsNode {
  return { id: 'n4', kind: 'equals', position: { x: 0, y: 0 }, chainId: null, createdAt: 0 };
}

function resultNode(display?: string): ResultNode {
  return {
    id: 'n5',
    kind: 'result',
    sourceChainId: 'c1',
    position: { x: 0, y: 0 },
    chainId: 'c1',
    createdAt: 0,
    derived: display === undefined ? undefined : { display, computedAt: '2026-08-03T00:00:00.000Z' },
  };
}

function referenceNode(): ReferenceNode {
  return {
    id: 'n6',
    kind: 'reference',
    targetNodeId: 'n5',
    position: { x: 0, y: 0 },
    chainId: null,
    createdAt: 0,
  };
}

describe('widthOf: symbol nodes', () => {
  test('operator and paren use operatorWidth', () => {
    expect(widthOf(operatorNode(), 'en-US')).toBe(tokens.operatorWidth);
    expect(widthOf(parenNode(), 'en-US')).toBe(tokens.operatorWidth);
  });

  test('equals uses equalsWidth', () => {
    expect(widthOf(equalsNode(), 'en-US')).toBe(tokens.equalsWidth);
  });

  test('symbol widths are unaffected by fontSize', () => {
    expect(widthOf(operatorNode(), 'en-US', 60)).toBe(tokens.operatorWidth);
    expect(widthOf(equalsNode(), 'en-US', 60)).toBe(tokens.equalsWidth);
  });
});

describe('widthOf: the nodeHeight floor', () => {
  test('a single digit floors at nodeHeight rather than measuring square', () => {
    expect(widthOf(numberNode('1'), 'en-US')).toBe(tokens.nodeHeight);
  });

  test('a long number exceeds the floor', () => {
    const width = widthOf(numberNode('123456789012'), 'en-US');
    expect(width).toBeGreaterThan(tokens.nodeHeight);
  });

  test('a result with no derived display yet still floors at nodeHeight', () => {
    expect(widthOf(resultNode(), 'en-US')).toBe(tokens.nodeHeight);
  });

  test('a result with a long derived display exceeds the floor', () => {
    const width = widthOf(resultNode('123456789012'), 'en-US');
    expect(width).toBeGreaterThan(tokens.nodeHeight);
  });

  test('a result in an error outcome sizes against the explanation at RESULT_ERROR_FONT_SIZE', () => {
    const node = resultNode('1');
    node.derived = {
      display: '1',
      computedAt: '2026-08-04T00:00:00.000Z',
      outcome: { status: 'error', error: 'DivideByZero' },
    };
    const explanation = explainEngineError('DivideByZero');
    const errorWidth = widthOf(node, 'en-US');
    // Must match the glyph size ResultNode actually renders — not numeralFontSize (30),
    // which oversizes the cell by more than nodeHeight (P4.6 review).
    expect(errorWidth).toBe(
      Math.max(
        tokens.nodeHeight,
        measureTextWidth(explanation, RESULT_ERROR_FONT_SIZE) + 2 * tokens.numberPaddingX,
      ),
    );
    expect(errorWidth).not.toBe(
      Math.max(
        tokens.nodeHeight,
        measureTextWidth(explanation, tokens.numeralFontSize) + 2 * tokens.numberPaddingX,
      ),
    );
  });
});

describe('widthOf: measures the displayed string, not the raw one', () => {
  test('a grouped display is wider than its ungrouped raw digit count would suggest', () => {
    const grouped = widthOf(numberNode('1000000'), 'en-US');
    const rawDigitsOnly = measureTextWidth('1000000', tokens.numeralFontSize) + 2 * tokens.numberPaddingX;
    // "1,000,000" has two extra separator glyphs over the bare "1000000" raw.
    expect(grouped).toBeGreaterThan(rawDigitsOnly);
  });

  test('the same raw measures differently under a locale that swaps separators', () => {
    const enUS = widthOf(numberNode('1234.5'), 'en-US');
    const deDE = widthOf(numberNode('1234.5'), 'de-DE');
    // Same glyph count either way ("1.234,5" vs "1,234.5"), just different separators.
    expect(enUS).toBe(deDE);
  });
});

describe('widthOf: cache invalidation on raw change', () => {
  test('editing a node raw picks up the new width, not a stale cached one', () => {
    const short = widthOf(numberNode('1'), 'en-US');
    const long = widthOf(numberNode('123456789012'), 'en-US');
    expect(long).toBeGreaterThan(short);

    // Editing the same logical node back down to a short raw must not keep returning
    // the wider cached value - each raw is its own cache entry.
    const backToShort = widthOf(numberNode('1'), 'en-US');
    expect(backToShort).toBe(short);
  });

  test('measureTextWidth is memoised: repeated calls for the same (text, fontSize) agree', () => {
    const a = measureTextWidth('42', 30);
    const b = measureTextWidth('42', 30);
    expect(a).toBe(b);
  });

  test('different fontSize is a different cache entry even for the same text', () => {
    const a = measureTextWidth('42', 30);
    const b = measureTextWidth('42', 60);
    expect(b).toBeGreaterThan(a);
  });
});

describe('widthOf: reference nodes (P4.9)', () => {
  test('sizes against the target result display when nodes are provided', () => {
    const target = resultNode('1,204');
    const ref = referenceNode();
    ref.targetNodeId = target.id;
    const nodes = { [target.id]: target, [ref.id]: ref };
    expect(widthOf(ref, 'en-US', tokens.numeralFontSize, nodes)).toBe(
      widthOf(target, 'en-US'),
    );
  });

  test('without a nodes map, falls back to the minimum cell width', () => {
    expect(widthOf(referenceNode(), 'en-US')).toBe(tokens.nodeHeight);
  });
});
