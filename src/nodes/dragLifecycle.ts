// Pure drag-release decisions for §8.2. Kept free of React/Reanimated so the state machine
// can be table-tested without a gesture runtime (jest mocks RNGH — see journal 2026-08-03).
import { DETACH_DISTANCE } from '../chains/bounds';
import type { SnapOutcome } from '../chains/snapping';
import type { ChainId, NodeId, NodeKind, Vec2 } from '../model/types';

/** §8.2 MovingChain threshold (ms). Compared against time from touch-down (`onBegin`)
 *  to pan activation (`onStart`, after `minDistance` is crossed) — so it mixes still
 *  dwell with the time taken to move those first pixels, not pure hold-still time.
 *  Context menu is 500 ms (P2.9); this stays shorter so hold-then-drag and
 *  hold-for-menu don't collide. */
export const CHAIN_MOVE_HOLD_MS = 200;

/**
 * §8.3 / §17.1 mapping: long-press-then-drag moves the chain; plain drag detaches.
 * Flipping this boolean is the one-line remap the architecture calls out — try both
 * before locking the decision (P3.7).
 */
export const LONG_PRESS_MOVES_CHAIN = true;

export type NodeDragMode = 'free' | 'detachMember' | 'moveChain' | 'moveSelection';

/** Chains + free nodes implied by a group / select-all set (§8.6). */
export type SelectionUnits = {
  chainIds: ChainId[];
  freeNodeIds: NodeId[];
};

/** Collapse a set of selected node ids into moveable units: each distinct chain
 *  (moved via its anchor) and each free node (moved via its position). */
export function resolveSelectionUnits(
  selected: ReadonlySet<NodeId>,
  nodes: Record<NodeId, { chainId: ChainId | null }>,
): SelectionUnits {
  const chainIds = new Set<ChainId>();
  const freeNodeIds: NodeId[] = [];
  for (const id of selected) {
    const node = nodes[id];
    if (!node) continue;
    if (node.chainId !== null) chainIds.add(node.chainId);
    else freeNodeIds.push(id);
  }
  return { chainIds: [...chainIds], freeNodeIds };
}

/** True when a drag must translate more than one chain/free node — the Select all
 *  case. A single-chain `Select group` stays on the existing `moveChain` path. */
export function isMultiUnitSelection(units: SelectionUnits): boolean {
  return units.chainIds.length + units.freeNodeIds.length > 1;
}

export type DragReleaseDecision =
  | { kind: 'snap'; outcome: SnapOutcome }
  | { kind: 'detach'; position: Vec2 }
  | { kind: 'move'; position: Vec2 }
  | { kind: 'cancel' };

/** Euclidean distance in world units — thresholds are world-space (§7, §8.2). */
export function worldDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** True once a chained member has been dragged at least `DETACH_DISTANCE` from its
 *  home slot. Uses `>=` so the detach edge is inclusive; snap uses strict `<`, and
 *  `DETACH_DISTANCE > SNAP_DISTANCE` is what creates hysteresis (§8.2). */
export function crossedDetachDistance(home: Vec2, current: Vec2): boolean {
  return worldDistance(home, current) >= DETACH_DISTANCE;
}

/**
 * Decide whether this press is a free-node move, a member detach, or a whole-chain move.
 *
 * Precedence (deliberate, P2.9 / P3.7):
 * 1. Free node → always `free`.
 * 2. `Select group` includes this node → `moveChain` (§8.6 other route).
 * 3. Context menu already claimed the press → never `moveChain` (menu wins at 500 ms).
 * 4. Otherwise the §17.1 mapping (`LONG_PRESS_MOVES_CHAIN`), using `heldMs` from
 *    touch-down to pan activation (see `CHAIN_MOVE_HOLD_MS`).
 */
export function resolveNodeDragMode(args: {
  wasChained: boolean;
  /** ms from touch-down to pan activation — see `CHAIN_MOVE_HOLD_MS`. */
  heldMs: number;
  groupSelected: boolean;
  contextMenuOpen: boolean;
  /** Override for the §17.1 A/B trial; defaults to `LONG_PRESS_MOVES_CHAIN`. */
  longPressMovesChain?: boolean;
}): NodeDragMode {
  if (!args.wasChained) return 'free';
  if (args.groupSelected) return 'moveChain';
  if (args.contextMenuOpen) return 'detachMember';

  const longPressMovesChain = args.longPressMovesChain ?? LONG_PRESS_MOVES_CHAIN;
  const heldLong = args.heldMs >= CHAIN_MOVE_HOLD_MS;
  if (longPressMovesChain) {
    return heldLong ? 'moveChain' : 'detachMember';
  }
  return heldLong ? 'detachMember' : 'moveChain';
}

/**
 * `chainId` written onto the mid-drag snap probe (§8.2 / P6.7).
 *
 * Ordinary members null out once past `DETACH_DISTANCE` so the vacated chain can
 * become a neighbour again (hysteresis stops an immediate re-snap). Results keep
 * their store `chainId` even when "detached" in the session — own-chain stays
 * excluded from candidates, and a miss cancels rather than freeing R.
 */
export function snapProbeChainId(args: {
  storeChainId: ChainId | null;
  detached: boolean;
  kind: NodeKind;
}): ChainId | null {
  if (args.detached && args.kind !== 'result') return null;
  return args.storeChainId;
}

/** Map end-of-drag geometry onto a single commit action for free / detachMember modes.
 *  `moveChain` / `moveSelection` commits are handled by the gesture (anchor/positions
 *  += delta) and never go through snap/detach.
 *
 *  - A snap candidate always wins (P3.3 already applied hysteresis / nearest).
 *  - A chained member that crossed detach with no candidate becomes free at `position`,
 *    except a **result** (P6.7): miss cancels so the source chain keeps R.
 *  - A free node with no candidate just moves.
 *  - A chained member that never crossed detach and has no candidate cancels: the
 *    finger releases and the node stays in its chain (no store write). */
export function decideDragRelease(args: {
  wasChained: boolean;
  detached: boolean;
  candidate: SnapOutcome | null;
  position: Vec2;
  /** P6.7: results are never free-floating — a miss cancels instead of detaching. */
  isResult?: boolean;
}): DragReleaseDecision {
  if (args.candidate) {
    return { kind: 'snap', outcome: args.candidate };
  }
  if (args.wasChained && args.detached) {
    if (args.isResult) return { kind: 'cancel' };
    return { kind: 'detach', position: args.position };
  }
  if (!args.wasChained) {
    return { kind: 'move', position: args.position };
  }
  return { kind: 'cancel' };
}
