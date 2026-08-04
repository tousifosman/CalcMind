// Engine error values and chain-status types. See docs/ARCHITECTURE.md §9 and §10.4.
//
// Errors are values on the chain, rendered on the result node. Nothing here throws across
// a module boundary (§10.4, decision #3).

/** The six error kinds §10.4 lists. Each is a value, never an exception. */
export type EngineErrorKind =
  | 'Incomplete'
  | 'InvalidSequence'
  | 'DivideByZero'
  | 'Overflow'
  | 'NotANumber'
  | 'CircularReference';

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
