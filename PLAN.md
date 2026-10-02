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
   dungeon: its scope and its steps are there. `DEBT.md`'s index lists it as `P10`, ahead
   of the G rows.
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
- Debug scaffolding is the chrome beside the canvas (`src/ui/`): the settings, the map
  preview and the champion panel. Its teleport by a click on the map and its cursor
  filter trace are behind `isDebugFeaturesEnabled()`. It has no log of its own: what
  the page reports goes to the console, a move's position at debug level, what F5 or
  F9 did at info level.

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

#### The rework

The rework stands on `GameSaves` (`src/engine/GameSaves.ts`), which is built with the
game, its data set and the store, and is where every save is built and written to the
store (the disk menu's SAVE and F5) and where a save's bytes are read back into the game
(LOAD, the boot's chooser and F9). Its scope, and after it the steps, one per commit.

**What a save is**

- **A CSBWin `.dat` file, and nothing else.** `buildSaveFile`
  (`src/engine/SaveGameFile.ts`) writes it, all sixteen blocks, and `applySaveBytes` reads
  it back as a genuine save, so no version of the port strands a save. What a file does
  not hold, a load does not give back, as in CSBWin: `src/engine/CsbwinSaveGame.ts` →
  "What is not restored" is the whole list (a blow not yet taken off the HP, the open
  inventory, and the like), and `tools/dump-save-roundtrip.ts` saves and loads three
  played games and holds everything that differs to it. F5 saves nothing where the disk
  icon does nothing: a champion still being chosen has no place in a file, and the key
  answers "CANNOT SAVE NOW". A
  `.dmweb.json`, the JSON wrapper earlier builds wrote around such a file, is not read:
  the store's upgrade kept of each the file it carried as `raw`.
- **Every save is a row of IndexedDB** (`SaveRecord`, `src/data/saves/SaveStore.ts`): the
  file's bytes beside what the list needs. The level, the champions' names and the
  playthrough (below) are read from the file's own blocks when the row is written; the
  data set, the date, when the save was last used, the play time and whether F5 wrote it
  are the row's own. Nothing is JSON, and no row holds anything a `.dat` could not be
  listed without.
- **No store on disk.** IndexedDB (`BrowserSaveStore`) is the one store: a directory on
  disk needs `showDirectoryPicker`, which is Chromium's alone. **Export** downloads the
  selected save's bare `.dat`, which CSBWin opens. **Import** is a `.dat` dropped on the
  canvas while the dialog is up; there is no file picker.
- **A save knows its dungeon.** A row carries its data set's id, and the list shows the
  running data set's saves only (`GameSaves.dataSet`). The filter is the list's
  parameter, not its rule: `DEBT.md` G17's source save is picked across sets (a DM save
  feeds a CSB game). CSBWin keeps a game's saves in that game's directory (`CSBGAME.DAT`
  to `CSBGAME4.DAT`, `doc/CSBwin-src/CSBCode.cpp:9747-9756`), and guards against the
  wrong graphics with the signatures an Extended Features block may carry
  (`expectedGraphicSignature1/2`, `SaveGame.cpp:378-379`, checked at
  `Graphics.cpp:1784-1815`), which the port neither checks nor writes.
- **An import is checked against the dungeon.** A `.dat` holds no name of its dungeon,
  but it holds the dungeon (blocks 7-14). A dungeon's signature is one digest per level, of
  its walls: the level's width and height, and one bit per cell, stone or anything else.
  Nothing finer: a teleporter a release moved, or a cell whose type play changed, leaves
  the signature alone, and a player seldom knows which release a save came from. The
  digest is SHA-256, the one a browser and Node both have built in. A save is its
  dungeon's when every level matches. A save of another dungeon is refused, with the
  dungeon it looks like named when the port knows it ("switch to it", or "not supported
  yet"), which is the known dungeon most of its levels match: that takes a catalogue of
  known dungeons' signatures, which may list dungeons the port cannot play. The evidence is a tool that
  shows each committed save, early and late ones, matching its own dungeon and no
  other.
- **Play time is the player's**: wall-clock time in the game, the frozen game and the
  open dialog left out. The file's `d.Time` is not it (sleep runs it fast). The game
  counts it in VBLs, sixty a second (`Game.playTime`, `src/engine/Game.ts`): the wall
  clock paces them, and a gap the loop does not make up, a machine asleep, counts
  nothing. The row carries it, in milliseconds (`SaveEntry.playTime`): a save writes
  the count, a load takes the row's, and a new game starts at 0. A row stored before
  rows held it counts none. An export loses it and an import starts at 0. The dialog's
  preview shows it.

**A playthrough**

- **`d.RandomGameID` names it**: drawn when a new game is read
  (`doc/CSBwin-src/SaveGame.cpp:1523-1532`), kept in `GAMEBLOCK1` (offset 308, written at
  `:1060`), carried by the port as `block1.randomGameID`, and what CSBWin itself tests
  for "THAT'S NOT THE SAME GAME" (`:1605-1606`). It is drawn before the Hall of
  Champions, so it names a game from its first step, whoever is in the party. Two new
  games differ: `CsbRandom` takes its seed from `Math.random` at its first draw
  (`src/core/random.ts`), as CSBWin seeds from the system time (`CSBCode.cpp:350`).
  A drawn id is never 0: where CSBWin keeps a product of 0, the port draws again
  (`drawRandomGameID`, `src/engine/GameContext.ts`; `DEBT.md` H).
- **No stored save is to hold 0**, which names no playthrough. A save of an earlier
  build holds it, as the author's four `.dmweb.json` files do. The author's decision, in
  two stages:
  - **A file takes its id as it enters the store** (step 4). The import gives a file
    that holds 0 an id and stamps it into the file, `GAMEBLOCK1`'s `RandomGameID` and
    nothing else of the game, so the row and its file agree and an export carries it.
    The id is that of an existing save that has one, of the same dungeon (the row's
    data set) and the same party (the same champions' names, in the same order), the
    newest when several do (`joinedPlaythrough`, `src/data/saves/SaveStore.ts`); with
    none, a new one, drawn as a new game's is. The rows the store already holds are
    stamped by the same rule in a one-time upgrade of the store, its version 3, one row
    at a time, so that the rows of one party and data set end up in one playthrough. It
    needs no export and no import: only the author's browser holds such rows. After it
    0 is no special value, and what treats it apart is deleted: the load's rule below
    with `OpenedSave.joins`, and `quickSlot`'s refusal of playthrough 0. The draw still
    never gives 0.
  - **Until then the load gives the game its id** (`GameSaves.open`), by the same rule,
    drawing from a stream of its own so that `d.RandomNumber` stays the file's. So a
    running game always has a playthrough, and its saves carry it; the row and the file
    that held 0 keep it. CSBWin takes the file's id as it is (`SaveGame.cpp:1610`), as
    the port does for any other id.
- **No id drawn here is a stored save's.** CSBWin's draw is the
  product of two 16-bit words from consecutive draws of one stream, and two games draw
  the same id about once in 16 million pairs (measured once, over 4 million draws of
  `drawRandomGameID`): 8 chances in 100,000 for a store of fifty playthroughs. Across
  data sets nothing follows, since every comparison is a data set's. Within one, two
  playthroughs of one id would share F5's slot, so one's quick-save would be written
  over the other's; F9 would load whichever of them saved last; neither confirmation
  would be asked between them; and the dialog would list them as one. The author's
  decision: whenever the port draws an id, a new game's or one for a file that holds
  none, it draws again while a row of the data set holds that id (`drawPlaythrough`,
  `src/engine/GameSaves.ts`). CSBWin's formula stays. The engine draws a new game's
  with no store at hand (`newGameBlock1`, `src/engine/GameContext.ts`), so the page
  holds it against the store once the game is read and before it runs
  (`GameSaves.newGameRead`), from the game's own stream; a store that cannot be listed
  leaves the id as drawn. What is left is an imported file whose own id
  is a local playthrough's, which nothing tells from a save of that playthrough, since
  a party changes within one.
- **F5 has a slot of its own**, one per playthrough, written over at each press. It never
  touches a save made from the dialog, which is what is left when a quick-save was made
  at the wrong moment. The slot is the playthrough's newest quick-save in the data set
  (`quickSlot`, `src/data/saves/SaveStore.ts`); a press writes its file and its date
  there, under the row's key and name, and the first press makes the row. Playthrough 0
  has no slot: no game with a party runs under it, and the rows that hold 0 are earlier
  builds' files, of any game. **F9 loads the playthrough's newest save**, the quick slot
  or another, and finds none in a playthrough not saved yet: a new game, or a game
  loaded from a file that names no playthrough, which is no save of the one the load
  gave it. Both are the player's, not debug features, and what they did is printed in
  the message area.
- **SAVE writes over the selected save**, or makes a new one from the heading of the
  running game's playthrough; a game with no save yet has no heading, and makes its
  first from the list's "new save" row. The row written over keeps its key and its name
  and takes the file, its date and the game's playthrough, and is the dialog's save from
  then on: a quick-save written over is F5's slot no longer, and the next F5 makes
  another. On another playthrough's heading SAVE does nothing, the author's decision: a
  file holds the running game's id, so a new save is never another playthrough's.
  **LOAD takes any save**, and from a heading the last save used of its playthrough.
  Either asks first when the save, the one read or the one written over, is of another
  playthrough than the running game's, a file that names none included; the order of
  two saves of one playthrough is never checked, since loading an old save and saving
  over a newer one is ordinary play. The question is `_DoMenu`'s two-option menu in the
  dialog's place: CSBWin's own line for a save of another `d.RandomGameID`, "THAT'S NOT
  THE SAME GAME" (`doc/CSBwin-src/SaveGame.cpp:1605-1606`), over the action and CANCEL
  (`asksFirst`, `src/renderer/ui/SaveMenu.ts`). The boot's chooser has no game behind
  it and never asks.
- **The last save used**, loaded or written, is the dialog's selection when it opens,
  the boot's chooser's too. The author's decision: each row holds the time it was last
  used (`SaveEntry.usedAt`), set by a write and by a load that read, and the last save
  used is the data set's row with the latest (`lastUsedSave`,
  `src/data/saves/SaveStore.ts`). Nothing is kept beside the rows, and using one save
  writes nothing to another's row. A load sets that time alone (`SaveStore.markUsed`);
  a row stored before rows held it counts from its date. With no save in the data set,
  the dialog opens on "new save".

**The dialog**

- Its own layout over nearly the whole 320×200 buffer, in the game's style (graphic 0's
  pieces, `_DoMenu`'s colours and font): not one of `_DoMenu`'s four layouts.
- **The layout**: 304×184 at (8,8), on a screen cleared to black, in the game as at the
  entrance: an 8-pixel ring of the game's picture would show nothing whole. Three pieces
  of graphic 0 make it, each drawn at the size wanted by keeping its corners and
  repeating its middle: the grey frame, the sunken panel and a button frame. Two panels
  side by side, the list's (210 wide: 32 characters a row and the scrollbar) and
  the preview's (65 wide, 10 characters), over one row of four buttons: LOAD, SAVE and
  EXPORT under the list, CANCEL under the preview. A button that can do nothing has no
  label, as CSBWin's empty slot has none. The labels' places in their frames, the
  rectangle a click takes and the press animation are `_DoMenu`'s. The question before
  a load or a save is `_DoMenu`'s centred menu, alone on the cleared screen.
- **A two-level list**: a heading for each playthrough, named by the champions of its
  newest save, and under it, folded or not, its saves, newest first, each with its day,
  its time, its level and, on F5's, "QUICKSAVE". The playthroughs are in the order of their last
  use, a playthrough's being that of the save of its own last used
  (`playthroughsOf`, `src/data/saves/SaveStore.ts`). The dialog opens with the first
  unfolded, the last save used selected under it, and the others folded; a click on a
  heading folds or unfolds it, and so do the left and right arrows. A game with no save
  yet has no heading, and the full menu a first row, "NEW SAVE", in its place. The
  files that name no playthrough are listed as one, until step 4 leaves none.
- **The list scrolls** under its fifteen rows, beside a scrollbar in the manner of a
  GEM window's, in the dialog's two colours, the option's orange on the panel's brown
  (`drawScrollbar`, `src/renderer/ui/SaveMenu.ts`): eleven columns against the panel's
  right edge, outlined; a hollow arrow on a stem in a box at each end; between them a
  slider, plain, whose height is to the track's as the rows shown are to the list's,
  in a track dithered of the two colours where rows lie beyond the panel. A list that
  fits has the whole track for a slider. A click on an arrow scrolls a row, as a notch
  of the wheel does; the slider is not dragged, and the track takes no click. Scrolling
  does not move the selection, which may leave the panel; a key that moves the
  selection scrolls the list back to it.
- **A preview** beside the list, of the save LOAD would read: the selected save, or
  from a heading its playthrough's last save used, and nothing on "NEW SAVE". A line of
  the panel each, on the list's rows (`formatSavePreview`,
  `src/data/saves/SaveStore.ts`): the champions' names without their titles, the level,
  the play time as `H:MM:SS`, and the day and the time it was saved. A party of fewer
  than four leaves its lines empty, so the rest stands in one place for every save.
- **The dialog's message**, what went wrong, what was done or "WORKING...", is the last
  lines of the preview's panel, in the title's colour: wrapped at the panel's width
  (`wrapMessage`, `src/renderer/ui/SaveMenu.ts`), five lines at most, over whatever
  lines of the preview it needs. A move of the selection takes it down.
- **LOAD, SAVE, EXPORT**, and a drop for the import. No delete, no quit and no "SAVE AND
  QUIT": loading another playthrough's save is how a player leaves a game.
- **No "GAME LOADED, READY TO PLAY."**, nor its "ASCII DUMP" (`DEBT.md` G14): a
  loaded game is played at once. It is CSBWin's `_TAG021028` menu
  (`doc/CSBwin-src/CSBCode.cpp:10493-10537`), so its absence is an entry of
  `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". The boot's
  hand-off keeps the fade to black and the cleared screen that menu gave the chooser's
  picture (`tag021028`, `src/renderer/intro/BootSequence.ts`).

**The steps**

1. ✅ **The row.** The data set, the playthrough and whether F5 wrote it, beside the
   bytes. `GameSaves` lists its data set's rows. The
   store's version-2 upgrade (`src/data/saves/legacyRows.ts`, run once by `idb.ts`) keeps
   of each older row the CSBWin file alone, out of its `.dmweb.json` when it is one, and
   reads the row again from that file. An older row names no data set, so every one
   becomes the default set's; a row that holds no CSBWin file, which no build could
   load, is dropped. Nothing else in `src/` reads JSON. Evidence:
   `tools/dump-save-menu.ts`, "the one save call" and "the store's upgrade". The
   IndexedDB half of the upgrade (`upgradeFromVersion1`) no tool runs, since Node has no
   IndexedDB. The author's `.dmweb.json` files on disk are converted by hand, outside
   the engine; `tools/peek-dungeon.ts` reads one meanwhile.
2. ✅ **The playthrough**, one commit each:
   - a. ✅ **A game loaded from a file of playthrough 0 is given one**, by the menu's
     LOAD and the boot's chooser, which read through `GameSaves.open` and `read`.
     Step 4 moves the rule to the import and deletes it here. Evidence:
     `tools/dump-save-menu.ts`, "the list" (which save is joined) and "a save that names
     no playthrough" (the loads).
   - b. ✅ **F5's slot and F9's choice.** Evidence: `tools/dump-save-menu.ts`, "the list"
     (which row is the slot), "the one save call" (a second F5 writes over the first,
     and SAVE does not), "one store, two data sets" (F9 in its playthrough, and in one
     with no save) and "a save that names no playthrough" (neither key takes such a
     file).
   - c. ✅ **SAVE over the selection**, or new from the game's heading or the list's
     "new save" row.
     Evidence: `tools/dump-save-menu.ts`, "the
     one save call" (the row written over, F5's slot written over, another
     playthrough's save) and "the menu's selection, and what SAVE writes" (the menu's
     own clicks and keys); the golden frame shows the row.
   - d. ✅ **The two confirmations.** Evidence: `tools/dump-save-menu.ts`, "the
     question before a load or a save across playthroughs" (which LOAD and which SAVE
     ask, that nothing is done before the answer, and what each answer does).
   - e. ✅ **The last save used.** Evidence: `tools/dump-save-menu.ts`, "the list"
     (which row it is, and a row from before the field), "one store, two data sets"
     (F9's load marks its row, in its set alone) and "the menu's selection, and what
     SAVE writes" (either menu opens on it, scrolled to it; a read that fails marks
     nothing; a load writes the time alone). `BrowserSaveStore.markUsed` no tool runs,
     since Node has no IndexedDB.
   - f. ✅ **The play time.** Evidence: `tools/dump-save-menu.ts`, "the play time" (the
     VBLs counted, and those of the frozen game and of the disk menu left out; SAVE's
     and F5's rows; LOAD and F9 taking the row's; a save and a load exact to the VBL; a
     read that fails; a row from before the field; a new game) and "the store's
     upgrade" (an upgraded row counts none).
   - g. ✅ **A drawn id is no stored row's**: a new game's, and the load's for a file
     that holds none; step 4's import and upgrade draw through the same
     `drawPlaythrough`. Evidence: `tools/dump-save-menu.ts`, "a drawn playthrough is no
     stored save's" (a store holding the ids a pinned stream draws first, and each
     game taking the next; another data set's saves; a store that cannot be listed).
3. ✅ **The dialog**, one commit each:
   - a. ✅ **The frame**: the dialog in its rectangle on the cleared screen, drawn from
     graphic 0's pieces (`drawPiece`, `src/renderer/ui/SaveMenu.ts`). The list is
     fifteen rows, which fill its panel with two pixels of it above and below; LOAD,
     SAVE and CANCEL are buttons, and EXPORT's frame has no label until step 4; the
     question is
     centred. Evidence: `tools/dump-save-menu.ts`, "the dialog's pieces of graphic 0"
     (each piece at its own size is the art), "the dialog" (the margins, and clean
     panel under every row and label), "the menu button sets" (a frame's rectangle and
     label against CSBWin's table) and "the menu's selection" (CANCEL, and EXPORT's
     frame); the golden frame `tools/frames/06-savemenu.png`.
   - b. ✅ **The two-level list**: a heading row for each playthrough over its saves,
     folded or not (`layoutRows`, `src/renderer/ui/SaveMenu.ts`). A save's row gives up
     the party, which is its heading's, for the time of day and F5's "QUICKSAVE". Evidence:
     `tools/dump-save-menu.ts`, "the list" (the playthroughs and their order, a
     heading's and a save's row) and "the two-level list" (three games' saves in one
     store: which heading is first and unfolded and which save selected; a click
     folding and unfolding; from a heading, LOAD reading the last save used, asking
     across playthroughs, and SAVE making a new save on the game's own and inert on
     another's; the "new save" row of a game with no save; the load-only chooser), and
     "the menu's selection" (the arrows).
   - c. ✅ **The preview**, in its panel (`drawSaveMenu`, `src/renderer/ui/SaveMenu.ts`);
     the dialog's message, what went wrong, what was done or "WORKING...", is the
     panel's last lines.
     Evidence: `tools/dump-save-menu.ts`, "the dialog" (ten characters fit the
     panel), "the list" (a play time's format, and a preview's lines) and "the preview"
     (the panel read back: which rows hold ink and that none leaves the lines' cells;
     "NEW SAVE" showing nothing, a heading its last save used, and the load-only
     chooser the same; a message on the panel's last lines, as many as it wraps to,
     and taken down by a move of the selection).
     The golden frame shows the "NEW SAVE" row, whose preview is empty.
   - d. ✅ **The scrolling**: the scrollbar, its arrows and the wheel (`drawScrollbar`,
     `scrollSlider`, `scrollBy` and `showSelection`, `src/renderer/ui/SaveMenu.ts`).
     Evidence: `tools/dump-save-menu.ts`, "the dialog" (the bar against the panel's
     edge, on clean panel) and "the scrolling" (twenty-one rows, the bar read back
     from the screen: the slider's place and height at the first row, between and at
     the last page, the checkerboard around it, the outlines, the two arrows; an
     arrow's click and the wheel scrolling a row and leaving the selection out of the
     panel, and a draw not scrolling back; the track and the slider taking no click; a
     key bringing the list back; a list that fits having the whole track for a
     slider); the golden frame shows that last case. The wheel and the keys reach the
     list in play and at the entrance, whose chooser is up before the page's own
     listeners are bound (`createIntroHost`, `src/renderer/intro/BootSequence.ts`):
     the frames probe checks that either menu takes a notch and the entrance none,
     and that the chooser's selection follows the arrow keys.
4. ⏳ **Export and import**, with the dungeon check and the catalogue behind it, one
   commit each. Until the import a `.dat` on disk has no way into the page, the
   committed saves included: the store's rows are the only saves it loads.
   - a. ⏳ **No stored save holds playthrough 0** ("A playthrough"). The stamp: an id
     written into a file that holds none, `GAMEBLOCK1`'s `RandomGameID` and nothing
     else, with a tool of its own (the stamped file differs from the original in
     `GAMEBLOCK1` alone, and reads back with the id). The store's version-3 upgrade
     stamps the rows it already holds. The load's rule (2a) is deleted, with
     `OpenedSave.joins` and `quickSlot`'s refusal of playthrough 0. It comes first
     because, until it, a game loaded from a row that holds 0 runs under an id its row
     does not have, so the saves made from it are listed under another heading than
     the save it was loaded from.
   - b. ⏳ **EXPORT**: the selected save's bare `.dat`, downloaded.
   - c. ⏳ **A dungeon's signature, and the catalogue** of the known dungeons', with the
     tool that shows each committed save matching its own dungeon and no other.
   - d. ⏳ **The import**: a `.dat` dropped on the canvas while the dialog is up,
     checked against the dungeon, stamped when it holds no id, and stored.
5. ✅ **No "GAME LOADED, READY TO PLAY."** Evidence: `tools/dump-bad-saved-game.ts`, "a
   save read" (the hand-off after a load is one fade and four VBLs on a cleared screen,
   and waits for no click), and the golden frame `tools/frames/12-game-loaded.png`: the
   loaded game's first view, straight from the chooser's LOAD.

#### The file

`saveSaveGameState` (`src/data/SaveGameLoader.ts`) writes all sixteen blocks, and
`buildSaveFile` hands it the Extended Features header (`buildLiveExtendedFeatures`,
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
eight committed saves:

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
  form) and `tools/dump-save-roundtrip.ts` (the file a save is, saved and loaded:
  five cycles that leave the timer table the same size, and three played games whose
  every difference after a load is on the list of what a file does not hold).

#### The menu

The disk icon opens a dialog over the 320×200 buffer (`src/renderer/ui/SaveMenu.ts`
over `Menu.ts`, a faithful `_DoMenu` / `_WaitForMenuSelect`), listing the running data
set's saves (`GameSaves.list`, over `src/data/saves/`) under a heading for each
playthrough, the last one used first: the party of its newest save, and when unfolded
its saves, newest first, each row with its day, time and level. A game with no save yet
has a first row, "NEW SAVE", for a heading. Beside the list, a panel previews the save
LOAD would read: its party, its level, its play time and its date. The list has a
scrollbar, whose arrows scroll it a row a click, as the wheel does. The menu opens on the last
save used, written or loaded, its playthrough alone unfolded, and on "NEW SAVE" when the
data set has none. LOAD reads the selected save, or from a heading its playthrough's
last save used. SAVE writes over the selected save, or from the game's own heading or
"NEW SAVE" makes a new row, its file a `.dat` named for its date. Either asks first on a
save of another playthrough than the running game's. Both,
and the two keys, go through `GameSaves` (`src/engine/GameSaves.ts`). F5
writes its playthrough's quick-save, over the last, and F9 loads the newest save of its
playthrough, F5's or the menu's. Each key says what it
did on a line of the message area, in white: "GAME SAVED" or "GAME LOADED"; "CANNOT SAVE
NOW" with no party, with a champion still being chosen, or while a script holds the loop,
and "CANNOT LOAD NOW" for that last; CSBWin's own "UNABLE TO SAVE GAME!"
(`doc/CSBwin-src/SaveGame.cpp:1266`) and "CAN'T FIND SAVED GAME!" (`:1585`) for a write
that failed and for no save at all; a file that does not read gives the line the menu's
message would be. Each outcome is also a line for the console, with the save's name,
and with the error behind a failure. CANCEL, Esc and a right-click close the menu. The
five places it
diverges from CSBWin's menu are listed in `doc/CSBWIN_MENU_REFERENCE.md`, with the menu
the boot leaves out after a load. Evidence:
`tools/dump-save-menu.ts` and the golden frame `tools/frames/06-savemenu.png`.

#### Deferred

- ⏸️ **DSA programs are not written**, and `buildSaveFile` refuses a dungeon with any
  (`DEBT.md` G1). The retail DM dungeon defines none: `numDSA` is 0 in every committed
  save, with no special-location records. **The DSA global variables are not read from `EXPOOL`**
  (`doc/CSBwin-src/SaveGame.cpp:1746-1763`); the running game's are kept (G1).
- ⏸️ **`SimpleEncryption` is neither written nor readable past the header**, and
  **`MakeBigActuators` reads the actuator type after the byte swap, CSBWin before it**
  (`DEBT.md` G4).
- **What no CSBWin file holds is not restored**: `d.Word11694` (`gameWon`),
  `d.PartySleeping`, `d.PendingDamage` and `d.PendingOuches`, the open inventory
  (`src/engine/CsbwinSaveGame.ts` → "What is not restored").
- **`EXPOOL` holds the bones records and what the file had, no more.** CSBWin's `Setup`
  gives every loaded game the pool's directory block (`doc/CSBwin-src/SaveGame.cpp:2773`),
  and `SaveGame` puts the 24 overlay palette records there at every save (`:1152-1164`).
  The port makes the block at the first record it writes, a death's bones
  (`src/data/CsbwinExpool.ts`), and writes no palette record, so its save of a game
  started on `dungeon.dat` has no `EXPOOL`, or the bones' alone. CSBWin loads either:
  `Setup` makes the block, and with no palette record it keeps the palette it has
  (`:1763-1789`).
- **A record index above 1023 cannot be expressed.** `dataIndexMap` is 16 bits and the
  port's RN index field is 10; CSBWin allows 64000. The largest index in any committed
  save is 682, and `CsbwinObjectIndex.resolve` throws rather than alias.
- ⏸️ **An unknown dungeon played from its save**, a later option on the import's refusal,
  of use to someone iterating on a dungeon of their own. A save is its dungeon's whole
  world and already loads into any running game (`installCsbwinWorld`), so what is
  missing is what the file does not hold: the graphics and the tables read from
  `graphics.dat`, which the player would pick from the known dungeons' (the signatures
  an Extended Features block may carry, `SaveGame.cpp:378-379`, could suggest one); a
  `dungeon.dat` for "RESTART THIS GAME", so a lost game can only load a save; and a data
  set to list its saves under, which its signature can stand for. A dungeon with DSAs
  waits for `DEBT.md` G1: `buildSaveFile` refuses to save one.
- **The menu:** no delete (`BrowserSaveStore.remove` has no caller), no file picker for
  an import and no `SAVE AND QUIT`, none of them in the rework's scope; and the golden
  frame shows the "NEW SAVE" row alone, since the frame script clears IndexedDB
  (`dump-save-menu.ts` proves the rows).

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
