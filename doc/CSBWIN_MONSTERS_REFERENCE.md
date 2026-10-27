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
(`doc/CSBwin-src/Data.h:1091`, struct at `doc/CSBwin-src/CSB.h:2319`).

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
`word20` (`fixItem26`, `doc/CSBwin-src/CSBCode.cpp:10166`). Everything else is a
plain byte. `LE16` on a little-endian host is a byte swap, so these are big-endian in
the file like the rest of the Atari-derived data.

**One fixup precedes the swap:** a `movementTicks06` of zero is forced to 1, with a
message box (`doc/CSBwin-src/CSBCode.cpp:10287-10297`).

`word2` bits (`doc/CSBwin-src/CSB.h:2331-2359`):

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

`word4` (`MONSTERDESC_WORD4`, `doc/CSBwin-src/CSB.h:2295-2316`) says which sprites
exist — `HasSideGraphic` 0x0008, `HasBackGraphic` 0x0010, `HasAttackGraphic` 0x0020 —
plus `NonAttackingMirrorOK` 0x0004 and `AttackingMirrorOK` 0x0200.

`word14`/`word16`/`word18`/`word20` bitfields (`doc/CSBwin-src/CSB.h:2410-2421`):

- `sightDistance()` = `word14` bits 0-3, **halved for each level of darkness**.
- `smellingDistance()` = `word14` bits 8-11, compared against distance to prey.
- `bravery()` = `word16` bits 4-7; 15 means never afraid, and it is also the
  resistance to WAR CRY, CALM, BRANDISH and BLOW HORN.
- `FireResistance()` = `word18` bits 4-7, `PoisonResistance()` = bits 8-11.
- `word20` bits 4-7 are the time a group's next turn adds when it is not attacking, and
  bits 8-11 when it is (`CSB.h`'s comment on `word20`, read at `CSBCode.cpp:6031-6040`;
  `monsterDelayFromMoveToAttack` and `monsterDelayFromAttackToMove`,
  `src/data/tables/MonsterDesc.ts`).

### `DB4` — the per-group record in `dungeon.dat`

16 bytes (`doc/CSBwin-src/CSB.h:1078-1142`). Two fields are dual-purpose, and both
were being misread by this port before Phase 12:

- **`uByte4`** packs `monsterType()` in bits 0-4 and `alternateGraphics()` in bits
  5-7 (`doc/CSBwin-src/CSB.h:1116-1119`). The type *must* be masked to 5 bits before
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
(`doc/CSBwin-src/CSB.h:494-496`, set at `doc/CSBwin-src/SaveGame.cpp:396-402`, written
back at `:972-973` and `:983-984`). Both default to false (`data.cpp:78-79`), so plain
Dungeon Master never sees them; Conflux 3.5 sets both. With them on:

- an `invisible()` creature is passed over by `DrawRoomObjects`' walk of the cell, which
  draws the last creature that is not (`doc/CSBwin-src/Code51a4.cpp:2204-2210`);
- a `drawAsSize4()` group is drawn as size 2, its positions taken as 255, so one figure,
  centred (`:420-441`, `:469`). The member drawn is `DrawSize4Index`'s (`:323-348`): 1 for a
  lone monster, else the first attacking, else the first whose facing passes
  `((facingByte ^ monsterFacing) & mask) == 0`, with `facingByte` the record's own two
  `facing()` bits, `monsterFacing` the party's facing plus 2, and both `mask` and
  `monsterFacing` shifted two bits a member, else 1;
- a missile reaching a `drawAsSize4()` group's empty corner hits member 1
  (`Code11f52.cpp:2000-2001`);
- a member of a `drawAsSize4()` group dying while another lives drops nothing
  (`:1161-1162`), and the group shows its death cloud only for its last member, size 255
  at position 255 (`:1293-1299`);
- a `Unique()` group is not deleted when a square's 31 movement timers overflow
  (`:2531`);
- `&MONSTER@` reads all four (`DSA.cpp:4022-4025`).

`STATE_OF_FEAR` (`doc/CSBwin-src/CSBTypes.h:169`) has no state 1. A giggler's steal puts
its group into state 5 one time in eight, or on a coin toss when it took something
(`doc/CSBwin-src/Monster.cpp:279-285`), and `DetachItem16` resets any state ≥ 4 back to 0
(`doc/CSBwin-src/CSBCode.cpp:6188`).

