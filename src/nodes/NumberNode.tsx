// The number cell (§1.1, §6). Displays `raw` through the locale display layer (§10.3/P2.1) -
// storage stays canonical, only this render step ever formats it for a human. When selected
// as the current edit target (§8.6, P2.6) it swaps its `Text` for a `TextInput` showing the
// same locale-formatted string: `formatForDisplay` is documented as live-typing-safe for
// exactly this reason, and going through it (rather than raw) is what keeps the round trip
// through `parseUserInput` an identity (P2.1's property test).
import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { NodeId } from '../model/types';
import { useNode } from '../store/selectors';
import { useUiStore } from '../store/uiStore';
import { deselectNode, setNodeRaw } from '../store/commands';
import { formatForDisplay, parseUserInput } from '../engine/format';
import { widthOf } from '../chains/measure';
import { rolePalette, glyphColor } from '../ui/tokens';
import { getDeviceLocale } from '../ui/locale';
import { Cell, glyphTextStyle } from './Cell';

interface NumberNodeProps {
  id: NodeId;
}

function NumberNodeComponent({ id }: NumberNodeProps) {
  const node = useNode(id);
  const isEditing = useUiStore((state) => state.editingNodeId === id);
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

  // Backspace on an already-empty raw has no text to change, so onChangeText never fires for
  // it - onKeyPress does, on every key regardless of whether the text changed (§8.6: "backspace
  // on empty raw deletes the node"). Escape here covers the mid-edit case; deselecting when
  // nothing is focused is a window-level listener in AppShell, since a key handled by this
  // TextInput never reaches it (react-native-web's TextInput stops propagation on keydown).
  function handleKeyPress(e: { nativeEvent: { key: string } }): void {
    if (e.nativeEvent.key === 'Backspace' && numberNode.raw === '') {
      deselectNode();
    } else if (e.nativeEvent.key === 'Escape') {
      deselectNode();
    }
  }

  return (
    <Cell
      testID={`number-node-${id}`}
      width={widthOf(node, locale)}
      fill={palette.fill}
      border={palette.border}
      label={node.label}
    >
      {isEditing ? (
        <TextInput
          testID={`number-node-input-${id}`}
          style={[glyphTextStyle, { color: glyphColor }, styles.input]}
          value={display}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onBlur={deselectNode}
          autoFocus
          keyboardType="numeric"
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
