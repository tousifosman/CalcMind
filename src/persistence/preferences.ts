// Preferences storage adapter contract. Sibling to `adapter.ts` (§12.2) but a
// deliberately smaller contract: a single small, app-wide preferences blob rather than
// many named documents. Platform bundlers replace this module exactly as `adapter.ts`
// documents — Metro resolves `preferences.native.ts`, webpack resolves `preferences.web.ts`
// (via resolve.extensions) — and this file's `preferencesAdapter` stub must never run; a
// throw here means a bundler failed to pick a platform file.
//
// Unlike documents (§12.3's atomic write + one-generation backup), a corrupt or lost
// preferences file only loses a display setting, never user data — so this contract has
// no backup/atomicity requirement. A failed `read()` or `write()` is swallowed by the
// caller (the preferences store), which just stays on in-memory defaults.

/** Holds the numeral font size (§1.2 `tokens.numeralFontSize`'s live override) and the
 *  auto-pan-to-edited-cell toggle (§7 P7 follow-up). Both optional so a partially-written
 *  or older file still parses. */
export interface Preferences {
  numeralFontSize?: number;
  autoPanToEditedCell?: boolean;
}

export interface PreferencesAdapter {
  /** Resolves to `{}` (not a rejection) when nothing has been saved yet. */
  read(): Promise<Preferences>;
  write(prefs: Preferences): Promise<void>;
}

function unresolved(): never {
  throw new Error(
    'persistence: PreferencesAdapter platform module was not resolved (expected preferences.native.ts or preferences.web.ts)',
  );
}

/** Stub for tsc; Metro/webpack substitute the platform implementation. */
export const preferencesAdapter: PreferencesAdapter = {
  read: unresolved,
  write: unresolved,
};
