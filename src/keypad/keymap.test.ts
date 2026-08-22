import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  addOperatorNode,
  addParenNode,
  selectNode,
  selectGroup,
  editNumberNode,
  setNodeRaw,
  deleteNode,
  appendEqualsNode,
  appendNumberNode,
  appendOperatorAndNumber,
  createLinkToValue,
  selectAll,
  CONTINUATION_OFFSET,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import {
  commandFromHardwareKey,
  dispatchEditorCommand,
  resolveParenSide,
  groupContainsResult,
  chainHasEquals,
} from './keymap';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    groupSelectedIds: new Set(),
    lastInteractionPoint: { x: 0, y: 0 },
  });
}

beforeEach(resetStore);

function nodes() {
  return useDocumentStore.getState().document.nodes;
}

describe('commandFromHardwareKey (§8.5 hardware/web keyboard mapping)', () => {
  test('digits map to the same digit region the keypad reports', () => {
    expect(commandFromHardwareKey('7')).toEqual({ region: 'digit', value: '7' });
  });

  test('+ - * / map to the four operator glyphs', () => {
    expect(commandFromHardwareKey('+')).toEqual({ region: 'operator', op: '+' });
    expect(commandFromHardwareKey('-')).toEqual({ region: 'operator', op: '-' });
    expect(commandFromHardwareKey('*')).toEqual({ region: 'operator', op: '×' });
    expect(commandFromHardwareKey('/')).toEqual({ region: 'operator', op: '÷' });
  });

  test('Enter maps to equals, Backspace and Escape map to themselves', () => {
    expect(commandFromHardwareKey('Enter')).toEqual({ region: 'equals' });
    expect(commandFromHardwareKey('Backspace')).toEqual({ region: 'backspace' });
    expect(commandFromHardwareKey('Escape')).toEqual({ region: 'escape' });
  });

  test('arrows map to chain-navigation commands with no on-screen keypad equivalent', () => {
    expect(commandFromHardwareKey('ArrowLeft')).toEqual({ region: 'arrow', direction: 'left' });
    expect(commandFromHardwareKey('ArrowRight')).toEqual({ region: 'arrow', direction: 'right' });
    expect(commandFromHardwareKey('ArrowUp')).toEqual({ region: 'arrow', direction: 'up' });
    expect(commandFromHardwareKey('ArrowDown')).toEqual({ region: 'arrow', direction: 'down' });
  });

  test('+/- maps via _ and F9 (no single glyph on a standard keyboard)', () => {
    expect(commandFromHardwareKey('_')).toEqual({ region: 'sign' });
    expect(commandFromHardwareKey('F9')).toEqual({ region: 'sign' });
  });

  test('Ctrl/Cmd+Z / Shift+Z / Y map to undo and redo', () => {
    expect(commandFromHardwareKey('z', { ctrl: true })).toEqual({ region: 'undo' });
    expect(commandFromHardwareKey('z', { meta: true })).toEqual({ region: 'undo' });
    expect(commandFromHardwareKey('z', { ctrl: true, shift: true })).toEqual({ region: 'redo' });
    expect(commandFromHardwareKey('y', { ctrl: true })).toEqual({ region: 'redo' });
    expect(commandFromHardwareKey('Z', { meta: true, shift: true })).toEqual({ region: 'redo' });
  });

  test('modifier chords other than undo/redo do not fall through to bare-key commands', () => {
    expect(commandFromHardwareKey('+', { ctrl: true })).toBeNull();
    expect(commandFromHardwareKey('1', { alt: true })).toBeNull();
  });

  test('a key this app has no use for maps to null', () => {
    expect(commandFromHardwareKey('a')).toBeNull();
    expect(commandFromHardwareKey('Shift')).toBeNull();
  });
});

describe('dispatchEditorCommand: nothing selected creates a node at the last tap point (§8.5)', () => {
  test('digit creates a number node in edit mode there', () => {
    useUiStore.getState().setLastInteractionPoint({ x: 40, y: 10 });

    dispatchEditorCommand({ region: 'digit', value: '5' });

    const id = useUiStore.getState().selectedNodeId!;
    expect(nodes()[id]).toMatchObject({ kind: 'number', raw: '5', position: { x: 40, y: 10 } });
    expect(useUiStore.getState().editingNodeId).toBe(id);
  });

  test('decimal and sign also start a number, with "." / "-" as the first character', () => {
    dispatchEditorCommand({ region: 'decimal' });
    expect(nodes()[useUiStore.getState().selectedNodeId!]).toMatchObject({ raw: '.' });

    resetStore();
    dispatchEditorCommand({ region: 'sign' });
    expect(nodes()[useUiStore.getState().selectedNodeId!]).toMatchObject({ raw: '-' });
  });

  test('operator/paren/equals create a free, selected (not editing) symbol node', () => {
    dispatchEditorCommand({ region: 'operator', op: '+' });
    const id = useUiStore.getState().selectedNodeId!;
    expect(nodes()[id]).toMatchObject({ kind: 'operator', op: '+', chainId: null });
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('backspace with nothing selected is a no-op', () => {
    const before = useDocumentStore.getState().undoStack.length;
    dispatchEditorCommand({ region: 'backspace' });
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });
});

describe('dispatchEditorCommand: editing a number (§8.6 edit target)', () => {
  test('digits append to raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'digit', value: '2' });

    expect(nodes()[id]).toMatchObject({ raw: '12' });
  });

  test('decimal appends once, then is ignored', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'decimal' });
    dispatchEditorCommand({ region: 'decimal' });

    expect(nodes()[id]).toMatchObject({ raw: '3.' });
  });

  test('sign toggles a leading minus', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'sign' });
    expect(nodes()[id]).toMatchObject({ raw: '-5' });

    dispatchEditorCommand({ region: 'sign' });
    expect(nodes()[id]).toMatchObject({ raw: '5' });
  });

  test('backspace trims one character, then discards the node once empty', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '9');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'backspace' });
    expect(nodes()[id]).toMatchObject({ raw: '' });

    dispatchEditorCommand({ region: 'backspace' });
    expect(nodes()[id]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });

  test('escape deselects and discards an empty in-progress number', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'escape' });

    expect(nodes()[id]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });
});