### `ITEM16` — the per-group runtime slot

16 bytes (`doc/CSBwin-src/CSB.h:2253-2290`), one per monster group **on the loaded
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
| 10-11 | `uByte10`, `uByte11` | mapX / mapY where the slot was attached — set only by `AttachItem16ToMonster` (`CSBCode.cpp:6147-6150`); a frightened group heads back there (`Monster.cpp:2277-2281`) |
| 12-15 | `singleMonsterStatus[4]` | Per-member status byte |

`word0` is the one swapped field, byte-swapped on load from a save game
(`doc/CSBwin-src/SaveGame.cpp:494`).

`SINGLE_MONSTER_STATUS` (`doc/CSBwin-src/CSB.h:2234-2251`): bit 7 = attacking, bit 6
= mirror the sprite, bits 0-2 and 3-5 are two signed 2-bit screen offsets applied
while the monster walks. Bit 6 is set or cleared on a coin flip in
`MonsterUpdateTime`; bit 7 is cleared when the movement timers are removed.

## Group lifecycle

`ProcessMonstersOnLevel` (`doc/CSBwin-src/CSBCode.cpp:6228`) is the bootstrap. It
walks every cell of the loaded level, and for each cell whose flags have bit 16 set
(has objects) it finds the **first** monster in the chain and does three things in
order:

1. `DeleteMonsterMovementTimers(mapX, mapY)` — drop any timers of type 29-41 there.
2. `AttachItem16ToMonster(objD5, mapX, mapY)` — claim an `ITEM16` slot.
3. `StartMonsterMovementTimers(mapX, mapY)` — schedule the group's first AI timer.

It then `break`s out of the chain: **one monster group per cell.**

`AttachItem16ToMonster` (`doc/CSBwin-src/CSBCode.cpp:6083`) linear-scans for the
first slot with `word0 < 0`, growing the array by 50 (capped at 1050) if it runs out.
Then, in order: `word0 = monster index`; `positions() = pDB4->groupIndex()` (saving
the packed positions the DB4 was carrying); `groupIndex(item16Index)` (the DB4 now
holds the slot number); `uByte10`/`ubPrevX` = mapX and `uByte11`/`ubPrevY` = mapY;
`uByte4 = d.Time - 127` (about 20 seconds); every member's facing set from
`pDB4->facing()`; every `singleMonsterStatus` cleared; and finally
`NextMonsterUpdateTime(pi16A2, -1, false)`.

`DetachItem16` (`doc/CSBwin-src/CSBCode.cpp:6176`) reverses it: `groupIndex()` gets
the packed positions back, `facing()` gets the packed facings, any fear state ≥ 4 is
reset to 0, and `word0` goes back to `-1`.

`EnsureItem16Available` (`doc/CSBwin-src/Monster.cpp:83`) grows the array by 50 when
fewer than 5 slots remain **and** the loaded level is the party's, capped at 240 —
note this is a different cap from `AttachItem16ToMonster`'s 1050.

`CreateMonster` (`doc/CSBwin-src/Monster.cpp:111`) takes `value` (monster type in
bits 0-4, alternate graphic in bits 5-6), a hit-point multiplier, `numMonM1`, facing
and a map square of `d.LoadedLevel`, the level its caller loaded. It returns `RNnul`
while the ITEM16 pool is full and that level is the party's (`:136-142`); a generator
off the party's level makes its group whatever the pool
(`tools/checks/monster-move-code.ts`). It clamps `numMonM1` to 1 for a size-1 monster and to 0 for a
size-2 one, both with a message box. HP per member is
`baseHealth09 * hitPointMultiplier + Random(baseHealth09/4 + 1)`. Positions are
assigned from a random start (`STRandom0_3()`), advancing by 2 rather than 1 for a
size-1 monster. It finishes with `MoveObject`, which is what actually attaches the
`ITEM16`, and a `soundTELEPORT`.

A monster **not** on the party's level has its `groupIndex` parked at `0xd8`, or
`0xff` if it fills the whole cell (`doc/CSBwin-src/MoveObject.cpp:517-518`, and the
same for a DSA-copied monster at `doc/CSBwin-src/DSA.cpp:1885-1888`). This is what
makes CSBWin's bare `groupIndex() < d.MaxITEM16` test
(`doc/CSBwin-src/Monster.cpp:531`) a valid "is an `ITEM16` attached?" check.

