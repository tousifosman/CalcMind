// Document store. See docs/ARCHITECTURE.md §5 (architecture), §7 (viewport is
// excluded from undo history), §13 (undo/redo via immer patches).
//
// Dirty-set recompute (P4.8 / P6.2, §11 / §11.4) runs inside the same `produceWithPatches`
// turn as the mutation when `recomputeSeeds` is passed — so undo restores both the
// edit and the cascaded results in one entry, and no committed frame shows a
// stale-but-undimmed result. The dirty set (seed ∪ transitive dependents) lives in
// `engine/graph.ts`'s `dirtyClosure`; this store API stayed stable through P6.2.
//
// Persistence dirty signalling (P5.6, §12.3): mutations notify an optional listener
// rather than importing autosave — §5 forbids store → persistence. The app shell
// wires the listener to the autosave controller. Undo/redo notify too so autosave
// and undo stay independent (§13).
import { create } from 'zustand';
import { produceWithPatches, applyPatches, enablePatches, type Patch } from 'immer';
import { CalcDocument, ChainId, Vec2, ZOOM_MIN, ZOOM_MAX } from '../model/types';
import { createEmptyDocument } from '../model/factories';
import { recomputeFromSeeds } from '../engine/graph';

enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

const MAX_HISTORY = 100;

/** Optional dirty-set recompute for the same undo entry as the recipe (§11). */
export interface ApplyCommandOptions {
  /** Chains whose mutation should seed `dirtyClosure`. Untouched chains stay out. */
  recomputeSeeds?: readonly ChainId[];
  /** Required when `recomputeSeeds` is non-empty — display formatting is locale-sensitive. */
  locale?: string;
}

type DirtyHandler = () => void;
type SuppressHandler = (suppressed: boolean) => void;

let dirtyHandler: DirtyHandler | null = null;
let autosaveSuppressHandler: SuppressHandler | null = null;

/**
 * Register the persistence dirty listener (autosave). Pass `null` to detach.
 * Lives outside the zustand state so wiring it does not re-render subscribers.
 */
export function setDocumentDirtyHandler(handler: DirtyHandler | null): void {
  dirtyHandler = handler;
}

/**
 * Register the autosave suppress hook (§8.8 / P6b.4). The value-slider scrub
 * gesture calls {@link setAutosaveSuppressed} so one drag does not enqueue a
 * write per frame; force-flush still writes while suppressed.
 */
export function setAutosaveSuppressHandler(handler: SuppressHandler | null): void {
  autosaveSuppressHandler = handler;
}

/** Toggle autosave debounce suppress. No-op until {@link setAutosaveSuppressHandler} is wired. */
export function setAutosaveSuppressed(suppressed: boolean): void {
  autosaveSuppressHandler?.(suppressed);
}

function notifyDocumentDirty(): void {
  dirtyHandler?.();
}

export interface DocumentState {
  document: CalcDocument;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** ISO timestamp of the last successful autosave write; null until one lands. */
  lastSavedAt: string | null;

  /** Apply a mutating recipe to the document as a single undoable command.
   *  This is the only way command implementations (store/commands.ts) should
   *  touch `document` — it's what keeps undo/redo correct as the command set grows.
   *  Pass `recomputeSeeds` to mark→recompute the dirty closure in this same turn (P4.8). */
  applyCommand: (recipe: (draft: CalcDocument) => void, options?: ApplyCommandOptions) => void;

  /** Set pan/zoom directly, bypassing undo history (§7: undoing a calculation
   *  should not also move the camera). Zoom is clamped to [ZOOM_MIN, ZOOM_MAX]. */
  setViewport: (partial: Partial<{ pan: Vec2; zoom: number }>) => void;

  /** Surfaced by autosave after a successful write (§12.3). */
  setLastSavedAt: (savedAt: string | null) => void;

  /**
   * Replace the in-memory document without marking dirty (load / new-document).
   * Caller must `prepareDocumentSwitch` on autosave first so the previous doc is flushed.
   */
  replaceDocument: (document: CalcDocument) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  document: createEmptyDocument(),
  undoStack: [],
  redoStack: [],
  lastSavedAt: null,

  applyCommand: (recipe, options) => {
    const { document } = get();
    const seeds = options?.recomputeSeeds;
    const locale = options?.locale;
    const [nextDocument, patches, inversePatches] = produceWithPatches(document, (draft) => {
      recipe(draft);
      if (seeds !== undefined && seeds.length > 0) {
        if (locale === undefined) {
          throw new Error('applyCommand: locale is required when recomputeSeeds is set');
        }
        recomputeFromSeeds(draft, seeds, locale);
      }
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
    notifyDocumentDirty();
  },

  setViewport: (partial) => {
    const { document } = get();
    const nextZoom =
      partial.zoom === undefined
        ? document.viewport.zoom
        : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, partial.zoom));
    const nextPan = partial.pan ?? document.viewport.pan;
    if (
      nextPan.x === document.viewport.pan.x &&
      nextPan.y === document.viewport.pan.y &&
      nextZoom === document.viewport.zoom
    ) {
      return;
    }
    set({
      document: {
        ...document,
        viewport: { pan: nextPan, zoom: nextZoom },
      },
    });
    // Viewport is persisted with the document (§12.1) even though it is outside
    // undo (§7) — a reopen should restore the camera.
    notifyDocumentDirty();
  },

  setLastSavedAt: (savedAt) => {
    set({ lastSavedAt: savedAt });
  },

  replaceDocument: (document) => {
    set({
      document,
      undoStack: [],
      redoStack: [],
      lastSavedAt: null,
    });
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
    notifyDocumentDirty();
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
    notifyDocumentDirty();
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
