// The locale display/storage boundary. See docs/ARCHITECTURE.md §10.3 and decision #11.
//
// This is the ONLY place a locale separator exists anywhere in the codebase. Everything else -
// storage, the engine, NumberNode.raw - uses the canonical form from numeric.ts: '.' and no
// grouping, so a document written in one locale opens correctly in another.
//
// `formatComputedValue` is the result-cell half of the same boundary: Decimal → display
// string with §10.3's significant-digit and scientific-notation rules, then locale.
import Decimal from 'decimal.js';
import { isCanonicalRaw, splitRaw } from './numeric';

/** Forces Latin digits (0-9) regardless of locale. Grouping and the decimal separator still vary
 *  by locale (fr-FR groups with a space, de-DE decimal-separates with a comma); the digits
 *  themselves do not, because parseUserInput has no way to transliterate Arabic-indic or Bengali
 *  digits back to canonical, and the keypad only ever sends 0-9 (§8.5). */
function latnLocale(locale: string): string {
  return `${locale}-u-nu-latn`;
}

// Separator values are derived from Intl.NumberFormat, which is expensive to construct.
// Cache per locale so formatForDisplay and parseUserInput (called on every keystroke) pay
// the construction cost at most once per locale tag seen in a session.
const _decimalCache = new Map<string, string>();
const _groupCache = new Map<string, string>();

/** The glyph the locale uses for a decimal point - what the keypad's decimal key displays
 *  (P2.7), while the key itself still inserts a canonical '.' into raw. */
export function decimalSeparatorFor(locale: string): string {
  const key = latnLocale(locale);
  if (_decimalCache.has(key)) return _decimalCache.get(key)!;
  const part = new Intl.NumberFormat(key).formatToParts(1.1).find((p) => p.type === 'decimal');
  const sep = part ? part.value : '.';
  _decimalCache.set(key, sep);
  return sep;
}

function groupSeparatorFor(locale: string): string {
  const key = latnLocale(locale);
  if (_groupCache.has(key)) return _groupCache.get(key)!;
  const part = new Intl.NumberFormat(key).formatToParts(1000).find((p) => p.type === 'group');
  const sep = part ? part.value : '';
  _groupCache.set(key, sep);
  return sep;
}

/** Groups an integer digit string per the locale, through `Intl.NumberFormat`, for anything that
 *  fits a JS double exactly. Beyond `Number.MAX_SAFE_INTEGER` that conversion would silently
 *  alter the digits (float64 rounding) - a missing thousands separator is cosmetic, a wrong
 *  digit on screen while a person is mid-type is not - so this degrades to ungrouped rather than
 *  risk it. `raw` itself and any computed value (decimal.js, §10.3) are exact regardless; this
 *  only bounds what the *display* layer can show grouped. */
function groupInteger(digits: string, locale: string): string {
  if (digits === '') {
    return '';
  }
  const asNumber = Number(digits);
  if (!Number.isSafeInteger(asNumber)) {
    return digits;
  }
  return new Intl.NumberFormat(latnLocale(locale), { maximumFractionDigits: 0 }).format(asNumber);
}

/** Formats canonical raw for display. Live-safe: partial states ("", "-", "3.") format
 *  partially rather than throwing, so this can run on every keystroke while a number is being
 *  edited, not just once a value is complete. Grouping and the decimal separator are the
 *  locale's; the digits are always 0-9 (see `latnLocale` above). */
export function formatForDisplay(raw: string, locale: string): string {
  if (!isCanonicalRaw(raw)) {
    throw new Error(`formatForDisplay: not canonical raw: ${JSON.stringify(raw)}`);
  }
  if (raw === '' || raw === '-') {
    return raw;
  }

  const { sign, integer, hasPoint, fraction } = splitRaw(raw);
  return sign + groupInteger(integer, locale) + (hasPoint ? decimalSeparatorFor(locale) : '') + fraction;
}

/** Parses locale-formatted or partially-typed input back to canonical raw: strips the locale's
 *  grouping separator, replaces its decimal separator with '.', and passes digits, sign and a
 *  trailing separator through unchanged - `parseUserInput('3,', 'de-DE')` is `'3.'`, not `'3'`
 *  (§6). Throws if the result isn't canonical raw, which means the input wasn't a number in this
 *  locale to begin with.
 *
 *  Validates grouping placement when the group separator overlaps with the canonical '.' to
 *  prevent silent mis-normalisation: `'13.5'` in de-DE (where '.' groups) rejects rather than
 *  silently producing `'135'`. */
