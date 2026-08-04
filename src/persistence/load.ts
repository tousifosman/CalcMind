// Load pipeline (§12.3). A file on disk is untrusted input:
//   read → JSON check (.bak fallback) → version check → migrate → zod →
//   normalise arrays→maps → chain layout → evaluate all chains topologically → ready.
//
// P5.2 owns the trust-boundary primitives (parse / version gate / zod).
// P5.5 composes them with the adapter, migrations, layout, and evaluate.
import { prettifyError } from 'zod';

import { layoutChain } from '../chains/layout';
import {
  buildDependencyGraph,
  recomputeChain,
  topologicalOrder,
} from '../engine/graph';
import {
  serializedDocumentSchema,
  type SerializedDocumentParsed,
} from '../model/schema';
import {
  CURRENT_SCHEMA_VERSION,
  type CalcDocument,
  type ChainId,
} from '../model/types';
import type { StorageAdapter } from './adapter';
import { runMigrations } from './migrations';
import { fromSerializedDocument } from './serialize';

/** Why a load failed. Discriminated so callers can message without re-parsing. */
export type LoadError =
  | {
      kind: 'malformed_json';
      message: string;
    }
  | {
      kind: 'newer_schema';
      schemaVersion: number;
      current: number;
      message: string;
    }
  | {
      kind: 'validation';
      message: string;
    }
  | {
      kind: 'missing_schema_version';
      message: string;
    }
  | {
      kind: 'unreadable';
      message: string;
    }
  | {
      kind: 'migration';
      message: string;
    };

export type ValidateLoadedJsonResult =
  | { ok: true; document: SerializedDocumentParsed }
  | { ok: false; error: LoadError }
  | {
      ok: false;
      needs_migration: true;
      schemaVersion: number;
      value: unknown;
    };

export type OpenDocumentResult =
  | {
      ok: true;
      document: CalcDocument;
      /** Which file supplied the JSON that passed validation. */
      source: 'primary' | 'backup';
    }
  | { ok: false; error: LoadError };

/** Safe `JSON.parse`. Malformed input is a handled outcome, never a throw. */
export function parseJsonText(text: string):
  | { ok: true; value: unknown }
  | { ok: false; error: Extract<LoadError, { kind: 'malformed_json' }> } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown parse error';
    return {
      ok: false,
      error: {
        kind: 'malformed_json',
        message: `Document is not valid JSON (${detail}). The file was left untouched.`,
      },
    };
  }
}

/**
 * Peek `schemaVersion` on an already-parsed value without running the full
 * wire schema — a newer file's shape is unknown, so we must refuse before zod
 * (decision #7).
 */
export function readSchemaVersion(
  value: unknown,
):
  | { ok: true; schemaVersion: number }
  | { ok: false; error: Extract<LoadError, { kind: 'missing_schema_version' }> } {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('schemaVersion' in value) ||
    typeof (value as { schemaVersion: unknown }).schemaVersion !== 'number' ||
    !Number.isFinite((value as { schemaVersion: number }).schemaVersion)
  ) {
    return {
      ok: false,
      error: {
        kind: 'missing_schema_version',
        message:
          'Document is missing a numeric schemaVersion. The file was left untouched.',
      },
    };
  }
  return {
    ok: true,
    schemaVersion: (value as { schemaVersion: number }).schemaVersion,
  };
}

export function refuseNewerSchema(schemaVersion: number): Extract<
  LoadError,
  { kind: 'newer_schema' }
> {
  return {
    kind: 'newer_schema',
    schemaVersion,
    current: CURRENT_SCHEMA_VERSION,
    message:
      `This document was written by a newer CalcMind (schemaVersion ${schemaVersion}; ` +
      `this app understands up to ${CURRENT_SCHEMA_VERSION}). Open it in a newer version — ` +
      `the file was left untouched.`,
  };
}

/**
 * Run the on-disk zod schema. Failures name the offending field via zod's
 * prettify path; the parsed value is returned only on full success.
 */
export function validateWireDocument(
  value: unknown,
):
  | { ok: true; document: SerializedDocumentParsed }
  | { ok: false; error: Extract<LoadError, { kind: 'validation' }> } {
  const parsed = serializedDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        message: `Document failed validation:\n${prettifyError(parsed.error)}`,
      },
    };
  }
  return { ok: true, document: parsed.data };
}

/**
 * Trust-boundary check for a raw JSON string (§12.3 / P5.2):
 *   1. JSON parse (malformed → error, file untouched)
 *   2. schemaVersion gate — greater than CURRENT → refuse (decision #7)
 *   3. zod wire schema — failures name the field; nothing partial returned
 *
 * Older-than-CURRENT documents are not validated here: migration (P5.7) must
 * run first, then this again. {@link openDocument} does that composition.
 */
