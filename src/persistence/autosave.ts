// Autosave. See docs/ARCHITECTURE.md §12.3 (debounce + force-flush), §13 (undo
// marks dirty independently), §8.8 (suppressible for slider scrub).
//
// Persistence must not import the store (§5 dependency rule). Callers inject
// getDocument / write / onSaved; the app shell wires those to documentStore and
// the platform StorageAdapter.
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

import type { CalcDocument } from '../model/types';
import { serializeDocument } from './serialize';

/** Debounce window from §12.3. A mid-edit kill loses at most this much. */
export const AUTOSAVE_DEBOUNCE_MS = 600;

export interface AutosaveDeps {
  getDocument: () => CalcDocument;
  write: (id: string, json: string) => Promise<void>;
  onSaved: (savedAt: string) => void;
  /** Override for tests; defaults to `new Date().toISOString()`. */
  now?: () => string;
  debounceMs?: number;
}

export interface AutosaveController {
  /** Schedule a debounced write. No-ops the timer while suppressed (§8.8). */
  markDirty: () => void;
  /**
   * Write immediately if dirty. Ignores suppress so background / explicit save /
   * document switch still land one durable snapshot (kill-safety).
   */
  flush: () => Promise<void>;
  /** Explicit save — same as flush (§12.3). */
  save: () => Promise<void>;
  /**
   * Force-flush the current document before a load replaces it, then clear dirty
   * so the incoming document is not written back under the old id.
   */
  prepareDocumentSwitch: () => Promise<void>;
  setSuppressed: (suppressed: boolean) => void;
  isSuppressed: () => boolean;
  isDirty: () => boolean;
  /** AppState (native) + visibilitychange/pagehide (web). Returns detach. */
  attachLifecycleListeners: () => () => void;
  dispose: () => void;
}

export function createAutosave(deps: AutosaveDeps): AutosaveController {
  const debounceMs = deps.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const now = deps.now ?? (() => new Date().toISOString());

  let dirty = false;
  let suppressed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Fire-and-forget flush for timers / lifecycle (avoids `void` / no-void). */
  function fireFlush(): void {
    flush().then(
      () => undefined,
      () => undefined,
    );
  }

  function schedule(): void {
    if (disposed || suppressed || !dirty) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      fireFlush();
    }, debounceMs);
  }

  async function writeIfDirty(): Promise<void> {
    if (disposed || !dirty) return;
    const doc = deps.getDocument();
    // Clear before await so concurrent markDirty during the write re-arms.
    // On rejection we restore dirty (unless a concurrent markDirty already did)
    // so the next flush / lifecycle force-flush retries — otherwise a failed
    // write permanently drops the edit and kill-safety is void.
    dirty = false;
    const json = serializeDocument(doc);
    const savedAt = now();
    try {
      await deps.write(doc.id, json);
    } catch (err) {
      if (!disposed) {
        dirty = true;
        schedule();
        // Automatic callers (fireFlush) swallow the rejection; log so a failed
        // save is not silent. A UI "save failed" signal is future work.
        console.warn('autosave: write failed; will retry', err);
      }
      throw err;
    }
    if (!disposed) {
      deps.onSaved(savedAt);
    }
  }

  function enqueueWrite(): Promise<void> {
    chain = chain.then(writeIfDirty, writeIfDirty);
    return chain;
  }

  async function flush(): Promise<void> {
    clearTimer();
    if (disposed || !dirty) return;
    await enqueueWrite();
  }

  function markDirty(): void {
    if (disposed) return;
    dirty = true;
    schedule();
  }

  function setSuppressed(next: boolean): void {
    if (disposed) return;
    suppressed = next;
    if (next) {
      clearTimer();
    } else if (dirty) {
      schedule();
    }
  }

  async function prepareDocumentSwitch(): Promise<void> {
    await flush();
    dirty = false;
    clearTimer();
  }

  function attachLifecycleListeners(): () => void {
    const subscriptions: Array<() => void> = [];

    const appSub: NativeEventSubscription = AppState.addEventListener(
      'change',
      next => {
        if (next === 'background' || next === 'inactive') {
          fireFlush();
        }
      },
    );
    subscriptions.push(() => appSub.remove());

    // No DOM lib in tsconfig (bare RN) — same `any` cast AppShell uses for web.
    const webWindow =
      Platform.OS === 'web' ? (globalThis as any).window : undefined;
    if (webWindow?.addEventListener) {
      const onVisibility = (): void => {
        if (webWindow.document?.visibilityState === 'hidden') {
          fireFlush();
        }
      };
      const onPageHide = (): void => {
        fireFlush();
      };
      webWindow.addEventListener('visibilitychange', onVisibility);
      webWindow.addEventListener('pagehide', onPageHide);
      subscriptions.push(() => {
        webWindow.removeEventListener('visibilitychange', onVisibility);
        webWindow.removeEventListener('pagehide', onPageHide);
      });
    }

    return () => {
      for (const detach of subscriptions) detach();
    };
  }

  function dispose(): void {
    disposed = true;
    clearTimer();
    dirty = false;
  }

  return {
    markDirty,
    flush,
    save: flush,
    prepareDocumentSwitch,
    setSuppressed,
    isSuppressed: () => suppressed,
    isDirty: () => dirty,
    attachLifecycleListeners,
    dispose,
  };
}
