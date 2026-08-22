// Auto-pan-to-edited-cell (§7 P7 follow-up, §12.5 opt-out). Pure geometry only — no store,
// no Reanimated — so the "does this need a pan, and by how much" question is testable
// directly; Canvas.tsx's `panIntoView` only drives the shared values and store commit from
// this function's result.
//
// User-reported gap: the on-screen keypad no longer drags the whole page when a cell is
// added or edited near the canvas edge (2026-08-21's `preventScroll` fix), but nothing
// replaced the *usefulness* of that old, accidental behaviour — an edge cell being typed
// into can still sit partly or fully outside the visible canvas, with nothing bringing it
// into view. This computes the pan (not the keypad, not the page) that fixes that.
import { Vec2 } from '../model/types';

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportState {
  pan: Vec2;
  zoom: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** Fixed screen-space gap (dp) kept between an edited cell and the visible canvas edge —
 *  independent of zoom, like every other spacing token in this app (§1.2), rather than a
 *  world-space distance that would look tighter or looser depending on how zoomed in the
 *  canvas happens to be. */
export const AUTO_PAN_PADDING = 24;

/**
 * Returns the `pan` needed so `rect` (world space) sits fully within the canvas's own
 * screen bounds (`canvasSize`, i.e. `Canvas`'s own laid-out size — already excludes the
 * keypad, which shares the flex column with it rather than overlaying it), padded by
 * `AUTO_PAN_PADDING` on whichever edge(s) it currently violates. Returns `null` when `rect`
 * already fits (no pan needed) or `canvasSize` hasn't been measured yet (a 0×0 layout).
 *
 * Only the violated axis moves, and only just enough to clear the padding — a cell already
 * comfortably inside the padded bounds keeps its pan untouched on that axis, and a chain
 * wider or taller than the padded viewport (rare, but not impossible with a long formula)
 * pins whichever edge it overflowed rather than trying to fit both at once.
 */
export function computeAutoPanTarget(
  rect: WorldRect,
  viewport: ViewportState,
  canvasSize: CanvasSize,
): Vec2 | null {
  const { width: cw, height: ch } = canvasSize;
  if (cw <= 0 || ch <= 0) return null;
  const { pan, zoom } = viewport;

  const left = (rect.x - pan.x) * zoom;
  const top = (rect.y - pan.y) * zoom;
  const right = left + rect.width * zoom;
  const bottom = top + rect.height * zoom;

  let dxScreen = 0;
  if (left < AUTO_PAN_PADDING) dxScreen = left - AUTO_PAN_PADDING;
  else if (right > cw - AUTO_PAN_PADDING) dxScreen = right - (cw - AUTO_PAN_PADDING);

  let dyScreen = 0;
  if (top < AUTO_PAN_PADDING) dyScreen = top - AUTO_PAN_PADDING;
  else if (bottom > ch - AUTO_PAN_PADDING) dyScreen = bottom - (ch - AUTO_PAN_PADDING);

  if (dxScreen === 0 && dyScreen === 0) return null;

  return {
    x: pan.x + dxScreen / zoom,
    y: pan.y + dyScreen / zoom,
  };
}
