# Dungeon.dat File Format Specification

Complete technical specification for Dungeon Master / Chaos Strikes Back dungeon.dat files.

**Source**: dmweb.free.fr documentation (archived in `doc/external/dungeon format.html`)
**Applies to**: Dungeon Master, Chaos Strikes Back, Dungeon Master II
**Platforms**: All (Atari ST, Amiga, PC, Mac, etc.)
**Date**: 2026-01-04

---

## Table of Contents

1. [File Overview](#file-overview)
2. [File Structure](#file-structure)
3. [Header Format](#header-format)
4. [Map Descriptors](#map-descriptors)
5. [Object System](#object-system)
6. [Database Records](#database-records)
7. [Map Data](#map-data)
8. [Text Encoding](#text-encoding)
9. [Compression](#compression)

---

## File Overview

### File Names
- **Dungeon Master**: `DUNGEON.DAT`
- **Chaos Strikes Back**: `DUNGEON.DAT`
- **Apple IIGS**: Stores dungeon in fork resource

### Endianness
- **Little-endian**: PC, Apple IIGS, Super NES, FM-Towns, PC-98, IBM PS-V
- **Big-endian**: Atari ST, Amiga, X68000, Macintosh, Sega CD

Must detect and convert accordingly.

### Compression
Optional compression with signature `0x8104` (33028) at file start. See [Compression](#compression).

### Checksum
Optional 16-bit checksum at end of file (sum of all previous data).

---

## File Structure

Sequential sections (no padding between):

```
1. File Header                 (44 bytes)
2. Map Definitions             (16 bytes × num_maps)
3. Column Index                (2 bytes × total_columns)
4. Object ID List              (2 bytes × object_list_size)
5. Text Data                   (variable, in words)
6. Door Database               (4 bytes × door_count)
7. Teleporter Database         (6 bytes × teleporter_count)
8. Text Database               (4 bytes × text_count)
9. Sensor Database             (8 bytes × sensor_count)
10. Creature Database          (16 bytes × creature_count)
11. Weapon Database            (4 bytes × weapon_count)
12. Clothe Database            (4 bytes × clothe_count)
13. Scroll Database            (4 bytes × scroll_count)
14. Potion Database            (4 bytes × potion_count)
15. Container Database         (8 bytes × container_count)
16. Miscellaneous Database     (4 bytes × misc_count)
17. (Unused Database)          (0 bytes)
18. (Unused Database)          (0 bytes)
19. (Unused Database)          (0 bytes)
20. Projectile Database        (8 bytes × projectile_count, save games only)
21. Cloud Database             (4 bytes × cloud_count, save games only)
22. Map Data                   (global_map_data_size bytes)
23. Checksum                   (2 bytes, optional)
```

---

## Header Format

**Offset**: 0x0000
**Size**: 44 bytes

### Field Layout

| Offset | Type  | Name | Description |
|--------|-------|------|-------------|
| +0x00  | word  | Random Seed | Dungeon ID: 99=DM, 8=CSB Prison, 13=CSB, 0=DM2 |
| +0x02  | word  | Map Data Size | Total size of map data section in bytes |
| +0x04  | byte  | Num Maps | Number of maps/levels in dungeon |
| +0x05  | byte  | (Padding) | Unused |
| +0x06  | word  | Text Size | Size of text data in words (2-byte units) |
| +0x08  | word  | Starting Position | Packed party start location |
| +0x0A  | word  | Object List Size | Size of object ID list in words |
| +0x0C  | word[16] | Object Counts | Number of objects per category |

### Starting Position Encoding (word at +0x08)

```
Bits 15-12: Unused
Bits 11-10: Initial facing direction
            00 = North
            01 = East
            10 = South
            11 = West
Bits 9-5:   Starting Y coordinate (0-31)
Bits 4-0:   Starting X coordinate (0-31)
```

**Decoding example**:
```typescript
const startPos = 0x1234;  // Example value
const x = startPos & 0x1F;              // Bits 0-4
const y = (startPos >> 5) & 0x1F;       // Bits 5-9
const facing = (startPos >> 10) & 0x03; // Bits 10-11
```

### Object Counts Array (16 words at +0x0C)

| Index | Category | Record Size |
|-------|----------|-------------|
| 0 | Doors | 4 bytes |
| 1 | Teleporters | 6 bytes |
| 2 | Texts | 4 bytes |
| 3 | Sensors (Actuators) | 8 bytes |
| 4 | Creatures | 16 bytes |
| 5 | Weapons | 4 bytes |
| 6 | Clothes | 4 bytes |
| 7 | Scrolls | 4 bytes |
| 8 | Potions | 4 bytes |
| 9 | Containers | 8 bytes |
| 10 | Miscellaneous | 4 bytes |
| 11 | (Unused) | 0 bytes |
| 12 | (Unused) | 0 bytes |
| 13 | (Unused) | 0 bytes |
| 14 | Projectiles | 8 bytes (save games only) |
| 15 | Clouds | 4 bytes (save games only) |

---

## Map Descriptors

**Offset**: 0x002C (after header)
**Size**: 16 bytes per map

### Map Descriptor Layout

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Map Data Offset | Offset into map data section, wrapped at 64K (`PROVEN_FACTS.md` → "`LEVELDESC.cellOffset` wraps at 64K") |
| +0x02 | word | Component Flags | Graphics usage flags (DM2 only) |
| +0x04 | word | (Unused) | Always 0 |
| +0x06 | byte | Offset X | Map offset X in dungeon |
| +0x07 | byte | Offset Y | Map offset Y in dungeon |
| +0x08 | word | Map Size | Packed: level, width, height |
| +0x0A | word | Graphics Counts | Wall/floor decoration counts |
| +0x0C | word | Difficulty | Map depth and creature types |
| +0x0E | word | Door Graphics | Door types and graphics style |

### Component Flags (word at +0x02, DM2 only)

```
Bit 8:  Door type 1 present
Bit 7:  Door type 0 present
Bit 6:  Portraits present
Bit 5:  Teleporter blue haze present
Bit 4:  Stairs down present
Bit 3:  Stairs up present
Bit 2:  Nearly invisible pit present
Bit 1:  Ceiling pit present
Bit 0:  Normal pit present
```

Always 0 in Dungeon Master and Chaos Strikes Back.

### Map Size (word at +0x08)

```
Bits 15-11: Map height - 1 (0-31, so max height = 32)
Bits 10-6:  Map width - 1 (0-31, so max width = 32)
Bits 5-0:   Level number (0-63)
```

**Decoding**:
```typescript
const mapSize = 0x1234;  // Example
const level = mapSize & 0x3F;                 // Bits 0-5
const width = ((mapSize >> 6) & 0x1F) + 1;    // Bits 6-10, +1
const height = ((mapSize >> 11) & 0x1F) + 1;  // Bits 11-15, +1
```

### Graphics Counts (word at +0x0A)

```
Bits 15-12: Floor random decoration count
Bits 11-8:  Total floor graphics count
Bits 7-4:   Wall random decoration count
Bits 3-0:   Total wall graphics count
```

### Difficulty (word at +0x0C)

```
Bits 15-12: Map difficulty/depth (0-15)
Bits 11-8:  (Unused in DM/CSB, varies in some dungeons)
Bits 7-4:   Creature types allowed on this map
Bits 3-0:   Door decoration graphics count
```

### Door Graphics (word at +0x0E)

```
Bits 15-12: Door type 1 graphic index
Bits 11-8:  Door type 0 graphic index
Bits 7-4:   Map graphics style (wall/floor theme)
Bits 3-0:   Floor/ceiling style
```

---

## Object System

### Object ID Format

**Size**: 2 bytes (word)

```
Bits 15-14: Position on tile
            00 = North / Top-Left
            01 = East / Top-Right
            10 = South / Bottom-Left
            11 = West / Bottom-Right

Bits 13-10: Category (0-15)
            0000 = Door
            0001 = Teleporter
            0010 = Text
            0011 = Sensor
            0100 = Creature
            0101 = Weapon
            0110 = Clothe
            0111 = Scroll
            1000 = Potion
            1001 = Container
            1010 = Miscellaneous
            1011 = (Unused)
            1100 = (Unused)
            1101 = (Unused)
            1110 = Projectile
            1111 = Cloud

Bits 9-0:   Index within category (0-1023)
```

**Special Values**:
- `0xFFFE`: End of linked list marker
- `0xFFFF`: Null/empty slot

**Encoding example**:
```typescript
function encodeObjectID(position: number, category: number, index: number): number {
    return ((position & 0x03) << 14) |
           ((category & 0x0F) << 10) |
           (index & 0x3FF);
}

function decodeObjectID(id: number) {
    return {
        position: (id >> 14) & 0x03,
        category: (id >> 10) & 0x0F,
        index: id & 0x3FF
    };
}
```

### Column Index

**Purpose**: Optimize finding objects in tiles.

**Size**: 2 bytes per column across all maps

**Value**: Cumulative count of tiles with objects up to (but not including) this column.

**Usage**:
```typescript
function getObjectListIndex(mapIndex: number, x: number, y: number): number {
    const columnIndex = mapColumnOffset[mapIndex] + x;
    const baseIndex = columnIndex[columnIndex];

    // Count tiles with objects in this column up to row y
    let offset = 0;
    for (let row = 0; row < y; row++) {
        if (tileHasObjects(mapIndex, x, row)) {
            offset++;
        }
    }

    return baseIndex + offset;
}
```

### Object ID List

**Size**: 2 bytes per entry, total size in header

**Structure**: Array of Object IDs, one per tile that contains objects.

**Linked Lists**: Objects on same tile are chained via "Next Object ID" field in each database record.

**Example**:
```
Tile (5, 10) contains 3 objects:

objectList[45] = 0x1234  // First object
    ↓ (record.nextObjectID)
objectList[46] = 0x5678  // Second object
    ↓
objectList[47] = 0x9ABC  // Third object
    ↓
0xFFFE (end marker)
```

---

## Database Records

All records start with a 2-byte "Next Object ID" field for linking.

### Door (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile (0xFFFE = end) |
| +0x02 | word | Attributes | Door properties |

**Attributes** (word):
```
Bit 8:   Destructible by chopping
Bit 7:   Destructible by fireball
Bit 6:   Has button
Bit 5:   Opening direction (0=horizontal, 1=vertical)
Bits 4-1: Ornate decoration number (0-15)
Bit 0:   Door type (0 or 1)
```

### Teleporter (6 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Teleporter properties |
| +0x04 | word | Destination | Target map/level |

**Attributes** (word at +0x02):
```
Bit 15:      Sound effect (0=silent, 1=sound)
Bits 14-13:  Scope
             00 = Items only
             01 = Creatures only
             10 = Items and party
             11 = Everything
Bit 12:      Rotation type (0=relative, 1=absolute)
Bits 11-10:  Rotation amount (0-3 = 0°, 90°, 180°, 270°)
Bits 9-5:    Destination Y coordinate (0-31)
Bits 4-0:    Destination X coordinate (0-31)
```

**Destination** (word at +0x04):
```
Bits 15-8:   Destination map/level number
Bits 7-0:    (Unused in DM/CSB)
```

### Text (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Text Reference | Pointer to text data |

**Text Reference** (word at +0x02):
```
When bits 2-1 = 00:
  Bits 15-3:  Offset in text data (in words)
  Bit 2:      Translation required (DM2 only)
  Bit 1:      Simplified sensor (DM2 only)
  Bit 0:      Visible (1=visible wall inscription)

When bits 2-1 ≠ 00:
  Champion definition (DM/CSB only)
```

### Sensor (Actuator) (8 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Type & Data | Sensor type and parameters |
| +0x04 | word | Behavior | Timing and action flags |
| +0x06 | word | Target | Target location or action |

**Type & Data** (word at +0x02):
```
Bits 15-7:  Type-specific data
Bits 6-0:   Sensor type (0-127)
```

**Sensor Types**:
- 0: Floor pad (party or creature)
- 1: Floor pad (party only)
- 2: Floor pad (creature only)
- 3: Pit (party or creature falls)
- 4: Wall switch
- 5: Wall ornate switch
- 6: Object detector
- ... many more types

**Behavior** (word at +0x04):
```
Bits 15-12: Decoration graphic ordinal
Bit 11:     Target type (0=remote, 1=local)
Bits 10-7:  Delay (0-15 ticks)
Bit 6:      Sound effect (0=silent, 1=sound)
Bit 5:      Revert effect (reset after delay)
Bits 4-3:   Action type
            00 = Set
            01 = Clear
            10 = Toggle
            11 = Hold
Bit 2:      Once only (sensor destroyed after trigger)
Bits 1-0:   (Varies by sensor type)
```

**Target** (word at +0x06):
- **Remote target**: Encoded map/X/Y/position
- **Local target**: Encoded action parameters

### Creature (16 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Possession | Object carried by creature |
| +0x04 | byte | Type | Creature type (0-26) |
| +0x05 | byte | Positions | Sub-tile positions (2 bits × 4) |
| +0x06 | word | HP 1 | Hit points for creature 1 |
| +0x08 | word | HP 2 | Hit points for creature 2 |
| +0x0A | word | HP 3 | Hit points for creature 3 |
| +0x0C | word | HP 4 | Hit points for creature 4 |
| +0x0E | word | Attributes | Creature flags |

**Creature Types** (byte at +0x04): CSBWin's `MONSTERTYPE`
(`doc/CSBwin-src/Objects.h:153-183`), with the names its dump prints
(`MonsterName`, `doc/CSBwin-src/AsciiDump.cpp:306-339`). CSBWin names neither 5 nor 25.
```
0  = mon_Scorpion        14 = mon_Vexirk
1  = mon_SlimeDevil      15 = mon_Worm
2  = mon_Giggler         16 = mon_AntMan
3  = mon_FlyingEye       17 = mon_Muncher
4  = mon_Hellhound       18 = mon_DethKnight
5  = mon_5               19 = mon_Zytaz
6  = mon_Screamer        20 = mon_WaterElemental
7  = mon_RockPile        21 = mon_Oitu
8  = mon_Rive            22 = mon_Demon
9  = mon_StoneGolem      23 = mon_LordChaos
10 = mon_Mummy           24 = mon_Dragon
11 = mon_BlackFlame      25 = mon_25
12 = mon_Skeleton        26 = mon_GreyLord
13 = mon_Couatl
```

**Positions** (byte at +0x05):
```
Bits 7-6:  Creature 4 sub-position (00-11)
Bits 5-4:  Creature 3 sub-position
Bits 3-2:  Creature 2 sub-position
Bits 1-0:  Creature 1 sub-position
Special: 0xFF = creature centered in tile
```

**Attributes** (word at +0x0E):
```
Bit 10:    Important/non-flushable creature
Bits 9-8:  Facing direction (00=N, 01=E, 10=S, 11=W)
Bits 6-5:  Count - 1 (0-3 = 1-4 creatures)
Bits 3-0:  Runtime data (health status, state)
```

### Weapon (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Weapon properties |

**Attributes** (word at +0x02):
```
Bit 15:      Runtime flag
Bit 14:      Broken (cannot use)
Bits 13-10:  Charges or luminous power (torches)
Bit 9:       Poisoned
Bit 8:       Cursed
Bit 7:       Important (plot item)
Bits 6-0:    Weapon type (0-127)
```

**Weapon Types**:
```
0  = Torch
1  = Flamitt
2  = Staff of Claws
3  = Storm Ring
4  = Ra Key
... (46 types in DM, more in CSB)
```

### Clothe (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Clothing properties |

**Attributes** (word at +0x02):
```
Bit 13:      Broken
Bits 12-9:   Charges (unused in DM/CSB)
Bit 8:       Cursed
Bit 7:       Important
Bits 6-0:    Clothe type (0-127)
```

### Scroll (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Scroll properties |

**Attributes** (word at +0x02):
```
Bits 15-10:  State (0=open, 1=closed)
Bits 9-0:    Text reference (offset in words)
```

### Potion (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Potion properties |

**Attributes** (word at +0x02):
```
Bit 15:      Important
Bits 14-8:   Potion type (0-127)
Bits 7-0:    Power/dosage (0-255)
```

**Potion Types**:
```
0  = Mon Potion
1  = Mana Potion
2  = Magic Potion (strength)
3  = Dexterity Potion
4  = Shield Potion
... (20+ types)
```

### Container (8 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Contained Object | First object inside |
| +0x04 | word | Type | Container type |
| +0x06 | word | (Unused) | Always 0 |

**Type** (word at +0x04):
```
Bits 2-1:  Container type
           00 = Chest (only valid type in DM/CSB)
Bits 0, 3-15: Unused
```

**Contained objects**: Linked list starting at +0x02, using nextObjectID fields.

### Miscellaneous (4 bytes)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Item properties |

**Attributes** (word at +0x02):
```
Bits 15-14:  Special state (waterskin/compass/bones)
Bit 7:       Important
Bits 6-0:    Item type (0-127)
```

**Item Types**:
```
0  = Compass
1  = Waterskin (bits 15-14 = water level)
2  = Jewel Symal
3  = Illumulet
4  = Rope
5  = Lock picks
... (50+ types: food, keys, gems, etc.)
```

### Projectile (8 bytes, save games only)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Projectile Object | What was thrown |
| +0x04 | byte | Range Energy | Distance remaining |
| +0x05 | byte | Damage Energy | Attack power |
| +0x06 | word | Event Index | Timer/event reference |

### Cloud (4 bytes, save games only)

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| +0x00 | word | Next Object | Next object in tile |
| +0x02 | word | Attributes | Cloud properties |

**Attributes** (word at +0x02):
```
Bits 15-8:   Value/power
Bits 6-0:    Cloud type
```

---

## Map Data

### Structure

For each map, the map data contains:
1. **Tile definitions** (1 byte per tile)
2. **Graphic indices** (variable)

### Tile Definition (1 byte)

```
Bits 7-5:  Tile type (room type)
           000 = Wall
           001 = Floor
           010 = Pit
           011 = Stairs
           100 = Door
           101 = Teleporter
           110 = Trick Wall
           111 = Empty (DM2 only)

Bit 4:     Has objects (1 = yes, 0 = no)

Bits 3-0:  Tile attributes (type-specific)
```

### Tile-Specific Attributes

#### Wall (type 000)
```
Bit 3:  Allow random decoration on North wall
Bit 2:  Allow random decoration on East wall
Bit 1:  Allow random decoration on South wall
Bit 0:  Allow random decoration on West wall
```

#### Floor (type 001)
```
Bit 3:  Allow random floor decoration
Bits 2-0: (Unused)
```

#### Pit (type 010)
```
Bit 3:  Pit is open (will fall through)
Bit 2:  Pit is invisible
Bit 1:  (Unused)
Bit 0:  Imaginary pit (visual only, won't fall)
```

#### Stairs (type 011)
```
Bit 3:  Orientation (0=West-East, 1=North-South)
Bit 2:  Direction (0=Down, 1=Up)
Bits 1-0: (Unused)
```

#### Door (type 100)
```
Bit 3:     Orientation (0=EW, 1=NS)
Bits 2-0:  Door state
           000 = Open
           001 = Almost open
           010 = Half open
           011 = Almost closed
           100 = Closed
           101 = Bashed open
```

#### Teleporter (type 101)
```
Bit 3:  Teleporter is open/active
Bit 2:  Teleporter is visible
Bits 1-0: (Unused)
```

#### Trick Wall (type 110)
```
Bit 3:  Allow random decoration
Bit 2:  Wall is open (passable)
Bit 1:  (Unused)
Bit 0:  Imaginary (visual only)
```

### Graphic Indices

Following tile definitions, graphic indices specify which textures to use. Format varies by map descriptor settings.

---

## Text Encoding

### 5-Bit Character Encoding

Text compressed as 5-bit codes, packed 3 per word (15 bits used, bit 15 ignored).

**Word format**:
```
Bits 14-10:  First character (5 bits)
Bits 9-5:    Second character (5 bits)
Bits 4-0:    Third character (5 bits)
```

**Character Codes** (0-31):
```
0-25:  Letters A-Z
26:    Space
27:    Period '.'
28:    Separator (context-dependent)
       - Wall text: 0x80 (special marker)
       - Message: Space
       - Scroll/Champion: Line feed
29:    Escape code 1 (character table)
30:    Escape code 2 (string table)
31:    End of text
```

### Escape Codes

**Escape 1** (code 29): Next 5-bit code indexes character table.
**Escape 2** (code 30): Next 5-bit code indexes string table.

**Common String Table** (Escape 2):
```
Code 0-1:   (Empty)
Code 2:     "THE "
Code 3:     "YOU "
Code 4-31:  (Varies by version, mostly empty)
```

### Text Output Format

**Wall inscriptions**: Direct font indices (0-35).
**Messages/Scrolls**: ASCII codes (0x41-0x5A for A-Z).

### Champion Text Format

Champions defined in text data section using special format:

```
Name (7 chars max) + CR
Title part 1 (17 chars) + CR
Title part 2 (2 chars) + CR
Gender (M/F) + CR
Health (4 hex digits)
Stamina (4 hex digits, value × 10)
Mana (4 hex digits) + CR
Luck (2 hex)
Strength (2 hex)
Dexterity (2 hex)
Wisdom (2 hex)
Vitality (2 hex)
Anti-magic (2 hex)
Anti-fire (2 hex) + CR
Fighter skills (4 hex, one per hidden skill)
Ninja skills (4 hex)
Priest skills (4 hex)
Wizard skills (4 hex) + END
```

Example:
```
HALK\r
BARBARIAN WARRIO\r
R \r
M\r
12CE0FA0008C\r
0A64460505055A5000
```

---

## Compression

A new game's `dungeon.dat` may be compressed. `ReadDatabases` reads the first 8 bytes and
takes the file as compressed when their first word is 33028; otherwise it rewinds and
reads it plain (`doc/CSBwin-src/SaveGame.cpp:2558-2586`). A saved game is never read this
way. The port: `DungeonLoader.loadDungeonDat` and `ExpandData`
(`src/core/compression.ts`), checked by `tools/dump-compressed-dungeon.ts`.

### The 8-byte header

| Offset | Type | Meaning |
|--------|------|---------|
| +0x00 | word | 33028 (`0x8104`) |
| +0x02 | long | The expanded size in bytes |
| +0x06 | word | `d.Word22592`, which a plain file leaves at `_ReadEntireGame`'s 13 (`SaveGame.cpp:1571`) |

All three big-endian. The rest of the file is the compressed body, expanded by
`ExpandData` into a buffer that `FetchDataBytes` then reads as it would the plain file.

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
`Word22592` 12. The expanded image ends with the checksum word `ReadDatabases` compares
with the byte sum of everything it fetched (`SaveGame.cpp:2866-2870`), 0x939f, and the
port's expansion matches it. DM's `dungeon.dat` is plain, and has no checksum word.

---

## Summary

### Key Points

1. **Binary format**: All multi-byte values must handle endianness
2. **Packed data**: Extensive bit-packing for space efficiency
3. **Linked lists**: Objects chained via nextObjectID fields
4. **Indexed access**: Column index optimizes object lookup
5. **Optional features**: Compression and checksum are optional
6. **Version differences**: DM, CSB, and DM2 have slight variations

### Implementation Checklist

- [ ] Detect endianness and convert if needed
- [ ] Handle optional compression (signature 0x8104)
- [ ] Parse header (44 bytes)
- [ ] Parse map descriptors (16 bytes × count)
- [ ] Parse column index (2 bytes × columns)
- [ ] Parse object list (2 bytes × list size)
- [ ] Parse text data (5-bit encoding)
- [ ] Parse all 16 databases
- [ ] Parse map data (tile definitions)
- [ ] Verify checksum if present
- [ ] Build 3D array for tile access
- [ ] Build object lookup structures

### Testing

Test with these dungeons:
- **Dungeon Master** (dungeon ID 99)
- **Chaos Strikes Back** (dungeon ID 13)
- **CSB Prison** (dungeon ID 8)

Verify:
- Party starts at correct position
- Map dimensions match
- Object counts match header
- Checksum validates (if present)

---

## References

- Original documentation: dmweb.free.fr
- CSBWin source code: `doc/CSBwin-src/SaveGame.cpp` (ReadDatabases function)
- Original JavaScript parser: `static/js/dungeon.js` (the pre-TypeScript
  proof-of-concept, retired in Phase 14 — recoverable from git history)
