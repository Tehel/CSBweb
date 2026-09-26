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
| C46 | The cursor's viewport click reads `d.CellTypeJustAhead == 0` off the cell flags | S | ⏳ |
| C47 | Seven engine sounds bypass `QueueSound` | M | ⏳ |
| C48 | A Zokathra with both hands full is linked into the cell, not dropped | S | ⏳ |
| C49 | `PrepareAttack` does not refuse a busy champion | S | ⏳ |
| C50 | `DisableCharacterAction` refuses a delay of 0 | S | ⏳ |
| C51 | A restored timer queue is read as a sorted list, but CSBWin's is a heap | M | ⏳ |
| C52 | The attack hands are not shaded while a candidate is in the party | S | ⏳ |
| C53 | Five mouse handlers do not set `d.clockTick` | S | ⏳ |
| C54 | `extraTicks`: a turn or a step does not make a tick due | S | ⏳ |
| C57 | The party's arrival on another level runs at once, not at the top of the next tick | M | ⏳ |
| C58 | A turn does not lift and place the party | S | ⏳ |
| C59 | A missile leaving the map is dropped, not met as the exterior wall | S | ⏳ |
| C60 | Six other callers of `TAG02076e` / `TAG0207cc` do not call them | M | ⏳ |
| C61 | The dev quick-save writes an open chest empty | S | ⏳ |
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
| G12 | `SmartDiscard`: a filling database is not thinned | — | ⏳ |
| H | Deliberate divergences | — | 🚫 |

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C62 · D9 · E7 · F11 · G13. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## D — State representation

Empty. New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

Empty. New architecture debt goes here, and jumps the queue.

---

## C — Known divergences from CSBWin

Tiers D and E are empty, so these are taken in the index's order (see "Priority").

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
`src/engine/MouseSystem.ts:340`), two switches in `ActuatorSystem` (`:374`, `:509`), three
teleporters in `WorldMove.resolveCellEffects` (`:324`, `:341`, `:348`) and a door's step
in `TimerSystem` (`:743`). For the door button CSBWin queues
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
`restore` takes the saved array as the firing order (`src/engine/TimerQueue.ts:315`), and
`processTimers` stops at the first entry not yet due (`src/engine/TimerSystem.ts:87-111`).
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

### C53 ⏳ Five mouse handlers do not set `d.clockTick`

The port models `d.clockTick` as `ctx.loop.clockTickSet` (`= 1`: a tick runs in this VBL)
and `clockTickCleared` (`= 0`: a tick that was due waits a VBL), in `src/engine/LoopState.ts`.
`WakeUp`, a refused move, the door button and `TouchWallF1` write them. Five more handlers
that the mouse queue runs write `d.clockTick` in CSBWin, and their counterparts write
neither flag:

- `ShowHideInventory` sets it to 1 once it has passed its dead-champion and
  pressed-eye/mouth returns (`doc/CSBwin-src/CSBCode.cpp:7441`).
- `TAG01a148`, the pick-up from the floor, ends with `d.clockTick = 1` (`Mouse.cpp:840`),
  which its early returns skip.
- `DropObject` ends the same way (`Mouse.cpp:964`).
- The attack menu, `_TAG019fac`, sets it to `ExecuteAttack`'s result
  (`Character.cpp:4716-4717`): 0 puts a due tick off, and 1 or a pass's -1 makes one due.
- The cast button, in `_MagicSelection`, sets it to `CastMagic`'s result (`Magic.cpp:564`).

Set the flags where each of these lands in the port. Evidence: a row per handler in
`tools/dump-mouse-queue.ts` case 9, counting the frames from the click to the next tick.

### C54 ⏳ `extraTicks`: a turn or a step does not make a tick due

