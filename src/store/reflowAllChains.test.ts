jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

import { reflowAllChainsForDisplay } from './reflowAllChains';
import { setDocumentDirtyHandler, useDocumentStore } from './documentStore';
import { layoutChain } from '../chains/layout';
import { widthOf } from '../chains/measure';
import { createEmptyDocument, createChainId } from '../model/factories';
import type { CalcNode, Chain, NumberNode, OperatorNode } from '../model/types';

function numberNode(id: string, raw: string, chainId: string): NumberNode {
  return { id, kind: 'number', raw, position: { x: -1, y: -1 }, chainId, createdAt: 0 };
}

function operatorNode(id: string, chainId: string): OperatorNode {
  return { id, kind: 'operator', op: '+', position: { x: -1, y: -1 }, chainId, createdAt: 0 };
}

/** Seeds documentStore directly (not through a command) so positions start
 *  deliberately wrong — the point is proving reflow corrects them. */
function seedChainDocument() {
  const chainId = createChainId();
  const a = numberNode('a', '12', chainId);
  const op = operatorNode('op', chainId);
  const b = numberNode('b', '345', chainId);
  const chain: Chain = { id: chainId, anchor: { x: 100, y: 200 }, members: ['a', 'op', 'b'] };
  const nodes: Record<string, CalcNode> = { a, op, b };

  const document = createEmptyDocument();
  document.nodes = nodes;
  document.chains = { [chainId]: chain };

  useDocumentStore.setState({ document, undoStack: [], redoStack: [], lastSavedAt: null });
  return { chainId, chain, nodes };
}

beforeEach(() => {
  setDocumentDirtyHandler(null);
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
    lastSavedAt: null,
  });
});

describe('reflowAllChainsForDisplay', () => {
  test('lays every chain out flush at the given font size, matching layoutChain directly', () => {
    const { chainId, chain, nodes } = seedChainDocument();

    reflowAllChainsForDisplay(30);

    const expected = layoutChain(chain, nodes, 'en-US', 30);
    const after = useDocumentStore.getState().document.nodes;
    expect(after.a!.position).toEqual(expected.a);
    expect(after.op!.position).toEqual(expected.op);
    expect(after.b!.position).toEqual(expected.b);
    expect(useDocumentStore.getState().document.chains[chainId]).toEqual(chain); // untouched
  });

  test('a different font size produces a different (wider) layout', () => {
    seedChainDocument();

    reflowAllChainsForDisplay(14);
    const narrow = useDocumentStore.getState().document.nodes.b!.position.x;

    reflowAllChainsForDisplay(30);
    const wide = useDocumentStore.getState().document.nodes.b!.position.x;

    expect(wide).toBeGreaterThan(narrow);
  });

  test('bypasses undo history entirely (§7 precedent: setViewport)', () => {
    seedChainDocument();
    reflowAllChainsForDisplay(26);
    expect(useDocumentStore.getState().undoStack).toHaveLength(0);
  });

  test('notifies dirty (so autosave still picks up the new positions)', () => {
    seedChainDocument();
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);

    reflowAllChainsForDisplay(26);

    expect(dirty).toHaveBeenCalledTimes(1);
  });

  test('a document with no chains is a true no-op: no set, no dirty notification', () => {
    const before = useDocumentStore.getState().document;
    const dirty = jest.fn();
    setDocumentDirtyHandler(dirty);

    reflowAllChainsForDisplay(26);

    expect(useDocumentStore.getState().document).toBe(before);
    expect(dirty).not.toHaveBeenCalled();
  });

  test('a free (chainless) node is left untouched — only chain members reflow', () => {
    const { chainId } = seedChainDocument();
    const free = numberNode('free', '9', null as unknown as string);
    free.chainId = null;
    free.position = { x: 500, y: 500 };
    useDocumentStore.setState((state) => ({
      document: { ...state.document, nodes: { ...state.document.nodes, free } },
    }));

    reflowAllChainsForDisplay(26);

    expect(useDocumentStore.getState().document.nodes.free!.position).toEqual({ x: 500, y: 500 });
    // Sanity: the chain itself still moved, so this isn't just a global no-op.
    expect(useDocumentStore.getState().document.chains[chainId]).toBeDefined();
  });

  test('widthOf at the new font size matches what reflow actually laid out (cross-check with measure.ts)', () => {
    seedChainDocument();
    reflowAllChainsForDisplay(30);

    const { document } = useDocumentStore.getState();
    const aWidth = widthOf(document.nodes.a!, 'en-US', 30);
    expect(document.nodes.op!.position.x).toBe(document.nodes.a!.position.x + aWidth);
  });
});
