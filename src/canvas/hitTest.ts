// Ad hoc tap hit-testing against node bounding boxes, built from §8.1's authoritative
// `position` and P2.2's `widthOf`. This is NOT P3.2's real neighbour-query interface - there
// is no chain layout yet for it to serve, and no promise that call sites survive a later
// spatial hash (§8.4 is about drag-frame snap search, a different problem). It exists only so
// a tap (P2.6) can tell "landed on a node" from "landed on empty canvas" before P3 exists.
import { CalcNode, Vec2 } from '../model/types';
import { tokens } from '../ui/tokens';
import { widthOf } from '../chains/measure';

function containsPoint(node: CalcNode, point: Vec2, locale: string): boolean {
  const width = widthOf(node, locale);
  const { x, y } = node.position;
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + tokens.nodeHeight;
}

/** Returns the node under `point` (world coordinates), or `null` for empty canvas. Reference
 *  nodes aren't created before P6 (§6) and `widthOf` throws for that kind, so they're skipped
 *  here rather than letting a tap near one crash. */
export function hitTestNode(
  nodes: Record<string, CalcNode>,
  point: Vec2,
  locale: string,
): CalcNode | null {
  for (const node of Object.values(nodes)) {
    if (node.kind === 'reference') continue;
    if (containsPoint(node, point, locale)) return node;
  }
  return null;
}
