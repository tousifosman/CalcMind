import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Keypad, KeypadKey, isClearSwipe } from './Keypad';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import {
  addNumberNode,
  addOperatorNode,
  appendEqualsNode,
  appendOperatorAndNumber,
  continueFromValue,
  selectAll,
  selectGroup,
  selectNode,
  setNodeRaw,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette } from '../ui/tokens';
import { findHostByTestID } from '../nodes/testUtils';

beforeEach(() => {
  act(() => {
    useUiStore.setState({
      keypadVisible: true,
      clearConfirmVisible: false,
      groupSelectedIds: new Set(),
      // `allSelected` was missing here — a test that called `selectAll()` (Select all
      // locks data-entry keys) leaked `allSelected: true` into whichever test ran next,
      // silently disabling every data-entry key for it. Caught by a later test in this
      // file asserting `()` was enabled with nothing selected and getting `true` instead.
      allSelected: false,
      selectedNodeId: null,
      editingNodeId: null,
    });
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
    expect(findByTestID(renderer, 'keypad-link')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-add-components')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-notes')).toBeTruthy();
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

  test('digit keys disable while a linked cell, result, or operator is selected', () => {
    const presses: KeypadKey[] = [];
    const n = addNumberNode({ x: 0, y: 0 }, '3');
    appendEqualsNode(n);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (node) => node.kind === 'result',
    )!;
    const { referenceId, operatorId } = continueFromValue(result.id, '+');
    const freeOp = addOperatorNode({ x: 200, y: 0 }, '×');
    let renderer!: ReactTestRenderer;
    act(() => {
      selectNode(referenceId);
      renderer = create(<Keypad onKeyPress={(key) => presses.push(key)} />);
    });

    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-digit-0').props.disabled).toBe(true);
    // Decimal / +/- are number keys now (not a separate number-editing carve-out): a
    // selected linked cell disables them right alongside the digits.
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);
    act(() => {
      findByTestID(renderer, 'keypad-digit-5').props.onPress?.();
    });
    expect(presses).toEqual([]);

    act(() => {
      selectNode(result.id);
    });
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
    // Same for a selected result — this was the reported gap: decimal / +/- used to stay
    // enabled here even though every digit disabled.
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);

    act(() => {
      selectNode(operatorId);
    });
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBe(true);

    act(() => {
      selectNode(freeOp);
    });
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);

    act(() => {
      selectNode(n);
    });
    // Re-render picks up the selection change.
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBeFalsy();
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
    // Decimal / `+/-` moved into the digit grid's `0` row, and `()` moved into the accent
    // column under `+` (§8.5); the number-editing row now holds only icon keys —
    // `Create link`, `Add components`, `Notes` — so no Text glyphs remain in it.
    const editingLabels = findByTestID(renderer, 'keypad-number-editing')
      .findAllByType('Text' as never)
      .map((node) => node.children[0]);
    expect(editingLabels).toEqual([]);
    // Bottom history row is undo, redo, backspace — left to right, all Heroicons
    // (arrow-uturn-left / right, backspace). No Text glyphs in this row.
    // `findByProps({ testID })` hits the Key composite (label = a11y name); the
    // spoken accessibilityLabel lives on the inner Touchable, same as ModeKey.
    const history = findByTestID(renderer, 'keypad-history');
    expect(history.findAllByType('Text' as never)).toHaveLength(0);
    const undo = findByTestID(renderer, 'keypad-undo');
    const redo = findByTestID(renderer, 'keypad-redo');
    const backspace = findByTestID(renderer, 'keypad-backspace');
    expect(undo.props.label).toBe('Undo');
    expect(redo.props.label).toBe('Redo');
    expect(backspace.props.label).toBe('Backspace');
    expect(undo.props.icon).toBeTruthy();
    expect(redo.props.icon).toBeTruthy();
    expect(backspace.props.icon).toBeTruthy();
    expect(undo.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
    expect(redo.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
    expect(backspace.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
  });
});

