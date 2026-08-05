const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_env, argv) => ({
  entry: path.resolve(__dirname, 'web/index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    // Relative asset paths in production, so the build works from a GitHub
    // Pages project subpath (e.g. https://<user>.github.io/<repo>/) as well
    // as the root. webpack-dev-server needs an absolute publicPath to route
    // requests to its in-memory bundle correctly.
    publicPath: argv.mode === 'production' ? './' : '/',
    clean: true,
  },
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
    alias: {
      'react-native$': 'react-native-web',
    },
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        include: [
          path.resolve(__dirname, 'App.tsx'),
          path.resolve(__dirname, 'web'),
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, 'node_modules/react-native'),
          path.resolve(__dirname, 'node_modules/react-native-web'),
          path.resolve(__dirname, 'node_modules/@react-native'),
          path.resolve(__dirname, 'node_modules/react-native-gesture-handler'),
          // Connector curves (§11.3 / P6.6) — ship ESM with `.web.js` entry points
          // that webpack resolves via `resolve.extensions`, but still need Babel
          // for the same RN JSX / runtime transforms as gesture-handler.
          path.resolve(__dirname, 'node_modules/react-native-svg'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['module:@react-native/babel-preset'],
            plugins: [
              ['react-native-web', { commonjs: true }],
              'react-native-reanimated/plugin',
            ],
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'web/index.html'),
    }),
    // Metro injects this global automatically; webpack doesn't, and
    // react-native/react-native-reanimated read it at import time.
    new webpack.DefinePlugin({
      __DEV__: JSON.stringify(argv.mode !== 'production'),
    }),
    // webpack 5 dropped its automatic Node polyfills. react-native-reanimated
    // reads the bare `process` global directly (e.g. PlatformChecker.js's
    // `process.env.JEST_WORKER_ID`, with no `typeof process` guard), which is
    // a ReferenceError in a real browser without this.
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],
  devServer: {
    port: 8081,
    open: false,
  },
});
