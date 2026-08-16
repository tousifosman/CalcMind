import {
  MAX_HISTORY,
  setDocumentDirtyHandler,
  useDocumentStore,
} from './documentStore';
import { renameDocument } from './commands';
import { createEmptyDocument } from '../model/factories';
import { ZOOM_MIN, ZOOM_MAX } from '../model/types';
import { AUTOSAVE_DEBOUNCE_MS, createAutosave } from '../persistence/autosave';
import { serializeDocument } from '../persistence/serialize';

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

  test('viewport changes stay excluded when undoing later document edits (§7 / P7.1)', () => {
    renameDocument('First');
    useDocumentStore.getState().setViewport({ pan: { x: 40, y: 50 }, zoom: 2 });
    renameDocument('Second');
    useDocumentStore.getState().setViewport({ pan: { x: 1, y: 2 }, zoom: 0.5 });

    expect(useDocumentStore.getState().undoStack).toHaveLength(2);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.name).toBe('First');
    // Camera is whatever the user last set — undo must not rewind it (§7).
    expect(useDocumentStore.getState().document.viewport).toEqual({
      pan: { x: 1, y: 2 },
      zoom: 0.5,
    });

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.name).toBe('Second');
    expect(useDocumentStore.getState().document.viewport).toEqual({
      pan: { x: 1, y: 2 },
      zoom: 0.5,
    });
  });
});

describe('mutateWithoutUndo (§1.2 P7: reflowAllChainsForDisplay\'s primitive)', () => {
  test('mutates the document without touching undo history', () => {
    useDocumentStore.getState().mutateWithoutUndo((draft) => {
      draft.name = 'Renamed without undo';
    });
    expect(useDocumentStore.getState().document.name).toBe('Renamed without undo');
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });

  test('a no-op recipe is a true no-op: no set, no dirty notification', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);
    const before = useDocumentStore.getState().document;

    useDocumentStore.getState().mutateWithoutUndo(() => {
      // touches nothing
    });

    expect(useDocumentStore.getState().document).toBe(before); // same reference back
    expect(dirty).not.toHaveBeenCalled();
  });

  test('notifies dirty (so autosave still picks it up) when something actually changed', () => {
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);
    useDocumentStore.getState().mutateWithoutUndo((draft) => {
      draft.name = 'Dirty via mutateWithoutUndo';
    });
    expect(dirty).toHaveBeenCalledTimes(1);
  });

  test('stays outside undo even sandwiched between real edits (§7 precedent: setViewport)', () => {
    renameDocument('First');
    useDocumentStore.getState().mutateWithoutUndo((draft) => {
      draft.name = 'Reflowed, not a document edit';
    });
    // The reflow-style mutation left no trace on the stack — still exactly the one
    // entry renameDocument('First') pushed.
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);

    useDocumentStore.getState().undo();
    // Reverts renameDocument('First') by its own recorded inverse patch, landing back
    // on the pre-'First' name — not on 'Reflowed, not a document edit', which undo
    // never knew existed.
    expect(useDocumentStore.getState().document.name).toBe('Untitled');

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.name).toBe('First');
  });
});

describe('undo stack bound (P7.1 / §13)', () => {
  test('the stack is capped at MAX_HISTORY and drops the oldest entry', () => {
    for (let i = 0; i < MAX_HISTORY; i++) {
      renameDocument(`name-${i}`);
    }
    expect(useDocumentStore.getState().undoStack).toHaveLength(MAX_HISTORY);
    expect(useDocumentStore.getState().document.name).toBe(`name-${MAX_HISTORY - 1}`);

    renameDocument('overflow');
    expect(useDocumentStore.getState().undoStack).toHaveLength(MAX_HISTORY);
    expect(useDocumentStore.getState().document.name).toBe('overflow');

    // Undoing MAX_HISTORY times walks back through the retained window only —
    // the very first rename was dropped and cannot be restored.
    for (let i = 0; i < MAX_HISTORY; i++) {
      useDocumentStore.getState().undo();
    }
    expect(useDocumentStore.getState().canUndo()).toBe(false);
    expect(useDocumentStore.getState().document.name).toBe('name-0');
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

  test('undo marks dirty and therefore saves through autosave (§13 / P7.1)', async () => {
    jest.useFakeTimers();
    const writes: Array<{ id: string; json: string }> = [];
    const controller = createAutosave({
      getDocument: () => useDocumentStore.getState().document,
      write: async (id, json) => {
        writes.push({ id, json });
      },
      onSaved: savedAt => useDocumentStore.getState().setLastSavedAt(savedAt),
    });
    setDocumentDirtyHandler(() => controller.markDirty());

    try {
      renameDocument('Saved once');
      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
      await controller.flush();
      expect(writes).toHaveLength(1);
      expect(writes[0]!.json).toBe(
        serializeDocument(useDocumentStore.getState().document),
      );

      useDocumentStore.getState().undo();
      expect(useDocumentStore.getState().document.name).toBe('Untitled');

      jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
      await controller.flush();
      expect(writes).toHaveLength(2);
      expect(writes[1]!.json).toBe(
        serializeDocument(useDocumentStore.getState().document),
      );
      expect(JSON.parse(writes[1]!.json).name).toBe('Untitled');
    } finally {
      setDocumentDirtyHandler(null);
      controller.dispose();
      jest.useRealTimers();
    }
  });
});
