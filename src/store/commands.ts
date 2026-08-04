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
  createReferenceNode,
  createChainId,
} from '../model/factories';
import { CalcDocument, CalcNode, Chain, ChainId, NodeId, OperatorSymbol, ParenSide, Vec2 } from '../model/types';
import { layoutChain } from '../chains/layout';
import { widthOf } from '../chains/measure';
import type { SnapOutcome } from '../chains/snapping';
import { getDeviceLocale } from '../ui/locale';
import { tokens } from '../ui/tokens';
import { dirtyClosure, recomputeFromSeeds, removeResultNodesForChain } from '../engine/graph';

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

/** §8.3: a chain that loses its `=` also loses its result node. Deletion lives in
 *  `removeResultNodesForChain` (`engine/graph.ts`) so the equals-loss path and the
 *  not-Evaluated recompute path cannot drift apart. */

/** §8.3 bookkeeping after a chain's `members` changed, in the same commit as the
 *  mutation: drop orphaned results if `=` is gone; otherwise recompute the chain's
 *  result via the dirty-set path (P4.8 / §11 — create, update, or remove); delete an
 *  empty chain; dissolve a single-member chain (sole member becomes free with its
 *  current `position` authoritative); otherwise re-flow. */
function finalizeChain(draft: CalcDocument, chainId: ChainId): void {
  const chain = draft.chains[chainId];
  if (!chain) return;

  const hasEquals = chain.members.some((id) => draft.nodes[id]?.kind === 'equals');
  // Capture the dirty set while the seed still exists and (for the equals path)
  // before dissolve bookkeeping — dependents are reflowed only when we cascaded.
  let dirtyAfterCompute: readonly ChainId[] = [chainId];
  if (hasEquals) {
    // Nested inside an existing applyCommand recipe, so call the graph directly
    // rather than via applyCommand's recomputeSeeds option (that option is for
    // top-level recipes that don't already own the draft — e.g. setNodeRaw).
    recomputeFromSeeds(draft, [chainId], getDeviceLocale());
    dirtyAfterCompute = dirtyClosure(draft, [chainId]);
  } else {
    removeResultNodesForChain(draft, chainId);
  }

  // Recompute may have added/removed a result member — re-read after it.
  const after = draft.chains[chainId];
  if (!after) return;

  if (after.members.length === 0) {
    delete draft.chains[chainId];
    return;
  }

  if (after.members.length === 1) {
    const soleId = after.members[0];
    const sole = draft.nodes[soleId];
    if (sole) sole.chainId = null;
    delete draft.chains[chainId];
    return;
  }

  // Reflow every still-present chain the cascade touched (seed ∪ dependents).
  for (const id of dirtyAfterCompute) {
    if (draft.chains[id]) reflowChain(draft, id);
  }
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

/** World offset of a continuation chain from its source result (§8.7).
 *  Proportions taken from `docs/assets/linking-model.svg`: roughly half a cell right and
 *  one-and-a-half cells down from the result's top-left. */
export const CONTINUATION_OFFSET = {
  x: tokens.nodeHeight * 0.5,
  y: tokens.nodeHeight * 1.5,
} as const;

/**
 * §8.7 Continuation: with result `R` selected, operator `⊕` creates a new chain
 * below-right of `R` containing `[ reference→R , ⊕ ]`. Returns the new operator id so
 * the dispatcher can select it — the next digit then lands in a fresh number via the
 * normal append path. Never edits `R`.
 */
export function continueFromResult(
  resultNodeId: NodeId,
  op: OperatorSymbol,
): { chainId: ChainId; referenceId: NodeId; operatorId: NodeId } {
  const result = useDocumentStore.getState().document.nodes[resultNodeId];
  if (!result || result.kind !== 'result') {
    throw new Error(
      `continueFromResult: node ${resultNodeId} is not a result (got ${result?.kind ?? 'missing'})`,
    );
  }

  const reference = createReferenceNode({ x: 0, y: 0 }, resultNodeId);
  const operator = createOperatorNode({ x: 0, y: 0 }, op);
  const chainId = createChainId();
  const anchor = {
    x: result.position.x + CONTINUATION_OFFSET.x,
    y: result.position.y + CONTINUATION_OFFSET.y,
  };

  useDocumentStore.getState().applyCommand((draft) => {
    reference.chainId = chainId;
    operator.chainId = chainId;
    draft.nodes[reference.id] = reference;
    draft.nodes[operator.id] = operator;
    draft.chains[chainId] = {
      id: chainId,
      anchor,
      members: [reference.id, operator.id],
    };
    reflowChain(draft, chainId);
  });

  return { chainId, referenceId: reference.id, operatorId: operator.id };
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

  // Recompute + reflow in one recipe so a keystroke updates the result and the
  // flush layout before the commit lands (§11 same-turn rule, §8.1). The store's
  // `recomputeSeeds` option is the same `recomputeFromSeeds` call for callers
  // that don't own nested bookkeeping (P5 load); setNodeRaw goes through the
  // graph directly because it must reflow *after* the result width changes.
  const locale = getDeviceLocale();

  store.applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (!node || node.kind !== 'number') return;
    node.raw = raw;
    if (node.chainId !== null) {
      const seed = [node.chainId] as const;
      recomputeFromSeeds(draft, seed, locale);
      // P6.2: cascade may change dependent result widths — reflow the whole dirty set.
      for (const id of dirtyClosure(draft, seed)) {
        if (draft.chains[id]) reflowChain(draft, id);
      }
    }
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

/**
 * Break a reference link by deleting the reference node (§11.2). Used by the
 * CircularReference Unlink affordance (P6.3) on the DFS closing edge; P6.4's
 * long-press `Unlink from parent` will share this path. One undo entry via
 * {@link deleteNode}.
 */
export function unlinkReference(referenceNodeId: NodeId): void {
  const node = useDocumentStore.getState().document.nodes[referenceNodeId];
  if (!node || node.kind !== 'reference') return;
  deleteNode(referenceNodeId);
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
      x: chain.anchor.x - widthOf(node, locale, tokens.numeralFontSize, draft.nodes),
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
        x: chain.anchor.x - widthOf(node, locale, tokens.numeralFontSize, draft.nodes),
        y: chain.anchor.y,
      };
    }
    node.chainId = chainId;
    chain.members.splice(clamped, 0, nodeId);
    finalizeChain(draft, chainId);
  });
}