describe('dispatchEditorCommand: completing a full chain by typing (§8.5, P2.8 acceptance)', () => {
  test('12 + 34 = builds one chain with members, trailing equals, and a result (P4.7)', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '3' });
    dispatchEditorCommand({ region: 'digit', value: '4' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const chainIds = Object.keys(doc.chains);
    expect(chainIds).toHaveLength(1);
    const chain = doc.chains[chainIds[0]];
    const kinds = chain.members.map((id) => doc.nodes[id].kind);
    expect(kinds).toEqual(['number', 'operator', 'number', 'equals', 'result']);
    const result = doc.nodes[chain.members[4]];
    expect(result).toMatchObject({
      kind: 'result',
      sourceChainId: chain.id,
      derived: { display: '46' },
    });
    // Focus lands on the result so the next operator can continue (§8.7) without
    // an extra tap on the read-only cell.
    expect(useUiStore.getState().selectedNodeId).toBe(chain.members[4]);
  });

  test('an operator on a selected symbol node (not a number) still continues the chain', () => {
    const first = addParenNode({ x: 0, y: 0 }, 'open');
    selectNode(first);

    dispatchEditorCommand({ region: 'operator', op: '×' });

    const chainId = nodes()[first]!.chainId!;
    const chain = useDocumentStore.getState().document.chains[chainId];
    expect(chain.members).toHaveLength(3); // paren, operator, fresh number
    expect(useUiStore.getState().editingNodeId).toBe(chain.members[2]);
  });

  test('pressing an operator on an empty in-progress number discards it instead of chaining it', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(id);

    dispatchEditorCommand({ region: 'operator', op: '+' });

    expect(nodes()[id]).toBeUndefined();
    const selectedId = useUiStore.getState().selectedNodeId!;
    expect(nodes()[selectedId]).toMatchObject({ kind: 'operator', op: '+', chainId: null });
  });

  test('2 × (3 + 4) = continues one chain and evaluates to 14 (§10.2 decision #4)', () => {
    // Regression test for a bug caught live during the P4 phase exit check: opening a
    // paren right after an operator (before any digit lands in its auto-created empty
    // placeholder) discarded the placeholder *and* fell through to "nothing selected",
    // silently starting a second, disconnected chain anchored back at the last tap point.
    // `2 ×` was then stranded as an orphaned Incomplete chain and `=` only ever saw
    // `(3 + 4)`, producing 7 instead of 14.
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'operator', op: '×' });
    dispatchEditorCommand({ region: 'paren', side: 'open' });
    dispatchEditorCommand({ region: 'digit', value: '3' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '4' });
    dispatchEditorCommand({ region: 'paren', side: 'close' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const chainIds = Object.keys(doc.chains);
    expect(chainIds).toHaveLength(1); // not two - the paren must continue the '2 ×' chain
    const chain = doc.chains[chainIds[0]];
    const kinds = chain.members.map((id) => doc.nodes[id].kind);
    expect(kinds).toEqual(['number', 'operator', 'paren', 'number', 'operator', 'number', 'paren', 'equals', 'result']);
    const result = doc.nodes[chain.members[chain.members.length - 1]];
    expect(result).toMatchObject({ kind: 'result', derived: { display: '14' } });
  });

  test('on-screen () (no side) opens after an operator and closes after a number', () => {
    // Same expression as above, but via the merged keypad key that omits `side`.
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'operator', op: '×' });
    dispatchEditorCommand({ region: 'paren' }); // → open
    dispatchEditorCommand({ region: 'digit', value: '3' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '4' });
    dispatchEditorCommand({ region: 'paren' }); // → close
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const chainIds = Object.keys(doc.chains);
    expect(chainIds).toHaveLength(1);
    const chain = doc.chains[chainIds[0]!];
    const sides = chain!.members
      .map((id) => doc.nodes[id])
      .filter((n) => n?.kind === 'paren')
      .map((n) => (n!.kind === 'paren' ? n.side : null));
    expect(sides).toEqual(['open', 'close']);
    const result = doc.nodes[chain!.members[chain!.members.length - 1]!];
    expect(result).toMatchObject({ kind: 'result', derived: { display: '14' } });
  });
});

describe('resolveParenSide (§8.5 smart () key)', () => {
  test('with nothing selected, opens', () => {
    expect(resolveParenSide(undefined, {}, {})).toBe('open');
  });

  test('after a free number (no chain), opens — for n( implicit mul', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '12');
    const doc = useDocumentStore.getState().document;
    expect(resolveParenSide(doc.nodes[id], doc.nodes, doc.chains)).toBe('open');
  });

  test('after a number with unmatched open, closes', () => {
    dispatchEditorCommand({ region: 'paren', side: 'open' });
    dispatchEditorCommand({ region: 'digit', value: '3' });
    const selectedId = useUiStore.getState().selectedNodeId!;
    const doc = useDocumentStore.getState().document;
    expect(resolveParenSide(doc.nodes[selectedId], doc.nodes, doc.chains)).toBe('close');
  });

  test('after an operator, opens even when depth > 0', () => {
    dispatchEditorCommand({ region: 'paren', side: 'open' });
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    // Selection is the empty placeholder after `+`.
    const selectedId = useUiStore.getState().selectedNodeId!;
    const doc = useDocumentStore.getState().document;
    expect(resolveParenSide(doc.nodes[selectedId], doc.nodes, doc.chains)).toBe('open');
  });
});