describe('Create link keypad button (§8.6)', () => {
  test('renders an icon (no text glyph), with "Create link" as the a11y name', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    const link = findByTestID(renderer, 'keypad-link');
    expect(link.props.label).toBe('Create link');
    expect(link.findAllByType('Text' as never)).toHaveLength(0);
    expect(link.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
  });

  test('disabled when nothing is selected', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });

  test('enabled when a number is selected; pressing reports the createLink region', () => {
    const presses: KeypadKey[] = [];
    let n!: string;
    act(() => {
      n = addNumberNode({ x: 0, y: 0 }, '3');
      selectNode(n);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad onKeyPress={(key) => presses.push(key)} />);
    });

    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(false);
    act(() => {
      findByTestID(renderer, 'keypad-link').props.onPress();
    });
    expect(presses).toEqual([{ region: 'createLink' }]);
  });

  test('enabled when a result is selected', () => {
    act(() => {
      const n = addNumberNode({ x: 0, y: 0 }, '3');
      appendEqualsNode(n);
      const result = Object.values(useDocumentStore.getState().document.nodes).find(
        (node) => node.kind === 'result',
      )!;
      selectNode(result.id);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(false);
  });

  test('disabled when a linked cell (reference) is selected', () => {
    act(() => {
      const n = addNumberNode({ x: 0, y: 0 }, '3');
      const { referenceId } = continueFromValue(n, '+');
      selectNode(referenceId);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });

  test('disabled when an operator is selected', () => {
    act(() => {
      const op = addOperatorNode({ x: 0, y: 0 }, '+');
      selectNode(op);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });

  test('disabled during Select group, even with a number selected beforehand', () => {
    let n!: string;
    let op!: string;
    act(() => {
      n = addNumberNode({ x: 0, y: 0 }, '1');
      op = addOperatorNode({ x: 50, y: 0 }, '+');
      const b = addNumberNode({ x: 84, y: 0 }, '2');
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains.ch = { id: 'ch', members: [n, op, b], anchor: { x: 0, y: 0 } };
        draft.nodes[n].chainId = 'ch';
        draft.nodes[op].chainId = 'ch';
        draft.nodes[b].chainId = 'ch';
      });
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
      selectGroup(op);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });

  test('disabled while Select all is active', () => {
    act(() => {
      addNumberNode({ x: 0, y: 0 }, '1');
      selectAll();
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });
});

describe('() moved into the accent column, under + (§8.5)', () => {
  test('still reports the paren region and follows numberEditingKeysDisabled', () => {
    const presses: KeypadKey[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad onKeyPress={(key) => presses.push(key)} />);
    });

    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBeFalsy();
    act(() => {
      findByTestID(renderer, 'keypad-paren').props.onPress();
    });
    expect(presses).toEqual([{ region: 'paren' }]);

    act(() => {
      const op = addOperatorNode({ x: 0, y: 0 }, '+');
      selectNode(op);
    });
    // An operator selected disables the number-editing row, () included, same as before
    // the move (§8.5: "the number-editing row … is disabled too" while an operator is
    // selected — `()` itself replaces nothing, it just still belongs to that rule).
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBe(true);
  });

  test('is filled the same amber as the other operator keys', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    const paren = findHostByTestID(renderer.root, 'keypad-paren');
    const add = findHostByTestID(renderer.root, 'keypad-op-add');
    expect(paren.props.style).toMatchObject({ backgroundColor: rolePalette.operator.fill });
    expect(paren.props.style).toMatchObject({ backgroundColor: add.props.style.backgroundColor });
  });
});

describe('Decimal / +/- share 0\'s colour (§8.5)', () => {
  test('are filled the same teal as the digit keys, not the generic grey key', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    const decimal = findHostByTestID(renderer.root, 'keypad-decimal');
    const sign = findHostByTestID(renderer.root, 'keypad-sign');
    const zero = findHostByTestID(renderer.root, 'keypad-digit-0');
    expect(decimal.props.style).toMatchObject({ backgroundColor: rolePalette.number.fill });
    expect(sign.props.style).toMatchObject({ backgroundColor: rolePalette.number.fill });
    expect(decimal.props.style.backgroundColor).toBe(zero.props.style.backgroundColor);
    // `()`, elsewhere in the accent column, still keeps the operator amber — this is
    // decimal/`+/-` specifically picking up the *number* fill, not a global recolour.
    expect(decimal.props.style.backgroundColor).not.toBe(rolePalette.operator.fill);
  });
});

describe('Add components / Notes placeholders (§8.6, behaviour TBD)', () => {
  test('render disabled with their icon, Create link\'s blue fill, and no onPress', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const [testID, label] of [
      ['keypad-add-components', 'Add components'],
      ['keypad-notes', 'Notes'],
    ] as const) {
      const key = findByTestID(renderer, testID);
      expect(key.props.disabled).toBe(true);
      expect(key.props.label).toBe(label);
      expect(key.props.onPress).toBeUndefined();
      expect(key.findAllByProps({ accessibilityRole: 'Svg' }).length).toBeGreaterThan(0);
      expect(key.findAllByType('Text' as never)).toHaveLength(0);
    }
  });

  test('stay disabled regardless of selection (behaviour not wired up yet)', () => {
    let n!: string;
    act(() => {
      n = addNumberNode({ x: 0, y: 0 }, '3');
      selectNode(n);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    expect(findByTestID(renderer, 'keypad-add-components').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-notes').props.disabled).toBe(true);
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

describe('group-mode keypad (§8.5)', () => {
  test('Select group without a result disables digits, editing, operators, and equals', () => {
    let op!: string;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '1');
      op = addOperatorNode({ x: 50, y: 0 }, '+');
      const b = addNumberNode({ x: 84, y: 0 }, '2');
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains.ch = { id: 'ch', members: [a, op, b], anchor: { x: 0, y: 0 } };
        draft.nodes[a].chainId = 'ch';
        draft.nodes[op].chainId = 'ch';
        draft.nodes[b].chainId = 'ch';
      });
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
      selectGroup(op);
    });

    expect(findByTestID(renderer, 'keypad-undo').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-redo').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-digit-7').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-op-add').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBe(true);
  });

  test('Select group with a result keeps operators enabled and equals disabled', () => {
    let op!: string;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '1');
      const built = appendOperatorAndNumber(a, '+');
      op = built.operatorId;
      setNodeRaw(built.numberId, '2');
      appendEqualsNode(built.numberId);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
      selectGroup(op);
    });

    expect(findByTestID(renderer, 'keypad-op-add').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-op-multiply').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-digit-1').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();
    // `Create link` is not part of the §8.7-continuation carve-out that keeps
    // operators enabled here — a group selection is not a single number/result.
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
  });
});

