---
name: loadpartylevel-draws-mean-party-moved
description: CSBWin's extra draws under AttachItem16ToMonster < ProcessMonstersOnLevel < LoadPartyLevel mean the party changed level there and not in the port; find who set d.newPartyLevel
metadata:
  type: project
---

When an F24 drift's extra draws on CSBWin's side are `STRandom < NextMonsterUpdateTime < AttachItem16ToMonster < ProcessMonstersOnLevel < LoadPartyLevel < _MainLoop` at a tick's end, the party changed level in CSBWin and not in the port (`_MainLoop`'s `tag0006a4`, `CSBCode.cpp:628-645`, re-attaching each group of the new level with fresh times).

**Why:** Conflux's line-44479 drift (`DEBT.md` F24) was 29 such draws. A `TraceLine` where `MoveObject` sets `d.newPartyLevel` (`Code11f52.cpp:3358`, printing `curLevel`, `AttachedLevel_4`, the squares) named the destination, a DSA `&TELEPORTPARTY` at 4(12,8); a per-command DSA trace ([[dsa-trace-both-sides]]) showed the port never ran that DSA; the cause was upstream: the logged click on its switch, which the port's picking took for an alcove.

**How to apply:** trace `d.newPartyLevel`'s writer first, then which DSA or move did it, then walk back to the input that triggered it (a click: trace the port's `handleClickInViewport` picking state, `ui.picking`). See [[csbwin-oracle]].
