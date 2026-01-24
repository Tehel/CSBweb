# Actuators in CSBWin (DB3) - Sourced Notes

This document summarizes how actuators work in CSBWin based on the original C++ source under `doc/CSBwin-src/`. All statements below are tied to specific CSBWin code/comments.

## 1) Data model: DB3 (Actuator) record

**Primary definition**: `doc/CSBwin-src/CSB.h` class `DB3` (Actuator) and its field comments.

Key fields and helpers (all from `DB3` in `doc/CSBwin-src/CSB.h:927-1075`):
- `word2`:
  - bits 0-6: `actuatorType()` (see type list below).
  - bits 7-15: `value()` (type-specific value).
  - bits 7-11: `DSAselector()` (for type 47).
  - bits 12-15: `DSAstate()` (for type 47).
- `word4`:
  - bit 2: `onceOnly()` (disables after first activation).
  - bits 3-4: `action()` (`SET`, `CLEAR`, `TOGGLE`, `CONSTPRESSURE`).
  - bit 5: `normallyClosed()`.
  - bit 6: `audible()` (click sound).
  - bits 7-10: `delay()` (time before action).
  - bit 11: `localActionOnly()`.
  - bits 12-15: `wallGraphicOrdinal()` (for decoration).
- `word6` interpretation depends on `word4 bit 11`:
  - If `localActionOnly()` is false: `targetX()/targetY()/targetPos()` live in bits 6-10, 11-15, 4-5.
  - If `localActionOnly()` is true: `localActionType()` uses bits 4-15.
  - Additional helpers for special types:
    - `disableTime()` / `hitPointMultiplier()` (monster generator).
    - `energyRemaining()` (missile launcher).
    - `andOrEdge()` / `drawAsSize4()` (type-specific flags).
    - `SetResponses()` / `ClearResponses()` / `ToggleResponses()` / `DisableMessage()` / `State()` / `Position()` for portrait/DSA state handling.

## 2) Actuator type meanings (from CSB.h comments)

CSBWin documents actuatorType values in the DB3 comments (`doc/CSBwin-src/CSB.h:927-1045`). These meanings are authoritative:
- `0`: no-op.
- `1`: simple wall switch (can be pressed with anything).
- `2`: unspecified (DB3 comment notes "?").
- `3`: lock; key stays in hand.
- `4`: lock; key removed from hand.
- `5`: bitwise compare actuator; Timer6 uses bit positions in `word8` (see `CSB.h` comment).
- `6`:
  - In **stone**: a counter. `SET` increments, others decrement. Pressed when non-zero.
  - In **open**: monster generator (timer type 5 triggers); can disable after N uses.
- `7`: stone-room missile launcher (one predefined).
- `8`:
  - In **open**: party-only pad; value is an OBJECTTYPE in party possessions.
  - In **stone**: missile launcher (spell), value selects spell.
- `9`: stone missile launcher (two predefined).
- `10`: stone missile launcher (two spells).
- `11`: lock; key removed from hand.
- `14`: missile launcher using one available object from same room.
- `15`: missile launcher using two available objects from same room.
- `47`: DSA (Dungeon Scripted Action).

## 3) Trigger evaluation (press/step logic)

**Core routine**: `PressurePadOrAlcove()` in `doc/CSBwin-src/Code11f52.cpp:3660-3890`.

High-level behavior:
- Split by **actuator location**:
  - **Open room / pad** (`switchPosition == -1`).
  - **Stone wall / lever** (`switchPosition != -1`), and actuator position must match `obj.pos()`.
- For pads:
  - Logic depends on `actuatorType()` with checks for party/monster/object presence, direction, and object type matches.
  - Example cases (all from `PressurePadOrAlcove()`):
    - Type 1: "anything" pad, ignores if object/monster already present.
    - Type 2: party or monsters only.
    - Type 3: party only, with optional facing constraint when `value != 0`.
    - Type 4: requires object type match (`value` vs moved object basic type).
    - Type 7: monsters only.
    - Type 8: checks party possession (calls `DoesPartyHave()`).
    - Type 9: party only, fires only on place, not remove.
- For wall switches:
  - Types 1-3 use object presence/type checks.
- `switchClosed` is derived from `switchPressed` and `normallyClosed()`.
- `CONSTPRESSURE` converts to `SET` when closed, `CLEAR` when open.
- Audible pads queue sound `soundPRESSUREPAD` (see `PressurePadOrAlcove()`).
- Final action queues via `QueueSwitchAction()` with `tmrAct` derived from actuator action.

## 4) QueueSwitchAction: "anything can act on anything"

**Core routine**: `QueueSwitchAction()` in `doc/CSBwin-src/Code11f52.cpp:3566-3636`.

Key behavior:
- If `onceOnly()` is set, actuator type is cleared (`actuatorType(0)`).
- `actionTime = d.Time + delay()`.
- If `localActionOnly()` is set, call `PerformLocalAction()` and return.
- Otherwise:
  - Read target room type from `d.LevelCellFlags[targetX][targetY]`.
  - For stone or false wall, use `targetPos()`; otherwise position is forced to 0.
  - Map room type to timer function using `d.Byte1596[targetRoomType]` (`doc/CSBwin-src/Data.h:1403`).
  - If mapping is 0, `WarnIllegalTimer()` is called and no timer is created.
  - Otherwise `CreateTimer()` is called with (function, x, y, pos, action, time).

