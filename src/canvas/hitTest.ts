// Ad hoc tap hit-testing against node bounding boxes, built from §8.1's authoritative
// `position` and P2.2's `widthOf`. This is NOT P3.2's real neighbour-query interface - there
// is no chain layout yet for it to serve, and no promise that call sites survive a later
// spatial hash (§8.4 is about drag-frame snap search, a different problem). It exists only so
// a tap (P2.6) can tell "landed on a node" from "landed on empty canvas" before P3 exists.
import { CalcNode, Vec2 } from '../model/types';
import { tokens, nodeHeightFor } from '../ui/tokens';
import { widthOf } from '../chains/measure';

function containsPoint(
  node: CalcNode,
  point: Vec2,
  locale: string,
  nodes: Record<string, CalcNode>,
  fontSize: number,
): boolean {
  const width = widthOf(node, locale, fontSize, nodes);
  const { x, y } = node.position;
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + nodeHeightFor(fontSize);
}

/** Returns the node under `point` (world coordinates), or `null` for empty canvas. */
export function hitTestNode(
  nodes: Record<string, CalcNode>,
  point: Vec2,
  locale: string,
  /** Live numeral font size (§1.2 P7 preference); defaults to the compiled-in
   *  token, same as `widthOf`'s own matching parameter. */
  fontSize: number = tokens.numeralFontSize,
): CalcNode | null {
  for (const node of Object.values(nodes)) {
    if (containsPoint(node, point, locale, nodes, fontSize)) return node;
  }
  return null;
}
