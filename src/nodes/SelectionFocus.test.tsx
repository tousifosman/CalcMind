import React from 'react';
import { act } from 'react-test-renderer';
import { NumberNode } from './NumberNode';
import { OperatorNode } from './OperatorNode';
import { ResultNode } from './ResultNode';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  addOperatorNode,
  selectNode,
  selectGroup,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { selectionFocusColor } from '../ui/tokens';
import { SELECTION_FOCUS_WIDTH } from './Cell';
import { SELECTED_NODE_Z_INDEX } from './useNodeDrag';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';
import { NodeLayer } from '../canvas/NodeLayer';
import { CanvasViewportContext } from '../canvas/ViewportContext';
import { useSharedValue } from 'react-native-reanimated';
import type { ResultNode as ResultNodeModel } from '../model/types';

function resetStores() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    groupSelectedIds: new Set(),
    dragSnap: null,
  });
}

beforeEach(resetStores);
afterEach(unmountAll);

/** Results are engine-created (P4); inject like ResultNode.test.tsx. */
function seedResult(id = 'r1'): string {
  const node: ResultNodeModel = {
    id,
    kind: 'result',
    sourceChainId: 'c1',
    position: { x: 0, y: 0 },
    chainId: 'c1',
    createdAt: 0,
    derived: { display: '17', computedAt: '2026-08-08T00:00:00.000Z' },
  };
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[id] = node;
  });
  return id;
}

describe('selection focus ring (P7.2)', () => {
  test('a selected node paints the focus ring; an unselected node does not', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '+');
    const renderer = renderNode(<OperatorNode id={id} />);

    expect(renderer.root.findAllByProps({ testID: `operator-node-${id}-selection-focus` })).toHaveLength(
      0,
    );

    act(() => {
      selectNode(id);
    });
    expect(
      findHostByTestID(renderer.root, `operator-node-${id}-selection-focus`).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: selectionFocusColor })]),
    );
  });

  test('a selected result paints the focus ring (read-only, still the continuation target)', () => {
    const id = seedResult();
    const renderer = renderNode(<ResultNode id={id} />);

    expect(renderer.root.findAllByProps({ testID: `result-node-${id}-selection-focus` })).toHaveLength(
      0,
    );

    act(() => {
      selectNode(id);
    });
    expect(
      findHostByTestID(renderer.root, `result-node-${id}-selection-focus`).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: selectionFocusColor })]),
    );
  });

  test('selection hides the inset identity ring — outer focus ring alone is enough', () => {
    // Label grants identity (§11.1) without needing a reference graph.
    const a = addNumberNode({ x: 0, y: 0 }, '32');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[a]!.label = 'n';
    });

    const renderer = renderNode(<NumberNode id={a} />);
    expect(findHostByTestID(renderer.root, `number-node-${a}-identity-ring`)).toBeTruthy();

    act(() => {
      selectNode(a);
    });
    expect(findHostByTestID(renderer.root, `number-node-${a}-selection-focus`)).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: `number-node-${a}-identity-ring` }),
    ).toHaveLength(0);
  });

  test('group selection also shows the focus ring on each member', () => {
    const a = addOperatorNode({ x: 0, y: 0 }, '+');
    const b = addOperatorNode({ x: 40, y: 0 }, '×');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
    });

    const renderer = renderNode(
      <>
        <OperatorNode id={a} />
        <OperatorNode id={b} />
      </>,
    );
    act(() => {
      selectGroup(a);
    });

    expect(findHostByTestID(renderer.root, `operator-node-${a}-selection-focus`)).toBeTruthy();
    expect(findHostByTestID(renderer.root, `operator-node-${b}-selection-focus`)).toBeTruthy();
  });

  test('group selection merges the ring across the interior seam — no border where two selected cells meet', () => {
    const a = addOperatorNode({ x: 0, y: 0 }, '+');
    const b = addOperatorNode({ x: 40, y: 0 }, '×');
    const c = addOperatorNode({ x: 80, y: 0 }, '-');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b, c], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
      draft.nodes[c].chainId = 'c1';
    });

    const renderer = renderNode(
      <>
        <OperatorNode id={a} />
        <OperatorNode id={b} />
        <OperatorNode id={c} />
      </>,
    );
    act(() => {
      selectGroup(a);
    });

    // Start: outer (left) edge keeps its border, the interior (right) seam does not.
    expect(findHostByTestID(renderer.root, `operator-node-${a}-selection-focus`).props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderLeftWidth: SELECTION_FOCUS_WIDTH, borderRightWidth: 0 }),
      ]),
    );
    // Middle: both interior seams lose their border — reads as part of one big cell.
    expect(findHostByTestID(renderer.root, `operator-node-${b}-selection-focus`).props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderLeftWidth: 0, borderRightWidth: 0 }),
      ]),
    );
    // End: outer (right) edge keeps its border, the interior (left) seam does not.
    expect(findHostByTestID(renderer.root, `operator-node-${c}-selection-focus`).props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderLeftWidth: 0, borderRightWidth: SELECTION_FOCUS_WIDTH }),
      ]),
    );
  });

  test('an ordinary single selection keeps the full ring even on a structurally middle cell', () => {
    const a = addOperatorNode({ x: 0, y: 0 }, '+');
    const b = addOperatorNode({ x: 40, y: 0 }, '×');
    const c = addOperatorNode({ x: 80, y: 0 }, '-');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b, c], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
      draft.nodes[c].chainId = 'c1';
    });

    const renderer = renderNode(<OperatorNode id={b} />);
    act(() => {
      selectNode(b); // primary keypad selection, NOT selectGroup — `b` is chain-'middle'.
    });

    expect(findHostByTestID(renderer.root, `operator-node-${b}-selection-focus`).props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderLeftWidth: SELECTION_FOCUS_WIDTH,
          borderRightWidth: SELECTION_FOCUS_WIDTH,
        }),
      ]),
    );
  });
});

