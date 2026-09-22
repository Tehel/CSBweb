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
- The whole pre-game sequence (Phase 16): the title animation, the dungeon entrance with
  its three buttons, the door-opening animation and the credits scroll.

**Known-incomplete, in rough priority order:**
1. ✅ **Message area** — done (Phase 11). CSBWin's `SCROLLING_TEXT` is ported: fragment-based
   emission, 53-column word wrap, 4 rows with 70-tick expiry, and `updateDebug()` demoted to
   the external debug log. Scroll *animation* and save-game serialization remain deferred.
2. ✅ **Combat works both ways** — done (Phase 12). `Monster.cpp` is ported: groups
   hunt, flee, throw missiles, hit the party, take damage and die, and a killed
   champion leaves bones. `Attack.cpp` is ported too: the attack menu offers each
   champion's legal options and every attack type resolves, through the Party Attack
   Filter. Lord Chaos's fusion endgame is the one deliberate omission.
3. ✅ **The champion lifecycle is done** (Phase 13). Champions are created at the Hall
   of Champions mirrors, named on the Reincarnate keyboard screen, fed, poisoned,
   drained, dropped down pits, killed — leaving bones — and brought back at the Altar
   of Vi. What is left of the phase is a short list of deferrals, all of them either
   DSA filters no dungeon we load defines or the **wings**, a store of departed
   champions this port does not have; they are listed under "Carried-over debt".
4. ✅ **Clouds work** — `CreateCloud` schedules its `TT_25` timer and `ProcessTT_25` is
   ported, so clouds shrink, damage and expire (Phase 9 step 13).
5. ✅ **Throw stats** — done. `WEAPONDESC` is extracted and `ThrowByCharacter` is
   ported over the real `DetermineThrowingDistance` chain (Phase 9 step 11).
6. ✅ **Debug scaffolding** — done (Phase 14). Now confined to `src/dev.ts` and reached only
   through `isDebugFeaturesEnabled()`.
7. ✅ **`ViewportRenderer.ts` god object** — done (Phase 14). Split from 3809 lines to 723;
   the UI now lives in `src/renderer/ui/`.
8. ⚠️ **CSBWin-binary-compatible save files** — the **reader is done** (Phase 10 step 12,
   September 13th) and **the live path now writes a whole file** (September 14th): the
   game's own save button emits all sixteen blocks, and
   `tools/dump-live-save-file.ts` writes one from a game played out of `dungeon.dat` and
   one from a game played on from a genuine save, and loads both back into a running
   engine with the world, the party, a thrown object still in flight and the object on
   the cursor intact. What that needed was not plumbing: CSBWin's three load-time
   conversions are ported (`src/data/CsbwinDungeonConversions.ts`), so the in-memory
   world is always save-shaped. What is left of the phase is **block 1**, which is still
   a stub of valid checksums over fields this port does not model. See Phase 10's "What
   is left, in one place".
9. ✅ **The party's own pit-fall damage** is ported (Phase 13 step 6), and
   `supressPitDamage` now has something to suppress.

**Validation debt:** several phases below list "Validation" steps (render tests, render
probes, pixel comparisons against CSBWin screenshots) that were **never carried out** —
there is no test framework in the project at all. Verification has been visual and ad hoc.
Those items are now marked 🚫 where they were silently skipped; Phase 15 addresses this.

`npm test` now exists (Phase 15 step 1) and runs both standing forms of evidence in ~14s,
or ~33s with `--frames`. There is still no test *framework*; what there is:

1. `tools/probe-frames.mjs` + `tools/check-frames.sh` drive the real app over the
   DevTools Protocol and compare eight screen states against `tools/frames/`. Built
   to make the Phase 14 split safe. No assertions beyond equality. The script starts
   its own dev server and headless Chrome.

   Pinning the viewport was **not** enough to make the frames portable, as a move to a
   second machine showed: a full-page screenshot carries the DOM debug chrome, drawn with
   the host's fonts and widget theme, and `cmp` on two PNGs tests the Chrome build's
   encoder rather than the rendering. The probe now reads the 320x200 canvas back with
   `getImageData`, writes the PNG itself (`tools/lib/png.mjs`), and
   `tools/compare-frames.mjs` decodes both sides and compares pixels. Nothing in the
   comparison depends on the host any more.

   The same pass found `04-inventory-sel` had been identical to `03-inventory` since it
   was captured: it clicked (15,15), which is champion 0's party block (button id 12),
   not the inventory grid, so no selection ever happened and the frame could not fail.
   It now clicks (41,66) — body slot 2, HALK's Bezerker Helm — and covers the three
   things a selection changes: the vacated slot, the held object's name in the top-right
   line, and the `LOAD` readout. `compare-frames.mjs` fails a baseline containing two
   identical frames, so a dead frame cannot come back unnoticed.
2. **Forty assertion-carrying verification tools**, plus four run for crashes only.
   **`tools/run-checks.mjs` is the authority on the list** — it is not repeated here,
   because the hand-kept copy that used to sit in this bullet drifted to thirteen tools
   out of date before anyone noticed. Run `npm test` to see the roll. Broadly: the save
   and CSBWin-file group (`dump-savegame*.ts`, `dump-csbwin-*.ts`,
   `dump-character-block.ts`, `dump-save-roundtrip.ts`, `dump-portraits.ts`), the monster
   group (`dump-monster-*.ts`, `watch-monster*.ts`), the champion group
   (`dump-champion-*.ts`, `dump-feeding.ts`, `dump-hall-of-champions.ts`,
   `dump-vi-altar.ts`, `dump-pit-fall.ts`, `dump-reincarnate-entry.ts`), and the UI and
   codec group (`dump-status-boxes.ts`, `dump-mastery-panel.ts`, `dump-save-menu.ts`,
   `dump-intro.ts`, `dump-image-codec.ts`, `dump-key-bindings.ts`).
   These load the real game files, drive the real engine with a fixed RNG seed, print a
   human-readable table and assert invariants, exiting non-zero on failure. They are the de-facto regression
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

- ✅ **Resolved: dropping an object onto an active teleporter did not teleport it.**
  `DropObject` (`doc/CSBwin-src/Mouse.cpp:882`) always calls `MoveObject(objD4, -1, 0,
  x, y, NULL, NULL)`, the same teleporter/pit-resolution loop a walking party or
  monster goes through — `Game.dropObjectFromCursor` skipped straight to
  `DungeonState.addObjectToCell` on the raw drop target instead, so a "place the item
  on the plate" puzzle placed the item and nothing else happened.
  `TimerSystem.resolveDroppedObjectPosition` is the new public wrapper around the
  existing `resolveCellEffects` (already used by `wiggleObject`/the actuator path;
  nothing about the teleporter logic itself was wrong), and `dropObjectFromCursor`
  now lands the object wherever that resolves to.
  Evidence: `tools/dump-teleporter-drop.ts` finds a real active, item-scoped
  teleporter in `dungeon.dat`, drops a floor item onto it, and checks the item ends
  up at the destination rather than the drop cell — it fails on the pre-fix code.

