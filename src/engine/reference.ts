// Reference resolution for display and dangling recovery (§11, §11.2, P6.4).
//
// A reference is dangling when its target is missing from the document. Deleting a
// target must not cascade into consumers (§11) — instead `prepareReferencesForDeletion`
// stamps `lastKnownDisplay` so the cell can keep showing a dimmed struck-through value
// rather than a bare `?` (§11.2).
import { formatForDisplay } from './format';
import { resultCellContent } from './errors';
import type { CalcDocument, CalcNode, NodeId, ReferenceNode } from '../model/types';

/** True when the reference's target is gone. Derived — never a stored flag. */
export function isDanglingReference(
  ref: ReferenceNode,
  nodes: Record<NodeId, CalcNode>,
): boolean {
  return nodes[ref.targetNodeId] === undefined;
}

/**
 * What a reference cell should paint / measure. Walks through result→source display
 * and nested references with a cycle guard. Missing targets yield `lastKnownDisplay`
 * (P6.4) so layout and the view agree on the struck-through glyph.
 */
export function referenceDisplayText(
  ref: ReferenceNode,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  visiting: Set<NodeId> = new Set(),
): string {
  if (visiting.has(ref.id)) return '';
  visiting.add(ref.id);

  const target = nodes[ref.targetNodeId];
  if (!target) return ref.lastKnownDisplay ?? '';

  switch (target.kind) {
    case 'number':
      return formatForDisplay(target.raw, locale);
    case 'result':
      return resultCellContent(target.derived).text;
    case 'reference':
      return referenceDisplayText(target, nodes, locale, visiting);
    default:
      return '';
  }
}

export type ReferenceCellContent =
  | { mode: 'live'; text: string; dimmed: false }
  | { mode: 'dangling'; text: string; dimmed: true };

/**
 * Map a reference to what the cell should show. Pure so `widthOf` and `ReferenceNode`
 * agree without the view owning the §11.2 rules.
 */
export function referenceCellContent(
  ref: ReferenceNode,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): ReferenceCellContent {
  if (isDanglingReference(ref, nodes)) {
    return {
      mode: 'dangling',
      text: ref.lastKnownDisplay ?? '',
      dimmed: true,
    };
  }
  return { mode: 'live', text: referenceDisplayText(ref, nodes, locale), dimmed: false };
}

/** Explanation offered when the user taps a dangling reference (§11.2). */
export function explainDanglingReference(): string {
  return 'This value was deleted. The link no longer points anywhere.';
}

/**
 * Before removing nodes, stamp every reference that pointed at them with the live
 * display string so the cell can keep showing it under `DanglingReference`. Does not
 * delete the references — cascading delete is forbidden (§11).
 */
export function prepareReferencesForDeletion(
  draft: CalcDocument,
  deletedIds: ReadonlySet<NodeId>,
  locale: string,
): void {
  if (deletedIds.size === 0) return;
  for (const node of Object.values(draft.nodes)) {
    if (node.kind !== 'reference') continue;
    if (!deletedIds.has(node.targetNodeId)) continue;
    // Capture while the target is still present. If it is already gone, keep any
    // earlier stamp rather than overwriting with ''.
    if (draft.nodes[node.targetNodeId]) {
      node.lastKnownDisplay = referenceDisplayText(node, draft.nodes, locale);
    } else if (node.lastKnownDisplay === undefined) {
      node.lastKnownDisplay = '';
    }
  }
}

/** Delete `ids` after stamping any references that pointed at them (§11 / P6.4). */
export function deleteNodesLeavingDanglingRefs(
  draft: CalcDocument,
  ids: Iterable<NodeId>,
  locale: string,
): void {
  const deletedIds = ids instanceof Set ? ids : new Set(ids);
  prepareReferencesForDeletion(draft, deletedIds, locale);
  for (const id of deletedIds) {
    delete draft.nodes[id];
  }
}

/** Nodes a dangling reference may be re-pointed at: values, not structural glyphs. */
export function isRepointTarget(
  nodeId: NodeId,
  nodes: Record<NodeId, CalcNode>,
  /** The dangling reference being repaired — cannot point at itself. */
  selfId: NodeId,
): boolean {
  if (nodeId === selfId) return false;
  const node = nodes[nodeId];
  if (!node) return false;
  if (node.kind === 'number' || node.kind === 'result') return true;
  if (node.kind === 'reference') return !isDanglingReference(node, nodes);
  return false;
}
