// Commands: the only place application code should mutate the document (via
// documentStore.applyCommand, which makes every mutation here undoable). See
// docs/ARCHITECTURE.md §5 (architecture), §6 (node kinds) and §13 (undo/redo).
//
// The §8.1 flush layout pass lives in ../chains/layout.ts (P3.1) and is applied here via
// reflowChain / finalizeChain. Typing still builds chains through appendMembersToChain
// (P2.8, decision #16); drag-snap commits go through the P3.4 commands below, which
// share the same §8.3 bookkeeping (dissolve / empty-delete / drop result with `=`).
import { setAutosaveSuppressed, useDocumentStore } from './documentStore';
import { historyTop, type HistoryEntry } from './undo';
import { useUiStore } from './uiStore';
import { usePreferencesStore } from './preferencesStore';
import {
  createNumberNode,
  createOperatorNode,
  createParenNode,
  createEqualsNode,
  createReferenceNode,
  createChainId,
} from '../model/factories';
import { CalcDocument, CalcNode, Chain, ChainId, NodeId, OperatorSymbol, ParenSide, Vec2 } from '../model/types';
import { boundsOf } from '../chains/bounds';
import { layoutChain } from '../chains/layout';
import { widthOf } from '../chains/measure';
import type { SnapOutcome } from '../chains/snapping';
import { getDeviceLocale } from '../ui/locale';
import { tokens, nodeHeightFor } from '../ui/tokens';
import { dirtyClosure, recomputeFromSeeds } from '../engine/graph';
import {
  deleteNodesLeavingDanglingRefs,
  isDanglingReference,
  isRepointTarget,
  referenceDisplayText,
} from '../engine/reference';
import { parseComputedDisplay } from '../engine/format';
import { identitySourceId } from '../engine/identity';

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

/**
 * Replace the symbol on an existing operator (§8.5). Selecting an operator and
 * pressing another operator key changes it in place rather than appending a
 * second operator at the chain end. Recomputes the chain when the op changes.
 */
export function setOperatorSymbol(nodeId: NodeId, op: OperatorSymbol): void {
  const store = useDocumentStore.getState();
  const target = store.document.nodes[nodeId];
  if (!target || target.kind !== 'operator') {
    throw new Error(
      `setOperatorSymbol: node ${nodeId} is not an operator (got ${target?.kind ?? 'missing'})`,
    );
  }
  if (target.op === op) return;

  const locale = getDeviceLocale();
  store.applyCommand((draft) => {
    const node = draft.nodes[nodeId];
    if (!node || node.kind !== 'operator') return;
    node.op = op;
    if (node.chainId !== null) {
      const seed = [node.chainId] as const;
      recomputeFromSeeds(draft, seed, locale);
      for (const id of dirtyClosure(draft, seed)) {
        if (draft.chains[id]) reflowChain(draft, id);
      }
    }
  });
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
  const positions = layoutChain(
    chain,
    draft.nodes,
    getDeviceLocale(),
    usePreferencesStore.getState().numeralFontSize,
  );
  for (const memberId of chain.members) {
    const member = draft.nodes[memberId];
    const position = positions[memberId];
    if (member && position) member.position = position;
  }
}

/** §8.3 bookkeeping after a chain's `members` changed, in the same commit as the
 *  mutation: recompute the chain via the dirty-set path (P4.8 / §11 — create, update,
 *  or drop the result depending on whether `=` is present and the chain is Evaluated)
 *  and cascade to anything that references it (§11 / P6.2 — losing `=` is an edit too);
 *  delete an empty chain; dissolve a single-member chain (sole member becomes free with
 *  its current `position` authoritative); otherwise re-flow every chain the cascade
 *  touched. */
function finalizeChain(draft: CalcDocument, chainId: ChainId): void {
  const chain = draft.chains[chainId];
  if (!chain) return;

  // Always cascade, whether this chain gained, kept, or just lost its `=`.
  // `recomputeChain` (inside `recomputeFromSeeds`) already handles a seed that is no
  // longer Evaluated by removing its own result — losing `=` doesn't need a special
  // "skip the graph" branch. That branch used to call `removeResultNodesForChain`
  // directly, which never seeded a cascade: a chain referencing the one that just lost
  // `=` kept showing its last cached value instead of recomputing to reflect the new
  // dangling reference (caught live during the P6 phase exit check — deleting a
  // dependency's `=` left a downstream result frozen on a stale number instead of
  // turning into `NotANumber`).
  //
  // Nested inside an existing applyCommand recipe, so call the graph directly rather
  // than via applyCommand's recomputeSeeds option (that option is for top-level
  // recipes that don't already own the draft — e.g. setNodeRaw).
  recomputeFromSeeds(draft, [chainId], getDeviceLocale());
  // Capture the dirty set while the seed still exists and before dissolve bookkeeping —
  // dependents are reflowed only when we cascaded.
  const dirtyAfterCompute = dirtyClosure(draft, [chainId]);

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
 *  immediately after the anchor's own position in `members` — not necessarily the
 *  chain's end, creating a new one-member chain first if it doesn't have one yet — then
 *  re-flows the whole chain with `layoutChain` (P3.1) so every member reads correctly
 *  immediately. One call is one undo entry, however many nodes it appends - which is
 *  what lets `appendOperatorAndNumber` below insert its operator and its fresh operand
 *  atomically.
 *
 *  Inserting at the anchor's index (rather than always pushing to the array's end)
 *  matters whenever the anchor isn't already the chain's last member — e.g. selecting
 *  `2` in the already-`=`'d chain `1 + 2 = 3` and pressing `+` must build `1 + 2 + _ = 3`
 *  in place, not push past the trailing `=`/result. `finalizeChain`'s recompute finds
 *  `=` wherever it now sits (`writeChainDerived` looks it up fresh) and the sequence
 *  validator reads `members` in stored order, so no other bookkeeping needs to know the
 *  anchor moved out of last place. */
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

    const anchorIndex = chain.members.indexOf(anchorNodeId);
    const insertAt = anchorIndex === -1 ? chain.members.length : anchorIndex + 1;

    for (const node of newNodes) {
      node.chainId = chain.id;
      draft.nodes[node.id] = node;
    }
    chain.members.splice(insertAt, 0, ...newNodes.map((node) => node.id));

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

