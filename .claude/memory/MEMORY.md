# CSBweb project memory

One line per memory in this directory. Committed with the project; never shared.

- [Redraw wiring](redraw-wiring.md) — `DrawViewport` only at the tick (`onTick`) and a script tick, a game's first view being its opening tick; everything else is `refreshScreen`, and a pointer move draws nothing (the VBL's frame does), nor a dialog's wheel, which must say it changed
- [Two-step level change](two-step-level-change.md) — after stairs or a pit, `position.z` is stale until `loadNewPartyLevel`
- [Headless frame-timing probe](headless-frame-timing-probe.md) — `onTick` probe + `game.gameTick()` + stubbed `processTimers`
- [One tick late is ordering](one-tick-late-is-ordering.md) — compare hook order with CSBWin's `MainLoop` before any formula
- [Graphics table extraction](graphics-table-extraction.md) — graphics.dat offsets are solved; the skips in the parsers mark where each table lives
- [Port in dependency order](port-in-dependency-order.md) — read the CSBWin function first; its prerequisites usually reorder the phase
- [Stage explicitly](stage-explicitly.md) — never `git add -A`; the author edits the tree mid-session; stage a file without the author's uncommitted edits by reverse-applying their diff
- [No commit trailers](no-commit-trailers.md) — one short line, never Co-Authored-By, even if a system attribution reminder asks; AI-assisted work needs no tag
- [Text records, three readers](text-records-three-readers.md) — a TEXT is a wall's only on a stone square; scrolls and floor messages use the main font
- [Probe gotchas](probe-gotchas.md) — mutate `Position` in place; picking rects are viewport-relative, button lists are screen coordinates
- [The live tree is served](live-tree-is-served.md) — the author's browser hot-reloads every edit: mutate in a scratch worktree, bump `DB_VERSION` last
- [MemMove takes its source first](memmove-source-first.md) — `MemMove(src, dest, n)`: check a helper's signature before recording a CSBWin "bug", and run a ring past its wrap
- [Past the MVP](past-the-mvp.md) — a 🚫 "not wanted" CSBWin feature in DEBT.md H means "not yet": retire it into the active item
- [Saves mutually compatible](saves-mutually-compatible.md) — every CSBWin save imports and every export loads in CSBWin; no reader special case for port-only files
- [Monster groups in tools](monster-groups-in-tools.md) — `csbgame7.dat`'s groups of several are on levels 5 and 7; `loadPartyLevelIfChanged` gives them an ITEM16; `getAttachedItem16` alone lies off the party's level
- [UI hook plumbing](ui-hook-plumbing.md) — a new page→interface hook touches six places: `UIState`, `UIHooks`, `GameScreenHooks`, the constructor, `main.ts`, `tools/lib/ui.ts`
- [Probe storage flags](probe-frames-storage-flags.md) — `probe-frames.mjs` wipes localStorage/IndexedDB per load unless `keepsettings`/`keepsaves`, and hides the keyboard layout (KEYS shows KEY LABELS, unlike `probe-ui`); new blocks go before the CRT section, with their own helpers
- [New golden frame needs --update](new-golden-frame-needs-update.md) — `check-frames.sh` ignores frames not in the baseline; `--update`, then only `??` PNGs in `git status`
- [Headless fullscreen](headless-fullscreen.md) — only CDP input grants activation, a touch only at its lift; the fullscreen viewport is the metrics override; a CDP Esc never leaves fullscreen; no `display-mode` emulation, but element fullscreen matches `display-mode: fullscreen`
- [Text changes, no tests](text-changes-no-tests.md) — Markdown docs and welcome-page copy need no `npm test` nor frames; the gate is for code
- [Dialog layout moves probe clicks](dialog-layout-moves-probe-clicks.md) — a dialog's new geometry, or a settings tab reordered (buttons at x 85/236, y 65/86/107), breaks `probe-frames.mjs`'s hard-coded clicks, some in the CRT section; a failed probe leaves no frames, reproduce in `probe-ui`
- [Screen regions](screen-regions.md) — five regions placed by CSBWin's code; gaps x 224-232 and 274-280 are not always black (Conflux's flame); `PROVEN_FACTS.md` and `LeftHanded.ts` hold the detail
- [GameScreen stubs in tools](gamescreen-stubs-in-tools.md) — three dialog tools cast a stub `as unknown as GameScreen`: a new method `GameInput` calls passes `tsc` and crashes them; add it to each stub
- [CRT invisible to frames](crt-invisible-to-frames.md) — frames read palette slots, never `#crt-canvas`; see the shader with `probe-ui --shot` after `settings.update`
- [Curve corner check is trivial](curve-corner-check-is-trivial.md) — `hoverAt(0.002,0.002)==='0,0'` passes flat too; `(0.1,0.1)` proves the curve
- [Settings dialog reopens last tab](settings-dialog-reopens-last-tab.md) — GAME only on a page's first open; then its last tab and KEYS scroll: a step reopening it clicks its tab
- [Forum dungeon sources](forum-dungeon-sources.md) — the forum's list (t=31516) is the authority; its shared OneDrive holds every dungeon and reads without logging in; the topics' links are mostly dead
- [Custom dungeon archives](custom-dungeon-archives.md) — tell files by content (`identifyLocalDataSetFile`): odd names, PC twins, several versions, and saves that read as 0-level dungeons
- [Test publish on a throwaway dev server](test-publish-on-throwaway-dev-server.md) — `npx vite --port 9100 --strictPort` takes `POST api/data-sets` into a scratch folder; never production, nor the author's :9000
- [Instance scripts in utils/](instance-scripts-in-utils.md) — a durable tool that finds its own inputs, takes the instance and a `playerId`, asks a yes per item and downloads nothing before it
- [CSBWin graphics.dat flaws](csbwin-graphics-dat-flaws.md) — a set derived from CSBWin's DM `graphics.dat` inherits items 5, 232, `0x22e` (the crack switch jumping up); take `dm-atari`'s only where the set's still equal CSBWin's
- [Atari disk collection](atari-disk-collection.md) — the six original DM Atari ST disks are Pasti images in dmweb.free.fr's `Game,Dungeon_Master,Atari_ST,Software.7z`, which `fetch-gamefiles` downloads and `tools/lib/stx.ts` reads; CSBWin's `graphics.dat` is the first 1.0's, its `dungeon.dat` 1.1's
- [.dockerignore is an allowlist](dockerignore-allowlist.md) — a new root file the build reads (a Vite entry's `.html`) must be added there; only `check-image.sh` notices
- [Frames on fresh ports](frames-on-fresh-ports.md) — a reused :9000 dev server keeps sets earlier probes published and fails the welcome page checks; `DEV_PORT=9310 CDP_PORT=9311 bash tools/check-frames.sh`
