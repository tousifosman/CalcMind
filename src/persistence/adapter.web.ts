// Web StorageAdapter. See docs/ARCHITECTURE.md §12.2, §12.3.
//
// Documents live in IndexedDB via idb-keyval (DB `calcmind`, store `documents`).
// Keys are document ids; values are the §12.1 JSON strings. IndexedDB transactions
// give write atomicity for free — no `.tmp` / `.bak` siblings on this platform.
//
// Export / import (P5.8): Blob download; file picker with File System Access API
// where available, otherwise `<input type="file">`. `importDocument` returns the
// raw JSON string only — callers must run the P5.5 load/validation pipeline; an
// exported file is still untrusted on the way back in.
//
// Browser APIs are reached through a local `BrowserGlobals` cast rather than
// adding `"dom"` to the shared RN tsconfig (which would collide with RN's own
// `Blob` / ambient types). This file is only loaded by webpack via `.web.ts`.
import { createStore, del, get, keys, set } from 'idb-keyval';

import type { DocumentMeta, StorageAdapter } from './adapter';
import { assertSafeDocumentId, isSafeDocumentId } from './documentId';

export type { DocumentMeta, StorageAdapter };
export { assertSafeDocumentId, isSafeDocumentId } from './documentId';

/** Injectable key/value surface so tests can run without IndexedDB. */
export type DocumentKeyVal = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

/** Injectable browser I/O for export/import (P5.8). */
export type WebTransferIo = {
  /** Trigger a file download of `json` under `filename`. */
  downloadJson(filename: string, json: string): void | Promise<void>;
  /** Open a file picker; resolve raw text, or `null` if the user cancels. */
  pickJsonText(): Promise<string | null>;
};

type FileLike = { text(): Promise<string> };

type AnchorLike = {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
};

type InputLike = {
  type: string;
  accept: string;
  style: { display: string };
  files: FileLike[] | null;
  click(): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
};

type BrowserGlobals = {
  document: {
    createElement(tag: 'a'): AnchorLike;
    createElement(tag: 'input'): InputLike;
    createElement(tag: string): AnchorLike | InputLike;
    body: { appendChild(node: AnchorLike | InputLike): void };
  };
  Blob: new (parts: string[], opts?: { type?: string }) => unknown;
  URL: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  TextEncoder: new () => { encode(text: string): { length: number } };
  setTimeout(handler: () => void, ms?: number): unknown;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<Array<{ getFile: () => Promise<FileLike> }>>;
};

function browser(): BrowserGlobals {
  return globalThis as unknown as BrowserGlobals;
}

const IDB_NAME = 'calcmind';
const IDB_STORE = 'documents';

function createIdbKeyVal(): DocumentKeyVal {
  const store = createStore(IDB_NAME, IDB_STORE);
  return {
    get: key => get<string>(key, store),
    set: (key, value) => set(key, value, store),
    del: key => del(key, store),
    keys: async () => (await keys(store)).map(k => String(k)),
  };
}