- ✅ **Resolved: a thrown object landing on an active teleporter or a pressure plate
  did nothing.** `ProcessObjectFromMissile`'s no-monster arm
  (`doc/CSBwin-src/Timer.cpp:151-159`) is `MoveObject(objD6.pos(missile.pos()), -2, 0,
  mapX, mapY, NULL, NULL)` — the same call `DropObject` makes, which places the
  landed object through `PlaceOrRemoveObjectInRoom`
  (`doc/CSBwin-src/Code11f52.cpp:3438-3446`), the function that fires a pressure
  plate under whatever just arrived. `TimerSystem.dropMissileObject` did neither: it
  called `DungeonState.addObjectToCell` on the raw landing cell with no teleporter
  resolution and — this is the one that actually bites, since a missile's own
  in-flight movement already resolves any teleporter it flies through
  (`moveMissileToCell` → `resolveCellEffects`) — no actuator trigger at all, so a
  puzzle solved by throwing an item onto a plate you cannot stand on (or cannot walk
  to, with a pit in the way) never fired. Now calls the same
  `resolveDroppedObjectPosition` the cursor-drop fix uses, then
  `ActuatorSystem.triggerObjectMove` at the landing cell.
  Evidence: `tools/dump-missile-drop.ts` throws a floor item at a real teleporter and
  at a real floor actuator in `dungeon.dat`; the actuator-trigger check fails on the
  pre-fix code (the teleporter check does not, in isolation, only because the
  in-flight path already covered it — kept anyway since it is what CSBWin's own
  `MoveObject` call does at that point, and it is the one that matters when a throw's
  range runs out exactly on the landing cell rather than mid-flight).

- ✅ **Resolved: a thrown object that hit a closed door landed on the far corner of
  its cell, half a cell past where it should sit** — reported by the author as
  fully reproducible for every closed door, both orientations: throw at a closed
  door, open it, and the item sits at the back corner rather than the front one; a
  save/load round-trip keeps it there, so it is a database misplacement, not a
  rendering artifact. `MissileTimer` computes two different positions on the tick a
  door blocks the flight (`doc/CSBwin-src/Timer.cpp:370-377`): an advanced `curPos`
  it threads through `ProcessMissileEncounter` as `objectPos` (used for a shattered
  potion's cloud placement and for `MissileEncounterFilter`), and the missile RN's
  own `.pos()` bits, which the `leavingThisCell` write that would normally advance
  them never runs on this path (it is gated on `leavingThisCell`, which is false
  here) — so `ProcessObjectFromMissile` (`Timer.cpp:156-157`, `objD6.pos(missile
  .pos())`) drops a plain weapon or misc item at the corner the missile was already
  resting at, one hop short of `objectPos`. `TimerSystem.processObjectFromMissile`
  had collapsed these into one value, dropping at the threaded-through `objectPos`
  for every caller. It now derives the drop corner from the missile RN's own stored
  position instead of a passed-in `posInCell`, matching CSBWin's split; the same fix
  also corrects a latent twin of the same bug for a missile that runs out of range
  exactly as it flies off the edge of the map (`nextRoomType` 8/exterior), which had
  been using the advanced position too.
  Evidence: `tools/dump-missile-drop.ts` scenario 3 throws a floor item at a real
  closed door in `dungeon.dat`, records the missile's own resting corner the tick
  before the door blocks it, and checks the landed item sits at that exact corner.
  Fails on the pre-fix code (landed corner 0 where the resting corner was 3).

- ✅ **Resolved: the teleporter/energy shimmer never animated, for two independent
  reasons.**
  1. `GraphicRandom` (`doc/CSBwin-src/CSBCode.cpp:564`) is a C function-static, so
     its counter advances once per *process*, not once per draw call.
     `BytecodeInterpreter.graphicRandom` had reseeded to 12345 as an *instance*
     field, and `DrawViewport` builds a fresh `BytecodeInterpreter` every redraw, so
     every frame replayed the identical jitter sequence. Moved to a `static` field on
     the class so it persists across instances, matching the C static's lifetime.
  2. `Game`'s main loop paced itself with `requestAnimationFrame`, which browsers
     **fully suspend** — not merely throttle — the moment a tab is backgrounded or
     occluded, unlike `setTimeout`. CSBWin's own VBL timer (and with it `d.Time`, and
     the `GraphicRandom` counter that rides on every `DrawViewport` it triggers) never
     stops just because the window lost focus. Confirmed live: with the old
     `requestAnimationFrame` scheduling, an out-of-focus tab's tick loop measured
     **zero** further iterations over several seconds — it had died outright, not
     slowed down — while a `setTimeout`-paced version of the same loop kept
     advancing (throttled to roughly 1/sec while backgrounded, full rate once
     focused). That standing-dead loop, occasionally kicked back to life by whatever
     browser-internal event a mouse click or move triggers, is the whole story
     behind "changes only on mouse events." `gameLoop` now reschedules itself with
     `setTimeout` instead.
  CSBWin redraws the viewport once per game tick — `DrawViewport(d.partyFacing,
  d.partyX, d.partyY)` sits directly in the "for each tick of the clock" handler
  (`doc/CSBwin-src/CSBCode.cpp:638`) — and a tick is 15 VBL at normal speed, i.e. 4
  Hz; this port's own `GAME_TIMING.TICKS_PER_SECOND = 4` already matches that, so the
  shimmer should change about **4 times a second**, not ~1 Hz.

  **Both of the above were real, and neither was the actual bug.** The pressure-plate
  fix confirmed ticks were running; the shimmer was still frozen anyway. The real
  defect was arithmetic, not scheduling: `graphicRandom`'s `state * 0xbb40e62d + 11`
  uses JS's plain `*`, and `state` and the multiplier are each up to ~2^32 — their
  exact product needs up to 64 bits, more than a float64 mantissa's 53, so the
  multiply silently rounded away exactly the low bits `>>> 7 % n` reads. Every state
  the LCG could reach turned out to be a multiple of 4096 once rounded, so `% 32`
  (the teleporter's row jitter) and `% 2` (cloud/decoration mirror-flip, the same
  method) both always came out **0** — a redraw every tick, always painting the
  identical pixels, invisible on any single frame and only showing up as a sequence.
  `core/random.ts`'s own `CsbRandom.advance()` already had the fix and the comment
  explaining it (`Math.imul` truncates to 32 bits *before* rounding, matching C's
  `ui32` multiply exactly) — `graphicRandom` just didn't follow it. Fixed the same
  way, and the identical pattern turned up in `SaveGameLoader.ts`'s DSA checksum
  reader (`this.checksum * 0xbb40e62d + 11 + buf[i]`), fixed too; it is currently
  dead code (no dungeon this project loads defines a DSA, per the note below), so it
  had no test to catch it.
  Evidence: `tools/dump-graphic-random.ts` drives the LCG against an exact BigInt
  oracle from five seeds, then checks the specific failure mode directly — 64 draws
  of `% 32` from the class's own starting state must not land on one value. Fails
  on the pre-fix code (all draws land on 0); the `Math.imul` version spreads across
  26 of the 32 possible values.

- ✅ **Added: the "lightning door" energy shimmer was never ported at all** — not a
  bug in existing code, a missing feature. `DrawDoor`'s bit-10 branch of
  `d.DoorTOC[doorType]` (`doc/CSBwin-src/CSBCode.cpp:4156-4166`) redraws with a
  random mirror and a random vertical flip on every frame the door isn't bashed;
  `opStdDrawDoor` had no notion of `DoorTOC` at all and always drew the same
  bitmap. The shipped `dungeon.dat` sets the bit —
  `doorCharacteristics[3] == 0x5ff` — so any level whose `doorType0Index`/
  `doorType1Index` selects entry 3 has doors that should shimmer and silently
  didn't. `ViewportRenderer.drawViewportFrame` now resolves `context.doorTOC` from
  the level's door characteristics next to where it already resolved
  `doorGraphics`, and `opStdDrawDoor` rolls the mirror/flip through a new
  `BytecodeInterpreter.viewportRandom` — a dedicated `CsbRandom` instance, per
  CSBWin's own `d.RandomNumber`-swap around `DrawViewport`
  (`doc/CSBwin-src/Viewport.cpp:6706-6707`), so drawing a door can never perturb the
  sequence monster AI and combat depend on.
  Evidence: `tools/dump-door-lightning.ts` confirms the shipped dungeon actually
  sets the bit, then drives `opStdDrawDoor` directly across 40 redraws of the same
  closed door and checks the drawn bitmap doesn't sit at a single, frozen pattern.
  Fails on the pre-fix code (always 1 distinct pattern); passes with 13 of 40 draws
  distinct.

  **Left open:** whether the cloud- and missile-sprite mirror/flip randomization
  elsewhere in `BytecodeInterpreter` (`this.graphicRandom(2)` for `mirror`/`flip` at
  the cloud-drawing site) is even drawing from the right generator. `GraphicRandom`
  has exactly two call sites in all of CSBWin, both inside `DrawTeleporter` — nothing
  in cloud or missile drawing calls it, so that code's choice of `graphicRandom`
  over a `viewportRandom`-style `STRandomBool()` (or over reading a monster's own
  precomputed mirror bit, set once by game logic rather than re-rolled every frame —
  `NextMonsterUpdateTime`, `doc/CSBwin-src/CSBCode.cpp:5877-5941`, is a real example
  of the latter) was not verified while fixing this. Not touched here — it was
  discovered by contrast while tracing what `GraphicRandom` is and is not used for,
  not by anything reported broken, and changing it needs its own read of the actual
  cloud/missile drawing source first.

