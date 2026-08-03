import React from 'react';
import { Text } from 'react-native';
import { EqualsNode } from './EqualsNode';
import { useDocumentStore } from '../store/documentStore';
import { addEqualsNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette, tokens } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('EqualsNode', () => {
  test('renders "=" at the fixed equals width, in the equals palette', () => {
    const id = addEqualsNode({ x: 0, y: 0 });
    const renderer = renderNode(<EqualsNode id={id} />);

    expect(renderer.root.findByType(Text).props.children).toBe('=');
    const band = findHostByTestID(renderer.root, `equals-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: tokens.equalsWidth,
          backgroundColor: rolePalette.equals.fill,
          borderColor: rolePalette.equals.border,
        }),
      ]),
    );
  });

  test('renders nothing for a missing node', () => {
    const renderer = renderNode(<EqualsNode id="does-not-exist" />);
    expect(renderer.toJSON()).toBeNull();
  });
});
