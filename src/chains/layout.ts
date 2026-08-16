// Chain layout pass. See docs/ARCHITECTURE.md §8.1 (the flush left-to-right algorithm)
// and §6.1 (`members` order is the truth and is never re-derived from `x`).
//
// Pure: no store access, no React. Store-side callers (store/commands.ts) are the ones
// that write the returned positions back onto draft nodes, inside the same command that
// changed `members` or a member's `raw` — this module only computes where things go.
//
// P3.6's `insertionFeedback` lives here too: mid-drag gap/caret geometry for §8.3, still
// pure over plain data — NodeLayer applies the offsets as transforms; the document is
// untouched until release.
import type { CalcNode, Chain, ChainId, NodeId, Vec2 } from '../model/types';
import { tokens } from '../ui/tokens';
import type { SnapOutcome } from './snapping';
import { widthOf } from './measure';

/** Lays `chain.members` out flush, left to right, from `chain.anchor`, per §8.1:
 *  `x = anchor.x`, then each member advances `x` by its own `widthOf`. Reads `members`
 *  in stored order — the array is the truth (§6.1); this never sorts by an existing
 *  `position.x`, so a rendering bug or floating-point drift can't reorder a formula.
 *
 *  A member id with no matching entry in `nodes` (deleted but not yet pruned from
 *  `members`) is skipped rather than throwing — layout is a read pass over whatever
 *  state it's given, not the place that enforces `members` consistency.
 *
 *  Returns a fresh position per member; callers write it onto the node themselves.
 *  `position` is a cache (§8.1) — `chain.anchor` + `chain.members` remain the truth. */
export function layoutChain(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  /** Live numeral font size (§1.2 P7 preference); defaults to the compiled-in
   *  token, same as `widthOf`'s own matching parameter this passes through to. */
  fontSize: number = tokens.numeralFontSize,
): Record<NodeId, Vec2> {
  const positions: Record<NodeId, Vec2> = {};
  let x = chain.anchor.x;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    positions[memberId] = { x, y: chain.anchor.y };
    x += widthOf(member, locale, fontSize, nodes);
  }
  return positions;
}

/** World-space caret drawn at a pending snap slot (§8.3). Coordinates are the caret's
 *  top-left; height matches `nodeHeight` so it reads as a cell edge. */
export interface InsertionCaret {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ephemeral drag preview: where the caret sits and which nodes translate to open the
 *  gap. Offsets are additive to the store's cached `position` — never written back. */
export interface InsertionFeedback {
  caret: InsertionCaret | null;
  /** World-space delta per node that must move to reveal the pending slot. Empty when
   *  `candidate` is null so the gap closes with no residual offset (no visual jump).
   *  Usually `{ x: gap, y: 0 }`; `newChain` with the dragged node as left also carries a
   *  `y` so the partner tracks the live release row (matching `formNewChain`'s anchor). */
  offsets: Record<NodeId, Vec2>;
}

const EMPTY_FEEDBACK: InsertionFeedback = { caret: null, offsets: {} };

function chainWithoutDragged(chain: Chain, draggedId: NodeId): Chain {
  if (!chain.members.includes(draggedId)) return chain;
  return { ...chain, members: chain.members.filter((id) => id !== draggedId) };
}

function caretAt(x: number, y: number): InsertionCaret {
  return {
    x,
    y,
    width: Math.max(tokens.borderBand, 4),
    height: tokens.nodeHeight,
  };
}

function chainRight(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  fontSize: number,
): number {
  let x = chain.anchor.x;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    x += widthOf(member, locale, fontSize, nodes);
  }
  return x;
}

/** Shift every member at `members[index]` and after by `gap`, mirroring an interior
 *  insert (and the rightward half of a new-chain seed). Missing ids are skipped. */
function shiftFromIndex(
  members: readonly NodeId[],
  index: number,
  gap: number,
  offsets: Record<NodeId, Vec2>,
): void {
  for (let i = index; i < members.length; i += 1) {
    const id = members[i];
    if (id === undefined) continue;
    offsets[id] = { x: gap, y: 0 };
  }
}

