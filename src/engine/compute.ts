// Chain → display (or error). See docs/ARCHITECTURE.md §10.1.
//
// The store's result-lifecycle (P4.7) calls this rather than assembling tokenize →
// validate → parse → evaluate → format itself, so the pipeline stays one pure function
// and P4.8 / load-time recompute can reuse it without forking the steps.
import Decimal from 'decimal.js';
import { engineError, type EngineError } from './errors';
import { evaluate, isEngineError, type EvalResult, type ReferenceResolver } from './evaluate';
import { formatComputedValue } from './format';
import { ParseError, parse } from './parse';
import { tokenize } from './tokenize';
import { validateChain } from './validate';
import type { CalcNode, Chain, ChainId, NodeId } from '../model/types';

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
 * Resolve a reference target to a live value without trusting `ResultNode.derived`
 * (§6, §12.1). Numbers parse from `raw`; results recompute their source chain; nested
 * references walk with a cycle guard. `chains` is required for result targets — without
 * it a result reference degrades to `NotANumber` rather than reading the cache.
 */
export function resolveReferenceValue(
  targetNodeId: NodeId,
  nodes: Record<NodeId, CalcNode>,
  chains: Record<ChainId, Chain> | undefined,
  locale: string,
  stack: Set<NodeId> = new Set(),
): EvalResult {
  if (stack.has(targetNodeId)) {
    return engineError('CircularReference');
  }
  const target = nodes[targetNodeId];
  if (!target) {
    return engineError('NotANumber');
  }

  stack.add(targetNodeId);
  try {
    switch (target.kind) {
      case 'number': {
        try {
          const value = new Decimal(target.raw);
          if (value.isNaN()) return engineError('NotANumber');
          if (!value.isFinite()) return engineError('Overflow');
          return value;
        } catch {
          return engineError('NotANumber');
        }
      }
      case 'result': {
        const source = chains?.[target.sourceChainId];
        if (!source) return engineError('NotANumber');
        const computed = computeChain(source, nodes, locale, chains, stack);
        if (computed === null) return engineError('Incomplete');
        if (!computed.ok) return computed.error;
        return computed.value;
      }
      case 'reference':
        return resolveReferenceValue(target.targetNodeId, nodes, chains, locale, stack);
      default:
        return engineError('NotANumber');
    }
  } finally {
    stack.delete(targetNodeId);
  }
}

/**
 * Run the §10.1 pipeline for a chain. Returns `null` unless structural validation says
 * `Evaluated` (Valid expression + `=`). On success, `display` is locale-formatted and is
 * what belongs in `ResultNode.derived` — a cache written from this output, never read
 * back as an input (§6, §12.1).
 *
 * `chains` enables live reference resolution (P4.9). Omit it only for documents that
 * cannot contain references; unresolved refs then become `NotANumber`.
 */
export function computeChain(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  chains?: Record<ChainId, Chain>,
  referenceStack: Set<NodeId> = new Set(),
): ChainComputeResult {
  const status = validateChain(chain, nodes);
  if (status.status !== 'Evaluated') {
    return null;
  }

  try {
    const tokens = tokenize(chain, nodes);
    const ast = parse(tokens);
    const resolve: ReferenceResolver | undefined = chains
      ? (targetId) => resolveReferenceValue(targetId, nodes, chains, locale, referenceStack)
      : undefined;
    const value = evaluate(ast, resolve);
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
