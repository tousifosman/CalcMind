// §1.2 P7: the numeral font size preference, plus §7's auto-pan-to-edited-cell toggle.
// Persistence and chain-reflow side effects are mocked so this stays a test of the store's
// own logic (clamping, when it writes, when it reflows) — preferences.native.test.ts /
// preferences.web.test.ts cover the adapters themselves, and reflowAllChains's own
// geometry is chains/layout.test.ts's job.
interface MockPrefs {
  numeralFontSize?: number;
  autoPanToEditedCell?: boolean;
}

const mockWrite = jest.fn(async (_prefs: MockPrefs) => {});
const mockRead = jest.fn(async () => ({}) as MockPrefs);

jest.mock('../persistence/preferences', () => ({
  preferencesAdapter: {
    write: (prefs: MockPrefs) => mockWrite(prefs),
    read: () => mockRead(),
  },
}));

const mockReflow = jest.fn((_fontSize: number) => {});
jest.mock('./reflowAllChains', () => ({
  reflowAllChainsForDisplay: (fontSize: number) => mockReflow(fontSize),
}));

import {
  usePreferencesStore,
  NUMERAL_FONT_SIZE_MIN,
  NUMERAL_FONT_SIZE_MAX,
} from './preferencesStore';
import { tokens } from '../ui/tokens';

beforeEach(() => {
  jest.clearAllMocks();
  usePreferencesStore.setState({
    numeralFontSize: tokens.numeralFontSize,
    autoPanToEditedCell: true,
  });
});

describe('preferencesStore numeralFontSize', () => {
  test('starts at the compiled-in token default', () => {
    expect(usePreferencesStore.getState().numeralFontSize).toBe(tokens.numeralFontSize);
  });

  test('setNumeralFontSize updates state, persists (with the full blob), and reflows every open chain at the new size', () => {
    usePreferencesStore.getState().setNumeralFontSize(26);

    expect(usePreferencesStore.getState().numeralFontSize).toBe(26);
    // persist() writes every field's current value, not just the one that changed — a
    // partial write would silently drop autoPanToEditedCell from disk on the next
    // restart (see preferencesStore.ts's `persist` comment).
    expect(mockWrite).toHaveBeenCalledWith({ numeralFontSize: 26, autoPanToEditedCell: true });
    expect(mockReflow).toHaveBeenCalledWith(26);
  });

  test('a value that gets clamped reflows at the clamped size, not the raw input', () => {
    usePreferencesStore.getState().setNumeralFontSize(NUMERAL_FONT_SIZE_MAX + 10);
    expect(mockReflow).toHaveBeenCalledWith(NUMERAL_FONT_SIZE_MAX);
  });

  test('clamps below the minimum', () => {
    usePreferencesStore.getState().setNumeralFontSize(NUMERAL_FONT_SIZE_MIN - 10);
    expect(usePreferencesStore.getState().numeralFontSize).toBe(NUMERAL_FONT_SIZE_MIN);
  });

  test('clamps above the maximum', () => {
    usePreferencesStore.getState().setNumeralFontSize(NUMERAL_FONT_SIZE_MAX + 10);
    expect(usePreferencesStore.getState().numeralFontSize).toBe(NUMERAL_FONT_SIZE_MAX);
  });

  test('setting to the current (post-clamp) value is a no-op: no write, no reflow', () => {
    usePreferencesStore.setState({ numeralFontSize: 22 });
    usePreferencesStore.getState().setNumeralFontSize(22);

    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockReflow).not.toHaveBeenCalled();
  });

  test('a failed persist keeps the in-memory value (swallowed, not surfaced)', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    usePreferencesStore.getState().setNumeralFontSize(28);
    expect(usePreferencesStore.getState().numeralFontSize).toBe(28);
    // Let the rejected promise's .catch() settle before the test ends.
    await Promise.resolve();
    await Promise.resolve();
  });

  test('hydrate() loads a persisted value over the default', async () => {
    mockRead.mockResolvedValueOnce({ numeralFontSize: 18 });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().numeralFontSize).toBe(18);
  });

  test('hydrate() clamps a persisted value that is out of the current range', async () => {
    mockRead.mockResolvedValueOnce({ numeralFontSize: 999 });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().numeralFontSize).toBe(NUMERAL_FONT_SIZE_MAX);
  });

  test('hydrate() with nothing saved leaves the default in place', async () => {
    mockRead.mockResolvedValueOnce({});
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().numeralFontSize).toBe(tokens.numeralFontSize);
  });

  test('hydrate() swallows a read failure and keeps the default', async () => {
    mockRead.mockRejectedValueOnce(new Error('unavailable'));
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().numeralFontSize).toBe(tokens.numeralFontSize);
  });

  test('hydrate() never calls the reflow side effect — only user edits (setNumeralFontSize) do', async () => {
    mockRead.mockResolvedValueOnce({ numeralFontSize: 18 });
    await usePreferencesStore.getState().hydrate();
    expect(mockReflow).not.toHaveBeenCalled();
  });
});

describe('preferencesStore autoPanToEditedCell (§7 P7 follow-up)', () => {
  test('starts on by default', () => {
    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(true);
  });

  test('setAutoPanToEditedCell(false) updates state and persists the full blob', () => {
    usePreferencesStore.getState().setAutoPanToEditedCell(false);

    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(false);
    expect(mockWrite).toHaveBeenCalledWith({
      numeralFontSize: tokens.numeralFontSize,
      autoPanToEditedCell: false,
    });
  });

  test('setAutoPanToEditedCell(true) after turning it off updates state and persists both fields', () => {
    usePreferencesStore.getState().setAutoPanToEditedCell(false);
    mockWrite.mockClear();
    usePreferencesStore.getState().setAutoPanToEditedCell(true);

    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith({
      numeralFontSize: tokens.numeralFontSize,
      autoPanToEditedCell: true,
    });
  });

  test('setting to the current value is a no-op: no write', () => {
    usePreferencesStore.getState().setAutoPanToEditedCell(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('a changed numeral font size does not clobber a previously-set autoPanToEditedCell on disk', () => {
    usePreferencesStore.getState().setAutoPanToEditedCell(false);
    usePreferencesStore.getState().setNumeralFontSize(26);

    expect(mockWrite).toHaveBeenLastCalledWith({
      numeralFontSize: 26,
      autoPanToEditedCell: false,
    });
  });

  test('a failed persist keeps the in-memory value (swallowed, not surfaced)', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    usePreferencesStore.getState().setAutoPanToEditedCell(false);
    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
  });

  test('hydrate() loads a persisted false value over the default', async () => {
    mockRead.mockResolvedValueOnce({ autoPanToEditedCell: false });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(false);
  });

  test('hydrate() with nothing saved leaves the default (true) in place', async () => {
    mockRead.mockResolvedValueOnce({});
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(true);
  });

  test('hydrate() ignores a non-boolean value and keeps the default', async () => {
    mockRead.mockResolvedValueOnce({ autoPanToEditedCell: 'nope' as unknown as boolean });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().autoPanToEditedCell).toBe(true);
  });
});
