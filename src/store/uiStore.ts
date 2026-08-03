// Ephemeral UI state: never persisted, never undoable. Kept in its own store rather
// than on `documentStore`'s `document` (which IS persisted) or routed through
// `applyCommand` (which IS undoable) — see docs/ARCHITECTURE.md §8.5, whose last
// bullet requires keypad visibility to sit outside undo history.
import { create } from 'zustand';

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
}

export const useUiStore = create<UiState>((set) => ({
  keypadVisible: true,
  toggleKeypad: () => set((state) => ({ keypadVisible: !state.keypadVisible })),
  showKeypad: () => set({ keypadVisible: true }),
  hideKeypad: () => set({ keypadVisible: false }),

  clearConfirmVisible: false,
  requestClearConfirm: () => set({ clearConfirmVisible: true }),
  dismissClearConfirm: () => set({ clearConfirmVisible: false }),
}));
