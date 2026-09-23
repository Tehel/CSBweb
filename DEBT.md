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

## Why this order

- **A — Housekeeping.** Minutes of work, and it stops stale comments misleading every later
  session.
- **B — Duplicate implementations.** The cheapest real risk: each copy is a place where a
  fix lands once and misses the others, and one of them (`DescIndex`) has already drifted.
  Tier C also needs the single copies (`OrdinalOfMonsterAtPosition`, `NameIndex`).
- **C — Known divergences from CSBWin.** The project's first rule is faithfulness, so known
  wrong behaviour outranks tidiness. Each item is local and small.
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
| C13 | The rest of `MoveParty`: stamina, move delay, queue depth | M | ⏳ |
| C14 | `DrawClouds`: size, colour map, lightning position, the cell under the party | S | ⏳ |
| C15 | A DSA cell move does not go through `MoveObject` | M | ⏳ |
| C16 | Freed database slots are never reused | M | ⏳ |
| C17 | `WiggleEverything` leaves a moved cloud's timer behind | S | ✅ |
| C18 | A Fluxcage never expires, and frees door record 0 | S | ✅ |
| C19 | `CastSpell` under a spell filter's overrides | S | ⏳ |
| D1 | Hands stored twice (*bundle with D2*) | M | ⏳ |
| D2 | One "no object" value | L | ⏳ |
| D3 | Most state fields are optional | L | ⏳ |
| D4 | `ObjectID` is not a distinct type | M | ⏳ |
| E1 | A shared game context, and one set of tables | L | ⏳ |
| E2 | Split `Game.ts` by CSBWin source file | L | ⏳ |
| E3 | Split `TimerSystem.ts` | L | ⏳ |
| E4 | `ViewportRenderer` has become the UI host; `main.ts`'s `init()` | M | ⏳ |
| E5 | The quick-save snapshot is hand-maintained | M | ⚠️ |
| F1 | Sweep for empty placeholder tables | S | ⏳ |
| F2 | No golden frame covers an edge decoration | M | ⏳ |
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1–G8 | Unported CSBWin features | — | ⏳ |
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
  `movementQueue` (clicks are handled as they arrive), so the port clears that.
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

### C13 ⏳ The rest of `MoveParty`: stamina, move delay, queue depth

Found while re-reading `MoveParty` for C5; none is fixed yet. All in
`doc/CSBwin-src/CSBCode.cpp` unless said otherwise.

- **Every attempted step costs stamina.** Before the destination is even looked at, each
  champion's `staminaAdjustment` is `sw((3 * load) / MaxLoad + 1)` (`:8088-8101`), and
  `AdjustStamina` is applied to each after the party-move filter (`:8129-8135`) — for a
  blocked step as much as for a taken one. The port charges nothing for walking.
- **The move delay.** A taken step sets `d.partyMoveDisableTimer` to the slowest living
  champion's `TimeToMove` (`:8326-8347`); the tick counts it down (`:689-692`), and
  `Mouse.cpp:1482-1491` refuses a step while it is non-zero — or while `d.Word11712` is
  set and the step heads towards `d.Word11714`. The port gates on wall-clock
  milliseconds instead (`Party.canMove`, `GAME_TIMING.MOVE_DELAY_MS` / `TURN_DELAY_MS`).
  `PLAN.md` Phase 10 already lists `partyMoveDisableTimer` as not modelled for saves;
  modelling it closes both.
- **The key queue holds two keys, not three.** `CSBUI.cpp:143-145` is a 3-slot ring that
  refuses a key when `next == keyQueueStart` (`:1131-1139`); `Game.movementQueueLen` is 3
  and the port's check lets three in.
- **`DiscardAllInput()` on a level change** (`:623`, after `LoadPartyLevel`): stairs, a
  pit or a teleporter to another level also throw away queued input. Not ported.
- **Room type 7.** `D5W` is set only for stone, a shut door and a solid false wall
  (`:8224-8261`), so any other room type is entered; `DungeonState.isWalkable` refuses
  `RoomType.EMPTY` (7). Check whether any dungeon we load has such a cell before changing it.
- `CallPartyMoveFilter` (`:8119`) is a DSA filter — G2's kind, and no loaded dungeon
  defines one.

Evidence for each will extend `tools/dump-party-collision.ts`, which now steps frames with
`Game.runFrame`.

### C14 ⏳ `DrawClouds`: size, colour map, lightning position, the cell under the party

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

### C15 ⏳ A DSA cell move does not go through `MoveObject`

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

### C16 ⏳ Freed database slots are never reused

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

### C19 ⏳ `CastSpell` under a spell filter's overrides

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

---

## D — State representation

