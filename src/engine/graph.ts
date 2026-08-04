// Dirty-set recompute and the chain-level reference DAG (§11, §11.4).
// See docs/ARCHITECTURE.md.
//
// P4.8 landed the single-chain half: a mutation seeds its own chain, and that
// chain alone is recomputed. P6.1 builds the reference DAG (`buildDependencyGraph`,
// `topologicalOrder`). P6.3 colours cycles via DFS at build time. P6.2 extends
// `dirtyClosure` to transitive dependents in topological order — callers keep
// calling `recomputeFromSeeds` with the same signature, so the cascade lands
// without rewriting the store wiring.
import { createResultNode } from '../model/factories';
import type {
  CalcDocument,
  CalcNode,
  ChainId,
  CircularReferenceCycle,
  NodeId,
  ResultNode,
} from '../model/types';
import { validateChain } from './validate';
import { computeChain } from './compute';

/** One reference link. Keyed by `(sourceNodeId, referenceNodeId)` — never by
 *  source alone, because one value commonly feeds several consumers (§11.1,
 *  `2026-08-03` revision 7). */
export interface DependencyEdge {
  sourceNodeId: NodeId;
  referenceNodeId: NodeId;
  /** Chain that produces / owns the referenced node. */
  sourceChainId: ChainId;
  /** Chain that contains the reference node (the dependent). */
  dependentChainId: ChainId;
}

/** One directed cycle found by DFS colouring at graph-build time (§11). */
export interface DependencyCycle {
  /** Members in walk order; the closing edge returns to `chainIds[0]`. */
  chainIds: readonly ChainId[];
  /** DFS back-edge that closed this cycle (`source → dependent`). */
  closingEdge: DependencyEdge;
}

/** Chain-level DAG built from reference nodes (§11). Vertices are chains;
 *  edge `A → B` when `B` contains a reference to a node in `A`. */
export interface DependencyGraph {
  /** Every chain id in the document, in `Object.keys` order. */
  vertices: readonly ChainId[];
  /** Reference links keyed by {@link dependencyEdgeKey}. */
  edges: ReadonlyMap<string, DependencyEdge>;
  /**
   * Adjacency for cascade: `sourceChainId → dependent chain ids` (deduped,
   * preserving first-seen order). Many references from B into A collapse to
   * one chain edge here; `edges` still keeps each link.
   */
  dependents: ReadonlyMap<ChainId, readonly ChainId[]>;
  /**
   * Cycles from DFS 3-colouring at build time (§11). Empty when the graph is
   * a DAG. Every listed chain should enter `CircularReference` on recompute;
   * chains outside these keep evaluating normally.
   */
  cycles: readonly DependencyCycle[];
}

/** Stable map key for a reference edge — pair, never source alone (§11.1). */
export function dependencyEdgeKey(
  sourceNodeId: NodeId,
  referenceNodeId: NodeId,
): string {
  return `${sourceNodeId}\u001f${referenceNodeId}`;
}

/**
 * Which chain produces `node` for dependency purposes. Results use
 * `sourceChainId` (the chain whose evaluation they cache); everything else
 * uses `chainId`. Free / unknown nodes return `null` — no chain edge.
 */
function chainOfSource(node: CalcNode, document: CalcDocument): ChainId | null {
  if (node.kind === 'result') {
    return document.chains[node.sourceChainId] !== undefined
      ? node.sourceChainId
      : null;
  }
  if (node.chainId !== null && document.chains[node.chainId] !== undefined) {
    return node.chainId;
  }
  return null;
}

