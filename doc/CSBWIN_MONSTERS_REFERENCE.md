# CSBWin Monster Reference (Sourced)

This document captures verified monster behaviour from the CSBWin C++ source under
`doc/CSBwin-src/` — chiefly `Monster.cpp`, `Attack.cpp`, and the monster-lifecycle
helpers that live in `CSBCode.cpp`.

It is written as Phase 12 is ported, and it says what has been *verified*, not what
has been implemented. Anything not yet confirmed against the C++ is absent rather
than guessed.

## Data model

### `MONSTERDESC` — the per-type descriptor

27 records of 26 bytes each, in `graphics.dat` item `0x22f`, at `d.MonsterDescriptor`
(`doc/CSBwin-src/Data.h:1076`, struct at `doc/CSBwin-src/CSB.h:2256`).

| Offset | Field | Notes |
| --- | --- | --- |
| 0 | `uByte0` | The entry's own index, i.e. the monster type number |
| 1 | `attackSound` | Sound ordinal; non-zero makes `MonsterAttacks` play a sound |
| 2 | `word2` | Size, material and immunity flags |
| 4 | `word4` | Which graphics exist, and the mirroring rules |
| 6 | `movementTicks06` | Ticks per move; `255 - this` goes into `TIMER.uByte5` |
| 7 | `attackTicks07` | |
| 8 | `defense08` | |
| 9 | `baseHealth09` | Base HP; `CreateMonster` adds `Random(baseHealth09/4 + 1)` |
| 10 | `attack10` | |
| 11 | `poisonAttack11` | |
| 12 | `dexterity12` | Compared against a champion's quickness |
| 13 | `unused13` | |
| 14 | `word14` | Sight and smelling distance |
| 16 | `word16` | Bravery |
| 18 | `word18` | Fire and poison resistance |
| 20 | `word20` | Attack/move delay increments |
| 22 | `uByte22[4]` | |

Six fields are byte-swapped on load — `word2`, `word4`, `word14`, `word16`, `word18`,
`word20` (`fixItem26`, `doc/CSBwin-src/CSBCode.cpp:10042`). Everything else is a
plain byte. `LE16` on a little-endian host is a byte swap, so these are big-endian in
the file like the rest of the Atari-derived data.

**One fixup precedes the swap:** a `movementTicks06` of zero is forced to 1, with a
message box (`doc/CSBwin-src/CSBCode.cpp:10163-10173`).

`word2` bits (`doc/CSBwin-src/CSB.h:2268-2296`):

| Bits | Accessor | Meaning |
| --- | --- | --- |
| 0-1 | `horizontalSize()` | 0 = one corner, 1 = two corners (worm), 2 = the whole cell (dragon) |
| 2 | `See360()` | Can see in all directions |
| 3 | `word2Bit3()` | Tested when checking for `Blocked` |
| 4 | `word2Bit4()` | Unknown |
| 5 | `levitating()` | Cannot fall through a pit |
| 6 | `nonMaterial()` | Immune to everything but the Dispell missile; passes through doors |
| 7-8 | `verticalSize()` | Size when passing through a door |
| 9 | `leavesDroppings()` | As worm rounds do |
| 10 | `absorbsDaggersEtc()` | Absorbs arrows, slayers, darts, stars, daggers |
| 11 | `seesInvisible()` | |
| 12 | `canSeeInDark()` | |
| 13 | `invincible()` | Impervious to damage |

`word4` (`MONSTERDESC_WORD4`, `doc/CSBwin-src/CSB.h:2232-2253`) says which sprites
exist — `HasSideGraphic` 0x0008, `HasBackGraphic` 0x0010, `HasAttackGraphic` 0x0020 —
plus `NonAttackingMirrorOK` 0x0004 and `AttackingMirrorOK` 0x0200.

`word14`/`word16`/`word18`/`word20` bitfields (`doc/CSBwin-src/CSB.h:2348-2362`):

- `sightDistance()` = `word14` bits 0-3, **halved for each level of darkness**.
- `smellingDistance()` = `word14` bits 8-11, compared against distance to prey.
- `bravery()` = `word16` bits 4-7; 15 means never afraid, and it is also the
  resistance to WAR CRY, CALM, BRANDISH and BLOW HORN.
