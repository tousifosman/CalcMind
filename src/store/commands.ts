// Commands: the only place application code should mutate the document (via
// documentStore.applyCommand, which makes every mutation here undoable). See
// docs/ARCHITECTURE.md §5 (architecture), §6 (node kinds) and §13 (undo/redo).
//
// Chain mutations (snap, drag, detach...) land in P3 once the layout pass
// exists to give them something to act on.
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import {
  createNumberNode,
  createOperatorNode,
  createParenNode,
  createEqualsNode,
} from '../model/factories';
import { NodeId, OperatorSymbol, ParenSide, Vec2 } from '../model/types';

export function renameDocument(name: string): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.name = name;
  });
}

export function addNumberNode(position: Vec2, raw: string): NodeId {
  const node = createNumberNode(position, raw);
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[node.id] = node;
  });
  return node.id;
}

export function addOperatorNode(position: Vec2, op: OperatorSymbol): NodeId {
  const node = createOperatorNode(position, op);
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[node.id] = node;
  });
  return node.id;
}

export function addParenNode(position: Vec2, side: ParenSide): NodeId {
  const node = createParenNode(position, side);
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[node.id] = node;
  });
  return node.id;
}

export function addEqualsNode(position: Vec2): NodeId {
  const node = createEqualsNode(position);
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[node.id] = node;
  });
  return node.id;
}

/** setNodeRaw coalescing window (§13): keystrokes to the same node within this
 *  many ms merge into the undo entry already on top of the stack, rather than
 *  each landing as its own entry. */
const RAW_EDIT_COALESCE_WINDOW_MS = 500;

// Which node the last setNodeRaw call touched, when, and how deep the undo
// stack was right after it landed - so a follow-up call can tell "still the
// same edit burst" (merge) from "a different node, or something else was
// undoable in between" (don't). Module state rather than store state: it's a
// command-dispatch concern, not part of the document.
let lastRawEdit: { nodeId: NodeId; at: number; stackLength: number } | null = null;

export function setNodeRaw(nodeId: NodeId, raw: string): void {
  const store = useDocumentStore.getState();

  // Read-only enforcement lives here, not in each node view (§11.3): every edit, from
  // whichever input path (keypad, hardware keyboard, a future paste), ends up calling this
  // command, so this is the one place that can't be bypassed. A result node existing but
  // being the wrong kind is not the same as "nothing to edit" - it must reject, not silently
  // no-op, or an edit attempt on a read-only cell looks indistinguishable from success.
  const targetNode = store.document.nodes[nodeId];
  if (targetNode && targetNode.kind !== 'number') {
    throw new Error(`setNodeRaw: node ${nodeId} is a ${targetNode.kind} node and is read-only`);
  }

  const stackLengthBefore = store.undoStack.length;
  const now = Date.now();
  const canCoalesce =
    lastRawEdit !== null &&
    lastRawEdit.nodeId === nodeId &&
    lastRawEdit.stackLength === stackLengthBefore &&
    now - lastRawEdit.at < RAW_EDIT_COALESCE_WINDOW_MS;

  store.applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (node && node.kind === 'number') node.raw = raw;
  });

  if (useDocumentStore.getState().undoStack.length === stackLengthBefore) {
    return; // no-op edit (raw unchanged, or node missing - wrong kind already threw above)
  }

  if (canCoalesce) {
    useDocumentStore.setState((state) => {
      const stack = state.undoStack.slice();
      const latest = stack.pop()!;
      const previous = stack.pop()!;
      stack.push({
        patches: [...previous.patches, ...latest.patches],
        inversePatches: [...latest.inversePatches, ...previous.inversePatches],
      });
      return { undoStack: stack };
    });
  }

  lastRawEdit = { nodeId, at: now, stackLength: useDocumentStore.getState().undoStack.length };
}

/** Swipe-to-clear (§8.5, decision #15): wipes every node and chain in one undo
 *  entry. The confirmation gate lives in the keypad (P2.10) - this command trusts
 *  its caller and does not ask again, so it stays a plain, testable mutation. */
export function clearDocument(): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const alreadyEmpty =
      Object.keys(draft.nodes).length === 0 && Object.keys(draft.chains).length === 0;
    if (alreadyEmpty) return;
    draft.nodes = {};
    draft.chains = {};
  });
}

export function deleteNode(nodeId: NodeId): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (!node) return;
    delete draft.nodes[nodeId];

    if (node.chainId !== null) {
      const chain = draft.chains[node.chainId];
      if (chain) {
        chain.members = chain.members.filter((id) => id !== nodeId);
        if (chain.members.length === 0) delete draft.chains[node.chainId];
      }
    }
  });
}

/** Selects every node in the same chain as `nodeId` (§8.6, P2.9). Nodes that are
 *  not chain members — i.e. free nodes with `chainId === null` — count as a group
 *  of one. This is purely ephemeral UI state; the document is not changed. */
export function selectGroup(nodeId: NodeId): void {
  const { document } = useDocumentStore.getState();
  const node = document.nodes[nodeId];
  if (!node) return;

  let ids: NodeId[];
  if (node.chainId !== null) {
    const chain = document.chains[node.chainId];
    ids = chain ? chain.members : [nodeId];
  } else {
    ids = [nodeId];
  }

  useUiStore.getState().setGroupSelected(new Set(ids));
  // Select the long-pressed node as the primary selection so the keypad still has
  // a sensible target while the group highlight is visible.
  useUiStore.getState().setSelectedNode(nodeId);
  useUiStore.getState().setEditingNode(null);
}

// Selection (§8.6, §13, P2.6). `uiStore` holds selectedNodeId/editingNodeId as bare ephemeral
// state and has no document to consult; these wrappers are what add the one piece of domain
// behaviour selection needs - discarding a number node that's being abandoned mid-edit with
// nothing typed into it yet, so committing an empty raw removes it rather than leaving a
// blank cell on the canvas. Every path that moves the selection (tap empty canvas, tap
// another node, Escape) should go through these rather than uiStore's setters directly.

/** `keepId` is the node about to become selected/edited, if any, so re-selecting the node
 *  that's already being edited doesn't delete it out from under itself. */
function discardIfAbandoned(keepId: NodeId | null): void {
  const editingId = useUiStore.getState().editingNodeId;
  if (!editingId || editingId === keepId) return;
  const node = useDocumentStore.getState().document.nodes[editingId];
  if (node && node.kind === 'number' && node.raw === '') {
    deleteNode(editingId);
  }
}

/** Selects any node kind without entering edit mode - the target for keypad input once
 *  P2.8 wires that up, but not itself a text field (§8.6). */
export function selectNode(nodeId: NodeId): void {
  discardIfAbandoned(nodeId);
  useUiStore.getState().setEditingNode(null);
  useUiStore.getState().setSelectedNode(nodeId);
}

/** Selects a number node and opens its in-place text editor (§8.6, P2.6). */
export function editNumberNode(nodeId: NodeId): void {
  discardIfAbandoned(nodeId);
  useUiStore.getState().setSelectedNode(nodeId);
  useUiStore.getState().setEditingNode(nodeId);
}

/** Clears selection and, if the node being edited is an empty number, discards it (§8.6). */
export function deselectNode(): void {
  discardIfAbandoned(null);
  useUiStore.getState().setSelectedNode(null);
  useUiStore.getState().setEditingNode(null);
}
