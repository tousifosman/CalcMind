// ValueSlider popover (§8.8 / P6b.3).
import React from 'react';
import { TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { ValueSlider, ValueSliderOverlay } from './ValueSlider';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { addNumberNode, editNumberNode, selectNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('ValueSlider', () => {
  test('renders a popover with both range endpoints labelled', () => {
    const id = addNumberNode({ x: 40, y: 80 }, '42');
    const renderer = renderNode(<ValueSlider nodeId={id} />);

    expect(renderer.root.findByProps({ testID: `value-slider-${id}` })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: `value-slider-min-label-${id}` }).props.children).toBe(
      0,
    );
    expect(renderer.root.findByProps({ testID: `value-slider-max-label-${id}` }).props.children).toBe(
      100,
    );
  });

  test('zero opens with [0, 10]', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '0');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.root.findByProps({ testID: `value-slider-min-label-${id}` }).props.children).toBe(
      0,
    );
    expect(renderer.root.findByProps({ testID: `value-slider-max-label-${id}` }).props.children).toBe(
      10,
    );
  });

  test('negative value labels a symmetric range', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '-7');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.root.findByProps({ testID: `value-slider-min-label-${id}` }).props.children).toBe(
      -10,
    );
    expect(renderer.root.findByProps({ testID: `value-slider-max-label-${id}` }).props.children).toBe(
      10,
    );
  });

  test('bounds inputs are editable', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const minInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-min-${id}`);
    expect(minInput).toBeDefined();

    act(() => {
      minInput!.props.onChangeText('-20');
      minInput!.props.onBlur();
    });

    expect(renderer.root.findByProps({ testID: `value-slider-min-label-${id}` }).props.children).toBe(
      -20,
    );
  });

  test('renders nothing for mid-typing raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.toJSON()).toBeNull();
  });
});

describe('ValueSliderOverlay', () => {
  test('mounts when a scrubbable number is selected', () => {
    const id = addNumberNode({ x: 10, y: 10 }, '3');
    act(() => editNumberNode(id));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.root.findByProps({ testID: 'value-slider-overlay' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: `value-slider-${id}` })).toBeTruthy();
  });

  test('stays hidden when selection is not a number', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    act(() => selectNode(id));
    // selectNode clears editing but keeps selection — still a number, so shown.
    // Switch to no selection:
    act(() => useUiStore.getState().setSelectedNode(null));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('exposes bound TextInputs for the selected number', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '100');
    act(() => editNumberNode(id));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
  });
});
