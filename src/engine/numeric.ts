/**
 * Numeric helpers (§10.3).
 *
 * All arithmetic in the engine uses `decimal.js` at precision 34 (§10.3).
 * This module exports the configured `Decimal` class so every consumer uses
 * the same precision, and collects the small numeric utilities that do not
 * belong in `format.ts`.
 */

import { Decimal } from 'decimal.js';

// Precision 34 matches IEEE 754 decimal128, which is the level at which
// financial applications operate (§10.3).
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