`_TurnParty` and `MoveParty` open with `if (extraTicks) d.clockTick = 1;`
(`doc/CSBwin-src/CSBCode.cpp:7866-7869`, `:8084-8087`), so every turn and step runs a tick
in the VBL that handles it. `extraTicks` is CSBWin's "Extra Ticks" menu option
(`OPT_EXTRATICKS`, `CSBUI.cpp:987-988`), initialised `true` (`data.cpp:279`) and turned off
only for the playback of a recording (`CSBUI.cpp:964`, `:2160`, `:2201`) or by a recording's
`#NoExtraTicks` line (`Recording.cpp:300-303`). The port follows CSBWin's option defaults
(`DM_rules`, `src/engine/HallOfChampions.ts:251`), so `extraTicks` is on. The port's
`MovementSystem` sets neither flag for a turn or a step that goes through. Set
`clockTickSet` at the top of both. Evidence: a row in `tools/dump-mouse-queue.ts` counting
the frames from an arrow click to the next tick.

### C57 ⏳ The party's arrival on another level runs at once, not at the top of the next tick

When a `MoveObject` of the party ends on another level, CSBWin sets `d.newPartyLevel` and
presses no pads (`doc/CSBwin-src/Code11f52.cpp:3319-3324`), and `TraverseStairway` sets it
too (`CSBCode.cpp:7775`). The main loop acts on it at the top of the next tick, or at once
after `ProcessTimers` when a timer moved the party (`CSBCode.cpp:618-623`, `:635`):
`LoadPartyLevel`, then `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)`, which takes the
party through its square again, leaves a second footprint and presses the pads, then
`DiscardAllInput`. Until then `d.partyLevel` is the old level while `d.partyX` and
`d.partyY` are already the new square's. The port runs the load and the second
`MoveObject` from inside the move, in `WorldMove.arriveOnPartyLevel`
(`src/engine/WorldMove.ts:124`), and leaves only the discard to the tick
(`MonsterSystem.loadPartyLevelOnArrival`, `Game.loadNewPartyLevel`). So whatever runs
between the move and that tick sees the new level loaded, its groups attached and its pads
pressed, where CSBWin's sees the old party level: the rest of the timers in the pass that
moved the party, for one, since `ProcessTimers` does not test `d.newPartyLevel`. Porting
it means a pending level that `Game.loadNewPartyLevel` acts on, and a `party.position` that
can hold CSBWin's half-moved state without the renderer drawing it (CSBWin draws only after
the check, `CSBCode.cpp:635-639`). Evidence: a check that drops the party down a pit from a
timer with a second timer due in the same pass, and records the level the second one sees.

### C58 ⏳ A turn does not lift and place the party

Off the stairs, `_TurnParty` brackets its `SetPartyFacing` with
`PlaceOrRemoveObjectInRoom(d.partyX, d.partyY, RN(RNnul), true, 0)` before and
`(…, true, 1)` after (`doc/CSBwin-src/CSBCode.cpp:7912-7934`), so the pads under the party
see it leave and come back, with `unchangedRoom` true, facing the new way. The port's turn,
`MovementSystem.handleTurn` (`src/engine/MovementSystem.ts:109`), only sets the facing.
Add the pair around it. Evidence: a row in `tools/dump-party-move.ts` case 7 with the two
calls.

### C59 ⏳ A missile leaving the map is dropped, not met as the exterior wall

When the cell a missile flies into is off the map, CSBWin's `MissileTimer` makes it
`roomEXTERIOR` (`doc/CSBwin-src/Timer.cpp:329`), which counts as stone (`:340`), so the
missile meets it through `ProcessMissileEncounter(nextRoomType, …)` (`:351-364`). That
runs filter 6 (`Code11f52.cpp:1841-1843`) and goes on into the shared tail
(`:2044-2121`), where a spell becomes its cloud (`CreateCloud`, `:2099`). The port's
`processMissileTimer` meets nothing off the map: it drops the missile through
`processObjectFromMissile` (`src/engine/TimerSystem.ts:1409-1414`), so filter 6 never runs
and a fireball ends without its explosion. `processMissileEncounter`'s arm for the
exterior, `case 8` (`src/engine/MissileEncounter.ts:287`), is unreachable. Pass the
exterior to the encounter as CSBWin does. Evidence: a check that flies a fireball off an
open cell on a map's border and looks for its cloud.

