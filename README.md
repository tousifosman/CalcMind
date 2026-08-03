# CalcMind

A mind map like calculator, built with the bare [React Native CLI](https://reactnative.dev), and also shipped as a web page (via `react-native-web` + Webpack) hosted on GitHub Pages.

This project intentionally avoids Expo/EAS — everything here is open source and runs on your own machine or CI, with no vendor build service required.

## Design

CalcMind is a free-form canvas calculator: numbers and operators are nodes placed anywhere on an
infinite canvas, snapping together into formulas that recompute as you edit them.

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the full design — the domain model, snapping
and evaluation engines, the on-disk document format, and the phased development plan. Read it
before starting feature work.

> The current `App.tsx` is still a conventional keypad calculator; the canvas model described in
> that document has not been built yet.

## Development

```bash
npm install
npm start          # starts the Metro bundler
```

In another terminal:

```bash
npm run android     # requires Android Studio / an emulator or device
npm run ios         # requires Xcode (macOS only)
npm run web          # starts a Webpack dev server for the browser build
```

## Web build

The app is built for the web with `react-native-web` via a plain Webpack config (`webpack.config.js`):

```bash
npm run build:web
```

This outputs a static site to `dist/` with relative asset paths (`publicPath: './'`), so it works correctly when served from a GitHub Pages project subpath (`https://<user>.github.io/<repo>/`).

## Deployment

`.github/workflows/deploy-web.yml` builds the web export and publishes it to GitHub Pages on every push to `main`.

**One-time setup:** in the repository's **Settings → Pages**, set "Build and deployment" → "Source" to **GitHub Actions**. After that, every push to `main` will automatically redeploy the site.