/** Vertical pitch of a continuation chain from the row above it (§8.7), *at the
 *  compiled-in default font size*. One-and-a-half cell heights: a full cell plus a
 *  half-cell gap, matching the spacing under the source group's first cell.
 *  `continuationAnchor` below computes the live value (§12.5) from the current numeral
 *  font size rather than reading this constant — kept exported for tests/reference at
 *  the default setting. */
export const CONTINUATION_OFFSET = {
  y: tokens.nodeHeight * 1.5,
} as const;

/**
 * §8.7 placement: under the first cell of the source group (or under a free
 * value itself), x aligned with that cell. When any other cell already overlaps
 * the landing slot in that first-cell column, stack under it (and keep stacking
 * while the slot still intersects an occupant) while still anchoring x to the
 * source group's first cell — not to a drifted occupant.
 *
 * Collision is axis-aligned bounds overlap against the first cell's horizontal
 * span, not left-edge proximity / same-row banding: a free number sitting in the
 * gap under the group (or slightly x-offset but still under the first cell) must
 * still push the new chain below it.
 *
 * Pure over plain document data so the stacking rule is unit-testable without
 * going through the store. Accepts the same value kinds as
 * {@link continueFromValue}.
 */
export function continuationAnchor(
  valueNodeId: NodeId,
  nodes: Record<NodeId, CalcNode>,
  chains: Record<ChainId, Chain>,
  locale: string = 'en-US',
): Vec2 {
  const value = nodes[valueNodeId];
  const isLiveReference =
    value?.kind === 'reference' && nodes[value.targetNodeId] !== undefined;
  if (
    !value ||
    (value.kind !== 'result' && value.kind !== 'number' && !isLiveReference)
  ) {
    throw new Error(
      `continuationAnchor: node ${valueNodeId} is not a number, result, or live reference (got ${value?.kind ?? 'missing'})`,
    );
  }

  const sourceChain =
    value.chainId !== null ? chains[value.chainId] : undefined;
  const originX = sourceChain?.anchor.x ?? value.position.x;
  const originY = sourceChain?.anchor.y ?? value.position.y;
  // Live font size (§12.5), read once and reused for every geometry call below so the
  // pitch, the occupancy-check slot, and boundsOf's own height all agree — not
  // CONTINUATION_OFFSET.y / tokens.nodeHeight, which are only the default-size values.
  const fontSize = usePreferencesStore.getState().numeralFontSize;
  const pitch = nodeHeightFor(fontSize) * 1.5;
  const sourceChainId = sourceChain?.id ?? null;

  const firstMember =
    sourceChain !== undefined
      ? nodes[sourceChain.members[0]!]
      : value;
  const columnLeft = originX;
  const columnRight = originX + widthOf(firstMember, locale, fontSize, nodes);

  let y = originY + pitch;
  // Push below any cell whose bounds intersect the candidate slot in this
  // column. A clear gap below the source keeps the default landing; only real
  // overlap moves the chain down.
  for (;;) {
    let blockerY: number | null = null;
    const slotTop = y;
    const slotBottom = y + nodeHeightFor(fontSize);
    for (const node of Object.values(nodes)) {
      if (sourceChainId !== null && node.chainId === sourceChainId) continue;
      // A free value seeding continuation must not treat itself as occupying
      // the landing column (its bounds sit at originY, above the default slot).
      if (sourceChainId === null && node.id === valueNodeId) continue;
      const b = boundsOf(node, locale, nodes, fontSize);
      if (b.right <= columnLeft || b.left >= columnRight) continue;
      if (b.bottom <= slotTop || b.top >= slotBottom) continue;
      if (blockerY === null || node.position.y > blockerY) {
        blockerY = node.position.y;
      }
    }
    if (blockerY === null) break;
    y = blockerY + pitch;
  }

  return { x: originX, y };
}

