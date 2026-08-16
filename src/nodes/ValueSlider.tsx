// Value slider popover (§8.8 / P6b.3–P6b.4).
//
// Selecting a number raises this sheet anchored beneath its cell. Dragging the
// thumb rewrites the number through `scrubNodeValue` (one undo entry for the
// whole gesture, autosave suppressed, dirty-subgraph recompute throttled to the
// frame budget). Tap toggles integer snap; drag returns to continuous values.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { worldToScreen } from '../canvas/coords';
import { widthOf } from '../chains/measure';
import { NodeId } from '../model/types';
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
import { rolePalette, tokens } from '../ui/tokens';
import {
  inferSliderRange,
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
  const locale = getDeviceLocale();

  const [range, setRange] = useState<SliderRange>({ min: 0, max: 10 });
  const [integerSnap, setIntegerSnap] = useState(false);
  const [minText, setMinText] = useState('0');
  const [maxText, setMaxText] = useState('10');
  const [trackWidth, setTrackWidth] = useState(POPOVER_WIDTH - 32);
  // Re-infer bounds when the selected node changes, not on every scrub frame.
  const rangedForNode = useRef<NodeId | null>(null);
  // Ref so gesture callbacks always read the latest range / snap without
  // rebuilding the gesture object every render.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const integerSnapRef = useRef(integerSnap);
  integerSnapRef.current = integerSnap;

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

  if (!node || node.kind !== 'number' || value === null) {
    return null;
  }

  const cellWidth = widthOf(node, locale, fontSize);
  const screenTopLeft = worldToScreen(node.position, viewport);
  const screenBottom = worldToScreen(
    { x: node.position.x, y: node.position.y + tokens.nodeHeight },
    viewport,
  );
  const screenCellWidth = cellWidth * viewport.zoom;
  const left = screenTopLeft.x + screenCellWidth / 2 - POPOVER_WIDTH / 2;
  const top = screenBottom.y + ANCHOR_GAP;

  function writeFraction(fraction: number, snap: boolean): void {
    const next = valueAtTrackFraction(fraction, rangeRef.current, snap);
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

  const span = range.max - range.min;
  const thumbFraction = span === 0 ? 0 : (value - range.min) / span;
  const thumbLeft =
    Math.min(Math.max(thumbFraction, 0), 1) * Math.max(0, trackWidth - THUMB_SIZE);

  return (
    <View
      testID={`value-slider-${nodeId}`}
      style={[styles.popover, { left, top, width: POPOVER_WIDTH }]}
      {...preventFocusSteal}
    >
      <View style={styles.boundsRow}>
        <BoundInput
          testID={`value-slider-min-${nodeId}`}
          value={minText}
          onChangeText={setMinText}
          onCommit={(text) => commitBound('min', text)}
        />
        <View style={styles.boundsSpacer} />
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
    </View>
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

/** Reads selection and mounts the slider when a scrubbable number is selected. */
export function ValueSliderOverlay() {
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const node = useDocumentStore((s) =>
    selectedNodeId ? s.document.nodes[selectedNodeId] : undefined,
  );

  if (!selectedNodeId || !node || node.kind !== 'number') {
    return null;
  }
  if (rawToSliderValue(node.raw) === null) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="value-slider-overlay">
      <ValueSlider nodeId={selectedNodeId} />
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
    paddingVertical: 10,
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
  boundsSpacer: {
    flex: 1,
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
});
