// Identity hue assignment (§11.1, decision #12, P6.5).
import {
  assignIdentityHues,
  identityBearingNodeIds,
  identitySourceId,
  labelForNode,
  nodeHasLabel,
  referencedNodeIds,
} from './identity';
import { deserializeDocument, serializeDocument } from '../persistence/serialize';
import type {
  CalcDocument,
  CalcNode,
  NumberNode,
  ReferenceNode,
  ResultNode,
} from '../model/types';

const ORIGIN = { x: 0, y: 0 };
const PALETTE = ['#AAA111', '#BBB222', '#CCC333'] as const;

function number(id: string, raw: string, label?: string): NumberNode {
  return {
    id,
    kind: 'number',
    raw,
    position: ORIGIN,
    chainId: null,
    createdAt: 0,
    ...(label !== undefined ? { label } : {}),
  };
}

function result(id: string, display: string, label?: string): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId: 'c1',
    createdAt: 0,
    sourceChainId: 'c1',
    derived: { display, computedAt: '2026-08-04T00:00:00.000Z' },
    ...(label !== undefined ? { label } : {}),
  };
}

function reference(id: string, targetNodeId: string): ReferenceNode {
  return {
    id,
    kind: 'reference',
    position: ORIGIN,
    chainId: 'c2',
    createdAt: 0,
    targetNodeId,
  };
}

function doc(nodes: Record<string, CalcNode>): CalcDocument {
  return {
    schemaVersion: 1,
    id: 'doc',
    name: 't',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    viewport: { pan: ORIGIN, zoom: 1 },
    nodes,
    chains: {},
  };
}

describe('nodeHasLabel', () => {
  test('absent and empty string are not labels; non-empty is', () => {
    expect(nodeHasLabel(number('a', '1'))).toBe(false);
    expect(nodeHasLabel(number('a', '1', ''))).toBe(false);
    expect(nodeHasLabel(number('a', '1', 'Rate'))).toBe(true);
  });
});

describe('identitySourceId / labelForNode (P6b.1)', () => {
  test('number and result are their own identity source', () => {
    const nodes = { n1: number('n1', '5'), r1: result('r1', '5', 'Sum') };
    expect(identitySourceId(nodes, 'n1')).toBe('n1');
    expect(identitySourceId(nodes, 'r1')).toBe('r1');
    expect(labelForNode(nodes, 'n1')).toBeUndefined();
    expect(labelForNode(nodes, 'r1')).toBe('Sum');
  });

  test('reference looks through to the target label', () => {
    const nodes = {
      r1: result('r1', '35', 'Initial Deposit'),
      ref: reference('ref', 'r1'),
    };
    expect(identitySourceId(nodes, 'ref')).toBe('r1');
    expect(labelForNode(nodes, 'ref')).toBe('Initial Deposit');
    // A label on the reference cell itself is ignored — identity owns the caption.
    nodes.ref = { ...nodes.ref, label: 'Ignored' };
    expect(labelForNode(nodes, 'ref')).toBe('Initial Deposit');
  });

  test('dangling reference and non-values have no identity source', () => {
    const nodes: Record<string, CalcNode> = {
      ref: reference('ref', 'ghost'),
      op: {
        id: 'op',
        kind: 'operator',
        op: '+',
        position: ORIGIN,
        chainId: null,
        createdAt: 0,
      },
    };
    expect(identitySourceId(nodes, 'ref')).toBeNull();
    expect(identitySourceId(nodes, 'op')).toBeNull();
    expect(labelForNode(nodes, 'ref')).toBeUndefined();
  });
});

