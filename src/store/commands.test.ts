import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
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
  CONTINUATION_OFFSET,
  setNodeRaw,
  deleteNode,
  clearDocument,
  selectNode,
  editNumberNode,
  deselectNode,
  selectGroup,
  prependToChain,
  appendToChain,
  insertIntoChain,
  formNewChain,
  detachNode,
  commitSnapOutcome,
  moveFreeNode,
  moveChain,
  unlinkFromParent,
  repointReference,
} from './commands';
import { createEmptyDocument } from '../model/factories';
import { tokens } from '../ui/tokens';
import { insertionFeedback, layoutChain } from '../chains/layout';
import { widthOf } from '../chains/measure';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
  });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null, groupSelectedIds: new Set() });
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

describe('appendNumberNode / appendParenNode / appendEqualsNode (P2.8 chain building)', () => {
  test('appending to a free node creates a one-member chain first, then a two-member one', () => {
    const first = addNumberNode({ x: 100, y: 50 }, '1');

    const second = appendParenNode(first, 'open');

    const chainId = useDocumentStore.getState().document.nodes[first]!.chainId;
    expect(chainId).not.toBeNull();
    const chain = useDocumentStore.getState().document.chains[chainId!];
    expect(chain).toMatchObject({ anchor: { x: 100, y: 50 }, members: [first, second] });
    expect(useDocumentStore.getState().document.nodes[second]).toMatchObject({
      kind: 'paren',
      side: 'open',
      chainId,
      position: { x: 100 + tokens.nodeHeight, y: 50 }, // number width floors at nodeHeight for '1'
    });
  });

  test('a third append lands after both existing members, in the same chain', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '1');
    const second = appendParenNode(first, 'open');

    const third = appendEqualsNode(second);

    const chainId = useDocumentStore.getState().document.nodes[first]!.chainId;
    expect(useDocumentStore.getState().document.chains[chainId!].members).toEqual([first, second, third]);
    expect(useDocumentStore.getState().document.nodes[third]).toMatchObject({
      kind: 'equals',
      position: { x: tokens.nodeHeight + tokens.operatorWidth, y: 0 },
    });
  });

  test('appendNumberNode inserts the given raw directly', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '1');
    const second = appendNumberNode(first, '-');
    expect(useDocumentStore.getState().document.nodes[second]).toMatchObject({ kind: 'number', raw: '-' });
  });

  test('appending to a node already in a chain reuses that chain and its anchor', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '1');
    const second = appendParenNode(first, 'open');
    const firstChainId = useDocumentStore.getState().document.nodes[first]!.chainId;

    const third = appendEqualsNode(second);

    expect(useDocumentStore.getState().document.nodes[third]!.chainId).toBe(firstChainId);
    expect(useDocumentStore.getState().document.chains[firstChainId!].anchor).toEqual({ x: 0, y: 0 });
  });

  test('appending to a node that no longer exists is a no-op', () => {
    const before = useDocumentStore.getState().undoStack.length;
    appendParenNode('does-not-exist', 'open');
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });

  test('undo removes the appended node and dissolves the chain it created', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '1');
    appendParenNode(first, 'open');

    useDocumentStore.getState().undo();

    expect(useDocumentStore.getState().document.nodes[first]).toMatchObject({ chainId: null });
    expect(useDocumentStore.getState().document.chains).toEqual({});
  });
});

