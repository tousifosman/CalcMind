// Connector geometry for reference links (§11.1, §11.3, decision #13).
//
// Pure: takes node positions + a hue map and returns drawable curves / collapse
// badges. The React overlay (`ConnectorLayer.tsx`) owns SVG; this module owns the
// arithmetic so fan layout and the >4 collapse rule can be tested without a
// renderer.
//
// Bezier shape follows `docs/assets/linking-model.svg`: a vertical cubic from the
// source cell's bottom edge to the reference cell's top edge. 1→N fans start
// points across the source bottom and push control points outward so curves leave
// at distinct angles rather than stacking on one exit.
import { boundsOf, type Bounds } from '../chains/bounds';
import { dependencyEdgeKey } from '../engine/graph';
import type { CalcNode, NodeId, Vec2 } from '../model/types';

/** Collapse a source's fan to a count badge when it has more than this many
 *  live consumers (§11.1 "more than ~4"). */
export const CONNECTOR_FAN_COLLAPSE_AT = 5;

/** Stroke width in world dp — reads clearly at default zoom without overpowering
 *  the 64dp cell chrome. */
export const CONNECTOR_STROKE_WIDTH = 3;

/** Vertical distance from each endpoint to its cubic control point. Tuned so a
 *  typical continuation gap (§8.7 / `CONTINUATION_OFFSET.y`) bows rather than
 *  reading as a straight diagonal. */
export const CONNECTOR_CONTROL_OFFSET = 42;

/** Horizontal spacing between fan exit points along the source bottom edge. */
export const CONNECTOR_FAN_SPREAD = 14;

/** Opacity for connectors that are not part of the current selection. All links
 *  stay drawn (decision #13); this is the density escape hatch — fade, don't hide. */
export const CONNECTOR_UNSELECTED_OPACITY = 0.35;

/** Neutral fallback when a live link somehow has no identity hue — keeps the
 *  non-chromatic channel (the line itself) even if the palette walk misses. */
export const CONNECTOR_NEUTRAL_HUE = '#6B7280';

export interface ConnectorLink {
  sourceNodeId: NodeId;
  referenceNodeId: NodeId;
}

export interface ConnectorCurve {
  key: string;
  sourceNodeId: NodeId;
  referenceNodeId: NodeId;
  hue: string;
  /** SVG cubic path in world coordinates. */
  d: string;
  opacity: number;
}

export interface ConnectorBadge {
  sourceNodeId: NodeId;
  count: number;
  hue: string;
  /** World-space centre of the badge. */
  position: Vec2;
}

export interface ConnectorSceneBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ConnectorScene {
  curves: ConnectorCurve[];
  badges: ConnectorBadge[];
  /** Distinct hues that need an SVG arrowhead marker. */
  hues: string[];
  bounds: ConnectorSceneBounds | null;
}

function centerBottom(bounds: Bounds): Vec2 {
  return { x: (bounds.left + bounds.right) / 2, y: bounds.bottom };
}

function centerTop(bounds: Bounds): Vec2 {
  return { x: (bounds.left + bounds.right) / 2, y: bounds.top };
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.min(max, Math.max(min, value));
}

/** Live reference links: target exists. Dangling refs contribute nothing — there
 *  is no source cell to draw from (§11.2 owns their chrome instead). */
export function collectConnectorLinks(
  nodes: Record<NodeId, CalcNode>,
): ConnectorLink[] {
  const links: ConnectorLink[] = [];
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'reference') continue;
    if (nodes[node.targetNodeId] === undefined) continue;
    links.push({
      sourceNodeId: node.targetNodeId,
      referenceNodeId: node.id,
    });
  }
  return links;
}

/** Stable fan order: left-to-right by reference position, then id. */
export function sortFanConsumers(
  links: readonly ConnectorLink[],
  nodes: Record<NodeId, CalcNode>,
): ConnectorLink[] {
  return [...links].sort((a, b) => {
    const ax = nodes[a.referenceNodeId]?.position.x ?? 0;
    const bx = nodes[b.referenceNodeId]?.position.x ?? 0;
    if (ax !== bx) return ax - bx;
    return a.referenceNodeId < b.referenceNodeId
      ? -1
      : a.referenceNodeId > b.referenceNodeId
        ? 1
        : 0;
  });
}

/**
 * Cubic path from `start` to `end` with a vertical bow. `fanIndex` / `fanCount`
 * shift the exit point along the source bottom and push the first control point
 * outward so a 1→N fan leaves at distinct angles (§11.1).
 */
