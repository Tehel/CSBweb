---
description: Resume paying off DEBT.md, one item (or one step) per session
argument-hint: "[notes: the author's answer to a pending decision, or an item to take instead]"
---

Resume paying off DMweb's technical debt.

## Notes for this session

$ARGUMENTS

These notes may be empty; DEBT.md is the status either way. When they hold the author's
answer to a decision an entry is waiting on, write it into that entry first. When they
name a different item, take that one instead of the first row.

## Orient (cheaply)

- CLAUDE.md is already loaded. Read DEBT.md in full: its "Priority" and "How to work this
  list" sections are this session's rules, and the first row of its index is the item to
  take.
- Read that item's entry, then the code and the CSBWin source it cites (use
  `doc/CSBWIN_SYMBOL_INDEX.tsv` before grepping `doc/CSBwin-src/`). Don't read
  `doc/PLAN_ARCHIVE.md` unless the entry points you there.

## Work

- Take the first row of the index. If it is size L, work one step of it. If its entry has
  no split yet, the first step is to write the split, and any decision the entry asks for,
  into the entry, and commit that before any code moves.
- Aim for one item or one step per session, or two or three if they are size S. Stop
  before a size-M item would overrun the session; the next session will pick it up
  (CLAUDE.md → "Working economically").
- If a decision really is the author's (DEBT.md, CSBWin and the file rule don't settle
  it), write the options into the entry and stop. Don't guess.
- Refactors (tiers D and E) change no behaviour. Prove it with the whole-output diff in
  `.claude/skills/verification-tools/` ("A refactor is proven by diffing every tool's whole
  output"), and run `npm test -- --frames` when anything under `src/renderer/` or `src/ui/`
  moves. If a refactor uncovers a divergence from CSBWin, record it in tier C with the
  next free ID. Don't fix it: tier C is frozen until tier E is empty.
- A fix owes the five things listed in `.claude/skills/playtest-bug/`.
- Run `npm test` before every commit. Commit messages are one line, `Debt <ID>: …` or
  `Docs: …`, with no trailers. Never push.
- Do the bookkeeping in the same commit as the work. For a paid item, delete its entry and
  its index row, and rewrite or remove every code comment that cites its ID (grep for it).
  Fix any line numbers you shifted in other entries. Where a split item stands is written
  in its entry, not only in the report. Write documentation as the present state, not the
  story of how it got there (CLAUDE.md → "Write down the present, not the past").

## Report

End the session with a short report:

1. What was paid or advanced, commit by commit, with its evidence.
2. What was recorded (new IDs), and any decision written into an entry.
3. Anything surprising, or anything the author needs to decide.
4. **Next command**: the exact line for the author to type in a fresh session. Normally
   that is `/pay-debt` alone, because everything the next session needs is in DEBT.md.
   When an entry is waiting on the author, suggest `/pay-debt <ID>: <decision>` with the
   options spelled out, so their answer travels in the notes.