describe('appendOperatorAndNumber', () => {
  test('appends an operator and a fresh empty number in one undo entry', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '12');
    const stackBefore = useDocumentStore.getState().undoStack.length;

    const { operatorId, numberId } = appendOperatorAndNumber(first, '+');

    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 1);
    const chainId = useDocumentStore.getState().document.nodes[first]!.chainId;
    expect(useDocumentStore.getState().document.chains[chainId!].members).toEqual([first, operatorId, numberId]);
    expect(useDocumentStore.getState().document.nodes[operatorId]).toMatchObject({ kind: 'operator', op: '+' });
    expect(useDocumentStore.getState().document.nodes[numberId]).toMatchObject({ kind: 'number', raw: '' });
  });

  test('undo removes both the operator and the number together', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '12');
    appendOperatorAndNumber(first, '+');

    useDocumentStore.getState().undo();

    expect(useDocumentStore.getState().document.nodes[first]).toMatchObject({ chainId: null });
    expect(Object.keys(useDocumentStore.getState().document.nodes)).toEqual([first]);
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

  test('a raw edit that widens a member re-flows the rest of its chain in the same commit (P3.1, §8.1)', () => {
    const first = addNumberNode({ x: 0, y: 0 }, '1');
    const { operatorId, numberId } = appendOperatorAndNumber(first, '+');
    const operatorXBefore = useDocumentStore.getState().document.nodes[operatorId]!.position.x;
    const numberXBefore = useDocumentStore.getState().document.nodes[numberId]!.position.x;

    setNodeRaw(first, '999999'); // much wider than '1', which floors at nodeHeight

    const nodes = useDocumentStore.getState().document.nodes;
    expect(nodes[first]!.position.x).toBe(0); // anchor member itself never moves
    expect(nodes[operatorId]!.position.x).toBeGreaterThan(operatorXBefore);
    expect(nodes[numberId]!.position.x).toBeGreaterThan(numberXBefore);
    // Still flush: no gap between the widened first member and the operator that follows it.
    expect(nodes[operatorId]!.position.x).toBe(nodes[first]!.position.x + widthOf(nodes[first]!, 'en-US'));
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

  test('deleting a chain member drops it from chain.members; a leftover sole member dissolves to free', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 20, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c_test = { id: 'c_test', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c_test';
      draft.nodes[b].chainId = 'c_test';
    });

    deleteNode(a);

    // §8.3: a chain that drops to one member dissolves; the survivor becomes free.
    expect(useDocumentStore.getState().document.chains.c_test).toBeUndefined();
    expect(useDocumentStore.getState().document.nodes[b]).toMatchObject({
      chainId: null,
    });
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

describe('selectGroup', () => {
  test('selecting a free node (no chain) creates a group of one', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '7');
    selectGroup(id);
    expect(useUiStore.getState().groupSelectedIds).toEqual(new Set([id]));
    expect(useUiStore.getState().selectedNodeId).toBe(id);
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('selecting a chained node groups all chain members', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addOperatorNode({ x: 50, y: 0 }, '+');
    const c = addNumberNode({ x: 84, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.ch = { id: 'ch', members: [a, b, c], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'ch';
      draft.nodes[b].chainId = 'ch';
      draft.nodes[c].chainId = 'ch';
    });

    selectGroup(b);

    expect(useUiStore.getState().groupSelectedIds).toEqual(new Set([a, b, c]));
    expect(useUiStore.getState().selectedNodeId).toBe(b);
  });

  test('calling selectGroup on a non-existent node is a no-op', () => {
    selectGroup('ghost');
    expect(useUiStore.getState().groupSelectedIds.size).toBe(0);
  });

  test('selectGroup does not add an undo entry', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const before = useDocumentStore.getState().undoStack.length;
    selectGroup(id);
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });
});

describe('P3.4 chain mutations: prepend / append / insert / newChain / detach', () => {
  function seedChain(
    members: Array<{ raw?: string; kind?: 'number' | 'operator' | 'equals' }>,
    anchor = { x: 100, y: 40 },
  ) {
    const ids: string[] = [];
    for (const m of members) {
      let id: string;
      if (m.kind === 'operator') id = addOperatorNode({ x: 0, y: 0 }, '+');
      else if (m.kind === 'equals') id = addEqualsNode({ x: 0, y: 0 });
      else id = addNumberNode({ x: 0, y: 0 }, m.raw ?? '1');
      ids.push(id);
    }
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: ids, anchor: { ...anchor } };
      for (const id of ids) {
        draft.nodes[id].chainId = 'c1';
      }
      // Member `position` is a cache of anchor+members (§8.1). Seed it so tests that
      // assert "existing members stay put" compare against a laid-out baseline, not the
      // {0,0} from addNumberNode.
      const positions = layoutChain(draft.chains.c1, draft.nodes, 'en-US');
      for (const id of ids) {
        const pos = positions[id];
        if (pos) draft.nodes[id].position = pos;
      }
    });
    // Clear the add-node undo entries so each mutation test starts with a known stack depth.
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    return ids;
  }

  test('appendToChain joins a free node and reflows in the same commit', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 500, y: 40 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    appendToChain(free, 'c1');

    const chain = useDocumentStore.getState().document.chains.c1;
    expect(chain.members).toEqual([a, b, free]);
    expect(useDocumentStore.getState().document.nodes[free]).toMatchObject({
      chainId: 'c1',
      position: {
        x: 100 + widthOf(useDocumentStore.getState().document.nodes[a]!, 'en-US')
          + widthOf(useDocumentStore.getState().document.nodes[b]!, 'en-US'),
        y: 40,
      },
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('prependToChain opens a gap on the left: anchor shifts, existing members stay', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    const freeWidth = widthOf(useDocumentStore.getState().document.nodes[free]!, 'en-US');
    const aBefore = { ...useDocumentStore.getState().document.nodes[a]!.position };
    const bBefore = { ...useDocumentStore.getState().document.nodes[b]!.position };

    prependToChain(free, 'c1');

    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([free, a, b]);
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual({
      x: 100 - freeWidth,
      y: 40,
    });
    expect(useDocumentStore.getState().document.nodes[free].position).toEqual({
      x: 100 - freeWidth,
      y: 40,
    });
    // Pre-existing members must not jump — only the new leftmost cell is new.
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual(aBefore);
    expect(useDocumentStore.getState().document.nodes[b].position).toEqual(bBefore);
  });

  test('insertIntoChain at index 0 shifts the anchor like prepend', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    const freeWidth = widthOf(useDocumentStore.getState().document.nodes[free]!, 'en-US');
    const aBefore = { ...useDocumentStore.getState().document.nodes[a]!.position };

    insertIntoChain(free, 'c1', 0);

    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([free, a, b]);
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual({
      x: 100 - freeWidth,
      y: 40,
    });
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual(aBefore);
  });

  test('insertIntoChain splices at the given index', () => {
    const [a, op, b] = seedChain([
      { raw: '1' },
      { kind: 'operator' },
      { raw: '2' },
    ]);
    const free = addNumberNode({ x: 0, y: 0 }, '5');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    const aBefore = { ...useDocumentStore.getState().document.nodes[a]!.position };

    insertIntoChain(free, 'c1', 1);

    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, free, op, b]);
    // Interior insert keeps the anchor; members before the slot stay put.
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual({ x: 100, y: 40 });
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual(aBefore);
    expect(useDocumentStore.getState().document.nodes[free].position).toEqual({
      x: 100 + widthOf(useDocumentStore.getState().document.nodes[a]!, 'en-US'),
      y: 40,
    });
  });

  test('formNewChain builds [left, right] with anchor at left.position', () => {
    const left = addNumberNode({ x: 30, y: 70 }, '3');
    const right = addNumberNode({ x: 200, y: 70 }, '4');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    const chainId = formNewChain(left, right);

    expect(chainId).not.toBeNull();
    const chain = useDocumentStore.getState().document.chains[chainId!];
    expect(chain).toMatchObject({
      anchor: { x: 30, y: 70 },
      members: [left, right],
    });
    expect(useDocumentStore.getState().document.nodes[left].position).toEqual({ x: 30, y: 70 });
    expect(useDocumentStore.getState().document.nodes[right].position).toEqual({
      x: 30 + widthOf(useDocumentStore.getState().document.nodes[left]!, 'en-US'),
      y: 70,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('formNewChain leftPosition overrides a stale left store cache for the anchor', () => {
    // Drag release: left node still sits at its pre-drag store position, but the finger
    // released elsewhere — without leftPosition the chain would anchor at the stale cache
    // (the P3.1 class of bug). With it, anchor + layout start at the live release point.
    const left = addNumberNode({ x: 10, y: 20 }, '3');
    const right = addNumberNode({ x: 200, y: 20 }, '4');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    const release = { x: 80, y: 55 };
    const chainId = formNewChain(left, right, release);

    const chain = useDocumentStore.getState().document.chains[chainId!];
    expect(chain.anchor).toEqual(release);
    expect(useDocumentStore.getState().document.nodes[left].position).toEqual(release);
    expect(useDocumentStore.getState().document.nodes[right].position).toEqual({
      x: release.x + widthOf(useDocumentStore.getState().document.nodes[left]!, 'en-US'),
      y: release.y,
    });
  });

  test('detachNode frees the member at the given position and reflows the remainder', () => {
    const [a, b, c] = seedChain([{ raw: '1' }, { raw: '2' }, { raw: '3' }]);

    detachNode(b, { x: 250, y: 90 });

    expect(useDocumentStore.getState().document.nodes[b]).toMatchObject({
      chainId: null,
      position: { x: 250, y: 90 },
    });
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, c]);
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual({ x: 100, y: 40 });
    expect(useDocumentStore.getState().document.nodes[c].position).toEqual({
      x: 100 + widthOf(useDocumentStore.getState().document.nodes[a]!, 'en-US'),
      y: 40,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('detach that leaves one member dissolves the chain', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);

    detachNode(a, { x: 10, y: 10 });

    expect(useDocumentStore.getState().document.chains.c1).toBeUndefined();
    expect(useDocumentStore.getState().document.nodes[a]).toMatchObject({
      chainId: null,
      position: { x: 10, y: 10 },
    });
    expect(useDocumentStore.getState().document.nodes[b]).toMatchObject({ chainId: null });
  });

  test('detaching the equals node also deletes the chain\'s result node', () => {
    const [a, eq] = seedChain([{ raw: '10' }, { kind: 'equals' }]);
    // Two members so detach of equals leaves one (which then dissolves) — seed a third
    // so we can observe the result deletion on a still-multi-member chain first.
    const b = addNumberNode({ x: 0, y: 0 }, '20');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[b].chainId = 'c1';
      draft.chains.c1.members = [a, b, eq];
      draft.nodes.r1 = {
        id: 'r1',
        kind: 'result',
        sourceChainId: 'c1',
        position: { x: 0, y: 0 },
        chainId: 'c1',
        createdAt: 0,
        derived: { display: '30', computedAt: '2026-08-04T00:00:00.000Z' },
      };
      draft.chains.c1.members.push('r1');
    });
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    detachNode(eq, { x: 400, y: 40 });

    expect(useDocumentStore.getState().document.nodes.r1).toBeUndefined();
    expect(useDocumentStore.getState().document.nodes[eq]).toMatchObject({ chainId: null });
    // a, b remain (no equals, no result) — still a two-member chain.
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b]);
  });

  test('each mutation is a single undo entry that fully restores', () => {
    const left = addNumberNode({ x: 0, y: 0 }, '1');
    const right = addNumberNode({ x: 80, y: 0 }, '2');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    formNewChain(left, right);
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[left].chainId).toBeNull();
    expect(useDocumentStore.getState().document.nodes[right].chainId).toBeNull();
    expect(Object.keys(useDocumentStore.getState().document.chains)).toHaveLength(0);

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[left].chainId).not.toBeNull();
  });

  test('prependToChain undo/redo restores anchor and membership', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    const anchorBefore = { ...useDocumentStore.getState().document.chains.c1.anchor };

    prependToChain(free, 'c1');
    const shiftedAnchor = { ...useDocumentStore.getState().document.chains.c1.anchor };
    expect(shiftedAnchor.x).toBeLessThan(anchorBefore.x);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b]);
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual(anchorBefore);
    expect(useDocumentStore.getState().document.nodes[free].chainId).toBeNull();

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([free, a, b]);
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual(shiftedAnchor);
  });

  test('appendToChain undo/redo restores membership', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    appendToChain(free, 'c1');
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b]);
    expect(useDocumentStore.getState().document.nodes[free].chainId).toBeNull();

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b, free]);
  });

  test('insertIntoChain undo/redo restores membership', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '5');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    insertIntoChain(free, 'c1', 1);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b]);

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, free, b]);
  });

  test('detachNode undo/redo restores the member and chain', () => {
    const [a, b, c] = seedChain([{ raw: '1' }, { raw: '2' }, { raw: '3' }]);

    detachNode(b, { x: 250, y: 90 });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, b, c]);
    expect(useDocumentStore.getState().document.nodes[b].chainId).toBe('c1');

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.nodes[b]).toMatchObject({
      chainId: null,
      position: { x: 250, y: 90 },
    });
    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, c]);
  });

  test('commitSnapOutcome dispatches append', () => {
    const [a] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    commitSnapOutcome(free, { kind: 'append', chainId: 'c1' });

    expect(useDocumentStore.getState().document.chains.c1.members.at(-1)).toBe(free);
    expect(useDocumentStore.getState().document.nodes[a].chainId).toBe('c1');
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('commitSnapOutcome dispatches prepend with a left-shifted anchor', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '9');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    const freeWidth = widthOf(useDocumentStore.getState().document.nodes[free]!, 'en-US');
    const aBefore = { ...useDocumentStore.getState().document.nodes[a]!.position };

    commitSnapOutcome(free, { kind: 'prepend', chainId: 'c1' });

    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([free, a, b]);
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual({
      x: 100 - freeWidth,
      y: 40,
    });
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual(aBefore);
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('commitSnapOutcome dispatches insert', () => {
    const [a, b] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const free = addNumberNode({ x: 0, y: 0 }, '5');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    commitSnapOutcome(free, { kind: 'insert', chainId: 'c1', index: 1 });

    expect(useDocumentStore.getState().document.chains.c1.members).toEqual([a, free, b]);
  });

  test('commitSnapOutcome dispatches newChain', () => {
    const left = addNumberNode({ x: 10, y: 20 }, '1');
    const right = addNumberNode({ x: 90, y: 20 }, '2');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    commitSnapOutcome(right, { kind: 'newChain', leftId: left, rightId: right });

    const chains = Object.values(useDocumentStore.getState().document.chains);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.members).toEqual([left, right]);
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('commitSnapOutcome newChain forwards position when the dragged node is the left member', () => {
    // NEW_CHAIN [dragged, free]: dragged is leftId. Its store position is still the
    // pre-drag home; the release `position` must become the chain anchor.
    const dragged = addNumberNode({ x: 0, y: 0 }, '1');
    const free = addNumberNode({ x: 200, y: 0 }, '2');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    const release = { x: 120, y: 40 };
    commitSnapOutcome(
      dragged,
      { kind: 'newChain', leftId: dragged, rightId: free },
      release,
    );

    const chains = Object.values(useDocumentStore.getState().document.chains);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.anchor).toEqual(release);
    expect(chains[0]!.members).toEqual([dragged, free]);
    expect(useDocumentStore.getState().document.nodes[dragged].position).toEqual(release);
  });

  test('newChain dragged-left: insertionFeedback preview matches post-commit partner position', () => {
    // PR #63 review: preview used the partner's store home + gap, but commit anchors at
    // the live release point — assert the two agree for the same inputs.
    const dragged = addNumberNode({ x: 0, y: 0 }, '7');
    const partner = addNumberNode({ x: 200, y: 40 }, '5');
    const { document } = useDocumentStore.getState();
    const live = { x: 120, y: 55 };
    const outcome = { kind: 'newChain' as const, leftId: dragged, rightId: partner };

    const feedback = insertionFeedback(
      outcome,
      document.nodes[dragged],
      document.chains,
      document.nodes,
      'en-US',
      live,
    );
    const previewed = {
      x: document.nodes[partner].position.x + feedback.offsets[partner]!.x,
      y: document.nodes[partner].position.y + feedback.offsets[partner]!.y,
    };

    commitSnapOutcome(dragged, outcome, live);

    expect(useDocumentStore.getState().document.nodes[partner].position).toEqual(previewed);
    expect(useDocumentStore.getState().document.nodes[dragged].position).toEqual(live);
  });

  test('commitSnapOutcome newChain leaves the stationary left node alone when dragging the right', () => {
    // NEW_CHAIN [free, dragged]: free is leftId and already authoritative in the store.
    // Passing the dragged node's release position must not overwrite the left anchor.
    const free = addNumberNode({ x: 50, y: 60 }, '1');
    const dragged = addNumberNode({ x: 300, y: 60 }, '2');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    commitSnapOutcome(
      dragged,
      { kind: 'newChain', leftId: free, rightId: dragged },
      { x: 999, y: 999 },
    );

    const chains = Object.values(useDocumentStore.getState().document.chains);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.anchor).toEqual({ x: 50, y: 60 });
    expect(chains[0]!.members).toEqual([free, dragged]);
    expect(useDocumentStore.getState().document.nodes[free].position).toEqual({ x: 50, y: 60 });
  });

  test('appending a node already in the target chain is a no-op', () => {
    const [a] = seedChain([{ raw: '1' }, { raw: '2' }]);
    const before = useDocumentStore.getState().undoStack.length;
    appendToChain(a, 'c1');
    expect(useDocumentStore.getState().undoStack).toHaveLength(before);
  });

  test('detaching a free node is a no-op', () => {
    const id = addNumberNode({ x: 1, y: 2 }, '1');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });
    detachNode(id, { x: 9, y: 9 });
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
    expect(useDocumentStore.getState().document.nodes[id].position).toEqual({ x: 1, y: 2 });
  });
});

