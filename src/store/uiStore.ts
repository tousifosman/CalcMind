// Ephemeral UI state: never persisted, never undoable. Kept in its own store rather
// than on `documentStore`'s `document` (which IS persisted) or routed through
// `applyCommand` (which IS undoable) — see docs/ARCHITECTURE.md §8.5, whose last
// bullet requires keypad visibility to sit outside undo history.
import { create } from 'zustand';
import { NodeId } from '../model/types';

export interface UiState {
  keypadVisible: boolean;
  toggleKeypad: () => void;
  showKeypad: () => void;
  hideKeypad: () => void;

  /** Swipe-across-backspace clear confirmation (§8.5, decision #15). Ephemeral
   *  for the same reason keypad visibility is: it is a prompt about intent, not
   *  a document edit, so it must sit outside undo history. */
  clearConfirmVisible: boolean;
  requestClearConfirm: () => void;
  dismissClearConfirm: () => void;

  /** Which node is selected, and (for a number) which one is showing its in-place text
   *  editor (§8.6, §13, P2.6). Selecting a node isn't a document edit, so - same reasoning
   *  as the two flags above - it sits here, outside undo history, rather than on `document`.
   *  These are bare setters; `store/commands.ts`'s `selectNode`/`editNumberNode`/
   *  `deselectNode` are what callers should use, since they also decide whether an abandoned
   *  empty number node gets discarded (§8.6's "committing an empty raw removes it") - this
   *  store has no document to check that against, deliberately, so it can't. */
  selectedNodeId: NodeId | null;
  editingNodeId: NodeId | null;
  setSelectedNode: (id: NodeId | null) => void;
  setEditingNode: (id: NodeId | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  keypadVisible: true,
  toggleKeypad: () => set((state) => ({ keypadVisible: !state.keypadVisible })),
  showKeypad: () => set({ keypadVisible: true }),
  hideKeypad: () => set({ keypadVisible: false }),

  clearConfirmVisible: false,
  requestClearConfirm: () => set({ clearConfirmVisible: true }),
  dismissClearConfirm: () => set({ clearConfirmVisible: false }),

  selectedNodeId: null,
  editingNodeId: null,
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setEditingNode: (id) => set({ editingNodeId: id }),
}));
