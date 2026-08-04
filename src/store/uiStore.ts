// Ephemeral UI state: never persisted, never undoable. Kept in its own store rather
// than on `documentStore`'s `document` (which IS persisted) or routed through
// `applyCommand` (which IS undoable) — see docs/ARCHITECTURE.md §8.5, whose last
// bullet requires keypad visibility to sit outside undo history.
import { create } from 'zustand';
import { NodeId, Vec2 } from '../model/types';
import type { SnapOutcome } from '../chains/snapping';

/** Discriminated union for the two menu variants (§8.6). */
export type ContextMenu =
  | { kind: 'node'; nodeId: NodeId; anchor: Vec2 }
  | { kind: 'canvas'; anchor: Vec2 };

/** Live drag feedback for P3.5 / P3.6. Ephemeral: recomputed every frame from shared
 *  values, never written into the document or undo history (§11.4, §13). */
export interface DragSnapState {
  nodeId: NodeId;
  /** World-space top-left of the dragged node this frame. */
  position: Vec2;
  /** Nearest §8.3 candidate, or null when nothing is in range. P3.6 reads this for the caret. */
  candidate: SnapOutcome | null;
}

export interface UiState {
  keypadVisible: boolean;
  toggleKeypad: () => void;
  showKeypad: () => void;
  hideKeypad: () => void;

  /** Where a key that creates a node (§8.5: "otherwise creates a new node at the
   *  caret/last-tap point") should place it, when there's no selection to act on
   *  instead. Updated on every canvas tap; an on-screen or hardware key press never
   *  moves it. Ephemeral - it is not part of the document and never undoable. */
  lastInteractionPoint: Vec2;
  setLastInteractionPoint: (point: Vec2) => void;

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

  /** The open context menu, if any (§8.6, P2.9). Ephemeral — a menu is a momentary
   *  prompt, not a document change. `anchor` is in screen coordinates so the overlay
   *  can position itself without needing the viewport transform. */
  contextMenu: ContextMenu | null;
  openContextMenu: (menu: ContextMenu) => void;
  closeContextMenu: () => void;

  /** Nodes selected as a group (§8.6 `Select group`, P2.9). A group is the whole
   *  chain that contains the long-pressed node. Ephemeral: moving and deleting a
   *  group are the operations it enables (P3.7); the set itself is not a document edit. */
  groupSelectedIds: ReadonlySet<NodeId>;
  setGroupSelected: (ids: ReadonlySet<NodeId>) => void;
  clearGroupSelected: () => void;

  /** In-progress node drag (§8.2, P3.5). Null when idle. Updated every drag frame for
   *  the insertion caret (P3.6); cleared on release before any document commit. */
  dragSnap: DragSnapState | null;
  setDragSnap: (state: DragSnapState | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  keypadVisible: true,
  toggleKeypad: () => set((state) => ({ keypadVisible: !state.keypadVisible })),
  showKeypad: () => set({ keypadVisible: true }),
  hideKeypad: () => set({ keypadVisible: false }),

  lastInteractionPoint: { x: 0, y: 0 },
  setLastInteractionPoint: (point) => set({ lastInteractionPoint: point }),

  clearConfirmVisible: false,
  requestClearConfirm: () => set({ clearConfirmVisible: true }),
  dismissClearConfirm: () => set({ clearConfirmVisible: false }),

  selectedNodeId: null,
  editingNodeId: null,
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setEditingNode: (id) => set({ editingNodeId: id }),

  contextMenu: null,
  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),

  groupSelectedIds: new Set(),
  setGroupSelected: (ids) => set({ groupSelectedIds: ids }),
  clearGroupSelected: () => set({ groupSelectedIds: new Set() }),

  dragSnap: null,
  setDragSnap: (dragSnap) => set({ dragSnap }),
}));