/**
 * §8.7 Continuation: with a value `V` (number, result, or live reference) selected,
 * operator `⊕` creates a new chain under the first cell of V's group (or under V
 * when free) containing `[ reference→V , ⊕ , empty number ]`. Returns the fresh
 * number id so the dispatcher can put it in edit mode — same as
 * {@link appendOperatorAndNumber}, and required now that a selected operator
 * rejects digits. Never edits `V`.
 *
 * Numbers and live references are accepted here so *this primitive* can seed a link
 * from either — but the operator-key dispatcher no longer calls it with a reference at
 * all (below). Kept generic for the explicit `Create link` context-menu action
 * ({@link createLinkToValue}), which still accepts a chain-member number or a live
 * reference, same as `Label` — an explicit "link this" request isn't the implicit
 * operator-key shorthand.
 *
 * This function itself doesn't care whether `V` already belongs to a chain — that
 * restriction lives in the caller. `dispatchEditorCommand`'s operator-key gesture only
 * reaches here for a *free* number (`chainId === null`) or a selected result; a number
 * already mid-formula, or *any* live reference (free or chain-member), gets
 * {@link appendOperatorAndNumber} instead, extending that formula/chain in place rather
 * than linking it (§8.7). A reference is already a link — pressing an operator on one
 * means "keep computing with what this points to", not "make another link to this
 * link". Reported live: a reference dropped by `Create link`, operator pressed on it,
 * was spinning off a second reference instead of extending from the first.
 */
export function continueFromValue(
  valueNodeId: NodeId,
  op: OperatorSymbol,
): { chainId: ChainId; referenceId: NodeId; operatorId: NodeId; numberId: NodeId } {
  const { nodes, chains } = useDocumentStore.getState().document;
  const value = nodes[valueNodeId];
  const isLiveReference =
    value?.kind === 'reference' && nodes[value.targetNodeId] !== undefined;
  if (
    !value ||
    (value.kind !== 'result' && value.kind !== 'number' && !isLiveReference)
  ) {
    throw new Error(
      `continueFromValue: node ${valueNodeId} is not a number, result, or live reference (got ${value?.kind ?? 'missing'})`,
    );
  }

  const reference = createReferenceNode({ x: 0, y: 0 }, valueNodeId);
  const operator = createOperatorNode({ x: 0, y: 0 }, op);
  const number = createNumberNode({ x: 0, y: 0 }, '');
  const chainId = createChainId();
  const anchor = continuationAnchor(
    valueNodeId,
    nodes,
    chains,
    getDeviceLocale(),
  );

  useDocumentStore.getState().applyCommand((draft) => {
    reference.chainId = chainId;
    operator.chainId = chainId;
    number.chainId = chainId;
    draft.nodes[reference.id] = reference;
    draft.nodes[operator.id] = operator;
    draft.nodes[number.id] = number;
    draft.chains[chainId] = {
      id: chainId,
      anchor,
      members: [reference.id, operator.id, number.id],
    };
    reflowChain(draft, chainId);
  });

  return {
    chainId,
    referenceId: reference.id,
    operatorId: operator.id,
    numberId: number.id,
  };
}

/** @deprecated Use {@link continueFromValue} — kept as a thin alias for call sites
 *  that still say "result" while the behaviour accepts any value. */
export function continueFromResult(
  resultNodeId: NodeId,
  op: OperatorSymbol,
): { chainId: ChainId; referenceId: NodeId; operatorId: NodeId; numberId: NodeId } {
  return continueFromValue(resultNodeId, op);
}

/**
 * §8.6 "Create link" context-menu action: drops a free-floating reference to
 * `valueNodeId` near its source — no operator, no bundled empty number, and not
 * attached to any chain. The explicit counterpart to §8.7 continuation for a link the
 * user wants to place and drag elsewhere rather than keep computing from immediately;
 * dragging the fresh reference onto a chain afterward is the ordinary snap path, same
 * as any other free node (only a *dragged result* gets the special drag-to-link
 * commit — §11). Shares {@link continuationAnchor}'s placement and stacking rule so
 * the new cell doesn't land on an existing occupant, and the same value eligibility
 * (number, result, or live reference) as continuation and `Label`. Selects the new
 * reference so it's ready to drag or, for a live reference, continue from.
 */
