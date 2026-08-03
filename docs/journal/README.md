# Working journal

A dated record of what was decided, what was discovered, and — most importantly —
**what turned out to be wrong**. One file per working day, `YYYY-MM-DD.md`.

## Why this exists

`ARCHITECTURE.md` says what the design *is*. It is rewritten in place as the design
changes, so it carries no memory of the version that came before. That lost history is
the expensive part: several beliefs in this project have been confidently held, acted
on, and then contradicted by evidence. Without a record, the same wrong assumption gets
re-derived from the same plausible reasoning.

So the journal is append-only and never edited to look smarter in hindsight. A
superseded belief stays on the page with its correction next to it.

## What goes in an entry

Each entry has four parts, in this order:

1. **Session log** — what was worked on, in the order it happened. Discussion,
   direction given, decisions taken.
2. **Findings** — knowledge worth keeping: how a dependency actually behaves, what an
   environment constraint really is, why a workaround was needed. Facts, with the
   evidence that established them.
3. **Knowledge revisions** — beliefs held at the start of the day that no longer hold,
   in `Previously believed → Now known → What established it` form. This is the section
   that justifies the whole directory.
4. **Open threads** — what is unresolved, and what would settle it.

Reference `ARCHITECTURE.md` by section (`§7`) rather than quoting it, so entries do not
drift from the design as it evolves.

## Sourcing and honesty

Entries written the same day are first-hand. Entries back-filled later are reconstructed
from the commit record, the design document's own revision history, and files on disk —
which faithfully preserve *decisions and their rationale*, but not the texture of the
conversation that produced them. Back-filled entries say so at the top, and stick to
what the artefacts actually support rather than inventing plausible dialogue.

Where the record is genuinely silent, the entry says the record is silent.

## Index

| Date | Headline |
|---|---|
| [2026-08-02](2026-08-02.md) | Repo bootstrap; Expo dropped for bare RN CLI; design work begins |
| [2026-08-03](2026-08-03.md) | Design grounded in observed reference behaviour (three rounds); P0 foundations; P1 canvas pan/zoom |
