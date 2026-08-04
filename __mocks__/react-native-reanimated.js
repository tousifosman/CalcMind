// Manual Jest mock. react-native-reanimated (via react-native-worklets) loads
// a real native module at import time with no jest-environment fallback yet,
// which crashes under plain `jest`/react-test-renderer (no native bridge).
// This stands in with just the bits CalcMind's canvas code uses, so
// component tests can render Canvas without a real UI-thread runtime.
const { View } = require('react-native');

function useSharedValue(initial) {
  return { value: initial };
}

function makeMutable(initial) {
  return { value: initial };
}

function useAnimatedStyle(styleFactory) {
  return styleFactory();
}

function runOnJS(fn) {
  return (...args) => fn(...args);
}

module.exports = {
  __esModule: true,
  default: { View },
  useSharedValue,
  makeMutable,
  useAnimatedStyle,
  runOnJS,
};
