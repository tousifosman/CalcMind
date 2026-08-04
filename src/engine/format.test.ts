import fc from 'fast-check';
import Decimal from 'decimal.js';
import {
  formatForDisplay,
  parseUserInput,
  decimalSeparatorFor,
  formatComputedValue,
  parseComputedDisplay,
} from './format';

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

  test('rejects malformed grouping that would silently produce a different number', () => {
    // '13.5' in de-DE: '.' is the group separator, so stripping blindly would give '135'
    expect(() => parseUserInput('13.5', 'de-DE')).toThrow();
    // '1.23' in en-US: '.' is the decimal separator, so '123' would be wrong
    expect(() => parseUserInput('1.23.45', 'en-US')).toThrow();
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

describe('formatComputedValue', () => {
  test('strips trailing zeros and keeps up to 12 significant digits', () => {
    expect(formatComputedValue(new Decimal('1.2300'), 'en-US')).toBe('1.23');
    expect(formatComputedValue(new Decimal('123456.789012345'), 'en-US')).toBe('123,456.789012');
  });

  test.each([
    // Exactly at the high boundary → scientific (|x| ≥ 1e12)
    { value: '1e12', locale: 'en-US', expected: '1e+12' },
    // Just below → plain
    { value: '999999999999', locale: 'en-US', expected: '999,999,999,999' },
    // Just above
    { value: '1.00000000001e12', locale: 'en-US', expected: '1.00000000001e+12' },
    // Exactly at the low boundary → plain (0 < |x| < 1e-6 is the scientific rule)
    { value: '1e-6', locale: 'en-US', expected: '0.000001' },
    // Just below → scientific
    { value: '9.9e-7', locale: 'en-US', expected: '9.9e-7' },
    // Just above low boundary → plain
    { value: '1.1e-6', locale: 'en-US', expected: '0.0000011' },
  ])('boundary $value → $expected', ({ value, locale, expected }) => {
    expect(formatComputedValue(new Decimal(value), locale)).toBe(expected);
  });

  test('applies locale separators on the mantissa (and only here)', () => {
    expect(formatComputedValue(new Decimal('1234.5'), 'de-DE')).toBe('1.234,5');
    expect(formatComputedValue(new Decimal('1.23e+15'), 'de-DE')).toBe('1,23e+15');
  });

  test('zero is "0"', () => {
    expect(formatComputedValue(new Decimal(0), 'en-US')).toBe('0');
    expect(formatComputedValue(new Decimal('-0'), 'de-DE')).toBe('0');
  });

  test('negative values keep the sign', () => {
    expect(formatComputedValue(new Decimal('-1.5e12'), 'en-US')).toBe('-1.5e+12');
    expect(formatComputedValue(new Decimal('-0.0000005'), 'en-US')).toBe('-5e-7');
  });

  test('the formatter never emits something parseComputedDisplay rejects', () => {
    const locales = ['en-US', 'de-DE', 'fr-FR'];
    const values = fc
      .tuple(fc.boolean(), fc.integer({ min: -20, max: 20 }), fc.integer({ min: 1, max: 999999999 }))
      .map(([neg, exp, mantissa]) => {
        const base = new Decimal(mantissa).times(new Decimal(10).pow(exp - 8));
        return neg ? base.negated() : base;
      });

    fc.assert(
      fc.property(values, fc.constantFrom(...locales), (value, locale) => {
        if (value.isZero()) {
          expect(parseComputedDisplay(formatComputedValue(value, locale), locale).isZero()).toBe(
            true,
          );
          return;
        }
        const displayed = formatComputedValue(value, locale);
        expect(() => parseComputedDisplay(displayed, locale)).not.toThrow();
        const roundTripped = parseComputedDisplay(displayed, locale);
        // 12 significant digits — compare at that precision.
        expect(
          roundTripped
            .toSignificantDigits(12)
            .equals(value.toSignificantDigits(12)),
        ).toBe(true);
      }),
    );
  });
});