/** In-memory DocumentKeyVal for contract tests (no IndexedDB in Jest). */
export function createMemoryDocumentKeyVal(
  seed?: Iterable<[string, string]>,
): DocumentKeyVal {
  const map = new Map<string, string>(seed);
  return {
    get: async key => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    del: async key => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
}

function utf8ByteLength(text: string): number {
  return new (browser().TextEncoder)().encode(text).length;
}

function filenameForExport(id: string, json: string): string {
  let base = id;
  try {
    const parsed = JSON.parse(json) as { name?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      base = parsed.name
        .trim()
        .replace(/[^\w\- ]+/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 80);
    }
  } catch {
    // Keep id — export must still work for corrupt-but-readable primaries.
  }
  return `${base}.calcmind.json`;
}

/** Default Blob download via a temporary `<a download>`. */
export function downloadJsonViaAnchor(filename: string, json: string): void {
  const g = browser();
  const blob = new g.Blob([json], { type: 'application/json' });
  const url = g.URL.createObjectURL(blob);
  const anchor = g.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  g.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on next tick so the click navigation can start.
  g.setTimeout(() => g.URL.revokeObjectURL(url), 0);
}

/**
 * Prefer the File System Access API; fall back to `<input type="file">`.
 * Cancel → `null`. Does not parse or validate — P5.5 owns the trust boundary.
 */
export async function pickJsonTextViaBrowser(): Promise<string | null> {
  const g = browser();
  if (typeof g.showOpenFilePicker === 'function') {
    try {
      const handles = await g.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'CalcMind document',
            accept: {
              'application/json': ['.json', '.calcmind.json'],
            },
          },
        ],
      });
      const handle = handles[0];
      if (!handle) {
        return null;
      }
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      // User dismiss / abort — not an error for the adapter.
      if (
        err !== null &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'AbortError'
      ) {
        return null;
      }
      throw err;
    }
  }

  return new Promise(resolve => {
    const input = g.document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.calcmind.json,application/json';
    input.style.display = 'none';
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve, () => resolve(null));
    });
    // Best-effort cancel: if focus returns with no change, treat as cancel.
    // Some browsers never fire this; callers already accept `null`.
    const onFocus = () => {
      g.setTimeout(() => {
        if (!input.files?.length) {
          cleanup();
          g.removeEventListener('focus', onFocus);
          resolve(null);
        }
      }, 300);
    };
    g.addEventListener('focus', onFocus);
    g.document.body.appendChild(input);
    input.click();
  });
}

function metaFromJson(id: string, json: string): DocumentMeta {
  let name = id;
  let updatedAt = '';
  try {
    const parsed = JSON.parse(json) as { name?: unknown; updatedAt?: unknown };
    if (typeof parsed.name === 'string') {
      name = parsed.name;
    }
    if (typeof parsed.updatedAt === 'string') {
      updatedAt = parsed.updatedAt;
    }
  } catch {
    // Still list the id so a corrupt primary remains discoverable (P5.5).
  }
  return { id, name, updatedAt, bytes: utf8ByteLength(json) };
}

export type WebAdapterDeps = {
  kv?: DocumentKeyVal;
  transfer?: WebTransferIo;
};

export function createWebStorageAdapter(
  deps: WebAdapterDeps = {},
): StorageAdapter {
  const kv = deps.kv ?? createIdbKeyVal();
  const transfer: WebTransferIo = deps.transfer ?? {
    downloadJson: downloadJsonViaAnchor,
    pickJsonText: pickJsonTextViaBrowser,
  };

  async function list(): Promise<DocumentMeta[]> {
    const allKeys = await kv.keys();
    const metas: DocumentMeta[] = [];
    for (const id of allKeys) {
      if (!isSafeDocumentId(id)) {
        continue;
      }
      const json = await kv.get(id);
      if (json === undefined) {
        continue;
      }
      metas.push(metaFromJson(id, json));
    }
    metas.sort((a, b) => a.id.localeCompare(b.id));
    return metas;
  }

  async function read(id: string): Promise<string> {
    assertSafeDocumentId(id);
    const json = await kv.get(id);
    if (json === undefined) {
      throw new Error(`persistence: document not found: ${id}`);
    }
    return json;
  }

  async function write(id: string, json: string): Promise<void> {
    assertSafeDocumentId(id);
    // Single IndexedDB put — transactional, so crash mid-write cannot leave a
    // truncated primary (§12.3).
    await kv.set(id, json);
  }

  async function remove(id: string): Promise<void> {
    assertSafeDocumentId(id);
    await kv.del(id);
  }

  async function exportDocument(id: string): Promise<void> {
    const json = await read(id);
    await transfer.downloadJson(filenameForExport(id, json), json);
  }

  async function importDocument(): Promise<string | null> {
    // Raw string only — P5.5 load pipeline validates; do not shortcut here.
    return transfer.pickJsonText();
  }

  return {
    list,
    read,
    write,
    remove,
    exportDocument,
    importDocument,
  };
}

/** Default web adapter instance (platform resolution of `./adapter`). */
export const storageAdapter: StorageAdapter = createWebStorageAdapter();