- ✅ **Resolved: moving the mouse changed the teleporter/door animation state, at
  mouse-input rate.** With both bugs above fixed, the shimmer visibly *worked* — and
  then turned out to advance on every `mousemove` pixel, far faster than the once a
  tick CSBWin actually redraws at. `ui/events.ts`'s mousemove handler called the
  same `renderView()` movement and ticks use, which always calls
  `ViewportRenderer.render()` → `drawViewportFrame()` → `DrawViewport`, consuming a
  `graphicRandom`/`viewportRandom` draw on every call. CSBWin's cursor is a
  sprite tracked independently of the dungeon redraw — nothing in its mouse handling
  calls `DrawViewport` — so the fix is a narrower `ViewportRenderer.refreshOverlay()`
  that recomposites the screen (cursor, hover highlights, every UI panel) over
  whatever `viewportIndexBuffer` already holds, without calling `drawViewportFrame`
  at all; mousemove now calls that instead of `renderView()`.
  Evidence: live in a real tab, counting calls separately — eight `hover` moves
  produced exactly eight `refreshOverlay` calls and zero additional
  `drawViewportFrame` calls, which kept advancing on its own from the tick loop only.

- ⚠️ **The quick-save's runtime snapshot is still hand-maintained, and the column-index
  bug shows how that fails.** `DungeonSnapshot` enumerates what play can change, and it
  omitted `data.columnIndex` — on the reasoning, written into the file as a comment, that
  it was structural. It is not: `DungeonState.addObjectToCell` / `removeObjectFromCell`
  rewrite it whenever a cell gains or loses its last object, as CSBWin does
  (`doc/CSBwin-src/CSBCode.cpp:5211-5224`). `columnIndex`, `header.objectListSize` and
  `header.objectCounts` are now captured, the save version is 5, and
  `tools/dump-savegame.ts` compares the whole mutable `DungeonData` and asserts that
  loading twice with play in between gives the same world. But the list is still a list:
  any field added to `DungeonData` later has to be remembered here by hand. Deriving it
  from the type, or snapshotting the whole structure and subtracting what is immutable,
  is a Phase 10 / Phase 15 candidate.

  <sub>Context: `doc/PROVEN_FACTS.md` → “The column index is saved state, not dungeon structure”.</sub>


- ✅ **Resolved: the timer table leaked two slots on every save/load cycle.**
  `TimerQueue.restore` minted new indices above the highest restored one, on the
  reasoning — written into the comment — that CSBWin's `m_firstAvailTimer` free list
  "costs nothing but the numbering". It cost more: `LoadGame` is followed by
  `reloadAfterSaveGame`, whose `processMonstersOnLevel` deletes and re-creates the
  movement timers of every monster group on the party's level, so each load abandoned a
  slot per re-created timer — `csbgame7.dat` went 78 → 80 → 82 → … over five quick-loads,
  without bound. The free list is ported now: `addTimer` allocates at the cursor and
  walks it forward, `deleteTimer` lowers it, `shiftNext` frees the fired timer's slot as
  `GetNextTimerEntry` does, and `restore` derives the cursor from the holes rather than
  needing the `gb2.FirstAvailTimer` the file carries. `shiftNext` not freeing was a
  second bug in the same place: a fired timer's index stayed live to `getTimer`.

  <sub>Context: `doc/PROVEN_FACTS.md` → “The timer array has a free list, and a save
  carries its cursor”. Evidence: `tools/dump-save-roundtrip.ts`.</sub>


- ✅ **Resolved: champion titles missing their first character — and it is not a bug.**
  A reincarnated champion whose title was left empty. `_ReIncarnate` clears **one byte**
  of each field to start, `pChar->name[0] = 0; pChar->title[0] = 0;`
  (`doc/CSBwin-src/Code13ea4.cpp:57-58`) — not the array — and each keystroke advances the
  terminator. Type the name back and skip the title, and `title[0]` stays 0 with the old
  title's bytes 1..19 still behind it: `SHE DEVIL` becomes `\0HE DEVIL`. The name never
  shows it because retyping the same name overwrites the same bytes over padding that was
  already zero. So reincarnation was never ruled out; a *test* that types a title
  overwrites the remnant, which is why the saves made to provoke it came back clean.

  CSBWin prints the title as a C string (`TextToViewport(…, pcA3->title, false)`,
  `doc/CSBwin-src/Character.cpp:1338`), so it shows a **blank** title — what the player
  asked for. The reader is not corrected for it; `decodeCharField` now stops at the first
  NUL for the same reason, where it used to skip zero bytes and show `HE DEVIL`.

  A second path to the same byte exists and is a real off-by-one —
  `EditCharacterName`'s insert branch (`doc/CSBwin-src/Chaos.cpp:5323-5324`) shifts from
  `max_len` rather than the string's length, so `name[8] = name[7]` and `name[8]` *is*
  `title[0]` — but that is the editor, not the game.

  <sub>`doc/PROVEN_FACTS.md` → “A champion's title can lose its first character”.</sub>

- ⏳ The dual storage itself is the real defect and is still there: `Champion` keeps
  hands in both `possessions[0..1, 8]` and three named fields, and every writer has to
  remember both. Collapsing it to the array alone is a Phase 15 candidate.

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “A thrown or shot object no longer stays in the hand as well”.</sub>

**Rendering / UI**

- ⏳ **Other empty placeholder tables may be hiding the same way.** This one produced no
  warning and no marker — worth a Phase 15 sweep for arrays and tables that are
  initialised empty and read through a `continue`-on-falsy guard.

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “The eye panel prints the mastery ranks again”.</sub>

- ⏳ **One deliberate non-port** in the same block: CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored far-right sidewalls
  (positions 1 and 6, `:3536`), compensates for `MakeMirror` reversing a byte-aligned
  buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would shift a
  correctly aligned image. Left out on purpose, with the reasoning in the code.

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “A wall decoration one cell ahead and to the left is no longer…”.</sub>

- ⏳ **No golden frame covers an edge decoration**, which is why this survived so long.
  `tools/dump-hall-of-champions.ts` now pins the geometry that makes position 7 special
  (both edge slots narrower than the bitmap; the front-left window ending flush with its
  right edge, the front-right starting flush with its left) across all 8 rect sets, but
  the pixels themselves are still verified only by screenshot. A sixth frame would want a
  way to place the party, which the probe has no affordance for.

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “A wall decoration one cell ahead and to the left is no longer…”.</sub>

- ⚠️ *(Phase 4)* DSA-based decoration gating and footprints/extended cell flags are not
  ported. Wall and floor decoration selection currently follows `TAG00a4a2` + the actuator
  `wallGraphicOrdinal` for stone/open rooms.