export function validateLoadedJson(text: string): ValidateLoadedJsonResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return parsed;
  }

  const version = readSchemaVersion(parsed.value);
  if (!version.ok) {
    return version;
  }

  if (version.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: refuseNewerSchema(version.schemaVersion) };
  }

  if (version.schemaVersion < CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      needs_migration: true,
      schemaVersion: version.schemaVersion,
      value: parsed.value,
    };
  }

  return validateWireDocument(parsed.value);
}

/**
 * §12.3 open-document flow after a JSON value is in hand: version → migrate →
 * zod → normalise → layout → evaluate. Pure over the value; never writes storage.
 */
export function materializeLoadedValue(
  value: unknown,
  locale: string,
):
  | { ok: true; document: CalcDocument }
  | { ok: false; error: LoadError } {
  const version = readSchemaVersion(value);
  if (!version.ok) {
    return version;
  }

  if (version.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: refuseNewerSchema(version.schemaVersion) };
  }

  let wireValue: unknown = value;
  if (version.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migrated = runMigrations(value);
    if (!migrated.ok) {
      return {
        ok: false,
        error: {
          kind: 'migration',
          message: migrated.error.message,
        },
      };
    }
    wireValue = migrated.value;
  }

  const validated = validateWireDocument(wireValue);
  if (!validated.ok) {
    return validated;
  }

  const document = fromSerializedDocument(validated.document);
  prepareLoadedDocument(document, locale);
  return { ok: true, document };
}

/**
 * Re-flow every chain (member `position` from the file is ignored for members —
 * §12.1), then evaluate all chains in topological order. `derived` from the file
 * may paint for a moment; the engine overwrites it and always wins (decision #6).
 */
export function prepareLoadedDocument(
  document: CalcDocument,
  locale: string,
): void {
  reflowAllChains(document, locale);

  const graph = buildDependencyGraph(document);
  const order = topologicalOrder(graph);
  // Also evaluate chains that somehow aren't graph vertices (shouldn't happen —
  // vertices are Object.keys(chains) — but keep the loop total).
  const seen = new Set<ChainId>(order);
  for (const chainId of order) {
    recomputeChain(document, chainId, locale);
  }
  for (const chainId of Object.keys(document.chains) as ChainId[]) {
    if (seen.has(chainId)) continue;
    recomputeChain(document, chainId, locale);
  }

  // Result create/remove can change membership widths — lay out again.
  reflowAllChains(document, locale);
}

function reflowAllChains(document: CalcDocument, locale: string): void {
  for (const chain of Object.values(document.chains)) {
    const positions = layoutChain(chain, document.nodes, locale);
    for (const memberId of chain.members) {
      const member = document.nodes[memberId];
      const position = positions[memberId];
      if (member && position) {
        member.position = position;
      }
    }
  }
}

type JsonSource = { value: unknown; source: 'primary' | 'backup' };

/**
 * Read primary; on missing / IO error / malformed JSON, try `.bak` via
 * `readBackup`. If both fail, report unreadable and **do not overwrite** either
 * (§12.3). Primary-absent (crash window between rotate and rename — P5.3) is
 * treated like corrupt.
 */
async function readJsonWithBackup(
  adapter: StorageAdapter,
  id: string,
): Promise<
  | { ok: true; result: JsonSource }
  | { ok: false; error: Extract<LoadError, { kind: 'unreadable' }> }
> {
  let primaryText: string | null = null;
  try {
    primaryText = await adapter.read(id);
  } catch {
    primaryText = null;
  }

  if (primaryText !== null) {
    const parsed = parseJsonText(primaryText);
    if (parsed.ok) {
      return { ok: true, result: { value: parsed.value, source: 'primary' } };
    }
  }

  if (adapter.readBackup) {
    try {
      const bakText = await adapter.readBackup(id);
      const parsed = parseJsonText(bakText);
      if (parsed.ok) {
        return { ok: true, result: { value: parsed.value, source: 'backup' } };
      }
    } catch {
      // Missing or unreadable backup — fall through to unreadable.
    }
  }

  return {
    ok: false,
    error: {
      kind: 'unreadable',
      message:
        'Document is unreadable (primary and backup both failed). ' +
        'Neither file was overwritten.',
    },
  };
}

/**
 * Open a document by id through the §12.3 load flowchart. Never writes the
 * adapter — a failed load leaves primary and `.bak` untouched.
 */
export async function openDocument(
  adapter: StorageAdapter,
  id: string,
  options?: { locale?: string },
): Promise<OpenDocumentResult> {
  const locale = options?.locale ?? 'en-US';
  const fetched = await readJsonWithBackup(adapter, id);
  if (!fetched.ok) {
    return fetched;
  }

  const materialized = materializeLoadedValue(fetched.result.value, locale);
  if (!materialized.ok) {
    return materialized;
  }
  return {
    ok: true,
    document: materialized.document,
    source: fetched.result.source,
  };
}
