---
name: one-tick-late-is-ordering
description: A screen state one tick early or late is a hook-ordering bug against CSBWin's MainLoop, not a formula bug
metadata:
  type: feedback
---

When something on screen lags or leads by a tick (a blow shown late, a bad frame on a
level change, the last frame before the credits missing the killing blow), compare the
order of the port's hooks in `Game.runFrame` / `Game.gameTick` with CSBWin's `MainLoop`
(`doc/CSBwin-src/CSBCode.cpp:610-788`) before looking at any computation.

**Why:** the tick's redraw ran at the top of the tick, before `ProcessTimers`, for a long
time unnoticed. Two separate playtest symptoms, and every monster hit a tick late, all
came from that one placement. This is the playtest-bug skill's "suspect the gate, not the
formula" rule, applied to timing.

**How to apply:** list CSBWin's steps (`tag000698` → `LoadPartyLevel` → `ProcessTimers`
→ `DrawViewport` → `d.Time++` …) next to the port's and look for the first place they
differ. See [[redraw-wiring]], [[headless-frame-timing-probe]].
