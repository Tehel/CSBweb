---
name: two-step-level-change
description: A stairs step or pit fall leaves party.position.z on the old level until the next tick's loadNewPartyLevel
metadata:
  type: project
---

A move to another level happens in two steps, as in CSBWin. `TraverseStairway`
(`MovementSystem.traverseStairway`) and the pit arm of `WorldMove` write the new x and y
into `party.state.position` and set `ctx.loop.newPartyLevel`, but `position.z` stays the
level the party left. `Game.loadNewPartyLevel`, at the top of the next tick and again
after the timers, sets the new level and runs the party's `MoveObject` there.

**Why:** anything that reads `party.state.position` in between sees the new square on
the old level. A redraw placed there produced a visible bad frame on every level change.

**How to apply:** a tool that moves the party between levels must run a tick
(`gameTick`) or call `game.loadNewPartyLevel()` before asserting a level. A new reader of
the party's position that can run between a move and the tick must allow for
`newPartyLevel !== -1`. See [[redraw-wiring]].
