// Canonical raw-number representation. See docs/ARCHITECTURE.md §10.3 and §6.
//
// "raw" is what NumberNode.raw stores: a decimal point (never a locale separator), no grouping,
// and not necessarily a complete number - "3.", "-" and "" are all valid raw, mid-typing states
// that must survive a save/load cycle unchanged. Turning raw into a value to compute with is the
// engine's job (P4), not this file's.

const CANONICAL_RAW_PATTERN = /^-?\d*\.?\d*$/;

/** True for every raw a person can reach by typing digits, a leading '-' and at most one '.',
 *  left to right - including "" and mid-typing states like "-" or "3.". Not "is a complete,
 *  evaluable number"; that check belongs to the engine (P4). */
export function isCanonicalRaw(text: string): boolean {
  return CANONICAL_RAW_PATTERN.test(text);
}

export interface RawParts {
  sign: '-' | '';
  integer: string;
  hasPoint: boolean;
  fraction: string;
}

/** Splits canonical raw into its parts without interpreting it as a number, so partial states
 *  (a lone '-', a trailing '.') survive intact instead of being coerced through a numeric type.
 *  Throws on non-canonical input - callers that don't already know `raw` is canonical should
 *  check `isCanonicalRaw` first. */
export function splitRaw(raw: string): RawParts {
  const match = /^(-)?(\d*)(\.)?(\d*)$/.exec(raw);
  if (!match) {
    throw new Error(`splitRaw: not canonical raw: ${JSON.stringify(raw)}`);
  }
  const [, sign, integer, point, fraction] = match;
  return { sign: sign === '-' ? '-' : '', integer, hasPoint: point === '.', fraction };
}
