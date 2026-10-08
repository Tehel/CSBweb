# CSBWin Timers Reference (Sourced)

This document captures verified timer behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Timer scheduling and tick order

- `GameTimers::CheckForTimerEvent` returns true when the next timer's `Time()` is `<= d.Time` (`doc/CSBwin-src/Timer.cpp`).
- The main loop runs `ProcessTimers()` at the start of each clock tick, and `d.Time++` happens later before input handling (`doc/CSBwin-src/CSBCode.cpp` tags `tag0006d0` and `tag000730`).

## Timer insertion and de-duplication

- `deleteDuplicateTimers` is a global that every game read sets once the databases are in: 1 when the world's `EXPOOL` holds no `(EDT_Database << 24) + (EDBT_DeleteDuplicateTimers << 16)` record, else that record's first longword (`doc/CSBwin-src/SaveGame.cpp:1965-1975`). 3D2D1D's `dungeon.dat` holds one of 0. The port reads it with `readDeleteDuplicateTimers` (`src/data/CsbwinExpool.ts`) into `TimerQueue.deleteDuplicateTimers`.
- `GameTimers::SetTimer` deduplicates map timers (`TT_MAP_FIRST..TT_MAP_LAST`, including `TT_DOOR`) when `deleteDuplicateTimers != 0`: if an existing map timer — of **any** map function — has the same `Time()`, `Level()`, and `timerWord6` (x/y), it takes the new `timerUByte9` and is returned instead of inserting another; for `TT_STONEROOM` it also matches `timerUByte8` (pos). A matching `TT_1` is instead deleted and the new timer queued (`doc/CSBwin-src/Timer.cpp:1011-1053`).
- When inserting a `TT_1` (door step) timer, `GameTimers::SetTimer` keeps an existing `TT_DOOR` or `TT_1` at the same `Time()/Level()/timerWord6` and drops the new one: a `TT_DOOR` with `timerUByte9 == 2` (toggle) becomes `1 - newAction`, any other `TT_DOOR` is left alone, and a `TT_1` takes the new action (`doc/CSBwin-src/Timer.cpp:1055-1096`).
- "First match" means first in `TIMER_SEARCH` order: the queue's heap array, walked from its last entry (`doc/CSBwin-src/Timer.cpp:1209-1215`, `:2924-2933`). See `doc/PROVEN_FACTS.md` → "`TIMER_SEARCH` walks the queue backwards".

## Door timers

- `ProcessTT_DOOR` does not animate doors directly: it checks door state and action, resolves toggle to open/close based on `cellFlag & 7`, converts the timer to `TT_1`, and requeues it (`doc/CSBwin-src/Timer.cpp`).
- `ProcessTT_1` advances door state by one step and requeues itself until fully open/closed; it returns immediately if the door is already at the requested end state and defers if the party/monsters block the door (`doc/CSBwin-src/Timer.cpp`).

## False wall timers

- `ProcessTT_FALSEWALL` toggles false wall visibility by setting/clearing bit `0x04` in the cell flag; when clearing, it defers if the party or a non-material monster occupies the cell (`doc/CSBwin-src/Timer.cpp`).
- The non-material check consults **only the first monster** in the cell's object chain, not
  every monster present: `FindFirstMonster()` walks the chain and returns the first `dbMONSTER`
  record (`doc/CSBwin-src/Code11f52.cpp:568`), and `RN::NonMaterial()` then reads
  `MonsterDescriptor[monsterType].nonMaterial()`, i.e. `word2 & 0x40`
  (`doc/CSBwin-src/data.cpp:554`, `doc/CSBwin-src/CSB.h:2349`). A cell may hold up to four
  monsters, so "any monster is non-material" is **not** equivalent and would defer the false
  wall in cases CSBWin does not. See `doc/CSBwin-src/Timer.cpp:1466-1472`.
