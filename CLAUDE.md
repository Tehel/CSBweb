# DMweb

A TypeScript/Canvas port of **Dungeon Master** (Atari ST), running in the browser.

Project memory index: @.claude/memory/MEMORY.md

## The one non-negotiable rule

`doc/CSBwin-src/` (Paul R. Stevens' C++ port of the disassembled original, ~120k LOC) is the
**authoritative specification**. Every behaviour must mirror it — same order of operations,
same magic numbers, same edge cases. When our code, our docs, or intuition disagree with
CSBWin, CSBWin wins.

Corollaries:

- **Never guess.** If a table, offset, rectangle or formula is not read from the game data
  files or transcribed from CSBWin, it is a placeholder and must be marked as one.
- **Port, don't reinvent.** Prefer a mechanical, line-by-line translation of the C++ over a
  "cleaner" rewrite, and keep CSBWin's function names (`SummarizeRoomInfo`,
  `ProcessMissileEncounter`, `AdjustSkills`, …) so the two codebases stay greppable against
  each other. Even CSBWin's own typos are preserved where they are identifiers
  (e.g. `TT_DESSAGE`).
- Tables must be extracted at runtime from `graphics.dat` / `dungeon.dat`, never hardcoded.
- Documented exceptions exist and are rare — see "Audio sample rates" and
  "`dm-atari/graphics.dat` is CSBWin's with three items from the 1.2 disk" in
  `doc/PROVEN_FACTS.md`, the two places we knowingly diverge (listed under `DEBT.md` H).
  Don't create new ones silently.

## Where things are written down

| File | Role |
| --- | --- |
| `CLAUDE.md` | This file. High-level orientation only; keep it short. |
| `PLAN.md` | **Authority on detailed project status.** Live phases. |
| `DEBT.md` | **Authority on technical debt**, in payoff order. Paying it off is the current priority. |
| `doc/PLAN_ARCHIVE.md` | Working notes of the phases and debt items closed up to 2026-09-26. **Frozen**, reference only — read on demand. |
| `doc/CSBWIN_REFERENCE_INDEX.md` | Index of the per-topic CSBWin reference docs. |
| `doc/PROVEN_FACTS.md` | Verified facts with `File.cpp:line` citations. |
| `doc/SAVES.md` | The port's own save design: the store, the playthrough, the dialog, F5 and F9. |
| `doc/CSBWIN_SYMBOL_INDEX.tsv` | Every CSBWin symbol → `File.cpp:line`. Grep this before grepping the tree. |
| `NOTES.md` | The author's personal scratchpad. **Do not edit.** Flag problems instead. |
| `doc/CSBwin-src/` | The C++ reference (gitignored, not ours). |

**Documentation contract:** before working on a topic, read its doc. When you verify a new
fact in the C++ source, write it down with a `doc/CSBwin-src/<File>.cpp:<line>` reference.
Only 100%-certain facts go in; speculation stays out. Update `PLAN.md` progress markers as
you go, and **record every deferral** — a phase marked done with silent gaps is worse than
one marked incomplete.
Debt — a deferral from a closed phase, a divergence found along the way — goes in `DEBT.md`.

**Write down the present, not the past.** Every document here describes the project as it
is now: what works, what is left, the rules and the reasons for them. None of them narrates
how the project got there: no "fixed in `abc1234`", "used to", "since 2026-09-25", "found
while paying C21", and no progress logs. When something changes, rewrite the text to say
the new state rather than adding to it, and delete what is finished. History belongs in a
document only as the reason for a rule that still holds (the ray-casting false start, the
months of broken `tsc`). The record of what happened is `git log`: a commit message names
its phase step or debt ID, so `git log --grep C33` finds the work. `doc/PLAN_ARCHIVE.md`
keeps what it has, and nothing new goes in.

## Tech stack