- `FireResistance()` = `word18` bits 4-7, `PoisonResistance()` = bits 8-11.
- `AdditionalDelayFromMoveToAttack()` = `word20` bits 4-7,
  `AdditionalDelayFromAttackToMove()` = bits 8-11.

### `DB4` — the per-group record in `dungeon.dat`

16 bytes (`doc/CSBwin-src/CSB.h:1075-1139`). Two fields are dual-purpose, and both
were being misread by this port before Phase 12:

- **`uByte4`** packs `monsterType()` in bits 0-4 and `alternateGraphics()` in bits
  5-7 (`doc/CSBwin-src/CSB.h:1113-1116`). The type *must* be masked to 5 bits before
  it indexes `MonsterDescriptor[27]`.
- **`uByte5` / `groupIndex()`** is the `ITEM16` slot index while the group is on the
  party's level, and *is* the four packed 2-bit member positions otherwise. The two
  readings are swapped by `AttachItem16ToMonster` and `DetachItem16`.

`word14` at offset 14 holds `fear()` in bits 0-3, `numMonM1()` in bits 5-6 (group
size **minus one**), `facing()` in bits 8-9, `important()` bit 10, `invisible()` bit
11, `drawAsSize4()` bit 12, `Unique()` bit 13 and `Poisoned()` bit 14.

`invisible()`, `drawAsSize4()`, `Unique()` and `Poisoned()` are each gated on a
global design option read from the save game's extended-features block —
`InvisibleMonsters` = 0x02 and `DrawAsSize4Monsters` = 0x04 in `extendedFlags`
(`doc/CSBwin-src/CSB.h:494-496`, set at `doc/CSBwin-src/SaveGame.cpp:394-400`). Both
default to false, so plain Dungeon Master never sees them.

`STATE_OF_FEAR` (`doc/CSBwin-src/CSBTypes.h:164`) has no state 1. A giggler that has
just stolen something is put into state 5, and `DetachItem16` resets any state ≥ 4
back to 0 (`doc/CSBwin-src/CSBCode.cpp:6129`).

### `ITEM16` — the per-group runtime slot

16 bytes (`doc/CSBwin-src/CSB.h:2190-2227`), one per monster group **on the loaded
level only**. This is where all the live movement state lives:

| Offset | Field | Meaning |
| --- | --- | --- |
| 0 | `word0` | DB4 index of the group; **`-1` marks a free slot** |
| 2 | `facing_2` | Four 2-bit fields, one per group member |
| 3 | `pos_3` | Four 2-bit positions within the cell |
| 4 | `uByte4` | Low byte of the next update time |
| 5 | `uByte5` | Pause countdown (a giggler gets `Random(64) + 20`) |
| 6-7 | `uByte6`, `uByte7` | mapX / mapY of the square being approached |
| 8-9 | `ubPrevX`, `ubPrevY` | Previous mapX / mapY |
| 10-11 | `uByte10`, `uByte11` | Current mapX / mapY |
| 12-15 | `singleMonsterStatus[4]` | Per-member status byte |

`word0` is the one swapped field, byte-swapped on load from a save game
(`doc/CSBwin-src/SaveGame.cpp:486`).

`SINGLE_MONSTER_STATUS` (`doc/CSBwin-src/CSB.h:2171-2188`): bit 7 = attacking, bit 6
= mirror the sprite, bits 0-2 and 3-5 are two signed 2-bit screen offsets applied
while the monster walks. Bit 6 is set or cleared on a coin flip in
`MonsterUpdateTime`; bit 7 is cleared when the movement timers are removed.

## Group lifecycle

`ProcessMonstersOnLevel` (`doc/CSBwin-src/CSBCode.cpp:6169`) is the bootstrap. It
walks every cell of the loaded level, and for each cell whose flags have bit 16 set
(has objects) it finds the **first** monster in the chain and does three things in
order:

1. `DeleteMonsterMovementTimers(mapX, mapY)` — drop any timers of type 29-41 there.
2. `AttachItem16ToMonster(objD5, mapX, mapY)` — claim an `ITEM16` slot.
3. `StartMonsterMovementTimers(mapX, mapY)` — schedule the group's first AI timer.

