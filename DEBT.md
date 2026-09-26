# dmweb – Technical debt

This file is the **authority on technical debt**: everything known to be wrong, divergent
from CSBWin, duplicated, or left unfinished in code that is otherwise considered done. It
lists **open items only**. `PLAN.md` carries the live phases and points here; paying this
list off is the current project priority (`PLAN.md` → "Current priority").

A paid item is deleted. Its commits name its ID, so `git log --grep C33` finds the work,
and an ID is never reused. Items paid before 2026-09-26 are in `doc/PLAN_ARCHIVE.md` →
"Resolved debt", which is where a `DEBT.md` ID cited in the code but absent here is found.

Markers are `PLAN.md`'s: ⚠️ knowingly divergent or incomplete · ⏳ not started ·
🚫 deliberately not done.

## Priority: structure before features

**Data-structure and architecture debt is paid before any missing feature is built.**
Tiers D (state representation) and E (architecture) come first, then the divergences of
tier C, and the unported features of tier G come last. Two reasons:

- A feature built on a structure that is about to move gets built twice: once now, and
  again when the move lands — or the move has to carry it, which doubles the diff to
  review.
- The structure sets the price of every later port. With one `GameContext`, a fix calls
  across systems through `ctx.systems` instead of adding a hook and a round of `?? 0`
  guesses. E3 gives `TimerSystem.ts`, which every missile, cloud and world-move change
  goes through, the same shape.

The order, then:

1. **D and E.** Tier D is empty today. New structural debt goes into D or E and jumps the
   queue.
2. **C — Known divergences from CSBWin.** Frozen while D and E have items: a divergence
   found along the way is recorded here and not fixed, unless it blocks the D/E item at
   hand or corrupts saves. C33 and C34 come first once E is empty, unless the author
   pulls them forward.
3. **G — Unported CSBWin features.** Last. A missing feature is started only once D and E
   are empty, even when a dungeon, a save or a playtest needs it — note the need under the
   item instead. The author can always ask for one out of order.
4. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**H** is not debt: deliberate divergences, recorded so nobody "fixes" them.

## How to work this list

1. **One item per commit, a few per session**, in the order above, then `/clear`
   (`CLAUDE.md` → "Working economically"). `/pay-debt` (`.claude/commands/pay-debt.md`)
   starts such a session and ends it with the command for the next one. Stop before a size-M item would overrun the
   session. Split an L item into steps and record the split in its entry.
2. **Re-verify first.** Every pointer below was checked against the code on 2026-09-26, but
   line numbers drift. If an item turns out to be already paid, delete it and say how you
   know in the commit message.
3. **Refactors change no behaviour.** Tiers D and E are refactors: `npm test` before and
   after, and `npm test -- --frames` whenever anything under `src/renderer/` or `src/ui/`
   moves. Better still, and expected for a split like E3: every tool's full output is
   byte-identical before and after (only `dump-save-menu` varies on its own, by
   one byte, the save date), and the author's runtime saves hash the same after load and
   after 600 ticks. A refactor that uncovers a divergence records it in tier C. If it is
   fixed at all, the fix goes in a **separate** commit, so every commit is either
   behaviour-neutral or a fix, never both.
4. **A fix owes the usual five things** (`.claude/skills/playtest-bug/`): the CSBWin
   citation, the fix, a `tools/` check that fails before it, a `doc/PROVEN_FACTS.md` entry
   if a new fact was verified, and the bookkeeping here.
5. **When an item is paid,** delete its entry and its index row, and rewrite or remove
   every code comment that cites its ID: an ID in the code means the debt is still open.
   Name the ID in the commit message (`Debt C33: …`); that is the record.