export function parseUserInput(text: string, locale: string): string {
  const group = groupSeparatorFor(locale);
  const decimal = decimalSeparatorFor(locale);

  // When the group separator is the same character as the canonical decimal point ('.'),
  // stripping it blindly can silently change the number: '13.5' in de-DE becomes '135'.
  // Validate that every '.' in the integer portion is a proper thousands separator
  // (first segment 1-3 digits, subsequent segments exactly 3 digits).
  if (group === '.') {
    const withoutSign = text.startsWith('-') ? text.slice(1) : text;
    const decIdx = withoutSign.indexOf(decimal);
    const integerPortion = decIdx === -1 ? withoutSign : withoutSign.slice(0, decIdx);
    if (integerPortion.includes('.')) {
      const segments = integerPortion.split('.');
      const validGrouping =
        /^\d+$/.test(segments[0]) &&
        segments[0].length >= 1 &&
        segments[0].length <= 3 &&
        segments.slice(1).every((s) => s.length === 3 && /^\d+$/.test(s));
      if (!validGrouping) {
        throw new Error(`parseUserInput: not a number in locale ${locale}: ${JSON.stringify(text)}`);
      }
    }
  }

  let normalised = group !== '' ? text.split(group).join('') : text;
  if (decimal !== '.') {
    normalised = normalised.split(decimal).join('.');
  }

  if (!isCanonicalRaw(normalised)) {
    throw new Error(`parseUserInput: not a number in locale ${locale}: ${JSON.stringify(text)}`);
  }
  return normalised;
}

const SCIENTIFIC_THRESHOLD_HIGH = new Decimal('1e12');
const SCIENTIFIC_THRESHOLD_LOW = new Decimal('1e-6');
const RESULT_SIGNIFICANT_DIGITS = 12;

/**
 * Value → string on the result cell (§10.3). Up to 12 significant digits with trailing
 * zeros stripped; scientific notation when `|x| ≥ 1e12` or `0 < |x| < 1e-6`. Locale
 * separators are applied here and nowhere else; the Decimal itself stays canonical.
 *
 * The scientific decision is made on the *rounded* magnitude, not the pre-round value:
 * `999999999999.9` rounds to exactly `1e12` under 12 sig digs, and must format as
 * scientific — deciding from the pre-round abs would emit a 13-digit plain number that
 * contradicts the boundary rule for the digits actually shown.
 */
export function formatComputedValue(value: Decimal, locale: string): string {
  if (value.isNaN() || !value.isFinite()) {
    throw new Error('formatComputedValue: refusing to format a non-finite value');
  }
  if (value.isZero()) {
    return formatForDisplay('0', locale);
  }

  const significant = value.toSignificantDigits(RESULT_SIGNIFICANT_DIGITS);
  if (significant.isZero()) {
    // Underflow under 12 sig digs — treat as zero rather than scientific of a tiny residual.
    return formatForDisplay('0', locale);
  }

  const abs = significant.abs();
  const useScientific =
    abs.greaterThanOrEqualTo(SCIENTIFIC_THRESHOLD_HIGH) ||
    abs.lessThan(SCIENTIFIC_THRESHOLD_LOW);

  if (!useScientific) {
    // toFixed keeps a plain decimal form near the 1e-6 boundary where toString would
    // switch to exponential on its own (e.g. 1e-7). Trailing zeros are already gone
    // after toSignificantDigits.
    const canonical = significant.toFixed();
    return formatForDisplay(canonical, locale);
  }

  // Mantissa × 10^exp. decimal.js's toExponential uses a capital E sometimes; normalise
  // to a lowercase `e` so parseComputedDisplay has one form to undo.
  const expForm = significant.toExponential().replace(/E/, 'e');
  const match = /^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(expForm);
  if (!match) {
    throw new Error(`formatComputedValue: unexpected exponential form ${expForm}`);
  }
  const [, mantissa, exponent] = match;
  // Locale applies to the mantissa only; the exponent stays ASCII digits with sign.
  return `${formatForDisplay(mantissa, locale)}e${exponent}`;
}

/**
 * Undo `formatComputedValue` for property tests and any caller that needs the Decimal
 * back. Accepts both plain locale-formatted decimals and the scientific form this file
 * emits (`1,23e+12` under de-DE).
 */
export function parseComputedDisplay(text: string, locale: string): Decimal {
  const sci = /^(.+?)e([+-]?\d+)$/i.exec(text);
  if (sci) {
    const mantissa = parseUserInput(sci[1], locale);
    const exponent = Number(sci[2]);
    return new Decimal(mantissa).times(new Decimal(10).pow(exponent));
  }
  return new Decimal(parseUserInput(text, locale));
}
