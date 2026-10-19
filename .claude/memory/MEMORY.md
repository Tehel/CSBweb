# CSBweb project memory

One line per memory in this directory. Committed with the project; never shared.

- [Redraw wiring](redraw-wiring.md) — `DrawViewport` only at the tick (`onTick`) and a script tick, a game's first view being its opening tick; everything else is `refreshScreen`, and a pointer move draws nothing (the VBL's frame does), nor a dialog's wheel, which must say it changed
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
- [Probe storage flags](probe-frames-storage-flags.md) — `probe-frames.mjs` wipes localStorage/IndexedDB per load unless `keepsettings`/`keepsaves`, and hides the keyboard layout (KEYS shows KEY LABELS, unlike `probe-ui`); new blocks go before the CRT section, with their own helpers
- [New golden frame needs --update](new-golden-frame-needs-update.md) — `check-frames.sh` ignores frames not in the baseline; `--update`, then only `??` PNGs in `git status`
- [Design canvas files](design-canvas-files.md) — reading the canvas URL gives "Loading…"; list its files and read `project/<Artboard>.dc.html`; ideas, not specs, optimistic about space
- [Headless fullscreen](headless-fullscreen.md) — only CDP input grants activation, a touch only at its lift; the fullscreen viewport is the metrics override; a CDP Esc never leaves fullscreen; no `display-mode` emulation, but element fullscreen matches `display-mode: fullscreen`
- [Text changes, no tests](text-changes-no-tests.md) — copy-only welcome-page changes need a screenshot, not `npm test` or the frames
- [Dialog layout moves probe clicks](dialog-layout-moves-probe-clicks.md) — a dialog's new geometry, or a settings tab reordered (buttons at x 85/236, y 65/86/107), breaks `probe-frames.mjs`'s hard-coded clicks, some in the CRT section; a failed probe leaves no frames, reproduce in `probe-ui`
- [Screen regions](screen-regions.md) — five regions placed by CSBWin's code; gaps x 224-232 and 274-280 are not always black (Conflux's flame); `PROVEN_FACTS.md` and `LeftHanded.ts` hold the detail
- [GameScreen stubs in tools](gamescreen-stubs-in-tools.md) — three dialog tools cast a stub `as unknown as GameScreen`: a new method `GameInput` calls passes `tsc` and crashes them; add it to each stub
- [Probe party changes dialog cursor](probe-party-changes-dialog-cursor.md) — `BUILD_PARTY` makes the cursor over later dialogs the hand; build a party last on its page
- [CRT invisible to frames](crt-invisible-to-frames.md) — frames read palette slots, never `#crt-canvas`; see the shader with `probe-ui --shot` after `settings.update`
- [Curve corner check is trivial](curve-corner-check-is-trivial.md) — `hoverAt(0.002,0.002)==='0,0'` passes flat too; `(0.1,0.1)` proves the curve
- [Settings dialog reopens last tab](settings-dialog-reopens-last-tab.md) — GAME only on a page's first open; then its last tab and KEYS scroll: a step reopening it clicks its tab
- [Forum dungeon sources](forum-dungeon-sources.md) — the forum's list (t=31516) is the authority; its shared OneDrive holds every dungeon and reads without logging in; the topics' links are mostly dead
- [Custom dungeon archives](custom-dungeon-archives.md) — tell files by content (`identifyLocalDataSetFile`): odd names, PC twins, several versions, and saves that read as 0-level dungeons
- [Test publish on a throwaway dev server](test-publish-on-throwaway-dev-server.md) — `npx vite --port 9100 --strictPort` takes `POST api/data-sets` into a scratch folder; never production, nor the author's :9000
- [Instance scripts in utils/](instance-scripts-in-utils.md) — a durable tool that finds its own inputs, takes the instance and a `playerId`, asks a yes per item and downloads nothing before it
- [Theron's Quest conversion](theron-quest-conversion.md) — one release in three formats; Theron unrecruitable and item 5 undecodable as published; patched copies in `archive/CustomDungeon-TheronsQuestConversion-csbweb/`
- [CSBWin graphics.dat flaws](csbwin-graphics-dat-flaws.md) — a set derived from CSBWin's DM `graphics.dat` inherits items 5, 232, `0x22e` (the crack switch jumping up); take `dm-atari`'s only where the set's still equal CSBWin's
- [Theron merged quest design](theron-merged-quest-design.md) — seven stages, a hub, corridors with the intros, ways back behind each arrival, DM rules; built by `tools/build-theron-quest.ts` (the object index: ~1,100 actuators); its `CSBgraphics.dat` holds the stages' pictures (behind open doors) and name plaques, wall decorations from L_ghthouse's RTC PNGs
- [Atari disk collection](atari-disk-collection.md) — the six original DM Atari ST disks as Pasti images in `archive/Game,Dungeon_Master,Atari_ST,Software/`, each disk's files in its `extracted/<version>/`; CSBWin's `graphics.dat` is the first 1.0's, its `dungeon.dat` 1.1's
