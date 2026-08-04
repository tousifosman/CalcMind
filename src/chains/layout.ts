// Chain layout pass. See docs/ARCHITECTURE.md §8.1 (the flush left-to-right algorithm)
// and §6.1 (`members` order is the truth and is never re-derived from `x`).
//
// Pure: no store access, no React. Store-side callers (store/commands.ts) are the ones
// that write the returned positions back onto draft nodes, inside the same command that
// changed `members` or a member's `raw` — this module only computes where things go.
import type { CalcNode, Chain, NodeId, Vec2 } from '../model/types';
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
): Record<NodeId, Vec2> {
  const positions: Record<NodeId, Vec2> = {};
  let x = chain.anchor.x;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    positions[memberId] = { x, y: chain.anchor.y };
    x += widthOf(member, locale);
  }
  return positions;
}
