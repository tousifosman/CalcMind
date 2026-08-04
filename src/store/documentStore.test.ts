import { useDocumentStore } from './documentStore';
import { renameDocument } from './commands';
import { createEmptyDocument } from '../model/factories';
import { ZOOM_MIN, ZOOM_MAX } from '../model/types';

function resetStore() {
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
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
