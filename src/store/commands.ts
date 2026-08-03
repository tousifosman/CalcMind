// Commands: the only place application code should mutate the document (via
// documentStore.applyCommand, which makes every mutation here undoable). See
// docs/ARCHITECTURE.md §5 (architecture) and §13 (undo/redo).
//
// Node/chain commands (create, snap, drag, delete...) land in P2/P3 once the
// canvas and engine exist to give them something to act on. This file exists
// now to establish the pattern: a command is a small function that calls
// `useDocumentStore.getState().applyCommand(recipe)`.
import { useDocumentStore } from './documentStore';

export function renameDocument(name: string): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.name = name;
  });
}