describe('moveFreeNode', () => {
  test('repositions a free node in one undo entry', () => {
    const id = addNumberNode({ x: 10, y: 20 }, '1');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    moveFreeNode(id, { x: 50, y: 60 });

    expect(useDocumentStore.getState().document.nodes[id].position).toEqual({ x: 50, y: 60 });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[id].position).toEqual({ x: 10, y: 20 });
  });

  test('does not move a chained member', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 0, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
    });
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    moveFreeNode(a, { x: 99, y: 99 });
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });
});

describe('moveChain', () => {
  test('updates anchor and reflows every member in one undo entry', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const op = addOperatorNode({ x: 0, y: 0 }, '+');
    const b = addNumberNode({ x: 0, y: 0 }, '2');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, op, b], anchor: { x: 100, y: 40 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[op].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
      const positions = layoutChain(draft.chains.c1, draft.nodes, 'en-US');
      for (const id of [a, op, b]) {
        const pos = positions[id];
        if (pos) draft.nodes[id].position = pos;
      }
    });
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    moveChain('c1', { x: 200, y: 80 });

    const { document, undoStack } = useDocumentStore.getState();
    expect(document.chains.c1.anchor).toEqual({ x: 200, y: 80 });
    expect(document.nodes[a].position).toEqual({ x: 200, y: 80 });
    expect(document.nodes[op].position.y).toBe(80);
    expect(document.nodes[b].position.y).toBe(80);
    expect(document.nodes[op].position.x).toBeGreaterThan(document.nodes[a].position.x);
    expect(document.nodes[b].position.x).toBeGreaterThan(document.nodes[op].position.x);
    expect(undoStack).toHaveLength(1);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.chains.c1.anchor).toEqual({ x: 100, y: 40 });
    expect(useDocumentStore.getState().document.nodes[a].position).toEqual({ x: 100, y: 40 });
  });

  test('no-op when chain is missing or anchor is unchanged', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '3');
    const b = addNumberNode({ x: 0, y: 0 }, '4');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b], anchor: { x: 10, y: 20 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
    });
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    moveChain('ghost', { x: 1, y: 2 });
    moveChain('c1', { x: 10, y: 20 });
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });
});

