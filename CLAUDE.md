# CalcMind — working notes for AI sessions

A free-form canvas calculator: numbers and operators are nodes on an infinite canvas that
snap into formula chains and recompute as you edit them. React Native (bare CLI, no Expo),
also shipped as a static web build via `react-native-web` + Webpack.

## Read these before working

- **`docs/ARCHITECTURE.md`** — the design, and the authority on what it currently is.
  Section-numbered (`§7`, `§8.7`); cite sections rather than restating them. It contains the
  phased plan (P0–P7) with per-phase acceptance criteria, and a decisions log with revisit
  conditions.
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
  Both of those are recorded mistakes (`docs/journal/2026-08-03.md`, revisions 8 and 10).
- **Keep docs from going stale.** If a change contradicts `README.md` or
  `docs/ARCHITECTURE.md`, fix them in the same commit.
- **Dependency versions here are deliberate.** Check the journal's Findings before
  upgrading or adding anything — notably the reanimated / gesture-handler pairing.

## Verification

```bash
npx tsc --noEmit     # no typecheck script; run it directly
npm run lint
npm test
npm run build:web    # must still emit dist/
```

For anything user-visible, also run it: `npm run web` and open it. The web target once
built successfully and rendered a 0×0 page for several phases without anyone noticing.