## AI timers

`TIMERTYPE` 29-41 are the monster AI (`doc/CSBwin-src/CSB.h:1828-1842`):

| Value | Name | Meaning |
| --- | --- | --- |
| 29-31 | `TT_29`..`TT_31` | Movement wake-ups; `TT_31` = the party ran into the monster |
| 32 | `TT_MONSTER_Agroup` | The "A" attack group |
| 33-36 | `TT_MONSTER_A0`..`A3` | The four "A" individuals |
| 37 | `TT_MONSTER_Bgroup` | The "B" attack group |
| 38-41 | `TT_MONSTER_B0`..`B3` | The four "B" individuals |

`ProcessTimers` routes the whole span to `ProcessTimers29to41(uByte6, uByte7,
Function(), uByte8)` before its own switch statement
(`doc/CSBwin-src/CSBCode.cpp:6481-6488`) — so the monster AI never reaches the
ordinary timer dispatch.

Three negative pseudo-types exist that never sit on the queue
(`doc/CSBwin-src/CSB.h:1806-1808`). `ProcessTimers29to41` rewrites its incoming
function code into one of them to record *why* it woke: `TT_M1` = monster attacked or
bumped into, `TT_M2` = monster damaged, `TT_M3` = monster damaged by a cloud or a
door. `InitialChecks` maps `TT_M3` back to `TT_29`
(`doc/CSBwin-src/Monster.cpp:3026`).

## Perception and movement

Ported in `src/engine/MonsterPerception.ts`. The two wall predicates differ in exactly
one way: `BlockedTypeA` (`doc/CSBwin-src/Monster.cpp:294`) treats an almost-closed or
closed door as a wall unless its `DoorTOC` entry has bit 8 set, while
`StoneOrClosedFalseWall` (`:354`) ignores doors entirely. Sight uses the first, smell
the second — so a monster can smell you through a closed door but not see you.

`TestDirectPathOpen` (`:375`) walks *from the party towards the monster*, keeping the
slope of the line as constant as it can. At each step it computes what the slope would
become after a step in x and after a step in y, and takes whichever deviates less;
slopes are scaled by 64 with integer division, and the truncation is part of the
result. If the chosen cell is blocked it gives up, except on an exact tie of the two
deviations, which earns one retry along the other diagonal. A perfect diagonal is a
separate branch: both orthogonal neighbours must be blocked *and* the diagonal cell
itself before the path is refused.

`Blocked` (`:518`) is misnamed — it returns the distance to the party when the party
**can** be seen, and 0 otherwise. See `doc/PROVEN_FACTS.md` for the facing
de-duplication, the darkness penalty, and the cone geometry.

`PossibleMove` (`:635`) runs its tests in a fixed order that matters: bounds, the DSA
move-inhibit flags, room type (stone/stairs/pit/false-wall), then the Fluxcage scan
for invincible monsters, then teleporter willingness, then the party's square, then
doors, and only then whether another monster is already there. It answers through six
`d.` globals rather than a return value, gathered into `MoveProbe` in the port.

The footprint trail that feeds smelling is `src/engine/PartyFootprints.ts` — see the
two `PROVEN_FACTS.md` entries on `AddFootprintEntry`, which CSBWin's own author
describes as broken but which is the only writer of the age bytes smelling reads.

## Moving a group

`MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:2831-3459`), ported as
`MonsterSystem.moveMonster`. In order:

1. If the group is leaving a real square on the party's level, `CheckMoveFromMissile`
   runs first — a missile sitting in that square gets its encounter as the group
   walks out of it. If that removed the group, the move returns 1.
2. The destination goes through the same cell-effect resolution the party uses, so
   teleporter chains and pit falls apply identically. A monster teleport also rotates
   the group's facings and positions (`TeleportMonster`, `:2343`), through the `ITEM16`
   of the level the group is attached to. A fall hurts the group at its old square
   with the death deferred; if all of it died, the loop stops.
3. A group the fall killed, or one on a level its type may not live on, is deleted:
   remains at the new square, `DeleteMonster` at the old (`:3182-3211`).
4. The group is lifted off its old square (pads released). If the resolved destination
   holds the party or another monster, it is parked in abeyance rather than placed.
