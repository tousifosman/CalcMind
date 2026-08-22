import { computeAutoPanTarget, AUTO_PAN_PADDING } from './autoPan';

const VIEWPORT_IDLE = { pan: { x: 0, y: 0 }, zoom: 1 };
const CANVAS = { width: 400, height: 800 };

describe('computeAutoPanTarget', () => {
  test('returns null when the rect already sits fully within the padded bounds', () => {
    const rect = { x: 100, y: 100, width: 50, height: 40 };
    expect(computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS)).toBeNull();
  });

  test('returns null when canvasSize has not been measured yet (0×0 layout)', () => {
    const rect = { x: -1000, y: -1000, width: 50, height: 40 };
    expect(computeAutoPanTarget(rect, VIEWPORT_IDLE, { width: 0, height: 0 })).toBeNull();
  });

  test('pans right (increases pan.x) when the rect sits off the left edge', () => {
    // Screen-left = (x - pan.x) * zoom = -20, short of the 24dp padding by 44.
    const rect = { x: -20, y: 100, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    expect(target).toEqual({ x: -44, y: 0 });
    // Verify the invariant directly: the rect's new screen-left sits exactly at the padding.
    const newLeft = (rect.x - target!.x) * VIEWPORT_IDLE.zoom;
    expect(newLeft).toBe(AUTO_PAN_PADDING);
  });

  test('pans left (decreases pan.x) when the rect sits off the right edge', () => {
    // Screen-right = (x + width - pan.x) * zoom = 420, past (400 - 24) = 376 by 44.
    const rect = { x: 370, y: 100, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    expect(target).toEqual({ x: 44, y: 0 });
    const newRight = (rect.x + rect.width - target!.x) * VIEWPORT_IDLE.zoom;
    expect(newRight).toBe(CANVAS.width - AUTO_PAN_PADDING);
  });

  test('pans down (increases pan.y) when the rect sits off the top edge', () => {
    const rect = { x: 100, y: -30, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    expect(target).toEqual({ x: 0, y: -54 });
  });

  test('pans up (decreases pan.y) when the rect sits off the bottom edge', () => {
    // Screen-bottom = (y + height) * zoom = 820, past (800 - 24) = 776 by 44.
    const rect = { x: 100, y: 780, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    expect(target).toEqual({ x: 0, y: 44 });
  });

  test('handles simultaneous horizontal and vertical overflow independently', () => {
    const rect = { x: -20, y: -30, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    expect(target).toEqual({ x: -44, y: -54 });
  });

  test('a rect exactly at the padding boundary needs no pan (not < / > , the boundary itself is fine)', () => {
    // Screen-left exactly AUTO_PAN_PADDING, screen-right exactly (width - AUTO_PAN_PADDING).
    const rect = { x: AUTO_PAN_PADDING, y: 100, width: CANVAS.width - 2 * AUTO_PAN_PADDING, height: 40 };
    expect(computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS)).toBeNull();
  });

  test('scales the world-space delta by zoom — same screen shortfall, smaller world pan at 2x zoom', () => {
    const viewport = { pan: { x: 0, y: 0 }, zoom: 2 };
    // Screen-left = (10 - 0) * 2 = 20, short of padding (24) by 4 screen px → 2 world units.
    const rect = { x: 10, y: 100, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, viewport, CANVAS);
    expect(target).toEqual({ x: -2, y: 0 });
  });

  test('accounts for a non-zero existing pan, not just world-origin-relative position', () => {
    const viewport = { pan: { x: 500, y: 0 }, zoom: 1 };
    // World rect at x=480 is screen x = (480 - 500) = -20 — off the left edge again.
    const rect = { x: 480, y: 100, width: 50, height: 40 };
    const target = computeAutoPanTarget(rect, viewport, CANVAS);
    expect(target).toEqual({ x: 456, y: 0 });
  });

  test('a rect wider than the padded viewport pins the violated edge instead of centring', () => {
    // width 500 > (400 - 2*24); rect starts off the left edge, so the left check wins.
    const rect = { x: -50, y: 100, width: 500, height: 40 };
    const target = computeAutoPanTarget(rect, VIEWPORT_IDLE, CANVAS);
    const newLeft = (rect.x - target!.x) * VIEWPORT_IDLE.zoom;
    expect(newLeft).toBe(AUTO_PAN_PADDING);
  });
});
