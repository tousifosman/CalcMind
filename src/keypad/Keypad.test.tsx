import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Keypad, KeypadKey, isClearSwipe } from './Keypad';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { addNumberNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';

beforeEach(() => {
  act(() => {
    useUiStore.setState({ keypadVisible: true, clearConfirmVisible: false });
    useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  });
});

function findByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

describe('Keypad', () => {
  test('renders nothing when the keypad is hidden', () => {
    useUiStore.getState().hideKeypad();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(renderer.root.findAllByProps({ testID: 'keypad' })).toHaveLength(0);
  });

  test('renders every region from §8.5: digits, number editing, history, operators, mode strip', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(findByTestID(renderer, `keypad-digit-${digit}`)).toBeTruthy();
    }
    expect(findByTestID(renderer, 'keypad-decimal')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-sign')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-paren')).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'keypad-paren-open' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'keypad-paren-close' })).toHaveLength(0);
    expect(findByTestID(renderer, 'keypad-history')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-undo')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-redo')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-backspace')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-divide')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-multiply')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-subtract')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-add')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-equals')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-dismiss')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-documents')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-functions')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-graph')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-clear-all')).toBeTruthy();
  });

  test('the decimal key shows the locale glyph but reports a bare "decimal" press', () => {
    const presses: KeypadKey[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad locale="de-DE" onKeyPress={(key) => presses.push(key)} />);
    });

    const decimalText = renderer.root.findByProps({ testID: 'keypad-decimal' }).findByType('Text' as never);
    expect(decimalText.children).toEqual([',']);

    act(() => {
      findByTestID(renderer, 'keypad-decimal').props.onPress();
    });
    expect(presses).toEqual([{ region: 'decimal' }]);
  });

  test('functions and graph mode keys are disabled, not silently missing', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    expect(findByTestID(renderer, 'keypad-mode-functions').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-mode-graph').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-mode-documents').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-mode-dismiss').props.disabled).toBeFalsy();
  });

  test('dismissing via the mode strip hides the keypad, outside undo history', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    act(() => {
      findByTestID(renderer, 'keypad-mode-dismiss').props.onPress();
    });

    expect(useUiStore.getState().keypadVisible).toBe(false);
    expect(renderer.root.findAllByProps({ testID: 'keypad' })).toHaveLength(0);
  });

  test('key presses report which region and value was pressed', () => {
    const presses: KeypadKey[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad onKeyPress={(key) => presses.push(key)} />);
    });

    act(() => {
      findByTestID(renderer, 'keypad-digit-7').props.onPress();
      findByTestID(renderer, 'keypad-op-multiply').props.onPress();
      findByTestID(renderer, 'keypad-equals').props.onPress();
      findByTestID(renderer, 'keypad-paren').props.onPress();
      findByTestID(renderer, 'keypad-backspace').props.onPress();
      findByTestID(renderer, 'keypad-sign').props.onPress();
      findByTestID(renderer, 'keypad-undo').props.onPress();
      findByTestID(renderer, 'keypad-redo').props.onPress();
    });

    expect(presses).toEqual([
      { region: 'digit', value: '7' },
      { region: 'operator', op: '×' },
      { region: 'equals' },
      { region: 'paren' },
      { region: 'backspace' },
      { region: 'sign' },
      { region: 'undo' },
      { region: 'redo' },
    ]);

    const parenLabel = findByTestID(renderer, 'keypad-paren').findByType('Text' as never);
    expect(parenLabel.children).toEqual(['()']);
    // `()` shares the number-editing row with decimal / +/- (same Key cell size).
    const editingLabels = findByTestID(renderer, 'keypad-number-editing')
      .findAllByType('Text' as never)
      .map((node) => node.children[0]);
    expect(editingLabels).toEqual(['.', '+/-', '()']);
    // Bottom history row is undo, redo, backspace — left to right. Undo/redo are
    // Heroicons (arrow-uturn-left / right); only ⌫ still renders a Text glyph.
    const history = findByTestID(renderer, 'keypad-history');
    expect(history.findAllByType('Text' as never).map((node) => node.children[0])).toEqual(['⌫']);
    const undo = findByTestID(renderer, 'keypad-undo');
    const redo = findByTestID(renderer, 'keypad-redo');
    expect(undo.props.accessibilityLabel).toBe('Undo');
    expect(redo.props.accessibilityLabel).toBe('Redo');
    expect(undo.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
    expect(redo.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
  });
});