The mapping table appears in code comments in both `QueueSwitchAction()` and `QueueDSASwitchAction()`:
- roomSTONE -> timer 6
- roomOPEN -> timer 5
- roomPIT -> timer 9
- roomSTAIRS -> timer 0 (illegal)
- roomDOOR -> timer 10
- roomTELEPORTER -> timer 8
- roomFALSEWALL -> timer 7
- unused -> timer 0

## 5) CreateTimer and timer fields

**CreateTimer**: `doc/CSBwin-src/Mouse.cpp:176-206`.

Creates a `TIMER` with:
- `Time = actionTime`, `Level = d.LoadedLevel`.
- `Function = timer function`.
- `timerUByte6/7 = x/y`, `timerUByte8 = pos`, `timerUByte9 = action`.
- Enqueues into `gameTimers`.

The TIMER struct and per-function comments are in `doc/CSBwin-src/CSB.h:1799-1980`.

## 6) Room-type timer handlers (core effects)

Key handlers in `doc/CSBwin-src/Timer.cpp` show the "anything can act on anything" behavior in practice:
- `ProcessTT_OPENROOM` (`Timer.cpp:1650+`):
  - Iterates objects in the target cell.
  - DB2 text: toggles show/hide based on action; prints text if party is on the cell.
  - DB3 actuator type 47: forwards to DSA via `ProcessDSATimer5`.
  - DB3 actuator type 48: handled via `OperateCounterActuator`.
- `ProcessTT_FALSEWALL` (`Timer.cpp:1380+`):
  - Checks for DSA/portrait actuators at the location.
  - Toggles cellflag bit `0x04` (wall invisibility) based on action.
  - Requeues when party or non-material monsters are on the tile.
- `ProcessTT_DOOR` (`Timer.cpp:1565+`):
  - Calls `ActivateDSA()` on DSA actuators at (x,y,pos).
  - May queue follow-up door timers based on `timerTypeModifier`.
- `TT_TELEPORTER` and `TT_PIT` effects are described in the `TIMER` comments as toggling cellflag bits and calling `ProcessNewlyActiveRoom()` for teleporters (`doc/CSBwin-src/CSB.h:1860-1888`).

Additional room-type effects are described in the TIMER comments:
- Timer function 6 ("fiddle with DB2 and DB3") affects DB2 show flags and DB3 actuators (see `doc/CSBwin-src/CSB.h:1847-1865`).
- Timer function 8 toggles teleporter active bit `0x08` and calls `ProcessNewlyActiveRoom` when set (see `doc/CSBwin-src/CSB.h:1866-1876`).
- Timer function 7 toggles false wall invisibility bit `0x04` (see `doc/CSBwin-src/CSB.h:1860-1865`).

Many handlers consult `timerTypeModifier[timerUByte9]` for SET/CLEAR/TOGGLE and skip work when it equals 3 (`doc/CSBwin-src/Timer.cpp`, `doc/CSBwin-src/DSA.cpp`).

## 7) Special actuator types (counters, generators, missile launchers)

**Counters**:
- `OperateCounterActuator()` handles counters (type 6 in stone, type 48 in open) and uses `QueueSwitchAction()` when the counter transitions (`doc/CSBwin-src/Timer.cpp:1589-1665`).
- Counters do not increment when the value is zero (explicit guard).

**Monster generators**:
- Type 6 in open rooms is a monster generator (described in DB3 comments, `doc/CSBwin-src/CSB.h:927-1045`), with disable-time handling via `word6`.

**Missile launchers**:
- Types 7-10, 14-15 are missile launchers (described in DB3 comments, `doc/CSBwin-src/CSB.h:927-1045`).
- Timer handling and object ejection are in `TriggerMissileLauncher()` (`doc/CSBwin-src/Timer.cpp:1883+`).

## 8) DSA (type 47)

DSA integration points:
- Actuator type 47 is explicitly handled in `PressurePadOrAlcove()` and timer handlers (`doc/CSBwin-src/Code11f52.cpp`, `doc/CSBwin-src/Timer.cpp`).
- `QueueDSASwitchAction()` mirrors `QueueSwitchAction()` but can create `TT_DESSAGE` or mapped room timers (`doc/CSBwin-src/DSA.cpp:470-540`).
- DSA state/selector/parameters are stored in DB3 (`DSAselector()`, `DSAstate()`, `ParameterA/B()` in `doc/CSBwin-src/CSB.h:927-1075`).

## 9) Local actions and delayed actuator rotation

**Local actions**:
- `localActionOnly()` routes to `PerformLocalAction()` (`doc/CSBwin-src/Mouse.cpp:222-260`).
- `PerformLocalAction()` directly handles localActionType 10 (skill increaser) and otherwise populates `DelayedActuatorAction*` globals.

**DelayedActuatorAction**:
- `RotateActuatorList()` consumes delayed action state and rotates actuator ordering at a location (`doc/CSBwin-src/Code11f52.cpp:3471-3525`).

## 10) Notable limits and guardrails

All from CSBWin source:
- **Illegal target**: `WarnIllegalTimer()` is called when room-type -> timer mapping yields 0 (`doc/CSBwin-src/Code11f52.cpp:3566-3636`).
- **DSA activation level**: `ActivateDSA()` only handles the loaded level and calls `NotImplemented` otherwise (`doc/CSBwin-src/Timer.cpp:1465-1525`).
- **Counter increment guard**: counters do not increment when value is zero (`doc/CSBwin-src/Timer.cpp:1589-1665`).
