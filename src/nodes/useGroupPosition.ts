// Where a cell sits within its chain's flush run (§1.1: "cells sit flush ... reads as a
// single pill rather than a row of separate chips"). `docs/assets/formula-reference.svg`
// draws this as one clipped rounded rectangle around the whole chain, not a per-cell one —
// Cell.tsx approximates that with per-cell corner radii and border sides keyed off this.
import { NodeId, ChainId } from '../model/types';
import { useDocumentStore } from '../store/documentStore';

export type GroupPosition = 'solo' | 'start' | 'middle' | 'end';

/** A chain of one member reads the same as no chain at all — full round, full border — so
 *  only a chain with at least two members has an interior to square off. */
export function useGroupPosition(nodeId: NodeId, chainId: ChainId | null): GroupPosition {
  return useDocumentStore((state) => {
    if (chainId === null) return 'solo';
    const chain = state.document.chains[chainId];
    if (!chain || chain.members.length <= 1) return 'solo';
    const index = chain.members.indexOf(nodeId);
    if (index === 0) return 'start';
    if (index === chain.members.length - 1) return 'end';
    return 'middle';
  });
}
