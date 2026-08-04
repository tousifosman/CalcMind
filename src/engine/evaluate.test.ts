import Decimal from 'decimal.js';
import { evaluate, isEngineError } from './evaluate';
import { parse } from './parse';
import { tokenize } from './tokenize';
import type {
  CalcNode,
  Chain,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ParenNode,
} from '../model/types';

const ORIGIN = { x: 0, y: 0 };

function number(id: string, raw: string): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function op(id: string, symbol: OperatorSymbol): OperatorNode {
  return { id, kind: 'operator', op: symbol, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function paren(id: string, side: 'open' | 'close'): ParenNode {
  return { id, kind: 'paren', side, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function chainOf(nodes: CalcNode[]): { chain: Chain; nodes: Record<string, CalcNode> } {
  const map: Record<string, CalcNode> = {};
  for (const n of nodes) {
    map[n.id] = n;
  }
  return {
    chain: { id: 'c1', anchor: ORIGIN, members: nodes.map((n) => n.id) },
    nodes: map,
  };
}

function evalNodes(nodes: CalcNode[]) {
  const built = chainOf(nodes);
  return evaluate(parse(tokenize(built.chain, built.nodes)));
}

describe('evaluate', () => {
  test('0.1 + 0.2 is exactly 0.3 (§10.3, decision #3)', () => {
    const result = evalNodes([number('n1', '0.1'), op('o1', '+'), number('n2', '0.2')]);
    expect(isEngineError(result)).toBe(false);
    if (isEngineError(result)) {
      return;
    }
    expect(result.equals(new Decimal('0.3'))).toBe(true);
  });

  test('2 + 3 × 4 = 14', () => {
    const result = evalNodes([
      number('n1', '2'),
      op('o1', '+'),
      number('n2', '3'),
      op('o2', '×'),
      number('n3', '4'),
    ]);
    expect(isEngineError(result)).toBe(false);
    if (isEngineError(result)) {
      return;
    }
    expect(result.equals(14)).toBe(true);
  });

  test('2 × (3 + 4) = 14', () => {
    const result = evalNodes([
      number('n1', '2'),
      op('o1', '×'),
      paren('p1', 'open'),
      number('n2', '3'),
      op('o2', '+'),
      number('n3', '4'),
      paren('p2', 'close'),
    ]);
    expect(isEngineError(result)).toBe(false);
    if (isEngineError(result)) {
      return;
    }
    expect(result.equals(14)).toBe(true);
  });

  test('1221 + 3 - 20 = 1204', () => {
    const result = evalNodes([
      number('n1', '1221'),
      op('o1', '+'),
      number('n2', '3'),
      op('o2', '-'),
      number('n3', '20'),
    ]);
    expect(isEngineError(result)).toBe(false);
    if (isEngineError(result)) {
      return;
    }
    expect(result.equals(1204)).toBe(true);
  });

  test('division by zero returns DivideByZero, never Infinity', () => {
    const result = evalNodes([number('n1', '1'), op('o1', '÷'), number('n2', '0')]);
    expect(result).toEqual({ kind: 'DivideByZero' });
  });

  test('0 ÷ 0 is DivideByZero (zero divisor wins over indeterminate)', () => {
    const result = evalNodes([number('n1', '0'), op('o1', '÷'), number('n2', '0')]);
    expect(result).toEqual({ kind: 'DivideByZero' });
  });

  test('overflow returns Overflow value, never Infinity', () => {
    // Reference resolver can surface a non-finite Decimal; evaluate must map it.
    const result = evaluate(
      {
        kind: 'binary',
        op: '×',
        left: { kind: 'reference', targetNodeId: 'inf', nodeId: 'r1' },
        right: { kind: 'number', raw: '2', nodeId: 'n2' },
      },
      (id) => (id === 'inf' ? new Decimal(Infinity) : { kind: 'NotANumber' }),
    );
    expect(result).toEqual({ kind: 'Overflow' });
  });

  test('non-numeric raw returns NotANumber without throwing', () => {
    const result = evaluate({ kind: 'number', raw: 'not-a-number', nodeId: 'n1' });
    expect(result).toEqual({ kind: 'NotANumber' });
  });

  test('nothing throws across the module boundary', () => {
    expect(() => evaluate({ kind: 'number', raw: '', nodeId: 'n1' })).not.toThrow();
    expect(() =>
      evaluate({
        kind: 'binary',
        op: '÷',
        left: { kind: 'number', raw: '1', nodeId: 'a' },
        right: { kind: 'number', raw: '0', nodeId: 'b' },
      }),
    ).not.toThrow();
  });

  test('unresolved reference returns NotANumber', () => {
    const result = evaluate({
      kind: 'reference',
      targetNodeId: 'missing',
      nodeId: 'r1',
    });
    expect(result).toEqual({ kind: 'NotANumber' });
  });

  test('resolved reference multiplies', () => {
    const result = evaluate(
      {
        kind: 'binary',
        op: '×',
        left: { kind: 'reference', targetNodeId: 't', nodeId: 'r1' },
        right: { kind: 'number', raw: '2', nodeId: 'n1' },
      },
      (id) => (id === 't' ? new Decimal(21) : { kind: 'NotANumber' }),
    );
    expect(isEngineError(result)).toBe(false);
    if (isEngineError(result)) {
      return;
    }
    expect(result.equals(42)).toBe(true);
  });
});
