// Selector hooks. Kept as thin wrappers over useDocumentStore so components
// subscribe to the narrowest slice they need (§11.4 performance budget: a node
// should re-render only when its own slice changes).
import { useDocumentStore } from './documentStore';
import { CalcNode, Chain, NodeId, ChainId, Viewport } from '../model/types';

export function useViewport(): Viewport {
  return useDocumentStore((state) => state.document.viewport);
}

export function useNode(id: NodeId): CalcNode | undefined {
  return useDocumentStore((state) => state.document.nodes[id]);
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
