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
  guesses.

The order, then:

1. **D and E.** New structural debt goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** Frozen while D and E have items: a divergence
   found along the way is recorded here and not fixed, unless it blocks the D/E item at
   hand or corrupts saves. Taken in the index's order, unless the author pulls another
   forward.
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
   moves. Better still, and expected for any split of a module: every tool's full output is
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
| C37 | A door button or a touched wall does not set `d.clockTick` | S | ⏳ |
| C38 | `SetTimer`'s sequence repack at 0xffff is not ported | S | ⏳ |
| C39 | `MonsterAI`'s copy of `d.MonsterDamageResult` is never 1 | S | ⏳ |
| C40 | `CheckMoveFromMissile` uses the missile timer's filter state | S | ⏳ |
| C41 | The party's `MoveObject` is put together at four call sites | M | ⏳ |
| C42 | The missile timer puts its own `MoveObject` together | S | ⏳ |
| C43 | `CheckMonsterVersusMissiles` masks the positions byte | S | ⏳ |
| C44 | The save menu's `TAG02076e` and `TAG0207cc` hooks are set by nobody | S | ⏳ |
| C45 | Saving does not re-attach the monsters | S | ⏳ |
| C46 | The cursor's viewport click reads `d.CellTypeJustAhead == 0` off the cell flags | S | ⏳ |
| C47 | Seven engine sounds bypass `QueueSound` | M | ⏳ |
| C48 | A Zokathra with both hands full is linked into the cell, not dropped | S | ⏳ |
| C49 | `PrepareAttack` does not refuse a busy champion | S | ⏳ |
| C50 | `DisableCharacterAction` refuses a delay of 0 | S | ⏳ |
| C51 | A restored timer queue is read as a sorted list, but CSBWin's is a heap | M | ⏳ |
| C52 | The attack hands are not shaded while a candidate is in the party | S | ⏳ |
| F1 | Silent fallbacks for tables that are always there | S | ⏳ |
| F2 | No golden frame covers an edge decoration | M | ⏳ |
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1 | DSA gaps, and the footprint decoration | — | ⏳ |
| G2 | Nine DSA filters | — | ⏳ |
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

## D — State representation

Empty. New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

Empty. New architecture debt goes here, and jumps the queue.

---

## C — Known divergences from CSBWin

Tiers D and E are empty, so these are taken in the index's order (see "Priority").

### C37 ⏳ A door button or a touched wall does not set `d.clockTick`

