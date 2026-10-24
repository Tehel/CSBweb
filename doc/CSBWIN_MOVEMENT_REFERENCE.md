# CSBWin Movement and Collision Reference (Sourced)

This document captures verified movement/collision rules from the CSBWin C++ source under `doc/CSBwin-src/`.

## Party movement blocking

- Party movement blocks on `roomSTONE`, blocks on `roomDOOR` unless `doorState` is `0`, `1`, or `5`, and blocks on `roomFALSEWALL` when both `(cellFlags & 0x04) == 0` and `(cellFlags & 0x01) == 0` (`doc/CSBwin-src/CSBCode.cpp`).

## Monsters block the party

`MoveParty` (`doc/CSBwin-src/CSBCode.cpp:8031`) treats a monster in the destination
cell with the same inhibit flag (`D5W`) it uses for a wall, but the two paths differ:

```c
if (d.NumCharacter != 0) {
  if (D5W != 0) {                       // terrain blocked
    direction = direction + (d.partyFacing + 2);
    LOCAL_8  = GetCharacterToDamage(newX, newY, direction & 3);
    k = DamageCharacter(LOCAL_8, 1, 24, 2);
    LOCAL_10 = GetCharacterToDamage(newX, newY, (direction + 1) & 3);
    if (LOCAL_8 != LOCAL_10) k |= DamageCharacter(LOCAL_10, 1, 24, 2);
    if (k != 0) QueueSound(18, d.partyX, d.partyY, 0);
  } else {
    if (direction <= 3) {
      objD0 = FindFirstMonster(newX, newY);
      D5W = objD0 != RNeof;
    }
    if (D5W != 0) ProcessTimers29to41(newX, newY, TT_M1, 0);
  }
} else {
  if (direction > 3) return result;
}
if (D5W != 0) { DiscardAllInput(); d.clockTick = 0; }
else { MoveObject(...); /* …party actually moves… */ }
```

(`doc/CSBwin-src/CSBCode.cpp:8373-8400`)

Verified facts:

- The monster block is gated on `d.NumCharacter != 0`. A party with no champions walks
  through monsters.
- `FindFirstMonster` here is **not** filtered by `NonMaterial()`, unlike the door-crush
  test in `ProcessTT_1` (`doc/CSBwin-src/Timer.cpp:1313`). An immaterial monster blocks
  the party even though it does not stop a closing door.
- The monster block queues **no sound**. Only the terrain block does (`QueueSound(18, …)`,
  and only when a champion actually took damage).
- The monster block calls `ProcessTimers29to41(newX, newY, TT_M1, 0)`, so being walked
  into gives the group a turn. `InitialChecks` maps `TT_M1` to a `TT_31` timer one tick
  out (`doc/CSBwin-src/Monster.cpp:3030-3059`); `CSB.h:1831` names it
  `TT_31 = 31, // When Party ran into monster`.
- One `TT_31` per bump is correct. `SetTimer`'s duplicate suppression covers only
  `TT_MAP_FIRST..TT_MAP_LAST` (5..10) plus `TT_1` / `TT_DOOR` / `TT_BASH_DOOR`
  (`doc/CSBwin-src/Timer.cpp:1011-1052`), and 31 is outside that range.
- A **vertical** move (`direction > 3`, the Move Up / Move Down buttons) refuses
  outright when the destination holds a monster — an early `return result` with no
  timer poke and no sound (`doc/CSBwin-src/CSBCode.cpp:8287-8291`).

Not yet ported (see `PLAN.md`): the terrain block's `DamageCharacter(…, 1, 24, 2)`
wall-bump damage and its sound-18 gate, the `DiscardAllInput()` / `d.clockTick = 0`
pair, and the vertical-move guard.

## A closing door does not pass through what is under it

`ProcessTT_1` (`doc/CSBwin-src/Timer.cpp:1271-1357`) — CSBWin's door-step timer, our
`TimerFunction.TT_DOOR_STEP`. The whole blocker handling sits under `if (D5W == 1)`,
i.e. only while the door is coming *down*:

```c
if (D5W == 1) {
  pDB0_4 = FirstObjectRecordAddressDB0(x, y);
  w_10 = pDB0_4->mode();                    // bit 5 of DB0.word2: up/down vs sideways
  if (d.LoadedLevel==d.partyLevel && x==d.partyX && y==d.partyY && D4W != 0) {
    if (d.NumCharacter > 0) {
      *cfA2 &= 0xf8;                        // spring fully open again
      w_10 |= 8;                            // dead store
      D0W = DamageAllCharacters(5, 4, 2);
      if (D0W != 0) QueueSound(soundDOOROPENING, x, y, 1);
    }
    pTimer->Time(pTimer->Time()+1); gameTimers.SetTimer(pTimer); return;
  }
  obj_6 = FindFirstMonster(x, y);
  if (obj_6 != RNeof && !obj_6.NonMaterial()) {
    D1W = (w_10 != 0) ? obj_6.VerticalSize() : 1;
    if (D4W >= D1W) {
      monsterDamageResult = DamageMonsterGroup(GetRecordAddressDB4(obj_6), x, y, 5, 1, false, NULL);
      if (monsterDamageResult != ALL_MONSTERS_DIED) ProcessTimers29to41(x, y, TT_M3, 0);
      D4W = (D4W == 0) ? 0 : D4W - 1;       // rebound one step back up
      *cfA2 = (*cfA2 & 0xf8) | D4W;
      QueueSound(4, x, y, 1);
      pTimer->Time(pTimer->Time()+1); gameTimers.SetTimer(pTimer); return;
    }
  }
}
```

Verified facts:

- **The nesting is not what it looks like.** `D4W != 0` belongs to the *party* arm
  only. The monster arm's only gate is `D4W >= D1W`, so a fully open (`D4W == 0`)
  up-down door still crushes a monster whose `VerticalSize()` is 0 — and 2 of the 27
  monster types in the shipped `graphics.dat` have `verticalSize == 0`
  (histogram: 0→2, 1→18, 2→4, 3→3). Reading `D4W != 0` as guarding both arms is
  wrong in play, not just on paper.
- The party arm is additionally gated on `d.NumCharacter > 0`, and the sound only
  plays when `DamageAllCharacters` reports somebody was actually hurt.
- `soundDOOROPENING` is 18 (`doc/CSBwin-src/CSB.h:629`); the monster rebound queues
  ordinal 4.
- `FindFirstMonster` consults only the **first** monster in the cell chain, and an
  immaterial one is skipped entirely — the door closes through a ghost.
- `w_10 |= 8` in the party arm is a dead store: nothing reads `w_10` afterwards.
- A sideways door catches anything (`D1W = 1`); an up-down door only catches a
  monster at least as tall as the gap that is left.

Observed on level 2's up-down door at (0,25) with an Ant Man
(`verticalSize == 1`) under it: the door steps `1 → 0 → 1` — it closes to 1, crushes
and rebounds to 0, and the `TT_M3` poke gives the group a turn, which it uses to walk
out from under the door (`tools/checks/door-crush.ts`).
