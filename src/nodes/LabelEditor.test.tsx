// P6b.1 review follow-up: cover the in-place label TextInput branch and the
// web Space/Enter trap that react-test-renderer cannot exercise via a real DOM.
import React from 'react';
import { act } from 'react-test-renderer';
import { NumberNode } from './NumberNode';
import { attachLabelKeyTrap } from './Cell';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { addNumberNode, editNodeLabel, setNodeLabel } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    editingLabelNodeId: null,
  });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('in-place label editor (P6b.1 review)', () => {
  test('editNodeLabel swaps the caption to a TextInput and typing updates the source', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    act(() => editNodeLabel(id));
    expect(useUiStore.getState().editingLabelNodeId).toBe(id);

    const renderer = renderNode(<NumberNode id={id} />);
    const input = findHostByTestID(renderer.root, `number-node-${id}-label-input`);
    expect(input.type).toBe('TextInput');
    expect(input.props.value).toBe('');
    expect(input.props.autoFocus).toBe(true);

    act(() => {
      input.props.onChangeText('Initial Deposit');
    });
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({
      label: 'Initial Deposit',
    });
    // Controlled value re-renders from the store.
    expect(
      findHostByTestID(renderer.root, `number-node-${id}-label-input`).props.value,
    ).toBe('Initial Deposit');

    act(() => {
      input.props.onBlur();
    });
    expect(useUiStore.getState().editingLabelNodeId).toBeNull();
    // After blur, caption is plain Text again.
    expect(
      renderer.root.findAll((n) => n.props.testID === `number-node-${id}-label-input`),
    ).toHaveLength(0);
    expect(findHostByTestID(renderer.root, `number-node-${id}-label`).props.children).toBe(
      'Initial Deposit',
    );
  });

  test('attachLabelKeyTrap stops Space and Enter from bubbling (web gesture trap)', () => {
    const stopPropagation = jest.fn();
    const listeners = new Map<string, (e: { key: string; stopPropagation: () => void }) => void>();
    const inputNode = {
      addEventListener: jest.fn(
        (type: string, listener: (e: { key: string; stopPropagation: () => void }) => void) => {
          listeners.set(type, listener);
        },
      ),
      removeEventListener: jest.fn(),
    };

    const detach = attachLabelKeyTrap(inputNode);
    expect(inputNode.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    const onKeyDown = listeners.get('keydown')!;
    onKeyDown({ key: ' ', stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    stopPropagation.mockClear();
    onKeyDown({ key: 'Enter', stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    stopPropagation.mockClear();
    onKeyDown({ key: 'a', stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();

    detach();
    expect(inputNode.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  test('editNodeLabel finishes a prior label edit before switching (trim)', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    const b = addNumberNode({ x: 80, y: 0 }, '2');
    act(() => {
      editNodeLabel(a);
      setNodeLabel(a, '  Rate  ');
    });
    expect(useDocumentStore.getState().document.nodes[a]!.label).toBe('  Rate  ');

    act(() => editNodeLabel(b));
    expect(useUiStore.getState().editingLabelNodeId).toBe(b);
    // Previous caption was trimmed via finishEditingLabel before the switch.
    expect(useDocumentStore.getState().document.nodes[a]!.label).toBe('Rate');
  });
});
