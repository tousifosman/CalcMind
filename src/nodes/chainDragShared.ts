// Shared Reanimated values for §8.2 MovingChain: while one member is dragged in
// chain-move mode, every other member of the same chain applies the same translate
// so the formula moves as a unit without mid-drag store writes (§11.4).
import { makeMutable } from 'react-native-reanimated';
import type { ChainId } from '../model/types';

export const chainDragChainId = makeMutable<ChainId | null>(null);
export const chainDragDx = makeMutable(0);
export const chainDragDy = makeMutable(0);

export function resetChainDragShared(): void {
  chainDragChainId.value = null;
  chainDragDx.value = 0;
  chainDragDy.value = 0;
}