export function createLinkToValue(valueNodeId: NodeId): NodeId {
  const { nodes, chains } = useDocumentStore.getState().document;
  const value = nodes[valueNodeId];
  const isLiveReference =
    value?.kind === 'reference' && nodes[value.targetNodeId] !== undefined;
  if (
    !value ||
    (value.kind !== 'result' && value.kind !== 'number' && !isLiveReference)
  ) {
    throw new Error(
      `createLinkToValue: node ${valueNodeId} is not a number, result, or live reference (got ${value?.kind ?? 'missing'})`,
    );
  }

  const reference = createReferenceNode(
    continuationAnchor(valueNodeId, nodes, chains, getDeviceLocale()),
    valueNodeId,
  );

  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[reference.id] = reference;
  });
  selectNode(reference.id);
  return reference.id;
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
//
// `entry` is the coalesced stack-top this burst owns — keyed by object identity,
// not `undoStack.length`, so coalescing still works once the stack is capped at
// MAX_HISTORY (length stops growing; the top reference still changes).
let lastRawEdit: { nodeId: NodeId; at: number; entry: HistoryEntry } | null = null;

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

  const topBefore = historyTop(store.undoStack);
  const now = Date.now();
  const canCoalesce =
    lastRawEdit !== null &&
    lastRawEdit.nodeId === nodeId &&
    lastRawEdit.entry === topBefore &&
    now - lastRawEdit.at < RAW_EDIT_COALESCE_WINDOW_MS;

  // Recompute + reflow in one recipe so a keystroke updates the result and the
  // flush layout before the commit lands (§11 same-turn rule, §8.1). The store's
  // `recomputeSeeds` option is the same `recomputeFromSeeds` call for callers
  // that don't own nested bookkeeping (P5 load); setNodeRaw goes through the
  // graph directly because it must reflow *after* the result width changes.
  const locale = getDeviceLocale();

  store.applyCommand(
    (draft) => {
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
    },
    { coalesceWithTop: canCoalesce },
  );

  const topAfter = historyTop(useDocumentStore.getState().undoStack);
  if (topAfter === null || topAfter === topBefore) {
    return; // no-op edit (raw unchanged, or node missing - wrong kind already threw above)
  }

  lastRawEdit = { nodeId, at: now, entry: topAfter };
}

// ─── Value-slider scrub (§8.8 / P6b.3–P6b.4) ─────────────────────────────────
//
// A scrub is one gesture, not a burst of keystrokes: the whole drag coalesces into
// a single undo entry regardless of wall-clock duration, autosave is suppressed
// until release, and recompute is coalesced to one flush per animation frame so a
// deep dependency graph cannot drop the thumb interaction (§8.8 frame budget).

interface ScrubSession {
  nodeId: NodeId;
  /**
   * The scrub's single undo entry once the first frame commits, or `null` until
   * then. Subsequent frames merge into this entry by identity — not by
   * `baseStackLength + 2`, which never becomes true once the stack is capped.
   */
  scrubEntry: HistoryEntry | null;
}

let scrubSession: ScrubSession | null = null;
let scrubPendingRaw: string | null = null;
let scrubRafHandle: ReturnType<typeof requestAnimationFrame> | null = null;

/** Test seam: replace rAF / cancel so unit tests can drive the throttle without a browser. */
let scrubScheduleFrame: (cb: () => void) => ReturnType<typeof requestAnimationFrame> = cb =>
  requestAnimationFrame(cb);
let scrubCancelFrame: (handle: ReturnType<typeof requestAnimationFrame>) => void = handle =>
  cancelAnimationFrame(handle);

/** @internal — tests only. */
export function _setScrubFrameSchedulerForTests(options: {
  schedule?: typeof scrubScheduleFrame;
  cancel?: typeof scrubCancelFrame;
} | null): void {
  if (options === null) {
    scrubScheduleFrame = cb => requestAnimationFrame(cb);
    scrubCancelFrame = handle => cancelAnimationFrame(handle);
    return;
  }
  if (options.schedule) scrubScheduleFrame = options.schedule;
  if (options.cancel) scrubCancelFrame = options.cancel;
}

function cancelScheduledScrubFlush(): void {
  if (scrubRafHandle !== null) {
    scrubCancelFrame(scrubRafHandle);
    scrubRafHandle = null;
  }
}

/**
 * Apply `raw` to the scrubbed number, recompute the dirty subgraph, and merge
 * into the scrub's single undo entry. Shared by the rAF flush and the forced
 * end-of-gesture flush.
 */
function commitScrubRaw(nodeId: NodeId, raw: string): void {
  const store = useDocumentStore.getState();
  const targetNode = store.document.nodes[nodeId];
  if (targetNode && targetNode.kind !== 'number') {
    throw new Error(`scrubNodeValue: node ${nodeId} is a ${targetNode.kind} node and is read-only`);
  }

  const topBefore = historyTop(store.undoStack);
  const locale = getDeviceLocale();

  // Coalesce every frame of this gesture into the entry opened by the first
  // mutation — not the 500ms keystroke window. A scrub held for seconds is still
  // one undo (§8.8). Amend-in-place so a full stack does not evict older history.
  const coalesceWithTop =
    scrubSession !== null &&
    scrubSession.nodeId === nodeId &&
    scrubSession.scrubEntry !== null &&
    topBefore === scrubSession.scrubEntry;

  store.applyCommand(
    (draft) => {
      const node = draft.nodes[nodeId];
      if (!node || node.kind !== 'number') return;
      node.raw = raw;
      if (node.chainId !== null) {
        const seed = [node.chainId] as const;
        recomputeFromSeeds(draft, seed, locale);
        for (const id of dirtyClosure(draft, seed)) {
          if (draft.chains[id]) reflowChain(draft, id);
        }
      }
    },
    { coalesceWithTop },
  );

  const topAfter = historyTop(useDocumentStore.getState().undoStack);
  if (topAfter === topBefore) {
    return; // no-op (raw unchanged)
  }

  if (scrubSession !== null && scrubSession.nodeId === nodeId) {
    scrubSession.scrubEntry = topAfter;
  }

  // Keep keystroke coalesce from merging with a just-finished scrub.
  lastRawEdit = null;
}

