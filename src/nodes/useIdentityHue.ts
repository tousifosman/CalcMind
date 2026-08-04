// Per-node identity hue from the document (§11.1 / P6.5). Thin store wrappers so
// node views stay free of the assignment walk; each subscription only re-renders
// when *that* node's resolved hue string changes (zustand Object.is on the result).
import { useDocumentStore } from '../store/documentStore';
import { assignIdentityHues } from '../engine/identity';
import { identityHues } from '../ui/tokens';
import type { NodeId } from '../model/types';

/** Hue for an identity-bearing source (referenced or labelled). `undefined` → no ring. */
export function useSourceIdentityHue(nodeId: NodeId): string | undefined {
  return useDocumentStore((state) =>
    assignIdentityHues(state.document.nodes, identityHues).get(nodeId),
  );
}

/** Hue a reference cell should fill with — the target's identity hue, if any. */
export function useReferenceIdentityHue(referenceId: NodeId): string | undefined {
  return useDocumentStore((state) => {
    const node = state.document.nodes[referenceId];
    if (!node || node.kind !== 'reference') return undefined;
    return assignIdentityHues(state.document.nodes, identityHues).get(
      node.targetNodeId,
    );
  });
}
