// The on-screen keypad. See docs/ARCHITECTURE.md §8.5 (the regions table this mirrors),
// §1.3 (Tydlig's keypad, which this is modelled on), §1.2 (tokens) and decision #15.
//
// This component only renders keys and reports which one was pressed via `onKeyPress` —
// it does not itself create or edit nodes. `onKeyPress` is wired to `keymap.ts`'s
// `dispatchEditorCommand` (P2.8), the same function the hardware-keyboard listener in
// `AppShell.tsx` calls, so on-screen and hardware input can't diverge.
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import ArrowUturnLeftIcon from 'react-native-heroicons/outline/ArrowUturnLeftIcon';
import ArrowUturnRightIcon from 'react-native-heroicons/outline/ArrowUturnRightIcon';
import BackspaceIcon from 'react-native-heroicons/outline/BackspaceIcon';
import ChevronDownIcon from 'react-native-heroicons/outline/ChevronDownIcon';
import Cog6ToothIcon from 'react-native-heroicons/outline/Cog6ToothIcon';
import LinkIcon from 'react-native-heroicons/outline/LinkIcon';
import SquaresPlusIcon from 'react-native-heroicons/outline/SquaresPlusIcon';
import PencilSquareIcon from 'react-native-heroicons/outline/PencilSquareIcon';
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
  const openSettings = useUiStore((state) => state.openSettings);
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
  // `()` is for operands; disable it while an operator is selected (operator keys still
  // replace the symbol). Decimal and `+/-` used to share this rule too, but they're number
  // buttons now (`numberKeysDisabled`, below) — a selected result/reference disables them
  // right alongside the digits, not just a selected operator.
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
  // §8.6 `Create link` keypad button: enabled for a selected number, result, or *live*
  // reference — same eligibility as the context-menu action of the same name
  // (`createLinkToValue`) and as `dispatchEditorCommand`'s `createLink` handler. A
  // dangling reference (target gone) does not count: there is nothing live to re-link.
  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : undefined;
  const selectedIsLiveReference =
    selectedNode?.kind === 'reference' && nodes[selectedNode.targetNodeId] !== undefined;
  const canCreateLink =
    !dataEntryLocked &&
    !groupMode &&
    (selectedKind === 'number' || selectedKind === 'result' || selectedIsLiveReference);

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
        {/* Work space (P5) and functions/chart (§10.2, §17.2) have no feature behind them
            yet - all three render disabled rather than functional-looking but inert. Labels
            read "Work space" / "Chart" rather than the underlying Documents/Graph concepts
            they'll eventually open (§12 / §17.2) - user-facing wording, not a rename of the
            feature itself. */}
        <ModeKey label="Work space" disabled testID="keypad-mode-documents" />
        <ModeKey label="ƒ(x)" disabled testID="keypad-mode-functions" />
        <ModeKey label="Chart" disabled testID="keypad-mode-graph" />
        {/* Discoverable clear (P7.8). Same confirm gate as swipe-across-backspace
            (decision #15); disabled on an empty canvas so the affordance does not
            invite a no-op confirm. */}
        <ModeKey
          label="Clear all"
          onPress={requestClearConfirm}
          disabled={documentEmpty}
          testID="keypad-mode-clear-all"
        />
        {/* Icon-only (no text) - opens the settings sheet (§8.5), currently just an About
            row (SettingsSheet.tsx). */}
        <ModeKey
          label="Settings"
          icon={<Cog6ToothIcon size={18} color="#333333" />}
          onPress={openSettings}
          testID="keypad-mode-settings"
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
                respectively, the reference app's bottom-row layout. Both now use
                `numberKeysDisabled` — the same rule the digits use — rather than the looser
                `numberEditingKeysDisabled` (which only blocks while an operator is selected):
                a selected result or linked cell isn't a number-edit target any more than a
                digit is, so decimal / `+/-` disable right alongside `0`. They just live in
                the digit grid now so they land in this row instead of a dedicated one. Same
                fill and label style as `0` when enabled (`rolePalette.number.fill` /
                `keyLabel`, via `gridEditingKey` + `labelStyle`) so the whole row reads as one
                colour rather than `0` standing out from its neighbours — and the same
                `digitKeyDisabled` swap-to-grey when disabled, layered on top of
                `gridEditingKey`/`keyLabel` so it wins over both: `Key`'s own generic
                `keyDisabled` just fades whatever colour is already there (right for the
                accent-coloured keys), which used to leave these two visibly greenish while
                every other number key had already gone flat grey. */}
            <View style={styles.digitRow}>
              <Key
                label={decimalSeparatorFor(locale)}
                onPress={() => press({ region: 'decimal' })}
                disabled={numberKeysDisabled}
                testID="keypad-decimal"
                style={[styles.gridEditingKey, numberKeysDisabled && styles.digitKeyDisabled]}
                labelStyle={[styles.keyLabel, numberKeysDisabled && styles.digitKeyLabelDisabled]}
              />
              <DigitKey
                value="0"
                disabled={numberKeysDisabled}
                onPress={() => press({ region: 'digit', value: '0' })}
              />
              <Key
                label="+/-"
                onPress={() => press({ region: 'sign' })}
                disabled={numberKeysDisabled}
                testID="keypad-sign"
                style={[styles.gridEditingKey, numberKeysDisabled && styles.digitKeyDisabled]}
                labelStyle={[styles.keyLabel, numberKeysDisabled && styles.digitKeyLabelDisabled]}
              />
            </View>
          </View>

          <View style={styles.editingRow} testID="keypad-number-editing">
            {/* §8.6 `Create link`: takes the slot `.` used to occupy in this row. Enabled
                for a selected number, result, or live reference (`canCreateLink`); creates
                a free reference near the selected value, same placement as §8.7
                continuation but without the operator/empty-number (`createLinkToValue`). */}
            <Key
              label="Create link"
              icon={<LinkIcon size={20} color={glyphColor} />}
              onPress={() => press({ region: 'createLink' })}
              disabled={!canCreateLink}
              testID="keypad-link"
              style={styles.linkKey}
            />
            {/* Declared, not yet functional — same "affordance before behaviour" pattern as
                the context menu's `Copy` / canvas menu's `Add number` / `Add graph`. Shares
                `Create link`'s blue fill; behaviour to follow. */}
            <Key
              label="Add components"
              icon={<SquaresPlusIcon size={20} color={glyphColor} />}
              disabled
              testID="keypad-add-components"
              style={styles.linkKey}
            />
            <Key
              label="Notes"
              icon={<PencilSquareIcon size={20} color={glyphColor} />}
              disabled
              testID="keypad-notes"
              style={styles.linkKey}
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
          {/* `()` (§8.5): moved underneath `+` into the accent column, styled as an
              `OperatorKey` — same amber fill and white label as `÷ × − +`. Side is resolved
              in `dispatchEditorCommand` from chain depth so one tap opens or closes as
              appropriate; only its position/colour changed, not its behaviour. */}
          <OperatorKey
            label="()"
            onPress={() => press({ region: 'paren' })}
            disabled={numberEditingKeysDisabled}
            testID="keypad-paren"
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
  /** Omit for a declared-but-not-yet-functional key (always pair with `disabled`, same
   *  as `ModeKey`'s optional `onPress`). */
  onPress?: () => void;
  testID?: string;
  disabled?: boolean;
  /** When set, rendered instead of the label text; `label` stays the a11y name
   *  (same pattern as ModeKey's Heroicons slot). */
  icon?: ReactNode;
  /** Per-instance overrides layered after `styles.key` / `styles.keyDisabled` — e.g.
   *  `gridEditingKey`'s teal fill to match `0`, or `linkKey`'s blue. Every key shares
   *  `key`'s height (§8.5 — see its comment) so rows across the two keypad columns stay
   *  aligned; an override here should not touch `height` without checking that. */
  style?: StyleProp<ViewStyle>;
  /** Per-instance override for the fallback label `Text` (ignored when `icon` is set) —
   *  e.g. `keyLabel` so decimal / `+/-` read white on their teal fill, matching `DigitKey`,
   *  instead of the default dark `neutralKeyLabel`. */
  labelStyle?: StyleProp<TextStyle>;
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

