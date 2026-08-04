// Manual Jest mock. The real package's GestureDetector wires into
// react-native-reanimated's createAnimatedComponent in a way that only works
// against a real native/UI-thread runtime, which plain jest + react-test-renderer
// don't provide. This stands in with just the bits CalcMind's canvas code uses,
// so component tests can render Canvas without a real gesture runtime.
const React = require('react');
const { View } = require('react-native');

function makeGestureBuilder() {
  const builder = {};
  const chainable = [
    'minPointers',
    'maxPointers',
    'onStart',
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
    builder[method] = () => builder;
  }
  return builder;
}

const Gesture = {
  Pan: makeGestureBuilder,
  Pinch: makeGestureBuilder,
  Tap: makeGestureBuilder,
  LongPress: makeGestureBuilder,
  Simultaneous: () => makeGestureBuilder(),
  Race: () => makeGestureBuilder(),
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
