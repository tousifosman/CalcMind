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
import { Vec2, ZOOM_MIN, ZOOM_MAX } from '../model/types';
import { CanvasViewportContext } from './ViewportContext';

const WHEEL_COMMIT_DEBOUNCE_MS = 200;
/** Wheel deltaY-per-notch that reads as one "ctrl+wheel" zoom step. */
const WHEEL_ZOOM_SENSITIVITY = 0.0035;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

interface CanvasProps {
  children?: ReactNode;
  style?: ViewStyle;
  /** Fired on a tap that doesn't turn into a pan, with the tapped point in **world**
   *  coordinates (§7). Canvas only reports where the tap landed; deciding whether that point
   *  hit a node or empty space is the caller's job (§8.6, P2.6) - Canvas has no node data to
   *  hit-test against, and shouldn't need any to stay a plain transform container. */
  onTap?: (worldPoint: Vec2) => void;
  /** Fired on a long-press (≥500 ms) that doesn't turn into a pan, with both the
   *  long-pressed world point and the raw screen point (for menu positioning).
   *  Same caller-decides contract as `onTap`: Canvas reports geometry only. */
  onLongPress?: (worldPoint: Vec2, screenPoint: Vec2) => void;
}

export function Canvas({ children, style, onTap, onLongPress }: CanvasProps) {
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
    .onEnd((e, success) => {
      'worklet';
      if (success && onTap) {
        // Inlined rather than calling coords.ts's screenToWorld: e.x/e.y are read on the UI
        // thread inside this worklet, and a plain imported function isn't workletized just by
        // being called from one (same reason the pinch/wheel handlers above inline this math).
        runOnJS(onTap)({ x: e.x / zoom.value + panX.value, y: e.y / zoom.value + panY.value });
      }
    });

  // Long-press opens the context menu (§8.6, P2.9). 500 ms — long enough to be
  // deliberate, short enough not to feel sluggish. The menu takes precedence over P3.7's
  // long-press-to-move-chain; see the precedence note in NodeContextMenu.tsx.
  const longPress = Gesture.LongPress()
    .minDuration(500)
    .onEnd((e, success) => {
      'worklet';
      if (success && onLongPress) {
        const worldPoint = { x: e.x / zoom.value + panX.value, y: e.y / zoom.value + panY.value };
        const screenPoint = { x: e.absoluteX, y: e.absoluteY };
        runOnJS(onLongPress)(worldPoint, screenPoint);
      }
    });

  // Race, not Simultaneous: a drag activates pan before release and should win outright,
  // while a tap only resolves on release once pan/pinch have failed to activate.
  // Long-press competes in the same race — if pan activates first it cancels long-press.
  const composedGesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), tap, longPress);

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
    <CanvasViewportContext.Provider value={{ panX, panY, zoom }}>
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
    </CanvasViewportContext.Provider>
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
