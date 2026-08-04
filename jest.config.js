module.exports = {
  preset: '@react-native/jest-preset',
  // nanoid and fast-check ship ESM-only (no CJS build). immer has a real CJS
  // build, but RN's jest preset adds a "react-native" export condition (for
  // parity with Metro), which immer's package.json maps to its ESM bundle -
  // so it needs transforming here too even though it's not ESM-only upstream.
  // react-native-reanimated and react-native-svg are manually mocked (see
  // __mocks__/) rather than transformed - neither has a jest-environment
  // fallback for the native runtime they normally drive. Whitelisted here too
  // as a safety net in case a mock is ever removed. Everything else stays
  // ignored so the preset keeps skipping transform of ordinary CJS packages.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-gesture-handler|react-native-reanimated|react-native-svg|nanoid|fast-check|immer)/)',
  ],
  setupFiles: ['./node_modules/react-native-gesture-handler/jestSetup.js'],

  // Nested clones / worktrees under the repo root (local-only) collide with
  // haste and steal react-test-renderer from a different node_modules tree.
  modulePathIgnorePatterns: ['<rootDir>/CalcMind/', '<rootDir>/copilot-worktrees/'],
  testPathIgnorePatterns: ['<rootDir>/CalcMind/', '<rootDir>/copilot-worktrees/'],
};
