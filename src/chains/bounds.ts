// Node bounds and neighbour queries for snap search. See docs/ARCHITECTURE.md
// §8.2 (thresholds), §8.3 (what gets compared), §8.4 (O(n) then spatial hash).
//
// P3.2 shipped the O(n) scan behind `SnappingNeighbours` so call sites would not
// change when a uniform spatial hash landed. P7.6's profile showed O(n) at ~500
// nodes costing ~10ms/frame (~60% of a 60fps budget) on the JS drag path, so the
// hash is now the default. The linear implementation stays exported so the same
// behavioural suite can prove the two agree.
import type { CalcNode, Chain, NodeId } from '../model/types';
import { tokens } from '../ui/tokens';
import { widthOf } from './measure';

export const SNAP_DISTANCE = 28;
export const SNAP_VERTICAL = 48;
export const DETACH_DISTANCE = 44;

/** §8.4: uniform bucket edge. Square cells; chains span every bucket they overlap. */
export const SPATIAL_HASH_BUCKET = 2 * tokens.nodeHeight;

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChainBoundary {
  index: number;
  x: number;
}

export interface SnappingNeighbours {
  chainsNear(node: CalcNode): Chain[];
  freeNodesNear(node: CalcNode): CalcNode[];
}

type NeighbourFactory = (
  chains: Record<string, Chain>,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  /** Live numeral font size (§1.2 P7 preference); defaults to the compiled-in
   *  token — see `boundsOf`'s matching parameter. */
  fontSize?: number,
) => SnappingNeighbours;

interface ChainEntry {
  chain: Chain;
  bounds: Bounds;
}

interface FreeEntry {
  node: CalcNode;
  bounds: Bounds;
}

function horizontalBounds(left: number, width: number): Pick<Bounds, 'left' | 'right'> {
  return { left, right: left + width };
}

export function boundsOf(
  node: CalcNode,
  locale: string,
  nodes?: Record<NodeId, CalcNode>,
  /** Live numeral font size (§1.2 P7 preference). Defaults to the compiled-in token
   *  so every existing caller/test that predates the setting keeps behaving exactly
   *  as before; production call sites pass the live `usePreferencesStore` value
   *  explicitly (never read it in here — this module stays pure, like `widthOf`
   *  itself, whose same-named/defaulted parameter this mirrors). */
  fontSize: number = tokens.numeralFontSize,
): Bounds {
  const { left, right } = horizontalBounds(
    node.position.x,
    widthOf(node, locale, fontSize, nodes),
  );
  return {
    left,
    right,
    top: node.position.y,
    bottom: node.position.y + tokens.nodeHeight,
  };
}

export function verticalOverlap(a: Bounds, b: Bounds): number {
  if (a.bottom < b.top) return b.top - a.bottom;
  if (b.bottom < a.top) return a.top - b.bottom;
  return 0;
}

export function memberBoundaries(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  fontSize: number = tokens.numeralFontSize,
): ChainBoundary[] {
  const boundaries: ChainBoundary[] = [];
  let x = chain.anchor.x;

  for (let index = 0; index < chain.members.length - 1; index += 1) {
    const member = nodes[chain.members[index]];
    if (!member) continue;
    x += widthOf(member, locale, fontSize, nodes);
    boundaries.push({ index: index + 1, x });
  }

  return boundaries;
}

function chainBounds(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  fontSize: number,
): Bounds | null {
  const firstMember = chain.members.find((id) => nodes[id]);
  if (!firstMember) return null;

  let width = 0;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    width += widthOf(member, locale, fontSize, nodes);
  }

  const { left, right } = horizontalBounds(chain.anchor.x, width);
  return {
    left,
    right,
    top: chain.anchor.y,
    bottom: chain.anchor.y + tokens.nodeHeight,
  };
}

function collectEntries(
  chains: Record<string, Chain>,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
  fontSize: number,
): { chainEntries: ChainEntry[]; freeEntries: FreeEntry[] } {
  const chainEntries = Object.values(chains)
    .map((chain) => ({ chain, bounds: chainBounds(chain, nodes, locale, fontSize) }))
    .filter((entry): entry is ChainEntry => entry.bounds !== null);

  const freeEntries: FreeEntry[] = [];
  for (const node of Object.values(nodes)) {
    if (node.chainId !== null || node.kind === 'reference') continue;
    freeEntries.push({ node, bounds: boundsOf(node, locale, undefined, fontSize) });
  }

  return { chainEntries, freeEntries };
}

