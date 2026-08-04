// AST → value. See docs/ARCHITECTURE.md §10.3 and §10.4.
//
// All arithmetic in decimal.js at precision 34. Errors are values — nothing throws
// across this module's boundary (decision #3).
import Decimal from 'decimal.js';
import { engineError, type EngineError } from './errors';
import type { Expr } from './parse';
import type { NodeId } from '../model/types';

Decimal.set({ precision: 34 });

export type EvalResult = Decimal | EngineError;

export function isEngineError(value: EvalResult): value is EngineError {
  return !(value instanceof Decimal);
}

/** Optional resolver for reference nodes. `computeChain` supplies one when given a
 *  chains map (P4.9); callers may omit it — unresolved references become `NotANumber`. */
export type ReferenceResolver = (targetNodeId: NodeId) => EvalResult;

/**
 * Evaluate an AST. Division by zero returns `DivideByZero`, never `Infinity`.
 * Overflow → `Overflow`; non-numeric → `NotANumber`. Never throws to the caller.
 */
export function evaluate(expr: Expr, resolveReference?: ReferenceResolver): EvalResult {
  try {
    return evalExpr(expr, resolveReference);
  } catch {
    // decimal.js can still throw on pathological construction; map to a value.
    return engineError('NotANumber');
  }
}

function evalExpr(expr: Expr, resolveReference?: ReferenceResolver): EvalResult {
  switch (expr.kind) {
    case 'number': {
      try {
        const value = new Decimal(expr.raw);
        return normaliseDecimal(value);
      } catch {
        return engineError('NotANumber');
      }
    }
    case 'reference': {
      if (resolveReference === undefined) {
        return engineError('NotANumber');
      }
      const resolved = resolveReference(expr.targetNodeId);
      if (isEngineError(resolved)) {
        return resolved;
      }
      return normaliseDecimal(resolved);
    }
    case 'binary': {
      const left = evalExpr(expr.left, resolveReference);
      if (isEngineError(left)) {
        return left;
      }
      const right = evalExpr(expr.right, resolveReference);
      if (isEngineError(right)) {
        return right;
      }
      return applyBinary(expr.op, left, right);
    }
  }
}

function applyBinary(
  op: '×' | '÷' | '+' | '-',
  left: Decimal,
  right: Decimal,
): EvalResult {
  if (op === '÷') {
    if (right.isZero()) {
      return engineError('DivideByZero');
    }
  }

  let result: Decimal;
  switch (op) {
    case '+':
      result = left.plus(right);
      break;
    case '-':
      result = left.minus(right);
      break;
    case '×':
      result = left.times(right);
      break;
    case '÷':
      result = left.div(right);
      break;
  }

  if (result.isNaN()) {
    return engineError('NotANumber');
  }
  if (!result.isFinite()) {
    return engineError('Overflow');
  }
  return result;
}

/** Shared Decimal → EvalResult gate (NaN / non-finite). Exported so reference
 *  resolution (P4.9) cannot drift from the number-literal path. */
export function normaliseDecimal(value: Decimal): EvalResult {
  if (value.isNaN()) {
    return engineError('NotANumber');
  }
  if (!value.isFinite()) {
    return engineError('Overflow');
  }
  return value;
}
