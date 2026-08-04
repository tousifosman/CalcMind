import {
  deserializeDocument,
  documentSchemaUrl,
  serializeDocument,
  stripDerived,
  toSerializedDocument,
} from './serialize';
import { CalcDocument, ResultNode } from '../model/types';

/** A small document with two chains and out-of-order Record keys, to exercise sorting. */
function sampleDocument(): CalcDocument {
  return {
    schemaVersion: 1,
    id: 'doc_test',
    name: 'Kitchen remodel',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:04:12.412Z',
    viewport: { pan: { x: -120, y: 40 }, zoom: 1 },
    // Inserted in reverse id order so a naïve Object.values walk would be unstable.
    nodes: {
      n2: {
        id: 'n2',
        kind: 'operator',
        op: '+',
        position: { x: 88, y: 0 },
        chainId: 'c1',
        createdAt: 1785664801000,
      },
      n1: {
        id: 'n1',
        kind: 'number',
        raw: '1221',
        position: { x: 0, y: 0 },
        chainId: 'c1',
        createdAt: 1785664800000,
      },
      n3: {
        id: 'n3',
        kind: 'result',
        sourceChainId: 'c1',
        position: { x: 310, y: 0 },
        chainId: 'c1',
        createdAt: 1785664805000,
        derived: {
          display: '1221',
          computedAt: '2026-08-02T10:04:12.412Z',
        },
      },
      n_free: {
        id: 'n_free',
        kind: 'number',
        raw: '7',
        position: { x: 500, y: 100 },
        chainId: null,
        createdAt: 1785664810000,
        label: 'spare',
      },
    },
    chains: {
      c_z: {
        id: 'c_z',
        members: ['n_free'],
        anchor: { x: 500, y: 100 },
      },
      c1: {
        id: 'c1',
        members: ['n1', 'n2', 'n3'],
        anchor: { x: 0, y: 0 },
      },
    },
  };
}

describe('serializeDocument', () => {
  test('nodes and chains are arrays in stable id order', () => {
    const wire = toSerializedDocument(sampleDocument());
    expect(Array.isArray(wire.nodes)).toBe(true);
    expect(Array.isArray(wire.chains)).toBe(true);
    expect(wire.nodes.map(n => n.id)).toEqual(['n1', 'n2', 'n3', 'n_free']);
    expect(wire.chains.map(c => c.id)).toEqual(['c1', 'c_z']);
  });

  test('derived is stripped on write', () => {
    const wire = toSerializedDocument(sampleDocument());
    const result = wire.nodes.find(n => n.id === 'n3') as ResultNode;
    expect(result.kind).toBe('result');
    expect(result.derived).toBeUndefined();
    expect('derived' in result).toBe(false);

    const json = serializeDocument(sampleDocument());
    expect(json).not.toMatch(/"derived"/);
  });

  test('member position is written (self-describing file)', () => {
    const wire = toSerializedDocument(sampleDocument());
    const n1 = wire.nodes.find(n => n.id === 'n1')!;
    expect(n1.position).toEqual({ x: 0, y: 0 });
    expect(n1.chainId).toBe('c1');
  });

  test('attaches the §12.1 $schema URL', () => {
    const wire = toSerializedDocument(sampleDocument());
    expect(wire.$schema).toBe(documentSchemaUrl(1));
    expect(wire.$schema).toBe('https://calcmind.app/schema/document-1.json');
  });

  test('keys are sorted so identical documents are byte-identical', () => {
    const a = serializeDocument(sampleDocument());
    const b = serializeDocument(sampleDocument());
    expect(a).toBe(b);

    // Re-building with differently ordered Record insertion must not change bytes.
    const shuffled: CalcDocument = {
      ...sampleDocument(),
      nodes: {
        n3: sampleDocument().nodes.n3,
        n_free: sampleDocument().nodes.n_free,
        n1: sampleDocument().nodes.n1,
        n2: sampleDocument().nodes.n2,
      },
      chains: {
        c1: sampleDocument().chains.c1,
        c_z: sampleDocument().chains.c_z,
      },
    };
    expect(serializeDocument(shuffled)).toBe(a);

    // Top-level keys and a node's own keys appear in sorted order in the text.
    const topKeys = [...a.matchAll(/^ {2}"(\$?\w+)":/gm)].map(m => m[1]);
    expect(topKeys).toEqual([...topKeys].sort());

    const parsed = JSON.parse(a) as { nodes: Array<Record<string, unknown>> };
    const n1 = parsed.nodes.find(n => n.id === 'n1')!;
    expect(Object.keys(n1)).toEqual(Object.keys(n1).sort());
  });

  test('round-trip: document → JSON → document equals the derived-stripped original', () => {
    const original = sampleDocument();
    const json = serializeDocument(original);
    const roundTripped = deserializeDocument(json);

    const expected: CalcDocument = {
      ...original,
      nodes: Object.fromEntries(
        Object.entries(original.nodes).map(([id, node]) => [id, stripDerived(node)]),
      ),
    };
    expect(roundTripped).toEqual(expected);
    // Second serialisation of the round-trip is byte-identical to the first.
    expect(serializeDocument(roundTripped)).toBe(json);
  });

  test('empty document round-trips', () => {
    const empty: CalcDocument = {
      schemaVersion: 1,
      id: 'doc_empty',
      name: 'Untitled',
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: {},
      chains: {},
    };
    const json = serializeDocument(empty);
    expect(deserializeDocument(json)).toEqual(empty);
    expect(serializeDocument(deserializeDocument(json))).toBe(json);
  });

  test('does not mutate the input document', () => {
    const doc = sampleDocument();
    const before = JSON.parse(JSON.stringify(doc));
    serializeDocument(doc);
    expect(doc).toEqual(before);
    expect(doc.nodes.n3.kind === 'result' && doc.nodes.n3.derived).toEqual({
      display: '1221',
      computedAt: '2026-08-02T10:04:12.412Z',
    });
  });
});