describe('isClearSwipe (§8.5 swipe-across-backspace threshold)', () => {
  test('a short drag is not a clear swipe', () => {
    expect(isClearSwipe(10, 0)).toBe(false);
  });

  test('a long horizontal swipe is a clear swipe', () => {
    expect(isClearSwipe(60, 2)).toBe(true);
    expect(isClearSwipe(-60, -2)).toBe(true);
  });

  test('a long but mostly-vertical drag is not a clear swipe', () => {
    expect(isClearSwipe(45, 40)).toBe(false);
  });
});

describe('swipe-to-clear confirmation (P2.10, decision #15)', () => {
  test('no confirmation dialog renders by default', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    expect(renderer.root.findAllByProps({ testID: 'keypad-clear-confirm' })).toHaveLength(0);
  });

  test('the confirmation dialog appears once requested and hides the keypad keys', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    act(() => {
      useUiStore.getState().requestClearConfirm();
    });

    expect(findByTestID(renderer, 'keypad-clear-confirm')).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'keypad-digits' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'keypad-mode-clear-all' })).toHaveLength(0);
  });

  test('cancelling the confirmation restores the keypad keys', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    act(() => {
      useUiStore.getState().requestClearConfirm();
    });
    act(() => {
      findByTestID(renderer, 'keypad-clear-confirm-cancel').props.onPress();
    });

    expect(renderer.root.findAllByProps({ testID: 'keypad-clear-confirm' })).toHaveLength(0);
    expect(findByTestID(renderer, 'keypad-digits')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-clear-all')).toBeTruthy();
  });

  test('confirming clears every node in one undo entry and closes the dialog', () => {
    let id!: string;
    let stackBefore!: number;
    act(() => {
      id = addNumberNode({ x: 0, y: 0 }, '42');
      stackBefore = useDocumentStore.getState().undoStack.length;
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    act(() => {
      useUiStore.getState().requestClearConfirm();
    });

    act(() => {
      findByTestID(renderer, 'keypad-clear-confirm-clear').props.onPress();
    });

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 1);
    expect(useUiStore.getState().clearConfirmVisible).toBe(false);
    expect(renderer.root.findAllByProps({ testID: 'keypad-clear-confirm' })).toHaveLength(0);
  });

  test('dismissing leaves the document byte-identical', () => {
    let id!: string;
    let documentBefore!: ReturnType<typeof useDocumentStore.getState>['document'];
    act(() => {
      id = addNumberNode({ x: 0, y: 0 }, '42');
      documentBefore = useDocumentStore.getState().document;
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    act(() => {
      useUiStore.getState().requestClearConfirm();
    });

    act(() => {
      findByTestID(renderer, 'keypad-clear-confirm-cancel').props.onPress();
    });

    expect(useDocumentStore.getState().document).toBe(documentBefore);
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '42' });
    expect(useUiStore.getState().clearConfirmVisible).toBe(false);
  });
});

describe('Clear all mode-strip button (P7.8)', () => {
  test('is disabled on an empty canvas and enabled once a node exists', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-mode-clear-all').props.disabled).toBe(true);

    act(() => {
      addNumberNode({ x: 0, y: 0 }, '7');
    });
    expect(findByTestID(renderer, 'keypad-mode-clear-all').props.disabled).toBe(false);
  });

  test('pressing it raises the same confirmation as swipe-to-clear', () => {
    act(() => {
      addNumberNode({ x: 0, y: 0 }, '7');
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    act(() => {
      findByTestID(renderer, 'keypad-mode-clear-all').props.onPress();
    });

    expect(useUiStore.getState().clearConfirmVisible).toBe(true);
    expect(findByTestID(renderer, 'keypad-clear-confirm')).toBeTruthy();
  });

  test('confirming from the button clears the document in one undo entry', () => {
    let id!: string;
    let stackBefore!: number;
    act(() => {
      id = addNumberNode({ x: 0, y: 0 }, '7');
      stackBefore = useDocumentStore.getState().undoStack.length;
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    act(() => {
      findByTestID(renderer, 'keypad-mode-clear-all').props.onPress();
    });
    act(() => {
      findByTestID(renderer, 'keypad-clear-confirm-clear').props.onPress();
    });

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 1);
    expect(useUiStore.getState().clearConfirmVisible).toBe(false);
  });
});
