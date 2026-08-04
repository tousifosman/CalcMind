import { useUiStore } from './uiStore';

function resetStore() {
  useUiStore.setState({
    keypadVisible: true,
    clearConfirmVisible: false,
    selectedNodeId: null,
    editingNodeId: null,
  });
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

describe('uiStore clear confirmation', () => {
  test('starts hidden', () => {
    expect(useUiStore.getState().clearConfirmVisible).toBe(false);
  });

  test('requestClearConfirm shows it, dismissClearConfirm hides it', () => {
    useUiStore.getState().requestClearConfirm();
    expect(useUiStore.getState().clearConfirmVisible).toBe(true);

    useUiStore.getState().dismissClearConfirm();
    expect(useUiStore.getState().clearConfirmVisible).toBe(false);
  });
});

describe('uiStore selection', () => {
  test('starts with nothing selected or editing', () => {
    expect(useUiStore.getState().selectedNodeId).toBeNull();
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('setSelectedNode and setEditingNode are independent setters', () => {
    useUiStore.getState().setSelectedNode('n_1');
    expect(useUiStore.getState().selectedNodeId).toBe('n_1');
    expect(useUiStore.getState().editingNodeId).toBeNull();

    useUiStore.getState().setEditingNode('n_1');
    expect(useUiStore.getState().editingNodeId).toBe('n_1');

    useUiStore.getState().setSelectedNode(null);
    expect(useUiStore.getState().selectedNodeId).toBeNull();
    expect(useUiStore.getState().editingNodeId).toBe('n_1'); // unaffected by the other setter
  });
});
