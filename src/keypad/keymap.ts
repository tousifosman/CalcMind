// Input dispatch (P2.8 / P7.2, §8.5). `Keypad.tsx`'s on-screen presses and `AppShell.tsx`'s
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
  continueFromResult,
  setNodeRaw,
  deleteNode,
  deleteGroup,
  selectNode,
  editNumberNode,
  deselectNode,
} from '../store/commands';
import { isEvaluableRaw } from '../engine/validate';
import { CalcNode, NodeId, NumberNode, OperatorSymbol, ParenSide } from '../model/types';

/** True when a Select-group set contains a result — the keypad then exposes the
 *  operator column for §8.7 continuation (§8.5 group mode). */
export function groupContainsResult(
  groupIds: ReadonlySet<NodeId>,
  nodes: Record<NodeId, CalcNode>,
): boolean {
  for (const id of groupIds) {
    if (nodes[id]?.kind === 'result') return true;
  }
  return false;
}

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type KeypadKey =
  | { region: 'digit'; value: Digit }
  | { region: 'decimal' }
  | { region: 'sign' }
  | { region: 'backspace' }
  /** On-screen `()` omits `side`; dispatch picks open/close via {@link resolveParenSide}.
   *  Hardware `(`/`)` always supply an explicit side. */
  | { region: 'paren'; side?: ParenSide }
  | { region: 'operator'; op: OperatorSymbol }
  | { region: 'equals' }
  | { region: 'undo' }
  | { region: 'redo' };

/** Hardware/web-keyboard-only commands with no on-screen keypad equivalent (§8.5: "arrows
 *  move selection along a chain", Escape deselects; P7.2 adds between-chain arrows).
 *  Undo/redo are also on the keypad history row; they stay here as `KeypadKey` members
 *  so hardware Ctrl/Cmd+Z shares the same command. Unioned with `KeypadKey` so both
 *  input sources share one command type and one dispatch function. */
export type EditorCommand =
  | KeypadKey
  | { region: 'escape' }
  | { region: 'arrow'; direction: 'left' | 'right' | 'up' | 'down' };

/** Modifier flags from a hardware `KeyboardEvent` (P7.2). */
export interface KeyMods {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Maps a `KeyboardEvent.key` (+ modifiers) to the same commands the on-screen keypad
 *  reports (§8.5 / P7.2). Returns `null` for a key this app has no use for, e.g. letters. */
export function commandFromHardwareKey(key: string, mods: KeyMods = {}): EditorCommand | null {
  const mod = !!(mods.ctrl || mods.meta);

  // Undo / redo before the bare-key table so Ctrl+Z is never mistaken for a letter no-op,
  // and so Alt/Ctrl chords do not fall through into digit/operator mapping.
  if (mod && (key === 'z' || key === 'Z')) {
    return mods.shift ? { region: 'redo' } : { region: 'undo' };
  }
  if (mod && (key === 'y' || key === 'Y')) {
    return { region: 'redo' };
  }
  if (mod || mods.alt) return null;

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
    case 'ArrowUp':
      return { region: 'arrow', direction: 'up' };
    case 'ArrowDown':
      return { region: 'arrow', direction: 'down' };
    // Keypad `+/-` has no single glyph on a standard keyboard. `_` is unused elsewhere
    // in the map; F9 matches the common calculator negate shortcut.
    case '_':
    case 'F9':
      return { region: 'sign' };
    default:
      return null;
  }
}

function isStructural(command: EditorCommand): boolean {
  return command.region === 'operator' || command.region === 'paren' || command.region === 'equals';
}

/**
 * Which side the on-screen `()` key should insert (§8.5). Prefers `)` when the
 * chain through the selection has unmatched opens *and* a close is legal there
 * (after a number / reference / close paren); otherwise `(`. Hardware `(`/`)`
 * bypass this and keep explicit sides.
 *
 * Exported for unit tests — the keypad only reports `{ region: 'paren' }` and
 * {@link dispatchEditorCommand} is the sole caller in production.
 */