/** Create a fresh two-member chain ordered `[leftId, rightId]` (§8.3 NEW_CHAIN).
 *  Anchor is the left node's position; pass `leftPosition` when the left node is the
 *  one being dragged so the anchor reflects the release point rather than a stale
 *  store cache (P3.5). */
export function formNewChain(
  leftId: NodeId,
  rightId: NodeId,
  leftPosition?: Vec2,
): ChainId | null {
  let created: ChainId | null = null;
  useDocumentStore.getState().applyCommand((draft) => {
    const left = draft.nodes[leftId];
    const right = draft.nodes[rightId];
    if (!left || !right || leftId === rightId) return;

    if (leftPosition) {
      left.position = { x: leftPosition.x, y: leftPosition.y };
    }

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
 *  each branch calls a single `applyCommand`. `position` is the drag release point in
 *  world units; required for NEW_CHAIN when the dragged node is the left member so the
 *  anchor is not taken from a stale store position (P3.5). */
export function commitSnapOutcome(
  nodeId: NodeId,
  outcome: SnapOutcome,
  position?: Vec2,
): void {
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
    case 'newChain': {
      const leftPos =
        position && nodeId === outcome.leftId ? position : undefined;
      formNewChain(outcome.leftId, outcome.rightId, leftPos);
      break;
    }
  }
}

/** Reposition a free node. One undo entry. No-op if the node is missing or still
 *  chained — members get their position from layout (§8.1), not from this command. */
export function moveFreeNode(nodeId: NodeId, position: Vec2): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (!node || node.chainId !== null) return;
    if (node.position.x === position.x && node.position.y === position.y) return;
    node.position = { x: position.x, y: position.y };
  });
}

/** Reposition a whole chain by updating its `anchor`, then re-flowing members in the
 *  same commit (§8.1, §8.2 MovingChain). One undo entry. Member `position` is the
 *  layout cache; `anchor` + `members` remain the truth. */
export function moveChain(chainId: ChainId, anchor: Vec2): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const chain = draft.chains[chainId];
    if (!chain) return;
    if (chain.anchor.x === anchor.x && chain.anchor.y === anchor.y) return;
    chain.anchor = { x: anchor.x, y: anchor.y };
    reflowChain(draft, chainId);
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
