# csbweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- ⏸️ postponed: taken only when the author names it (`DEBT.md` → "Priority")
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

This file carries only the phases that still have work in them, and describes them as
they stand (`CLAUDE.md` → "Write down the present, not the past"). When a phase is
finished, lift anything still open into **`DEBT.md`**, which is the authority on debt, and
any verified fact into `doc/`; then delete the phase's body and add its line to
"Completed phases".

## Current priority: paying the debt, then open-sourcing

The game is complete. Every FTL dungeon loads and plays, and so do the fans' dungeons the
welcome page lists; Dungeon Master and Theron's Quest have been played to their end. The
site around them is deployed: the welcome page, a player's own data sets, the server.

The work now is **`DEBT.md`'s active rows** (`DEBT.md` → "Priority"), and after them
cleaning the repository up to publish it as open source. `DEBT.md` says how to work an item. **One item per commit, a few
per session**, then `/clear`. Its index is the live status; its first row is the next item.
At the author's request its P rows come first: a player's own data sets, added from local
files on the welcome page, played, then published and moderated (`DEBT.md` → "P").

⏸️ **Postponed**, until the author names one: a save of a dungeon the port does not know
(`DEBT.md` G22), CSBWin's debugging features (G14, the ASCII dump), comparing frames
against CSBWin's own screenshots, and the extras (X). No dungeon the port plays needs them.

## Ground rules

1. **The build must stay clean.** `npm run build` runs `tsc && vite build && vite build --ssr`; `tsc --noEmit`
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
- Saves: a save is a CSBWin `.dat` file, all sixteen blocks, written by the game and
  read back as a genuine one is (`doc/CSBWIN_SAVEGAME_REFERENCE.md`). The dialog behind
  the disk icon and at the entrance lists them by playthrough, with LOAD, SAVE, EXPORT
  and an import by a file dropped on the page; F5 and F9, and the Sleepsave
  (`doc/SAVES.md`).
- Three data sets (`src/data/DataSets.ts`: `dm-atari`, the default, `dm-windows` and
  `csb`), one chosen before the boot by `?dungeon=<id>`, which the welcome page's PLAY
  and CONTINUE set; the manifest's `dmRules` gives
  a set without an Extended Features block DM's rules.
- The deployed game, at `https://csbweb.looten.net/`: a Docker container on the author's
  VPS, its server's statistics and their nightly backup (`doc/DEPLOYMENT.md`,
  `doc/STATISTICS.md`).
- The game's page holds nothing beside the canvas (`index.html`): the settings, the map
  and the champions are dialogs drawn in it (`DEBT.md` U). Without a known `?dungeon=`
  the page is the welcome page (`src/ui/welcomePage.ts`), which lists the official
  games first, FTL's own, then the fans' dungeons, the player's own data sets among them (`DEBT.md` P). Its HOW
  TO PLAY, also at `#how-to-play`, is the newcomer's sheet (`src/ui/howToPlay.ts`): the keys as the player's settings
  have them, with a chooser of the presets' moves, the runes in the game's font with the manual's names, the first
  steps and the mouse, and a PDF and a PNG of it to print, for each preset and each label layout, which
  `tools/gen-help-sheet.mjs` makes (the frames' probe fails a sheet changed without them made again). The map dialog's teleport is behind `?dev`, and so is a move down or up a level whatever is there (`Game.devChangeLevel`). The page has no log of its
  own: what it reports goes to the console, a move's position at debug level, what F5,
  F9 or the Sleepsave did at info level.

**Incomplete:**
- Everything in `DEBT.md`: the technical debt, the known divergences from CSBWin, and the
  unported CSBWin features (tier G).

**The evidence.** `npm test` runs `tsc` and every tool listed in `tools/run-checks.mjs`;
`npm test -- --frames` adds the golden frames. There is still no test *framework*:

1. **Golden frames.** `tools/probe-frames.mjs` and `tools/check-frames.sh` drive the real
   app over the DevTools Protocol and compare the screen states in `tools/frames/`. The
   probe reads the 320x200 screen back as its palette slots and the palettes they were
   shown through, and `tools/compare-frames.mjs` compares those, so nothing depends on the
   host machine or on how an Atari colour is shown on the canvas. It also fails a baseline that holds two identical
   frames, so a frame that can no longer fail is caught.
2. **Verification tools.** `tools/run-checks.mjs` is the one list of them; don't copy it
   anywhere. They load the real game files, drive the real engine with a fixed RNG seed,
   print a human-readable table and assert invariants through `tools/lib/check.ts`, whose
   `finish()` also fails a run that made no checks. They are the regression suite for
   everything the frames cannot see. The pattern is in `.claude/skills/verification-tools/`.

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
| 6 | Custom skins / `BACKGROUND_LIB` |
| 7 | UI rendering (faithful DM layout) |
| 7.5 | Light level / palette switching |
| 8 | CSBWin-compatible actuators |
| 8.5 | Teleporter cell actions parity |
| 9 | CSBWin-compatible missiles |
| 9.5 | Skills & experience parity |
| 9.75 | Magic casting parity |
| 10 | CSBWin-compatible save/load, and the save dialog (`doc/SAVES.md`) |
| 11 | Unify the messaging system |
| 12 | Monsters: AI, movement, combat |
| 13 | Champion lifecycle |
| 14 | Structural cleanup |
| 15 | Verification: the test runner, the golden frames, the render probe, the table items round-tripped |
| 16 | Title screen and dungeon entrance |
| 17 | Deployment: the game on the author's VPS (`doc/DEPLOYMENT.md`, `doc/STATISTICS.md`) |