/**
 * Build the chain-level dependency DAG from the document's reference nodes
 * (§11). Pure: reads `document.nodes` / `document.chains` only.
 *
 * Dangling targets (missing node, or target with no chain) and free references
 * (`chainId === null`) contribute no edge — P6.4 owns the dangling UI state;
 * the graph simply has nothing to wire.
 *
 * An edge means "B reads a node in A," not "the reference evaluates successfully."
 * Pointing at an operator or paren still wires the chain edge even though
 * `resolveReferenceValue` would yield `NotANumber` — recomputing on an upstream
 * edit just re-derives the same error.
 *
 * Self-edges and longer cycles are recorded as ordinary edges; {@link
 * topologicalOrder} still returns every vertex (cycle members trail). Cycles
 * themselves are listed on {@link DependencyGraph.cycles} via DFS colouring;
 * {@link recomputeFromSeeds} paints every member `CircularReference`.
 */
export function buildDependencyGraph(document: CalcDocument): DependencyGraph {
  const vertices = Object.keys(document.chains);
  const edges = new Map<string, DependencyEdge>();
  const dependentSets = new Map<ChainId, ChainId[]>();
  const dependentSeen = new Map<ChainId, Set<ChainId>>();

  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'reference') continue;
    if (node.chainId === null || document.chains[node.chainId] === undefined) {
      continue;
    }
    const target = document.nodes[node.targetNodeId];
    if (!target) continue;
    const sourceChainId = chainOfSource(target, document);
    if (sourceChainId === null) continue;

    const key = dependencyEdgeKey(node.targetNodeId, node.id);
    edges.set(key, {
      sourceNodeId: node.targetNodeId,
      referenceNodeId: node.id,
      sourceChainId,
      dependentChainId: node.chainId,
    });

    let bucket = dependentSets.get(sourceChainId);
    let seen = dependentSeen.get(sourceChainId);
    if (!bucket || !seen) {
      bucket = [];
      seen = new Set();
      dependentSets.set(sourceChainId, bucket);
      dependentSeen.set(sourceChainId, seen);
    }
    if (!seen.has(node.chainId)) {
      seen.add(node.chainId);
      bucket.push(node.chainId);
    }
  }

  // Freeze adjacency lists so the `readonly` in `DependencyGraph.dependents`
  // is honest at runtime too (callers get a ReadonlyMap view of a finished graph).
  const dependents = new Map<ChainId, readonly ChainId[]>();
  for (const [source, deps] of dependentSets) {
    dependents.set(source, Object.freeze(deps));
  }

  const partial = { vertices, edges, dependents };
  const cycles = Object.freeze(findCycles(partial));
  return { vertices, edges, dependents, cycles };
}

/** Canonical key so A→B→A and B→A→B collapse to one recorded cycle. */
function cycleKey(chainIds: readonly ChainId[]): string {
  if (chainIds.length === 0) return '';
  let minIdx = 0;
  for (let i = 1; i < chainIds.length; i++) {
    if (chainIds[i]! < chainIds[minIdx]!) minIdx = i;
  }
  const rotated = [...chainIds.slice(minIdx), ...chainIds.slice(0, minIdx)];
  return rotated.join('\0');
}

/**
 * Pick a deterministic reference edge for chain edge `source → dependent`.
 * Several references between the same pair still collapse to one chain edge in
 * `dependents`; unlinking any one breaks that adjacency.
 */
function edgeBetween(
  edges: ReadonlyMap<string, DependencyEdge>,
  sourceChainId: ChainId,
  dependentChainId: ChainId,
): DependencyEdge | undefined {
  let best: DependencyEdge | undefined;
  let bestKey: string | undefined;
  for (const [key, edge] of edges) {
    if (
      edge.sourceChainId === sourceChainId &&
      edge.dependentChainId === dependentChainId
    ) {
      if (bestKey === undefined || key < bestKey) {
        best = edge;
        bestKey = key;
      }
    }
  }
  return best;
}

/**
 * DFS 3-colouring over the chain adjacency (§11). White / grey / black; a back
 * edge to a grey vertex closes a cycle. Pure over an already-built adjacency —
 * called from {@link buildDependencyGraph} so colouring happens at build time.
 */
