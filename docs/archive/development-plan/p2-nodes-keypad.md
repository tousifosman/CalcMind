# CalcMind — Development plan archive: P2 · Nodes + keypad

**Archived.** This phase is done and its tasks are no longer active work — moved out of
`docs/DEVELOPMENT_PLAN.md` to keep that file focused on what's left. The `Status` table
and dependency diagram there still summarize this phase; this file is the historical detail
for it. `docs/ARCHITECTURE.md` remains the authority on design — nothing here overrides it.

---

## P2 · Nodes + keypad

Nothing in this phase evaluates anything. A chain of nodes is inert until P4. Resist wiring
arithmetic in early: the validation and precedence rules in §9 and §10.2 are subtler than they
look, and a provisional version will have to be deleted rather than extended.

### P2.1 — Locale-aware number display and input parsing

**Objective.** The display/storage boundary from §10.3, as pure functions, before anything renders
a number. This goes first because it is the one thing in P2 that corrupts documents if retrofitted
— a stored locale-formatted string is ambiguous forever.
**Architecture.** §10.3 (numerics and locale), decision #11.
**Touches.** `src/engine/format.ts`, `src/engine/numeric.ts`.

- [x] `formatForDisplay(raw, locale)` renders through `Intl.NumberFormat`. This is the **only**
      place separators exist anywhere in the codebase.
- [x] `parseUserInput(text, locale)` accepts the locale separator and normalises to a canonical
      `.` immediately, at the input edge.
- [x] Stored `raw` keeps a canonical `.` and no grouping. Under `de-DE`, `13.5` displays as `13,5`;
      typing `13,5` stores `13.5`.
- [x] `decimalSeparatorFor(locale)` returns the glyph the keypad key will display (P2.7 consumes
      this).
- [x] Partial input survives verbatim: `"3."`, `"-0.5"`, `"-"`, `""` all round-trip unchanged.
      `"3."` must not normalise to `"3"` — §6 requires it to survive a save/load cycle intact.
- [x] Property test (`fast-check`): parse ∘ format is identity over generated decimals, and the
      formatter never emits a string it cannot re-parse (§14).
- Grouping for integers beyond `Number.MAX_SAFE_INTEGER` degrades to ungrouped digits rather than
  risk float64 altering what's on screen. See `docs/journal/2026-08-03.md` for why.

### P2.2 — Text measurement and node width

**Objective.** `widthOf(node)` per §8.1, memoised. Needed for node sizing now and reused verbatim
by P3's chain layout, which is why it is not folded into the view components.
**Architecture.** §8.1 (`widthOf` rules), §11.4 (memoise per `(raw, fontSize)`), §1.2 (tokens).
**Touches.** `src/chains/measure.ts`.
**Depends on.** P2.1.

- [x] Symbol nodes use `operatorWidth` / `equalsWidth`; numbers and results use measured text
      width + `2 × numberPaddingX`, **floored at `nodeHeight`** so single digits stay square-ish.
- [x] Measurement is cached per `(raw, fontSize)`; changing `raw` invalidates that entry only.
- [x] Works identically on web and native — no DOM-only measurement path.
- [x] Width is computed from the **displayed** string (P2.1), not the raw one, so `1.020` and
      `1020` are not silently the same width in a grouping locale.
- [x] Unit tests cover the `nodeHeight` floor and cache invalidation on `raw` change.
- No native or DOM text engine is asked for glyph widths — there is no synchronous,
  platform-identical API for it. `measure.ts` sums a fixed per-glyph advance-width table instead,
  a first guess like the identity palette (§11.1), not a measurement. See
  `docs/journal/2026-08-03.md` for why and what would replace it.

### P2.3 — Node CRUD commands

**Objective.** Create, edit and delete nodes through the command layer, so every mutation is
undoable and the P3/P4 commands have a pattern to follow.
**Architecture.** §6 (node kinds), §13 (undo; 500ms edit coalescing), §5.1 (layout).
**Touches.** `src/store/commands.ts`, `src/model/factories.ts`.
**Depends on.** P2.1.

- [x] Commands: `addNumberNode(position, raw)`, `addOperatorNode`, `addParenNode`, `addEqualsNode`,
      `setNodeRaw`, `deleteNode`.
- [x] Each produces exactly one undo entry. Successive `setNodeRaw` calls to the **same** node
      within 500ms coalesce into one, so undo does not walk back a keystroke at a time (§13).
