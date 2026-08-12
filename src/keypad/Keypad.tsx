// The on-screen keypad. See docs/ARCHITECTURE.md §8.5 (the regions table this mirrors),
// §1.3 (Tydlig's keypad, which this is modelled on), §1.2 (tokens) and decision #15.
//
// This component only renders keys and reports which one was pressed via `onKeyPress` —
// it does not itself create or edit nodes. `onKeyPress` is wired to `keymap.ts`'s
// `dispatchEditorCommand` (P2.8), the same function the hardware-keyboard listener in
// `AppShell.tsx` calls, so on-screen and hardware input can't diverge.
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import ArrowUturnLeftIcon from 'react-native-heroicons/outline/ArrowUturnLeftIcon';
import ArrowUturnRightIcon from 'react-native-heroicons/outline/ArrowUturnRightIcon';
import BackspaceIcon from 'react-native-heroicons/outline/BackspaceIcon';
import ChevronDownIcon from 'react-native-heroicons/outline/ChevronDownIcon';
import LinkIcon from 'react-native-heroicons/outline/LinkIcon';
import { decimalSeparatorFor } from '../engine/format';
import { glyphColor, identityHues, rolePalette } from '../ui/tokens';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { clearDocument } from '../store/commands';
import { Digit, KeypadKey, groupContainsResult } from './keymap';

