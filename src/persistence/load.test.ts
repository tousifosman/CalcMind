import { CURRENT_SCHEMA_VERSION, type CalcDocument, type ResultNode } from '../model/types';
import type { StorageAdapter } from './adapter';
import {
  materializeLoadedValue,
  openDocument,
  parseJsonText,
  readSchemaVersion,
  refuseNewerSchema,
  validateLoadedJson,
  validateWireDocument,
} from './load';
import { serializeDocument } from './serialize';

function sampleDocument(): CalcDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'doc_test',
    name: 'Kitchen remodel',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:04:12.412Z',
    viewport: { pan: { x: -120, y: 40 }, zoom: 1 },
    nodes: {
      n1: {
        id: 'n1',
        kind: 'number',
        raw: '1221',
        position: { x: 0, y: 0 },
        chainId: 'c1',
        createdAt: 1785664800000,
      },
      n2: {
        id: 'n2',
        kind: 'operator',
        op: '+',
        position: { x: 88, y: 0 },
        chainId: 'c1',
        createdAt: 1785664801000,
      },
      n3: {
        id: 'n3',
        kind: 'number',
        raw: '3',
        position: { x: 122, y: 0 },
        chainId: 'c1',
        createdAt: 1785664802000,
      },
      n4: {
        id: 'n4',
        kind: 'equals',
        position: { x: 186, y: 0 },
        chainId: 'c1',
        createdAt: 1785664803000,
      },
      n5: {
        id: 'n5',
        kind: 'result',
        sourceChainId: 'c1',
        position: { x: 9999, y: 9999 }, // deliberately wrong — layout must overwrite
        chainId: 'c1',
        createdAt: 1785664804000,
      },
    },
    chains: {
      c1: {
        id: 'c1',
        members: ['n1', 'n2', 'n3', 'n4', 'n5'],
        anchor: { x: 0, y: 0 },
      },
    },
  };
}

function sampleWireJson(): string {
  return serializeDocument(sampleDocument());
}

/** Hand-edited file that still carries a stale `derived` (serialiser strips these). */
function sampleWireJsonWithStaleDerived(): string {
  const wire = JSON.parse(sampleWireJson()) as {
    nodes: Array<Record<string, unknown>>;
  };
  const result = wire.nodes.find(n => n.id === 'n5');
  if (result) {
    result.derived = {
      display: '9999',
      computedAt: '2026-08-02T10:00:00.000Z',
    };
    result.position = { x: 9999, y: 9999 };
  }
  return `${JSON.stringify(wire, null, 2)}\n`;
}

/** In-memory adapter for load-pipeline tests — primary + optional .bak. */
function memoryAdapter(opts: {
  primary?: string | null;
  backup?: string | null;
  writes?: string[];
}): StorageAdapter {
  const writes = opts.writes ?? [];
  return {
    list: async () => [],
    read: async () => {
      if (opts.primary == null) {
        throw new Error('ENOENT: primary missing');
      }
      return opts.primary;
    },
    write: async (_id, json) => {
      writes.push(json);
    },
    remove: async () => {},
    readBackup:
      opts.backup === undefined
        ? undefined
        : async () => {
            if (opts.backup == null) {
              throw new Error('ENOENT: backup missing');
            }
            return opts.backup;
          },
  };
}

