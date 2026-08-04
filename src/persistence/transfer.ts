// Shared helpers for export/import (§12.2 / P5.8). Platform adapters own the
// share-sheet / Blob / file-picker mechanics; this module only shapes filenames
// and keeps the "exported file is still untrusted on the way back in" rule
// next to the load pipeline.
import type { StorageAdapter } from './adapter';
import {
  materializeLoadedValue,
  parseJsonText,
  type LoadError,
  type OpenDocumentResult,
} from './load';

/** Build a download / share filename from document JSON (`name`, else id). */
export function fileNameForExport(json: string, fallbackId: string): string {
  let base = fallbackId;
  try {
    const parsed = JSON.parse(json) as { name?: unknown; id?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      base = parsed.name.trim();
    } else if (typeof parsed.id === 'string' && parsed.id.length > 0) {
      base = parsed.id;
    }
  } catch {
    // Use fallbackId.
  }
  const safe = base.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 80) || fallbackId;
  return safe.endsWith('.calcmind.json') ? safe : `${safe}.calcmind.json`;
}

export type ImportPipelineResult =
  | OpenDocumentResult
  | { ok: false; error: Extract<LoadError, { kind: 'malformed_json' }> }
  | {
      ok: false;
      error: { kind: 'cancelled'; message: string };
    }
  | {
      ok: false;
      error: { kind: 'unsupported'; message: string };
    };

/**
 * Pick a file via the adapter, then run the **full** P5.5 validation /
 * materialise path (JSON → version → migrate → zod → layout → evaluate).
 * No shortcut for "our own" format — an exported file is still untrusted (§12.2 / P5.8).
 * Does not write storage; the caller decides whether to install the document.
 */
export async function importDocumentThroughPipeline(
  adapter: StorageAdapter,
  options?: { locale?: string },
): Promise<ImportPipelineResult> {
  if (!adapter.importDocument) {
    return {
      ok: false,
      error: {
        kind: 'unsupported',
        message: 'This platform does not support document import.',
      },
    };
  }

  const json = await adapter.importDocument();
  if (json === null) {
    return {
      ok: false,
      error: {
        kind: 'cancelled',
        message: 'Import cancelled.',
      },
    };
  }

  const parsed = parseJsonText(json);
  if (!parsed.ok) {
    return parsed;
  }

  const locale = options?.locale ?? 'en-US';
  const materialized = materializeLoadedValue(parsed.value, locale);
  if (!materialized.ok) {
    return materialized;
  }
  return {
    ok: true,
    document: materialized.document,
    // Import is not a storage read — source is informational for the UI.
    source: 'primary',
  };
}
