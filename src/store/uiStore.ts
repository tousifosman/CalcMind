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
}

export const useUiStore = create<UiState>((set) => ({
  keypadVisible: true,
  toggleKeypad: () => set((state) => ({ keypadVisible: !state.keypadVisible })),
  showKeypad: () => set({ keypadVisible: true }),
  hideKeypad: () => set({ keypadVisible: false }),
}));
