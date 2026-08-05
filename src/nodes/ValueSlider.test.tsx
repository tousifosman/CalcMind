// ValueSlider popover (§8.8 / P6b.3).
import React from 'react';
import { TextInput } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import { ValueSlider, ValueSliderOverlay } from './ValueSlider';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  editNumberNode,
  endValueScrub,
  selectNode,
  _setScrubFrameSchedulerForTests,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

type GestureBuilder = {
  __kind: string;
  __handlers: Record<string, ((e?: { x: number }) => void) | undefined>;
};

function gestureApi(): {
  __resetBuilders: () => void;
  __builders: () => GestureBuilder[];
} {
  return Gesture as unknown as {
    __resetBuilders: () => void;
    __builders: () => GestureBuilder[];
  };
}

function latestBuilder(kind: string): GestureBuilder {
  const builders = gestureApi().__builders().filter((b) => b.__kind === kind);
  expect(builders.length).toBeGreaterThan(0);
  return builders[builders.length - 1]!;
}

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null });
}

beforeEach(() => {
  resetStore();
  gestureApi().__resetBuilders();
  _setScrubFrameSchedulerForTests({
    schedule: (cb) => {
      cb();
      return 0 as unknown as ReturnType<typeof requestAnimationFrame>;
    },
    cancel: () => undefined,
  });
});
afterEach(() => {
  endValueScrub();
  _setScrubFrameSchedulerForTests(null);
  unmountAll();
});

describe('ValueSlider', () => {
  test('renders a popover with both range endpoints labelled', () => {
    const id = addNumberNode({ x: 40, y: 80 }, '42');
    const renderer = renderNode(<ValueSlider nodeId={id} />);

    expect(renderer.root.findByProps({ testID: `value-slider-${id}` })).toBeTruthy();
    // Editable bound inputs are the labelled endpoints (42 → [0, 100]).
    const minInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-min-${id}`);
    const maxInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-max-${id}`);
    expect(minInput!.props.value).toBe('0');
    expect(maxInput!.props.value).toBe('100');
  });

  test('zero opens with [0, 10]', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '0');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-min-${id}`)!
        .props.value,
    ).toBe('0');
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-max-${id}`)!
        .props.value,
    ).toBe('10');
  });

  test('negative value labels a symmetric range', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '-7');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-min-${id}`)!
        .props.value,
    ).toBe('-10');
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-max-${id}`)!
        .props.value,
    ).toBe('10');
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

    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-min-${id}`)!
        .props.value,
    ).toBe('-20');
  });

  test('renders nothing for mid-typing raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('track exposes accessibilityValue for the current range and value', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const track = renderer.root.findByProps({ testID: `value-slider-track-${id}` });
    expect(track.props.accessibilityRole).toBe('adjustable');
    expect(track.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  });
});

describe('ValueSlider gesture wiring (§8.8 tap snap / drag continuous)', () => {
  const TRACK_WIDTH = 200;

  function renderReadySlider(raw: string) {
    const id = addNumberNode({ x: 0, y: 0 }, raw);
    gestureApi().__resetBuilders();
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const track = renderer.root.findByProps({ testID: `value-slider-track-${id}` });
    act(() => {
      track.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: TRACK_WIDTH, height: 28 } },
      });
    });
    // Layout update re-creates gestures; read the latest builders after it.
    return { id, renderer, pan: latestBuilder('Pan'), tap: latestBuilder('Tap') };
  }

  test('tap snaps to the nearest integer and shows the integer-snap hint', () => {
    // Mid-track on [0, 10] → 5; a tap just off centre still rounds.
    const { id, renderer, tap } = renderReadySlider('3');
    act(() => {
      tap.__handlers.onEnd?.({ x: TRACK_WIDTH * 0.44 }); // → 4.4 → round 4
    });

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '4' });
    expect(renderer.root.findByProps({ testID: `value-slider-snap-hint-${id}` })).toBeTruthy();
  });

  test('drag writes continuous values and clears integer snap', () => {
    const { id, renderer, pan, tap } = renderReadySlider('3');
    // Enter integer mode first via tap.
    act(() => {
      tap.__handlers.onEnd?.({ x: TRACK_WIDTH * 0.5 });
    });
    expect(renderer.root.findByProps({ testID: `value-slider-snap-hint-${id}` })).toBeTruthy();

    // Drag again → continuous (§8.8); 0.33 of [0,10] → 3.3.
    act(() => {
      pan.__handlers.onBegin?.({ x: TRACK_WIDTH * 0.33 });
      pan.__handlers.onUpdate?.({ x: TRACK_WIDTH * 0.33 });
      pan.__handlers.onFinalize?.();
    });

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3.3' });
    expect(
      renderer.root.findAll((n) => n.props?.testID === `value-slider-snap-hint-${id}`),
    ).toHaveLength(0);
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
