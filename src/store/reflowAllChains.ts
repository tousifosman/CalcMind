// Re-flows every chain's member `position` directly on `documentStore`, bypassing undo
// (`mutateWithoutUndo`, §7 precedent: `setViewport`) — for a display preference change
// (the numeral font size setting, §1.2 P7), not a document edit a user would expect
// Ctrl+Z to touch. Same "position is a cache" contract persistence/load.ts's own
// `reflowAllChains` uses when a document is opened.
//
// Lives outside store/commands.ts (which has its own private, per-chain `reflowChain`
// used after document edits) rather than reusing it, so that store/preferencesStore.ts
// can call this without an import cycle: commands.ts already reads the live font size
// from preferencesStore.ts for its own `widthOf` calls, so preferencesStore.ts cannot
// also import commands.ts. `fontSize` is taken as a parameter rather than read from
// preferencesStore.ts directly for the same reason — preferencesStore.ts is this
// module's caller, so reading the store in here too would just relocate the cycle.
import { useDocumentStore } from './documentStore';
import { layoutChain } from '../chains/layout';
import { getDeviceLocale } from '../ui/locale';
import type { ChainId } from '../model/types';

export function reflowAllChainsForDisplay(fontSize: number): void {
  const locale = getDeviceLocale();
  useDocumentStore.getState().mutateWithoutUndo((draft) => {
    for (const chainId of Object.keys(draft.chains) as ChainId[]) {
      const chain = draft.chains[chainId];
      if (!chain) continue;
      const positions = layoutChain(chain, draft.nodes, locale, fontSize);
      for (const memberId of chain.members) {
        const member = draft.nodes[memberId];
        const position = positions[memberId];
        if (member && position) member.position = position;
      }
    }
  });
}