export function findCycles(
  graph: Pick<DependencyGraph, 'vertices' | 'edges' | 'dependents'>,
): DependencyCycle[] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<ChainId, number>();
  for (const id of graph.vertices) colour.set(id, WHITE);

  const cycles: DependencyCycle[] = [];
  const seenKeys = new Set<string>();
  const path: ChainId[] = [];

  const visit = (u: ChainId): void => {
    colour.set(u, GREY);
    path.push(u);
    const deps = graph.dependents.get(u);
    if (deps) {
      for (const v of deps) {
        if (!colour.has(v)) continue;
        const c = colour.get(v) ?? WHITE;
        if (c === GREY) {
          const start = path.indexOf(v);
          if (start < 0) continue;
          const chainIds = path.slice(start);
          const key = cycleKey(chainIds);
          if (seenKeys.has(key)) continue;
          const closingEdge = edgeBetween(graph.edges, u, v);
          if (!closingEdge) continue;
          seenKeys.add(key);
          cycles.push({
            chainIds: Object.freeze(chainIds),
            closingEdge,
          });
        } else if (c === WHITE) {
          visit(v);
        }
      }
    }
    path.pop();
    colour.set(u, BLACK);
  };

  for (const id of graph.vertices) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id);
  }
  return cycles;
}

/**
 * Short label for naming a cycle in the result cell (§11.2). Prefers an explicit
 * member `label`, then a result's cached display, then a number's `raw`, then
 * a truncated chain id — never invents a hue or a persisted name.
 */
export function chainCycleLabel(
  document: CalcDocument,
  chainId: ChainId,
): string {
  const chain = document.chains[chainId];
  if (!chain) return chainId;
  for (const memberId of chain.members) {
    const node = document.nodes[memberId];
    if (node?.label) return node.label;
  }
  for (const memberId of chain.members) {
    const node = document.nodes[memberId];
    if (node?.kind === 'result' && node.derived?.display) {
      return node.derived.display;
    }
  }
  for (const memberId of chain.members) {
    const node = document.nodes[memberId];
    if (node?.kind === 'number' && node.raw !== '') return node.raw;
  }
  return chainId.length > 8 ? chainId.slice(0, 8) : chainId;
}

/**
 * Topological order of chains: sources before their dependents (§11). Stable
 * among independent chains (follows `graph.vertices` order).
 *
 * When the graph contains a cycle, every vertex is still returned — nodes that
 * Kahn's algorithm cannot emit are appended in vertex order. Cycle members are
 * also listed on `graph.cycles` and painted `CircularReference` by
 * {@link recomputeFromSeeds}.
 */