describe('P4.7 result node lifecycle', () => {
  test('create -> snap -> = -> result (section 14 integration)', () => {
    const left = addNumberNode({ x: 0, y: 0 }, '1221');
    const plus = addOperatorNode({ x: 80, y: 0 }, '+');
    const mid = addNumberNode({ x: 160, y: 0 }, '3');
    const minus = addOperatorNode({ x: 240, y: 0 }, '-');
    const right = addNumberNode({ x: 320, y: 0 }, '20');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    formNewChain(left, plus);
    const chainId = useDocumentStore.getState().document.nodes[left]!.chainId!;
    appendToChain(mid, chainId);
    appendToChain(minus, chainId);
    appendToChain(right, chainId);

    const eqId = appendEqualsNode(right);

    const doc = useDocumentStore.getState().document;
    const chain = doc.chains[chainId]!;
    expect(chain.members.slice(0, 5)).toEqual([left, plus, mid, minus, right]);
    expect(doc.nodes[eqId]!.kind).toBe('equals');
    expect(chain.members).toContain(eqId);

    const resultId = chain.members.find((id) => doc.nodes[id]!.kind === 'result');
    expect(resultId).toBeDefined();
    expect(doc.nodes[resultId!]).toMatchObject({
      kind: 'result',
      sourceChainId: chainId,
      chainId,
      derived: { display: '1,204' },
    });
    expect(chain.members[chain.members.indexOf(eqId) + 1]).toBe(resultId);
  });

  test('removing = deletes the result node (section 8.3)', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '10');
    const plus = addOperatorNode({ x: 40, y: 0 }, '+');
    const b = addNumberNode({ x: 80, y: 0 }, '20');
    formNewChain(a, plus);
    const chainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    appendToChain(b, chainId);
    const eqId = appendEqualsNode(b);
    const resultId = useDocumentStore
      .getState()
      .document.chains[chainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'result',
      )!;
    expect(useDocumentStore.getState().document.nodes[resultId]).toBeDefined();

    deleteNode(eqId);

    expect(useDocumentStore.getState().document.nodes[resultId]).toBeUndefined();
    expect(
      Object.values(useDocumentStore.getState().document.nodes).some(
        (n) => n.kind === 'result' && n.sourceChainId === chainId,
      ),
    ).toBe(false);
  });

  test('setNodeRaw rejects edits on a result - throws, does not swallow', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '7');
    appendEqualsNode(a);
    const resultId = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!.id;

    expect(() => setNodeRaw(resultId, '99')).toThrow(/read-only/);
    expect(useDocumentStore.getState().document.nodes[resultId]).toMatchObject({
      kind: 'result',
      derived: { display: '7' },
    });
  });

  test('derived is written from the engine - never trusted as an input', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '2');
    const times = addOperatorNode({ x: 40, y: 0 }, '×');
    const b = addNumberNode({ x: 80, y: 0 }, '3');
    formNewChain(a, times);
    appendToChain(b, useDocumentStore.getState().document.nodes[a]!.chainId!);
    appendEqualsNode(b);

    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    expect(result.derived?.display).toBe('6');
    const poisonedId = result.id;

    useDocumentStore.getState().applyCommand((draft) => {
      const r = Object.values(draft.nodes).find((n) => n.kind === 'result');
      if (r && r.kind === 'result') {
        r.derived = { display: 'POISON', computedAt: '1999-01-01T00:00:00.000Z' };
      }
    });

    const eq = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'equals',
    )!;
    deleteNode(eq.id);
    appendEqualsNode(b);
    const fresh = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    expect(fresh.derived?.display).toBe('6');
    expect(fresh.id).not.toBe(poisonedId);
  });

  test('DivideByZero still creates a result with derived.outcome error (P4.6)', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const div = addOperatorNode({ x: 40, y: 0 }, '÷');
    const b = addNumberNode({ x: 80, y: 0 }, '0');
    formNewChain(a, div);
    appendToChain(b, useDocumentStore.getState().document.nodes[a]!.chainId!);
    appendEqualsNode(b);

    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    expect(result.derived).toEqual({
      display: '',
      computedAt: expect.any(String),
      outcome: { status: 'error', error: 'DivideByZero' },
    });
  });

  test('Incomplete chain with = does not create a result', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '3');
    const { numberId } = appendOperatorAndNumber(a, '+');
    // Chain is 3 + <empty>; appending = keeps it Incomplete (empty raw).
    appendEqualsNode(numberId);

    const results = Object.values(useDocumentStore.getState().document.nodes).filter(
      (n) => n.kind === 'result',
    );
    expect(results).toHaveLength(0);
  });
});

