// Wire autosave to the document store and platform storage adapter (§12.3).
// Lives in app/ so persistence stays free of store imports (§5 dependency rule).
import { storageAdapter } from '../persistence/adapter';
import {
  createAutosave,
  type AutosaveController,
} from '../persistence/autosave';
import {
  setAutosaveSuppressHandler,
  setDocumentDirtyHandler,
  useDocumentStore,
} from '../store/documentStore';

let controller: AutosaveController | null = null;
let detachLifecycle: (() => void) | null = null;

/** Active autosave controller, if started. Used by load / document-switch (P5.5). */
export function getAutosaveController(): AutosaveController | null {
  return controller;
}

/**
 * Start debounced autosave + lifecycle force-flush listeners.
 * Returns a dispose function for unmount / tests.
 */
export function startAutosave(): () => void {
  stopAutosave();

  const next = createAutosave({
    getDocument: () => useDocumentStore.getState().document,
    write: (id, json) => storageAdapter.write(id, json),
    onSaved: savedAt => useDocumentStore.getState().setLastSavedAt(savedAt),
  });

  setDocumentDirtyHandler(() => next.markDirty());
  setAutosaveSuppressHandler(suppressed => next.setSuppressed(suppressed));
  detachLifecycle = next.attachLifecycleListeners();
  controller = next;

  return stopAutosave;
}

export function stopAutosave(): void {
  detachLifecycle?.();
  detachLifecycle = null;
  setDocumentDirtyHandler(null);
  setAutosaveSuppressHandler(null);
  controller?.dispose();
  controller = null;
}
