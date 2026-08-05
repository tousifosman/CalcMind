// Manual Jest mock. The real package's GestureDetector wires into
// react-native-reanimated's createAnimatedComponent in a way that only works
// against a real native/UI-thread runtime, which plain jest + react-test-renderer
// don't provide. This stands in with just the bits CalcMind's canvas code uses,
// so component tests can render Canvas without a real gesture runtime.
//
// Handlers registered via `.onBegin` / `.onUpdate` / `.onEnd` / `.onFinalize` are
// retained on the builder so tests can drive gestures without a native runtime
// (P6b.3 ValueSlider review: tap-snap / drag-continuous must be CI-checkable).
const React = require('react');
const { View } = require('react-native');

/** Builders created since the last {@link Gesture.__resetBuilders} call. */
const recentBuilders = [];

const HANDLER_METHODS = new Set([
  'onStart',
  'onBegin',
  'onUpdate',
  'onEnd',
  'onChange',
  'onFinalize',
]);

function makeGestureBuilder(kind) {
  const handlers = {};
  const builder = {
    __kind: kind,
    __handlers: handlers,
  };
  const chainable = [
    'minPointers',
    'maxPointers',
    'onStart',
    'onBegin',
    'onUpdate',
    'onEnd',
    'onChange',
    'onFinalize',
    'maxDuration',
    'minDuration',
    'minDistance',
    'enabled',
  ];
  for (const method of chainable) {
    if (HANDLER_METHODS.has(method)) {
      builder[method] = (fn) => {
        handlers[method] = fn;
        return builder;
      };
    } else {
      builder[method] = () => builder;
    }
  }
  recentBuilders.push(builder);
  return builder;
}

const Gesture = {
  Pan: () => makeGestureBuilder('Pan'),
  Pinch: () => makeGestureBuilder('Pinch'),
  Tap: () => makeGestureBuilder('Tap'),
  LongPress: () => makeGestureBuilder('LongPress'),
  Simultaneous: () => makeGestureBuilder('Simultaneous'),
  Race: () => makeGestureBuilder('Race'),
  Exclusive: () => makeGestureBuilder('Exclusive'),
  /** Clear recorded builders between tests that drive gesture handlers. */
  __resetBuilders: () => {
    recentBuilders.length = 0;
  },
  /** Builders created since the last reset, oldest first. */
  __builders: () => recentBuilders.slice(),
};

function GestureDetector({ children }) {
  return children ?? null;
}

function GestureHandlerRootView(props) {
  return React.createElement(View, props);
}

module.exports = {
  __esModule: true,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
};
