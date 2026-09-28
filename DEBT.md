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
   byte-identical before and after (only `dump-save-menu`, by one byte, and
   `dump-savegame`, by its payload's size, vary on their own: both carry the save's
   wall-clock date), and the author's runtime saves hash the same after load and
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
| C65 | The host takes a sound's volume from its SND item, not its ordinal | S | ⏳ |
| C66 | A delayed sound plays at once | S | ⏳ |
| C67 | The timer table has no size, and a save writes it too small | S | ⏳ |
| C68 | `d.Time` moves on before the timers, not after them | M | ⏳ |
| C69 | A step, a drop and a pick-up run the timers at once | S | ⏳ |
| C70 | The top view of positions has a square for nobody | S | ⏳ |
| C71 | A resumed game has no "GAME LOADED, READY TO PLAY." | S | ⏳ |
| C73 | A room's message decodes without the escape tables | S | ⏳ |
| C74 | A keyed attack makes no tick due | S | ⏳ |
| C75 | A generator makes its group on the party's level | S | ⏳ |
| F1 | Silent fallbacks for tables that are always there | S | ⏳ |
| F2 | No golden frame covers an edge decoration | M | ⏳ |
| F11 | `probe-ui.mjs --boot` boots with an empty party | S | ⏳ |
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1 | DSA gaps, and the footprint decoration | — | ⏳ |
| G2 | Ten DSA filters | — | ⏳ |
| G3 | The wings | — | ⏳ |
| G4 | CSB extensions, malformed heroes, the monster design options | — | ⏳ |
| G6 | UI effects | — | ⏳ |
| G7 | Save-format gaps | — | in `PLAN.md` |
| G10 | `StealFromCharacter`: the giggler steals nothing | — | ⏳ |
| G11 | `MakeMoreRoomInDB`: a full database refuses the record | — | ⏳ |
| G12 | `SmartDiscard`: a filling database is not thinned | — | ⏳ |
| H | Deliberate divergences | — | 🚫 |

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C76 · D9 · E7 · F12 · G14. An ID recorded and paid in one commit has no
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

### C65 ⏳ The host takes a sound's volume from its SND item, not its ordinal

CSBWin's `QueueSound` makes the volume from the ordinal's own entry, loud at or below
`byte6` and quiet below `byte7` (`LOCAL_12`, `doc/CSBwin-src/CSBCode.cpp:1867-1876`), and
hands `StartSound` that choice (`:1894-1896`), which attenuates a quiet sound 18 times
(`Sound.cpp:663`). The port's `SoundQueue` hands the host the distance instead, and
`SoundManager.getDistanceVolume` (`src/audio/SoundManager.ts`) looks the thresholds up
again by SND item, in a catalog where the last ordinal to name an item wins
(`buildSoundCatalog`, `src/audio/soundsIndex.ts`). Ordinals 5 and 20 both name item 537
(`doc/PROVEN_FACTS.md` → "`QueueSound`'s argument is an ordinal into the sound table"), so
a big explosion, ordinal 5 (`byte6` 3, `byte7` 7), plays with ordinal 20's 0 and 4: quiet
one to three squares away, where CSBWin's is loud, and silent four to six away, where
CSBWin's is quiet. Every other item has one ordinal. Hand the host `LOCAL_12`, not the
distance. Evidence: a row in `tools/dump-queue-sound.ts` for ordinal 5 three squares away.

### C66 ⏳ A delayed sound plays at once

With `deltaTime > 1`, CSBWin's `QueueSound` sets a `TT_20` timer due at
`d.Time + deltaTime - 1` instead of playing (`doc/CSBwin-src/CSBCode.cpp:1832-1848`), and
`ProcessTimers` queues the sound again, with `deltaTime` 1, when it fires (`:6485-6492`).
The port's `SoundQueue.queueSound` plays it at once, and `TimerSystem.dispatch` has no
`TT_20` arm, so a `TT_20` in a CSBWin save is dropped. The delayed callers are the door
bash (`src/engine/AttackSystem.ts:1258`), a champion's wound
(`src/engine/MonsterAttack.ts:394`) and a monster's death (`src/engine/MonsterDamage.ts:212`,
`:325`), whose delay varies. Queue the timer, and give `TimerSystem` the arm. Evidence: a
check that queues a sound with `deltaTime` 2 and finds it played a tick later.

### C67 ⏳ The timer table has no size, and a save writes it too small

