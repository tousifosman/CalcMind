# GitHub workflows

This repo shows 6 workflows in its GitHub Actions tab. Only 3 are files you can
edit, in `.github/workflows/`; the other 3 are GitHub-managed integrations
enabled via repo settings/features, not checked-in YAML.

## Repo-defined workflows (`.github/workflows/`)

### 1. `ci.yml` — CI

**Triggers:** every PR into `main`, and every push to `main`.

**Job:** single `verify` job that mirrors exactly what `AGENTS.md` asks a
human/agent to run before calling work done: `npm ci` → `tsc --noEmit` →
`npm run lint` → `npm test -- --ci` → `npm run build:web`. Concurrency is
grouped per-PR/ref so a new push cancels the stale run. This is the required
status check meant to gate merges to `main` (branch protection has to be
wired up separately in repo settings — the workflow itself can't do that).

### 2. `deploy-web.yml` — Deploy web build to GitHub Pages

**Triggers:** push to `main`, or manual `workflow_dispatch`.

**Job:** builds the web export (`npm run build:web`) and publishes `dist/`
to the root of the `gh-pages` branch via `peaceiris/actions-gh-pages`, with
`keep_files: true`. That flag is deliberate — it's what stops this job from
wiping out the `pr-preview/pr-<n>/` directories that workflow #3 maintains
on the same branch. Concurrency group `gh-pages-main` serializes pushes to
`main` (no cancel-in-progress, since you don't want a half-finished Pages
publish).

### 3. `deploy-pr-preview.yml` — Deploy PR preview

**Triggers:** manual `workflow_dispatch` (maintainer picks a PR number +
`deploy`/`remove`), and automatically on `pull_request: closed` (always
treated as `remove`).

**Jobs:**
- `determine` — normalizes the two trigger shapes (dispatch inputs vs. the
  PR-closed event payload) into one `pr_number`/`action` output pair.
- `deploy` — checks out `refs/pull/<n>/head` (works for fork PRs too),
  builds the web export, and publishes it to `gh-pages` under
  `pr-preview/pr-<n>/`, then comments the preview URL back on the PR.
- `remove` — checks whether `gh-pages` even exists yet (skips cleanly if
  not), deletes `pr-preview/pr-<n>/`, and commits/pushes if there was
  anything to remove.

This is intentionally manual for deploys (not run on every push) — only the
teardown on PR-close is automatic, so `gh-pages` doesn't accumulate
abandoned preview directories forever.

## GitHub-managed workflows (not files in the repo)

### 4. Copilot (`copilot-pull-request-reviewer`)

GitHub's built-in Copilot PR-review integration — runs automatically when
Copilot is requested/enabled as a reviewer on a PR. Configured via repo
settings, not a YAML file you can edit here.

### 5. Copilot cloud agent (`copilot-swe-agent`)

The GitHub Copilot coding-agent workflow, triggered when an issue/PR is
assigned to Copilot to autonomously make changes. Also a GitHub-hosted
dynamic workflow, not a checked-in file.

### 6. `pages-build-deployment`

GitHub's legacy/native Pages build pipeline, auto-created whenever GitHub
Pages is enabled on the repo. In this repo it's effectively vestigial for
the actual site content — Pages here is served from the `gh-pages` branch
populated by workflows #2/#3, not from this dynamic Jekyll-style builder —
but GitHub still runs it whenever Pages config triggers it.

---

**Net picture:** the real CI/CD logic maintained in this repo is just the 3
files — CI gating, main-branch deploy, and manual PR previews, all
coordinating through careful `keep_files`/concurrency-group choices on the
shared `gh-pages` branch. The other 3 are GitHub platform features (Copilot
review, Copilot agent, Pages' own build hook) that show up in the same
workflow list but aren't something you edit as YAML in this repo.
