import fc from 'fast-check';
import Decimal from 'decimal.js';
import { formatForDisplay, parseUserInput, decimalSeparatorFor } from './format';

describe('decimalSeparatorFor', () => {
  test('en-US uses a period', () => {
    expect(decimalSeparatorFor('en-US')).toBe('.');
  });

  test('de-DE uses a comma', () => {
    expect(decimalSeparatorFor('de-DE')).toBe(',');
  });
});

describe('formatForDisplay', () => {
  test('groups the integer part and swaps in the locale decimal separator', () => {
    expect(formatForDisplay('1020', 'en-US')).toBe('1,020');
    expect(formatForDisplay('13.5', 'de-DE')).toBe('13,5');
    expect(formatForDisplay('1020', 'de-DE')).toBe('1.020');
  });

  test.each(['', '-', '3.', '-0.5', ''])('partial raw %j formats without throwing', (raw) => {
    expect(() => formatForDisplay(raw, 'en-US')).not.toThrow();
  });

  test('a trailing decimal point survives formatting', () => {
    expect(formatForDisplay('3.', 'en-US')).toBe('3.');
    expect(formatForDisplay('3.', 'de-DE')).toBe('3,');
  });

  test('empty and bare-sign raw pass through unchanged', () => {
    expect(formatForDisplay('', 'de-DE')).toBe('');
    expect(formatForDisplay('-', 'de-DE')).toBe('-');
  });

  test('rejects non-canonical raw', () => {
    expect(() => formatForDisplay('1,5', 'en-US')).toThrow();
  });
});

describe('parseUserInput', () => {
  test('accepts the locale separator and normalises to canonical', () => {
    expect(parseUserInput('13,5', 'de-DE')).toBe('13.5');
    expect(parseUserInput('1.234,56', 'de-DE')).toBe('1234.56');
    expect(parseUserInput('1,234.56', 'en-US')).toBe('1234.56');
  });

  test('a trailing locale separator normalises to a trailing canonical point, not to an integer', () => {
    expect(parseUserInput('3,', 'de-DE')).toBe('3.');
  });

  test.each(['', '-', '-0.5'])('%j round-trips unchanged under a locale matching canonical form', (raw) => {
    expect(parseUserInput(raw, 'en-US')).toBe(raw);
  });

  test('rejects text that is not a number in the given locale', () => {
    expect(() => parseUserInput('abc', 'en-US')).toThrow();
  });
});

describe('parse . format is identity over generated decimals', () => {
  const locales = ['en-US', 'de-DE', 'fr-FR', 'en-IN'];

  // Digits only, no leading zeros other than a bare "0", so display-side leading-zero
  // normalisation (Intl formats "007" as "7") can never make this anything but a pure
  // round trip - see the dedicated cosmetic-normalisation test below for that behaviour.
  const decimalString = fc
    .tuple(
      fc.boolean(),
      fc.oneof(fc.constant('0'), fc.stringMatching(/^[1-9]\d{0,8}$/)),
      fc.option(fc.stringMatching(/^\d{0,8}$/), { nil: undefined }),
    )
    .map(([negative, integer, fraction]) => {
      const magnitude = fraction === undefined ? integer : `${integer}.${fraction}`;
      return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
    });

  test.each(locales)('holds for %s', (locale) => {
    fc.assert(
      fc.property(decimalString, (raw) => {
        const displayed = formatForDisplay(raw, locale);
        const roundTripped = parseUserInput(displayed, locale);
        expect(new Decimal(roundTripped).equals(new Decimal(raw))).toBe(true);
      }),
    );
  });

  test('the formatter never emits a string parseUserInput rejects', () => {
    fc.assert(
      fc.property(decimalString, fc.constantFrom(...locales), (raw, locale) => {
        expect(() => parseUserInput(formatForDisplay(raw, locale), locale)).not.toThrow();
      }),
    );
  });
});

describe('leading zeros are a display-only cosmetic normalisation', () => {
  test('formatForDisplay drops them, but never touches stored raw', () => {
    expect(formatForDisplay('007.5', 'en-US')).toBe('7.5');
  });
});

describe('grouping beyond Number.MAX_SAFE_INTEGER', () => {
  test('degrades to ungrouped rather than risk float64 altering the displayed digits', () => {
    const digits = '9'.repeat(20);
    expect(formatForDisplay(digits, 'en-US')).toBe(digits);
  });

  test('every digit still round-trips through parseUserInput', () => {
    const raw = `-${'1'.repeat(20)}.5`;
    expect(parseUserInput(formatForDisplay(raw, 'de-DE'), 'de-DE')).toBe(raw);
  });
});
