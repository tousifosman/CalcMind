import {
  createMemoryPreferencesKeyVal,
  createWebPreferencesAdapter,
} from './preferences.web';

describe('web PreferencesAdapter', () => {
  test('read() resolves to {} when nothing has been saved yet', async () => {
    const adapter = createWebPreferencesAdapter(createMemoryPreferencesKeyVal());
    expect(await adapter.read()).toEqual({});
  });

  test('write() then read() round-trips', async () => {
    const adapter = createWebPreferencesAdapter(createMemoryPreferencesKeyVal());
    await adapter.write({ numeralFontSize: 26 });
    expect(await adapter.read()).toEqual({ numeralFontSize: 26 });
  });

  test('a later write() overwrites, not merges with, the earlier one', async () => {
    const adapter = createWebPreferencesAdapter(createMemoryPreferencesKeyVal());
    await adapter.write({ numeralFontSize: 26 });
    await adapter.write({ numeralFontSize: 18 });
    expect(await adapter.read()).toEqual({ numeralFontSize: 18 });
  });

  test('a corrupt stored value is swallowed to {} rather than thrown', async () => {
    const kv = createMemoryPreferencesKeyVal([['preferences', 'not json']]);
    const adapter = createWebPreferencesAdapter(kv);
    expect(await adapter.read()).toEqual({});
  });

  test('stores under its own key, independent of any caller-supplied document keys', async () => {
    const kv = createMemoryPreferencesKeyVal([['doc_1', '{"name":"unrelated"}']]);
    const adapter = createWebPreferencesAdapter(kv);
    await adapter.write({ numeralFontSize: 30 });
    expect(await kv.get('doc_1')).toBe('{"name":"unrelated"}');
    expect(await adapter.read()).toEqual({ numeralFontSize: 30 });
  });
});
