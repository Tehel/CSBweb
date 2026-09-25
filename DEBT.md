# dmweb – Technical debt

This file is the **authority on technical debt**: everything known to be wrong, divergent
from CSBWin, duplicated, or left unfinished in code that is otherwise considered done.
`PLAN.md` carries the live phases and points here. **Paying this list off is the current
project priority** (`PLAN.md` → "Current priority").

It was created on 2026-09-23 from two sources:

- a whole-codebase structural review (duplication, god objects, naming, typing), and
- `PLAN.md`'s former "Carried-over debt" list. Every open entry moved here. The resolved
  ones went to `doc/PLAN_ARCHIVE.md` → "Resolved debt (moved out of `PLAN.md`)", together
  with two entries found already fixed during the move (the `MagicPanel` caster index and
  the Phase 8 missile/monster/wiggle hooks).

Markers are `PLAN.md`'s: ✅ done · ⚠️ knowingly divergent or incomplete · ⏳ not started ·
🚫 deliberately not done.

## How to work this list

1. **One item per commit, a few per session**, in index order, then `/clear` (`CLAUDE.md`
   → "Working economically"). Stop before a size-M item would overrun the session. An item
   marked *bundle* goes with its partner.
2. **Re-verify first.** Pointers were checked on 2026-09-23 unless the item says
   *(re-audit)*, and line numbers drift. If an item turns out to be already paid, mark it ✅
   and say how you know.
3. **Refactors change no behaviour.** Tiers B, D and E are refactors: `npm test` before and
   after, and `npm test -- --frames` whenever anything under `src/renderer/` or `src/ui/`
   moves. A refactor that uncovers a divergence from CSBWin fixes it in a **separate**
   commit, so every commit is either behaviour-neutral or a fix, never both.
4. **A fix owes the usual five things** (`.claude/skills/playtest-bug/`): the CSBWin
   citation, the fix, a `tools/` check that fails before it, a `doc/PROVEN_FACTS.md` entry
   if a new fact was verified, and the marker here.
5. **Mark as you go.** Set the item's marker and add a one-line outcome under it. When a
   whole tier is ✅, move it to `doc/PLAN_ARCHIVE.md` → "Resolved debt".
6. **New debt goes here**, in the tier it belongs to — not only in a code comment, and not
   in `PLAN.md` once its phase is closed.
7. **Since 2026-09-25, tiers D and E go before the rest of tier C** (see "Why this order").
   Tier C is **frozen**: a divergence found along the way is recorded here, in tier C, and
   not fixed — unless it blocks the D/E item at hand or corrupts saves. C33 and C34 wait;
   C34 lands after E1/E2, once the possession code has one `Character` home and the engine
   can reach the UI without new setters. C25 (re-sized to M after D4) and C35 wait in the
   frozen queue with the rest of tier C. D6 and F4 were paid before E1c (2026-09-25), so
   tier D is closed and every suite tool is seeded. E1 was paid on 2026-09-25 (E1d:
   `GameHost`). E2 is under way — `GameMethods` is gone (2026-09-25); what is left is the
   code in `Game` that is not the loop (see E2, "What is left") — then E3, E4. C36 (found
   paying E2) waits with the rest of tier C.

## Why this order

- **A — Housekeeping.** Minutes of work, and it stops stale comments misleading every later
  session.
- **B — Duplicate implementations.** The cheapest real risk: each copy is a place where a
  fix lands once and misses the others, and one of them (`DescIndex`) has already drifted.
  Tier C also needs the single copies (`OrdinalOfMonsterAtPosition`, `NameIndex`).
- **C — Known divergences from CSBWin.** The project's first rule is faithfulness, so known
  wrong behaviour outranks tidiness. Each item is local and small. C1–C32 were paid in
  this order; **the rest of tier C now comes after D and E** (from 2026-09-25). Every C
  fix had begun to cost a new hook in `Game`'s constructor and a fresh round of `?? 0`
  guesses, which is exactly the debt D and E remove, so paying them first makes each
  remaining C item cheaper. New C items are still recorded as they are found.
- **D — State representation.** The most pervasive debt: four spellings of "no object" and
  mostly-optional state types. It comes before the splits in E because it *deletes* code —
  moving code that is about to be rewritten would double the diff to review.
- **E — Architecture.** The shared context first: it turns the `Game` / `TimerSystem`
  splits into mechanical moves instead of re-plumbing fifteen hooks each.
- **F — Verification debt.** Independent of the rest; interleave it anywhere.
- **G — Unported CSBWin features.** Things CSBWin does that the port has not built. Not
  defects in existing code; listed so nothing is lost. Pick one up when a dungeon, a save
  file or a playtest needs it.
- **H — Deliberate divergences.** Recorded so nobody "fixes" them.

## Index

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| A1 | Documentation pointers to things that no longer exist | S | ✅ archived |
| A2 | Stale comments, a dead parameter, console noise | S | ✅ archived |
| B1 | One `DescIndex`, one `GetBasicObjectType`, one `NameIndex` | M | ✅ archived |
| B2 | Small helpers defined in several files | M | ✅ archived |
| B3 | `LOCATIONREL` has three shapes | S | ✅ archived |
| C1 | The melee door bash ignores `HitDoor`'s delay | S | ✅ |
| C2 | Missile→monster damage skips the magic and poison formulas | M | ✅ |
| C3 | `NinetySecondUpdate` cadence, and its body unaudited | S | ✅ |
| C4 | `DamageCharacter` is missing two early guards | S | ✅ |
| C5 | Three movement deferrals | M | ✅ |
| C6 | Which generator cloud and missile sprites flip with | S | ✅ |
| C7 | `CreateMovementTimer`'s overflow guard | S | ✅ |
| C8 | Phase 8 DSA leftovers | M | ✅ |
| C9 | Door pass-through rules and magic formulas | M | ✅ |
| C10 | Phase 9.5 refinements | S | ✅ |
| C11 | `DoesPartyHave` does not look inside chests | S | ✅ |
| C12 | `SetTimer`'s duplicate-timer rules keep the wrong timer | S | ✅ |
| C13 | The rest of `MoveParty`: stamina, move delay, queue depth | M | ✅ |
| C14 | `DrawClouds`: size, colour map, lightning position, the cell under the party | S | ✅ |
| C15 | A DSA cell move does not go through `MoveObject` | M | ✅ |
| C16 | Freed database slots are never reused | M | ✅ |
| C17 | `WiggleEverything` leaves a moved cloud's timer behind | S | ✅ |
| C18 | A Fluxcage never expires, and frees door record 0 | S | ✅ |
| C19 | `CastSpell` under a spell filter's overrides | S | ✅ |
| C20 | A level change inside `ProcessTimers` waits for the next tick | S | ✅ |
| C21 | Clicks do not go through the input queue | M | ✅ |
| C22 | A monster's own move presses no pads, and drags timers the AI does not | M | ✅ |
| C23 | The other object movers are not `MoveObject` either | M | ✅ |
| C24 | `moveMonster`'s return value, and what the AI does with it | M | ✅ |
| C25 | The stairs do not turn a monster's corner | M | ⚠️ |
| C26 | The disk icon ignores `HandleMouseEvents`' eye and mouth gate | S | ✅ |
| C27 | A dead champion keeps a ghost of slot 8 | S | ✅ |
| C28 | `DropAllPossessions` is not CSBWin's | S | ✅ |
| C29 | The save writer writes an empty cursor as `RNempty` | S | ✅ |
| C30 | `removeCharacterPossession` is a bare slot clear | M | ✅ |
| C31 | A dead champion's bones are not set down by `MoveObject` | S | ✅ |
| C32 | `AdjustStatsForItemCarried` is not ported | M | ✅ |
| C33 | An empty-handed click on bare stone plays no sound | S | ⏳ |
| C34 | Five possession writers, none of them CSBWin's whole | M | ⏳ |
| C35 | A monster that throws nothing reports missile 0, not `RNnul` | S | ⏳ |
| C36 | `EnableCharacterAction` keeps the attack type, and frees only its own timer | S | ⏳ |
| C37 | A door button or a touched wall does not make a tick due at once | S | ⏳ |
| D1 | Hands stored twice (*bundle with D2*) | M | ✅ archived |
| D2 | One "no object" value (split: D2a-d ✅) | L | ✅ archived |
| D3 | Most state fields are optional (split: D3a-g) | L | ✅ archived |
| D4 | `ObjectID` is not a distinct type | M | ✅ archived |
| D5 | Cell flags stored twice (`cellFlags` and `tiles`) | S | ✅ archived |
| D6 | `GameState.party` is a second copy of `Party.state` | S | ✅ archived |
| E1 | A shared game context, and one set of tables (split E1a-d) | L | ✅ |
| E2 | Split `Game.ts` by CSBWin source file (under way: `GameMethods` gone; the non-loop rest left) | L | ⚠️ |
| E3 | Split `TimerSystem.ts` | L | ⏳ |
| E4 | `ViewportRenderer` has become the UI host; `main.ts`'s `init()` | M | ⏳ |
| E5 | The quick-save snapshot is hand-maintained | M | ⚠️ |
| F1 | Sweep for empty placeholder tables | S | ⏳ |
| F2 | No golden frame covers an edge decoration | M | ⏳ |
| F4 | Four suite tools draw from an unseeded stream | S | ✅ |
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1–G10 | Unported CSBWin features | — | ⏳ |
| H | Deliberate divergences | — | 🚫 |

Size: **S** well under a session · **M** about one session · **L** several sessions (split
it and record the split here).

---

## A — Housekeeping

✅ Paid on 2026-09-23 (A1 with the commit that created this file, A2 in `1c0f132`). Both
entries, with their outcomes, are in `doc/PLAN_ARCHIVE.md` → "Resolved debt" → "`DEBT.md`
tier A".

---

## B — Duplicate implementations

✅ Paid on 2026-09-23 (B1 in `779ae8b`, B2 in `6f8b47c`..`4934252`, B3 in `5f77cc5`). All
three entries, with their outcomes, are in `doc/PLAN_ARCHIVE.md` → "Resolved debt" →
"`DEBT.md` tier B".

---

## C — Known divergences from CSBWin

### C1 ✅ The melee door bash ignores `HitDoor`'s delay

**Paid in `ca34722`.** `TimerSystem.hitDoor` takes CSBWin's `delay` (and the `d.Time` it
counts from); `AttackSystem`'s door arm passes 2. A delayed hit queues `TT_BASH_DOOR`
(= 2, new in `TimerFunction`), and `processBashDoor` — `ProcessTT_BASH_DOOR`,
`Timer.cpp:1492` — shatters the door when it fires. `TimerQueue` gained `SetTimer`'s
`TT_BASH_DOOR` rule: queueing one deletes every `TT_1` / `TT_DOOR` timer on the cell
(`Timer.cpp:1102-1123`). Evidence: `tools/dump-player-attacks.ts` case 8 (fails four checks
before the fix); the fact is in `doc/PROVEN_FACTS.md`.

Found on the way and fixed in `cbba108`: `hitDoor` compared the force with
`DoorCharacteristics[doorType]` instead of the level's `DoorTOC[doorType]`
(`CSBCode.cpp:5780-5783`). Levels 6, 12 and 13 map door type 0 to entries 3 and 2, so a
door there needed 110 force instead of 255 or 230 — invisible in stock DM, which has no
breakable door on those levels. `DungeonState.doorTOC` is now the one copy, shared with
`MonsterPerception`. Evidence: case 8b. Found too, and recorded as C12: the port's other
duplicate-timer rules.

<details><summary>original entry</summary>

