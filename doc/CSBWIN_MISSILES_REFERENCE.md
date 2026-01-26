# CSBWin Missile System Reference (Sourced)

This document captures verified missile behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Timer encoding and lifecycle

- `MissileTimer` stores `mapX` in bits `0..4`, `mapY` in bits `5..9`, direction in bits `10..11`, and `deltaEnergy` in bits `12..15` of `timerWord8` (`doc/CSBwin-src/Timer.cpp`).
- `TT_Missile0` is converted to `TT_Missile` on first tick; it checks party/monster hits via `ProcessMissileEncounter(-2/-1, ...)`, reduces `rangeRemaining`/`damageRemaining` by `deltaEnergy`, and if `rangeRemaining <= deltaEnergy` it calls `MissileEncounterFilter(5, ...)`, removes the missile, and `ProcessObjectFromMissile` (`doc/CSBwin-src/Timer.cpp`).

## Movement and collision

- A missile leaves the cell when `missileDirection == pos` or `((missileDirection + 1) & 3) == pos` (`doc/CSBwin-src/Timer.cpp`).
- When leaving, it tests the next cell for `roomSTONE`, `roomFALSEWALL` (solid), `roomSTAIRS` (only blocks if current cell is also stairs), or `roomEXTERIOR`, and calls `ProcessMissileEncounter(nextRoomType, ...)` before moving (`doc/CSBwin-src/Timer.cpp`).
- Door collisions while the missile stays inside a door cell call `ProcessMissileEncounter(roomDOOR, ...)`; on a successful hit it deletes the missile, otherwise it re-adds it to the room at the new position (`doc/CSBwin-src/Timer.cpp`).
- `MoveObject` sets missile direction from the missile timer word8, teleports missiles through active teleporters via `TeleportMissile`, and treats missiles as levitated so pits do not affect them (`doc/CSBwin-src/Code11f52.cpp`).

## Encounter resolution

- `ProcessObjectFromMissile` moves the projectile into a destination list when `pDest` is non-null (monster possessions), otherwise moves the projectile into the room at the missile position, and then deletes the missile record (`doc/CSBwin-src/Timer.cpp`).
- `ProcessMissileEncounter` converts thrown potions (`dbPOTION`) of type Ven Potion and Ful Bomb into `RNPoisonCloud` or `RNFireball` using potion strength, and treats magic projectiles as `dbCLOUD` (with `nonPoison_Spell` set for cloud types other than poison/poison bolt) (`doc/CSBwin-src/Code11f52.cpp`).
- Door logic: a Zo spell on a door with a switch queues `TT_DOOR`; doors with `doorstate == 5` or `<= 1` allow passage; for some door types (`DoorTOC` high byte with bit `0x02`) missiles can pass based on `rangeRemaining`, `ObjDesc.word4 & 0x100` (fits in pouch), and `!IsAKey()` (`doc/CSBwin-src/Code11f52.cpp`).
- Monster logic: non-material monsters ignore missiles except `RNDispellMissile`; `RNFireball` heals `mon_BlackFlame`; if a monster absorbs daggers/arrows/etc then it sets `pobj_24 = DBmon->pPossession()` so the projectile is linked into monster inventory when the missile is processed (`doc/CSBwin-src/Code11f52.cpp`).

## Additional helpers

- `CheckMoveFromMissile` is called from `MoveObject` for party/monster movement; it scans missiles in the cell being vacated (skipping `TT_Missile0`) and calls `ProcessMissileEncounter(-2/-1, ...)` using the leaving occupant position, deleting the missile timer if a hit occurs (`doc/CSBwin-src/Code11f52.cpp`).
- `OrdinalOfMonsterAtPosition` uses `MonsterPositionByte` and `MonsterDescriptor.horizontalSize` (word2 bits 0-1); size 1 monsters occupy two adjacent positions, with orientation adjusted by `MonsterFacingByte` parity, and a positions byte of `0xFF` returns ordinal `1` (`doc/CSBwin-src/Code11f52.cpp`).
- `MissileEncounterFilter` looks up `ESL_MISSILEENCOUNTERFILTER` in `EDT_SpecialLocations`, builds a timer for the filter DSA at that location, sets `pDSAparameters[0]=7` with params `{1:defaultAction(0),2:type,3:locr.Integer(),4:missileRN,5:projectileRN,6:directionBits,7:index}`, runs `ProcessDSAFilter`, and returns `pDSAparameters[1]` (`doc/CSBwin-src/Code11f52.cpp`).
