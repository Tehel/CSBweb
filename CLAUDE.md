# CSBweb

A TypeScript/Canvas port of **Dungeon Master** (Atari ST), running in the browser.

Project memory index: @.claude/memory/MEMORY.md

## The one non-negotiable rule

`doc/CSBwin-src/` (Paul R. Stevens' C++ port of the disassembled original, ~120k LOC, his
last source, CSBWin 20230608) is the **authoritative specification**. Every behaviour must
mirror it — same order of operations, same magic numbers, same edge cases. When our code,
our docs, or intuition disagree with CSBWin, CSBWin wins.

It is followed faithfully, not blindly. When CSBWin is **obviously wrong** — a slip of its
own translation, such as a byte offset read as a word index, or a bug that costs the
player something the game means to give (a hint, an item, a message) — the port does the
right thing instead. "Obviously" is earned: cite both readings, and rule out a misread
helper first (`.claude/memory/memmove-source-first.md`). Each such fix is a deliberate
divergence, listed under `DEBT.md` H with its proof.

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
  `doc/PROVEN_FACTS.md`, and the rest of `DEBT.md` H.
  Don't create new ones silently.

## Where things are written down

| File | Role |
| --- | --- |
| `CLAUDE.md` | This file. High-level orientation only; keep it short. |
| `PLAN.md` | **Authority on detailed project status.** Live phases. |
| `DEBT.md` | **Authority on technical debt**, in payoff order. Paying it off is the current priority. |
| `doc/PLAN_ARCHIVE.md` | Working notes of the phases and debt items closed up to 2026-09-26. **Frozen**, reference only — read on demand. Its CSBWin citations are mapped to 2023 lines by script, unreviewed. |
| `doc/CSBWIN_REFERENCE_INDEX.md` | Index of the per-topic CSBWin reference docs. |
| `doc/PROVEN_FACTS.md` | Verified facts with `File.cpp:line` citations. |
| `doc/SAVES.md` | The port's own save design: the store, the playthrough, the dialog, F5 and F9. |
| `doc/DEPLOYMENT.md` | The deployed game: the server, the image, the VPS, deploying and backups. `doc/STATISTICS.md`: what it counts. |
| `doc/CSBWIN_SYMBOL_INDEX.tsv` | Every CSBWin symbol → `File.cpp:line`. Grep this before grepping the tree. |
| `NOTES.md` | The author's personal scratchpad. **Do not edit.** Flag problems instead. |
| `doc/CSBwin-src/` | The C++ reference (not ours, committed as published): `CSBwin_SRC_20230608`, CSBWin's last source and the build the author plays. |

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
does. The game's page holds nothing beside the canvas: the settings, the map and the
champions are dialogs drawn in it. Without a known `?dungeon=`, the page is the welcome
page instead, HTML where the player chooses a game (`src/ui/welcomePage.ts`).

```bash
npm run dev            # Vite dev server on :9000
npm run build          # tsc && vite build, and the server's module (--ssr)
npm test               # the gate: tsc + every asserting tool  (~75s, a worker per core)
npm test -- --only=dsa,save  # tsc + the tools whose name holds any of these
npm test -- --frames   # …and the golden frames               (~40s more)
npm start              # the deployed server, server/, over dist/  (Node >= 22.18)
bash tools/check-image.sh  # the golden frames against the Docker image (Docker, ~2 min)
```

**Build hygiene (non-negotiable):** `npm test` must pass before any commit. It runs
`tsc --noEmit` first, which is the real build gate — `vite build` alone will happily
succeed on broken code, because esbuild strips types without checking them, so it proves
nothing. The project once sat with a broken `tsc` for months, and a genuine runtime bug
was hiding among the type errors.

There is still **no test framework** (`PLAN.md` → "The evidence") — `npm test` is a runner
(`tools/run-checks.mjs`) over two standing forms of evidence, and both must pass:

- `tools/check-frames.sh` compares twenty-eight live screen states against `tools/frames/` — the
  cheapest way to prove a renderer or UI change kept every pixel. It starts its own dev
  server and headless Chrome, so it needs no setup (on Node 20 it turns on
  `--experimental-websocket` itself; `probe-ui.mjs` needs that flag, or Node 22). It is
  out of the default run only because it costs a browser and ~40s. Run it before any renderer or UI commit. A frame is
  the 320x200 screen as CSBWin draws it, its palette slots and the palettes they were shown
  through (`tools/lib/frames.mjs`), not the canvas's colours: a slot drawn for another of
  the same colour fails, and a baseline captured on one machine is checkable on another. The probe also asserts on the spot what
  no frame shows: the CRT effect, which needs a Chrome that gives WebGL, the wheel
  and the keys reaching a save menu, at the entrance as in play, a move of the pointer
  painting nothing until the VBL's frame, the download its EXPORT starts, a file
  dropped on it, a finger on a touch screen: a tap one click, the eye held while it
  is down, and the eye let go by a mouse released off the canvas; and the settings dialog
  opened by Esc and by a double click, the clock held under it, a setting kept across a
  reload, its slider dragged off the canvas, and its EXIT leading to the welcome
  page, the map dialog opened by a long
  press, and only with MAP VIEW on, the champion dialog opened by a long press on
  the stat bars, where a tap opens the inventory at its release, and fullscreen, entered
  by a tap and by a click, the screen and the effect sized and centred in it, at 16:10
  and at 4:3; and the welcome page's tiles, its fonts, its selection, where PLAY and
  CONTINUE lead, CONTINUE's save read straight into play, and the form that adds a set,
  and edits, publishes and deletes one.
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
            (LZW/RLE/SND), imageDecoder (IMG1/IMG2), md5, png (a paletted PNG, written),
            types, RnMaps (what an RN names: RN::dbType, pos, idx), intCast (sw, div,
            ApplyLimits), objectNameIndex (OBJNI_* constants)
