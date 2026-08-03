import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Keypad, KeypadKey } from './Keypad';
import { useUiStore } from '../store/uiStore';

beforeEach(() => {
  act(() => {
    useUiStore.setState({ keypadVisible: true });
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

  test('renders every region from §8.5: digits, number editing, grouping, operators, mode strip', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Keypad />);
    });

    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(findByTestID(renderer, `keypad-digit-${digit}`)).toBeTruthy();
    }
    expect(findByTestID(renderer, 'keypad-decimal')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-sign')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-backspace')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-paren-open')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-paren-close')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-divide')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-multiply')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-subtract')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-op-add')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-equals')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-dismiss')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-documents')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-functions')).toBeTruthy();
    expect(findByTestID(renderer, 'keypad-mode-graph')).toBeTruthy();
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
      findByTestID(renderer, 'keypad-paren-open').props.onPress();
      findByTestID(renderer, 'keypad-backspace').props.onPress();
      findByTestID(renderer, 'keypad-sign').props.onPress();
    });

    expect(presses).toEqual([
      { region: 'digit', value: '7' },
      { region: 'operator', op: '×' },
      { region: 'equals' },
      { region: 'paren', side: 'open' },
      { region: 'backspace' },
      { region: 'sign' },
    ]);
  });
});
