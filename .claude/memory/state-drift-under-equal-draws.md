---
name: state-drift-under-equal-draws
description: an F24 drift whose draws agree up to a DSA that reads different values is a state drift from long before; log the fields per tick on both sides and diff, then catch the port's writer with a setter
metadata:
  type: project
---

When a `DEBT.md` F24 drift's draws agree up to a DSA but the DSA reads different values (`&CHAR@`, `&MON@`), the state drifted long before without moving the random stream. Log the suspect fields once per tick on both sides, printing only on change: in CSBWin, a block at the top of `ProcessTimers` (`CSBCode.cpp`, the oracle build folder's copy) writing `stats.txt`, which lands in the oracle's run folder; in the port, the same at the top of `TimerSystem.processTimers` through a `globalThis` hook a scratch worktree's `play-csbwin-log.ts` sets. Diff for the first tick that parts, then catch the port's writer with an `Object.defineProperty` setter on the field that records `new Error().stack` over that tick range.

**Why:** Conflux's line-4684 drift showed at 0x259b, but its cause was a chest picked up at 0x1ea7, 1,780 ticks earlier (food, water, stamina, then load and `MaxLoad` logged). Tracing the DSA only showed where the drift surfaced; three runs of this method found the cause ([[dungeon-rules-in-expool]]).

**How to apply:** after the draws-per-tick triage of [[csbwin-oracle]], if the first differing draw is a decision made on game state rather than the stream, log that state from `d.Time` 0 on both sides before reading any code. Restore the oracle's `.orig` copies after.

**The timers themselves:** when a tick's draws part among DSA message timers (fn 101/102) or the timers come in another order, log one line per timer at the top of the `ProcessTimers` loop on both sides (CSBWin: after `LoadLevel(D0W)`, a `TraceLine` of `Function()`, `Level()`, `timerUByte5`-`8` and `numRandomCalls`; the port: `ctx.host.trace` before `dispatch`), from a few thousand ticks back, and diff. Normalise first: missile timers (fn 48/49) lay their fields out differently on each side, fn 60/61's `b8` differs, the port's `b8=205` is an unset byte, fn 75 has x and y swapped; none of those is a drift. Conflux's line-10327 drift (draws parting at 0x4eee) was an extra pit timer at 0x4858, a pad lifted by a pick-up at the party's feet, found in one run this way. A timer only one side has: catch its maker with a stack trace in the port's `TimerQueue.addTimer` filtered on its function, then a `TraceLine` of the cell's chain and the call's flags in CSBWin's `PlaceOrRemoveObjectInRoom` (or whatever made it) on both sides.
