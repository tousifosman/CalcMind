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

// No actual UI-thread animation runtime under Jest (see the header comment) - collapses
// straight to `toValue` and fires `callback(true)` synchronously, same as a real
// `withTiming` does once its animation finishes. Good enough for `Canvas.tsx`'s auto-pan
// (§7 P7 follow-up): tests only need the end state and the completion callback, not the
// in-between frames a real device actually animates.
function withTiming(toValue, _config, callback) {
  if (callback) callback(true);
  return toValue;
}

module.exports = {
  __esModule: true,
  default: { View },
  useSharedValue,
  makeMutable,
  useAnimatedStyle,
  runOnJS,
  withTiming,
};