describe('dispatchEditorCommand: continuation from a value (P4.9, §8.7)', () => {
  test('operator with a result selected creates [reference→R, ⊕, number] under the source first cell and edits the number', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '0' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'equals' });

    const afterEquals = useDocumentStore.getState().document;
    const result = Object.values(afterEquals.nodes).find((n) => n.kind === 'result');
    expect(result).toBeDefined();
    const sourceChain = afterEquals.chains[result!.chainId!]!;
    // `=` already focused the result — no extra selectNode before continuation.
    expect(useUiStore.getState().selectedNodeId).toBe(result!.id);

    dispatchEditorCommand({ region: 'operator', op: '×' });

    const doc = useDocumentStore.getState().document;
    const refs = Object.values(doc.nodes).filter((n) => n.kind === 'reference');
    expect(refs).toHaveLength(1);
    const ref = refs[0]!;
    expect(ref).toMatchObject({ kind: 'reference', targetNodeId: result!.id });

    const contChain = doc.chains[ref.chainId!]!;
    expect(contChain).toBeDefined();
    expect(contChain.members).toHaveLength(3);
    expect(doc.nodes[contChain.members[0]!]!.kind).toBe('reference');
    expect(doc.nodes[contChain.members[1]!]!).toMatchObject({ kind: 'operator', op: '×' });
    expect(doc.nodes[contChain.members[2]!]!).toMatchObject({ kind: 'number', raw: '' });

    expect(contChain.anchor).toEqual({
      x: sourceChain.anchor.x,
      y: sourceChain.anchor.y + CONTINUATION_OFFSET.y,
    });

    const selectedId = useUiStore.getState().selectedNodeId;
    expect(selectedId).toBe(contChain.members[2]);
    expect(useUiStore.getState().editingNodeId).toBe(contChain.members[2]);
    expect(doc.nodes[result!.id]!.kind).toBe('result');
  });

  test('operator with a selected (not editing) number creates [reference→N, ⊕]', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    const numberId = useUiStore.getState().selectedNodeId!;
    expect(useDocumentStore.getState().document.nodes[numberId]).toMatchObject({
      kind: 'number',
      raw: '12',
    });

    // Tap/arrow equivalent: select without editing so the next operator continues.
    selectNode(numberId);
    expect(useUiStore.getState().editingNodeId).toBeNull();

    dispatchEditorCommand({ region: 'operator', op: '+' });

    const doc = useDocumentStore.getState().document;
    const refs = Object.values(doc.nodes).filter((n) => n.kind === 'reference');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: 'reference', targetNodeId: numberId });
    const contChain = doc.chains[refs[0]!.chainId!]!;
    expect(contChain.members).toHaveLength(3);
    expect(doc.nodes[contChain.members[1]!]).toMatchObject({ kind: 'operator', op: '+' });
    expect(useUiStore.getState().selectedNodeId).toBe(contChain.members[2]);
    expect(useUiStore.getState().editingNodeId).toBe(contChain.members[2]);
    // Source stays put.
    expect(doc.nodes[numberId]).toMatchObject({ kind: 'number', raw: '12' });
  });

  test('operator while editing a number still appends in-chain (typing 5+3)', () => {
    dispatchEditorCommand({ region: 'digit', value: '5' });
    expect(useUiStore.getState().editingNodeId).not.toBeNull();
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '3' });

    const doc = useDocumentStore.getState().document;
    const numbers = Object.values(doc.nodes).filter((n) => n.kind === 'number');
    expect(numbers).toHaveLength(2);
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'reference')).toHaveLength(0);
    expect(numbers.map((n) => n.raw).sort()).toEqual(['3', '5']);
    // One chain: 5 + 3
    expect(Object.keys(doc.chains)).toHaveLength(1);
  });

  test('operator with a selected linked cell extends its own chain in place, not a second link', () => {
    dispatchEditorCommand({ region: 'digit', value: '3' });
    const numberId = useUiStore.getState().selectedNodeId!;
    selectNode(numberId);
    dispatchEditorCommand({ region: 'operator', op: '+' });

    const firstRef = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'reference',
    )!;
    // Finish the first continuation chain so selection is elsewhere, then re-select the link.
    dispatchEditorCommand({ region: 'digit', value: '1' });
    selectNode(firstRef.id);

    const before = useDocumentStore.getState().document;
    const chainId = firstRef.chainId!;
    const membersBefore = before.chains[chainId]!.members;
    expect(membersBefore).toHaveLength(3); // [firstRef, +, '1']

    dispatchEditorCommand({ region: 'operator', op: '×' });

    const doc = useDocumentStore.getState().document;
    // No second reference was created — this is not §8.7 continuation. Reported live:
    // pressing an operator on a dropped `Create link` reference used to spin off a
    // reference-to-the-reference instead of extending from it.
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'reference')).toHaveLength(1);
    // Same chain, grown from [ref, +, 1] to [ref, ×, <empty>, +, 1] — the new operand
    // lands right after the reference, pushing the rest of the formula rightward.
    const afterMembers = doc.chains[chainId]!.members;
    expect(afterMembers).toHaveLength(5);
    expect(afterMembers[0]).toBe(firstRef.id);
    expect(doc.nodes[afterMembers[1]!]).toMatchObject({ kind: 'operator', op: '×' });
    expect(doc.nodes[afterMembers[2]!]).toMatchObject({ kind: 'number', raw: '' });
    expect(afterMembers[3]).toBe(membersBefore[1]);
    expect(afterMembers[4]).toBe(membersBefore[2]);

    expect(useUiStore.getState().selectedNodeId).toBe(afterMembers[2]);
    expect(useUiStore.getState().editingNodeId).toBe(afterMembers[2]);
  });

  test('operator with a selected free (not-yet-chained) linked cell builds [ref, ⊕, empty] in place', () => {
    // Free-standing reference, e.g. one just dropped by the `Create link` action —
    // chainId null, not part of any chain yet.
    const source = addNumberNode({ x: 0, y: 0 }, '14');
    const refId = createLinkToValue(source);
    expect(useDocumentStore.getState().document.nodes[refId]).toMatchObject({
      kind: 'reference',
      chainId: null,
    });
    selectNode(refId);

    dispatchEditorCommand({ region: 'operator', op: '+' });

    const doc = useDocumentStore.getState().document;
    // Still exactly one reference — no second link spun off.
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'reference')).toHaveLength(1);
    const ref = doc.nodes[refId]!;
    expect(ref.chainId).not.toBeNull();
    const members = doc.chains[ref.chainId!]!.members;
    expect(members).toEqual([refId, expect.any(String), expect.any(String)]);
    expect(doc.nodes[members[1]!]).toMatchObject({ kind: 'operator', op: '+' });
    expect(doc.nodes[members[2]!]).toMatchObject({ kind: 'number', raw: '' });
    expect(useUiStore.getState().selectedNodeId).toBe(members[2]);
    expect(useUiStore.getState().editingNodeId).toBe(members[2]);
  });

  test('operator with an operator selected replaces its symbol in place', () => {
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '3' });
    const op = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'operator',
    )!;
    selectNode(op.id);
    const membersBefore =
      useDocumentStore.getState().document.chains[op.chainId!]!.members.length;

    dispatchEditorCommand({ region: 'operator', op: '×' });

    const doc = useDocumentStore.getState().document;
    expect(doc.nodes[op.id]).toMatchObject({ kind: 'operator', op: '×' });
    expect(doc.chains[op.chainId!]!.members).toHaveLength(membersBefore);
    expect(useUiStore.getState().selectedNodeId).toBe(op.id);
  });

  test('paren with an operator selected no-ops', () => {
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    const op = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'operator',
    )!;
    selectNode(op.id);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'paren', side: 'open' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(op.id);
  });

  test('digit with a linked cell selected no-ops (does not append at chain end)', () => {
    dispatchEditorCommand({ region: 'digit', value: '3' });
    const numberId = useUiStore.getState().selectedNodeId!;
    selectNode(numberId);
    dispatchEditorCommand({ region: 'operator', op: '+' });
    const ref = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'reference',
    )!;
    selectNode(ref.id);
    const before = useDocumentStore.getState().undoStack.length;
    const membersBefore = useDocumentStore.getState().document.chains[ref.chainId!]!.members
      .length;

    dispatchEditorCommand({ region: 'digit', value: '9' });
    dispatchEditorCommand({ region: 'decimal' });
    dispatchEditorCommand({ region: 'sign' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useDocumentStore.getState().document.chains[ref.chainId!]!.members).toHaveLength(
      membersBefore,
    );
    expect(useUiStore.getState().selectedNodeId).toBe(ref.id);
  });

  test('digit on a selected (not editing) number opens edit and appends', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    const numberId = useUiStore.getState().selectedNodeId!;
    selectNode(numberId);
    expect(useUiStore.getState().editingNodeId).toBeNull();

    dispatchEditorCommand({ region: 'digit', value: '2' });

    expect(useUiStore.getState().editingNodeId).toBe(numberId);
    expect(useDocumentStore.getState().document.nodes[numberId]).toMatchObject({
      kind: 'number',
      raw: '12',
    });
  });

  test('digit / equals with a result selected still no-op (result is read-only)', () => {
    const chainId = 'c_result_test';
    const resultId = 'n_result_test';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains[chainId] = { id: chainId, members: [], anchor: { x: 0, y: 0 } };
      draft.nodes[resultId] = {
        id: resultId,
        kind: 'result',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: Date.now(),
        sourceChainId: chainId,
      };
    });
    selectNode(resultId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'equals' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(resultId);
  });

  test('paren with a result selected wraps a new link in ( ) instead of no-op (§8.7)', () => {
    const chainId = 'c_result_paren_test';
    const resultId = 'n_result_paren_test';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains[chainId] = { id: chainId, members: [], anchor: { x: 0, y: 0 } };
      draft.nodes[resultId] = {
        id: resultId,
        kind: 'result',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: Date.now(),
        sourceChainId: chainId,
      };
    });
    selectNode(resultId);

    dispatchEditorCommand({ region: 'paren', side: 'open' });

    const doc = useDocumentStore.getState().document;
    const ref = Object.values(doc.nodes).find(
      (n) => n.kind === 'reference' && n.targetNodeId === resultId,
    )!;
    expect(ref).toBeDefined();
    const chain = doc.chains[ref.chainId!]!;
    const kinds = chain.members.map((id) => doc.nodes[id]?.kind);
    expect(kinds).toEqual(['paren', 'reference', 'paren']);
    // Close paren selected (not editing — nothing to type into yet), so a following
    // operator or `=` extends this new chain in place like any other selected paren.
    const closeParenId = chain.members[2]!;
    expect(useUiStore.getState().selectedNodeId).toBe(closeParenId);
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('selecting the = cell rejects digit/paren/equals — nothing appends after it', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const equalsNode = Object.values(doc.nodes).find((n) => n.kind === 'equals')!;
    const chainId = equalsNode.chainId!;
    const membersBefore = [...doc.chains[chainId]!.members];

    selectNode(equalsNode.id);
    dispatchEditorCommand({ region: 'digit', value: '9' });
    dispatchEditorCommand({ region: 'paren', side: 'open' });
    dispatchEditorCommand({ region: 'equals' });

    expect(useDocumentStore.getState().document.chains[chainId]!.members).toEqual(membersBefore);
    // Still selected — every command above was a no-op, not a deselect.
    expect(useUiStore.getState().selectedNodeId).toBe(equalsNode.id);
  });

  test('an operator on a selected = converts it to that operator in place (§9)', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const before = useDocumentStore.getState().document;
    const equalsNode = Object.values(before.nodes).find((n) => n.kind === 'equals')!;
    const chainId = equalsNode.chainId!;
    const resultId = before.chains[chainId]!.members.find(
      (id) => before.nodes[id]?.kind === 'result',
    )!;

    selectNode(equalsNode.id);
    dispatchEditorCommand({ region: 'operator', op: '×' });

    const after = useDocumentStore.getState().document;
    // The old = (and the result it had) are gone; the chain now reads 1 + 2 × _.
    expect(after.nodes[equalsNode.id]).toBeUndefined();
    expect(after.nodes[resultId]).toBeUndefined();
    const chain = after.chains[chainId]!;
    const kinds = chain.members.map((id) => after.nodes[id]?.kind);
    expect(kinds).toEqual(['number', 'operator', 'number', 'operator', 'number']);
    const newOperator = after.nodes[chain.members[3]!];
    expect(newOperator).toMatchObject({ kind: 'operator', op: '×' });
    // The fresh empty operand is what's now selected and being edited, same as any
    // other operator press seeds and focuses its operand.
    const newNumberId = chain.members[4]!;
    expect(useUiStore.getState().selectedNodeId).toBe(newNumberId);
    expect(useUiStore.getState().editingNodeId).toBe(newNumberId);
    expect(after.nodes[newNumberId]).toMatchObject({ kind: 'number', raw: '' });
  });

  test('an operator on a selected = with no other chain history still leaves undo intact', () => {
    // Guards convertEqualsToOperator's own no-op guard (missing predecessor) rather than
    // a thrown error corrupting the undo stack — not reachable through the UI for a real
    // equals node (always has a preceding operand), but dispatch shouldn't crash if one
    // ever is selected with a malformed chain underneath it.
    const chainId = 'c_malformed';
    const equalsId = 'n_malformed_equals';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains[chainId] = { id: chainId, members: [equalsId], anchor: { x: 0, y: 0 } };
      draft.nodes[equalsId] = {
        id: equalsId,
        kind: 'equals',
        position: { x: 0, y: 0 },
        chainId,
        createdAt: Date.now(),
      };
    });
    selectNode(equalsId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'operator', op: '+' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useDocumentStore.getState().document.nodes[equalsId]).toBeDefined();
  });

  test('= is rejected on any other member once the chain already has one — no second equals', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const one = Object.values(doc.nodes).find((n) => n.kind === 'number' && n.raw === '1')!;
    const chainId = one.chainId!;
    const membersBefore = [...doc.chains[chainId]!.members];

    selectNode(one.id);
    dispatchEditorCommand({ region: 'equals' });

    const after = useDocumentStore.getState().document;
    expect(after.chains[chainId]!.members).toEqual(membersBefore);
    expect(after.chains[chainId]!.members.filter((id) => after.nodes[id]?.kind === 'equals')).toHaveLength(1);
  });

  test('backspace on a selected result is disabled — a derived value, not user input (§9)', () => {
    const resultId = 'n_result_test2';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[resultId] = {
        id: resultId,
        kind: 'result',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: Date.now(),
        sourceChainId: 'c_missing',
      };
    });
    selectNode(resultId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[resultId]).toBeDefined();
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(resultId);
  });

  test('full keystroke path: continue, type operand, = uses live reference value', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '0' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'equals' });

    const result = Object.values(useDocumentStore.getState().document.nodes).find((n) => n.kind === 'result')!;
    expect(useUiStore.getState().selectedNodeId).toBe(result.id);
    dispatchEditorCommand({ region: 'operator', op: '×' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const contResult = Object.values(doc.nodes).find(
      (n) => n.kind === 'result' && n.id !== result.id,
    );
    expect(contResult).toMatchObject({
      kind: 'result',
      derived: { display: '30' },
    });

    // Editing the source input must change what a later recompute of the continuation
    // sees — the reference is live, not a frozen copy (P4.8/P6.2 auto-cascade comes later).
    const ten = Object.values(doc.nodes).find((n) => n.kind === 'number' && n.raw === '10')!;
    setNodeRaw(ten.id, '20');

    const contEquals = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'equals' && n.chainId === contResult!.chainId,
    )!;
    deleteNode(contEquals.id);
    const op = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'operator' && n.chainId === contResult!.chainId,
    )!;
    // After deleting =, the continuation result is gone; find the number operand and re-equals.
    const two = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'number' && n.raw === '2' && n.chainId === op.chainId,
    )!;
    appendEqualsNode(two.id);

    const refreshed = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result' && n.chainId === op.chainId,
    );
    expect(refreshed?.kind).toBe('result');
    expect(refreshed && refreshed.kind === 'result' ? refreshed.derived?.display : undefined).toBe('50');
  });

  test('operator on a selected chain-member number extends that chain in place, not a link', () => {
    // 1 + 2 =
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const before = useDocumentStore.getState().document;
    const two = Object.values(before.nodes).find(
      (n) => n.kind === 'number' && n.raw === '2',
    )!;
    const chainId = two.chainId!;
    const membersBefore = before.chains[chainId]!.members;
    expect(membersBefore.map((id) => before.nodes[id]!.kind)).toEqual([
      'number',
      'operator',
      'number',
      'equals',
      'result',
    ]);

    // Select `2` (tap-selected, not editing) and press `+`.
    selectNode(two.id);
    expect(useUiStore.getState().editingNodeId).toBeNull();
    dispatchEditorCommand({ region: 'operator', op: '+' });

    const doc = useDocumentStore.getState().document;
    // No reference/link was created — this must not be §8.7 continuation.
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'reference')).toHaveLength(0);
    // Same chain, now [1, +, 2, +, <empty>, =] — the new operand lands right after `2`,
    // pushing the stale `=` rightward rather than past it. The formula is Incomplete
    // (trailing operator, empty operand) until filled in, so the stale result is
    // dropped rather than kept showing a value the expression no longer implies.
    const afterMembers = doc.chains[chainId]!.members;
    expect(afterMembers).toHaveLength(6);
    expect(afterMembers.map((id) => doc.nodes[id]!.kind)).toEqual([
      'number',
      'operator',
      'number',
      'operator',
      'number',
      'equals',
    ]);
    expect(afterMembers[0]).toBe(membersBefore[0]);
    expect(afterMembers[2]).toBe(two.id);
    expect(doc.nodes[afterMembers[3]!]).toMatchObject({ kind: 'operator', op: '+' });
    expect(doc.nodes[afterMembers[4]!]).toMatchObject({ kind: 'number', raw: '' });
    // Trailing `=` is the same node, just shifted right.
    expect(afterMembers[5]).toBe(membersBefore[3]);
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'result')).toHaveLength(0);

    expect(useUiStore.getState().selectedNodeId).toBe(afterMembers[4]);
    expect(useUiStore.getState().editingNodeId).toBe(afterMembers[4]);

    // Filling in the new operand recomputes: 1 + 2 + 6 = 9.
    dispatchEditorCommand({ region: 'digit', value: '6' });
    const recomputed = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    );
    expect(recomputed).toMatchObject({ kind: 'result', derived: { display: '9' } });
  });

  test('operator on a selected mid-chain number (no `=` yet) still extends in place', () => {
    // 1 + 2 + 3, no equals — select the middle `2` and insert `×` right after it.
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '3' });

    const before = useDocumentStore.getState().document;
    const two = Object.values(before.nodes).find(
      (n) => n.kind === 'number' && n.raw === '2',
    )!;
    const chainId = two.chainId!;

    selectNode(two.id);
    dispatchEditorCommand({ region: 'operator', op: '×' });

    const doc = useDocumentStore.getState().document;
    expect(Object.values(doc.nodes).filter((n) => n.kind === 'reference')).toHaveLength(0);
    const members = doc.chains[chainId]!.members;
    expect(members.map((id) => doc.nodes[id]!.kind)).toEqual([
      'number',
      'operator',
      'number',
      'operator',
      'number',
      'operator',
      'number',
    ]);
    expect(doc.nodes[members[3]!]).toMatchObject({ kind: 'operator', op: '×' });
    expect(doc.nodes[members[4]!]).toMatchObject({ kind: 'number', raw: '' });
    // The original trailing `3` is still last, just pushed one slot further right.
    expect(doc.nodes[members[6]!]).toMatchObject({ kind: 'number', raw: '3' });
  });
});

