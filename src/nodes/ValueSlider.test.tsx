// ValueSlider popover (§8.8 / P6b.3, plus the show/pin/step follow-up).
import React from 'react';
import { TextInput, Vibration } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { Line } from 'react-native-svg';
import CheckIcon from 'react-native-heroicons/solid/CheckIcon';
import { act } from 'react-test-renderer';
import { ValueSlider, ValueSliderOverlay } from './ValueSlider';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  endValueScrub,
  setNodeRaw,
  showValueSlider,
  _setScrubFrameSchedulerForTests,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

type GestureBuilder = {
  __kind: string;
  __handlers: Record<string, ((e?: { x?: number; translationX?: number; translationY?: number }) => void) | undefined>;
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
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    sliderState: null,
    liveViewport: null,
  });
}

/** §8.8: the popover only renders while `uiStore.sliderState` names its node - the
 *  direct-render tests below open it explicitly instead of relying on selection. */
function openSlider(id: string) {
  act(() => useUiStore.getState().openSlider(id));
}

/** Pulls the popover's own `{ left, top }` out of its style array - the second
 *  entry is a plain positioning object, not a `StyleSheet.create` reference. */
function popoverPosition(
  renderer: ReturnType<typeof renderNode>,
  id: string,
): { left: number; top: number } {
  const style = ([] as unknown[]).concat(
    renderer.root.findByProps({ testID: `value-slider-${id}` }).props.style,
  );
  const pos = style.find(
    (s): s is { left: number; top: number } => !!s && typeof s === 'object' && 'left' in s,
  );
  expect(pos).toBeDefined();
  return pos!;
}

let vibrateSpy: jest.SpyInstance;

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
  vibrateSpy = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
});
afterEach(() => {
  endValueScrub();
  _setScrubFrameSchedulerForTests(null);
  vibrateSpy.mockRestore();
  unmountAll();
});