export type { Digit, KeypadKey } from './keymap';
export { groupContainsResult } from './keymap';

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
  const groupSelectedIds = useUiStore((state) => state.groupSelectedIds);
  const allSelected = useUiStore((state) => state.allSelected);
  // Empty-canvas gate for the Clear all mode-strip button — disabled when there
  // is nothing to wipe, so the affordance does not invite a no-op confirm.
  const documentEmpty = useDocumentStore((state) => {
    const { nodes, chains } = state.document;
    return Object.keys(nodes).length === 0 && Object.keys(chains).length === 0;
  });
  const nodes = useDocumentStore((state) => state.document.nodes);
  // Select all (§8.6): data-entry keys have no single target — gray them out.
  // Mode strip (and hardware undo/redo) stay available.
  const dataEntryLocked = allSelected;
  // Results, operators, and linked cells are not number-edit targets — digit keys
  // would otherwise no-op silently (results) or append at chain end (operators /
  // references). Operators on a result/reference/number still continue (§8.7).
  const selectedNodeId = useUiStore((state) => state.selectedNodeId);
  const selectedKind = useDocumentStore((state) =>
    selectedNodeId ? state.document.nodes[selectedNodeId]?.kind : undefined,
  );
  const selectionBlocksDigits =
    selectedKind === 'reference' ||
    selectedKind === 'result' ||
    selectedKind === 'operator';
  // Number-editing row (., +/-, ()) is for operands; hide it while an operator
  // is selected (operator keys still replace the symbol).
  const selectionBlocksNumberEditing = selectedKind === 'operator';

  if (!visible) {
    return null;
  }

  // §8.5 group mode: Select group disables everything except history (undo /
  // redo / backspace). When the group includes a result, operators stay enabled
  // for §8.7 continuation; equals and every digit/editing key stay disabled.
  const groupMode = groupSelectedIds.size > 0 && !dataEntryLocked;
  const numberKeysDisabled =
    dataEntryLocked || groupMode || selectionBlocksDigits;
  const numberEditingKeysDisabled =
    dataEntryLocked || groupMode || selectionBlocksNumberEditing;
  const operatorsEnabled =
    !dataEntryLocked && (!groupMode || groupContainsResult(groupSelectedIds, nodes));
  // §8.6 `Create link` keypad button: enabled only for a selected number or result —
  // narrower than the context-menu action of the same name, which also allows a live
  // reference (there is no "already-a-link" source to re-link here).
  const canCreateLink =
    !dataEntryLocked &&
    !groupMode &&
    (selectedKind === 'number' || selectedKind === 'result');

  function press(key: KeypadKey) {
    if (dataEntryLocked) return;
    onKeyPress?.(key);
  }

  // Only confirming clears (decision #15) - cancel just closes the prompt and
  // leaves the document exactly as it was. Shared by the mode-strip Clear all
  // button and the swipe-across-backspace gesture.
  function confirmClear() {
    clearDocument();
    dismissClearConfirm();
  }

  const backspaceSwipe = Gesture.Pan()
    .enabled(!dataEntryLocked)
    .onEnd((e) => {
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
        <ModeKey
          label="Dismiss keypad"
          icon={<ChevronDownIcon size={18} color="#333333" />}
          onPress={hideKeypad}
          testID="keypad-mode-dismiss"
        />
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
                  <DigitKey
                    key={value}
                    value={value}
                    disabled={numberKeysDisabled}
                    onPress={() => press({ region: 'digit', value })}
                  />
                ))}
              </View>
            ))}
            {/* `0`'s row: decimal on its left, `+/-` on its right — under `1` and `3`
                respectively, the reference app's bottom-row layout. Both are number-editing
                keys (same `disabled` rule as `()`, which stays below); they just live in
                the digit grid now so they land in this row instead of a dedicated one. */}
            <View style={styles.digitRow}>
              <Key
                label={decimalSeparatorFor(locale)}
                onPress={() => press({ region: 'decimal' })}
                disabled={numberEditingKeysDisabled}
                testID="keypad-decimal"
                style={styles.gridEditingKey}
              />
              <DigitKey
                value="0"
                disabled={numberKeysDisabled}
                onPress={() => press({ region: 'digit', value: '0' })}
              />
              <Key
                label="+/-"
                onPress={() => press({ region: 'sign' })}
                disabled={numberEditingKeysDisabled}
                testID="keypad-sign"
                style={styles.gridEditingKey}
              />
            </View>
          </View>

          <View style={styles.editingRow} testID="keypad-number-editing">
            {/* §8.6 `Create link`: takes the slot `.` used to occupy in this row. Enabled
                only for a selected number or result (`canCreateLink`); creates a free
                reference near the selected value, same placement as §8.7 continuation
                but without the operator/empty-number (`createLinkToValue`). */}
            <Key
              label="Create link"
              icon={<LinkIcon size={20} color={glyphColor} />}
              onPress={() => press({ region: 'createLink' })}
              disabled={!canCreateLink}
              testID="keypad-link"
              style={styles.linkKey}
            />
            {/* Single `()` key (§8.5): same cell size as `Create link` above.
                Side is resolved in `dispatchEditorCommand` from chain depth so one
                tap opens or closes as appropriate. */}
            <Key
              label="()"
              onPress={() => press({ region: 'paren' })}
              disabled={numberEditingKeysDisabled}
              testID="keypad-paren"
            />
          </View>

          <View style={styles.historyRow} testID="keypad-history">
            <Key
              label="Undo"
              icon={<ArrowUturnLeftIcon size={22} color="#333333" />}
              onPress={() => press({ region: 'undo' })}
              testID="keypad-undo"
            />
            <Key
              label="Redo"
              icon={<ArrowUturnRightIcon size={22} color="#333333" />}
              onPress={() => press({ region: 'redo' })}
              testID="keypad-redo"
            />
            {/* Swipe-across-backspace clear gesture stays on this key wherever it sits (§8.5). */}
            <GestureDetector gesture={backspaceSwipe}>
              <Key
                label="Backspace"
                icon={<BackspaceIcon size={22} color="#333333" />}
                onPress={() => press({ region: 'backspace' })}
                disabled={dataEntryLocked}
                testID="keypad-backspace"
              />
            </GestureDetector>
          </View>
        </View>

        <View style={styles.accentColumn} testID="keypad-operators">
          <OperatorKey
            label="÷"
            onPress={() => press({ region: 'operator', op: '÷' })}
            testID="keypad-op-divide"
            disabled={!operatorsEnabled}
          />
          <OperatorKey
            label="×"
            onPress={() => press({ region: 'operator', op: '×' })}
            testID="keypad-op-multiply"
            disabled={!operatorsEnabled}
          />
          <OperatorKey
            label="−"
            onPress={() => press({ region: 'operator', op: '-' })}
            testID="keypad-op-subtract"
            disabled={!operatorsEnabled}
          />
          <OperatorKey
            label="+"
            onPress={() => press({ region: 'operator', op: '+' })}
            testID="keypad-op-add"
            disabled={!operatorsEnabled}
          />
          <EqualsKey
            onPress={() => press({ region: 'equals' })}
            testID="keypad-equals"
            disabled={dataEntryLocked || groupMode}
          />
        </View>
      </View>
    </View>
  );
}

