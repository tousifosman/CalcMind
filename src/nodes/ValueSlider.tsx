// Value slider popover (§8.8 / P6b.3–P6b.4, plus the show/pin/step follow-up).
//
// Raised explicitly from the cell menu's `Show slider` item (`commands.ts`'s
// `showValueSlider`) rather than automatically on selection — `ValueSliderOverlay`
// below reads `uiStore.sliderState`, not `selectedNodeId`. Dragging the thumb
// rewrites the number through `scrubNodeValue` (one undo entry for the whole
// gesture, autosave suppressed, dirty-subgraph recompute throttled to the frame
// budget). Tap toggles integer snap (whole numbers); drag quantizes to the Step
// field's grid instead (default 0.1, `quantizeToStep` in `inferSliderRange.ts`),
// vibrating once per step crossing rather than continuously.
//
// The popover opens unpinned: `AppShell`'s canvas tap/long-press handlers close it
// the moment something else is tapped, the same as any other momentary prompt. The
// `Keep open` checkbox pins it - suppressing that dismissal - and while pinned also
// draws a connector line back to the cell and lets the popover itself be dragged via
// its handle, independent of the anchored position under the cell. The handle is
// always mounted, at a fixed height, so pinning never resizes the popover - only its
// bar's opacity and its own gesture's `enabled` state track `pinned`.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import CheckIcon from 'react-native-heroicons/solid/CheckIcon';
import { worldToScreen } from '../canvas/coords';
import { widthOf } from '../chains/measure';
import { NodeId, Vec2 } from '../model/types';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { usePreferencesStore } from '../store/preferencesStore';
import {
  beginValueScrub,
  endValueScrub,
  isValueScrubbing,
  scrubNodeValue,
} from '../store/commands';
import { getDeviceLocale } from '../ui/locale';
import { rolePalette, nodeHeightFor } from '../ui/tokens';
import {
  inferSliderRange,
  quantizeToStep,
  rawToSliderValue,
  sliderValueToRaw,
  valueAtTrackFraction,
  type SliderRange,
} from './inferSliderRange';

const POPOVER_WIDTH = 260;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 20;
/** Gap between the cell's bottom edge and the popover top, in screen px. */
const ANCHOR_GAP = 8;
/** Default Step field value (§8.8 follow-up) - continuous dragging's grid size. */
const DEFAULT_STEP = 0.1;
/** Short tick rather than `Vibration.vibrate()`'s 400ms default - one per step
 *  crossing during a drag, not one long buzz. */
const STEP_VIBRATION_MS = 10;
/** The popover's own chrome gray (already `boundInput`/`dragHandleBar`'s border),
 *  reused for the popover's border and the pinned connector line so the line reads
 *  as this window's own edge rather than a document-graph connector in the cell's
 *  identity hue. */
const POPOVER_BORDER_COLOR = '#D1D5DB';

// Same trade as Keypad keys: a mousedown on the slider must not blur the
// number's TextInput (which would deselect and dismiss this popover).
const preventFocusSteal =
  Platform.OS === 'web'
    ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
    : {};

interface ValueSliderProps {
  nodeId: NodeId;
}

