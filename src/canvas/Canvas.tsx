// The infinite canvas: pan/zoom viewport. See docs/ARCHITECTURE.md §7.
//
// Rendering: an outer view carries the (screen-space) translate, an inner view
// nested inside it carries the scale, and children are positioned with plain
// `left`/`top` equal to their *world* coordinates. Because the translate wraps
// the scale, a world point (x, y) ends up at exactly worldToScreen(x, y) on
// screen - see coords.ts for the formula this mirrors.
//
// Interaction follows §11.4's "commit only on release" rule: pan/pinch drive
// Reanimated shared values on every frame for a smooth 60fps drag, and only
// write the result back into the Zustand store (via setViewport, which - per
// §7 - never touches undo history) when the gesture ends. Wheel input on web
// has no natural "end", so it debounces its store commit instead.
import { ReactNode, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { useDocumentStore } from '../store/documentStore';
import { ZOOM_MIN, ZOOM_MAX } from '../model/types';

const WHEEL_COMMIT_DEBOUNCE_MS = 200;
/** Wheel deltaY-per-notch that reads as one "ctrl+wheel" zoom step. */
const WHEEL_ZOOM_SENSITIVITY = 0.0035;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

interface CanvasProps {
  children?: ReactNode;
  style?: ViewStyle;
  /** Fired on a tap that doesn't turn into a pan (§8.5: tapping empty canvas toggles the
   *  keypad). Hit-testing against nodes to distinguish an empty-canvas tap from a tap on
   *  a node lands with P2.5/P2.6 - until then every tap is a canvas tap, since nothing is
   *  rendered on it yet. */
  onTap?: () => void;
}

export function Canvas({ children, style, onTap }: CanvasProps) {
  const setViewport = useDocumentStore((state) => state.setViewport);

  // Read once, non-reactively: Canvas drives the viewport, it doesn't need to
  // re-render when it changes its own value via commitViewport() below.
  const initialViewport = useDocumentStore.getState().document.viewport;
  const panX = useSharedValue(initialViewport.pan.x);
  const panY = useSharedValue(initialViewport.pan.y);
  const zoom = useSharedValue(initialViewport.zoom);

  // Gesture-start scratch values, kept on the UI thread.
  const gestureStartPanX = useSharedValue(0);
  const gestureStartPanY = useSharedValue(0);
  const gestureStartZoom = useSharedValue(1);
  const pinchFocalWorldX = useSharedValue(0);
  const pinchFocalWorldY = useSharedValue(0);

  function commitViewport() {
    setViewport({ pan: { x: panX.value, y: panY.value }, zoom: zoom.value });
  }

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      gestureStartPanX.value = panX.value;
      gestureStartPanY.value = panY.value;
    })
    .onUpdate((e) => {
      'worklet';
      panX.value = gestureStartPanX.value - e.translationX / zoom.value;
      panY.value = gestureStartPanY.value - e.translationY / zoom.value;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitViewport)();
    });

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      gestureStartZoom.value = zoom.value;
      pinchFocalWorldX.value = e.focalX / zoom.value + panX.value;
      pinchFocalWorldY.value = e.focalY / zoom.value + panY.value;
    })
    .onUpdate((e) => {
      'worklet';
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, gestureStartZoom.value * e.scale));
      zoom.value = nextZoom;
      panX.value = pinchFocalWorldX.value - e.focalX / nextZoom;
      panY.value = pinchFocalWorldY.value - e.focalY / nextZoom;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitViewport)();
    });

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      'worklet';
      if (success && onTap) {
        runOnJS(onTap)();
      }
    });

  // Race, not Simultaneous: a drag activates pan before release and should win outright,
  // while a tap only resolves on release once pan/pinch have failed to activate.
  const composedGesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -panX.value * zoom.value }, { translateY: -panY.value * zoom.value }],
  }));

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: zoom.value }],
  }));

  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleWheelCommit() {
    if (wheelCommitTimer.current !== null) clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = setTimeout(commitViewport, WHEEL_COMMIT_DEBOUNCE_MS);
  }

  // Web only: react-native-web forwards `onWheel` straight through to a DOM
  // wheel listener (untyped by RN's own ViewProps, hence the `any`). Plain
  // scroll pans, ctrl/cmd+wheel zooms about the cursor (§7).
  function onWheel(event: any) {
    event.preventDefault?.();
    const native = event.nativeEvent ?? event;
    const deltaX = native.deltaX ?? 0;
    const deltaY = native.deltaY ?? 0;
    if (native.ctrlKey || native.metaKey) {
      const offsetX = native.offsetX ?? 0;
      const offsetY = native.offsetY ?? 0;
      const nextZoom = clampZoom(zoom.value * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY));
      const focalWorldX = offsetX / zoom.value + panX.value;
      const focalWorldY = offsetY / zoom.value + panY.value;
      zoom.value = nextZoom;
      panX.value = focalWorldX - offsetX / nextZoom;
      panY.value = focalWorldY - offsetY / nextZoom;
    } else {
      panX.value += deltaX / zoom.value;
      panY.value += deltaY / zoom.value;
    }
    scheduleWheelCommit();
  }

  useEffect(() => {
    return () => {
      if (wheelCommitTimer.current !== null) clearTimeout(wheelCommitTimer.current);
    };
  }, []);

  const webWheelProps: Record<string, unknown> = Platform.OS === 'web' ? { onWheel } : {};

  return (
    <View style={[styles.fill, style]} {...webWheelProps}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.fill} testID="canvas-surface">
          <Animated.View style={[styles.fill, outerStyle]}>
            <Animated.View style={[styles.fill, styles.originTopLeft, innerStyle]}>
              {children}
            </Animated.View>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  originTopLeft: {
    transformOrigin: '0 0',
  },
});
