import fc from 'fast-check';
import { isCanonicalRaw, splitRaw } from './numeric';

describe('isCanonicalRaw', () => {
  test.each(['', '-', '0', '3.', '.5', '-0.5', '1221', '-.'])('%s is canonical', (raw) => {
    expect(isCanonicalRaw(raw)).toBe(true);
  });

  test.each(['+5', '1.2.3', '--5', '1,5', '1 5', 'abc', '5-'])('%s is not canonical', (raw) => {
    expect(isCanonicalRaw(raw)).toBe(false);
  });
});

describe('splitRaw', () => {
  test('splits sign, integer, point and fraction', () => {
    expect(splitRaw('-12.5')).toEqual({ sign: '-', integer: '12', hasPoint: true, fraction: '5' });
  });

  test.each([
    ['', { sign: '', integer: '', hasPoint: false, fraction: '' }],
    ['-', { sign: '-', integer: '', hasPoint: false, fraction: '' }],
    ['3.', { sign: '', integer: '3', hasPoint: true, fraction: '' }],
    ['.5', { sign: '', integer: '', hasPoint: true, fraction: '5' }],
  ] as const)('splitRaw(%j)', (raw, expected) => {
    expect(splitRaw(raw)).toEqual(expected);
  });

  test('throws on non-canonical input', () => {
    expect(() => splitRaw('1,5')).toThrow();
  });

  test('never throws for anything isCanonicalRaw accepts', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^-?\d{0,6}\.?\d{0,6}$/), (raw) => {
        fc.pre(isCanonicalRaw(raw));
        expect(() => splitRaw(raw)).not.toThrow();
      }),
    );
  });
});
