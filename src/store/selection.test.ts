import { isEntireCanvasSelected } from './selection';

describe('isEntireCanvasSelected', () => {
  test('empty canvas is false', () => {
    expect(isEntireCanvasSelected(new Set(), {})).toBe(false);
    expect(isEntireCanvasSelected(new Set(['a']), {})).toBe(false);
  });

  test('true only when every node id is in the group set', () => {
    const nodes = { a: {}, b: {}, c: {} };
    expect(isEntireCanvasSelected(new Set(['a', 'b', 'c']), nodes)).toBe(true);
    expect(isEntireCanvasSelected(new Set(['a', 'b']), nodes)).toBe(false);
    expect(isEntireCanvasSelected(new Set(['a', 'b', 'c', 'ghost']), nodes)).toBe(false);
  });
});
