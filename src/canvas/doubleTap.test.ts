import { DOUBLE_TAP_WINDOW_MS, noteCellTap } from './doubleTap';

describe('noteCellTap', () => {
  test('first tap on a cell is not a double-tap and records a stride', () => {
    const result = noteCellTap(null, 'a', 1000);
    expect(result.isDoubleTap).toBe(false);
    expect(result.next).toEqual({ nodeId: 'a', atMs: 1000 });
  });

  test('second tap on the same cell within the window is a double-tap', () => {
    const first = noteCellTap(null, 'a', 1000);
    const second = noteCellTap(first.next, 'a', 1000 + DOUBLE_TAP_WINDOW_MS);
    expect(second.isDoubleTap).toBe(true);
    expect(second.next).toBeNull();
  });

  test('second tap after the window is a fresh single tap', () => {
    const first = noteCellTap(null, 'a', 1000);
    const second = noteCellTap(first.next, 'a', 1000 + DOUBLE_TAP_WINDOW_MS + 1);
    expect(second.isDoubleTap).toBe(false);
    expect(second.next).toEqual({ nodeId: 'a', atMs: 1000 + DOUBLE_TAP_WINDOW_MS + 1 });
  });

  test('second tap on a different cell is not a double-tap', () => {
    const first = noteCellTap(null, 'a', 1000);
    const second = noteCellTap(first.next, 'b', 1100);
    expect(second.isDoubleTap).toBe(false);
    expect(second.next).toEqual({ nodeId: 'b', atMs: 1100 });
  });

  test('a third tap after a completed double starts a new stride', () => {
    const first = noteCellTap(null, 'a', 1000);
    const second = noteCellTap(first.next, 'a', 1200);
    expect(second.isDoubleTap).toBe(true);
    const third = noteCellTap(second.next, 'a', 1300);
    expect(third.isDoubleTap).toBe(false);
    expect(third.next).toEqual({ nodeId: 'a', atMs: 1300 });
  });
});
