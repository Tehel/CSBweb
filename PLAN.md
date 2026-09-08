# dmweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

This file carries only the phases that still have work in them. Completed phases are
archived in `doc/PLAN_ARCHIVE.md` — but their unfinished business is **not** archived with
them: it is listed under "Carried-over debt" below, which is the authority. When you finish
a phase, move its body to the archive and lift anything still open into that list.

## Ground rules

1. **The build must stay clean.** `npm run build` runs `tsc && vite build`; `tsc --noEmit`
   must pass with zero errors before any commit. Note that `vite build` alone will happily
   succeed on broken code — esbuild strips types without checking them — so `tsc` is the
   only real gate. (The project sat with a broken `tsc` and a genuine runtime bug hidden
   among the type errors; don't let that recur.)
2. **No guessed tables in the shipping path.** If a rectangle/offset/formula is not extracted
   from the game data or transcribed from CSBWin, mark it as temporary.
3. **One renderer is authoritative**: the bytecode-based path.
4. Prefer small tooling over manual reasoning: table dumps, render probes, trace hooks.

## Status (September 2026)

Verified against the code, not inherited from earlier revisions of this file.

**Solid:**
- Data loading: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, save games (base + extended).
- Bytecode viewport renderer — the authoritative path. All `0x22e` rectangle tables are
  extracted at runtime; no guessed geometry remains in the renderer.
- Movement + collision, CSBWin-style 3-deep key queue, immediate post-move timer processing.
- Timer queue with CSBWin duplicate-timer suppression.
- Actuators, DSA scripting, teleporters, pits, doors, false walls.
- Missiles and throwing (lifecycle, encounters, DSA filters).
- Skills/experience (mastery, AdjustSkills, LevelUp), magic casting (all three spell classes).
- Light levels / palette switching, sound, most of the DM UI.

**Known-incomplete, in rough priority order:**
1. ✅ **Message area** — done (Phase 11). CSBWin's `SCROLLING_TEXT` is ported: fragment-based
   emission, 53-column word wrap, 4 rows with 70-tick expiry, and `updateDebug()` demoted to
   the external debug log. Scroll *animation* and save-game serialization remain deferred.
2. 🔄 **Monsters work.** `Monster.cpp` is ported (Phase 12 steps 1-5): groups hunt,
   flee, throw missiles, hit the party, take damage and die, and a killed champion
   leaves bones. Remaining in the phase: creature generators, and the *champion's*
   own attacks from `Attack.cpp`. Armour does not yet reduce damage — see Phase 12.
3. 🔄 **Champion death and bones now work** (Phase 12); resurrection, character
   creation and potion drinking remain (Phase 13).
4. **Clouds are created but inert** — no timer, no damage, never expire (Phase 9 step 13).
5. **Throw stats are estimates**, not CSBWin's skill/weight/stamina formulas (Phase 9 step 11).
6. ✅ **Debug scaffolding** — done (Phase 14). Now confined to `src/dev.ts` and reached only
   through `isDebugFeaturesEnabled()`.
7. ✅ **`ViewportRenderer.ts` god object** — done (Phase 14). Split from 3809 lines to 723;
   the UI now lives in `src/renderer/ui/`.
8. **CSBWin-binary-compatible save files** not attempted (Phase 10).

**Validation debt:** several phases below list "Validation" steps (render tests, render
probes, pixel comparisons against CSBWin screenshots) that were **never carried out** —
there is no test framework in the project at all. Verification has been visual and ad hoc.
Those items are now marked 🚫 where they were silently skipped; Phase 15 addresses this.

There are now two partial exceptions, and Phase 15 should absorb both rather than start
from nothing:

1. `tools/probe-frames.mjs` + `tools/check-frames.sh` drive the real app over the
   DevTools Protocol and byte-compare five screen states against `tools/frames/`. Built
   to make the Phase 14 split safe. Five frames, no assertions beyond equality, needs a
   dev server and a headless Chrome.
2. **Seven assertion-carrying verification tools** built during Phase 12
   (`dump-monster-{tables,activation,perception,damage,move,ai}.ts`,
   `watch-monster{s,-attacks}.ts`). These load the real game files, drive the real
   engine with a fixed RNG seed, print a human-readable table and assert invariants,
   exiting non-zero on failure. They are the de-facto regression suite for everything
   the frames cannot see, and they caught two real bugs and two wrong tests.

   The pattern is written up in `.claude/skills/verification-tools/`. What Phase 15
   would add is a runner, shared fixtures, and assertions that do not each hand-roll a
   `check()` helper — not the idea.

## Carried-over debt (from completed phases)

The phases below are archived in `doc/PLAN_ARCHIVE.md`, but they did **not** close clean.
Every open item from them is listed here so that nothing is buried by the split — this list
is the authority, the archive only holds the surrounding context. Each entry names its
archive section.

**Rendering / UI**

- ⚠️ *(Phase 4)* DSA-based decoration gating and footprints/extended cell flags are not
  ported. Wall and floor decoration selection currently follows `TAG00a4a2` + the actuator
  `wallGraphicOrdinal` for stone/open rooms.
- ⏳ *(Phase 7)* **Rune click flash effect** missing in the magic panel.
- ⏳ *(Phase 7)* **Attack panel is a placeholder**: `drawAttackPanel()` picks the first alive
  champion rather than the acting one, `PossibleAttackTypes` is not ported at all, and
  visibility is driven by the F7 debug toggle instead of real attack state. Blocked on
  Phase 12's champion melee (see Phase 12's own open list).