describe('continueFromResult (P4.9, §8.7)', () => {
  test('builds [reference→R, ⊕] below-right of R in one undo entry', () => {
    const a = addNumberNode({ x: 10, y: 20 }, '7');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find((n) => n.kind === 'result')!;
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    const { chainId, referenceId, operatorId } = continueFromResult(result.id, '+');

    const doc = useDocumentStore.getState().document;
    expect(doc.chains[chainId]!.members).toEqual([referenceId, operatorId]);
    expect(doc.nodes[referenceId]).toMatchObject({
      kind: 'reference',
      targetNodeId: result.id,
      chainId,
    });
    expect(doc.nodes[operatorId]).toMatchObject({ kind: 'operator', op: '+', chainId });
    expect(doc.chains[chainId]!.anchor).toEqual({
      x: result.position.x + CONTINUATION_OFFSET.x,
      y: result.position.y + CONTINUATION_OFFSET.y,
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('rejects a non-result target', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    expect(() => continueFromResult(a, '+')).toThrow(/not a result/);
  });
});

describe('dangling references (P6.4 / §11.2)', () => {
  test('deleting a referenced node leaves the reference dangling — no cascade', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '7');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    const { referenceId, chainId } = continueFromResult(result.id, '+');

    deleteNode(result.id);

    const doc = useDocumentStore.getState().document;
    expect(doc.nodes[result.id]).toBeUndefined();
    expect(doc.nodes[referenceId]).toMatchObject({
      kind: 'reference',
      targetNodeId: result.id,
      lastKnownDisplay: '7',
      chainId,
    });
    // Consumer chain members still include the reference — not cascaded away.
    expect(doc.chains[chainId]!.members).toContain(referenceId);
  });

  test('unlinkFromParent freezes the live value as a plain number in one undo entry', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '12');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    const { referenceId, chainId } = continueFromResult(result.id, '+');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    unlinkFromParent(referenceId);

    const doc = useDocumentStore.getState().document;
    expect(doc.nodes[referenceId]).toBeUndefined();
    const replacement = doc.chains[chainId]!.members
      .map((id) => doc.nodes[id])
      .find((n) => n && n.kind === 'number' && n.raw === '12');
    expect(replacement).toBeDefined();
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
  });

  test('unlinkFromParent on a dangling reference freezes lastKnownDisplay', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '5');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    const { referenceId } = continueFromResult(result.id, '+');
    deleteNode(result.id);
    expect(useDocumentStore.getState().document.nodes[referenceId]).toMatchObject({
      lastKnownDisplay: '5',
    });

    unlinkFromParent(referenceId);

    const numbers = Object.values(useDocumentStore.getState().document.nodes).filter(
      (n) => n.kind === 'number' && n.raw === '5' && n.id !== a,
    );
    expect(numbers).toHaveLength(1);
    expect(useDocumentStore.getState().document.nodes[referenceId]).toBeUndefined();
  });

  test('repointReference retargets and clears the dangling stamp', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '3');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    const { referenceId } = continueFromResult(result.id, '+');
    deleteNode(result.id);

    const other = addNumberNode({ x: 100, y: 100 }, '99');
    repointReference(referenceId, other);

    expect(useDocumentStore.getState().document.nodes[referenceId]).toMatchObject({
      kind: 'reference',
      targetNodeId: other,
    });
    expect(
      (useDocumentStore.getState().document.nodes[referenceId] as { lastKnownDisplay?: string })
        .lastKnownDisplay,
    ).toBeUndefined();
  });

  test('repointReference is a no-op for an invalid target', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    )!;
    const { referenceId } = continueFromResult(result.id, '+');
    const op = addOperatorNode({ x: 50, y: 50 }, '+');

    repointReference(referenceId, op);

    expect(useDocumentStore.getState().document.nodes[referenceId]).toMatchObject({
      targetNodeId: result.id,
    });
  });
});

