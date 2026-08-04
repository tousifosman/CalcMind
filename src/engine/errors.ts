// Engine error values and chain-status types. See docs/ARCHITECTURE.md §9 and §10.4.
//
// Errors are values on the chain, rendered on the result node. Nothing here throws across
// a module boundary (§10.4, decision #3). Explanation copy lives here so ResultNode and
// tests share one source, and so §11.2's "explained, not marked" rule is enforceable without
// the view inventing strings.
import type {
  CircularReferenceCycle,
  EngineErrorKind,
  ResultDerived,
} from '../model/types';

export type { EngineErrorKind, CircularReferenceCycle };

export interface EngineError {
  kind: EngineErrorKind;
}

export function engineError(kind: EngineErrorKind): EngineError {
  return { kind };
}

/**
 * Exactly one of these at any moment (§9). Structural validation (P4.2) produces Empty /
 * Incomplete / Valid / Invalid / Evaluated. Stale and ErrorState are applied by the
 * recompute lifecycle (P4.7–P4.8) once a result exists.
 */
export type ChainStatus =
  | { status: 'Empty' }
  | { status: 'Incomplete' }
  | { status: 'Valid' }
  | {
      status: 'Invalid';
      /** Member index of the node immediately before the offending boundary (the red hairline
       *  sits between `members[boundaryAfter]` and `members[boundaryAfter + 1]`). */
      boundaryAfter: number;
    }
  | { status: 'Evaluated' }
  | { status: 'Stale' }
  | { status: 'ErrorState'; error: EngineError };

/**
 * Human-readable explanation for each §10.4 error. Never a bare glyph — §11.2 is the
 * design's sharpest criticism of the reference app and applies to engine errors, not just
 * broken links. When a `CircularReference` carries cycle metadata from P6.3 DFS colouring,
 * prefer {@link explainCircularReference} so the cell *names* the cycle.
 */
export function explainEngineError(kind: EngineErrorKind): string {
  switch (kind) {
    case 'Incomplete':
      return 'Incomplete expression';
    case 'InvalidSequence':
      return 'Invalid sequence';
    case 'DivideByZero':
      return 'Division by zero';
    case 'Overflow':
      return 'Number too large';
    case 'NotANumber':
      return 'Not a number';
    case 'CircularReference':
      return 'Circular reference';
  }
}

/** §11.2: name the cycle (`A → B → A`), not a bare "Circular reference" glyph. */
export function explainCircularReference(chainLabels: readonly string[]): string {
  if (chainLabels.length === 0) return explainEngineError('CircularReference');
  return `Circular: ${[...chainLabels, chainLabels[0]].join(' → ')}`;
}

/** Affordance label offered on a named circular-reference cell (§11.2). Measured into
 *  `widthOf` via {@link resultCellContent} so layout and the Unlink control agree. */
export const CIRCULAR_UNLINK_LABEL = 'Unlink';

export type ResultCellContent =
  | { mode: 'empty'; text: '' }
  | { mode: 'value'; text: string; dimmed: false }
  | { mode: 'stale'; text: string; dimmed: true }
  | {
      mode: 'error';
      text: string;
      dimmed: false;
      error: EngineErrorKind;
      /** Present when DFS named the cycle — ResultNode offers Unlink on this. */
      cycle?: CircularReferenceCycle;
    };

/** Font size for error explanations on the result cell. Smaller than `tokens.numeralFontSize`
 *  so a multi-word message reads as a message, not a failed numeral. Owned here — next to
 *  `resultCellContent` — so `widthOf` and `ResultNode` cannot disagree about it (P4.6 review). */
export const RESULT_ERROR_FONT_SIZE = 16;

/**
 * Map a result's derived cache to what the cell should show. Pure so widthOf and ResultNode
 * agree on the string without the view owning the §10.4 / §9 rules.
 */
export function resultCellContent(derived: ResultDerived | undefined): ResultCellContent {
  if (derived === undefined) {
    return { mode: 'empty', text: '' };
  }
  const outcome = derived.outcome;
  if (outcome === undefined) {
    return { mode: 'value', text: derived.display, dimmed: false };
  }
  if (outcome.status === 'stale') {
    return { mode: 'stale', text: derived.display, dimmed: true };
  }
  if (outcome.error === 'CircularReference' && outcome.cycle) {
    // Include the Unlink affordance in the measured string so the cell is wide enough
    // for both the named cycle and the control ResultNode renders beside it (§11.2).
    const named = explainCircularReference(outcome.cycle.chainLabels);
    return {
      mode: 'error',
      text: `${named} ${CIRCULAR_UNLINK_LABEL}`,
      dimmed: false,
      error: 'CircularReference',
      cycle: outcome.cycle,
    };
  }
  return {
    mode: 'error',
    text: explainEngineError(outcome.error),
    dimmed: false,
    error: outcome.error,
  };
}
