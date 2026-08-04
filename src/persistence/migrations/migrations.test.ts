// Migration harness tests (§12.4 / P5.7).
//
// Production `migrations` is empty (v1 is the origin). The v0→v1 fixture pair
// exercises the runner with a synthetic step that is *not* registered in
// production — so the machinery is proven before real user data depends on it.
//
// Rule for the next author: every future migration ships `before.json` /
// `after.json` under `__fixtures__/<from>-to-<to>/` and a test that feeds
// `before` through `runMigrations` and asserts deep equality with `after`.
import beforeV0 from './__fixtures__/v0-to-v1/before.json';
import afterV1 from './__fixtures__/v0-to-v1/after.json';
import {
  CURRENT_SCHEMA_VERSION,
  migrations,
  runMigrations,
  type Migration,
} from './index';
import { validateWireDocument } from '../load';

/**
 * Synthetic v0→v1 step used only in tests. Mirrors what a real first migration
 * might have done: rename `title`→`name`, Records→arrays, bump schemaVersion.
 * Never add this to the production `migrations` array — v1 is the shipped origin.
 */
const syntheticV0toV1: Migration = {
  from: 0,
  to: 1,
  migrate: (doc: unknown) => {
    const raw = doc as {
      schemaVersion: number;
      id: string;
      title?: string;
      name?: string;
      createdAt: string;
      updatedAt: string;
      viewport: unknown;
      nodes: Record<string, unknown> | unknown[];
      chains: Record<string, unknown> | unknown[];
    };
    const nodes = Array.isArray(raw.nodes)
      ? raw.nodes
      : Object.values(raw.nodes).sort((a, b) =>
          String((a as { id: string }).id).localeCompare(
            String((b as { id: string }).id),
          ),
        );
    const chains = Array.isArray(raw.chains)
      ? raw.chains
      : Object.values(raw.chains).sort((a, b) =>
          String((a as { id: string }).id).localeCompare(
            String((b as { id: string }).id),
          ),
        );
    return {
      schemaVersion: 1,
      id: raw.id,
      name: raw.name ?? raw.title ?? 'Untitled',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      viewport: raw.viewport,
      nodes,
      chains,
    };
  },
};

describe('migration harness (P5.7)', () => {
  test('production migrations stay empty — v1 is the origin', () => {
    expect(migrations).toEqual([]);
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  test('identity when already at CURRENT', () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, keep: true };
    const result = runMigrations(doc);
    expect(result).toEqual({ ok: true, value: doc });
  });

  test('synthetic v0→v1 fixture pair: before migrates to after', () => {
    const result = runMigrations(beforeV0, [syntheticV0toV1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(afterV1);
  });

  test('synthetic v0→v1 output passes the wire zod schema', () => {
    const result = runMigrations(beforeV0, [syntheticV0toV1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validated = validateWireDocument(result.value);
    expect(validated.ok).toBe(true);
  });

  test('gap in the chain is an error, not a silent skip', () => {
    const result = runMigrations(
      { schemaVersion: 0 },
      [{ from: 2, to: 3, migrate: d => d }],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('no_path');
    expect(result.error.message).toMatch(/No migration from schemaVersion 0/);
  });

  test('migration that fails to bump schemaVersion is a broken_chain', () => {
    const result = runMigrations(
      { schemaVersion: 0 },
      [
        {
          from: 0,
          to: 1,
          migrate: () => ({ schemaVersion: 0 }),
        },
      ],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('broken_chain');
  });

  test('refuses to migrate downward', () => {
    const result = runMigrations(
      { schemaVersion: 2 },
      [],
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/downward/i);
  });
});