describe('P6.7 drag result into chain (§11)', () => {
  /** Evaluated source chain ending in result R, plus a second chain to snap into. */
  function seedSourceAndTarget(): {
    sourceChainId: string;
    resultId: string;
    targetChainId: string;
    targetLeft: string;
    targetRight: string;
  } {
    const a = addNumberNode({ x: 0, y: 0 }, '5');
    appendEqualsNode(a);
    const sourceChainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    const resultId = useDocumentStore
      .getState()
      .document.chains[sourceChainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'result',
      )!;

    const targetLeft = addNumberNode({ x: 400, y: 0 }, '2');
    const targetRight = addOperatorNode({ x: 440, y: 0 }, '+');
    formNewChain(targetLeft, targetRight);
    const targetChainId = useDocumentStore.getState().document.nodes[targetLeft]!.chainId!;
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    return { sourceChainId, resultId, targetChainId, targetLeft, targetRight };
  }

  test('append inserts a reference to R — not R itself, and not a value copy', () => {
    const { sourceChainId, resultId, targetChainId, targetLeft, targetRight } =
      seedSourceAndTarget();
    const sourceMembersBefore = [
      ...useDocumentStore.getState().document.chains[sourceChainId]!.members,
    ];

    commitSnapOutcome(resultId, { kind: 'append', chainId: targetChainId });

    const doc = useDocumentStore.getState().document;
    const target = doc.chains[targetChainId]!;
    expect(target.members.slice(0, 2)).toEqual([targetLeft, targetRight]);
    const insertedId = target.members[2]!;
    expect(insertedId).not.toBe(resultId);
    expect(doc.nodes[insertedId]).toMatchObject({
      kind: 'reference',
      targetNodeId: resultId,
      chainId: targetChainId,
    });
    // Source keeps its own result at the same membership.
    expect(doc.chains[sourceChainId]!.members).toEqual(sourceMembersBefore);
    expect(doc.nodes[resultId]).toMatchObject({
      kind: 'result',
      chainId: sourceChainId,
      sourceChainId,
    });
  });

  test('prepend and insert also place a reference; source result unchanged', () => {
    const { sourceChainId, resultId, targetChainId, targetLeft, targetRight } =
      seedSourceAndTarget();

    commitSnapOutcome(resultId, { kind: 'prepend', chainId: targetChainId });
    let doc = useDocumentStore.getState().document;
    const prepended = doc.chains[targetChainId]!.members[0]!;
    expect(doc.nodes[prepended]).toMatchObject({
      kind: 'reference',
      targetNodeId: resultId,
    });
    expect(doc.chains[targetChainId]!.members.slice(1)).toEqual([targetLeft, targetRight]);
    expect(doc.nodes[resultId]!.chainId).toBe(sourceChainId);

    // Undo back to the two-member target, then insert between them.
    useDocumentStore.getState().undo();
    commitSnapOutcome(resultId, { kind: 'insert', chainId: targetChainId, index: 1 });
    doc = useDocumentStore.getState().document;
    expect(doc.chains[targetChainId]!.members).toEqual([
      targetLeft,
      expect.any(String),
      targetRight,
    ]);
    const mid = doc.chains[targetChainId]!.members[1]!;
    expect(doc.nodes[mid]).toMatchObject({ kind: 'reference', targetNodeId: resultId });
    expect(doc.nodes[resultId]!.chainId).toBe(sourceChainId);
  });

  test('newChain with a free node seeds [ref→R, free] or [free, ref→R]; R stays home', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '9');
    appendEqualsNode(a);
    const sourceChainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    const resultId = useDocumentStore
      .getState()
      .document.chains[sourceChainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'result',
      )!;
    const free = addNumberNode({ x: 300, y: 40 }, '3');
    useDocumentStore.setState({ undoStack: [], redoStack: [] });

    // Dragged result on the right of the free node.
    commitSnapOutcome(resultId, {
      kind: 'newChain',
      leftId: free,
      rightId: resultId,
    });

    let doc = useDocumentStore.getState().document;
    const chainRight = Object.values(doc.chains).find(
      (c) => c.id !== sourceChainId && c.members.includes(free),
    )!;
    expect(chainRight.members).toHaveLength(2);
    expect(chainRight.members[0]).toBe(free);
    expect(doc.nodes[chainRight.members[1]!]).toMatchObject({
      kind: 'reference',
      targetNodeId: resultId,
    });
    expect(doc.nodes[resultId]!.chainId).toBe(sourceChainId);
    expect(doc.nodes[resultId]!.kind).toBe('result');

    useDocumentStore.getState().undo();
    const free2 = addNumberNode({ x: 500, y: 40 }, '4');
    const release = { x: 450, y: 40 };
    commitSnapOutcome(
      resultId,
      { kind: 'newChain', leftId: resultId, rightId: free2 },
      release,
    );

    doc = useDocumentStore.getState().document;
    const chainLeft = Object.values(doc.chains).find(
      (c) => c.id !== sourceChainId && c.members.includes(free2),
    )!;
    expect(doc.nodes[chainLeft.members[0]!]).toMatchObject({
      kind: 'reference',
      targetNodeId: resultId,
    });
    expect(chainLeft.members[1]).toBe(free2);
    expect(chainLeft.anchor).toEqual(release);
    expect(doc.nodes[resultId]!.chainId).toBe(sourceChainId);
  });

  test('one undo entry; undo removes the reference and leaves the source result', () => {
    const { sourceChainId, resultId, targetChainId } = seedSourceAndTarget();
    const sourceMembers = [
      ...useDocumentStore.getState().document.chains[sourceChainId]!.members,
    ];

    commitSnapOutcome(resultId, { kind: 'append', chainId: targetChainId });
    expect(useDocumentStore.getState().undoStack).toHaveLength(1);
    const refId = useDocumentStore
      .getState()
      .document.chains[targetChainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'reference',
      )!;

    useDocumentStore.getState().undo();
    const doc = useDocumentStore.getState().document;
    expect(doc.nodes[refId]).toBeUndefined();
    expect(doc.chains[targetChainId]!.members).not.toContain(refId);
    expect(doc.chains[sourceChainId]!.members).toEqual(sourceMembers);
    expect(doc.nodes[resultId]).toMatchObject({ kind: 'result', chainId: sourceChainId });  });
});


