// Web StorageAdapter contract + P5.8 transfer + webpack .web.ts resolution.
import {
  createMemoryDocumentKeyVal,
  createWebStorageAdapter,
  downloadJsonViaAnchor,
  pickJsonTextViaBrowser,
} from './adapter.web';
import { defineStorageAdapterContract } from './adapter.sharedTests';

defineStorageAdapterContract('web', () => ({
  adapter: createWebStorageAdapter({ kv: createMemoryDocumentKeyVal() }),
}));

describe('web adapter specifics (§12.2)', () => {
  test('write is a single kv.set (IndexedDB transaction atomicity)', async () => {
    const ops: Array<{ op: string; key?: string }> = [];
    const inner = createMemoryDocumentKeyVal();
    const kv = {
      get: (key: string) => {
        ops.push({ op: 'get', key });
        return inner.get(key);
      },
      set: async (key: string, value: string) => {
        ops.push({ op: 'set', key });
        return inner.set(key, value);
      },
      del: (key: string) => {
        ops.push({ op: 'del', key });
        return inner.del(key);
      },
      keys: () => {
        ops.push({ op: 'keys' });
        return inner.keys();
      },
    };
    const adapter = createWebStorageAdapter({ kv });
    await adapter.write('doc_a', '{"n":1}');
    await adapter.write('doc_a', '{"n":2}');
    expect(ops.filter(o => o.op === 'set')).toEqual([
      { op: 'set', key: 'doc_a' },
      { op: 'set', key: 'doc_a' },
    ]);
    await expect(adapter.read('doc_a')).resolves.toBe('{"n":2}');
  });

  test('rejects unsafe document ids on write/read/remove', async () => {
    const adapter = createWebStorageAdapter({
      kv: createMemoryDocumentKeyVal(),
    });
    await expect(adapter.write('../x', '{}')).rejects.toThrow(/unsafe document id/);
    await expect(adapter.read('a/b')).rejects.toThrow(/unsafe document id/);
    await expect(adapter.remove('')).rejects.toThrow(/unsafe document id/);
  });

  test('list skips keys that fail the safe-id alphabet', async () => {
    const kv = createMemoryDocumentKeyVal([
      ['doc_ok', JSON.stringify({ id: 'doc_ok', name: 'Ok' })],
      ['../bad', '{"name":"nope"}'],
    ]);
    const adapter = createWebStorageAdapter({ kv });
    const list = await adapter.list();
    expect(list.map(m => m.id)).toEqual(['doc_ok']);
  });
});