CSBWin's timer table has a size, `m_maxTimers`. A new game allocates 100 slots and one more
per record of the monster database and of each database from the missiles on
(`doc/CSBwin-src/SaveGame.cpp:2549`, `:2612-2616`), 467 in every committed save, and a save
carries it as `gb2.MaxTimers`, which `LoadGame` allocates (`:1638`). `SetTimer` checks it
first: once `m_numTimer >= m_maxTimers - 5`, it moves `m_firstAvailTimer` to `m_maxTimers`,
past every hole, and enlarges the table to `(m_maxTimers+10)*5/4` (`Timer.cpp:1001-1010`).
The port's `TimerQueue` has no size: `addTimer` always takes the lowest free slot, and a save
writes `MaxTimers` as one past the highest live slot (`buildTimerRecords`,
`src/engine/RuntimeSave.ts`; `maxTimers`, `src/engine/SaveGamePayload.ts:245`, `:302`). So a
table CSBWin reads back from a port save is nearly full, and its next `SetTimer` jumps past
the holes, and a game that fills its table numbers the slots that follow differently. A slot
is what `busyTimerIndex` holds, and the last tie-break of `timerLess`. Keep the size, read
from the save and grown as `SetTimer` grows it. Evidence: a check that a save written from
`csbgame7.dat` carries `MaxTimers` 467, and one that fills a table to the jump.

### C68 ⏳ `d.Time` moves on before the timers, not after them

CSBWin's tick runs `ProcessTimers()` (`doc/CSBwin-src/CSBCode.cpp:626`) and then `d.Time++`
(`:660`), its only per-tick write of `d.Time`, and `LoadGame` sets `d.Time = gb2.Time`
(`SaveGame.cpp:1624`). So a timer pass fires what is due at the `d.Time` the mouse handlers
saw since the last tick. The port's `Game.gameTick` increments `tickCount` first
(`src/engine/Game.ts:449`) and runs `processTimers` on the new value. A timer set between
ticks for `d.Time + n` therefore fires one tick sooner than CSBWin's, and so does a loaded
game's timer due at `gb2.Time + 1`. The door button's `TT_DOOR`, set for `d.Time + 1`
(`Mouse.cpp:1078-1085`), moves the door in the tick the click brings on, where CSBWin's moves
it in the tick after, and `tools/dump-mouse-queue.ts` case 9 asserts the port's timing. A
timer that a handler sets inside the pass, from `TimerSystem.now`, is due one tick later by
the clock than CSBWin's, and fires in the same tick. Move the increment after the timers,
and after the lost game's return, which skips it (`CSBCode.cpp:658`).
The tools that turn the clock themselves (`tickCount++` then `processTimers`) move with it,
and so does `Game.processTimersViewportAndSound`, whose `d.Time++` is also after its
timers (`doc/CSBwin-src/Attack.cpp:2199-2208`).
Evidence: a row in `tools/dump-mouse-queue.ts` case 9 counting the ticks from the door
button to the door's first step.

### C69 ⏳ A step, a drop and a pick-up run the timers at once

CSBWin runs `ProcessTimers` from the main loop's tick (`doc/CSBwin-src/CSBCode.cpp:627`)
and from `_FusionSequence` (`Attack.cpp:2199`), nowhere else. The port also runs
`processTimers(tickCount)` from three handlers the mouse queue runs, once their move is
made: `MovementSystem.moveParty` after a turn or a step that went through
(`src/engine/MovementSystem.ts:66`), `MouseSystem.dropObjectFromCursor`
(`src/engine/MouseSystem.ts:102`) and `MouseSystem.triggerObjectMove`, the pick-up
(`:275`). So a timer the move queues for the current time, a pad's or a pit's, fires inside
the handler, before the rest of the queue's entries in that pass and before the top of the
tick, where CSBWin's waits for the tick. After a move to another level they run before the
tick has loaded it (`d.newPartyLevel`), with the party still on its old level, and they
drop what `processTimers` returns, so a CSB win among those timers is lost. Remove the
three calls. Evidence: a check that drops an object on a pad whose
action is due at once, and finds its timer still queued when the handler returns.

### C70 ⏳ The top view of positions has a square for nobody

CSBWin draws a champion's square in the top view of positions from `DrawCharacterState`,
once per champion in the party, and only inside `if (pcA3->HP() != 0)`
(`doc/CSBwin-src/Character.cpp:1308-1513`): a dead champion has none, their square blanked
by `KillCharacter` (`:2663-2666`). The port's `drawPartyStatus` (`src/renderer/ui/Character.ts:390`)
draws one for each of the four boxes, alive, dead or empty, an empty box's in the slot of
its own index. So the golden frame `01-boot` shows four coloured squares over an empty
party, where CSBWin shows none; with three champions, the empty fourth box paints its
colour, 14, over whichever champion stands in position 3; and a dead champion keeps a
square.
Draw it for a living champion only, and capture `01-boot` again. Evidence: the frame, and
a row in `tools/dump-marching-order.ts` that draws a party with a dead champion.

### C71 ⏳ A resumed game has no "GAME LOADED, READY TO PLAY."

