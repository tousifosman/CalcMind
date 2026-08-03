import React from 'react';
import { Text } from 'react-native';
import { NumberNode } from './NumberNode';
import { useDocumentStore } from '../store/documentStore';
import { addNumberNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('NumberNode', () => {
  test('renders the locale-formatted display value in the number palette', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1020');
    const renderer = renderNode(<NumberNode id={id} />);

    expect(renderer.root.findByType(Text).props.children).toBe('1,020');
    const band = findHostByTestID(renderer.root, `number-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: rolePalette.number.fill,
          borderColor: rolePalette.number.border,
        }),
      ]),
    );
  });

  test('renders the label above the cell when present', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[id].label = 'Total';
    });

    const renderer = renderNode(<NumberNode id={id} />);
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain('Total');
  });

  test('renders nothing for a missing node', () => {
    const renderer = renderNode(<NumberNode id="does-not-exist" />);
    expect(renderer.toJSON()).toBeNull();
  });
});
