# CSBWin DSA Reference (Sourced)

This document captures verified DSA behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## DSA loading

- `DSA::Read` loads `description[80]`, `state`, `localState`, `groupID`, `numState`, and `firstDisplayedState`, then reads only the non-empty states; `DSAState::Read` enforces `numAction <= 12` (`doc/CSBwin-src/DSA.cpp`).

## Program words and `&` operations

- A command's relative-state field is followed by a 16-bit state word only when `IsMaxState()`, which every command class defines as `nextState == -MAXSTATE` (`doc/CSBwin-src/Data.h:1889-2384`). `QUESTION`'s `MAXSTATE` is 2, so a field of -2 takes the word. Every other `MAXSTATE` is the field's most negative value (-8, -32, -16, -512, -4), whose negation the signed field cannot hold, so those commands never read one. Conflux 3.5's 4646 programs decode to their exact lengths with this layout (`tools/dump-dsa-census.ts`). The state word is read unsigned (`m_PC` is a `ui16 *`, `doc/CSBwin-src/DSA.cpp:250`) but in `LOAD`, `VARIABLESTORE`/`FETCH` and `GLOBALSTORE`/`FETCH`, which cast it to `i16`; `QUESTION`'s word is unsigned (`:858-866`).
- Every other operand word is unsigned too: `LOAD_INTEGER` (26) pushes its word as it is (`:1099-1106`), and a message's explicit delay is the word (`:662`). `LOAD` 29 (`LOAD_ABS32`) and 31 say "Illegal DSA load command" and push nothing (`:1138-1143`). A `STORE` above 25 (`:1328-1332`) and an `OVERRIDE` whose `what` is not 1 (`:1045-1058`) return before they set the next state, and the `STORE` pops nothing. `GLOBALFETCH` past the last variable pushes `0xcdcdcdcd` (`:1302-1306`). `tools/dump-dsa-decoder.ts` runs each.
- `STKOP` (`doc/CSBwin-src/Data.h:1721-1861`) has 138 values, 0 to 126 and 129 to 139. `EX_AMPERSAND` has a case for each but three: `STKOP_I_Indirect` is unpacked before the switch (`doc/CSBwin-src/DSA.cpp:2345-2391`) and then runs as the operation it carries; `STKOP_Noop` (0) and `STKOP_2Dup` (23) reach the default, which says "Illegal subcode in EX_AMPERSAND" and returns (`doc/CSBwin-src/DSA.cpp:4979-4981`). So 136 are operations.

## STKOP character operations

- An index of 4 is the hand's owner, `d.HandChar`, in `&CHPOSS`, `&MASTERY`, `&CHAR@`, `&CHAR!`, `&TALENTS@` and `&TALENTS!`; in `&ISCARRIED` 4 is the hand's owner and 5 every champion (`doc/CSBwin-src/DSA.cpp:1613-1641`). An index with bit 16 set names a champion in the wings by fingerprint, in `&CHAR@` (zeros when the wings hold nobody), `&TALENTS@` (0) and `&TALENTS!` (nothing) (`:4166-4347`).
- `&PARTY@` writes `NumCharacter`, `partyLevel`, `partyX`, `partyY`, `partyFacing`, `PartySleeping`, `SeeThruWalls`, `MagicFootprintsActive`, `HandChar`, `Invisible`, `FireShield`, `SpellShield` (`:4127-4165`). `&CHAR@` writes 59: facing, food, `HP - PendingDamage` (at least 0), load, mana, ouches, charPosition, shieldStrength, stamina, water, the seven attributes as `minimum << 16 | maximum << 8 | current`, the twenty skills as (tempAdjust, experience) pairs, fingerprint, talents (`:4166-4241`). Both write nothing when `index + num`, unsigned, passes 100.
- `&CHAR!` writes back only food and water (clamped to -1023..2048), HP, mana and stamina (clamped to 0..their maximum), the attributes and the talents, and refuses the potential champion (`:4426-4541`). The HP variable is first clamped to 0..`MaxHP` in the variable itself; below `HP - PendingDamage` it sets `PendingDamage = HP - value`, otherwise `HP = value + PendingDamage`, and a champion whose `HP - PendingDamage` is not above 0 keeps both.
- `&CHPOSS` pushes -1 for an empty slot; a negative champion is the hand, a champion above 4 is 0, a slot above 29 slot 0 (`:3330-3357`). A champion slot from 0 to 3 past the party is read from the record left there: zeros at every start, so 0 (`doc/PROVEN_FACTS.md` → "A `CHARDESC` slot past the party holds zeros, or the champion who left it"). `&MASTERY`'s flags 1 and 2 are `DetermineMastery`'s 0x4000 and 0x8000, and a champion or skill out of range is 0 (`:3389-3410`).
- `&WHEREISCHAR` is the last party index with the fingerprint, else 5 when `EXPOOL` holds a 25-longword record under `EDT_Character << 24 | fingerprint`, else 4 (`:4383-4412`). `&WHOHASTALENT` sets bit `chIdx` for each champion holding every talent asked (`:4363-4382`). `&COUNTINJURY` counts the masked `ouches` bits of the living champions in the champion mask (`:4798-4818`).
- `&ISCARRIED` with an object ID pushes `256 * chIdx` plus its slot, 255 for the hand, or -1, and searches a chest's contents, which report the chest's slot; with a negative ID, a basic object type (-1 for type 0), it pushes how many are carried (`:1520-1641`).
- `&EXPERIENCE+` calls `AddToSkill` for a living champion, which adds `(UI16)(experience)` to the skill and to its basic skill (`doc/CSBwin-src/Magic.cpp:360-442`). `&CAUSEPOISON` is `PoisonCharacter` (`DSA.cpp:4348-4362`). `tools/dump-dsa-characters.ts` runs each of these.

## STKOP object operations

- `&CHARGES@`, `&CURSE@`, `&BROKEN@`, `&POISONED@` and `&SUBTYPE@` pop a slot index and push the field of the object there, 0 for an index `checkIndirectIndex` refuses or a database without the field (`doc/CSBwin-src/DSA.cpp:3411-3439`, `:3458-3483`, `:3511-3536`, `:3564-3595`, `:3629-3651`). Charges are a weapon's (`DB5` bits 10-13) and a garment's (`DB6` bits 9-12), a potion's strength (`DB8` bits 0-7) and a misc object's `value()` (`DB10` bits 14-15). A curse is a weapon's, a garment's or a misc object's bit 8; breakage a weapon's bit 14 or a garment's bit 13; poison a weapon's bit 9 alone (the garment arm is commented out); a subtype a misc object's bits 9-13 alone (`doc/CSBwin-src/CSB.h:1141-1310`).
- The five setters pop the value, then the slot, and write the same fields, cut to the field's width by `SETWBITS` (`CSB.h:746-774`); a flag is set by any non-zero value (`DSA.cpp:3440-3457`, `:3484-3510`, `:3537-3563`, `:3596-3628`, `:3652-3675`). `&CURSE!` is `SetCursed`, which brackets the bit with `AdjustStatsForItemCarried`'s -1 and +1 on the bearer, through a slot that is right only for the last champion (`doc/PROVEN_FACTS.md` → "`AdjustStatsForItemCarried`"). `tools/dump-dsa-objects.ts` runs each.

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