5. Otherwise, crossing on or off the party's level attaches or detaches the `ITEM16`,
   the group is set down (pads pressed), and the AI timers are started and the old
   square's dropped when the value is non-zero. Nothing re-aims the group's other
   timers, and the slot's `uByte10`/`uByte11` and `ubPrevX`/`ubPrevY` are not touched.

The value it returns decides what the caller does next: the AI and a DSA go on only when
it is 0. See `doc/PROVEN_FACTS.md` → "What `MoveObject` returns for a monster, and the AI
stops on anything but 0", and the entries on the abeyance mechanism and Lord Chaos's
escape from a walled-in corner, on which AI timers are re-aimed, and on what
`item16Attached` actually tests.

## Damage and death

Ported in `src/engine/MonsterDamage.ts`. `DamageMonster`
(`doc/CSBwin-src/Code11f52.cpp:1089`) returns one of three results —
`NO_MONSTER_DIED`, `SOME_NOT_ALL_MONSTERS_DIED`, `ALL_MONSTERS_DIED`
(`doc/CSBwin-src/CSB.h:2987`) — and has four callers: the missile system, the AI gate
`InitialChecks`, champion melee (`Attack.cpp:503`) and cloud damage
(`Timer.cpp:524`).

Two early exits take no damage at all: an `invincible()` monster type, and a member
whose hit points are exactly `0xffff`. A member dies when `hp <= damage`; below that,
the write-back only happens for strictly positive damage, so a zero-damage call is a
pure liveness probe — which is precisely how `InitialChecks` uses it.

The whole-group death path drops remains, deletes the monster and frees its `ITEM16`.
The single-member path is the subtle one: survivors are compacted down over the dead
member across five parallel structures at once. See `doc/PROVEN_FACTS.md` for that,
for the fear-state-6 gate on timer renumbering, for how the group timer survives the
renumbering by arithmetic rather than by an explicit test, and for the range-split
encoding of `MonsterDroppings`.

`DropMonsterRemains` (`:865`) takes an explicit `monsterAttachedToLevel` because of a
bug CSBWin fixed: a monster teleported onto a level its type is not allowed on dies
*there*, so `d.LoadedLevel` is the destination and reading the position byte with it
would consult an `ITEM16` belonging to a different level.

## Attacking the party

Ported in `src/engine/MonsterAttack.ts`. `MonsterAttacks`
(`doc/CSBwin-src/Monster.cpp:948`) is a *decision* about how to attack, expressed as
a parameter block the Monster Attack Filter DSA may rewrite before anything happens —
see `doc/PROVEN_FACTS.md` for that, for which monsters throw what, for the two
independent chances to avoid a blow, for the many-stage damage formula, and for how
wounds accumulate.

