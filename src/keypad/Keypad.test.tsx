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
  createLinkToValue,
  editNumberNode,
  selectAll,
  selectGroup,
  selectNode,
  setNodeRaw,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { identityHues, rolePalette } from '../ui/tokens';
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
      settingsVisible: false,
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
    expect(findByTestID(renderer, 'keypad-mode-settings')).toBeTruthy();
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

  test('the settings mode key is enabled and opens the settings sheet', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    expect(findByTestID(renderer, 'keypad-mode-settings').props.disabled).toBeFalsy();
    act(() => {
      findByTestID(renderer, 'keypad-mode-settings').props.onPress();
    });
    expect(useUiStore.getState().settingsVisible).toBe(true);
  });

  test('digit keys disable while a linked cell or result is selected; an operator depends on its right neighbour', () => {
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
    // §8.5: this operator's right neighbour is `continueFromValue`'s own empty operand —
    // a number cell, so digits now target it instead of disabling. `()` stays disabled;
    // an operator is never a paren target.
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBe(true);

    act(() => {
      selectNode(freeOp);
    });
    // A free (chainless) operator has no right neighbour to speak of — same "add one"
    // case, so digits stay enabled here too.
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBeFalsy();

    act(() => {
      selectNode(n);
    });
    // Re-render picks up the selection change.
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBeFalsy();
  });

  test('digit keys disable on a selected operator whose right neighbour is a linked cell or a result (§8.5)', () => {
    const source = addNumberNode({ x: 0, y: 0 }, '7');
    let opId!: string;
    let refId!: string;
    act(() => {
      opId = addOperatorNode({ x: 0, y: 0 }, '+');
      refId = 'ref_right_of_op';
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains.ch_op_ref = { id: 'ch_op_ref', members: [opId, refId], anchor: { x: 0, y: 0 } };
        draft.nodes[opId]!.chainId = 'ch_op_ref';
        draft.nodes[refId] = {
          id: refId,
          kind: 'reference',
          position: { x: 40, y: 0 },
          chainId: 'ch_op_ref',
          createdAt: 0,
          targetNodeId: source,
        };
      });
      selectNode(opId);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);

    let resultOpId!: string;
    act(() => {
      resultOpId = 'op_right_of_result';
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains.ch_op_result = {
          id: 'ch_op_result',
          members: [resultOpId, 'result_right_of_op'],
          anchor: { x: 0, y: 0 },
        };
        draft.nodes[resultOpId] = {
          id: resultOpId,
          kind: 'operator',
          op: '+',
          position: { x: 0, y: 0 },
          chainId: 'ch_op_result',
          createdAt: 0,
        };
        draft.nodes.result_right_of_op = {
          id: 'result_right_of_op',
          kind: 'result',
          position: { x: 40, y: 0 },
          chainId: 'ch_op_result',
          createdAt: 0,
          sourceChainId: 'ch_op_result',
        };
      });
      selectNode(resultOpId);
    });
    expect(findByTestID(renderer, 'keypad-digit-5').props.disabled).toBe(true);
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

  test('enabled when a live linked cell (reference) is selected', () => {
    act(() => {
      const n = addNumberNode({ x: 0, y: 0 }, '3');
      const { referenceId } = continueFromValue(n, '+');
      selectNode(referenceId);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    // Same eligibility as the context-menu `Create link` action (§8.6): chaining a link
    // off an existing link works from the keypad too.
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(false);
  });

  test('disabled when a dangling linked cell (target gone) is selected', () => {
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.dangling = {
          id: 'dangling',
          kind: 'reference',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: 'gone',
          lastKnownDisplay: '42',
        };
      });
      selectNode('dangling');
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

describe('main column and accent column rows stay aligned (§8.5)', () => {
  test('every key shares one row height, so the two six-row columns land on the same lines', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    // One representative per row on each side: digit grid (4 rows) + number-editing row +
    // history row on the left; operators + `()` + `=` on the right — six rows each since
    // `()` moved into the accent column. If any of these drifts from the rest, the two
    // columns step out of alignment the way the reported screenshot showed.
    const testIDs = [
      'keypad-digit-7',
      'keypad-decimal',
      'keypad-link',
      'keypad-undo',
      'keypad-op-divide',
      'keypad-paren',
      'keypad-equals',
    ];
    const heights = testIDs.map(
      (testID) => findHostByTestID(renderer.root, testID).props.style.height,
    );
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe(48);
  });

  test('every non-final row in the main column carries the same bottom gap', () => {
    // `historyRow` used to be exempt (it was always the last row, where a trailing margin
    // doesn't matter) and had no `marginBottom` of its own. Reordering the main column
    // (§8.5) put the digit grid after it, silently collapsing that gap and shifting every
    // row below out of line with the operator column's own evenly spaced rows — a real,
    // reported regression. Asserting every non-final row shares one gap value catches a
    // repeat the same way the height check above catches a repeat of the 44-vs-48 bug.
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    const rowTestIDs = ['keypad-number-editing', 'keypad-history'];
    const gaps = rowTestIDs.map((testID) => findByTestID(renderer, testID).props.style.marginBottom);
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeGreaterThan(0);
  });

  test('the two columns sum to the same total natural height', () => {
    // The real invariant behind both row-alignment bugs above: with every key 48px tall
    // (checked above), the two columns land on identical row lines *only* if their six
    // rows' gaps add up to the same total — five rows carrying `KEY_GAP`, one true last
    // row that doesn't, on both sides. The fix for the previous bug (giving `historyRow`
    // its gap back) left the digit grid's now-actually-last row still carrying its own
    // unconditional trailing gap, so the main column summed 6px taller than the accent
    // column — invisible to the gap-equality check above, since every individual gap was
    // still a valid `KEY_GAP` or 0, just the wrong row was the one still carrying it. That
    // mismatch is what a real device showed as every operator key rendering ~1px too tall
    // (the browser stretching the shorter column to fill the taller one's height):
    // react-test-renderer doesn't run real layout, so this can only assert the arithmetic,
    // not reproduce the stretch itself — the browser boundingBox() check that actually
    // caught it isn't available here.
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    // RN style arrays merge left-to-right with later entries overriding earlier ones for
    // the same key (not summing) — mirrors that merge rather than assuming a flat object.
    function marginBottomOf(style: unknown): number {
      const layers = ([] as { marginBottom?: number }[]).concat(style as never).filter(Boolean);
      return layers.reduce((resolved, layer) => layer.marginBottom ?? resolved, 0);
    }

    // Read every gap from a *host* node (`findHostByTestID`), not `findByTestID`: the
    // latter's first tree match is often the outer composite (e.g. `OperatorKey` itself),
    // which never receives a `style` prop at all — its style is hardcoded internally and
    // only appears once flattened onto the actual host node further down.
    //
    // Main column: the number-editing and history rows' own containers, then each of the
    // digit grid's four row containers (three from the `DIGIT_ROWS.map`, plus the decimal/
    // `0`/`+/-` row — now the column's true last row, so the only one that must *not*
    // carry the gap).
    const mainRowGaps = [
      'keypad-number-editing',
      'keypad-history',
      'keypad-digit-row-789',
      'keypad-digit-row-456',
      'keypad-digit-row-123',
      'keypad-digit-row-last',
    ].map((id) => marginBottomOf(findHostByTestID(renderer.root, id).props.style));
    const mainTotal = 6 * 48 + mainRowGaps.reduce((sum, g) => sum + g, 0);

    const accentGaps = [
      'keypad-op-divide',
      'keypad-op-multiply',
      'keypad-op-subtract',
      'keypad-op-add',
      'keypad-paren',
      'keypad-equals',
    ].map((id) => marginBottomOf(findHostByTestID(renderer.root, id).props.style));
    const accentTotal = 6 * 48 + accentGaps.reduce((sum, g) => sum + g, 0);

    expect(mainTotal).toBe(accentTotal);
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

  test('when disabled, turn the same grey as a disabled digit key rather than fading teal', () => {
    act(() => {
      const result = addNumberNode({ x: 0, y: 0 }, '3');
      appendEqualsNode(result);
      const r = Object.values(useDocumentStore.getState().document.nodes).find(
        (node) => node.kind === 'result',
      )!;
      selectNode(r.id);
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    const decimal = findHostByTestID(renderer.root, 'keypad-decimal');
    const sign = findHostByTestID(renderer.root, 'keypad-sign');
    const zero = findHostByTestID(renderer.root, 'keypad-digit-0');
    // Same swapped-to-grey background as `0`, not a faded version of the teal fill.
    expect(decimal.props.style.backgroundColor).toBe(zero.props.style.backgroundColor);
    expect(sign.props.style.backgroundColor).toBe(zero.props.style.backgroundColor);
    expect(decimal.props.style.backgroundColor).not.toBe(rolePalette.number.fill);
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
    // `Create link` follows the same §8.7-continuation carve-out as operators — a
    // group containing a result can link that result (§8.6).
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBeFalsy();
  });
});

describe('= key disables once its chain already has an equals (§9)', () => {
  test('selecting any member of an already-`=`\'d chain disables keypad-equals', () => {
    let one!: string;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '1');
      const built = appendOperatorAndNumber(a, '+');
      setNodeRaw(built.numberId, '2');
      appendEqualsNode(built.numberId);
      one = a;
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
      selectNode(one);
    });

    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBe(true);
  });

  test('a chain with no equals yet, or nothing selected, leaves keypad-equals enabled', () => {
    let a!: string;
    act(() => {
      a = addNumberNode({ x: 0, y: 0 }, '1');
      addOperatorNode({ x: 50, y: 0 }, '+');
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBeFalsy();

    act(() => {
      selectNode(a);
    });
    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBeFalsy();
  });
});

describe('selecting = only leaves the operator keys active (§9)', () => {
  test('digits, decimal/+/-, (), Create link, and = itself all disable; operators stay enabled', () => {
    let equalsId!: string;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '1');
      const built = appendOperatorAndNumber(a, '+');
      setNodeRaw(built.numberId, '2');
      equalsId = appendEqualsNode(built.numberId);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
      selectNode(equalsId);
    });

    expect(findByTestID(renderer, 'keypad-digit-7').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-decimal').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-sign').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-paren').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-link').props.disabled).toBe(true);
    expect(findByTestID(renderer, 'keypad-equals').props.disabled).toBe(true);
    // The one exception: an operator converts = in place (§9), so the operator column
    // stays active rather than joining the rest of the keypad in disabling.
    expect(findByTestID(renderer, 'keypad-op-add').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-op-multiply').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-op-subtract').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-op-divide').props.disabled).toBeFalsy();
    // Backspace/undo/redo stay live, same as every other locked-data-entry state.
    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();
    expect(findByTestID(renderer, 'keypad-undo').props.disabled).toBeFalsy();
  });
});