### D1 ⏳ Hands stored twice *(bundle with D2)*

`Champion` keeps its hands in both `possessions[0]`, `[1]` and `[8]` and three named
fields, `shieldHand`, `weaponHand` and `quiver` (`src/engine/gameTypes.ts:191-193`), and
every writer has to remember both — `Game.setPossessionDirect` (`src/engine/Game.ts:2700`)
is the pattern. The named fields are typed `any`, so the compiler cannot help. CSBWin has
only `possessions[30]`.

Delete the three fields, read and write the array through named slot constants, and let
`tsc` find every site. Check that the save paths (`SaveGameLoader`, `CsbwinCharacters`,
`RuntimeSaveState`) serialise the array only.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “A thrown or shot object no longer stays in the hand as well”.</sub>

### D2 ⏳ One "no object" value

**What.** An empty possession slot or the cursor can hold `null`, `undefined`,
`OBJECT_ID_NULL` (0xFFFF) or `OBJECT_ID_EOF` (0xFFFE) (`src/core/types.ts:112-113`).
`possessions` is an *optional* `Array<number | null>` and `objectInHand` is
`ObjectID | null` (`src/engine/gameTypes.ts:195`, `:229`). So every module normalises for
itself, with four identical functions:

- `Game.normalizeObjectInHand` (`src/engine/Game.ts:2722`)
- `ActuatorSystem.normalizeObjectInHand` (`src/engine/ActuatorSystem.ts:870`)
- `DsaSystem.normalizePossessionValue` (`src/engine/DsaSystem.ts:2338`), plus
  `isEmptyObject` (`:2379`)
- `normalizeObjectValue` (`src/renderer/ui/Objects.ts:170`)

It also guards with `isLikelyObjectRecord` (`Game.ts:2357`, `ui/Objects.ts:150`), called
about twenty times. That function only checks that a record index is in range — a
defensive guess at whether a number is an object at all.

CSBWin has one empty value, `RNnul`; `RNeof` only ever terminates a chain.

**Fix (recommended).** Make `RNnul` (`OBJECT_ID_NULL`) the only empty value everywhere a
slot or the cursor is stored. CSBWin does that, and the save file already stores it, so the
load/save boundary stops converting. Make `possessions` a required 30-entry `ObjectID[]`.
Delete the normalizers. Wherever `isLikelyObjectRecord` still guards something after B1 has
split the RN/type overload, replace it with a plain `!== OBJECT_ID_NULL` or delete it. If
an `OBJECT_ID_EOF` ever turns up in a slot, that is a bug upstream to find, not a value to
normalise.

The alternative — `null` as the one empty value, converted at the file boundary — is less
churn but departs from CSBWin; "port, don't reinvent" argues for `RNnul`.

**Evidence.** `npm test -- --frames`; `tools/dump-save-roundtrip.ts` and
`tools/dump-live-save-file.ts` prove the boundary. A grep proves the normalizers are gone.
If `RuntimeSaveState`'s shape changes, bump `RUNTIME_SAVE_VERSION`.

### D3 ⏳ Most state fields are optional

`Champion` has 24 optional fields out of 35, and `PartyState` 13 out of 25
(`src/engine/gameTypes.ts`). That is where `src/engine/` gets its 277 `?? 0` and 62 `?.[`.
CSBWin's `CHARDESC` has no optional fields; the optionality is a relic of porting one field
at a time.

