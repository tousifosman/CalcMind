// Engine error values and chain-status types. See docs/ARCHITECTURE.md §9 and §10.4.
//
// Errors are values on the chain, rendered on the result node. Nothing here throws across
// a module boundary (§10.4, decision #3). Explanation copy lives here so ResultNode and
// tests share one source, and so §11.2's "explained, not marked" rule is enforceable without
// the view inventing strings.
import type { EngineErrorKind, ResultDerived } from '../model/types';

export type { EngineErrorKind };

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
 * broken links. `CircularReference`'s full "name the cycle" treatment is P6.3; the string
 * here is still an explanation so P4.6 can render the kind distinguishably without the graph.
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

export type ResultCellContent =
  | { mode: 'empty'; text: '' }
  | { mode: 'value'; text: string; dimmed: false }
  | { mode: 'stale'; text: string; dimmed: true }
  | { mode: 'error'; text: string; dimmed: false; error: EngineErrorKind };

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
  return {
    mode: 'error',
    text: explainEngineError(outcome.error),
    dimmed: false,
    error: outcome.error,
  };
}
