import React from 'react';
import { act } from 'react-test-renderer';
import { OperatorNode } from './OperatorNode';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { addOperatorNode, selectNode, selectGroup } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { selectionFocusColor } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

function resetStores() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    groupSelectedIds: new Set(),
  });
}

beforeEach(resetStores);
afterEach(unmountAll);

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
});
