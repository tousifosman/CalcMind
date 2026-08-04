// Native StorageAdapter. See docs/ARCHITECTURE.md §12.2, §12.3.
//
// Documents live at DocumentDirectoryPath/calcmind/<id>.calcmind.json.
// Writes are atomic: .tmp → (writeFile completion as flush barrier) → rename
// over target, with the previous good file kept as exactly one .bak generation.
//
// @dr.pogodin/react-native-fs exposes no fsync. writeFile resolves only after
// the native writer closes the handle (Android explicitly notes the stream is
// flushed on close); that completion is the durability barrier before rename.
import {
  DocumentDirectoryPath,
  exists,
  mkdir,
  moveFile,
  readDir,
  readFile,
  stat,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';

import type { DocumentMeta, StorageAdapter } from './adapter';
import { assertSafeDocumentId, isSafeDocumentId } from './documentId';

export type { DocumentMeta, StorageAdapter };
export { assertSafeDocumentId, isSafeDocumentId } from './documentId';

const DOC_EXT = '.calcmind.json';
const TMP_SUFFIX = '.tmp';
const BAK_SUFFIX = '.bak';

/** Root directory for all CalcMind documents on this device. */
export function documentsDirectory(): string {
  return `${DocumentDirectoryPath}/calcmind`;
}

export function primaryPath(id: string): string {
  assertSafeDocumentId(id);
  return `${documentsDirectory()}/${id}${DOC_EXT}`;
}

export function tmpPath(id: string): string {
  return `${primaryPath(id)}${TMP_SUFFIX}`;
}

export function bakPath(id: string): string {
  return `${primaryPath(id)}${BAK_SUFFIX}`;
}

/** Filename → document id, or null if not a primary document file.
 *  `.calcmind.json.tmp` / `.calcmind.json.bak` do not end in `DOC_EXT`, so they
 *  are excluded without a special case. */
export function idFromPrimaryFileName(fileName: string): string | null {
  if (!fileName.endsWith(DOC_EXT)) {
    return null;
  }
  return fileName.slice(0, -DOC_EXT.length);
}

async function ensureDocumentsDir(): Promise<void> {
  await mkdir(documentsDirectory());
}

async function unlinkIfExists(path: string): Promise<void> {
  if (await exists(path)) {
    await unlink(path);
  }
}

/**
 * Atomic write with one-generation backup (§12.3):
 *   1. write payload to `<primary>.tmp`
 *   2. await writeFile (flush barrier — no fsync API on this library)
 *   3. if primary exists, rotate it to `<primary>.bak` (replacing any older .bak)
 *   4. rename `.tmp` over primary
 *
 * Crash window between steps 3 and 4: primary is briefly *absent* (content is
 * already at `.bak`, new bytes at `.tmp`). That is not "old file or new file" —
 * §12.3's load flowchart recovers via `.bak` when the primary can't be read.
 * P5.5 must treat "primary missing" the same as "primary corrupt" for that
 * fallback; `read()` here stays primary-only per the §12.2 interface.
 */
async function atomicWrite(id: string, json: string): Promise<void> {
  await ensureDocumentsDir();
  const primary = primaryPath(id);
  const tmp = tmpPath(id);
  const bak = bakPath(id);

  await writeFile(tmp, json, 'utf8');

  if (await exists(primary)) {
    await unlinkIfExists(bak);
    await moveFile(primary, bak);
  }

  // After a successful rotate, `primary` is already gone; on first write it
  // never existed. moveFile requires a free destination either way.
  await moveFile(tmp, primary);
}

async function listDocuments(): Promise<DocumentMeta[]> {
  await ensureDocumentsDir();
  const entries = await readDir(documentsDirectory());
  const metas: DocumentMeta[] = [];

  // One full read+parse per document for name/updatedAt. Fine at current
  // scale; a metadata index would be the lever if list becomes hot.
  for (const entry of entries) {
    const id = idFromPrimaryFileName(entry.name);
    if (id === null || !isSafeDocumentId(id)) {
      continue;
    }
    const path = primaryPath(id);
    let bytes = typeof entry.size === 'number' ? entry.size : 0;
    let name = id;
    let updatedAt = '';
    try {
      const info = await stat(path);
      bytes = info.size;
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { name?: unknown; updatedAt?: unknown };
      if (typeof parsed.name === 'string') {
        name = parsed.name;
      }
      if (typeof parsed.updatedAt === 'string') {
        updatedAt = parsed.updatedAt;
      }
    } catch {
      // Still list the id so a corrupt primary remains discoverable; load (P5.5)
      // recovers from .bak or reports unreadable without overwriting.
    }
    metas.push({ id, name, updatedAt, bytes });
  }

  metas.sort((a, b) => a.id.localeCompare(b.id));
  return metas;
}

async function readDocument(id: string): Promise<string> {
  return readFile(primaryPath(id), 'utf8');
}

async function readBackupDocument(id: string): Promise<string> {
  return readFile(bakPath(id), 'utf8');
}

async function removeDocument(id: string): Promise<void> {
  await unlinkIfExists(primaryPath(id));
  await unlinkIfExists(bakPath(id));
  await unlinkIfExists(tmpPath(id));
}

export function createNativeStorageAdapter(): StorageAdapter {
  return {
    list: listDocuments,
    read: readDocument,
    write: atomicWrite,
    remove: removeDocument,
    readBackup: readBackupDocument,
  };
}

/** Default native adapter instance (platform resolution of `./adapter`). */
export const storageAdapter: StorageAdapter = createNativeStorageAdapter();
