// The number cell (§1.1, §6). Displays `raw` through the locale display layer (§10.3/P2.1) -
// storage stays canonical, only this render step ever formats it for a human. When selected
// as the current edit target (§8.6, P2.6) it swaps its `Text` for a `TextInput` showing the
// same locale-formatted string: `formatForDisplay` is documented as live-typing-safe for
// exactly this reason, and going through it (rather than raw) is what keeps the round trip
// through `parseUserInput` an identity (P2.1's property test).
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { useUiStore } from '../store/uiStore';
import { deselectNode, setNodeRaw, finishEditingLabel, setNodeLabel } from '../store/commands';
import { formatForDisplay, parseUserInput } from '../engine/format';
import { widthOf } from '../chains/measure';
import { rolePalette, glyphColor, nodeHeightFor } from '../ui/tokens';
import { getDeviceLocale } from '../ui/locale';
import { commandFromHardwareKey, dispatchEditorCommand } from '../keypad/keymap';
import { Cell, useGlyphTextStyle } from './Cell';
import { useSourceIdentityHue } from './useIdentityHue';
import { useNodeSelected, useNodeGroupSelected } from './useNodeSelected';
import { useGroupPosition } from './useGroupPosition';
import { usePreferencesStore } from '../store/preferencesStore';
import { useCanvasViewportOptional } from '../canvas/ViewportContext';

interface NumberNodeProps {
  id: NodeId;
}

