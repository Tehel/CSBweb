---
name: monster-groups-in-tools
description: Where a tool finds monster groups of several in the fixture saves, how to get them an ITEM16, and why getAttachedItem16 alone lies off the party's level
metadata:
  type: project
---

**Where the groups are.** `csbgame7.dat` has no group of more than one monster on the
party's level (6): only two lone type-9s, as wide as their square. Its groups of several
are on levels 5 and 7; `tools/dump-dsa-monsters.ts` names them (`THREE`, `TWO`, `FOUR`,
and `WIDE_PAIR` on level 8). The other fixture saves have no monster on the party's level
at all.

**The ITEM16 path.** A group has its `ITEM16` (corners, facings, status) only on the
party's level. To test that path, put the party on the group's level in the tool:
`party.position = new Position(x, y, level)`, then
`game.ctx.systems.monsters.loadPartyLevelIfChanged()`, which attaches the level's groups
as a level change does (it re-rolls their status, so set the status after it).

**The trap.** `DungeonState.getAttachedItem16` checks only that `groupIndex` is within the
pool (`src/engine/DungeonState.ts:848-852`). A group off the party's level keeps its
corners byte in that field (5, 6, …), so it gets an unrelated `ITEM16` back. Test
`level === party.position.z` first, as `MonsterDamage.monsterPositionByte` does.

**Why:** the next monster work needs this, the DSA's `I_DelMon`, `I_InsMon` and
`I_MonsterStore`, and G2's monster move filter, and finding it took a scan of every
fixture.

**How to apply:** start a monster tool from `dump-dsa-monsters.ts`'s positions and
`partyOnto`. A level change in play goes through `loadNewPartyLevel` instead
([[two-step-level-change]]).
