// Shared selection/focus subscription for node views (P7.2 / §8.6). A node is focused
// when it is the keypad target (`selectedNodeId`) or part of a `Select group` set —
// both must show the Cell focus ring so keyboard navigation never lands on an invisible
// selection.
import { NodeId } from '../model/types';
import { useUiStore } from '../store/uiStore';

export function useNodeSelected(id: NodeId): boolean {
  return useUiStore(
    (state) => state.selectedNodeId === id || state.groupSelectedIds.has(id),
  );
}
