// Input dispatch (P2.8, §8.5). `Keypad.tsx`'s on-screen presses and `AppShell.tsx`'s
// hardware-keyboard listener both resolve to an `EditorCommand` and are handed to
// `dispatchEditorCommand` below - the one place that decides what a key does. Two
// implementations of "what does pressing + mean" would diverge; this is deliberately the
// only one.
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  addOperatorNode,
  addParenNode,
  addEqualsNode,
  appendNumberNode,
  appendParenNode,
  appendEqualsNode,
  appendOperatorAndNumber,
  setNodeRaw,
  deleteNode,
  selectNode,
  editNumberNode,
  deselectNode,
} from '../store/commands';
import { NodeId, NumberNode, OperatorSymbol, ParenSide } from '../model/types';

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type KeypadKey =
  | { region: 'digit'; value: Digit }
  | { region: 'decimal' }
  | { region: 'sign' }
  | { region: 'backspace' }
  | { region: 'paren'; side: ParenSide }
  | { region: 'operator'; op: OperatorSymbol }
  | { region: 'equals' };

/** Hardware/web-keyboard-only commands with no on-screen keypad equivalent (§8.5: "arrows
 *  move selection along a chain", "Escape deselects"). Unioned with `KeypadKey` so both
 *  input sources share one command type and one dispatch function. */
export type EditorCommand = KeypadKey | { region: 'escape' } | { region: 'arrow'; direction: 'left' | 'right' };

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Maps a `KeyboardEvent.key` to the same commands the on-screen keypad reports (§8.5:
 *  "Hardware and web keyboards map to the same commands"). Returns `null` for a key this
 *  app has no use for, e.g. letters. */
export function commandFromHardwareKey(key: string): EditorCommand | null {
  if (DIGITS.has(key)) return { region: 'digit', value: key as Digit };
  switch (key) {
    case '.':
    case ',':
      return { region: 'decimal' };
    case '+':
      return { region: 'operator', op: '+' };
    case '-':
      return { region: 'operator', op: '-' };
    case '*':
      return { region: 'operator', op: '×' };
    case '/':
      return { region: 'operator', op: '÷' };
    case 'Enter':
    case '=':
      return { region: 'equals' };
    case 'Backspace':
      return { region: 'backspace' };
    case 'Escape':
      return { region: 'escape' };
    case '(':
      return { region: 'paren', side: 'open' };
    case ')':
      return { region: 'paren', side: 'close' };
    case 'ArrowLeft':
      return { region: 'arrow', direction: 'left' };
    case 'ArrowRight':
      return { region: 'arrow', direction: 'right' };
    default:
      return null;
  }
}

function isStructural(command: EditorCommand): boolean {
  return command.region === 'operator' || command.region === 'paren' || command.region === 'equals';
}

function moveSelectionAlongChain(selectedId: NodeId | null, direction: 'left' | 'right'): void {
  if (!selectedId) return;
  const { document } = useDocumentStore.getState();
  const node = document.nodes[selectedId];
  const chain = node?.chainId ? document.chains[node.chainId] : undefined;
  if (!chain) return;

  const index = chain.members.indexOf(selectedId);
  if (index === -1) return;
  const nextId = chain.members[index + (direction === 'left' ? -1 : 1)];
  const nextNode = nextId ? document.nodes[nextId] : undefined;
  if (!nextNode) return;

  if (nextNode.kind === 'number') editNumberNode(nextNode.id);
  else selectNode(nextNode.id);
}

/** The one dispatch function every key press goes through, from the on-screen keypad or a
 *  hardware/web keyboard (§8.5). Targets the selected node if there is one, otherwise
 *  creates a new node at the last tap point. */
export function dispatchEditorCommand(command: EditorCommand): void {
  if (command.region === 'escape') {
    deselectNode();
    return;
  }

  const ui = useUiStore.getState();

  if (command.region === 'arrow') {
    moveSelectionAlongChain(ui.selectedNodeId, command.direction);
    return;
  }

  const selectedId = ui.selectedNodeId;
  let selectedNode = selectedId ? useDocumentStore.getState().document.nodes[selectedId] : undefined;
  let editingNumber: NumberNode | undefined =
    selectedNode && selectedNode.kind === 'number' && ui.editingNodeId === selectedNode.id
      ? selectedNode
      : undefined;

  // A structural key can't sensibly continue an empty in-progress number - §8.6 already
  // discards one abandoned by any other selection change, so do that first and fall
  // through to the "nothing selected" case rather than chain a node that's about to
  // disappear out from under itself.
  if (isStructural(command) && editingNumber && editingNumber.raw === '') {
    deselectNode();
    selectedNode = undefined;
    editingNumber = undefined;
  }

  if (command.region === 'backspace') {
    if (editingNumber) {
      if (editingNumber.raw === '') {
        deselectNode(); // already empty - discards it (§8.6)
      } else {
        setNodeRaw(editingNumber.id, editingNumber.raw.slice(0, -1));
      }
    } else if (selectedNode) {
      deleteNode(selectedNode.id);
      useUiStore.getState().setSelectedNode(null);
      useUiStore.getState().setEditingNode(null);
    }
    return;
  }

  // TODO(P4.9, §8.7): pressing an operator (or any other structural/edit key) with a
  // result selected is reserved for continuation - creating a new chain that references
  // the result, not editing it in place. That mechanism doesn't exist yet, so this is a
  // deliberate no-op rather than a placeholder edit users would have to unlearn.
  if (selectedNode?.kind === 'result') return;

  const caretPoint = ui.lastInteractionPoint;

  switch (command.region) {
    case 'digit':
    case 'decimal':
    case 'sign': {
      const char = command.region === 'digit' ? command.value : command.region === 'decimal' ? '.' : '-';

      if (editingNumber) {
        if (command.region === 'decimal' && editingNumber.raw.includes('.')) return; // one separator only
        if (command.region === 'sign') {
          setNodeRaw(
            editingNumber.id,
            editingNumber.raw.startsWith('-') ? editingNumber.raw.slice(1) : `-${editingNumber.raw}`,
          );
        } else {
          setNodeRaw(editingNumber.id, editingNumber.raw + char);
        }
        return;
      }
      if (selectedNode) {
        editNumberNode(appendNumberNode(selectedNode.id, char));
        return;
      }
      editNumberNode(addNumberNode(caretPoint, char));
      return;
    }

    case 'paren': {
      if (selectedNode) {
        selectNode(appendParenNode(selectedNode.id, command.side));
        return;
      }
      selectNode(addParenNode(caretPoint, command.side));
      return;
    }

    case 'operator': {
      if (selectedNode) {
        editNumberNode(appendOperatorAndNumber(selectedNode.id, command.op).numberId);
        return;
      }
      selectNode(addOperatorNode(caretPoint, command.op));
      return;
    }

    case 'equals': {
      if (selectedNode) {
        selectNode(appendEqualsNode(selectedNode.id));
        return;
      }
      selectNode(addEqualsNode(caretPoint));
      return;
    }
  }
}
