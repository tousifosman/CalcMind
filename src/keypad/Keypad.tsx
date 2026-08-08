// The on-screen keypad. See docs/ARCHITECTURE.md §8.5 (the regions table this mirrors),
// §1.3 (Tydlig's keypad, which this is modelled on), §1.2 (tokens) and decision #15.
//
// This component only renders keys and reports which one was pressed via `onKeyPress` —
// it does not itself create or edit nodes. `onKeyPress` is wired to `keymap.ts`'s
// `dispatchEditorCommand` (P2.8), the same function the hardware-keyboard listener in
// `AppShell.tsx` calls, so on-screen and hardware input can't diverge.
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { decimalSeparatorFor } from '../engine/format';
import { glyphColor, rolePalette } from '../ui/tokens';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { clearDocument } from '../store/commands';
import { Digit, KeypadKey } from './keymap';

export type { Digit, KeypadKey } from './keymap';

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

/** How far a pan across the backspace key has to travel, and how much more
 *  horizontal than vertical it has to be, before it reads as Tydlig's
 *  swipe-to-clear gesture (§8.5) rather than an accidental drag or a vertical
 *  scroll. Screen pixels, not world units - this is a keypad-local gesture,
 *  not the canvas geometry §7 requires zoom-independent thresholds for. */
const CLEAR_SWIPE_MIN_DISTANCE = 40;
const CLEAR_SWIPE_MIN_HORIZONTAL_DOMINANCE = 2;

/** Pure so it is testable without a real gesture runtime (the jest mock for
 *  react-native-gesture-handler drops gesture callbacks - see its header
 *  comment). Exported for that reason. */
export function isClearSwipe(translationX: number, translationY: number): boolean {
  const dx = Math.abs(translationX);
  const dy = Math.abs(translationY);
  return dx >= CLEAR_SWIPE_MIN_DISTANCE && dx >= dy * CLEAR_SWIPE_MIN_HORIZONTAL_DOMINANCE;
}

// Web: data-entry keys already have hardware equivalents (P7.2), so keep them out of
// Tab order — otherwise Tab walks ~20 identical-looking buttons before reaching the
// mode strip / confirm actions. Native ignores tabIndex.
const skipTabOrder = Platform.OS === 'web' ? ({ tabIndex: -1 } as object) : {};

export function Keypad({ locale = 'en-US', onKeyPress }: KeypadProps) {
  const visible = useUiStore((state) => state.keypadVisible);
  const hideKeypad = useUiStore((state) => state.hideKeypad);
  const clearConfirmVisible = useUiStore((state) => state.clearConfirmVisible);
  const requestClearConfirm = useUiStore((state) => state.requestClearConfirm);
  const dismissClearConfirm = useUiStore((state) => state.dismissClearConfirm);
  // Empty-canvas gate for the Clear all mode-strip button — disabled when there
  // is nothing to wipe, so the affordance does not invite a no-op confirm.
  const documentEmpty = useDocumentStore((state) => {
    const { nodes, chains } = state.document;
    return Object.keys(nodes).length === 0 && Object.keys(chains).length === 0;
  });

  if (!visible) {
    return null;
  }

  function press(key: KeypadKey) {
    onKeyPress?.(key);
  }

  // Only confirming clears (decision #15) - cancel just closes the prompt and
  // leaves the document exactly as it was. Shared by the mode-strip Clear all
  // button and the swipe-across-backspace gesture.
  function confirmClear() {
    clearDocument();
    dismissClearConfirm();
  }

  const backspaceSwipe = Gesture.Pan().onEnd((e) => {
    'worklet';
    if (isClearSwipe(e.translationX, e.translationY)) {
      runOnJS(requestClearConfirm)();
    }
  });

  // While the wipe confirm is up, hide the keypad chrome (mode strip + keys) so
  // the dialog is the only bottom UI — keys would only distract from Cancel/Clear.
  if (clearConfirmVisible) {
    return (
      <View style={styles.container} testID="keypad">
        <View style={styles.confirmOverlay} testID="keypad-clear-confirm">
          <Text style={styles.confirmMessage}>Clear the whole canvas?</Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={styles.confirmCancel}
              onPress={dismissClearConfirm}
              testID="keypad-clear-confirm-cancel"
            >
              <Text style={styles.confirmCancelLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmClear}
              onPress={confirmClear}
              testID="keypad-clear-confirm-clear"
            >
              <Text style={styles.confirmClearLabel}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
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
        {/* Discoverable clear (P7.8). Same confirm gate as swipe-across-backspace
            (decision #15); disabled on an empty canvas so the affordance does not
            invite a no-op confirm. */}
        <ModeKey
          label="Clear all"
          onPress={requestClearConfirm}
          disabled={documentEmpty}
          testID="keypad-mode-clear-all"
        />
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
            <GestureDetector gesture={backspaceSwipe}>
              <Key label="⌫" onPress={() => press({ region: 'backspace' })} testID="keypad-backspace" />
            </GestureDetector>
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

// Web only: a plain TouchableOpacity press starts with a mousedown, which blurs whatever
// TextInput currently has focus *before* onPress fires - for a data-entry key that's the
// number node this press is meant to act on (P2.8, §8.5's "acts on the selected node"). A
// blur runs NumberNode's onBlur (deselectNode), so by the time onPress ran, dispatch was
// already seeing "nothing selected" - verified in a real browser: every key after the first
// landed as its own free node instead of continuing the one being edited. `preventDefault` on
// mousedown is the standard fix for an on-screen keyboard's keys not stealing focus from the
// field they edit; unrecognised on native, where TouchableOpacity has no mouse events to steal
// focus with.
const preventFocusSteal = { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() };

function Key({ label, onPress, testID }: KeyProps) {
  return (
    <TouchableOpacity
      style={styles.key}
      onPress={onPress}
      testID={testID}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={styles.neutralKeyLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function DigitKey({ value, onPress }: { value: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.digitKey}
      onPress={onPress}
      testID={`keypad-digit-${value}`}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={styles.keyLabel}>{value}</Text>
    </TouchableOpacity>
  );
}

function OperatorKey({ label, onPress, testID }: KeyProps) {
  return (
    <TouchableOpacity
      style={[styles.key, styles.accentKey]}
      onPress={onPress}
      testID={testID}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={styles.accentKeyLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function EqualsKey({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity
      style={[styles.key, styles.equalsKey]}
      onPress={onPress}
      testID={testID}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
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
  confirmOverlay: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADADA',
  },
  confirmMessage: {
    color: '#333333',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  confirmCancel: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: KEY_GAP,
    backgroundColor: '#DADADA',
  },
  confirmCancelLabel: {
    color: '#333333',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmClear: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: rolePalette.operator.fill,
  },
  confirmClearLabel: {
    color: glyphColor,
    fontSize: 14,
    fontWeight: '700',
  },
});
