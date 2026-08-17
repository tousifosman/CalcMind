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
| [2026-08-08](2026-08-08.md) | Soft-keyboard suppress; Clear-confirm hides keypad; `()` merge; Heroicons; keypad undo/redo row; focus chrome: stacking, group clear, `=`→result, no identity ring while selected; Select all (+ drag, clear, keypad lock); double-tap selects chain |
| [2026-08-09](2026-08-09.md) | Continuation stacking; group-mode keypad; operator replace / editing-key disable; main merge-conflict fix |
| [2026-08-11](2026-08-11.md) | `Create link` context-menu action; continuation fix for a selected chain-member operand; keypad `=` key 6px-narrower fix |
| [2026-08-12](2026-08-12.md) | `Create link` keypad button; decimal/`+/-` relocated into the digit grid's `0` row; `()` moved under `+` and recoloured to operator amber; decimal/`+/-` recoloured to number teal and now disable for a selected result/reference like the digits, with a placeholder grey-green disabled colour shared with the digits; `Add components`/`Notes` placeholders; `Keypad.test.tsx` `allSelected` reset bug fixed; `/prpreview` PR-comment trigger for `deploy-pr-preview.yml` |
| [2026-08-14](2026-08-14.md) | Keypad's two six-row columns now align row-for-row — unified every key to `digitKey`'s 48px height, a latent 44-vs-48 gap only exposed once `()`'s move made the row counts match; operator on a selected reference now extends its own chain in place instead of continuation-linking to a second reference; `Create link` keypad button widened to enable on a selected live reference too, plus new dispatch-level test coverage for it |
| [2026-08-15](2026-08-15.md) | Cell numeral font size reduced 30→22 and weight 800→400, a deliberate departure from the §1.2 reference-sampled values; follow-up found `numeralFontSize` alone doesn't reflow number-cell width (the glyph-width table is a hand-derived cache, not a live scale) and fixed it alongside `numberPaddingX` reduced 12→8→4 across two more follow-ups; short-number fixtures can hide a padding change entirely behind the `nodeHeight` floor; `nodeHeight` then reduced 64→48→40 (asked the user first once it doubled as the tap/drag hit box), surfacing a stale hardcoded `96` in a `keymap.test.ts` assertion and a `snapping.test.ts` fixture whose geometry only worked by an unnoticed, shrinking cancellation |
| [2026-08-16](2026-08-16.md) | Numeral size made a live, persisted Settings preference (`store/preferencesStore.ts`, new §12.5) — merged a same-week Settings-sheet PR from main instead of duplicating it; threaded `fontSize` through `chains/*` as defaulted parameters rather than reading the store directly, keeping every existing test passing unchanged; added `documentStore.mutateWithoutUndo` (§7 precedent: `setViewport`) so a font-size change re-flows chains without polluting undo history, catching a real no-op-detection bug in its first draft; caught live (not by any test) that two `idb-keyval` stores sharing one IndexedDB database name silently break the loser's object store forever; follow-up: cell *height* made to track the same live font size via a new `nodeHeightFor` derivation (`numberPaddingX`/`mathAxisOffset` still fixed), and the Settings row relabelled "Canvas Number Font Size" with a non-editable "pt" unit and a typable value alongside the +/− stepper |
| [2026-08-17](2026-08-17.md) | Value slider (§8.8) stops auto-opening on selection; a `Show slider` cell-menu item opens it explicitly, an unpinned popover closes on the next canvas tap/long-press elsewhere, and one `Keep open` checkbox (`uiStore.sliderState.pinned`) jointly gates surviving that dismissal, a connector line back to the cell, and a drag handle to reposition the popover — decision #21. Verified live with Playwright against the served web build (no `chromium-cli` in this environment; the global `playwright` package plus `NODE_PATH`/`PLAYWRIGHT_BROWSERS_PATH` worked instead), including a screenshot of the connector line spanning to a dragged-away popover |
