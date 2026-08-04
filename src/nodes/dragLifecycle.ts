// Pure drag-release decisions for §8.2. Kept free of React/Reanimated so the state machine
// can be table-tested without a gesture runtime (jest mocks RNGH — see journal 2026-08-03).
import { DETACH_DISTANCE } from '../chains/bounds';
import type { SnapOutcome } from '../chains/snapping';
import type { Vec2 } from '../model/types';

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

/** Map end-of-drag geometry onto a single commit action.
 *
 *  - A snap candidate always wins (P3.3 already applied hysteresis / nearest).
 *  - A chained member that crossed detach with no candidate becomes free at `position`.
 *  - A free node with no candidate just moves.
 *  - A chained member that never crossed detach and has no candidate cancels: the
 *    finger releases and the node stays in its chain (no store write). */
export function decideDragRelease(args: {
  wasChained: boolean;
  detached: boolean;
  candidate: SnapOutcome | null;
  position: Vec2;
}): DragReleaseDecision {
  if (args.candidate) {
    return { kind: 'snap', outcome: args.candidate };
  }
  if (args.wasChained && args.detached) {
    return { kind: 'detach', position: args.position };
  }
  if (!args.wasChained) {
    return { kind: 'move', position: args.position };
  }
  return { kind: 'cancel' };
}
