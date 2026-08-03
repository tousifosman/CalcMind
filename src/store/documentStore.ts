// Document store. See docs/ARCHITECTURE.md §5 (architecture), §7 (viewport is
// excluded from undo history), §13 (undo/redo via immer patches).
import { create } from 'zustand';
import { produceWithPatches, applyPatches, enablePatches, type Patch } from 'immer';
import { CalcDocument, Vec2, ZOOM_MIN, ZOOM_MAX } from '../model/types';
import { createEmptyDocument } from '../model/factories';

enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

const MAX_HISTORY = 100;

export interface DocumentState {
  document: CalcDocument;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  /** Apply a mutating recipe to the document as a single undoable command.
   *  This is the only way command implementations (store/commands.ts) should
   *  touch `document` — it's what keeps undo/redo correct as the command set grows. */
  applyCommand: (recipe: (draft: CalcDocument) => void) => void;

  /** Set pan/zoom directly, bypassing undo history (§7: undoing a calculation
   *  should not also move the camera). Zoom is clamped to [ZOOM_MIN, ZOOM_MAX]. */
  setViewport: (partial: Partial<{ pan: Vec2; zoom: number }>) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  document: createEmptyDocument(),
  undoStack: [],
  redoStack: [],

  applyCommand: (recipe) => {
    const { document } = get();
    const [nextDocument, patches, inversePatches] = produceWithPatches(document, (draft) => {
      recipe(draft);
      draft.updatedAt = new Date().toISOString();
    });

    // A no-op recipe still produces an `updatedAt` patch (it's stamped
    // unconditionally above) - ignore that one when deciding whether the
    // recipe actually changed anything, so it stays a true no-op detector
    // rather than one that depends on two Date.now() calls landing in the
    // same millisecond.
    const meaningfulPatches = patches.filter(
      (patch) => !(patch.path.length === 1 && patch.path[0] === 'updatedAt'),
    );
    if (meaningfulPatches.length === 0) return; // no-op recipe, nothing to record

    set((state) => ({
      document: nextDocument,
      undoStack: [...state.undoStack, { patches, inversePatches }].slice(-MAX_HISTORY),
      redoStack: [],
    }));
  },

  setViewport: (partial) => {
    set((state) => ({
      document: {
        ...state.document,
        viewport: {
          pan: partial.pan ?? state.document.viewport.pan,
          zoom:
            partial.zoom === undefined
              ? state.document.viewport.zoom
              : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, partial.zoom)),
        },
      },
    }));
  },

  undo: () => {
    const { undoStack, document } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    set((state) => ({
      document: applyPatches(document, entry.inversePatches),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, entry],
    }));
  },

  redo: () => {
    const { redoStack, document } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    set((state) => ({
      document: applyPatches(document, entry.patches),
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, entry],
    }));
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