describe('dispatchEditorCommand: backspace on a selected (not editing) number trims a digit (§8.5)', () => {
  test('trims one digit at a time, staying selected and editing, before the cell empties', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '12');
    selectNode(a); // tap-selected, not editing — the reported gap.

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[a]).toMatchObject({ raw: '1' });
    expect(useUiStore.getState().selectedNodeId).toBe(a);
    expect(useUiStore.getState().editingNodeId).toBe(a);
  });

  test('reaching an empty cell keeps it selected instead of auto-discarding', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '5');
    selectNode(a);

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[a]).toMatchObject({ raw: '' });
    expect(useUiStore.getState().selectedNodeId).toBe(a);
  });

  test('a second backspace on an already-empty number deletes it and selects its left neighbour', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const built = appendOperatorAndNumber(a, '+');
    setNodeRaw(built.numberId, '9');
    selectNode(built.numberId);
    dispatchEditorCommand({ region: 'backspace' }); // '9' -> ''
    expect(nodes()[built.numberId]).toMatchObject({ raw: '' });

    dispatchEditorCommand({ region: 'backspace' }); // '' -> deleted, land on '+'

    expect(nodes()[built.numberId]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBe(built.operatorId);
  });

  test('a free (chainless) empty number falls back to full deselect, same as before', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '9');
    selectNode(a);
    dispatchEditorCommand({ region: 'backspace' }); // '9' -> ''

    dispatchEditorCommand({ region: 'backspace' }); // '' -> deleted, no neighbour

    expect(nodes()[a]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });
});