export function resolveParenSide(
  selected: CalcNode | undefined,
  nodes: Record<NodeId, CalcNode>,
  chains: Record<string, { members: readonly NodeId[] }>,
): ParenSide {
  if (!selected?.chainId) return 'open';
  const chain = chains[selected.chainId];
  if (!chain) return 'open';

  const end = chain.members.indexOf(selected.id);
  if (end === -1) return 'open';

  let depth = 0;
  let expectingOperand = true;
  for (let i = 0; i <= end; i++) {
    const node = nodes[chain.members[i]!];
    if (!node) continue;
    if (node.kind === 'equals' || node.kind === 'result') break;
    if (node.kind === 'paren' && node.side === 'open') {
      // Implicit mul before `(` (§10.2) — open is always legal; resets to operand.
      depth += 1;
      expectingOperand = true;
      continue;
    }
    if (node.kind === 'paren' && node.side === 'close') {
      depth -= 1;
      expectingOperand = false;
      continue;
    }
    if (node.kind === 'operator') {
      expectingOperand = true;
      continue;
    }
    // number | reference. Mid-typing stubs ("", "-", ".") after an operator are
    // the empty placeholder `appendOperatorAndNumber` leaves selected — they are
    // not a completed operand, so `()` must still open (e.g. `(1 +` then `()`).
    if (node.kind === 'number' && !isEvaluableRaw(node.raw)) {
      continue;
    }
    expectingOperand = false;
  }

  // Prefer closing when there is something to close and a close is grammatical.
  if (depth > 0 && !expectingOperand) return 'close';
  return 'open';
}

function focusNode(node: CalcNode): void {
  if (node.kind === 'number') editNumberNode(node.id);
  else selectNode(node.id);
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

  focusNode(nextNode);
}

/** Vertical jump to another chain (or a free node), landing on the member nearest in x
 *  to the current selection (P7.2: "arrows move selection … between chains"). */
function moveSelectionBetweenChains(selectedId: NodeId | null, direction: 'up' | 'down'): void {
  if (!selectedId) return;
  const { document } = useDocumentStore.getState();
  const selected = document.nodes[selectedId];
  if (!selected) return;

  const currentChainId = selected.chainId;
  const currentX = selected.position.x;
  const currentY = selected.position.y;

  type Candidate = { id: NodeId; dy: number; dx: number };
  const candidates: Candidate[] = [];

  for (const chain of Object.values(document.chains)) {
    if (chain.id === currentChainId) continue;

    let bestId: NodeId | undefined;
    let bestDx = Infinity;
    let bestY = 0;
    for (const memberId of chain.members) {
      const member = document.nodes[memberId];
      if (!member) continue;
      const dx = Math.abs(member.position.x - currentX);
      if (dx < bestDx) {
        bestDx = dx;
        bestId = memberId;
        bestY = member.position.y;
      }
    }
    if (!bestId) continue;
    const dy = bestY - currentY;
    if (direction === 'up' && dy >= 0) continue;
    if (direction === 'down' && dy <= 0) continue;
    candidates.push({ id: bestId, dy: Math.abs(dy), dx: bestDx });
  }

  for (const node of Object.values(document.nodes)) {
    if (node.chainId !== null) continue;
    if (node.id === selectedId) continue;
    // A free node already covered when walking the selected node's own (absent) chain.
    const dy = node.position.y - currentY;
    if (direction === 'up' && dy >= 0) continue;
    if (direction === 'down' && dy <= 0) continue;
    candidates.push({
      id: node.id,
      dy: Math.abs(dy),
      dx: Math.abs(node.position.x - currentX),
    });
  }

  if (candidates.length === 0) return;
  candidates.sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  const next = document.nodes[candidates[0]!.id];
  if (next) focusNode(next);
}

function moveSelection(selectedId: NodeId | null, direction: 'left' | 'right' | 'up' | 'down'): void {
  if (direction === 'left' || direction === 'right') {
    moveSelectionAlongChain(selectedId, direction);
  } else {
    moveSelectionBetweenChains(selectedId, direction);
  }
}

/** The one dispatch function every key press goes through, from the on-screen keypad or a
 *  hardware/web keyboard (§8.5). Targets the selected node if there is one, otherwise
 *  creates a new node at the last tap point. */