describe('P4.8 recompute on edit', () => {
  test('editing an input updates the result in the same commit (section 14)', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1221');
    const plus = addOperatorNode({ x: 40, y: 0 }, '+');
    const b = addNumberNode({ x: 80, y: 0 }, '3');
    formNewChain(a, plus);
    const chainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    appendToChain(b, chainId);
    appendEqualsNode(b);

    const resultId = useDocumentStore
      .getState()
      .document.chains[chainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'result',
      )!;
    expect(useDocumentStore.getState().document.nodes[resultId]).toMatchObject({
      derived: { display: '1,224' },
    });

    setNodeRaw(a, '1300');

    const doc = useDocumentStore.getState().document;
    const updated = doc.nodes[resultId]!;
    expect(updated).toMatchObject({
      id: resultId,
      kind: 'result',
      derived: { display: '1,303' },
    });
    if (updated.kind === 'result') {
      expect(updated.derived?.outcome).toBeUndefined();
    }
  });

  test('editing one chain does not re-evaluate an untouched Evaluated chain', () => {
    const graphCompute = require('../engine/compute') as typeof import('../engine/compute');
    const actualCompute = graphCompute.computeChain.bind(graphCompute);
    const evaluated: string[] = [];
    const spy = jest.spyOn(graphCompute, 'computeChain').mockImplementation((chain, nodes, locale, chains, stack) => {
      evaluated.push(chain.id);
      return actualCompute(chain, nodes, locale, chains, stack);
    });

    try {
      const a1 = addNumberNode({ x: 0, y: 0 }, '1');
      const p1 = addOperatorNode({ x: 40, y: 0 }, '+');
      const b1 = addNumberNode({ x: 80, y: 0 }, '2');
      formNewChain(a1, p1);
      const c1 = useDocumentStore.getState().document.nodes[a1]!.chainId!;
      appendToChain(b1, c1);
      appendEqualsNode(b1);

      const a2 = addNumberNode({ x: 0, y: 100 }, '10');
      const p2 = addOperatorNode({ x: 40, y: 100 }, '+');
      const b2 = addNumberNode({ x: 80, y: 100 }, '20');
      formNewChain(a2, p2);
      const c2 = useDocumentStore.getState().document.nodes[a2]!.chainId!;
      appendToChain(b2, c2);
      appendEqualsNode(b2);

      const r2Before = Object.values(useDocumentStore.getState().document.nodes).find(
        (n) => n.kind === 'result' && n.sourceChainId === c2,
      );
      expect(r2Before?.kind).toBe('result');
      if (!r2Before || r2Before.kind !== 'result') {
        throw new Error('expected result on c2');
      }
      const r2Derived = { ...r2Before.derived! };

      evaluated.length = 0;
      setNodeRaw(a1, '7');

      expect(evaluated).toEqual([c1]);
      expect(useDocumentStore.getState().document.nodes[r2Before.id]).toMatchObject({
        derived: r2Derived,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('applyCommand recomputeSeeds updates a result in the same undo entry', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '2');
    const plus = addOperatorNode({ x: 40, y: 0 }, '+');
    const b = addNumberNode({ x: 80, y: 0 }, '3');
    formNewChain(a, plus);
    const chainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    appendToChain(b, chainId);
    appendEqualsNode(b);
    const resultId = useDocumentStore
      .getState()
      .document.chains[chainId]!.members.find(
        (id) => useDocumentStore.getState().document.nodes[id]!.kind === 'result',
      )!;

    useDocumentStore.getState().applyCommand(
      (draft) => {
        const node = draft.nodes[a];
        if (node && node.kind === 'number') node.raw = '9';
      },
      { recomputeSeeds: [chainId], locale: 'en-US' },
    );

    expect(useDocumentStore.getState().document.nodes[resultId]).toMatchObject({
      derived: { display: '12' },
    });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.nodes[a]).toMatchObject({ raw: '2' });
    expect(useDocumentStore.getState().document.nodes[resultId]).toMatchObject({
      derived: { display: '5' },
    });
  });

  test('clearing then retyping an operand drops and recreates the result (keypad path)', () => {
    // Keypad backspace sets raw to "" (Incomplete → no result), then digits rebuild it.
    const a = addNumberNode({ x: 0, y: 0 }, '5');
    const div = addOperatorNode({ x: 40, y: 0 }, '÷');
    const b = addNumberNode({ x: 80, y: 0 }, '3');
    formNewChain(a, div);
    const chainId = useDocumentStore.getState().document.nodes[a]!.chainId!;
    appendToChain(b, chainId);
    appendEqualsNode(b);
    expect(
      Object.values(useDocumentStore.getState().document.nodes).some((n) => n.kind === 'result'),
    ).toBe(true);

    setNodeRaw(a, '');
    expect(
      Object.values(useDocumentStore.getState().document.nodes).filter((n) => n.kind === 'result'),
    ).toHaveLength(0);

    setNodeRaw(a, '8');
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    );
    expect(result).toMatchObject({
      kind: 'result',
      sourceChainId: chainId,
      derived: { display: '2.66666666667' },
    });
  });
});

