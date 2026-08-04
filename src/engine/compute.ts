// Chain → display (or error). See docs/ARCHITECTURE.md §10.1.
//
// The store's result-lifecycle (P4.7) calls this rather than assembling tokenize →
// validate → parse → evaluate → format itself, so the pipeline stays one pure function
// and P4.8 / load-time recompute can reuse it without forking the steps.
import Decimal from 'decimal.js';
import { engineError, type EngineError } from './errors';
import { evaluate, isEngineError } from './evaluate';
import { formatComputedValue } from './format';
import { ParseError, parse } from './parse';
import { tokenize } from './tokenize';
import { validateChain } from './validate';
import type { CalcNode, Chain, NodeId } from '../model/types';

export type ChainComputeOk = {
  ok: true;
  value: Decimal;
  display: string;
};

export type ChainComputeErr = {
  ok: false;
  error: EngineError;
};

/** `null` means the chain is not `Evaluated` — no result node should be created (§9). */
export type ChainComputeResult = ChainComputeOk | ChainComputeErr | null;

/**
 * Run the §10.1 pipeline for a chain. Returns `null` unless structural validation says
 * `Evaluated` (Valid expression + `=`). On success, `display` is locale-formatted and is
 * what belongs in `ResultNode.derived` — a cache written from this output, never read
 * back as an input (§6, §12.1).
 */
export function computeChain(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): ChainComputeResult {
  const status = validateChain(chain, nodes);
  if (status.status !== 'Evaluated') {
    return null;
  }

  try {
    const tokens = tokenize(chain, nodes);
    const ast = parse(tokens);
    const value = evaluate(ast);
    if (isEngineError(value)) {
      return { ok: false, error: value };
    }
    return {
      ok: true,
      value,
      display: formatComputedValue(value, locale),
    };
  } catch (err) {
    // Evaluated chains should parse; a throw here is defensive, not a user-facing path.
    if (err instanceof ParseError) {
      return { ok: false, error: engineError('InvalidSequence') };
    }
    return { ok: false, error: engineError('NotANumber') };
  }
}