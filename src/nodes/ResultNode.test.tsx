import React from 'react';
import { Text } from 'react-native';
import { ResultNode } from './ResultNode';
import { useDocumentStore } from '../store/documentStore';
import { setNodeRaw } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette } from '../ui/tokens';
import type { ResultNode as ResultNodeModel } from '../model/types';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

/** No factory exists for result nodes (P2.3 only covers CRUD-able kinds; a result is created by
 *  the engine, P4) - injected straight into the draft, the same way commands.test.ts builds
 *  chain fixtures it has no command for yet. */
function addResultNode(document: ResultNodeModel): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[document.id] = document;
  });
}

describe('ResultNode', () => {
  test('renders its derived display, solid fill, no dot texture', () => {
    addResultNode({
      id: 'r1',
      kind: 'result',
      sourceChainId: 'c1',
      position: { x: 0, y: 0 },
      chainId: 'c1',
      createdAt: 0,
      derived: { display: '1204', computedAt: '2026-08-03T00:00:00.000Z' },
    });

    const renderer = renderNode(<ResultNode id="r1" />);

    const texts = renderer.root.findAllByType(Text);
    expect(texts).toHaveLength(1);
    expect(texts[0].props.children).toBe('1204');

    const band = findHostByTestID(renderer.root, 'result-node-r1');
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: rolePalette.result.fill,
          borderColor: rolePalette.result.border,
        }),
      ]),
    );
    // Solid fill only - no texture pattern/image sibling next to the glyph (§11.3, decision #9).
    expect(band.children).toHaveLength(1);
  });

  test('renders nothing for a missing node', () => {
    const renderer = renderNode(<ResultNode id="does-not-exist" />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('is read-only: an edit attempt is rejected, not silently swallowed', () => {
    addResultNode({
      id: 'r1',
      kind: 'result',
      sourceChainId: 'c1',
      position: { x: 0, y: 0 },
      chainId: 'c1',
      createdAt: 0,
    });

    expect(() => setNodeRaw('r1', '5')).toThrow(/read-only/);
    // The rejected attempt must not have mutated the node either.
    expect(useDocumentStore.getState().document.nodes.r1).toMatchObject({ kind: 'result' });
  });
});