`Attack.cpp`'s door-bash arm calls `HitDoor(attackX, attackY, strength, 0 /*not a ZO
spell*/, 2 /*delay*/)` (`doc/CSBwin-src/Attack.cpp:1803-1808`). Our `AttackSystem` calls
`hooks.hitDoor(position, strength, false)` with no delay, and `TimerSystem.hitDoor`
(`src/engine/TimerSystem.ts:2509`) has no `delay` parameter: only the zero-delay case — the
spell's — is ported. When this was recorded, melee did not exist and the delayed form was
unreachable; Phase 12 step 7 made it live. `HitDoor` itself is at
`doc/CSBwin-src/Code11f52.cpp:2263`; the original note names the delayed path
`TT_BASH_DOOR`.

Port the `delay` arm and whatever it queues, and fix the stale comment at
`TimerSystem.ts:2505-2507`. Evidence: extend `tools/dump-player-attacks.ts` to bash a real
door and check its state on the attack tick and after the delay.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “Clouds are alive”.</sub>

</details>

### C2 ✅ Missile→monster damage skips the magic and poison formulas

**Paid in `4393754`.**
`TimerSystem.processMissileEncounter`'s monster arm is now CSBWin's, line for line
(`Code11f52.cpp:1960-2042`): the victim is `ordinalOfMonsterAtPosition` of the arrival
corner (an empty corner lets the missile fly on unless the group is `drawAsSize4`); a
fireball heals a Black Flame (capped at 1000) and vanishes; the blow is
`sw(((64 * magic) & 0xffff) / defense08) + DeterminePoisonDamage`, and a blow of 0 skips
`DamageMonster` but still spends the missile; survivors get `ProcessTimers29to41(TT_M2)`;
the dagger-absorption arm runs only when nobody died. `Game.applyMissileDamageToMonster`
is gone — a `damageMonster` hook takes its place, passing CSBWin's `noItem16 = false` —
and `d.MonsterDamageResult` is reset at the top of each encounter, as CSBWin does.

Found on the way and fixed in the same commit, because the monster arm's formula depends
on it: the port turned a thrown Ven or Ful potion into its cloud **before** the switch,
while CSBWin keeps `RNprojectile` as the potion until the tail (`:2060-2063`). So a bomb's
first blow — on a monster *and* on a champion — was a fireball's instead of a thrown
object's. The door arm reads the potion too since C9.
Evidence: `tools/dump-missile-monster.ts` (9 of 15 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

The monster arm of `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:2007-2015`)
divides `64 * DetermineMagicDamage(...)` by the monster's `defense08`, adds
`DeterminePoisonDamage`, and picks its victim with `OrdinalOfMonsterAtPosition`.
`Game.applyMissileDamageToMonster` (`src/engine/Game.ts:1248`) passes the missile's raw
damage to `DamageMonster` and hits the first living group member. Everything it needs
exists: `TimerSystem.determineMagicDamage` (`TimerSystem.ts:2621`, so far used by the party
arm only), `MonsterDamage.determinePoisonDamage`, and `ordinalOfMonsterAtPosition` (single
after B2). Visible in play: spells and thrown weapons deal the wrong damage to monsters.

Do this before E3 moves the missile code: C2 is a fix, E3 a move. Evidence: a `tools/`
scenario that fires at a real group and checks the damage against a hand computation of
the formula, and which member took it.

<sub>Recorded in Phase 13. Context: `doc/PLAN_ARCHIVE.md` → "Phase 13 — Champion lifecycle".</sub>

</details>

### C3 ✅ `NinetySecondUpdate` cadence, and its body unaudited

**Paid in `f507904`.** `Game.processNinetySecondUpdate`
gates on `(tickCount & 511) == 0`. Auditing the body against `CSBCode.cpp:7339-7387` found
one more divergence: CSBWin loops over `d.NumCharacter` less one while
`d.PotentialCharacterOrdinal != 0`, so a Hall of Champions recruit's torch does not burn;
the port burned it. The torch test now uses `NameIndex` as CSBWin does (it used
`GetBasicObjectType`, which agrees for every torch), and hands go 1 then 0.
`SelectPaletteForLightLevel` / `DrawEightHands` need no call: both are derived from live
state every frame. Evidence: `tools/dump-ninety-second-update.ts` (5 of 6 checks fail
before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

CSBWin calls `NinetySecondUpdate` when `(d.Time & 511) == 0`
(`doc/CSBwin-src/CSBCode.cpp:680-683`). `Game.processNinetySecondUpdate`
(`src/engine/Game.ts:1397`) fires on `tickCount % (TICKS_PER_SECOND * 90)` — every 360
ticks instead of every 512, so about 1.4 times too often. Its body (torch burn-down) was
never audited against `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7339`). Port both,
the way `processTenSecondUpdate` was; `tools/dump-ten-second-update.ts` is the model for
the evidence.

</details>

### C4 ✅ `DamageCharacter` is missing two of CSBWin's three early guards

**Paid in `be5fcb5`.**
`MonsterAttack.damageCharacter` now opens as CSBWin does (`Character.cpp:2712-2717`):
`sw(damage)`, then `chIdx == -1` → 0, the recruit → `chIdx + 1`, a won game → 1 (through a
new `isGameWon` hook), a non-positive blow → 0, and only then the missing-champion and
zero-health checks. The `sw` was a third, unlisted gap: a blow of `0x10005` now hurts for 5.
Evidence: `tools/dump-champion-death.ts` → "DamageCharacter's early guards" (5 checks fail
before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`doc/CSBwin-src/Character.cpp:2712-2714`: `chIdx+1 == d.PotentialCharacterOrdinal`, which
makes a champion still standing in a Hall of Champions mirror unhurtable, and
`d.Word11694` — `Game.gameWon` in this port — a global damage suppressor. Both return early
with a non-zero value, so a caller reading the result sees "damage was dealt".
`MonsterAttack.damageCharacter` (`src/engine/MonsterAttack.ts`) guards only on the index, a
missing champion and zero health. The mirror guard matters now that missiles reach the
party through this function. `PartyState` already carries the potential-character ordinal
(`src/engine/gameTypes.ts:218`).

</details>

### C5 ✅ Three movement deferrals

All in CSBWin's move handler, `MoveParty` (`doc/CSBwin-src/CSBCode.cpp:7944`). Two were
fixes, one needed nothing; what the re-reading found beyond them is C13.

- ✅ **Wall-bump damage.** Paid in `73f6a86`. `MovementSystem.bumpWall` is `:8263-8291`: `GetCharacterToDamage` on the two
  corners of the crossed side, `DamageCharacter(ch, 1, 24, 2)` on each, and sound 18 only
  if `k != 0`. The map edge is bumped the same way (`GetCellFlags` answers stone there).
  `MovementHooks` became required — only `Game` builds a `MovementSystem`. Evidence:
  `tools/dump-party-collision.ts` case 5 (2 of 15 checks fail before); the fact is in
  `doc/PROVEN_FACTS.md`. Found on the way: the tool built its `Game` without `byte586`,
  and `MonsterAttack.determineAttackOrder` then silently uses `[0, 1, 2, 3]` — an F1
  placeholder.
- ✅ **`DiscardAllInput()` / `d.clockTick = 0`** on any inhibited move (`:8310-8314`).
  Paid in `d9eceae`, after `8159938` split `Game.runFrame` out of the loop so a tool can
  step frames. The mapping,
  read rather than guessed: `DiscardAllInput` drains the key queue and resets the mouse
  queue (`:7532`, `CSBUI.cpp:1374-1391`), and every move the port queues is in
  `movementQueue` (clicks are handled as they arrive), so the port clears that. (Since
  C21 that is `Game`'s one mouse queue, keys and clicks alike.)
  `d.clockTick` is "a tick is due", and the VBL sets it again on every VBL once
  `vblCount >= d.Speed` (`:1066-1077`), so zeroing it holds a due tick for one VBL —
  `Game.clockTickCleared` skips the tick for the rest of the frame. `MovementResult`
  carries CSBWin's `D5W` as `inhibited`. Evidence: `tools/dump-party-collision.ts` case 6
  (4 of 21 checks fail before); the fact is in `doc/PROVEN_FACTS.md`.
- 🚫 **The vertical-move guard** (`:8200-8204`), which refuses a Move Up / Move Down into
  a monster's cell outright. Nothing to port: CSBWin cannot reach it either. Move Up / Down
  (`0x1124` / `0x1125`) come only from `ThreeDMovements` keys (`:8476-8487`) and
  `GravityMove` (`Mouse.cpp:1259`, `:1334-1336`, called only while `gravityMove`, which
  only `if (GravityGame)` sets, `:8079-8083`). Both flags are the 3DMaze extension's,
  initialised `false` (`data.cpp:239-240`) and assigned nowhere in the tree.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “Monsters block the party”.</sub>

### C6 ✅ Which generator cloud and missile sprites flip with

**Paid in `d9877ef`.** Missiles were already right: CSBWin derives their mirror and flip from
the graphic's `word4`, the timer's direction, the relative position and `(mapX+mapY)&1`
(`Code51a4.cpp:2356-2465`), with no randomness, and `drawMissilesAtPosition` already did
that. Clouds were wrong three ways: they rolled `GraphicRandom` instead of the viewport's
`STRandomBool()`, rolled mirror before flip (CSBWin: flip first, `Code51a4.cpp:258-260`),
and ignored `tag006932`'s placement — the even-height `+1` on `y1` and the left-edge source
column `Larger(LOCAL_30, LOCAL_22 - x - 1)` (`:265-287`). While there: `viewportRandom`
starts at CSBWin's `0x34175432` (`Viewport.cpp:6697`) instead of a host random seed. No
golden frame shows a cloud, so none moved. Evidence: `tools/dump-cloud-draw.ts` (7 of 14
checks fail before); the fact is in `doc/PROVEN_FACTS.md`. The rest of `DrawClouds`' drift
is C14.

<details><summary>original entry</summary>

Lifted from inside the resolved "teleporter shimmer" entry (now in the archive), where it
was left open. `GraphicRandom` has exactly two call sites in all of CSBWin, both inside
`DrawTeleporter`; nothing in cloud or missile drawing calls it. Yet
`BytecodeInterpreter` rolls `this.graphicRandom(2)` for the `mirror` / `flip` of clouds
(`drawClouds`) and possibly missiles (`drawMissilesAtPosition`). What CSBWin does instead
is unverified: a `viewportRandom`-style `STRandomBool()`, or a mirror bit precomputed by
game logic rather than re-rolled every frame (`NextMonsterUpdateTime`,
`doc/CSBwin-src/CSBCode.cpp:5877-5941`, is an example of the latter). Read the cloud and
missile drawing source in `Viewport.cpp` first, then port what it does.

</details>

### C7 ✅ `CreateMovementTimer`'s overflow guard is not ported

**Paid in `7a90d0c`.**
`MonsterSystem.createMovementTimer` counts the waiting `TT_60` / `TT_61` timers of its kind
on the square and, from 31, deletes the group unless it is `Unique()` or carries something
(`Code11f52.cpp:2473-2512`). `Unique()` goes through `monsterUnique`, which applies
CSBWin's `drawAsSize4Monsters` gate — a constant `false` until G4 models the option.
Evidence: `tools/dump-monster-move.ts` case 4 (3 of 18 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`doc/CSBwin-src/Code11f52.cpp:2474-2510`; the gap is noted in place at
`src/engine/MonsterSystem.ts:636`. Recorded in Phase 12 step 2.

</details>

<sub>Context: `doc/PLAN_ARCHIVE.md` → "Phase 12 — Monsters".</sub>

### C8 ✅ Phase 8 DSA leftovers

Re-audited 2026-09-23. The first bullet was not DSA at all but the actuator local action;
it is **paid in `600811e`**. The second is paid in two commits; what it uncovered is C15
and C16.

- ✅ **`PerformLocalAction`'s champion.** `SkillIncreaser` (`Mouse.cpp:209-230`) credits
  `d.HandChar`, the cursor's owner; the port matched a living champion's `partyPosition`
  against the actuator's wall position. And `PressurePadOrAlcove` passes `-1`, not the
  alcove's position (`Code11f52.cpp:3875`), which also changes `RotateActuatorList`'s
  filter. Evidence: `tools/dump-local-action.ts` (3 of 6 checks fail before); the fact is
  in `doc/PROVEN_FACTS.md`.
- ✅ **DSA cloud moves.** `DsaSystem.findCellSource` now hands a cloud over: the check
  pass finds its `TT_25` / `TT_24` (lowest slot, index compare) or returns
  `SER_BadCloudTimer` (`MoveObject.cpp:227-245`), and `findCellDestination` retargets
  it — square, level and the placed ID (`:522-529`). **The old note that missiles need
  nothing was wrong:** `FindCellDestination` has a `dbMISSILE` arm (`:574-596`) that
  writes the new square into `timerWord8` and the new level; that is ported too.
  Evidence: `tools/dump-dsa-move.ts` (8 of 13 checks fail before); the fact is in
  `doc/PROVEN_FACTS.md`. What is still not CSBWin's about a DSA cell move is C15.
- ✅ **Deferred deletes.** `&DEL` now condemns through `DsaSystem.deleteObject` onto the
  bank's `objectDeleteList`, and `processTimer6Internal` ends with `consumateDeletes`,
  returning whether the slave went — which the three timer walks already `break` on.
  Before, the walks stopped only by accident: the freed slave's link read `0xFFFF`,
  which decodes as a cloud and was skipped. The deferral itself is not yet observable
  in play, because the port never reuses a freed slot; it will be once slot reuse is
  ported (C16). Evidence: `tools/dump-dsa-delete.ts` (4 of 9 checks fail before); the
  fact is in `doc/PROVEN_FACTS.md`.

The archived shimmer entry notes that no dungeon this project loads defines a DSA, so
neither DSA bullet could show in play; both tools build their own DSA.

<details><summary>original entry</summary>

- `PerformLocalAction()` does not map `HandChar` precisely; it matches on `partyPosition`
  when `mapPos` is specified. Suspect it of the same confusion between cell position and
  champion index that was fixed in `Party.getPartyChampion` and `MagicPanel`.
- DSA object manipulation skips the cloud and missile timer updates, and does not free DB
  records on delete (CSBWin uses a deferred `DeleteDBEntry`).

The archived shimmer entry notes that no dungeon this project loads defines a DSA. If that
holds, neither can show in play today, which is why this sits last among the verified
divergences.

</details>

### C9 ✅ Door pass-through rules and the magic damage/poison formulas

Re-audited 2026-09-23: the magic damage and poison formulas and Black Flame healing were
C2's; what was left was the door arm, and none of it was there. `TimerSystem.
processMissileEncounter`'s `case RoomType.DOOR` is now CSBWin's line for line
(`Code11f52.cpp:1844-1935`): a Zo spell works a door's button at `d.Time + 1` and is spent
either way (the port let it fly on at an open door, and read the time off the missile
timer); `DoorTOC`'s high-byte bit 1 lets a non-physical spell through, and a thrown object
that out-ranges `STRandom(128)`, fits in a pouch and is not a key; everything else hits
the door with `HitDoor(DetermineMagicDamage + 1 + STRandom % that)`. `RN::IsAKey` is
`objectIndex.IsAKey` now, and `TimerSystem` gets it and `ObjDesc.word4` as hooks from
`Game`. The shipped data has one door type missiles pass (`0x36e`). Evidence:
`tools/dump-missile-door.ts` (8 of 13 checks fail before, plus a data canary); the fact is
in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Recorded in Phase 9 step 12: door pass-through (the `DoorTOC` and `ObjDesc` checks for
missiles) and the magic damage and poison formulas, including Black Flame fireball healing
(`doc/CSBwin-src/Code11f52.cpp:1870+`, `:1488+`). Partly overtaken since:
`DetermineMagicDamage` exists now, and commit `83cccd0` worked on the door path. C2 paid
the monster arm; the door arm had neither the `DoorTOC & 2` pass-through test nor the
`HitDoor` with `DetermineMagicDamage + 1` force — a missile at a shut door just stopped.

</details>

### C10 ✅ Phase 9.5 refinements

Re-audited 2026-09-23; one of the three was live, the other two were overtaken.

- ✅ **`LastMonsterAttackTime`'s source.** Paid in `dc627b9`. CSBWin's one writer is
  `MonsterAttacks` (`Monster.cpp:982`), which `MonsterAttack` has ported since Phase 12;
  the Phase 9.5 stand-in in `Game.applyMissileDamageToParty` stamped it on every missile
  that reached the party, too — even a champion's own spell — so `AdjustSkills` doubled
  experience and the facing reset held off for a monster that had not attacked. It is
  gone. Evidence: `tools/dump-last-monster-attack.ts` (1 of 2 checks fails before); the
  fact is in `doc/PROVEN_FACTS.md`.
- ✅ **The throw skill gain** was already CSBWin's: `Game.throwByCharacter` is
  `Mouse.cpp:722-756` line for line — 8 experience, +4 for a weapon, + `uByte3 / 4` when
  its class is 12 or less, into `AdjustSkills(chIdx, 10, …, ASW_ThrowByCharacter)` before
  the mastery is read. The move lock it ends with (`d.Word11712 = 4`) is C13's.
- ✅ **Spell skill selection** was ported with the spell table: `castSpell` reads
  `spellByte5` (or its filter override) into `DetermineMastery` and `AdjustSkills`, as
  `Magic.cpp:1216-1229` does. Re-reading `CastSpell` for it found other drift: C19.

<details><summary>original entry</summary>

"Refine spell skill selection once spell definitions exist, replace the throw skill gain
with CSBWin's tables, and refine the `LastMonsterAttackTime` source now that monster AI is
in." Possibly overtaken: `Game.awardThrowSkill` (`src/engine/Game.ts:2728`) now documents
itself as `AdjustSkills(chIdx, 10, experience, ASW_ThrowByCharacter)`. Check each of the
three against CSBWin, then close or narrow this entry.

</details>

### C11 ✅ `DoesPartyHave` does not look inside chests

**Paid in `f1b71a4`.** `ActuatorSystem.doesPartyHave` is `Code11f52.cpp:3622-3680` now: the
30 possessions of every champion with hit points, then the cursor, each compared by
`GetBasicObjectType` and, when it is a chest (`OBJNI_CHEST`, 0x90, new), its contents too. Two
gaps beyond the entry: CSBWin's `goto` back into the loop checks **`d.objectInHand`** as
well (`:3672-3678`), which the port never did, and the champion filter is `HP() != 0`, not
the `alive` flag. The named hand/quiver fields are no longer read — `possessions[0]`, `[1]`
and `[8]` hold the same objects (D1). The shipped dungeon has 22 type-8 sensors. Evidence:
`tools/dump-does-party-have.ts` (4 of 7 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`DoesPartyHave` (`doc/CSBwin-src/Code11f52.cpp:3623-3670`), which answers actuator type 8,
walks the 30 possessions of every champion with `HP() != 0` and, for each one whose basic
type is `objNI_Chest`, walks the chest's `contents()` chain too, comparing
`GetBasicObjectType` against the actuator's value at every step. The port's
`ActuatorSystem.doesPartyHave` checks the possessions and the three hand/quiver fields but
never opens a chest, and filters on `champ.alive` rather than on hit points. A key carried
in a chest therefore fails to trip a type-8 sensor that CSBWin would trip.

Port it line for line (the hand/quiver fields go with D1). Evidence: a `tools/` scenario
that puts the matching object in a carried chest and checks the actuator fires.

<sub>Found while paying B1, 2026-09-23.</sub>

</details>

### C12 ✅ `SetTimer`'s duplicate-timer rules keep the wrong timer

Re-audited 2026-09-23 against `Timer.cpp:989-1130` read whole; every claim held.
**Paid in `21855bc`.** `TimerQueue.applyDuplicateTimerRules` is `SetTimer`'s head line
for line: a map timer meeting a map timer, and a `TT_1` meeting a `TT_DOOR` or a `TT_1`,
keep and return the old timer (a `TT_DOOR`'s `uByte9` flipped only if it was 2); only a map
timer meeting a `TT_1` deletes and requeues. The re-reading found one more thing: every
CSBWin timer search walks the **queue from its end** (`TIMER_SEARCH`, `:1209-1215`,
`:2924-2933`), not the slots. `TimerQueue.searchOrder()` is that order; the duplicate rules
and C8's DSA cloud-timer lookup (which took the lowest slot) use it. Evidence:
`tools/dump-timer-dedupe.ts` (3 of 15 checks fail before); the facts are in
`doc/PROVEN_FACTS.md`, and `doc/CSBWIN_TIMERS_REFERENCE.md` is corrected.

- ✅ **The sequence number was stamped at the wrong time.** Paid in `438c652`.
  `SetTimer` stamps `m_timerSequence++` on the slot it inserts into (`Timer.cpp:1189`;
  `SEQUENCED_TIMERS` is defined in `stdafx.h:17`), so a dropped duplicate consumes none and
  a requeued timer gets a fresh one. `TimerQueue.createTimer` stamped before the duplicate
  rules ran, and `addTimer` — which `MonsterSystem`, `MonsterAI` and `DsaSystem` call with
  their own entries — kept whatever the entry carried (the DSA passed 0, a requeued monster
  timer its old number). The stamp breaks ties between timers due on the same tick, and is
  saved (`gb2.TimerSequence`). `addTimer` stamps now. Evidence: `tools/dump-timer-dedupe.ts`
  case 6 (2 of 17 checks fail before). **Not ported:** the repack when the counter reaches
  0xffff (`:1136-1188`) — the port's counter grows past 16 bits, and a save masks it.

<details><summary>original entry</summary>

Seen while paying C1, not yet worked. `GameTimers::SetTimer` (`doc/CSBwin-src/Timer.cpp:989`)
resolves a clash by **keeping the timer already queued** and dropping the new one;
`TimerQueue.applyDuplicateTimerRules` mostly deletes the old one and queues the new.
`doc/CSBWIN_TIMERS_REFERENCE.md` → "Timer insertion and de-duplication" already states
CSBWin's rule correctly; the code does not follow it.

- *A map timer (5–10) meets a map timer* with the same time, level and cell (and, for
  `TT_STONEROOM`, `uByte8`): CSBWin copies the new `uByte9` into the existing one and
  returns it (`Timer.cpp:1022-1036`). The port deletes the existing and queues the new —
  which also keeps the new *function* where CSBWin keeps the old.
- *A `TT_1` meets a `TT_DOOR`* at the same time, level and cell: CSBWin keeps the
  `TT_DOOR`, setting its `uByte9` to `1 - new.uByte9` if it was 2, and returns it
  (`Timer.cpp:1073-1085`). The port flips the *new* timer's own `uByte9` and deletes the
  `TT_DOOR`.
- *A `TT_1` meets a `TT_1`*: CSBWin copies `uByte9` into the existing one and returns it
  (`Timer.cpp:1087-1092`); the port replaces it.
- The map-timer-meets-`TT_1` arm (`Timer.cpp:1038-1051`) and the new `TT_BASH_DOOR` rule
  match.

Re-read `Timer.cpp:989-1130` whole before changing anything — these line ranges come from
reading it in pieces. The visible effect is on doors toggled twice in one tick. Evidence:
a `tools/` scenario queuing each clashing pair and checking which entry survives, with
which function, `uByte9` and slot index. Size S–M.

</details>

### C13 ✅ The rest of `MoveParty`: stamina, move delay, queue depth

**Paid in `1dc4c1d`, `49c953e`, `263786a`, `f9d72b0` and `bbbc8a0`,** one bullet each.
What they left is C20 and C21; found on the way, D5. All in `doc/CSBwin-src/CSBCode.cpp`
unless said otherwise.

- ✅ **Every attempted step costs stamina.** Before the destination is even looked at, each
  champion's `staminaAdjustment` is `sw((3 * load) / MaxLoad + 1)` (`:8088-8101`), and
  `AdjustStamina` is applied to each after the party-move filter (`:8129-8135`) — for a
  blocked step as much as for a taken one. Now `MovementSystem.chargeStamina`, at the top
  of every move (turns are free). Evidence: `tools/dump-party-collision.ts` case 7 (4 of
  26 checks fail before); the fact is in `doc/PROVEN_FACTS.md`.
- ✅ **The move delay.** A taken step sets `d.partyMoveDisableTimer` to the slowest living
  champion's `TimeToMove` (`:8326-8347`); the tick counts it down (`:689-692`), and
  `Mouse.cpp:1482-1491` refuses a step while it is non-zero — or while `d.Word11712` is
  set and the step heads towards `d.Word11714`. The wall-clock gate (`Party.canMove`,
  `GAME_TIMING.MOVE_DELAY_MS` / `TURN_DELAY_MS`, `lastMoveTime`) is gone:
  `Game.processMovementQueue` (since C21, `Game.handleMouseEvents`) holds a step on the timer or the throw lock, and any turn or
  step on `HandleMouseEvents`' one-event-per-tick `lastTime` (`Mouse.cpp:1468-1476`);
  `Game.setPartyMoveDelay` is the step's tail, `CharacterStats.timeToMove` is
  `TimeToMove`, and a throw sets the lock. All three words are `PartyState` fields, saved
  and loaded, which closes `PLAN.md` Phase 10's gap. Evidence:
  `tools/dump-party-collision.ts` case 8 (it crashes before), `tools/dump-live-save-file.ts`
  (2 of 191 checks fail before); the fact is in `doc/PROVEN_FACTS.md`. **Left:** CSBWin
  stamps `lastTime` for every mouse event, clicks included — C21.
- ✅ **The key queue holds two keys, not three.** `CSBUI.cpp:143-145` is a 3-slot ring that
  refuses a key when `next == keyQueueStart` (`:1131-1139`), and the mouse queue each key
  moves on to at once is too: `TAG0196da` refuses a key when `MouseQEnd + 2 ==
  MouseQStart` (`CSBCode.cpp:8439-8443`). `Game.enqueueMovement` now lets two in.
  Evidence: `tools/dump-party-collision.ts` case 9 (1 of 39 checks fails before).
  **Left:** CSBWin's mouse queue also carries clicks — C21. **Corrected by C21:** the
  mouse queue is 8 long, not 3 (`Data.h:1513` leaves `NoKeyQue` undefined, so `:1515` is
  the dead branch), and the key queue in front is emptied one key per message, so
  *seven* moves wait. The bullet's premise was wrong; case 9 now checks seven.
- ✅ **`DiscardAllInput()` on a level change** (`:623`, after `LoadPartyLevel`): stairs, a
  pit or a teleporter to another level also throw away queued input. The port loads the
  level on arrival, so `Game.loadPartyLevelIfChanged` notes the change and `gameTick`
  discards at its top, where CSBWin does. Evidence: `tools/dump-party-collision.ts` case
  10 (1 of 43 checks fails before); the fact is in `doc/PROVEN_FACTS.md`. Found on the
  way: a level change made *inside* `ProcessTimers` is loaded at the next tick, not at
  once — C20.
- ✅ **Room type 7.** `D5W` is set only for stone, a shut door and a solid false wall
  (`:8224-8261`), so any other room type is entered; `DungeonState.isWalkable` refused
  `RoomType.EMPTY` (7). Neither `dungeon.dat` nor any of the fourteen saves has a type-7
  cell, so nothing loaded changes. `MovementSystem.handleMovement` now computes `D5W` as
  CSBWin does, and `isWalkable` (its only caller) is gone. Evidence:
  `tools/dump-party-collision.ts` case 11 (1 of 45 checks fails before). Found on the way:
  D5.
- 🚫 `CallPartyMoveFilter` (`:8119`) is a DSA filter — G2's kind, and no loaded dungeon
  defines one. Its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8122-8128`, `:8336-8346`) are
  G2's too.