Vanilla TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`) + Vite. No framework.
A single 320×200 `<canvas>` is the whole screen, CSS-scaled to 960×600 with
`image-rendering: pixelated`. Everything — viewport, inventory, panels, cursor, messages —
is blitted into one palette-index buffer and converted to RGBA at present time, as CSBWin
does. The HTML controls beside the canvas are dev/debug affordances only.

```bash
npm run dev            # Vite dev server on :9000
npm run build          # tsc && vite build
npm test               # the gate: tsc + every asserting tool  (~80s, DEBT.md F13)
npm test -- --frames   # …and the golden frames               (~40s more)
```

**Build hygiene (non-negotiable):** `npm test` must pass before any commit. It runs
`tsc --noEmit` first, which is the real build gate — `vite build` alone will happily
succeed on broken code, because esbuild strips types without checking them, so it proves
nothing. The project once sat with a broken `tsc` for months, and a genuine runtime bug
was hiding among the type errors.

There is still **no test framework** (see `PLAN.md` Phase 15) — `npm test` is a runner
(`tools/run-checks.mjs`) over two standing forms of evidence, and both must pass:

- `tools/check-frames.sh` compares fourteen live screen states against `tools/frames/` — the
  cheapest way to prove a renderer or UI change kept every pixel. It starts its own dev
  server and headless Chrome, so it needs no setup (on Node 20 it turns on
  `--experimental-websocket` itself; `probe-ui.mjs` needs that flag, or Node 22). It is
  out of the default run only because it costs a browser and ~40s. Run it before any renderer or UI commit. A frame is
  the 320x200 canvas read back as pixels, and the comparison is pixel-wise, so a baseline
  captured on one machine is checkable on another. The probe also asserts on the spot what
  no frame shows: the CRT effect, which needs a Chrome that gives WebGL, the wheel
  and the keys reaching a save menu, at the entrance as in play, the download its
  EXPORT starts, and a file dropped on it.
- `tools/dump-*.ts` and `tools/watch-*.ts` stand the real engine up against the real game
  files, print what happened, and assert invariants. **They are the regression suite for
  everything the frames cannot see** — tables, AI, damage, timers, movement. `npm test`
  runs every tool **listed** in `tools/run-checks.mjs` — there is no discovery, so a new
  tool is not evidence until it is added there. Run one on its own with
  `npx tsx tools/<name>.ts`. A tool builds its `Game` (or a bare `GameContext`) through
  `tools/lib/game.ts`, so it gets every table `main.ts` does, and finds a genuine CSBWin
  save through `tools/lib/saves.ts`, in `tools/fixtures/`.

When porting behaviour that is invisible on screen, write the tool in the same commit.
The `verification-tools` skill in `.claude/skills/` has the pattern, the gotchas, and
the "canary" technique for proving an extracted table sits at the right offset.

`tools/probe-ui.mjs` is the third thing, and it is **not** evidence: it drives the running
app over CDP to read live state, click the canvas and take screenshots, for bugs that only
show up on screen. Use it to find out what is wrong, then prove it in a `dump-*.ts`. The
`playtest-bug` and `probe-app` skills cover the debugging loop those two serve.
`tools/peek-dungeon.ts` is the other thing that is not evidence: it prints what the data
holds. That can be a level as an ASCII map, one square's flags and objects, or where an
item or monster is, read from `dungeon.dat` or a save. The `peek-dungeon` skill covers it.

## Code layout (`src/`, ~55k LOC)

```
audio/      SoundManager (the samples, played through Web Audio) and soundsIndex
core/       BinaryFile (big-endian cursor), bytes (free byte reads), compression
            (LZW/RLE/SND), imageDecoder (IMG1/IMG2), types (incl. withObjectPosition =
            RN::pos), intCast (sw, div, ApplyLimits), objectNameIndex (OBJNI_* constants)
