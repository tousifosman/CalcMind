// Shared StorageAdapter behavioural contract. P5.4 reuses this against the web
// adapter so both platforms prove the same surface (§12.2, P5.4 acceptance).
import type { StorageAdapter } from './adapter';

export type AdapterHarness = {
  adapter: StorageAdapter;
  /** Optional: inspect raw stored payload for a document id (test-only). */
  peekPrimary?: (id: string) => string | undefined;
  peekBak?: (id: string) => string | undefined;
  peekTmp?: (id: string) => string | undefined;
};

export function defineStorageAdapterContract(
  label: string,
  setup: () => AdapterHarness,
): void {
  describe(`StorageAdapter contract (${label})`, () => {
    let harness: AdapterHarness;

    beforeEach(() => {
      harness = setup();
    });

    test('write then read round-trips the JSON string', async () => {
      const json = '{"schemaVersion":1,"id":"doc_a","name":"A"}';
      await harness.adapter.write('doc_a', json);
      await expect(harness.adapter.read('doc_a')).resolves.toBe(json);
    });

    test('list returns metas sorted by id, with name/updatedAt/bytes', async () => {
      await harness.adapter.write(
        'doc_b',
        JSON.stringify({
          schemaVersion: 1,
          id: 'doc_b',
          name: 'Beta',
          updatedAt: '2026-08-04T12:00:00.000Z',
        }),
      );
      await harness.adapter.write(
        'doc_a',
        JSON.stringify({
          schemaVersion: 1,
          id: 'doc_a',
          name: 'Alpha',
          updatedAt: '2026-08-04T11:00:00.000Z',
        }),
      );
      const list = await harness.adapter.list();
      expect(list.map(m => m.id)).toEqual(['doc_a', 'doc_b']);
      expect(list[0]).toMatchObject({
        id: 'doc_a',
        name: 'Alpha',
        updatedAt: '2026-08-04T11:00:00.000Z',
      });
      expect(list[0].bytes).toBeGreaterThan(0);
      expect(list[1]).toMatchObject({ id: 'doc_b', name: 'Beta' });
    });

    test('overwrite replaces the primary content', async () => {
      await harness.adapter.write('doc_x', '{"v":1}');
      await harness.adapter.write('doc_x', '{"v":2}');
      await expect(harness.adapter.read('doc_x')).resolves.toBe('{"v":2}');
    });

    test('remove deletes the document; subsequent read fails', async () => {
      await harness.adapter.write('doc_z', '{"gone":false}');
      await harness.adapter.remove('doc_z');
      await expect(harness.adapter.read('doc_z')).rejects.toBeTruthy();
      const list = await harness.adapter.list();
      expect(list.find(m => m.id === 'doc_z')).toBeUndefined();
    });
  });
}