/** Viewport stub so NodeLayer's drag hook can mount under Jest (no real canvas). */
function ViewportStub({ children }: { children: React.ReactNode }) {
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zoom = useSharedValue(1);
  return (
    <CanvasViewportContext.Provider value={{ panX, panY, zoom, panIntoView: () => {} }}>
      {children}
    </CanvasViewportContext.Provider>
  );
}

describe('selection focus stacking', () => {
  test('a selected chain member elevates z-index above idle neighbours', () => {
    const a = addOperatorNode({ x: 0, y: 0 }, '+');
    const b = addOperatorNode({ x: 40, y: 0 }, '×');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.chains.c1 = { id: 'c1', members: [a, b], anchor: { x: 0, y: 0 } };
      draft.nodes[a].chainId = 'c1';
      draft.nodes[b].chainId = 'c1';
    });

    const renderer = renderNode(
      <ViewportStub>
        <NodeLayer />
      </ViewportStub>,
    );

    act(() => {
      selectNode(a);
    });

    // Reanimated's useAnimatedStyle is mocked as a plain function in Jest — the
    // returned style object is merged onto the positioned wrapper.
    const positioned = findHostByTestID(renderer.root, `positioned-node-${a}`);
    const styles = Array.isArray(positioned.props.style)
      ? positioned.props.style
      : [positioned.props.style];
    expect(styles).toEqual(
      expect.arrayContaining([expect.objectContaining({ zIndex: SELECTED_NODE_Z_INDEX })]),
    );

    const other = findHostByTestID(renderer.root, `positioned-node-${b}`);
    const otherStyles = Array.isArray(other.props.style) ? other.props.style : [other.props.style];
    expect(otherStyles).toEqual(expect.arrayContaining([expect.objectContaining({ zIndex: 0 })]));
  });
});
