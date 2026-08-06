// Undo / redo helpers. See docs/ARCHITECTURE.md §13 (bounded stack, patch pairs)
// and §7 (viewport stays out of history — that exclusion lives in documentStore's
// setViewport path, not here).
//
// History entries keep object identity across pushes so coalescing can key off the
// stack-top reference rather than `undoStack.length`. Length alone breaks once the
// stack is capped at MAX_HISTORY: a push-then-slice leaves length unchanged, so
// no-op detection and "merge with previous" both misfire (journal 2026-08-05).
import type { Patch } from 'immer';

/** One undoable command: forward patches for redo, inverse for undo (§13). */
export interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

/** Bounded undo depth from §13. Oldest entries drop when exceeded. */
export const MAX_HISTORY = 100;

/** Append an entry, dropping the oldest once the stack exceeds {@link MAX_HISTORY}. */
export function pushHistory(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...stack, entry].slice(-MAX_HISTORY);
}

/** Top of the undo stack, or `null` when empty. Identity is stable across pushes. */
export function historyTop(stack: readonly HistoryEntry[]): HistoryEntry | null {
  return stack.length === 0 ? null : stack[stack.length - 1]!;
}

/**
 * Merge the top two entries into one. Forward patches concatenate in commit order;
 * inverse patches reverse so undo walks the latest mutation first.
 *
 * Prefer {@link amendHistoryTop} for live coalescing: push-then-merge at
 * {@link MAX_HISTORY} drops an unrelated oldest entry (the push caps the stack)
 * and then shrinks length by one more (the merge), silently losing history.
 */
export function coalesceTopTwo(stack: HistoryEntry[]): HistoryEntry[] {
  if (stack.length < 2) return stack;
  const previous = stack[stack.length - 2]!;
  const latest = stack[stack.length - 1]!;
  return [
    ...stack.slice(0, -2),
    {
      patches: [...previous.patches, ...latest.patches],
      inversePatches: [...latest.inversePatches, ...previous.inversePatches],
    },
  ];
}

/**
 * Fold new patches into the current stack-top without pushing. Stack length is
 * unchanged, so a coalesced keystroke/scrub frame at {@link MAX_HISTORY} does
 * not evict an older entry.
 */
export function amendHistoryTop(
  stack: HistoryEntry[],
  patches: Patch[],
  inversePatches: Patch[],
): HistoryEntry[] {
  if (stack.length === 0) {
    return [{ patches, inversePatches }];
  }
  const top = stack[stack.length - 1]!;
  return [
    ...stack.slice(0, -1),
    {
      patches: [...top.patches, ...patches],
      inversePatches: [...inversePatches, ...top.inversePatches],
    },
  ];
}
