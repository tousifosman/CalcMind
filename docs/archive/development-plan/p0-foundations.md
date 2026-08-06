# CalcMind — Development plan archive: P0 · Foundations

**Archived.** This phase is done and its tasks are no longer active work — moved out of
`docs/DEVELOPMENT_PLAN.md` to keep that file focused on what's left. The `Status` table
and dependency diagram there still summarize this phase; this file is the historical detail
for it. `docs/ARCHITECTURE.md` remains the authority on design — nothing here overrides it.

---

## ~~P0 · Foundations~~ — done

> ~~Deps installed; `ui/tokens.ts` matches §1.2; empty store + commands compile; `tsc`, `eslint`,
> `jest` green; `npm run build:web` still produces `dist/`.~~

Delivered in `08620f9`. Dependencies from §4; design tokens transcribed from §1.2 rather than
re-derived; the §6 domain model with its zod mirror for the later persistence boundary; a Zustand
store with immer-patch undo/redo (§13) whose viewport writes deliberately bypass history (§7).
Session notes in `docs/journal/2026-08-03.md`.