describe('referencedNodeIds / identityBearingNodeIds', () => {
  test('unreferenced unlabelled value has no identity', () => {
    const nodes = { n1: number('n1', '5'), r1: result('r1', '5') };
    expect(identityBearingNodeIds(nodes)).toEqual([]);
  });

  test('a reference alone grants the target an identity', () => {
    const nodes = {
      r1: result('r1', '35'),
      ref: reference('ref', 'r1'),
    };
    expect([...referencedNodeIds(nodes)]).toEqual(['r1']);
    expect(identityBearingNodeIds(nodes)).toEqual(['r1']);
  });

  test('a label alone grants identity — reference-only rule was wrong', () => {
    const nodes = { n1: number('n1', '100', 'Initial Deposit') };
    expect(identityBearingNodeIds(nodes)).toEqual(['n1']);
  });

  test('referenced OR labelled — either is enough; both still one identity', () => {
    const nodes = {
      r1: result('r1', '35', 'Sum'),
      ref: reference('ref', 'r1'),
    };
    expect(identityBearingNodeIds(nodes)).toEqual(['r1']);
  });

  test('dangling reference does not invent an identity for a missing target', () => {
    const nodes = { ref: reference('ref', 'ghost') };
    expect(identityBearingNodeIds(nodes)).toEqual([]);
  });

  test('ids are sorted — traversal order is not Object.keys insertion order', () => {
    // Insert z before a so Object.keys would be ['z','a'] without sorting.
    const nodes: Record<string, CalcNode> = {};
    nodes.z = number('z', '1', 'Z');
    nodes.a = number('a', '2', 'A');
    expect(Object.keys(nodes)).toEqual(['z', 'a']);
    expect(identityBearingNodeIds(nodes)).toEqual(['a', 'z']);
  });
});

describe('assignIdentityHues', () => {
  test('no identity → empty map (no hue spent)', () => {
    const nodes = { n1: number('n1', '5'), r1: result('r1', '5') };
    expect(assignIdentityHues(nodes, PALETTE).size).toBe(0);
  });

  test('assigns palette colours in sorted-id order; wraps when exhausted', () => {
    const nodes = {
      c: number('c', '3', 'C'),
      a: number('a', '1', 'A'),
      b: number('b', '2', 'B'),
      d: number('d', '4', 'D'),
      // Reference grants `a` identity too (already labelled) and must not itself
      // become a map key — callers look up the target.
      ref: reference('ref', 'a'),
    };
    const hues = assignIdentityHues(nodes, PALETTE);
    expect(hues.get('a')).toBe('#AAA111');
    expect(hues.get('b')).toBe('#BBB222');
    expect(hues.get('c')).toBe('#CCC333');
    expect(hues.get('d')).toBe('#AAA111'); // wrap
    expect(hues.has('ref')).toBe(false);
    expect(hues.get(nodes.ref.targetNodeId)).toBe('#AAA111');
  });

  test('empty palette yields no hues', () => {
    const nodes = { n1: number('n1', '1', 'L') };
    expect(assignIdentityHues(nodes, []).size).toBe(0);
  });

  test('1→N: one source identity, many references share it by looking up the target', () => {
    const nodes = {
      r1: result('r1', '10'),
      refA: reference('refA', 'r1'),
      refB: reference('refB', 'r1'),
    };
    const hues = assignIdentityHues(nodes, PALETTE);
    expect(hues.size).toBe(1);
    expect(hues.get('r1')).toBe('#AAA111');
    // Both consumers resolve through the same source entry.
    expect(hues.get(nodes.refA.targetNodeId)).toBe(hues.get(nodes.refB.targetNodeId));
  });

  test('save → reload yields identical hue assignment (decision #12)', () => {
    // Creation order deliberately differs from sorted-id order; serialize sorts
    // by id, so Object.keys after deserialize will not match live insertion order.
    const live = doc({});
    live.nodes.z = number('z', '9', 'Zed');
    live.nodes.m = result('m', '42');
    live.nodes.a = number('a', '1');
    live.nodes.ref = reference('ref', 'm');
    // Live keys: z, m, a, ref. Identities: m (referenced), z (labelled) → sorted m, z.
    const before = assignIdentityHues(live.nodes, PALETTE);
    expect([...before.keys()]).toEqual(['m', 'z']);
    expect(before.get('m')).toBe('#AAA111');
    expect(before.get('z')).toBe('#BBB222');

    const reloaded = deserializeDocument(serializeDocument(live));
    expect(Object.keys(reloaded.nodes)).toEqual(['a', 'm', 'ref', 'z']); // sorted
    const after = assignIdentityHues(reloaded.nodes, PALETTE);
    expect([...after.entries()]).toEqual([...before.entries()]);
  });
});