Make them required, initialised in one place per type (`createChampionFromPreset` in
`src/engine/AddCharacter.ts`, `Party`'s constructor, the save loaders), then remove the
`?? 0` fallbacks field by field. Watch for a fallback that hides a *different* default from
the initializer's, and check the initializer against CSBWin. Split across sessions by field
group, and record the split here. If `RuntimeSaveState`'s shape changes, bump
`RUNTIME_SAVE_VERSION`.

### D4 ⏳ `ObjectID` is not a distinct type

`type ObjectID = ui16` (`src/core/types.ts:110`) is a plain `number`. So the 82
`as ObjectID` casts check nothing, and a name index or a slot number passes for an object
ID silently. After D2, decide: brand it (`number & { readonly __rn: unique symbol }`),
which would make `tsc` catch RN/type confusion like B1's overload, or drop the casts.
Measure the churn on a branch first.

---

## E — Architecture

### E1 ⏳ A shared game context, and one set of tables

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

### E2 ⏳ Split `Game.ts` by CSBWin source file

`Game.ts` is 3018 lines. Split it by CSBWin source file, as `src/renderer/ui/` already is
(`doc/UI_MODULE_MAP.md`). Method groups (lines as of 2026-09-23):

| Group | Methods | CSBWin |
| --- | --- | --- |
| Hall of Champions | `addChampion`, `addCharacter`, `resurrectReincarnateCancel`, `finishResurrectReincarnate`, `reincarnateNamed`, `reincarnate`, the mirror helpers, `registerChampionBones`, `assignChampionFingerprint` (≈ `:820-1290`) | `AddCharacter` `Character.cpp:456`, `_ResurrectReincarnateCancel` `CSBCode.cpp:6616`, `_ReIncarnate` `Code13ea4.cpp` |
| Periodic updates | `processNinetySecondUpdate`, `processTenSecondUpdate` (≈ `:1397-1580`) | `NinetySecondUpdate` `CSBCode.cpp:7339`, `TenSecondUpdate` `Code17818.cpp:160` |
| Magic | `castMagic`, `fillSpellParameters`, `castSpell`, `incantationToSpell`, … `applyMagicShield` (≈ `:1591-1970`), `characterThrowsSpell` (`:2078`), the spell messages (≈ `:2265-2352`), `castSpellFromUi` | `CastSpell` `Magic.cpp:1090` and its neighbours |
| Cursor drop and throw | `dropObjectFromCursor`, `maybeScheduleViAltar`, `throwObjectFromCursor`, `throwStaminaCost`, `awardThrowSkill` (≈ `:2487-2760`) | `DropObject` `Mouse.cpp:848`, `ThrowByCharacter` `Mouse.cpp:673` |
| Quick-save | `RuntimeSaveState` (≈ `:95-172`), `getRuntimeSaveState`, `applyRuntimeSaveState`, the timer (de)serialisers (≈ `:2757-3017`) | none — the port's own quick-save |
| Character actions | `disableCharacterAction`, `enableCharacterAction`, `setBusyTimerRefill`, `refillPossessionSlot`, `matchingAmmunition`, `removeCharacterPossession` (≈ `:2005-2245`) | find their CSBWin home before moving them |

Leave `Game` as the loop, the construction, and a thin public facade. One group per commit.
Do E1 first.

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
- **Decoration gating and footprints** *(Phase 4)*. DSA-based decoration gating and
  footprints / extended cell flags are not ported (`src/renderer/csbwin/SummarizeRoomInfo.ts:515`).
  Wall and floor decoration selection follows `TAG00a4a2` plus the actuator's
  `wallGraphicOrdinal` for stone and open rooms.

### G2 ⏳ Three DSA filters

No dungeon we load defines any of them, so none could be verified if written:
`ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`, Phase 13 step 1),
`ESL_FEEDINGFILTER` (`:4288-4344`, step 5, with the insertion point already marked in
`handleMouthPress`), and `PortraitTranslateDisable`'s `QueueDSASwitchAction`
(`CSBCode.cpp:6540-6612`, step 4). The last one only fires on a `DisableMessage` that the
shipped dungeon never carries.

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

### G5 ⏳ Messages and sleep

From Phase 11:

- The pixel-level scroll animation (`d.PushTextUp` / `d.TextScanlineScrollCount`) is not
  implemented. Rows scroll instantly, and CSBWin's wait-for-animation guards are absent.
- `SCROLLING_TEXT::Serialize` — message state in save games
  (`doc/CSBwin-src/Data.h:1666`). Quick-load calls `discardText()` instead.
- `d.PartySleeping` is plumbed (`setPartySleeping`) but never set: there is no sleep
  system yet.

### G6 ⏳ UI effects

- **Rune click flash** in the magic panel (Phase 7).
- **Interaction highlights** — button press and selection effects (flash, shading, invert)
  across UI regions, consistent with the hit-test rectangles (Phase 7).
- **The viewport flash on a blow**, and a light-level trace hook (Phase 7.5). `atk_LIGHT`
  itself works; this is the flash, not the LIGHT attack.

### G7 ⚠️ Save-game fidelity gaps

From Phase 5: extended-feature save games (sequenced and extended timers, DSA blocks), the
full monster attack and alternate-graphics state, and exact missile mirror/flip edge cases.
Save work lives in `PLAN.md` → "Phase 10"; take these up there.

### G8 ⚠️ Champion-attack deferrals

Phase 12 step 7 deferred several things, all deliberately; they are listed under the step
in `doc/PLAN_ARCHIVE.md` → "Phase 12 — Monsters".

---

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
  affordance with no CSBWin counterpart, kept deliberately: five of the eight golden frames
  boot through it.
- 🚫 **Custom skins / `BACKGROUND_LIB`** (Phase 6). The shipped DM dungeon uses no custom
  backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here,
  so the branch is dead.
- 🚫 **Audio sample rates** — the one documented exception to faithfulness;
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- **Not debt, per the 2026-09-23 review** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
