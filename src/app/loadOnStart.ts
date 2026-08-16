// Load the most recently saved document on launch (§12.3, P5.5), if one exists. Lives in
// app/ alongside startAutosave.ts so persistence stays free of store imports (§5).
import { storageAdapter } from '../persistence/adapter';
import { openDocument } from '../persistence/load';
import { useDocumentStore } from '../store/documentStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { getDeviceLocale } from '../ui/locale';
import { getAutosaveController } from './startAutosave';

/**
 * On launch, open the most recently updated document (if any) through the full §12.3 load
 * pipeline and replace the store's fresh empty document with it. Call after
 * `startAutosave()` so `getAutosaveController()` has a controller to flush first.
 *
 * A missing/corrupt/newer-schema file is left exactly as `openDocument` already leaves it —
 * §12.3's "never overwrite a file that failed to load" safety property. This app has no
 * document browser yet (multi-document UX is deferred, §17.2) and no error-surfacing UI for
 * a failed load, so it simply stays on the fresh empty document rather than losing or
 * corrupting anything already on disk. Without this wiring the app silently discards every
 * autosaved document on the next launch — caught live: `npm run web`, type something, wait
 * out the autosave debounce, reload, and the canvas comes back blank despite IndexedDB
 * still holding the file.
 *
 * Caller must have already awaited `usePreferencesStore.getState().hydrate()` — the numeral
 * font size preference below has to be the persisted one, not the compiled-in default, or a
 * document saved under a non-default size re-flows wrong on the very first paint.
 */
export async function loadMostRecentDocument(): Promise<void> {
  let list: Awaited<ReturnType<typeof storageAdapter.list>>;
  try {
    list = await storageAdapter.list();
  } catch {
    return; // adapter unavailable - stay on the fresh empty document
  }
  if (list.length === 0) return;

  const mostRecent = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const result = await openDocument(storageAdapter, mostRecent.id, {
    locale: getDeviceLocale(),
    fontSize: usePreferencesStore.getState().numeralFontSize,
  });
  if (!result.ok) return;

  // Flush (and stop tracking) whatever the throwaway startup document owed before the
  // swap, so nothing autosaves back under the wrong id once we replace it (documentStore's
  // own doc comment on `replaceDocument`).
  await getAutosaveController()?.prepareDocumentSwitch();
  useDocumentStore.getState().replaceDocument(result.document);
}
