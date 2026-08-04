import { setDocumentDirtyHandler, useDocumentStore } from './documentStore';
import { renameDocument } from './commands';
import { createEmptyDocument } from '../model/factories';
import { ZOOM_MIN, ZOOM_MAX } from '../model/types';

function resetStore() {
  setDocumentDirtyHandler(null);
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
    lastSavedAt: null,
  });
}

beforeEach(resetStore);

describe('applyCommand', () => {
  test('mutates the document and records one undo entry', () => {
    renameDocument('Trip budget');
    expect(useDocumentStore.getState().document.name).toBe('Trip budget');
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('a no-op recipe records no history', () => {
    const before = useDocumentStore.getState().document.name;
    useDocumentStore.getState().applyCommand((draft) => {
      draft.name = before; // same value, produces no patches
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });

  test('undo reverts, redo reapplies', () => {
    renameDocument('First');
    renameDocument('Second');
    expect(useDocumentStore.getState().document.name).toBe('Second');

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.name).toBe('First');

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.name).toBe('Untitled');
    expect(useDocumentStore.getState().canUndo()).toBe(false);

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.name).toBe('First');
  });

  test('a new command clears the redo stack', () => {
    renameDocument('First');
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().canRedo()).toBe(true);

    renameDocument('Branched');
    expect(useDocumentStore.getState().canRedo()).toBe(false);
  });
});

describe('setViewport', () => {
  test('updates pan without touching undo history', () => {
    useDocumentStore.getState().setViewport({ pan: { x: 10, y: -20 } });
    expect(useDocumentStore.getState().document.viewport.pan).toEqual({ x: 10, y: -20 });
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });

  test('clamps zoom to [ZOOM_MIN, ZOOM_MAX]', () => {
    useDocumentStore.getState().setViewport({ zoom: 100 });
    expect(useDocumentStore.getState().document.viewport.zoom).toBe(ZOOM_MAX);

    useDocumentStore.getState().setViewport({ zoom: 0.001 });
    expect(useDocumentStore.getState().document.viewport.zoom).toBe(ZOOM_MIN);
  });
});

describe('applyCommand recomputeSeeds (P4.8)', () => {
  test('throws when recomputeSeeds is set without a locale', () => {
    expect(() =>
      useDocumentStore.getState().applyCommand((draft) => {
        draft.name = 'x';
      }, { recomputeSeeds: ['c1'] }),
    ).toThrow(/locale is required/);
  });
});

describe('persistence dirty signalling (P5.6)', () => {
  test('applyCommand, undo, and redo notify the dirty handler', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);

    renameDocument('One');
    expect(dirty).toHaveBeenCalledTimes(1);

    useDocumentStore.getState().undo();
    expect(dirty).toHaveBeenCalledTimes(2);

    useDocumentStore.getState().redo();
    expect(dirty).toHaveBeenCalledTimes(3);
  });

  test('a no-op recipe does not notify dirty', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);
    const before = useDocumentStore.getState().document.name;
    useDocumentStore.getState().applyCommand(draft => {
      draft.name = before;
    });
    expect(dirty).not.toHaveBeenCalled();
  });

  test('setViewport notifies dirty when the camera actually moves', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);
    useDocumentStore.getState().setViewport({ pan: { x: 1, y: 2 } });
    expect(dirty).toHaveBeenCalledTimes(1);
    useDocumentStore.getState().setViewport({ pan: { x: 1, y: 2 } });
    expect(dirty).toHaveBeenCalledTimes(1);
  });

  test('setLastSavedAt is surfaced on the store', () => {
    useDocumentStore.getState().setLastSavedAt('2026-08-04T12:00:00.000Z');
    expect(useDocumentStore.getState().lastSavedAt).toBe('2026-08-04T12:00:00.000Z');
  });

  test('replaceDocument clears history and lastSavedAt without notifying dirty', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);
    renameDocument('Before');
    useDocumentStore.getState().setLastSavedAt('2026-08-04T12:00:00.000Z');
    dirty.mockClear();

    const next = createEmptyDocument('Loaded');
    useDocumentStore.getState().replaceDocument(next);
    expect(useDocumentStore.getState().document.name).toBe('Loaded');
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
    expect(useDocumentStore.getState().lastSavedAt).toBeNull();
    expect(dirty).not.toHaveBeenCalled();
  });
});
