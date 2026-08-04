// Web StorageAdapter. See docs/ARCHITECTURE.md §12.2, §12.3.
//
// Documents live in IndexedDB via idb-keyval (`calcmind` / `documents`).
// IndexedDB transactions give atomicity for free — no `.tmp` / `.bak` dance
// (and no `readBackup`). Webpack resolves this file through the existing
// `.web.ts` extension order in `webpack.config.js` with no config change (§5.1).
//
// Export = Blob download; import = File System Access API when available,
// otherwise `<input type="file">` (§12.2 / P5.8).
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';

import type { DocumentMeta, StorageAdapter } from './adapter';
import { assertSafeDocumentId, isSafeDocumentId } from './documentId';
import { fileNameForExport } from './transfer';

export type { DocumentMeta, StorageAdapter };
export { assertSafeDocumentId, isSafeDocumentId } from './documentId';

/**
 * Distinctive string so a web bundle that includes this module can be grepped
 * to prove webpack's `.web.ts` resolution. Not a runtime API.
 */
export const WEB_ADAPTER_MODULE = 'calcmind-persistence-adapter-web';

const defaultStore: UseStore = createStore('calcmind', 'documents');

export type WebDownloadFn = (filename: string, json: string) => void;
export type WebPickFileFn = () => Promise<string | null>;

export type WebStorageAdapterOptions = {
  /** Inject a fresh idb-keyval store (tests); production uses the default. */
  store?: UseStore;
  /** Override Blob-download (tests). */
  download?: WebDownloadFn;
  /** Override file picker (tests). */
  pickFile?: WebPickFileFn;
};

function byteLength(json: string): number {
  const g = globalThis as unknown as {
    TextEncoder?: { new (): { encode: (s: string) => { byteLength: number } } };
  };
  if (typeof g.TextEncoder === 'function') {
    return new g.TextEncoder().encode(json).byteLength;
  }
  return json.length;
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
    // Corrupt payload: still list the id so load can report unreadable.
  }
  return { id, name, updatedAt, bytes: byteLength(json) };
}

/** Minimal DOM surface — RN's tsconfig has no `dom` lib; keep web APIs local. */
type WebDocument = {
  createElement(tagName: 'a'): {
    href: string;
    download: string;
    rel: string;
    click(): void;
    remove(): void;
  };
  createElement(tagName: 'input'): {
    type: string;
    accept: string;
    style: { display: string };
    files: Array<{ text: () => Promise<string> }> | null;
    addEventListener(type: 'change' | 'cancel', listener: () => void): void;
    click(): void;
    remove(): void;
  };
  body: { appendChild(node: unknown): void };
};

type WebBlob = { new (parts: string[], options?: { type?: string }): unknown };

type WebUrl = {
  createObjectURL(blob: unknown): string;
  revokeObjectURL(url: string): void;
};

type OpenFilePickerWindow = {
  document: WebDocument;
  Blob: WebBlob;
  URL: WebUrl;
  showOpenFilePicker?: (options?: {
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    multiple?: boolean;
  }) => Promise<Array<{ getFile: () => Promise<{ text: () => Promise<string> }> }>>;
};

function webWindow(): OpenFilePickerWindow {
  return globalThis as unknown as OpenFilePickerWindow;
}

/** Trigger a Blob download via a temporary `<a download>`. */
export function downloadJsonBlob(filename: string, json: string): void {
  const w = webWindow();
  const blob = new w.Blob([json], { type: 'application/json' });
  const url = w.URL.createObjectURL(blob);
  const anchor = w.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  w.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  w.URL.revokeObjectURL(url);
}

/**
 * File System Access API when present; otherwise a hidden `<input type="file">`.
 * Cancel → `null`.
 */
export async function pickJsonFile(): Promise<string | null> {
  const w = webWindow();
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({
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
      const file = await handle.getFile();
      return await file.text();
    } catch (cause) {
      if (
        cause !== null &&
        typeof cause === 'object' &&
        'name' in cause &&
        (cause as { name: string }).name === 'AbortError'
      ) {
        return null;
      }
      throw cause;
    }
  }

  return new Promise((resolve, reject) => {
    const input = w.document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.calcmind.json';
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
      file.text().then(resolve, reject);
    });
    // Chromium fires `cancel` when the dialog is dismissed with no selection.
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    w.document.body.appendChild(input);
    input.click();
  });
}

export function createWebStorageAdapter(
  options: WebStorageAdapterOptions = {},
): StorageAdapter {
  const store = options.store ?? defaultStore;
  const download = options.download ?? downloadJsonBlob;
  const pickFile = options.pickFile ?? pickJsonFile;

  async function listDocuments(): Promise<DocumentMeta[]> {
    const ids = await keys(store);
    const metas: DocumentMeta[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !isSafeDocumentId(id)) {
        continue;
      }
      const json = await get<string>(id, store);
      if (typeof json !== 'string') {
        continue;
      }
      metas.push(metaFromJson(id, json));
    }
    metas.sort((a, b) => a.id.localeCompare(b.id));
    return metas;
  }

  async function readDocument(id: string): Promise<string> {
    assertSafeDocumentId(id);
    const json = await get<string>(id, store);
    if (typeof json !== 'string') {
      throw new Error(`persistence: document not found: ${id}`);
    }
    return json;
  }

  async function writeDocument(id: string, json: string): Promise<void> {
    assertSafeDocumentId(id);
    // Single idb put — the transaction commits or it doesn't (§12.3).
    await set(id, json, store);
  }

  async function removeDocument(id: string): Promise<void> {
    assertSafeDocumentId(id);
    await del(id, store);
  }

  async function exportDocument(id: string): Promise<void> {
    const json = await readDocument(id);
    download(fileNameForExport(json, id), json);
  }

  async function importDocument(): Promise<string | null> {
    return pickFile();
  }

  return {
    list: listDocuments,
    read: readDocument,
    write: writeDocument,
    remove: removeDocument,
    exportDocument,
    importDocument,
  };
}

/** Default web adapter instance (platform resolution of `./adapter`). */
export const storageAdapter: StorageAdapter = createWebStorageAdapter();
