# DMweb

A TypeScript/Canvas port of **Dungeon Master** (Atari ST), running in the browser.

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
- Documented exceptions exist and are rare — see "Audio sample rates" in
  `doc/PROVEN_FACTS.md`, the one place we knowingly diverge. Don't create new ones silently.

## Where things are written down

| File | Role |
| --- | --- |
| `CLAUDE.md` | This file. High-level orientation only; keep it short. |
| `PLAN.md` | **Authority on detailed project status.** Live phases. |
| `DEBT.md` | **Authority on technical debt**, in payoff order. Paying it off is the current priority. |
| `doc/PLAN_ARCHIVE.md` | Working notes for completed phases. Reference only — read on demand. |
| `doc/CSBWIN_REFERENCE_INDEX.md` | Index of the per-topic CSBWin reference docs. |
| `doc/PROVEN_FACTS.md` | Verified facts with `File.cpp:line` citations. |
| `doc/CSBWIN_SYMBOL_INDEX.tsv` | Every CSBWin symbol → `File.cpp:line`. Grep this before grepping the tree. |
| `NOTES.md` | The author's personal scratchpad. **Do not edit.** Flag problems instead. |
| `doc/CSBwin-src/` | The C++ reference (gitignored, not ours). |

**Documentation contract:** before working on a topic, read its doc. When you verify a new
fact in the C++ source, write it down with a `doc/CSBwin-src/<File>.cpp:<line>` reference.
Only 100%-certain facts go in; speculation stays out. Update `PLAN.md` progress markers as
you go, and **record every deferral** — a phase marked done with silent gaps is worse than
one marked incomplete.
Debt — a deferral from a closed phase, a divergence found along the way — goes in `DEBT.md`.

## Tech stack

Vanilla TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`) + Vite. No framework.
A single 320×200 `<canvas>` is the whole screen, CSS-scaled to 960×600 with
`image-rendering: pixelated`. Everything — viewport, inventory, panels, cursor, messages —
is blitted into one palette-index buffer and converted to RGBA at present time, as CSBWin
does. The HTML controls beside the canvas are dev/debug affordances only.

```bash
npm run dev            # Vite dev server on :9000
npm run build          # tsc && vite build
npm test               # the gate: tsc + every asserting tool  (~6s)
npm test -- --frames   # …and the golden frames               (~12s)
```

**Build hygiene (non-negotiable):** `npm test` must pass before any commit. It runs
`tsc --noEmit` first, which is the real build gate — `vite build` alone will happily
succeed on broken code, because esbuild strips types without checking them, so it proves
nothing. The project once sat with a broken `tsc` for months, and a genuine runtime bug
was hiding among the type errors.

There is still **no test framework** (see `PLAN.md` Phase 15) — `npm test` is a runner
(`tools/run-checks.mjs`) over two standing forms of evidence, and both must pass:

- `tools/check-frames.sh` compares eight live screen states against `tools/frames/` — the
  cheapest way to prove a renderer or UI change kept every pixel. It starts its own dev
  server and headless Chrome, so it needs no setup (on Node 20 it turns on
  `--experimental-websocket` itself; `probe-ui.mjs` needs that flag, or Node 22). It is
  out of the default run only because it costs a browser and ~7s. Run it before any renderer or UI commit. A frame is
  the 320x200 canvas read back as pixels, and the comparison is pixel-wise, so a baseline
  captured on one machine is checkable on another.
- `tools/dump-*.ts` and `tools/watch-*.ts` stand the real engine up against the real game
  files, print what happened, and assert invariants. **They are the regression suite for
  everything the frames cannot see** — tables, AI, damage, timers, movement. `npm test`
  runs every tool **listed** in `tools/run-checks.mjs` — there is no discovery, so a new
  tool is not evidence until it is added there. Run one on its own with
  `npx tsx tools/<name>.ts`.

When porting behaviour that is invisible on screen, write the tool in the same commit.
The `verification-tools` skill in `.claude/skills/` has the pattern, the gotchas, and
the "canary" technique for proving an extracted table sits at the right offset.

`tools/probe-ui.mjs` is the third thing, and it is **not** evidence: it drives the running
app over CDP to read live state, click the canvas and take screenshots, for bugs that only
show up on screen. Use it to find out what is wrong, then prove it in a `dump-*.ts`. The
`playtest-bug` and `probe-app` skills cover the debugging loop those two serve.

## Code layout (`src/`, ~30k LOC)

```
core/       BinaryFile (big-endian cursor), bytes (free byte reads), compression
            (LZW/RLE/SND), imageDecoder (IMG1/IMG2), types (incl. withObjectPosition =
            RN::pos), intCast (sw, div, ApplyLimits), objectNameIndex (OBJNI_* constants)
data/       DungeonLoader, GraphicsLoader, CSBGraphicsLoader, SaveGameLoader, HeroExtractor
engine/     Game, DungeonState, Party, MovementSystem, TimerSystem, TimerQueue,
            ActuatorSystem, DsaSystem, skills, AddCharacter, objectIndex (the one
            DescIndex / GetBasicObjectType / NameIndex)
renderer/   ViewportRenderer (viewport composition only), DrawViewport, ViewportGraphics
  bytecode/ BytecodeInterpreter, BytecodePrograms (168 cell programs), Opcodes
  csbwin/   Runtime table extraction: ViewportTables, UITables, ObjectTables,
            SummarizeRoomInfo, CanvasBlitter, TextRenderer
  intro/    Everything before the party is in the dungeon: the title animation, the
            dungeon entrance, the door animation, the credits scroll. See
            doc/CSBWIN_TITLE_SCREEN_REFERENCE.md.
  ui/       The DM interface, one module per CSBWin file — Mouse, Inventory, Character,
            MagicPanel, Feeding, Objects, Light, Draw, HitTest, ViewportPicking, all over
            a shared UIState. See doc/UI_MODULE_MAP.md.
ui/         DOM-side debug chrome (settings, map preview, log)
dev.ts      Dev-only scaffolding (random party, quick-save, missile scenarios/trace),
            reached only via isDebugFeaturesEnabled()
main.ts     Bootstrap and wiring
```

## Key technical concepts

- **Big-endian everywhere** (Atari ST heritage).
- **Object IDs / RN system**: 16-bit `[position:2][category:4][index:10]`. Objects live in
  per-cell linked chains; all references are indirect through these IDs.
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
- Deleting code that won't survive to the end state is expected — no need to preserve
  intermediate functionality for its own sake.
- **Never `git push`.** Commit freely, but the remote is frequently out of range; pushing is
  the author's call. Ask rather than assume a push is wanted.

## Current state

See `PLAN.md` for the audited detail. In one paragraph: data loading, the bytecode viewport
renderer, movement (stamina, the move delay in ticks, and CSBWin's one mouse queue that
keys and clicks share), timers, actuators, DSA scripting, missiles,
skills/experience, magic casting, light levels, sound, the pre-game screens (Phase 16 —
title, dungeon entrance, doors, credits) and most of the DM UI all work. The message area (Phase 11),
the structural cleanup (Phase 14), **monsters** (Phase 12 — `Monster.cpp`, AI, movement and
combat both ways) and the **champion lifecycle** (Phase 13 — death, bones, the Hall of
Champions, resurrection) are all done. Genuine CSBWin save files **load** (Phase 10 step
12). What is left is the other half of **Phase 10**, *writing* a CSBWin-compatible save;
the **validation debt** (Phase 15, steps 3–5); and the technical debt in `DEBT.md` —
**paying that off is the current priority**, one item per commit, in the order it gives.
