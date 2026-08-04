// Snap candidate resolution. See docs/ARCHITECTURE.md §8.2 (thresholds) and §8.3
// (the gather-and-keep-nearest pseudocode).
//
// Pure: given a dragged node and a neighbour query (P3.2), return the single best
// snap outcome for this frame, or null. Thresholds are the named world-unit constants
// from bounds.ts — never inlined here, so a later tweak to SNAP_DISTANCE cannot drift
// between gather and resolve. Call sites of `SnappingNeighbours` do not change when
// §8.4's spatial hash lands behind that interface.
import type { CalcNode, Chain, ChainId, NodeId } from '../model/types';
import {
  SNAP_DISTANCE,
  boundsOf,
  memberBoundaries,
  type SnappingNeighbours,
} from './bounds';
import { widthOf } from './measure';

export type SnapOutcome =
  | { kind: 'prepend'; chainId: ChainId }
  | { kind: 'append'; chainId: ChainId }
  | { kind: 'insert'; chainId: ChainId; index: number }
  | { kind: 'newChain'; leftId: NodeId; rightId: NodeId };

interface RankedCandidate {
  outcome: SnapOutcome;
  /** Horizontal distance that passed the `< SNAP_DISTANCE` check. Nearest wins (§8.3). */
  distance: number;
}

function chainExtent(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): { left: number; right: number } | null {
  let width = 0;
  let any = false;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    any = true;
    width += widthOf(member, locale);
  }
  if (!any) return null;
  return { left: chain.anchor.x, right: chain.anchor.x + width };
}

function consider(candidates: RankedCandidate[], distance: number, outcome: SnapOutcome): void {
  // Strict `<`, matching §8.3. Distance equal to SNAP_DISTANCE is outside.
  if (distance >= SNAP_DISTANCE) return;
  candidates.push({ outcome, distance });
}

/** Gather §8.3 candidates for `dragged` and return the nearest, or `null` if none
 *  are in range. `neighbours` is the P3.2 interface — already filtered to chains /
 *  free nodes within `SNAP_VERTICAL` and excluding the dragged node's own chain /
 *  itself — so this function only does the horizontal side of the search.
 *
 *  On equal distance, the first candidate gathered wins (chain prepend → append →
 *  inserts in left-to-right boundary order, then free-node new-chains). The
 *  architecture does not specify a tie-break; stable gather order is enough for
 *  tests and for a deterministic caret. */
export function resolveSnapCandidate(
  dragged: CalcNode,
  neighbours: SnappingNeighbours,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): SnapOutcome | null {
  const draggedBounds = boundsOf(dragged, locale);
  const centerX = (draggedBounds.left + draggedBounds.right) / 2;
  const candidates: RankedCandidate[] = [];

  for (const chain of neighbours.chainsNear(dragged)) {
    const extent = chainExtent(chain, nodes, locale);
    if (!extent) continue;

    consider(candidates, Math.abs(draggedBounds.right - extent.left), {
      kind: 'prepend',
      chainId: chain.id,
    });
    consider(candidates, Math.abs(draggedBounds.left - extent.right), {
      kind: 'append',
      chainId: chain.id,
    });

    for (const boundary of memberBoundaries(chain, nodes, locale)) {
      consider(candidates, Math.abs(centerX - boundary.x), {
        kind: 'insert',
        chainId: chain.id,
        index: boundary.index,
      });
    }
  }

  for (const free of neighbours.freeNodesNear(dragged)) {
    const freeBounds = boundsOf(free, locale);
    consider(candidates, Math.abs(draggedBounds.left - freeBounds.right), {
      kind: 'newChain',
      leftId: free.id,
      rightId: dragged.id,
    });
    consider(candidates, Math.abs(draggedBounds.right - freeBounds.left), {
      kind: 'newChain',
      leftId: dragged.id,
      rightId: free.id,
    });
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].distance < best.distance) {
      best = candidates[i];
    }
  }
  return best.outcome;
}
