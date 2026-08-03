module.exports = {
  preset: '@react-native/jest-preset',
  // nanoid and fast-check ship ESM-only (no CJS build). immer has a real CJS
  // build, but RN's jest preset adds a "react-native" export condition (for
  // parity with Metro), which immer's package.json maps to its ESM bundle -
  // so it needs transforming here too even though it's not ESM-only upstream.
  // Everything else stays ignored so the preset keeps skipping transform of
  // ordinary CJS packages.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|nanoid|fast-check|immer)/)',
  ],
};