describe('web export / import (P5.8)', () => {
  test('exportDocument downloads the stored JSON under a .calcmind.json name', async () => {
    const downloads: Array<{ filename: string; json: string }> = [];
    const kv = createMemoryDocumentKeyVal();
    const adapter = createWebStorageAdapter({
      kv,
      transfer: {
        downloadJson: (filename, json) => {
          downloads.push({ filename, json });
        },
        pickJsonText: async () => null,
      },
    });
    const json = JSON.stringify({
      schemaVersion: 1,
      id: 'doc_a',
      name: 'Kitchen remodel',
    });
    await adapter.write('doc_a', json);
    await adapter.exportDocument!('doc_a');
    expect(downloads).toEqual([
      { filename: 'Kitchen remodel.calcmind.json', json },
    ]);
  });

  test('importDocument returns the raw picker text without validating', async () => {
    const raw = '{"schemaVersion":99,"not":"validated"}';
    const adapter = createWebStorageAdapter({
      kv: createMemoryDocumentKeyVal(),
      transfer: {
        downloadJson: () => undefined,
        pickJsonText: async () => raw,
      },
    });
    // Adapter must not refuse newer-schema / malformed — that is P5.5's job.
    await expect(adapter.importDocument!()).resolves.toBe(raw);
  });

  test('importDocument returns null when the user cancels', async () => {
    const adapter = createWebStorageAdapter({
      kv: createMemoryDocumentKeyVal(),
      transfer: {
        downloadJson: () => undefined,
        pickJsonText: async () => null,
      },
    });
    await expect(adapter.importDocument!()).resolves.toBeNull();
  });

  test('downloadJsonViaAnchor creates an object-URL download link', () => {
    const clicks: string[] = [];
    const createObjectURL = jest.fn(() => 'blob:mock');
    const revokeObjectURL = jest.fn();
    const appendChild = jest.fn();
    const remove = jest.fn();
    const click = jest.fn(function (this: { download: string }) {
      clicks.push(this.download);
    });

    const g = globalThis as Record<string, unknown>;
    const prev = {
      URL: g.URL,
      Blob: g.Blob,
      document: g.document,
    };

    g.URL = { createObjectURL, revokeObjectURL };
    g.Blob = class {
      constructor(_parts: unknown[], _opts?: unknown) {}
    };
    g.document = {
      createElement: () => ({
        href: '',
        download: '',
        rel: '',
        click,
        remove,
      }),
      body: { appendChild },
    };

    try {
      downloadJsonViaAnchor('Doc.calcmind.json', '{"ok":true}');
      expect(createObjectURL).toHaveBeenCalled();
      expect(appendChild).toHaveBeenCalled();
      expect(clicks).toEqual(['Doc.calcmind.json']);
      expect(remove).toHaveBeenCalled();
    } finally {
      g.URL = prev.URL;
      g.Blob = prev.Blob;
      g.document = prev.document;
    }
  });

  test('pickJsonTextViaBrowser prefers showOpenFilePicker when present', async () => {
    const getFile = jest.fn(async () => ({
      text: async () => '{"from":"fsa"}',
    }));
    const showOpenFilePicker = jest.fn(async () => [{ getFile }]);
    const g = globalThis as Record<string, unknown>;
    const previous = g.showOpenFilePicker;
    g.showOpenFilePicker = showOpenFilePicker;
    try {
      await expect(pickJsonTextViaBrowser()).resolves.toBe('{"from":"fsa"}');
      expect(showOpenFilePicker).toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete g.showOpenFilePicker;
      } else {
        g.showOpenFilePicker = previous;
      }
    }
  });

  test('pickJsonTextViaBrowser maps AbortError to null', async () => {
    const g = globalThis as Record<string, unknown>;
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    g.showOpenFilePicker = jest.fn(async () => {
      throw abort;
    });
    try {
      await expect(pickJsonTextViaBrowser()).resolves.toBeNull();
    } finally {
      delete g.showOpenFilePicker;
    }
  });
});

describe('webpack .web.ts resolution (§5.1 / P5.4)', () => {
  test('resolve.extensions prefers adapter.web.ts over adapter.ts with no config change', async () => {
    // Verify the same extension order webpack.config.js already lists — do not
    // invent a new alias. enhanced-resolve is webpack's own resolver.
    const { ResolverFactory, CachedInputFileSystem } =
      require('enhanced-resolve') as {
        ResolverFactory: {
          createResolver: (opts: object) => {
            resolve: (
              context: object,
              path: string,
              request: string,
              resolveContext: object,
              callback: (err: Error | null, result?: string) => void,
            ) => void;
          };
        };
        CachedInputFileSystem: new (fs: unknown, duration: number) => unknown;
      };
    const fs = require('fs') as unknown;
    const nodePath = require('path') as {
      resolve: (...parts: string[]) => string;
      basename: (p: string) => string;
    };

    const resolver = ResolverFactory.createResolver({
      fileSystem: new CachedInputFileSystem(fs, 4000),
      extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
      useSyncFileSystemCalls: true,
    });

    const persistenceDir = nodePath.resolve(
      // process.cwd() is the repo root under Jest.
      (globalThis as { process?: { cwd: () => string } }).process!.cwd(),
      'src/persistence',
    );

    const resolved: string = await new Promise((resolve, reject) => {
      resolver.resolve(
        {},
        persistenceDir,
        './adapter',
        {},
        (err, result) => {
          if (err || !result) {
            reject(err ?? new Error('resolve returned empty'));
            return;
          }
          resolve(result);
        },
      );
    });

    expect(nodePath.basename(resolved)).toBe('adapter.web.ts');
  });
});