/**
 * Mid-drag insertion preview for §8.3. Given the live snap candidate and the dragged
 * node, returns the caret rect and the temporary `translateX` each affected node needs
 * so the chain (or free partner) opens a gap the size of `widthOf(dragged)`.
 *
 * Geometry matches the P3.4 commit rules (journal 2026-08-04 revision 5):
 * - **prepend** — gap on the left; existing members stay put; caret at `anchor.x − gap`.
 * - **append** — gap on the right; members stay put; caret at the current right edge.
 * - **insert(i)** — members at `i` and after shift right by `gap`; caret at the old
 *   boundary (left edge of the opened slot).
 * - **newChain** — stationary partner stays when it is left; when the dragged node is
 *   left, the partner previews at `livePosition + gap` (matching `formNewChain`'s
 *   release-point anchor), not at its own store home.
 *
 * Returns empty feedback when `candidate` is null — caret and offsets both gone, so
 * dropping out of range closes the gap without a jump.
 */
export function insertionFeedback(
  candidate: SnapOutcome | null,
  dragged: CalcNode,
  chains: Record<ChainId, Chain>,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  /** Live world position of the dragged node this frame. Required for jump-free
   *  `newChain` when the dragged node becomes leftmost — `formNewChain` anchors at
   *  the release point, not the store's stale home. Falls back to `dragged.position`. */
  livePosition?: Vec2,
  /** Live numeral font size (§1.2 P7 preference); defaults to the compiled-in
   *  token, same as `widthOf`'s own matching parameter this passes through to. */
  fontSize: number = tokens.numeralFontSize,
): InsertionFeedback {
  if (!candidate) return EMPTY_FEEDBACK;

  const gap = widthOf(dragged, locale, fontSize, nodes);
  if (gap <= 0) return EMPTY_FEEDBACK;

  const live = livePosition ?? dragged.position;
  const offsets: Record<NodeId, Vec2> = {};

  switch (candidate.kind) {
    case 'prepend': {
      const raw = chains[candidate.chainId];
      if (!raw) return EMPTY_FEEDBACK;
      const chain = chainWithoutDragged(raw, dragged.id);
      // Members keep their world x — same as prependToChain shifting the anchor left.
      return {
        caret: caretAt(chain.anchor.x - gap, chain.anchor.y),
        offsets,
      };
    }
    case 'append': {
      const raw = chains[candidate.chainId];
      if (!raw) return EMPTY_FEEDBACK;
      const chain = chainWithoutDragged(raw, dragged.id);
      return {
        caret: caretAt(chainRight(chain, nodes, locale, fontSize), chain.anchor.y),
        offsets,
      };
    }
    case 'insert': {
      const raw = chains[candidate.chainId];
      if (!raw) return EMPTY_FEEDBACK;
      const chain = chainWithoutDragged(raw, dragged.id);
      const index = Math.max(0, Math.min(candidate.index, chain.members.length));
      // Walk to the insertion boundary the same way memberBoundaries does.
      let boundaryX = chain.anchor.x;
      for (let i = 0; i < index; i += 1) {
        const member = nodes[chain.members[i]];
        if (!member) continue;
        boundaryX += widthOf(member, locale, fontSize, nodes);
      }
      if (index === 0) {
        // Same geometry as prepend: gap opens on the left, members stay.
        return {
          caret: caretAt(boundaryX - gap, chain.anchor.y),
          offsets,
        };
      }
      shiftFromIndex(chain.members, index, gap, offsets);
      return {
        caret: caretAt(boundaryX, chain.anchor.y),
        offsets,
      };
    }
    case 'newChain': {
      const partnerId =
        candidate.leftId === dragged.id ? candidate.rightId : candidate.leftId;
      const partner = nodes[partnerId];
      if (!partner) return EMPTY_FEEDBACK;

      if (candidate.leftId === dragged.id) {
        // Dragged becomes leftmost: formNewChain anchors at the live release point
        // (P3.5), so the partner must preview at live + gap — not at its own home + gap.
        // Using the store home here was the jump the review on PR #63 caught.
        const partnerAt = { x: live.x + gap, y: live.y };
        offsets[partnerId] = {
          x: partnerAt.x - partner.position.x,
          y: partnerAt.y - partner.position.y,
        };
        return {
          caret: caretAt(partnerAt.x, partnerAt.y),
          offsets,
        };
      }
      // Partner stays left; caret at its right edge where the dragged node will land.
      return {
        caret: caretAt(partner.position.x + widthOf(partner, locale, fontSize, nodes), partner.position.y),
        offsets,
      };
    }
  }
}