function isVerticallyNear(dragged: Bounds, candidate: Bounds): boolean {
  return verticalOverlap(dragged, candidate) < SNAP_VERTICAL;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** O(n) scan — the P3.2 shipping path, kept for behavioural parity tests. */
export const makeLinearSnappingNeighbours: NeighbourFactory = (
  chains,
  nodes,
  locale,
  fontSize = tokens.numeralFontSize,
) => {
  const { chainEntries, freeEntries } = collectEntries(chains, nodes, locale, fontSize);

  return {
    chainsNear(node) {
      const draggedBounds = boundsOf(node, locale, undefined, fontSize);
      return chainEntries
        .filter(
          ({ chain, bounds }) =>
            chain.id !== node.chainId && isVerticallyNear(draggedBounds, bounds),
        )
        .map(({ chain }) => chain)
        .sort(byId);
    },
    freeNodesNear(node) {
      const draggedBounds = boundsOf(node, locale, undefined, fontSize);
      return freeEntries
        .filter(
          ({ node: candidate, bounds }) =>
            candidate.id !== node.id && isVerticallyNear(draggedBounds, bounds),
        )
        .map(({ node: candidate }) => candidate)
        .sort(byId);
    },
  };
};

function bucketCoord(value: number, bucketSize: number): number {
  return Math.floor(value / bucketSize);
}

function bucketKey(by: number): string {
  return String(by);
}

/** Insert an axis-aligned box into every Y-bucket it overlaps.
 *  Neighbour filtering is vertical-only (`SNAP_VERTICAL`); horizontal
 *  gating lives in `resolveSnapCandidate` (`SNAP_DISTANCE`). A 1D Y hash
 *  with §8.4's `2 × nodeHeight` bucket edge therefore matches the interface
 *  contract without falsely dropping far-but-coplanar candidates. */
function insertIntoBuckets<T>(
  map: Map<string, T[]>,
  bounds: Bounds,
  item: T,
  bucketSize: number,
): void {
  const y0 = bucketCoord(bounds.top, bucketSize);
  const y1 = bucketCoord(bounds.bottom, bucketSize);
  for (let by = y0; by <= y1; by += 1) {
    const key = bucketKey(by);
    let cell = map.get(key);
    if (!cell) {
      cell = [];
      map.set(key, cell);
    }
    cell.push(item);
  }
}

/** Y-buckets a vertically-near neighbour of `dragged` could occupy. Expand by
 *  `SNAP_VERTICAL` plus one bucket of slop so a box that straddles a bucket
 *  edge is never missed; the exact `verticalOverlap` filter still runs. */
function queryBucketKeys(dragged: Bounds, bucketSize: number): string[] {
  const padY = SNAP_VERTICAL + bucketSize;
  const y0 = bucketCoord(dragged.top - padY, bucketSize);
  const y1 = bucketCoord(dragged.bottom + padY, bucketSize);
  const keys: string[] = [];
  for (let by = y0; by <= y1; by += 1) {
    keys.push(bucketKey(by));
  }
  return keys;
}

/** Uniform spatial hash (§8.4). Same `SnappingNeighbours` surface as the linear
 *  scan — `useNodeDrag` and `resolveSnapCandidate` call sites unchanged. */
export const makeSpatialHashSnappingNeighbours: NeighbourFactory = (
  chains,
  nodes,
  locale,
  fontSize = tokens.numeralFontSize,
) => {
  const { chainEntries, freeEntries } = collectEntries(chains, nodes, locale, fontSize);
  const bucketSize = SPATIAL_HASH_BUCKET;
  const chainBuckets = new Map<string, ChainEntry[]>();
  const freeBuckets = new Map<string, FreeEntry[]>();

  for (const entry of chainEntries) {
    insertIntoBuckets(chainBuckets, entry.bounds, entry, bucketSize);
  }
  for (const entry of freeEntries) {
    insertIntoBuckets(freeBuckets, entry.bounds, entry, bucketSize);
  }

  return {
    chainsNear(node) {
      const draggedBounds = boundsOf(node, locale, undefined, fontSize);
      const seen = new Set<string>();
      const out: Chain[] = [];
      for (const key of queryBucketKeys(draggedBounds, bucketSize)) {
        const cell = chainBuckets.get(key);
        if (!cell) continue;
        for (const { chain, bounds } of cell) {
          if (seen.has(chain.id)) continue;
          seen.add(chain.id);
          if (chain.id === node.chainId) continue;
          if (!isVerticallyNear(draggedBounds, bounds)) continue;
          out.push(chain);
        }
      }
      return out.sort(byId);
    },
    freeNodesNear(node) {
      const draggedBounds = boundsOf(node, locale, undefined, fontSize);
      const seen = new Set<string>();
      const out: CalcNode[] = [];
      for (const key of queryBucketKeys(draggedBounds, bucketSize)) {
        const cell = freeBuckets.get(key);
        if (!cell) continue;
        for (const { node: candidate, bounds } of cell) {
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          if (candidate.id === node.id) continue;
          if (!isVerticallyNear(draggedBounds, bounds)) continue;
          out.push(candidate);
        }
      }
      return out.sort(byId);
    },
  };
};

/** Shipping neighbour query (§8.4). Call sites stay on this name. */
export const makeSnappingNeighbours: NeighbourFactory = makeSpatialHashSnappingNeighbours;
