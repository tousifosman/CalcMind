# Working journal

A dated record of what was decided, what was discovered, and — most importantly —
**what turned out to be wrong**. One file per working day, `YYYY-MM-DD.md`, append-only.

## Why this exists

`ARCHITECTURE.md` says what the design *is*. It is rewritten in place as the design
changes, so it carries no memory of the version that came before. That lost history is the
expensive part: the recurring failure in this project is not ignorance but **confident
wrong belief arrived at by good reasoning** — the kind that gets re-derived from the same
plausible premises unless something interrupts it.

So a superseded belief stays on the page with its correction next to it, and entries are
never edited to look smarter in hindsight.

## Start here

**[GUIDELINES.md](GUIDELINES.md)** is the spec — how to *read* the journal before making a
decision, and how to *write* an entry. Read it before doing either.

The fastest useful thing in this directory, for anyone picking the project up cold:

```bash
grep -rn "Previously believed" docs/journal/
```

That lists every belief this project has held and overturned, with the evidence that
overturned it.

## Entries

| Date | Headline |
|---|---|
| [2026-08-02](2026-08-02.md) | Repo bootstrap; Expo dropped for bare RN CLI; design work begins |
| [2026-08-03](2026-08-03.md) | Design grounded in observed reference behaviour (three rounds); P0 foundations; P1 canvas pan/zoom |
| [2026-08-04](2026-08-04.md) | P2–P4 exit; P5.1–P5.8 persistence; P6.1–P6.3/P6.5/P6.7–P6.8 linking |
| [2026-08-05](2026-08-05.md) | P6.6–P6b exit; linking polish through labels + slider |
| [2026-08-06](2026-08-06.md) | P7.2 keyboard; P7.3 result texture; P7.6 spatial hash; P7.8 Clear all; manual PR preview deploys |
| [2026-08-08](2026-08-08.md) | PR preview float bug; Clear-confirm hides keypad; suppress OS soft keyboard on number edit; merge paren keys into `()` |
