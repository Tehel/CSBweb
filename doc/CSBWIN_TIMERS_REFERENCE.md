# CSBWin Timers Reference (Sourced)

This document captures verified timer behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Timer scheduling and tick order

- `GameTimers::CheckForTimerEvent` returns true when the next timer's `Time()` is `<= d.Time` (`doc/CSBwin-src/Timer.cpp`).
- The main loop runs `ProcessTimers()` at the start of each clock tick, and `d.Time++` happens later before input handling (`doc/CSBwin-src/CSBCode.cpp` tags `tag0006d0` and `tag000730`).

## Timer insertion and de-duplication

- `deleteDuplicateTimers` is defined as `-1` (enabled) by default (`doc/CSBwin-src/data.cpp`).
- `GameTimers::SetTimer` deduplicates map timers (`TT_MAP_FIRST..TT_MAP_LAST`, including `TT_DOOR`) when `deleteDuplicateTimers != 0`: if an existing map timer has the same `Time()`, `Level()`, and `timerWord6` (x/y), it updates `timerUByte9` instead of inserting another; for `TT_STONEROOM` it also matches `timerUByte8` (pos) (`doc/CSBwin-src/Timer.cpp`).
- When inserting a `TT_1` (door step) timer, `GameTimers::SetTimer` special-cases an existing `TT_DOOR` at the same `Time()/Level()/timerWord6` with `timerUByte9 == 2` (toggle): it flips the door timer's action to `1 - newAction` and reuses it instead of queueing a second timer (`doc/CSBwin-src/Timer.cpp`).

## Door timers

- `ProcessTT_DOOR` does not animate doors directly: it checks door state and action, resolves toggle to open/close based on `cellFlag & 7`, converts the timer to `TT_1`, and requeues it (`doc/CSBwin-src/Timer.cpp`).
- `ProcessTT_1` advances door state by one step and requeues itself until fully open/closed; it returns immediately if the door is already at the requested end state and defers if the party/monsters block the door (`doc/CSBwin-src/Timer.cpp`).

## False wall timers

- `ProcessTT_FALSEWALL` toggles false wall visibility by setting/clearing bit `0x04` in the cell flag; when clearing, it defers if the party or a non-material monster occupies the cell (`doc/CSBwin-src/Timer.cpp`).
- The non-material check consults **only the first monster** in the cell's object chain, not
  every monster present: `FindFirstMonster()` walks the chain and returns the first `dbMONSTER`
  record (`doc/CSBwin-src/Code11f52.cpp:533`), and `RN::NonMaterial()` then reads
  `MonsterDescriptor[monsterType].nonMaterial()`, i.e. `word2 & 0x40`
  (`doc/CSBwin-src/data.cpp:553`, `doc/CSBwin-src/CSB.h:2286`). A cell may hold up to four
  monsters, so "any monster is non-material" is **not** equivalent and would defer the false
  wall in cases CSBWin does not. See `doc/CSBwin-src/Timer.cpp:1466-1472`.