`TAG021028`, the hand-off to the adventure, puts up `DoMenu("GAME LOADED, READY TO PLAY.",
"PLAY GAME", "ASCII DUMP")` when `d.gameState` is `GAMESTATE_ResumeSavedGame`, and runs
`AsciiDump` for its second button until the first is chosen
(`doc/CSBwin-src/CSBCode.cpp:10493-10515`). That is every game the chooser loaded: from the
entrance's "resume" at boot, and after "RESTART THIS GAME". The port goes straight into the
adventure in both (`init` and `showEndOfGame`, `src/main.ts`). Show the menu, with
`src/renderer/ui/Menu.ts`, before the loop starts. Evidence: a golden frame of it.

### C73 ⏳ A room's message decodes without the escape tables

CSBWin's `DecodeText` expands codes 29 and 30 through the escape tables `d.Byte10080` and
`d.Byte10016` for any text but a wall's (`doc/CSBwin-src/CSBCode.cpp:5559-5574`), and the
dungeon compresses "THE " and "YOU " that way. `DungeonState.decodeTextBytes` drops an
escape when it is given no tables (`src/engine/DungeonState.ts`). The wall text
(`BytecodeInterpreter`) and the scroll (`Inventory`) pass them. The one caller that passes
none is the text the party finds on a square it enters, which `ActuatorSystem` decodes
with `decodeMessageText(rec)` and queues (`src/engine/ActuatorSystem.ts:618`,
`Code11f52.cpp:3960-3963`).

In `dm-atari/dungeon.dat` only one text can take that path: of the 30 texts on squares
that are not walls, 29 are hidden (the champions' records, "WELCOME BACK BRAVE
ADVENTURERS.", the four ending texts of level 12's cell (0, 0)) and use no escape. The one
visible text is on level 0 at (9, 1), a teleporter square: "IT IS TOO BAD YOU DID NOT
DISCOVER THE TRUE SECRET OF THE FIRESTAFF.", which the port would print without its two
"THE"s. When the party reaches that square has not been checked. The tables are
`ctx.tables.textDecode`. Pass them, and make the `tables` parameter required, so no decode
can leave them out. Evidence: a `tools/` check that puts the party on that square and reads
what was queued.

### C74 ⏳ A keyed attack makes no tick due

A click on an attack option sets `d.clockTick = intResult` after `ExecuteAttack`
(`doc/CSBwin-src/Character.cpp:4716-4717`), which `handleAttackAreaClick` mirrors
(`src/renderer/ui/Attack.ts`). The attack option keys reach `executeAttack` through
`performAttack` (`src/renderer/ui/Keyboard.ts:161`), which drops the result, so a keyed
attack waits for the next tick where a clicked one brings it on at once. The module comment
of `Keyboard.ts` promises the two routes stay equivalent. Set the clock tick there as the
click does, with a case in `tools/dump-key-bindings.ts`.

### C75 ⏳ A generator makes its group on the party's level

CSBWin's generator runs in a timer, with the timer's level loaded (`ProcessTimers`,
`doc/CSBwin-src/CSBCode.cpp:6416-6417`). It takes the hit-point multiplier from the
actuator, or from that level's descriptor when the actuator's is 0
(`d.pCurLevelDesc->experienceMultiplier()`, `Timer.cpp:1782-1786`), and `CreateMonster`'s
`MoveObject` puts the group on that level (`curLevel = d.LoadedLevel`,
`Code11f52.cpp:2857`). The port's `TimerSystem.spawnMonsterGenerator`
(`src/engine/TimerSystem.ts`) passes `createMonster` the party's level, and a multiplier of
0 when the actuator's is 0, so every member's hit points are the random spread alone. A
generator whose timer fires once the party has left its level makes its group on the
party's level, at the generator's x and y, where CSBWin's appears beside the generator.
Pass `timer.level`, and the timer level's `difficulty` when the actuator's multiplier is 0.
Evidence: a row in a `tools/` check firing a generator with the party on another level, and
one with a multiplier-0 generator.

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
- `TimerSystem.applyBrightnessSteps` (`TimerSystem.ts:279`) returns silently when
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

### F11 ⏳ `probe-ui.mjs --boot` boots with an empty party

`tools/probe-ui.mjs --boot` still presses F8 for a random dev party (`:146`), a key that no
longer exists, so it boots with an empty party. `tools/probe-frames.mjs` builds its party
at the Hall of Champions instead, and `--boot` should do the same.

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

### G2 ⏳ Ten DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:112`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:342`).
- `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`). It counts each kill in `expool`'s
  statistics and, when the dungeon has an `ESL_DELETEMONSTERFILTER`, runs its type-47 DSA,
  which may set `deathCloud` and `dropResidue`. CSBWin calls it from `DamageMonster` with
  `DMW_Damage` (`Code11f52.cpp:1112`, `:1122`) and from `MoveObject`'s two deletions with
  `DMW_Movement1` / `DMW_Movement2` (`:3151`, `:3304`). The port's matching places are
  `MonsterDamage.ts:463` and `MonsterSystem.ts:546`.