describe('P6.2 incremental cascade', () => {
  test('§11: editing 1221→1300 updates 1303 then 2606; unrelated chain untouched', () => {
    const graphCompute = require('../engine/compute') as typeof import('../engine/compute');
    const actualCompute = graphCompute.computeChain.bind(graphCompute);
    const evaluated: string[] = [];
    const spy = jest.spyOn(graphCompute, 'computeChain').mockImplementation((chain, nodes, locale, chains, stack) => {
      evaluated.push(chain.id);
      return actualCompute(chain, nodes, locale, chains, stack);
    });

    try {
      // c1: 1221 + 3 =
      const n1 = addNumberNode({ x: 0, y: 0 }, '1221');
      const p1 = addOperatorNode({ x: 40, y: 0 }, '+');
      const n2 = addNumberNode({ x: 80, y: 0 }, '3');
      formNewChain(n1, p1);
      const c1 = useDocumentStore.getState().document.nodes[n1]!.chainId!;
      appendToChain(n2, c1);
      appendEqualsNode(n2);
      const r1 = Object.values(useDocumentStore.getState().document.nodes).find(
        (n) => n.kind === 'result' && n.sourceChainId === c1,
      )!;
      expect(r1).toMatchObject({ derived: { display: '1,224' } });

      // c2: continuation × 2 =
      const { chainId: c2, operatorId } = continueFromResult(r1.id, '×');
      const n3 = appendNumberNode(operatorId, '2');
      appendEqualsNode(n3);
      const r2 = Object.values(useDocumentStore.getState().document.nodes).find(
        (n) => n.kind === 'result' && n.sourceChainId === c2,
      )!;
      expect(r2).toMatchObject({ derived: { display: '2,448' } });

      // c3: unrelated evaluated chain
      const lone = addNumberNode({ x: 0, y: 200 }, '9');
      appendEqualsNode(lone);
      const c3 = useDocumentStore.getState().document.nodes[lone]!.chainId!;
      const r3 = Object.values(useDocumentStore.getState().document.nodes).find(
        (n) => n.kind === 'result' && n.sourceChainId === c3,
      )!;
      const r3Derived = { ...(r3.kind === 'result' ? r3.derived! : {}) };

      evaluated.length = 0;
      setNodeRaw(n1, '1300');

      expect(evaluated).toEqual([c1, c2]);
      expect(useDocumentStore.getState().document.nodes[r1.id]).toMatchObject({
        derived: { display: '1,303' },
      });
      expect(useDocumentStore.getState().document.nodes[r2.id]).toMatchObject({
        derived: { display: '2,606' },
      });
      expect(useDocumentStore.getState().document.nodes[r3.id]).toMatchObject({
        derived: r3Derived,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
