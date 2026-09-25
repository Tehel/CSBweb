---
name: verification-tools
description: Write a tools/ verification script to prove a CSBWin port is faithful. Use when porting engine behaviour that cannot be seen on screen — data tables, AI, damage, timers, movement — or when asked to test/verify/check ported logic. This project has no test framework; these scripts are how correctness is demonstrated.
---

# Verification tools

This project has **no test framework** (PLAN.md Phase 15). Correctness is demonstrated
by scripts in `tools/` that stand up the real engine against the real game files, drive
it, and both **print what happened** and **assert invariants**.

That dual nature is the point. A pass/fail assertion tells you a number matched. A
printed table lets you look at the output and notice that Mummies are on level 1 and
Ant Men on level 2, which is how you find out the port is actually right rather than
consistently wrong.

## When to write one

Whenever you port something whose behaviour is invisible: extracted tables, AI
decisions, damage formulas, timer scheduling, object lifecycles. If the only evidence
a change works is `tsc` passing, there is no evidence.

`tools/check-frames.sh` covers the renderer. It does **not** cover anything else.

## The three gates

`npm test` runs them. Before any commit:

1. `tsc --noEmit` — the real gate. `vite build` proves nothing (esbuild strips types
   without checking them).
2. **Every `tools/*.ts` that has assertions**, re-run. They are the regression suite.
   Adding a table or changing a shared record breaks them silently otherwise.
3. `npm test -- --frames` adds `tools/check-frames.sh`: eight live screen states
   compared pixel by pixel. It starts its own dev server and headless Chrome (reusing yours if
   they are already up), so there is nothing to set up. Always run it for a renderer
   or UI change.

A tool is in the suite because it is listed in `tools/run-checks.mjs`. **Add yours to
that list**, with the arguments the assertions were written for — several tools take a
level, and the wrong level activates no monsters and quietly checks nothing.

## Assertions

Import the shared helper — do not hand-roll `check()`:

```ts
import { check, fail, finish } from './lib/check';

check(timer.uByte5 === 255 - desc.movementTicks06, 'Ant Man timer counts from 252');
finish();  // prints the verdict, owns process.exitCode
```

`finish()` **fails a run that made no checks**. Three tools had drifted into printing
`PROBLEMS: …` and exiting 0, so a runner would have called them green; one had a verdict
line that overwrote two earlier failures. A tool that cannot fail is not evidence.

## Shape

Two naming conventions, both run with `npx tsx tools/<name>.ts [args]`:

- `dump-*.ts` — inspect and assert on a specific mechanism.
- `watch-*.ts` — run the clock and report what emerged over time.

```ts
/**
 * One paragraph: what is invisible without this, and what the reader should look for.
 *
 * Run: `npx tsx tools/dump-thing.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// …engine imports…

import { check, finish } from './lib/check';

async function main(): Promise<void> {
  // 1. Load the real files. Never synthesise a dungeon.
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  // 2. Stand up the real objects, with a FIXED seed so the run repeats.
  const random = new CsbRandom(0x12345678);

  // 3. Drive it.

  // 4. Print a table a human can sanity-check.
  console.log(['thing', 'at', 'value'].join('\t'));

  // 5. Assert invariants.
  check(somethingTrue, 'what should have held');

  finish();
}