describe('ValueSlider', () => {
  test('renders a popover with both range endpoints labelled', () => {
    const id = addNumberNode({ x: 40, y: 80 }, '42');
    openSlider(id);
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
    openSlider(id);
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
    openSlider(id);
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
    openSlider(id);
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
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('renders nothing when sliderState names a different node', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    const other = addNumberNode({ x: 40, y: 0 }, '1');
    openSlider(other);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('track exposes accessibilityValue for the current range and value', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const track = renderer.root.findByProps({ testID: `value-slider-track-${id}` });
    expect(track.props.accessibilityRole).toBe('adjustable');
    expect(track.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  });
});

describe('ValueSlider "Keep open" checkbox (§8.8 pin/dismiss/drag follow-up)', () => {
  test('opens unpinned, with no connector line and the drag bar hidden (not unmounted)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);

    const pin = renderer.root.findByProps({ testID: `value-slider-pin-${id}` });
    expect(pin.props.accessibilityState).toEqual({ checked: false });
    expect(
      renderer.root.findAll((n) => n.props?.testID === `value-slider-connector-${id}`),
    ).toHaveLength(0);
    // The handle container stays mounted at a fixed size whether pinned or not -
    // only the bar's own opacity changes - so toggling pinned can't resize the
    // popover. Asserted here via the container's presence and the bar's opacity.
    expect(renderer.root.findByProps({ testID: `value-slider-drag-handle-${id}` })).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: `value-slider-drag-handle-bar-${id}` }).props.style,
    ).toContainEqual({ opacity: 0 });
    // No checkmark glyph while unchecked.
    expect(renderer.root.findAllByType(CheckIcon)).toHaveLength(0);
  });

  test('checking it pins the slider, drawing the connector line and revealing the drag bar', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const handleStyleBefore = renderer.root.findByProps({ testID: `value-slider-drag-handle-${id}` }).props
      .style;

    act(() => {
      renderer.root.findByProps({ testID: `value-slider-pin-${id}` }).props.onPress();
    });

    expect(useUiStore.getState().sliderState).toMatchObject({ nodeId: id, pinned: true });
    expect(renderer.root.findByProps({ testID: `value-slider-pin-${id}` }).props.accessibilityState).toEqual(
      { checked: true },
    );
    expect(renderer.root.findByProps({ testID: `value-slider-connector-${id}` })).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: `value-slider-drag-handle-bar-${id}` }).props.style,
    ).toContainEqual({ opacity: 1 });
    // The handle container's own style (padding/margin) doesn't change with pinned.
    expect(renderer.root.findByProps({ testID: `value-slider-drag-handle-${id}` }).props.style).toBe(
      handleStyleBefore,
    );
    // A visible checkmark glyph, not just a colour change (§8.8 follow-up: the
    // plain white square used before this didn't read as a check to a user).
    expect(renderer.root.findAllByType(CheckIcon)).toHaveLength(1);
  });

  test('connector line colour matches the popover\'s own chrome, not the cell\'s identity hue', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    act(() => useUiStore.getState().setSliderPinned(true));
    const renderer = renderNode(<ValueSlider nodeId={id} />);

    const line = renderer.root.findByType(Line);
    const popoverStyle = ([] as unknown[]).concat(
      renderer.root.findByProps({ testID: `value-slider-${id}` }).props.style,
    );
    const popoverChrome = popoverStyle.find(
      (s): s is { borderColor: string } => !!s && typeof s === 'object' && 'borderColor' in s,
    );
    expect(popoverChrome).toBeDefined();
    expect(line.props.stroke).toBe(popoverChrome!.borderColor);
  });

  test('unchecking it clears pinned and any accumulated drag offset', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    act(() => {
      useUiStore.getState().setSliderPinned(true);
      useUiStore.getState().setSliderOffset({ x: 30, y: 12 });
    });
    const renderer = renderNode(<ValueSlider nodeId={id} />);

    act(() => {
      renderer.root.findByProps({ testID: `value-slider-pin-${id}` }).props.onPress();
    });

    expect(useUiStore.getState().sliderState).toEqual({
      nodeId: id,
      pinned: false,
      offset: { x: 0, y: 0 },
    });
  });

  test('dragging the handle moves the popover via sliderState.offset', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    act(() => useUiStore.getState().setSliderPinned(true));
    gestureApi().__resetBuilders();
    renderNode(<ValueSlider nodeId={id} />);

    const handlePan = gestureApi()
      .__builders()
      .filter((b) => b.__kind === 'Pan')[0]!; // the drag handle mounts first, before the track

    act(() => {
      handlePan.__handlers.onBegin?.();
      handlePan.__handlers.onUpdate?.({ translationX: 15, translationY: -8 });
    });

    expect(useUiStore.getState().sliderState?.offset).toEqual({ x: 15, y: -8 });
  });
});

