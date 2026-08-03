// The locale display/storage boundary. See docs/ARCHITECTURE.md §10.3 and decision #11.
//
// This is the ONLY place a locale separator exists anywhere in the codebase. Everything else -
// storage, the engine, NumberNode.raw - uses the canonical form from numeric.ts: '.' and no
// grouping, so a document written in one locale opens correctly in another.
import { isCanonicalRaw, splitRaw } from './numeric';

/** Forces Latin digits (0-9) regardless of locale. Grouping and the decimal separator still vary
 *  by locale (fr-FR groups with a space, de-DE decimal-separates with a comma); the digits
 *  themselves do not, because parseUserInput has no way to transliterate Arabic-indic or Bengali
 *  digits back to canonical, and the keypad only ever sends 0-9 (§8.5). */
function latnLocale(locale: string): string {
  return `${locale}-u-nu-latn`;
}

/** The glyph the locale uses for a decimal point - what the keypad's decimal key displays
 *  (P2.7), while the key itself still inserts a canonical '.' into raw. */
export function decimalSeparatorFor(locale: string): string {
  const part = new Intl.NumberFormat(latnLocale(locale)).formatToParts(1.1).find((p) => p.type === 'decimal');
  return part ? part.value : '.';
}

function groupSeparatorFor(locale: string): string {
  const part = new Intl.NumberFormat(latnLocale(locale)).formatToParts(1000).find((p) => p.type === 'group');
  return part ? part.value : '';
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
 *  locale to begin with. */
export function parseUserInput(text: string, locale: string): string {
  const group = groupSeparatorFor(locale);
  const decimal = decimalSeparatorFor(locale);

  let normalised = group !== '' ? text.split(group).join('') : text;
  if (decimal !== '.') {
    normalised = normalised.split(decimal).join('.');
  }

  if (!isCanonicalRaw(normalised)) {
    throw new Error(`parseUserInput: not a number in locale ${locale}: ${JSON.stringify(text)}`);
  }
  return normalised;
}
