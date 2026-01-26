# CSBWin DSA Reference (Sourced)

This document captures verified DSA behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## DSA loading

- `DSA::Read` loads `description[80]`, `state`, `localState`, `groupID`, `numState`, and `firstDisplayedState`, then reads only the non-empty states; `DSAState::Read` enforces `numAction <= 12` (`doc/CSBwin-src/DSA.cpp`).

## Timers and selector resolution

- `ProcessDSATimer6` resolves the slave DSA by mapping `DB3::DSAselector()` through `DSALevelIndex[level][selector]`, computes `inputMsgType = 3 * timerPosition + timerTypeModifier[timerUByte9]`, executes the DSA, and writes the resulting state back via `GetState`/`PutState` (`doc/CSBwin-src/DSA.cpp`).
- `QueueDSASwitchAction` maps target room type via `Byte1596` and queues `TT_DESSAGE` when `MorD != 'M'`; non-stone/falsewall targets force `targetPos = 0` (`doc/CSBwin-src/DSA.cpp`).

## STKOP cell operations

- `STKOP_CellFetch` packs room data into a variable array: slot 0 is `roomType`, slot 1 encodes room attributes (room-type specific), and slot 2+ contain teleporter facing/what/dest or door state/type/decoration when present (`doc/CSBwin-src/DSA.cpp`).
- `STKOP_CellStore` writes room attributes back to `CELLFLAG` and updates teleporter/door fields (rotation, scope, door switch/mode, etc.) with guard rules for door state transitions (bashed/open) (`doc/CSBwin-src/DSA.cpp`).
- `STKOP_FalsePit` toggles bit 0 on pit `CELLFLAG` when the location is valid and room type is PIT (`doc/CSBwin-src/DSA.cpp`).

## Generator delay helpers

- `STKOP_GeneratorDelayStore` locates the first monster generator (type 6) in an open room and writes its disable time (falling back to a disabled type 0 actuator if present); `STKOP_GeneratorDelayFetch` reads the disable time for the first type 6 generator (`doc/CSBwin-src/DSA.cpp`).

## EX_ADD and EX_DEL

- `EX_ADD` validates negative destinations (`-1` cursor empty, `-100..-999` character slot empty, `<= -1000` monster RN = `-location/1000`) and positive destinations by bounds only, clones the object via `CopyItem`, sets `mostRecentInterestingObjectID` to the new RN, and for cell placement chooses a random position from `posMask` bits before calling `MoveObject(newObj, -1, 0, x, y)` and setting `newObj.pos(p)` (`doc/CSBwin-src/DSA.cpp`).
- `EX_DEL` ignores `objID` for negative locations (cursor/character slot), but for positive locations it removes only the matching RN and only for `dbACTUATOR`, `dbMISC`, `dbPOTION`, `dbWEAPON`, or `dbCLOTHING`, then queues DB deletion (and deletes scroll text records separately) (`doc/CSBwin-src/DSA.cpp`).

## DSA MoveObject restrictions

- DSA `MoveObject` uses source/destination types `{1=cell,2=cursor,3=monster,4=character,5=chest}`, validates source first (positive error codes) and destination second (negative error codes), enforces `dstDepth == 0` for cell/chest/monster, blocks clouds, checks chest ownership (character possession), limits chest contents to 8 items, and validates character slots using `ObjDesc[descIndex].word4` vs `CarryLocation[slot]` (`doc/CSBwin-src/MoveObject.cpp`).
