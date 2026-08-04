// Dirty-set recompute (P4.8) and chain-level dependency DAG (P6.1, §11 / §11.4).
import { computeChain } from './compute';
import {
  buildDependencyGraph,
  chainCycleLabel,
  dependencyEdgeKey,
  dirtyClosure,
  findCycles,
  markChainsStale,
  markChainCircular,
  recomputeChain,
  recomputeFromSeeds,
  removeResultNodesForChain,
  topologicalOrder,
} from './graph';
import type {
  CalcDocument,
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ReferenceNode,
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

function reference(id: string, targetNodeId: string, chainId: string): ReferenceNode {
  return {
    id,
    kind: 'reference',
    position: ORIGIN,
    chainId,
    createdAt: 0,
    targetNodeId,
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

describe('buildDependencyGraph', () => {
  test('vertices are every chain; edge A→B when B references a node in A', () => {
    // §11 worked example shape: c1 = 1221+3, c2 = ref(r1)×2
    const doc = docWithChains({
      c1: {
        members: [
          number('n1', '1221', 'c1'),
          op('p1', '+', 'c1'),
          number('n2', '3', 'c1'),
          equals('e1', 'c1'),
          result('r1', 'c1', '1224'),
        ],
      },
      c2: {
        members: [
          reference('ref1', 'r1', 'c2'),
          op('p2', '×', 'c2'),
          number('n3', '2', 'c2'),
          equals('e2', 'c2'),
          result('r2', 'c2', '2448'),
        ],
      },
      c3: {
        members: [number('lone', '9', 'c3')],
      },
    });

    const graph = buildDependencyGraph(doc);
    expect(graph.vertices).toEqual(['c1', 'c2', 'c3']);
    expect(graph.edges.size).toBe(1);
    expect(graph.edges.get(dependencyEdgeKey('r1', 'ref1'))).toEqual({
      sourceNodeId: 'r1',
      referenceNodeId: 'ref1',
      sourceChainId: 'c1',
      dependentChainId: 'c2',
    });
    expect(graph.dependents.get('c1')).toEqual(['c2']);
    expect(graph.dependents.has('c2')).toBe(false);
    expect(graph.dependents.has('c3')).toBe(false);
  });

  test('edges keyed by (sourceNodeId, referenceNodeId) — never by source alone', () => {
    // One source feeding two consumers (§11.1, 2026-08-03 revision 7).
    const doc = docWithChains({
      src: {
        members: [
          number('a', '10', 'src'),
          equals('e', 'src'),
          result('r', 'src', '10'),
        ],
      },
      left: {
        members: [reference('refL', 'r', 'left'), op('pL', '+', 'left'), number('b', '1', 'left')],
      },
      right: {
        members: [reference('refR', 'r', 'right'), op('pR', '+', 'right'), number('c', '2', 'right')],
      },
    });

    const graph = buildDependencyGraph(doc);
    expect(graph.edges.size).toBe(2);
    expect(graph.edges.get(dependencyEdgeKey('r', 'refL'))).toMatchObject({
      sourceNodeId: 'r',
      referenceNodeId: 'refL',
      dependentChainId: 'left',
    });
    expect(graph.edges.get(dependencyEdgeKey('r', 'refR'))).toMatchObject({
      sourceNodeId: 'r',
      referenceNodeId: 'refR',
      dependentChainId: 'right',
    });
    // A source-only key would have collapsed these; both consumers must remain.
    expect(graph.dependents.get('src')).toEqual(['left', 'right']);
  });

  test('dangling / free / chainless targets contribute no edge', () => {
    const doc = docWithChains({
      c1: {
        members: [
          reference('missing', 'ghost', 'c1'),
          reference('freeTarget', 'orphan', 'c1'),
        ],
      },
    });
    // Orphan number exists but is not in any chain.
    doc.nodes.orphan = {
      id: 'orphan',
      kind: 'number',
      raw: '1',
      position: ORIGIN,
      chainId: null,
      createdAt: 0,
    };
    // Free reference (not a chain member) — also no edge.
    doc.nodes.freeRef = {
      id: 'freeRef',
      kind: 'reference',
      position: ORIGIN,
      chainId: null,
      createdAt: 0,
      targetNodeId: 'orphan',
    };

    const graph = buildDependencyGraph(doc);
    expect(graph.edges.size).toBe(0);
    expect(graph.dependents.size).toBe(0);
  });

  test('number targets use chainId; same source chain collapses dependents', () => {
    const doc = docWithChains({
      a: { members: [number('n', '5', 'a')] },
      b: {
        members: [
          reference('r1', 'n', 'b'),
          op('p', '+', 'b'),
          reference('r2', 'n', 'b'),
        ],
      },
    });
    const graph = buildDependencyGraph(doc);
    expect(graph.edges.size).toBe(2);
    expect(graph.dependents.get('a')).toEqual(['b']);
  });

  test('DAG documents report no cycles', () => {
    const doc = docWithChains({
      a: {
        members: [number('na', '1', 'a'), equals('ea', 'a'), result('ra', 'a', '1')],
      },
      b: {
        members: [reference('rb', 'ra', 'b'), equals('eb', 'b'), result('rb_out', 'b', '1')],
      },
    });
    expect(buildDependencyGraph(doc).cycles).toEqual([]);
  });
});

describe('findCycles / DFS colouring (P6.3)', () => {
  test('two-chain cycle lists both members and a closing edge', () => {
    // A = ref(B's result); B = ref(A's result)
    const doc = docWithChains({
      a: {
        members: [
          reference('refA', 'rb', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '1'),
        ],
      },
      b: {
        members: [
          reference('refB', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb', 'b', '1'),
        ],
      },
    });
    const graph = buildDependencyGraph(doc);
    expect(graph.cycles).toHaveLength(1);
    const cycle = graph.cycles[0]!;
    expect(new Set(cycle.chainIds)).toEqual(new Set(['a', 'b']));
    expect(cycle.chainIds).toHaveLength(2);
    expect(['refA', 'refB']).toContain(cycle.closingEdge.referenceNodeId);
    // findCycles over the same adjacency agrees with build-time colouring.
    expect(findCycles(graph)).toHaveLength(1);
  });

  test('self-edge is a one-chain cycle', () => {
    const doc = docWithChains({
      a: {
        members: [
          reference('self', 'ra', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '1'),
        ],
      },
    });
    const graph = buildDependencyGraph(doc);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0]!.chainIds).toEqual(['a']);
    expect(graph.cycles[0]!.closingEdge.referenceNodeId).toBe('self');
  });

  test('three-chain cycle; independent chain stays outside', () => {
    // a → b → c → a, plus lone
    const doc = docWithChains({
      a: {
        members: [
          reference('ra_ref', 'rc', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '1'),
        ],
      },
      b: {
        members: [
          reference('rb_ref', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb', 'b', '1'),
        ],
      },
      c: {
        members: [
          reference('rc_ref', 'rb', 'c'),
          equals('ec', 'c'),
          result('rc', 'c', '1'),
        ],
      },
      lone: {
        members: [
          number('n', '9', 'lone'),
          equals('el', 'lone'),
          result('rl', 'lone', '9'),
        ],
      },
    });
    const graph = buildDependencyGraph(doc);
    expect(graph.cycles).toHaveLength(1);
    expect(new Set(graph.cycles[0]!.chainIds)).toEqual(new Set(['a', 'b', 'c']));
    expect(graph.cycles[0]!.chainIds.includes('lone')).toBe(false);
  });
});

describe('recomputeFromSeeds cycle colouring (P6.3)', () => {
  test('every chain in a deliberate cycle enters CircularReference; others keep working', () => {
    const doc = docWithChains({
      a: {
        members: [
          reference('refA', 'rb', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '1'),
        ],
      },
      b: {
        members: [
          reference('refB', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb', 'b', '1'),
        ],
      },
      ok: {
        members: [
          number('n1', '2', 'ok'),
          op('p', '+', 'ok'),
          number('n2', '3', 'ok'),
          equals('eo', 'ok'),
          result('ro', 'ok', '5'),
        ],
      },
    });

    // Seed only one cycle member — both must be painted, and `ok` must not be touched.
    recomputeFromSeeds(doc, ['a'], 'en-US');

    const ra = doc.nodes.ra as ResultNode;
    const rb = doc.nodes.rb as ResultNode;
    expect(ra.derived?.outcome).toMatchObject({
      status: 'error',
      error: 'CircularReference',
    });
    expect(rb.derived?.outcome).toMatchObject({
      status: 'error',
      error: 'CircularReference',
    });
    const raOutcome = ra.derived?.outcome;
    const rbOutcome = rb.derived?.outcome;
    expect(raOutcome?.status === 'error' && raOutcome.cycle).toBeTruthy();
    expect(rbOutcome?.status === 'error' && rbOutcome.cycle).toBeTruthy();
    // Sibling cells must agree on the named cycle — labels are snapshotted
    // before any member is blanked (review: order-dependent chain-id leak).
    if (raOutcome?.status === 'error' && rbOutcome?.status === 'error') {
      expect(raOutcome.cycle?.chainLabels).toEqual(rbOutcome.cycle?.chainLabels);
      expect(raOutcome.cycle?.chainLabels.every((l) => l !== 'a' && l !== 'b')).toBe(
        true,
      );
    }

    // Independent chain: never re-evaluated, prior display intact.
    const evaluated = computeChainMock.mock.calls.map(([chain]) => chain.id);
    expect(evaluated).not.toContain('ok');
    expect(evaluated).not.toContain('a');
    expect(evaluated).not.toContain('b');
    expect(doc.nodes.ro).toMatchObject({
      derived: { display: '5', computedAt: '2026-08-04T00:00:00.000Z' },
    });
  });

  test('unlinking the closing edge clears CircularReference on former cycle members', () => {
    const doc = docWithChains({
      a: {
        members: [
          number('na', '10', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '10'),
        ],
      },
      b: {
        members: [
          reference('refB', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb', 'b', '10'),
        ],
      },
    });
    // Close the cycle: a references b's result.
    doc.nodes.refA = reference('refA', 'rb', 'a');
    doc.chains.a.members = ['refA', 'ea', 'ra'];

    recomputeFromSeeds(doc, ['a'], 'en-US');
    expect((doc.nodes.ra as ResultNode).derived?.outcome).toMatchObject({
      error: 'CircularReference',
    });
    expect((doc.nodes.rb as ResultNode).derived?.outcome).toMatchObject({
      error: 'CircularReference',
    });

    const raCycleOutcome = (doc.nodes.ra as ResultNode).derived?.outcome;
    const closing =
      raCycleOutcome?.status === 'error' && raCycleOutcome.cycle
        ? raCycleOutcome.cycle.closingReferenceNodeId
        : 'refA';

    // Unlink: drop the closing reference and recompute from its former chain.
    const closingNode = doc.nodes[closing]!;
    const closingChainId = closingNode.chainId!;
    delete doc.nodes[closing];
    doc.chains[closingChainId]!.members = doc.chains[closingChainId]!.members.filter(
      (id) => id !== closing,
    );

    recomputeFromSeeds(doc, [closingChainId], 'en-US');

    // Cycle gone — at least one former member evaluates again (the still-Evaluated side).
    const stillCyclic = buildDependencyGraph(doc).cycles.length > 0;
    expect(stillCyclic).toBe(false);
    const raOut = (doc.nodes.ra as ResultNode | undefined)?.derived?.outcome;
    const rbOut = (doc.nodes.rb as ResultNode | undefined)?.derived?.outcome;
    expect(raOut?.status === 'error' && raOut.error === 'CircularReference').toBe(false);
    expect(rbOut?.status === 'error' && rbOut.error === 'CircularReference').toBe(false);
  });

  test('chainCycleLabel prefers member label, then result display, then number raw', () => {
    const labelled = docWithChains({
      c: {
        members: [
          { ...number('n', '3', 'c'), label: 'Deposit' },
          equals('e', 'c'),
          result('r', 'c', '3'),
        ],
      },
    });
    expect(chainCycleLabel(labelled, 'c')).toBe('Deposit');

    const fromResult = docWithChains({
      c: {
        members: [equals('e', 'c'), result('r', 'c', '42')],
      },
    });
    expect(chainCycleLabel(fromResult, 'c')).toBe('42');

    const fromRaw = docWithChains({
      c: { members: [number('n', '7', 'c')] },
    });
    expect(chainCycleLabel(fromRaw, 'c')).toBe('7');
  });

  test('markChainCircular writes named cycle metadata onto the result', () => {
    const doc = docWithChains({
      a: {
        members: [
          { ...reference('refA', 'rb', 'a'), label: 'Alpha' },
          equals('ea', 'a'),
          result('ra', 'a', '1'),
        ],
      },
      b: {
        members: [
          { ...reference('refB', 'ra', 'b'), label: 'Beta' },
          equals('eb', 'b'),
          result('rb', 'b', '1'),
        ],
      },
    });
    const cycle = buildDependencyGraph(doc).cycles[0]!;
    const labels = cycle.chainIds.map((id) => chainCycleLabel(doc, id));
    markChainCircular(doc, 'a', cycle, labels);
    const outcome = (doc.nodes.ra as ResultNode).derived?.outcome;
    expect(outcome).toMatchObject({
      status: 'error',
      error: 'CircularReference',
    });
    if (outcome?.status === 'error') {
      expect(outcome.cycle?.chainLabels).toEqual(
        expect.arrayContaining(['Alpha', 'Beta']),
      );
      expect(outcome.cycle?.closingReferenceNodeId).toBe(cycle.closingEdge.referenceNodeId);
    }
  });

  test('sibling cycle members share identical chainLabels after recompute', () => {
    // Pure ref=result chains — the regression case where blanking the first
    // member's display would make the second fall through to a raw chain id.
    const doc = docWithChains({
      a: {
        members: [
          reference('refA', 'rb', 'a'),
          equals('ea', 'a'),
          result('ra', 'a', '7'),
        ],
      },
      b: {
        members: [
          reference('refB', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb', 'b', '7'),
        ],
      },
    });
    recomputeFromSeeds(doc, ['b'], 'en-US');
    const raOut = (doc.nodes.ra as ResultNode).derived?.outcome;
    const rbOut = (doc.nodes.rb as ResultNode).derived?.outcome;
    expect(raOut?.status).toBe('error');
    expect(rbOut?.status).toBe('error');
    if (raOut?.status !== 'error' || rbOut?.status !== 'error') return;
    expect(raOut.cycle?.chainLabels).toEqual(rbOut.cycle?.chainLabels);
    expect(raOut.cycle?.chainLabels).toEqual(['7', '7']);
  });
});

describe('topologicalOrder', () => {
  test('sources precede dependents — linear chain A→B→C', () => {
    const doc = docWithChains({
      a: {
        members: [number('na', '1', 'a'), equals('ea', 'a'), result('ra', 'a', '1')],
      },
      b: {
        members: [
          reference('rb', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb_out', 'b', '1'),
        ],
      },
      c: {
        members: [reference('rc', 'rb_out', 'c'), equals('ec', 'c')],
      },
    });
    expect(topologicalOrder(buildDependencyGraph(doc))).toEqual(['a', 'b', 'c']);
  });

  test('diamond: shared source before both branches, sink last', () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const doc = docWithChains({
      a: {
        members: [number('na', '1', 'a'), equals('ea', 'a'), result('ra', 'a', '1')],
      },
      b: {
        members: [
          reference('rb', 'ra', 'b'),
          equals('eb', 'b'),
          result('rb_out', 'b', '1'),
        ],
      },
      c: {
        members: [
          reference('rc', 'ra', 'c'),
          equals('ec', 'c'),
          result('rc_out', 'c', '1'),
        ],
      },
      d: {
        members: [
          reference('rd1', 'rb_out', 'd'),
          op('pd', '+', 'd'),
          reference('rd2', 'rc_out', 'd'),
        ],
      },
    });
    const order = topologicalOrder(buildDependencyGraph(doc));
    expect(order).toHaveLength(4);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  test('independent chains keep vertices order; empty refs → identity order', () => {
    const doc = docWithChains({
      z: { members: [number('nz', '1', 'z')] },
      a: { members: [number('na', '2', 'a')] },
    });
    expect(topologicalOrder(buildDependencyGraph(doc))).toEqual(['z', 'a']);
  });

  test('§11 edit cascade order: c1 before c2 when c2 refs c1', () => {
    const doc = docWithChains({
      c2: {
        members: [reference('ref', 'r1', 'c2'), op('p', '×', 'c2'), number('n', '2', 'c2')],
      },
      c1: {
        members: [
          number('n1', '1221', 'c1'),
          op('p1', '+', 'c1'),
          number('n2', '3', 'c1'),
          equals('e1', 'c1'),
          result('r1', 'c1', '1224'),
        ],
      },
    });
    // vertices insertion order is c2, c1 — topo must still put producer first.
    expect(buildDependencyGraph(doc).vertices).toEqual(['c2', 'c1']);
    expect(topologicalOrder(buildDependencyGraph(doc))).toEqual(['c1', 'c2']);
  });
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