- [x] A free node carries `chainId: null` and an **authoritative** `position` (§6).
- [x] `deleteNode` on a chain member never leaves a dangling id in `chain.members`. Re-layout is
      P3's job; consistency is this task's.
- [x] A no-op command records no history entry. See `2026-08-03` Findings for the unconditional-
      timestamp trap that made this test pass only by coincidence.
- [x] Undo/redo test per command.

### P2.4 — Node views, one per kind

**Objective.** Render each node kind to the visual reference.
**Architecture.** §6 (kinds), §11.3 (plain `View`s with `borderRadius` — no SVG in v1), §1.2
(tokens), §1.1 and `docs/assets/node-anatomy.svg` (what the cells look like).
**Touches.** `src/nodes/NumberNode.tsx`, `OperatorNode.tsx`, `ParenNode.tsx`, `EqualsNode.tsx`,
`ResultNode.tsx`.
**Depends on.** P2.1, P2.2.

- [x] One component per kind, styled entirely from `ui/tokens.ts` — no hard-coded colours or sizes.
- [x] Cells sit **flush** with the correct border band per §1.2's role table; numbers teal,
      operators amber, `=` purple, results salmon.
- [x] `ResultNode` renders solid `#FF7E79` with the `#FFA3A0` band and **no dot texture** — §11.3
      defers texture to v1.1 (P7.3), and hue plus border already carry read-only-ness.
- [x] `ResultNode` is read-only: edit attempts are rejected, not silently swallowed.
- [x] Paren nesting depth renders as a subtle tint step on the paren cells (§10.2).
- [x] `label` renders above the cell when present. Identity hue is P6.5, so a neutral colour is
      correct here — do not invent a provisional hue rule.
- [x] Each is `React.memo`'d and reads its own slice through a per-node selector, so one node
      changing does not re-render its siblings (§11.4).
- [x] A component test per kind, plus one asserting the result node rejects edits (§14).

### P2.5 — Node layer inside the canvas

**Objective.** Put nodes on the canvas at their world coordinates.
**Architecture.** §7 (the transform), §8.1 (`position` is the uniform field hit testing and
rendering read), §11.4 (re-render scope).
**Touches.** `src/canvas/NodeLayer.tsx`, `src/canvas/Canvas.tsx`.
**Depends on.** P2.4.

- [x] Nodes are positioned with plain `left`/`top` equal to their **world** coordinates, as
      children of `Canvas`. The existing translate-wrapping-scale nesting already maps them to
      `worldToScreen` with no per-node arithmetic — read the comment at the top of `Canvas.tsx`
      before touching this.
- [x] A node stays under the pointer that drags the canvas at every zoom level from 0.25 to 4.
- [x] The layer subscribes to node **ids**, not to the node map, so adding one node does not
      re-render the others (§11.4).
- [x] Verified in a browser at minimum, middle and maximum zoom — not type-checked only.

### P2.6 — Selection and in-place number editing

**Objective.** Tap empty canvas → a number node already in edit mode. Tap a node → select it.
**Architecture.** §8.6 (selection), §8.5 (keys act on the selected node), §13 (selection is not
undoable).
**Touches.** `src/store/uiStore.ts` (ephemeral slice — not `documentStore.ts`; see the P2.6
journal addendum for why), `src/store/commands.ts`, `src/nodes/NumberNode.tsx`,
`src/canvas/hitTest.ts`, `src/app/AppShell.tsx`.
**Depends on.** P2.3, P2.5.

- [x] `selectedNodeId` and `editingNodeId` live outside undo history (§13).
- [x] Tap empty canvas creates a number node at that **world** point, in edit mode, `raw: ""`.
- [x] Tap a node selects it. `Escape` deselects.
- [x] An editing number node shows a caret and takes digits, the decimal key and backspace.
- [x] Backspace on empty `raw` deletes the node; committing an empty `raw` removes it rather than
      leaving a blank cell on the canvas.
- [x] Tap is distinguished from pan: a press that travels beyond a small threshold pans the canvas
      and creates nothing. Verify by dragging the canvas from empty space and confirming no node
      appears.

### P2.7 — Keypad

**Objective.** The keypad from §8.5 — not full-screen, dismissible, operators visually separated
from digits.
**Architecture.** §8.5 (the regions table), §1.3 (what the reference keypad looks like), §1.2
(tokens), decision #15.
**Touches.** `src/keypad/Keypad.tsx`, `src/app/AppShell.tsx`.
**Depends on.** P2.1 (decimal glyph).