### C60 ⏳ Six other callers of `TAG02076e` / `TAG0207cc` do not call them

The pair is ported as `tag02076e` and `tag0207cc` (`src/renderer/ui/Mouse.ts`), and only the
save menu calls it. CSBWin calls it from six more places, and the port's counterparts do
neither half:

- Sleep, button 145: `TAG02076e` after the inventory is hidden
  (`doc/CSBwin-src/Mouse.cpp:1691`). Port: the UI's sleep click, then `MouseSystem.sleep`
  (`src/engine/MouseSystem.ts:362`).
- `WakeUp`: `TAG0207cc` last (`CSBCode.cpp:7061`). Port: `wakeUp`
  (`src/engine/LoopState.ts:41`).
- `AddCharacter`: `TAG02076e` after `ShowHideInventory` shows the candidate
  (`Character.cpp:796-797`). Port: `HallOfChampions.addCharacter`
  (`src/engine/HallOfChampions.ts:85`).
- `_ResurrectReincarnateCancel`: `TAG0207cc` after a cancel (`CSBCode.cpp:6657`) and after a
  resurrection or reincarnation (`:6808`). Port: `HallOfChampions.resurrectReincarnateCancel`
  (`:142`).
- The main loop: the pair back to back, about every ten seconds, while `d.Word11722` is
  non-zero (`CSBCode.cpp:766-774`). The port does not model `d.Word11722`.

What each misses is the halves' state: `SetCursorShape(0)`, the arrow cursor until
`TAG0207cc`'s `TAG002572` puts it back (while asleep, for one); the caster selected again;
`d.Word20252 = 1` when no attack menu is open; the inventory shown again. The freeze's
pair (`Mouse.cpp:1736`, `:1765`) goes with the freeze (G5). Call the pair at each site, and
move `drawCursorItem`'s arrow, which tests the save menu, onto a cursor-shape state the pair
sets and clears. Evidence: a check per site, in `tools/dump-sleep.ts` and
`tools/dump-hall-of-champions.ts`.

### C61 ⏳ The dev quick-save writes an open chest empty

An open chest's objects are out of its chain until it is repacked (`doc/PROVEN_FACTS.md` →
"The disk menu saves an open chest packed"). The disk menu repacks it before a save
(`tag02076e`), but the dev quick-save (`quickSave`, `src/dev.ts:99`) builds its payload
straight from the game, so a quick-save made with a chest open restores the chest empty
and its objects nowhere. CSBWin has no quick-save; its only save repacks. Repack before
the payload is built and open the chest again after, as the disk menu does. Evidence: a
check that quick-saves over an open chest and restores it.

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
- `TimerSystem.applyBrightnessSteps` (`TimerSystem.ts:274`) returns silently when
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
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:240`).
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
`MissileEncounter.processMissileEncounter` (`MissileEncounter.ts:371`) and in `MonsterDamage`
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

### G12 ⏳ `SmartDiscard`: a filling database is not thinned

CSBWin's main loop calls `SmartDiscard(false)` on every tick
(`doc/CSBwin-src/CSBCode.cpp:678`), and the game start (`:10636`) and the tail of a save
(`SaveGame.cpp:1245`) call `SmartDiscard(true)`, which starts it over on a new database
(`SmartDiscard.cpp:747-757`). Each call does one step of a cycle through the misc, weapon
and clothing databases (`:764-793`): count the records in use, fifty a step, and once the
count reaches three quarters of the database's maximum (`:805-821`), scan the dungeon for
objects and discard them in priority order. None of it is ported. `Game.saveWritten`, the
save's tail, leaves out its `SmartDiscard(true)`.

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