function flushPendingScrub(): void {
  cancelScheduledScrubFlush();
  if (scrubSession === null || scrubPendingRaw === null) return;
  const { nodeId } = scrubSession;
  const raw = scrubPendingRaw;
  scrubPendingRaw = null;
  commitScrubRaw(nodeId, raw);
}

function scheduleScrubFlush(): void {
  if (scrubRafHandle !== null) return;
  scrubRafHandle = scrubScheduleFrame(() => {
    scrubRafHandle = null;
    flushPendingScrub();
  });
}

/**
 * Open a scrub gesture on `nodeId` (§8.8). Suppresses autosave until
 * {@link endValueScrub}. Safe to call when already scrubbing the same node.
 */
export function beginValueScrub(nodeId: NodeId): void {
  if (scrubSession?.nodeId === nodeId) return;
  if (scrubSession !== null) {
    endValueScrub();
  }
  setAutosaveSuppressed(true);
  scrubSession = {
    nodeId,
    scrubEntry: null,
  };
  scrubPendingRaw = null;
  lastRawEdit = null;
}

/**
 * Queue a scrubbed raw value. Recompute runs at most once per animation frame
 * so a deep dirty subgraph cannot stall the thumb; the latest raw always wins.
 */
export function scrubNodeValue(nodeId: NodeId, raw: string): void {
  if (scrubSession === null || scrubSession.nodeId !== nodeId) {
    beginValueScrub(nodeId);
  }
  scrubPendingRaw = raw;
  scheduleScrubFlush();
}

/**
 * Release the scrub gesture: flush any pending frame, clear autosave suppress
 * (which reschedules a write if dirty), and close the coalesce session.
 */
export function endValueScrub(): void {
  flushPendingScrub();
  scrubSession = null;
  scrubPendingRaw = null;
  setAutosaveSuppressed(false);
}

/** True while a scrub gesture is open — tests and UI guards. */
export function isValueScrubbing(): boolean {
  return scrubSession !== null;
}

/** Clear-all (§8.5, decision #15): wipes every node and chain in one undo entry.
 *  The confirmation gate lives in the keypad (P2.10 swipe / P7.8 Clear all
 *  button) - this command trusts its caller and does not ask again, so it stays
 *  a plain, testable mutation. */
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
    // Stamp consumers first so they keep the last known value under §11.2 —
    // never cascade-delete references that pointed here (§11 / P6.4).
    deleteNodesLeavingDanglingRefs(draft, [nodeId], getDeviceLocale());

    if (chainId !== null) {
      const chain = draft.chains[chainId];
      if (chain) {
        chain.members = chain.members.filter((id) => id !== nodeId);
        finalizeChain(draft, chainId);
      }
    }
  });
}

/** Deletes every id in a Select-group set as one undo entry (§8.6: a group is how a
 *  chain is deleted as a unit). Empty input is a no-op. */
export function deleteGroup(ids: Iterable<NodeId>): void {
  const idList = Array.from(ids);
  if (idList.length === 0) return;
  useDocumentStore.getState().applyCommand((draft) => {
    const chainIds = new Set<ChainId>();
    for (const id of idList) {
      const node = draft.nodes[id];
      if (node?.chainId) chainIds.add(node.chainId);
    }
    deleteNodesLeavingDanglingRefs(draft, idList, getDeviceLocale());
    for (const chainId of chainIds) {
      const chain = draft.chains[chainId];
      if (!chain) continue;
      chain.members = chain.members.filter((id) => draft.nodes[id] !== undefined);
      finalizeChain(draft, chainId);
    }
  });
}

/**
 * Break a reference into a plain number, freezing the live (or last-known) value
 * (§8.6 `Unlink from parent`, §11.2 convert-to-number). One undo entry.
 * Distinct from {@link unlinkReference}, which deletes the reference (P6.3 cycle Unlink).
 */
export function unlinkFromParent(referenceId: NodeId): void {
  useDocumentStore.getState().applyCommand((draft) => {
    replaceReferenceWithNumber(draft, referenceId);
  });
}

/**
 * Re-point a reference at another value (§11.2). Clears any dangling stamp.
 * No-op when the new target is missing or not a value node.
 */
export function repointReference(referenceId: NodeId, newTargetId: NodeId): void {
  useDocumentStore.getState().applyCommand((draft) => {
    const ref = draft.nodes[referenceId];
    if (!ref || ref.kind !== 'reference') return;
    if (!isRepointTarget(newTargetId, draft.nodes, referenceId)) return;
    ref.targetNodeId = newTargetId;
    delete ref.lastKnownDisplay;
    if (ref.chainId !== null) {
      finalizeChain(draft, ref.chainId);
    }
  });
}

