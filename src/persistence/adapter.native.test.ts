jest.mock('@dr.pogodin/react-native-fs');

import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  assertSafeDocumentId,
  bakPath,
  createNativeStorageAdapter,
  idFromPrimaryFileName,
  isSafeDocumentId,
  primaryPath,
  tmpPath,
} from './adapter.native';
import { defineStorageAdapterContract } from './adapter.sharedTests';

type FsMock = typeof RNFS & {
  __resetMemoryFs: () => void;
  __getOps: () => Array<{
    op: string;
    path?: string;
    from?: string;
    into?: string;
    bytes?: number;
  }>;
  __getFiles: () => Map<string, string>;
  __setFailNextMove: (message?: string) => void;
  __setFailNthMove: (n: number, message?: string) => void;
};

const fs = RNFS as FsMock;

beforeEach(() => {
  fs.__resetMemoryFs();
});

defineStorageAdapterContract('native', () => ({
  adapter: createNativeStorageAdapter(),
  peekPrimary: id => fs.__getFiles().get(primaryPath(id)),
  peekBak: id => fs.__getFiles().get(bakPath(id)),
  peekTmp: id => fs.__getFiles().get(tmpPath(id)),
}));

describe('native paths (§12.2)', () => {
  test('documents live under DocumentDirectoryPath/calcmind/<id>.calcmind.json', () => {
    expect(primaryPath('doc_V1')).toBe(
      `${fs.DocumentDirectoryPath}/calcmind/doc_V1.calcmind.json`,
    );
    expect(tmpPath('doc_V1')).toBe(
      `${fs.DocumentDirectoryPath}/calcmind/doc_V1.calcmind.json.tmp`,
    );
    expect(bakPath('doc_V1')).toBe(
      `${fs.DocumentDirectoryPath}/calcmind/doc_V1.calcmind.json.bak`,
    );
  });

  test('idFromPrimaryFileName accepts only primary filenames', () => {
    expect(idFromPrimaryFileName('doc_a.calcmind.json')).toBe('doc_a');
    expect(idFromPrimaryFileName('doc_a.calcmind.json.tmp')).toBeNull();
    expect(idFromPrimaryFileName('doc_a.calcmind.json.bak')).toBeNull();
    expect(idFromPrimaryFileName('readme.txt')).toBeNull();
  });

  test('path helpers reject unsafe document ids', () => {
    expect(isSafeDocumentId('doc_V1StGXR8Z5jdHi6B')).toBe(true);
    expect(isSafeDocumentId('../etc')).toBe(false);
    expect(isSafeDocumentId('a/b')).toBe(false);
    expect(isSafeDocumentId('')).toBe(false);
    expect(() => assertSafeDocumentId('doc_ok')).not.toThrow();
    expect(() => primaryPath('../escape')).toThrow(/unsafe document id/);
    expect(() => primaryPath('a/b')).toThrow(/unsafe document id/);
  });
});