function NumberNodeComponent({ id }: NumberNodeProps) {
  const node = useNode(id);
  const isEditing = useUiStore((state) => state.editingNodeId === id);
  const isEditingLabel = useUiStore((state) => state.editingLabelNodeId === id);
  const selected = useNodeSelected(id);
  const groupSelected = useNodeGroupSelected(id);
  const identityHue = useSourceIdentityHue(id);
  const groupPosition = useGroupPosition(id, node?.chainId ?? null);
  const inputRef = useRef<TextInput>(null);

  // Web only, same trade as Canvas.tsx's onWheel and AppShell's keydown listener (no DOM lib
  // in this project's tsconfig). react-native-gesture-handler's web backend treats a bubbling
  // 'Enter' or ' ' keydown reaching a GestureDetector-wrapped view as that gesture's keyboard
  // activation equivalent (its KeyboardEventManager listens for keydown natively on the
  // gesture's own view, regardless of what's actually focused) - so typing Enter into this
  // TextInput, nested inside Canvas's GestureDetector, was completing Canvas's Tap gesture as
  // a side effect and leaving a stray free number node on the canvas underneath, verified in a
  // real browser. React's onKeyPress below can't prevent it: React delegates every synthetic
  // event to the DOM root, so it only runs once the native event has already bubbled past
  // Canvas's ancestor listener. A raw listener on the actual input node - reached via `ref`,
  // since react-native-web forwards a TextInput ref straight to its host <input> - runs before
  // that bubbling starts, so it's the only place that can stop it in time. Enter is dispatched
  // from here rather than the onKeyPress handler below for the same reason: once propagation
  // is stopped, React's own onKeyPress for this same keystroke will never fire. F9 (sign) is
  // handled here too — onKeyPress only fires for printable keys (P7.2).
  useEffect(() => {
    if (Platform.OS !== 'web' || !isEditing) return;
    // No DOM lib in this project's tsconfig (a bare RN app, per AGENTS.md) - `any` here is the
    // same trade Canvas.tsx's onWheel and AppShell's window keydown listener already make.
    const inputNode: any = inputRef.current;
    if (!inputNode || typeof inputNode.addEventListener !== 'function') return;

    // `autoFocus` (below) becomes a literal HTML `autofocus` attribute on web, and the
    // browser's own autofocus algorithm scrolls its nearest scrollable ancestor to bring
    // the newly-focused input into view — here, that's the whole app's root container
    // (`body`/`#root`, `web/index.html`), so a cell added near the canvas edge dragged
    // the *entire* screen, keypad included, rather than leaving the keypad fixed and
    // letting only the canvas itself account for the cell's position. Reported live: the
    // keypad visibly shifted on every off-screen add/edit. Calling `.focus()` ourselves
    // with `preventScroll: true` is the one thing that suppresses that browser-native
    // scroll — there's no prop for it, `autoFocus` itself doesn't take options.
    if (typeof inputNode.focus === 'function') {
      inputNode.focus({ preventScroll: true });
    }

    function onNativeKeyDown(e: any): void {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          dispatchEditorCommand({ region: 'equals' });
        }
        return;
      }
      // P7.2: F9 is the non-printable hardware equivalent of keypad +/-. onKeyPress
      // never sees it (react-native-web only synthesises printable keys), so handle
      // it on the raw listener alongside Enter.
      if (e.key === 'F9') {
        e.preventDefault();
        e.stopPropagation();
        dispatchEditorCommand({ region: 'sign' });
      }
    }
    inputNode.addEventListener('keydown', onNativeKeyDown);
    return () => inputNode.removeEventListener('keydown', onNativeKeyDown);
  }, [isEditing]);

  const glyphTextStyle = useGlyphTextStyle();
  const fontSize = usePreferencesStore((s) => s.numeralFontSize);

  // §7 auto-pan-to-edited-cell (P7 follow-up, §12.5 opt-out): a cell entering edit mode
  // (added or typed into) pans the canvas to keep it clear of the visible edge, with
  // padding. This is a different fix from the `preventScroll` effect above — that one
  // stops the *keypad* from moving; this is what actually keeps the edited cell in view,
  // which the browser's old accidental autoFocus-scroll used to do as an unintended side
  // effect before that fix removed it. `useCanvasViewportOptional` (not the throwing
  // `useCanvasViewport`) so this stays a no-op rather than a crash for every component
  // spec that renders `NumberNode` standalone, without mounting `Canvas` — most of them.
  // Re-runs on `node` (not narrowed to `numberNode`, which isn't in scope until after the
  // early return below - hooks must stay unconditional) so both entering edit mode and
  // growing while being typed into (which can push a chain further past the edge without
  // moving this cell's own `position`) keep re-checking.
  const canvasViewport = useCanvasViewportOptional();
  const autoPanEnabled = usePreferencesStore((s) => s.autoPanToEditedCell);
  useEffect(() => {
    if (!isEditing || !autoPanEnabled || !canvasViewport || !node || node.kind !== 'number') {
      return;
    }
    // Web only: blur this input for the pan's duration, refocusing (still `preventScroll`,
    // same as the effect above) once it settles. Reported live on a real device: the pan
    // itself was enough to bring the keyboard-drags-the-page bug back, even though nothing
    // here calls `.focus()` or `scrollIntoView()` again - WebKit can re-trigger its own
    // "scroll the focused control into view" heuristic purely from a *focused* element's
    // bounding rect changing, including via a CSS transform, independent of any new focus
    // call (this is a different trigger than the one-time `autoFocus` HTML-attribute case
    // the effect above already covers). Losing DOM focus for ~`AUTO_PAN_DURATION_MS` costs
    // nothing the on-screen keypad needs — it dispatches through `onKeyPress` regardless of
    // this input's focus state — only a hardware key pressed mid-pan would be missed, and
    // even then only in a JS-side `pointerEvents="none"` field like this one, not by having
    // no visible caret.
    const inputNode: any =
      Platform.OS === 'web' && inputRef.current ? (inputRef.current as any) : null;
    const canBlurFocus =
      inputNode &&
      typeof inputNode.blur === 'function' &&
      typeof inputNode.focus === 'function';
    canvasViewport.panIntoView(
      {
        x: node.position.x,
        y: node.position.y,
        width: widthOf(node, getDeviceLocale(), fontSize),
        height: nodeHeightFor(fontSize),
      },
      canBlurFocus
        ? {
            onWillPan: () => inputNode.blur(),
            onSettled: () => inputNode.focus({ preventScroll: true }),
          }
        : undefined,
    );
  }, [isEditing, autoPanEnabled, canvasViewport, node, fontSize]);

  if (!node || node.kind !== 'number') return null;
  // Rebound so the narrowing above survives into the closures below - TS does not carry a
  // control-flow-narrowed type of an outer variable into a nested function declaration, only
  // the static type of a binding created after the narrowing.
  const numberNode = node;

  const locale = getDeviceLocale();
  const palette = rolePalette.number;
  const display = formatForDisplay(numberNode.raw, locale);

  function handleChangeText(text: string): void {
    try {
      setNodeRaw(id, parseUserInput(text, locale));
    } catch {
      // Not a complete number in this locale yet (e.g. a second decimal separator) - drop
      // the keystroke rather than store garbage; the controlled `value` below snaps the
      // TextInput's own buffer back to the last-good `display` string.
    }
  }

  // onKeyPress fires for every key regardless of whether it changed the text, unlike
  // onChangeText above - this is the one path a key reaches while this TextInput is focused,
  // since react-native-web's TextInput stops a handled keydown from ever bubbling to
  // AppShell's window-level listener (docs/journal/2026-08-03.md). Digits and the decimal
  // separator are left to onChangeText, which already normalises them per-locale through
  // `parseUserInput` - re-deciding them here would bypass that. A non-empty Backspace is left
  // to onChangeText too, since it already shortens the text. Everything else (operators,
  // parens, Backspace-on-empty, Escape, vertical arrows, sign) goes through the same
  // `dispatchEditorCommand` the keypad uses (P2.8 / P7.2, §8.5), so a hardware keyboard
  // can complete a chain the same way on-screen taps do. Horizontal arrows are left alone
  // so the text caret still moves normally while typing, rather than jumping to a sibling
  // node mid-edit. Vertical arrows *do* leave the field — between-chain navigation (P7.2).
  // Enter is excluded - the raw listener in the effect above owns it and dispatches it
  // itself (see that comment).
  //
  // preventDefault() on a dispatched command is not optional: react-native-web's TextInput
  // calls this handler from a native 'keydown' listener (see TextInput/index.js's
  // handleKeyDown) without cancelling the browser's own default text-insertion action for
  // that key. dispatchEditorCommand runs synchronously and can re-render this component onto
  // a *different* number node (e.g. '-' appends an operator and switches editing to a fresh
  // empty operand) before the browser gets to apply that default action - which then lands on
  // whichever input is focused *afterward*, not on the one the keydown actually started on.
  // For a character that isn't valid raw (like '+') the leaked keystroke is silently rejected
  // by parseUserInput and invisible. '-' *is* valid raw, so it survived as a real bug: typing
  // "3", then "-", produced a fresh operand pre-loaded with "-" instead of "", so appending a
  // digit gave "-4" instead of "4" - silently negating the second operand of every hardware-
  // typed subtraction. Caught live in a browser, not by any test (see the journal).
  function handleKeyPress(e: { nativeEvent: { key: string }; preventDefault?: () => void }): void {
    const key = e.nativeEvent.key;
    const isDigit = key.length === 1 && key >= '0' && key <= '9';
    if (isDigit || key === '.' || key === ',') return;
    if (key === 'Backspace' && numberNode.raw !== '') return;
    if (key === 'ArrowLeft' || key === 'ArrowRight') return;
    if (key === 'Enter') return;

    const command = commandFromHardwareKey(key);
    if (command) {
      e.preventDefault?.();
      dispatchEditorCommand(command);
    }
  }

  return (
    <Cell
      testID={`number-node-${id}`}
      width={widthOf(node, locale, fontSize)}
      fill={palette.fill}
      border={palette.border}
      label={numberNode.label}
      identityHue={identityHue}
      isEditingLabel={isEditingLabel}
      selected={selected}
      groupSelected={groupSelected}
      groupPosition={groupPosition}
      onLabelChange={(text) => setNodeLabel(id, text)}
      onLabelBlur={finishEditingLabel}
    >
      {isEditing ? (
        <TextInput
          ref={inputRef}
          testID={`number-node-input-${id}`}
          style={[glyphTextStyle, { color: glyphColor }, styles.input]}
          value={display}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onBlur={deselectNode}
          // Native has no browser to scroll — RN's own `autoFocus` is fine there. Web
          // focuses itself instead, via the effect above, specifically so it can pass
          // `preventScroll: true` (no such option on this prop) and keep the keypad from
          // sliding along with a cell added near the canvas edge — see that effect for
          // the full story.
          autoFocus={Platform.OS !== 'web'}
          // Custom keypad is the soft-input surface (§8.5); keep the TextInput focused for
          // caret + hardware keys, but do not raise the OS keyboard on top of ours.
          // `showSoftInputOnFocus={false}` alone is not enough on mobile web: RN-web only
          // maps it to `virtualkeyboardpolicy="manual"`, which Safari ignores, while
          // `keyboardType="numeric"` still emits `inputMode="numeric"` and opens the OS
          // pad. `inputMode="none"` is the HTML/RN signal Safari (and native) respect;
          // leave `keyboardType` unset so it cannot reintroduce a numeric inputMode.
          showSoftInputOnFocus={false}
          inputMode="none"
          // Let the canvas GestureDetector see the second click/tap of a double-tap
          // (§8.6 select group). The field is focused via `autoFocus` for hardware
          // keys; mouse caret placement is not a designed interaction here — digits
          // come from the keypad — so swallowing pointer hits would only block the
          // double-tap upgrade after the first tap mounts this input.
          pointerEvents="none"
          // Belt and braces alongside the raw-listener workaround in the effect above:
          // react-native-web also defaults a single-line TextInput to blurring on Enter via
          // its own deferred setTimeout, which this app never wants (Enter is fully handled
          // above).
          blurOnSubmit={false}
        />
      ) : (
        <Text style={[glyphTextStyle, { color: glyphColor }]} numberOfLines={1}>
          {display}
        </Text>
      )}
    </Cell>
  );
}

const styles = StyleSheet.create({
  input: {
    width: '100%',
    textAlign: 'center',
    padding: 0,
  },
});

export const NumberNode = React.memo(NumberNodeComponent);