export function connectorPath(
  start: Vec2,
  end: Vec2,
  fanIndex: number,
  fanCount: number,
  sourceBounds: Bounds,
): string {
  const mid = (fanCount - 1) / 2;
  const fanOffset = fanCount <= 1 ? 0 : (fanIndex - mid) * CONNECTOR_FAN_SPREAD;
  const inset = 4;
  const sx = clamp(
    start.x + fanOffset,
    sourceBounds.left + inset,
    sourceBounds.right - inset,
  );
  const sy = start.y;
  const ex = end.x;
  const ey = end.y;
  const goingDown = ey >= sy;
  const vertical = goingDown
    ? CONNECTOR_CONTROL_OFFSET
    : -CONNECTOR_CONTROL_OFFSET;
  // Outward push on the first control gives the fan its angle; the second stays
  // above the reference so the arrowhead arrives near-vertical.
  const c1x = sx + fanOffset * 0.5;
  const c1y = sy + vertical;
  const c2x = ex;
  const c2y = ey - vertical;
  return `M${sx} ${sy} C${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
}

function linkInvolvesSelection(
  link: ConnectorLink,
  selectedNodeId: NodeId | null,
): boolean {
  if (selectedNodeId === null) return false;
  return (
    link.sourceNodeId === selectedNodeId ||
    link.referenceNodeId === selectedNodeId
  );
}

function groupExpanded(
  links: readonly ConnectorLink[],
  selectedNodeId: NodeId | null,
): boolean {
  if (links.length < CONNECTOR_FAN_COLLAPSE_AT) return true;
  return links.some((link) => linkInvolvesSelection(link, selectedNodeId));
}

function curveOpacity(
  link: ConnectorLink,
  selectedNodeId: NodeId | null,
  anyLinkSelected: boolean,
): number {
  if (!anyLinkSelected) return 1;
  return linkInvolvesSelection(link, selectedNodeId)
    ? 1
    : CONNECTOR_UNSELECTED_OPACITY;
}

function expandBounds(
  bounds: ConnectorSceneBounds | null,
  x: number,
  y: number,
  pad: number,
): ConnectorSceneBounds {
  if (bounds === null) {
    return {
      minX: x - pad,
      minY: y - pad,
      width: pad * 2,
      height: pad * 2,
    };
  }
  const minX = Math.min(bounds.minX, x - pad);
  const minY = Math.min(bounds.minY, y - pad);
  const maxX = Math.max(bounds.minX + bounds.width, x + pad);
  const maxY = Math.max(bounds.minY + bounds.height, y + pad);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build the drawable connector scene for the current document.
 *
 * @param selectedNodeId — when set, a collapsed (>4) fan expands if the
 *   selection is the source or any of its consumers; otherwise unselected
 *   curves fade rather than disappear (decision #13).
 */
export function buildConnectorScene(
  nodes: Record<NodeId, CalcNode>,
  hues: ReadonlyMap<NodeId, string>,
  locale: string,
  selectedNodeId: NodeId | null,
): ConnectorScene {
  const links = collectConnectorLinks(nodes);
  if (links.length === 0) {
    return { curves: [], badges: [], hues: [], bounds: null };
  }

  const bySource = new Map<NodeId, ConnectorLink[]>();
  for (const link of links) {
    const bucket = bySource.get(link.sourceNodeId);
    if (bucket) bucket.push(link);
    else bySource.set(link.sourceNodeId, [link]);
  }

  const anyLinkSelected = links.some((link) =>
    linkInvolvesSelection(link, selectedNodeId),
  );

  const curves: ConnectorCurve[] = [];
  const badges: ConnectorBadge[] = [];
  const hueSet = new Set<string>();
  let bounds: ConnectorSceneBounds | null = null;
  const pad = CONNECTOR_STROKE_WIDTH * 4 + 12;

  // Stable source order so React keys and marker emission don't shuffle.
  const sourceIds = [...bySource.keys()].sort();
  for (const sourceId of sourceIds) {
    const group = sortFanConsumers(bySource.get(sourceId)!, nodes);
    const source = nodes[sourceId];
    if (!source) continue;
    const sourceBounds = boundsOf(source, locale, nodes);
    const hue = hues.get(sourceId) ?? CONNECTOR_NEUTRAL_HUE;
    hueSet.add(hue);

    if (!groupExpanded(group, selectedNodeId)) {
      const anchor = centerBottom(sourceBounds);
      const badge: ConnectorBadge = {
        sourceNodeId: sourceId,
        count: group.length,
        hue,
        position: { x: anchor.x, y: anchor.y + 14 },
      };
      badges.push(badge);
      bounds = expandBounds(bounds, badge.position.x, badge.position.y, pad);
      continue;
    }

    const start = centerBottom(sourceBounds);
    for (let i = 0; i < group.length; i++) {
      const link = group[i]!;
      const ref = nodes[link.referenceNodeId];
      if (!ref) continue;
      const refBounds = boundsOf(ref, locale, nodes);
      const end = centerTop(refBounds);
      const d = connectorPath(start, end, i, group.length, sourceBounds);
      curves.push({
        key: dependencyEdgeKey(link.sourceNodeId, link.referenceNodeId),
        sourceNodeId: link.sourceNodeId,
        referenceNodeId: link.referenceNodeId,
        hue,
        d,
        opacity: curveOpacity(link, selectedNodeId, anyLinkSelected),
      });
      bounds = expandBounds(bounds, start.x, start.y, pad);
      bounds = expandBounds(bounds, end.x, end.y, pad);
    }
  }

  return {
    curves,
    badges,
    hues: [...hueSet].sort(),
    bounds,
  };
}

/** Sanitize a hex colour into a valid SVG fragment id (`#2F6BFF` → `2F6BFF`). */
export function connectorMarkerId(hue: string): string {
  return `cm-arrow-${hue.replace(/[^A-Za-z0-9_-]/g, '')}`;
}