- `MonsterAttackFilter`, which may rewrite a monster attack's whole parameter block
  (`MonsterAttack.ts:146`). CSBWin's block is a file-scope global
  (`doc/CSBwin-src/Monster.cpp:917-938`), and `MonsterAttacks` never writes its
  `disableTime`, which no C++ reads, so a filter sees the value the last filter left there.
  The port builds a fresh block each attack, with `disableTime` 0.
- `CallPartyMoveFilter` (`CSBCode.cpp:8119`), which may rewrite the stamina adjustments or
  refuse the move, with its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8122-8128`,
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:246`).
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
- `SoundFilter` (`ESL_SOUNDFILTER`, `doc/CSBwin-src/Sound.cpp:670`), which `QueueSound`
  calls once it has the volume, and which may play the sound through a DSA instead
  (`CSBCode.cpp:1877`). `SoundQueue.queueSound` plays straight on.

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
  comment gives the reason. While a script holds the loop (`Game.isRunningScript`) the
  panel keys do nothing, as CSBWin's would wait in the queue for a pass that never comes
  before the credits; the two screens open only from a pass, so neither is up then.
- 🚫 **F1-F4 select the caster.** CSBWin's adventure key table `Byte18400` binds them to
  buttons 7-10, the four inventories (`doc/PROVEN_FACTS.md` → "The key tables: CSBWin's own
  keys"). The author finds the caster on F1-F4 and the inventories on 7-0 more convenient,
  so `tableKeyButton` (`src/renderer/ui/Keyboard.ts`) leaves F1-F4 to `handleUIKey`. Every
  other table key keeps CSBWin's role. A rebinding screen, if players ever disagree, would
  make this a default rather than a divergence.
- 🚫 **A script's caller finishes at once.** `Game.runScript` returns as soon as the script
  reaches its first `VBLDelay`, so what CSBWin's suspended caller would do after the script
  ends, the port's does before it. Both scripts end the game, and the callers' tails that
  anything could still see are skipped (`executeAttack` and `handleAttackAreaClick`,
  `src/renderer/ui/Attack.ts`). What is left is `HandleMouseEvents`' `lastTime = d.Time`
  (`doc/CSBwin-src/Mouse.cpp:1647-1649`), stamped at the click, which nothing reads after
  the credits.
- 🚫 **A champion who dies in hand is put down on nobody.** `KillCharacter` does not end a
  change of the marching order, and `TAG0025a6` then writes the dead champion's facing and
  position to `d.CH16482[-1]`, outside the champions (`doc/PROVEN_FACTS.md` → "Changing
  the marching order"). The port writes them to no one and does the rest: whoever stood on
  the target square still moves (`tag0025a6`, `src/renderer/ui/Mouse.ts`).
- 🚫 **The vertical-move guard** in `MoveParty` (`CSBCode.cpp:8200-8204`) is not ported,
  because CSBWin cannot reach it either. Move Up / Down (`0x1124` / `0x1125`) come only from
  the 3DMaze extension's `ThreeDMovements` keys and `GravityMove`, whose flags are
  initialised `false` (`data.cpp:239-240`) and assigned nowhere in the tree.
- 🚫 **The main loop makes one pass a VBL, not one a message.** CSBWin's loop makes a pass
  for every message the UI hands it (`doc/CSBwin-src/CSBUI.cpp:1253-1272`): each VBL's
  `UIM_VBL` (`system.cpp:624-630`), and a mouse button going down, which pushes a message
  of its own (`CSBUI.cpp:1185-1201`, `:1207-1222`). Every pass runs `HandleMouseEvents`,
  the tick if `d.clockTick` is set, and takes one print-queue entry (`CSBCode.cpp:714-765`).
  The port's `Game.runFrame` is one pass a VBL, and `onMouseClick` only queues: a click
  waits for the next VBL, at worst about 17 ms, and takes no print-queue entry of its own.
  The author's decision: the delay is too small to matter.
- 🚫 **The intro and the end screen run on wall-clock time** through
  `requestAnimationFrame`, not on a VBL counter shared with the game loop. Nothing else
  runs while they play (the end screen starts once the loop has stopped), so there is
  nothing for them to drift against. If a boot-time animation ever has to agree with `d.Time`,
  this is the place that would have to change.
- 🚫 **The game does not quit.** `_ShowCredits` ends in `UI_PushMessage(UIM_TERMINATE)`
  (`doc/CSBwin-src/Code1f9e6.cpp:349`), which closes CSBWin. A page cannot close itself,
  so the credits picture stays up (`src/renderer/intro/ShowCredits.ts`).
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