CSBWin's door button sets `d.clockTick = 1` before queueing the sound and the `TT_DOOR`
timer (`doc/CSBwin-src/Mouse.cpp:1078`), so the door starts moving on the next VBL.
`TouchWallF1` sets `d.clockTick = TouchWall(...)` (`Mouse.cpp:788`), and `TouchWall`
returns 0 (`:315`) unless it worked a wall switch (`:537-539`). So a switch that fired makes
a tick due at once, and a touch that fired nothing clears a due tick, the way an inhibited
move does (the port's `ctx.loop.clockTickCleared`). Only a cell ahead that is off the map
leaves `d.clockTick` alone (`:784-787`). The port's `MouseSystem.handleDoorSwitchClick`
and `handleWallClick` (`src/engine/MouseSystem.ts:304-338`, `:282-286`) set neither flag, so a door
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
each stamp (`src/engine/RuntimeSave.ts:298`, `:337`). After 65535 queued timers the port's
stamps no longer match CSBWin's, and two timers on either side of the wrap swap their tie
order across a save and a load. Port the repack. Evidence: a `tools/` check that queues
past 0xffff and compares the stamps, and the queue order, before and after a save.

### C39 ⏳ `MonsterAI`'s copy of `d.MonsterDamageResult` is never 1

CSBWin's monster shuffle calls `CheckMonsterVersusMissiles` and then moves the monster to
its new corner only `if (d.MonsterDamageResult != 1)` (`doc/CSBwin-src/Monster.cpp:3955-3970`):
a missile that killed some of the group but not all leaves its corners as they were. The
port's test (`src/engine/MonsterAI.ts:616`) reads `MonsterAI.lastDamageResult`, a copy of
`d.MonsterDamageResult` that `MonsterAI.checkMonsterVersusMissiles` sets at its end from
whether the group was wiped out (`:1186-1189`): 2 if it was, 0 otherwise, never 1.
So the test always passes, and the monster takes the new corner. Delete the copy and read
`d.MonsterDamageResult` where the encounter writes it (`MissileEncounter.monsterDamageResult`).
Evidence: a check that parks a missile in the corner a
two-monster group shuffles to, with damage enough to kill one of them.

### C40 ⏳ `CheckMoveFromMissile` uses the missile timer's filter state

CSBWin's `CheckMoveFromMissile` (`doc/CSBwin-src/Code11f52.cpp:2530-2776`) neither reads nor
writes `missileFilterObject` / `missileFilterTimer`, the globals `MissileTimer` fills
(`Timer.cpp:176-177`, `:220-221`). The port's `MissileEncounter.checkMoveFromMissile`
(`src/engine/MissileEncounter.ts:88`) does both:

- It returns at once while `missileFilterObject` is set (`:89`), so a move made while a
  missile's own timer runs checks no missiles, where CSBWin's checks them.
- It points both at each missile it resolves, and clears them after (`:162-173`). CSBWin
  never clears `missileFilterTimer`, only `missileFilterObject` at each of `MissileTimer`'s
  exits, so `MissileEncounterFilter`'s parameter 6, `BITS10_11(missileFilterTimer.timerWord8())`
  (`Code11f52.cpp:1681`), is the direction of the last missile `MissileTimer` ran. The
  port's is the struck missile's own direction in `checkMoveFromMissile`, and 0 in
  `checkMonsterVersusMissiles` (`TimerSystem.clearMissileFilterState`, `TimerSystem.ts:1505`,
  then `?? 0` at `MissileEncounter.ts:440`). Only a dungeon with a missile encounter
  filter can see this half.

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
`AttackSystem.climbDownIntoPit` (`:1353`), `DsaSystem.teleportParty` (`:3028`) and
`TimerSystem.wiggleParty` (`:1758`). They do not agree:

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

Port the party path of `MoveObject` once, in `WorldMove`, in CSBWin's order, and
route the four through it. Evidence: a check per call site that moves the party past a
missile and onto a pit, compared with the order above.

### C42 ⏳ The missile timer puts its own `MoveObject` together

CSBWin's `MissileTimer` moves its missile into the next cell with the world
`MoveObject(missileFilterObject, origMapX, origMapY, curMapX, curMapY, NULL, NULL)` and
reads the result back from `d.NewX`, `d.NewY` and `d.NewDir`
(`doc/CSBwin-src/Timer.cpp:383-390`). The port's `TimerSystem.processMissileTimer` does not
call `WorldMove.moveObject`. It runs the teleporter loop through
`WorldMove.resolveMissileMove`, with the direction it holds, and unlinks and relinks the
missile itself (`TimerSystem.ts:1421-1431`). `moveObject` has a missile arm of its own,
which reads the direction from the timer the missile record names (`WorldMove.ts:161-165`).
Whether the two ever give a different result is not verified. Move the missile through
`moveObject`, as CSBWin does, and delete `resolveMissileMove`. Evidence: a check that flies
a missile through a rotating teleporter and compares its cell, corner and direction.

### C43 ⏳ `CheckMonsterVersusMissiles` masks the positions byte

Both of CSBWin's calls pass the group's whole positions byte, `pI16A2->positions()`, as
`position` (`doc/CSBwin-src/Monster.cpp:3882`, `:3960`), and the scan skips every missile
whose `objD6.pos() != position` (`:4478`). `RN::pos()` is 0-3 (`CSBTypes.h:331-335`), so a
missile is met only while bits 2-7 of the byte are all 0, and never by a centred lone
monster (255). The port's `MonsterAI.checkMonsterVersusMissiles` compares the corner with
`positions & 3` (`src/engine/MonsterAI.ts:1174`), so wherever those bits are set it meets
the missiles in that corner, which CSBWin lets through. Compare the whole byte. Evidence: a
check that parks a missile in corner 3 of a centred lone monster's cell and runs its turn.

### C44 ⏳ The save menu's `TAG02076e` and `TAG0207cc` hooks are set by nobody

`openSaveMenu` and `closeSaveMenu` call `ui.onEnterMenu` and `ui.onLeaveMenu`
(`src/renderer/ui/SaveMenu.ts:161`, `:184`), CSBWin's `TAG02076e` and `TAG0207cc`, but
nothing assigns either hook (`src/renderer/ui/UIState.ts:184-186`), so neither runs.
`GameScreen.presentViewport` shades the three panels while the menu is up, which is
`TAG02076e`'s drawing half. The rest is not ported:

- `TAG02076e` (`doc/CSBwin-src/Character.cpp:5108-5135`) repacks the open chest when the
  inventory shows one (`d.DisplayResurrectChestOrScroll == 4`, `:5124`), through
  `RepackChest` (`:3108`, the port's `repackOpenChest`). It also sets the cursor
  shape to 0 (`:5133`), and does nothing at all while the party sleeps (`:5111`).
- `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:9934-9968`) re-selects the magic caster
  (`:9945-9947`), sets `d.Word20252 = 1` when no attack menu is open (`:9950`), and redraws
  the attack options and the inventory. The port redraws every frame, so only the state
  changes can matter.

Port both into the UI, call them from the save menu, and delete the two hooks. Evidence: a
check that opens the menu over an open chest.

### C45 ⏳ Saving does not re-attach the monsters

Once the file is closed, CSBWin's save detaches every active group and runs
`ProcessMonstersOnLevel` (`doc/CSBwin-src/SaveGame.cpp:1237-1245`), so that the game
played on after a save is the one a restore of it gives back. A restore re-attaches the
same way, through the game start's `LoadPartyLevel(d.partyLevel)`
(`doc/CSBwin-src/CSBCode.cpp:10491`). The port re-attaches on a load
(`MonsterSystem.reloadAfterSaveGame`, from `applyRuntimeSaveState`) but not on a save:
`getRuntimeSaveState`, which the quick-save and `buildSavePayload` both call, leaves the
monsters alone. So a game played on after a save keeps its monsters' movement timers and
`singleMonsterStatus` mirror bits, and its place in the random stream, where CSBWin's
re-creates the timers and re-rolls the bits, drawing from the stream as it does. Re-attach
after the save, in the save paths rather than in `getRuntimeSaveState`, which tools call
just to read the state. Evidence: a check that plays on after a save beside a load of that
save, frame for frame, and compares the monsters' timers and `singleMonsterStatus`.

### C46 ⏳ The cursor's viewport click reads `d.CellTypeJustAhead == 0` off the cell flags

With an object in hand, `HandleClickInViewport` takes its stone arm (the two near drop
areas, then button 5 for the wall, an alcove or a fountain) when `d.CellTypeJustAhead == 0`
(`doc/CSBwin-src/Mouse.cpp:1165`). That is `roomData[17].roomType` as `SummarizeRoomInfo`
leaves it (`Viewport.cpp:6782-6785`), and a false wall summarises as stone while it is not
open, `(cf & 4) == 0` (`Codea59a.cpp:278-279`). The port's `resolveViewportCursorAction`
(`src/renderer/ui/ViewportPicking.ts:94`) tests `isFrontCellStoneOrVisibleFalseWall`
instead, which also wants a false wall not to be imaginary, `(cf & 5) == 0`: the
bare-stone sound's test (`Mouse.cpp:1146-1147`), not this one. So before a closed imaginary
false wall (level 2, (7,9), `cf` 0xc1, in the shipped dungeon) CSBWin takes the stone arm
and the port the open one, with its throw and four drop areas. Test
`ui.context.roomData[17].roomType`, as `resolveEmptyHandedViewportClick` does. Evidence: a
row in `tools/dump-viewport-click.ts` with an object in hand before (7,9).

### C47 ⏳ Seven engine sounds bypass `QueueSound`

The engine's sounds go through `SoundQueue.queueSound`, CSBWin's `QueueSound`
(`doc/CSBwin-src/CSBCode.cpp:1819`), which looks the ordinal up in `d.sound1772` and
attenuates it by the distance to the party. Seven calls play a `SoundIndex` item through
`ctx.host.playSound` instead: the door button (`MouseSystem.handleDoorSwitchClick`,
`src/engine/MouseSystem.ts:327`), two switches in `ActuatorSystem` (`:375`, `:510`), three
teleporters in `WorldMove.resolveCellEffects` (`:296`, `:313`, `:320`) and a door's step
in `TimerSystem` (`:751`). For the door button CSBWin queues
`QueueSound(1, d.partyX, d.partyY, 1)` (`Mouse.cpp:1079`), and ordinal 1 is item 534,
`SoundIndex.SWITCH`, the sample the port plays. The CSBWin calls behind the other six are
not yet read. All seven escape whatever `QueueSound` does that the host does not: the
sound table's distances today, and its delayed sounds and `SoundFilter` once they are
ported (`SoundQueue`'s module comment). Read each site's CSBWin call and queue its ordinal.
Evidence: a check per site that records the ordinal queued.

### C48 ⏳ A Zokathra with both hands full is linked into the cell, not dropped

When neither of the caster's hands is empty, CSBWin's Zokathra drops the new object into
the party's cell with `MoveObject(obj_2, -1, 0, d.partyX, d.partyY, NULL, NULL)`, on the
party's level (`doc/CSBwin-src/Magic.cpp:1380-1387`), so it presses a pad there as any
drop does. The port's `MagicSystem` links it in with `DungeonState.addObjectToCell`
(`src/engine/MagicSystem.ts:334-338`), which triggers nothing, and deletes the record if
that fails, a case CSBWin does not have. Drop it with `WorldMove.moveObject(obj, -1, 0, …)`,
as `CharacterSystem.dropAllPossessions` does. Evidence: a check that casts Zokathra with
both hands full on a pressure pad.

### C49 ⏳ `PrepareAttack` does not refuse a busy champion

CSBWin's `PrepareAttack` returns at once when the champion has `CHARFLAG_attackDisable` set
(`doc/CSBwin-src/Character.cpp:4916`), so a click on a shaded hand, or its attack key,
opens no menu. The port's `prepareAttack` (`src/renderer/ui/Attack.ts:129-134`) tests only
health, and neither caller (`Attack.ts:212`, `src/renderer/ui/Keyboard.ts:120`) nor
`executeAttack` tests more, so a busy champion's menu opens, and an option picked from it
attacks again before the busy timer has fired. Test `CHARFLAG_ATTACK_DISABLE` in
`charFlags`, as `drawAttackButton` does. Evidence: a check that attacks, then clicks the
same hand at once.

### C50 ⏳ `DisableCharacterAction` refuses a delay of 0

CSBWin's `DisableCharacterAction` (`doc/CSBwin-src/Magic.cpp:502-537`) has no guard on
`timeDelay`. A delay of 0 queues a `TT_11` due at `d.Time`, and for a champion who is
already busy it replaces the busy timer with one due at the same time (`:517-525`), whose
`timerUByte6`, the slot a throw refills, is 0 (`:512`). The port's
`MagicSystem.disableCharacterAction` returns on `timeDelay <= 0`
(`src/engine/MagicSystem.ts:484`). No shipped path passes 0 or less: every spell in
`dm-atari/graphics.dat` has a disable time of 12 to 63 (`BITS10_15(word6)`,
`Magic.cpp:1399`), an attack disables only when its time is non-zero (`Attack.cpp:2149`),
and a throw turns a negative time into 4 (`Mouse.cpp:723`). Such a time comes only from a
filter (G2) or another game's spell table. Remove the guard. Evidence: a check that
disables a champion for 0 ticks, once idle and once busy.

### C51 ⏳ A restored timer queue is read as a sorted list, but CSBWin's is a heap

CSBWin's `m_timerQueue` is a binary min-heap over `TIMER::operator<`
(`doc/CSBwin-src/Timer.cpp:765-810`). `SetTimer` appends the new timer and sifts it
(`:1200-1202`, `AdjustTimerQueue` at `:831-896`), `GetNextTimerEntry` takes
`m_timerQueue[0]` (`:1222-1235`), and `DeleteTimer` moves the last entry into the hole and
sifts it (`:959-984`). `LoadGame` reads the array back as it was written
(`SaveGame.cpp:1693-1699`). The port's `TimerQueue` is a sorted array instead: `addTimer`
and `reprioritizeTimer` insert in order, `shiftNext` and `deleteTimer` shift and splice,
`restore` takes the saved array as the firing order (`src/engine/TimerQueue.ts:273`), and
`processTimers` stops at the first entry not yet due (`src/engine/TimerSystem.ts:95-119`).
`searchOrder`, `TIMER_SEARCH`'s walk from the end of the array, which decides which
duplicate `SetTimer` keeps, then visits the timers in another order than CSBWin's.

Every committed save's queue is heap-ordered by time, and none with more than two timers is
sorted (33 of `csbgame7.dat`'s 76 entries follow a later one). So a loaded game fires its timers
out of order, and a due timer waits behind later ones: IAIDO's `TT_11` in `csbgame6.dat`,
due at the saved `d.Time`, fires 17 ticks after the load. The port's own insertions and
deletions then work on an array that is neither sorted nor a heap, and the save writer
carries that array as the queue (`src/engine/SaveGamePayload.ts:241`), which CSBWin would
read as a heap. Port the heap, so the port writes back the array CSBWin would. Evidence: a
check that loads `csbgame7.dat` and compares the order the timers fire in with the heap's
`operator<` order.

### C52 ⏳ The attack hands are not shaded while a candidate is in the party

CSBWin's `DrawAttackButton` shades the hand while `d.PotentialCharacterOrdinal` is set,
as it does for a busy champion and a sleeping party (`doc/CSBwin-src/Character.cpp:4875-4880`),
so a champion being considered at a Hall of Champions mirror, once `DrawCharacterState`
draws them (`:1500-1503`), shows a shaded hand. The port's `drawAttackButton`
(`src/renderer/ui/Attack.ts:305`) tests only the busy bit and sleep. Add
`potentialChampionIndex >= 0`. Evidence: a check or a golden frame of a candidate's
attack hand.

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
  missing, with no warning (`src/engine/MonsterAttack.ts:793`).
- `levelUp` falls back to a fresh, unseeded `CsbRandom` when no stream is passed
  (`src/engine/skills.ts:328`), and `AdjustSkillsContext.random` is optional (`:64`). The
  engine passes `ctx.random`, but a tool that forgets it silently becomes unreproducible.
- `TimerSystem.applyBrightnessSteps` (`TimerSystem.ts:282`) returns silently when
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
  `warnedOps` (`src/engine/DsaSystem.ts:1261`, `:1865`). Those warnings are the list.
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

### G2 ⏳ Nine DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:110`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:333`).
- `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`). It counts each kill in `expool`'s
  statistics and, when the dungeon has an `ESL_DELETEMONSTERFILTER`, runs its type-47 DSA,
  which may set `deathCloud` and `dropResidue`. CSBWin calls it from `DamageMonster` with
  `DMW_Damage` (`Code11f52.cpp:1112`, `:1122`) and from `MoveObject`'s two deletions with
  `DMW_Movement1` / `DMW_Movement2` (`:3151`, `:3304`). The port's matching places are
  `MonsterDamage.ts:463` and `MonsterSystem.ts:540`.
- `MonsterAttackFilter`, which may rewrite a monster attack's whole parameter block
  (`MonsterAttack.ts:146`). CSBWin's block is a file-scope global
  (`doc/CSBwin-src/Monster.cpp:917-938`), and `MonsterAttacks` never writes its
  `disableTime`, which no C++ reads, so a filter sees the value the last filter left there.
  The port builds a fresh block each attack, with `disableTime` 0.
- `CallPartyMoveFilter` (`CSBCode.cpp:8119`), which may rewrite the stamina adjustments or
  refuse the move, with its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8122-8128`,
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:260`).
- `ActionNameFilter` (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8680`), which may rename an
  attack option. The names come straight from `AttackNames`.
- `CursorFilter` (`ESL_CURSORFILTER`, `MoveObject.cpp:797`), which may cancel what is
  about to happen to the object on the cursor. CSBWin sends it a packet from 21 places.
  The port sends six of the packet types, all from `ActuatorSystem` (the key, the torch
  holder, the swap, the gift), to `GameHost.cursorFilter`, which `main.ts` answers with a
  debug trace. None of the other types is sent, among them `HandleClothingClick`'s
  `PlaceOnCharacter`, which may cancel the click, and `PickFromCharacter`
  (`CSBCode.cpp:6966-6972`, `:6982-6991`).
- `ESL_EQUIPFILTER`, which `CHARDESC::SetPossession(…, true)` runs before it writes the
  slot, once with timer function 1 for the object leaving and once with 0 for the object
  arriving (`Character.cpp:2917-2998`). Both halves of the pair write through it
  (`:1850`, `:1962`). The port's pair writes with `CharacterSystem.setPossessionDirect`.

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
`MissileEncounter.processMissileEncounter` (`MissileEncounter.ts:356`) and in `MonsterDamage`
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
(`MonsterAttack.ts:195-197`). Port it there, through `ctx.systems`, with a tool that has a
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
