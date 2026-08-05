// §8.8 range inference for the value slider. Pure: given a numeric value, return
// the default `[min, max]` the popover should open with. The user can edit the
// bounds afterwards; that override is ephemeral UI state and never reaches here.
import Decimal from 'decimal.js';

export interface SliderRange {
  min: number;
  max: number;
}

/**
 * Infer the slider range from the current value (§8.8):
 * - positive → `[0, 10^ceil(log10(v))]`
 * - negative → symmetric about zero
 * - zero → `[0, 10]`
 *
 * Exact powers of ten keep the value on the upper endpoint (`v = 100` → `[0, 100]`),
 * not one decade above — `ceil(log10(10^n))` is `n`, not `n+1`.
 */
export function inferSliderRange(value: number): SliderRange {
  if (!Number.isFinite(value) || value === 0) {
    return { min: 0, max: 10 };
  }

  const abs = new Decimal(value).abs();
  // Decimal.log(10) then ceil avoids the Math.log10 float trap on exact powers of
  // ten (e.g. `Math.log10(0.01)` drifting above -2 and ceil-ing to the wrong decade).
  const magnitude = new Decimal(10).pow(abs.log(10).ceil());
  const max = magnitude.toNumber();

  if (value < 0) {
    return { min: -max, max };
  }
  return { min: 0, max };
}

/**
 * Parse a number-node `raw` into a finite slider value, or `null` when the cell
 * is mid-typing (`""`, `"-"`, `"3."`) and has nothing meaningful to scrub yet.
 */
export function rawToSliderValue(raw: string): number | null {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return null;
  try {
    const d = new Decimal(raw);
    if (!d.isFinite()) return null;
    return d.toNumber();
  } catch {
    return null;
  }
}

/**
 * Canonical raw for a scrubbed numeric value. Always a complete number (no
 * trailing `.`), so the cell never lands in a mid-typing stub from the slider.
 *
 * Live scrub is a "what-if" probe: keep a handful of significant digits so cells
 * and cascading results do not fill with `toFixed(10)` noise during a drag.
 * Integers stay integer strings.
 */
export function sliderValueToRaw(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const d = new Decimal(value);
  if (d.isInteger()) {
    const asInt = d.toFixed(0);
    return asInt === '-0' ? '0' : asInt;
  }
  let s = d.toSignificantDigits(6).toFixed();
  if (s.includes('.')) {
    s = s.replace(/\.?0+$/, '');
  }
  if (s === '' || s === '-' || s === '-0') return '0';
  return s;
}

/** Clamp `value` into `[min, max]`, optionally rounding to the nearest integer. */
export function clampSliderValue(
  value: number,
  range: SliderRange,
  integerSnap: boolean,
): number {
  let next = Math.min(range.max, Math.max(range.min, value));
  if (integerSnap) {
    next = Math.round(next);
    next = Math.min(range.max, Math.max(range.min, next));
  }
  return next;
}

/**
 * Map a 0..1 track fraction to a value in `range`. Used by both tap and drag so
 * the thumb and the hit position share one mapping.
 */
export function valueAtTrackFraction(
  fraction: number,
  range: SliderRange,
  integerSnap: boolean,
): number {
  const t = Math.min(1, Math.max(0, fraction));
  const value = range.min + t * (range.max - range.min);
  return clampSliderValue(value, range, integerSnap);
}
