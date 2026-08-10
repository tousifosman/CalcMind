# CalcMind

A mind map like calculator, built with the bare [React Native CLI](https://reactnative.dev), and also shipped as a web page (via `react-native-web` + Webpack) hosted on GitHub Pages.

This project intentionally avoids Expo/EAS — everything here is open source and runs on your own machine or CI, with no vendor build service required.

## Design

CalcMind is a free-form canvas calculator: numbers and operators are nodes placed anywhere on an
infinite canvas, snapping together into formulas that recompute as you edit them.

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the full design — the domain model, snapping
and evaluation engines, and the on-disk document format. Read it before starting feature work.

**[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)** is the build order: what is already done,
and the remaining phases broken into tasks that each carry an objective, the architecture sections
they implement, and their own acceptance criteria.

**[docs/journal/](docs/journal/README.md)** is the dated working record: what was decided, what
was discovered about the toolchain, and which earlier beliefs turned out to be wrong. The
architecture document is rewritten in place as the design changes, so the journal is the only
thing that remembers the version before. Worth skimming before trusting an assumption —
**[docs/journal/GUIDELINES.md](docs/journal/GUIDELINES.md)** explains how to read it when making a
decision, and how to add to it.

> Progress: P0 (foundations) and P1 (canvas pan/zoom) are done. `App.tsx` renders the canvas;
> nodes and the keypad start in P2.

## Working with AI tools

**[AGENTS.md](AGENTS.md)** is the canonical instruction file, read by Cursor, Copilot, Codex and
most other agents. `CLAUDE.md` imports it (Claude Code doesn't read `AGENTS.md` itself) and
`.cursor/rules/calcmind.mdc` points at it. Edit `AGENTS.md`; the other two are pointers.

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

## Continuous integration

`.github/workflows/ci.yml` runs the same checks as the Verification section of `AGENTS.md`
(typecheck, lint, test, web build) on every push to `main` and every pull request targeting it.

**One-time setup:** in **Settings → Branches**, add a branch protection rule for `main` with
"Require status checks to pass before merging" enabled, and select the `verify` check. This can't
be configured from a workflow file — it's a per-repository setting an admin has to make once.
Without it the workflow still runs and reports red/green on PRs, but GitHub won't block merging a
red one.

## Deployment

`.github/workflows/deploy-web.yml` builds the web export and publishes it to the `gh-pages` branch on every push to `main`, at the site root.

**One-time setup:** in the repository's **Settings → Pages**, set "Build and deployment" → "Source" to **Deploy from a branch**, and pick branch `gh-pages`, folder `/ (root)`. (Deploying to a branch, rather than through `actions/deploy-pages`, is what lets PR previews below coexist with the `main` deploy — a Pages site backed by "GitHub Actions" as its source only ever has one live deployment, with no room for a second, PR-scoped one.)

### PR previews

`.github/workflows/deploy-pr-preview.yml` publishes a given PR's build to a temp path — `https://<user>.github.io/<repo>/pr-preview/pr-<n>/` — without merging it, so it can be reviewed live before landing. Run it manually from the Actions tab (`Deploy PR preview` → `Run workflow`), giving it the PR number; it comments the preview URL back on the PR. The preview is torn down automatically when the PR closes, or on demand by re-running the workflow with the `remove` action.
