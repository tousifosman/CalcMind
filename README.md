# CalcMind

A mind map like calculator, built with [Expo](https://expo.dev) / React Native, and also shipped as a web page hosted on GitHub Pages.

## Development

```bash
npm install
npm start          # opens the Expo dev tools (press "w" for web, or scan the QR code for a device)
```

Platform-specific shortcuts:

```bash
npm run android
npm run ios
npm run web
```

## Web build

The app is built for the web with `react-native-web` via Expo's static export:

```bash
npm run build:web
```

This exports a static site to `dist/` and rewrites asset URLs to relative paths (via `scripts/fix-web-base-path.js`) so it works correctly when served from a GitHub Pages project subpath (`https://<user>.github.io/<repo>/`).

## Deployment

`.github/workflows/deploy-web.yml` builds the web export and publishes it to GitHub Pages on every push to `main`.

**One-time setup:** in the repository's **Settings → Pages**, set "Build and deployment" → "Source" to **GitHub Actions**. After that, every push to `main` will automatically redeploy the site.
