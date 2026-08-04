// Native export / import (P5.8) — share sheet + pickFile.
jest.mock('@dr.pogodin/react-native-fs');

jest.mock('react-native', () => {
  const share = jest.fn(async () => ({ action: 'sharedAction' }));
  return {
    Platform: { OS: 'ios' },
    Share: { share },
    // Test-only back-door; jest.mock factories hoist above outer bindings.
    __shareMock: share,
  };
});

import * as RNFS from '@dr.pogodin/react-native-fs';
import * as RN from 'react-native';

import { createNativeStorageAdapter, primaryPath } from './adapter.native';

type FsMock = typeof RNFS & {
  __resetMemoryFs: () => void;
  __getFiles: () => Map<string, string>;
  __setNextPickPaths: (paths: string[]) => void;
  TemporaryDirectoryPath: string;
};

type RnMock = typeof RN & {
  Platform: { OS: string };
  __shareMock: jest.Mock;
};

const fs = RNFS as FsMock;
const rn = RN as RnMock;
const mockShare = rn.__shareMock;

beforeEach(() => {
  fs.__resetMemoryFs();
  mockShare.mockClear();
  rn.Platform.OS = 'ios';
});

describe('native exportDocument (P5.8)', () => {
  test('iOS shares a file:// URL to a temp .calcmind.json copy', async () => {
    const adapter = createNativeStorageAdapter();
    const json = JSON.stringify({
      id: 'doc_1',
      name: 'Patio',
      schemaVersion: 1,
    });
    await adapter.write('doc_1', json);

    await adapter.exportDocument!('doc_1');

    expect(mockShare).toHaveBeenCalledTimes(1);
    const call = mockShare.mock.calls[0] as unknown as [
      { url: string; title: string },
      { subject: string },
    ];
    expect(call[0]).toMatchObject({
      url: `file://${fs.TemporaryDirectoryPath}/Patio.calcmind.json`,
      title: 'Patio.calcmind.json',
    });
    expect(call[1]).toMatchObject({ subject: 'Patio.calcmind.json' });
    // Temp file cleaned up after the share sheet resolves.
    expect(
      fs.__getFiles().has(`${fs.TemporaryDirectoryPath}/Patio.calcmind.json`),
    ).toBe(false);
    // Primary untouched.
    expect(fs.__getFiles().get(primaryPath('doc_1'))).toBe(json);
  });

  test('Android shares JSON as message (RN Share has no file URL there)', async () => {
    rn.Platform.OS = 'android';
    const adapter = createNativeStorageAdapter();
    const json = '{"id":"doc_1","name":"X"}';
    await adapter.write('doc_1', json);

    await adapter.exportDocument!('doc_1');

    expect(mockShare).toHaveBeenCalledWith(
      { message: json, title: 'X.calcmind.json' },
      { dialogTitle: 'X.calcmind.json' },
    );
  });
});

describe('native importDocument (P5.8)', () => {
  test('reads the picked file and returns raw text without validating', async () => {
    const adapter = createNativeStorageAdapter();
    const raw = '{"schemaVersion":99,"trusted":false}';
    const pickPath = `${fs.TemporaryDirectoryPath}/incoming.json`;
    await fs.writeFile(pickPath, raw, 'utf8');
    fs.__setNextPickPaths([pickPath]);

    await expect(adapter.importDocument!()).resolves.toBe(raw);
  });

  test('returns null when the picker yields no paths', async () => {
    const adapter = createNativeStorageAdapter();
    fs.__setNextPickPaths([]);
    await expect(adapter.importDocument!()).resolves.toBeNull();
  });
});
