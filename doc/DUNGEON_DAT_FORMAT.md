# `dungeon.dat`

The file that holds a dungeon: its levels, every object in them, and the texts. CSBWin
reads it in `ReadDatabases` (`doc/CSBwin-src/SaveGame.cpp:2536-2910`), and the port in
`DungeonLoader` (`src/data/DungeonLoader.ts`), with the section arithmetic in
`src/data/DungeonImageLayout.ts`. A CSBWin save carries the same image, in a shape of its
own (`doc/CSBWIN_SAVEGAME_REFERENCE.md` → "The dungeon image in a save").

The community's description of the format is the Dungeon Master Encyclopaedia's
["Dungeon Files"](http://dmweb.free.fr/community/documentation/file-formats/dungeon-files/)
page (version 1.8, 2011), which credits Zyx, Meynaf, Sphenx, Beowuuf, kentaro.k-21 and
Paul R. Stevens. This document follows its outline. Every field below is checked against
CSBWin and cited. What only that page says is gathered at the end under "Not checked
against CSBWin" and says so.

Every word is **big-endian**: that is the Atari ST and Amiga form, the one CSBWin and the
port read. A bit range `bits 4-0` counts from bit 0, the least significant.

---

## The file

A `dungeon.dat` is up to three things, in this order:

1. **An Extended Features block**, only in a dungeon made for CSBWin. `ReadExtendedFeatures`
   reads it and returns its size (`SaveGame.cpp:299`, `:2560`). It declares the shape of
   the image after it (big actuators, indirect text, six-byte scrolls, the cell array's
   length) and carries the object index, the DSAs and the rule flags
   (`doc/CSBWIN_SAVEGAME_REFERENCE.md` → "Extended features block"). The DM Windows
   package's `dungeon.dat`, 3D2D1D's, Conflux's and Towers of Chaos' have one. A file
   can also be enciphered, which `readExtendedFeatures` undoes
   (`src/data/CsbwinExtendedFeatures.ts`).
2. **The image**, plain or compressed. When its first word is 33028 (`0x8104`), the image
   is compressed (see "Compression").
3. **A checksum word**, optional (see "Checksum").

### The image's sections

`ReadDatabases` fetches these one after the other, with no padding:

| # | Section | Size in bytes |
|---|---------|---------------|
| 1 | Header | 44 |
| 2 | Level descriptors | 16 × levels |
| 3 | Column index | 2 × the sum of the levels' widths |
| 4 | Object list | 2 × header word 10 |
| 5 | Text | 2 × header word 6 |
| 6 | Databases 0 to 15 | count × record size, for each |
| 7 | Cell array | header word 2 |
| 8 | Checksum | 2, when present |

(`SaveGame.cpp:2610-2873`.) The record sizes are `dbEntrySizes`, `sizeof (DB0)` to
`sizeof (DB15)` (`doc/CSBwin-src/data.cpp:395-413`):

| DB | Records | Bytes |
|----|---------|-------|
| 0 | Doors | 4 |
| 1 | Teleporters | 6 |
| 2 | Texts | 4 |
| 3 | Actuators (sensors) | 8, or 10 when the Extended Features block says big actuators |
| 4 | Monster groups | 16 |
| 5 | Weapons | 4 |
| 6 | Clothing | 4 |
| 7 | Scrolls | 4, or 6 from Extended Features version `'B'` |
| 8 | Potions | 4 |
| 9 | Chests | 8 |
| 10 | Miscellaneous items | 4 |
| 11 | `EXPOOL`, CSBWin's extension pool | 256 |
| 12, 13 | Unused | 0 |
| 14 | Missiles | 8 |
| 15 | Clouds | 4 |

`ReadDatabases` takes 2 from the actuator size for an image without big actuators
(`SaveGame.cpp:2783-2787`), and reads scrolls through `readScrollDatabase`, which picks
the four- or six-byte form by the Extended Features version (`:2401-2412`). A FTL dungeon
has no `EXPOOL` record, no missile and no cloud: a missile or a cloud lives only while a
timer moves it, and a `dungeon.dat` has no timers.

---

## Header (44 bytes)

`DUNGEONDATINDEX` (`doc/CSBwin-src/CSB.h:2120-2145`):

| Offset | Size | Field | CSBWin |
|--------|------|-------|--------|
| 0 | word | Random seed, the dungeon's identity | `Sentinel()` |
| 2 | word | Length of the cell array in bytes | `LegacyCellFlagArraySize()` |
| 4 | byte | Number of levels | `NumLevel()`, `BITS8_15(word4)` |
| 5 | byte | Unread | — |
| 6 | word | Length of the text in words | `NumWordsInTextArray()` |
| 8 | word | The party's start | `StartingPartyX/Y/Facing()` |
| 10 | word | Length of the object list in words | `ObjectListLength()` |
| 12 | 16 words | The number of records in each database | `DBSize(n)` |

The **seed** is added into the hash that places random wall and floor decorations
(`Hash`, `doc/CSBwin-src/CSBCode.cpp:5740-5757`). It is 99 in every DM `dungeon.dat` here
(`dm-atari`, `dm-atari-1.2`, `dm-atari-1.3-fr`, `dm-windows`), and in Kid's Dungeon,
Conflux and Towers of Chaos; 8 in Chaos Strikes Back's; 0 in 3D2D1D's.

The **start** is bits 4-0 x, 9-5 y and 11-10 the facing (0 north, 1 east, 2 south,
3 west), always on level 0 (`SaveGame.cpp:2612-2622`). DM's is (1, 3) facing south.

The **cell array's length** is the Extended Features block's when it declares one; the
header's then reads as 0 (`SaveGame.cpp:2624-2631`).

A new game grows two counts as it reads them: the object list by 300 empty slots
(`:2661`, `:2707-2713`), and each database by `d.Byte7302[n]` spare records
(`:2766-2777`).

---

## Level descriptors (16 bytes each)

`LEVELDESC` (`CSB.h:2147-2190`). The Encyclopaedia calls a level a "map": in DM and CSB
there is one per level, and in Dungeon Master II several maps share a level.

| Offset | Size | Field |
|--------|------|-------|
| 0 | word | `cellOffset`: where the level's cells start in the cell array |
| 2 | 4 bytes | `FILL2`, unread by CSBWin (Dungeon Master II's, see the end) |
| 6 | byte | `offsetX` |
| 7 | byte | `offsetY` |
| 8 | word | Size and level |
| 10 | word | Decoration counts |
| 12 | word | Counts and experience multiplier |
| 14 | word | Graphic sets and door types |

`cellOffset` is 16 bits, so a dungeon whose cell array passes 64K stores it wrapped, and
CSBWin unwraps it level by level (`SaveGame.cpp:2889-2898`, `doc/PROVEN_FACTS.md` →
"`LEVELDESC.cellOffset` wraps at 64K, and CSBWin unwraps it").

`offsetX` and `offsetY` place the level in the dungeon's frame. Stairs and pits lead to
the same absolute square on the level one depth up or down whose rectangle holds it
(`IncrementLevel`, `doc/CSBwin-src/CSBCode.cpp:4774-4830`); a teleporter names its
destination's descriptor instead.

Word 8:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 5-0 | `Level()` | The level's depth; several descriptors may share one |
| 10-6 | `LastColumn()` | Width − 1 |
| 15-11 | `LastRow()` | Height − 1 |

Word 10:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 3-0 | `NumWallDecoration()` | Wall decorations on the level |
| 7-4 | `NumRandomWallDecoration()` | How many of them, the first ones, may be placed at random |
| 11-8 | `NumFloorDecorations()` | Floor decorations on the level |
| 15-12 | `NumRandomFloorDecorations()` | How many of them may be placed at random |

A square that allows a random decoration gets one when `Hash` modulo 30 falls below the
random count (`RandomWallDecoration`, `doc/CSBWIN_DECORATIONS_REFERENCE.md`).

Word 12:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 3-0 | `NumDoorDecorations()` | Door decorations on the level |
| 7-4 | `numMonsterType()` | Monster types allowed on the level |
| 11-8 | — | Unread, but not zero: DM's levels hold 0, 1, 3 and 4 there |
| 15-12 | `experienceMultiplier()` | The level's experience multiplier, which also sets a generated monster's hit points |

Word 14:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 3-0 | `backgroundGraphicSet()` | Floor and ceiling set |
| 7-4 | `wallGraphicSet()` | Wall set |
| 11-8 | `Door1Type()` | The graphic of the level's door type 0 |
| 15-12 | `Door2Type()` | The graphic of the level's door type 1 |

DM and CSB have one floor, ceiling and wall set, 0.

---

## Column index and object list

The **column index** has one word per column of every level, level 0's first. Each holds
the number of squares with objects in all the columns before it, counted in the order
the cells are stored; `d.objectLevelIndex[level]` is where a level's columns start
(`SaveGame.cpp:2648-2655`).

The **object list** holds, for each square with objects, the reference of its first
object, in the same order. A square's entry is its column's word plus the number of
squares with objects above it in the column (`GetObjectListIndex`,
`doc/CSBwin-src/CSBCode.cpp:5168-5190`). The rest of the list, past the last square, is
`0xFFFF`.

### Object references

A reference (CSBWin's `RN`) in `dungeon.dat` is packed (`SaveGame.cpp:2142-2144`):

| Bits | Meaning |
|------|---------|
| 9-0 | Record number in its database |
| 13-10 | Database, 0 to 15 |
| 15-14 | The object's place on the square, 0 to 3: its corner, or the side of a wall it is on |

`0xFFFE` (`RNeof`) ends a chain, and `0xFFFF` (`RNnul`) is no object. CSBWin turns every
packed reference into a slot of its object index as it reads the file
(`ConvertListOfObjects`, `doc/PROVEN_FACTS.md` → "An RN in a save file is an indirect
index, not a packed `[pos][db][idx]`").

The objects of a square form a chain: each record's first word is the next object's
reference. A click on a wall reads its actuators only up to the first monster or item in
the chain (`TouchWall`, `doc/CSBwin-src/Mouse.cpp:322-340`, `:600`). A monster group's
possessions and a chest's contents are chains of their own, rooted in the record.

---

## Text

The text section is words of three 5-bit codes: bits 14-10 the first, 9-5 the second,
4-0 the third, and bit 15 unread (`DecodeText`, `CSBCode.cpp:5597-5615`). A TEXT record
names where its text starts, in words; `ConvertToIndirectText`
then copies each one into a compacted array and renumbers the record
(`SaveGame.cpp:2433-2490`, `doc/PROVEN_FACTS.md`).

`DecodeText(dest, text, typeOfText, max)` (`CSBCode.cpp:5552-5735`) reads three kinds:

| `typeOfText` | Used for | Letters | Code 28 | Ends with |
|--------------|----------|---------|---------|-----------|
| 0 | A wall's text | The code itself, an index in the wall font | `0x80`, a line break | `0x81` |
| 1 | A message | ASCII | A space | 0 |
| 2 | A scroll, a champion | ASCII | A line feed | 0 |

The codes:

| Code | Meaning |
|------|---------|
| 0-25 | `A` to `Z` |
| 26 | Space |
| 27 | `.` |
| 28 | Separator, as the table above |
| 29 | Escape 1: the next code picks a two-byte string of `d.Byte10080` |
| 30 | Escape 2: the next code picks an eight-byte string, of `d.Byte10336` for a wall, `d.Byte10016` otherwise |
| 31 | End |

The escape tables are read from `graphics.dat` item `0x22f`, not from the dungeon
(`doc/CSBwin-src/Data.h:1085-1087`, `doc/PROVEN_FACTS.md`). A message starts with a line
feed, and two separators in a row in it make a line feed (`CSBCode.cpp:5574-5580`,
`:5689-5694`). A text is decoded only when its record's show bit is set, or when
`typeOfText` has bit 15, as a champion's has. Every decoding ends in
`SubstituteCharacterNames`, CSBWin's `.Q.`, `.R.` and `.N.` escapes (`doc/PROVEN_FACTS.md`).

### Champion text

A champion's name, title and statistics are a text on the square in front of their
mirror, where the party stands to recruit them. `AddCharacter` takes the first TEXT
record of the party's square and decodes it with `typeOfText` `0x8002`, hidden or not
(`doc/CSBwin-src/Character.cpp:536-548`). Numbers are written in letters, `A` = 0 to
`P` = 15, most significant first (`DecodeCharacterValue`, `:415-432`). In order
(`:554-701`):

| Field | Characters | Rule |
|-------|------------|------|
| Name | Up to 7, then a line feed | |
| Title | Up to 19, in two lines | The two lines are joined |
| Sex | `M` or `F`, then one character | |
| Health | 4 | At most 999 |
| Stamina | 4 | At most 9999; shown divided by 10 (`:1092`) |
| Mana | 4, then one character | At most 900 |
| Luck, Strength, Dexterity, Wisdom, Vitality, Anti-magic, Anti-fire | 2 each, then one character | At most 224 (`doc/CSBwin-src/CSB.h:631-637`) |
| Hidden skills 4 to 19 | 1 each, four per class: fighter, ninja, priest, wizard | Level `n` gives `125 << n` experience; `A` gives none (unless CSBWin's `neophyteSkills`), at most `R` |

CSBWin reads more after the skills, all optional: three letters, the reincarnation
attribute penalty (default 2), the reincarnation statistic penalty (default 8) and the
random points (default 3), then eight digits of talents (`:683-689`). A text that breaks
a rule is replaced by CSBWin's own `legalHero` (`:475`, `:554`). A class's base skill is
the sum of its four hidden skills' experience (`:690-701`).

---

## Records

Every record starts with the word that links it into its chain. A free record has
`RNnul` there (`DeleteDBEntry`, `doc/CSBwin-src/data.cpp:995-1017`).

### Door (DB0, 4 bytes)

`DB0` (`CSB.h:821-848`). Word 2:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 0 | `doorType()` | Which of the level's two door types |
| 4-1 | `ornateness()` | The door decoration, 1-based in the level's list; 0 none |
| 5 | `mode()` | 0 opens sideways, 1 opens up |
| 6 | `doorSwitch()` | Has a button |
| 7 | `canOpenWithFireball()` | Destroyed by a fireball |
| 8 | `canOpenWithAxe()` | Destroyed by blows |
| 15-9 | — | Unread. CSBWin's comment calls `0x0400` a random mirroring of the image |

A door record belongs on a door square, whose cell flags hold its state.

### Teleporter (DB1, 6 bytes)

`DB1` (`CSB.h:852-888`). Word 2:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 4-0 | `destX()` | Destination x, in the destination level |
| 9-5 | `destY()` | Destination y |
| 11-10 | `rotation()` | The facing, or the turn |
| 12 | `facingMode()` | 1: set the facing to bits 11-10; 0: turn by them |
| 14-13 | `what()` | 0 objects, 1 monsters, 2 the party and objects, 3 everything |
| 15 | `audible()` | Buzzes |

Word 4, bits 15-8: the destination level (`destLevel()`); bits 7-0 unread.

### Text (DB2, 4 bytes)

`DB2` (`CSB.h:890-902`). Word 2: bit 0 `show()`, whether the text is visible; bits 15-3
`index()`, where it starts in the text section, in words. Bits 2-1 are unread.

Where a text is read depends on its square: on a wall, it is drawn on the side it is on
(`SummarizeStoneRoom`, `doc/CSBWIN_DECORATIONS_REFERENCE.md`); elsewhere, it is a message
printed when the party enters the square (`doc/PROVEN_FACTS.md`, `Code11f52.cpp:3995-4001`).

### Actuator (DB3, 8 bytes)

`DB3` (`CSB.h:930-1074`). The Encyclopaedia calls actuators sensors.

Word 2:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 6-0 | `actuatorType()` | The type, see "Actuator types" |
| 15-7 | `value()` | The type's value |

Word 4:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 1-0 | — | Unread by the FTL types; a portrait and a DSA read word 4 their own way |
| 2 | `onceOnly()` | The type becomes 0 once it acts |
| 4-3 | `action()` | 0 set, 1 clear, 2 toggle, 3 hold (`ACTUATORACTION`) |
| 5 | `normallyClosed()` | Inverts the actuator's pressed state |
| 6 | `audible()` | Clicks |
| 10-7 | `delay()` | Ticks before the action |
| 11 | `localActionOnly()` | Acts on itself, not on a target |
| 15-12 | `wallGraphicOrdinal()` | Its decoration, 1-based in the level's wall or floor list; 0 none |

Word 6, for a target (bit 11 clear): bits 5-4 `targetPos()`, the target wall's side;
10-6 `targetX()`; 15-11 `targetY()`, on the actuator's own level. For a local action
(bit 11 set): bits 15-4 `localActionType()`. Some types read word 6 their own way, below.

An event acts when it leaves the actuator closed: pressed, or released with bit 5 set.
Hold acts on every event, a set when it leaves it closed and a clear otherwise
(`PressurePadOrAlcove`, `doc/CSBwin-src/Code11f52.cpp:3880-3910`). The action becomes a
timer of the target square's type, which then does what that square does
(`QueueSwitchAction`, `doc/ACTUATORS.md`).

**Local actions** (`PerformLocalAction`, `doc/CSBwin-src/Mouse.cpp:239-254`): 10 gives 300
experience in hidden skill 8, the first ninja one, shared among the living champions
from a floor actuator, or to the champion holding the cursor from a wall
(`SkillIncreaser`, `:210-235`). 1 and 2 rotate the actuators on that side of the square:
the first one moves behind the last (`RotateActuatorList`, `Code11f52.cpp:3500-3560`).

CSBWin's extensions read more of these words: DSAs (type 47), portraits' states, the
and/or gate's condition; `doc/ACTUATORS.md` and `doc/CSBWIN_DSA_REFERENCE.md` have them.
`MakeBigActuators` appends word 8 to every actuator when it reads an image without big
actuators (`SaveGame.cpp:2816-2819`).

### Monster group (DB4, 16 bytes)

`DB4` (`CSB.h:1078-1142`):

| Offset | Size | Field |
|--------|------|-------|
| 0 | word | Link |
| 2 | word | `possession()`: the first object the group carries, dropped when it dies |
| 4 | byte | Bits 4-0 `monsterType()`; bits 7-5 `alternateGraphics()`, CSBWin's |
| 5 | byte | `groupIndex()`: the corners of the four monsters, two bits each, monster 1 in bits 1-0 |
| 6 | 4 words | `hitPoints6[4]`, each monster's |
| 14 | word | Flags |

Byte 5 holds the corners only while the group is off the party's level; on it, it is the
group's `ITEM16` slot (`AttachItem16ToMonster`, `doc/CSBwin-src/CSBCode.cpp:6146`).

Word 14:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 3-0 | `fear()` | Play's state, 0 in a dungeon |
| 6-5 | `numMonM1()` | Monsters in the group − 1 |
| 9-8 | `facing()` | The facing, off the party's level |
| 10 | `important()` | Never discarded to make room |
| 11 | `invisible()` | CSBWin's, read only with its `invisibleMonsters` option |
| 12 | `drawAsSize4()` | CSBWin's, read only with its `drawAsSize4Monsters` option |
| 13 | `Unique()` | CSBWin's, likewise |
| 14 | `Poisoned()` | CSBWin's, for DSAs, likewise |
| 4, 7, 15 | — | Unread, but DM's creature 38 has bits 4 and 7 set |

`MONSTERTYPE` (`doc/CSBwin-src/Objects.h:153-183`), with the names CSBWin's dump prints
(`MonsterName`, `doc/CSBwin-src/AsciiDump.cpp:306-339`). CSBWin names neither 5 nor 25.

```
0  Scorpion        7  Rock Pile      14 Vexirk          21 Oitu
1  Slime Devil     8  Rive           15 Worm            22 Demon
2  Giggler         9  Stone Golem    16 Ant Man         23 Lord Chaos
3  Flying Eye     10  Mummy          17 Muncher         24 Dragon
4  Hellhound      11  Black Flame    18 Deth Knight     25 —
5  —              12  Skeleton       19 Zytaz           26 Grey Lord
6  Screamer       13  Couatl         20 Water Elemental
```

The types a level allows are listed after its cells (see "Cell array").

### Weapon (DB5, 4 bytes)

`DB5` (`CSB.h:1144-1173`). Word 2:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 6-0 | `weaponType()` | `WEAPONTYPE` (`Objects.h:39`) |
| 7 | `important()` | Never discarded to make room |
| 8 | `cursed()` | |
| 9 | `poisoned()` | |
| 13-10 | `charges()` | Charges; a torch's fuel |
| 14 | `broken()` | |
| 15 | `litTorch()` | A lit torch |

### Clothing (DB6, 4 bytes)

`DB6` (`CSB.h:1175-1196`). Word 2: bits 6-0 `clothingType()` (`CLOTHINGTYPE`,
`Objects.h:90`), 7 `important()`, 8 `cursed()`, 12-9 `charges()`, 13 `broken()`;
bits 15-14 unread.

### Scroll (DB7, 4 or 6 bytes)

The four-byte form, a `dungeon.dat`'s: word 2 bits 9-0 the TEXT **record** that holds
the scroll's text, and bits 15-10 zero for an open scroll. CSBWin converts it as it
reads: the text becomes a reference to that record, and the scroll is open when bits
15-10 were 0 (`convertScrolls`, `SaveGame.cpp:2356-2378`). The six-byte form, a save's
and a dungeon's from Extended Features version `'B'`, is that converted record: word 2
the text's reference, word 4 bit 0 `open()` (`CSB.h:1198-1219`, `doc/PROVEN_FACTS.md` →
"The new scroll record, and where big actuators put their extra bytes").

A scroll's text is decoded as type 2 whatever its show bit says.

### Potion (DB8, 4 bytes)

`DB8` (`CSB.h:1221-1236`). Word 2: bits 7-0 `strength()`, the power; 14-8
`potionType()` (`POTIONTYPE`, `Objects.h:14`); 15 `important()`.

### Chest (DB9, 8 bytes)

`DB9` (`CSB.h:1238-1251`): word 2 `contents()`, the first object inside; word 4, whose
bits 2-1 plus one are the container's object index, 0 for the chest, the other bits
unnamed and not zero in DM; two bytes `m_uByte6`.

### Miscellaneous item (DB10, 4 bytes)

`DB10` (`CSB.h:1253-1281`). Word 2:

| Bits | CSBWin | Meaning |
|------|--------|---------|
| 6-0 | `miscType()` | `MISCTYPE` (`Objects.h:185`) |
| 7 | `important()` | |
| 8 | `cursed()` | |
| 13-9 | `subType()` | CSBWin's |
| 15-14 | `value()` | A waterskin's fill (0 empty, 3 full), a compass's facing, the charges, or the kind of bones |

### `EXPOOL` (DB11, 256 bytes)

CSBWin's extension pool: champions' bones, special locations, global texts and
variables (`doc/CSBWIN_SAVEGAME_REFERENCE.md` → "EXPOOL", `src/data/CsbwinExpool.ts`).
None in a FTL dungeon.

### Missile (DB14, 8 bytes)

`DB14` (`CSB.h:1301-1321`): word 2 `flyingObject()`, the object or spell in flight;
byte 4 `rangeRemaining()`; byte 5 `damageRemaining()`; word 6 `timerIndex()`, the timer
that moves it.

### Cloud (DB15, 4 bytes)

`DB15` (`CSB.h:1333-1348`). Word 2: bits 6-0 `cloudType()` (`CLOUDTYPE`: 0 fireball,
3 dispell, 4 open door, 7 poison, 40 death, 50 flux cage), bit 7 `b7()`, bits 15-8
`value()`.

---

## Actuator types

What an actuator does depends on its type and on its square: on a stone wall (or a
closed trick wall) it is a wall actuator, anywhere else a floor actuator.

### Floor actuators

Pressed by what enters or leaves the square (`PressurePadOrAlcove`,
`doc/CSBwin-src/Code11f52.cpp:3767-3850`):

| Type | Pressed by |
|------|------------|
| 0 | Nothing: a floor decoration |
| 1 | Anything: the party, a monster, an item. Not again while something already holds it |
| 2 | The party or a monster, not an item |
| 3 | The party. With a value `v`, only arriving facing `v − 1`; leaving releases it |
| 4 | An item whose object index is the value, not again while one already holds it |
| 5 | Nothing |
| 6 | Nothing: a monster generator, which a timer drives (below) |
| 7 | A monster |
| 8 | The party, while a champion carries an object whose index is the value (`DoesPartyHave`) |
| 9 | The party arriving, when the value is at most 20 |
| 47 | A DSA (`doc/CSBWIN_DSA_REFERENCE.md`) |

A **monster generator** (type 6) acts when a set, clear or toggle timer reaches its
square (`ProcessTT_OPENROOM`, `doc/CSBwin-src/Timer.cpp:1771-1830`): it makes a group of the
type in its value. Word 4 bits 10-7 give the size: with bit 10 set, 1 to the number in
bits 9-7 at random; otherwise the number itself. Word 6 bits 7-4 multiply the hit points,
0 meaning the level's multiplier; bits 15-8 disable it for a while after it acts, 1-127
ticks or `64 × (n − 126)` from 128, by turning it into type 0 until a
`TT_ReactivateGenerator` timer turns it back (`:1835-1875`). Its sound is the teleport's.
CSBWin passes word 4 bit 5 and word 6 bit 0 on as the group's invisible and
draw-as-size-4 flags.

Type 48 on a floor is CSBWin's counter, as type 6 on a wall.

### Wall actuators

A wall actuator answers to a click on its side, to an item put into it (an alcove), or
to a timer.

**A click** (`TouchWall`, `doc/CSBwin-src/Mouse.cpp:291-606`). Only the actuators on the
clicked side answer, and with nobody holding the cursor only a portrait:

| Type | Pressed by |
|------|------------|
| 1 | Any click. Never with the hold action |
| 2 | A click with an object in hand; with bit 5, an empty hand |
| 3 | A click with an object whose index is the value (with bit 5, any other); it stays in hand |
| 4 | As 3, and the object leaves the hand and is deleted |
| 11 | As 4, only when it is the last actuator on that side; then the side's actuators rotate |
| 12 | An empty hand, when it is the last on that side: the object of the value is made and put in the hand, as a launcher's (below); then the actuators rotate |
| 13 | A holder: an empty hand takes the object of the value from that side, a hand holding one puts it there; then the actuators rotate. With hold, putting sets and taking clears |
| 16 | An object of the value in hand, when it is the last on that side: it changes places with the square's first item |
| 17 | As 11, and it deletes itself from the chain when pressed |
| 127 | A champion's mirror: a click recruits the champion whose portrait the value names, once, while the portrait is active |

**An item put into it** (`PressurePadOrAlcove`, `Code11f52.cpp:3851-3878`), only the
actuators on that side:

| Type | Pressed by |
|------|------------|
| 1 | Any item, when none is already there |
| 2 | An item whose index is the value, when none of that kind is already there |
| 3 | Any item but the value, when no other kind is already there |

**A timer** (`ProcessTT_STONEROOM`, `doc/CSBwin-src/Timer.cpp:2165-2386`). A timer on a
wall also shows, hides or toggles the TEXT on the side it names.

| Type | Does |
|------|------|
| 5 | An and/or gate. Value bits 3-0 (word 2 bits 10-7) are the state, bits 7-4 (word 2 bits 14-11) the reference. The timer's side picks a state bit, which the action sets, clears or toggles; the gate is pressed when state equals reference. CSBWin adds a condition in word 6 bits 2-0 (`andOrEdge()`) |
| 6 | A counter. A set adds one, up to 511, anything else takes one; a counter at 0 no longer changes, and it is pressed when it reaches 0 (`OperateCounterActuator`, `:1603-1686`) |
| 7 | Launches the object of the value |
| 8 | Launches the spell of the value |
| 9 | Launches two objects of the value |
| 10 | Launches two spells of the value |
| 14 | Launches the first item on its side of its square |
| 15 | Launches the first two items on its side of its square |
| 18 | Ends the game |
| 47 | A DSA |
| 127 | A portrait's states, CSBWin's (`ProcessPortraitTimer6`) |

**Launchers** (`TriggerMissileLauncher`, `Timer.cpp:1883-2010`) throw into the square
in front of their side, with the range in word 6 bits 11-4, a damage of 100 and no
decay. A single missile starts at random on the left or the right. The objects a value
makes (`ConstructPredefinedMissile`, `Mouse.cpp:106-175`): 4 to 7 a torch, 32 a dagger,
51 an arrow, 52 a slayer, 54 a rock, 55 a poison dart, 56 a throwing star, 128 a
boulder. The spells (`RN::CreateSpell`, `doc/CSBwin-src/CSBTypes.h:244-251`): 0 fireball,
1 poison blob, 2 lightning bolt, 3 dispell, 4 the door-opening spell, 6 poison bolt,
7 poison cloud. Types 14 and 15 take items at the timer's position or the next one,
`(pos + 1) & 3`, and launch nothing when none is left. With once only, a launcher becomes type 0.

---

## Cell array

The cells of every level, level 0's first, each level at its `cellOffset`. A level's
cells go column by column: x = 0, y = 0 to the height − 1, then x = 1
(`SaveGame.cpp:2900-2915`). One byte each, CSBWin's `CELLFLAG`
(`doc/CSBwin-src/CSBTypes.h:181-211`):

| Bits | Meaning |
|------|---------|
| 3-0 | Attributes of the square's type |
| 4 | The square has objects |
| 7-5 | The type (`ROOMTYPE`, `CSB.h:561-575`) |

| Type | Square | Bit 0 | Bit 1 | Bit 2 | Bit 3 |
|------|--------|-------|-------|-------|-------|
| 0 | Stone wall | Random decoration on the west side | … south | … east | … north |
| 1 | Open | | | | Random floor decoration |
| 2 | Pit | Imaginary: nobody falls | | Obscured | Open: things fall |
| 3 | Stairs | | | Going up | Runs north–south |
| 4 | Door | State, bits 2-0 | | | Runs north–south |
| 5 | Teleporter | | | Visible | Active |
| 6 | Trick wall | Passable though shown | | Open: not shown, passable | Random decoration |

A door's state is 0 open, 1 almost open, 2 half open, 3 almost closed, 4 closed,
5 bashed; the party passes at 0, 1 and 5 (`doc/CSBwin-src/CSBCode.cpp:8319-8324`). A pit
is drawn only while open, bit 2 drawing it obscured (`SummarizeRoomInfo`,
`doc/CSBwin-src/Codea59a.cpp:263-276`); a teleporter's haze shows only while it is
active and visible (`:354-357`). The trick wall's bits are read in
`Codea59a.cpp:278-297` and `CSBCode.cpp:8339-8345`, the imaginary pit's in
`Monster.cpp:682-692`. A type 7 is not a DM or CSB square: CSBWin turns it into an open
one after the read (`CheckCelltypes`, `SaveGame.cpp:1468-1501`).

### After each level's cells

Four lists of bytes follow a level's last cell, in this order
(`SetPartyLevel`, `doc/CSBwin-src/CSBCode.cpp:5855-5875`; `Code390e.cpp:325-330`):

| Bytes | List |
|-------|------|
| `numMonsterType()` | The monster types allowed on the level |
| `NumWallDecoration()` | The wall decorations: a graphic number each |
| `NumFloorDecorations()` | The floor decorations |
| `NumDoorDecorations()` | The door decorations |

An actuator's or a door's decoration ordinal is 1-based in these lists. CSBWin adds a
last wall entry, 0, for a far wall text (`CSBCode.cpp:5866`). How the numbers become
graphics is in `doc/CSBWIN_DECORATIONS_REFERENCE.md`.

---

## Checksum

`FetchDataBytes` adds every byte it reads, from the header to the end of the cell array,
into a 16-bit sum (`doc/CSBwin-src/CSBCode.cpp:9186-9211`). `ReadDatabases` then reads the
word after the cell array without adding it, and fails the read when the word is there
and differs from the sum (`SaveGame.cpp:2866-2870`). When the file ends at the cell array,
nothing is compared: DM's `dungeon.dat` has no checksum, CSB's prison has one.

---

## Compression

A new game's `dungeon.dat` may be compressed. `ReadDatabases` reads the first 8 bytes and
takes the file as compressed when their first word is 33028; otherwise it rewinds and
reads it plain (`SaveGame.cpp:2558-2586`). A saved game is never read this way. The port:
`DungeonLoader.loadDungeonDat` and `ExpandData` (`src/core/compression.ts`), checked by
`tools/checks/compressed-dungeon.ts`.

### The 8-byte header

| Offset | Type | Meaning |
|--------|------|---------|
| +0x00 | word | 33028 (`0x8104`) |
| +0x02 | long | The expanded size in bytes |
| +0x06 | word | `d.Word22592`, which a plain file leaves at `_ReadEntireGame`'s 13 (`SaveGame.cpp:1571`) |

All three big-endian. The rest of the file is the compressed body, expanded by
`ExpandData` into a buffer that `FetchDataBytes` then reads as it would the plain file.
Behind an Extended Features block, the body starts 8 bytes after the block, or 8 bytes
into the file for a block of version `'@'` (`:2574-2581`).

### The body (`ExpandData`, `CSBCode.cpp:9970-10053`)

The first 20 bytes are two tables: 4 bytes, then 16. The codes follow as big-endian
words, read one bit at a time from bit 15 down, a code running on into the next word
when the current one is used up. One code makes one byte:

| Code | Bits | Byte |
|------|------|------|
| `0xx` | 3 | entry `xx` of the 4-byte table |
| `10yyyy` | 6 | entry `yyyy` of the 16-byte table |
| `11zzzzzzzz` | 10 | `zzzzzzzz` itself |

The count of bytes to make is a word (`D7W`), so a size over 65535 expands only its low
word's worth.

### Chaos Strikes Back's prison

CSB's `dungeon.dat` is the one compressed file known: 2098 bytes, expanding to 2622, with
`Word22592` 12. The expanded image ends with its checksum, 0x939f, and the port's
expansion matches it.

---

## What CSBWin changes as it reads

`ReadDatabases` and `_ReadEntireGame` turn a `dungeon.dat` into the shape a save is
written in, and the port does the same (`convertOriginalDungeon`,
`src/data/CsbwinDungeonConversions.ts`): references become object-index slots, texts go
indirect, actuators get word 8, scrolls get six bytes, unknown cell types become open
squares (`CheckCelltypes`) and mirrors get CSBWin's portrait state cleared
(`ExtendPortraits`, `SaveGame.cpp:1503-1527`). `tools/checks/dungeon-image-blocks.ts` reads
`dungeon.dat` without them and writes its sections back byte for byte.

---

## Not checked against CSBWin

The Encyclopaedia's page says the following, which CSBWin's source neither confirms nor
contradicts, or which concerns versions CSBWin does not read.

**Versions.** The file is `DUNGEON.DAT` in most versions, `DUNGEON.GAME` on the Apple IIGS
(with `DUNGEON.BONUS` for Kid's Dungeon), and `DUNGEONF.DAT` and `DUNGEONG.DAT` for French
and German in multilingual versions. The PC, Apple IIGS, Super NES, FM-Towns, PC-98 and
IBM PS-V files are little-endian, converted by swapping the two bytes of every word. DM's
Atari ST 1.x files have no checksum; from 2.x the English files have one and the others
not; CSB's and Dungeon Master II's always do. Atari ST 1.2 English does not read a
compressed file. A bad checksum makes the PC 3.4 game say "The game is damaged!". The
word at 6 of a compressed header is 12 or 8 in the files the page lists.

**Seeds.** 13 is CSB's main dungeon (its `mini.dat`) and 0 Dungeon Master II's; the Hint
Oracle's files name the dungeon by its seed.

**Dungeon Master II.** A level descriptor's word 2 marks which graphics a map uses (bit 0
pit, 1 ceiling pit, 2 faint pit, 3 stairs up, 4 stairs down, 5 teleporter haze, 6
portraits, 7 door type 0, 8 door type 1), and word 14 bits 7-4 its style (0 blue zone,
1 outside, 2 cave, 3 interior, 4 Skullkeep roof, 5 mist). A TEXT's bit 2 marks a text to
translate and bit 1 a simplified sensor. Type 7 is an empty square. Its champions and its
texts are in `graphics.dat`, its experience levels need twice the experience, and its
sensors go far past type 18.

**Older engines.** Before 2.1, floor type 5 fired when the party arrived by the stairs it
stands on, and a launcher's word 6 bits 15-12 were a decay rate; floor type 9 checks the
engine's version; type 18 waits word 4 bits 10-7 seconds from CSB 2.1. Types 14 and 15
crash an older engine when no item is left to launch. Monster types 25 and 26 crash the
original game, and a monster teleported onto a level that does not allow it dies there,
crashing when it carries something.

**Door types**, a level's word 14 bits 11-8 and 15-12: 0 grate, 1 wood, 2 iron, 3 Ra.
Their resistances are in `graphics.dat` item 559.

**DM's decorations**, by the number a level's list holds:

- Walls: 0 unreadable inscription, 1 square alcove, 2 Vi altar, 3 arched alcove, 4 hook,
  5 iron lock, 6 wood ring, 7 small switch, 8 dent 1, 9 dent 2, 10 iron ring, 11 crack,
  12 slime outlet, 13 dent 3, 14 tiny switch, 15 green switch out, 16 blue switch out,
  17 coin slot, 18 double iron lock, 19 square lock, 20 winged lock, 21 onyx lock,
  22 stone lock, 23 cross lock, 24 topaz lock, 25 skeleton lock, 26 gold lock,
  27 turquoise lock, 28 emerald lock, 29 ruby lock, 30 Ra lock, 31 master lock, 32 gem
  hole, 33 slime, 34 grate, 35 fountain, 36 manacles, 37 ghoul's head, 38 empty torch
  holder, 39 scratches, 40 poison holes, 41 fireball holes, 42 dagger holes, 43 champion
  mirror, 44 lever up, 45 lever down, 46 full torch holder, 47 red switch out, 48 eye
  switch, 49 big switch out, 50 crack switch out, 51 green switch in, 52 blue switch in,
  53 red switch in, 54 big switch in, 55 crack switch in, 56 amalgam (encased gem),
  57 amalgam (free gem), 58 amalgam (without gem), 59 Lord Order (outside).
- Floors: 0 square grate, 1 square pressure pad, 2 moss, 3 round grate, 4 round pressure
  plate, 5 black flame pit, 6 crack, 7 tiny pressure pad, 8 puddle.
- Doors: 0 square grid, 1 iron bars, 2 jewels, 3 wooden bars, 4 arched grid, 5 block
  lock, 6 corner lock, 7 black door (the entrance), 8 red triangle lock, 9 triangle lock,
  10 Ra door energy, 11 iron door damage.

**DM's and CSB's portraits**, a mirror's value: 0 Elija / Airwing, 1 Halk / Aroc,
2 Syra / Talon, 3 Hissssa / Leta, 4 Zed / Dema, 5 Chani / Algor, 6 Hawk / Toadrot,
7 Boris / Ven, 8 Mophus / Mantia, 9 Leif / Gnatu, 10 Wu Tse / Slogar, 11 Alex / Sting,
12 Linflas / Skelar, 13 Azizi / Deth, 14 Iaido / Necro, 15 Gando / Plague, 16 Stamm /
Tunda, 17 Leyla / Lana, 18 Tiggy / Buzzzz, 19 Sonja / Petal, 20 Nabi / Itza, 21 Gothmog /
Tula, 22 Wuuf / Kazai, 23 Daroou / Lor.

**Design rules.** An object must not be in two chains. Actuators go before a monster
group in a square's chain. A portrait shares its wall with no decorated actuator. A
scroll's line holds at most 14 characters. DM's four texts on level 12 at (0, 0), each
starting with a letter A to D, are the endgame's, printed in that letter's order without
it.
