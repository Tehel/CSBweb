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
| `PLAN.md` | **Authority on detailed project status.** Live phases + carried-over debt. |
| `doc/PLAN_ARCHIVE.md` | Working notes for completed phases. Reference only — read on demand. |
| `doc/CSBWIN_REFERENCE_INDEX.md` | Index of the per-topic CSBWin reference docs. |
| `doc/PROVEN_FACTS.md` | Verified facts with `File.cpp:line` citations. |
| `NOTES.md` | The author's personal scratchpad. **Do not edit.** Flag problems instead. |
| `doc/CSBwin-src/` | The C++ reference (gitignored, not ours). |

**Documentation contract:** before working on a topic, read its doc. When you verify a new
fact in the C++ source, write it down with a `doc/CSBwin-src/<File>.cpp:<line>` reference.
Only 100%-certain facts go in; speculation stays out. Update `PLAN.md` progress markers as
you go, and **record every deferral** — a phase marked done with silent gaps is worse than
one marked incomplete.

## Tech stack

Vanilla TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`) + Vite. No framework.
A single 320×200 `<canvas>` is the whole screen, CSS-scaled to 960×600 with
`image-rendering: pixelated`. Everything — viewport, inventory, panels, cursor, messages —
is blitted into one palette-index buffer and converted to RGBA at present time, as CSBWin
does. The HTML controls beside the canvas are dev/debug affordances only.

```bash
npm run dev       # Vite dev server on :9000
npm run build     # tsc && vite build
npx tsc --noEmit  # the real gate — see below
```

**Build hygiene (non-negotiable):** `tsc --noEmit` must pass with zero errors before any
commit. `vite build` alone will happily succeed on broken code, because esbuild strips types
without checking them — so it proves nothing. The project once sat with a broken `tsc` for
months, and a genuine runtime bug was hiding among the type errors.

There is **no test framework** yet (see `PLAN.md` Phase 15), but there are now two
standing forms of evidence, and both must pass before a commit:

- `tools/check-frames.sh` byte-compares five live screen states against `tools/frames/`.
  The cheapest way to prove a renderer or UI change kept every pixel.
- `tools/dump-*.ts` and `tools/watch-*.ts` (run with `npx tsx`) stand the real engine up
  against the real game files, print what happened, and assert invariants. **They are the
  regression suite for everything the frames cannot see** — tables, AI, damage, timers,
  movement. Re-run all of them, not just the one you are working on.

When porting behaviour that is invisible on screen, write the tool in the same commit.
The `verification-tools` skill in `.claude/skills/` has the pattern, the gotchas, and
the "canary" technique for proving an extracted table sits at the right offset.

## Code layout (`src/`, ~30k LOC)

```
core/       BinaryFile (big-endian), compression (LZW/RLE/SND), imageDecoder (IMG1/IMG2),
            types, objectNameIndex (shared OBJNI_* constants)
data/       DungeonLoader, GraphicsLoader, CSBGraphicsLoader, SaveGameLoader, HeroExtractor
engine/     Game, DungeonState, Party, MovementSystem, TimerSystem, TimerQueue,
            ActuatorSystem, DsaSystem, skills, AddCharacter
renderer/   ViewportRenderer (viewport composition only), DrawViewport, ViewportGraphics
  bytecode/ BytecodeInterpreter, BytecodePrograms (168 cell programs), Opcodes
  csbwin/   Runtime table extraction: ViewportTables, UITables, ObjectTables,
            SummarizeRoomInfo, CanvasBlitter, TextRenderer
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

## Conventions

- Commits: **single short line, no JIRA prefix, no trailers** (e.g. `Pits on ceiling`).
  This overrides the global `JIRA-XXX` convention.
- Deleting code that won't survive to the end state is expected — no need to preserve
  intermediate functionality for its own sake.
- **Never `git push`.** Commit freely, but the remote is frequently out of range; pushing is
  the author's call. Ask rather than assume a push is wanted.

## Current state

See `PLAN.md` for the audited detail. In one paragraph: data loading, the bytecode viewport
renderer, movement, timers, actuators, DSA scripting, missiles, skills/experience, magic
casting, light levels, sound and most of the DM UI all work. The message area (Phase 11) and
the structural cleanup (Phase 14) are done — the UI now lives in `src/renderer/ui/`, one
module per CSBWin file. The largest gaps are **no monsters at all** (`Monster.cpp` unported
— Phase 12, the current priority), no champion death/creation (Phase 13), and the validation
debt (Phase 15).
