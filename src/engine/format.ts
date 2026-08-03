/**
 * Display/storage boundary for numbers (§10.3).
 *
 * Stored `raw` values always use a canonical `.` decimal point and no grouping
 * separators.  Every other place in the codebase that renders a number must go
 * through `formatForDisplay`; every place that reads user input must go through
 * `parseUserInput`.  Nothing else may introduce locale separators.
 */

/**
 * Returns the decimal separator character for the given locale.
 * Used by the keypad (P2.7) to label the decimal key.
 */
export function decimalSeparatorFor(locale: string): string {
  // Format 1.1 and extract whatever character appears between the two digits.
  const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
  const decimalPart = parts.find((p) => p.type === 'decimal');
  return decimalPart?.value ?? '.';
}

/**
 * Formats a canonical raw value for display using the active locale.
 *
 * Partial / in-progress input (e.g. `"3."`, `"-"`, `""`) is returned verbatim
 * — §6 requires these to survive a save/load cycle intact, and they cannot be
 * fed to `Intl.NumberFormat` without mangling them.
 *
 * For valid numbers the display rules follow §10.3:
 *   - up to 12 significant digits, trailing zeros stripped
 *   - scientific notation when |x| ≥ 1e12 or 0 < |x| < 1e-6
 *   - locale's grouping and decimal separators applied
 */
export function formatForDisplay(raw: string, locale: string): string {
  if (!isCompleteNumber(raw)) {
    return raw;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return raw;
  }

  const abs = Math.abs(n);
  const useScientific = abs !== 0 && (abs >= 1e12 || abs < 1e-6);

  if (useScientific) {
    // `notation: 'scientific'` produces locale-aware scientific output.
    return new Intl.NumberFormat(locale, {
      notation: 'scientific',
      maximumSignificantDigits: 12,
    }).format(n);
  }

  return new Intl.NumberFormat(locale, {
    maximumSignificantDigits: 12,
    useGrouping: true,
  }).format(n);
}

/**
 * Parses user-entered text into a canonical raw value (always `.` as decimal
 * point, no grouping).
 *
 * Partial / in-progress input (`"3."`, `"-"`, `"-0."`, `""`) is returned
 * verbatim after replacing any locale decimal separator with `.`.
 *
 * Any locale grouping separators are stripped before parsing.
 */
export function parseUserInput(text: string, locale: string): string {
  if (text === '' || text === '-') {
    return text;
  }

  const decSep = decimalSeparatorFor(locale);
  const groupSep = groupingSeparatorFor(locale);

  // Strip grouping separators, then replace locale decimal with canonical `.`.
  let normalised = text;
  if (groupSep && groupSep !== decSep) {
    normalised = normalised.split(groupSep).join('');
  }
  if (decSep !== '.') {
    normalised = normalised.split(decSep).join('.');
  }

  // Return partial input verbatim (after normalisation) so `"3."` stays `"3."`.
  if (isPartialInput(normalised)) {
    return normalised;
  }

  // For complete numbers, validate and return the canonical string.
  const n = Number(normalised);
  if (Number.isFinite(n)) {
    return normalised;
  }

  return normalised;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the grouping (thousands) separator for the locale, or an empty
 * string if the locale does not use one.
 */
function groupingSeparatorFor(locale: string): string {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1000);
  const groupPart = parts.find((p) => p.type === 'group');
  return groupPart?.value ?? '';
}

/**
 * Returns true when `raw` is a syntactically complete numeric literal that can
 * be passed to `Number()` without ambiguity.
 *
 * `"3."`, `"-"`, `"-0."` are *not* complete — they are mid-entry states that
 * must survive the save/load boundary unchanged (§6).
 */
function isCompleteNumber(raw: string): boolean {
  if (raw === '' || raw === '-' || raw === '+') {
    return false;
  }
  // Ends with decimal point — still being typed.
  if (raw.endsWith('.')) {
    return false;
  }
  return Number.isFinite(Number(raw));
}

/**
 * Returns true when the normalised string is an in-progress partial entry that
 * should pass through unchanged.
 */
function isPartialInput(normalised: string): boolean {
  return normalised === '' || normalised === '-' || normalised.endsWith('.');
}
