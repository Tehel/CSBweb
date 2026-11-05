---
name: possiblemove-globals-outlive-call
description: CSBWin's PossibleMove scratch globals (moveOntoPartyPosition, Word13038, Word13042, Obj13040) are read stale after a skipped call; the port's per-call MoveProbe loses that
metadata:
  type: project
---

`PossibleMove` (`doc/CSBwin-src/Monster.cpp:635`) answers through `d.` globals it resets at its top: `d.moveOntoPartyPosition`, `d.Word13038`, `d.Word13042`, `d.Obj13040` (ReDMCSB's `G0387`-`G0390`). The port returns them in a `MoveProbe` that lives for one call (`MonsterPerception.possibleMove`). Where CSBWin skips the call and still reads a global, it reads the last call's value, another direction's or another group's. `Try_Directions_D5_To_D4`'s `goto tag00d36e` did, for `moveOntoPartyPosition`: the port now keeps that one as `MonsterPerception.moveOntoPartyPosition` (flag `skippedStepForgetsParty`, level 5).

**Why:** that stale read cost a CSB run's drift (`CSBFullRecordingV4`, map 6, `d.Time` 0x32a4); the other three globals have not been audited for the same pattern.

**How to apply:** a drift right after a skipped or short-circuited `PossibleMove` (a 1-in-4 roll, an `&&` chain in `Try_Preferred_Direction_Then_Others`) — check whether CSBWin reads one of these globals there before suspecting anything else. Related: [[csbwin-oracle]], [[one-tick-late-is-ordering]].
