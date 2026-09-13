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
8. ⚠️ **CSBWin-binary-compatible save files** — the **reader is done**: twelve genuine
   saves in `static/gamefiles/saves/` load into a running game, party, world, objects
   and all (Phase 10 step 12, September 13th). The *writer* still stops after block 6,
   which is what is left of Phase 10.
9. ✅ **The party's own pit-fall damage** is ported (Phase 13 step 6), and
   `supressPitDamage` now has something to suppress.

**Validation debt:** several phases below list "Validation" steps (render tests, render
probes, pixel comparisons against CSBWin screenshots) that were **never carried out** —
there is no test framework in the project at all. Verification has been visual and ad hoc.
Those items are now marked 🚫 where they were silently skipped; Phase 15 addresses this.

`npm test` now exists (Phase 15 step 1) and runs both standing forms of evidence in ~6s,
or ~12s with `--frames`. There is still no test *framework*; what there is:

1. `tools/probe-frames.mjs` + `tools/check-frames.sh` drive the real app over the
   DevTools Protocol and byte-compare six screen states against `tools/frames/`. Built
   to make the Phase 14 split safe. Six frames, no assertions beyond equality. The
   script now starts its own dev server and headless Chrome, and the probe pins the
   viewport, so the frames reproduce on any machine rather than only on the browser
   the baseline happened to be captured in.
2. **Twenty-six assertion-carrying verification tools** — the Phase 12 nine
   (`dump-monster-{tables,activation,perception,damage,move,ai}.ts`,
   `watch-monster{s,-attacks}.ts`, `dump-player-attacks.ts`) plus
   `dump-hand-owner.ts`, `dump-throwing.ts`, `dump-clouds.ts`, `dump-savegame.ts`,
   `dump-savegame-blocks.ts`,
   `dump-party-collision.ts`, `dump-door-crush.ts`, `dump-attributes.ts` and
   `dump-champion-state.ts`, `dump-feeding.ts`, `dump-pit-fall.ts`,
   `dump-hall-of-champions.ts`, `dump-vi-altar.ts`, `dump-status-boxes.ts`,
   `dump-reincarnate-entry.ts` and `dump-save-menu.ts`.
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
- Step 6 (character block) — ⚠️ **read, not written.** `CsbwinCharacters.ts` unpacks a
  whole `CHARDESC` — stats, skills, wounds, the thirty possessions, the portrait — and
  its title field is 20 bytes rather than the struct's 16 (`doc/PROVEN_FACTS.md`).
  Nothing is packed. The portrait is the one field that needs a *codec* rather than a
  field write: `readPortrait` unpacks the bitplanes and no encoder exists yet, so the
  writer owes a `writePortrait` that repacks `Champion.portrait` into 464 bytes — and,
  for a champion created in play, resolves `portraitGraphic` against graphic 26 first,
  since the engine never filled the pixels in.
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
