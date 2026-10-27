---
name: verification-tools
description: Write a tools/checks/ verification script to prove a CSBWin port is faithful. Use when porting engine behaviour that cannot be seen on screen — data tables, AI, damage, timers, movement — or when asked to test/verify/check ported logic. This project has no test framework; these scripts are how correctness is demonstrated.
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
2. **Every `tools/checks/*.ts` that has assertions**, re-run. They are the regression suite.
   Adding a table or changing a shared record breaks them silently otherwise.
3. `npm test -- --frames` adds `tools/check-frames.sh`: twenty live screen states
   compared pixel by pixel, as palette slots and the palettes they were shown through. It starts its own dev server and headless Chrome (reusing yours if
   they are already up), so there is nothing to set up. Always run it for a renderer
   or UI change.

A tool is in the suite because it is listed in `tools/run-checks.ts`. **Add yours to
that list**, with the arguments the assertions were written for — several tools take a
level, and the wrong level activates no monsters and quietly checks nothing.

The runner keeps a worker per core busy and prints in the list's order. While working,
`npm test -- --only=dsa,save` runs `tsc` and only the tools whose name holds any of the
words; the whole suite still runs before the commit. `--jobs=1` runs one tool at a time,
for a tool's own timing.

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

Every tool lives in `tools/checks/`, named for what it checks, and runs with
`npm test -- --only=<name>.ts [args]` once it is listed in `run-checks.ts`: the runner
checks the types first, prints the tool's whole output, and hands it the arguments. An
`--only` that is a tool's whole name picks that tool alone, so `room-text.ts` is not also
`open-room-text.ts`. `npx tsx tools/checks/<name>.ts` runs a tool with type errors in it,
or in what it imports, as if they were not there.

- `<mechanism>.ts` — inspect and assert on a specific mechanism.
- `watch-<scenario>.ts` — run the clock and report what emerged over time.

```ts
/**
 * One paragraph: what is invisible without this, and what the reader should look for.
 *
 * Run: `npm test -- --only=thing.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// …engine imports…

import { check, finish } from '../lib/check';