export function topologicalOrder(graph: DependencyGraph): ChainId[] {
  const inDegree = new Map<ChainId, number>();
  for (const id of graph.vertices) {
    inDegree.set(id, 0);
  }
  for (const [source, deps] of graph.dependents) {
    if (!inDegree.has(source)) continue;
    for (const dep of deps) {
      if (!inDegree.has(dep)) continue;
      // Self-edge: still raises in-degree so the node is treated as cyclic.
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  const queue: ChainId[] = [];
  for (const id of graph.vertices) {
    if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  }

  const order: ChainId[] = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    order.push(id);
    const deps = graph.dependents.get(id);
    if (!deps) continue;
    for (const dep of deps) {
      const next = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }

  if (order.length < graph.vertices.length) {
    const emitted = new Set(order);
    for (const id of graph.vertices) {
      if (!emitted.has(id)) order.push(id);
    }
  }
  return order;
}

/**
 * Expand a mutation seed into the ordered list of chains that must be
 * recomputed (§11). Untouched chains are never included — §11.4's dirty-set
 * rule lives here, not in the store.
 *
 * P4.8: the seed itself (deduped, existing chains only).
 * P6.2: replace this body with "seed ∪ transitive dependents in topo order"
 * using {@link buildDependencyGraph}. Do not change the signature.
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
 * Write `derived` onto the chain's result node (create / update / dedupe). Shared
 * by the normal compute path and the cycle-colouring path so both keep one
 * result per Evaluated chain.
 */
function writeChainDerived(
  draft: CalcDocument,
  chainId: ChainId,
  derived: ResultNode['derived'],
): void {
  const chain = draft.chains[chainId];
  if (!chain || derived === undefined) return;
  const existing = resultNodesForChain(draft, chainId);

  if (existing.length > 0) {
    existing[0]!.derived = derived;
    for (let i = 1; i < existing.length; i++) {
      const dupId = existing[i]!.id;
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
 * Paint one Evaluated chain `CircularReference`, naming the cycle and recording
 * the closing reference so ResultNode can offer Unlink (§11.2). Non-Evaluated
 * chains drop any leftover result — same rule as a failed recompute.
 */
export function markChainCircular(
  draft: CalcDocument,
  chainId: ChainId,
  cycle: DependencyCycle,
): void {
  const chain = draft.chains[chainId];
  if (!chain) return;

  const status = validateChain(chain, draft.nodes);
  if (status.status !== 'Evaluated') {
    if (resultNodesForChain(draft, chainId).length > 0) {
      removeResultNodesForChain(draft, chainId);
    }
    return;
  }

  const cycleMeta: CircularReferenceCycle = {
    chainIds: [...cycle.chainIds],
    chainLabels: cycle.chainIds.map((id) => chainCycleLabel(draft, id)),
    closingReferenceNodeId: cycle.closingEdge.referenceNodeId,
  };

  writeChainDerived(draft, chainId, {
    display: '',
    computedAt: new Date().toISOString(),
    outcome: {
      status: 'error',
      error: 'CircularReference',
      cycle: cycleMeta,
    },
  });
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

  writeChainDerived(draft, chainId, derived);
}

/**
 * Mark the dirty closure of `seed` stale, then recompute each chain in order.
 * One call is the whole §11 mark→evaluate step for the seeds given — never a
 * full document sweep (§11.4).
 *
 * Cycle handling (P6.3): build the graph, DFS-colour cycles, expand the dirty
 * set to every member of any cycle that touches it (and to any chain still
 * showing `CircularReference` that is no longer cyclic after an unlink), then
 * paint cyclic chains without evaluating them so the rest of the document keeps
 * working.
 */
export function recomputeFromSeeds(
  draft: CalcDocument,
  seed: readonly ChainId[],
  locale: string,
): void {
  const graph = buildDependencyGraph(draft);
  const cycleByChain = new Map<ChainId, DependencyCycle>();
  for (const cycle of graph.cycles) {
    for (const id of cycle.chainIds) {
      if (!cycleByChain.has(id)) cycleByChain.set(id, cycle);
    }
  }

  const dirtySet = new Set(dirtyClosure(draft, seed));

  // Creating a cycle by editing one member must paint *every* member (§11).
  for (const cycle of graph.cycles) {
    if (cycle.chainIds.some((id) => dirtySet.has(id))) {
      for (const id of cycle.chainIds) dirtySet.add(id);
    }
  }

  // Breaking a cycle (unlink) leaves former members with a stale CircularReference
  // outcome; pull them into this turn so they re-evaluate as a DAG again.
  for (const node of Object.values(draft.nodes)) {
    if (node.kind !== 'result') continue;
    const outcome = node.derived?.outcome;
    if (
      outcome?.status === 'error' &&
      outcome.error === 'CircularReference' &&
      !cycleByChain.has(node.sourceChainId)
    ) {
      dirtySet.add(node.sourceChainId);
    }
  }

  const dirty = [...dirtySet].filter((id) => draft.chains[id] !== undefined);
  if (dirty.length === 0) return;

  markChainsStale(draft, dirty);
  for (const chainId of dirty) {
    const cycle = cycleByChain.get(chainId);
    if (cycle) {
      markChainCircular(draft, chainId, cycle);
    } else {
      recomputeChain(draft, chainId, locale);
    }
  }
}
