# CalcMind

A mind map like calculator, built with the bare [React Native CLI](https://reactnative.dev), and also shipped as a web page (via `react-native-web` + Webpack) hosted on GitHub Pages.

This project intentionally avoids Expo/EAS — everything here is open source and runs on your own machine or CI, with no vendor build service required.

## Design

CalcMind is a free-form canvas calculator: numbers and operators are nodes placed anywhere on an
infinite canvas, snapping together into formulas that recompute as you edit them.

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the full design — the domain model, snapping
and evaluation engines, the on-disk document format, and the phased development plan. Read it
before starting feature work.

**[docs/journal/](docs/journal/README.md)** is the dated working record: what was decided, what
was discovered about the toolchain, and which earlier beliefs turned out to be wrong. The
architecture document is rewritten in place as the design changes, so the journal is the only
thing that remembers the version before. Worth skimming before trusting an assumption —
**[docs/journal/GUIDELINES.md](docs/journal/GUIDELINES.md)** explains how to read it when making a
decision, and how to add to it.

> Progress: P0 (foundations) and P1 (canvas pan/zoom) are done. `App.tsx` renders the canvas;
> nodes and the keypad start in P2.

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

This outputs a static site to `dist/` with relative asset paths (`publicPath: './'` in production), so it works correctly when served from a GitHub Pages project subpath (`https://<user>.github.io/<repo>/`). In development the config switches to an absolute `'/'`, which webpack-dev-server needs to route requests to its in-memory bundle.

## Deployment

`.github/workflows/deploy-web.yml` builds the web export and publishes it to GitHub Pages on every push to `main`.

**One-time setup:** in the repository's **Settings → Pages**, set "Build and deployment" → "Source" to **GitHub Actions**. After that, every push to `main` will automatically redeploy the site.
