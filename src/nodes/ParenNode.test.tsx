import React from 'react';
import { Text } from 'react-native';
import { ParenNode, tintForDepth } from './ParenNode';
import { useDocumentStore } from '../store/documentStore';
import { addParenNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette, tokens } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('ParenNode', () => {
  test('renders "(" or ")" per side, at the operator width and palette', () => {
    const open = addParenNode({ x: 0, y: 0 }, 'open');
    const close = addParenNode({ x: 40, y: 0 }, 'close');

    expect(renderNode(<ParenNode id={open} />).root.findByType(Text).props.children).toBe('(');
    expect(renderNode(<ParenNode id={close} />).root.findByType(Text).props.children).toBe(')');

    const band = findHostByTestID(renderNode(<ParenNode id={open} />).root, `paren-node-${open}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: tokens.operatorWidth })]),
    );
  });

  test('depth 0 renders the plain operator palette', () => {
    const id = addParenNode({ x: 0, y: 0 }, 'open');
    const band = findHostByTestID(renderNode(<ParenNode id={id} />).root, `paren-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: rolePalette.operator.fill,
          borderColor: rolePalette.operator.border,
        }),
      ]),
    );
  });

  test('deeper nesting renders a progressively lighter fill', () => {
    const id = addParenNode({ x: 0, y: 0 }, 'open');
    const band = findHostByTestID(
      renderNode(<ParenNode id={id} depth={2} />).root,
      `paren-node-${id}`,
    );
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: tintForDepth(rolePalette.operator.fill, 2) }),
      ]),
    );
    expect(tintForDepth(rolePalette.operator.fill, 2)).not.toBe(rolePalette.operator.fill);
  });

  test('tintForDepth clamps beyond the max step and no-ops at depth 0', () => {
    expect(tintForDepth('#000000', 0)).toBe('#000000');
    expect(tintForDepth('#000000', 10)).toBe(tintForDepth('#000000', 4));
  });
});
