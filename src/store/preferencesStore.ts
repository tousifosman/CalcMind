// User display preferences: persisted, but not part of `document` and not undoable —
// a third category alongside documentStore (persisted + undoable) and uiStore (never
// persisted, never undoable). Holds the numeral font size (§1.2 `tokens.numeralFontSize`'s
// live override) and the auto-pan-to-edited-cell toggle (§7 P7 follow-up) — both surfaced
// on the Settings sheet.
//
// Reads outside a React render (store/commands.ts, chains/layout.ts, canvas/hitTest.ts)
// use `usePreferencesStore.getState().numeralFontSize` directly — the same non-reactive
// pattern this codebase already uses for uiStore in those same non-component modules.
// Node view components subscribe reactively (`usePreferencesStore((s) => ...)`) so a
// changed setting repaints already-mounted cells immediately.
import { create } from 'zustand';
import { tokens } from '../ui/tokens';
import { preferencesAdapter } from '../persistence/preferences';
import { reflowAllChainsForDisplay } from './reflowAllChains';

/** Inclusive dp range and step for the Settings sheet's stepper. 22 (default) sits
 *  roughly in the middle; the range spans comfortably smaller and comfortably larger
 *  than the current default without needing `numberPaddingX`/`nodeHeight` (fixed
 *  tokens, not user-adjustable) to also move to stay legible. */
export const NUMERAL_FONT_SIZE_MIN = 14;
export const NUMERAL_FONT_SIZE_MAX = 30;
export const NUMERAL_FONT_SIZE_STEP = 2;

function clampNumeralFontSize(size: number): number {
  return Math.min(NUMERAL_FONT_SIZE_MAX, Math.max(NUMERAL_FONT_SIZE_MIN, size));
}

export interface PreferencesState {
  numeralFontSize: number;
  /** Clamps to the settings range, persists (best-effort — a failed write keeps the
   *  in-memory value, matching preferences.ts's "lose the setting, not the app"
   *  contract), and re-flows every open chain so existing formulas stay flush at the
   *  new size instead of visually desyncing until the next unrelated edit. */
  setNumeralFontSize: (size: number) => void;
  /** §7 P7 follow-up: whether a cell entering edit mode (added or typed into) pans the
   *  canvas to keep it clear of the visible edge, padded (`autoPan.ts`'s
   *  `AUTO_PAN_PADDING`). Defaults on — this replaces the *usefulness* of the browser's
   *  old accidental autoFocus-scroll (2026-08-21's `preventScroll` fix removed the
   *  scroll itself, which moved the whole page including the keypad, not just the
   *  canvas). Read directly by `NumberNode` (`usePreferencesStore((s) => ...)`, same
   *  reactive-subscribe pattern as `numeralFontSize`), not threaded through `commands.ts`
   *  — unlike the font size, nothing needs this value outside a mounted component. */
  autoPanToEditedCell: boolean;
  setAutoPanToEditedCell: (enabled: boolean) => void;
  /** Loads the persisted value, if any, over the compiled-in default. Call once on
   *  app start, before opening any document — persistence/load.ts's own reflow-on-open
   *  needs the live preference in place to lay out at the right size the first time. */
  hydrate: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  // `preferencesAdapter.write` replaces the whole persisted blob (preferences.ts /
  // preferences.web.ts / preferences.native.ts all write one file's full contents, none
  // of them merge) — so every setter must persist *every* field's current value, not just
  // the one it changed, or the field it left alone would quietly vanish from disk on the
  // next restart. Centralised here rather than duplicated per setter.
  function persist(): void {
    const { numeralFontSize, autoPanToEditedCell } = get();
    preferencesAdapter.write({ numeralFontSize, autoPanToEditedCell }).catch(() => {
      // Swallowed by design (preferences.ts): the setting still applies this
      // session, it just won't survive a restart.
    });
  }

  return {
    numeralFontSize: tokens.numeralFontSize,
    autoPanToEditedCell: true,

    setNumeralFontSize: (size) => {
      const clamped = clampNumeralFontSize(size);
      if (clamped === get().numeralFontSize) return;
      set({ numeralFontSize: clamped });
      persist();
      reflowAllChainsForDisplay(clamped);
    },

    setAutoPanToEditedCell: (enabled) => {
      if (enabled === get().autoPanToEditedCell) return;
      set({ autoPanToEditedCell: enabled });
      persist();
    },

    hydrate: async () => {
      let prefs: Awaited<ReturnType<typeof preferencesAdapter.read>>;
      try {
        prefs = await preferencesAdapter.read();
      } catch {
        return; // adapter unavailable — stay on the compiled-in default
      }
      if (typeof prefs.numeralFontSize === 'number') {
        set({ numeralFontSize: clampNumeralFontSize(prefs.numeralFontSize) });
      }
      if (typeof prefs.autoPanToEditedCell === 'boolean') {
        set({ autoPanToEditedCell: prefs.autoPanToEditedCell });
      }
    },
  };
});