It then `break`s out of the chain: **one monster group per cell.**

`AttachItem16ToMonster` (`doc/CSBwin-src/CSBCode.cpp:6024`) linear-scans for the
first slot with `word0 < 0`, growing the array by 50 (capped at 1050) if it runs out.
Then, in order: `word0 = monster index`; `positions() = pDB4->groupIndex()` (saving
the packed positions the DB4 was carrying); `groupIndex(item16Index)` (the DB4 now
holds the slot number); `uByte10`/`ubPrevX` = mapX and `uByte11`/`ubPrevY` = mapY;
`uByte4 = d.Time - 127` (about 20 seconds); every member's facing set from
`pDB4->facing()`; every `singleMonsterStatus` cleared; and finally
`NextMonsterUpdateTime(pi16A2, -1, false)`.

`DetachItem16` (`doc/CSBwin-src/CSBCode.cpp:6117`) reverses it: `groupIndex()` gets
the packed positions back, `facing()` gets the packed facings, any fear state ≥ 4 is
reset to 0, and `word0` goes back to `-1`.

`EnsureItem16Available` (`doc/CSBwin-src/Monster.cpp:83`) grows the array by 50 when
fewer than 5 slots remain **and** the loaded level is the party's, capped at 240 —
note this is a different cap from `AttachItem16ToMonster`'s 1050.

`CreateMonster` (`doc/CSBwin-src/Monster.cpp:111`) takes `value` (monster type in
bits 0-4, alternate graphic in bits 5-6), a hit-point multiplier, `numMonM1`, facing
and a map square. It clamps `numMonM1` to 1 for a size-1 monster and to 0 for a
size-2 one, both with a message box. HP per member is
`baseHealth09 * hitPointMultiplier + Random(baseHealth09/4 + 1)`. Positions are
assigned from a random start (`STRandom0_3()`), advancing by 2 rather than 1 for a
size-1 monster. It finishes with `MoveObject`, which is what actually attaches the
`ITEM16`, and a `soundTELEPORT`.

A monster **not** on the party's level has its `groupIndex` parked at `0xd8`, or
`0xff` if it fills the whole cell (`doc/CSBwin-src/MoveObject.cpp:517-518`, and the
same for a DSA-copied monster at `doc/CSBwin-src/DSA.cpp:1884-1887`). This is what
makes CSBWin's bare `groupIndex() < d.MaxITEM16` test
(`doc/CSBwin-src/Monster.cpp:531`) a valid "is an `ITEM16` attached?" check.

## AI timers

`TIMERTYPE` 29-41 are the monster AI (`doc/CSBwin-src/CSB.h:1765-1779`):

| Value | Name | Meaning |
| --- | --- | --- |
| 29-31 | `TT_29`..`TT_31` | Movement wake-ups; `TT_31` = the party ran into the monster |
| 32 | `TT_MONSTER_Agroup` | The "A" attack group |
| 33-36 | `TT_MONSTER_A0`..`A3` | The four "A" individuals |
| 37 | `TT_MONSTER_Bgroup` | The "B" attack group |
| 38-41 | `TT_MONSTER_B0`..`B3` | The four "B" individuals |

`ProcessTimers` routes the whole span to `ProcessTimers29to41(uByte6, uByte7,
Function(), uByte8)` before its own switch statement
(`doc/CSBwin-src/CSBCode.cpp:6422-6429`) — so the monster AI never reaches the
ordinary timer dispatch.

Three negative pseudo-types exist that never sit on the queue
(`doc/CSBwin-src/CSB.h:1743-1745`). `ProcessTimers29to41` rewrites its incoming
function code into one of them to record *why* it woke: `TT_M1` = monster attacked or
bumped into, `TT_M2` = monster damaged, `TT_M3` = monster damaged by a cloud or a
door. `InitialChecks` maps `TT_M3` back to `TT_29`
(`doc/CSBwin-src/Monster.cpp:3022`).

## Attack tables

