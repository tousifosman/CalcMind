import { CURRENT_SCHEMA_VERSION, type CalcDocument } from '../model/types';
import { serializeDocument } from './serialize';
import {
  fileNameForExport,
  importDocumentThroughPipeline,
} from './transfer';
import type { StorageAdapter } from './adapter';

function sampleDoc(): CalcDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'doc_export',
    name: 'Kitchen remodel',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:04:12.412Z',
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    nodes: {
      n1: {
        id: 'n1',
        kind: 'number',
        raw: '2',
        position: { x: 0, y: 0 },
        chainId: 'c1',
        createdAt: 1,
      },
      n2: {
        id: 'n2',
        kind: 'operator',
        op: '+',
        position: { x: 40, y: 0 },
        chainId: 'c1',
        createdAt: 2,
      },
      n3: {
        id: 'n3',
        kind: 'number',
        raw: '3',
        position: { x: 80, y: 0 },
        chainId: 'c1',
        createdAt: 3,
      },
      n4: {
        id: 'n4',
        kind: 'equals',
        position: { x: 120, y: 0 },
        chainId: 'c1',
        createdAt: 4,
      },
      n5: {
        id: 'n5',
        kind: 'result',
        sourceChainId: 'c1',
        position: { x: 160, y: 0 },
        chainId: 'c1',
        createdAt: 5,
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

describe('fileNameForExport', () => {
  test('uses document name and .calcmind.json suffix', () => {
    expect(fileNameForExport(serializeDocument(sampleDoc()), 'doc_x')).toBe(
      'Kitchen remodel.calcmind.json',
    );
  });

  test('falls back to id when name missing', () => {
    expect(fileNameForExport('{"id":"doc_z"}', 'doc_fallback')).toBe(
      'doc_z.calcmind.json',
    );
  });
});

describe('importDocumentThroughPipeline (P5.8)', () => {
  test('unsupported when adapter has no importDocument', async () => {
    const adapter: StorageAdapter = {
      list: async () => [],
      read: async () => {
        throw new Error('unused');
      },
      write: async () => {},
      remove: async () => {},
    };
    const result = await importDocumentThroughPipeline(adapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  test('cancelled when picker returns null', async () => {
    const adapter: StorageAdapter = {
      list: async () => [],
      read: async () => {
        throw new Error('unused');
      },
      write: async () => {},
      remove: async () => {},
      importDocument: async () => null,
    };
    const result = await importDocumentThroughPipeline(adapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('cancelled');
  });

  test('full P5.5 path: valid export materialises and engine wins', async () => {
    const json = serializeDocument(sampleDoc());
    const adapter: StorageAdapter = {
      list: async () => [],
      read: async () => {
        throw new Error('import must not read storage');
      },
      write: async () => {
        throw new Error('import must not write storage');
      },
      remove: async () => {},
      importDocument: async () => json,
    };
    const result = await importDocumentThroughPipeline(adapter, {
      locale: 'en-US',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.n1?.kind).toBe('number');
    const resultNode = result.document.nodes.n5;
    expect(resultNode?.kind).toBe('result');
    if (resultNode?.kind !== 'result') return;
    expect(resultNode.derived?.display).toBe('5');
  });

  test('schemaVersion 99 is refused — no shortcut for “our own” format', async () => {
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
    const adapter: StorageAdapter = {
      list: async () => [],
      read: async () => {
        throw new Error('unused');
      },
      write: async () => {},
      remove: async () => {},
      importDocument: async () => newer,
    };
    const result = await importDocumentThroughPipeline(adapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('newer_schema');
  });

  test('malformed import JSON is a handled outcome', async () => {
    const adapter: StorageAdapter = {
      list: async () => [],
      read: async () => {
        throw new Error('unused');
      },
      write: async () => {},
      remove: async () => {},
      importDocument: async () => '{not-json',
    };
    const result = await importDocumentThroughPipeline(adapter);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed_json');
  });
});
