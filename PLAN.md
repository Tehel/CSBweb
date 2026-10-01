# dmweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- ⏸️ postponed until the default dungeon is validated (`DEBT.md` → "Priority")
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

This file carries only the phases that still have work in them, and describes them as
they stand (`CLAUDE.md` → "Write down the present, not the past"). When a phase is
finished, lift anything still open into **`DEBT.md`**, which is the authority on debt, and
any verified fact into `doc/`; then delete the phase's body and add its line to
"Completed phases".

## Current priority: a working game on the default dungeon

The goal is a complete, faithful game on `dm-atari`. The work, in order:

1. **Rework the save menu** (Phase 10), and with it saves that know their
   dungeon. The author sets the rest of its scope when it starts. `DEBT.md`'s index lists
   it as `P10`, ahead of the G rows.
2. **`DEBT.md`'s other active rows**: the unported CSBWin features the default dungeon and
   Chaos Strikes Back reach. `DEBT.md` says how
   to work an item. **One item per commit, a few per session**, then `/clear`. Its index is
   the live status; its first row is the next item.
3. Phase 15 step 4 interleaves anywhere.

⏸️ **Postponed until the default dungeon is validated**: DSA extensibility and CSBWin's
custom-dungeon extensions (`DEBT.md` G1-G4), its debugging features (G14, the ASCII dump),
and Phase 15 step 5. The retail dungeon uses none of them. Features of **Chaos Strikes
Back** are not postponed: it is the next dungeon to try.

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

## Status

**Working:**
- Data loading: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, save games (base and
  extended).
- The bytecode viewport renderer, the authoritative path. Every `0x22e` rectangle table is
  extracted at runtime; no guessed geometry remains in the renderer.
- Movement and collision: stamina per step, the move delay in ticks, CSBWin's one mouse
  queue for keys and clicks, and timers processed straight after a move.
- The timer queue, with CSBWin's duplicate-timer rules.
- Actuators, DSA scripting, teleporters, pits, doors, false walls.
- Missiles, throwing and clouds.
- Skills and experience (mastery, `AdjustSkills`, `LevelUp`), magic casting (all three
  spell classes), worn-object bonuses.
- Light levels and palette switching, sound, the message area (`SCROLLING_TEXT`), most of
  the DM UI.
- Monsters (`Monster.cpp`): groups hunt, flee, throw missiles, hit the party, take damage
  and die. The champions' own attacks (`Attack.cpp`), through the Party Attack Filter.
- The champion lifecycle: the Hall of Champions mirrors, the Reincarnate screen, feeding,
  poison, pit falls, death and bones, the Altar of Vi; sleep.
- The pre-game sequence: the title animation, the dungeon entrance, the door animation and
  the credits scroll. The game's `dungeon.dat` is read after ENTER, as CSBWin reads it.
- Three data sets (`src/data/DataSets.ts`: `dm-atari`, the default, `dm-windows` and
  `csb`), one chosen before the boot by `?dungeon=<id>`, and the DM Rules toggle.
- Debug scaffolding is confined to `src/dev.ts`, reached only through
  `isDebugFeaturesEnabled()`.

**Incomplete:**
- ⚠️ **The save menu.** Save files are done: the reader, and the game's own save button,
  which writes all sixteen blocks as CSBWin fills them. `tools/dump-live-save-file.ts`
  writes a file from a game played out of `dungeon.dat` and one from a game played on from
  a genuine save, and loads both back with the world, the party, a thrown object in flight
  and the object on the cursor intact. The menu behind the disk icon is to be reworked
  (Phase 10).
- ⚠️ **Validation.** Several completed phases listed validation steps (render tests, render
  probes, pixel comparisons against CSBWin screenshots) that were never carried out.
  Phase 15 gathers them.
- Everything in `DEBT.md`: the technical debt, the known divergences from CSBWin, and the
  unported CSBWin features (tier G).

**The evidence.** `npm test` runs `tsc` and every tool listed in `tools/run-checks.mjs`;
`npm test -- --frames` adds the golden frames. There is still no test *framework*:

1. **Golden frames.** `tools/probe-frames.mjs` and `tools/check-frames.sh` drive the real
   app over the DevTools Protocol and compare the screen states in `tools/frames/`. The
   probe reads the 320x200 canvas back and `tools/compare-frames.mjs` compares pixels, so
   nothing depends on the host machine. It also fails a baseline that holds two identical
   frames, so a frame that can no longer fail is caught.
