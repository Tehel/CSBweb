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
2. ✅ **Combat works both ways** — done (Phase 12). `Monster.cpp` is ported: groups
   hunt, flee, throw missiles, hit the party, take damage and die, and a killed
   champion leaves bones. `Attack.cpp` is ported too: the attack menu offers each
   champion's legal options and every attack type resolves, through the Party Attack
   Filter. Lord Chaos's fusion endgame is the one deliberate omission.
3. 🔄 **Champion death and bones work** (Phase 12), the **Vi altar resurrects** (only
   the wings branch is left), potions are drinkable, and the **Hall of Champions
   works**: a mirror click
   offers Resurrect / Reincarnate / Cancel and the party is built the way DM builds it
   (Phase 13 step 4). All four of Phase 13's prerequisites are done: the `ATTRIBUTE`
   (maximum, current, minimum) triple, `AdjustStamina`, `SelectMagicCaster` +
   `gameIsLost`, and poison as a `TT_75` timer chain. What is left in Phase 13 is the
   name-entry screen behind Reincarnate.
4. ✅ **Clouds work** — `CreateCloud` schedules its `TT_25` timer and `ProcessTT_25` is
   ported, so clouds shrink, damage and expire (Phase 9 step 13).
5. ✅ **Throw stats** — done. `WEAPONDESC` is extracted and `ThrowByCharacter` is
   ported over the real `DetermineThrowingDistance` chain (Phase 9 step 11).
6. ✅ **Debug scaffolding** — done (Phase 14). Now confined to `src/dev.ts` and reached only
   through `isDebugFeaturesEnabled()`.
7. ✅ **`ViewportRenderer.ts` god object** — done (Phase 14). Split from 3809 lines to 723;
   the UI now lives in `src/renderer/ui/`.
8. **CSBWin-binary-compatible save files** not attempted (Phase 10).
9. ✅ **The party's own pit-fall damage** is ported (Phase 13 step 6), and
   `supressPitDamage` now has something to suppress.

**Validation debt:** several phases below list "Validation" steps (render tests, render
probes, pixel comparisons against CSBWin screenshots) that were **never carried out** —
there is no test framework in the project at all. Verification has been visual and ad hoc.
Those items are now marked 🚫 where they were silently skipped; Phase 15 addresses this.

`npm test` now exists (Phase 15 step 1) and runs both standing forms of evidence in ~6s,
or ~12s with `--frames`. There is still no test *framework*; what there is:

1. `tools/probe-frames.mjs` + `tools/check-frames.sh` drive the real app over the
   DevTools Protocol and byte-compare five screen states against `tools/frames/`. Built
   to make the Phase 14 split safe. Five frames, no assertions beyond equality. The
   script now starts its own dev server and headless Chrome, and the probe pins the
   viewport, so the frames reproduce on any machine rather than only on the browser
   the baseline happened to be captured in.
2. **Twenty-four assertion-carrying verification tools** — the Phase 12 nine
   (`dump-monster-{tables,activation,perception,damage,move,ai}.ts`,
   `watch-monster{s,-attacks}.ts`, `dump-player-attacks.ts`) plus
   `dump-hand-owner.ts`, `dump-throwing.ts`, `dump-clouds.ts`, `dump-savegame.ts`,
   `dump-savegame-blocks.ts`,
   `dump-party-collision.ts`, `dump-door-crush.ts`, `dump-attributes.ts` and
   `dump-champion-state.ts`, `dump-feeding.ts`, `dump-pit-fall.ts`,
   `dump-hall-of-champions.ts`, `dump-vi-altar.ts` and `dump-status-boxes.ts`.
   `tools/run-checks.mjs` is the authority on the list. These load the real game
   files, drive the real engine with a fixed RNG seed, print a human-readable table and
   assert invariants, exiting non-zero on failure. They are the de-facto regression
   suite for everything the frames cannot see, and they caught two real bugs and two
   wrong tests.

   ⚠️ Three of the "assertion-carrying" seven were nothing of the kind when the runner
   was built: `dump-monster-{tables,activation,perception}.ts` printed `PROBLEMS: …` and
   exited 0, and `watch-monster-attacks.ts` had a verdict line that overwrote its own
   armour and wound failures. All four now assert through `tools/lib/check.ts`, whose
   `finish()` also fails a run that made **no** checks. `dump-monster-activation.ts` also
   defaulted to a level with no creatures on it, so the no-argument run activated nothing.

   The pattern is written up in `.claude/skills/verification-tools/`. What Phase 15 still
   owes is shared fixtures and the render probe — not the idea.

## Carried-over debt (from completed phases)

The phases below are archived in `doc/PLAN_ARCHIVE.md`, but they did **not** close clean.
Every open item from them is listed here so that nothing is buried by the split — this list
is the authority, the archive only holds the surrounding context. Each entry names its
archive section.

**Bugs found but not fixed**

- ✅ **The level-3 monster timer stall — no longer reproduces.** Re-checked after
  Phase 12 closed: `npx tsx tools/watch-monsters.ts 3 10 25 200` runs the documented
  repro and the `50000 cap` warning never fires; 5 of 13 groups move and the Muncher
  at (11,29) walks its whole path to (9,25). The next-time computation the entry
  suspected (`Increment_Time_By_W52_Plus_Random` / `EnsureI60NonZero`) was ⏳ when the
  cloud work hit this, and was ported in Phase 12 step 2. Kept here as a record of the
  diagnosis; `tools/dump-clouds.ts` still uses level 2 and need not change.

  <details><summary>original entry</summary>

- 🐞 **The level-3 monster timer stall.** A `TT_MONSTER_AGROUP` timer for the group at
  (10,29) on level 3 re-queues itself at the tick it just ran on, so `processTimers`
  spins until its 50000-iteration cap and **every timer behind it never runs** — on that
  level the game effectively stops. Reproduce: put the party on level 3, run
  `processTimers` from tick 0, and watch the new `TimerSystem: timer pass … hit the 50000
  cap` warning fire on 199 of the first 200 ticks. The trace shows `Standard_Finish`
  reached with `timeUntilAlternateUpdate=0`, which suggests the next-time computation
  (`Increment_Time_By_W52_Plus_Random` / `EnsureI60NonZero`, `doc/CSBwin-src/Monster.cpp`)
  is producing a zero delay where CSBWin guarantees a positive one. Found while porting
  clouds: it was masking the cloud timer on that level.
  `tools/dump-clouds.ts` deliberately kills its test monster on level **2** to avoid it.

  </details>

