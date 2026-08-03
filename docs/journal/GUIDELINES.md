# How to use the working journal

This document is the spec for `docs/journal/`. It has two halves, and the first one is the
one people skip:

1. **[Reading it before you decide](#part-1--reading-before-you-decide)** — the journal is
   an input to work, not a report about work. A journal nobody reads is a diary.
2. **[Writing an entry](#part-2--writing-an-entry)** — what belongs in one, in what shape,
   at what quality bar.

If you are an AI session picking this project up cold: read Part 1 now, and read Part 2
before you finish your session.

---

## What the journal is for

`ARCHITECTURE.md` is rewritten in place as the design changes. It always describes the
*current* design and therefore remembers nothing about the design it replaced. The journal
is the memory: it records what was believed, what evidence overturned it, and what that
cost.

This matters because the recurring failure in this project is not ignorance, it is
**confident wrong belief arrived at by good reasoning.** Examples that actually happened:

- "A label is a property of a number" — reasonable, and wrong; it belongs to the identity.
- "`tsc` passes and the build succeeds, so the web target is healthy" — it rendered 0×0.
- "PR #4 is on the shared branch, so it includes the later work" — it didn't, and `main`
  sat stale.

Each of those is *re-derivable* from the same plausible reasoning that produced it the
first time. The journal exists so the second derivation gets interrupted.

### Division of labour between documents

| Document | Answers | Tense |
|---|---|---|
| `ARCHITECTURE.md` | What is the design? | Present — always current |
| `docs/journal/` | Why is it that? What did we try? What was wrong? | Past — append-only |
| Commit messages | What changed in this diff, and why now? | Past — per change |

A commit body and a journal entry are not redundant. The commit explains one diff to a
reviewer. The entry explains a *day* to someone with no context, and is the only one of
the two that records beliefs that changed without producing a diff.

---

## Part 1 — Reading before you decide

### Read the journal when

- **About to make or revisit a design decision.** Someone may have already settled it
  against evidence you don't have. Check before re-opening it.
- **About to add, upgrade, or pin a dependency.** Version pairings here are deliberate.
- **Debugging something that "should work."** Toolchain traps are recorded in Findings,
  usually with the misleading symptom that hid the cause.
- **About to claim work is done, landed, or deployed.** Revision 10 of `2026-08-03` exists
  because that claim was made wrongly.
- **About to try an external network fetch.** Some hosts are recorded as unreachable *by
  any client*, with the reason. Don't spend the attempts again.
- **Told a fact about this project that sounds obvious.** Obvious is where the wrong
  beliefs live.

### How to read it efficiently

Do not read it front to back. It grows monotonically and the recent end is the load-bearing
one.

1. **Grep the revisions first.** `grep -rn "Previously believed" docs/journal/` gives you
   every overturned belief in the project in one screen. This is the highest-value 30
   seconds available to a new session.
2. **Then grep Findings for your topic** — dependency name, tool, error string.
3. **Then read the newest entry in full**, for current state and open threads.
4. Read older entries only when tracing why something is the way it is.

### How to weigh what you find

- **A `Now known:` line is binding.** It is a belief that was already tested against
  evidence. Do not re-derive the superseded version and do not act on it. If you think it
  is wrong, you need *new evidence*, and overturning it is itself a journal entry.
- **`ARCHITECTURE.md` wins on what the design currently is.** The journal wins on why, and
  on what was tried. They should not conflict.
- **If they do conflict, that is a finding.** One of them is stale. Say so explicitly to
  the user rather than silently picking the one you prefer, then fix the stale one.
- **Open threads are open.** An entry listing a question as unresolved is not permission to
  resolve it by assumption. Several are marked "decide with a real device in hand"; that
  means paper reasoning has already been tried and rejected as insufficient.
- **Check the sourcing banner.** Entries marked back-filled were reconstructed from
  artefacts. Their decisions and rationale are reliable; their narrative detail is thinner
  than a same-day entry, and absence of a detail there is not evidence it didn't happen.

---

## Part 2 — Writing an entry

### When to write

Write at the end of any working session where something durable happened. One file per
calendar day, `YYYY-MM-DD.md`; append to the day's entry if it already exists.

**Write because of these triggers:**

- A belief changed — *always* worth an entry, even with no code to show for it.
- A non-obvious fact was learned about a dependency, tool, or the environment.
- A decision was made, or an earlier one revisited.
- Something took far longer than it should have. Record what hid the cause.
- A claim made to the user turned out to be wrong.
- A phase landed, or its acceptance criteria were checked.

**Do not write:**

- A changelog. `git log` already exists and is better at it.
- Routine mechanics — files touched, tests run, commands issued — unless one of them
  taught you something.
- A day with nothing durable in it. Silence is a valid entry; an empty ritual entry
  dilutes the grep results that make Part 1 work.

### The four sections

Every entry has these, in this order. Omit a section only if it is genuinely empty.

#### 1. Session log

What was worked on, in the order it happened. Number the items. Reference commits by short
hash and PRs by number, so an entry can be tied back to the diff.

Include the direction you were given and the decisions taken, not a transcript. If a
session changed course because of user pushback, say so — that is exactly the kind of thing
the commit record loses.

#### 2. Findings

Durable knowledge, with the evidence that established it. Write each one for a stranger who
will hit the same wall in six months and grep for it.

A good finding has three parts: **the fact**, **why it bites** (the mechanism), and **the
misleading symptom** if there was one. That third part is what makes it findable, because
the symptom is what the next person will search for.

Group under subheadings once there are more than a handful (`### Environment`,
`### Toolchain`, `### Correctness` is the current split).

#### 3. Knowledge revisions

The section that justifies the whole directory. Use this exact three-line form, and number
the revisions so they can be cited (`2026-08-03` revision 4):

```markdown
**4. Implicit multiplication is real, but narrower than assumed.**
*Previously believed:* a factor next to anything multiplies.
*Now known:* a factor followed by an open paren multiplies; two adjacent numbers stay
invalid — `12 34` is far more likely a mis-snap than a product.
*What established it:* observed reference behaviour; recorded as decision #4.
```

Rules:

- **`What established it` is mandatory.** A revision without evidence is just a change of
  mind, and the next session has no way to weigh it.
- **State the old belief plainly**, in the form it was actually held. Do not soften it into
  something more defensible than what you believed.
- **Add a `Standing lesson:` line** when the correction generalises beyond its instance.
- **Include revisions with no diff.** "We thought X, it's actually Y, nothing needed
  changing" is still worth recording — it stops X being acted on later.

#### 4. Open threads

What is unresolved, and **what would settle it**. The second half is the point: "still
deciding the drag gesture" is nearly useless; "one line in `useNodeDrag`, decide it on a
real device" tells the next session both the cost and the blocker.

Carry forward threads that are still open. Do not silently drop one — if it closed, it
closed via a revision or a decision, and that belongs in the entry.

---

## House style

- **Cause before consequence.** "webpack 5 dropped Node polyfills, so reanimated's
  unguarded `process` read is a ReferenceError" — not "added a polyfill."
- **Name the failure mode, not just the fix.** The fix ages out with the next version. The
  failure mode is what makes the next weird symptom recognisable.
- **Keep the misleading symptom.** "`useSharedValue` reads as `undefined` with no error
  pointing at the cause" is the searchable part.
- **Generalise once, at the end**, marked: `Generalisable: any unconditional timestamp
  write defeats patch-based change detection.`
- **Own mistakes in plain first-person past tense.** No hedging, no passive voice hiding
  who believed it. The corrected-belief entries are the most useful ones in the file and
  they only work if they are honest.
- **Never rewrite a past entry to look smarter.** Append-only. If an entry was wrong, the
  correction is a new revision in a new entry that cites the old one. The one permitted
  edit to a past entry is a factual typo.
- **Reference `ARCHITECTURE.md` by section** (`§8.7`), never by quoting it, so entries
  don't drift as the design changes.
- **No session-specific noise** — no model identifiers, tool names, token counts, or
  scratchpad paths. Write for a reader who doesn't know or care how the entry was produced.
- **Prose over bullet soup** for reasoning; bullets for enumerable facts.

### Back-filling

Allowed, and sometimes necessary. Two obligations:

1. **Banner it at the top** — state that it is reconstructed and from what (commits, the
   design doc's history, files on disk).
2. **Do not invent the conversation.** Artefacts preserve decisions and rationale, not
   dialogue. Where the record is silent, say the record is silent rather than writing
   plausible-sounding narrative. A fabricated detail in a document whose only value is
   trustworthiness destroys the document.

---

## Anti-patterns

Real rewrites, from this project's own material.

| Don't | Do |
|---|---|
| "Fixed a webpack issue with reanimated." | "reanimated v4 + RNGH v3 breaks under webpack: the pairing pulls in `react-native-worklets`, reanimated's hook *barrel* throws, and because it's a barrel every export after the throw is silently `undefined` — including `useSharedValue`. Pinned to the 3.19.5 / 2.32.0 pairing reanimated's own devDependencies test against." |
| "Learned that labels work differently." | Full three-line revision: previously a property of `NumberNode` → now known to belong to the identity, because the compound-interest screenshot renders one label above the declaration *and* both references → so editing it must update every cell sharing that identity. |
| "Discussed the design with the user and made improvements." | Which belief changed, what evidence changed it, what in the model moved as a result. |
| Editing yesterday's entry to remove a belief that turned out wrong. | Leave it. Add today's revision citing it. The wrongness *is* the content. |
| "TODO: check colour accessibility." | "The §11.1 hue set is unchecked for deuteranopia/protanopia. Must be validated **before P6 ships**, since colour carries link identity." — thread plus the deadline plus why it's load-bearing. |
| "Everything works, all tests green." | Say what was verified and how. If it was only type-checked, say only type-checked — that exact overclaim is `2026-08-03` revision 8. |

---

## Checklist before you close a session

- [ ] Did any belief of mine change today? → a numbered revision, with evidence.
- [ ] Did I learn something non-obvious about a dependency, tool, or this environment? → a
      finding, with the misleading symptom.
- [ ] Did I tell the user something that turned out to be wrong? → a revision. Not optional.
- [ ] Does an open thread from a previous entry need carrying forward, or did it close?
- [ ] Did anything I did make `ARCHITECTURE.md` or `README.md` stale? Fix them in the same
      commit.
- [ ] Is the index in `README.md` updated with today's entry?
- [ ] Would a session that read only today's entry know what to do next?