export function ValueSlider({ nodeId }: ValueSliderProps) {
  const node = useDocumentStore((s) => s.document.nodes[nodeId]);
  const viewport = useDocumentStore((s) => s.document.viewport);
  const fontSize = usePreferencesStore((s) => s.numeralFontSize);
  const sliderState = useUiStore((s) => s.sliderState);
  const locale = getDeviceLocale();

  const [range, setRange] = useState<SliderRange>({ min: 0, max: 10 });
  const [integerSnap, setIntegerSnap] = useState(false);
  const [minText, setMinText] = useState('0');
  const [maxText, setMaxText] = useState('10');
  const [step, setStep] = useState(DEFAULT_STEP);
  const [stepText, setStepText] = useState(String(DEFAULT_STEP));
  const [trackWidth, setTrackWidth] = useState(POPOVER_WIDTH - 32);
  // Re-infer bounds when the selected node changes, not on every scrub frame.
  const rangedForNode = useRef<NodeId | null>(null);
  // Ref so gesture callbacks always read the latest range / snap / step without
  // rebuilding the gesture object every render.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const integerSnapRef = useRef(integerSnap);
  integerSnapRef.current = integerSnap;
  const stepRef = useRef(step);
  stepRef.current = step;
  // Last value actually written by a drag, compared against the next quantized
  // value to tell a real step crossing (vibrate) apart from sub-step pointer
  // jitter that quantizes to the same grid point (don't). A ref, not state or the
  // `value` prop, for the same reason `rangeRef`/`integerSnapRef` are: it must be
  // read and written synchronously inside the gesture callback itself, not depend
  // on a re-render having landed between two fast onUpdate calls.
  const lastQuantizedValueRef = useRef<number | null>(null);

  const value =
    node && node.kind === 'number' ? rawToSliderValue(node.raw) : null;

  useLayoutEffect(() => {
    if (!node || node.kind !== 'number') return;
    if (rangedForNode.current === nodeId) return;
    const parsed = rawToSliderValue(node.raw);
    if (parsed === null) return;
    const next = inferSliderRange(parsed);
    rangedForNode.current = nodeId;
    setRange(next);
    setMinText(String(next.min));
    setMaxText(String(next.max));
    setIntegerSnap(false);
    setStep(DEFAULT_STEP);
    setStepText(String(DEFAULT_STEP));
    lastQuantizedValueRef.current = parsed;
  }, [node, nodeId]);

  useEffect(() => {
    return () => {
      // Close a scrub left open by an interrupted gesture (deselect / node
      // deleted mid-drag) so autosave suppress cannot stick. Only fire when a
      // scrub is actually open — selection changes that never scrubbed should
      // not touch the scrub session.
      if (isValueScrubbing()) {
        endValueScrub();
      }
    };
  }, [nodeId]);

  // Guards against the two ways this popover can be asked to render for a node it
  // no longer applies to: the slider closed/re-opened elsewhere (sliderState out of
  // sync with `nodeId`), or the node became invalid mid-open (deleted, or edited to
  // a mid-typing raw) - same as the original selection-driven guard, just widened.
  if (
    !node ||
    node.kind !== 'number' ||
    value === null ||
    !sliderState ||
    sliderState.nodeId !== nodeId
  ) {
    return null;
  }

  const pinned = sliderState.pinned;
  const offset = sliderState.offset;

  const cellWidth = widthOf(node, locale, fontSize);
  const screenTopLeft = worldToScreen(node.position, viewport);
  const screenBottom = worldToScreen(
    { x: node.position.x, y: node.position.y + nodeHeightFor(fontSize) },
    viewport,
  );
  const screenCellWidth = cellWidth * viewport.zoom;
  const left = screenTopLeft.x + screenCellWidth / 2 - POPOVER_WIDTH / 2 + offset.x;
  const top = screenBottom.y + ANCHOR_GAP + offset.y;
  // Endpoints for the pinned connector line: the cell's bottom-center (same point
  // the popover anchors from before any drag offset) to the popover's own top-center.
  const cellAnchor: Vec2 = { x: screenTopLeft.x + screenCellWidth / 2, y: screenBottom.y };
  const popoverAnchor: Vec2 = { x: left + POPOVER_WIDTH / 2, y: top };

  function writeFraction(fraction: number, snap: boolean): void {
    let next = valueAtTrackFraction(fraction, rangeRef.current, snap);
    if (!snap) {
      // Continuous dragging (tap's integer snap is a separate, coarser mode -
      // §8.8) lands on the Step field's grid rather than an arbitrary fraction.
      next = quantizeToStep(next, stepRef.current, rangeRef.current);
      if (next !== lastQuantizedValueRef.current) {
        Vibration.vibrate(STEP_VIBRATION_MS);
      }
    }
    lastQuantizedValueRef.current = next;
    scrubNodeValue(nodeId, sliderValueToRaw(next));
  }

  function onScrubStart(): void {
    beginValueScrub(nodeId);
  }

  function onScrubEnd(): void {
    endValueScrub();
  }

  function onTrackTap(fraction: number): void {
    // Tap → integer snap mode and land on the nearest integer at the tap (§8.8).
    setIntegerSnap(true);
    integerSnapRef.current = true;
    beginValueScrub(nodeId);
    writeFraction(fraction, true);
    endValueScrub();
  }

  function onDragFraction(fraction: number): void {
    // Dragging again leaves integer mode for continuous values (§8.8).
    if (integerSnapRef.current) {
      integerSnapRef.current = false;
      setIntegerSnap(false);
    }
    writeFraction(fraction, false);
  }

  function commitBound(which: 'min' | 'max', text: string): void {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setMinText(String(range.min));
      setMaxText(String(range.max));
      return;
    }
    let next: SliderRange =
      which === 'min' ? { min: parsed, max: range.max } : { min: range.min, max: parsed };
    if (next.min > next.max) {
      next = { min: next.max, max: next.min };
    }
    setRange(next);
    setMinText(String(next.min));
    setMaxText(String(next.max));
  }

  function commitStep(text: string): void {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStepText(String(step));
      return;
    }
    setStep(parsed);
    setStepText(String(parsed));
  }

  const span = range.max - range.min;
  const thumbFraction = span === 0 ? 0 : (value - range.min) / span;
  const thumbLeft =
    Math.min(Math.max(thumbFraction, 0), 1) * Math.max(0, trackWidth - THUMB_SIZE);

  function onTogglePinned(): void {
    useUiStore.getState().setSliderPinned(!pinned);
  }

  const connectorMinX = Math.min(cellAnchor.x, popoverAnchor.x);
  const connectorMinY = Math.min(cellAnchor.y, popoverAnchor.y);
  const connectorWidth = Math.max(1, Math.abs(cellAnchor.x - popoverAnchor.x));
  const connectorHeight = Math.max(1, Math.abs(cellAnchor.y - popoverAnchor.y));

  return (
    <>
      {pinned ? (
        <Svg
          pointerEvents="none"
          testID={`value-slider-connector-${nodeId}`}
          width={connectorWidth}
          height={connectorHeight}
          viewBox={`${connectorMinX} ${connectorMinY} ${connectorWidth} ${connectorHeight}`}
          style={[styles.connector, { left: connectorMinX, top: connectorMinY }]}
        >
          <Line
            x1={cellAnchor.x}
            y1={cellAnchor.y}
            x2={popoverAnchor.x}
            y2={popoverAnchor.y}
            stroke={POPOVER_BORDER_COLOR}
            strokeWidth={2}
          />
        </Svg>
      ) : null}
      <View
        testID={`value-slider-${nodeId}`}
        style={[styles.popover, { left, top, width: POPOVER_WIDTH }]}
        {...preventFocusSteal}
      >
        <DragHandle nodeId={nodeId} offset={offset} pinned={pinned} />
        <View style={styles.boundsRow}>
          <BoundInput
            testID={`value-slider-min-${nodeId}`}
            value={minText}
            onChangeText={setMinText}
            onCommit={(text) => commitBound('min', text)}
          />
          <View style={styles.stepGroup}>
            <Text style={styles.stepLabel}>Step</Text>
            <BoundInput
              testID={`value-slider-step-${nodeId}`}
              value={stepText}
              onChangeText={setStepText}
              onCommit={commitStep}
            />
          </View>
          <BoundInput
            testID={`value-slider-max-${nodeId}`}
            value={maxText}
            onChangeText={setMaxText}
            onCommit={(text) => commitBound('max', text)}
          />
        </View>

        <SliderTrack
          nodeId={nodeId}
          trackWidth={trackWidth}
          thumbLeft={thumbLeft}
          range={range}
          value={value}
          integerSnap={integerSnap}
          onLayoutWidth={setTrackWidth}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onTapFraction={onTrackTap}
          onDragFraction={onDragFraction}
        />

        {integerSnap ? (
          <Text style={styles.snapHint} testID={`value-slider-snap-hint-${nodeId}`}>
            Integer snap
          </Text>
        ) : null}

        <TouchableOpacity
          testID={`value-slider-pin-${nodeId}`}
          style={styles.pinRow}
          onPress={onTogglePinned}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: pinned }}
          accessibilityLabel="Keep slider open"
          {...preventFocusSteal}
        >
          <View style={[styles.checkbox, pinned && styles.checkboxChecked]}>
            {pinned ? <CheckIcon size={11} color="#FFFFFF" /> : null}
          </View>
          <Text style={styles.pinLabel}>Keep open</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

