import React from 'react';
import { Text, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { NumberNode } from './NumberNode';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { addNumberNode, editNumberNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null });
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

describe('NumberNode editing', () => {
  test('shows a Text glyph, not a TextInput, when not the edit target', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const renderer = renderNode(<NumberNode id={id} />);
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('5');
  });

  test('swaps to a focused TextInput showing the locale display when editing', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1020');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    const input = renderer.root.findByType(TextInput);
    expect(input.props.value).toBe('1,020');
    expect(input.props.showSoftInputOnFocus).toBe(false);
    expect(input.props.inputMode).toBe('none');
    expect(input.props.keyboardType).toBeUndefined();
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
  });

  test('typing normalises locale input to canonical raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onChangeText('3.'));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3.' });
  });

  test('an invalid keystroke is dropped rather than stored', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onChangeText('3..'));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3' });
  });

  test('backspace on an already-empty raw deletes the node and exits edit mode', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: 'Backspace' } }),
    );

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('Escape while editing exits edit mode and discards an empty raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: 'Escape' } }),
    );

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });

  test('blurring with a non-empty raw commits it rather than discarding', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '7');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onBlur());

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '7' });
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('a hardware operator key while editing continues the chain (P2.8, §8.5)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '12');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '+' } }));

    const chainId = useDocumentStore.getState().document.nodes[id]!.chainId!;
    const chain = useDocumentStore.getState().document.chains[chainId];
    expect(chain.members).toHaveLength(3);
    expect(useDocumentStore.getState().document.nodes[chain.members[1]]).toMatchObject({
      kind: 'operator',
      op: '+',
    });
    // Dispatch moves the edit target to the fresh operand, so it's no longer this node.
    expect(useUiStore.getState().editingNodeId).toBe(chain.members[2]);
  });

  test('a dispatched command key calls preventDefault, so the browser cannot also insert it', () => {
    // Regression test for the P2.8 hardware-keyboard bug (docs/journal/2026-08-04.md): without
    // preventDefault, react-native-web still performs its native default text-insertion for the
    // keydown, and since dispatchEditorCommand synchronously moves editingNodeId to a *different*
    // node, that insertion lands on the freshly-created operand instead of vanishing - '-' is
    // valid canonical raw, so the leaked character survived as real (wrong) data. `+` isn't
    // canonical raw, so the same leak there was silently swallowed and never visible.
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);
    const preventDefault = jest.fn();

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '-' }, preventDefault }),
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);

    const chainId = useDocumentStore.getState().document.nodes[id]!.chainId!;
    const chain = useDocumentStore.getState().document.chains[chainId];
    const newOperandId = chain.members[2];
    // The whole point: the fresh operand must start genuinely empty, not pre-loaded with '-'.
    expect(useDocumentStore.getState().document.nodes[newOperandId]).toMatchObject({ raw: '' });
  });

  test('a digit key does not call preventDefault, so native insertion + onChangeText still work', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);
    const preventDefault = jest.fn();

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '2' }, preventDefault }),
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('a digit typed via a real keystroke is left to onChangeText, not double-applied', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '2' } }));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '1' });
  });
});
