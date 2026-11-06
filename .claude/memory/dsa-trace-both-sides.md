---
name: dsa-trace-both-sides
description: recipe and gotchas for diffing a DSA per-command trace between CSBWin (DSA.cpp Execute) and the port (DsaMachine.executeRun), setvar included
metadata:
  type: project
---

CSBWin: in the oracle build's `DSA.cpp`, declare `TraceLine`, give `class STACK` `depth()`/`top()` accessors, `TraceLine` at `Execute`'s entry (slave and master locations: copy `locrSlave` into a `LOCATIONABS` by assignment, not initialisation, which does not compile), at the top of the opcode loop (state, column, opcode, words left, depth, top), and in `DSADBANK::Var(i, value)` (`setvar`). The port: the same at `DsaMachine.executeRun`'s entry and loop (`ProgramCursor.remaining + 1` matches CSBWin's count; `DsaStack.stack` is private, open it in the scratch copy), and `setvar` in `DsaBank.setVar` through a `globalThis` hook that the scratch `play-csbwin-log.ts` sets to print inside `--trace`'s window (`DsaBank`'s own `trace` does not reach stdout).

**Gotchas:** the port's `host.trace` lines are unindented while its draw lines are indented: grep `^ *(execute|cmd|setvar)`, and keep the run's whole output in a file, since a rerun costs ~5 minutes. The port's window starts at the tick's first timer, CSBWin's earlier: align on the first common `execute` line before diffing. The first `setvar` that differs names a filter's input; Conflux's line-51958 drift was attack parameter 16, `heroToDamage` (the order is `ATTACK_PARAMETERES`, `Monster.cpp:921-942`).

**How to apply:** after the draw triage of [[csbwin-oracle]] shows the sides parting at a DSA's decision. Then print the decision's inputs on both sides ([[state-drift-under-equal-draws]]).
