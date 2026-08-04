import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import {
  addNumberNode,
  addOperatorNode,
  addParenNode,
  addEqualsNode,
  setNodeRaw,
  deleteNode,
  clearDocument,
  selectNode,
  editNumberNode,
  deselectNode,
} from './commands';
import { createEmptyDocument } from '../model/factories';

function resetStore() {
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
  });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null });
}

beforeEach(resetStore);
afterEach(() => jest.useRealTimers());

describe('addNumberNode', () => {
  test('adds a free number node with an authoritative position', () => {
    const id = addNumberNode({ x: 10, y: 20 }, '42');
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({
      kind: 'number',
      raw: '42',
      position: { x: 10, y: 20 },
      chainId: null,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('undo removes it, redo restores it', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '1' });
  });
});

describe('addOperatorNode', () => {
  test('adds a free operator node', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '+');
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({
      kind: 'operator',
      op: '+',
      chainId: null,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('undo removes it, redo restores it', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '×');
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ op: '×' });
  });
});

describe('addParenNode', () => {
  test('adds a free paren node', () => {
    const id = addParenNode({ x: 0, y: 0 }, 'open');
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({
      kind: 'paren',
      side: 'open',
      chainId: null,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('undo removes it, redo restores it', () => {
    const id = addParenNode({ x: 0, y: 0 }, 'close');
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ side: 'close' });
  });
});

describe('addEqualsNode', () => {
  test('adds a free equals node', () => {
    const id = addEqualsNode({ x: 5, y: 5 });
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({
      kind: 'equals',
      chainId: null,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('undo removes it, redo restores it', () => {
    const id = addEqualsNode({ x: 0, y: 0 });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeDefined();
  });
});

describe('setNodeRaw', () => {
  test("edits a number node's raw value", () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    setNodeRaw(id, '12');
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '12' });
  });

  test('throws rather than silently no-opping on a node that is not a number', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '+');
    const before = useDocumentStore.getState().undoStack.length;
    expect(() => setNodeRaw(id, '5')).toThrow(/read-only/);
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });

  test('a no-op edit (raw unchanged) records no history entry', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    const before = useDocumentStore.getState().undoStack.length;
    setNodeRaw(id, '1');
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });

  test('successive edits to the same node within 500ms coalesce into one undo entry', () => {
    jest.useFakeTimers();
    const id = addNumberNode({ x: 0, y: 0 }, '');
    const stackAfterAdd = useDocumentStore.getState().undoStack.length;

    setNodeRaw(id, '1');
    jest.advanceTimersByTime(100);
    setNodeRaw(id, '12');
    jest.advanceTimersByTime(100);
    setNodeRaw(id, '123');

    expect(useDocumentStore.getState().undoStack).toHaveLength(stackAfterAdd + 1);
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '123' });

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '' });
  });

  test('edits more than 500ms apart do not coalesce', () => {
    jest.useFakeTimers();
    const id = addNumberNode({ x: 0, y: 0 }, '');
    const stackAfterAdd = useDocumentStore.getState().undoStack.length;

    setNodeRaw(id, '1');
    jest.advanceTimersByTime(600);
    setNodeRaw(id, '12');

    expect(useDocumentStore.getState().undoStack).toHaveLength(stackAfterAdd + 2);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '1' });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '' });
  });

  test('edits to a different node do not coalesce with an in-progress burst', () => {
    jest.useFakeTimers();
    const a = addNumberNode({ x: 0, y: 0 }, '');
    const b = addNumberNode({ x: 10, y: 0 }, '');
    const stackBefore = useDocumentStore.getState().undoStack.length;

    setNodeRaw(a, '1');
    jest.advanceTimersByTime(100);
    setNodeRaw(b, '2');

    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 2);
  });
});

describe('deleteNode', () => {
  test('removes a free node', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    deleteNode(id);
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
  });

  test('undo restores it, redo removes it again', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    deleteNode(id);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '1' });
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
  });

  test('deleting a chain member drops it from chain.members without a dangling id', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 20, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_test = { id: 'c_test', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_test';
      draft.nodes[b].chainId = 'c_test';
    });

    deleteNode(a);

    expect(useDocumentStore.getState().document.chains.c_test.members).toEqual([b]);
  });

  test('deleting the last member of a chain removes the chain', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_solo = { id: 'c_solo', members: [a], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_solo';
    });

    deleteNode(a);

    expect(useDocumentStore.getState().document.chains.c_solo).toBeUndefined();
  });

  test('deleting a node that does not exist is a no-op', () => {
    const before = useDocumentStore.getState().undoStack.length;
    deleteNode('does-not-exist');
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });
});

describe('clearDocument', () => {
  test('removes every node and chain in a single undo entry', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 20, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_test = { id: 'c_test', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_test';
      draft.nodes[b].chainId = 'c_test';
    });
    const stackBefore = useDocumentStore.getState().undoStack.length;

    clearDocument();

    expect(useDocumentStore.getState().document.nodes).toEqual({});
    expect(useDocumentStore.getState().document.chains).toEqual({});
    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 1);
  });

  test('undo restores every node and chain that clearing removed', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    clearDocument();

    useDocumentStore.getState().undo();

    expect(useDocumentStore.getState().document.nodes[a]).toMatchObject({ raw: '1' });
  });

  test('clearing an already-empty document is a no-op', () => {
    const before = useDocumentStore.getState().undoStack.length;
    clearDocument();
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });
});

describe('selectNode / editNumberNode / deselectNode', () => {
  test('selectNode selects without entering edit mode', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '+');
    selectNode(id);
    expect(useUiStore.getState().selectedNodeId).toBe(id);
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('editNumberNode selects and edits the same node', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(id);
    expect(useUiStore.getState().selectedNodeId).toBe(id);
    expect(useUiStore.getState().editingNodeId).toBe(id);
  });

  test('deselectNode clears both', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    editNumberNode(id);
    deselectNode();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('moving selection away from an empty in-progress number discards it', () => {
    const empty = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(empty);
    const other = addNumberNode({ x: 50, y: 0 }, '9');

    selectNode(other);

    expect(useDocumentStore.getState().document.nodes[empty]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBe(other);
  });

  test('deselecting discards an empty in-progress number', () => {
    const empty = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(empty);

    deselectNode();

    expect(useDocumentStore.getState().document.nodes[empty]).toBeUndefined();
  });

  test('a non-empty in-progress number survives moving the selection away', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    editNumberNode(id);
    deselectNode();
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3' });
  });

  test('re-selecting the node currently being edited does not delete it', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    editNumberNode(id);
    editNumberNode(id);
    expect(useDocumentStore.getState().document.nodes[id]).toBeDefined();
  });
});