- [x] Regions exactly as tabulated in §8.5: digits `7 8 9 / 4 5 6 / 1 2 3 / 0`; number editing
      (locale decimal separator, `+/-`, backspace); grouping `(` `)`; operators `÷ × − + =` in a
      separated accent column; mode strip.
- [x] Not full-screen, and dismissible. Tapping empty canvas toggles it (§8.5).
- [x] The decimal key **shows the locale glyph** (P2.1) and inserts a canonical `.`.
- [x] `functions` and `graph` in the mode strip render visibly **disabled** — they are later work
      (§10.2 extension path, §17.2), so they must read as not-yet rather than silently missing.
- [x] Keypad visibility is ephemeral state, outside undo history.

### P2.8 — Input dispatch: keypad and hardware keyboard

**Objective.** Make keys do things, from the on-screen keypad and a real keyboard, through one
code path.
**Architecture.** §8.5 (targeting rules and the full key map).
**Touches.** `src/keypad/keymap.ts`, `src/keypad/Keypad.tsx`, `src/app/AppShell.tsx`,
`src/nodes/NumberNode.tsx`, `src/store/commands.ts`, `src/store/uiStore.ts`.
**Depends on.** P2.3, P2.6, P2.7.

- [x] A key acts on the **selected node** if there is one, otherwise creates a new node at the
      caret/last-tap point (§8.5).
- [x] Hardware and web keyboards map to the same commands: digits; `+ - * /` → `+ − × ÷`;
      `Enter` → `=`; `Backspace`; `Escape` deselects; arrows move selection along a chain.
- [x] On-screen and hardware input go through **one** dispatch function. Two parallel
      implementations will diverge.
- [x] Pressing an operator with a **result** selected is reserved for continuation (§8.7). Until
      P4.9 lands, make it an explicit no-op with a `TODO` citing §8.7 — do **not** ship a
      placeholder behaviour that users would have to unlearn.
- [x] Verified with a real keyboard in a browser, completing a full chain by typing.

### P2.9 — Long-press context menus

**Objective.** The §8.6 menus, which are how `Delete` and `Select group` are reached.
**Architecture.** §8.6 (both menus and their items), §1.3 (observed in the reference app).
**Touches.** `src/nodes/NodeContextMenu.tsx`, `src/canvas/Canvas.tsx`.
**Depends on.** P2.6.

- [x] Long-press a node → `Copy`, `Delete`, `Select group`. (`Unlink from parent` for
      references landed with P6.4.)
- [x] Long-press empty canvas → `Add number`, `Paste`, and `Add graph` rendered **disabled**
      (§17.2 defers graphing).
- [x] `Select group` selects the whole chain — this is how a chain is moved or deleted as a unit
      (§8.6), and P3.7 depends on it existing.
- [x] Long-press must not conflict with P3.7's long-press-to-move-chain. Decide the precedence now
      and record it, rather than discovering the clash in P3.
- [x] Delete removes the node in one undo entry.

### P2.10 — Swipe-to-clear, with confirmation

**Objective.** The reference app's swipe-across-backspace clear, gated behind a confirm.
**Architecture.** §8.5, decision #15 (a bare swipe wiping a document is too destructive for one
stray gesture, even with undo).
**Touches.** `src/keypad/Keypad.tsx`, `src/store/commands.ts`.
**Depends on.** P2.7.

- [x] Swiping across backspace raises a confirmation. **Only confirming clears.**
- [x] Clearing is a single undo entry (§13).
- [x] Dismissing the confirmation leaves the document byte-identical.

### Phase exit check — P2

> Tap empty canvas → number node in edit mode; keypad per §8.5 with digits, operators, parens,
> locale decimal key; hardware keyboard mapped; delete works; `raw` round-trips `"3."`; `13,5`
> displays per locale while storing `13.5`.

- [x] All of the above demonstrated by hand in a browser, in one sitting.

Demonstrated in a real Chromium session (not merely type-checked — see `docs/journal/2026-08-04.md`
revision 2, the recorded mistake this guards against). Found and fixed one real bug in the
process: hardware-typed `-` after a number leaked into the freshly-appended operand's `raw`
(`3 −` produced a new operand pre-loaded with `"-"` instead of `""`), silently negating the
second operand of every keyboard-typed subtraction. `+` masked the same underlying defect
because `+` isn't valid canonical raw, so the leaked character was silently rejected rather
than visible.