describe('dispatchEditorCommand: backspace on a selected operator lands on its left neighbour (§8.5)', () => {
  test('deletes the operator and selects the chain member to its left', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const built = appendOperatorAndNumber(a, '+');
    setNodeRaw(built.numberId, '2');
    selectNode(built.operatorId);

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[built.operatorId]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBe(a);
    // The chain still holds together — '2' just lost its operator, not its chain.
    const doc = useDocumentStore.getState().document;
    expect(doc.chains[doc.nodes[a]!.chainId!]!.members).toEqual([a, built.numberId]);
  });

  test('an operator with nothing to its left falls back to full deselect', () => {
    const a = addOperatorNode({ x: 0, y: 0 }, '+');
    const numberId = appendNumberNode(a, '2');
    selectNode(a);

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[a]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
    expect(nodes()[numberId]).toBeDefined();
  });
});

describe('dispatchEditorCommand: digit on a selected operator targets its right operand (§8.5)', () => {
  test('no number cell to the right: inserts a fresh one with the typed digit', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const built = appendOperatorAndNumber(a, '+');
    deleteNode(built.numberId); // same state a backspace-emptied-then-deleted operand leaves
    selectNode(built.operatorId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'digit', value: '9' });

    const doc = useDocumentStore.getState().document;
    const chain = doc.chains[doc.nodes[a]!.chainId!]!;
    expect(chain.members).toHaveLength(3);
    const newId = chain.members[2]!;
    expect(doc.nodes[newId]).toMatchObject({ kind: 'number', raw: '9' });
    expect(useUiStore.getState().selectedNodeId).toBe(newId);
    expect(useUiStore.getState().editingNodeId).toBe(newId);
    expect(useDocumentStore.getState().undoStack).toHaveLength(before + 1);
  });

  test('a number cell to the right: edits it in place, appending rather than duplicating', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const built = appendOperatorAndNumber(a, '+');
    setNodeRaw(built.numberId, '2');
    selectNode(built.operatorId);
    const membersBefore =
      useDocumentStore.getState().document.chains[nodes()[a]!.chainId!]!.members.length;

    dispatchEditorCommand({ region: 'digit', value: '9' });

    expect(nodes()[built.numberId]).toMatchObject({ kind: 'number', raw: '29' });
    expect(useUiStore.getState().selectedNodeId).toBe(built.numberId);
    expect(useUiStore.getState().editingNodeId).toBe(built.numberId);
    const doc = useDocumentStore.getState().document;
    expect(doc.chains[doc.nodes[a]!.chainId!]!.members).toHaveLength(membersBefore);
  });

  test('decimal and sign on the right neighbour follow the same one-separator / toggle rules as editing it directly', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const built = appendOperatorAndNumber(a, '+');
    setNodeRaw(built.numberId, '2.5');
    selectNode(built.operatorId);

    dispatchEditorCommand({ region: 'decimal' }); // already has one — ignored
    dispatchEditorCommand({ region: 'sign' });

    expect(nodes()[built.numberId]).toMatchObject({ kind: 'number', raw: '-2.5' });
  });

  test('the cell to the right is a linked cell: digit no-ops', () => {
    const chainId = 'c_op_ref_test';
    const opId = 'n_op_ref_test_op';
    const refId = 'n_op_ref_test_ref';
    const source = addNumberNode({ x: 0, y: 0 }, '7');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains[chainId] = { id: chainId, members: [opId, refId], anchor: { x: 0, y: 0 } };
      draft.nodes[opId] = {
        id: opId,
        kind: 'operator',
        op: '+',
        position: { x: 0, y: 0 },
        chainId,
        createdAt: Date.now(),
      };
      draft.nodes[refId] = {
        id: refId,
        kind: 'reference',
        position: { x: 40, y: 0 },
        chainId,
        createdAt: Date.now(),
        targetNodeId: source,
      };
    });
    selectNode(opId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'digit', value: '9' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(opId);
    expect(useDocumentStore.getState().document.chains[chainId]!.members).toEqual([opId, refId]);
  });

  test('the cell to the right is a result: digit no-ops', () => {
    const chainId = 'c_op_result_test';
    const opId = 'n_op_result_test_op';
    const resultId = 'n_op_result_test_result';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains[chainId] = { id: chainId, members: [opId, resultId], anchor: { x: 0, y: 0 } };
      draft.nodes[opId] = {
        id: opId,
        kind: 'operator',
        op: '+',
        position: { x: 0, y: 0 },
        chainId,
        createdAt: Date.now(),
      };
      draft.nodes[resultId] = {
        id: resultId,
        kind: 'result',
        position: { x: 40, y: 0 },
        chainId,
        createdAt: Date.now(),
        sourceChainId: chainId,
      };
    });
    selectNode(opId);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'digit', value: '9' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(opId);
  });
});