2. **Verification tools.** `tools/run-checks.mjs` is the one list of them; don't copy it
   anywhere. They load the real game files, drive the real engine with a fixed RNG seed,
   print a human-readable table and assert invariants through `tools/lib/check.ts`, whose
   `finish()` also fails a run that made no checks. They are the regression suite for
   everything the frames cannot see. The pattern is in `.claude/skills/verification-tools/`;
   what Phase 15 still owes is shared fixtures.

## Completed phases

Open items from them are in `DEBT.md`. `doc/PLAN_ARCHIVE.md` (frozen) holds the working
notes of the phases closed up to 2026-09-26; for a phase closed later, its line here and
`git log` are the record.

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

Only the phases with work left in them.

### Phase 10 — CSBWin-Compatible Save/Load

Goal: read and write a save file CSBWin itself can load. **Reading and writing are done**;
what is left is the rework of the save menu. What the file cannot carry for a dungeon with
DSAs or an enciphered file is postponed with them (`DEBT.md` G1, G4).

#### The rework: what is already decided

The author sets the rest of its scope when it starts. `DEBT.md` E13 (the save pipeline's
owner) and C96 (the bones records in `EXPOOL`) come first.

- **A save is a CSBWin `.dat` file, and the JSON wrapper goes.** A `.dmweb.json`
  (`src/engine/SaveGamePayload.ts`) pairs `runtime`, the port's own state in the shape of
  the build that wrote it, with `raw`, the whole CSBWin file the port writes. Only `raw`'s
  format is stable: `runtime` is refused at any other version, and `applySaveBytes` then
  loads `raw` as a genuine save. Saving the `.dat` alone ends the version bumps that
  strand saves. First, whatever only `runtime` carries has to be found a place in the
  file, or shown to follow from it: `src/engine/CsbwinSaveGame.ts` → "What is not
  restored" is where to start, and `tools/dump-save-roundtrip.ts` is how to prove the file
  alone gives the game back. Both stores already list a genuine `.dat` from its own blocks
  (`src/data/saves/`).
- **A save knows its dungeon.** A save's header names its date, level and party, not its
  game (`SaveHeader`, `src/engine/SaveGamePayload.ts`), and both stores list every save
  together, so a DM save could be offered to a CSB game and restored into the wrong
  tables. CSBWin keeps a game's saves in that game's directory (`CSBGAME.DAT` to
  `CSBGAME4.DAT`, `doc/CSBwin-src/CSBCode.cpp:9747-9756`), and guards against the wrong
  graphics with the signatures an Extended Features block may carry
  (`expectedGraphicSignature1/2`, `SaveGame.cpp:378-379`, checked at
  `Graphics.cpp:1784-1815`), which the port neither checks nor writes. Needed: saves
  stored and listed per data set (`src/data/DataSets.ts`), a genuine `.dat` accepted in
  the set whose files it was made from, and `DEBT.md` G17's source save picked across sets
  (a DM save feeds a CSB game).

#### The file

