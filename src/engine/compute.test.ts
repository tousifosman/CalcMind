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
  ReferenceNode,
  ResultNode,
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

describe('computeChain: reference resolution (P4.9)', () => {
  test('continuation chain evaluates against the live source inputs, not a frozen derived', () => {
    const sourceMembers = [
      number('n1', '10'),
      op('o1', '+'),
      number('n2', '5'),
      equals('e1'),
    ];
    const source = chainOf(sourceMembers);
    source.chain.id = 'c_source';
    for (const n of Object.values(source.nodes)) n.chainId = 'c_source';

    const resultNode: ResultNode = {
      id: 'r1',
      kind: 'result',
      position: ORIGIN,
      chainId: 'c_source',
      createdAt: 0,
      sourceChainId: 'c_source',
      derived: { display: 'POISON', computedAt: '1999-01-01T00:00:00.000Z' },
    };
    source.nodes.r1 = resultNode;
    source.chain.members.push('r1');

    const ref: ReferenceNode = {
      id: 'ref1',
      kind: 'reference',
      position: ORIGIN,
      chainId: 'c_cont',
      createdAt: 0,
      targetNodeId: 'r1',
    };
    const contOp = op('o2', '×');
    contOp.chainId = 'c_cont';
    contOp.id = 'o2';
    const contNum = number('n3', '2');
    contNum.chainId = 'c_cont';
    const contEq = equals('e2');
    contEq.chainId = 'c_cont';

    const nodes: Record<string, CalcNode> = {
      ...source.nodes,
      ref1: ref,
      o2: contOp,
      n3: contNum,
      e2: contEq,
    };
    const chains = {
      c_source: source.chain,
      c_cont: { id: 'c_cont', anchor: ORIGIN, members: ['ref1', 'o2', 'n3', 'e2'] },
    };

    const result = computeChain(chains.c_cont, nodes, 'en-US', chains);
    expect(result).toEqual({
      ok: true,
      value: expect.any(Decimal),
      display: '30',
    });

    // Mutate source input; recompute must see 20+5=25, times 2 = 50 — not POISON, not 15.
    const n1 = nodes.n1;
    if (!n1 || n1.kind !== 'number') throw new Error('expected n1');
    n1.raw = '20';
    const again = computeChain(chains.c_cont, nodes, 'en-US', chains);
    expect(again && again.ok && again.display).toBe('50');
  });
});
