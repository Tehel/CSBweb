---
name: redraw-wiring
description: Where the port redraws the screen — onTick in main.ts, not a render loop; where to look for a frame one tick early or late
metadata:
  type: project
---

The port has no per-animation-frame render. The screen is redrawn in three places:

- once per tick, from `game.onTick` in `src/main.ts` `wire()` (`renderView()`);
- on a VBL when the message strip scrolled, from `game.onFrame`;
- when the engine asks, through `GameHost.drawViewport` (a script's tick).

`Game.gameTick` runs `onTickCallbacks` where CSBWin's tick calls `DrawViewport`
(`doc/CSBwin-src/CSBCode.cpp:638`): after the timers and after `loadNewPartyLevel`,
before the game-lost check.

**Why:** a frame that shows a state one tick early or late is decided by where these
hooks fire inside `gameTick`, and that is not visible from the renderer.

**How to apply:** for a timing symptom on screen, open `Game.gameTick` next to
`CSBCode.cpp:600-778` first. See [[one-tick-late-is-ordering]] and [[two-step-level-change]].
