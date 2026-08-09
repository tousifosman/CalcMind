// Shared Reanimated values for §8.2 MovingChain and §8.6 multi-unit selection drag:
// while one node is dragged, followers apply the same translate without mid-drag
// store writes (§11.4).
//
// Single-concurrent-drag assumption: these are module-level singletons, not
// per-session. A second begin would stomp the first; either session's reset would
// clear both. Fine while only one pointer drives a node drag at a time in
// practice — `maxPointers(1)` is per-detector, not global.
import { makeMutable } from 'react-native-reanimated';
import type { ChainId } from '../model/types';

export const chainDragChainId = makeMutable<ChainId | null>(null);
export const chainDragDx = makeMutable(0);
export const chainDragDy = makeMutable(0);

/** Other selected nodes that should follow a `moveSelection` drag (Select all).
 *  Record values are `1` when following — worklet-friendly membership test. */
export const selectionDragFollowers = makeMutable<Record<string, number>>({});
export const selectionDragDx = makeMutable(0);
export const selectionDragDy = makeMutable(0);
/** `1` while a multi-unit selection drag is active — lets the UI-thread pan
 *  update publish dx/dy without scanning the followers map each frame. */
export const selectionDragActive = makeMutable(0);

export function resetChainDragShared(): void {
  chainDragChainId.value = null;
  chainDragDx.value = 0;
  chainDragDy.value = 0;
}

export function resetSelectionDragShared(): void {
  selectionDragFollowers.value = {};
  selectionDragDx.value = 0;
  selectionDragDy.value = 0;
  selectionDragActive.value = 0;
}
