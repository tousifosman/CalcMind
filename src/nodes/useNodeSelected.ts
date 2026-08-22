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

/** Specifically membership in a `Select group` / `Select all` set (§8.6), as opposed to
 *  being the lone `selectedNodeId` keypad target. `Cell` uses this to decide whether its
 *  focus ring should merge with flush group siblings (no border on the shared interior
 *  seam, so a selected chain reads as one cell) — a rule that must not apply to an
 *  ordinary single selection, whose neighbours are not also selected. A node can be both
 *  (a group's result is often also the primary keypad target, §8.6) — group membership is
 *  what decides the ring shape either way, since a chain's own result is still one flush
 *  member of the "one big cell" the whole group reads as. */
export function useNodeGroupSelected(id: NodeId): boolean {
  return useUiStore((state) => state.groupSelectedIds.has(id));
}
