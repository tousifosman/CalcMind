// Document ↔ §12.1 JSON. Arrays on disk, Records in memory; keys sorted for byte-stable
// files; `derived` stripped on write (save sequence in §12.3). Validation belongs to the
// load boundary (P5.2) — this module only shapes and stringifies.
import { CalcDocument, CalcNode, Chain, ChainId, NodeId, ResultNode } from '../model/types';

/** On-disk schema URL for a given `schemaVersion` (§12.1 sample). */
export function documentSchemaUrl(schemaVersion: number): string {
  return `https://calcmind.app/schema/document-${schemaVersion}.json`;
}

/** Wire shape: same fields as `CalcDocument`, plus `$schema`, with `nodes`/`chains` as arrays. */
export interface SerializedDocument {
  $schema: string;
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  viewport: CalcDocument['viewport'];
  nodes: CalcNode[];
  chains: Chain[];
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Drop `derived` from a result node; other kinds pass through unchanged. */
export function stripDerived(node: CalcNode): CalcNode {
  if (node.kind !== 'result' || node.derived === undefined) {
    return node;
  }
  const rest: ResultNode = { ...node };
  delete rest.derived;
  return rest;
}

/** Deep-clone with every object's keys in sorted order — feeds `JSON.stringify` for
 *  byte-identical output across runs (§12.1). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Records → sorted arrays, strip every `derived`, attach `$schema`. Pure; does not mutate. */
export function toSerializedDocument(doc: CalcDocument): SerializedDocument {
  const nodes = Object.values(doc.nodes)
    .map(stripDerived)
    .sort(byId);
  const chains = Object.values(doc.chains).sort(byId);
  return {
    $schema: documentSchemaUrl(doc.schemaVersion),
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    viewport: {
      ...doc.viewport,
      pan: { ...doc.viewport.pan },
    },
    nodes,
    chains,
  };
}

/**
 * Document → the §12.1 JSON string, byte-stably.
 * Pretty-printed (2-space) so files stay inspectable and git-diffable (decision #5).
 * Member `position` is written even when redundant with `anchor` + `members` (§12.1);
 * the load pipeline ignores it for members and re-runs layout (P5.5).
 */
export function serializeDocument(doc: CalcDocument): string {
  return `${JSON.stringify(sortKeysDeep(toSerializedDocument(doc)), null, 2)}\n`;
}

/**
 * Structural inverse of `serializeDocument`: arrays → Records, drop `$schema`.
 * Does **not** validate (P5.2) and does **not** re-run layout (P5.5) — positions come
 * back as written, which is what the round-trip equality test needs.
 */
export function deserializeDocument(json: string): CalcDocument {
  const raw = JSON.parse(json) as SerializedDocument;
  const nodes: Record<NodeId, CalcNode> = {};
  for (const node of raw.nodes) {
    nodes[node.id] = node;
  }
  const chains: Record<ChainId, Chain> = {};
  for (const chain of raw.chains) {
    chains[chain.id] = chain;
  }
  return {
    schemaVersion: raw.schemaVersion,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    viewport: raw.viewport,
    nodes,
    chains,
  };
}
