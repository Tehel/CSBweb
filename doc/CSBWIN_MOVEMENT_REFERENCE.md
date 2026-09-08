# CSBWin Movement and Collision Reference (Sourced)

This document captures verified movement/collision rules from the CSBWin C++ source under `doc/CSBwin-src/`.

## Party movement blocking

- Party movement blocks on `roomSTONE`, blocks on `roomDOOR` unless `doorState` is `0`, `1`, or `5`, and blocks on `roomFALSEWALL` when both `(cellFlags & 0x04) == 0` and `(cellFlags & 0x01) == 0` (`doc/CSBwin-src/CSBCode.cpp`).

## Monsters block the party

`MoveParty` (`doc/CSBwin-src/CSBCode.cpp:7944`) treats a monster in the destination
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

(`doc/CSBwin-src/CSBCode.cpp:8286-8313`)

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
  out (`doc/CSBwin-src/Monster.cpp:3026-3055`); `CSB.h:1768` names it
  `TT_31 = 31, // When Party ran into monster`.
- One `TT_31` per bump is correct. `SetTimer`'s duplicate suppression covers only
  `TT_MAP_FIRST..TT_MAP_LAST` (5..10) plus `TT_1` / `TT_DOOR` / `TT_BASH_DOOR`
  (`doc/CSBwin-src/Timer.cpp:1011-1052`), and 31 is outside that range.
- A **vertical** move (`direction > 3`, the Move Up / Move Down buttons) refuses
  outright when the destination holds a monster — an early `return result` with no
  timer poke and no sound (`doc/CSBwin-src/CSBCode.cpp:8200-8204`).

Not yet ported (see `PLAN.md`): the terrain block's `DamageCharacter(…, 1, 24, 2)`
wall-bump damage and its sound-18 gate, the `DiscardAllInput()` / `d.clockTick = 0`
pair, and the vertical-move guard.