describe('parseJsonText', () => {
  test('malformed JSON is a handled outcome, not a throw', () => {
    expect(() => parseJsonText('{not json')).not.toThrow();
    const result = parseJsonText('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed_json');
    expect(result.error.message).toMatch(/not valid JSON/i);
    expect(result.error.message).toMatch(/left untouched/i);
  });

  test('valid JSON returns the parsed value', () => {
    const result = parseJsonText('{"a":1}');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('schemaVersion gate (decision #7)', () => {
  test('schemaVersion greater than CURRENT is refused with a clear message', () => {
    const newer = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 98,
      id: 'doc_x',
      name: 'Future',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [],
      chains: [],
    });
    const result = validateLoadedJson(newer);
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) return;
    expect(result.error.kind).toBe('newer_schema');
    if (result.error.kind !== 'newer_schema') return;
    expect(result.error.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 98);
    expect(result.error.current).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.error.message).toMatch(/newer CalcMind/i);
    expect(result.error.message).toMatch(/left untouched/i);
    expect(result.error.message).not.toMatch(/failed validation/i);
  });

  test('refuseNewerSchema names both versions', () => {
    const err = refuseNewerSchema(99);
    expect(err.message).toContain('99');
    expect(err.message).toContain(String(CURRENT_SCHEMA_VERSION));
  });

  test('missing schemaVersion is refused', () => {
    const result = validateLoadedJson(
      JSON.stringify({ id: 'doc_x', nodes: [], chains: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) return;
    expect(result.error.kind).toBe('missing_schema_version');
  });

  test('older schemaVersion goes through the shared migrate gate (empty migrations → error)', () => {
    const older = JSON.stringify({
      schemaVersion: 0,
      id: 'doc_old',
      name: 'Old',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [],
      chains: [],
    });
    // Production migrations is empty (v1 origin). The shared gate surfaces
    // that as a migration error — same path materializeLoadedValue / openDocument use.
    const result = validateLoadedJson(older);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('migration');
    expect(result.error.message).toMatch(/No migration from schemaVersion 0/);
  });

  test('validateLoadedJson and materializeLoadedValue share the newer-schema refusal', () => {
    const newer = {
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      id: 'doc_x',
      name: 'Future',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [],
      chains: [],
    };
    const fromString = validateLoadedJson(JSON.stringify(newer));
    const fromValue = materializeLoadedValue(newer, 'en-US');
    expect(fromString.ok).toBe(false);
    expect(fromValue.ok).toBe(false);
    if (fromString.ok || fromValue.ok) return;
    expect(fromString.error.kind).toBe('newer_schema');
    expect(fromValue.error.kind).toBe('newer_schema');
    expect(fromString.error.message).toBe(fromValue.error.message);
  });
});

describe('validateWireDocument / validateLoadedJson', () => {
  test('a current-version serialised document validates', () => {
    const result = validateLoadedJson(sampleWireJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.document.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(result.document.nodes)).toBe(true);
    expect(Array.isArray(result.document.chains)).toBe(true);
  });

  test('structurally invalid but parseable JSON names the offending field', () => {
    const bad = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'doc_bad',
      name: 'Bad',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: {
        n1: {
          id: 'n1',
          kind: 'number',
          raw: '1',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 1,
        },
      },
      chains: [],
    });
    const result = validateLoadedJson(bad);
    expect(result.ok).toBe(false);
    if (result.ok || !('error' in result)) return;
    expect(result.error.kind).toBe('validation');
    expect(result.error.message).toMatch(/nodes/i);
    expect('document' in result).toBe(false);
  });

  test('invalid node field is named in the error', () => {
    const bad = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'doc_bad',
      name: 'Bad',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [
        {
          id: 'n1',
          kind: 'number',
          raw: 13.5,
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 1,
        },
      ],
      chains: [],
    };
    const result = validateWireDocument(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/nodes\[0\]\.raw/);
  });

  test('optional $schema and optional derived are accepted', () => {
    const withExtras = {
      $schema: 'https://calcmind.app/schema/document-1.json',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'doc_x',
      name: 'X',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [
        {
          id: 'r1',
          kind: 'result',
          sourceChainId: 'c1',
          position: { x: 0, y: 0 },
          chainId: 'c1',
          createdAt: 1,
          derived: { display: '42', computedAt: '2026-08-02T10:00:00.000Z' },
        },
      ],
      chains: [{ id: 'c1', members: ['r1'], anchor: { x: 0, y: 0 } }],
    };
    const result = validateWireDocument(withExtras);
    expect(result.ok).toBe(true);
  });

  test('readSchemaVersion rejects non-objects', () => {
    expect(readSchemaVersion(null).ok).toBe(false);
    expect(readSchemaVersion([]).ok).toBe(false);
    expect(readSchemaVersion('1').ok).toBe(false);
  });
});

describe('openDocument load pipeline (P5.5)', () => {
  test('corrupt primary recovers from .bak without writing', async () => {
    const good = sampleWireJson();
    const writes: string[] = [];
    const adapter = memoryAdapter({
      primary: '{not-json',
      backup: good,
      writes,
    });

    const result = await openDocument(adapter, 'doc_test', { locale: 'en-US' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('backup');
    expect(result.document.nodes.n1?.kind).toBe('number');
    expect(writes).toEqual([]);
  });

  test('missing primary (crash window) recovers from .bak', async () => {
    const good = sampleWireJson();
    const writes: string[] = [];
    const adapter = memoryAdapter({
      primary: null,
      backup: good,
      writes,
    });

    const result = await openDocument(adapter, 'doc_test', { locale: 'en-US' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('backup');
    expect(writes).toEqual([]);
  });

  test('both primary and backup unreadable → report and do not overwrite', async () => {
    const writes: string[] = [];
    const adapter = memoryAdapter({
      primary: '{broken',
      backup: '{also-broken',
      writes,
    });

    const result = await openDocument(adapter, 'doc_test');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unreadable');
    expect(result.error.message).toMatch(/Neither file was overwritten/);
    expect(writes).toEqual([]);
  });

  test('engine overwrites wrong derived from the file (decision #6)', async () => {
    const adapter = memoryAdapter({ primary: sampleWireJsonWithStaleDerived() });
    const result = await openDocument(adapter, 'doc_test', { locale: 'en-US' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const resultNode = result.document.nodes.n5 as ResultNode;
    expect(resultNode.kind).toBe('result');
    expect(resultNode.derived?.display).toBe('1,224'); // 1221+3, not the file's 9999
    expect(resultNode.derived?.outcome).toBeUndefined();
  });

  test('member positions are re-laid out from anchor, ignoring file positions', async () => {
    const adapter = memoryAdapter({ primary: sampleWireJsonWithStaleDerived() });
    const result = await openDocument(adapter, 'doc_test', { locale: 'en-US' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const n1 = result.document.nodes.n1;
    const n5 = result.document.nodes.n5;
    expect(n1?.position).toEqual({ x: 0, y: 0 });
    // File had (9999, 9999); layout places the result flush after equals.
    expect(n5?.position.x).toBeGreaterThan(0);
    expect(n5?.position.x).toBeLessThan(9999);
    expect(n5?.position.y).toBe(0);
  });

  test('schemaVersion 99 is refused and nothing is written', async () => {
    const writes: string[] = [];
    const newer = JSON.stringify({
      schemaVersion: 99,
      id: 'doc_x',
      name: 'Future',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: [],
      chains: [],
    });
    const adapter = memoryAdapter({ primary: newer, writes });
    const result = await openDocument(adapter, 'doc_x');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('newer_schema');
    expect(writes).toEqual([]);
  });

  test('materializeLoadedValue evaluates a Valid chain with =', () => {
    const wire = JSON.parse(sampleWireJson()) as unknown;
    const result = materializeLoadedValue(wire, 'en-US');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.document.nodes.n5 as ResultNode;
    expect(r.derived?.display).toBe('1,224');
  });
});