async function main(): Promise<void> {
  // 1. Load the real files. Never synthesise a dungeon.
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/dm-atari/dungeon.dat'))));
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

**Build a `UIState` through `tools/lib/ui.ts`.** `newUIState(graphics, ctx, hooks?)`
builds it as `GameScreen` does: the tables and font, a blank 320x200 screen, and a fresh
`ViewportRenderer`'s interpreter context, with every hook a no-op unless passed. Assign
`ui.ctx.party.state`, `screenIndexBuffer` or `context` afterwards to stage a party, a
buffer or a view: `ui.partyState` reads the game's party, and cannot be assigned. Read the tables off it (`ui.uiTables`, `ui.objectTables`) rather than extracting
them again.

**Build a `Game` through `tools/lib/game.ts`.** `newGame(data, graphics, options?)`
gives the game every table in `GameTables` — built as `main.ts` builds it, from the one
`extractGraphicsTables` of that `graphics.dat` — and `newContext(data, graphics, parts?)` gives a `GameContext` for a tool that
stands one subsystem up without a `Game` (pass your own `party`, `timers` or seeded
`random` in `parts`, and read the dungeon off `ctx.dungeon`, whose hooks are the
context's; set `ctx.state.tickCount` for the clock). Subsystems call each other through
`ctx.systems`, which such a context holds only as the tool fills it: pass the systems in
`newContext`'s last argument or assign them after, the real system or a stand-in
(`ctx.systems.missileEncounter = standInOf<MissileEncounter>({ createDeathCloud: () => { clouds++; } })`,
`checks/monster-damage.ts`). Asking for one the tool has not given throws, naming it.
A `DungeonState` built outside any context is `new DungeonState(data, NO_GAME)`.
Any partial value is `standInOf<T>({ … })`'s (`tools/lib/standIn.ts`): a record, a
drawing context, a dungeon with the three members a draw reaches. `tsc` checks each
member given against `T`'s; an `as unknown as` checks nothing, and a renamed member then
leaves the tool compiling and passing while it tests nothing. A tool makes no
`as unknown as` and no `as any`.
To intercept a call inside a whole `Game`, replace the method on the instance with
`standIn(target, 'member', replacement)`, or `wrapMember(target, 'member', (real) => …)`
for one that calls the real method (`tools/lib/standIn.ts`): every caller goes through
the instance at call time, `tsc` checks the stand-in against the member, and the
function either returns puts the member back. Before E1a each
tool hand-built the subset of tables it thought it needed, and two tests silently
measured nothing because of it (the armour test without the clothing tables;
`GetCharacterToDamage` without `byte586`, where a wall bump hurt the back row). A new
table goes into `GameTables` and `buildGameTables`, and every tool has it. A tool that
needs a *different* table builds its game over a copy:
`new Game(data, { ...gameTablesOf(graphics), doorCharacteristics: [...] })`
(`checks/missile-door.ts`). A tool that reads the screen's tables (`UITables`,
`ObjectTables`, `ViewportTables`) takes them off its `UIState` if it has one, and from
`graphicsTablesOf(graphics)` otherwise, the same extraction its `GameTables` came from,
rather than calling an extractor itself. A champion's carry tables are the game's
(`gameTablesOf(graphics)`). Never
mutate the shared set.

**A `Game` plays over the `DungeonData` it is built on, in place.** A champion recruited
empties their mirror in it, so a second game over the
same `DungeonData` starts where the first left off. Load the file again for each game
(`prisonGame`, `tools/checks/rise.ts`).

**Find a genuine save through `tools/lib/saves.ts`.** The CSBWin saves are in
`tools/fixtures/`, beside the golden frames: seven made to order for a check (a party
one step in, a door in motion, a sword in flight) and `csbgame7.dat`, the one save of
real play, for whatever needs live monsters on the party's level. `genuineSaves()` lists
them in file-name order, `genuineSaves(process.argv[2])` takes a tool's optional path
instead, and `savePath('csbgame7.dat')` finds one by name. Use `csbgame7.dat` when any
valid save will do, and put a new save made for a check in `tools/fixtures/`.

**Seed fixed, always.** `new CsbRandom(0x12345678)` (or `game.setRandomSeed(…)`). An
unseeded run is not a test, and it spoils the refactor check below (`DEBT.md` F4).

**A refactor is proven by diffing every tool's whole output, not only the verdicts.**
Before a behaviour-neutral change, capture `npx tsx tools/checks/<t>.ts` for every tool in
`run-checks.ts` into a scratch directory; after it, capture again and `cmp` file by file.
A passing check can hide a changed number the check does not look at. Run a differing
tool twice on the old tree (a `git worktree` of `HEAD` in the scratchpad, with
`node_modules` and `tools/fixtures/gamefiles` symlinked in) to tell a real change from a tool that
varies on its own.
The other half is the saves: for every file of `genuineSaves()`, a seeded
`newGame` with `applyCsbwinSave`, then `getRuntimeSaveState()` hashed as JSON after the load
and again after 600 VBLs of `runVbl(game, TICK_DUE)`, a tick each, on both trees. Zero `savedAt` in the hash
(a `JSON.stringify` replacer): it is wall-clock, and with it two runs of the same tree
never agree. A change that drops a field from the runtime save's shape drops it from the
old tree's hash too, with the same replacer, and the replacer sorts every object's keys:
a copy that rebuilds an object reorders them, and the plain JSON then differs.

**An RN means something only in its own world.** It is a slot of that world's
`RnMaps`, not a packed `[pos][db][idx]`. Make one with `game.ctx.dungeon.rnMaps.rn(db,
index)` of the game it goes into (`setPos` for a corner), never by shifting bits, and
read it through that same game's maps: a tool with two games that decodes one's RN
through the other's reads a different object, silently. Compare two RNs with `===`;
the slot is the object whatever its corner. A record freed and handed out again can
take the freed object's slot, so read an RN's index when it is handed out, not after.
When the RNs themselves move in a refactor, diff a dump that decodes every RN through
its world (each chain, record, possession and timer object) instead of the raw output.

**Never perturb `Math.random` at construction time.** `tools/probe-frames.ts`
overrides `Math.random` to make the golden frames reproducible; anything that draws
from it during setup shifts every frame. `CsbRandom` seeds lazily for exactly this
reason — keep it that way.

**Trace buffers fill up.** Counting events by filtering a capped log undercounts. Use a
dedicated counter for totals and cap only the sample lines you print.

**Give the clock enough ticks.** Monster move intervals run to 185 ticks; a 60-tick
window legitimately observes nothing. Size the window from the slowest thing involved.

**A target that walks away.** `createMonster` arms the group's AI, so a few ticks of
`processTimers` can move it out of the cell before your missile arrives — the scenario
then silently tests nothing. Call `game.ctx.timers.deleteMonsterMovementTimers(x, y, level)`
after placing it (`checks/missile-monster.ts`).

**A timer pass runs on the game's clock.** `processTimers()` takes no time: it is
`ProcessTimers(void)` and reads `d.Time`, `ctx.state.tickCount`, as does everything that
schedules from "now" (a cloud, poison, a door bash). A tool that steps the timers on its
own clock sets that clock first: `processTimersAt(game, t)` (`tools/lib/game.ts`), or
`tickCount++` after each `processTimers()`, as the tick does.

**Stepping VBLs.** `game.runFrame()` is one VBL: `vblInterrupt` (the strip's scroll, the
button flash, and `d.vblCount`, which raises `d.clockTick` once it reaches `d.Speed`),
then the mouse queue (`HandleMouseEvents`), then a tick if `d.clockTick` is set.
`runVbl(game, sinceTick)` (`tools/lib/game.ts`) sets the count first: `runVbl(game,
TICK_DUE)` makes a tick due in that VBL, `runVbl(game, 1)` makes none due by the count, and
`runVbl(game)` lets it run on, a tick every fifteenth VBL. Queue input with
`enqueueMovement` (a key) or `onMouseClick(x, y, buttons)` / `onMouseUnClick()`, and catch
the non-movement buttons with `setMouseEventHandlers`. A click is matched to its button
only when it is taken, by the handlers' `translate`: a tool with an interface passes
`searchMouseButtons`, and one without uses `ButtonsAt` (`tools/lib/clicks.ts`), which
says what button a point is and queues the click there. Empty the queue with
`discardAllInput()`, and set `game.lastInputTime`, public for the tools
(`checks/mouse-queue.ts`, `checks/party-collision.ts` case 6). `lastInputTime == 0` disables the one-per-tick gate, as
`lastTime == 0` does in CSBWin, so start the clock first. Every tick runs the monsters
too, so do anything that needs a monster where you found it before the VBLs that tick,
or step with `runVbl(game, 1)` so none is due.

**Spy on the real call, don't re-derive it.** When a formula consumes random numbers,
wrap the instance method (`game.systems.missileEncounter.determineMagicDamage = …`) to record its
inputs and outputs, then check the arithmetic the engine did with them. Recomputing the
draws in the tool would need the RNG state and proves less.

**Find objects by name index, and canary the name.** To stand up "a Staff" or "an
Illumulet", search the `ObjDesc` rows of the right category for the `OBJNI_*` CSBWin
tests (`typeNamed` in `checks/item-bonuses.ts` / `checks/champion-death.ts`) — bound the
search to the category's own rows, or a weapon type runs into the clothing rows — and
check `objectTables.objectNames[objNI]` spells what you meant. The Atari DM names are not
always CSB's: Staff of Irra is STAFF OF MANAR, Cross of Neta SNAKE STAFF, Serpent Staff
THE CONDUIT, Side Splitter DELTA, Dragon Fang THE INQUISITOR.

**Make output diffable.** Tab-separated columns, stable ordering, no timestamps.

## Existing tools worth copying from

| Tool | Pattern it demonstrates |
| --- | --- |
| `checks/monster-tables.ts` | Extracted-table dump with a canary |
| `checks/monster-activation.ts` | Lifecycle + cross-checking two structures agree |
| `checks/monster-perception.ts` | Probing a predicate against map geometry |
| `checks/monster-damage.ts` | Multi-case with named sub-cases and a pinned counter-case |
| `checks/monster-move.ts` | Before/after state around one operation |
| `checks/monster-ai.ts` | Driving the real timer queue; gate coverage |
| `checks/watch-monsters.ts` | Emergent behaviour over time, with a safety invariant |
| `checks/watch-monster-attacks.ts` | Whole-system outcome plus isolated formula probes |
| `checks/monster-tables.ts` | Asserting the canary rather than only printing it |
| `checks/missile-monster.ts` | Firing real missiles at a placed group; spying on engine calls |
| `checks/party-collision.ts` | Stepping `Game.runFrame` at chosen times; queued input |
