// Native PreferencesAdapter. See ./preferences.ts for the contract and why it is
// deliberately simpler than the document StorageAdapter (no atomic write / backup).
//
// Lives at DocumentDirectoryPath/calcmind-preferences.json — a sibling of, not inside,
// the `calcmind` documents directory (adapter.native.ts's `documentsDirectory()`), so
// `readDir(documentsDirectory())` never sees it and it can't be mistaken for a document.
import {
  DocumentDirectoryPath,
  exists,
  readFile,
  writeFile,
} from '@dr.pogodin/react-native-fs';

import type { Preferences, PreferencesAdapter } from './preferences';

export type { Preferences, PreferencesAdapter };

export function preferencesPath(): string {
  return `${DocumentDirectoryPath}/calcmind-preferences.json`;
}

async function read(): Promise<Preferences> {
  const path = preferencesPath();
  if (!(await exists(path))) return {};
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Preferences;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    // Corrupt file: lose the saved preference, not the app - same "swallow and
    // fall back to defaults" contract preferences.ts documents.
    return {};
  }
}

async function write(prefs: Preferences): Promise<void> {
  await writeFile(preferencesPath(), JSON.stringify(prefs), 'utf8');
}

export const preferencesAdapter: PreferencesAdapter = { read, write };