/** Shared body for unlink-from-parent / convert-dangling-to-number. Mutates `draft` in place. */
function replaceReferenceWithNumber(draft: CalcDocument, referenceId: NodeId): void {
  const ref = draft.nodes[referenceId];
  if (!ref || ref.kind !== 'reference') return;

  const locale = getDeviceLocale();
  const display =
    referenceDisplayText(ref, draft.nodes, locale) ||
    (isDanglingReference(ref, draft.nodes) ? (ref.lastKnownDisplay ?? '') : '');
  let raw = '';
  if (display !== '') {
    try {
      raw = parseComputedDisplay(display, locale).toFixed();
    } catch {
      // Unparseable stamp (e.g. an error explanation was somehow stored) — freeze
      // as empty rather than inventing a number the user never saw.
      raw = '';
    }
  }

  const number = createNumberNode({ ...ref.position }, raw);
  number.chainId = ref.chainId;
  if (ref.label !== undefined) number.label = ref.label;

  delete draft.nodes[referenceId];
  draft.nodes[number.id] = number;

  if (ref.chainId !== null) {
    const chain = draft.chains[ref.chainId];
    if (chain) {
      chain.members = chain.members.map((id) => (id === referenceId ? number.id : id));
      finalizeChain(draft, ref.chainId);
    }
  }
}

/**
 * Break a reference link by deleting the reference node (§11.2). Used by the
 * CircularReference Unlink affordance (P6.3) on the DFS closing edge. Long-press
 * `Unlink from parent` is {@link unlinkFromParent} (freeze as number) — a different
 * action. One undo entry via {@link deleteNode}.
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
      x: chain.anchor.x - widthOf(node, locale, usePreferencesStore.getState().numeralFontSize, draft.nodes),
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
        x: chain.anchor.x - widthOf(node, locale, usePreferencesStore.getState().numeralFontSize, draft.nodes),
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

/**
 * P6.7 / §11: insert a fresh reference to `resultId` into `chainId` at `index`.
 * Does not touch the result or its source chain. Anchor shifts left on index 0 the
 * same way `prependToChain` / `insertIntoChain` do for ordinary nodes.
 */
function placeReferenceInChain(
  draft: CalcDocument,
  resultId: NodeId,
  chainId: ChainId,
  index: number,
): NodeId | undefined {
  const result = draft.nodes[resultId];
  const chain = draft.chains[chainId];
  if (!result || result.kind !== 'result' || !chain) return undefined;
  // Defence in depth: probe keeps the result's chainId so own-chain is excluded,
  // but refuse here too if a stale outcome somehow targets it.
  if (result.chainId === chainId) return undefined;

  const reference = createReferenceNode({ x: 0, y: 0 }, resultId);
  draft.nodes[reference.id] = reference;
  reference.chainId = chainId;

  const clamped = Math.max(0, Math.min(index, chain.members.length));
  if (clamped === 0) {
    const locale = getDeviceLocale();
    chain.anchor = {
      x: chain.anchor.x - widthOf(reference, locale, usePreferencesStore.getState().numeralFontSize, draft.nodes),
      y: chain.anchor.y,
    };
  }
  chain.members.splice(clamped, 0, reference.id);
  finalizeChain(draft, chainId);
  return reference.id;
}

/**
 * P6.7: NEW_CHAIN where one side is the dragged result — partner joins a fresh chain
 * with a reference to R; R itself stays put. Anchor follows the same P3.5 rule as
 * `formNewChain`: release point when the result (now the reference) is the left member.
 */
function placeReferenceInNewChain(
  draft: CalcDocument,
  resultId: NodeId,
  outcome: Extract<SnapOutcome, { kind: 'newChain' }>,
  position?: Vec2,
): NodeId | undefined {
  const result = draft.nodes[resultId];
  if (!result || result.kind !== 'result') return undefined;
  if (outcome.leftId !== resultId && outcome.rightId !== resultId) return undefined;

  const partnerId = outcome.leftId === resultId ? outcome.rightId : outcome.leftId;
  const partner = draft.nodes[partnerId];
  if (!partner || partnerId === resultId) return undefined;

  removeFromCurrentChain(draft, partnerId);
  if (!draft.nodes[partnerId]) return undefined;

  const resultIsLeft = outcome.leftId === resultId;
  const anchor = resultIsLeft
    ? { x: (position ?? result.position).x, y: (position ?? result.position).y }
    : { x: partner.position.x, y: partner.position.y };

  const reference = createReferenceNode(
    resultIsLeft ? { ...anchor } : { x: 0, y: 0 },
    resultId,
  );
  draft.nodes[reference.id] = reference;

  const leftId = resultIsLeft ? reference.id : partnerId;
  const rightId = resultIsLeft ? partnerId : reference.id;

  const chainId = createChainId();
  draft.chains[chainId] = {
    id: chainId,
    anchor: { ...anchor },
    members: [leftId, rightId],
  };
  draft.nodes[leftId]!.chainId = chainId;
  draft.nodes[rightId]!.chainId = chainId;
  finalizeChain(draft, chainId);
  return reference.id;
}