describe('dispatchEditorCommand: Create link keypad button (§8.6)', () => {
  test('on a selected number, drops a free reference and selects it', () => {
    const n = addNumberNode({ x: 0, y: 0 }, '3');
    selectNode(n);

    dispatchEditorCommand({ region: 'createLink' });

    const doc = useDocumentStore.getState().document;
    const refs = Object.values(doc.nodes).filter((node) => node.kind === 'reference');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: 'reference', targetNodeId: n, chainId: null });
    expect(useUiStore.getState().selectedNodeId).toBe(refs[0]!.id);
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('on a selected result, drops a free reference to the result', () => {
    dispatchEditorCommand({ region: 'digit', value: '3' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '4' });
    dispatchEditorCommand({ region: 'equals' });
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (node) => node.kind === 'result',
    )!;
    selectNode(result.id);

    dispatchEditorCommand({ region: 'createLink' });

    const refs = Object.values(useDocumentStore.getState().document.nodes).filter(
      (node) => node.kind === 'reference',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: 'reference', targetNodeId: result.id });
  });

  test('on a selected live reference, drops a second reference to it (chaining links, unlike operator)', () => {
    const n = addNumberNode({ x: 0, y: 0 }, '3');
    const firstRef = createLinkToValue(n);
    selectNode(firstRef);

    dispatchEditorCommand({ region: 'createLink' });

    const refs = Object.values(useDocumentStore.getState().document.nodes).filter(
      (node) => node.kind === 'reference',
    );
    expect(refs).toHaveLength(2);
    const child = refs.find((r) => r.targetNodeId === firstRef)!;
    expect(child).toBeDefined();
    expect(useUiStore.getState().selectedNodeId).toBe(child.id);
  });

  test('on a selected dangling reference, no-ops', () => {
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
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'createLink' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(
      Object.values(useDocumentStore.getState().document.nodes).filter(
        (node) => node.kind === 'reference' && node.id !== 'dangling',
      ),
    ).toHaveLength(0);
  });

  test('with nothing selected, no-ops', () => {
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'createLink' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(
      Object.values(useDocumentStore.getState().document.nodes).filter(
        (node) => node.kind === 'reference',
      ),
    ).toHaveLength(0);
  });
});