The champion side, `src/engine/ChampionDamage.ts`, is `MonsterDamagesCharacter` (`:4531`) → `DamageCharacter`
(`doc/CSBwin-src/Character.cpp:2708`), which only adds to `d.PendingDamage`; the tick's
`DisplayCharacterDamage` (`doc/CSBwin-src/CSBCode.cpp:7143`) takes it off the HP and calls
`KillCharacter` (`Character.cpp:2531`) (`doc/PROVEN_FACTS.md` → "`DamageCharacter` only
adds to `d.PendingDamage`"). `DamageCharacter`'s
`P4` selects the mitigation: 1 fire, 5 spell, 6 wisdom-scaled, 2 half armour, anything
else full armour, 0 no mitigation and no wounds at all. Its value comes from
`MONSTERDESC.uByte22[2]`, which is non-zero for every shipped monster except the
Giggler.

Armour is `TAG01680a` (`doc/CSBwin-src/Character.cpp:2396`) averaged over every body
part the blow could land on. It combines shields held in either hand — weighted per
body part by `Byte1412`, so a shield covers some parts far better than others — a
vitality-scaled random term, the champion's shield spell, the party shield, the
temporary modifier the champion's *own* attack type imposes, and the garment worn on
the struck part. A wounded part then loses `STRandom0_3() + 8`, a sleeping party's
total is halved, and the result is halved again and held to 0-100 (`:2483-2491`;
`doc/PROVEN_FACTS.md` → "`TAG01680a`: a wounded part and a sleeping party are less
protected").

## Attack tables

Everything the champion attack pipeline needs is in `graphics.dat` item `0x230`,
immediately after `Byte20194[16]` (the ShrinkBLT colour map) and immediately before
`Spells[25]` (`doc/CSBwin-src/Data.h:647-660`). Seven parallel 44-entry signed-byte
tables indexed by `ATTACKTYPE`, then `AttackNames[300]`, then `legalAttacks[44]`:

| Table | Use |
| --- | --- |
| `experienceForAttacking[44]` | `ATTACKPARAMETERS.experienceGained` (`Attack.cpp:1730`) |
| `SkillNumber[44]` | Which skill the attack requires and trains |
| `Byte20090[44]` | Assigned to `CHARDESC.word64` for the attack (`Character.cpp:4995`) |
| `Byte20046[44]` | Base stamina cost, `+ STRandomBool()` (`Attack.cpp:1721`) |
| `Byte20002[44]` | The "D6W" factor into `DeterminePhysicalAttackDamage` (`Attack.cpp:1131`) |
| `Byte19958[44]` | The "D7W" factor, likewise (`Attack.cpp:1137`) |
| `Byte19914[44]` | `ATTACKPARAMETERS.disableTime` (`Attack.cpp:1714`) |

`AttackNames[300]` is a **NUL-separated** list indexed by attack type;
`GetAttackTypeName` walks forward over `n` terminators rather than indexing
(`doc/CSBwin-src/CSBCode.cpp:8714`). Note this differs from `ObjectNames`, which
terminates each entry with a high bit instead.

`ATTACKTYPE` (`doc/CSBwin-src/CSB.h:577`) has 44 entries. Three are marked "Not in
CSB" — `atk_JUGGLE` (0), `atk_SPEED` (3) and `atk_PRAY` (26) — and the names really
are stored as `"N"` and `"X"` in the graphics file, which is a useful confirmation
that the offsets above are right.

`LEGALATTACKS` is 8 bytes (`doc/CSBwin-src/Data.h:225`), one per attack class, read
by `GetLegalAttackTypes` (`doc/CSBwin-src/Character.cpp:4786-4825`):

- byte 0 — the always-legal attack, copied to `PossibleAttackTypes[0]` unconditionally.
- bytes 1-2 — two optional attacks, 255 meaning absent.
- bytes 4-5 — the mastery each of those needs. **Bit 7 means the wielded item must
  have charges left** (`ItemHasChargesLeft`, `doc/CSBwin-src/Character.cpp:4761`);
  the remaining bits are compared against `DetermineMastery`.
- byte 6 — read into `d.Word20262` and, in CSBWin's own words, "Not used anywhere!!"
  (`doc/CSBwin-src/Character.cpp:4957`). It looks like a skill number.
- bytes 3 and 7 — always zero in the shipped data.

`PrepareAttack` (`doc/CSBwin-src/Character.cpp:4929`) picks the class from
`ObjDesc[weapon.DescIndex()].AttackClass()`, and falls back to **class 2** for an
empty weapon hand. A class of 0 means the item affords no attack at all and the
click is ignored. It refuses outright if the champion has `CHARFLAG_attackDisable`
set or zero HP.

Verified from the shipped `graphics.dat`, as a check on all of the above: class 2 is
`PUNCH / KICK / WAR CRY`, class 27 is `SHOOT` alone (a bow), class 36 is `BLOW HORN`,
class 39 is `CLIMB DOWN` (a rope) and class 1 is `INVOKE / FUSE / FLUXCAGE` (the Ra
key). `Byte20002` and `Byte19958` are non-zero exactly for the physical attacks,
matching CSBWin's comment at `doc/CSBwin-src/Attack.cpp:1131`.
`tools/checks/monster-tables.ts` prints all of it.

## Monster stats in the shipped data

From `tools/checks/monster-tables.ts` against Dungeon Master's `graphics.dat`, as a
sanity check on the `MONSTERDESC` layout: type 15 (Worm) has `horizontalSize` 1 (two
corners); type 24 (Dragon) has `horizontalSize` 2 (the whole cell) with `baseHealth`
and `attack` both 255; types 23 (Lord Chaos), 25 and 26 (Grey Lord) share one
identical row and are the only `invincible` monsters; types 8, 11, 19 and 20 are the
`nonMaterial` ones.