describe('native atomic write (§12.3)', () => {
  test('first write: writeFile(.tmp) then moveFile → primary; no .bak', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');

    const ops = fs
      .__getOps()
      .filter(o => o.op === 'writeFile' || o.op === 'moveFile' || o.op === 'unlink');
    expect(ops[0]).toMatchObject({ op: 'writeFile', path: tmpPath('doc_1') });
    expect(
      ops.some(
        o =>
          o.op === 'moveFile' &&
          o.from === tmpPath('doc_1') &&
          o.into === primaryPath('doc_1'),
      ),
    ).toBe(true);

    const files = fs.__getFiles();
    expect(files.get(primaryPath('doc_1'))).toBe('{"n":1}');
    expect(files.has(tmpPath('doc_1'))).toBe(false);
    expect(files.has(bakPath('doc_1'))).toBe(false);
  });

  test('overwrite: previous primary becomes the sole .bak, after .tmp write', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');
    const opCountBefore = fs.__getOps().length;

    await adapter.write('doc_1', '{"n":2}');

    const ops = fs.__getOps().slice(opCountBefore);
    const writeTmp = ops.findIndex(
      o => o.op === 'writeFile' && o.path === tmpPath('doc_1'),
    );
    const moveToBak = ops.findIndex(
      o =>
        o.op === 'moveFile' &&
        o.from === primaryPath('doc_1') &&
        o.into === bakPath('doc_1'),
    );
    const moveToPrimary = ops.findIndex(
      o =>
        o.op === 'moveFile' &&
        o.from === tmpPath('doc_1') &&
        o.into === primaryPath('doc_1'),
    );

    expect(writeTmp).toBeGreaterThanOrEqual(0);
    expect(moveToBak).toBeGreaterThan(writeTmp);
    expect(moveToPrimary).toBeGreaterThan(moveToBak);

    const files = fs.__getFiles();
    expect(files.get(primaryPath('doc_1'))).toBe('{"n":2}');
    expect(files.get(bakPath('doc_1'))).toBe('{"n":1}');
    expect(files.has(tmpPath('doc_1'))).toBe(false);
  });

  test('second overwrite replaces .bak — exactly one generation', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');
    await adapter.write('doc_1', '{"n":2}');
    await adapter.write('doc_1', '{"n":3}');

    const files = fs.__getFiles();
    expect(files.get(primaryPath('doc_1'))).toBe('{"n":3}');
    expect(files.get(bakPath('doc_1'))).toBe('{"n":2}');
    const bakLike = [...files.keys()].filter(
      p => p.includes('doc_1') && p.endsWith('.bak'),
    );
    expect(bakLike).toEqual([bakPath('doc_1')]);
  });

  test('crash after .tmp write leaves prior primary intact (no truncated primary)', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');

    // Fail the first move of the next write (primary → .bak), after .tmp is written.
    fs.__setFailNextMove('simulated crash mid-save');
    await expect(adapter.write('doc_1', '{"n":2}')).rejects.toThrow(
      'simulated crash mid-save',
    );

    const files = fs.__getFiles();
    expect(files.get(primaryPath('doc_1'))).toBe('{"n":1}');
    expect(files.get(tmpPath('doc_1'))).toBe('{"n":2}');
  });

  test('crash after primary→.bak leaves no primary (P5.5 recovers via .bak)', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');

    // Second moveFile in the overwrite is .tmp → primary. Failing it leaves
    // primary absent, old bytes at .bak, new bytes at .tmp — the window P5.5's
    // load path must treat like a missing/corrupt primary.
    fs.__setFailNthMove(2, 'simulated crash after bak rotate');
    await expect(adapter.write('doc_1', '{"n":2}')).rejects.toThrow(
      'simulated crash after bak rotate',
    );

    const files = fs.__getFiles();
    expect(files.has(primaryPath('doc_1'))).toBe(false);
    expect(files.get(bakPath('doc_1'))).toBe('{"n":1}');
    expect(files.get(tmpPath('doc_1'))).toBe('{"n":2}');
  });

  test('remove clears primary, .bak, and any leftover .tmp', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');
    await adapter.write('doc_1', '{"n":2}');
    await fs.writeFile(tmpPath('doc_1'), 'orphan', 'utf8');

    await adapter.remove('doc_1');

    const files = fs.__getFiles();
    expect(files.has(primaryPath('doc_1'))).toBe(false);
    expect(files.has(bakPath('doc_1'))).toBe(false);
    expect(files.has(tmpPath('doc_1'))).toBe(false);
  });

  test('list ignores .bak and .tmp siblings', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write(
      'doc_1',
      JSON.stringify({ id: 'doc_1', name: 'One', updatedAt: 't' }),
    );
    await adapter.write(
      'doc_1',
      JSON.stringify({ id: 'doc_1', name: 'One', updatedAt: 't2' }),
    );
    await fs.writeFile(tmpPath('doc_1'), 'nope', 'utf8');

    const list = await adapter.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('doc_1');
  });
});

describe('native readBackup (P5.5 recovery)', () => {
  test('write twice, then readBackup returns the prior generation', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');
    await adapter.write('doc_1', '{"n":2}');

    await expect(adapter.read('doc_1')).resolves.toBe('{"n":2}');
    expect(adapter.readBackup).toBeDefined();
    await expect(adapter.readBackup!('doc_1')).resolves.toBe('{"n":1}');
    expect(fs.__getFiles().get(bakPath('doc_1'))).toBe('{"n":1}');
  });

  test('after primary is removed, readBackup still returns the last good file', async () => {
    const adapter = createNativeStorageAdapter();
    await adapter.write('doc_1', '{"n":1}');
    await adapter.write('doc_1', '{"n":2}');
    await fs.unlink(primaryPath('doc_1'));

    await expect(adapter.read('doc_1')).rejects.toBeTruthy();
    await expect(adapter.readBackup!('doc_1')).resolves.toBe('{"n":1}');
  });
});