interface KeyProps {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  /** When set, rendered instead of the label text; `label` stays the a11y name
   *  (same pattern as ModeKey's Heroicons slot). */
  icon?: ReactNode;
  /** Per-instance overrides layered after `styles.key` / `styles.keyDisabled` — e.g.
   *  `gridEditingKey`'s taller height to match the digit row it now sits in, or
   *  `linkKey`'s blue fill. */
  style?: StyleProp<ViewStyle>;
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

function Key({ label, icon, onPress, testID, disabled, style }: KeyProps) {
  return (
    <TouchableOpacity
      style={[styles.key, disabled && styles.keyDisabled, style]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={icon ? label : undefined}
      accessibilityState={{ disabled: !!disabled }}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      {icon ?? (
        <Text style={[styles.neutralKeyLabel, disabled && styles.keyLabelDisabled]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function DigitKey({
  value,
  onPress,
  disabled,
}: {
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.digitKey, disabled && styles.digitKeyDisabled]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={`keypad-digit-${value}`}
      accessibilityState={{ disabled: !!disabled }}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={[styles.keyLabel, disabled && styles.digitKeyLabelDisabled]}>{value}</Text>
    </TouchableOpacity>
  );
}

function OperatorKey({ label, onPress, testID, disabled }: KeyProps) {
  return (
    <TouchableOpacity
      style={[styles.key, styles.accentKey, disabled && styles.keyDisabled]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityState={{ disabled: !!disabled }}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={[styles.accentKeyLabel, disabled && styles.keyLabelDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

function EqualsKey({
  onPress,
  testID,
  disabled,
}: {
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.key, styles.equalsKey, disabled && styles.keyDisabled]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityState={{ disabled: !!disabled }}
      {...preventFocusSteal}
      {...skipTabOrder}
    >
      <Text style={[styles.accentKeyLabel, disabled && styles.keyLabelDisabled]}>=</Text>
    </TouchableOpacity>
  );
}

function ModeKey({
  label,
  icon,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  /** When set, rendered instead of the label text; `label` stays the a11y name. */
  icon?: ReactNode;
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
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      {icon ?? (
        <Text style={[styles.modeKeyLabel, disabled && styles.modeKeyLabelDisabled]}>{label}</Text>
      )}
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
  digitKey: {
    flex: 1,
    height: 48,
    marginHorizontal: KEY_GAP / 2,
    borderRadius: 8,
    backgroundColor: rolePalette.number.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitKeyDisabled: {
    backgroundColor: '#DADADA',
    opacity: 0.55,
  },
  digitKeyLabelDisabled: {
    color: '#888888',
  },
  editingRow: {
    flexDirection: 'row',
    marginBottom: KEY_GAP,
  },
  historyRow: {
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
  keyDisabled: {
    opacity: 0.35,
  },
  keyLabel: {
    color: glyphColor,
    fontSize: 20,
    fontWeight: '400',
  },
  keyLabelDisabled: {
    color: '#B3B3B3',
  },
  /** Decimal / `+/-` now live in the digit grid's `0` row (§8.5): match that row's
   *  48px cell height so the row reads as one aligned line instead of the generic
   *  44px `key` height stepping down. Horizontal margin is already shared with `key`. */
  gridEditingKey: {
    height: 48,
  },
  /** §8.6 `Create link`: a blue distinct from every role fill (number/operator/equals/
   *  result) and from the identity hues it might otherwise collide with in meaning —
   *  reuses `identityHues[0]`, the palette's own primary blue, already checked for
   *  deuteranopia/protanopia (`paletteAccessibility.ts`) rather than inventing a new one. */
  linkKey: {
    backgroundColor: identityHues[0],
  },
  neutralKeyLabel: {
    color: '#333333',
    fontSize: 18,
    fontWeight: '400',
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
    fontWeight: '400',
  },
  equalsKey: {
    backgroundColor: rolePalette.equals.fill,
    marginHorizontal: 0,
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