data/       DungeonLoader, GraphicsLoader, CSBGraphicsLoader, SaveGameLoader, HeroExtractor,
            HintOracleLoader (CSB's `hcsb.hct`)
  saves/    The saves behind the disk icon: SaveStore (a save's row, the CSBWin file
            beside what a list needs), BrowserSaveStore (IndexedDB, the one store),
            legacyRows (the store's upgrade from its first version), downloadSaveFile
            (the save menu's EXPORT)
  tables/   Runtime table extraction from graphics.dat: ObjectTables, UITables,
            ViewportTables, MonsterDesc, and GraphicsTables (all of them, read once)
engine/     Game, GameContext (what every subsystem shares, CSBWin's `d.`), GameHost (what
            the engine asks of the page), GameTables (every graphics.dat table, one
            builder), DungeonState, Party, MovementSystem, TimerSystem, TimerQueue,
            WorldMove (the world `MoveObject`: teleporters, pits, stairs),
            MissileEncounter (a missile meeting something, and the clouds and door
            blows it sets off),
            ActuatorSystem, DsaSystem, MagicSystem, CharacterSystem, AttackSystem,
            MouseSystem (Mouse.cpp's engine half), HallOfChampions, the Monster* systems,
            MouseQueue and LoopState (the loop's `d.` state, at `ctx.mouseQueue` /
            `ctx.loop`), PeriodicUpdates (the ninety- and ten-second updates), LightLevel
            (`SelectPaletteForLightLevel`: `d.CurrentPalette`),
            SmartDiscard (thinning a filling database), MakeMoreRoomInDB (making
            room in a full one),
            RuntimeSave (the state a read restores), SaveGameFile (the CSBWin file a
            save is, written from the game and read back), GameSaves (a save built and
            written to the store, or read back: the disk menu's, the boot's and F5/F9's),
            skills, AddCharacter, objectIndex
            (the one DescIndex / GetBasicObjectType / NameIndex)
renderer/   GameScreen (the 320x200 screen, host of the UI and its modal screens),
            GameInput (where a click or a key goes once the page has read it),
            ViewportRenderer (the dungeon view only), DrawViewport, ViewportGraphics
  bytecode/ BytecodeInterpreter, ViewportDraw (what the drawing shares with it),
            DrawDecorations and DrawDoor (CSBCode.cpp's drawing), DrawRoomObjects
            (Code51a4.cpp's: objects, monsters, missiles, clouds), BytecodePrograms
            (168 cell programs), Opcodes
  csbwin/   SummarizeRoomInfo, CanvasBlitter, TextRenderer, ScrollingText
  intro/    Everything before the party is in the dungeon: the title animation, the
            dungeon entrance, the door animation, the credits scroll. And the end of
            the game (`ShowCredits`), on the same host. See
            doc/CSBWIN_TITLE_SCREEN_REFERENCE.md.
  ui/       The DM interface, one module per CSBWin file — Mouse, Inventory, Character,
            MagicPanel, Feeding, Objects, Draw, HitTest, ViewportPicking, all over
            a shared UIState. See doc/UI_MODULE_MAP.md.
ui/         DOM-side debug chrome (settings, map preview, champion panel), and saveDrop
            (the save menu's import: a file dropped on the page)
lib/        glfx (the CRT effect's WebGL) and its loader
main.ts     Bootstrap and wiring
```

## Key technical concepts

- **Big-endian everywhere** (Atari ST heritage).
- **Object IDs / RN system**: 16-bit `[position:2][category:4][index:10]`. Objects live in
  per-cell linked chains; all references are indirect through these IDs. "No object" is
  `RNnul` (`OBJECT_ID_NULL`, 0xFFFF) in every stored slot and the cursor, and what every
  possession reader returns for an empty slot, as in CSBWin;
  `RNeof` (0xFFFE) only ends a chain. `tsc` cannot catch a stale `=== null` against a
  `number`, so a change to an empty value is audited by grep, reader by reader.
  `ObjectID` is a branded type, as CSBWin's `RN` is a class: a plain number becomes one
  only through `as ObjectID`, and only where CSBWin converts (a file's word, a timer word,
  a DSA word after `isValidObjectId`, the `RNVAL` constants in `core/spellRn.ts`). Retype
  the variable before adding a cast anywhere else.
- **Cell flags**: 8-bit `[roomType:3][hasObjects:1][attributes:4]`.
- **Text**: 5-bit chars, 3 per 16-bit word. **Colours**: Atari 12-bit `0RGB`, ×36 → 8-bit.
- **Rendering is NOT ray-casting.** 21 fixed relative cells; each (cell × roomType) pair
  selects one of 168 **bytecode programs** run on a stack machine, which blit pre-rendered
  bitmaps into fixed screen rectangles read from `graphics.dat` item `0x22e`.
  (An early version of this project assumed Wolfenstein-style ray-casting and had to be
  thrown away — research the actual implementation before assuming an architecture.)
- **Timing**: 60 Hz VBL loop, 4 game ticks/sec; a timer queue with CSBWin's duplicate-timer
  suppression drives doors, missiles, actuators, spells and (eventually) monsters.

## Working economically

A session is priced at roughly `tool calls × context size`, and context only grows, so the
cost of a session is **quadratic in the number of round trips**. Measured on this project:
the last quarter of a 211-call session cost 4.4× what the first quarter did. Long sessions
are the expensive thing, not hard questions. So:

- **One topic per session.** After a commit, `/clear`. Three bugs in one context cost about
  twice what the same three bugs cost in three contexts.
- **Batch independent tool calls** into a single message. Two greps that do not depend on
  each other should never be two round trips.
- **Read wide once, not narrow many times.** One `sed -n '1,400p'` beats eight `sed -n`
  peeks at the same file: every peek re-sends the whole conversation.
- **Consult `doc/CSBWIN_SYMBOL_INDEX.tsv` before grepping `doc/CSBwin-src/`.** One
  `grep -P '^SummarizeRoomInfo\t'` replaces a grep of 120k lines plus the two peeks that
  usually follow it. Regenerate with `node tools/gen-csbwin-index.mjs` if the tree changes.
- **Delegate open-ended C++ searches to an `Explore` subagent** — "where does CSBWin decide
  a missile has hit?" — and keep the ten greps and their output out of the main context.
  This is a deliberate exception to the default of not spawning agents. Do it for *search*,
  never for judgement: the subagent reports where the code is, and the porting decision is
  still made here, against the source.

Don't trade faithfulness for economy. Re-reading CSBWin to get a magic number right is
always worth it; re-reading the same file for the fifth time because the first four peeks
were three lines each is not.

## Conventions

- Commits: **single short line, no JIRA prefix, no trailers** (e.g. `Pits on ceiling`).
  This overrides the global `JIRA-XXX` convention.
- Imports name the module by relative path (`'../core/types'`). The only barrels are
  `src/ui/index.ts` and `src/data/saves/index.ts`, the public faces of the debug chrome
  and the save store.
- The engine and the loaders do not log: a diagnostic goes to `GameHost.trace`, which a
  tool prints and the page leaves silent.
- Deleting code that won't survive to the end state is expected — no need to preserve
  intermediate functionality for its own sake.
- **Never `git push`.** Commit freely, but the remote is frequently out of range; pushing is
  the author's call. Ask rather than assume a push is wanted.

## Current state

See `PLAN.md` for the detail. Working: data loading, the bytecode viewport renderer,
movement (stamina, the move delay in ticks, and CSBWin's one mouse queue that keys and
clicks share), timers, actuators, DSA scripting, missiles and clouds, skills/experience,
magic casting, light levels, worn-object bonuses, sound, the message area, monsters
(`Monster.cpp`: AI, movement and combat both ways), the champion lifecycle (the Hall of
Champions, death, bones, resurrection), sleep, the pre-game screens (title, dungeon
entrance, doors, credits) and most of the DM UI. Genuine CSBWin save files load, and a
save of the port's is such a file, all sixteen blocks, and nothing else; the dialog
behind the disk icon lists them by playthrough, and exports and imports them
(`doc/SAVES.md`). **The current priority is a complete
game on the default dungeon**: `DEBT.md`'s active rows, one item per commit (the unported
features the retail dungeon reaches). DSA extensibility, CSBWin's custom-dungeon and debugging extras, and comparing
frames with CSBWin's are postponed until the default dungeon is validated; Chaos Strikes
Back's own features are not. The first row of `DEBT.md`'s index is the next item, and
`/pay-debt` starts a session on it.
