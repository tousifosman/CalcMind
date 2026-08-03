import { useUiStore } from './uiStore';

function resetStore() {
  useUiStore.setState({ keypadVisible: true });
}

beforeEach(resetStore);

describe('uiStore keypad visibility', () => {
  test('starts visible', () => {
    expect(useUiStore.getState().keypadVisible).toBe(true);
  });

  test('toggleKeypad flips visibility', () => {
    useUiStore.getState().toggleKeypad();
    expect(useUiStore.getState().keypadVisible).toBe(false);
    useUiStore.getState().toggleKeypad();
    expect(useUiStore.getState().keypadVisible).toBe(true);
  });

  test('hideKeypad and showKeypad set an explicit state', () => {
    useUiStore.getState().hideKeypad();
    expect(useUiStore.getState().keypadVisible).toBe(false);
    useUiStore.getState().hideKeypad();
    expect(useUiStore.getState().keypadVisible).toBe(false);

    useUiStore.getState().showKeypad();
    expect(useUiStore.getState().keypadVisible).toBe(true);
  });
});