**Rendering / UI**

- ✅ *(playtest)* **A wall decoration one cell ahead and to the left is no longer cropped
  on the wrong side.** Position 7 (the F2 front-left wall) scales to the width of the F2
  *centre* rectangle and is then drawn into a narrower slot flush against the left border,
  so it must show the bitmap's **right** end — `srcOffsetX = finalBitmapWidth -
  (rect.x2 - rect.x1)` (`doc/CSBwin-src/CSBCode.cpp:3551`). The port computed no
  `srcOffsetX` at all, so it drew the left end instead: cropped on the wrong side, with
  the transparent margin that belonged off-screen showing as a gap from the border.
  Its mirror-image case, position 9, was accidentally right because there the offset
  really is 0. Found by playtest, standing one back and one right of a Hall of Champions
  mirror. Written up in `doc/CSBWIN_DECORATIONS_REFERENCE.md`.

  ⏳ **One deliberate non-port** in the same block: CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored far-right sidewalls
  (positions 1 and 6, `:3536`), compensates for `MakeMirror` reversing a byte-aligned
  buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would shift a
  correctly aligned image. Left out on purpose, with the reasoning in the code.

  ⏳ **No golden frame covers an edge decoration**, which is why this survived so long.
  `tools/dump-hall-of-champions.ts` now pins the geometry that makes position 7 special
  (both edge slots narrower than the bitmap; the front-left window ending flush with its
  right edge, the front-right starting flush with its left) across all 8 rect sets, but
  the pixels themselves are still verified only by screenshot. A sixth frame would want a
  way to place the party, which the probe has no affordance for.

- ⚠️ *(Phase 4)* DSA-based decoration gating and footprints/extended cell flags are not
  ported. Wall and floor decoration selection currently follows `TAG00a4a2` + the actuator
  `wallGraphicOrdinal` for stone/open rooms.
- ⏳ *(Phase 7)* **Rune click flash effect** missing in the magic panel.
- ✅ *(Phase 7 item 14)* **Attack panel** — done (Phase 12 step 7). `src/renderer/ui/Attack.ts`
  ports `GetLegalAttackTypes`, `PrepareAttack`, `DrawAttackButton`, `DrawLegalAttackTypes`,
  `_ExecuteAttack`, `TAG019fac`, `TAG01b29a` and `_FlashAttackDamage`. The F7 debug toggle
  and the placeholder text are deleted; the panel is driven by `word20250`/`word20252` as
  CSBWin drives it. One deferral: `ActionNameFilter` (`ESL_ACTIONNAMEFILTER`), the DSA that
  can rename an option, is not ported — names come straight from `AttackNames`.
- ⏳ *(Phase 7)* **Interaction highlights** — button press/selection effects (flash, shading,
  invert) across UI regions, consistent with the hit-test rectangles.
- ⏳ *(Phase 7.5)* Attack-driven light effects; light-level trace hook. (`atk_LIGHT` itself
  works — this is the *viewport* flash on a blow, not the LIGHT attack.)

**Engine**

- ✅ *(playtest)* **A closing door no longer passes through the party or a monster.**
  `ProcessTT_1`'s two blocker arms are ported (`doc/CSBwin-src/Timer.cpp:1289-1357`):
  the party springs the door fully open, takes `DamageAllCharacters(5, 4, 2)` and only
  then hears `soundDOOROPENING`; a monster takes `DamageMonsterGroup(…, 5)`, the
  survivors are poked with `TT_M3`, and the door steps back **up** one with sound 4.
  Neither existed — the door closed straight through both.

  The nesting was the trap and is written up in `doc/CSBWIN_MOVEMENT_REFERENCE.md`:
  `D4W != 0` guards the *party* arm alone, so a fully open up-down door still crushes a
  `VerticalSize() == 0` monster, and two of the 27 monster types in the shipped data
  are that size. Verified by `tools/dump-door-crush.ts`, which shows level 2's door
  stepping `1 → 0 → 1` over an Ant Man and the party losing 71 HP under it.

- ✅ *(playtest)* **Monsters block the party.** `MoveParty`'s monster arm is ported into
  `MovementSystem.handleMovement` — the `d.NumCharacter != 0` gate, the unfiltered
  `FindFirstMonster` (an immaterial monster blocks too), the silence, and
  `ProcessTimers29to41(x, y, TT_M1, 0)` so the group gets a turn out of being bumped
  into. Before this the party walked straight through every monster, which made every
  combat encounter escapable and every combat playtest measure the wrong game.
  Ref: `doc/CSBwin-src/CSBCode.cpp:8286-8304`, written up in
  `doc/CSBWIN_MOVEMENT_REFERENCE.md`. Verified by `tools/dump-party-collision.ts`.

  ⏳ **Three deferrals from the same block**, all pre-existing gaps rather than new:
  - The **wall-bump damage**: CSBWin answers a terrain-blocked move with
    `DamageCharacter(…, 1, 24, 2)` on up to two champions and only then queues sound 18
    (`:8288-8299`). We queue the sound unconditionally and nobody is hurt.
  - **`DiscardAllInput()` / `d.clockTick = 0`** on any inhibited move (`:8311-8315`).
    Not ported because `DiscardAllInput` drains CSBWin's raw keyboard and mouse queues
    (`:7532`), which is not obviously our 3-deep `movementQueue` — that mirrors
    `CSBUI.cpp`'s key queue. Establishing the mapping needs `CSBUI.cpp` read properly;
    guessing it would change how queued moves behave after every bump.
  - The **vertical-move guard** (`:8200-8204`), which refuses a Move Up / Move Down into
    a monster's cell outright. `MovementAction` has no up/down member, so there is no
    entry point to attach it to yet.

- ⚠️ *(Phase 8)* `PerformLocalAction()` does not map `HandChar` precisely; it uses
  partyPosition matching when `mapPos` is specified.
- ⚠️ *(Phase 8)* The DSA interpreter has many unimplemented ampersand subcodes — see the
  TODOs in `src/engine/DsaSystem.ts`.
- ⚠️ *(Phase 8)* Missile launch, monster creation and `WiggleEverything` still need concrete
  engine hooks — see the TODOs in `src/engine/TimerSystem.ts`.
- ⚠️ *(Phase 8)* DSA object manipulation skips cloud/missile timer updates and does not free
  DB records on delete (CSBWin uses a deferred `DeleteDBEntry`).
- ✅ *(Phase 9 step 11)* **`ThrowByCharacter` is ported.**
  `estimateThrowRange/Damage/Decay` are gone; range, damage and decay come from
  `DetermineThrowingDistance` and skill-10 mastery, in CSBWin's order — the throw raises
  the skill *before* the mastery that sets its range is read. The sound, the stamina cost
  (`TAG016382`) and the action disable came with it; they were missing entirely.
  Ref: `doc/CSBwin-src/Mouse.cpp:672-757`, `doc/CSBwin-src/Character.cpp:2267`.
- ⏳ *(Phase 9 step 12)* Door pass-through rules (DoorTOC + ObjDesc checks for missiles) and
  the magic damage/poison formulas incl. Black Flame fireball healing.
  Ref: `doc/CSBwin-src/Code11f52.cpp:1870+`, `doc/CSBwin-src/Code11f52.cpp:1488+`.
- ✅ *(Phase 9 step 13)* **Clouds are alive.** `CreateCloud` now schedules the `TT_25`
  timer it always needed, and `ProcessTT_25` is ported in full: the death puff shrinks by
  40 a tick and is gone in 3-6, poison lingers ~85 ticks and hurts whoever stands in it,
  and a fireball bursts a door and vanishes. `CreateCloud`'s own blast damage came with
  it, along with `DamageMonsterGroup`, `DeterminePoisonDamage`, `DamageAllCharacters` and
  `HitDoor`, none of which existed. Verified by `tools/dump-clouds.ts`.
  Ref: `doc/CSBwin-src/Timer.cpp:436`, `doc/CSBwin-src/Code11f52.cpp:1376`.

  ⚠️ `HitDoor`'s `delay` argument is not ported — only the zero case is reachable, since
  the delayed form is `Attack.cpp`'s melee (`TT_BASH_DOOR`), which does not exist yet.
- ⚠️ *(Phase 9.5)* Refine spell skill selection once spell definitions exist, replace the
  throw skill gain with CSBWin's tables, and refine the `LastMonsterAttackTime` source now
  that monster AI is in.
- ⚠️ *(new, `src/engine/CharacterStats.ts`)* Two knowingly-different things in the
  weight/load chain, both recorded in the module comment:
  - `CHARDESC.load` is **recomputed** from the possessions rather than cached and
    adjusted at each of CSBWin's eight possession writers. Same value, and it cannot
    drift; `Party.ts` already made the same choice for `SetHandOwner`.
  - The `nameIndex` hook is `Game.getBaseObjectNameIndex`, which returns the *base*
    object name index rather than `RN::NameIndex()`'s modified one. This only matters
    where a modifiable object (0-31) is looked up — `determineMastery`'s Firestaff A/B
    bonus — and it is pre-existing: `Game.ts:844` already fed it the same way. The
    Elven Boots check in `MaxLoad` is unaffected (index 119, outside the range).

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

- ⚠️ F8 (random party) was **not** deleted, contrary to the phase's original wording. Its
  justification — "the only way to get a playable party" — expired with Phase 13 step 4:
  the Hall of Champions works. It is kept only because it is still convenient for
  playtesting; deleting it is now a free choice, not a blocked one.
- ✅ F5/F9 (quick-save/load) **stay**. They are not scaffolding to be removed: they are the
  functional equivalent of the original save menu, and are kept for their convenience
  whether or not that menu is ever ported (Phase 10).

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

**The runtime snapshot now carries the world** (`src/engine/DungeonSnapshot.ts`,
save format v2). It used to carry the party, the tick count, the `ITEM16` pool, the
timers and the missile records and nothing else, so a quick-load reset every dungeon
mutation — doors closed again, moved objects snapped back to their `dungeon.dat`
cells, fired actuators re-armed — while the party kept its inventory. A door opened
with a consumed key was then unopenable and the save was dead. v2 adds cell flags
(with `tiles` re-derived), the object list, every database's records, the DSA state
machine positions and global variables, the champion-bones map, `d.RandomNumber`,
`d.Word11694` and the footprint trail. v1 saves are refused by `quickLoad` rather
than half-restored, since the world state they would need was never written.
Verified by `tools/dump-savegame.ts`. This does not shorten Phase 10 — the binary
format is a separate job — but it removes the reason to rush it.

### Phase 12 — Monsters: AI, movement, combat

Goal: port `doc/CSBwin-src/Monster.cpp` and the attack pipeline in
`doc/CSBwin-src/Attack.cpp`. When this phase opened it was the single largest remaining
gap — there were **no active monsters at all**, only their rendering. Both halves of combat
now work; see `doc/CSBWIN_MONSTERS_REFERENCE.md` and `doc/CSBWIN_ATTACK_REFERENCE.md`.

Several systems already carry proxies waiting on this phase; each must be revisited here:
- `LastMonsterAttackTime` is fed from the missile-hit path instead of real monster attacks
  (gates `AdjustSkills` scaling).
- Monster attack rendering is triggered from the renderer rather than from combat logic.
- Monster teleport rotation/position logic and monster teleporter sounds are stubs.
- `Game.registerChampionBones()` exists but is never called automatically.
- Attack panel (Phase 7 item 14) cannot show real actions without `PossibleAttackTypes`.

All five are now retired — see step 6.

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
   (new): on level 2 with the party at (6,14), most of the 22 groups move over 600
   ticks and none ends up inside a wall; the two groups adjacent to the party both enter
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
   6. ✅ Creature generators — **done**, see step 5.
   7. ✅ The champion melee pipeline from `Attack.cpp`, with the real attack panel —
      **done**, see step 7.

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
   - ✅ **`Attack.cpp` proper** — the champion's own attacks. See step 7.

   - ✅ **Armour now protects.** `TAG01680a` ported: shields held in either hand
     weighted per body part by `Byte1412`, the vitality-scaled random term, the
     champion's shield spell, the party shield, the champion's own attack-type
     modifier, and the garment worn on the struck part. `ClothingDesc.uByte1/uByte2`
     extracted from graphic `0x22f` and `Byte1412[6]` from `0x232`; bit 7 of
     `uByte2` marks a shield, verified as exactly the seven shields in the shipped
     data. Measured: one body piece cuts damage ~6%, a full suit ~18%.

   ✅ **Both divergences closed** by `src/engine/CharacterStats.ts`:
   - `TAG01680a`'s `DetermineThrowingDistance(chIdx, hand)` term
     (`Character.cpp:2416`) is in, so a shield too heavy for its bearer protects less.
     The full suit in `tools/watch-monster-attacks.ts` moved from 18% to 20%.
   - **`Quickness` uses load**: a champion carrying 504 against a 500 max load averages
     13.2, an empty-handed one 26.5 (`tools/dump-throwing.ts`).

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
6. ✅ **Retire the proxies.**
   - ✅ `LastMonsterAttackTime` is fed by `MonsterAttacks`, not the missile path.
   - ✅ The renderer-side attack trigger is **deleted** — `onMonsterAttackState`,
     `handleMonsterAttackState` and `playMonsterAttackSound` are gone. The attacking
     flag is set by the AI and the renderer only reads it, so a monster attacking off
     screen is no longer silent.
   - ✅ `Game.registerChampionBones()` is called automatically from `KillCharacter`.
   - ✅ Monster teleport rotation and teleporter sounds are real (`moveMonster`).
   - ✅ The attack panel is real (step 7); the placeholder text and its F7 debug
     toggle are deleted.

7. ✅ **The champion's own attacks** (`Attack.cpp`). See
   `doc/CSBWIN_ATTACK_REFERENCE.md` for the whole shape.
   - ✅ **`src/engine/AttackSystem.ts`**: `_Attack`'s dispatch over all 44
     `ATTACKTYPE`s, `AttackWithPhysicalForce`, `DeterminePhysicalAttackDamage` with
     both damage rolls and the three special-cased blades, `PhysicalAttackFilter`,
     `DetermineAttackOrdinal`, `WarCryEtc`, `AttackWithSpell`,
     `DecrementChargesRemaining`, `SetCharToPartyFacing`, `FluxCage`,
     `IsCellFluxcage` and `IsLordChaosHere`. `ATTACKPARAMETERS` is kept as one block,
     as CSBWin does, because the Party Attack Filter is handed the whole thing.
   - ✅ **The Party Attack Filter** (`ESL_PARTYATTACKFILTER`): `SetupDSAParam` and
     `CallAttackFilter` via `DsaSystem.findPartyAttackFilter` /
     `callPartyAttackFilter`, called at `msg` 0, 1 and 2 with the same block mutated
     in place.
   - ✅ **`src/renderer/ui/Attack.ts`**: `ItemHasChargesLeft`,
     `GetLegalAttackTypes`, `PrepareAttack`, `_ExecuteAttack`, `TAG01b1c0`,
     `DrawAttackButton`, `DrawLegalAttackTypes`, `TAG019fac`, `TAG01b29a` and
     `_FlashAttackDamage`, over new `UIState` fields mirroring
     `AttackingCharacterOrdinal` / `PossibleAttackTypes` / `Byte20256` /
     `Word20248` / `Word20250` / `Word20252`.
   - ✅ **Supporting ports that were missing**: `CharacterThrowsSpell` and
     `LaunchObject` (`Magic.cpp:449`), `EnableCharacterAction` (`Timer.cpp:2638`)
     with the bow's auto-reload and the thrown weapon's hand refill (`TAG0115ee`,
     `TAG011594`, `TAG0153c2`), `RemoveCharacterPossession`, `TT_24` and
     `CreateFluxcage` (`Code11f52.cpp:1515`), `MagicShield`'s return value, and
     `ThrowByCharacter` with the filter's range/damage/decay overrides.

   **Four real bugs fell out**, all recorded in `doc/PROVEN_FACTS.md`:
   - **`CT_FLUXCAGE` is 50, not 7.** `MonsterPerception` was comparing against
     `CT_POISON`, so an invincible monster was stopped by a poison cloud and walked
     straight through a Fluxcage — the mechanism the Lord Chaos fusion depends on.
     The constants now live in `src/engine/cloudTypes.ts`.
   - **The party's turn never rotated the champions.** CSBWin adds the turn delta to
     every champion's `charPosition` *and* `facing` (`Code11f52.cpp:4085`); neither
     moved here, so a champion kept attacking in the direction the party faced when
     they joined, and the corner marker in their box rotated when it should not.
     Ported as `setPartyFacing` in `src/engine/Party.ts`, which the plain turn, the
     teleporter rotation and the pit shuffle now all go through — as in CSBWin, where
     all three are `MoveObject`.
   - **`charPosition` was doubling as the portrait slot.** `Character.ts`,
     `Inventory.ts`, `Feeding.ts` and `MagicPanel.ts` looked champions up by
     `partyPosition === chIdx`; CSBWin indexes `d.CH16482[chIdx]` directly, and once
     the corner rotates the two part company. All four now index by champion number.
   - **`ordinalOfMonsterAtPosition` existed twice and one copy was wrong.**
     `MonsterAI`'s iterated the group ascending and skipped CSBWin's parity walk-back
     for a two-corner monster. Extracted to `src/engine/monsterPosition.ts` and shared
     with `TimerSystem` and `AttackSystem`.

   Also added: `ClothingRecord.charges` (`DB6` bits 9-12), which no loader was
   reading, and `Game.setRandomSeed` so a whole-`Game` tool can pin `d.RandomNumber` —
   `watch-monster-attacks.ts` and `dump-clouds.ts` were unseeded and are now
   reproducible.

   ⚠️ **`dump-clouds.ts`'s half of that never took effect** and was only found when
   `tools/` was brought inside the type gate (Phase 15 step 1): its
   `game.setRandomSeed(0x12345678)` sat *after* a `return new Game(...)`, so it was
   dead code and every run drew a fresh `Math.random()` seed. Fixed; the tool now
   produces byte-identical output across runs.

   ⚠️ **Deferrals, all deliberate:**
   - **Lord Chaos's endgame** — `_Fusion` (`Attack.cpp:133`) and `_FusionSequence`
     (`:2220`). `atk_FUSE` runs its filter and does nothing else. It cannot be
     exercised until Lord Chaos works, so porting it now would land untested.
   - **`ActionNameFilter`** (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8680`) — the DSA that
     can rename an attack option. Option names come straight from `AttackNames`.
   - **`d.SupressPitDamage`** is not modelled, because the party's own pit-fall damage
     is not ported at all. `atk_CLIMBDOWN` moves the party down the pit through the
     normal `resolveCellEffects` chain and nothing is hurt — which is currently also
     true of falling in by accident.
   - **`_FlashAttackDamage`'s `VBLDelay(15)`** stops the whole game for a quarter
     second. The flash is a timed overlay of the same duration instead; the game keeps
     running underneath, as it already does for the feeding animation.
   - **`FluxCage`'s duplicated neighbour test** (`:1626-1630`) tests `(LCX, LCY-1)`
     twice and never looks south. Kept as written — it is what the real game does.
   - **`atk_SHOOT` overwrites the damage it computes** with the launcher's weapon class
     (`:1905-1906`). Plainly a bug in the original; kept.

   Verified with `tools/dump-player-attacks.ts` (new), seven cases on the real dungeon:
   a sword's menu reads SWING / PARRY / CHOP with mastery requirements 2 and 3 and a
   bare hand reads PUNCH / KICK / WAR CRY — the canary that pins the graphic `0x230`
   offsets; each of the four corners reaches a different member of a two-worm group;
   300 SWINGs by a mastery-4 champion land 213 blows for 798 damage against a mastery-8
   champion's 212 for 915, which is how we learned the hit check ignores skill
   entirely; a well-fed champion wipes a ~590-HP worm group in 115 swings; the two
   back-rank corners report "CAN'T REACH" on all 20 attempts and the front two never
   do; 60 SWINGs at a Rive deal 0 and 60 DISRUPTs deal 429; all five shouts frighten
   the group exactly when `base + mastery` can reach its bravery; and FREEZE LIFE steps
   70 → 140 → 200 → 200. Fourteen new entries in `doc/PROVEN_FACTS.md`. The
   `tools/check-frames.sh` attack frame is *deliberately* rebaselined — it used to
   capture the F7 placeholder and now captures the real menu.