### C14 ✅ `DrawClouds`: size, colour map, lightning position, the cell under the party

**Paid in `a1ed379`.** All five, and two more found on the way: a poison cloud drew
graphic 354 (one of the party-cell graphics) instead of `TAG005088`'s `348 + Smaller(3, 2)`
= 350; and `Word7246` was read as its declared 12 words, but lightning indexes it up to
word 20, running on into `Word7222`. So lightning one and two cells ahead had scale 0 and
was never drawn. The cell under the party is now a tiling of the whole viewport
(`d.Word2530`), not a 96×30 box. One assumption remains, recorded in the code and in
`doc/PROVEN_FACTS.md`: C++ does not fix the order of `TAG008c98`'s two random arguments,
and the port draws them right to left. The graphics are 48×31, not 48×32; CSBWin pads the
missing row, and the tiling never reaches it. Evidence: `tools/dump-cloud-draw.ts`
sections 4-7 (47 of 90 checks fail before). No golden frame shows a cloud; they all
still pass.

<details><summary>original entry</summary>

Found while porting C6's placement block; nothing here is fixed. All in
`doc/CSBwin-src/Code51a4.cpp`, against `BytecodeInterpreter.drawClouds`.

- **The size clamp is on the wrong thing.** `TAG005088` clamps the *scale* to 32 (`:29`);
  the port clamps the resulting width and height to 1..32, which crops every full-size
  cloud whose graphic is larger (graphic 348's table size is 160×111).
- **The scale.** `w_156 = Larger(4, Byte5758[group] * Larger(48, value+1) >> 8) & 0xfffe`
  (`:251-254`). The port has no `& 0xfffe`, and treats `value == 0` as a full-size 32 that
  CSBWin does not have.
- **The shrink's colour map** is `d.IdentityColorMap` for types 0-2 (`:52-58`); the port
  passes `colorMapMedium`.
- **Lightning (type 100) is placed from `d.Word7246`** (`:143`, `x, y, scale`); the port
  takes only the scale from it and the position from `Word7042` / `Word7162`.
- **The cell under the party** (`RelativeCellNumber == 12`, `:178-218`) picks graphic
  `351 + 3·D4W + (value>>5 != 0) + (value>>5 > 3)`, where `D4W` is the type index with
  type 40 counted as 2 (`:180-191`), shrinks the type-40 one through
  `d.Byte5712`, and draws it with `TAG008c98` at `STRandom0_3() + 87`, `STRandom() & 63` —
  two more viewport-stream draws. The port blits `351 + typeIndex` into a fixed rectangle.

Extend `tools/dump-cloud-draw.ts`, which already stubs the tables it needs.

</details>

### C15 ✅ A DSA cell move does not go through `MoveObject`

**Paid in `ff6e578`.** CSBWin's low-level `MoveObject` is ported once for objects, as
`TimerSystem.moveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`), and `DsaSystem.
findCellSource` / `findCellDestination` lift and set down through it and, for a monster,
through `MonsterSystem.moveMonster` (its monster branch), with `groupIndex` reset to
`0xd8` / `0xff` off the party's level (`MoveObject.cpp:504-521`) and a same-level monster
moved square to square (`:539-571`). The pads' `unchangedRoom` is now "the party stands
here", not "source is destination". Evidence: `tools/dump-dsa-move.ts` sections 4-8 (8 of
26 checks fail before); the fact is in `doc/PROVEN_FACTS.md`. Found on the way: C22, C23.

<details><summary>original entry</summary>

`FindCellSource` / `FindCellDestination` (`doc/CSBwin-src/MoveObject.cpp:166-251`,
`:460-600`) move the object with the low-level `MoveObject` (`Code11f52.cpp:2796`) —
`MoveObject(obj, x, y, -1, 0)` to lift it, `MoveObject(obj, -1, 0, x, y)` to set it down —
so an object a DSA drops on an open teleporter or pit is carried on at once, and a
monster moved within the party's level keeps its state: it is not lifted at the source
(`:205-219`), `MoveObject(object, srcX, srcY, x, y)` moves it, and its AI timers follow
(`:547-570`); moved off that level its `groupIndex` becomes `0xd8` / `0xff` (`:506-520`).
`DsaSystem.findCellSource` / `findCellDestination` splice the chain directly
(`removeObjectFromCell`, `addObjectToCell`) with only the actuator triggers, and have no
monster arm. The port's equivalent of `MoveObject`'s cell-effect loop is
`TimerSystem.resolveCellEffects`. Found while paying C8; no dungeon here has a DSA, so a
`tools/` scenario has to build one (`tools/dump-dsa-move.ts` shows how).

</details>

### C16 ✅ Freed database slots are never reused

