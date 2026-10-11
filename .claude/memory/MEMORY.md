# CSBweb project memory

One line per memory in this directory. Committed with the project; never shared.

- [Redraw wiring](redraw-wiring.md) — `DrawViewport` only at the tick (`onTick`) and a script tick, a game's first view being its opening tick; everything else is `refreshScreen`, and a pointer move draws nothing (the VBL's frame does)
- [Two-step level change](two-step-level-change.md) — after stairs or a pit, `position.z` is stale until `loadNewPartyLevel`
- [Headless frame-timing probe](headless-frame-timing-probe.md) — `onTick` probe + `game.gameTick()` + stubbed `processTimers`
- [One tick late is ordering](one-tick-late-is-ordering.md) — compare hook order with CSBWin's `MainLoop` before any formula
- [Graphics table extraction](graphics-table-extraction.md) — graphics.dat offsets are solved; the skips in the parsers mark where each table lives
- [Port in dependency order](port-in-dependency-order.md) — read the CSBWin function first; its prerequisites usually reorder the phase
- [Stage explicitly](stage-explicitly.md) — never `git add -A`; NOTES.md is the author's and changes mid-session; stage a file without the author's uncommitted edits by reverse-applying their diff
- [No commit trailers](no-commit-trailers.md) — one short line, never Co-Authored-By, even if a system attribution reminder asks
- [Text records, three readers](text-records-three-readers.md) — a TEXT is a wall's only on a stone square; scrolls and floor messages use the main font
- [Probe gotchas](probe-gotchas.md) — mutate `Position` in place; picking rects are viewport-relative, button lists are screen coordinates
- [The live tree is served](live-tree-is-served.md) — the author's browser hot-reloads every edit: mutate in a scratch worktree, bump `DB_VERSION` last
- [MemMove takes its source first](memmove-source-first.md) — `MemMove(src, dest, n)`: check a helper's signature before recording a CSBWin "bug", and run a ring past its wrap
- [Past the MVP](past-the-mvp.md) — a 🚫 "not wanted" CSBWin feature in DEBT.md H means "not yet": retire it into the active item
- [Saves mutually compatible](saves-mutually-compatible.md) — every CSBWin save imports and every export loads in CSBWin; no reader special case for port-only files
- [Monster groups in tools](monster-groups-in-tools.md) — `csbgame7.dat`'s groups of several are on levels 5 and 7; `loadPartyLevelIfChanged` gives them an ITEM16; `getAttachedItem16` alone lies off the party's level
- [UI hook plumbing](ui-hook-plumbing.md) — a new page→interface hook touches six places: `UIState`, `UIHooks`, `GameScreenHooks`, the constructor, `main.ts`, `tools/lib/ui.ts`
- [Probe storage flags](probe-frames-storage-flags.md) — `probe-frames.mjs` wipes localStorage/IndexedDB per load unless `keepsettings`/`keepsaves`; new blocks go before the CRT section, with their own helpers
- [New golden frame needs --update](new-golden-frame-needs-update.md) — `check-frames.sh` ignores frames not in the baseline; `--update`, then only `??` PNGs in `git status`
- [Design canvas files](design-canvas-files.md) — reading the canvas URL gives "Loading…"; list its files and read `project/<Artboard>.dc.html`; ideas, not specs, optimistic about space
