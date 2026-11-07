---
name: manual-clock-one-timer
description: the tools' ManualClock keeps one pending setTimeout, a second replacing the first; anything Game schedules must share `loopTimer`
metadata:
  type: project
---

`src/engine/ManualClock.ts`, the clock the tools' pages run the loop on
(`tools/lib/playback.ts`, `standInPage`), holds a single pending call: a second
`setTimeout` replaces the first, and `advance` fires only the latest.

So any new work `Game` schedules shares `loopTimer` with the paced loop. `Game.forward`
does: its slices are `loopTimer`, `gameLoop` returns while it runs, `setPace` only records
the pace then (taken up when it ends), and `stop` clears both.

**Why:** a second timer of its own works in the browser and is silently dropped in
`tools/`, so the evidence would test something else than the page.

**How to apply:** before adding a timer anywhere the loop runs (the engine, the viewer's
player). See [[headless-frame-timing-probe]].
