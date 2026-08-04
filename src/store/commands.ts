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
  createChainId,
} from '../model/factories';
import { CalcNode, Chain, NodeId, OperatorSymbol, ParenSide, Vec2 } from '../model/types';
import { widthOf } from '../chains/measure';
import { getDeviceLocale } from '../ui/locale';

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

// Chain building via typing (P2.8, §8.5). This is deliberately not P3's job: P3's chain
// mutations (snap, drag, detach) resolve which of several nearby candidates a dragged node
// means to join (§8.2-8.4), which needs geometry this doesn't. Typing always knows exactly
// which chain to extend - whichever one the selected node already belongs to - so it can
// append directly, with none of that candidate search.

/** Appends already-constructed nodes to the chain the node at `anchorNodeId` belongs to,
 *  creating a new one-member chain first if it doesn't have one yet. Positions each
 *  appended node with §8.1's flush layout formula so it reads correctly immediately, rather
 *  than waiting on a chain layout pass to catch up (there isn't one yet - P3 territory).
 *  One call is one undo entry, however many nodes it appends - which is what lets
 *  `appendOperatorAndNumber` below insert its operator and its fresh operand atomically. */
function appendMembersToChain(anchorNodeId: NodeId, newNodes: CalcNode[]): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const anchorNode = draft.nodes[anchorNodeId];
    if (!anchorNode) return;

    const existingChain = anchorNode.chainId ? draft.chains[anchorNode.chainId] : undefined;
    const chain: Chain =
      existingChain ?? { id: createChainId(), anchor: { ...anchorNode.position }, members: [anchorNodeId] };
    if (!existingChain) {
      draft.chains[chain.id] = chain;
      anchorNode.chainId = chain.id;
    }

    const locale = getDeviceLocale();
    for (const node of newNodes) {
      let x = chain.anchor.x;
      for (const memberId of chain.members) {
        const member = draft.nodes[memberId];
        if (member) x += widthOf(member, locale);
      }
      node.chainId = chain.id;
      node.position = { x, y: chain.anchor.y };
      draft.nodes[node.id] = node;
      chain.members.push(node.id);
    }
  });
}

/** Appends a number node to the chain after `afterNodeId` (§8.5's "acts on the selected
 *  node" targeting rule). */
export function appendNumberNode(afterNodeId: NodeId, raw: string): NodeId {
  const node = createNumberNode({ x: 0, y: 0 }, raw);
  appendMembersToChain(afterNodeId, [node]);
  return node.id;
}

export function appendParenNode(afterNodeId: NodeId, side: ParenSide): NodeId {
  const node = createParenNode({ x: 0, y: 0 }, side);
  appendMembersToChain(afterNodeId, [node]);
  return node.id;
}

export function appendEqualsNode(afterNodeId: NodeId): NodeId {
  const node = createEqualsNode({ x: 0, y: 0 });
  appendMembersToChain(afterNodeId, [node]);
  return node.id;
}

/** Pressing an operator doesn't just append the operator (§8.5) - the next keystroke should
 *  land in a fresh operand, so this appends the operator and an empty number node together.
 *  Doing that as two separate `appendMembersToChain` calls would let undo strand the
 *  operator without the operand it was appended for. */
export function appendOperatorAndNumber(
  afterNodeId: NodeId,
  op: OperatorSymbol,
): { operatorId: NodeId; numberId: NodeId } {
  const operatorNode = createOperatorNode({ x: 0, y: 0 }, op);
  const numberNode = createNumberNode({ x: 0, y: 0 }, '');
  appendMembersToChain(afterNodeId, [operatorNode, numberNode]);
  return { operatorId: operatorNode.id, numberId: numberNode.id };
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

/** Selects any node kind without entering edit mode - the target for keypad/hardware-keyboard
 *  input (P2.8, §8.5), but not itself a text field (§8.6). */
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
