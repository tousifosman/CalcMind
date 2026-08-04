// §11.2 / P6.4 — dangling reference detection, display, and delete-time stamping.
import {
  deleteNodesLeavingDanglingRefs,
  explainDanglingReference,
  isDanglingReference,
  isRepointTarget,
  prepareReferencesForDeletion,
  referenceCellContent,
  referenceDisplayText,
} from './reference';
import type { CalcDocument, CalcNode, NumberNode, ReferenceNode, ResultNode } from '../model/types';

const ORIGIN = { x: 0, y: 0 };

function number(id: string, raw: string): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId: null, createdAt: 0 };
}

function result(id: string, display: string): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId: 'c1',
    createdAt: 0,
    sourceChainId: 'c1',
    derived: { display, computedAt: '2026-08-04T00:00:00.000Z' },
  };
}

function reference(id: string, targetNodeId: string, lastKnownDisplay?: string): ReferenceNode {
  return {
    id,
    kind: 'reference',
    position: ORIGIN,
    chainId: null,
    createdAt: 0,
    targetNodeId,
    ...(lastKnownDisplay !== undefined ? { lastKnownDisplay } : {}),
  };
}

function doc(nodes: CalcNode[]): CalcDocument {
  const map: Record<string, CalcNode> = {};
  for (const n of nodes) map[n.id] = n;
  return {
    schemaVersion: 1,
    id: 'doc',
    name: 't',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    viewport: { pan: ORIGIN, zoom: 1 },
    nodes: map,
    chains: {},
  };
}

describe('isDanglingReference', () => {
  test('false when the target exists', () => {
    const nodes = { n: number('n', '3'), r: reference('r', 'n') };
    expect(isDanglingReference(nodes.r, nodes)).toBe(false);
  });

  test('true when the target is missing', () => {
    const nodes = { r: reference('r', 'ghost', '9') };
    expect(isDanglingReference(nodes.r, nodes)).toBe(true);
  });
});

describe('referenceDisplayText / referenceCellContent', () => {
  test('live number target shows formatted raw', () => {
    const nodes = { n: number('n', '1221'), r: reference('r', 'n') };
    expect(referenceDisplayText(nodes.r, nodes, 'en-US')).toBe('1,221');
    expect(referenceCellContent(nodes.r, nodes, 'en-US')).toEqual({
      mode: 'live',
      text: '1,221',
      dimmed: false,
    });
  });

  test('dangling shows lastKnownDisplay, dimmed — never a bare ?', () => {
    const nodes = { r: reference('r', 'ghost', '1,224') };
    expect(referenceDisplayText(nodes.r, nodes, 'en-US')).toBe('1,224');
    expect(referenceCellContent(nodes.r, nodes, 'en-US')).toEqual({
      mode: 'dangling',
      text: '1,224',
      dimmed: true,
    });
    expect(referenceCellContent(nodes.r, nodes, 'en-US').text).not.toBe('?');
  });

  test('dangling without a stamp shows empty, still dangling mode', () => {
    const nodes = { r: reference('r', 'ghost') };
    expect(referenceCellContent(nodes.r, nodes, 'en-US')).toEqual({
      mode: 'dangling',
      text: '',
      dimmed: true,
    });
  });

  test('result target uses resultCellContent text', () => {
    const nodes = { res: result('res', '42'), r: reference('r', 'res') };
    expect(referenceDisplayText(nodes.r, nodes, 'en-US')).toBe('42');
  });
});

describe('explainDanglingReference', () => {
  test('is an explanation, not a glyph', () => {
    const text = explainDanglingReference();
    expect(text.length).toBeGreaterThan(1);
    expect(text).not.toBe('?');
  });
});

describe('prepareReferencesForDeletion / deleteNodesLeavingDanglingRefs', () => {
  test('stamps lastKnownDisplay and leaves the reference in place', () => {
    const draft = doc([number('n', '42'), reference('r', 'n')]);
    prepareReferencesForDeletion(draft, new Set(['n']), 'en-US');
    expect(draft.nodes.r).toMatchObject({
      kind: 'reference',
      targetNodeId: 'n',
      lastKnownDisplay: '42',
    });
    expect(draft.nodes.n).toBeDefined(); // prepare does not delete

    deleteNodesLeavingDanglingRefs(draft, ['n'], 'en-US');
    expect(draft.nodes.n).toBeUndefined();
    expect(draft.nodes.r).toMatchObject({
      kind: 'reference',
      lastKnownDisplay: '42',
    });
    expect(isDanglingReference(draft.nodes.r as ReferenceNode, draft.nodes)).toBe(true);
  });

  test('does not cascade-delete multiple consumers', () => {
    const draft = doc([
      number('n', '7'),
      reference('r1', 'n'),
      reference('r2', 'n'),
    ]);
    deleteNodesLeavingDanglingRefs(draft, ['n'], 'en-US');
    expect(draft.nodes.r1).toBeDefined();
    expect(draft.nodes.r2).toBeDefined();
    expect((draft.nodes.r1 as ReferenceNode).lastKnownDisplay).toBe('7');
    expect((draft.nodes.r2 as ReferenceNode).lastKnownDisplay).toBe('7');
  });

  test('keeps an earlier stamp when the target is already gone', () => {
    const draft = doc([reference('r', 'ghost', '99')]);
    prepareReferencesForDeletion(draft, new Set(['ghost']), 'en-US');
    expect((draft.nodes.r as ReferenceNode).lastKnownDisplay).toBe('99');
  });
});

describe('isRepointTarget', () => {
  test('allows numbers and results, rejects self and operators', () => {
    const nodes: Record<string, CalcNode> = {
      n: number('n', '1'),
      res: result('res', '2'),
      r: reference('r', 'n'),
      dangling: reference('dangling', 'ghost', '3'),
      op: { id: 'op', kind: 'operator', op: '+', position: ORIGIN, chainId: null, createdAt: 0 },
    };
    expect(isRepointTarget('n', nodes, 'r')).toBe(true);
    expect(isRepointTarget('res', nodes, 'r')).toBe(true);
    expect(isRepointTarget('r', nodes, 'dangling')).toBe(true);
    expect(isRepointTarget('dangling', nodes, 'r')).toBe(false);
    expect(isRepointTarget('op', nodes, 'r')).toBe(false);
    expect(isRepointTarget('r', nodes, 'r')).toBe(false);
  });
});
