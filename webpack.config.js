const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: path.resolve(__dirname, 'web/index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    // Relative asset paths, so the build works from a GitHub Pages project
    // subpath (e.g. https://<user>.github.io/<repo>/) as well as the root.
    publicPath: './',
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
          path.resolve(__dirname, 'node_modules/react-native'),
          path.resolve(__dirname, 'node_modules/react-native-web'),
          path.resolve(__dirname, 'node_modules/@react-native'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['module:@react-native/babel-preset'],
            plugins: [['react-native-web', { commonjs: true }]],
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'web/index.html'),
    }),
  ],
  devServer: {
    port: 8081,
    open: false,
  },
};
