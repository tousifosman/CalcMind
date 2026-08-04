import type { CalcNode, Chain, NodeId } from '../model/types';
import { tokens } from '../ui/tokens';
import { widthOf } from './measure';

export const SNAP_DISTANCE = 28;
export const SNAP_VERTICAL = 48;
export const DETACH_DISTANCE = 44;

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

function horizontalBounds(left: number, width: number): Pick<Bounds, 'left' | 'right'> {
  return { left, right: left + width };
}

export function boundsOf(node: CalcNode, locale: string): Bounds {
  const { left, right } = horizontalBounds(node.position.x, widthOf(node, locale));
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
): ChainBoundary[] {
  const boundaries: ChainBoundary[] = [];
  let x = chain.anchor.x;

  for (let index = 0; index < chain.members.length - 1; index += 1) {
    const member = nodes[chain.members[index]];
    if (!member) continue;
    x += widthOf(member, locale);
    boundaries.push({ index: index + 1, x });
  }

  return boundaries;
}

function chainBounds(chain: Chain, nodes: Record<NodeId, CalcNode>, locale: string): Bounds | null {
  const firstMember = chain.members.find((id) => nodes[id]);
  if (!firstMember) return null;

  let width = 0;
  for (const memberId of chain.members) {
    const member = nodes[memberId];
    if (!member) continue;
    width += widthOf(member, locale);
  }

  const { left, right } = horizontalBounds(chain.anchor.x, width);
  return {
    left,
    right,
    top: chain.anchor.y,
    bottom: chain.anchor.y + tokens.nodeHeight,
  };
}

export function makeSnappingNeighbours(
  chains: Record<string, Chain>,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): SnappingNeighbours {
  const chainEntries = Object.values(chains)
    .map((chain) => ({ chain, bounds: chainBounds(chain, nodes, locale) }))
    .filter((entry): entry is { chain: Chain; bounds: Bounds } => entry.bounds !== null);
  const freeNodes = Object.values(nodes).filter((node) => node.chainId === null && node.kind !== 'reference');

  return {
    chainsNear(node) {
      const draggedBounds = boundsOf(node, locale);
      return chainEntries
        .filter(({ chain, bounds }) => chain.id !== node.chainId && verticalOverlap(draggedBounds, bounds) < SNAP_VERTICAL)
        .map(({ chain }) => chain);
    },
    freeNodesNear(node) {
      const draggedBounds = boundsOf(node, locale);
      return freeNodes.filter(
        (candidate) => candidate.id !== node.id && verticalOverlap(draggedBounds, boundsOf(candidate, locale)) < SNAP_VERTICAL,
      );
    },
  };
}