**Scope note.** `Attack.cpp`'s Lord Chaos endgame — `_Fusion`, `_FusionSequence` — is
**deliberately deferred**: it cannot be exercised until both monsters and Lord Chaos work,
so porting it now would land untested. `FluxCage`, `IsCellFluxcage` and `IsLordChaosHere`
*are* ported, since they are reachable today. Validation is `tools/dump-player-attacks.ts`,
`tools/watch-monster-attacks.ts` and `tools/check-frames.sh`, plus the dev-only AI trace
mirroring CSBWin's own `AITraceActive`/`AttackTraceActive` output so the two codebases stay
diffable; a real test framework stays Phase 15.

Status: ✅ done — steps 1-7 complete, with the deferrals listed under each step. What
remains of combat is not in this phase: the party's own pit-fall damage, the Lord Chaos
endgame (Phase 13's neighbour), and `CreateMovementTimer`'s overflow guard (step 2).

### Phase 13 — Champion lifecycle

Reference: **`doc/CSBWIN_CHAMPION_LIFECYCLE_REFERENCE.md`** — the attribute model,
`AddCharacter`, `KillCharacter`, the Vi altar, reincarnation, potions and pit falls,
with citations. Read it before touching any step below.

The phase was audited against CSBWin in September 2026 and re-ordered: three of the
original steps turned out to be largely done already, and the rest turned out to share
one missing primitive.

#### Prerequisites

0. ✅ **The `ATTRIBUTE` triple.** `CHARDESC.Attributes[7]` is seven
   *(maximum, current, minimum)* byte-triples (`doc/CSBwin-src/CSB.h:2409-2435`,
   `:2565`), not seven numbers. `src/engine/attributes.ts` ports it, including
   CSBWin's byte-wrap and its "above 240 means negative" read
   (`doc/CSBwin-src/data.cpp:1695-1741`), `AddCharacter`'s initial values
   (minimum 30, 10 for Luck, cap 224 — `doc/CSBwin-src/Character.cpp:640-659`) and
   `AdjustCurrentAttribute` (`doc/CSBwin-src/Character.cpp:3900-3934`).
   `tools/dump-attributes.ts` asserts all of it against the real mirrors.

   This was a prerequisite for nearly everything else in the phase — reincarnation
   penalties, the four attribute potions, the red box around the eye, the stats-panel
   colours — and it **fixed a live bug**: `levelUp` raised what was effectively
   *current* where CSBWin raises *maximum* (`doc/CSBwin-src/Magic.cpp:98-148`), so a
   level gain silently healed the attribute instead of opening a gap. It also closed
   the ⚠️ in `isCharacterLucky`, which had no min/max to clamp against, and replaced
   the `attrMax = attrValues.slice()` placeholder in the stats panel, where the
   red/green colour logic had been comparing a value with itself.

   The quick-save format went to v3; older quick-saves are refused, not upgraded.

1. ✅ **`AdjustStamina`** (`doc/CSBwin-src/Code11f52.cpp:4413`) —
   `MonsterAttack.adjustStamina`. Subtracts (so a negative value restores), clamps to
   `[0, MaxStamina]`, and turns any overshoot below zero into
   `DamageCharacter(chIdx, over/2, 0, 0)`. Wanted by step 6 and by anything that tires
   a champion.
2. ✅ **`SelectMagicCaster` and `d.GameIsLost`** — the two missing outcomes of
   `KillCharacter`'s tail. `selectMagicCaster` is in `Party.ts` beside `setHandOwner`,
   and `PartyState.gameIsLost` is set when the search finds nobody. The tail now runs
   CSBWin's own loop, skipping `potentialChampionIndex` — a new field, always -1 until
   Phase 13 step 4 sets it. `Game.onChampionDied` no longer blanks the magic tab, which
   would have undone the hand-off.

   This turned up a **real bug and fixed it**: `Party.getPartyChampion` resolved a
   champion by matching `partyPosition`, which is `CHARDESC.charPosition` — the corner
   of the cell, which `setPartyFacing` rotates. Every consumer of `cursorOwner` and
   `magicCasterIndex` reads them as list indices, and so does CSBWin
   (`d.CH16482[chIdx]`), so after the party turned, `setHandOwner(party, 1)` validated
   whichever champion had drifted into corner 1. It is now a plain list index, and
   `killCharacter` passes one.

   ⏳ **The same conflation survives in `src/renderer/ui/MagicPanel.ts:204-206`**, which
   both writes `magicCasterIndex = champion.partyPosition` and picks the rune-control
   rectangle by `partyPosition`, though the four boxes do not rotate. Left alone here
   because it is a UI change that wants the golden frames re-examined, not because it
   is right.
3. ✅ **Poison as a timer.** `TT_75` is ported: `poisonCharacter` deals
   `Larger(1, strength/64)` unmitigated damage and arms the next tick 36 ticks out
   carrying the remaining count; `TimerSystem.processPoisonTimer` drops `poisonCount`
   and calls back in, so the count sits at 1 for the whole illness; `curePoison`
   deletes the champion's pending `TT_75` timers, and `killCharacter` calls it. Before
   this, `poisonCount` only ever went up.

   `tools/dump-champion-state.ts` covers all three (36 checks) and caught a real defect
   while doing it: `schedulePoison` called `addTimer` after
   `createTimerWithUByte5`, which queues the entry itself, so two copies fired in the
   same pass and poison ran at double rate.

#### Steps

1. ✅ **Death.** Ported in Phase 12: `killCharacter` drops the possessions, creates the
   `value = 2` bones record at the champion's own cell position, and registers the
   bones↔champion mapping through `Game.registerChampionBones()`.
   ⏳ Still missing: the **character-death filter** DSA (`ESL_CHARDEATHFILTER`,
   actuator type 47, `doc/CSBwin-src/Character.cpp:2535-2589`) that runs before
   anything else.
2. ✅ **Item naming.** `getObjectDisplayName` prefixes the champion's name to the bones
   (`src/renderer/ui/Objects.ts:203`), matching
   `doc/CSBwin-src/Character.cpp:3549-3580`. Only actually reachable since the
   `misc_Boulder` mix-up under step 3 was fixed: the objects it tests for were never
   being created.
   ⚠️ It resolves the fingerprint against the *live party* only; CSBWin's
   `CHARDESC::CopyCharacter` also searches the wings (`:5239`), which we do not have.
3. ✅ **Resurrection at the Vi altar.** The `TT_VI_ALTAR` three-state timer is ported
   (`src/engine/TimerSystem.ts`), and the four gaps this step carried are closed:
   - state 2 now calls `CreateCloud(RNffe4)` over the bones
     (`doc/CSBwin-src/Timer.cpp:2730`), so the resurrection is visible;
   - `reviveChampion` became `bringCharacterToLife` and does the whole of
     `doc/CSBwin-src/Character.cpp:804` — the free-`charPosition` search when theirs is
     taken, and `facing = partyFacing`;
   - `findViAltarChampionIndex`, which guessed, is deleted. State 1's second arm reads
     `chIndex = DB10A2->value()` (`Timer.cpp:2789`) — for bones with no expool record
     the `value` field **is** the champion index, which `src/core/constants.ts` already
     said and nothing acted on;
   - the same two arms are now in the drop handler that *schedules* the timer
     (`Mouse.cpp:894-960`). `maybeScheduleViAltar` had only ever tested
     `value == 2`, which is the fingerprint arm's rule; a dungeon-authored bones object
     aimed at any champion but index 2 could not be placed in the altar at all.

   ⏳ **The wings are still absent** — CSBWin resolves a fingerprint that matches
   nobody in the party through `CHARDESC::GetFromWings`, heals that champion to
   `MaxHP/2` and saves them back (`Timer.cpp:2769-2782`). This port has no store of
   champions who have left the party, so there is nothing to search; the bones are left
   on the floor rather than silently destroyed. `Party.findChampionByFingerprint` is
   the one place that would grow the second half, and it names the gap.

   Along the way: three ad-hoc copies of `CHARDESC::CopyCharacter`'s party search
   (`TimerSystem`, `Game`, `Objects.ts`) collapsed into that one function, and the two
   copies of `CharacterAtPosition` into one — they had already drifted, `AddCharacter`'s
   omitting CSBWin's `HP() != 0` test. That omission was load-bearing in the opposite
   direction: without it a revived champion matches *themselves* and every
   resurrection relocates, and a full party sends the free-corner search off the end.

   `tools/dump-vi-altar.ts` drives both arms, the refusal of a living champion and the
   corner search (20 checks). It found **a real bug before it could even run**:
   `MonsterAttack.ts` declared its own `MISC_BONES_OF_HERO = 25` next to the correct
   `5` in `src/core/constants.ts` (`doc/CSBwin-src/Objects.h:192`), so every champion
   who died left a **boulder** (`misc_Boulder = 25`). Nothing downstream recognised it:
   the bones never took the champion's name (step 2, believed done), and the altar
   could never accept them — the entire death → altar → resurrection path was dead, in
   a step marked as working.

   **Reincarnation is not here** — it belongs to the Hall of Champions, step 4.
4. 🔄 **Character creation.** `main.ts`'s `addCharacterFromPortrait`, which dropped a
   preset hero straight into the party, is gone. `Game.addCharacter` ports
   `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) and
   `Game.resurrectReincarnateCancel` ports `_ResurrectReincarnateCancel`
   (`doc/CSBwin-src/CSBCode.cpp:6615`); the actuator hook is wired inside `Game` now, so
   the tools reach it too. Done:
   - `potentialChampionIndex` — the "almost but not quite added" state. It gates the
     mouth (`Character.cpp:4061`) and, through the click dispatcher
     (`Mouse.cpp:1578-1650`), the portrait boxes, the inventory buttons, the magic panel
     and the attack panel. That is the only thing making the menu modal — CSBWin has no
     mode flag for it.
   - The Resurrect/Reincarnate/Cancel menu: `drawResurrectMenu` (`TAG0189a8`) blits
     graphic 40 and sets `displayResurrectChestOrScroll = 5`, which is what
     `Mouse.ts`'s `tag01a6ea` (`CSBCode.cpp:8500`) switches on to turn a click on button
     id 81 into a `buttons18372` hit. The chest arm of the same function moved with it.
   - **Reincarnate**: all 20 skills wiped, the hero's own
     `reincarnateAttributePenalty`/`reincarnateStatPenalty` charged (`DM_rules` is false
     by default, `data.cpp:251`, so they do apply), then 12 random attribute points —
     hardcoded in CSBWin, *not* the `randomPoints` field it parses.
   - **Cancel**: the champion is popped, `SetHandOwner(-1)` if they were the only one.
   - The mirror cell's objects as possessions, through CSBWin's `switch`/`goto case9`
     slot search — including the fall-through that makes slot 6 unreachable.
     `AddCharacterPossession` deliberately leaves them linked in the room; Resurrect
     `RemoveObjectFromRoom`s them, Cancel does not, which is what makes the undo clean.
   - Disabling the portrait actuator afterwards, with the `BlockDisables` rule.
   - The fingerprint from `(partyLevel<<10)|(partyX<<5)|partyY`. `Game`'s invented
     `nextChampionFingerprint` counter is deleted; `assignChampionFingerprint` now
     derives it the same way for every champion, including those loaded from a save.

   Along the way `HeroExtractor` was made faithful where it had been approximate:
   `statNumbers` is now `DecodeCharacterValue` (`'A'`..`'P'` only, `Character.cpp:414`)
   where it used to accept `'A'`..`'Z'` and build nonsense hex, the MAXHP/MAXSTAMINA/
   MAXMANA clamps are applied, and `reincarnateAttributePenalty`/`reincarnateStatPenalty`
   are parsed off the end of the skill letters. All 24 shipped heroes still parse and
   take the 2/8 fallbacks.

   `tools/dump-hall-of-champions.ts` drives the whole flow through `handleWallClick` at
   the real level-0 mirrors of HALK, BORIS, WU TSE and AZIZI (133 checks, including the
   edge-decoration geometry below). Verified in
   the browser too: menu, Cancel, Resurrect, and the spent mirror refusing a second
   click.

   ✅ **The mirrors show the champions' portraits** (playtest follow-up, strictly a
   rendering job rather than part of the phase). `SummarizeRoomInfo` was already
   computing `championPortraitOrdinal`; nothing consumed it. Now
   `StdDrawWallDecoration` passes it to `drawWallDecoration`, which was restructured
   into CSBWin's own two independent halves — frame under `graphicIndex >= 0`, portrait
   under `relativePosition == 12`, early return only when *both* are absent — and
   `drawChampionPortrait` blits the 32x29 cell out of graphic 26 with transparent colour
   **1**, so the glass shows around the head. `d.Byte2546`, the destination rectangle, is
   now extracted from graphics.dat item `0x22e` where the parser previously skipped it;
   the canary is CSBWin's own recorded `0x60,0x7f,0x23,0x3f`. Written up in
   `doc/CSBWIN_DECORATIONS_REFERENCE.md`, and verified in the browser at four mirrors
   plus the distance and spent-mirror cases.

   ⏳ **Gaps:**
   - `ReIncarnate` itself (`doc/CSBwin-src/Code13ea4.cpp:20`), the viewport screen that
     blanks name and title and has the player type new ones, is **not ported** — a
     reincarnated champion keeps the hero text's name. It needs a keyboard-driven modal
     screen the UI has no equivalent for; everything after it is done.
   - `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`) is
     not ported. It only fires when the actuator carries a `DisableMessage`, a CSB
     extension the shipped DM dungeon never uses; the `actuatorType(0)` half is done.
   - `pcA3->talents` (`Character.cpp:688`) is parsed by CSBWin and dropped here —
     `Champion` has no field for it.
   - The `legalHero` fallback (`Character.cpp:475`) is not ported. CSBWin clamps a hero
     text that overflows MAXHP/MAXSTAMINA/MAXMANA or carries an out-of-range letter,
     marks it illegal and retries against its built-in "BOGUS / ILLEGAL HERO" string;
     `HeroExtractor` rejects such a hero outright, so a third-party dungeon with a bad
     hero text gets no champion where CSBWin would give a bogus one. No shipped DM hero
     is affected.
   - The portrait bitmap still comes from our own `portraitGraphic` path, not
     `TAG0088b2`'s copy into `CHARDESC.portrait`; external portraits for `charID > 23`
     are not supported (`GetExternalPortraitAddress`, a CSB extension no shipped DM hero
     uses).
   - **F8 (random party) is still there.** Its stated justification — "the only way to
     get a playable party" — is now gone, so it can be deleted whenever the author
     stops wanting it for playtesting. Left in deliberately rather than removed in the
     same commit as the feature that replaces it.
5. 🔄 **Drinking potions.** `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4020-4497`)
   is ported as its two halves: `src/renderer/ui/Feeding.ts` derives a
   `FEEDPARAMETERS` block from the object on the cursor, and
   `src/engine/Feeding.ts` applies it, in CSBWin's order, through the `applyFeeding`
   UI hook. All ten acting potion types work, the Ya potion arms its `TT_72`
   expiry timer (newly ported), and a lethal `hitpointAdjust` goes through
   `KillCharacter`. `tools/dump-feeding.ts` drives it over the **real potion records
   in `dungeon.dat`** (47 checks).

   `PotionType` in `src/core/constants.ts` was a guessed enum with eight invented
   members and the wrong values; it is now transcribed from
   `doc/CSBwin-src/Objects.h:14-37`, and the two files that had each written their own
   local constant use it.

   ⏳ **The Feeding Filter DSA is not ported** (`:4288-4344`). The insertion point is
   marked in `handleMouthPress`; no dungeon we load defines `ESL_FEEDINGFILTER`, and
   the parameter marshalling is its own job.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping, and CSBWin's incremental
   `CHARDESC.load` update — `characterLoad` re-sums instead, as it already did.
6. ✅ **Pit fall damage + stamina drain**, for party and monsters
   (`doc/CSBwin-src/Code11f52.cpp:3016-3106`). The pit branch of
   `TimerSystem.resolveCellEffects` now damages what falls through it:
   `DamageAllCharacters(20, 48, 2)` plus sound 6 for a free fall, a per-champion
   `AdjustStamina(25*load/MaxLoad + 1)` when `supressPitDamage` is set, and
   `DamageMonsterGroup(rec, oldX, oldY, 20, …, noItem16)` for a monster group — at the
   cell it fell *from*, because nothing is relinked until the resolver returns.
   `climbDownIntoPit` sets the flag through `withSupressedPitDamage`, and the fall
   clears it, so only the first drop of a chain is free.
   `tools/dump-pit-fall.ts` drops a party down a real pit in the shipped dungeon
   (12 checks).

   This turned up **a second real bug in the Phase 12 damage chain**: `damageCharacter`
   was missing CSBWin's `P4 == 2` branch, which halves the *armour* before the
   `130 - armour` scaling (`doc/CSBwin-src/Character.cpp:2780`). Every fixture in the
   tools is unarmoured, where `0 >> 1` is still 0, so nothing had shown it. It affects
   pit falls and both cloud damage paths.
7. ✅ **The eye and mouth boxes are drawn.** `drawMouthAndEyeBoxes`
   (`src/renderer/ui/Inventory.ts`) ports both blits of
   `doc/CSBwin-src/Character.cpp:1363-1392`: graphic **34** in place of **33** for the
   mouth when `food < 0`, `water < 0` or poisoned, and for the eye when any of
   attributes **1..6** has Current < Maximum. Luck is index 0 and CSBWin's loop starts
   at 1, so it can never mark the eye. Both go into `d.Word1398` / `d.Word1406`, which
   were already extracted, with transparent colour 12 so the icon shows through.

   The "red square on level gain" is answered and is **not level-specific**: a level
   raises the maxima (`Magic.cpp:98-148`) and leaves Current behind, and a drained
   champion shows the identical box.

   ⚠️ **The golden frames cannot see this**, and said so: all five were byte-identical
   after the change, because graphic 33 is the same pixels as the background beneath it
   and the frames only ever capture a fed, undamaged party.
   `tools/dump-status-boxes.ts` (28 checks) covers it instead — both rectangles out of
   `graphics.dat`, both graphics measured and proved to *differ*, and every arm of both
   predicates. Verified red in the browser too, at a champion made starving, poisoned
   and Strength-drained at once.

   One transcription trap worth keeping: `BLT2Viewport(…, 16, 12)` is a **16-byte
   source stride** (32 pixels) and transparent colour 12 — not a 16x12 image. The boxes
   are 18x18 on screen, and 18 pixels padded up to whole bitplane groups is what makes
   the stride 32. Passing the visible width as the stride would skew every row.
8. ✅ **The rest of `KillCharacter`'s tail** (`doc/CSBwin-src/Character.cpp:2670-2694`)
   — done as prerequisite 2. The cursor and the magic tab both move to the first living
   champion, `gameIsLost` is set when there is none, and `CurePoison` runs on the
   corpse.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping (`CHARFLAG_*`), which this port
   has no equivalent for — the renderer redraws from state every frame.
9. ✅ **`handChar` is read from the save block.** The GAMEBLOCK2 offset was never
   unknown — CSBWin's struct comments give the whole 128-byte layout
   (`doc/CSBwin-src/SaveGame.cpp:107-133`): `handChar` at 20, `MagicCaster` at 22.
   `parseBlock2` reads both, `saveSaveGameState` writes both, and
   `applySaveGameState` takes an optional party and assigns them the way `LoadGame`
   does (`:1636-1637`) — **directly**, not through `SetHandOwner`/`SelectMagicCaster`,
   which validate and rewrite facing. The layout is now written up in
   `doc/CSBWIN_SAVEGAME_REFERENCE.md`.

   Establishing the offset turned up **the reason a real DM save could not have been
   read anyway**: the whole block codec was little-endian. CSBWin never says the file
   is big-endian in words, it says it in `LE16`s — `Unscramble`'s hash arithmetic
   (`doc/CSBwin-src/CSBCode.cpp:9057`), `ReadUnscrambleBlock`'s (`:9083`) and every
   `BO()` in `swapBlock2` (`SaveGame.cpp:455`) — and `LE16` is a byte swap on the
   little-endian build CSBWin ships as. Reader and writer agreed with each other, so
   every checksum matched and the round trip was perfect, in a format no other program
   could read. Blocks 1 and 2, `ITEM16`, the characters and the timers are now
   big-endian; the CSB "Extended Features" header stays little-endian, because
   `SwapExtendedFeaturesBlock` is a no-op unless `_bigEndian` (`SaveGame.cpp:275`). The
   quick-save format went to v4 — old quick-saves are refused, not upgraded.

   `tools/dump-savegame-blocks.ts` (22 checks) is the first test the binary half has
   ever had; `dump-savegame.ts` only ever covered the runtime JSON. A round trip cannot
   see a byte order, so the tool differences two saves instead: `scramble`'s keystream
   depends on the hash and word index but never on the content, so changing
   `handChar` from 2 to 3 must move **byte 21** of block 2 and nothing else, where a
   little-endian writer would move byte 20. It caught a second defect on its first run:
   the `ITEM16` writer wrote bytes 2, 3 and 12-15 only, dropping each record's `word0`
   and its whole 4-11 middle, so a save carrying only these blocks lost its monster
   groups. Masked until now because the runtime half also carries `dungeon.item16` and
   is applied after.

Status: 🔄 in progress — prerequisites and steps 3, 6, 7, 8 and 9 done; steps 1, 2 and 5
done bar the gaps noted against each. **All that is left is the Reincarnate name-entry
screen under step 4** (`doc/CSBwin-src/Code13ea4.cpp:20`); every other open item in the
phase is a deferral recorded against its step.

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   twenty-four asserting tools, then four non-asserting dumps as crash-only smoke, then
   the frames with `--frames`. ~6s, ~17s with frames. Failures print the tool's whole output,
   because the table above a failed assertion is what says which way the port went wrong.
   Tools are listed in the runner with the arguments their assertions were written for.
   `tsx` is now a devDependency — the suite used to depend on `npx` fetching it.

   ✅ **`tools/` is inside the type gate.** `tsconfig.json` was `"include": ["src"]`, so
   `tsc --noEmit` — the thing this plan calls "the real gate" — never looked at the
   regression suite at all. Two errors slipped through in a single session before this
   was noticed: a call to a `setPlaySound` that does not exist, and a
   `TimerFunction.TT_1` that is spelled `TT_DOOR_STEP` here and therefore evaluated to
   `undefined`, so the timer was never dispatched and the tool silently measured
   nothing. Turning it on surfaced 34 errors; all are fixed. Of those, two were real:

   - `dump-clouds.ts`'s dead `setRandomSeed` (see Phase 12 step 7 above);
   - `watch-monster-attacks.ts`'s clothing fixtures never gained the
     `ClothingRecord.charges` field Phase 12 added to the record.

   The rest were unused locals plus twenty `Property 'timerSystem' is private`, which
   is now `readonly` and public like `timerQueue` and `monsterSystem` — the tools
   already drove it, TypeScript just could not see them doing it. `extract-graphics.ts`
   keeps its parked portrait-slicer setup alive with `void` references rather than
   deleting work that is only commented out.

   Came with `tools/lib/check.ts` (shared `check`/`fail`/`finish`, and `finish()` fails a
   run that made no checks) and with real assertions for the four tools that could not
   fail — see the ⚠️ under "Validation debt" above.
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` now starts its own dev
   server and headless Chrome (reusing ones already up), uses a throwaway Chrome profile,
   and takes `--update` to refresh the baseline; `tools/probe-frames.mjs` pins the viewport
   with `Emulation.setDeviceMetricsOverride`, which it did not before — the committed
   baseline was 1600x861 only because of the window decoration of the one browser that
   captured it, and every freshly started Chrome diffed on all five frames. The baseline
   was re-captured at 1600x1000 and verified byte-identical from both a fresh browser and
   the original one, so the *content* is unchanged.

   Still owed to make it a real test: a fixed set of *party positions* rather than whatever
   the boot dungeon gives, and rendering straight from the index buffer instead of a browser
   screenshot (no dev server, no Chrome).
3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. ⏳ **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: 🔄 in progress — steps 1 and 2 done; 3, 4 and 5 remain.
