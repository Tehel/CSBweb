---
name: dungeon-rules-in-expool
description: a quantity that differs only on a fan dungeon may come from its EXPOOL in CSBWin (Conflux's chest weight, EDBT_ObjectWeights); grep CSBWin for expool.Locate near the code before suspecting a formula
metadata:
  type: project
---

CSBWin reads some rules from the dungeon's `EXPOOL` (`expool.Locate((EDT_Database<<24)+(EDBT_…<<16)+…)`), with an FTL default where the record is missing; the port may have hard-coded the default. Conflux sets a chest's weight there (`EDBT_ObjectWeights` 0 = 10, `Mouse.cpp:63-70`; no other repository set has it), which the port read as 50 until level 6.

**Why:** the line-4684 drift of Conflux's partial game (`DEBT.md` F24) was that one lookup, and nothing in the port pointed to the pool. Conflux and Towers of Chaos are made with CSBuild and may hold other such records.

**How to apply:** when a quantity differs only on a fan dungeon, grep CSBWin for `expool.Locate` near the code in question first. To see which sets carry a record, a scratch script over `DATA_SETS` (`tools/lib/dataSets.ts`) printing `new Expool(new DungeonLoader().loadDungeonDat(bytes)).locateAt(key, 0)`. Found with [[state-drift-under-equal-draws]].
