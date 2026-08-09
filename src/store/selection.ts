// Pure helpers for ephemeral selection (§8.6). Kept out of `commands.ts` so the
// keypad and keymap can ask "is the whole canvas selected?" without pulling in
// document mutations.
import type { NodeId } from '../model/types';

/** True when every node on the canvas is in the group-selection set (Select all).
 *  Empty canvas is never "all selected" — there is nothing to lock the keypad for. */
export function isEntireCanvasSelected(
  groupSelectedIds: ReadonlySet<NodeId>,
  nodes: Record<NodeId, unknown>,
): boolean {
  const ids = Object.keys(nodes);
  if (ids.length === 0) return false;
  if (groupSelectedIds.size !== ids.length) return false;
  for (const id of ids) {
    if (!groupSelectedIds.has(id)) return false;
  }
  return true;
}