describe('dispatchEditorCommand: arrows move selection along a chain (§8.5)', () => {
  test('moves from a selected member to its neighbour, and stops at the ends', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addOperatorNode({ x: 0, y: 0 }, '+');
    const c = addNumberNode({ x: 0, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_ab = { id: 'c_ab', members: [a, b, c], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_ab';
      draft.nodes[b].chainId = 'c_ab';
      draft.nodes[c].chainId = 'c_ab';
    });
    selectNode(b);

    dispatchEditorCommand({ region: 'arrow', direction: 'right' });
    expect(useUiStore.getState().selectedNodeId).toBe(c);
    // Numbers are selected without editing so a following operator can continue (§8.7).
    expect(useUiStore.getState().editingNodeId).toBeNull();

    dispatchEditorCommand({ region: 'arrow', direction: 'right' });
    expect(useUiStore.getState().selectedNodeId).toBe(c); // already at the end

    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    expect(useUiStore.getState().selectedNodeId).toBe(a);
    expect(useUiStore.getState().editingNodeId).toBeNull();
    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    expect(useUiStore.getState().selectedNodeId).toBe(a); // already at the start
  });

  test('a free node (no chain) does not move on arrow keys', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    selectNode(id);

    dispatchEditorCommand({ region: 'arrow', direction: 'right' });

    expect(useUiStore.getState().selectedNodeId).toBe(id);
  });

  test('no selection is a no-op', () => {
    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });
});

describe('dispatchEditorCommand: arrows move selection between chains (P7.2)', () => {
  test('ArrowDown / ArrowUp jump to the nearest chain, landing on the closest member in x', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addOperatorNode({ x: 40, y: 0 }, '+');
    const c = addNumberNode({ x: 80, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_top = { id: 'c_top', members: [a, b, c], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_top';
      draft.nodes[b].chainId = 'c_top';
      draft.nodes[c].chainId = 'c_top';
      draft.nodes[a].position = { x: 0, y: 0 };
      draft.nodes[b].position = { x: 40, y: 0 };
      draft.nodes[c].position = { x: 80, y: 0 };
    });

    const d = addNumberNode({ x: 50, y: 120 }, '3');
    const e = addOperatorNode({ x: 90, y: 120 }, '×');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_bot = { id: 'c_bot', members: [d, e], anchor: { x: 50, y: 120 } };
      draft.nodes[d].chainId = 'c_bot';
      draft.nodes[e].chainId = 'c_bot';
      draft.nodes[d].position = { x: 50, y: 120 };
      draft.nodes[e].position = { x: 90, y: 120 };
    });

    selectNode(a); // x=0 on the top chain
    dispatchEditorCommand({ region: 'arrow', direction: 'down' });
    // Nearest bottom member to x=0 is d at x=50
    expect(useUiStore.getState().selectedNodeId).toBe(d);
    expect(useUiStore.getState().editingNodeId).toBeNull();

    selectNode(c); // x=80 on the top chain
    dispatchEditorCommand({ region: 'arrow', direction: 'down' });
    // Nearest to x=80 is e at x=90 (closer than d at 50)
    expect(useUiStore.getState().selectedNodeId).toBe(e);

    dispatchEditorCommand({ region: 'arrow', direction: 'up' });
    expect(useUiStore.getState().selectedNodeId).toBe(c);
  });

  test('ArrowDown reaches a free node below when no other chain is closer', () => {
    const top = addNumberNode({ x: 0, y: 0 }, '1');
    selectNode(top);
    // Force free (addNumberNode leaves chainId null already)
    const free = addNumberNode({ x: 10, y: 200 }, '9');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[free].position = { x: 10, y: 200 };
    });

    dispatchEditorCommand({ region: 'arrow', direction: 'down' });
    expect(useUiStore.getState().selectedNodeId).toBe(free);
  });

  test('ArrowUp / ArrowDown are no-ops when nothing lies in that direction', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    selectNode(id);
    dispatchEditorCommand({ region: 'arrow', direction: 'up' });
    expect(useUiStore.getState().selectedNodeId).toBe(id);
    dispatchEditorCommand({ region: 'arrow', direction: 'down' });
    expect(useUiStore.getState().selectedNodeId).toBe(id);
  });
});

describe('chainHasEquals (§9: at most one = per chain)', () => {
  test('false for a free node, a chain with no equals, and a missing/null id', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    const free = Object.values(nodes()).find((n) => n.kind === 'number')!;
    expect(chainHasEquals(free.id, nodes(), useDocumentStore.getState().document.chains)).toBe(false);
    expect(chainHasEquals(null, nodes(), useDocumentStore.getState().document.chains)).toBe(false);
    expect(chainHasEquals('missing', nodes(), useDocumentStore.getState().document.chains)).toBe(false);

    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    const doc = useDocumentStore.getState().document;
    const one = Object.values(doc.nodes).find((n) => n.kind === 'number' && n.raw === '1')!;
    expect(chainHasEquals(one.id, doc.nodes, doc.chains)).toBe(false);
  });

  test('true for every member once the chain has an equals, including the equals/result themselves', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });

    const doc = useDocumentStore.getState().document;
    const one = Object.values(doc.nodes).find((n) => n.kind === 'number' && n.raw === '1')!;
    for (const id of doc.chains[one.chainId!]!.members) {
      expect(chainHasEquals(id, doc.nodes, doc.chains)).toBe(true);
    }
  });
});

