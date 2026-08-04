// Dirty-set recompute (§11, §11.4). See docs/ARCHITECTURE.md.
//
// P4.8 is the single-chain half: a mutation seeds its own chain, and that chain
// alone is recomputed. P6.2 extends `dirtyClosure` to transitive dependents in
// topological order — callers keep calling `recomputeFromSeeds` with the same
// signature, so the cascade lands without rewriting the store wiring.
import { createResultNode } from '../model/factories';
import type { CalcDocument, ChainId, NodeId, ResultNode } from '../model/types';
import { computeChain } from './compute';

/**
 * Expand a mutation seed into the ordered list of chains that must be
 * recomputed (§11). Untouched chains are never included — §11.4's dirty-set
 * rule lives here, not in the store.
 *
 * P4.8: the seed itself (deduped, existing chains only).
 * P6.2: replace this body with "seed ∪ transitive dependents in topo order"
 * after P6.1 builds the reference DAG. Do not change the signature.
 */
export function dirtyClosure(
  document: CalcDocument,
  seed: readonly ChainId[],
): ChainId[] {
  const seen = new Set<ChainId>();
  const order: ChainId[] = [];
  for (const id of seed) {
    if (seen.has(id)) continue;
    if (document.chains[id] === undefined) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/** Find every result node whose `sourceChainId` is `chainId`. */
function resultNodesForChain(document: CalcDocument, chainId: ChainId): ResultNode[] {
  const out: ResultNode[] = [];
  for (const node of Object.values(document.nodes)) {
    if (node.kind === 'result' && node.sourceChainId === chainId) {
      out.push(node);
    }
  }
  return out;
}

/**
 * Mark existing results for the dirty set as §9 Stale — previous display kept,
 * dimmed via `outcome: { status: 'stale' }`. P4.8 still recomputes in the same
 * turn (see `recomputeFromSeeds`), so the committed document never leaves a
 * dirty result undimmed; writing stale first keeps that invariant if a later
 * caller splits mark from evaluate (value-slider throttle, §8.8).
 */
export function markChainsStale(draft: CalcDocument, chainIds: readonly ChainId[]): void {
  for (const chainId of chainIds) {
    for (const result of resultNodesForChain(draft, chainId)) {
      if (result.derived === undefined) continue;
      result.derived = {
        ...result.derived,
        outcome: { status: 'stale' },
      };
    }
  }
}

/**
 * Delete every result whose `sourceChainId` is `chainId`, and drop those ids from
 * `chain.members` if the chain still exists (§8.3: losing `=` loses the result;
 * also used when recompute finds the chain no longer Evaluated).
 */
export function removeResultNodesForChain(draft: CalcDocument, chainId: ChainId): void {
  const toDelete: NodeId[] = [];
  for (const [id, node] of Object.entries(draft.nodes)) {
    if (node.kind === 'result' && node.sourceChainId === chainId) {
      toDelete.push(id);
    }
  }
  if (toDelete.length === 0) return;

  for (const id of toDelete) {
    delete draft.nodes[id];
  }
  const chain = draft.chains[chainId];
  if (chain) {
    const drop = new Set(toDelete);
    chain.members = chain.members.filter((id) => !drop.has(id));
  }
}

/**
 * Write `derived` for one chain from `computeChain`. Creates a ResultNode when
 * the chain becomes Evaluated and none exists; updates an existing one in place;
 * removes the result when the chain is no longer Evaluated (§9 Incomplete/Valid
 * have no result — same rule P4.7 used for create-only).
 *
 * `derived` is a cache only — never read back as an input (§6, §12.1).
 */
export function recomputeChain(
  draft: CalcDocument,
  chainId: ChainId,
  locale: string,
): void {
  const chain = draft.chains[chainId];
  if (!chain) return;

  // Pass draft.chains so reference nodes resolve live (P4.9). Omitting it makes
  // every reference in a dirty Evaluated chain degrade to NotANumber (PR #72).
  const computed = computeChain(chain, draft.nodes, locale, draft.chains);
  const existing = resultNodesForChain(draft, chainId);

  if (computed === null) {
    // Not Evaluated (Incomplete / Invalid / Valid without a live result path).
    if (existing.length > 0) removeResultNodesForChain(draft, chainId);
    return;
  }

  const computedAt = new Date().toISOString();
  const derived =
    computed.ok
      ? { display: computed.display, computedAt }
      : {
          display: '',
          computedAt,
          outcome: { status: 'error' as const, error: computed.error.kind },
        };

  if (existing.length > 0) {
    // Update the first; drop any duplicates so one chain never paints two results.
    existing[0].derived = derived;
    for (let i = 1; i < existing.length; i++) {
      const dupId = existing[i].id;
      delete draft.nodes[dupId];
      chain.members = chain.members.filter((id) => id !== dupId);
    }
    return;
  }

  const result = createResultNode({ x: 0, y: 0 }, chainId);
  result.chainId = chainId;
  result.derived = derived;
  draft.nodes[result.id] = result;

  const equalsIndex = chain.members.findIndex((id) => draft.nodes[id]?.kind === 'equals');
  if (equalsIndex >= 0) {
    chain.members.splice(equalsIndex + 1, 0, result.id);
  } else {
    chain.members.push(result.id);
  }
}

/**
 * Mark the dirty closure of `seed` stale, then recompute each chain in order.
 * One call is the whole §11 mark→evaluate step for the seeds given — never a
 * full document sweep (§11.4).
 */
export function recomputeFromSeeds(
  draft: CalcDocument,
  seed: readonly ChainId[],
  locale: string,
): void {
  const dirty = dirtyClosure(draft, seed);
  if (dirty.length === 0) return;
  markChainsStale(draft, dirty);
  for (const chainId of dirty) {
    recomputeChain(draft, chainId, locale);
  }
}