main();
```

**Top-level `await` breaks under `tsx`** — always wrap in `async function main()` and
call it.

## The canary technique

The strongest evidence that an extracted table is at the right offset is a value that
could only be right by luck. Look for one, print it, **and assert it** — a canary that
is only printed is a canary nobody checks on.

- Attack names read `BLOCK, CHOP, PUNCH, KICK…` in `ATTACKTYPE` order → graphic `0x230`
  offsets are right.
- A Screamer's remains come back as misc type 33, which is `misc_ScreamerSlice` → the
  whole `MonsterDroppings` range-split arithmetic is right.
- The clothing bit-7 flag is set on exactly the seven shields and nothing else.
- Monster AI timers get `uByte5 = 255 - movementTicks06` per type, matching the
  descriptor dump.

A table of plausible-looking numbers proves nothing. A table where one entry spells a
word proves the offsets.

## Suspect the test before the port

This happened **twice in one session**, and both times the port was right:

- Timer renumbering "didn't happen" — the test had built a state the game cannot
  reach (per-member timers outside fear state 6, which is the only state that creates
  them).
- Wounds "never occurred" at 4/200 — the test counted saturation, not frequency,
  because wounds accumulate into one mask. Resetting between hits gave 163/200.

When an assertion fails, re-read the C++ for a **gate you missed** before touching the
port. A failing check that turns out to be a wrong test is still valuable: pin the real
behaviour with an extra case explaining why it looks like an omission.

## Gotchas

**Tools build their own tables.** Each tool constructs its own `timerTables` /
`actuatorTables`. Adding a field in `main.ts` does **not** reach them — the armour test
silently measured nothing until the tool got the same tables. When you add a table,
grep `tools/` and update every constructor. A missing `byte586` does the same to `GetCharacterToDamage`:
`determineAttackOrder` falls back to `[0, 1, 2, 3]`, and a wall bump hurt the back row.
Copy the tables the code under test reads, not only the ones the tool's model needed.

**Seed fixed, always.** `new CsbRandom(0x12345678)`. An unseeded run is not a test.

**Never perturb `Math.random` at construction time.** `tools/probe-frames.mjs`
overrides `Math.random` to make the golden frames reproducible; anything that draws
from it during setup shifts every frame. `CsbRandom` seeds lazily for exactly this
reason — keep it that way.

**Trace buffers fill up.** Counting events by filtering a capped log undercounts. Use a
dedicated counter for totals and cap only the sample lines you print.

**Give the clock enough ticks.** Monster move intervals run to 185 ticks; a 60-tick
window legitimately observes nothing. Size the window from the slowest thing involved.

**A target that walks away.** `createMonster` arms the group's AI, so a few ticks of
`processTimers` can move it out of the cell before your missile arrives — the scenario
then silently tests nothing. Call `game.timerQueue.deleteMonsterMovementTimers(x, y, level)`
after placing it (`dump-missile-monster.ts`).

**Stepping frames.** `game.runFrame(t)` is one VBL at a time you choose: the mouse queue
(`HandleMouseEvents`), then a tick if `t - lastTickTime` reaches the tick interval. Queue
input with `enqueueMovement` (a key) or `onMouseClick(num, x, y)` / `onMouseUnClick()`,
catch the non-movement buttons with `setMouseEventHandlers`, empty the queue with
`discardAllInput()`, and reach `lastTickTime` / `lastInputTime` through a cast
(`dump-mouse-queue.ts`, `dump-party-collision.ts` case 6). `lastInputTime == 0` disables
the one-per-tick gate, as `lastTime == 0` does in CSBWin, so start the clock first. Every
tick runs the monsters too, so do anything that needs a monster where you found it
before the frames that tick, or set `lastTickTime = t` so none is due.

**Spy on the real call, don't re-derive it.** When a formula consumes random numbers,
wrap the instance method (`game.timerSystem.determineMagicDamage = …`) to record its
inputs and outputs, then check the arithmetic the engine did with them. Recomputing the
draws in the tool would need the RNG state and proves less.

**Find objects by name index, and canary the name.** To stand up "a Staff" or "an
Illumulet", search the `ObjDesc` rows of the right category for the `OBJNI_*` CSBWin
tests (`typeNamed` in `dump-item-bonuses.ts` / `dump-champion-death.ts`) — bound the
search to the category's own rows, or a weapon type runs into the clothing rows — and
check `objectTables.objectNames[objNI]` spells what you meant. The Atari DM names are not
always CSB's: Staff of Irra is STAFF OF MANAR, Cross of Neta SNAKE STAFF, Serpent Staff
THE CONDUIT, Side Splitter DELTA, Dragon Fang THE INQUISITOR.

**Make output diffable.** Tab-separated columns, stable ordering, no timestamps.

## Existing tools worth copying from

| Tool | Pattern it demonstrates |
| --- | --- |
| `dump-monster-tables.ts` | Extracted-table dump with a canary |
| `dump-monster-activation.ts` | Lifecycle + cross-checking two structures agree |
| `dump-monster-perception.ts` | Probing a predicate against map geometry |
| `dump-monster-damage.ts` | Multi-case with named sub-cases and a pinned counter-case |
| `dump-monster-move.ts` | Before/after state around one operation |
| `dump-monster-ai.ts` | Driving the real timer queue; gate coverage |
| `watch-monsters.ts` | Emergent behaviour over time, with a safety invariant |
| `watch-monster-attacks.ts` | Whole-system outcome plus isolated formula probes |
| `dump-monster-tables.ts` | Asserting the canary rather than only printing it |
| `dump-missile-monster.ts` | Firing real missiles at a placed group; spying on engine calls |
| `dump-party-collision.ts` | Stepping `Game.runFrame` at chosen times; queued input |
