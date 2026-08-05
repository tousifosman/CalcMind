import {
  amendHistoryTop,
  coalesceTopTwo,
  historyTop,
  MAX_HISTORY,
  pushHistory,
  type HistoryEntry,
} from './undo';
import type { Patch } from 'immer';

function namedPatch(tag: string): Patch {
  return { op: 'replace', path: ['name'], value: tag };
}

function entry(tag: string): HistoryEntry {
  const p = namedPatch(tag);
  return { patches: [p], inversePatches: [p] };
}

describe('undo helpers (P7.1 / §13)', () => {
  test('pushHistory appends and caps at MAX_HISTORY, dropping the oldest', () => {
    let stack: HistoryEntry[] = [];
    const first = entry('first');
    stack = pushHistory(stack, first);
    for (let i = 1; i < MAX_HISTORY; i++) {
      stack = pushHistory(stack, entry(`e${i}`));
    }
    expect(stack).toHaveLength(MAX_HISTORY);
    expect(stack[0]).toBe(first);

    const overflow = entry('overflow');
    stack = pushHistory(stack, overflow);
    expect(stack).toHaveLength(MAX_HISTORY);
    expect(stack[0]).not.toBe(first);
    expect(stack[stack.length - 1]).toBe(overflow);
    // Surviving entries keep object identity — coalesce keys off this.
    expect(stack[stack.length - 2]).toBeDefined();
  });

  test('historyTop returns the last entry by identity, or null when empty', () => {
    expect(historyTop([])).toBeNull();
    const a = entry('a');
    const b = entry('b');
    expect(historyTop([a, b])).toBe(b);
  });

  test('coalesceTopTwo merges forward patches and reverses inverse order', () => {
    const older = entry('older');
    const newer = entry('newer');
    const merged = coalesceTopTwo([entry('keep'), older, newer]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual({
      patches: [...older.patches, ...newer.patches],
      inversePatches: [...newer.inversePatches, ...older.inversePatches],
    });
    expect(merged[0]).toEqual(entry('keep'));
  });

  test('coalesceTopTwo is a no-op below two entries', () => {
    const only = entry('only');
    expect(coalesceTopTwo([])).toEqual([]);
    expect(coalesceTopTwo([only])).toEqual([only]);
  });

  test('amendHistoryTop folds patches into the top without changing length', () => {
    const older = entry('older');
    const top = entry('top');
    const next = amendHistoryTop(
      [older, top],
      [namedPatch('extra')],
      [namedPatch('undo-extra')],
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(older);
    expect(next[1]).toEqual({
      patches: [...top.patches, namedPatch('extra')],
      inversePatches: [namedPatch('undo-extra'), ...top.inversePatches],
    });
  });
});
