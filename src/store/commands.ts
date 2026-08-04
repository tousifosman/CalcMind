// Commands: the only place application code should mutate the document (via
// documentStore.applyCommand, which makes every mutation here undoable). See
// docs/ARCHITECTURE.md §5 (architecture), §6 (node kinds) and §13 (undo/redo).
//
// The §8.1 flush layout pass lives in ../chains/layout.ts (P3.1) and is applied here via
// reflowChain / finalizeChain. Typing still builds chains through appendMembersToChain
// (P2.8, decision #16); drag-snap commits go through the P3.4 commands below, which
// share the same §8.3 bookkeeping (dissolve / empty-delete / drop result with `=`).
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import {
  createNumberNode,
  createOperatorNode,
  createParenNode,
  createEqualsNode,
  createChainId,
} from '../model/factories';
import { CalcDocument, CalcNode, Chain, ChainId, NodeId, OperatorSymbol, ParenSide, Vec2 } from '../model/types';
import { layoutChain } from '../chains/layout';
import { widthOf } from '../chains/measure';
import type { SnapOutcome } from '../chains/snapping';
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

/** Re-flows a chain via `layoutChain` (P3.1, §8.1) and writes the result onto each
 *  member's `position` in `draft`. `position` is a cache - `chain.anchor` + `chain.members`
 *  stay the truth - so this is safe to call after any mutation that could change a member's
 *  width or a chain's membership, in the same commit as that mutation. */
function reflowChain(draft: CalcDocument, chainId: ChainId): void {
  const chain = draft.chains[chainId];
  if (!chain) return;
  const positions = layoutChain(chain, draft.nodes, getDeviceLocale());
  for (const memberId of chain.members) {
    const member = draft.nodes[memberId];
    const position = positions[memberId];
    if (member && position) member.position = position;
  }
}

/** §8.3: a chain that loses its `=` also loses its result node. Results are found by
 *  `sourceChainId` (and dropped from `members` if present) so this works whether or not
 *  the result was listed in `members` — §12.1's sample includes it; earlier typing paths
 *  never created one. */
function removeResultNodesForChain(draft: CalcDocument, chainId: ChainId): void {
  const toDelete: NodeId[] = [];
  for (const [id, node] of Object.entries(draft.nodes)) {
    if (node.kind === 'result' && node.sourceChainId === chainId) {
      toDelete.push(id);
    }
  }
  if (toDelete.length === 0) return;

  for (const id of toDelete) {
    delete draft.nodes[id];
  }
  const chain = draft.chains[chainId];
  if (chain) {
    const drop = new Set(toDelete);
    chain.members = chain.members.filter((id) => !drop.has(id));
  }
}

/** §8.3 bookkeeping after a chain's `members` changed, in the same commit as the
 *  mutation: drop orphaned results if `=` is gone; delete an empty chain; dissolve a
 *  single-member chain (sole member becomes free with its current `position`
 *  authoritative); otherwise re-flow. */
function finalizeChain(draft: CalcDocument, chainId: ChainId): void {
  const chain = draft.chains[chainId];
  if (!chain) return;

  const hasEquals = chain.members.some((id) => draft.nodes[id]?.kind === 'equals');
  if (!hasEquals) {
    removeResultNodesForChain(draft, chainId);
  }

  if (chain.members.length === 0) {
    delete draft.chains[chainId];
    return;
  }

  if (chain.members.length === 1) {
    const soleId = chain.members[0];
    const sole = draft.nodes[soleId];
    if (sole) sole.chainId = null;
    delete draft.chains[chainId];
    return;
  }

  reflowChain(draft, chainId);
}

/** Pulls `nodeId` out of whatever chain it currently belongs to, without deleting the
 *  node. Runs `finalizeChain` on the vacated chain so detach / snap-away leave no
 *  dangling one-member or equals-less result behind. No-op if the node is already free. */
function removeFromCurrentChain(draft: CalcDocument, nodeId: NodeId): void {
  const node = draft.nodes[nodeId];
  if (!node || node.chainId === null) return;
  const chainId = node.chainId;
  const chain = draft.chains[chainId];
  node.chainId = null;
  if (!chain) return;
  chain.members = chain.members.filter((id) => id !== nodeId);
  finalizeChain(draft, chainId);
}

