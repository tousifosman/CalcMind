// The on-screen keypad. See docs/ARCHITECTURE.md §8.5 (the regions table this mirrors),
// §1.3 (Tydlig's keypad, which this is modelled on), §1.2 (tokens) and decision #15.
//
// This component only renders keys and reports which one was pressed via `onKeyPress` —
// it does not itself create or edit nodes. That wiring, plus the hardware-keyboard side
// of the same dispatch, is P2.8's job once node commands (P2.3) and selection (P2.6)
// exist to give key presses something to act on.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { decimalSeparatorFor } from '../engine/format';
import { glyphColor, rolePalette } from '../ui/tokens';
import { useUiStore } from '../store/uiStore';

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type KeypadKey =
  | { region: 'digit'; value: Digit }
  | { region: 'decimal' }
  | { region: 'sign' }
  | { region: 'backspace' }
  | { region: 'paren'; side: 'open' | 'close' }
  | { region: 'operator'; op: '+' | '-' | '×' | '÷' }
  | { region: 'equals' };

interface KeypadProps {
  /** BCP-47 locale, used only to show the decimal key's glyph (§10.3); the key still
   *  reports a canonical '.' via onKeyPress. */
  locale?: string;
  onKeyPress?: (key: KeypadKey) => void;
}

const DIGIT_ROWS: Digit[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];

export function Keypad({ locale = 'en-US', onKeyPress }: KeypadProps) {
  const visible = useUiStore((state) => state.keypadVisible);
  const hideKeypad = useUiStore((state) => state.hideKeypad);

  if (!visible) {
    return null;
  }

  function press(key: KeypadKey) {
    onKeyPress?.(key);
  }

  return (
    <View style={styles.container} testID="keypad">
      <View style={styles.modeStrip}>
        <ModeKey label="⌄" onPress={hideKeypad} testID="keypad-mode-dismiss" />
        {/* Documents (P5) and functions/graph (§10.2, §17.2) have no feature behind them
            yet - all three render disabled rather than functional-looking but inert. */}
        <ModeKey label="Documents" disabled testID="keypad-mode-documents" />
        <ModeKey label="ƒ(x)" disabled testID="keypad-mode-functions" />
        <ModeKey label="Graph" disabled testID="keypad-mode-graph" />
      </View>

      <View style={styles.body}>
        <View style={styles.mainColumn}>
          <View style={styles.digitGrid} testID="keypad-digits">
            {DIGIT_ROWS.map((row) => (
              <View style={styles.digitRow} key={row.join('')}>
                {row.map((value) => (
                  <DigitKey key={value} value={value} onPress={() => press({ region: 'digit', value })} />
                ))}
              </View>
            ))}
            <View style={styles.digitRow}>
              <View style={styles.digitSpacer} />
              <DigitKey value="0" onPress={() => press({ region: 'digit', value: '0' })} />
              <View style={styles.digitSpacer} />
            </View>
          </View>

          <View style={styles.editingRow} testID="keypad-number-editing">
            <Key
              label={decimalSeparatorFor(locale)}
              onPress={() => press({ region: 'decimal' })}
              testID="keypad-decimal"
            />
            <Key label="+/-" onPress={() => press({ region: 'sign' })} testID="keypad-sign" />
            <Key label="⌫" onPress={() => press({ region: 'backspace' })} testID="keypad-backspace" />
          </View>

          <View style={styles.groupingRow} testID="keypad-grouping">
            <Key label="(" onPress={() => press({ region: 'paren', side: 'open' })} testID="keypad-paren-open" />
            <Key label=")" onPress={() => press({ region: 'paren', side: 'close' })} testID="keypad-paren-close" />
          </View>
        </View>

        <View style={styles.accentColumn} testID="keypad-operators">
          <OperatorKey label="÷" onPress={() => press({ region: 'operator', op: '÷' })} testID="keypad-op-divide" />
          <OperatorKey label="×" onPress={() => press({ region: 'operator', op: '×' })} testID="keypad-op-multiply" />
          <OperatorKey label="−" onPress={() => press({ region: 'operator', op: '-' })} testID="keypad-op-subtract" />
          <OperatorKey label="+" onPress={() => press({ region: 'operator', op: '+' })} testID="keypad-op-add" />
          <EqualsKey onPress={() => press({ region: 'equals' })} testID="keypad-equals" />
        </View>
      </View>
    </View>
  );
}

interface KeyProps {
  label: string;
  onPress: () => void;
  testID?: string;
}

function Key({ label, onPress, testID }: KeyProps) {
  return (
    <TouchableOpacity style={styles.key} onPress={onPress} testID={testID}>
      <Text style={styles.neutralKeyLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function DigitKey({ value, onPress }: { value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.digitKey} onPress={onPress} testID={`keypad-digit-${value}`}>
      <Text style={styles.keyLabel}>{value}</Text>
    </TouchableOpacity>
  );
}

function OperatorKey({ label, onPress, testID }: KeyProps) {
  return (
    <TouchableOpacity style={[styles.key, styles.accentKey]} onPress={onPress} testID={testID}>
      <Text style={styles.accentKeyLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function EqualsKey({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={[styles.key, styles.equalsKey]} onPress={onPress} testID={testID}>
      <Text style={styles.accentKeyLabel}>=</Text>
    </TouchableOpacity>
  );
}

function ModeKey({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.modeKey}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[styles.modeKeyLabel, disabled && styles.modeKeyLabelDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

const KEY_GAP = 6;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F2F2F2',
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  modeStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  modeKey: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  modeKeyLabel: {
    color: '#333333',
    fontSize: 13,
    fontWeight: '600',
  },
  modeKeyLabelDisabled: {
    color: '#B3B3B3',
  },
  body: {
    flexDirection: 'row',
  },
  mainColumn: {
    flex: 3,
  },
  digitGrid: {
    flexDirection: 'column',
  },
  digitRow: {
    flexDirection: 'row',
    marginBottom: KEY_GAP,
  },
  digitSpacer: {
    flex: 1,
    marginHorizontal: KEY_GAP / 2,
  },
  digitKey: {
    flex: 1,
    height: 48,
    marginHorizontal: KEY_GAP / 2,
    borderRadius: 8,
    backgroundColor: rolePalette.number.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editingRow: {
    flexDirection: 'row',
    marginBottom: KEY_GAP,
  },
  groupingRow: {
    flexDirection: 'row',
  },
  key: {
    flex: 1,
    height: 44,
    marginHorizontal: KEY_GAP / 2,
    borderRadius: 8,
    backgroundColor: '#DADADA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: glyphColor,
    fontSize: 20,
    fontWeight: '700',
  },
  neutralKeyLabel: {
    color: '#333333',
    fontSize: 18,
    fontWeight: '700',
  },
  accentColumn: {
    flex: 1,
    marginLeft: KEY_GAP,
  },
  accentKey: {
    height: 44,
    marginHorizontal: 0,
    marginBottom: KEY_GAP,
    backgroundColor: rolePalette.operator.fill,
  },
  accentKeyLabel: {
    color: glyphColor,
    fontSize: 20,
    fontWeight: '700',
  },
  equalsKey: {
    backgroundColor: rolePalette.equals.fill,
    marginBottom: 0,
  },
});