- ⏳ *(Phase 7)* **Interaction highlights** — button press/selection effects (flash, shading,
  invert) across UI regions, consistent with the hit-test rectangles.
- ⏳ *(Phase 7.5)* Attack-driven light effects (depends on Phase 12); light-level trace hook.

**Engine**

- ⚠️ *(Phase 8)* `PerformLocalAction()` does not map `HandChar` precisely; it uses
  partyPosition matching when `mapPos` is specified.
- ⚠️ *(Phase 8)* The DSA interpreter has many unimplemented ampersand subcodes — see the
  TODOs in `src/engine/DsaSystem.ts`.
- ⚠️ *(Phase 8)* Missile launch, monster creation and `WiggleEverything` still need concrete
  engine hooks — see the TODOs in `src/engine/TimerSystem.ts`.
- ⚠️ *(Phase 8)* DSA object manipulation skips cloud/missile timer updates and does not free
  DB records on delete (CSBWin uses a deferred `DeleteDBEntry`).
- ⏳ *(Phase 9 step 11)* **`ThrowByCharacter` stats are estimates.**
  `Game.estimateThrowRange/estimateThrowDamage/estimateThrowDecay` stand in for CSBWin's
  range/damage/decay from skills, stamina and item weight.
  Ref: `doc/CSBwin-src/Mouse.cpp:673+`, `doc/CSBwin-src/Attack.cpp:652+`.
- ⏳ *(Phase 9 step 12)* Door pass-through rules (DoorTOC + ObjDesc checks for missiles) and
  the magic damage/poison formulas incl. Black Flame fireball healing.
  Ref: `doc/CSBwin-src/Code11f52.cpp:1870+`, `doc/CSBwin-src/Code11f52.cpp:1488+`.
- ⏳ *(Phase 9 step 13)* **Clouds are inert — a visible bug, not just a gap.**
  `createCloud()`/`createCloudRecord()` build the DB13 record and add it to the cell but
  **never schedule a timer**, so clouds render forever and deal no damage.
  Ref: `doc/CSBwin-src/Timer.cpp:479+`, `doc/CSBwin-src/Code11f52.cpp:1376+`.
- ⚠️ *(Phase 9.5)* Refine spell skill selection once spell definitions exist, replace the
  throw skill gain with CSBWin's tables, and refine the `LastMonsterAttackTime` source now
  that monster AI is in.
- ⚠️ *(Phase 5)* Save-game fidelity gaps: extended-feature save games (sequenced/extended
  timers + DSA blocks), full monster attack/alternate-graphics state, and exact missile
  mirror/flip edge cases.

**Messages (Phase 11)**

- ⏳ Pixel-level scroll animation (`d.PushTextUp` / `d.TextScanlineScrollCount`) is not
  implemented; rows scroll instantly and CSBWin's wait-for-animation guards are absent.
- ⏳ `SCROLLING_TEXT::Serialize` — message state in save games
  (`doc/CSBwin-src/Data.h:1666`). Quick-load calls `discardText()` instead.