Everything the champion attack pipeline needs is in `graphics.dat` item `0x230`,
immediately after `Byte20194[16]` (the ShrinkBLT colour map) and immediately before
`Spells[25]` (`doc/CSBwin-src/Data.h:638-651`). Seven parallel 44-entry signed-byte
tables indexed by `ATTACKTYPE`, then `AttackNames[300]`, then `legalAttacks[44]`:

| Table | Use |
| --- | --- |
| `experienceForAttacking[44]` | `ATTACKPARAMETERS.experienceGained` (`Attack.cpp:1730`) |
| `SkillNumber[44]` | Which skill the attack requires and trains |
| `Byte20090[44]` | Assigned to `CHARDESC.word64` for the attack (`Character.cpp:4970`) |
| `Byte20046[44]` | Base stamina cost, `+ STRandomBool()` (`Attack.cpp:1721`) |
| `Byte20002[44]` | The "D6W" factor into `DeterminePhysicalAttackDamage` (`Attack.cpp:1131`) |
| `Byte19958[44]` | The "D7W" factor, likewise (`Attack.cpp:1137`) |
| `Byte19914[44]` | `ATTACKPARAMETERS.disableTime` (`Attack.cpp:1714`) |

`AttackNames[300]` is a **NUL-separated** list indexed by attack type;
`GetAttackTypeName` walks forward over `n` terminators rather than indexing
(`doc/CSBwin-src/CSBCode.cpp:8609`). Note this differs from `ObjectNames`, which
terminates each entry with a high bit instead.

`ATTACKTYPE` (`doc/CSBwin-src/CSB.h:574`) has 44 entries. Three are marked "Not in
CSB" — `atk_JUGGLE` (0), `atk_SPEED` (3) and `atk_PRAY` (26) — and the names really
are stored as `"N"` and `"X"` in the graphics file, which is a useful confirmation
that the offsets above are right.

`LEGALATTACKS` is 8 bytes (`doc/CSBwin-src/Data.h:225`), one per attack class, read
by `GetLegalAttackTypes` (`doc/CSBwin-src/Character.cpp:4769-4808`):

- byte 0 — the always-legal attack, copied to `PossibleAttackTypes[0]` unconditionally.
- bytes 1-2 — two optional attacks, 255 meaning absent.
- bytes 4-5 — the mastery each of those needs. **Bit 7 means the wielded item must
  have charges left** (`ItemHasChargesLeft`, `doc/CSBwin-src/Character.cpp:4744`);
  the remaining bits are compared against `DetermineMastery`.
- byte 6 — read into `d.Word20262` and, in CSBWin's own words, "Not used anywhere!!"
  (`doc/CSBwin-src/Character.cpp:4932`). It looks like a skill number.
- bytes 3 and 7 — always zero in the shipped data.

`PrepareAttack` (`doc/CSBwin-src/Character.cpp:4904`) picks the class from
`ObjDesc[weapon.DescIndex()].AttackClass()`, and falls back to **class 2** for an
empty weapon hand. A class of 0 means the item affords no attack at all and the
click is ignored. It refuses outright if the champion has `CHARFLAG_attackDisable`
set or zero HP.

Verified from the shipped `graphics.dat`, as a check on all of the above: class 2 is
`PUNCH / KICK / WAR CRY`, class 27 is `SHOOT` alone (a bow), class 36 is `BLOW HORN`,
class 39 is `CLIMB DOWN` (a rope) and class 1 is `INVOKE / FUSE / FLUXCAGE` (the Ra
key). `Byte20002` and `Byte19958` are non-zero exactly for the physical attacks,
matching CSBWin's comment at `doc/CSBwin-src/Attack.cpp:1131`.
`tools/dump-monster-tables.ts` prints all of it.

## Monster stats in the shipped data

From `tools/dump-monster-tables.ts` against Dungeon Master's `graphics.dat`, as a
sanity check on the `MONSTERDESC` layout: type 15 (Worm) has `horizontalSize` 1 (two
corners); type 24 (Dragon) has `horizontalSize` 2 (the whole cell) with `baseHealth`
and `attack` both 255; types 23 (Lord Chaos), 25 and 26 (Grey Lord) share one
identical row and are the only `invincible` monsters; types 8, 11, 19 and 20 are the
`nonMaterial` ones.