/** P6.7 / §11 drag-to-link: snap-commit a dragged result as a reference to it.
 *  One undo entry. `snapping.ts` is untouched — only the commit substitutes a
 *  reference for the result node.
 *
 *  Selects the new reference afterward the same way typing/continuation already
 *  select what they just created (§8.5) — otherwise the drop leaves nothing
 *  selected, and the very next keypress (typically `=`, to finish the expression
 *  the reference was just dropped into) falls through to "nothing selected" and
 *  lands as a free node at the stale last tap point instead of continuing the
 *  chain the user just built. Caught live driving the P6 phase exit check. */
function commitResultDragAsReference(
  resultId: NodeId,
  outcome: SnapOutcome,
  position?: Vec2,
): void {
  let referenceId: NodeId | undefined;
  useDocumentStore.getState().applyCommand((draft) => {
    const result = draft.nodes[resultId];
    if (!result || result.kind !== 'result') return;

    switch (outcome.kind) {
      case 'prepend':
        referenceId = placeReferenceInChain(draft, resultId, outcome.chainId, 0);
        break;
      case 'append': {
        const chain = draft.chains[outcome.chainId];
        if (!chain) return;
        referenceId = placeReferenceInChain(draft, resultId, outcome.chainId, chain.members.length);
        break;
      }
      case 'insert':
        referenceId = placeReferenceInChain(draft, resultId, outcome.chainId, outcome.index);
        break;
      case 'newChain':
        referenceId = placeReferenceInNewChain(draft, resultId, outcome, position);
        break;
    }
  });
  if (referenceId) selectNode(referenceId);
}

/** Dispatch a P3.3 `SnapOutcome` onto the matching mutation command. One undo entry —
 *  each branch calls a single `applyCommand`. `position` is the drag release point in
 *  world units; required for NEW_CHAIN when the dragged node is the left member so the
 *  anchor is not taken from a stale store position (P3.5).
 *
 *  P6.7: when the dragged node is a result, insert a reference to it instead of moving
 *  the result (§11). Snapping itself is unchanged. */