export function dispatchEditorCommand(command: EditorCommand): void {
  if (command.region === 'undo') {
    useDocumentStore.getState().undo();
    return;
  }
  if (command.region === 'redo') {
    useDocumentStore.getState().redo();
    return;
  }

  if (command.region === 'escape') {
    const ui = useUiStore.getState();
    const hadFocus =
      ui.selectedNodeId !== null ||
      ui.editingNodeId !== null ||
      ui.editingLabelNodeId !== null ||
      ui.groupSelectedIds.size > 0;
    deselectNode();
    // Second Escape (nothing focused) dismisses the keypad — the mode-strip chevron's
    // keyboard equivalent (P7.2). First Escape stays §8.5's "Escape deselects."
    if (!hadFocus) useUiStore.getState().hideKeypad();
    return;
  }

  const ui = useUiStore.getState();

  if (command.region === 'arrow') {
    moveSelection(ui.selectedNodeId, command.direction);
    return;
  }

  // Select all (§8.6): data-entry has no single keypad target. Undo/redo / Escape /
  // arrows already returned above; mode-strip actions never reach this dispatch.
  if (ui.allSelected) {
    return;
  }

  // §8.5 group mode: with a Select-group highlight, only history (undo/redo already
  // handled) and backspace apply; operators also apply when the group has a result
  // (§8.7 continuation). Digits / editing / equals / parens are inert — the on-screen
  // keys are disabled for the same reason.
  if (ui.groupSelectedIds.size > 0) {
    if (command.region === 'backspace') {
      deleteGroup(ui.groupSelectedIds);
      deselectNode();
      return;
    }
    if (command.region === 'operator') {
      const { nodes } = useDocumentStore.getState().document;
      const resultId =
        [...ui.groupSelectedIds].find((id) => nodes[id]?.kind === 'result') ?? null;
      if (resultId) {
        const { operatorId } = continueFromResult(resultId, command.op);
        selectNode(operatorId);
      }
    }
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
  //
  // Opening a paren is the one exception. `2 ×` then `(` is not the user abandoning the
  // chain - §10.2 decision #4's "implicit multiplication only before `(`" makes the paren
  // group `×`'s right operand, so it has to continue the very chain the discarded
  // placeholder was sitting in, not fall through and start a disconnected one anchored
  // back at the last tap point. Verified live: without this, `2 × (3 + 4) =` silently
  // evaluated only `(3 + 4)`, dropping `2 ×` into an orphaned Incomplete chain.
  //
  // The on-screen `()` key omits `side`; resolve it against the placeholder's chain
  // *before* discarding so the open-after-operator case still wins.
  if (isStructural(command) && editingNumber && editingNumber.raw === '') {
    if (command.region === 'paren' && editingNumber.chainId) {
      const doc = useDocumentStore.getState().document;
      const side =
        command.side ?? resolveParenSide(editingNumber, doc.nodes, doc.chains);
      if (side === 'open') {
        const chainId = editingNumber.chainId;
        deleteNode(editingNumber.id);
        const chain = useDocumentStore.getState().document.chains[chainId];
        // `appendOperatorAndNumber` always appends the operator and this placeholder together
        // onto a chain that had >= 1 member already (or creates one with exactly the anchor),
        // so deleting just the placeholder leaves >= 2 members behind - never the 1-member
        // state that dissolves a chain. Written explicitly rather than relying on that
        // invariant never changing: if it ever does and the chain is gone, fall through to
        // the ordinary discard-and-deselect path below instead of risking a crash.
        const anchorId =
          chain && chain.members.length > 0
            ? chain.members[chain.members.length - 1]
            : undefined;
        if (anchorId) {
          selectNode(appendParenNode(anchorId, 'open'));
          return;
        }
      }
    }
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
      // Prefer deselectNode so a leftover Select-group highlight clears with the
      // primary selection (same contract as Escape / tap-elsewhere).
      deselectNode();
    }
    return;
  }

  // §8.7 Continuation (P4.9): an operator with a result selected starts a new chain
  // referencing it. Other keys still no-op — the result is read-only and must not be
  // edited in place.
  if (selectedNode?.kind === 'result') {
    if (command.region === 'operator') {
      const { operatorId } = continueFromResult(selectedNode.id, command.op);
      selectNode(operatorId);
    }
    return;
  }

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
      const doc = useDocumentStore.getState().document;
      const side =
        command.side ?? resolveParenSide(selectedNode, doc.nodes, doc.chains);
      if (selectedNode) {
        selectNode(appendParenNode(selectedNode.id, side));
        return;
      }
      selectNode(addParenNode(caretPoint, side));
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
        // §8.7: after `=` the natural next action is continuation (operator on the
        // result). Select the new result when one exists; fall back to `=` only
        // when the chain did not evaluate (no result member).
        const equalsId = appendEqualsNode(selectedNode.id);
        const doc = useDocumentStore.getState().document;
        const chainId = doc.nodes[equalsId]?.chainId;
        const chain = chainId ? doc.chains[chainId] : undefined;
        const resultId = chain?.members.find((id) => doc.nodes[id]?.kind === 'result');
        selectNode(resultId ?? equalsId);
        return;
      }
      selectNode(addEqualsNode(caretPoint));
      return;
    }
  }
}
