// Double-tap / double-click detection for canvas cells (§8.6).
//
// Kept as a pure stride helper (not a Gesture.Tap().numberOfTaps(2) Exclusive
// pair) so a single tap still fires immediately — Exclusive would defer every
// select/edit until the double-tap window fails, which makes the canvas feel
// laggy. The second tap within the window upgrades to `selectGroup`.
import type { NodeId } from '../model/types';

/** Max gap between two taps on the same cell that still counts as a double-tap. */
export const DOUBLE_TAP_WINDOW_MS = 300;

export interface CellTapStride {
  nodeId: NodeId;
  atMs: number;
}

/** Returns whether this tap completes a double-tap on `nodeId`, plus the stride
 *  to keep for the next call (`null` after a completed double or a miss). */
export function noteCellTap(
  previous: CellTapStride | null,
  nodeId: NodeId,
  nowMs: number,
  windowMs: number = DOUBLE_TAP_WINDOW_MS,
): { isDoubleTap: boolean; next: CellTapStride | null } {
  if (previous !== null && previous.nodeId === nodeId && nowMs - previous.atMs <= windowMs) {
    return { isDoubleTap: true, next: null };
  }
  return { isDoubleTap: false, next: { nodeId, atMs: nowMs } };
}
