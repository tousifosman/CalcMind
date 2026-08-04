// Dirty-set recompute (P4.8, §11 / §11.4).
import { computeChain } from './compute';
import { dirtyClosure, markChainsStale, recomputeChain, recomputeFromSeeds, removeResultNodesForChain } from './graph';
import type {
  CalcDocument,
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ResultNode,
} from '../model/types';

jest.mock('./compute', () => {
  const actual = jest.requireActual('./compute') as typeof import('./compute');
  return {
    ...actual,
    computeChain: jest.fn(actual.computeChain),
  };
});

const computeChainMock = computeChain as jest.MockedFunction<typeof computeChain>;

const ORIGIN = { x: 0, y: 0 };

function number(id: string, raw: string, chainId: string): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId, createdAt: 0 };
}

function op(id: string, symbol: OperatorSymbol, chainId: string): OperatorNode {
  return { id, kind: 'operator', op: symbol, position: ORIGIN, chainId, createdAt: 0 };
}

function equals(id: string, chainId: string): EqualsNode {
  return { id, kind: 'equals', position: ORIGIN, chainId, createdAt: 0 };
}

function result(id: string, chainId: string, display: string): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId,
    createdAt: 0,
    sourceChainId: chainId,
    derived: { display, computedAt: '2026-08-04T00:00:00.000Z' },
  };
}

function docWithChains(
  chains: Record<string, { members: CalcNode[] }>,
): CalcDocument {
  const nodes: Record<string, CalcNode> = {};
  const chainMap: Record<string, Chain> = {};
  for (const [chainId, { members }] of Object.entries(chains)) {
    chainMap[chainId] = {
      id: chainId,
      anchor: ORIGIN,
      members: members.map((m) => m.id),
    };
    for (const m of members) {
      nodes[m.id] = m;
    }
  }
  return {
    schemaVersion: 1,
    id: 'doc',
    name: 't',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    viewport: { pan: ORIGIN, zoom: 1 },
    nodes,
    chains: chainMap,
  };
}

beforeEach(() => {
  computeChainMock.mockClear();
  computeChainMock.mockImplementation(
    jest.requireActual('./compute').computeChain as typeof computeChain,
  );
});

describe('dirtyClosure', () => {
  test('P4.8: returns the seed itself, deduped, skipping missing chains', () => {
    const doc = docWithChains({
      c1: { members: [number('a', '1', 'c1'), op('p', '+', 'c1'), number('b', '2', 'c1')] },
      c2: { members: [number('c', '9', 'c2'), equals('e', 'c2')] },
    });
    expect(dirtyClosure(doc, ['c1', 'c1', 'ghost', 'c2'])).toEqual(['c1', 'c2']);
  });

  test('empty seed yields empty dirty set — never a full document sweep', () => {
    const doc = docWithChains({
      c1: { members: [number('a', '1', 'c1'), equals('e', 'c1')] },
    });
    expect(dirtyClosure(doc, [])).toEqual([]);
  });
});

describe('markChainsStale', () => {
  test('sets outcome stale on existing derived without clearing display', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '3', 'c1'),
          equals('e', 'c1'),
          result('r', 'c1', '5'),
        ],
      },
    });
    markChainsStale(doc, ['c1']);
    const r = doc.nodes.r as ResultNode;
    expect(r.derived).toEqual({
      display: '5',
      computedAt: '2026-08-04T00:00:00.000Z',
      outcome: { status: 'stale' },
    });
  });
});

describe('removeResultNodesForChain', () => {
  test('deletes results by sourceChainId and drops them from members', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '3', 'c1'),
          equals('e', 'c1'),
          result('r', 'c1', '5'),
        ],
      },
    });
    removeResultNodesForChain(doc, 'c1');
    expect(doc.nodes.r).toBeUndefined();
    expect(doc.chains.c1.members).toEqual(['a', 'p', 'b', 'e']);
  });
});

describe('recomputeChain', () => {
  test('creates a result when the chain is Evaluated and none exists', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '3', 'c1'),
          equals('e', 'c1'),
        ],
      },
    });
    recomputeChain(doc, 'c1', 'en-US');
    const results = Object.values(doc.nodes).filter((n) => n.kind === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'result',
      sourceChainId: 'c1',
      derived: { display: '5' },
    });
    expect(doc.chains.c1.members).toContain(results[0].id);
  });

  test('updates an existing result in place when an input changes', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '3', 'c1'),
          equals('e', 'c1'),
          result('r', 'c1', '5'),
        ],
      },
    });
    (doc.nodes.a as NumberNode).raw = '10';
    recomputeChain(doc, 'c1', 'en-US');
    expect(doc.nodes.r).toMatchObject({
      id: 'r',
      derived: { display: '13' },
    });
    expect((doc.nodes.r as ResultNode).derived?.outcome).toBeUndefined();
  });

  test('removes the result when the chain is no longer Evaluated', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '', 'c1'),
          equals('e', 'c1'),
          result('r', 'c1', '5'),
        ],
      },
    });
    recomputeChain(doc, 'c1', 'en-US');
    expect(doc.nodes.r).toBeUndefined();
    expect(doc.chains.c1.members).toEqual(['a', 'p', 'b', 'e']);
  });
});

describe('recomputeFromSeeds', () => {
  test('recomputes only the dirty closure — untouched chains are never evaluated', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a1', '1', 'c1'),
          op('p1', '+', 'c1'),
          number('b1', '2', 'c1'),
          equals('e1', 'c1'),
          result('r1', 'c1', '3'),
        ],
      },
      c2: {
        members: [
          number('a2', '10', 'c2'),
          op('p2', '+', 'c2'),
          number('b2', '20', 'c2'),
          equals('e2', 'c2'),
          result('r2', 'c2', '30'),
        ],
      },
    });

    (doc.nodes.a1 as NumberNode).raw = '7';
    recomputeFromSeeds(doc, ['c1'], 'en-US');

    const evaluatedChainIds = computeChainMock.mock.calls.map(([chain]) => chain.id);
    expect(evaluatedChainIds).toEqual(['c1']);
    expect(doc.nodes.r1).toMatchObject({ derived: { display: '9' } });
    // Untouched chain keeps its prior derived cache — prove we did not rewrite it.
    expect(doc.nodes.r2).toMatchObject({
      derived: { display: '30', computedAt: '2026-08-04T00:00:00.000Z' },
    });
  });

  test('same-turn mark+evaluate leaves no stale outcome on a successful recompute', () => {
    const doc = docWithChains({
      c1: {
        members: [
          number('a', '2', 'c1'),
          op('p', '+', 'c1'),
          number('b', '3', 'c1'),
          equals('e', 'c1'),
          result('r', 'c1', '5'),
        ],
      },
    });
    (doc.nodes.b as NumberNode).raw = '8';
    recomputeFromSeeds(doc, ['c1'], 'en-US');
    expect(doc.nodes.r).toMatchObject({ derived: { display: '10' } });
    expect((doc.nodes.r as ResultNode).derived?.outcome).toBeUndefined();
  });
});