describe('Select all locks data-entry keys (§8.6)', () => {
  test('digits, operators, editing and grouping keys disable; mode strip stays live', () => {
    const presses: KeypadKey[] = [];
    act(() => {
      addNumberNode({ x: 0, y: 0 }, '1');
      addNumberNode({ x: 40, y: 0 }, '2');
      selectAll();
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad onKeyPress={(key) => presses.push(key)} />);
    });

    for (const digit of ['0', '1', '7']) {
      expect(findByTestID(renderer, `keypad-digit-${digit}`).props.disabled).toBe(true);
    }
    for (const id of [
      'keypad-decimal',
      'keypad-sign',
      'keypad-backspace',
      'keypad-paren',
      'keypad-link',
      'keypad-op-add',
      'keypad-op-multiply',
      'keypad-equals',
    ]) {
      expect(findByTestID(renderer, id).props.disabled).toBe(true);
    }

    // Mode strip remains interactive (top-row action items).
    expect(findByTestID(renderer, 'keypad-mode-dismiss').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-mode-clear-all').props.disabled).toBe(false);

    act(() => {
      findByTestID(renderer, 'keypad-digit-7').props.onPress?.();
      findByTestID(renderer, 'keypad-op-add').props.onPress?.();
    });
    expect(presses).toEqual([]);
  });
});
