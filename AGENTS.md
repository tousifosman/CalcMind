# CalcMind — working notes for AI coding agents

<!--
Canonical instructions for every AI tool used on this repo. Tool-specific files
(CLAUDE.md, .cursor/rules/) are thin pointers to this one - put substance here so there is
one source of truth to keep current.
-->

A free-form canvas calculator: numbers and operators are nodes on an infinite canvas that
snap into formula chains and recompute as you edit them. React Native (bare CLI, no Expo),
also shipped as a static web build via `react-native-web` + Webpack.

## Read these before working

- **`docs/DEVELOPMENT_PLAN.md`** — what is built and what to build next, as tasks carrying their
  own objective, architecture references and acceptance criteria. **Start here to pick up work**;
  each task tells you which architecture sections to read for it.
- **`docs/ARCHITECTURE.md`** — the design, and the authority on what it currently is.
  Section-numbered (`§7`, `§8.7`); cite sections rather than restating them. Contains a decisions
  log with revisit conditions.
- **`docs/journal/GUIDELINES.md`** — how to read the journal before deciding anything, and
  how to write an entry before you finish. Both halves are expected of you.

Cheapest high-value orientation, before you touch the design or a dependency:

```bash
grep -rn "Previously believed" docs/journal/
```

Every belief this project has held and overturned, with the evidence. A `Now known:` line
is binding — do not re-derive the superseded version of it.

## Standing expectations

- **Write a journal entry at the end of a session** in which a belief changed, a
  non-obvious fact was learned, a decision was taken, or a claim you made turned out wrong.
  `docs/journal/GUIDELINES.md` has the format and the closing checklist.
- **Verify before claiming.** Green `tsc` is not a working app; a branch is not `main`.
  Both are recorded mistakes (`docs/journal/2026-08-03.md`, revisions 8 and 10).
- **Keep docs from going stale.** If a change contradicts `README.md`, `AGENTS.md`,
  `docs/ARCHITECTURE.md` or `docs/DEVELOPMENT_PLAN.md`, fix them in the same commit. Tick a task's
  acceptance criteria in the same commit as the code that satisfies them.
- **Dependency versions here are deliberate.** Check the journal's Findings before
  upgrading or adding anything — notably the reanimated / gesture-handler pairing.
- **Match the surrounding code.** Comment density and naming in this repo are deliberate;
  existing files are the style guide.

## Verification

```bash
npx tsc --noEmit     # no typecheck script; run it directly
npm run lint
npm test
npm run build:web    # must still emit dist/
```

For anything user-visible, also run it: `npm run web` and open it. The web target once
built successfully and rendered a 0×0 page for several phases without anyone noticing.

## Git

Work on a feature branch; never commit straight to `main`. Commit messages explain *why*,
not just what — the existing log is the reference for the expected depth. Do not open a
pull request unless asked.

## Keeping the tool files in sync

| File | Read by | Contains |
|---|---|---|
| `AGENTS.md` | Cursor, Copilot, Codex, most others | **Everything. Edit this one.** |
| `CLAUDE.md` | Claude Code | One `@AGENTS.md` import line |
| `.cursor/rules/calcmind.mdc` | Cursor (always-applied) | A pointer, deliberately no rules |

Claude Code does **not** read `AGENTS.md` — a widely repeated claim that it falls back to it
is false, hence the explicit import. If you add tool-specific guidance, put it *below* the
import in that tool's file and leave everything shared here.
