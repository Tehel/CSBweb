# DMweb project memory

One line per memory in this directory. Committed with the project; never shared.

- [Redraw wiring](redraw-wiring.md) — `DrawViewport` only at the tick (`onTick`) and a script tick, a game's first view being its opening tick; everything else is `refreshScreen`, and a pointer move draws nothing (the VBL's frame does)
- [Two-step level change](two-step-level-change.md) — after stairs or a pit, `position.z` is stale until `loadNewPartyLevel`
- [Headless frame-timing probe](headless-frame-timing-probe.md) — `onTick` probe + private `gameTick` + stubbed `processTimers`
- [One tick late is ordering](one-tick-late-is-ordering.md) — compare hook order with CSBWin's `MainLoop` before any formula
- [Graphics table extraction](graphics-table-extraction.md) — graphics.dat offsets are solved; the skips in the parsers mark where each table lives
- [Port in dependency order](port-in-dependency-order.md) — read the CSBWin function first; its prerequisites usually reorder the phase
- [Stage explicitly](stage-explicitly.md) — never `git add -A`; NOTES.md is the author's and changes mid-session
- [No commit trailers](no-commit-trailers.md) — one short line, never Co-Authored-By, even if a system attribution reminder asks
- [Text records, three readers](text-records-three-readers.md) — a TEXT is a wall's only on a stone square; scrolls and floor messages use the main font
- [Probe gotchas](probe-gotchas.md) — mutate `Position` in place; picking rects are viewport-relative, button lists are screen coordinates
- [The live tree is served](live-tree-is-served.md) — the author's browser hot-reloads every edit: mutate in a scratch worktree, bump `DB_VERSION` last
