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
8. ⚠️ **CSBWin-binary-compatible save files** — the *reader* now handles genuine files
   (three real saves in `static/gamefiles/saves/`, read by `tools/dump-csbwin-save.ts`
   with every block checksum clean); the *writer* still stops after block 6. Phase 10
   below is rescored.
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
2. **Twenty-five assertion-carrying verification tools** — the Phase 12 nine
   (`dump-monster-{tables,activation,perception,damage,move,ai}.ts`,
   `watch-monster{s,-attacks}.ts`, `dump-player-attacks.ts`) plus
   `dump-hand-owner.ts`, `dump-throwing.ts`, `dump-clouds.ts`, `dump-savegame.ts`,
   `dump-savegame-blocks.ts`,
   `dump-party-collision.ts`, `dump-door-crush.ts`, `dump-attributes.ts` and
   `dump-champion-state.ts`, `dump-feeding.ts`, `dump-pit-fall.ts`,
   `dump-hall-of-champions.ts`, `dump-vi-altar.ts`, `dump-status-boxes.ts` and
   `dump-reincarnate-entry.ts`.
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

- ⏳ **Champion titles in genuine saves are missing their first character**, sometimes.
  `SHE DEVIL` reads back as `\0HE DEVIL`, `THE BARBARIAN` as `\0HE BARBARIAN`, against
  the preset names in `dungeon.dat`. It is in the files, not the reader: inside one save
  `HALK` loses its `T` while `LEYLA` and `ALEX` keep `SHADOWSEEK` and `ANDER` whole, so
  no offset error explains it. Suspicion is a champion-naming path writing its NUL at
  `name[8]`, which is `title[0]` — unverified, and the reader must not be "corrected"
  for it until the writing path is found. Matters for Phase 10 step 6.

  <sub>Context: `doc/PROVEN_FACTS.md` → “`CHARDESC.title` is 20 bytes, not 16”.</sub>

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

- ⚠️ F8 (random party) was **not** deleted, contrary to the phase's original wording. Its
  justification — "the only way to get a playable party" — expired with Phase 13 step 4:
  the Hall of Champions works. It is kept only because it is still convenient for
  playtesting; deleting it is now a free choice, not a blocked one.
- ✅ F5/F9 (quick-save/load) **stay**. They are not scaffolding to be removed: they are the
  functional equivalent of the original save menu, and are kept for their convenience
  whether or not that menu is ever ported (Phase 10).

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

11. **Load/save menu behind the disk icon** (author request, September 2026):
   the disk icon on the inventory screen should open a custom menu offering save and
   load, to and from **both** browser storage and a real file on disk. The disk-to-file
   half is what makes Phase 10's binary format visible to the player; the browser half
   can ship first over the existing runtime snapshot. Not started, and deliberately not
   worked on in the session that recorded it. Needs: the icon's hit rectangle
   (`src/renderer/ui/HitTest.ts`), a menu drawn in the 320×200 buffer rather than in
   DOM chrome, and File System Access / `<input type=file>` + blob download for the
   disk half.

Status: ⏳ mostly pending, but **rescored against the code in September 2026** — steps
2-5 are in better shape than the list above implies, and step 1 is done:

- Step 1 (inventory the blocks) — ✅ done. The full write order, every block's size and
  the EXPOOL side-writes are tabulated in `doc/CSBWIN_SAVEGAME_REFERENCE.md`.
- Steps 2-5 (runtime state, DB record layouts, object list, cell flags) — ✅ effectively
  done, though not yet *serialized*. `src/engine/DungeonSnapshot.ts` captures exactly
  what blocks 7-14 carry, and the column-index fix closed the last gap in step 4. What
  remains for these is packing, not modelling.
- Step 6 (character block) — ⏳ the one genuinely unported structure. `CHARDESC` is fully
  declared and its title field is 20 bytes rather than the struct's 16
  (`doc/PROVEN_FACTS.md`). Reading names out of a real save works; nothing is packed.
- Step 9 (checksum/scramble parity) — ✅ proven for blocks 0-6 in both directions, and
  now against files this project did not write.
- Step 10 (round-trip validation) — ⚠️ half. `tools/dump-csbwin-save.ts` reads genuine
  saves; the load → re-serialize → binary-compare half waits on the writer.
- ⏳ **New blocker, found by reading real files: the text section of the dungeon image
  does not parse.** Blocks 7-10 are fine — the image sits at
  `SaveGameState.dungeonImageOffset`, plain and uncompressed, and its header, level
  descriptors, column index and object list all read. The indirect text index that
  follows is **little-endian** (unlike the rest of the image) and, worse, none of the
  candidate lengths close: the section must be 5438 bytes and neither
  `NumWordsInTextArray*2`, `*4`, nor `*4 + 4 + 2*sizeOfCompressedText` gets there. Until
  it is solved, everything after it — all 16 databases and the cell flags — is
  unreachable, which is why `parseMissileRecordsFromSaveData` and
  `parseSpecialLocationsFromSaveData` return `null` on every genuine save. The `0`
  those used to report was a failed parse, not an empty one; `tools/dump-csbwin-save.ts`
  now asserts the failure so it cannot be mistaken for a result again.

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

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   asserting tools, then the frames with `--frames`. ~6s, ~17s with frames.
   `tools/` is inside the type gate. Shared helpers in `tools/lib/check.ts`.
   <sub>How it went, and the two real bugs it surfaced: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` starts its own dev server
   and headless Chrome and takes `--update`. Still owed to make it a real test: a fixed set
   of *party positions* rather than whatever the boot dungeon gives, and rendering straight
   from the index buffer instead of a browser screenshot.
   <sub>Baseline re-capture story: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>

3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. ⏳ **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: 🔄 in progress — steps 1 and 2 done; 3, 4 and 5 remain.
