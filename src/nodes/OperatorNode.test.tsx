import React from 'react';
import { Text } from 'react-native';
import { OperatorNode } from './OperatorNode';
import { useDocumentStore } from '../store/documentStore';
import { addOperatorNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette, tokens } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('OperatorNode', () => {
  test('renders its glyph at the fixed operator width, in the operator palette', () => {
    const id = addOperatorNode({ x: 0, y: 0 }, '×');
    const renderer = renderNode(<OperatorNode id={id} />);

    expect(renderer.root.findByType(Text).props.children).toBe('×');
    const band = findHostByTestID(renderer.root, `operator-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: tokens.operatorWidth,
          backgroundColor: rolePalette.operator.fill,
          borderColor: rolePalette.operator.border,
        }),
      ]),
    );
  });

  test('renders nothing for a node of a different kind', () => {
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes.n1 = {
        id: 'n1',
        kind: 'equals',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: 0,
      };
    });
    const renderer = renderNode(<OperatorNode id="n1" />);
    expect(renderer.toJSON()).toBeNull();
  });
});