data/       DataSets (the manifest's sets), LocalDataSets (a player's own, a record of the
            store's), DataSetFiles (a set's files read by name, from its folder or its record),
            DungeonLoader, GraphicsLoader, CSBGraphicsLoader, SaveGameLoader, HeroExtractor,
            HintOracleLoader (CSB's `hcsb.hct`), SwooshLoader (the Atari disk's `swoosh.img`),
            UtilityPortraits (the CSB utility disk's faces, RISE's NEW FACE)
  saves/    The saves behind the disk icon: SaveStore (a save's row, the CSBWin file
            beside what a list needs), BrowserSaveStore (IndexedDB, the one store),
            legacyRows (the store's upgrade from its first version), downloadSaveFile
            (the save menu's EXPORT), BrowserDataSetStore (the player's own data sets, in
            the same database)
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
            Chaos (the UTILITY's "MAKE NEW ADVENTURE": a saved game's party into
            `mini.dat`), FileSignatures (the graphics files checked against what a
            read names), DungeonCensus (what a dungeon holds: its items, monsters and
            DSAs, counted), Die (CSBWin's `die`), RelativeXY (a square counted in steps
            through `d.DeltaX`), skills, AddCharacter, objectIndex
            (the one DescIndex / GetBasicObjectType / NameIndex)
renderer/   GameScreen (the 320x200 screen, host of the UI and its modal screens),
            GameInput (where a click or a key goes once the page has read it),
            ViewportRenderer (the dungeon view only), DrawViewport, ViewportGraphics
  bytecode/ BytecodeInterpreter, ViewportDraw (what the drawing shares with it),
            DrawDecorations and DrawDoor (CSBCode.cpp's drawing), DrawRoomObjects
            (Code51a4.cpp's: objects, monsters, missiles, clouds), ApplyBackground (a
            skin's own graphics, on the viewport as Atari planar bytes), BytecodePrograms
            (168 cell programs), Opcodes
  csbwin/   SummarizeRoomInfo, CanvasBlitter, TextRenderer, ScrollingText
  intro/    Everything before the party is in the dungeon: the title animation, the
            dungeon entrance, the door animation, the credits scroll. And the end of
            the game (`ShowCredits`), on the same host. See
            doc/CSBWIN_TITLE_SCREEN_REFERENCE.md. Before the title, the
            Atari disk's FTL logo (`Swoosh`, doc/ATARI_ST_DISK_REFERENCE.md). And CSB's
            Hint Oracle (`HintOracle`), a program of its own in CSBWin
            (doc/CSBWIN_HINT_ORACLE_REFERENCE.md). And a set's thumbnail, its title's last
            frame (`TitleThumbnail`), which the welcome page shows.
  ui/       The DM interface, one module per CSBWin file — Mouse, Inventory, Character,
            MagicPanel, Feeding, Objects, Draw, HitTest, ViewportPicking, all over
            a shared UIState. See doc/UI_MODULE_MAP.md.
ui/         The page's DOM side: events (the canvas's and the keyboard's listeners,
            handing over to `GameInput`), saveDrop
            (the save menu's import: a file dropped on the page), fatalMessage (the
            screen an error that ends the game leaves), and gameEvents (what the
            server's statistics are told: a game started, joined, won or lost), and
            welcomePage (the page without a known `?dungeon=`: the games and the saves)
            and addDataSetForm (its form that adds, edits, publishes and deletes a player's own data set)
settings/   Settings: the player's settings, one model the page, the game and the dialogs
            read and change, kept in `localStorage`
lib/        crt (the CRT effect: a WebGL tube over the canvas, and the pointer read through it),
            fullscreen (`#game` at the largest whole multiple of 320x200, Esc locked)
main.ts     Bootstrap and wiring
```

## Key technical concepts

- **Big-endian everywhere** (Atari ST heritage).
- **Object IDs / RN system**: an RN is CSBWin's 16-bit slot of `dataTypeMap`/
  `dataIndexMap`, its world's `RnMaps` (`DungeonState.rnMaps`: `dbType`, `pos`, `idx`,
  `setPos`, `rn`), which say its database, record and corner. Objects live in per-cell
  linked chains of RNs. `setPos` moves the object in the map and keeps the RN, so two
  RNs are the same object exactly when they are equal. Only `dungeon.dat` stores RNs
  packed, `[position:2][category:4][index:10]`, and its reader numbers them into slots
  as CSBWin does; a save's slots and maps are kept as read. "No object" is
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
features the retail dungeon reaches, and the DSA's open bugs). Every DSA operation and the
indirect `&ADD`/`&DEL` are ported. Players' own data sets come first (`DEBT.md` P). CSBWin's debugging extras, a save of an unknown dungeon, and comparing
frames with CSBWin's are postponed until the default dungeon is validated; Chaos Strikes
Back's own features are not. The first row of `DEBT.md`'s index is the next item, and
`/pay-debt` starts a session on it.