describe('dispatchEditorCommand: Select-group mode (§8.5)', () => {
  test('groupContainsResult is true only when a result id is in the set', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    expect(groupContainsResult(new Set([a]), nodes())).toBe(false);
    const resultId = 'n_result_group';
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[resultId] = {
        id: resultId,
        kind: 'result',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: Date.now(),
        sourceChainId: 'c_missing',
      };
    });
    expect(groupContainsResult(new Set([a, resultId]), nodes())).toBe(true);
  });

  test('backspace deletes the whole group in one undo entry', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const op = addOperatorNode({ x: 50, y: 0 }, '+');
    const b = addNumberNode({ x: 84, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.ch = { id: 'ch', members: [a, op, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'ch';
      draft.nodes[op].chainId = 'ch';
      draft.nodes[b].chainId = 'ch';
    });
    selectGroup(op);
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[a]).toBeUndefined();
    expect(nodes()[op]).toBeUndefined();
    expect(nodes()[b]).toBeUndefined();
    expect(useUiStore.getState().groupSelectedIds.size).toBe(0);
    expect(useDocumentStore.getState().undoStack).toHaveLength(before + 1);
  });

  test('digits are no-ops while a group is selected', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const op = addOperatorNode({ x: 50, y: 0 }, '+');
    const b = addNumberNode({ x: 84, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.ch = { id: 'ch', members: [a, op, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'ch';
      draft.nodes[op].chainId = 'ch';
      draft.nodes[b].chainId = 'ch';
    });
    selectGroup(op);
    const nodeCount = Object.keys(nodes()).length;

    dispatchEditorCommand({ region: 'digit', value: '9' });

    expect(Object.keys(nodes())).toHaveLength(nodeCount);
    expect(useUiStore.getState().groupSelectedIds.size).toBe(3);
  });

  test('operator on a group with a result continues from that result', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '10');
    const { operatorId: op, numberId: b } = appendOperatorAndNumber(a, '+');
    setNodeRaw(b, '5');
    appendEqualsNode(b);
    const result = Object.values(nodes()).find((n) => n.kind === 'result')!;
    selectGroup(op);

    dispatchEditorCommand({ region: 'operator', op: '×' });

    expect(useUiStore.getState().groupSelectedIds.size).toBe(0);
    const selectedId = useUiStore.getState().selectedNodeId!;
    const selected = nodes()[selectedId];
    expect(selected).toMatchObject({ kind: 'number', raw: '' });
    expect(useUiStore.getState().editingNodeId).toBe(selectedId);
    const contChain = useDocumentStore.getState().document.chains[selected!.chainId!];
    expect(contChain.members).toHaveLength(3);
    const ref = nodes()[contChain.members[0]!];
    expect(ref).toMatchObject({ kind: 'reference', targetNodeId: result.id });
    expect(nodes()[contChain.members[1]!]).toMatchObject({ kind: 'operator', op: '×' });
    expect(contChain.members[2]).toBe(selectedId);
  });

  test('createLink on a group with a result links that result', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '10');
    const { operatorId: op, numberId: b } = appendOperatorAndNumber(a, '+');
    setNodeRaw(b, '5');
    appendEqualsNode(b);
    const result = Object.values(nodes()).find((n) => n.kind === 'result')!;
    selectGroup(op);

    dispatchEditorCommand({ region: 'createLink' });

    // Group selection is cleared by the reference's own selection, same as the
    // operator-continuation case above.
    expect(useUiStore.getState().groupSelectedIds.size).toBe(0);
    const selectedId = useUiStore.getState().selectedNodeId!;
    const selected = nodes()[selectedId];
    expect(selected).toMatchObject({ kind: 'reference', targetNodeId: result.id });
    // Unlike continuation, the new reference isn't attached to any chain.
    expect(selected!.chainId).toBeNull();
  });

  test('createLink on a group without a result is a no-op', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const op = addOperatorNode({ x: 50, y: 0 }, '+');
    const b = addNumberNode({ x: 84, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.ch = { id: 'ch', members: [a, op, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'ch';
      draft.nodes[op].chainId = 'ch';
      draft.nodes[b].chainId = 'ch';
    });
    selectGroup(op);
    const before = Object.keys(nodes()).length;

    dispatchEditorCommand({ region: 'createLink' });

    expect(Object.keys(nodes())).toHaveLength(before);
    expect(useUiStore.getState().groupSelectedIds.size).toBe(3);
  });
});

describe('dispatchEditorCommand: undo / redo and Escape dismiss (P7.2)', () => {
  test('undo and redo drive the document stack', () => {
    dispatchEditorCommand({ region: 'digit', value: '7' });
    const id = useUiStore.getState().selectedNodeId!;
    expect(nodes()[id]).toMatchObject({ raw: '7' });

    dispatchEditorCommand({ region: 'undo' });
    expect(nodes()[id]).toBeUndefined();

    dispatchEditorCommand({ region: 'redo' });
    expect(nodes()[id]).toMatchObject({ raw: '7' });
  });

  test('Escape deselects first; a second Escape with nothing focused hides the keypad', () => {
    useUiStore.getState().showKeypad();
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    editNumberNode(id);
    expect(useUiStore.getState().keypadVisible).toBe(true);

    dispatchEditorCommand({ region: 'escape' });
    expect(useUiStore.getState().selectedNodeId).toBeNull();
    expect(useUiStore.getState().keypadVisible).toBe(true); // still showing

    dispatchEditorCommand({ region: 'escape' });
    expect(useUiStore.getState().keypadVisible).toBe(false);
  });
});

describe('dispatchEditorCommand: Select all locks data-entry (§8.6)', () => {
  test('digits and operators are no-ops while the whole canvas is selected', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 40, y: 0 }, '2');
    selectAll();
    expect(useUiStore.getState().groupSelectedIds).toEqual(new Set([a, b]));

    dispatchEditorCommand({ region: 'digit', value: '9' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    expect(nodes()[a]).toMatchObject({ raw: '1' });
    expect(nodes()[b]).toMatchObject({ raw: '2' });
    expect(Object.keys(nodes())).toHaveLength(2);
  });

  test('undo / redo / Escape still work under Select all', () => {
    addNumberNode({ x: 0, y: 0 }, '3');
    const second = addNumberNode({ x: 40, y: 0 }, '4');
    selectAll();
    const before = useDocumentStore.getState().undoStack.length;

    dispatchEditorCommand({ region: 'undo' });
    expect(nodes()[second]).toBeUndefined();
    expect(useDocumentStore.getState().undoStack.length).toBeLessThan(before);

    dispatchEditorCommand({ region: 'redo' });
    expect(nodes()[second]).toMatchObject({ raw: '4' });
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);

    selectAll();
    dispatchEditorCommand({ region: 'escape' });
    expect(useUiStore.getState().groupSelectedIds.size).toBe(0);
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });
});
