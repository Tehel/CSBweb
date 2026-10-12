---
name: redraw-wiring
description: Where the port redraws the screen — the tick's DrawViewport vs. refreshScreen everywhere else, a dialog's pointer and wheel drawn by the VBL; where to look for a frame one tick early or late, or a dialog that reacts late
metadata:
  type: project
---

The port has no per-animation-frame render. `DrawViewport` (`renderView` in `src/main.ts`,
`GameScreen.drawViewport`) runs only where CSBWin calls it:

- once per main-loop tick, from `game.onTick` in `wire()`, skipped while an inventory is
  open or the party sleeps (`CSBCode.cpp:646-647`);
- a script's tick, through `GameHost.drawViewport`.

A game's first view (start, restart, a load) is the tick `MainLoop` opens with:
`Game.start`, `resumeMainLoop` and `applyRuntimeSaveState` make one due, and the page
draws nothing itself.

Everything else — clicks, keys, the message scroll, the button flash, the tick's paint
after `TAG01b29a` (`GameHost.paint`) — is `refreshScreen`, which composes the screen over
the viewport as it stands (`GameScreen.refreshOverlay`).

A move of the pointer draws nothing: it records the place (`GameScreen.setHoverPoint`),
and the VBL's frame (`game.onFrame` in `wire()`) composes the screen when the pointer has
moved (`takeCursorMoved`), as CSBWin's VBL handler alone draws the cursor. A redraw per
`mousemove` saturates the page: a mouse reports every 8 ms or faster, and composing the
screen takes about as long.

In a dialog, a click and a key are redrawn by `GameInput` (`refreshScreen` right after
`handleDialogClick` / `handleDialogKey`); the pointer and the wheel are not:
`Dialog.pointer` and `Dialog.wheel` say whether the dialog is drawn differently, and the
VBL's frame draws it (`takeCursorMoved`, `takeWheelTurned`). The save menu draws itself
instead (`renderLastFrame` in its `scrollBy`), so its `wheel` returns `false`. A dialog
input that says `false` (or returned `void`, as `wheel` once did) changes state that shows
only at the next unrelated repaint: frozen, then a jump.

`Game.gameTick` runs `onTickCallbacks` where CSBWin's tick calls `DrawViewport`
(`doc/CSBwin-src/CSBCode.cpp:648`): after the timers and after `loadNewPartyLevel`,
before the game-lost check.

**Why:** a frame that shows a state one tick early or late is decided by where these
hooks fire inside `gameTick`, and that is not visible from the renderer. A `DrawViewport`
off the tick advances `GraphicRandom` and changes the teleporter's shimmer.

**How to apply:** for a dialog that reacts late or in jumps, check that input's path to
a redraw first. For a timing symptom on screen, open `Game.gameTick` next to
`CSBCode.cpp:610-788` first. See [[one-tick-late-is-ordering]] and [[two-step-level-change]].
