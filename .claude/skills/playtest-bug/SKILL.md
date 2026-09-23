---
name: playtest-bug
description: Diagnose and fix a bug noticed while playing DMweb. Use when the author reports something wrong on screen or in play — a panel that prints nothing, an item that behaves wrong, a click that acts on the wrong champion, a timer that stalls, a thing that should resurrect and doesn't. Covers orienting cheaply, triangulating against CSBWin, and the five things every fix owes.
---

# Fixing a playtest bug

The project is feature-complete enough to play, so bugs now arrive as symptoms —
"the skeleton has no name", "the eye panel prints no mastery ranks" — rather than as
unported functions. The work is always the same shape: find which side of the port is
wrong, prove it, fix it, and leave evidence that it stays fixed.

One bug per session. `/clear` after the commit — see "Working economically" in `CLAUDE.md`.

## 1. Is it already known?

Before anything else, grep **`DEBT.md`** for the area. A good share of
what looks like a new bug is a deferral someone already wrote down, and the entry usually
names the CSBWin function that was skipped. `doc/PLAN_ARCHIVE.md` is worth a look too: if
the symptom matches a ✅ entry, you are looking at a regression, and that entry says what
the fix was the first time.

## 2. Orient cheaply, in this order

Each step is cheaper than the one below it. Stop as soon as you know where to look.

1. **Symptom on screen → module.** `doc/UI_MODULE_MAP.md` maps every part of the DM
   interface to its module in `src/renderer/ui/` *and* to the CSBWin file it is a
   translation of.
2. **A CSBWin name → `File.cpp:line`.** One grep of the symbol index:
   `grep -P '^DetermineMastery\t' doc/CSBWIN_SYMBOL_INDEX.tsv`. Definitions sort above
   prototypes, so the first hit is the real one. This replaces grepping 120k lines and
   the two peeks that usually follow.
3. **Topic → reference doc.** `doc/CSBWIN_REFERENCE_INDEX.md` lists the per-topic docs
   (attack, missiles, timers, champion lifecycle, …). `doc/PROVEN_FACTS.md` holds facts
   already verified against the C++, each with a citation.
4. **Only now** read source — ours or CSBWin's — and read it *wide*, once.

Do **not** open with `grep -rn <symptom word> src/ tools/ doc/ -i`. Sessions that did
spent six to fifteen round trips before forming a first hypothesis, because a symptom word
("skeleton", "bones") is rarely the identifier the code uses (`misc_BonesOfHero`).

## 3. Triangulate before you edit

Three things must agree, and the bug is wherever two of them disagree:

| | |
| --- | --- |
| `doc/CSBwin-src/` | The spec. Always wins. |
| `doc/CSBWIN_*_REFERENCE.md` | What we believed when we ported it. If it disagrees with the C++, the doc is wrong — fix it too. |
| `src/` | Ours. |

Read CSBWin's function **whole**, including the early returns, before comparing. Its
prerequisites frequently reorder the fix.

## 4. Suspect the gate, not the formula

Nearly every bug found in this phase has been a **missing guard, a missing mirror write,
or a wrong order of operations** — not a miscomputed number. Recent ones, all of this shape:

- *A thrown object stayed in the hand.* `setPossessionDirect` wrote `possessions[slot]`
  and returned, never clearing the `weaponHand` / `shieldHand` / `quiver` mirrors that
  every reader falls back to. The removal removed nothing.
- *The eye panel printed no mastery ranks.* The rank-name table was an empty placeholder,
  read through a `continue`-on-falsy guard — so it produced no warning and no marker.
- *Inventory clicks acted on the wrong champion.* `partyPosition` was being used where a
  champion index was meant.

So: when our code and CSBWin's compute the same thing but behave differently, look at what
CSBWin does *before* the computation, and at everywhere the value is stored twice.

## 5. Make it fail in a tool before you fix it

The bug is not understood until a `tools/` script reproduces it with an assertion that
**fails**. Then fix, and watch the same assertion pass. If you cannot make it fail, you
have not found it yet — you have found something else that is also true.

The `verification-tools` skill has how to write one: the real engine against the real game
files, printing a table *and* asserting. Extend an existing `dump-*.ts` when one already
covers the area (`dump-vi-altar.ts` grew from 342 to 518 lines for the bones fix) rather
than starting a new one.

## 6. What every fix owes

The last several bug-fix commits shipped exactly these five things. Treat it as a checklist:

1. **`src/`** — the fix.
2. **`tools/dump-*.ts`** — new or extended, asserting the thing that was broken.
3. **`tools/run-checks.mjs`** — one line, `{ tool: 'dump-<name>.ts' },`, if the tool is new.
   A tool nobody runs is not a regression test.
4. **`doc/PROVEN_FACTS.md`** — the CSBWin fact you had to establish, with its
   `doc/CSBwin-src/<File>.cpp:<line>` citation. Only what you are certain of.
5. **`PLAN.md`** — mark the debt item resolved, or **add one for anything you deferred**.
   A fix that quietly leaves half the CSBWin behaviour unported is how this list grew.

Facts go in `doc/`, and status goes in `PLAN.md`.

## 7. Gate and commit

`npm test` must pass — it runs `tsc --noEmit` first, which is the real gate. If you touched
anything the viewport or UI draws, `npm test -- --frames` as well.

Commit as a single short line describing the behaviour, not the mechanism: `Bones of a dead
champion`, `A thrown object leaves the hand`. No prefix, no trailers. Never `git push`.
