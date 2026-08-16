// Web PreferencesAdapter. See ./preferences.ts for the contract and why it is
// deliberately simpler than the document StorageAdapter (no atomic write / backup).
//
// Its own IndexedDB database (`calcmind-preferences`), deliberately NOT a second
// object store inside documents' `calcmind` database (adapter.web.ts). Two independent
// `idb-keyval.createStore(sameDbName, differentStoreName)` calls each open that database
// name on their own, uncoordinated — IndexedDB only creates the object stores present in
// whichever `createStore` call happens to run first (its own `upgradeneeded` handler is
// the only place a store gets created), so the other store is silently missing forever
// once that database name exists. Caught live: `usePreferencesStore`'s startup `hydrate()`
// runs before any document loads (AppShell.tsx), so on a fresh profile its `createStore`
// won by opening `calcmind` first and creating only a `preferences` store — every
// subsequent document autosave then threw `NotFoundError: ... object store was not
// found` because `documents` was never created. A separate database sidesteps the
// ordering hazard entirely; each database manages its own single store's lifecycle.
import { createStore, get, set } from 'idb-keyval';

import type { Preferences, PreferencesAdapter } from './preferences';

export type { Preferences, PreferencesAdapter };

const IDB_NAME = 'calcmind-preferences';
const IDB_STORE = 'preferences';
const KEY = 'preferences';

/** Injectable key/value surface so tests can run without IndexedDB — same shape as
 *  adapter.web.ts's `DocumentKeyVal`, narrowed to what a single blob needs. */
export type PreferencesKeyVal = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
};

function createIdbKeyVal(): PreferencesKeyVal {
  const store = createStore(IDB_NAME, IDB_STORE);
  return {
    get: (key) => get<string>(key, store),
    set: (key, value) => set(key, value, store),
  };
}

/** In-memory PreferencesKeyVal for contract tests (no IndexedDB in Jest). */
export function createMemoryPreferencesKeyVal(
  seed?: Iterable<[string, string]>,
): PreferencesKeyVal {
  const map = new Map<string, string>(seed);
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
  };
}

export function createWebPreferencesAdapter(
  kv: PreferencesKeyVal = createIdbKeyVal(),
): PreferencesAdapter {
  async function read(): Promise<Preferences> {
    const raw = await kv.get(KEY);
    if (raw === undefined) return {};
    try {
      const parsed = JSON.parse(raw) as Preferences;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  async function write(prefs: Preferences): Promise<void> {
    await kv.set(KEY, JSON.stringify(prefs));
  }

  return { read, write };
}

/** Default web adapter instance (platform resolution of `./preferences`). */
export const preferencesAdapter: PreferencesAdapter = createWebPreferencesAdapter();
