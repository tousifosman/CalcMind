// computeChain: §10.1 pipeline for result lifecycle (P4.7).
import Decimal from 'decimal.js';
import { computeChain } from './compute';
import type {
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
} from '../model/types';

const ORIGIN = { x: 0, y: 0 };

function number(id: string, raw: string): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function op(id: string, symbol: OperatorSymbol): OperatorNode {
  return { id, kind: 'operator', op: symbol, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function equals(id: string): EqualsNode {
  return { id, kind: 'equals', position: ORIGIN, chainId: 'c1', createdAt: 0 };
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

describe('computeChain', () => {
  test('returns null when the chain is Valid but has no equals', () => {
    const built = chainOf([number('n1', '3'), op('o1', '+'), number('n2', '4')]);
    expect(computeChain(built.chain, built.nodes, 'en-US')).toBeNull();
  });

  test('returns null when equals is present but the expression is Incomplete', () => {
    const built = chainOf([number('n1', '3'), op('o1', '+'), equals('e1')]);
    expect(computeChain(built.chain, built.nodes, 'en-US')).toBeNull();
  });

  test('Evaluated chain yields locale-formatted display from the engine', () => {
    const built = chainOf([
      number('n1', '1221'),
      op('o1', '+'),
      number('n2', '3'),
      op('o2', '-'),
      number('n3', '20'),
      equals('e1'),
    ]);
    const result = computeChain(built.chain, built.nodes, 'en-US');
    expect(result).toEqual({
      ok: true,
      value: expect.any(Decimal),
      display: '1,204',
    });
    if (result && result.ok) {
      expect(result.value.equals(1204)).toBe(true);
    }
  });

  test('0.1 + 0.2 = formats as 0.3', () => {
    const built = chainOf([
      number('n1', '0.1'),
      op('o1', '+'),
      number('n2', '0.2'),
      equals('e1'),
    ]);
    const result = computeChain(built.chain, built.nodes, 'en-US');
    expect(result && result.ok && result.display).toBe('0.3');
  });

  test('DivideByZero is an error result, not null', () => {
    const built = chainOf([
      number('n1', '1'),
      op('o1', '÷'),
      number('n2', '0'),
      equals('e1'),
    ]);
    const result = computeChain(built.chain, built.nodes, 'en-US');
    expect(result).toEqual({ ok: false, error: { kind: 'DivideByZero' } });
  });
});