/** Appends already-constructed nodes to the chain the node at `anchorNodeId` belongs to,
 *  creating a new one-member chain first if it doesn't have one yet, then re-flows the
 *  whole chain with `layoutChain` (P3.1) so every member reads correctly immediately.
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

    for (const node of newNodes) {
      node.chainId = chain.id;
      draft.nodes[node.id] = node;
      chain.members.push(node.id);
    }

    // Length is always ≥ 2 here (anchor + at least one append), so finalize reflows;
    // using it rather than reflowChain alone keeps equals/result bookkeeping in one place.
    finalizeChain(draft, chain.id);
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
    if (!node || node.kind !== 'number') return;
    node.raw = raw;
    // A raw edit can change the node's widthOf (§8.1), so the chain it belongs to - if
    // any - must re-flow in this same commit, or a frame could render a stale layout.
    if (node.chainId !== null) reflowChain(draft, node.chainId);
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
    const chainId = node.chainId;
    delete draft.nodes[nodeId];

    if (chainId !== null) {
      const chain = draft.chains[chainId];
      if (chain) {
        chain.members = chain.members.filter((id) => id !== nodeId);
        finalizeChain(draft, chainId);
      }
    }
  });
}

// --- P3.4: snap / detach commits (§8.3 bookkeeping) ---------------------------------

/** Prepend `nodeId` as the new leftmost member of `chainId`. One undo entry.
 *  Shifts `chain.anchor` left by `widthOf(node)` so existing members keep their world
 *  positions and only the new leftmost cell is new — §8.3's "opens a gap at the pending
 *  insertion point" for a left-edge snap. Leaving the anchor fixed would reflow the whole
 *  formula rightward onto the new node's slot. */
export function prependToChain(nodeId: NodeId, chainId: ChainId): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    const chain = draft.chains[chainId];
    if (!node || !chain) return;
    if (node.chainId === chainId) return;

    removeFromCurrentChain(draft, nodeId);
    // Target chain is a different id, so finalize on the source cannot have deleted it.
    if (!draft.chains[chainId]) return;
    const locale = getDeviceLocale();
    chain.anchor = {
      x: chain.anchor.x - widthOf(node, locale),
      y: chain.anchor.y,
    };
    node.chainId = chainId;
    chain.members.unshift(nodeId);
    finalizeChain(draft, chainId);
  });
}

/** Append `nodeId` as the new rightmost member of `chainId`. One undo entry. */
export function appendToChain(nodeId: NodeId, chainId: ChainId): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    const chain = draft.chains[chainId];
    if (!node || !chain) return;
    if (node.chainId === chainId) return;

    removeFromCurrentChain(draft, nodeId);
    if (!draft.chains[chainId]) return;
    node.chainId = chainId;
    chain.members.push(nodeId);
    finalizeChain(draft, chainId);
  });
}

/** Insert `nodeId` into `chainId` before `members[index]` (§8.3 INSERT_AT).
 *  `index` is clamped to `[0, members.length]` so a stale caret cannot write past the end.
 *  Index 0 is the same geometry as prepend (snap's `memberBoundaries` never yields 0, but
 *  a direct call can) — shift the anchor left so members to the right of the gap stay put. */
export function insertIntoChain(nodeId: NodeId, chainId: ChainId, index: number): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    const chain = draft.chains[chainId];
    if (!node || !chain) return;
    if (node.chainId === chainId) return;

    removeFromCurrentChain(draft, nodeId);
    if (!draft.chains[chainId]) return;
    const clamped = Math.max(0, Math.min(index, chain.members.length));
    if (clamped === 0) {
      const locale = getDeviceLocale();
      chain.anchor = {
        x: chain.anchor.x - widthOf(node, locale),
        y: chain.anchor.y,
      };
    }
    node.chainId = chainId;
    chain.members.splice(clamped, 0, nodeId);
    finalizeChain(draft, chainId);
  });
}

/** Create a fresh two-member chain ordered `[leftId, rightId]` (§8.3 NEW_CHAIN).
 *  Anchor is the left node's current (authoritative) position; layout reflows both. */
export function formNewChain(leftId: NodeId, rightId: NodeId): ChainId | null {
  let created: ChainId | null = null;
  useDocumentStore.getState().applyCommand((draft) => {
    const left = draft.nodes[leftId];
    const right = draft.nodes[rightId];
    if (!left || !right || leftId === rightId) return;

    removeFromCurrentChain(draft, leftId);
    removeFromCurrentChain(draft, rightId);

    const chainId = createChainId();
    draft.chains[chainId] = {
      id: chainId,
      anchor: { ...left.position },
      members: [leftId, rightId],
    };
    left.chainId = chainId;
    right.chainId = chainId;
    created = chainId;
    finalizeChain(draft, chainId);
  });
  return created;
}

/** Detach a chain member: write its authoritative free `position`, clear `chainId`, and
 *  run §8.3 bookkeeping on the vacated chain. One undo entry. No-op if already free. */
export function detachNode(nodeId: NodeId, position: Vec2): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (!node || node.chainId === null) return;
    node.position = { ...position };
    removeFromCurrentChain(draft, nodeId);
  });
}

/** Dispatch a P3.3 `SnapOutcome` onto the matching mutation command. One undo entry —
 *  each branch calls a single `applyCommand`. Convenience for P3.5's release handler. */
export function commitSnapOutcome(nodeId: NodeId, outcome: SnapOutcome): void {
  switch (outcome.kind) {
    case 'prepend':
      prependToChain(nodeId, outcome.chainId);
      break;
    case 'append':
      appendToChain(nodeId, outcome.chainId);
      break;
    case 'insert':
      insertIntoChain(nodeId, outcome.chainId, outcome.index);
      break;
    case 'newChain':
      formNewChain(outcome.leftId, outcome.rightId);
      break;
  }
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