**Paid in `6ae2afa`.** `DungeonState.findEmptyDBEntry` is `FindEmptyDBEntry`
(`doc/CSBwin-src/data.cpp:919-993`): the lowest record from index 1 whose link is `RNnul`,
else an append, which is the index `Enlarge` returns. Every allocator goes through it —
`MonsterSystem.findEmptyCreatureEntry`, `MonsterDamage.createDroppedRecord`,
`MonsterAttack.createBonesRecord`, `TimerSystem`'s missile and cloud records,
`Game.createMiscObject`, `constructPredefinedMissile` and `DsaSystem.copyItem` — and an
append keeps `count` and the header's `objectCounts` equal to the records, which the
image writer declares (`MonsterSystem`, `MonsterDamage` and the bones never bumped the
header). `AllocateIndirectIndex` needed nothing: the port has no live indirect index, and
the save writer numbers its own (see `doc/PROVEN_FACTS.md`, "An RN in block 10 or block 13
cannot be byte-identical"). C8's deferred deletes are now observable:
`tools/dump-dsa-delete.ts` shows a condemned record keeps its link for the rest of the run,
so nothing can take it. ⚠️ At 1024 records the allocator returns `null`, where CSBWin
calls `MakeMoreRoomInDB` (`Character.cpp:182`) — unported, and unreachable in the shipped
dungeons. Evidence: `tools/dump-db-reuse.ts` (7 of 11 checks fail before; the first arrow
`dungeon.dat` makes is weapon 105, not 107); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

CSBWin allocates a record with `FindEmptyDB<n>Entry` → `DATABASES::FindEmptyDBEntry`
(`doc/CSBwin-src/data.cpp:919`), which takes a freed slot (`DeleteDBEntry`, `data.cpp:995`,
is what frees one), and `AllocateIndirectIndex` (`SaveGame.cpp:2101`) reuses freed indirect
indices. Read both before porting; this entry has not audited their search order. Every allocator in the port appends instead — `MonsterSystem.
findEmptyCreatureEntry`, `MonsterDamage.createDroppedRecord`, `TimerSystem.
createCloudRecord` / `createMissileRecord`, `Game.createMiscObject`, `DsaSystem.copyItem`
— and two of them say so with a ⚠️. Object indices therefore drift from CSBWin's as soon as
anything is freed, which matters to a written save (Phase 10) and makes C8's deferred
deletes observable. Port `FindEmptyDB<n>Entry` once, in `DungeonState`, and route every
allocator through it.

</details>

### C17 ✅ `WiggleEverything` leaves a moved cloud's timer behind

**Paid in `7bfa5f6`.** `TimerSystem.wiggleObject` now retargets every `TT_25` / `TT_24`
naming a moved cloud (corner ignored, as CSBWin's `RN` compare does) to the new square,
level and placed ID (`Timer.cpp:2491-2510`). Evidence: `tools/dump-wiggle-cloud.ts` (2 of 12
checks fail before); the fact is in `doc/PROVEN_FACTS.md`. Found on the way: C18.

<details><summary>original entry</summary>

When a teleporter or pit opens under objects, `WiggleEverything` (`doc/CSBwin-src/
Timer.cpp:2428-2512`) moves each one with `MoveObject` and, for a cloud, retargets every
`TT_25` / `TT_24` naming it to `d.NewX`, `d.NewY`, `d.NewPos`, `d.NewLevel` (`:2491-2510`),
as it does a missile's timer (`:2476-2489`). `TimerSystem.wiggleObject` does the missile
and not the cloud, so a fireball's cloud carried off by a teleporter keeps burning at the
old square, and `processTT_25` then fails to unlink it (the ID it holds has the old
corner) and frees a record still linked in the new cell. The C8 cloud fix in `DsaSystem.
findCellDestination` is the pattern.

</details>

### C18 ✅ A Fluxcage never expires, and frees door record 0

**Paid in `51223c3`.** Found while paying C17. `CreateFluxcage` puts the cage in the
`TT_24`'s `timerObj8()` (`Code11f52.cpp:1535`) and `TT_24` removes and frees that object
(`CSBCode.cpp:6494-6510`). `TimerSystem.createFluxcage` put it on `TimerEntry.object`, as
every `TT_25` does, but `processExpireObject` read `timerWord8` — 0 on a live timer — so the
cage stood forever and `DeleteDBEntry(0)` freed door record 0, cutting that cell's chain
after the door. Only a cage restored from a save worked: `restoreTimerQueue` fills both.
`processExpireObject` reads `object` now. Evidence: `tools/dump-clouds.ts` section 6 (3 of
27 checks fail before).

### C19 ✅ `CastSpell` under a spell filter's overrides

**Paid in `2a5761e`.** `Game.castSpell` handles the filter's `action` first — its message
prints for a dead caster, and an action with no message (8 and up) now casts instead of
aborting — then takes the difficulty from the spell's own `skillRequired` and the
`missileType` from the filter. Evidence: `tools/dump-cast-spell.ts`, new (5 of 8 checks
fail before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Found re-reading `CastSpell` (`doc/CSBwin-src/Magic.cpp:1090`) for C10. All three need a DSA
spell filter (`DsaSystem.processSpellFilter`) to show, and no dungeon here defines one, so a
`tools/` scenario has to build it (`tools/dump-dsa-move.ts` shows how) or call
`Game.castSpell` with the parameters directly.

- **The difficulty uses the spell's own skill.** `D4W = pSpell->skillRequired + spellPower`
  (`:1207`) — the unfiltered value — while the experience's middle term uses the filtered
  `skillRequired` (`:1210`). `Game.castSpell` builds both from the filtered one.
- **`missileType` can be overridden** (`:1201-1205`); `Game.castSpell` always reads
  `spell.word6`, so a filter cannot change what a class-2 or class-3 spell does.
  (The class-1 potion type is `pSpell->word6` in CSBWin too, `:1250`.)
- **The abort messages come before the caster checks.** CSBWin handles
  `spellParameters.action` (`:1110-1149`) before `chIdx >= d.NumCharacter` and `HP() == 0`
  (`:1150`, `:1153`); the port checks the caster first, so a filter's abort on a dead caster
  prints nothing.

</details>

### C20 ✅ A level change inside `ProcessTimers` waits for the next tick

**Paid in `9e742ac`.** `Game.gameTick` now loops as CSBWin's main loop does:
`loadNewPartyLevel()` (`tag0006a4`: load, discard) at the top, then `processTimers` again
for as long as a pass changed level. The port resolves the pit/teleporter chain when the
party moves, so the `MoveObject(RNnul, -1, 0, x, y)` placement has nothing left to do.
Evidence: `tools/dump-party-collision.ts` case 12, new: a `TT_PIT` opens under a party
with a turn queued. Before the fix, 3 of its 4 checks failed, and the turn ran on the new
level. The fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Found paying C13. The main loop runs `ProcessTimers()` and then
`if (d.newPartyLevel != -1) goto tag0006a4;` (`doc/CSBwin-src/CSBCode.cpp:635`): a timer that
moves the party to another level — a pit opening under it, a teleporter an actuator
switched on — has the level loaded, the party placed with `MoveObject(RN(RNnul), -1, 0, x,
y)`, input discarded, and `ProcessTimers` run again, all in the same tick (`:615-635`).
`Game.gameTick` calls `loadPartyLevelIfChanged` only before `processTimers`, so such a level
is loaded, and its input discarded, a tick late; a turn or step queued in between runs on
the new level first. Evidence: a `tools/` scenario with a pit timer under a party that has
a turn queued (`tools/dump-party-collision.ts` case 10 is the pattern).

</details>

### C21 ✅ Clicks do not go through the input queue

**Paid in `efce48e`.** `Game` now has CSBWin's one
mouse queue, a ring of `MOUSEQLEN` entries, and it holds keys and clicks alike.

- **The queue is 8 long.** `MOUSEQLEN` is 8, not 3. `Data.h:1513` leaves `NoKeyQue`
  undefined, so `:1515` is dead, and this entry and C13 had cited it without its
  `#ifdef`.
- **Queueing.** `Game.onMouseClick` queues a button while fewer than six entries wait
  (`OnMouseClick`, `CSBCode.cpp:7607-7696`). `Game.onMouseUnClick` queues `0x0add` while
  fewer than seven wait (`:7581-7600`). `Game.enqueueMovement` refuses a key only when
  seven wait (`TAG0196da`, `:8439-8443`).
- **Dispatch.** `Game.handleMouseEvents` replaces `processMovementQueue`. It handles the
  head once per tick and turns and steps itself (`Mouse.cpp:1550-1570`); every other
  button goes to the UI's `handleMouseButton`, and the button-up goes to
  `handleMouseUnclick`. Every button stamps `lastTime`. The button-up does not, and it
  lets the next entry through in the same pass (`:1523-1549`). A held step blocks
  whatever is behind it.
- **The viewport.** Button 80, `HandleClickInViewport`, is now `src/ui/events.ts`'s
  `handleClickInViewport`, reached through the queue instead of from the DOM event.
  *Regression:* the move dropped the old `isWallDecorationHit(…) && handleWallClick()`
  fall-through. An alcove's wall decoration then swallowed every pickup from the alcove.
  Fixed by porting CSBWin's button order, objects before the wall
  (`resolveEmptyHandedViewportClick`, `tools/dump-viewport-click.ts`).
- **The on-screen arrows (buttons 1-6).** They were queued but dropped; they now work.
- **Removed.** `ui.mouseQueue` and the renderer's `processMouseQueue` are gone.

Still direct, and deliberately so:

- the save menu and the Reincarnate screen, which are modal;
- the panel keys in `ui/Keyboard.ts`, whose module comment gives the reason.

**Evidence:**

- `tools/dump-mouse-queue.ts` is new, with 15 checks. It crashes before the fix, which
  had no queue API.
- `tools/dump-party-collision.ts` case 9 now expects seven keys.
- `npm test -- --frames` passes. The frames click through the queue.
- Probed live: the forward and turn-left arrows move the party.

The fact is in `doc/PROVEN_FACTS.md`, and the "two moves" entry there is corrected.
Found on the way: C26, G9, and additions to G5 and G6.

<details><summary>original entry</summary>

Found paying C13. CSBWin has one mouse queue (`MOUSEQLEN` 3, `doc/CSBwin-src/Data.h:1515`)
for keys and clicks alike: a click is queued only into an empty queue, with its button-up
behind it (`CSBCode.cpp:7626-7630`, `:7586-7598`), and `HandleMouseEvents` handles one entry
per tick, stamping `lastTime` for each (`Mouse.cpp:1468-1476`). The port queues only
movement (`Game.movementQueue`) and handles clicks as they arrive, so a click neither waits
for the tick nor holds the next turn or step back to the next one, and a click does not
fill a queue slot a key would then be refused. Porting it means turning
`processMovementQueue` into `HandleMouseEvents`' dispatcher for every button. Size M; no
save or `tools/` scenario depends on it yet.

</details>

### C26 ✅ The disk icon ignores `HandleMouseEvents`' eye and mouth gate

**Paid in `7d19e09`.** `handleMouseButton` now returns
before the 140 branch while `ui.pressingEye` is set (`Mouse.cpp:1679-1680`). The port
has no pressed mouth, so only the eye is tested.

Evidence: `tools/dump-mouse-queue.ts` case 8 queues 71 and then 140, once without a
button-up between them and once with one. Before the fix, 1 of 17 checks fails.

<details><summary>original entry</summary>

Found paying C21. After button 81, `HandleMouseEvents` returns at once, stamping
`lastTime`, while `d.PressingEye` or `d.PressingMouth` is set
(`doc/CSBwin-src/Mouse.cpp:1679-1680`). Every later button is swallowed: 140 (the disk
icon), 145-148, 200-216.

The port's `handleMouseButton` (`src/renderer/ui/Mouse.ts`) handles 140 without that
test. It also has no `pressingMouth` at all: the mouth is handled on the press
(`handleMouthPress`).

The fix is one guard before the 140 branch. Evidence would be a `tools/` check that
queues 71, then 140, with no button-up between, and sees no save menu requested.

</details>

### C22 ✅ A monster's own move presses no pads, and drags timers the AI does not

**Paid in `593febf`.** `MonsterSystem.moveMonster` lifts and sets down a group that does
not levitate through `PlaceOrRemoveObjectInRoom` (a new `triggerObjectMove` hook, wired to
`ActuatorSystem.triggerObjectMove`): leaving with `unchangedRoom` = "the party stands
here", arriving with `false` (`doc/CSBwin-src/Code11f52.cpp:3287`, `:3392`); a flying
group presses nothing (`:3274`, `:3386`). The removal now comes before the occupancy test,
as in CSBWin (`:3257-3296`, `:3335-3358`), so a group that goes into abeyance releases its
pad. The AI-timer retarget left `moveMonster`: CSBWin's AI re-aims only `timer_70`
(`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`), which `MonsterAI` already did, and the
DSA's re-aim of the rest (`MoveObject.cpp:539-571`) now lives in `DsaSystem.
findCellDestination`. Evidence: `tools/dump-monster-pad.ts`, new, on a real type-1 pad
(6 of 12 checks fail before); `tools/dump-monster-move.ts` case 1 now expects the timers to
stay; `tools/dump-dsa-move.ts` section 6 still passes. The fact is in
`doc/PROVEN_FACTS.md`, and the "must retarget" entry there is corrected. Found on the way:
C24.

<details><summary>original entry</summary>

Found paying C15. `MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:3327-3424`)
removes and places a non-levitating group through `PlaceOrRemoveObjectInRoom`
(`:3287`, `:3392`), so a monster walking onto or off a pressure pad fires it.
`MonsterSystem.moveMonster` splices the chains with `removeObjectFromCell` /
`addObjectToCell` and calls no actuator at all. It also points the group's AI timers at
the new square whenever its `ITEM16` did not change — which is what the *DSA* does after
`MoveObject` (`MoveObject.cpp:539-571`), not `MoveObject` itself — so every AI step does
it too, where CSBWin's AI (`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`) leaves the other
timers behind. The DSA path now relies on it (C15); moving the retarget out means giving
`DsaSystem.findCellDestination` its own. Needs a `tools/` scenario with a pad under a
monster's path (`tools/dump-dsa-move.ts` sections 6-8 build a group). Size M.

</details>

### C23 ✅ The other object movers are not `MoveObject` either

**Paid in `298d869`, `42ccf79`, `68a21b5`, `e1cf787` and `9152c0b`.** Every mover CSBWin sends
through `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`) now goes through
`TimerSystem.moveObject` or, for a group, `MonsterSystem.moveMonster`:

- **`298d869`.** `TimerSystem.wiggleEverything` (`WiggleEverything`, `Timer.cpp:2428-2512`)
  moves each object through `moveObject`, walking the chain as CSBWin does, and re-aims a
  missile's timer from what `moveObject` reports. Evidence: `tools/dump-wiggle-objects.ts`
  (4 of 9 checks fail before).
- **`42ccf79`.** It moves the first monster through `moveMonster`, which gained the
  unchanged-room return (`Code11f52.cpp:3183-3213`). Evidence: `tools/dump-wiggle-monster.ts`
  (5 of 9 fail before).
- **`68a21b5`.** `Game.dropObjectFromCursor` is `moveObject(obj, -1, 0, x, y)`
  (`Mouse.cpp:881-889`) and `TimerSystem.dropMissileObject` is `moveObject(obj, -2, 0, x, y)`
  (`Timer.cpp:151-159`). Both had placed with `unchangedRoom` false where `MoveObject` passes
  "the party stands here" (`:3433-3448`), and the cursor drop had turned the item's corner on
  a relative teleporter although `oldX == -1` (`:3000-3006`). `resolveDroppedObjectPosition`
  is gone. Evidence: `tools/dump-drop-move-object.ts`, new (3 of 8 fail before).
- **`e1cf787`.** `MonsterDamage.deleteMonster` lifts the group with `moveMonster(obj, x, y,
  -1, 0)` (`:1038`, a new `moveMonster` hook), and `moveMonster` has the `newX < 0` path:
  `CheckMoveFromMissile` (which finds the cleared hit points and returns at once,
  `:2593-2596`), the lift through `PlaceOrRemoveObjectInRoom` or, levitating,
  `RemoveObjectFromRoom`, then `return 0` (`:3257-3297`). So a group killed on a pad releases
  it. Evidence: `tools/dump-monster-pad.ts` section 6 (1 of 4 fails before).
- **`9152c0b`.** `resolveCellEffects` has the stairs arm (`:3108-3131`): a monster or an
  object, not the party or a missile, goes one level down unless bit 2 says up, then one
  square out through `ExitStairsDirection`, its corner turned to face the stairs; the loop
  goes on from there. The `oldX != -1` teleporter rule moved into the loop, since the stairs
  turn a corner whatever `oldX` is. Evidence: `tools/dump-stairs-move.ts`, new (5 of 6 fail
  before).

The facts are in `doc/PROVEN_FACTS.md`. Found on the way: C25.

<details><summary>original entry</summary>

Found paying C15, which ported `MoveObject` for objects once, as `TimerSystem.moveObject`.
The other callers hand-rolled it, and each differed from it somewhere: the object and the
monster wiggle; `Game`'s drop from the cursor and `TimerSystem.dropMissileObject`, which
passed `unchangedRoom = false` and turned a dropped item's corner on a relative teleporter
although `oldX == -1`; `resolveCellEffects` had no stairs arm; and
`MonsterDamage.deleteMonster` took the group off its square with `removeObjectFromCell`
where CSBWin calls `MoveObject(obj, x, y, -1, 0)`, so a monster killed on a pad left it
pressed (found paying C24). Size M.

</details>

### C24 ✅ `moveMonster`'s return value, and what the AI does with it

**Paid in `6480bd4`.** `MonsterSystem.moveMonster` returns `{ code, position }`: CSBWin's
value (`LOCAL_14`, or 1 for a group that left the dungeon) and `d.NewX/NewY/NewLevel`. The
three `MonsterAI` callers end the turn on any non-zero `code` and re-aim `timer_70` to
`position` (`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`); the DSA and `createMonster`
test `code !== 0` too, so a group made on the party's level is `RNnul` with no sound, as
in CSBWin (`Monster.cpp:222-231`), and an audible generator now queues its own
(`Timer.cpp:1797-1800`). `code` comes from `TeleportMonster` only (`Code11f52.cpp:2988`),
the attach is `code++` (`:3376`), and `moveMonster` no longer writes `uByte10/11` or
`ubPrev*`. The pit fall hurts the group at its old square with `P5 = 0` (`:3096-3097`),
drops dead members' remains where it landed (`TAG00b522`, `:3103`), and a fatal fall or a
forbidden level deletes the group after the loop (`:3147-3176`); a chained teleport reads
the attached level's `ITEM16` (`:2988`). `DamageMonsterGroup` now empties the deferred
droppings first (`:1333`). Evidence: `tools/dump-monster-move-code.ts`, new (13 of 17
checks fail before); `tools/dump-monster-move.ts` case 1 (2 of 18 fail before);
`tools/watch-monsters.ts` now finds groups on the map instead of in `uByte10/11`; the other
tools that made a group get it through `tools/lib/createMonster.ts`. (The new tool joined
`tools/run-checks.mjs`'s list only in `42ccf79`: the runner has no discovery.) The facts are in
`doc/PROVEN_FACTS.md`, and the older return-value entry there is corrected. Found on the
way: the `DeleteMonster` bullet under C23, and `ProcessMonsterDeleteFilter` under G2.

<details><summary>original entry</summary>

Found paying C22. `MoveObject`'s monster branch returns `LOCAL_14`
(`doc/CSBwin-src/Code11f52.cpp:3423`) and each AI caller stops on anything non-zero
(`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`); the port's value and its callers differ:

- **The AI ignores a non-zero `code`.** `MonsterAI` returns only on `removed`, so after a
  teleport or a level change (`code >= 1`, when `moveMonster` has already started fresh
  timers and deleted the old square's) it goes on, re-aims `timer_70` at the square it
  asked for and re-queues it. CSBWin drops `timer_70` there. It also re-aims to `newX`
  where CSBWin uses `d.NewX` — the same square whenever `code` is 0.
- **`resolveMonsterDestination`'s `code` is 1 for any move**, a pit fall included, where
  `LOCAL_14` is set only by `TeleportMonster` (`:2988`); and an attach sets `code = 1`
  where CSBWin does `LOCAL_14++` (`:3376`), so a group teleported onto the party's level
  gets `2` and `ClearAttacking_DeleteMovementTimers(&d.Item16[0], …)` (`:3411-3413`) —
  slot 0's attacking bits, a CSBWin quirk to keep.
- **`moveMonster` rewrites the `ITEM16`'s `uByte10`/`uByte11` and `ubPrevX`/`ubPrevY`.**
  `MoveObject` touches neither; `uByte10`/`uByte11` is set only by `AttachItem16ToMonster`
  (`CSBCode.cpp:6088-6090`), and a frightened group heads back to it
  (`Monster.cpp:2273-2277`), so in the port it heads for the square it is on. `ubPrev*` is
  the AI caller's to set, which `MonsterAI` does.
- **A pit that kills the whole group, or a level the monster is not allowed on**, deletes
  it after the loop, dropping its remains (`LOCAL_18`, `:3099-3100`; `:3147-3176`). The port
  ignores `monsterFallsIntoPit`'s result, and `applyTeleporterToMonster` refuses the
  teleport instead (`TimerSystem.ts`, `blocked`), leaving the group on the teleporter.

Each is small; together they are one pass over `moveMonster` and its three `MonsterAI`
callers. Extend `tools/dump-monster-pad.ts` or `tools/dump-monster-move.ts`. Size M.

</details>

---

### C25 ⚠️ The stairs do not turn a monster's corner

Found paying C23. `MoveObject`'s stairs arm turns whatever it moves to face the stairs with
`objD7.pos(LOCAL_28)` (`doc/CSBwin-src/Code11f52.cpp:3124-3130`), and `RN::pos` writes the
corner into the global `dataTypeMap` (`CSBTypes.h:336-341`), so a monster's corner changes
too. The port's `resolveCellEffects` computes the turned corner for a monster, but
`MonsterSystem.moveMonster` sets the group down under the ID it came with: the corner is
part of the port's `ObjectID`, and `removeObjectFromCell` and every caller holding the ID
compare it whole, where CSBWin's `RN ==` compares only the indirect index (`:349-356`).
Believed invisible — a group's members are placed by `ITEM16`/`uByte5`, not by the RN's
corner — but not verified. Revisit with D4 (`ObjectID` as a distinct type), which is where
an ID whose corner is not part of its identity belongs.

*Re-sized after D4 (2026-09-25): M, not S.* The brand does not settle this: what C25 needs
is CSBWin's `RN ==`, a comparison that ignores the corner, and a type cannot forbid `===`.
The fix is an `rnEquals(a, b)` (`(a & 0x3fff) === (b & 0x3fff)`, with the `RNVAL`s compared
whole) used by `removeObjectFromCell` and every chain walker that CSBWin writes as `RN ==`.
Only then can `moveMonster` set the group down under the turned ID without the next lift,
which still holds the old ID, missing it. That touches every chain operation. It is still
tier C, so it waits in the frozen queue with the others.

### C27 ✅ A dead champion keeps a ghost of slot 8

**Paid in `3eeca47`.** Found splitting D1. `Game.dropAllPossessions` emptied the
array and the `weaponHand` / `shieldHand` mirrors but not `quiver`, and
`ui/Character.getChampionPossession` falls back to `quiver` for slot 8 when the array
reads null — so after death the inventory still showed whatever had been in slot 8,
though it now lay on the floor. CSBWin's `DropAllPossessions` empties all thirty
(`doc/CSBwin-src/Character.cpp:2497-2518`). The fix clears the mirror; D1 then deletes
it. Evidence: `tools/dump-champion-death.ts` arms slot 8 too and reads every slot back
through the UI's reader (3 of 41 checks fail before).

### C28 ✅ `DropAllPossessions` is not CSBWin's

**Paid in `7abaf1a`.** `Game.dropAllPossessions` walks `d.DropOrder`, now read from graphic `0x232`
(byte 244, `UITables.graphic232.dropOrder`, passed in `TimerTables`), takes each slot
out through `removeCharacterPossession`, turns the object to the champion's corner and
sets it down with `timerSystem.moveObject(obj, -1, 0, partyX, partyY)`. `Game` throws if
the table was not handed in, rather than dropping nothing; eight tools that kill a
champion now pass it. The drop is only as faithful as `removeCharacterPossession`, which
is a bare slot clear — C30. The table and the order are in `doc/PROVEN_FACTS.md`.
Evidence: `tools/dump-champion-death.ts` section 7 — `DropOrder` is a permutation of
0-29 (the canary), the chain lists the objects in `DropOrder` order, and a possession
dropped over an open pit falls through it (2 of 45 checks fail before).

<details><summary>original entry</summary>

Found paying C27. CSBWin's `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2497-2518`)
takes the slots in `d.DropOrder[30]` order, through `RemoveCharacterPossession` (so the
load, the light and the portrait hands are updated), turns each object to the champion's
`charPosition` and sets it down with `MoveObject(obj, -1, 0, partyX, partyY)` — so the
drop presses pads and falls through pits like any cursor drop. `Game.dropAllPossessions`
walks slots 0-29 in array order, writes the array directly, and splices each object in
with `addObjectToCell`. Visible as the stacking order of a dead champion's belongings, and
on a pad or a pit. `DropOrder` must come from the game data or CSBWin, not be guessed.
Extend `tools/dump-champion-death.ts`. Size S-M.

</details>

### C29 ✅ The save writer writes an empty cursor as `RNempty`

**Paid in `3b76c49`.** Found splitting D2b. `SaveGamePayload` wrote
`(party.objectInHand ?? 0)`, so an empty cursor went into the index pre-pass and out
through `encode` as 0, `RNempty`. CSBWin writes `d.objectInHand.ConvertToInteger()`
(`doc/CSBwin-src/SaveGame.cpp:1033`), `RNnul` for an empty hand, and its loader converts
anything that is not `RNnul` (`:2753-2760`), so a file this port wrote with an empty
cursor would have loaded in CSBWin with `RNempty` in hand. Every committed save with an
empty hand holds `0xffff`. The port's own reader accepted 0 as empty, which is why no
round trip caught it. Evidence: `tools/dump-live-save-file.ts` now reads the written word
back (2 of 193 checks fail before). The fact is in `doc/PROVEN_FACTS.md`.

### C30 ✅ `removeCharacterPossession` is a bare slot clear

**Paid.** `Game.removeCharacterPossession` now does what CSBWin's does to the object and
the party: round the neck an Illumulet gets `value(0)` and takes `d.Word1074[2]` off
`d.Brightness` (the table is passed in `TimerTables`; `Game` throws if it is missing when
an Illumulet comes off), a Jewel Symal gets `value(0)`; in the weapon hand a scroll
closes; in either hand a torch goes out — all tested on `RN::NameIndex`, as CSBWin does.
So a champion who dies wearing an Illumulet no longer leaves the party lit, and a thrown,
shot or dropped torch no longer burns on the floor. The palette, hands, backpack redraw,
`charFlags` and `load` have no counterpart (derived every frame, or re-summed). Left out
and recorded in C34: `AdjustStatsForItemCarried` (C32), `TAG01b1c0` and `RepackChest`
(both read UI state). Evidence: `tools/dump-champion-death.ts` section 8 kills one
champion wearing an Illumulet with a lit torch and an open scroll in hand, and one
wearing a Jewel Symal (5 of 56 checks fail before; the weapon and misc types are found
through `ObjDesc`, and come out as DM's torch 2, Jewel Symal 2, Illumulet 3).

Found paying C28. `Game.removeCharacterPossession` only writes `RNnul` into the slot.
CSBWin's `RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1822-1930`) also:
for slot 10, an Illumulet gets `value(0)` and takes `d.Word1074[2]` off `d.Brightness`, a
Jewel Symal gets `value(0)`; for slot 1, sets `CHARFLAG_weaponAttack`, calls `TAG01b1c0`
when this champion's attack menu is open, and closes a scroll (`open(false)`); for either
hand, a torch goes out (`litTorch(0)`); when the champion's inventory is open, a chest in
slot 1 is repacked; and `AdjustStatsForItemCarried(…, -1, …)` (C32). The load needs
nothing — `CharacterStats.characterLoad` re-sums. Its callers are the throw, the shot,
the two hand refills and, since C28, `DropAllPossessions`, so a champion who dies
wearing an Illumulet leaves the party's light raised, and a thrown or dropped torch stays
lit. The UI's `setChampionPossession` does the Illumulet's brightness and the torch, but
not the rest, so the two paths disagree. Port it once, for the engine, with a check that
kills a champion wearing an Illumulet and holding a lit torch.

### C31 ✅ A dead champion's bones are not set down by `MoveObject`

**Paid.** `MonsterAttack.killCharacter` turns the bones to the champion's corner and sets
them down through a new required `moveObject` hook (`TimerSystem.moveObject`), then
registers the expool record with the same RN, as CSBWin does. The old path deleted the
record when `addObjectToCell` failed; CSBWin has no such branch. Evidence:
`tools/dump-champion-death.ts` section 7 — dying over an open pit, no bones stay on the pit,
they land on the level below, still paired in the expool and in the champion's corner
(2 of 49 checks fail before).

Found paying C28. `KillCharacter` sets the bones down with `MoveObject(objD4, -1, 0,
d.partyX, d.partyY)` (`doc/CSBwin-src/Character.cpp:2636-2645`), like the possessions,
so over an open pit they fall. `MonsterAttack.killCharacter` splices them in with
`addObjectToCell`. `tools/dump-champion-death.ts` section 7 already stands the party on
an open pit; assert where the bones end up, and check the expool record still pairs
them.

### C32 ✅ `AdjustStatsForItemCarried` is not ported

**Paid.** `src/engine/AdjustStatsForItemCarried.ts` is a line-by-line port, `NameIndex`
and the `cursed()` bit included, over the port's wrapping `ATTRIBUTE` bytes
(`attributes.ts`) and an `sw` `maxMana`. Every writer of a champion's slots now calls it:
`Game.removeCharacterPossession` (`-1`), `Game.setChampionHand` (`+1`, the hand refills and
Zokathra), the Hall of Champions recruit (`+1` per object, as `AddCharacter` does through
`AddCharacterPossession`, `Character.cpp:789`), the UI's `setChampionPossession` and
`DsaSystem.setChampionPossession` (`-1` for what leaves, `+1` for what arrives) — so a
bonus always comes off by the path it went on. The twenty-one new `OBJNI_*` constants
were computed from the `Objects.h` enum. **Saves:** CSBWin stores the adjusted
attributes, and so does the port (the attributes are saved as they are), so neither a
CSBWin save nor the port's own needs anything on load and `RUNTIME_SAVE_VERSION` is
unchanged. A port save written *before* this commit holds unadjusted attributes: a
champion recruited then with NABI's Staff or BORIS's Rabbit's Foot loses the bonus when
the object comes off, once. Not ported: `SetCursed`, whose only caller is the unported
`STKOP_SetCurse` (G1). Evidence: `tools/dump-item-bonuses.ts` — every row of the table
against the real objects (the names in graphic `0x22c` are the canary, five of them
DM's names for CSB's), the places a row does not apply, curses and the wrapped Luck
minimum, and the four writers (3 of 99 checks fail with the writers stashed, 1 of 100 for
the DSA's).

Found paying C28. `AdjustStatsForItemCarried` (`doc/CSBwin-src/Character.cpp:1569-1770`)
is what makes a carried object change its bearer: a cursed weapon or garment in slots
0-12 costs 3 Luck, a Rabbit's Foot anywhere gives 10; in the weapon hand the Mace of
Order gives 5 Strength and the staffs, wands, Vorpal Blade and their kin give max mana;
Powertowers on the legs 10 Strength; the Crown of Nerra 10 Wisdom and the Dexhelm 10
Dexterity on the head; Flamebain 12 anti-fire and the Cloak of Night 8 Dexterity on the
body; round the neck a Jewel Symal 15 anti-magic, the Cloak of Night 8 Dexterity, the
Moonstone 3 max mana. Maximum, current and minimum all move. CSBWin calls it from
`AddCharacterPossession` (`:1970`), `RemoveCharacterPossession` (`:1858`) and `SetCursed`
(`:1801`, `:1815`). No module of the port has any of it, so none of these objects does
anything worn. Needs the whole table read before porting (`:1600-1760`), a check per
kind of bonus, and a thought about saves: CSBWin stores the adjusted attributes, so a
save loaded from CSBWin already carries the bonuses. Size M.

### C33 ⏳ An empty-handed click on bare stone plays no sound

Found fixing the alcove pickup. When `HandleClickInViewport`'s empty-handed button loop
hits nothing, it plays sound 4 at the party if all of these hold: the party is not
facing an alcove, `d.CellTypeJustAhead` is 0, the cell ahead is stone or a visible false
wall, and the click is within x 33-189, y 44-150
(`doc/CSBwin-src/Mouse.cpp:1139-1157`). `resolveEmptyHandedViewportClick` returns `null`
there, and nothing plays. Add the sound, and a row to `tools/dump-viewport-click.ts` that
asserts it is queued.

### C34 ⏳ Five possession writers, none of them CSBWin's whole

Found paying C30. CSBWin changes a champion's slots only through
`AddCharacterPossession` (`doc/CSBwin-src/Character.cpp:1936-2037`) and
`RemoveCharacterPossession` (`:1822-1930`). The port has five writers:

- `Game.removeCharacterPossession` — CSBWin's since C30 and C32, less two things:
  `TAG01b1c0` when `d.AttackingCharacterOrdinal` is this champion (`:1885-1888`), which
  closes their attack menu; and `RepackChest` when their inventory is open and a chest
  leaves the weapon hand (`:1906-1914`). Both read `UIState`
  (`attackingCharacterOrdinal`, the open inventory), which `Game` cannot see.
- `Game.setChampionHand` — a slot write plus `AdjustStatsForItemCarried` (C32), and
  nothing else. It is the add half of the two hand refills,
  which in CSBWin are `AddCharacterPossession(chIdx, RemoveCharacterPossession(…), hand)`
  (`doc/CSBwin-src/Timer.cpp:2663`, `CSBCode.cpp:6263-6270` through `TAG011594`), so a
  torch refilled from the quiver is not lit and a scroll is not opened.
- `ui/Character.setChampionPossession` (the inventory click, `Mouse.ts`) — adds and takes
  off the Illumulet's `Word1074[2]` and lights or puts out a torch, but sets no
  `value(1)` / `value(0)` on an Illumulet or Jewel Symal (so a worn one never shows its
  `_b` name), opens and closes no scroll, and does not call `TAG01b1c0`. It lights any
  torch by `GetBasicObjectType`; CSBWin's add tests `NameIndex == Torch_a`, an unlit one
  (`:1988`). It does call `AdjustStatsForItemCarried` since C32.
- `DsaSystem.setChampionPossession` — the Illumulet's brightness and, since C32,
  `AdjustStatsForItemCarried`; no torch, no `value()`, no scroll.
- The Hall of Champions recruit (`Game.collectMirrorPossessions`) — a fifth: CSBWin places
  each mirror object with `AddCharacterPossession` (`Character.cpp:789`); the port writes
  the array in `assignAddCharacterPossessions` and, since C32, adds the stat bonuses. A
  recruit's Illumulet does not light the party and a torch is not lit.

Port `AddCharacterPossession` for the engine, route all five through the engine pair
(`AdjustStatsForItemCarried` then has one caller per direction again), and give the
engine a way to ask the UI to close the attack menu and repack the chest. Needs the
frames (the inventory click is UI). `tools/dump-item-bonuses.ts` section 4 already
drives four of the writers.

### C35 ⏳ A monster that throws nothing reports missile 0, not `RNnul`

Found paying D4. CSBWin's monster attack starts from `missile = RNnul` and stores
`attackParameters.missileType = missile.ConvertToInteger()`
(`doc/CSBwin-src/Monster.cpp:1041`, `:1076`), so a monster with no missile reports
0xffff. `MonsterAttack.chooseMissile`'s default returns 0. Nothing reads it today (0 is
not in `THROWABLE`, so no missile flies), but the parameters are what CSBWin copies to the
Monster Attack Filter (`:1129-1165`), which the port has not wired: once it is, a DSA
filter would see 0 where CSBWin shows `RNnul`. Return `OBJECT_ID_NULL`, with a check that
reads the parameters of a monster that throws nothing.

### C36 ⏳ `EnableCharacterAction` keeps the attack type, and frees only its own timer

Found paying E2 (moving it into `TimerSystem`). CSBWin's `EnableCharacterAction`
(`doc/CSBwin-src/Timer.cpp:2638`) ends with `pChar->attackType = -1` (`:2680`); the port's
never resets it, so `champion.attackType` keeps the last attack for good. The next
`EnableCharacterAction` — say after a spell's `DisableCharacterAction` — then zeroes
`attackStatModifier` again (harmless: it is already 0) and, if that last attack was a
shot and hand 0 (the one the arrow is nocked from) is empty, reloads the bow from the quiver, where CSBWin would
not. CSBWin also sets `busyTimer = -1` and clears `CHARFLAG_attackDisable`
unconditionally (`:2645-2646`); `TimerSystem.processActionDisableTimer` does both only when
the expiring timer is the champion's own `busyTimerIndex`. Reset `attackType` at the end,
and check whether a stale `TT_11` can reach the handler at all (CSBWin's `SetTimer`
de-duplication may make the guard dead) before deciding the second; a check that shoots,
casts, and reads the quiver after the cast.

### C37 ⏳ A door button or a touched wall does not make a tick due at once

Found paying E2 (moving `HandleClickInViewport`'s engine half into `MouseSystem`). CSBWin's
door button sets `d.clockTick = 1` before queueing the sound and the `TT_DOOR` timer
(`doc/CSBwin-src/Mouse.cpp:1078`), and `TouchWallF1` sets `d.clockTick = TouchWall(...)`
(`Mouse.cpp:788`), so a wall switch that fired makes a tick due on the next VBL. The
port's `handleDoorSwitchClick` and `handleWallClick` set neither, so the door starts
moving, and a switch's effects land, up to a tick later. Set `ctx.loop.clockTickSet` in
both, and prove it with a check that counts the frames from the click to the timer
firing.

---

## D — State representation

✅ Paid on 2026-09-24/25 (D1 in `114dbbe`, D2a-d in `865d704`..`d1b3f8f`, D3a-g in
`b988d0b`..`fe3ae24`, D4 in `8606715`, D5 in `468ebc6`, D6 in `27a5aae`). All six
entries, with their outcomes and the fixes found on the way, are in `doc/PLAN_ARCHIVE.md`
→ "Resolved debt" → "`DEBT.md` tier D".

---

## E — Architecture

### E1 ✅ A shared game context, and one set of tables

**What.** `Game`'s constructor (`src/engine/Game.ts:273-590`, about 320 lines) hands the
same five things — the dungeon, a party-state getter, a tick getter, `random`, the timer
queue — to seven subsystems, in three styles:

- positional arguments: `ActuatorSystem`, `DsaSystem`, `TimerSystem`, `MonsterSystem`,
  `MonsterDamage`, `MonsterPerception`, `MonsterAttack`;
- options objects: `MonsterAI`, `CharacterStats`, `AttackSystem`;
- injection after construction — `setTables` (seven classes), `setCharacterStats`,
  `setTeleportPartyHandler`, `monsterDamage.onItem16Freed = …` — needed only because of
  construction order.

The `queueSound` lambda is written out five times, the "activate monster" lambda twice.
Every new call between two systems becomes a new hook in this constructor, which is why
`Game.ts` changed in 36 of the last 77 commits.

The tables are grouped by first consumer, not by content. `TimerTables` has 20 fields and
almost none concern timers: monster descriptors, attack tables, clothing armour,
`byte20090`… `ActuatorTables` carries weights, `weaponDesc` and three *callbacks*
(`onAddCharacter`, `adjustSkillsFilter`, `playSound`). `DsaSystem` receives
`dsaTables ?? actuatorTables`. `main.ts` builds both.

**Fix.** CSBWin's equivalent is the global `d.`. Introduce one context object, created
first, holding the dungeon, the party, the clock, `random`, the timer queue, the sound
queue and a single read-only `GameTables`, and pass it to every subsystem. Callbacks leave
the table types. Before coding, write a short design note into this entry — the shape of
the context, and how cross-system calls (monster ↔ missile ↔ attack) reach each other
without setters — since E2 and E3 build on it.

**Evidence.** Behaviour-neutral: `npm test -- --frames`. The `tools/` construct `Game` too;
they keep working unchanged or are updated in the same commit.

**Design note** (written 2026-09-25, before any code; E2 and E3 build on it).

*The context.* One object, `GameContext` (`src/engine/GameContext.ts`), created first in
`Game`'s constructor and handed to every subsystem as its only constructor argument:

```ts
interface GameContext {
  readonly dungeon: DungeonState;   // the level data, CSBWin's dungeon half of `d.`
  readonly party: Party;            // `ctx.party.state` is always current; no getters
  readonly state: GameState;        // the object `Game.state` is: `state.tickCount` is `d.Time`
  readonly random: Random;
  readonly timers: TimerQueue;
  readonly sounds: SoundQueue;
  readonly tables: GameTables;      // read-only, see below
  readonly host: GameHost;          // what only the host can do: play a sample, trace,
                                    // tell the UI something (null-object by default)
  readonly systems: GameSystems;    // the subsystems themselves, see below
}
```

The `() => this.party.state` and `() => this.state.tickCount` lambdas exist only because
`Party.setState` replaces the state object and the clock is a number. Reading through
`ctx.party.state` and `ctx.state.tickCount` at call time makes them unnecessary.

*Reaching each other without setters.* CSBWin's functions call each other directly. The
port does the same through `ctx.systems`, whose fields (`actuators`, `dsa`, `timer`,
`monsters`, `monsterAI`, `monsterDamage`, `monsterAttack`, `monsterPerception`,
`characterStats`, `attack`, and after E2 the `Game` groups: magic, Hall of Champions,
character actions) are filled one by one as `Game` constructs them. No constructor may
call another system. Only a method may, and methods run after construction, so the
construction order stops mattering. `timer.moveObject` calls
`ctx.systems.monsters.moveMonster(…)`; `monsterAI` calls
`ctx.systems.monsterAttack.monsterAttacks(…)`. That retires `setTables`' callbacks,
`setCharacterStats`, `setTeleportPartyHandler`, `setObjectMover`, `onItem16Freed` and the
hook objects between subsystems (`TimerHooks`' `onDsaTimer*`, `damageMonster`,
`onMonsterAI`…; `MonsterSystemHooks`; `AttackSystem`'s `hooks`). The five `queueSound`
lambdas become `ctx.sounds.queueSound`. A call through the instance also keeps the tools'
interception working: `dump-missile-monster` replaces `monsterDamage.damageMonster` on the
instance, and a direct `ctx.systems.monsterDamage.damageMonster(…)` still finds the
replacement at call time. Only the calls that leave the engine stay callbacks, gathered in
one `GameHost` the host passes to `Game`: `playSound`, `trace`, and the engine→UI notices
(sleep, close the attack menu, repack the open chest, which C34 needs). No per-hook
setters.

*One set of tables.* `GameTables` replaces `ActuatorTables`, `TimerTables`, `DsaTables`
and the `tables:` slices of `MonsterSystem`, `MonsterAttack`, `CharacterStats` and
`AttackSystem`. It is grouped by content under CSBWin's names (`objDesc`, `monsterDesc`,
`weaponDesc`, the weights, the `graphic232` words, the attack tables, the sound table,
`dropOrder`…), and every field is required. One builder, `buildGameTables(graphics)` over
`extractObjectTables` and `extractUITables`, is used by `main.ts` and, through a
`tools/lib/` helper, by the 44 tools that build a `Game`. A tool then gets every table
instead of the subset it chose, so "throws if the table was not handed in" goes away. The
callbacks leave the table types (`onAddCharacter`, `adjustSkillsFilter`, `playSound`
become calls through `ctx.systems` / `ctx.host`), and so does `dsaTables ?? actuatorTables`.
`CHARDESC::Possession(slot)` becomes one free function next to `Champion`, not a context
member, since it needs nothing but the champion.

*Split* (each step behaviour-neutral, `npm test -- --frames` before and after):

| Step | What | Size |
| --- | --- | --- |
| E1a | `GameTables` and `buildGameTables`; `main.ts` and the 44 tools build `Game` through it; subsystems still take their old slices, cut from it | M |
| E1b | `GameContext` without `systems`: every subsystem takes `ctx`; the positional arguments, the options objects and the getter lambdas go | M |
| E1c | `ctx.systems`: the inter-system hooks and the five setters become direct calls | M |
| E1d | `GameHost`: `playSound`, `trace`, the engine→UI notices; the callbacks leave the tables | S |

*Also (found paying D2d):* `CHARDESC::Possession(slot)` is written out once per module —
`Game.getChampionPossession`, `CharacterStats.possession`, `MonsterAttack.possession`,
`AttackSystem`'s hook, `ui/Character.getChampionPossession` — each a one-line
`possessions[slot] ?? OBJECT_ID_NULL`. The context should carry the one reader.

**E1a ✅ (`5afe970`).** `src/engine/GameTables.ts`: one read-only `GameTables`, every
field required, grouped by content (objects, object descriptors, monsters, the dungeon,
the party, attacks and spells, sound). The tables the port had renamed carry CSBWin's
name (`byte1596`, not `roomTimerFunctions`; `byte1386`, `byte10340`, `uByte9672`,
`byte8946`, `sound1772`, `objDescWord4`); a struct array's fields keep the port's names.
`spells` joined it, so `setSpellDefinitions` is gone. `buildGameTables(graphics)` is the
one builder; `main.ts` uses it, and so do the 44 tools, through `tools/lib/game.ts`
(`newGame`, `gameTablesOf`, `stockGraphics`). `Game`'s constructor became
`(dungeonData, tables, options)`, `GameOptions` holding what leaves the engine
(`cursorFilter`, `messages`, `playSound`) and the tools' `timerHooks` / `monsterHooks`.
**No tool depended on a table it had left out**: every tool's full output was diffed
before and after, and the only differences were the five tools that vary from run to run
anyway (recorded as F4), plus the graphics loader's log lines in `dump-viewport-click`,
which now loads graphics. Evidence: `npm test -- --frames`.

**E1b ✅ (`a32d3d6`, `3c9d48f`, `9a49f22`, `eb10975`).** `src/engine/GameContext.ts`:
`GameContext` = `dungeon`, `party`, `state`, `random`, `footprints` (`d.PartyFootprints`,
not in the design note, but shared state that `MonsterPerception` took positionally),
`timers`, `sounds`, `tables`. `createGameContext(dungeonData, tables, playSound)` builds
it, and `Game` takes its members from it. Every subsystem's first argument is `ctx`. The
getter lambdas are gone (`() => this.party.state`, `() => this.state.tickCount`, the party
level, the experience multiplier, `monsterDesc()`), and so are the seven table slices
(`ActuatorTables`, `TimerTables`, `DsaTables`, `MonsterSystemTables`, `MonsterDamageTables`,
`MonsterAttackTables`, `AttackSystemTables`, `CharacterStatsTables`) and their `setTables`.
`d.Word11694` and `d.CurrentPalette` moved into `GameState` (`gameWon`,
`currentPalette`), with `Game` accessors, so the `isGameWon` / `getCurrentPalette` hooks
became reads of `ctx.state`. The `queueSound` hooks became `ctx.sounds.queueSound`, and
`nameIndex` became `nameIndexOf(ctx, rn)`. `ActuatorSystem`'s callbacks left its tables
for an `ActuatorHooks` given at construction, which retired its post-construction
`setTables` call. `SoundQueue` takes `(party, soundTable, play)`. Tools that stand a
subsystem up alone use `newContext(data, graphics, parts)`. Behaviour-neutral: every
deterministic tool's output byte-identical, frames identical, the author's three runtime
saves load and play (no `RUNTIME_SAVE_VERSION` change: `GameState` is not saved as such,
and `RuntimeSaveState`'s `gameWon` goes through the accessor). One tool had to change how
it worked: `dump-missile-door` rewrote `TimerSystem`'s private table bag through a cast,
and now builds its game over a copy of the tables with its own `doorCharacteristics`.

*What E1c inherits.* Still second constructor arguments, for `ctx.systems` to retire:
`DsaSystem(ctx, actuators)`, `TimerSystem(ctx, actuators, hooks)`,
`MonsterAI(ctx, { monsters, damage, perception, … })`,
`AttackSystem(ctx, { monsterDamage, monsterAttack, monsters, dsa, characterStats, hooks })`,
and the hook objects of `TimerSystem`, `MonsterSystem`, `MonsterDamage`, `MonsterAttack`,
`AttackSystem`, `MovementSystem`, `ActuatorSystem`. The setters too: `setCharacterStats`
(`MonsterAttack`, `AttackSystem`), `setTeleportPartyHandler`, `setObjectMover`,
`onItem16Freed`. Many hooks call `Game` methods (`enableCharacterAction`,
`registerChampionBones`, `applyMagicShield`, `addCharacter`…), which have no system of
their own until E2: decide in E1c whether they go through a `ctx.systems.game` for now or
stay hooks until E2 gives them a home. `Game.addCharacterTables` is a two-field slice
still cut from `GameTables` for `assignAddCharacterPossessions`. The `possession` hooks
(the one-line `CHARDESC::Possession`) are still written out per module.

*E1c decision (2026-09-25, before code): the hooks that call `Game` methods.* They go
through `ctx.systems.game`, not through hooks that wait for E2. Its type is
`GameMethods = Pick<Game, …>` (`src/engine/GameContext.ts`): the union names exactly the
`Game` methods a subsystem still calls, each made public for it. That list is E2's
worklist — E2 moves a group into its own system, the subsystems' `ctx.systems.game.x`
become `ctx.systems.<group>.x`, and the names leave the union; E2 is done when
`GameMethods` is gone. The alternative, keeping those hooks until E2, would leave two
mechanisms side by side and every hook written out twice more (declared, then wired in
`Game`'s constructor). A hook whose body adapted its arguments (`magicShield`'s champion
lookup, `applyLight`, `openWindow`, `activateMonster`, `onSpawnMonster`, `hitDoor`'s
clock…) moves into the calling subsystem, at the call site or as a private helper named
after the hook. What leaves the engine (`playSound`, `trace`, `cursorFilter`,
`messages`) stays as it is for E1d.

**E1c ✅ (`450fb25`, `bbbe5a4`, `e522db9`, `aa4e7d0`).** `GameContext.systems`
(`GameSystems`: `actuators`, `dsa`, `timer`, `monsters`, `monsterDamage`,
`monsterPerception`, `monsterAttack`, `monsterAI`, `characterStats`, `attack`, `movement`,
`game`), created empty by `createGameContext` and filled by `Game` at the end of its
constructor. Every subsystem takes `ctx` and nothing else but its E1d host hooks: the
second constructor arguments (`DsaSystem`'s and `TimerSystem`'s `actuators`, `MonsterAI`'s
and `AttackSystem`'s deps objects), the setters (`setCharacterStats` ×2,
`setTeleportPartyHandler`, `setObjectMover`, `onItem16Freed`) and the inter-system hooks of
`TimerSystem`, `MonsterSystem`, `MonsterDamage`, `MonsterAttack`, `MonsterAI`,
`AttackSystem`, `MovementSystem` and `ActuatorSystem` (`onAddCharacter`,
`adjustSkillsFilter`) are gone; `Game`'s constructor went from 233 lines to 49.
`GameMethods` names the 22 `Game` methods a subsystem still calls. Five hooks `Game` never
wired went with their dead branches, each now an explicit default with a pointer here:
`onTriggerMissileLauncher`, `MonsterDamage.monsterDeleteFilter` and
`MonsterAttack.attackFilter` (G2), `stealFromCharacter` (G10). Hook payload fields the real
method ignored (`timer` on the AI calls, the missile's position and direction on
`applyMissileDamageToParty`) went too, and with them `processMissileEncounter`'s unused
`direction`. `AttackSystem` reads `CHARDESC::Possession` itself. Behaviour-neutral: every
tool's full output byte-identical after each commit, but for `dump-save-menu`'s payload
size, which varies by one byte from run to run on its own (3 of 16 runs on an unchanged
tree); frames identical. Two tools that stand a subsystem up alone now fill
`ctx.systems`: `dump-local-action` (a real `DsaSystem`), `dump-monster-damage` (stand-ins
for the timer and actuator systems — its dead group is now lifted through
`MonsterSystem.moveMonster`, as in a `Game`, where the missing hook used to unlink it
bare; the output is unchanged).

*What E1d inherits.* The host hooks, one per subsystem: `TimerHooks.playSound`,
`ActuatorHooks` (`cursorFilter`, `messages`, `playSound`), and the `trace` of
`MonsterSystemHooks`, `MonsterDamageHooks`, `MonsterAiHooks`, `AttackSystemHooks`;
`GameOptions` (`cursorFilter`, `messages`, `playSound`, `monsterHooks`) and `Game`'s own
engine→UI callbacks (`sleepListeners`, `openReincarnateScreen`, the notices C34 needs).
`Game.addCharacterTables` and the per-module `possession` readers are unchanged.

**E1d ✅ (`e2513c2`).** `src/engine/GameHost.ts`: `GameHost` = `playSound`, `trace`,
`cursorFilter`, `messages`, `sleepChanged`, `openReincarnateScreen`, every member
required. `createGameHost(partial)` fills what the host leaves out (or leaves `undefined`,
as `main.ts` does with no audio) with a null object — a cursor filter that lets everything
through, a message sink that drops everything — so no caller asks whether anyone is
listening. It sits at `ctx.host`; `Game`'s constructor is `(dungeonData, tables, host)`,
and `newGame(data, graphics, host)` in `tools/lib/game.ts`. Gone: `GameOptions`,
`ActuatorHooks`, `TimerHooks`, the four `trace` hook types (`MonsterSystemHooks`,
`MonsterDamageHooks`, `MonsterAiHooks`, `AttackSystemHooks`), `ActuatorSystem.getMessages`,
`Game.onSleepChanged` and its listener list, the assignable `Game.openReincarnateScreen`.
`SoundQueue` takes the host. Every subsystem now takes `ctx` and nothing else.
`dump-monster-ai` passes its trace as the host's; `dump-sleep` and `dump-hall-of-champions`
pass `sleepChanged` / `openReincarnateScreen` at construction instead of registering them
after it. Behaviour-neutral: every tool's full output byte-identical, frames identical. The
"notices C34 needs" (close the attack menu, repack the open chest) are not added: C34 adds
them to `GameHost` when it needs them. Still unchanged: `Game.addCharacterTables`, and the
per-module `possession` readers (`MagicSystem` and `CharacterSystem` read
`champion.possessions[slot] ?? OBJECT_ID_NULL` inline rather than add a sixth).

### E2 ⚠️ Split `Game.ts` by CSBWin source file

`Game.ts` is 3018 lines (2172 after the first six commits below, 1364 after the next five). Split it by CSBWin source file, as `src/renderer/ui/` already is
(`doc/UI_MODULE_MAP.md`). Method groups (lines as of 2026-09-23):

| Group | Methods | CSBWin |
| --- | --- | --- |
| Hall of Champions | `addChampion`, `addCharacter`, `resurrectReincarnateCancel`, `finishResurrectReincarnate`, `reincarnateNamed`, `reincarnate`, the mirror helpers, `registerChampionBones` (≈ `:820-1290`) | `AddCharacter` `Character.cpp:456`, `_ResurrectReincarnateCancel` `CSBCode.cpp:6616`, `_ReIncarnate` `Code13ea4.cpp` |
| Periodic updates | `processNinetySecondUpdate`, `processTenSecondUpdate` (≈ `:1397-1580`) | `NinetySecondUpdate` `CSBCode.cpp:7339`, `TenSecondUpdate` `Code17818.cpp:160` |
| Magic | `castMagic`, `fillSpellParameters`, `castSpell`, `incantationToSpell`, … `applyMagicShield` (≈ `:1591-1970`), `characterThrowsSpell` (`:2078`), the spell messages (≈ `:2265-2352`), `castSpellFromUi` | `CastSpell` `Magic.cpp:1090` and its neighbours |
| Cursor drop and throw | `dropObjectFromCursor`, `maybeScheduleViAltar`, `throwObjectFromCursor`, `throwStaminaCost`, `awardThrowSkill` (≈ `:2487-2760`) | `DropObject` `Mouse.cpp:848`, `ThrowByCharacter` `Mouse.cpp:673` |
| Quick-save | `RuntimeSaveState` (≈ `:95-172`), `getRuntimeSaveState`, `applyRuntimeSaveState`, the timer (de)serialisers (≈ `:2757-3017`) | none — the port's own quick-save |
| Character actions | `disableCharacterAction`, `enableCharacterAction`, `setBusyTimerRefill`, `refillPossessionSlot`, `matchingAmmunition`, `removeCharacterPossession` (≈ `:2005-2245`) | find their CSBWin home before moving them |

Leave `Game` as the loop, the construction, and a thin public facade. One group per commit.
Do E1 first.

**Progress (2026-09-25).** The rule applied is the one in the title: a method goes to the
system that ports its CSBWin file, even where the table above grouped it by topic
(`MagicShield` is `Attack.cpp`'s, `DisableCharacterAction` and `AdjustSkills` are
`Magic.cpp`'s). A `Game` method that only adapted a call for one caller moves into that
caller. Each commit behaviour-neutral: every tool's full output byte-identical (but for
`dump-save-menu`'s known one-byte wobble), frames identical.

| Commit | Group | Left `GameMethods` |
| --- | --- | --- |
| `659fcb6` | `MagicSystem` (`src/engine/MagicSystem.ts`, `ctx.systems.magic`, `game.magic`): `CastMagic`, `CastSpell` and its helpers, `SpellErrorMsg`, `StandardSpellMessage`, `CharacterThrowsSpell`, `LaunchObject`, `DisableCharacterAction`, `SetBrightnessTimer`, `AdjustSkills` bound to the context (`applySpellSkillGain`), `queueUtilityTimer`. `Game.castSpellFromUi` is a one-line facade for `main.ts`. | `applySpellSkillGain`, `characterThrowsSpell`, `disableCharacterAction`, `emitSpellMessage`, `launchObject`, `queueUtilityTimer`, `setBrightnessTimer` |
| `1e2fa18` | `Attack.cpp` into `AttackSystem`: `MagicShield` (`applyMagicShield`), and `d.Brightness += delta` inline. `Game.setBrightness`, which nothing called, is gone. | `applyMagicShield`, `adjustBrightness` |
| `1529b4b` | `CharacterSystem` (`src/engine/CharacterSystem.ts`, `ctx.systems.character`, `game.character`): `RemoveCharacterPossession`, `DropAllPossessions`, `setChampionHand` (the stat half of `AddCharacterPossession`), `AdjustStatsForItemCarried` bound to the context, `setPossessionDirect`. This is the one possession home C34 waits for. `setChampionHand` had joined `GameMethods` for one commit, for `MagicSystem`'s Zokathra. | `dropAllPossessions`, `removeCharacterPossession`, `setChampionHand` |
| `7ee7b57` | `KillCharacter`'s tail into `MonsterAttack.killCharacter`: the bones record and the inventory close, at the call sites. | `registerChampionBones`, `onChampionDied` |
| `3abb4b3` | `ProcessMissileEncounter`'s party arm into `TimerSystem` (private `applyMissileDamageToParty`, with `MISSILE_WOUND_MASK`). | `applyMissileDamageToParty` |
| `9b70f20` | The loop's state onto the context (the decision below): `MouseQueue` at `ctx.mouseQueue`, `LoopFlags` at `ctx.loop`, `wakeUp(ctx)` (`LoopState.ts`), `MonsterSystem.loadPartyLevelOnArrival`. `Game.wakeUp` is a facade for `main.ts`. | `wakeUp` |
| `a5c04bd` | `climbDownIntoPit` into `AttackSystem` (private), `handleDsaTeleportParty` into `DsaSystem` (private `teleportParty`, `STKOP_TeleportParty`), `notePartyMoved` into `TimerSystem`. | `climbDownIntoPit`, `handleDsaTeleportParty`, `notePartyMoved` |
| `a72da7f` | `EnableCharacterAction` into `TimerSystem` (private; the `TT_11` case now calls it and `TAG0115ee` apart, as `CSBCode.cpp:6466-6475` does); `matchingAmmunition` (`TAG0153c2`, `Character.cpp:1521` — the old comment said `CSBCode.cpp`) and `refillPossessionSlot` (`TAG0115ee`) into `CharacterSystem`, beside the possession pair C34 rewrites; `setBusyTimerRefill` into its one caller, `AttackSystem`. C36 recorded. | `enableCharacterAction`, `setBusyTimerRefill` |
| `fa6a67e` | `MouseSystem` (`src/engine/MouseSystem.ts`, `ctx.systems.mouse`, `game.mouse`): `DropObject` with its Vi-altar arm, `ThrowObjectInHand`, `throwFromWeaponHand`, `ThrowByCharacter`, `TAG016382`. `awardThrowSkill` went: it was `MagicSystem.applySpellSkillGain(chIdx, 10, …)` line for line. `Game.applyLimits` went for `core/intCast`'s (same result on these clamped ranges). `Game.dropObjectFromCursor` / `throwObjectFromCursor` are facades for `events.ts` and `tools/`. | `throwFromWeaponHand` |
| `6883775` | `HallOfChampions` (`src/engine/HallOfChampions.ts`, `ctx.systems.hallOfChampions`, `game.hallOfChampions`): `AddCharacter`, `_ResurrectReincarnateCancel` and its finish, `ReIncarnate`'s tail, the mirror helpers, `getObjectRecord`, `reincarnationSource`, `addCharacterTables`. One system, not `CharacterSystem`: the three CSBWin files share `reincarnateAttributePenalty` / `reincarnateStatPenalty` (`Character.cpp:14`), and two of them have no other port. `Game.resurrectReincarnateCancel` / `reincarnateNamed` are facades for `main.ts`. `GameMethods` and `ctx.systems.game` are gone. | `addCharacter` — none left |

Every one byte-identical on every tool's full output, frames identical, and the author's
three runtime saves hash the same after load and after 600 ticks as on `bf5c700`.

*What was left at `GameMethods` = 8 names* (kept for the reasoning behind the moves above):

- `addCharacter` (`Character.cpp:456`) — the Hall of Champions group; `AddCharacter` into
  `CharacterSystem`, or one `HallOfChampions` — decided for the second (`6883775`).
- `enableCharacterAction` (`Timer.cpp:2638`) with `refillPossessionSlot` and
  `matchingAmmunition`, and `setBusyTimerRefill` (the port's own helper for the throw's
  `uByte6`).
- `throwFromWeaponHand` — the "Cursor drop and throw" group (`Mouse.cpp`).
- `climbDownIntoPit` (`Attack.cpp:2033`), `handleDsaTeleportParty` (the DSA's party
  teleport), `notePartyMoved` (the footprint step of the world `MoveObject`,
  `Code11f52.cpp:3222`) and `wakeUp` (`CSBCode.cpp:7047`). These four touch `Game`'s
  loop state — `loadPartyLevelIfChanged`, `clockTickSet`, the mouse queue
  (`discardAllInput`) — which `Game` keeps as "the loop".

*Decision: how a system reaches the loop's state (2026-09-25).* In CSBWin all three are
`d.` globals that files other than the main loop write: `WakeUp` sets `d.clockTick = 1`
(`CSBCode.cpp:7050`), an inhibited `MoveParty` clears it (`:8313`), the world `MoveObject`
sets `d.newPartyLevel` (`Code11f52.cpp:3323`), and `DiscardAllInput` (`CSBCode.cpp:7532`)
resets `d.MouseQStart` / `d.MouseQEnd` for whoever calls it. So they move out of `Game`
into the context, as every other `d.` field did in E1 — and **not into `GameState`**:
`SaveGame.cpp` names neither `d.clockTick` nor `d.newPartyLevel`, the port's quick-save
carries none of the three today, and `GameState` is what the quick-save writes, so
putting them there would change the save's shape for state the next tick settles anyway.

- `ctx.mouseQueue` — a `MouseQueue` (`src/engine/MouseQueue.ts`): the ring
  (`pMouseQueue`, `MouseQStart`, `MouseQEnd`, `MOUSEQLEN`), its three writers (a key, a
  click, the button-up), `numEnt`, `DiscardAllInput`, and the head `HandleMouseEvents`
  takes. `HandleMouseEvents` itself stays in `Game`: it is the loop's consumer, and it
  calls `Game.move`.
- `ctx.loop` — a `LoopFlags` (`src/engine/LoopState.ts`): `clockTickSet` /
  `clockTickCleared` (the two ways a caller overrides the VBL's `d.clockTick`) and
  `newPartyLevel` (a level change whose `DiscardAllInput` the next tick owes). `Game`
  reads and clears them in `runFrame` / `gameTick`, as it does now.
- `WakeUp` becomes `wakeUp(ctx)` in the same module: with the flags and the queue on
  the context it needs nothing of `Game`, and its callers are `Monster.cpp:4531`'s and
  `DamageCharacter`'s blow (`MonsterAttack`) and button 146 (`Game.wakeUp`, a facade for
  `main.ts`). `Sleep` (button 145, `Mouse.cpp:1683`) has only the UI calling it and stays.
- The port's early level load (`loadPartyLevelIfChanged`: `LoadPartyLevel` at once, the
  discard owed to the next tick) becomes `MonsterSystem.loadPartyLevelOnArrival()`, beside
  `loadPartyLevel`, setting `ctx.loop.newPartyLevel`. The bare
  `MonsterSystem.loadPartyLevelIfChanged` keeps its other callers, which owe no discard.
  `tag0006a4` (`loadNewPartyLevel`) stays in `Game`: it is the tick.

Then the four go by file: `climbDownIntoPit` into `AttackSystem` (its one caller,
`atk_CLIMBDOWN`), `handleDsaTeleportParty` into `DsaSystem` (`STKOP_TeleportParty`,
`DSA.cpp:4583`, its one caller), `notePartyMoved` into `TimerSystem` beside the world
`MoveObject` it is a step of (E3 will carry it on with the world moves).

*What is left (2026-09-25): `Game` less the loop.* No system calls `Game` any more, so
what remains is found by reading `Game.ts`, not a type. E2 is done when `Game` is the loop
(`runFrame`, `gameTick`, `tag0006a4`, `HandleMouseEvents` and the queue's front door), the
construction, and one-line facades. By group, largest first — confirm each CSBWin home
before moving, and decide the two open questions first:

- **Quick-save** (≈ 340 lines with the `RuntimeSaveState` type): `getRuntimeSaveState`,
  `applyRuntimeSaveState`, `buildTimerRecords`, `restoreTimerQueue`. No CSBWin home — the
  port's own format. A `RuntimeSave.ts` module over the context, which is what E5 (the
  hand-maintained snapshot) then works on. `setPartyState` and `setRandomSeed` go with it
  if they are only its and the tools'.
- **Periodic updates** (≈ 180 lines): `processNinetySecondUpdate` (`NinetySecondUpdate`,
  `CSBCode.cpp:7339`) and `processTenSecondUpdate` (`TenSecondUpdate`,
  `Code17818.cpp:160`). *Open:* `CSBCode.cpp` is the loop's own file, so
  `NinetySecondUpdate` may rightly stay; `TenSecondUpdate` has no system. One small
  module for both, called from `gameTick`, is the likely answer.
- **The attack's engine half**: `championAttack` and `attackStatModifier` (`_ExecuteAttack`,
  `Character.cpp:4944`, which records `attackType` and `word64` around `Attack`), and
  `consumeAttackDamageToDisplay` — `AttackSystem` already owns `attackDamageToDisplay`.
  *Open:* `Character.cpp` says `CharacterSystem`; the body is all `AttackSystem`'s state.
- **The rest of `Mouse.cpp`**: `handleDoorSwitchClick` (the door button), `handleWallClick`,
  `sleep` (button 145, `Mouse.cpp:1683`) — into `MouseSystem`; `sleep` could instead sit
  beside `wakeUp` in `LoopState.ts`.
- **Feeding**: `applyFeeding` (the apply half of `_FeedCharacter`, `Character.cpp:4004`; the code cites `:4348`),
  which only binds `MonsterAttack` and `TimerSystem` calls into `Feeding.ts` — with a
  context those bindings can go into `Feeding.ts` itself.
- **`MoveParty`'s tail**: `move`, `triggerObjectMove`, `setPartyMoveDelay`
  (`MoveParty`, `CSBCode.cpp:7944`; its tail `:8310-8349`). `HandleMouseEvents` calls `move`, so this may be loop; if
  not, `MovementSystem`.
- Small change: `addChampion` (the tools' join; `HallOfChampions` or stays),
  `getChampionPossession`, `getBaseObjectNameIndex`, `nameIndex` (go with their callers).

*Decisions (2026-09-26), taken before the code moved:*

- **The periodic updates** go to one module of two functions over the context,
  `src/engine/PeriodicUpdates.ts` (`ninetySecondUpdate(ctx)`, `tenSecondUpdate(ctx)`),
  as `wakeUp(ctx)` did. `CSBCode.cpp` is the loop's file, but it is also `MoveParty`'s,
  `WakeUp`'s and a hundred other functions'; being in it does not make a function the
  loop. `Code17818.cpp`'s other port, `DetermineMastery`, is `skills.ts`, a table module
  the update should not be folded into. Neither update has state of its own, so no class.
  The cadence tests (`(d.Time & 511) == 0`, `d.Time & (d.PartySleeping ? 15 : 63)`)
  are the loop's (`CSBCode.cpp:680-688`) and move out of the bodies into `gameTick`,
  where CSBWin has them — as two predicates the module exports, `isNinetySecondTick` /
  `isTenSecondTick`, so that the cadence tools test the tick's own test;
  `d.NumCharacter == 0` stays in `TenSecondUpdate` (`Code17818.cpp:174`).
- **`_ExecuteAttack`'s engine half** (`championAttack`, `attackStatModifier`) goes to
  `CharacterSystem` as `executeAttack`, by the file rule: it is `Character.cpp:4944`, it
  writes two `CHARDESC` fields (`word64`, `attackType`) and makes one call into
  `AttackSystem`. `HallOfChampions` was the one exception to the rule, for shared tables;
  there is no such reason here. `consumeAttackDamageToDisplay` goes to `AttackSystem`,
  which owns `d.attackDamageToDisplay`.
- **`MoveParty`'s tail** (`move`, `setPartyMoveDelay`) goes to `MovementSystem`, which
  already ports `MoveParty`'s head (the collision, the stamina): one CSBWin function, one
  home, as `MovementSystem.moveParty`. `HandleMouseEvents` calling it does not make it
  the loop — `Mouse.cpp` calls `CSBCode.cpp` there too. `Game.move` keeps the move
  listeners (`onMove`) and is otherwise a facade.
- **`triggerObjectMove`** (the UI's pick-up from the floor, `ViewportPicking`), with
  `handleDoorSwitchClick` and `handleWallClick`, is `HandleClickInViewport`
  (`Mouse.cpp:1031`: the door switch at `:1060-1086`, `TouchWallF1` at `:1127`, the
  pick-up `TAG01a148` at `:1132`), so all three go to `MouseSystem`. So does `sleep`
  (button 145, `Mouse.cpp:1683`), by the same rule — `WakeUp` is `CSBCode.cpp`'s, which is
  why it sits in `LoopState.ts` and `Sleep` does not join it.
- **The quick-save** becomes `src/engine/RuntimeSave.ts`: `RUNTIME_SAVE_VERSION`, the
  `RuntimeSaveState` type, and `getRuntimeSaveState(ctx)` / `applyRuntimeSaveState(ctx,
  save)` with the timer (de)serialisers. `Game` keeps a facade for each, because loading
  owes one thing to the loop: `HandleMouseEvents`' `lastTime = 0` (`SaveGame.cpp:1661`),
  which is `Game`'s own static. `setPartyState` and `setRandomSeed` stay as facades (the
  map preview and the tools).

### E3 ⏳ Split `TimerSystem.ts`

`TimerSystem.ts` is 3323 lines, and it is half the world. Besides the `ProcessTimers`
dispatch and the small per-type handlers (doors, pits, light, shields, poison…) it holds:

| Group | Methods (start line, 2026-09-23) | CSBWin |
| --- | --- | --- |
| Missiles | `launchMissile` 1049, `launchMonsterMissile` 1080, `launchThrownMissile` 1109, `throwMissile` 1134, `throwObjectFromHand` 1185, `createMissileRecord` 1362, `triggerMissileLauncher` 1539, `processMissileTimer` 1643, `checkMoveFromMissile` 1830, `processMissileEncounter` 1952 … `finishMissileEncounter` 2211, `playMissileImpactSound` 2558, `dropMissileObject` 2705, the `word8` codec 2723-2743 | `ProcessMissileEncounter` `Code11f52.cpp:1711`; the missile timer in `Timer.cpp` |
| Clouds | `createDeathCloud` 2256, `createFluxcage` 2267, `createCloud` 2312, `processTT_25` 2388, `createCloudRecord` 2529, `playCloudSound` 2581 | `CreateCloud` `Code11f52.cpp:1376`, `ProcessTT_25` `Timer.cpp:436` |
| Door and magic damage | `hitDoor` 2509, `determineMagicDamage` 2621 | `HitDoor` `Code11f52.cpp:2263`, `DetermineMagicDamage` `Code11f52.cpp:1557` |
| Wiggle | `wiggleEverything` 2744, `wiggleParty` 2768, `wiggleMonster` 2910, `wiggleObject` 2930 | `WiggleEverything` `Timer.cpp:2428` |
| World moves | `resolvePartyMove` 2784 … `resolveMonsterDestination` 2828, `resolveCellEffects` 2970, the teleporter and pit helpers to ≈ 3300 | the world `MoveObject`, `Code11f52.cpp:2796` — **not** `MoveObject.cpp:721`, which is the DSA's ten-argument `MoveObject`, ported as `DsaSystem.moveObjectDsa` |
| Vi altar | `scheduleViAltar` 1211 … `bringCharacterToLife` 1341 | `ProcessTT_ViAltar` in `Timer.cpp` |
| Generators | `spawnMonsterGenerator` 1460, `processReactivateGenerator` 1514 | — |

`MonsterSystem` reaches the world-move logic through `TimerSystem` hooks
(`resolveMonsterDestination`, `checkMonsterMoveFromMissile`); after the split those point
at the new modules. Do E1 first, and C2 before moving the missile code.

### E4 ⏳ `ViewportRenderer` has become the UI host; `main.ts`'s `init()`

Phase 14 cut `ViewportRenderer.ts` from 3809 lines to 723. It is back to 999, and changed in
28 of the last 77 commits. It no longer renders only the viewport: it owns the mouse queue,
the save menu, the reincarnate screen and the overlay refresh. It also has twelve handler
setters that `main.ts` calls one by one: `setCharacterStats`, `setPlaySound`,
`setViewingFilter`, `setObjectMoveHandler`, `setSpellCastHandler`, `setFeedingHandler`,
`setResurrectReincarnateCancelHandler`, `setChampionAttackHandler`, `setSaveHandlers`,
`setPaletteSelectedHandler`, `setReincarnateNamedHandler`, `setBootFrameRenderer`.

Keep the viewport composition (`drawViewportFrame` and its helpers) in a class that
deserves the name, move the screen and UI hosting into one named for what it is, and take
the handlers as one object at construction. `main.ts`'s `init()`
(`src/main.ts:173-465`, about 290 lines) wants the same treatment: load, construct, wire and
start as separate functions. Evidence: `npm test -- --frames`.

### E5 ⚠️ The quick-save snapshot is hand-maintained

The column-index bug showed how that fails. `DungeonSnapshot` enumerates what play can
change, and it omitted `data.columnIndex` on the reasoning — written into the file as a
comment — that it was structural. It is not: `DungeonState.addObjectToCell` /
`removeObjectFromCell` rewrite it whenever a cell gains or loses its last object, as CSBWin
does (`doc/CSBwin-src/CSBCode.cpp:5211-5224`). `columnIndex`, `header.objectListSize` and
`header.objectCounts` are captured now, and `tools/dump-savegame.ts` compares the whole
mutable `DungeonData` and asserts that loading twice with play in between gives the same
world. But the list is still a list: any field added to `DungeonData` later has to be
remembered there by hand. Derive it from the type, or snapshot the whole structure and
subtract what is immutable. Pairs naturally with Phase 10's remaining save work.

<sub>Context: `doc/PROVEN_FACTS.md` → “The column index is saved state, not dungeon structure”.</sub>

---

## F — Verification debt

### F1 ⏳ Sweep for empty placeholder tables

The eye panel's mastery ranks vanished because a table was initialised empty and read
through a `continue`-on-falsy guard, which produced no warning and no marker. Other tables
may be hiding the same way: sweep for arrays and tables initialised empty and read through
such a guard.

Known candidate: `DEFAULT_ROOM_TIMER_FUNCTIONS` (`src/engine/roomTimers.ts`), a hardcoded
copy of `d.Byte1596` used when the extracted table is not wired. Find out whether any
path still reaches it; if not, delete it.

Second candidate, found in C5: `MonsterAttack.determineAttackOrder` returns `[0, 1, 2, 3]`
when `byte586` was not passed in, with no warning. `tools/dump-party-collision.ts` hit it
(its wall bump hurt the wrong champion) until the tool passed the table; other tools that
build a `Game` without `byte586` still would.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “The eye panel prints the mastery ranks again”.</sub>

### F2 ⏳ No golden frame covers an edge decoration

That is why the position-7 wall-decoration bug survived so long.
`tools/dump-hall-of-champions.ts` pins the geometry that makes position 7 special across
all 8 rect sets — both edge slots narrower than the bitmap, the front-left window ending
flush with its right edge, the front-right starting flush with its left. The pixels
themselves are still verified only by screenshot. Another frame needs a way to place the
party, which the probe does not have. That is the same missing affordance as Phase 15 step
2's "fixed set of party positions" (`PLAN.md`), so build it once for both.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “A wall decoration one cell ahead and to the left is no longer…”.</sub>

### F4 ✅ Four suite tools draw from an unseeded stream

**Paid in `dccb6a9`.** `dump-monster-ai`, `dump-throwing` and `watch-monsters` call
`game.setRandomSeed(0x12345678)`; `dump-attributes` built no `Game` at all — its `levelUp`
calls fell back to a fresh unseeded `CsbRandom` each — and now shares one seeded stream.
Each gives the same output on every run, and each still exercises what it asserts
(`dump-attributes` sees six raises, 45 checks; `watch-monsters` 16 groups move).
`dump-save-menu` still varies, by the save date. Found on the way, and left: `levelUp`'s
`random` is optional and falls back to an unseeded stream, the F1 shape.


*(Found paying E1a, 2026-09-25, by diffing every tool's output before and after.)*
`dump-attributes`, `dump-monster-ai`, `dump-throwing` (its `Game`; its `CharacterStats`
is seeded) and `watch-monsters` build a `Game` without `setRandomSeed`, so their output
changes from run to run: `dump-attributes` even runs 47, 49 or 51 checks. They pass
because their assertions hold for any seed, but a run cannot be compared with the last one,
which is what a refactor needs. (`dump-save-menu` varies too, by a byte of payload size;
that is the save date, not the random stream.) Fix: seed each, as the skill says
(`game.setRandomSeed(0x12345678)`), then check the assertions still bite.

### F3 — Phase 15 steps 3–5 stay in `PLAN.md`

The render probe, the table-extraction round-trip checks and the comparison against CSBWin
screenshots are a live phase, so they stay in `PLAN.md` → "Phase 15" rather than being
copied here. The never-executed validation steps of phases 2, 4, 5 and 7 are all folded into
it.

---

## G — Unported CSBWin features

### G1 ⏳ DSA gaps

- **Opcodes.** Unimplemented DSA opcodes and `&` subcodes are reported once each through
  `warnedOps` (`src/engine/DsaSystem.ts:1275`, `:1884`), and slave DSAs are not
  implemented (`:1921`). The old pointer to "the TODOs in `DsaSystem.ts`" was stale; these
  warnings are what there is.
- **`STKOP_Throw`** (`DSA.cpp:4558`) is one of them, so `TimerSystem.throwMissile`
  (`ThrowMissile`, `Timer.cpp:2016`) has no caller. When the opcode is ported, re-port the
  function's missile-type switch first: CSBWin throws a spell only for the eight words
  it lists (`RNFireball` … `RNPoisonCloud`, `RNMonsterDeath`) and nothing for any other
  non-zero word (`Timer.cpp:2029-2040`), where the port takes every word `>= 0xff80` as-is
  and maps the rest through `spellObjectId`. CSBWin also `LoadLevel`s the launch level
  around the launch (`:2065-2077`). Found in B3.
- **`STKOP_SetCurse`** (`DSA.cpp:3440-3456`) is another. It calls `SetCursed`
  (`Character.cpp:1782-1816`), which finds the champion carrying the object and brackets
  the curse change with `AdjustStatsForItemCarried(…, -1, …)` and `(…, +1, …)`, so a
  curse laid on a carried weapon costs 3 Luck at once. Port both together. Found in C32.
- **Decoration gating and footprints** *(Phase 4)*. DSA-based decoration gating and
  footprints / extended cell flags are not ported (`src/renderer/csbwin/SummarizeRoomInfo.ts:515`).
  Wall and floor decoration selection follows `TAG00a4a2` plus the actuator's
  `wallGraphicOrdinal` for stone and open rooms.

### G2 ⏳ Four DSA filters

No dungeon we load defines any of them, so none could be verified if written:
`ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`, Phase 13 step 1),
`ESL_FEEDINGFILTER` (`:4288-4344`, step 5, with the insertion point already marked in
`handleMouthPress`), and `PortraitTranslateDisable`'s `QueueDSASwitchAction`
(`CSBCode.cpp:6540-6612`, step 4). The last one only fires on a `DisableMessage` that the
shipped dungeon never carries.

The fourth is `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`), found paying C24: it
counts each kill in `expool`'s statistics and, when the dungeon has an
`ESL_DELETEMONSTERFILTER`, runs its type-47 DSA, which may set `deathCloud` and
`dropResidue`. Neither `MonsterDamage` (which had an unwired hook until E1c) nor
`MoveObject`'s two deletions (`:3147-3176`, `:3298-3308`) call it; all use the
defaults. `MonsterDamage`'s `DMW_DAMAGE` is 0 where CSBWin's `DMW_Damage` is 3
(`CSB.h:2922`); `DMW_Movement1` is 4, `DMW_Movement2` 5.

A fifth, found in E1c: `MonsterAttackFilter`, the DSA that may rewrite a monster
attack's whole parameter block. `MonsterAttack.monsterAttacks` had an `attackFilter` hook
for it that nothing wired; it now uses the block as built.

### G3 ⏳ The wings

CSBWin keeps champions who have left the party in a store that
`CHARDESC::GetFromWings` / `SaveToWings` reach (`doc/CSBwin-src/Character.cpp:5239`). Two
things consult it and cannot here:

- `CopyCharacter`, so bones dropped by a departed champion take no name (Phase 13 step 2);
- `ProcessTT_ViAltar` state 1, which heals such a champion to `MaxHP/2` and saves them back
  (`Timer.cpp:2769-2782`, step 3).

`Party.findChampionByFingerprint` is the one place where both would grow their second
half. It is a feature to build, not a branch to port: nothing in the port ever removes a
living champion from the party.

### G4 ⏳ CSB extensions and malformed heroes

Phase 13 step 4:

- `pcA3->talents`, which `Champion` has no field for;
- the `legalHero` fallback (`Character.cpp:475`), which clamps an out-of-range hero text
  and retries it against "BOGUS / ILLEGAL HERO", where `HeroExtractor` rejects it
  outright;
- external portraits for `charID > 23`.

No shipped DM hero touches any of them.

**The monster design options** *(found in C7)*. `DB4::invisible()` is gated on
`invisibleMonsters`, and `drawAsSize4()`, `Unique()` and `Poisoned()` on
`drawAsSize4Monsters` (`CSB.h:1125-1132`), both read from a save's `extendedFlags`
(`SaveGame.cpp:394-400`, `false` by default). The port models neither: `CreatureRecord`
holds the raw bits, and `monster.drawAsSize4` is read ungated in
`TimerSystem.processMissileEncounter` and `MonsterDamage` (`:555`, `:591`). Only
`MonsterSystem.monsterUnique` applies a gate, as a constant `false`. Harmless for now:
no creature in `dm-atari/dungeon.dat` sets any of bits 11-14. Modelling it means reading
`extendedFlags & 0x02` / `& 0x04` in `SaveGameLoader` and gating every accessor.

### G5 ⏳ Messages and freeze

From Phase 11:

- The pixel-level scroll animation (`d.PushTextUp` / `d.TextScanlineScrollCount`) is not
  implemented. Rows scroll instantly, and CSBWin's wait-for-animation guards are absent.
  With it goes `scrollingText.SetNewSpeed`, which sleep and `WakeUp` call to re-pace that
  animation (`doc/CSBwin-src/Mouse.cpp:1696`, `CSBCode.cpp:7053`).
- `SCROLLING_TEXT::Serialize` — message state in save games
  (`doc/CSBwin-src/Data.h:1666`). Quick-load calls `discardText()` instead.
- Sleep is ported (`Game.sleep` / `Game.wakeUp`, `tools/dump-sleep.ts`, 2026-09-24).
  The freeze is not (found paying C21):
  - 147 freezes, 148 thaws (`doc/CSBwin-src/Mouse.cpp:1731-1773`);
  - nor has the frozen game's filter on the queue, which throws away every entry but 148
    (`:1433-1444`);
  - nor the keys that reach them: Esc is 147 in the sleep-mode table `Byte18440` and 148
    in the frozen one `Byte18448` (graphics.dat `0x231`). Asleep, the port swallows Esc.

  `UIMode.Frozen` is never entered.

Also found porting sleep: `tools/probe-ui.mjs --boot` still presses F8 for a random dev
party, a key that no longer exists, so it boots with an empty party.
`tools/probe-frames.mjs` builds its party at the Hall of Champions instead; `--boot` should too.

### G6 ⏳ UI effects

- **Rune click flash** in the magic panel (Phase 7).
- **Interaction highlights** — button press and selection effects (flash, shading, invert)
  across UI regions, consistent with the hit-test rectangles (Phase 7).
- **`FlashButton`** on a movement arrow that was clicked or keyed: `MoveParty` returns
  the button and `HandleMouseEvents` flashes it (`doc/CSBwin-src/Mouse.cpp:1560-1567`).
  Found paying C21.
- **The viewport flash on a blow**, and a light-level trace hook (Phase 7.5). `atk_LIGHT`
  itself works; this is the flash, not the LIGHT attack.

### G7 ⚠️ Save-game fidelity gaps

From Phase 5: extended-feature save games (sequenced and extended timers, DSA blocks), the
full monster attack and alternate-graphics state, and exact missile mirror/flip edge cases.
Save work lives in `PLAN.md` → "Phase 10"; take these up there.

### G8 ⚠️ Champion-attack deferrals

Phase 12 step 7 deferred several things, all deliberately; they are listed under the step
in `doc/PLAN_ARCHIVE.md` → "Phase 12 — Monsters".

### G9 ⏳ Changing the marching order

Found paying C21. Buttons 125-128, the four position squares at the top right of
`buttons17196`, go to `TAG0025a6` (`doc/CSBwin-src/Mouse.cpp:1586-1597`,
`CSBCode.cpp:2053`). That function picks up the champion at that position so the player
can drag the champion to another square. The drag's "cursor left the rectangle" event is
button -1 (`Mouse.cpp:1800-1805`).

The port queues these buttons, and `handleMouseButton` drops them. The marching order
cannot be changed.

---

### G10 ⏳ `StealFromCharacter` — the giggler steals nothing

*(Found in E1c, 2026-09-25.)* A monster attack with `monsterShouldSteal` calls
`StealFromCharacter` (`doc/CSBwin-src/Monster.cpp:239`) in CSBWin. The port had a
`stealFromCharacter` hook that `Game` never wired, so the blow is spent and nothing is
taken; `MonsterAttack` now says so where the call belongs. Port it there, through
`ctx.systems`, with a tool that has a giggler rob a champion.

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

- 🚫 **The mirrored far-right sidewalls' `srcOffsetX`.** CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for positions 1 and 6 (`:3536`), compensates
  for `MakeMirror` reversing a byte-aligned buffer. `getMirroredBitmap` reverses the exact
  bitmap, so applying it would shift a correctly aligned image. The reasoning is in the
  code. <sub>Context: `doc/PLAN_ARCHIVE.md` → “A wall decoration one cell ahead and to the left is no longer…”.</sub>
- 🚫 **`CHARDESC.load` is recomputed** from the possessions rather than cached and adjusted
  at each of CSBWin's eight possession writers. Same value, and it cannot drift;
  `Party.ts` made the same choice for `SetHandOwner`. Recorded in the module comment of
  `src/engine/CharacterStats.ts`. (The other half of that old ⚠️, the `nameIndex` hook, is
  debt, in B1.)
- 🚫 **`CreateAndDropObject` appends** new weapon and armour records rather than reusing
  CSBWin's free list (Phase 12 step 4). Revisit if record exhaustion ever matters.
- 🚫 **The intro runs on wall-clock time** through `requestAnimationFrame`, not on a VBL
  counter shared with the game loop. Nothing else exists yet when it plays, so there is
  nothing to drift against. If a boot-time animation ever has to agree with `d.Time`, this
  is the place that would have to change.
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole intro.** A developer
  affordance with no CSBWin counterpart, kept deliberately: six of the nine golden frames
  boot through it.
- 🚫 **Custom skins / `BACKGROUND_LIB`** (Phase 6). The shipped DM dungeon uses no custom
  backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here,
  so the branch is dead.
- 🚫 **Audio sample rates** — a documented exception to faithfulness;
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- 🚫 **Crack Switch (In) placement** — `Byte4100[55]` is read as 2, not `graphics.dat`'s
  0, so a pressed crack switch stays low on the wall as in the Atari ST original;
  `doc/PROVEN_FACTS.md` → "Crack Switch (In) placement".
- **Not debt, per the 2026-09-23 review** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
