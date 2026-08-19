// Ephemeral UI state: never persisted, never undoable. Kept in its own store rather
// than on `documentStore`'s `document` (which IS persisted) or routed through
// `applyCommand` (which IS undoable) — see docs/ARCHITECTURE.md §8.5, whose last
// bullet requires keypad visibility to sit outside undo history.
import { create } from 'zustand';
import { ChainId, NodeId, Vec2 } from '../model/types';
import type { SnapOutcome } from '../chains/snapping';

/** Discriminated union for the two menu variants (§8.6). */
export type ContextMenu =
  | { kind: 'node'; nodeId: NodeId; anchor: Vec2 }
  | { kind: 'canvas'; anchor: Vec2 };

/** §8.8 value-slider popover state — see `sliderState` below. */
export interface SliderState {
  nodeId: NodeId;
  pinned: boolean;
  offset: Vec2;
}

/** Live drag feedback for P3.5 / P3.6. Ephemeral: recomputed every frame from shared
 *  values, never written into the document or undo history (§11.4, §13). */
export interface DragSnapState {
  nodeId: NodeId;
  /** World-space top-left of the dragged node this frame. */
  position: Vec2;
  /** Nearest §8.3 candidate, or null when nothing is in range. P3.6 reads this for the caret. */
  candidate: SnapOutcome | null;
  /**
   * P3.7 MovingChain: when set, every member of this chain is visually offset by
   * the same delta as `nodeId`. ConnectorLayer (P6.6) reads this so curves track
   * siblings that only move via Reanimated, not a document write. Null for ordinary
   * detach/free drags where only `nodeId` moves.
   */
  movingChainId: ChainId | null;
  /**
   * §8.6 Select all: when set, every listed chain and free node is offset by the
   * same delta as `nodeId` (connectors + commit). Mutually exclusive with
   * `movingChainId` in practice — single-chain group moves use that field alone.
   */
  movingSelection: {
    chainIds: readonly ChainId[];
    freeNodeIds: readonly NodeId[];
  } | null;
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

  /** Which identity source is showing its in-place label editor (§11.1 / P6b.1).
   *  Always a number or result id — never a reference. Ephemeral for the same
   *  reason as `editingNodeId`. */
  editingLabelNodeId: NodeId | null;
  setEditingLabelNode: (id: NodeId | null) => void;

  /** The open context menu, if any (§8.6, P2.9). Ephemeral — a menu is a momentary
   *  prompt, not a document change. `anchor` is in screen coordinates so the overlay
   *  can position itself without needing the viewport transform. */
  contextMenu: ContextMenu | null;
  openContextMenu: (menu: ContextMenu) => void;
  closeContextMenu: () => void;

  /**
   * Dangling-reference recovery sheet (§11.2 / P6.4). Ephemeral: tapping a dangling
   * cell opens it; the two actions (re-point / convert) are document edits that go
   * through commands, but the prompt itself is not undoable state.
   */
  danglingRecoveryId: NodeId | null;
  openDanglingRecovery: (referenceId: NodeId) => void;
  closeDanglingRecovery: () => void;

  /**
   * After choosing "Re-point at another value," the next tap on a valid value
   * becomes the new target. Ephemeral — cancelled by tapping empty canvas or Escape.
   */
  repointReferenceId: NodeId | null;
  beginRepoint: (referenceId: NodeId) => void;
  clearRepoint: () => void;

  /** Nodes selected as a group (§8.6 `Select group`, P2.9). A group is the whole
   *  chain that contains the long-pressed node. Ephemeral: moving and deleting a
   *  group are the operations it enables (P3.7); the set itself is not a document edit. */
  groupSelectedIds: ReadonlySet<NodeId>;
  allSelected: boolean;
  setGroupSelected: (ids: ReadonlySet<NodeId>) => void;
  setAllSelected: (active: boolean) => void;
  clearGroupSelected: () => void;

  /** In-progress node drag (§8.2, P3.5). Null when idle. Updated every drag frame for
   *  the insertion caret (P3.6); cleared on release before any document commit. */
  dragSnap: DragSnapState | null;
  setDragSnap: (state: DragSnapState | null) => void;

