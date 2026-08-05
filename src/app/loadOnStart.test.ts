// Regression coverage for the app-launch load wiring (§12.3, P5.5). Caught live, not by any
// test: without this module, `AppShell` never called `openDocument`, so a reload silently
// discarded every autosaved document even though the file was sitting right there in storage.
import type { StorageAdapter, DocumentMeta } from '../persistence/adapter';
import { serializeDocument } from '../persistence/serialize';
import { createEmptyDocument, createNumberNode } from '../model/factories';
import { useDocumentStore } from '../store/documentStore';

const mockStorageAdapter: StorageAdapter = {
  list: jest.fn(async (): Promise<DocumentMeta[]> => []),
  read: jest.fn(async () => {
    throw new Error('ENOENT');
  }),
  write: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
};

jest.mock('../persistence/adapter', () => ({
  get storageAdapter() {
    return mockStorageAdapter;
  },
}));

import { loadMostRecentDocument } from './loadOnStart';

function docWithOneNumber(name: string, updatedAt: string) {
  const doc = createEmptyDocument(name);
  const number = createNumberNode({ x: 0, y: 0 }, '7');
  doc.nodes[number.id] = number;
  doc.updatedAt = updatedAt;
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
    lastSavedAt: null,
  });
});

describe('loadMostRecentDocument', () => {
  test('no saved documents: leaves the fresh empty document alone', async () => {
    (mockStorageAdapter.list as jest.Mock).mockResolvedValueOnce([]);
    const before = useDocumentStore.getState().document;

    await loadMostRecentDocument();

    expect(useDocumentStore.getState().document).toBe(before);
  });

  test('one saved document: replaces the store with it', async () => {
    const saved = docWithOneNumber('Saved doc', '2026-08-04T12:00:00.000Z');
    const json = serializeDocument(saved);
    (mockStorageAdapter.list as jest.Mock).mockResolvedValueOnce([
      { id: saved.id, name: saved.name, updatedAt: saved.updatedAt, bytes: json.length },
    ]);
    (mockStorageAdapter.read as jest.Mock).mockImplementation(async (id: string) => {
      if (id === saved.id) return json;
      throw new Error('ENOENT');
    });

    await loadMostRecentDocument();

    const doc = useDocumentStore.getState().document;
    expect(doc.id).toBe(saved.id);
    expect(Object.values(doc.nodes).some((n) => n.kind === 'number' && n.raw === '7')).toBe(
      true,
    );
  });

  test('picks the most recently updated document when several exist', async () => {
    const older = docWithOneNumber('Older', '2026-08-01T00:00:00.000Z');
    const newer = docWithOneNumber('Newer', '2026-08-04T00:00:00.000Z');
    const olderJson = serializeDocument(older);
    const newerJson = serializeDocument(newer);
    (mockStorageAdapter.list as jest.Mock).mockResolvedValueOnce([
      { id: older.id, name: older.name, updatedAt: older.updatedAt, bytes: olderJson.length },
      { id: newer.id, name: newer.name, updatedAt: newer.updatedAt, bytes: newerJson.length },
    ]);
    (mockStorageAdapter.read as jest.Mock).mockImplementation(async (id: string) => {
      if (id === older.id) return olderJson;
      if (id === newer.id) return newerJson;
      throw new Error('ENOENT');
    });

    await loadMostRecentDocument();

    expect(useDocumentStore.getState().document.id).toBe(newer.id);
  });

  test('a load failure (corrupt file) leaves the fresh empty document alone, not a crash', async () => {
    (mockStorageAdapter.list as jest.Mock).mockResolvedValueOnce([
      { id: 'doc_bad', name: 'Bad', updatedAt: '2026-08-04T00:00:00.000Z', bytes: 3 },
    ]);
    (mockStorageAdapter.read as jest.Mock).mockResolvedValueOnce('not json');
    const before = useDocumentStore.getState().document;

    await expect(loadMostRecentDocument()).resolves.toBeUndefined();

    expect(useDocumentStore.getState().document).toBe(before);
  });

  test('replacing resets undo/redo history and lastSavedAt', async () => {
    const saved = docWithOneNumber('Saved doc', '2026-08-04T12:00:00.000Z');
    const json = serializeDocument(saved);
    (mockStorageAdapter.list as jest.Mock).mockResolvedValueOnce([
      { id: saved.id, name: saved.name, updatedAt: saved.updatedAt, bytes: json.length },
    ]);
    (mockStorageAdapter.read as jest.Mock).mockResolvedValueOnce(json);
    useDocumentStore.setState({
      undoStack: [{ patches: [], inversePatches: [] }],
      redoStack: [{ patches: [], inversePatches: [] }],
      lastSavedAt: '2020-01-01T00:00:00.000Z',
    });

    await loadMostRecentDocument();

    expect(useDocumentStore.getState().undoStack).toEqual([]);
    expect(useDocumentStore.getState().redoStack).toEqual([]);
    expect(useDocumentStore.getState().lastSavedAt).toBeNull();
  });
});
