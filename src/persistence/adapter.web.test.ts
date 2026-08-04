import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { createStore } from 'idb-keyval';

import {
  createWebStorageAdapter,
  WEB_ADAPTER_MODULE,
} from './adapter.web';
import { defineStorageAdapterContract } from './adapter.sharedTests';

let storeSeq = 0;

beforeEach(() => {
  // Fresh IndexedDB per test so createStore's cached open-promise cannot leak
  // state across cases (idb-keyval holds one dbp per createStore call).
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    writable: true,
    configurable: true,
  });
});

function freshWebAdapter() {
  storeSeq += 1;
  return createWebStorageAdapter({
    store: createStore(`calcmind-test-${storeSeq}`, 'documents'),
  });
}

defineStorageAdapterContract('web', () => ({
  adapter: freshWebAdapter(),
}));

describe('web adapter specifics (P5.4)', () => {
  test('rejects unsafe document ids at the key boundary', async () => {
    const adapter = freshWebAdapter();
    await expect(adapter.write('../etc', '{}')).rejects.toThrow(/unsafe document id/);
    await expect(adapter.read('a/b')).rejects.toThrow(/unsafe document id/);
  });

  test('has no readBackup — IndexedDB transactions need no .bak', () => {
    const adapter = freshWebAdapter();
    expect(adapter.readBackup).toBeUndefined();
  });

  test('WEB_ADAPTER_MODULE marker is stable for the webpack resolve smoke check', () => {
    expect(WEB_ADAPTER_MODULE).toBe('calcmind-persistence-adapter-web');
  });
});

describe('web export / import (P5.8)', () => {
  test('exportDocument downloads a Blob via the download hook', async () => {
    const downloads: Array<{ filename: string; json: string }> = [];
    storeSeq += 1;
    const adapter = createWebStorageAdapter({
      store: createStore(`calcmind-test-${storeSeq}`, 'documents'),
      download: (filename, json) => {
        downloads.push({ filename, json });
      },
    });
    const json = JSON.stringify({
      schemaVersion: 1,
      id: 'doc_a',
      name: 'Alpha',
    });
    await adapter.write('doc_a', json);
    await adapter.exportDocument?.('doc_a');
    expect(downloads).toEqual([
      { filename: 'Alpha.calcmind.json', json },
    ]);
  });

  test('importDocument returns picker text (and null on cancel)', async () => {
    storeSeq += 1;
    const adapter = createWebStorageAdapter({
      store: createStore(`calcmind-test-${storeSeq}`, 'documents'),
      pickFile: async () => '{"hello":1}',
    });
    await expect(adapter.importDocument?.()).resolves.toBe('{"hello":1}');

    storeSeq += 1;
    const cancelled = createWebStorageAdapter({
      store: createStore(`calcmind-test-${storeSeq}`, 'documents'),
      pickFile: async () => null,
    });
    await expect(cancelled.importDocument?.()).resolves.toBeNull();
  });

  test('import through pipeline uses P5.5 validation, not a storage short-circuit', async () => {
    const { importDocumentThroughPipeline } = require('./transfer') as typeof import('./transfer');
    const { serializeDocument } = require('./serialize') as typeof import('./serialize');
    const { CURRENT_SCHEMA_VERSION } = require('../model/types') as typeof import('../model/types');

    const json = serializeDocument({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'doc_i',
      name: 'Imported',
      createdAt: '2026-08-02T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
      viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
      nodes: {},
      chains: {},
    });

    storeSeq += 1;
    const adapter = createWebStorageAdapter({
      store: createStore(`calcmind-test-${storeSeq}`, 'documents'),
      pickFile: async () => json,
    });
    const result = await importDocumentThroughPipeline(adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.name).toBe('Imported');
    // Still empty in IndexedDB — import does not auto-write.
    await expect(adapter.read('doc_i')).rejects.toThrow(/not found/);
  });
});

describe('webpack .web.ts resolution (§5.1 / P5.4)', () => {
  test('resolve.extensions lists .web.ts before .ts — no config change required', () => {
    const factory = require('../../webpack.config.js') as (
      env: unknown,
      argv: { mode?: string },
    ) => { resolve: { extensions: string[] } };
    const config = factory({}, { mode: 'development' });
    const ext = config.resolve.extensions;
    const webTs = ext.indexOf('.web.ts');
    const ts = ext.indexOf('.ts');
    expect(webTs).toBeGreaterThanOrEqual(0);
    expect(ts).toBeGreaterThanOrEqual(0);
    expect(webTs).toBeLessThan(ts);
  });
});
