---
name: port-throw-trace-csbwin-first
description: when the port throws where CSBWin plays on, trace the same function's state in the oracle first; equal state means an unported branch behind a refusal, not a state drift
metadata:
  type: project
---

When the port throws mid-tick in an F24 run and CSBWin plays on, first put a `TraceLine` in
the same CSBWin function in the oracle ([[csbwin-oracle]]) and print the state the throw
objects to. If CSBWin has the same state, the throw is a refusal in the port, a branch it
never ported, and no state drift needs hunting: port the branch with a flag. A crash is
game-breaking, so the port must not throw even where its state matches CSBWin's. Look for
other such refusals with `grep -n "throw new Error" src/engine`.

**Why:** Conflux's line-62861 throw (`DEBT.md` F24) was `WorldMove.moveObject` refusing to
place a monster that a dying group carried. One trace of `DropMonsterRemains`' possession
chain showed CSBWin carried it too, which made a slot log on both sides unnecessary;
`MonsterSystem.moveMonster` already ported the branch.

**How to apply:** for a throw, trace before logging slots or state per tick
([[state-drift-under-equal-draws]]); those are for when the states differ.
