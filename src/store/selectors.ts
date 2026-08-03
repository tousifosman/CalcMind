// Selector hooks. Kept as thin wrappers over useDocumentStore so components
// subscribe to the narrowest slice they need (§11.4 performance budget: a node
// should re-render only when its own slice changes).
import { useShallow } from 'zustand/react/shallow';
import { useDocumentStore } from './documentStore';
import { CalcNode, Chain, NodeId, ChainId, Viewport } from '../model/types';

export function useViewport(): Viewport {
  return useDocumentStore((state) => state.document.viewport);
}

export function useNode(id: NodeId): CalcNode | undefined {
  return useDocumentStore((state) => state.document.nodes[id]);
}

/** The node layer (P2.5) subscribes to this rather than to `document.nodes` itself, so
 *  adding or removing a node re-renders the layer's list but not any node untouched by the
 *  change (§11.4) - each node still reads its own slice through `useNode` above. `useShallow`
 *  is what makes that hold: `Object.keys` returns a fresh array every call, and without it
 *  every document change (a node's `raw` included) would look like a new id list. */
export function useNodeIds(): NodeId[] {
  return useDocumentStore(useShallow((state) => Object.keys(state.document.nodes)));
}

export function useChain(id: ChainId): Chain | undefined {
  return useDocumentStore((state) => state.document.chains[id]);
}

export function useDocumentName(): string {
  return useDocumentStore((state) => state.document.name);
}

export function useCanUndo(): boolean {
  return useDocumentStore((state) => state.undoStack.length > 0);
}

export function useCanRedo(): boolean {
  return useDocumentStore((state) => state.redoStack.length > 0);
}