function Key({ label, icon, onPress, testID, disabled, style, labelStyle }: KeyProps) {
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
        <Text
          style={[styles.neutralKeyLabel, disabled && styles.keyLabelDisabled, labelStyle]}
        >
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
  // Placeholder tone, not a finished design pass: a grey with a slight number-teal cast
  // rather than plain neutral grey, so a disabled number key still reads as "this was the
  // teal one" instead of matching every other disabled key exactly. Revisit once the
  // disabled palette gets real design attention.
  digitKeyDisabled: {
    backgroundColor: '#ADD1CD',
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
    // Matches `digitKey`'s height (§8.5): the main column (digit grid + number-editing
    // row + history row) and the accent column (operators + `()` + `=`) both stack six
    // rows now that `()` moved into the accent column, and every row uses the shared
    // `KEY_GAP` bottom margin — so keeping every key the same height is what makes the
    // two columns land on the same six row boundaries instead of drifting apart by a few
    // px per row. Previously 44 vs `digitKey`'s 48, invisible while the columns had
    // different row counts; became a visible misalignment once they matched.
    height: 48,
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
  /** Decimal / `+/-` now live in the digit grid's `0` row (§8.5) and share `0`'s teal fill.
   *  Height and horizontal margin already match `key`'s own — no override needed for those. */
  gridEditingKey: {
    backgroundColor: rolePalette.number.fill,
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
    // Explicit despite matching `key`'s own height — this overrides `key`'s
    // `marginHorizontal` too, and `borderRadius: 8` from `key` still needs to be there in
    // the merged style array. Kept in sync with `key`'s height (see its comment: this is
    // what keeps the accent column's six rows aligned with the main column's six).
    height: 48,
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