interface BoundInputProps {
  testID: string;
  value: string;
  onChangeText: (text: string) => void;
  onCommit: (text: string) => void;
}

function BoundInput({ testID, value, onChangeText, onCommit }: BoundInputProps) {
  // Keep a ref so blur/submit can commit the latest keystrokes even when React
  // has not yet re-rendered the closed-over `value` prop (common in tests that
  // fire onChangeText + onBlur inside one `act`).
  const draftRef = useRef(value);
  draftRef.current = value;

  return (
    <TextInput
      testID={testID}
      style={styles.boundInput}
      value={value}
      onChangeText={(text) => {
        draftRef.current = text;
        onChangeText(text);
      }}
      onBlur={() => onCommit(draftRef.current)}
      onSubmitEditing={() => onCommit(draftRef.current)}
      keyboardType="numeric"
      selectTextOnFocus
      {...preventFocusSteal}
    />
  );
}

interface SliderTrackProps {
  nodeId: NodeId;
  trackWidth: number;
  thumbLeft: number;
  range: SliderRange;
  value: number;
  integerSnap: boolean;
  onLayoutWidth: (width: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onTapFraction: (fraction: number) => void;
  onDragFraction: (fraction: number) => void;
}

function SliderTrack({
  nodeId,
  trackWidth,
  thumbLeft,
  range,
  value,
  integerSnap,
  onLayoutWidth,
  onScrubStart,
  onScrubEnd,
  onTapFraction,
  onDragFraction,
}: SliderTrackProps) {
  const widthRef = useRef(trackWidth);
  widthRef.current = trackWidth;

  function fractionFromX(x: number): number {
    const w = widthRef.current;
    if (w <= 0) return 0;
    return Math.min(1, Math.max(0, x / w));
  }

  const pan = Gesture.Pan()
    .onBegin((e) => {
      runOnJS(onScrubStart)();
      runOnJS(onDragFraction)(fractionFromX(e.x));
    })
    .onUpdate((e) => {
      runOnJS(onDragFraction)(fractionFromX(e.x));
    })
    .onFinalize(() => {
      runOnJS(onScrubEnd)();
    });

  const tap = Gesture.Tap().onEnd((e) => {
    runOnJS(onTapFraction)(fractionFromX(e.x));
  });

  // Exclusive: a drag wins over tap once movement activates the pan.
  const composed = Gesture.Exclusive(pan, tap);

  function onLayout(e: LayoutChangeEvent): void {
    onLayoutWidth(e.nativeEvent.layout.width);
  }

  return (
    <GestureDetector gesture={composed}>
      <View
        testID={`value-slider-track-${nodeId}`}
        style={styles.track}
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityState={{ selected: integerSnap }}
        accessibilityValue={{
          min: range.min,
          max: range.max,
          now: value,
        }}
        {...preventFocusSteal}
      >
        <View style={styles.trackFill} />
        <View
          testID={`value-slider-thumb-${nodeId}`}
          style={[styles.thumb, { left: thumbLeft }]}
        />
      </View>
    </GestureDetector>
  );
}

interface DragHandleProps {
  nodeId: NodeId;
  /** The offset as of this render, captured on gesture start so drag deltas
   *  compose onto wherever the popover already was rather than resetting it. */
  offset: Vec2;
  pinned: boolean;
}

/** Grip strip at the top of the popover (§8.8): dragging it moves the whole
 *  window via `uiStore.setSliderOffset`, independent of the cell it's anchored to.
 *  Always mounted, at a fixed height, so pinning never resizes the popover - only
 *  the bar's own opacity toggles with `pinned`, and the gesture is disabled while
 *  unpinned (dragging only makes sense once the popover can outlive a tap
 *  elsewhere). */
function DragHandle({ nodeId, offset, pinned }: DragHandleProps) {
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  // Captured once per gesture on `onBegin` so `onUpdate`'s per-frame translation
  // composes onto the offset the drag actually started from, not the live one.
  const dragStartOffset = useRef(offset);

  function onDragBegin(): void {
    dragStartOffset.current = offsetRef.current;
  }

  function onDragMove(dx: number, dy: number): void {
    useUiStore.getState().setSliderOffset({
      x: dragStartOffset.current.x + dx,
      y: dragStartOffset.current.y + dy,
    });
  }

  const pan = Gesture.Pan()
    .enabled(pinned)
    .onBegin(() => {
      runOnJS(onDragBegin)();
    })
    .onUpdate((e) => {
      runOnJS(onDragMove)(e.translationX, e.translationY);
    });

  return (
    <GestureDetector gesture={pan}>
      <View testID={`value-slider-drag-handle-${nodeId}`} style={styles.dragHandle} {...preventFocusSteal}>
        <View
          testID={`value-slider-drag-handle-bar-${nodeId}`}
          style={[
            styles.dragHandleBar,
            pinned ? styles.dragHandleBarVisible : styles.dragHandleBarHidden,
          ]}
        />
      </View>
    </GestureDetector>
  );
}

/** Mounts the §8.8 popover for whichever node `uiStore.sliderState` names - opened
 *  explicitly via the cell menu's `Show slider` item, not on selection. */
export function ValueSliderOverlay() {
  const sliderState = useUiStore((s) => s.sliderState);
  const node = useDocumentStore((s) =>
    sliderState ? s.document.nodes[sliderState.nodeId] : undefined,
  );

  if (!sliderState || !node || node.kind !== 'number') {
    return null;
  }
  if (rawToSliderValue(node.raw) === null) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="value-slider-overlay">
      <ValueSlider nodeId={sliderState.nodeId} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
  popover: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: POPOVER_BORDER_COLOR,
    // Top is tighter than bottom on purpose: the drag handle's own bar (below)
    // already reads as the window's top affordance, so it shouldn't float in a
    // second layer of padding on top of its own.
    paddingTop: 4,
    paddingBottom: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  boundsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepGroup: {
    flex: 1,
    alignItems: 'center',
  },
  stepLabel: {
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 2,
  },
  boundInput: {
    width: 52,
    height: 28,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 6,
    fontSize: 13,
    color: '#1A1A2E',
    textAlign: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
  },
  trackFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: rolePalette.number.fill,
    borderWidth: 2,
    borderColor: rolePalette.number.border,
  },
  snapHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
  },
  connector: {
    position: 'absolute',
    // Below the popover / thumb chrome (zIndex 20 on the overlay), same layer as
    // ConnectorLayer's document curves - a screen-space line, not a document one.
    zIndex: 19,
  },
  dragHandle: {
    alignItems: 'center',
    paddingVertical: 3,
    marginBottom: 2,
  },
  dragHandleBar: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  dragHandleBarVisible: {
    opacity: 1,
  },
  dragHandleBarHidden: {
    opacity: 0,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  checkboxChecked: {
    backgroundColor: rolePalette.number.fill,
    borderColor: rolePalette.number.border,
  },
  pinLabel: {
    fontSize: 12,
    color: '#374151',
  },
});
