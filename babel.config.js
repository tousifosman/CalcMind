module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Must be listed last: rewrites worklets (gesture callbacks that run on the
  // UI thread) for react-native-reanimated / react-native-gesture-handler.
  plugins: ['react-native-reanimated/plugin'],
};