`saveSaveGameState` (`src/data/SaveGameLoader.ts`) writes all sixteen blocks, and
`buildSavePayload` hands it the Extended Features header (`buildLiveExtendedFeatures`,
`src/data/CsbwinExtendedFeatures.ts`), the object indirect index and the dungeon image, so
the game's own save writes a whole file. `applyCsbwinSave` (`src/engine/CsbwinSaveGame.ts`)
reads one back: `loadCsbwinWorld` (`src/data/CsbwinDungeonImage.ts`) parses the image,
`src/data/CsbwinCharacters.ts` unpacks `CHARDESC[4]` and the party tail, portraits
included, and `src/data/CsbwinObjectIndex.ts` translates every RN, which in a save is a
slot of the object indirect index, not a packed RN (`doc/PROVEN_FACTS.md` → "An RN in a
save file is an indirect index"). An original dungeon is converted on load as CSBWin
converts it (`src/data/CsbwinDungeonConversions.ts`: `ConvertToIndirectText`,
`MakeBigActuators`, `convertScrolls`), so the world in memory is always save-shaped.
When a layout does not close, save files made to order give the anchors: a fresh game
diffed against `dungeon.dat` is how the image was solved, and the section that seemed
wrong turned out to be three (`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save
file").

Against the write order in `doc/CSBWIN_SAVEGAME_REFERENCE.md`, over `dungeon.dat` and the
fourteen committed saves:

| Block | What it holds | State |
| --- | --- | --- |
| 0 | Extended Features, `dataTypeMap`/`dataIndexMap`, DSA blocks | ✅ byte-identical: header, both maps, the game info and the DSA level index with its 0xff terminator |
| 1 | GAMEBLOCK1 | ✅ every field; byte-identical outside the bytes `SaveGame` never assigns |
| 2 | GAMEBLOCK2 (128 b) | ✅ all 21 fields, byte-identical; `ObjectInHand` an indirect slot, `RNnul` when empty |
| 3 | ITEM16 | ✅ |
| 4 | characters + party tail | ✅ byte-identical, the thirty possession slots written as indirect slots |
| 5 | timers | ✅ the whole `TIMER`, in all three sizes, byte-identical bar `unused13` in a freed slot |
| 6 | timer queue | ✅ byte-identical over the live `NumTimer` entries; the debris past them is not reproduced |
| 7 | image header (`DUNGEONDATINDEX`, 44 b) | ✅ byte-identical |
| 8 | level descriptors (16 b x `NumLevel`) | ✅ byte-identical |
| 9 | column index (`objectListIndex`) | ✅ byte-identical |
| 10 | object list (`d.objectList`) | ✅ checked by resolving (below) |
| 11 | indirect text index | ✅ byte-identical. Little-endian longwords |
| 12 | `sizeOfCompressedText` + the text | ✅ byte-identical. Little-endian size word, big-endian text |
| 13 | the sixteen databases | ✅ every byte that is not an RN is the file's own; the RNs are resolved |
| 14 | cell flags (`cellFlagArray`) | ✅ byte-identical; `cellFlagArraySize` computes the 12366 every file declares |
| 15 | final checksum word | ✅ `buildImageChecksum`, proved against each save's own closing word |

**Two sections cannot be byte-identical.** Every word of block 10 and the link word of
every record in block 13 is an RN, which in a save is a slot number, and
`buildObjectIndirectIndex` numbers the slots its own way: CSBWin's order cannot be
reproduced and nothing outside the file refers to a slot number. Those words are
resolved instead: written, read back through `readObjectIndirectIndex` (both
`FormChecksum`s verified), and each must name the object the reader got out of CSBWin's
word. That argument would survive a bug our encode and our resolve shared, and
`tools/dump-dungeon-image-blocks.ts` says so where it makes it; `dungeon.dat`, which
stores packed RNs, is the compensating case, where those 1682 words are byte-compared.
<sub>`doc/PROVEN_FACTS.md` → "An RN in block 10 or block 13 cannot be byte-identical".</sub>

**Reported rather than asserted**, each for a sourced reason: `TIMER.unused13` in a freed
slot and the timer queue past `NumTimer`, both CSBWin allocation debris
(`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is 0xcd in a slot that has been used");
block 1's bytes `SaveGame` never assigns (`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what
`SaveGame` writes there, and which two fields are little-endian"); and a converted
scroll's `m_word4` bits 1-15, which `convertScrolls` leaves as debris in a genuine save
and the port writes as zero.

Evidence:

- `tools/dump-save-file-roundtrip.ts`: each committed save parsed, all sixteen blocks
  written again and read back by the port's own reader, field for field.
- `tools/dump-save-blocks-vs-file.ts` (blocks 2-6), `tools/dump-character-block.ts`
  (block 4) and `tools/dump-dungeon-image-blocks.ts` (blocks 7-15): written again from
  what was read, and compared with the file's own bytes.
- `tools/dump-live-save-file.ts`: a game played out of `dungeon.dat` and one played on
  from `csbgame7.dat`, each written and loaded into a fresh engine. Its scenario 2 holds
  the monster state to a fixed point rather than to the played game, because a load
  re-creates every group's movement timers and re-rolls their walk offsets, as CSBWin's
  does.
- `tools/dump-csbwin-world.ts` (every object chain of every save),
  `tools/dump-csbwin-party.ts` (every possession slot names a live record),
  `tools/dump-csbwin-load.ts` (each save restored into a real `Game` and asked where the
  party is, what it carries and what every cell holds), `tools/dump-csbwin-timers.ts`
  (two saves whose door timers differ in one byte: one door opens, the other shuts),
  `tools/dump-dungeon-conversions.ts` (the conversions against the saves' converted
  form) and `tools/dump-save-roundtrip.ts` (the JSON payload the stores write, including
  five save/load cycles that leave the timer table the same size).

#### The menu

The disk icon opens a menu drawn in the 320×200 buffer (`src/renderer/ui/SaveMenu.ts`
over `Menu.ts`, a faithful `_DoMenu` / `_WaitForMenuSelect`), listing the saves of the
browser store or of a directory on disk (`src/data/saves/`), newest first, each row with
its date, level and party. LOAD acts on the selection; SAVE always makes a new file. F5
writes one more save to the current source (the browser when the file source is not
connected, since a key must never raise a folder picker), and F9 loads the newest
loadable save of every store that can be listed without prompting. The five places it
diverges from CSBWin's menu are listed in `doc/CSBWIN_MENU_REFERENCE.md`. Evidence:
`tools/dump-save-menu.ts` and the golden frame `tools/frames/06-savemenu.png`.

What the file source can do: listing a directory needs `showDirectoryPicker`, which is
Chromium-only and hands back a handle for a directory the player picks. There is no path
access, so a directory cannot be opened by name or created outside a granted handle. The
handle is kept in IndexedDB, so the pick happens once; the permission is not, and Chrome
asks again with one click per page load. Both calls need transient user activation, which
is why a click while the menu is up is handled straight from the DOM event rather than
through the game's mouse queue.

#### Deferred

- ⏸️ **DSA programs are not written**, and `buildSavePayload` refuses a dungeon with any
  (`DEBT.md` G1). The retail DM dungeon defines none: `numDSA` is 0 in every committed
  save, with no special-location records. **The DSA global variables are not read from `EXPOOL`**
  (`doc/CSBwin-src/SaveGame.cpp:1746-1763`); the running game's are kept (G1).
- ⏸️ **`SimpleEncryption` is neither written nor readable past the header**, and
  **`MakeBigActuators` reads the actuator type after the byte swap, CSBWin before it**
  (`DEBT.md` G4).
- **`d.Word11694` (`gameWon`) and `d.PartySleeping` are not restored**; neither is in
  `GAMEBLOCK2` where the reader looks.
- **A record index above 1023 cannot be expressed.** `dataIndexMap` is 16 bits and the
  port's RN index field is 10; CSBWin allows 64000. The largest index in any committed
  save is 682, and `CsbwinObjectIndex.resolve` throws rather than alias.
- **The menu:** no `<input type=file>` or download fallback for Firefox and Safari (the
  file source says `NEEDS A CHROMIUM BROWSER`); no delete (`BrowserSaveStore.remove` has
  no caller); no `SAVE AND QUIT`; and the golden frame shows an empty list, since the
  frame script clears IndexedDB (`dump-save-menu.ts` proves the rows).

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   asserting tools, then the frames with `--frames`. ~14s, ~33s with frames.
   `tools/` is inside the type gate. Shared helpers in `tools/lib/check.ts`.
   <sub>How it went, and the two real bugs it surfaced: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` starts its own dev server
   and headless Chrome and takes `--update`. Fourteen frames: the first six load
   the app with `?intro=0`, and `07-entrance` / `08-credits` / `12-game-loaded` load it
   again without, which is the only standing evidence that the corridor behind the prison
   doors actually renders. The rest boot with `?intro=0` once more and stand the party on
   a fixed square (`FACE` in `tools/probe-frames.mjs`): a pressed crack switch
   (`doc/PROVEN_FACTS.md`, "`dm-atari/graphics.dat` is CSBWin's with three items from the 1.2 disk"), two door ornaments, and a
   mirror on each F2 edge wall, positions 7 and 9 of `DrawWallDecoration`. Still owed to
   make it a real test: comparing the palette-index buffer rather than the RGBA canvas it
   is converted to.
   <sub>Baseline re-capture story: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>

3. ✅ **Render probe.** `tools/dump-render-probe.ts` runs every cell program of
   `pStdDrawCode` on its own, headless, over hand-built room data, against the real
   `graphics.dat` and `dm-atari` level 0, in both mirror parities. It asserts that the
   port's table is null in exactly CSBWin's 46 `NOP` slots, that no program warns or
   writes a pixel outside the 16 colours, and that all 244 renders hash as
   `tools/reference/render-probe.tsv` records. A deliberate renderer change looks with
   `--png` (one contact sheet per parity in `tools/output/`) and rewrites the baseline
   with `--update`. Each slot is tried with one summary per room type (a closed door, a
   visible pit and teleporter, no decorations or objects), so wall and floor decorations,
   text, objects and the other door states are still seen only by the golden frames.
4. 🔄 **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately. Part-paid by Phase 16: `tools/dump-image-codec.ts`
   decodes every image in both data sets and asserts each one fills its own buffer exactly,
   which is what caught the codec bug's blast radius, and checks each opcode on a hand-built
   stream. The *table* extraction (`0x22e`..`0x232`) still has no round-trip check beyond the
   canaries individual tools assert.
5. ⏸️ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation). Postponed, perhaps for good: staging the same scene in CSBWin without
   cheats costs more than it would prove, and the golden frames and the render probe
   already catch any pixel that changes unintentionally.

Status: 🔄 in progress — steps 1, 2 and 3 done, 4 part-done; 5 postponed.
