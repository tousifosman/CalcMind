// Identity hues (§11.1, decision #12): a value becomes a named thing when something
// references it or the user labels it; either alone grants a hue from a rotating
// palette. Hue is derived at render time and never persisted — reopening a document
// reassigns the same colours from a deterministic traversal of identity-bearing
// node ids.
//
// Pure: reads node records only. The palette is passed in so this module stays free
// of `ui/` imports (engine rule in AGENTS.md / §14); callers supply `identityHues`
// from `src/ui/tokens.ts`.
import type { CalcNode, NodeId } from '../model/types';

/** True when `label` is a non-empty string. Absent / `''` do not grant identity. */
export function nodeHasLabel(node: CalcNode): boolean {
  return typeof node.label === 'string' && node.label.length > 0;
}

/**
 * The node that owns an identity's caption (§11.1): numbers and results store
 * `label`; a reference looks through to its target. `null` when `nodeId` is
 * missing, dangling, or not a value (operators / equals / parens cannot be
 * labelled via the command layer — colour is spent on values, not chrome).
 */
export function identitySourceId(
  nodes: Record<NodeId, CalcNode>,
  nodeId: NodeId,
): NodeId | null {
  const node = nodes[nodeId];
  if (!node) return null;
  if (node.kind === 'reference') {
    const target = nodes[node.targetNodeId];
    if (!target) return null;
    if (target.kind === 'number' || target.kind === 'result') return target.id;
    return null;
  }
  if (node.kind === 'number' || node.kind === 'result') return node.id;
  return null;
}

/**
 * Caption rendered above a cell for this identity (§11.1): looked up on the
 * declaring source, never on a reference's own `label` field. Editing the
 * source therefore updates every reference that shares the identity.
 */
export function labelForNode(
  nodes: Record<NodeId, CalcNode>,
  nodeId: NodeId,
): string | undefined {
  const sourceId = identitySourceId(nodes, nodeId);
  if (sourceId === null) return undefined;
  const source = nodes[sourceId];
  if (!source || !nodeHasLabel(source)) return undefined;
  return source.label;
}

/**
 * Node ids that something in `nodes` currently references. Missing targets are
 * still collected here; {@link assignIdentityHues} only assigns a hue when the
 * target exists in `nodes` (dangling refs do not invent identities).
 */
export function referencedNodeIds(
  nodes: Record<NodeId, CalcNode>,
): ReadonlySet<NodeId> {
  const ids = new Set<NodeId>();
  for (const node of Object.values(nodes)) {
    if (node.kind === 'reference') {
      ids.add(node.targetNodeId);
    }
  }
  return ids;
}

/**
 * Values that carry an identity: referenced **or** labelled (§11.1,
 * `2026-08-03` revision 1). Sorted lexicographically by id — that is the
 * stable "traversal order" decision #12 needs. Live `Object.keys` order follows
 * creation and changes across serialize→deserialize (arrays sorted by id on
 * disk), so sorting is what makes save/reload hue assignment identical.
 */
export function identityBearingNodeIds(
  nodes: Record<NodeId, CalcNode>,
): NodeId[] {
  const referenced = referencedNodeIds(nodes);
  const ids: NodeId[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (nodeHasLabel(node) || referenced.has(id)) {
      ids.push(id);
    }
  }
  ids.sort();
  return ids;
}

/**
 * Map from identity-bearing source node id → palette colour. Empty palette
 * yields an empty map (no hues to spend). Indices wrap with `%` so a document
 * with more identities than swatches still colours every one.
 *
 * References are **not** keys in this map — they look up their `targetNodeId`.
 * No identity → absent from the map → caller paints the structural role palette
 * only (§11.1: colour is spent only where it carries information).
 */
export function assignIdentityHues(
  nodes: Record<NodeId, CalcNode>,
  palette: readonly string[],
): ReadonlyMap<NodeId, string> {
  const hues = new Map<NodeId, string>();
  if (palette.length === 0) return hues;

  const sources = identityBearingNodeIds(nodes);
  for (let i = 0; i < sources.length; i++) {
    hues.set(sources[i]!, palette[i % palette.length]!);
  }
  return hues;
}
