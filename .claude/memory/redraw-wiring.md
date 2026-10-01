---
name: redraw-wiring
description: Where the port redraws the screen — the tick's DrawViewport vs. refreshScreen everywhere else; where to look for a frame one tick early or late
metadata:
  type: project
---

The port has no per-animation-frame render. `DrawViewport` (`renderView` in `src/main.ts`,
`GameScreen.drawViewport`) runs only where CSBWin calls it:

- once per main-loop tick, from `game.onTick` in `wire()`, skipped while an inventory is
  open or the party sleeps (`CSBCode.cpp:636-637`);
- a script's tick, through `GameHost.drawViewport`.

A game's first view (start, restart, a load) is the tick `MainLoop` opens with:
`Game.start`, `resumeMainLoop` and `applyRuntimeSaveState` make one due, and the page
draws nothing itself.

Everything else — clicks, keys, the message scroll, the button flash, the tick's paint
after `TAG01b29a` (`GameHost.paint`) — is `refreshScreen`, which composes the screen over
the viewport as it stands (`GameScreen.refreshOverlay`).

`Game.gameTick` runs `onTickCallbacks` where CSBWin's tick calls `DrawViewport`
(`doc/CSBwin-src/CSBCode.cpp:638`): after the timers and after `loadNewPartyLevel`,
before the game-lost check.

**Why:** a frame that shows a state one tick early or late is decided by where these
hooks fire inside `gameTick`, and that is not visible from the renderer. A `DrawViewport`
off the tick advances `GraphicRandom` and changes the teleporter's shimmer.

**How to apply:** for a timing symptom on screen, open `Game.gameTick` next to
`CSBCode.cpp:600-778` first. See [[one-tick-late-is-ordering]] and [[two-step-level-change]].