- ⏳ *(Phase 7)* **Rune click flash effect** missing in the magic panel.
- ⏳ *(Phase 7)* **Interaction highlights** — button press/selection effects (flash, shading,
  invert) across UI regions, consistent with the hit-test rectangles.
- ⏳ *(Phase 7.5)* Attack-driven light effects; light-level trace hook. (`atk_LIGHT` itself
  works — this is the *viewport* flash on a blow, not the LIGHT attack.)

**Engine**

- ⏳ **Three deferrals from the same block**, all pre-existing gaps rather than new:
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

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “Monsters block the party”.</sub>

- ⚠️ *(Phase 8)* `PerformLocalAction()` does not map `HandChar` precisely; it uses
  partyPosition matching when `mapPos` is specified.
- ⚠️ *(Phase 8)* The DSA interpreter has many unimplemented ampersand subcodes — see the
  TODOs in `src/engine/DsaSystem.ts`.
- ⚠️ *(Phase 8)* Missile launch, monster creation and `WiggleEverything` still need concrete
  engine hooks — see the TODOs in `src/engine/TimerSystem.ts`.
- ⚠️ *(Phase 8)* DSA object manipulation skips cloud/missile timer updates and does not free
  DB records on delete (CSBWin uses a deferred `DeleteDBEntry`).
- ⏳ *(Phase 9 step 12)* Door pass-through rules (DoorTOC + ObjDesc checks for missiles) and
  the magic damage/poison formulas incl. Black Flame fireball healing.
  Ref: `doc/CSBwin-src/Code11f52.cpp:1870+`, `doc/CSBwin-src/Code11f52.cpp:1488+`.
- ⚠️ `HitDoor`'s `delay` argument is not ported — only the zero case is reachable, since
  the delayed form is `Attack.cpp`'s melee (`TT_BASH_DOOR`), which does not exist yet.

  <sub>Context: `doc/PLAN_ARCHIVE.md` → “Clouds are alive”.</sub>

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

- ✅ F8 (random party) is **gone**, and with it F4/F6/F10 — the monster AI trace, the
  missile trace and the five missile scenarios, all Phase 8/12 validation aids whose
  phases have landed. The deletion reached the engine: `TimerHooks.onMissileTrace`,
  `MissileTraceEvent` and the nine `emitMissileTrace` sites in `TimerSystem` had no other
  consumer, nor did `Game.debugLaunchMissileDelayed` /
  `TimerSystem.launchDelayedMissile`, nor `main.ts`'s `getAddCharacterTables` (`Game`
  builds its own). `MonsterSystemHooks.trace` **stays** — `tools/dump-monster-ai.ts`
  registers it. `src/dev.ts` is down to the F5/F9 quick-save from ~640 lines.
- ✅ F5/F9 (quick-save/load) **stay**, and are no longer gated on `isDebugFeaturesEnabled()`
  — they are not scaffolding to be removed but the functional equivalent of the original
  save menu, kept for their convenience whether or not that menu is ever ported
  (Phase 10). The boot-time restore in `main.ts` is still Debug-gated; that one *is* a
  dev convenience.
- ⚠️ `tools/probe-frames.mjs` used F8 to get a party, so all five non-boot golden frames
  were rebuilt. It now drives the real Hall of Champions through the public game API —
  stand at a mirror, `handleWallClick`, `resurrectReincarnateCancel(160)`, four times —
  which needs no scaffolding in the app at all. HALK is added first so champion 0 holds a
  weapon and frame 05 still exercises the weapon attack list rather than PUNCH/KICK/WAR
  CRY.

**Champion lifecycle (Phase 13)**

- ⏳ **`DamageCharacter` is missing two of CSBWin's three early guards**
  (`doc/CSBwin-src/Character.cpp:2712-2714`): `chIdx+1 == d.PotentialCharacterOrdinal`,
  which makes a champion still standing in a Hall of Champions mirror unhurtable, and
  `d.Word11694`, a global damage suppressor. Both return early with a non-zero value, so
  a caller reading the result sees "damage was dealt" — the mirror guard matters now
  that missiles reach the party through this function.
- ⏳ **`DetermineMagicDamage` is used by the party arm only.** The monster arm of
  `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:2007-2015`) should divide
  `64 * DetermineMagicDamage(...)` by the monster's `defense08` and add
  `DeterminePoisonDamage`; `Game.applyMissileDamageToMonster` still passes the missile's
  raw `damageRemaining` to `DamageMonster` and picks the first living group member
  rather than `OrdinalOfMonsterAtPosition`. The function it needs now exists.

- ⏳ **The wings.** CSBWin keeps champions who have left the party in a store
  `CHARDESC::GetFromWings`/`SaveToWings` reach (`doc/CSBwin-src/Character.cpp:5239`).
  Two things consult it and cannot here: `CopyCharacter`, so bones dropped by a
  departed champion take no name (step 2), and `ProcessTT_ViAltar` state 1, which heals
  such a champion to `MaxHP/2` and saves them back (`Timer.cpp:2769-2782`, step 3).
  `Party.findChampionByFingerprint` is the single place both would grow the second
  half. This is a feature to build, not a branch to port — nothing in the port ever
  removes a champion from the party alive.
- ⏳ **Three DSA filters**, none defined by any dungeon we load, so none could be
  verified if written: `ESL_CHARDEATHFILTER` (actuator type 47,
  `Character.cpp:2535-2589`, step 1), `ESL_FEEDINGFILTER` (`:4288-4344`, step 5, with
  the insertion point already marked in `handleMouthPress`) and
  `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`, step 4,
  which only fires on a `DisableMessage` the shipped dungeon never carries).
- ⏳ **CSB extensions and malformed-hero handling** (step 4): `pcA3->talents`, which
  `Champion` has no field for; the `legalHero` fallback (`Character.cpp:475`) that
  clamps an out-of-range hero text and retries it against "BOGUS / ILLEGAL HERO", where
  `HeroExtractor` rejects it outright; and external portraits for `charID > 23`. No
  shipped DM hero touches any of them.
- ⏳ **`MagicPanel.ts:204-206` still conflates `partyPosition` with the champion
  index** — it writes `magicCasterIndex = champion.partyPosition` and picks the rune
  rectangle the same way, though the four boxes do not rotate. The same bug was fixed in
  `Party.getPartyChampion` (Phase 13 prerequisite 2); this half was left because it is a
  UI change wanting the golden frames re-examined, not because it is right.
**Intro (Phase 16)**

- ⏳ **The intro runs on wall-clock time** through `requestAnimationFrame`, not on a VBL
  counter shared with the game loop. Nothing else exists yet when it plays, so there is
  nothing to drift against; if a boot-time animation ever has to agree with `d.Time`, this
  is the place that would have to change.
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole sequence.** A
  developer affordance with no CSBWin counterpart, kept deliberately: five of the eight
  golden frames boot through it.

**Monsters (Phase 12)**

- ⚠️ *(step 2)* `CreateMovementTimer`'s overflow guard is not ported.
- ⚠️ *(step 4)* `CreateAndDropObject` appends new weapon / armour records rather than
  reusing CSBWin's free-list — a deliberate divergence.
- ⚠️ *(step 7)* The champion-attack deferrals, all deliberate, are listed under the step.

  <sub>Context for all three: `doc/PLAN_ARCHIVE.md` → "Phase 12 — Monsters".</sub>

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
| 12 | Monsters: AI, movement, combat |
| 13 | Champion lifecycle |
| 14 | Structural cleanup |
| 16 | Title screen and dungeon entrance |

## Next Steps (Phased)

Only the phases with work left in them. Completed phases are in `doc/PLAN_ARCHIVE.md`.

### Phase 10 — CSBWin-Compatible Save/Load