describe('ValueSlider position stability (§8.8 follow-up)', () => {
  test('does not shift when the cell gains digits (anchor width frozen on open)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const before = popoverPosition(renderer, id);

    // A much wider cell, same as scrubbing the value would produce mid-drag.
    act(() => setNodeRaw(id, '3.123456789'));

    expect(popoverPosition(renderer, id)).toEqual(before);
  });

  test('tracks uiStore.liveViewport during an active canvas gesture, not the lagging committed one', () => {
    const id = addNumberNode({ x: 100, y: 100 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const beforePan = popoverPosition(renderer, id);

    act(() => {
      useUiStore.getState().setLiveViewport({ pan: { x: 500, y: 500 }, zoom: 1 });
    });
    const duringPan = popoverPosition(renderer, id);
    expect(duringPan).not.toEqual(beforePan);

    // Gesture end: Canvas clears liveViewport once the committed viewport catches up.
    act(() => {
      useUiStore.getState().setLiveViewport(null);
    });
    expect(popoverPosition(renderer, id)).toEqual(beforePan);
  });
});

const TRACK_WIDTH = 200;

/** Renders a slider with a laid-out track, ready to drive its Pan/Tap gestures
 *  directly. Shared by the gesture-wiring and Step-field describe blocks below. */
function renderReadySlider(raw: string) {
  const id = addNumberNode({ x: 0, y: 0 }, raw);
  openSlider(id);
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

describe('ValueSlider gesture wiring (§8.8 tap snap / drag continuous)', () => {
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

describe('ValueSlider Step field (§8.8 follow-up)', () => {
  test('defaults to 0.1, positioned between the bound inputs', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-step-${id}`)!
        .props.value,
    ).toBe('0.1');
  });

  test('is editable and commits a positive number', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const stepInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-step-${id}`)!;

    act(() => {
      stepInput.props.onChangeText('0.5');
      stepInput.props.onBlur();
    });

    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-step-${id}`)!
        .props.value,
    ).toBe('0.5');
  });

  test('an invalid or non-positive commit reverts to the last valid step', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    openSlider(id);
    const renderer = renderNode(<ValueSlider nodeId={id} />);
    const stepInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-step-${id}`)!;

    act(() => {
      stepInput.props.onChangeText('0');
      stepInput.props.onBlur();
    });
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-step-${id}`)!
        .props.value,
    ).toBe('0.1');

    act(() => {
      stepInput.props.onChangeText('abc');
      stepInput.props.onBlur();
    });
    expect(
      renderer.root.findAllByType(TextInput).find((n) => n.props.testID === `value-slider-step-${id}`)!
        .props.value,
    ).toBe('0.1');
  });

  test('continuous dragging quantizes to the default 0.1 grid, not an arbitrary fraction', () => {
    const { id, pan } = renderReadySlider('3');
    act(() => {
      pan.__handlers.onBegin?.({ x: TRACK_WIDTH * 0.234 }); // raw fraction → 2.34...
      pan.__handlers.onFinalize?.();
    });
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '2.3' });
  });

  test('editing the step to 1 makes dragging land on whole numbers', () => {
    const { id, renderer, pan } = renderReadySlider('3');
    const stepInput = renderer.root
      .findAllByType(TextInput)
      .find((n) => n.props.testID === `value-slider-step-${id}`)!;
    act(() => {
      stepInput.props.onChangeText('1');
      stepInput.props.onBlur();
    });

    act(() => {
      pan.__handlers.onBegin?.({ x: TRACK_WIDTH * 0.27 }); // raw fraction → 2.7
      pan.__handlers.onFinalize?.();
    });
    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3' });
  });

  test('vibrates once per step crossing during a drag, not on every pointer move', () => {
    const { pan } = renderReadySlider('3');
    act(() => {
      pan.__handlers.onBegin?.({ x: TRACK_WIDTH * 0.23 }); // 3 → 2.3: crosses a step
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      pan.__handlers.onUpdate?.({ x: TRACK_WIDTH * 0.232 }); // still quantizes to 2.3
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      pan.__handlers.onUpdate?.({ x: TRACK_WIDTH * 0.236 }); // 2.3 → 2.4: crosses a step
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(2);
  });

  test('a tap (integer snap) does not vibrate - only a step-quantized drag does', () => {
    const { tap } = renderReadySlider('3');
    act(() => {
      tap.__handlers.onEnd?.({ x: TRACK_WIDTH * 0.5 });
    });
    expect(vibrateSpy).not.toHaveBeenCalled();
  });
});

describe('ValueSliderOverlay', () => {
  test('stays hidden until the slider is explicitly opened, even with a number selected', () => {
    const id = addNumberNode({ x: 10, y: 10 }, '3');
    act(() => useUiStore.getState().setSelectedNode(id));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('mounts when showValueSlider opens it', () => {
    const id = addNumberNode({ x: 10, y: 10 }, '3');
    act(() => showValueSlider(id));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.root.findByProps({ testID: 'value-slider-overlay' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: `value-slider-${id}` })).toBeTruthy();
  });

  test('stays hidden when the open node is not a number', () => {
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.op1 = {
          id: 'op1',
          kind: 'operator',
          op: '+',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
        };
      });
      useUiStore.getState().openSlider('op1');
    });
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('exposes bound TextInputs for the open number', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '100');
    act(() => showValueSlider(id));
    const renderer = renderNode(<ValueSliderOverlay />);
    expect(renderer.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
  });
});
