// Per-node identity hue from the document (§11.1 / P6.5). Thin store wrappers so
// node views stay free of the assignment walk; each subscription only re-renders
// when *that* node's resolved hue string changes (zustand Object.is on the result).
//
// §11.4: the hue map is derived once per `document.nodes` identity and shared
// across every subscriber. Without this cache, each mounted node would re-walk
// the whole document on every store update — a full sweep, which the budget
// forbids. Re-render scope is still per-node: only the returned string is compared.
import { useDocumentStore } from '../store/documentStore';
import { assignIdentityHues, identitySourceId } from '../engine/identity';
import { identityHues } from '../ui/tokens';
import type { CalcNode, NodeId } from '../model/types';

let cachedNodes: Record<NodeId, CalcNode> | null = null;
let cachedMap: ReadonlyMap<NodeId, string> | null = null;

/** Identity-hue map for `nodes`, recomputed only when the record identity changes. */
export function identityHueMapFor(
  nodes: Record<NodeId, CalcNode>,
): ReadonlyMap<NodeId, string> {
  if (nodes === cachedNodes && cachedMap !== null) {
    return cachedMap;
  }
  cachedNodes = nodes;
  cachedMap = assignIdentityHues(nodes, identityHues);
  return cachedMap;
}

/** Test-only: drop the module cache so a suite can't leak map identity across cases. */
export function resetIdentityHueCacheForTests(): void {
  cachedNodes = null;
  cachedMap = null;
}

/** Hue for an identity-bearing source (referenced or labelled). `undefined` → no ring. */
export function useSourceIdentityHue(nodeId: NodeId): string | undefined {
  return useDocumentStore((state) =>
    identityHueMapFor(state.document.nodes).get(nodeId),
  );
}

/** Hue a reference cell should fill with — the ultimate source's identity hue. */
export function useReferenceIdentityHue(referenceId: NodeId): string | undefined {
  return useDocumentStore((state) => {
    const sourceId = identitySourceId(state.document.nodes, referenceId);
    if (!sourceId) return undefined;
    return identityHueMapFor(state.document.nodes).get(sourceId);
  });
}