Goal: read and write a save file CSBWin itself can load. **Reading is done. Writing is the
only phase in this file with substantial engine work left in it.**

#### What is left, in one place

`saveSaveGameState` (`src/data/SaveGameLoader.ts`) emits all sixteen blocks, and
`buildSavePayload` now hands it the three it used to leave out — the Extended Features
header, the object indirect index and the dungeon image — so **the game's own save button
writes a whole file**. Against the sixteen-block write order in
`doc/CSBWIN_SAVEGAME_REFERENCE.md`:

| Block | What it holds | State |
| --- | --- | --- |
| 0 | Extended Features, `dataTypeMap`/`dataIndexMap`, DSA blocks | ✅ written and byte-identical to all fourteen saves — header, both maps, the game info and the DSA level index with its 0xff terminator. `buildObjectIndirectIndex` builds the maps for a world this port holds, which is what blocks 10-13 will encode their RNs through |
| 1 | GAMEBLOCK1 | ✅ |
| 2 | GAMEBLOCK2 (128 b) | ✅ all 21 fields, byte-identical to all fourteen saves. Three go out as zero because nothing models them: `partyMoveDisableTimer` (40), `Word11712` (42), `Word11714` (44). `ObjectInHand` (8) is an indirect slot now, encoded through the same index as the image |
| 3 | ITEM16 | ✅ |
| 4 | characters + party tail | ✅ byte-identical to all fourteen committed saves, the thirty possession slots included — they go out through `encodeRN` as slot numbers |
| 5 | timers | ✅ the whole 16-byte `TIMER`, in all three sizes, byte-identical bar `unused13` in a freed slot |
| 6 | timer queue | ✅ byte-identical over the live `NumTimer` entries; the debris past them is not reproduced |
| 7 | image header (`DUNGEONDATINDEX`, 44 b) | ✅ built and byte-identical to `dungeon.dat` **and** all fourteen saves |
| 8 | level descriptors (16 b x `NumLevel`) | ✅ same |
| 9 | column index (`objectListIndex`) | ✅ same |
| 10 | object list (`d.objectList`) | ✅ built. Nothing but RNs, so it **cannot** be byte-identical — our slot numbering is our own — and it is checked by resolving instead; see below |
| 11 | indirect text index | ✅ built and byte-identical. Little-endian longwords, alone with the Extended Features header in a big-endian file |
| 12 | `sizeOfCompressedText` + the text | ✅ built and byte-identical. Little-endian size word, big-endian text |
| 13 | the sixteen databases | ✅ built. Every byte that is **not** an RN is the file's own, on `dungeon.dat` and all fourteen saves; the RNs are resolved and compared. This is 18-22 KB of the ~40 KB image |
| 14 | cell flags (`cellFlagArray`) | ✅ built and byte-identical, and `cellFlagArraySize` computes the 12366 both `dungeon.dat` and every save declare |
| 15 | final checksum word | ✅ `buildImageChecksum`, and proved against each save's **own** closing word |

**A whole file now round-trips.** `tools/dump-save-file-roundtrip.ts` takes each of the
fourteen committed saves, parses it completely, re-serialises **all sixteen blocks**
through `saveSaveGameState` — dungeon image and closing checksum included — and hands the
result back to this port's own reader. 605 checks: the header, the object list, the column
index, every cell flag of all fourteen levels, every record of every database field for
field, the indirect text, the compressed text, EXPOOL byte for byte, the party, all 120
possession slots, `ObjectInHand` and the flying-sword timer. It is what covers the words
the block-by-block comparisons have to hold out.

Three things had to change for it, all of them real:

- `buildObjectIndirectIndex` takes `heldReferences`. An object a champion carries is in no
  cell chain, so without a pass over the possession slots (and the object-carrying timers,
  and `ObjectInHand`) its slot keeps position 0 and the reference comes back naming the
  right record in the wrong corner of its cell. CSBWin does exactly these four passes, in
  this order (`doc/PROVEN_FACTS.md` → "Everything CSBWin converts to slot numbers").
- `buildCsbwinCharacterBlock` takes `encodeRN`, so the thirty slots go out as slot
  numbers. That closes the reservation block 4 has carried since it was written.
- The **object-carrying timers** have to be translated by hand. `parseTimers` leaves a
  timer's object RN as the raw word — nothing in this port consumes one — which is
  harmless while a file is only read and wrong the moment it is rewritten with a new
  numbering. `csbgame-flying-sword.dat` exercises it.

The work is serialization, not modelling: `src/engine/DungeonSnapshot.ts` already captures
everything blocks 7-14 carry, the image layout is solved and proven by parsing (see the
resolved blocker at the end of this phase), and `FirstAvailTimer` — block 2 offset 26 —
became available when `TimerQueue` gained CSBWin's free cursor.

**Two sections cannot be byte-identical, and that is not a defect.** Every word of block
10 and the link word of every record in block 13 is an RN, which in a save is a slot
number in the object indirect index — and `buildObjectIndirectIndex` numbers those slots
its own way, because CSBWin's order cannot be reproduced and nothing outside the file
refers to a slot number. Those words are checked by resolving instead: the maps are
written, read back through `readObjectIndirectIndex` (both `FormChecksum`s verified), and
each word resolved through them must name the object the reader got out of CSBWin's word.
That argument is weaker in kind than the byte comparisons around it — it would survive a
bug our encode and our resolve shared — and `tools/dump-dungeon-image-blocks.ts` says so
where it makes it. `dungeon.dat`, which stores packed RNs and needs no index at all, is
the compensating case: for it those same words *are* byte-compared, all 1682 of them.
<sub>`doc/PROVEN_FACTS.md` → "An RN in block 10 or block 13 cannot be byte-identical".</sub>

**Mostly, but not entirely.** Writing blocks 7, 8 and 14 found three fields the *reader*
was dropping, and a section cannot be written back from a model that does not hold it:
`LEVELDESC.FILL2[4]`, the low byte of `DUNGEONDATINDEX::word4` — both zero everywhere, but
neither guessable — and bits 8-11 of `LEVELDESC.word12`, which CSBWin declares no accessor
for and which are **not** zero: the fourteen DM levels carry 0, 1, 3 and 4 between them.
All three are now on `DungeonHeader` / `MapDescriptor`, named as CSBWin names them and
documented as unread.

Block 13 had the same disease and more of it. Ten further bit ranges across seven record
types were being read past — the door's `word2` bits 9-15, the teleporter's low `word4`
byte, the text record's `word2` bits 1-2, the creature's `word14` bits 4, 7 and 15, the
clothing item's `word2` bits 14-15, both scroll forms' leftover bits, the chest's whole
`m_word4` and its two trailing bytes, and the misc item's `cursed` and `subType` — plus
the whole of **`EXPOOL`**, database 11, which had no parser at all and is now carried as
raw bytes on `DungeonData.expool`. Four of the ten are not zero in the data, so four of
them fail a canary; the rest are carried for the reason `FILL2` is.
<sub>`doc/PROVEN_FACTS.md` → "Ten more fields the record parsers were dropping".</sub>

