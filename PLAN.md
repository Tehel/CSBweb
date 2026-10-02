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

1. **`DEBT.md`'s active rows**: the unported CSBWin features the default dungeon and
   Chaos Strikes Back reach, and those Conflux 3.5 needs: the indirect `ObjectID`, full
   DSA support, and `CSBgraphics.dat`'s other sections (`DEBT.md` → "Priority"). `DEBT.md` says how
   to work an item. **One item per commit, a few per session**, then `/clear`. Its index is
   the live status; its first row is the next item.
2. Phase 15 step 4 interleaves anywhere.

⏸️ **Postponed until the default dungeon is validated**: a save of a dungeon the port does
not know (`DEBT.md` G22), CSBWin's debugging features (G14, the ASCII dump), and Phase 15
step 5. The retail dungeon uses none of them. Features of **Chaos Strikes
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
- Saves: a save is a CSBWin `.dat` file, all sixteen blocks, written by the game and
  read back as a genuine one is (`doc/CSBWIN_SAVEGAME_REFERENCE.md`). The dialog behind
  the disk icon and at the entrance lists them by playthrough, with LOAD, SAVE, EXPORT
  and an import by a file dropped on the page; F5 and F9 (`doc/SAVES.md`).
- Three data sets (`src/data/DataSets.ts`: `dm-atari`, the default, `dm-windows` and
  `csb`), one chosen before the boot by `?dungeon=<id>`, and the DM Rules toggle.
- Debug scaffolding is the chrome beside the canvas (`src/ui/`): the settings, the map
  preview and the champion panel. Its teleport by a click on the map and its cursor
  filter trace are behind `isDebugFeaturesEnabled()`. It has no log of its own: what
  the page reports goes to the console, a move's position at debug level, what F5 or
  F9 did at info level.

**Incomplete:**
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
| 10 | CSBWin-compatible save/load, and the save dialog (`doc/SAVES.md`) |
| 11 | Unify the messaging system |
| 12 | Monsters: AI, movement, combat |
| 13 | Champion lifecycle |
| 14 | Structural cleanup |
| 16 | Title screen and dungeon entrance |

## Next Steps (Phased)

Only the phases with work left in them.

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
