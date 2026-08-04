// Schema migrations (§12.4). Applied in ascending order until
// `doc.schemaVersion === CURRENT_SCHEMA_VERSION`.
//
// v1 is the origin: `migrations` stays empty in production. Every future
// migration MUST ship a `before.json` / `after.json` fixture pair under
// `__fixtures__/` and a test that runs the harness against them — migrations
// are the code most likely to silently eat data and the least likely to be
// exercised by hand (§12.4).
import { CURRENT_SCHEMA_VERSION } from '../../model/types';

export type Migration = {
  from: number;
  to: number;
  migrate: (doc: unknown) => unknown;
};

/** Production list. Empty while schemaVersion 1 is current. */
export const migrations: Migration[] = [];

export { CURRENT_SCHEMA_VERSION };

export type MigrateError =
  | {
      kind: 'no_path';
      from: number;
      to: number;
      message: string;
    }
  | {
      kind: 'broken_chain';
      from: number;
      expectedTo: number;
      got: unknown;
      message: string;
    };

export type MigrateResult =
  | { ok: true; value: unknown }
  | { ok: false; error: MigrateError };

/**
 * Run `steps` in ascending `from` order until `schemaVersion` reaches `target`
 * (default: {@link CURRENT_SCHEMA_VERSION}). The input is treated as opaque
 * untrusted JSON — callers validate with zod *after* this returns.
 *
 * Pure: does not mutate `doc` (each step receives whatever the previous
 * returned). A gap in the chain is an error, not a silent skip.
 */
export function runMigrations(
  doc: unknown,
  steps: readonly Migration[] = migrations,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrateResult {
  const version = peekVersion(doc);
  if (version === null) {
    return {
      ok: false,
      error: {
        kind: 'no_path',
        from: -1,
        to: target,
        message:
          'Cannot migrate: document has no numeric schemaVersion.',
      },
    };
  }

  if (version === target) {
    return { ok: true, value: doc };
  }

  if (version > target) {
    return {
      ok: false,
      error: {
        kind: 'no_path',
        from: version,
        to: target,
        message:
          `Cannot migrate downward from schemaVersion ${version} to ${target}.`,
      },
    };
  }

  const byFrom = new Map<number, Migration>();
  for (const step of steps) {
    if (byFrom.has(step.from)) {
      return {
        ok: false,
        error: {
          kind: 'broken_chain',
          from: step.from,
          expectedTo: step.to,
          got: 'duplicate',
          message: `Duplicate migration from schemaVersion ${step.from}.`,
        },
      };
    }
    byFrom.set(step.from, step);
  }

  let current: unknown = doc;
  let currentVersion = version;

  while (currentVersion < target) {
    const step = byFrom.get(currentVersion);
    if (!step) {
      return {
        ok: false,
        error: {
          kind: 'no_path',
          from: currentVersion,
          to: target,
          message:
            `No migration from schemaVersion ${currentVersion} toward ${target}.`,
        },
      };
    }

    current = step.migrate(current);
    const nextVersion = peekVersion(current);
    if (nextVersion !== step.to) {
      return {
        ok: false,
        error: {
          kind: 'broken_chain',
          from: step.from,
          expectedTo: step.to,
          got: nextVersion,
          message:
            `Migration ${step.from}→${step.to} left schemaVersion at ` +
            `${String(nextVersion)} (expected ${step.to}).`,
        },
      };
    }
    currentVersion = nextVersion;
  }

  return { ok: true, value: current };
}

function peekVersion(doc: unknown): number | null {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return null;
  }
  const v = (doc as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return null;
  }
  return v;
}
