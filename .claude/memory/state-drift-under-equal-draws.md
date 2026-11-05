---
name: state-drift-under-equal-draws
description: an F24 drift whose draws agree up to a DSA that reads different values is a state drift from long before; log the fields per tick on both sides and diff, then catch the port's writer with a setter
metadata:
  type: project
---

When a `DEBT.md` F24 drift's draws agree up to a DSA but the DSA reads different values (`&CHAR@`, `&MON@`), the state drifted long before without moving the random stream. Log the suspect fields once per tick on both sides, printing only on change: in CSBWin, a block at the top of `ProcessTimers` (`CSBCode.cpp`, the oracle build folder's copy) writing `stats.txt`, which lands in the oracle's run folder; in the port, the same at the top of `TimerSystem.processTimers` through a `globalThis` hook a scratch worktree's `play-csbwin-log.ts` sets. Diff for the first tick that parts, then catch the port's writer with an `Object.defineProperty` setter on the field that records `new Error().stack` over that tick range.

**Why:** Conflux's line-4684 drift showed at 0x259b, but its cause was a chest picked up at 0x1ea7, 1,780 ticks earlier (food, water, stamina, then load and `MaxLoad` logged). Tracing the DSA only showed where the drift surfaced; three runs of this method found the cause ([[dungeon-rules-in-expool]]).

**How to apply:** after the draws-per-tick triage of [[csbwin-oracle]], if the first differing draw is a decision made on game state rather than the stream, log that state from `d.Time` 0 on both sides before reading any code. Restore the oracle's `.orig` copies after.
