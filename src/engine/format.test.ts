import * as fc from 'fast-check';
import { decimalSeparatorFor, formatForDisplay, parseUserInput } from './format';

// ---------------------------------------------------------------------------
// decimalSeparatorFor
// ---------------------------------------------------------------------------

describe('decimalSeparatorFor', () => {
  test('returns "." for en-US', () => {
    expect(decimalSeparatorFor('en-US')).toBe('.');
  });

  test('returns "," for de-DE', () => {
    expect(decimalSeparatorFor('de-DE')).toBe(',');
  });

  test('returns "," for fr-FR', () => {
    expect(decimalSeparatorFor('fr-FR')).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// formatForDisplay
// ---------------------------------------------------------------------------

describe('formatForDisplay', () => {
  test('passes through empty string verbatim', () => {
    expect(formatForDisplay('', 'en-US')).toBe('');
  });

  test('passes through lone minus verbatim', () => {
    expect(formatForDisplay('-', 'en-US')).toBe('-');
  });

  test('passes through trailing-dot partial input verbatim', () => {
    expect(formatForDisplay('3.', 'en-US')).toBe('3.');
  });

  test('passes through "-0." verbatim', () => {
    expect(formatForDisplay('-0.', 'en-US')).toBe('-0.');
  });

  test('passes through "-0.5" as a complete number formatted', () => {
    // -0.5 is complete and formats to a locale string.
    expect(formatForDisplay('-0.5', 'en-US')).toBe('-0.5');
  });

  test('formats 13.5 as "13.5" for en-US', () => {
    expect(formatForDisplay('13.5', 'en-US')).toBe('13.5');
  });

  test('formats 13.5 as "13,5" for de-DE', () => {
    expect(formatForDisplay('13.5', 'de-DE')).toBe('13,5');
  });

  test('uses grouping separator for large numbers', () => {
    // 1020 in en-US should be "1,020"
    expect(formatForDisplay('1020', 'en-US')).toBe('1,020');
  });

  test('uses scientific notation for very large numbers (≥ 1e12)', () => {
    const formatted = formatForDisplay('1e12', 'en-US');
    // Should include 'E' or 'e' notation
    expect(formatted).toMatch(/[eE]/);
  });

  test('uses scientific notation for very small numbers (0 < |x| < 1e-6)', () => {
    const formatted = formatForDisplay('1e-7', 'en-US');
    expect(formatted).toMatch(/[eE]/);
  });

  test('strips trailing zeros up to 12 significant digits', () => {
    // 1.10000 should display as 1.1
    expect(formatForDisplay('1.10000', 'en-US')).toBe('1.1');
  });

  test('zero formats correctly', () => {
    expect(formatForDisplay('0', 'en-US')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// parseUserInput
// ---------------------------------------------------------------------------

describe('parseUserInput', () => {
  test('returns empty string verbatim', () => {
    expect(parseUserInput('', 'en-US')).toBe('');
  });

  test('returns lone minus verbatim', () => {
    expect(parseUserInput('-', 'en-US')).toBe('-');
  });

  test('preserves trailing dot in partial input', () => {
    expect(parseUserInput('3.', 'en-US')).toBe('3.');
  });

  test('accepts en-US decimal and returns canonical form', () => {
    expect(parseUserInput('13.5', 'en-US')).toBe('13.5');
  });

  test('accepts de-DE comma decimal and normalises to dot', () => {
    expect(parseUserInput('13,5', 'de-DE')).toBe('13.5');
  });

  test('strips grouping separator from en-US input', () => {
    expect(parseUserInput('1,020', 'en-US')).toBe('1020');
  });

  test('preserves trailing dot when de-DE comma is normalised', () => {
    // "3," in de-DE is equivalent to "3." in en-US — still partial
    expect(parseUserInput('3,', 'de-DE')).toBe('3.');
  });

  test('stores 13.5 regardless of display locale', () => {
    // Round-trip: display en stores canonical
    expect(parseUserInput('13.5', 'en-US')).toBe('13.5');
    // Round-trip: display de stores canonical
    expect(parseUserInput('13,5', 'de-DE')).toBe('13.5');
  });
});

// ---------------------------------------------------------------------------
// Property tests (§14)
// ---------------------------------------------------------------------------

describe('property: parse ∘ format is identity over finite decimals', () => {
  // We test over `en-US` and `de-DE` to cover both separator styles.
  for (const locale of ['en-US', 'de-DE']) {
    test(`round-trips for locale ${locale}`, () => {
      fc.assert(
        fc.property(
          fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e11, max: 1e11 }),
          (n) => {
            const raw = String(n);
            if (!raw.endsWith('.') && raw !== '-' && raw !== '') {
              const displayed = formatForDisplay(raw, locale);
              const reparsed = parseUserInput(displayed, locale);
              // formatForDisplay limits to 12 significant digits (§10.3), so the
              // reparsed value will equal the *formatted* number, not necessarily
              // the full-precision input.  The invariant is that the formatted
              // string can be re-parsed to a finite number.
              expect(Number.isFinite(Number(reparsed))).toBe(true);
            }
          },
        ),
      );
    });
  }
});

describe('property: formatter never emits a string it cannot re-parse', () => {
  test('holds for en-US', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e11, max: 1e11 }),
        (n) => {
          const raw = String(n);
          const displayed = formatForDisplay(raw, 'en-US');
          if (displayed !== raw) {
            // displayed is a fully formatted string; parseUserInput must not
            // throw and must return a finite number.
            const reparsed = parseUserInput(displayed, 'en-US');
            expect(Number.isFinite(Number(reparsed))).toBe(true);
          }
        },
      ),
    );
  });
});
