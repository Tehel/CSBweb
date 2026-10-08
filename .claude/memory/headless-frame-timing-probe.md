---
name: headless-frame-timing-probe
description: Testing which state a tick's frame sees, without a browser — onTick as probe, game.gameTick(), stubbed processTimers
metadata:
  type: project
---

Frame-timing bugs can be tested headlessly. `tools/check-frames.sh` cannot see them: a
golden frame is one still screen state, not the order of things inside a tick.

- Register `game.onTick(...)` and record what the frame would see (party position,
  `ctx.loop.newPartyLevel`, `party.state.gameIsLost`, `mainLoopHasReturned()`).
- Run one tick with `game.gameTick()`, public for the tools.
- To make something happen *inside the timers* (a monster's blow, a pit opening), replace
  `game.systems.timer.processTimers` with a stub that does it and returns `false`.

Examples: `tools/dump-stairs-move.ts` case 6 (the level change) and the last case of
`tools/dump-champion-death.ts` (the killing blow is drawn before the game ends).

**How to apply:** use this for a symptom like "the frame shows X before/after Y". To
prove the test catches the bug, run it against the old file
(`git show HEAD~1:src/... > src/...`) and restore it afterwards. See [[redraw-wiring]].
