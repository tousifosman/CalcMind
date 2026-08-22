// §8.6 `Copy` / `Copy As` text building.
import { chainTextWithoutResult, copyTextForNode } from './copyText';
import type {
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  ParenNode,
  ReferenceNode,
  ResultNode,
} from '../model/types';

const ORIGIN = { x: 0, y: 0 };
const LOCALE = 'en-US';

function number(id: string, raw: string, chainId: string | null = null): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId, createdAt: 0 };
}

function operator(id: string, op: OperatorNode['op'], chainId: string | null = null): OperatorNode {
  return { id, kind: 'operator', op, position: ORIGIN, chainId, createdAt: 0 };
}

function paren(id: string, side: ParenNode['side'], chainId: string | null = null): ParenNode {
  return { id, kind: 'paren', side, position: ORIGIN, chainId, createdAt: 0 };
}

function equalsNode(id: string, chainId: string | null = null): EqualsNode {
  return { id, kind: 'equals', position: ORIGIN, chainId, createdAt: 0 };
}

function result(id: string, display: string, chainId = 'c1'): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId,
    createdAt: 0,
    sourceChainId: chainId,
    derived: { display, computedAt: '2026-08-21T00:00:00.000Z' },
  };
}

function staleResult(id: string, display: string, chainId = 'c1'): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId,
    createdAt: 0,
    sourceChainId: chainId,
    derived: { display, computedAt: '2026-08-21T00:00:00.000Z', outcome: { status: 'stale' } },
  };
}

function erroredResult(id: string, chainId = 'c1'): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId,
    createdAt: 0,
    sourceChainId: chainId,
    derived: {
      display: '',
      computedAt: '2026-08-21T00:00:00.000Z',
      outcome: { status: 'error', error: 'DivideByZero' },
    },
  };
}

function reference(id: string, targetNodeId: string, chainId: string | null = null): ReferenceNode {
  return { id, kind: 'reference', position: ORIGIN, chainId, createdAt: 0, targetNodeId };
}

function danglingReference(id: string, lastKnownDisplay: string): ReferenceNode {
  return {
    id,
    kind: 'reference',
    position: ORIGIN,
    chainId: null,
    createdAt: 0,
    targetNodeId: 'gone',
    lastKnownDisplay,
  };
}

function byId(...nodes: CalcNode[]): Record<string, CalcNode> {
  const map: Record<string, CalcNode> = {};
  for (const node of nodes) map[node.id] = node;
  return map;
}

describe('copyTextForNode (§8.6 Copy)', () => {
  test('a number copies its locale-formatted raw', () => {
    const n = number('n1', '1234.5');
    expect(copyTextForNode('n1', byId(n), LOCALE)).toBe('1,234.5');
  });

  test('a completed result copies its display', () => {
    const r = result('r1', '17');
    expect(copyTextForNode('r1', byId(r), LOCALE)).toBe('17');
  });

  test('a stale result still copies its last-good display', () => {
    const r = staleResult('r1', '17');
    expect(copyTextForNode('r1', byId(r), LOCALE)).toBe('17');
  });

  test('an empty or errored result copies nothing', () => {
    const empty: ResultNode = {
      id: 'r_empty',
      kind: 'result',
      position: ORIGIN,
      chainId: 'c1',
      createdAt: 0,
      sourceChainId: 'c1',
    };
    expect(copyTextForNode('r_empty', byId(empty), LOCALE)).toBeNull();
    const err = erroredResult('r_err');
    expect(copyTextForNode('r_err', byId(err), LOCALE)).toBeNull();
  });

  test('a live reference copies the target value', () => {
    const target = number('n1', '7');
    const ref = reference('ref1', 'n1');
    expect(copyTextForNode('ref1', byId(target, ref), LOCALE)).toBe('7');
  });

  test('a dangling reference copies its last known value', () => {
    const ref = danglingReference('ref1', '42');
    expect(copyTextForNode('ref1', byId(ref), LOCALE)).toBe('42');
  });

  test('operator, paren, and equals have no value of their own', () => {
    const op = operator('op1', '+');
    const p = paren('p1', 'open');
    const eq = equalsNode('eq1');
    const nodes = byId(op, p, eq);
    expect(copyTextForNode('op1', nodes, LOCALE)).toBeNull();
    expect(copyTextForNode('p1', nodes, LOCALE)).toBeNull();
    expect(copyTextForNode('eq1', nodes, LOCALE)).toBeNull();
  });

  test('a missing node id copies nothing', () => {
    expect(copyTextForNode('ghost', {}, LOCALE)).toBeNull();
  });
});

describe('chainTextWithoutResult (§8.6 Copy As → Copy without result)', () => {
  test('a completed chain drops = and the result, keeping the formula', () => {
    const a = number('n1', '12', 'c1');
    const op = operator('op1', '+', 'c1');
    const b = number('n2', '5', 'c1');
    const eq = equalsNode('eq1', 'c1');
    const r = result('r1', '17', 'c1');
    const chain: Chain = { id: 'c1', members: ['n1', 'op1', 'n2', 'eq1', 'r1'], anchor: ORIGIN };
    expect(chainTextWithoutResult(chain, byId(a, op, b, eq, r), LOCALE)).toBe('12 + 5');
  });

  test('an Incomplete chain (no = yet) copies exactly what it has', () => {
    const a = number('n1', '12', 'c1');
    const op = operator('op1', '+', 'c1');
    const chain: Chain = { id: 'c1', members: ['n1', 'op1'], anchor: ORIGIN };
    expect(chainTextWithoutResult(chain, byId(a, op), LOCALE)).toBe('12 +');
  });

  test('parens and references render inline with the rest of the formula', () => {
    const open = paren('p1', 'open', 'c1');
    const target = number('src', '3');
    const ref = reference('ref1', 'src', 'c1');
    const op = operator('op1', '+', 'c1');
    const b = number('n2', '4', 'c1');
    const close = paren('p2', 'close', 'c1');
    const chain: Chain = { id: 'c1', members: ['p1', 'ref1', 'op1', 'n2', 'p2'], anchor: ORIGIN };
    expect(chainTextWithoutResult(chain, byId(open, target, ref, op, b, close), LOCALE)).toBe(
      '( 3 + 4 )',
    );
  });

  test('a missing member id is skipped rather than throwing', () => {
    const a = number('n1', '1', 'c1');
    const chain: Chain = { id: 'c1', members: ['n1', 'ghost'], anchor: ORIGIN };
    expect(chainTextWithoutResult(chain, byId(a), LOCALE)).toBe('1');
  });
});