  /**
   * Live pan/zoom during an active `Canvas` gesture (§7). Canvas's own pan/pinch/wheel
   * drive Reanimated shared values every frame and only commit into `documentStore`'s
   * `document.viewport` on release or debounce - a commit calls `notifyDocumentDirty`,
   * so committing on every frame would spam autosave the same way a per-frame document
   * write would (§7's "commit only on release"). Screen-space UI that must track the
   * canvas live *during* a gesture instead of lagging a frame behind reads this - same
   * reasoning `ViewportContext.tsx` already documents for node-drag, applied to
   * whatever can't read the shared values directly via that context because it isn't
   * mounted inside `Canvas` (the §8.8 slider popover and its connector line, so far).
   * Null when no gesture is active; callers fall back to the committed viewport then.
   */
  liveViewport: { pan: Vec2; zoom: number } | null;
  setLiveViewport: (viewport: { pan: Vec2; zoom: number } | null) => void;

  /**
   * The value-slider popover (§8.8, P6b.3). Opened explicitly from the cell context
   * menu's `Show slider` item — it no longer follows selection automatically. `pinned`
   * is the popover's own "keep open" checkbox: false (the default on open) means the
   * next canvas tap elsewhere closes it, same as any other momentary prompt in this
   * store; true suppresses that dismissal, and is also what gates the connector line
   * back to the cell and the popover's own drag handle (`ValueSlider.tsx` reads
   * `pinned` for both). `offset` is the popover's drag delta from its anchored
   * position; it only moves while pinned, and is reset whenever the slider opens fresh
   * or `pinned` is toggled.
   */
  sliderState: SliderState | null;
  openSlider: (nodeId: NodeId) => void;
  closeSlider: () => void;
  setSliderPinned: (pinned: boolean) => void;
  setSliderOffset: (offset: Vec2) => void;

  /** Settings sheet (§8.5, mode-strip cog). Ephemeral, same reasoning as every other
   *  prompt in this store: opening it is not a document edit, so it sits outside undo
   *  history rather than on `document`. */
  settingsVisible: boolean;
  openSettings: () => void;
  closeSettings: () => void;
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

  editingLabelNodeId: null,
  setEditingLabelNode: (id) => set({ editingLabelNodeId: id }),

  contextMenu: null,
  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),

  danglingRecoveryId: null,
  openDanglingRecovery: (referenceId) =>
    set({ danglingRecoveryId: referenceId, repointReferenceId: null, contextMenu: null }),
  closeDanglingRecovery: () => set({ danglingRecoveryId: null }),

  repointReferenceId: null,
  beginRepoint: (referenceId) =>
    set({ repointReferenceId: referenceId, danglingRecoveryId: null }),
  clearRepoint: () => set({ repointReferenceId: null }),

  groupSelectedIds: new Set(),
  allSelected: false,
  setGroupSelected: (ids) => set({ groupSelectedIds: ids }),
  setAllSelected: (active) => set({ allSelected: active }),
  clearGroupSelected: () => set({ groupSelectedIds: new Set(), allSelected: false }),

  dragSnap: null,
  setDragSnap: (dragSnap) => set({ dragSnap }),

  liveViewport: null,
  setLiveViewport: (liveViewport) => set({ liveViewport }),

  sliderState: null,
  openSlider: (nodeId) => set({ sliderState: { nodeId, pinned: false, offset: { x: 0, y: 0 } } }),
  closeSlider: () => set({ sliderState: null }),
  setSliderPinned: (pinned) =>
    set((state) =>
      state.sliderState
        ? { sliderState: { ...state.sliderState, pinned, offset: { x: 0, y: 0 } } }
        : state,
    ),
  setSliderOffset: (offset) =>
    set((state) => (state.sliderState ? { sliderState: { ...state.sliderState, offset } } : state)),

  settingsVisible: false,
  openSettings: () => set({ settingsVisible: true }),
  closeSettings: () => set({ settingsVisible: false }),
}));
