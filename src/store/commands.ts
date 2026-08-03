// Commands: the only place application code should mutate the document (via
// documentStore.applyCommand, which makes every mutation here undoable). See
// docs/ARCHITECTURE.md §5 (architecture), §6 (node kinds) and §13 (undo/redo).
//
// Chain mutations (snap, drag, detach...) land in P3 once the layout pass
// exists to give them something to act on.
import { useDocumentStore } from './documentStore';
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
    return; // no-op edit (raw unchanged, node missing, or not a number node)
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