- ⏳ `d.PartySleeping` is plumbed (`setPartySleeping`) but never set — no sleep system yet.

**Dev scaffolding (Phase 14)**

- ⚠️ F5/F8/F9 were **not** deleted, contrary to the phase's original wording. F8 is the only
  way to get a playable party (Phase 13's hall-of-champions does not exist) and F5/F9 are
  the only way to persist anything (Phase 10). Delete each as its real feature lands.

**Deliberately closed, not debt**

- 🚫 *(Phase 6)* Custom skins / `BACKGROUND_LIB` skipped — the shipped DM dungeon uses no
  custom backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 The never-executed validation steps of phases 2, 4, 5 and 7 (render probe, scripted
  room-info checks, CSBWin screenshot comparison) are **all** folded into Phase 15 below.

## Completed phases

Full working notes in **`doc/PLAN_ARCHIVE.md`**. Open items from them are listed above.

| Phase | Subject |
| --- | --- |
| 0 | Consolidate rendering entrypoint |
| 1 | Load CSBWin viewport tables from `graphics.dat` |
| 2 | Faithful low-level blitter (pixel-index buffer) |
| 3 | Floor/ceiling pipeline |
| 4 | `SummarizeRoomInfo()` authoritative |
| 5 | Opcode surface area |
| 6 | Custom skins / `BACKGROUND_LIB` (🚫 skipped) |
| 7 | UI rendering (faithful DM layout) |
| 7.5 | Light level / palette switching |
| 8 | CSBWin-compatible actuators |
| 8.5 | Teleporter cell actions parity |
| 9 | CSBWin-compatible missiles |
| 9.5 | Skills & experience parity |
| 9.75 | Magic casting parity |
| 11 | Unify the messaging system |
| 14 | Structural cleanup |

## Next Steps (Phased)

Only the phases with work left in them. Completed phases are in `doc/PLAN_ARCHIVE.md`.

### Phase 10 — CSBWin-Compatible Save/Load (pre‑work checklist)
Goal: ensure internal state and data structures are complete enough to write a binary‑compatible CSBWin save file.

1. **Inventory all save file blocks (CSBWin `SaveGame.cpp`)**:
   - Block1 (512 bytes), Block2 (128 bytes), Item16, Characters, Timers, TimerQueue.
   - Extended features: DSA blocks, extended wall decorations, sequenced/extended timers.
2. **Define missing runtime state in TS**:
   - Global engine state: random seeds, time counters, movement counts, party level/position/facing, UI state flags, object-in-hand, etc.
   - Timer queue metadata and ordering state (not just Timer table contents).
3. **Mirror CSBWin database record layouts**:
   - All DB records (door/teleporter/text/actuator/creature/weapon/clothing/scroll/potion/container/misc/missile/cloud) with correct bitfields, padding, and word sizes.
   - Include any save‑only fields (Item16 runtime indices, missile/cloud records) not present in base dungeon.dat.
4. **Add full object list serialization**:
   - `objectList`, `columnIndex`, `levelIndex`, and per‑cell object chains must be written/read exactly as CSBWin.
   - Ensure object positions (RN pos bits) and link fields are preserved.
5. **Persist cell flags and dynamic room state**:
   - Door/pit/falsewall/teleporter flags in `cellFlags` must be saved (not inferred from dungeon.dat).
6. **Character/party blocks**:
   - Implement CSBWin character block layout (3328 bytes) with exact packing of inventory, stats, skills, spells, wounds, and flags.
7. **Text/indirect text indices**:
   - Ensure `textWords`, `indirectTextIndex`, and any converted text tables are serialized when required by CSBWin.
8. **Extended features**:
   - DSA level index tables and DSA state blocks (if `CSBgraphics.dat`/extended flags present).
   - Extended wall decorations and related flags in save file header.
9. **Checksum/scramble parity**:
   - Implement CSBWin block checksums and scramble/unscramble exactly (endianness + word ordering).
10. **Round‑trip validation tooling**:
   - Add a tool to load CSBWin save → re‑serialize → binary‑compare.
   - Add targeted checks for door/pit state, object chains, and timers after load.

Status: ⏳ pending — not started. Note this is a large piece of work and is *not* a
prerequisite for playability; quick-save/load via a runtime JSON snapshot already works.

### Phase 12 — Monsters: AI, movement, combat

Goal: port `doc/CSBwin-src/Monster.cpp` and the attack pipeline in
`doc/CSBwin-src/Attack.cpp`. This is the single largest remaining gap — there are currently
**no active monsters at all**, only their rendering.

Several systems already carry proxies waiting on this phase; each must be revisited here:
- `LastMonsterAttackTime` is fed from the missile-hit path instead of real monster attacks
  (gates `AdjustSkills` scaling).
- Monster attack rendering is triggered from the renderer rather than from combat logic.
- Monster teleport rotation/position logic and monster teleporter sounds are stubs.
- `Game.registerChampionBones()` exists but is never called automatically.
- Attack panel (Phase 7 item 14) cannot show real actions without `PossibleAttackTypes`.

1. ✅ **Monster data model.** The audit found all three records truncated or misread, and
   they are now field-for-field transcriptions of CSBWin (see
   `doc/CSBWIN_MONSTERS_REFERENCE.md`):
   - `MonsterDesc` went from 4 fields to the whole 26-byte `MONSTERDESC`
     (`CSB.h:2256`) with named `word2`/`word4`/`word14`/`word16`/`word18`/`word20` bit
     accessors, plus CSBWin's zero-`movementTicks06` clamp (`CSBCode.cpp:10163`).
   - `Item16Record` went from 3 fields to the whole 16-byte `ITEM16` (`CSB.h:2190`) —
     `word0` and all the movement state the AI needs.
   - `CreatureRecord` now mirrors `DB4`: `creatureType` masked to 5 bits with
     `alternateGraphics` split off, `count` renamed to CSBWin's `numMonM1` and stored as
     count-minus-one, `positions`/`groupIndex?` collapsed into the single dual-purpose
     `groupIndex`, and `fear`/`invisible`/`drawAsSize4`/`unique`/`poisoned` added.
   - The attack tables `parseGraphic230` used to skip over are extracted:
     `experienceForAttacking`, `skillNumber`, `byte20090`, `byte20046`, `byte20002`,
     `byte19958`, `byte19914`, `attackNames[300]` and `legalAttacks[44]`.
   - `MonsterType`, `StateOfFear` and `ATTACKTYPE` transcribed into
     `src/engine/monsterTypes.ts`; timer types 29-41 and `TT_M1`/`TT_M2`/`TT_M3` added
     to `TimerFunction`.

   **Three real bugs fell out of the audit**, all recorded in `doc/PROVEN_FACTS.md`:
   `numMonM1` was read as a count by the renderer and as count-minus-one by
   `TimerSystem`/`Game`; `getMonsterRenderState` could never reach an `ITEM16` because
   the `groupIndex?` field was never assigned by any loader, so monster attack and mirror
   flags were dead even when loading a save; and `ViewportPicking` read positions
   straight off `DB4` instead of the render state.

   Verified with `tools/dump-monster-tables.ts` (new) — the attack names read `BLOCK`,
   `CHOP`, `PUNCH`, … in `ATTACKTYPE` order, which pins the graphic `0x230` offsets — and
   all five `tools/check-frames.sh` frames stayed byte-identical.
2. 🔄 **Monster timers and movement.**
   - ✅ **Group lifecycle** (`src/engine/MonsterSystem.ts`): the `ITEM16` pool with
     CSBWin's two different growth caps, `AttachItem16ToMonster`, `DetachItem16`,
     `TAG00bd40`, `ProcessMonstersOnLevel`, `InitializeItem16`,
     `NextMonsterUpdateTime`, `StartMonsterMovementTimers`,
     `DeleteMonsterMovementTimers` and `EnsureItem16Available`.
   - ✅ **`LoadPartyLevel`** wired: monsters are detached and re-attached whenever the
     party changes level, and the check runs immediately before `processTimers` at
     each of the four call sites, as CSBWin orders it (`CSBCode.cpp:618-635`).
     Restoring a save re-derives the pool (`SaveGame.cpp:1240-1244`).
   - ✅ **Timer types 29-41 routed** out of the dispatcher ahead of the switch, as
     CSBWin does (`CSBCode.cpp:6422`).
   - ✅ **`QueueSound` ported** (`src/engine/SoundQueue.ts`) — the engine can now name
     a sound by ordinal instead of raw SND id. ⚠️ Two gaps: `deltaTime > 1` should
     defer the sound as a `TT_20` timer (`CSBCode.cpp:1832`) but plays it at once,
     and `SoundFilter`'s DSA hand-off (`Sound.cpp:670`) is not ported.
   - ✅ **Dev AI trace** on F4, formatted after CSBWin's `AITraceActive` output.
   - ✅ **`MoveObject` for monsters** (`MonsterSystem.moveMonster`): monsters now use
     the same teleporter and pit resolution the party does, via
     `TimerSystem.resolveMonsterDestination` over the shared `resolveCellEffects`.
     Includes `CheckMoveFromMissile` on the way out, the `ITEM16` attach/detach when
     crossing levels, AI-timer retargeting, `ClearAttacking_DeleteMovementTimers`,
     and the `d.MonsterDamageResult` global that decides whether a missile encounter
     aborts the move.
   - ✅ **Abeyance** (`TT_60`/`TT_61` + `ProcessTimer60and61`): a group whose
     destination holds the party or another monster is parked and retries every 5
     ticks, with Lord Chaos's 25%-chance random step so he can escape a walled-in
     corner.
   - ✅ **`InitialChecks`** and `ProcessTimers29to41`'s prologue
     (`src/engine/MonsterAI.ts`), with the timer-helper chain CSBWin factored its
     `goto`s into: `SetMonsterTimerB`, `Set_Monster_Timer`, `EnsureI60NonZero`,
     `Increment_Time_By_W52_Plus_Random`, `Delete_Timers_Maybe_Set_Fear`,
     `MaybeDelTimers_Fear6_TurnIndividuals`, `Turn_Monsters_As_Group` and
     `StartBGroupTimer`. CSBWin's `d.` scratch globals are gathered into an explicit
     `AiScratch`.
   - ✅ **`d.freezeLifeTimer`** and **`d.Word11694`** (game won) added as real state,
     with the per-tick countdown (`CSBCode.cpp:684`).
   - ✅ **`ProcessTimers29to41`'s decision body** — the TT_29/30/31 reaction
     branches, the A-family and B-family timer paths, and the whole movement chain:
     `Try_Directions_D5_To_D4`, `Try_Preferred_Direction_Then_Others`, `Try_To_Move`,
     `D4D0Finish`, `TryUByte67`, `Process_Invincible`,
     `Process_Invincible_And_Finish` and `Standard_Finish`.

   **Monsters now move, hunt and flee.** Verified with `tools/watch-monsters.ts`
   (new): on level 2 with the party at (6,14), 18 of 22 groups move over 600 ticks
   and none ends up inside a wall; the two groups adjacent to the party both enter
   fear state 6 — the break-formation-and-attack state — and close to distance 1,
   while distant groups stay in state 0 and wander; and the nearest group's path
   `(6,13) → (7,13) → (7,14)` shows the pre-melee position shuffle. Six new entries
   in `doc/PROVEN_FACTS.md`, including the fear-state table.

   - ✅ **`CheckMonsterVersusMissiles`** (`Monster.cpp:4462`) — a monster shuffling to
     another corner of its cell now walks onto any missile already sitting there.

   ⚠️ **One deferral:** `CreateMovementTimer`'s overflow guard is not ported — CSBWin
   counts the groups already waiting at a square and, past 31, deletes the monster
   unless it is `Unique()` or carries something (`Code11f52.cpp:2474-2510`).

   Verified with `tools/dump-monster-move.ts` (new): an Ant Man moved from (1,16) to
   (2,16) leaves the old cell, appears in the new one, and its AI timer follows it
   rather than staying behind, while its `ITEM16` records (2,16) and remembers
   (1,16); a move onto an occupied square yields exactly one abeyance timer carrying
   that monster; and the abeyance timer correctly reschedules while blocked, then
   places the group once the destination clears.

   Verified with `tools/dump-monster-activation.ts` (new): on level 3 the real
   dungeon activates 13 groups — worms in the corridor at (2,1)-(6,1), munchers,
   rock piles, a Rive — each with exactly one AI timer whose `uByte5` is
   `255 - movementTicks06` for its type, and every DB4 pointing back at its own slot.
   All five `tools/check-frames.sh` frames unchanged.
3. 🔄 **AI / targeting.**
   - ✅ **Perception and movement probing** (`src/engine/MonsterPerception.ts`):
     `BlockedTypeA`, `StoneOrClosedFalseWall`, `TestDirectPathOpen`, `Blocked`,
     `GetBestMonsterFacingP1`, `PossibleMove`, `FindPossibleMove`,
     `PossibleDoubleMove`, `TurnMonster`, `TurnMonsterGroup`, plus
     `IsItInThisDirection`, `GetPrimaryAndSecondaryDirection`, `RelativeXY` and
     `DistanceBetweenPoints`. `PossibleMove`'s six `d.` output globals are gathered
     into an explicit `MoveProbe`.
   - ✅ **The footprint trail** (`src/engine/PartyFootprints.ts`): `d.PartyFootprints`
     + `d.Byte13220` with `AddFootprintEntry`, `DeleteFootprintEntry` and
     `SearchFootprints`, recorded at every party relocation. This is the smelling
     mechanism, and it did not exist before — only a `numFootprintEnt` counter did.
     CSBWin's author calls `AddFootprintEntry` broken; it is ported as written,
     because it is the sole writer of the age bytes smelling reads.
   - ✅ **`DoorCharacteristics[4]`** extracted from graphic `0x22f` (absolute 9760),
     so `DoorTOC` is real data rather than a guess; `MonsterDroppings[40]` came with
     it.
   - ⏳ Still to do: the state machine — `InitialChecks`, `ProcessTimers29to41` and
     the `Try_To_Move` / `Try_Preferred_Direction_Then_Others` /
     `Try_Directions_D5_To_D4` / `Standard_Finish` / `Process_Invincible` chain — and
     the Monster Move Filter DSA that wraps it.

   **Dependency found while reading `InitialChecks`** — it changes the order the rest
   of this phase has to be done in. `InitialChecks` cannot be finished before
   `DamageMonster` exists: its first real act is to sweep the group for a member at
   zero HP and call `DamageMonster` to remove it, re-queueing its own timer and
   bailing out if anyone died (`doc/CSBwin-src/Monster.cpp:2802-2832`). It also needs
   the monster form of `MoveObject` for the off-party-level random walk (`:2908`). So
   the remaining work is *not* "step 3 then step 4" — it is:

   1. ✅ `MoveObject` for monsters — **done**, see step 2 above.
   2. ✅ `DamageMonster` — **done**, see step 4 below.
   3. ✅ `InitialChecks` — **done**, with the timer-helper chain.
   4. ✅ `ProcessTimers29to41`'s decision body and the `Try_*` chain — **done**.
   5. ✅ `MonsterAttacks` + `MonsterDamagesCharacter` + champion death/bones — **done**.
   6. Remaining: creature generators (step 5 of the phase), the champion melee
      pipeline from `Attack.cpp` with the real attack panel, and the armour/load gaps
      listed below.

   Verified with `tools/dump-monster-perception.ts` (new): on level 2 with the party
   beside a nest of Ant Men, the three at ranges 1-3 see it and the ones beyond do
   not (Ant Man `sightDistance` is 3); the one standing one cell away but facing
   north is correctly blind to a party to its south while smelling it in the right
   direction; and across all 22 groups no monster ever reports a legal move into
   stone. Eleven new entries in `doc/PROVEN_FACTS.md`.
4. 🔄 **Attack resolution.**
   - ✅ **`DamageMonster`** (`src/engine/MonsterDamage.ts`) with `DeleteMonster`,
     `DropMonsterRemains`, `CreateAndDropObject` and the four packed-byte accessors
     `MonsterPositionByte` / `SetMonsterPositionByte` / `MonsterFacingByte` /
     `SetMonsterFacingByte`. This was done ahead of the rest of the phase because it
     is both a hard prerequisite for `InitialChecks` and the one piece that retires a
     stub already live in the shipping path.
   - ✅ **`Game.applyMissileDamageToMonster` retired.** The missile system now goes
     through the real `DamageMonster`, so a hit produces the death cloud, the
     droppings, the dropped possessions, the survivors' fear reaction and the
     per-member timer renumbering — none of which the 35-line stand-in did.
   - ✅ **`TimerQueue.reprioritizeTimer`** added, mirroring CSBWin's
     `AdjustTimerPriority` (`Code11f52.cpp:1194`): the function code is part of the
     queue's sort key, so renumbering a per-member timer has to re-sort it.
   - ✅ **`Byte10340[4]` and `MonsterDroppings[40]`** extracted from graphic `0x22f`.
   - ✅ **`MonsterAttacks` and the champion damage chain** (`src/engine/MonsterAttack.ts`):
     the attack parameter block and its DSA filter hook, per-type missile selection,
     `LaunchMissile` for monsters, `MonsterDamagesCharacter`, `DamageCharacter` with
     wounds, `Quickness`, `IsCharacterLucky`, `TAG016426`, `GetCharacterToDamage`,
     `DetermineAttackOrder`, `PoisonCharacter` and `KillCharacter`.
   - ✅ **Champion death → bones → possessions dropped**, with
     `Game.registerChampionBones` now called automatically — retiring the proxy Phase
     12 item 6 named. `d.uByte590[4]` and `d.Byte586[8][4]` extracted from graphic
     `0x232`.
   - ✅ **`LastMonsterAttackTime` proxy retired** — it is now fed by `MonsterAttacks`
     itself rather than from the missile-hit path.
   - ⏳ Still to do: `Attack.cpp` proper — the *champion's* attacks: hit
     determination, `PossibleAttackTypes`, the real attack panel.

   - ✅ **Armour now protects.** `TAG01680a` ported: shields held in either hand
     weighted per body part by `Byte1412`, the vitality-scaled random term, the
     champion's shield spell, the party shield, the champion's own attack-type
     modifier, and the garment worn on the struck part. `ClothingDesc.uByte1/uByte2`
     extracted from graphic `0x22f` and `Byte1412[6]` from `0x232`; bit 7 of
     `uByte2` marks a shield, verified as exactly the seven shields in the shipped
     data. Measured: one body piece cuts damage ~6%, a full suit ~18%.

   ⚠️ **Two divergences left, both marked in the code:**
   - `TAG01680a` omits its `DetermineThrowingDistance(chIdx, hand)` term
     (`Character.cpp:2416`), which needs the object-weight and max-load chain, so a
     shield *held in hand* protects slightly less than it should. Worn armour — the
     larger term — is complete.
   - **`Quickness` ignores load**, so a laden champion dodges as well as an empty
     one.

   Verified with `tools/watch-monster-attacks.ts` (new): a four-champion party stood
   next to the monsters on level 2 takes its first hit at tick ~146, loses its first
   champion around tick ~160-240, and ends as four sets of `misc_BonesOfHero` with
   `value = 2` lying in the party's cell. A direct wound probe confirms the
   threshold-doubling mechanism: 163 of 200 hits of 300 damage wound (reaching all
   six body parts), 0 of 200 hits of 6 damage do. Eight new entries in
   `doc/PROVEN_FACTS.md`.

   ⚠️ **One divergence, deliberate:** `CreateAndDropObject` appends new weapon /
   clothing / misc records rather than reusing a freed slot as CSBWin's
   `FindEmptyDB5Entry` does. This matches what `Game.createMiscObject` and
   `DsaSystem`'s object copy already do; it is invisible in play but drifts object
   indices from CSBWin's, which matters only for Phase 10's binary-compatible saves.

   Verified with `tools/dump-monster-damage.ts` (new), four cases on the real
   dungeon: killing member 1 of a 4-strong Screamer group compacts HP
   `[100,110,120,130]` → `[100,120,130]` and status `[a0,a1,a2,a3]` → `[a0,a2,a3]`
   while its per-member timers go `[0,1,2,3]` → `[0,1,2]` and the group timer is left
   alone; the same group outside fear state 6 has its timers correctly untouched;
   killing a lone Mummy frees the `ITEM16`, clears the AI timers, removes it from the
   cell and makes exactly one death cloud; and a Screamer's remains come back as
   `misc` type 33, `misc_ScreamerSlice`, which confirms the `MonsterDroppings`
   range-split arithmetic. Seven new entries in `doc/PROVEN_FACTS.md`.
5. ✅ **Creature generators.** `CreateMonster` ported
   (`MonsterSystem.createMonster`): group size clamped by the type's footprint, per
   member hit points of `baseHealth * multiplier + Random(baseHealth/4 + 1)`, corner
   positions from a random start advancing by two for a two-corner monster, and
   placement through `moveMonster` so an occupied square sends the new group into
   abeyance. Actuator type 6 now spawns; `TT_REACTIVATE_GENERATOR` was already wired.
6. 🔄 **Retire the proxies.**
   - ✅ `LastMonsterAttackTime` is fed by `MonsterAttacks`, not the missile path.
   - ✅ The renderer-side attack trigger is **deleted** — `onMonsterAttackState`,
     `handleMonsterAttackState` and `playMonsterAttackSound` are gone. The attacking
     flag is set by the AI and the renderer only reads it, so a monster attacking off
     screen is no longer silent.
   - ✅ `Game.registerChampionBones()` is called automatically from `KillCharacter`.
   - ✅ Monster teleport rotation and teleporter sounds are real (`moveMonster`).
   - ⏳ The attack panel still shows placeholder text; it needs the champion melee
     pipeline below.

**Scope decided at the start of the phase.** Items 1-4 (with champion death/bones, since
item 6 requires retiring the `registerChampionBones` proxy) are being done first; items 5
and 6, and the champion melee pipeline from `Attack.cpp` with the real attack panel
(Phase 7 item 14), follow. `Attack.cpp`'s Lord Chaos endgame — `_Fusion`,
`_FusionSequence`, `FluxCage`, `IsLordChaosHere` — is **deliberately deferred**: it cannot
be exercised until both monsters and Lord Chaos work, so porting it now would land
untested. Validation is `tools/check-frames.sh` plus a dev-only AI trace mirroring
CSBWin's own `AITraceActive` output (`Monster.cpp:3290`), so the two codebases stay
diffable; a real test framework stays Phase 15.

Status: 🔄 in progress — step 1 done; steps 2 and 3 partly done (the AI state machine is the remaining core).

### Phase 13 — Champion lifecycle

1. ⏳ **Death.** Champion death → bones creation → possessions dropped to the floor. Wire
   `Game.registerChampionBones()` into this path so the bones↔champion mapping is automatic.
2. ⏳ **Item naming.** Add the bones-name special case once the champion-bones value from
   DB10 is exposed.
3. ⏳ **Resurrection / reincarnation** at the altars, including the reduced-HP rule.
4. ⏳ **Character creation.** Portrait selection and the hall-of-champions flow.
   `HeroExtractor` + `AddCharacter` already provide preset heroes; this replaces the debug
   random-party injection.
5. ⏳ **Drinking potions.**
6. ⏳ **Pit fall damage** + stamina drain, for party and monsters.
7. ⏳ **Red square around the eye on level gain.**
8. ⏳ **The rest of `KillCharacter`'s tail** (`doc/CSBwin-src/Character.cpp:2670-2694`).
   `SetHandOwner` is now moved off a dead cursor owner, because without it the whole
   inventory stops responding. The other two outcomes of that block are still missing:
   `d.GameIsLost = 1` when no champion is left alive, and moving `d.MagicCaster` off the
   dead champion (`SelectMagicCaster`).
9. ⏳ **`handChar` is not read from a real DM save game.** `SaveGameLoader.parseBlock2`
   reads only `maxTimers` and `maxItem16`; CSBWin restores the cursor owner from
   `gb2.handChar` (`doc/CSBwin-src/SaveGame.cpp:1636`). Our own quick-saves carry it in
   the runtime party state, and `ensureHandOwner` repairs a state that lacks it, but the
   GAMEBLOCK2 offset has not been established so the real field is not parsed.

Status: ⏳ not started, apart from item 8's cursor hand-off.

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ⏳ Add a minimal test runner (the repo has no `test` script at all).
2. ⚠️ **Golden-frame rendering tests.** Partly there: `tools/probe-frames.mjs` drives the
   real app over the DevTools Protocol and `tools/check-frames.sh` byte-compares five states
   against `tools/frames/`. Determinism comes from clearing localStorage and seeding
   `Math.random` on every load. What it still needs to become a real test: a fixed set of
   *party positions* rather than whatever the boot dungeon gives, rendering straight from the
   index buffer instead of a browser screenshot (no dev server, no Chrome), and a `test`
   script that runs it. Absorb it rather than starting over.
3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. ⏳ **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: ⏳ not started.
