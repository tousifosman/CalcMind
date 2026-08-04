// Shared display string for a reference cell (P4.9). Layout (`widthOf`) and the
// ReferenceNode view must agree on what text is shown so hit-test boxes match glyphs.
// Identity hue is assigned by `engine/identity.ts` (P6.5) and applied in ReferenceNode.
import { formatForDisplay } from '../engine/format';
import { resultCellContent } from '../engine/errors';
import type { CalcNode, NodeId, ReferenceNode } from '../model/types';

/** What a reference cell should paint / measure. Walks through result→source display
 *  and nested references with a cycle guard; missing targets yield '' (P6.4 will make
 *  dangling explicit). */
export function referenceDisplayText(
  ref: ReferenceNode,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  visiting: Set<NodeId> = new Set(),
): string {
  if (visiting.has(ref.id)) return '';
  visiting.add(ref.id);

  const target = nodes[ref.targetNodeId];
  if (!target) return '';

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
