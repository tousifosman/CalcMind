jest.mock('@dr.pogodin/react-native-fs');

import * as RNFS from '@dr.pogodin/react-native-fs';
import { preferencesAdapter, preferencesPath } from './preferences.native';

type FsMock = typeof RNFS & {
  __resetMemoryFs: () => void;
  __getFiles: () => Map<string, string>;
};

const fs = RNFS as FsMock;

beforeEach(() => {
  fs.__resetMemoryFs();
});

describe('native PreferencesAdapter', () => {
  test('read() resolves to {} when nothing has been saved yet', async () => {
    expect(await preferencesAdapter.read()).toEqual({});
  });

  test('write() then read() round-trips', async () => {
    await preferencesAdapter.write({ numeralFontSize: 26 });
    expect(await preferencesAdapter.read()).toEqual({ numeralFontSize: 26 });
  });

  test('lives at DocumentDirectoryPath/calcmind-preferences.json, a sibling of the documents dir', () => {
    expect(preferencesPath()).toBe(`${fs.DocumentDirectoryPath}/calcmind-preferences.json`);
  });

  test('a later write() overwrites, not merges with, the earlier one', async () => {
    await preferencesAdapter.write({ numeralFontSize: 26 });
    await preferencesAdapter.write({ numeralFontSize: 18 });
    expect(await preferencesAdapter.read()).toEqual({ numeralFontSize: 18 });
  });

  test('a corrupt file is swallowed to {} rather than thrown (§: settings, not user data)', async () => {
    await fs.writeFile(preferencesPath(), 'not json', 'utf8');
    expect(await preferencesAdapter.read()).toEqual({});
  });
});