6. **New debt goes here,** in the tier it belongs to, with the next free ID. Not only in a
   code comment, and not in `PLAN.md` once its phase is closed. Write the entry as the
   state of the code, not the story of how it was found (`CLAUDE.md` → "Write down the
   present, not the past").

## Index

In payoff order: the first row is the next item.

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| E3 | Split `TimerSystem.ts` by CSBWin source file | L | ⏳ |
| E4 | `ViewportRenderer` has become the UI host; `main.ts`'s `init()` | M | ⏳ |
| E5 | The quick-save snapshot is hand-maintained | M | ⚠️ |
| E6 | `CHARDESC::Possession` is written out once per module | S | ⏳ |
| C25 | The stairs do not turn a monster's corner | M | ⚠️ |
| C33 | An empty-handed click on bare stone plays no sound | S | ⏳ |
| C34 | Five possession writers, none of them CSBWin's whole | M | ⏳ |
| C35 | A monster that throws nothing reports missile 0, not `RNnul` | S | ⏳ |
| C36 | `EnableCharacterAction` keeps the attack type, and frees only its own timer | S | ⏳ |
| C37 | A door button or a touched wall does not set `d.clockTick` | S | ⏳ |
| C38 | `SetTimer`'s sequence repack at 0xffff is not ported | S | ⏳ |
| C39 | `MonsterAI`'s copy of `d.MonsterDamageResult` is never 1 | S | ⏳ |
| C40 | `CheckMoveFromMissile` uses the missile timer's filter state | S | ⏳ |
| C41 | The party's `MoveObject` is put together at four call sites | M | ⏳ |
| F1 | Silent fallbacks for tables that are always there | S | ⏳ |
| F2 | No golden frame covers an edge decoration | M | ⏳ |
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1 | DSA gaps, and the footprint decoration | — | ⏳ |
| G2 | Seven DSA filters | — | ⏳ |
| G3 | The wings | — | ⏳ |
| G4 | CSB extensions, malformed heroes, the monster design options | — | ⏳ |
| G5 | The message scroll, message state in saves, the freeze | — | ⏳ |
| G6 | UI effects | — | ⏳ |
| G7 | Save-format gaps | — | in `PLAN.md` |
| G8 | Lord Chaos's fusion endgame | — | ⏳ |
| G9 | Changing the marching order | — | ⏳ |
| G10 | `StealFromCharacter`: the giggler steals nothing | — | ⏳ |
| G11 | `MakeMoreRoomInDB`: a full database refuses the record | — | ⏳ |
| H | Deliberate divergences | — | 🚫 |

Size: **S** well under a session · **M** about one session · **L** several sessions.

---

## E — Architecture

### E3 ⏳ Split `TimerSystem.ts` by CSBWin source file

`src/engine/TimerSystem.ts` is 3189 lines, and it is half the world. Besides the
`ProcessTimers` dispatch (`CSBCode.cpp:6383`) and the small per-type handlers (doors, pits,
light, shields, poison…) it holds these groups (start lines as of 2026-09-26):

| Group | Methods | CSBWin |
| --- | --- | --- |
| Missiles | `throwMissile` 947, `triggerMissileLauncher` 1266, `processMissileTimer` 1362, `checkMoveFromMissile` 1545, `processMissileEncounter` 1667 … `finishMissileEncounter` 2006 | `MissileTimer` `Timer.cpp:184`, `TriggerMissileLauncher` `Timer.cpp:1883`, `ThrowMissile` `Timer.cpp:2016`; `ProcessMissileEncounter` `Code11f52.cpp:1711`, `CheckMoveFromMissile` `Code11f52.cpp:2530` |
| Clouds | `createDeathCloud` 2051, `createFluxcage` 2062, `createCloud` 2109, `processTT_25` 2186, `createCloudRecord` 2337, `playCloudSound` 2382 | `CreateCloud` `Code11f52.cpp:1376`, `CreateFluxcage` `Code11f52.cpp:1515`, `ProcessTT_25` `Timer.cpp:436` |
| Door and magic damage | `hitDoor` 2306, `determineMagicDamage` 2421 | `HitDoor` `Code11f52.cpp:2263`, `DetermineMagicDamage` `Code11f52.cpp:1557` |
| Wiggle | `wiggleEverything` 2508 … 2591, with `notePartyMoved` 2579 | `WiggleEverything` `Timer.cpp:2428` |
| World moves | `resolvePartyMove` 2607, `moveObject` 2647, `resolveMonsterDestination` 2731, `checkMonsterVersusMissiles` 2776, `checkMonsterMoveFromMissile` 2806 … `teleportMonster` 3095 | the world `MoveObject`, `Code11f52.cpp:2796`, and `TeleportMonster` `Code11f52.cpp:2308` — **not** `MoveObject.cpp:721`, the DSA's ten-argument `MoveObject`, which is `DsaSystem.moveObjectDsa` |
| Vi altar | `scheduleViAltar` 1000 … `isChampionDead` 1113 | `ProcessTT_ViAltar` `Timer.cpp:2710` |
| Generators | `spawnMonsterGenerator` 1184, `processReactivateGenerator` 1241 | `ProcessTT_ReactivateGenerator` `Timer.cpp:1835` |
| Character action | `enableCharacterAction` 282 | `EnableCharacterAction` `Timer.cpp:2638` |

**The grouping.** A method goes to the system that ports its CSBWin file, the rule `Game`'s
split followed. `Timer.cpp` is `TimerSystem`'s, so every `Timer.cpp` function stays: the
missile timer (`MissileTimer`, `ProcessObjectFromMissile` `Timer.cpp:129`,
`TriggerMissileLauncher`, `ThrowMissile`), `ProcessTT_25`, `ProcessTT_BASH_DOOR`,
`WiggleEverything` with its party arm `wiggleParty`, the Vi altar, the generators
(`spawnMonsterGenerator` is `ProcessTT_OPENROOM`'s, `Timer.cpp:1688`) and
`EnableCharacterAction`.

`Code11f52.cpp` is not a topic. Like `CSBCode.cpp`, it is a segment of the disassembly named
by its address, and the port already spreads it over a dozen modules by topic: `DamageMonster`
and its neighbours are `MonsterDamage`'s, `PressurePadOrAlcove` is `ActuatorSystem`'s, the
`FindFirst*` are `DungeonState`'s, the footprints `PartyFootprints`', `MaxLoad`
`CharacterStats`'. So the topic decides, as it did for `PeriodicUpdates`, and what leaves
becomes **two** systems:

- **`WorldMove`** (`src/engine/WorldMove.ts`, `ctx.systems.worldMove`, `game.worldMove`),
  about 540 lines: the world `MoveObject` (`Code11f52.cpp:2796`) as the port cuts it up
  (`moveObject`, `resolvePartyMove`, `resolvePartyMoveWithTeleporter`,
  `resolveMonsterDestination`, `resolveCellEffects` with its teleporter and pit helpers,
  `withSupressedPitDamage`, `notePartyMoved`), with `TeleportMonster` (`:2308`),
  `Levitating` (`:2417`) and `PitGoesSomewhere` (`:2777`), which only it calls.
- **`MissileEncounter`** (`src/engine/MissileEncounter.ts`, `ctx.systems.missileEncounter`,
  `game.missileEncounter`), about 800 lines: `ProcessMissileEncounter` (`:1711`) with
  `MissileEncounterFilter` (`:1626`) and the port's helpers of it; `CheckMoveFromMissile`
  (`:2530`), its other entry point, with `checkMonsterMoveFromMissile`; and what an
  encounter sets off, which `Code11f52.cpp` keeps beside it: `CreateCloud` (`:1376`, with
  `createDeathCloud`, `createCloudRecord`, `playCloudSound`), `CreateFluxcage` (`:1515`),
  `HitDoor` (`:2263`) and `DetermineMagicDamage` (`:1557`).

`WorldMove` calls `MissileEncounter` (`checkMoveFromMissile`), never the reverse: the
encounter reaches `MoveObject` only through `ProcessObjectFromMissile`, which stays.

`CheckMonsterVersusMissiles` (`Monster.cpp:4462`) leaves by the same rule, for
`MonsterAI`: into the private wrapper of the same name that is its one caller
(`MonsterAI.ts:1155`).

**The state the line cuts through.**

- `missileFilterObject` / `missileFilterTimer` are `Timer.cpp`'s globals (`Timer.cpp:176-177`),
  which `Code11f52.cpp` reads (`extern` at `:25`, read at `:1681`). They stay `TimerSystem`'s,
  made public, and `MissileEncounter` reaches them through `ctx.systems.timer`. The port's
  `checkMoveFromMissile` also writes them, which CSBWin's does not (C40). The split keeps
  the writes.
- `d.MonsterDamageResult` (`Data.h:851`) is written and read by `ProcessMissileEncounter`,
  `CreateCloud`, `CheckMoveFromMissile` and `CheckMonsterVersusMissiles`. It becomes a
  public field of `MissileEncounter`, where three of the four are, and `MonsterAI` reaches
  it through `ctx.systems.missileEncounter`. `MonsterAI.lastDamageResult` is a second copy
  that diverges (C39). The split keeps it.
- `TimerSystem.now` (`TimerSystem.ts:108-113`), the port's copy of `d.Time` that
  `processTimers` sets, is what `CreateCloud`, `ProcessMissileEncounter` and `HitDoor`
  schedule from. It stays `TimerSystem`'s, read through `ctx.systems.timer`. Reading
  `ctx.state.tickCount` instead would be a change, not a move: three tools drive
  `processTimers` with a clock of their own (`watch-monsters`, `dump-dsa-move`,
  `dump-feeding`). Its comment cites a `setNow` that does not exist.
- The helpers both sides use (`isSamePosition`, `getPartyDistance`, `setDoorState`) become
  module functions, not copies. `isMagicSpell` goes, for `isMagicSpellRn` itself.

**Steps**, one commit each, each behaviour-neutral: every tool's whole output byte-identical
(but `dump-save-menu`'s one byte), and the author's runtime saves hash the same after load
and after 600 ticks. A tool that calls or spies on a moved method follows it
(`game.timerSystem.determineMagicDamage = …` becomes `game.missileEncounter.…`), and
`tools/dump-monster-damage.ts`'s stub of `ctx.systems.timer` becomes a stub of the new
system.

1. ✅ `LaunchMissile` is `MagicSystem.launchMissile` (with `launchThrownMissile`, its
   `Position` form), and its adapters sit in their callers (`MonsterAttack`,
   `MouseSystem`); the `word8` codec is `missileHelpers.ts`'s; `BringCharacterToLife` is
   `CharacterSystem`'s.
2. `WorldMove`. (M) Next.
3. `MissileEncounter`, and `CheckMonsterVersusMissiles` into `MonsterAI` with it, since it
   needs `d.MonsterDamageResult`'s new home. This step pays E3. (M)

`MonsterSystem` reaches the world moves through `ctx.systems.timer`
(`checkMonsterMoveFromMissile`, `resolveMonsterDestination`: `MonsterSystem.ts:509`,
`:524`). After steps 2 and 3 those calls point at `missileEncounter` and `worldMove`.

### E4 ⏳ `ViewportRenderer` has become the UI host; `main.ts`'s `init()`

`src/renderer/ViewportRenderer.ts` is 1023 lines and no longer renders only the viewport.
It hosts the save menu and the Reincarnate
screen (`saveMenuClick` / `saveMenuKey` / `saveMenuWheel`, `reincarnateClick` /
`reincarnateKey`) and the UI state, and it has thirteen handler setters that `main.ts`
calls one by one: `setCharacterStats`, `setPlaySound`, `setViewingFilter`,
`setObjectMoveHandler`, `setSpellCastHandler`, `setFeedingHandler`,
`setResurrectReincarnateCancelHandler`, `setChampionAttackHandler`, `setSleepHandlers`,
`setSaveHandlers`, `setPaletteSelectedHandler`, `setReincarnateNamedHandler` and
`setBootFrameRenderer`.

Keep the viewport composition (`drawViewportFrame` and its helpers) in a class that
deserves the name. Move the screen and UI hosting into a class named for what it is, and
have it take the handlers as one object at construction, the way `GameHost` gathers the
engine's callbacks. `main.ts`'s `init()` (`src/main.ts:168-429`, about 260 lines)
needs the same treatment: load, construct, wire and start as separate functions.
Evidence: `npm test -- --frames`.

### E5 ⚠️ The quick-save snapshot is hand-maintained

`src/engine/DungeonSnapshot.ts` lists what play can change in `DungeonData`, and both the
quick-save (`src/engine/RuntimeSave.ts`) and the CSBWin save (`src/data/CsbwinSaveGame.ts`)
restore the world through `captureDungeonSnapshot`. A hand list fails silently: a field
that play changes and the list misses is simply not restored. Such fields are not always
obvious. `data.columnIndex` looks structural, but `DungeonState.addObjectToCell` /
`removeObjectFromCell` rewrite it whenever a cell gains or loses its last object, as CSBWin
does (`doc/CSBwin-src/CSBCode.cpp:5211-5224`). It is on the list, with
`header.objectListSize` and `header.objectCounts`, and `tools/dump-savegame.ts` compares
the whole mutable `DungeonData` and asserts that loading twice with play in between gives
the same world. But a field added to `DungeonData` later still has to be added by hand. Derive the list from the type, or snapshot the
whole structure and subtract what is immutable. This pairs naturally with Phase 10's
remaining save work.

<sub>Context: `doc/PROVEN_FACTS.md` → “The column index is saved state, not dungeon structure”.</sub>

### E6 ⏳ `CHARDESC::Possession` is written out once per module

CSBWin reads a slot through `CHARDESC::Possession(slot)`. The port writes it out as a
one-line `possessions[slot] ?? OBJECT_ID_NULL`: as a private helper in `CharacterStats.ts:238`,
`AttackSystem.ts:291`, `PeriodicUpdates.ts:230` and `MonsterAttack.ts:694`; as the UI's
exported `getChampionPossession` (`src/renderer/ui/Character.ts:603`); and inline in
`CharacterSystem`, `MagicSystem`, `skills.ts`, `ui/Mouse.ts` and `data/CsbwinCharacters.ts`.
The array is a required thirty, so the `??` only guards an out-of-range slot. Make it one
exported function beside `Champion` (`src/engine/gameTypes.ts`) and use it everywhere.

---

## C — Known divergences from CSBWin

Frozen until tier E is paid (see "Priority").

### C25 ⚠️ The stairs do not turn a monster's corner

`MoveObject`'s stairs arm turns whatever it moves to face the stairs with
`objD7.pos(LOCAL_28)` (`doc/CSBwin-src/Code11f52.cpp:3124-3130`). `RN::pos` writes the
corner into the global `dataTypeMap` (`CSBTypes.h:336-341`), so a monster's corner changes
too. The port's `resolveCellEffects` computes the turned corner for a monster, but
`MonsterSystem.moveMonster` sets the group down under the ID it came with (and says so,
`MonsterSystem.ts:542-545`). The port's `ObjectID` carries the corner, and
`DungeonState.removeObjectFromCell` and every caller holding the ID compare it whole. CSBWin's
`RN ==` compares only the indirect index (`CSBTypes.h:349-356`). Believed invisible, since a
group's members are placed by `ITEM16`/`uByte5` and not by the RN's corner, but not verified.

A type cannot fix this: the `ObjectID` brand cannot forbid `===`. The fix is an
`rnEquals(a, b)` (`(a & 0x3fff) === (b & 0x3fff)`, with the `RNVAL`s compared whole), used
by `removeObjectFromCell` and every chain walker that CSBWin writes as `RN ==`. Only then
can `moveMonster` set the group down under the turned ID without the next lift missing it
(the lift still holds the old ID). That touches every chain operation, hence M.

### C33 ⏳ An empty-handed click on bare stone plays no sound

When `HandleClickInViewport`'s empty-handed button loop hits nothing, CSBWin plays sound 4
at the party if all of these hold: the party is not facing an alcove, `d.CellTypeJustAhead`
is 0, the cell ahead is stone or a visible false wall (`(cf & 5) == 0`), and the click is
within x 33-189, y 44-150 (`doc/CSBwin-src/Mouse.cpp:1138-1157`). The port's
`resolveEmptyHandedViewportClick` (`src/renderer/ui/ViewportPicking.ts:47`) returns `null`
there, and `src/ui/events.ts` does nothing with it. Add the sound, and a row to
`tools/dump-viewport-click.ts` that asserts it is queued.

### C34 ⏳ Five possession writers, none of them CSBWin's whole

CSBWin changes a champion's slots only through `AddCharacterPossession`
(`doc/CSBwin-src/Character.cpp:1936-2037`) and `RemoveCharacterPossession` (`:1822-1930`).
The port has five writers:

- `CharacterSystem.removeCharacterPossession` is CSBWin's, less two things. One is
  `TAG01b1c0` (`Character.cpp:4887`), which closes the attack menu, when
  `d.AttackingCharacterOrdinal` is this champion (`:1885-1888`). The other is `RepackChest`
  (`:3108`) when their inventory is open and a chest leaves the weapon hand (`:1906-1914`).
  Both depend on UI state (`UIState.attackingCharacterOrdinal`, the open inventory), which
  the engine cannot see.
- `CharacterSystem.setChampionHand` is a slot write plus `AdjustStatsForItemCarried`, and
  nothing else. It is the add half of the two hand refills, which in CSBWin are
  `AddCharacterPossession(chIdx, RemoveCharacterPossession(…), hand)` (`Timer.cpp:2664`;
  `CSBCode.cpp:6263-6270` through `TAG011594`). So a torch refilled from the quiver is not
  lit and a scroll is not opened. `MagicSystem`'s Zokathra goes through it too.
- `ui/Character.setChampionPossession` (`src/renderer/ui/Character.ts:607`), the inventory
  click from `ui/Mouse.ts`, adds and takes off the Illumulet's `Word1074[2]` and lights or
  puts out a torch. It sets no `value(1)` / `value(0)` on an Illumulet or Jewel Symal, so a
  worn one never shows its `_b` name. It opens and closes no scroll, and it does not call
  `TAG01b1c0`. It also lights any torch by `GetBasicObjectType`, where CSBWin's add tests
  `NameIndex == Torch_a`, an unlit one (`:1988`).
- `DsaSystem.setChampionPossession` (`DsaSystem.ts:2297`) does `AdjustStatsForItemCarried`
  and the Illumulet's brightness. It does nothing for a torch, `value()` or a scroll.
- The Hall of Champions recruit (`HallOfChampions.collectMirrorPossessions`) writes the
  array through `assignAddCharacterPossessions` (`AddCharacter.ts:108`), then adds the stat
  bonuses. CSBWin places each mirror object with `AddCharacterPossession`
  (`Character.cpp:789`). So a recruit's Illumulet does not light the party and their
  torch is not lit.

All five call `AdjustStatsForItemCarried`, each in its own way, and the UI and the DSA each
have their own copy of `updateLightForPossessionChange`.

Port `AddCharacterPossession` into `CharacterSystem` beside `removeCharacterPossession`,
and route all five writers through the pair, so that `AdjustStatsForItemCarried` has one
caller per direction again. Add the two engine→UI notices (close the attack menu, repack
the open chest) to `GameHost` (`src/engine/GameHost.ts`). Needs
the frames, because the inventory click is UI. `tools/dump-item-bonuses.ts` section 4
already drives four of the writers.

### C35 ⏳ A monster that throws nothing reports missile 0, not `RNnul`

CSBWin's monster attack starts from `missile = RNnul` and stores
`attackParameters.missileType = missile.ConvertToInteger()`
(`doc/CSBwin-src/Monster.cpp:1041`, `:1076`), so a monster with no missile reports
0xffff. `MonsterAttack.chooseMissile`'s default returns 0 (`MonsterAttack.ts:307-309`).
Nothing reads it today: 0 is not in `THROWABLE`, so no missile flies. But the parameters
are what CSBWin copies to the Monster Attack Filter (`:1129-1165`, unported, G2), so once
that filter exists a DSA would see 0 where CSBWin shows `RNnul`. Return `OBJECT_ID_NULL`,
with a check that reads the parameters of a monster that throws nothing.

### C36 ⏳ `EnableCharacterAction` keeps the attack type, and frees only its own timer

CSBWin's `EnableCharacterAction` (`doc/CSBwin-src/Timer.cpp:2638-2681`) opens with
`busyTimer = -1` and clears `CHARFLAG_attackDisable` unconditionally (`:2645-2646`), and it
ends with `pChar->attackType = -1` (`:2680`).

- **The attack type.** The port's `TimerSystem.enableCharacterAction` (`TimerSystem.ts:282`)
  never resets it, so `champion.attackType` keeps the last attack for good. The next
  `EnableCharacterAction`, say after a spell's `DisableCharacterAction`, then zeroes
  `attackStatModifier` again (harmless, because it is already 0). And if that last attack was
  a shot and hand 0 (the one the arrow is nocked from) is empty, it reloads the bow from
  the quiver, which CSBWin would not do.
- **The timer.** `TimerSystem.processActionDisableTimer` (`:259`) clears `busyTimerIndex`
  and `actionDisabledUntil` only when the expiring timer is the champion's own
  `busyTimerIndex`.

Reset `attackType` at the end. For the second, check first whether a stale `TT_11` can
reach the handler at all, since `SetTimer`'s de-duplication may make the guard dead.
Evidence: a check that shoots, casts, and reads the quiver after the cast.

### C37 ⏳ A door button or a touched wall does not set `d.clockTick`

CSBWin's door button sets `d.clockTick = 1` before queueing the sound and the `TT_DOOR`
timer (`doc/CSBwin-src/Mouse.cpp:1078`), so the door starts moving on the next VBL.
`TouchWallF1` sets `d.clockTick = TouchWall(...)` (`Mouse.cpp:788`), and `TouchWall`
returns 0 (`:315`) unless it worked a wall switch (`:537-539`). So a switch that fired makes
a tick due at once, and a touch that fired nothing clears a due tick, the way an inhibited
move does (the port's `ctx.loop.clockTickCleared`). Only a cell ahead that is off the map
leaves `d.clockTick` alone (`:784-787`). The port's `MouseSystem.handleDoorSwitchClick`
and `handleWallClick` (`src/engine/MouseSystem.ts:282-300`) set neither flag, so a door
starts moving, and a switch's effects land, up to a tick late.

Set `ctx.loop.clockTickSet` for the door button and a switch that fired, and
`clockTickCleared` for a touch that fired nothing, after checking that
`ActuatorSystem.triggerWallSwitch`'s result is `TouchWall`'s. Prove it with a check that
counts the frames from the click to the timer firing.

### C38 ⏳ `SetTimer`'s sequence repack at 0xffff is not ported

`SetTimer` stamps each timer it queues with `m_timerSequence++`
(`doc/CSBwin-src/Timer.cpp:1189`). When the counter reaches 0xffff it first repacks the
stamps in use down to the lowest numbers, in their order (`:1136-1188`). The stamp breaks
ties between timers due on the same tick, and it is saved (`gb2.TimerSequence`). The port's
`TimerQueue` stamps the same way (`nextSequence`, `src/engine/TimerQueue.ts:233`) but has
no repack. Its counter grows past 16 bits, and the quick-save keeps only the low 16 bits of
each stamp (`src/engine/RuntimeSave.ts:294`, `:333`). After 65535 queued timers the port's
stamps no longer match CSBWin's, and two timers on either side of the wrap swap their tie
order across a save and a load. Port the repack. Evidence: a `tools/` check that queues
past 0xffff and compares the stamps, and the queue order, before and after a save.

### C39 ⏳ `MonsterAI`'s copy of `d.MonsterDamageResult` is never 1

CSBWin's monster shuffle calls `CheckMonsterVersusMissiles` and then moves the monster to
its new corner only `if (d.MonsterDamageResult != 1)` (`doc/CSBwin-src/Monster.cpp:3955-3970`):
a missile that killed some of the group but not all leaves its corners as they were. The
port's test (`src/engine/MonsterAI.ts:616`) reads `MonsterAI.lastDamageResult`, a copy of
`d.MonsterDamageResult` that `MonsterAI.checkMonsterVersusMissiles` rebuilds from the
boolean it gets back (`:1155-1161`): 2 if the group was wiped out, 0 otherwise, never 1.
So the test always passes, and the monster takes the new corner. Delete the copy and read
`d.MonsterDamageResult` where the encounter writes it (`TimerSystem.monsterDamageResult`,
`MissileEncounter`'s after E3). Evidence: a check that parks a missile in the corner a
two-monster group shuffles to, with damage enough to kill one of them.

### C40 ⏳ `CheckMoveFromMissile` uses the missile timer's filter state

CSBWin's `CheckMoveFromMissile` (`doc/CSBwin-src/Code11f52.cpp:2530-2776`) neither reads nor
writes `missileFilterObject` / `missileFilterTimer`, the globals `MissileTimer` fills
(`Timer.cpp:176-177`, `:220-221`). The port's `TimerSystem.checkMoveFromMissile`
(`src/engine/TimerSystem.ts:1545`) does both:

- It returns at once while `missileFilterObject` is set (`:1546`), so a move made while a
  missile's own timer runs checks no missiles, where CSBWin's checks them.
- It points both at each missile it resolves, and clears them after (`:1619-1630`). CSBWin
  never clears `missileFilterTimer`, only `missileFilterObject` at each of `MissileTimer`'s
  exits, so `MissileEncounterFilter`'s parameter 6, `BITS10_11(missileFilterTimer.timerWord8())`
  (`Code11f52.cpp:1681`), is the direction of the last missile `MissileTimer` ran. The
  port's is the struck missile's own direction in `checkMoveFromMissile`, and 0 in
  `checkMonsterVersusMissiles` (`clearMissileFilterState` at `:1942-1945`, then `?? 0` at
  `:1930`). Only a dungeon with a missile encounter filter can see this half.

Remove the guard and the writes, and keep `missileFilterTimer` as CSBWin does, a copy that
outlives its timer. Evidence: a check that reads the filter's parameters for an encounter
caused by a party move.

### C41 ⏳ The party's `MoveObject` is put together at four call sites

CSBWin moves the party with one function, the world `MoveObject(RNnul, …)`
(`doc/CSBwin-src/Code11f52.cpp:2796`), from nine call sites (`Timer.cpp:2443`,
`DSA.cpp:4604`, `Attack.cpp:2032`, `CSBCode.cpp:8320`, …). The port has no such function.
Four call sites each assemble it from `checkMoveFromMissile`, `resolvePartyMove` (or
`resolvePartyMoveWithTeleporter`), `notePartyMoved` and two `triggerObjectMove`s: the step
(`MovementSystem.moveParty`, `src/engine/MovementSystem.ts:60-89`),
`AttackSystem.climbDownIntoPit` (`:1357`), `DsaSystem.teleportParty` (`:3087`) and
`TimerSystem.wiggleParty` (`:2591`). They do not agree:

- `MoveObject` calls `CheckMoveFromMissile(oldX, oldY, newX, newY)` first, with the cells
  its caller passed, before any teleporter or pit (`Code11f52.cpp:2847-2853`). The step and
  the DSA teleport do the same. The climb-down resolves the fall first and passes the cell
  it lands in, where CSBWin passes the pit (`Attack.cpp:2032`). That cell is on the level
  below, so the check's same-level second half-step never runs. The wiggle passes the
  resolved cell, where CSBWin passes the party's own cell twice (`Timer.cpp:2443`), and it
  skips the check altogether when nothing moved the party.
- The footprint step runs only when the room changed (`unchangedRoom`,
  `Code11f52.cpp:3183-3247`). Three of the sites test that. The step calls `notePartyMoved`
  after every successful move (`MovementSystem.ts:87`).

Port the party path of `MoveObject` once, in `WorldMove` after E3, in CSBWin's order, and
route the four through it. Evidence: a check per call site that moves the party past a
missile and onto a pit, compared with the order above.

---

## F — Verification debt

### F1 ⏳ Silent fallbacks for tables that are always there

A table that is initialised empty, or read through a `continue`-on-falsy guard, fails
without a warning or a marker: the output is just missing. Every table is a required field
of `GameTables`, built once for `main.ts` and every tool, so a guard against a missing table
is either dead code or a silent placeholder that hides a short one. Known cases:

- `DEFAULT_ROOM_TIMER_FUNCTIONS` (`src/engine/roomTimers.ts:10`), a hardcoded copy of
  `d.Byte1596` that `roomTimerFunction` uses when it gets no table. Its two callers
  (`ActuatorSystem`, `DsaSystem`) pass `ctx.tables.byte1596`, a required field, so it
  looks unreachable. Confirm that, then delete it and the `| null`.
- `MonsterAttack.determineAttackOrder` returns `[0, 1, 2, 3]` when its `byte586` row is
  missing, with no warning (`src/engine/MonsterAttack.ts:790`).
- `levelUp` falls back to a fresh, unseeded `CsbRandom` when no stream is passed
  (`src/engine/skills.ts:328`), and `AdjustSkillsContext.random` is optional (`:64`). The
  engine passes `ctx.random`, but a tool that forgets it silently becomes unreproducible.
- `TimerSystem.applyBrightnessSteps` (`TimerSystem.ts:319`) returns silently when
  `word1074` is empty.

Then sweep for the rest: arrays and tables initialised empty, or read through a falsy
guard.

### F2 ⏳ No golden frame covers an edge decoration

None of the nine golden frames (`tools/frames/`) shows a wall decoration on an edge
position, where the position-7 geometry is special. `tools/dump-hall-of-champions.ts` pins the geometry that makes position 7 special across
all 8 rect sets: both edge slots are narrower than the bitmap, the front-left window ends
flush with its right edge, and the front-right one starts flush with its left edge. The
pixels themselves are still verified only by screenshot. A new frame needs a way to place
the party, which the probe does not have. That is the same missing affordance as the
"fixed set of party positions" in `PLAN.md` → Phase 15 step 2, so build it once for both.

### F3 — Phase 15 steps 3–5 stay in `PLAN.md`

The render probe, the table-extraction round-trip checks and the comparison against CSBWin
screenshots are a live phase, so they stay in `PLAN.md` → "Phase 15" rather than being
copied here. The never-executed validation steps of phases 2, 4, 5 and 7 are all folded
into it.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. They come last (see "Priority").

### G1 ⏳ DSA gaps, and the footprint decoration

- **Opcodes.** Unimplemented DSA opcodes and `&` subcodes are reported once each through
  `warnedOps` (`src/engine/DsaSystem.ts:1273`, `:1877`). Those warnings are the list.
  Slave DSAs are not implemented (`findMaster`, `:1909-1917`).
- **`STKOP_Throw`** (`DSA.cpp:4558`) is one of the missing opcodes, so
  `TimerSystem.throwMissile` (`ThrowMissile`, `Timer.cpp:2016`) has no caller. When the
  opcode is ported, re-port the function's missile-type switch first. CSBWin throws a spell
  only for the eight words it lists (`RNFireball` … `RNPoisonCloud`, `RNMonsterDeath`), and
  nothing for any other non-zero word (`Timer.cpp:2029-2040`). The port takes every word
  `>= 0xff80` as-is and maps the rest through `spellObjectId`. CSBWin also `LoadLevel`s the
  launch level around the launch (`:2065-2077`).
- **`STKOP_SetCurse`** (`DSA.cpp:3440-3456`) is another. It calls `SetCursed`
  (`Character.cpp:1782-1816`), which finds the champion carrying the object and brackets
  the curse change with `AdjustStatsForItemCarried(…, -1, …)` and `(…, +1, …)`, so a curse
  laid on a carried weapon costs 3 Luck at once. Port both together.
- **The footprint decoration.** `SummarizeRoomInfo`'s footprint arm
  (`Codea59a.cpp:401-424`) sets `decorations[2] |= 0x8000` when `SearchFootprints`
  (`CSBCode.cpp:7066`) finds a footprint between `d.IndexOfFirstMagicFootprint` and
  `d.IndexOfLastMagicFootprint` on the cell, or when the cell has the `ECF_FOOTPRINTS`
  extended cell flag. It is omitted at `src/renderer/csbwin/SummarizeRoomInfo.ts:515`. The
  DSA decoration gating (actuator type 47) is ported.

### G2 ⏳ Seven DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:110`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:336`).
- `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`). It counts each kill in `expool`'s
  statistics and, when the dungeon has an `ESL_DELETEMONSTERFILTER`, runs its type-47 DSA,
  which may set `deathCloud` and `dropResidue`. CSBWin calls it from `DamageMonster` with
  `DMW_Damage` (`Code11f52.cpp:1112`, `:1122`) and from `MoveObject`'s two deletions with
  `DMW_Movement1` / `DMW_Movement2` (`:3151`, `:3304`). The port's matching places are
  `MonsterDamage.ts:463` and `MonsterSystem.ts:531`.
- `MonsterAttackFilter`, which may rewrite a monster attack's whole parameter block
  (`MonsterAttack.ts:139`). C35 is about what it would see.
- `CallPartyMoveFilter` (`CSBCode.cpp:8119`), which may rewrite the stamina adjustments or
  refuse the move, with its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8122-8128`,
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:260`).
- `ActionNameFilter` (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8680`), which may rename an
  attack option. The names come straight from `AttackNames`.

### G3 ⏳ The wings

CSBWin keeps champions who have left the party in a store that `CHARDESC::GetFromWings` /
`SaveToWings` reach (`doc/CSBwin-src/Character.cpp:5239`). Two things consult it, and
cannot here:

- `CopyCharacter`, so bones dropped by a departed champion take no name;
- `ProcessTT_ViAltar` state 1, which heals such a champion to `MaxHP/2` and saves them
  back (`Timer.cpp:2769-2782`).

`Party.findChampionByFingerprint` is where both would grow their second half. This is a
feature to build, not a branch to port: nothing in the port ever removes a living champion
from the party.

### G4 ⏳ CSB extensions, malformed heroes, the monster design options

- `pcA3->talents`, which `Champion` has no field for;
- the `legalHero` fallback (`Character.cpp:475`), which clamps an out-of-range hero text
  and retries it against "BOGUS / ILLEGAL HERO", where `HeroExtractor` rejects it
  outright;
- external portraits for `charID > 23`.

No shipped DM hero touches any of these.

**The monster design options.** `DB4::invisible()` is gated on `invisibleMonsters`, and
`drawAsSize4()`, `Unique()` and `Poisoned()` on `drawAsSize4Monsters`
(`CSB.h:1125-1132`). Both options are read from a save's `extendedFlags`
(`SaveGame.cpp:394-400`, `false` by default). The port models neither: `CreatureRecord`
holds the raw bits, and `monster.drawAsSize4` is read ungated in
`TimerSystem.processMissileEncounter` (`TimerSystem.ts:1812`) and in `MonsterDamage`
(`:504`, `:540`). Only `monsterUnique` (`MonsterSystem.ts:69`) applies a gate, as a
constant `false`. Harmless for now, because no creature in `dm-atari/dungeon.dat` sets any
of bits 11-14. Modelling it means reading `extendedFlags & 0x02` / `& 0x04` in
`SaveGameLoader` and gating every accessor.

### G5 ⏳ The message scroll, message state in saves, the freeze

- **The scroll animation.** The pixel-level scroll (`d.PushTextUp` /
  `d.TextScanlineScrollCount`) is not implemented. Rows scroll instantly, and CSBWin's
  wait-for-animation guards are absent. `scrollingText.SetNewSpeed` goes with it: sleep and
  `WakeUp` call it to re-pace that animation (`doc/CSBwin-src/Mouse.cpp:1696`,
  `CSBCode.cpp:7053`).
- **`SCROLLING_TEXT::Serialize`**, the message state in save games
  (`doc/CSBwin-src/Data.h:1666`). Quick-load calls `discardText()` instead.
- **The freeze.** Sleep is ported (`MouseSystem.sleep`, `wakeUp(ctx)` in
  `src/engine/LoopState.ts`, `tools/dump-sleep.ts`); the freeze is not:
  - button 147 freezes and 148 thaws (`doc/CSBwin-src/Mouse.cpp:1731-1773`);
  - the frozen game's queue filter throws away every entry but 148 (`:1433-1444`);
  - the keys that reach them are missing too: Esc is 147 in the sleep-mode table
    `Byte18440` and 148 in the frozen one `Byte18448` (graphics.dat `0x231`). Asleep, the
    port swallows Esc.

  `UIMode.Frozen` is never entered.

Also: `tools/probe-ui.mjs --boot` still presses F8 for a random dev party, a key that no
longer exists, so it boots with an empty party. `tools/probe-frames.mjs` builds its party
at the Hall of Champions instead, and `--boot` should do the same.

### G6 ⏳ UI effects

- **Rune click flash** in the magic panel.
- **Interaction highlights**: button press and selection effects (flash, shading, invert)
  across UI regions, consistent with the hit-test rectangles.
- **`FlashButton`** on a movement arrow that was clicked or keyed. `MoveParty` returns the
  button and `HandleMouseEvents` flashes it (`doc/CSBwin-src/Mouse.cpp:1560-1567`).
- **The viewport flash on a blow**, and a light-level trace hook. `atk_LIGHT` itself works;
  this item is the flash, not the LIGHT attack.

### G7 — Save-format gaps stay in `PLAN.md`

Writing a CSBWin-compatible save is live work, so it stays in `PLAN.md` → "Phase 10"
rather than being copied here.

### G8 ⏳ Lord Chaos's fusion endgame

`_Fusion` (`doc/CSBwin-src/Attack.cpp:133`) and `_FusionSequence` (`:2220`) are not ported.
`atk_FUSE` runs its filter and does nothing else (`src/engine/AttackSystem.ts:28-30`). What
the fusion depends on is ported: the Fluxcage, `IsCellFluxcage`, `IsLordChaosHere`, and
`MonsterPerception`'s Fluxcage test. The code gives a reason for waiting ("it cannot be
exercised until Lord Chaos himself works"). Check whether it still holds, now that the
monsters are ported.

### G9 ⏳ Changing the marching order

Buttons 125-128, the four position squares at the top right of `buttons17196`, go to
`TAG0025a6` (`doc/CSBwin-src/Mouse.cpp:1586-1597`, `CSBCode.cpp:2053`). That function picks
up the champion at that position so the player can drag them to another square. The drag's
"cursor left the rectangle" event is button -1 (`Mouse.cpp:1800-1805`). The port queues
these buttons, and `handleMouseButton` (`src/renderer/ui/Mouse.ts`) drops them, so the
marching order cannot be changed.

### G10 ⏳ `StealFromCharacter`: the giggler steals nothing

A monster attack with `monsterShouldSteal` calls `StealFromCharacter`
(`doc/CSBwin-src/Monster.cpp:239`). The port spends the blow and takes nothing
(`MonsterAttack.ts:188-190`). Port it there, through `ctx.systems`, with a tool that has a
giggler rob a champion.

### G11 ⏳ `MakeMoreRoomInDB`: a full database refuses the record

`DungeonState.findEmptyDBEntry` (`src/engine/DungeonState.ts:528`) returns `null` once a
database holds 1024 records (`:535`). At that point CSBWin calls `MakeMoreRoomInDB`
(`doc/CSBwin-src/Character.cpp:182`) to make room. This cannot happen in the shipped
dungeons.

---

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

- 🚫 **The mirrored far-right sidewalls' `srcOffsetX`.** CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for positions 1 and 6
  (`doc/CSBwin-src/CSBCode.cpp:3542`), compensates for `MakeMirror` reversing a
  byte-aligned buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would
  shift a correctly aligned image. The reasoning is in the code.
- 🚫 **`CHARDESC.load` is recomputed** from the possessions, rather than cached and adjusted
  at each of CSBWin's eight possession writers. Same value, and it cannot drift. `Party.ts`
  made the same choice for `SetHandOwner`. Recorded in the module comment of
  `src/engine/CharacterStats.ts`.
- 🚫 **`_FlashAttackDamage` does not stop the game.** CSBWin's ends in `VBLDelay(15)`,
  which halts everything for a quarter of a second. The port shows the flash as a timed
  overlay of the same length while the game keeps running, as it already does for the
  feeding animation (`src/renderer/ui/Attack.ts`, module comment).
- 🚫 **Three inputs bypass the mouse queue:** the save menu and the Reincarnate screen,
  which are modal, and the panel keys in `src/renderer/ui/Keyboard.ts`, whose module
  comment gives the reason.
- 🚫 **The vertical-move guard** in `MoveParty` (`CSBCode.cpp:8200-8204`) is not ported,
  because CSBWin cannot reach it either. Move Up / Down (`0x1124` / `0x1125`) come only from
  the 3DMaze extension's `ThreeDMovements` keys and `GravityMove`, whose flags are
  initialised `false` (`data.cpp:239-240`) and assigned nowhere in the tree.
- 🚫 **The intro runs on wall-clock time** through `requestAnimationFrame`, not on a VBL
  counter shared with the game loop. Nothing else exists yet when it plays, so there is
  nothing for it to drift against. If a boot-time animation ever has to agree with `d.Time`,
  this is the place that would have to change.
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole intro.** This is a
  developer affordance with no CSBWin counterpart, kept deliberately: six of the nine golden
  frames boot through it.
- 🚫 **Custom skins / `BACKGROUND_LIB`.** The shipped DM dungeon uses no custom
  backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here, so
  the branch is dead (`src/engine/PeriodicUpdates.ts:88`).
- 🚫 **Audio sample rates**, a documented exception to faithfulness:
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- 🚫 **Crack Switch (In) placement.** `Byte4100[55]` is read as 2, not `graphics.dat`'s 0,
  so a pressed crack switch stays low on the wall as in the Atari ST original:
  `doc/PROVEN_FACTS.md` → "Crack Switch (In) placement".
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