export function commitSnapOutcome(
  nodeId: NodeId,
  outcome: SnapOutcome,
  position?: Vec2,
): void {
  const node = useDocumentStore.getState().document.nodes[nodeId];
  if (node?.kind === 'result') {
    commitResultDragAsReference(nodeId, outcome, position);
    return;
  }

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

/** Translate every unit in a multi-node selection by the same delta (§8.6 Select all).
 *  Chains move via `anchor` + reflow; free nodes via `position`. One undo entry.
 *  No-op when `delta` is zero. */
export function moveSelection(
  units: { chainIds: readonly ChainId[]; freeNodeIds: readonly NodeId[] },
  delta: Vec2,
): void {
  if (delta.x === 0 && delta.y === 0) return;
  useDocumentStore.getState().applyCommand((draft) => {
    for (const chainId of units.chainIds) {
      const chain = draft.chains[chainId];
      if (!chain) continue;
      chain.anchor = { x: chain.anchor.x + delta.x, y: chain.anchor.y + delta.y };
      reflowChain(draft, chainId);
    }
    for (const id of units.freeNodeIds) {
      const node = draft.nodes[id];
      if (!node || node.chainId !== null) continue;
      node.position = { x: node.position.x + delta.x, y: node.position.y + delta.y };
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
  useUiStore.getState().setAllSelected(false);
  // Prefer a result in the group as the keypad target so §8.7 continuation works
  // from the group-mode operator column without an extra tap. Otherwise keep the
  // tapped / long-pressed node as primary.
  const resultId = ids.find((id) => document.nodes[id]?.kind === 'result');
  useUiStore.getState().setSelectedNode(resultId ?? nodeId);
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

/** Selects every node on the canvas (§8.6 `Select all`). Ephemeral — same store
 *  as `Select group`; the document is not changed and no undo entry is recorded.
 *  Discards an abandoned empty number first so a leftover blank edit cell is not
 *  part of the selection. No-op when the canvas is already empty. */
export function selectAll(): void {
  discardIfAbandoned(null);
  const { document } = useDocumentStore.getState();
  const ids = Object.keys(document.nodes);
  if (ids.length === 0) return;

  useUiStore.getState().setGroupSelected(new Set(ids));
  useUiStore.getState().setAllSelected(true);
  useUiStore.getState().setEditingNode(null);
  useUiStore.getState().setEditingLabelNode(null);
  // Keep the current keypad target when it is still present; otherwise pick any
  // surviving node so the focus ring / keypad still have somewhere to land.
  const current = useUiStore.getState().selectedNodeId;
  const primary = current && document.nodes[current] ? current : ids[0];
  useUiStore.getState().setSelectedNode(primary);
}

/** Selects any node kind without entering edit mode - the target for keypad/hardware-keyboard
 *  input (P2.8, §8.5), but not itself a text field (§8.6). Replaces any prior
 *  `Select group` highlight — a single-node tap/key move is not a group selection. */
export function selectNode(nodeId: NodeId): void {
  discardIfAbandoned(nodeId);
  useUiStore.getState().clearGroupSelected();
  useUiStore.getState().setEditingNode(null);
  useUiStore.getState().setEditingLabelNode(null);
  useUiStore.getState().setSelectedNode(nodeId);
}

/** Selects a number node and opens its in-place text editor (§8.6, P2.6). */
export function editNumberNode(nodeId: NodeId): void {
  discardIfAbandoned(nodeId);
  useUiStore.getState().clearGroupSelected();
  useUiStore.getState().setEditingLabelNode(null);
  useUiStore.getState().setSelectedNode(nodeId);
  useUiStore.getState().setEditingNode(nodeId);
}

/**
 * Open the §8.8 value-slider popover for `nodeId`, from the cell menu's `Show slider`
 * item (P6b.3+). The slider no longer follows selection automatically - this is the
 * one path that raises it. Selects the node too, same as every other menu action that
 * targets a node, so the cell reads as the keypad target while its slider is open.
 */
export function showValueSlider(nodeId: NodeId): void {
  selectNode(nodeId);
  useUiStore.getState().openSlider(nodeId);
}

/** Clears selection and, if the node being edited is an empty number, discards it (§8.6). */
export function deselectNode(): void {
  discardIfAbandoned(null);
  useUiStore.getState().clearGroupSelected();
  useUiStore.getState().setSelectedNode(null);
  useUiStore.getState().setEditingNode(null);
  useUiStore.getState().setEditingLabelNode(null);
}

/** setNodeLabel coalescing window (§13): keystrokes to the same identity source
 *  within this many ms merge into one undo entry — same budget as {@link setNodeRaw}. */
const LABEL_EDIT_COALESCE_WINDOW_MS = 500;

let lastLabelEdit: { sourceId: NodeId; at: number; entry: HistoryEntry } | null =
  null;

/**
 * Set the caption on an identity (§11.1 / P6b.1). `nodeId` may be the declaring
 * value or any reference to it — the write always lands on the identity source
 * so every cell sharing that identity updates together, in one undo entry
 * (successive keystrokes within {@link LABEL_EDIT_COALESCE_WINDOW_MS} coalesce).
 * Empty string clears the label. No-op when `nodeId` is not a number, result,
 * or live reference to one.
 */
export function setNodeLabel(nodeId: NodeId, label: string): void {
  const store = useDocumentStore.getState();
  const sourceId = identitySourceId(store.document.nodes, nodeId);
  if (sourceId === null) return;

  // Store as typed so mid-edit spaces survive; empty string clears. Identity
  // grant still requires a non-empty caption via {@link nodeHasLabel}.
  const next = label.length > 0 ? label : undefined;

  const topBefore = historyTop(store.undoStack);
  const now = Date.now();
  const canCoalesce =
    lastLabelEdit !== null &&
    lastLabelEdit.sourceId === sourceId &&
    lastLabelEdit.entry === topBefore &&
    now - lastLabelEdit.at < LABEL_EDIT_COALESCE_WINDOW_MS;

  store.applyCommand(
    (draft) => {
      const node = draft.nodes[sourceId];
      if (!node || (node.kind !== 'number' && node.kind !== 'result')) return;
      if (next === undefined) {
        if (node.label === undefined) return;
        delete node.label;
      } else if (node.label === next) {
        return;
      } else {
        node.label = next;
      }
    },
    { coalesceWithTop: canCoalesce },
  );

  const topAfter = historyTop(useDocumentStore.getState().undoStack);
  if (topAfter === null || topAfter === topBefore) {
    return; // no-op (label unchanged, or source vanished mid-flight)
  }

  lastLabelEdit = {
    sourceId,
    at: now,
    entry: topAfter,
  };
}

/**
 * Open the in-place label editor on `nodeId` (§11.1). Resolves references to
 * their source so the TextInput sits on a declaring cell; still works when
 * invoked from a reference via the context menu (the write path looks through
 * identity either way). Clears number-raw editing so the two text fields never
 * compete for the same keystrokes. Switching from another node's label edit
 * finishes that one first (trim), mirroring {@link discardIfAbandoned} for raw.
 */
export function editNodeLabel(nodeId: NodeId): void {
  const nodes = useDocumentStore.getState().document.nodes;
  const sourceId = identitySourceId(nodes, nodeId);
  if (sourceId === null) return;
  const previousLabelId = useUiStore.getState().editingLabelNodeId;
  if (previousLabelId !== null && previousLabelId !== sourceId) {
    finishEditingLabel();
  }
  discardIfAbandoned(sourceId);
  useUiStore.getState().clearGroupSelected();
  useUiStore.getState().setEditingNode(null);
  useUiStore.getState().setSelectedNode(sourceId);
  useUiStore.getState().setEditingLabelNode(sourceId);
}

/** Finish an in-place label edit. Trims a leading/trailing-space draft into one
 *  last coalesced write so a whitespace-only caption does not linger. */
export function finishEditingLabel(): void {
  const id = useUiStore.getState().editingLabelNodeId;
  useUiStore.getState().setEditingLabelNode(null);
  if (!id) return;
  const node = useDocumentStore.getState().document.nodes[id];
  if (!node || node.label === undefined) return;
  const trimmed = node.label.trim();
  if (trimmed !== node.label) {
    setNodeLabel(id, trimmed);
  }
}