**The evidence gap is closed for everything the writer builds.**
`tools/dump-dungeon-image-blocks.ts` does it for the whole image — 687 checks over
`dungeon.dat` and all fourteen saves — and `tools/dump-save-blocks-vs-file.ts` parses each
of the fourteen committed saves, writes
blocks 2-6 again from what came out, and compares them with the file's own bytes — the
argument `tools/dump-character-block.ts` makes for block 4, widened to every block. All
five are identical in all fourteen. Writing it found two defects in blocks that were
marked complete: block 5 wrote zeros into `TIMER.unused13` where a real file holds 0xcd,
and nothing had ever looked at block 6's tail. Two regions are reported rather than
asserted, each for a sourced reason — `unused13` in a freed slot and the timer queue past
`NumTimer`, both CSBWin allocation debris (`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is
0xcd in a slot that has been used"). **Block 1 is the exception**: it carries
`RandomGameID`, `Byte22808[132]`, `SaveOption`, `totalMoveCount` and
`Word22592`/`Word22594`, none of which this port models, so it is reported and not
asserted. Any new block should arrive with the same comparison, and step 10's
load → re-serialize → binary-compare is the end state.

**Deferred on purpose, and none of it blocking:** the DSA global variables are not read from
`EXPOOL`; `d.Word11694` (`gameWon`) and `d.PartySleeping` are not restored; a record index
above 1023 cannot be expressed. All three are detailed under step 12.

**Deferred by the block-2 work (September 13th):**

- ⏳ **`partyMoveDisableTimer`, `Word11712` and `Word11714`** (`GAMEBLOCK2` offsets 40,
  42, 44) are written as zero. This port models no equivalent of any of them, and the
  loader restores none of them either, so the three are symmetrical gaps rather than a
  writer defect.
- ✅ **Resolved: `ObjectInHand`** (offset 8) goes out as an indirect slot number, through
  the index `buildSavePayload` builds for the image — the same one block 4's thirty
  possession slots use, which was always the same dependency rather than two.
- ⏳ **DSA programs are not re-serialized.** A save that carries DSAs is written back
  with the byte range it was read with (`SaveGameState.dsaBlock`), so a DSA whose state
  machine has moved since the load would be written where it stood. `DSA::Write`
  (`doc/CSBwin-src/Chaos.cpp`) is unported. No dungeon this project loads defines a DSA
  — `numDSA` is 0 in every committed save — so nothing exercises it.
- ⏳ **`SimpleEncryption` is neither written nor readable past the header.** The flag
  (`EF_FLAGS.SimpleEncryption`, 0x04) puts the *whole* file behind RC4 with key `{1,0}`,
  not just the 512-byte block the reader deciphers. No committed save sets it.
- ✅ **The live path writes a whole file** (September 14th). `buildSavePayload` builds the
  object indirect index, the dungeon image, the Extended Features header and the character
  block together — they are one numbering — and `saveSaveGameState` closes the file with
  block 15. `GAMEBLOCK2.ObjectInHand` and the thirty possession slots go out as slot
  numbers, which retires the two reservations blocks 2 and 4 carried. The header is
  `buildLiveExtendedFeatures` (`src/data/CsbwinExtendedFeatures.ts`), field for field
  against `SaveGame` and with every zero measured rather than assumed
  (`doc/PROVEN_FACTS.md` → "The Extended Features header a live game writes").
  `sequencedTimers`/`extendedTimers` are true, so block 5 is the 16-byte `TIMER` the
  header declares.

  Evidence: `tools/dump-live-save-file.ts` (187 checks). A game played out of
  `dungeon.dat` — champions recruited at two mirrors, the party walked, an object thrown
  and still in flight, a second on the cursor — and a game played on from
  `csbgame7.dat`, each written and loaded back into a fresh engine. Six of its seven
  canaries fail when the field they blank is withheld; the seventh is named in the tool
  with the reason it cannot.

- ✅ **An original dungeon is converted on load, as CSBWin does** (September 14th).
  `src/data/CsbwinDungeonConversions.ts` ports `ConvertToIndirectText`,
  `MakeBigActuators` and `convertScrolls`, each behind CSBWin's own gate — the shape
  flags, which are false only for a `dungeon.dat`. So the in-memory world is always
  save-shaped and the writer never has to ask where it came from.
  `TextRecord.textIndex` is gone: `textOffset` is `DB2::index()` and means a word offset
  before the conversion and an index entry after, exactly as CSBWin's one field does.
  That closed a live bug — a genuine save arrives already converted, so `textIndex` was
  never set for one and every wall text, scroll and message was decoded from the wrong
  place in the compressed array.

  Evidence: `tools/dump-dungeon-conversions.ts` (143 checks). Every committed save was
  made by CSBWin from this same `dungeon.dat`, so its converted form is the oracle: 0
  differences in the 125-entry index, all 1749 words of compressed text, every TEXT
  record's rewritten index word, every scroll's new RN and `open` bit, and every
  actuator's `word8`. `DungeonImageOptions.noConvert` exists for exactly one caller,
  `tools/dump-dungeon-image-blocks.ts`, which has to hold `dungeon.dat`'s own shape up
  against the file.

- ✅ **A quick-save carries the converted image** (September 14th).
  `src/engine/DungeonSnapshot.ts` captures `textWords`, `indirectTextIndex`,
  `compressedText` and `expool`; `RUNTIME_SAVE_VERSION` is 7 and an older payload is
  refused rather than half-restored. `expool` is the one of the four that can be
  canaried — `dungeon.dat` has none and every save carries blocks of it — and the three
  text fields cannot, because this port's conversion of `dungeon.dat` reproduces the
  saves' arrays exactly; `tools/dump-save-roundtrip.ts` says so where it makes the claim.

- ✅ **A timer's object survives the file** (September 14th), which writing the live path
  is what exposed. The live `TimerEntry` keeps a missile's RN on an `object` field with
  no byte at all and puts the launch square in bytes 6-7 — where `ConvertTimers` says
  the object lives — so a saved missile lost its object and its packed position word
  both. `Game.collapseTimerBytes` and `restoreTimerQueue` are the two halves of the
  collapse now, and `CsbwinSaveGame.resolveTimerObjects` turns a loaded timer's slot
  number back into an RN, which `parseTimers` deliberately does not.
  <sub>`doc/PROVEN_FACTS.md` → "A live timer keeps its object in three places".</sub>

**Deferred by the live-path work (September 14th):**

- ⏳ **A converted scroll's `m_word4` bits 1-15 go out as zero.** `convertScrolls` writes
  bit 0 over two bytes nothing initialises, so a genuine save carries allocation debris
  there — 28 of DM's 35 scrolls in `csbgame4.dat`. Zero is the only honest value for a
  scroll this port converts; reported rather than asserted, like `TIMER.unused13`.
- ⏳ **`buildSavePayload` refuses a dungeon with DSA programs** rather than writing a file
  that silently lost them, because `DSA::Write` is unported. No dungeon this project
  loads defines one.
- ⏳ **`MakeBigActuators` reads the actuator type after the byte swap, CSBWin before it.**
  A knowing divergence with no effect on DM, and asserted rather than assumed:
  `tools/dump-dungeon-conversions.ts` fails if any actuator is type 47 under *either*
  reading. <sub>`doc/PROVEN_FACTS.md` → "`MakeBigActuators` runs before the byte swap".</sub>
- ⏳ **Scenario 2 of `dump-live-save-file.ts` holds the monster state to a fixed point**
  rather than to the played game, because a load is not a no-op — `reloadAfterSaveGame`
  re-creates every monster group's movement timers and re-rolls their walk offsets, as
  CSBWin's does. Everything the reload does not touch is still compared one round trip
  earlier.

- ⏳ **Block 1 is still a stub with valid checksums.** `RandomGameID`, `Byte22808[132]`,
  `SaveOption`, `totalMoveCount`, `Word22592`/`Word22594` and `Byte22596`/`Byte22598` are
  all zero. `LoadGame` reads `RandomGameID` only to refuse a save from a different game
  after the party has died (`doc/CSBwin-src/SaveGame.cpp:1602-1606`) and lets
  `Byte22596 != 1` through, so this is untested rather than known-broken.

#### The original pre-work checklist

Kept because the rescoring below is written against its numbering.

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

11. **Load/save menu behind the disk icon** (author request, September 2026) — ✅ done,
   September 13th. The disk icon opens a menu drawn in the 320×200 buffer, listing saves
   from browser storage or from a directory on disk, each row showing its date, level and
   party, newest first; LOAD acts on the selection, SAVE always creates a new file rather
   than overwriting one of four slots.

   - `doc/CSBWIN_MENU_REFERENCE.md` is the new sourced account: the icon
     (`buttons17760[1]`, id 140), graphic 0 and its four layout patches, the text
     metrics, `_WaitForMenuSelect`'s modality and press animation, the four save slots,
     and a numbered list of the five places this port deliberately diverges.
   - `src/renderer/ui/Menu.ts` is a faithful `_DoMenu` / `_WaitForMenuSelect`, usable on
     its own for the title-only and one-button menus and for the future title screen
     (`I1 != 0`, button set 1, centred at screen (47,33)).
   - `src/renderer/ui/SaveMenu.ts` is the extension on top. The list panel is made by
     tiling graphic 0's own interior band down over the full-width button frame — the
     same self-blit idiom the 1/2/4-option layouts use — which leaves the bottom pair of
     frames for LOAD and SAVE, hit-tested and animated through CSBWin's own rectangles.
   - `src/data/saves/` holds the two backends behind one interface, and
     `src/engine/SaveGamePayload.ts` the payload both they and the quick-save now share.
     `dev.ts` no longer has a save implementation of its own.
   - **F5 and F9 act on the same saves** (September 13th, second pass). They used to own a
     single `localStorage` key, so "the most recent save" meant one thing to the menu and
     another to F9. F5 now writes one more save to the current source — falling back to
     the browser when the file source is chosen but not connected, since a quick-save key
     must never raise a folder picker over the game — and F9 loads the newest *loadable*
     save across every store that can be listed without prompting, skipping a genuine
     `.dat` rather than picking it and then refusing it. `src/data/saves/registry.ts`
     holds the two singletons and the current source; `pickLatestLoadable` is pure and
     asserted. Anything left under the old key is migrated into the browser store once.
   - Evidence: `tools/dump-save-menu.ts` (120 checks — the table offsets as a canary, the
     panel built for real and measured pixel by pixel, `SplitLongLine`, the row
     formatting, and both metadata paths against the genuine saves) plus a sixth golden
     frame, `tools/frames/06-savemenu.png`.

   **What the file half can and cannot do**, measured rather than assumed: listing a real
   directory needs `showDirectoryPicker`, which is Chromium-only and hands back a handle
   for a directory *the player picks in the OS dialog*. There is no path access, so
   `~/dm-saves` cannot be opened by name and cannot be created — `getDirectoryHandle(…,
   {create:true})` only makes directories inside an already-granted handle. The handle is
   structured-cloneable and is remembered in IndexedDB so the pick happens once; the
   *permission* is not remembered, and Chrome re-asks with one click per page load. Both
   calls need transient user activation, which is why a click while the menu is up is
   handled straight from the DOM event instead of through the game's mouse queue.

   **Deferred, deliberately:**
   - ✅ **Genuine CSBWin `.dat` files load** (step 12, September 13th). They were listed
     with a `*` and an inert LOAD while their object references were undecodable; the
     star and the note are gone.
   - **No `<input type=file>` / blob-download fallback** for Firefox and Safari. The menu
     says `NEEDS A CHROMIUM BROWSER` on the file source and stays usable on the browser
     source; a fallback that cannot list a directory would not fit this menu's shape.
   - **No delete.** `BrowserSaveStore.remove` exists and nothing calls it, so the browser
     store grows without bound. The list scrolls, so this is untidy rather than broken.
   - **The sixth frame captures an empty list**, since the boot script clears IndexedDB to
     keep the frame byte-stable. The row rendering is proven by `dump-save-menu.ts`
     instead, not by pixels.
   - **`SAVE AND QUIT`** has no equivalent: there is no credits screen to quit to.

12. **A genuine CSBWin save loads.** ✅ done, September 13th.
   `src/data/CsbwinDungeonImage.ts` (`loadCsbwinWorld`) parses the dungeon image into a
   real `DungeonData`, `src/data/CsbwinCharacters.ts` unpacks `CHARDESC[4]` and the
   128-byte party tail, and `src/data/CsbwinSaveGame.ts` (`applyCsbwinSave`) turns the
   two into the `RuntimeSaveState` the engine already restores from. The disk menu's
   `.dat` rows are no longer starred; `applySaveBytes` sniffs our JSON against a binary
   and dispatches, so LOAD and F9 both act on them.

   **What unblocked it: an RN in a save file is an indirect index, not a packed RN.**
   `class RN` holds one `ui16` and resolves it through two global arrays, `dataTypeMap`
   and `dataIndexMap` (`doc/CSBwin-src/CSBTypes.h:268-370`); `ConvertListOfObjects`
   rewrites every reference in an original dungeon into a slot number the first time it
   is read (`doc/CSBwin-src/SaveGame.cpp:1916-2018`), and the two maps travel in the
   save's Extended Features block. So the possession slots that "came out as category
   0/1 with indices far past those databases" were never packed RNs — and neither was
   anything else in the image. `src/data/CsbwinObjectIndex.ts` reads the maps, verifies
   both `FormChecksum`s, and translates.
   <sub>`doc/PROVEN_FACTS.md` → "An RN in a save file is an indirect index".</sub>

   Evidence, in three layers:
   - `tools/dump-csbwin-world.ts` walks **every object chain** in all twelve committed
     saves — 1783 to 1908 objects each, up to 31 deep, through chests and monster
     possessions — and finds no free record, no index past a database, no category
     without one and no cycle. An early save holds `dungeon.dat`'s 1911 objects less
     exactly what the chosen heroes carried out of their mirrors.
   - `tools/dump-csbwin-party.ts` asserts that all thirty possession slots of every
     champion name a **live** record in one of the six carryable databases. This is the
     check that used to be printed and not asserted.
   - `tools/dump-csbwin-load.ts` is new and is the one that matters: it stands a real
     `Game` up on `dungeon.dat`, restores each save into it, and then asks the *live
     engine* where the party is, who it is, what its own cell holds, and whether every
     cell flag in all fourteen maps is the save's. 746 checks. Confirmed on screen too
     — `csbgame7.dat` loads in the running app with its four champions, their hands and
     its own corridor.

   ✅ **The timer queue is restored** (September 13th, second pass, on two save files
   made to order). The whole 16-byte `TIMER` is read and written, in all three of the
   sizes the Extended Features flags select, and the queue that orders it comes back
   verbatim rather than being re-inserted — CSBWin never re-sorts on load, and
   re-inserting would run the duplicate-timer rules over timers that legitimately
   coexist. **The quick-save gained this too**: it wrote the same single `timerWord8`
   field, so a door caught mid-close was lost across F5/F9 as well. Save format v6.
   Evidence: `tools/dump-csbwin-timers.ts` restores `csbgame4-door-opening.dat` and
   `csbgame4-door-closing.dat` — identical fresh games whose door timers differ in one
   byte — into a real `Game`, turns the clock, and watches one door open and the other
   shut. <sub>`doc/PROVEN_FACTS.md` → "The `TIMER` record".</sub>

   ✅ **The portraits load too** (September 13th, third pass). `CHARDESC` carries the
   picture rather than an index — 464 bytes of four-bitplane 32x29 at offset 336
   (`doc/PROVEN_FACTS.md` → "`CHARDESC` carries the champion's portrait as pixels") —
   so a loaded party had nothing for the status box to draw and showed four empty
   boxes, while a quick-saved party, whose champions still carried this port's
   `portraitGraphic`, drew correctly. `readPortrait` unpacks the bitplanes into
   `Champion.portrait` and `getChampionPortrait` prefers them, keeping the index as the
   fallback for champions the engine creates (it holds no graphics to blit from).
   Evidence: `tools/dump-csbwin-load.ts` decodes all four champions of every committed
   save and each is a cell of basic graphic 26 pixel for pixel — a canary that fails on
   a wrong offset, plane order or byte swap — and `tools/dump-portraits.ts` draws the
   real status bar into a real screen buffer and reads the portrait rectangle back, on
   both paths.

   ⏳ **Still deferred, and none of it new debt:**
   - **The DSA global variables are not read from `EXPOOL`.** CSBWin takes them from
     `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i`, sixteen `ui32` a record
     (`doc/CSBwin-src/SaveGame.cpp:1746-1763`); `locateExpoolRecord` finds a record but
     returns only its first word. No committed save needs it — the shipped DM dungeon
     defines no DSAs at all (`numDSA` is 0 in all twelve, and no special-location
     records) — so the running game's globals are kept rather than cleared.
   - **`d.Word11694` (`gameWon`) and `d.PartySleeping`** are not restored; neither is in
     `GAMEBLOCK2` where this reader looks.
   - **A record index above 1023 cannot be expressed.** `dataIndexMap` is 16 bits and
     this port's RN index field is 10. CSBWin allows 64000. The largest index in any
     committed save is 682; `CsbwinObjectIndex.resolve` throws rather than alias, so a
     third-party dungeon that needed it would say so.

Status: 🔄 **the reader is finished; the writer is what is left.** Rescored against the
code in September 2026, and again on the 13th when step 12 landed:

- Step 1 (inventory the blocks) — ✅ done. The full write order, every block's size and
  the EXPOOL side-writes are tabulated in `doc/CSBWIN_SAVEGAME_REFERENCE.md`.
- Steps 2-5 (runtime state, DB record layouts, object list, cell flags) — ✅ effectively
  done, though not yet *serialized*. `src/engine/DungeonSnapshot.ts` captures exactly
  what blocks 7-14 carry, and the column-index fix closed the last gap in step 4. What
  remains for these is packing, not modelling.
- Step 6 (character block) — ✅ **done, September 13th.** `CsbwinCharacters.ts` packs a
  whole `CHARDESC` as well as unpacking one — stats, skills, wounds, the thirty
  possessions, the portrait bitplanes — plus the 128-byte party tail, and
  `saveSaveGameState` writes the result into block 4 instead of 3328 zeros.
  `tools/dump-character-block.ts` packs the block again for each of the fourteen
  committed saves and compares it with the file's own bytes: **all fourteen are
  byte-identical**, which is the same argument `dump-csbwin-save.ts` makes for the
  reader — the bytes were written by CSBWin, so no bug symmetrical between our reader
  and our writer can satisfy it.

  Getting there needed six fields with no reader in this port, all now carried on
  `Champion` (`doc/PROVEN_FACTS.md` → "Packing `CHARDESC` back"): `charFlags` — which is
  where a champion's **gender** lives, and was being dropped entirely on load —
  `timerIndex`, `talents`, `causeOfDamage`, `monsterCausingDamage` and `load`.
  `AddCharacter` now sets `charFlags` from the hero's gender letter, as CSBWin does.

  It also found a live reader bug: `CHARDESC.incantation` is a C string, and this port
  read it as "the non-zero bytes", so the runes a cast leaves behind it came back as a
  spell in progress (`doc/PROVEN_FACTS.md` → "`CHARDESC.incantation` is a C string").

  **Still owed here:** the thirty possession slots are written as this port's packed
  object ids. A file wants indirect slot numbers, and the maps that define them travel
  with the dungeon image, which steps 3-5 have yet to write — so this is a dependency,
  not a defect, and the byte-identical proof above is made on champions read *without*
  an object index.

  <sub>A free result along the way: `CHARDESC.load` as CSBWin stored it matches what
  `CharacterStats.characterLoad` re-sums, for all 42 champions of the committed saves —
  asserted in `tools/dump-csbwin-load.ts`, and the only outside check the weight tables
  have.</sub>
- Step 9 (checksum/scramble parity) — ✅ proven for blocks 0-6 in both directions, and
  now against files this project did not write.
- Step 10 (round-trip validation) — ⚠️ half. `tools/dump-csbwin-save.ts` reads genuine
  saves; the load → re-serialize → binary-compare half waits on the writer.
- ✅ **Resolved: the dungeon image layout is solved.** (Kept here because the route to it
  is the lesson.) The blocker was never the text section alone — two database record
  sizes differ from `dungeon.dat` (ACTUATOR is 10 bytes with `bigActuators`, SCROLL is 6
  from extended-features version `'B'`), and the indirect-text block is little-endian
  with a header field, `NumWordsInTextArray`, that `ConvertToIndirectText` repurposes to
  mean "index entries". `tools/dump-csbwin-save.ts` now proves the whole layout by
  summing every section and landing on `EOF - 2`, for twelve genuine saves. Every
  database, the object list, the column index and the cell flags are read now (step 12);
  when this was written only MISSILE was.
  What found it: save files made to order — a fresh game diffed against `dungeon.dat`
  gave hard anchors for the cell flags and the door database, and the gap between them
  was the answer. <sub>`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file".</sub>

- 🚫 **Superseded blocker (kept for the record): the text section of the dungeon image
  did not parse.** The indirect text index is little-endian unlike the rest of the image
  and none of the candidate lengths closed, so everything after it — all sixteen
  databases and the cell flags — was unreachable, and
  `parseMissileRecordsFromSaveData` / `parseSpecialLocationsFromSaveData` returned
  `null` on every genuine save. Solved by the entry above; kept because the shape of the
  mistake (assuming one section was wrong when three were) is the lesson.

Note this is a large piece of work and is *not* a prerequisite for playability;
quick-save/load via a runtime JSON snapshot already works.

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

**The payload layer now has evidence of its own** (`tools/dump-save-roundtrip.ts`). Until
it was written nothing exercised `buildSavePayload` / `applySavePayload` — the JSON file
F5, F9 and both stores of the disk menu actually write — because `dump-savegame.ts` drives
the runtime snapshot directly and the `dump-csbwin-*` tools drive the CSBWin reader. The
tool starts from a genuine CSBWin save, which is the hard case: such a party carries 928
bytes of `CHARDESC.portrait` pixels where a party this engine created carries a single
`portraitGraphic` index. 106 checks — portraits, possessions, `charFlags`, incantations,
the world snapshot, ITEM16, missiles and the whole timer table round-trip; both
`csbgame4-door-*.dat` doors still open and shut after being restored *through the payload*;
and five save/load cycles on a level with live monsters leave the timer table the same size
with no holes, which is the leak above.

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   asserting tools, then the frames with `--frames`. ~14s, ~33s with frames.
   `tools/` is inside the type gate. Shared helpers in `tools/lib/check.ts`.
   <sub>How it went, and the two real bugs it surfaced: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` starts its own dev server
   and headless Chrome and takes `--update`. Eight frames since Phase 16: the first six load
   the app with `?intro=0`, and `07-entrance` / `08-credits` load it again without, which is
   the only standing evidence that the corridor behind the prison doors actually renders.
   Still owed to make it a real test: a fixed set of *party positions* rather than whatever
   the boot dungeon gives, and rendering straight from the index buffer instead of a browser
   screenshot.
   <sub>Baseline re-capture story: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>

3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. 🔄 **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately. Part-paid by Phase 16: `tools/dump-image-codec.ts`
   decodes every image in both data sets and asserts each one fills its own buffer exactly,
   which is what caught the codec bug's blast radius, and checks each opcode on a hand-built
   stream. The *table* extraction (`0x22e`..`0x232`) still has no round-trip check beyond the
   canaries individual tools assert.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: 🔄 in progress — steps 1 and 2 done, 4 part-done; 3 and 5 remain.
