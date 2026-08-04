import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { addNumberNode, addOperatorNode, addParenNode, selectNode, editNumberNode, setNodeRaw, deleteNode, appendEqualsNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { commandFromHardwareKey, dispatchEditorCommand } from './keymap';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null, lastInteractionPoint: { x: 0, y: 0 } });
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
});

describe('dispatchEditorCommand: continuation from a result (P4.9, §8.7)', () => {
  test('operator with a result selected creates [reference→R, ⊕] below-right and selects the operator', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '0' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'equals' });

    const afterEquals = useDocumentStore.getState().document;
    const result = Object.values(afterEquals.nodes).find((n) => n.kind === 'result');
    expect(result).toBeDefined();
    selectNode(result!.id);

    dispatchEditorCommand({ region: 'operator', op: '×' });

    const doc = useDocumentStore.getState().document;
    const refs = Object.values(doc.nodes).filter((n) => n.kind === 'reference');
    expect(refs).toHaveLength(1);
    const ref = refs[0]!;
    expect(ref).toMatchObject({ kind: 'reference', targetNodeId: result!.id });

    const contChain = doc.chains[ref.chainId!]!;
    expect(contChain).toBeDefined();
    expect(contChain.members).toHaveLength(2);
    expect(doc.nodes[contChain.members[0]!]!.kind).toBe('reference');
    expect(doc.nodes[contChain.members[1]!]!).toMatchObject({ kind: 'operator', op: '×' });

    expect(contChain.anchor).toEqual({
      x: result!.position.x + 32,
      y: result!.position.y + 96,
    });

    const selectedId = useUiStore.getState().selectedNodeId;
    expect(selectedId).toBe(contChain.members[1]);
    expect(doc.nodes[result!.id]!.kind).toBe('result');
  });

  test('digit / paren / equals with a result selected still no-op (result is read-only)', () => {
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
    dispatchEditorCommand({ region: 'paren', side: 'open' });
    dispatchEditorCommand({ region: 'equals' });

    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
    expect(useUiStore.getState().selectedNodeId).toBe(resultId);
  });

  test('backspace still deletes a selected result', () => {
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

    dispatchEditorCommand({ region: 'backspace' });

    expect(nodes()[resultId]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });

  test('full keystroke path: continue, type operand, = uses live reference value', () => {
    dispatchEditorCommand({ region: 'digit', value: '1' });
    dispatchEditorCommand({ region: 'digit', value: '0' });
    dispatchEditorCommand({ region: 'operator', op: '+' });
    dispatchEditorCommand({ region: 'digit', value: '5' });
    dispatchEditorCommand({ region: 'equals' });

    const result = Object.values(useDocumentStore.getState().document.nodes).find((n) => n.kind === 'result')!;
    selectNode(result.id);
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
    expect(useUiStore.getState().editingNodeId).toBe(c); // c is a number - lands in edit mode

    dispatchEditorCommand({ region: 'arrow', direction: 'right' });
    expect(useUiStore.getState().selectedNodeId).toBe(c); // already at the end

    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    dispatchEditorCommand({ region: 'arrow', direction: 'left' });
    expect(useUiStore.getState().selectedNodeId).toBe(a);
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