describe('backspace disables on a selected result (§9)', () => {
  test('a single selected result disables keypad-backspace', () => {
    const resultChain = 'c_backspace_result';
    const resultId = 'n_backspace_result';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains[resultChain] = { id: resultChain, members: [], anchor: { x: 0, y: 0 } };
        draft.nodes[resultId] = {
          id: resultId,
          kind: 'result',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: Date.now(),
          sourceChainId: resultChain,
        };
      });
      selectNode(resultId);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBe(true);
  });

  test('a selected number or nothing selected leaves keypad-backspace enabled', () => {
    let a!: string;
    act(() => {
      a = addNumberNode({ x: 0, y: 0 }, '3');
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });
    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();

    act(() => {
      selectNode(a);
    });
    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();
  });

  test('a Select-group containing a result still enables backspace — deletes the whole group', () => {
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

    expect(findByTestID(renderer, 'keypad-backspace').props.disabled).toBeFalsy();
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

describe('operator/() keys tint to Create link\'s blue when a press creates a new link (§8.7)', () => {
  function operatorKeys(renderer: ReactTestRenderer) {
    return ['keypad-op-divide', 'keypad-op-multiply', 'keypad-op-subtract', 'keypad-op-add'].map(
      (id) => findHostByTestID(renderer.root, id),
    );
  }

  test('a selected result tints every operator key and ()', () => {
    const resultChain = 'c_link_tint_result';
    const resultId = 'n_link_tint_result';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.chains[resultChain] = { id: resultChain, members: [], anchor: { x: 0, y: 0 } };
        draft.nodes[resultId] = {
          id: resultId,
          kind: 'result',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: Date.now(),
          sourceChainId: resultChain,
        };
      });
      selectNode(resultId);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: identityHues[0] });
    }
    expect(findHostByTestID(renderer.root, 'keypad-paren').props.style).toMatchObject({
      backgroundColor: identityHues[0],
    });
  });

  test('a selected free (unedited) number tints the operator keys but not ()', () => {
    let a!: string;
    act(() => {
      a = addNumberNode({ x: 0, y: 0 }, '5');
      selectNode(a);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: identityHues[0] });
    }
    // `()` on a free number groups within its own new chain, not a link — stays amber.
    expect(findHostByTestID(renderer.root, 'keypad-paren').props.style).toMatchObject({
      backgroundColor: rolePalette.operator.fill,
    });
  });

  test('a number being edited is not a link target — operator keys stay amber', () => {
    let a!: string;
    act(() => {
      a = addNumberNode({ x: 0, y: 0 }, '5');
      editNumberNode(a);
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: rolePalette.operator.fill });
    }
  });

  test('a number already in a chain extends in place — operator keys stay amber', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '1');
      const built = appendOperatorAndNumber(a, '+');
      setNodeRaw(built.numberId, '2');
      selectNode(a); // '1' is a chain member, not a free value.
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: rolePalette.operator.fill });
    }
  });

  test('a selected live reference extends in place — operator keys stay amber', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      const a = addNumberNode({ x: 0, y: 0 }, '5');
      const refId = createLinkToValue(a);
      selectNode(refId);
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: rolePalette.operator.fill });
    }
  });

  test('group mode with a result present tints the operator keys too', () => {
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

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: identityHues[0] });
    }
  });

  test('nothing selected — operator keys and () stay the ordinary amber', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const key of operatorKeys(renderer)) {
      expect(key.props.style).toMatchObject({ backgroundColor: rolePalette.operator.fill });
    }
    expect(findHostByTestID(renderer.root, 'keypad-paren').props.style).toMatchObject({
      backgroundColor: rolePalette.operator.fill,
    });
  });
});
