# CSBWin C++ Source Code - Architecture Documentation

This document provides a comprehensive overview of the CSBWin (Dungeon Master) source code architecture, intended as a reference for porting to TypeScript/Web.

**Source**: CSBWin C++ codebase in `doc/CSBwin-src/` (111,330 total lines of code)
**Date**: 2026-01-04
**Purpose**: Reference for TypeScript web port implementation

---

## Table of Contents

1. [Core Game Loop & Timing](#1-core-game-loop--timing)
2. [Movement System](#2-movement-system)
3. [Rendering System](#3-rendering-system)
4. [Data Structures](#4-data-structures)
5. [File Loading](#5-file-loading)
6. [Object System](#6-object-system)
7. [Critical Files for MVP](#7-critical-files-for-mvp)
8. [Implementation Recommendations](#8-implementation-recommendations)

---

## 1. Core Game Loop & Timing

### Main Loop Location
- **File**: `CSBCode.cpp` (11,445 lines - largest file in codebase)
- **Entry point**: `tag000698` (approximately line 600)

### Loop Structure

```cpp
tag000698:
    - Process VBL (vertical blank) timing
    - Load party level if needed
    - ProcessTimers() - Handle all scheduled events
    - DrawViewport() - Render 3D view if not sleeping
    - Handle mouse events
    - Wait for button flash effects
    - Display character damage numbers
    - d.Time++ - Increment game time
    - Loop back to tag0007b4 if no action needed
```

### Timing System

The game uses a **VBL (Vertical Blank Interrupt)** based timing system inherited from Atari ST:

**Key Variables** (in `Data.h`):
- `d.clockTick` (line ~900): Set to 1 when game should advance one tick
- `d.Speed` (line ~905): VBLs per clock tick (configurable game speed)
- `d.vblCount` (line ~906): Increments with each VBL
- `d.Time` (line ~499): Virtual game time in clock ticks

**VBL Interrupt Handler**:
- Function: `vblInterrupt()` at line ~894 in `CSBCode.cpp`
- Runs at ~60Hz (screen refresh rate)
- Increments `d.vblCount`
- When `d.vblCount >= d.Speed`, sets `d.clockTick = 1`

**Game Speed Settings**:
```cpp
speedTable[SPEED_NUMSPEED]:
    SPEED_NORMAL: 15 VBL per tick (~4 ticks/second)
    SPEED_FAST:   11 VBL per tick (~5.5 ticks/second)
    SPEED_SLOW:   22 VBL per tick (~2.7 ticks/second)
```

**Tick Processing Flow**:
1. VBL interrupt increments `d.vblCount` every ~16ms
2. When threshold reached, main loop detects `d.clockTick == 1`
3. `ProcessTimers()` executes all scheduled events
4. Game state updates (monsters move, projectiles fly, etc.)
5. `d.Time` increments
6. `d.clockTick` reset to 0

### Timer System

Timers drive most game logic (AI, projectiles, effects, doors, etc.)

**TIMER Structure** (CSB.h line ~1990):
```cpp
class TIMER {
    ui32 m_timerTime;        // Bits 0-23: when to fire, 24-31: level
    ui8  m_timerFunction;    // Timer type (0-63)
    ui8  m_timerUByte5-9;    // Function-specific parameters
    RN   m_timerObj6-8;      // Object references
    ui16 m_timerSequence;    // For sequenced timers
}
```

**Key Timer Functions**:
- 0-5: Actuator timers (switches, pressure plates)
- 6: Creature generator
- 7: Portrait effects (champion UI animations)
- 22: Disk operations
- 29-41: Monster AI (one function per monster type)
- 48-49: Missile movement (fireballs, arrows)

---

## 2. Movement System

### Party Movement

**Main Function**: `MoveParty()` at line ~7944 in `CSBCode.cpp`

**Movement Buttons** (stored in `d.MoveButn18496[]`):
- 0: Move Forward
- 1: Turn Right / Slide Right
- 2: Move Backward
- 3: Turn Left / Slide Left
- 4-5: Vertical movement (up/down stairs)

### Movement Processing Flow

1. **Input Detection**
   - Mouse clicks detected via `Mouse.cpp`
   - Keyboard handled via platform-specific code
   - Button hit detection on movement arrows

2. **Direction Calculation**
   - `d.partyFacing`: 0=North, 1=East, 2=South, 3=West
   - Delta tables: `d.Word18560[]` and `d.Word18568[]`
   - `RelativeXY(facing, direction)`: Converts relative to absolute coordinates

3. **Collision Detection**
   - `GetCellFlags(x, y)`: Retrieves cell type at position
   - `RoomType()`: Extracts room type from cell flags
   - Validates movement based on cell type

4. **Special Tile Handlers**
   - **Stairs**: `TraverseStairway()` - Level transitions
   - **Teleporters**: Processed via DB1 (teleporter database)
   - **Pits**: Check for falling, rope climbing
   - **Doors**: Check if open/closed state allows passage

5. **Stamina Cost**
   - Formula: `3 * load / maxLoad + 1` per champion
   - `AdjustStamina()`: Deducts stamina for movement
   - Heavy load = higher stamina cost

### Object Movement

**File**: `MoveObject.cpp`
**Function**: `MoveObject(RN object, x, y, newX, newY)`

Handles:
- Moving items between tiles
- Monster repositioning
- Projectile flight
- Cloud expansion

---

## 3. Rendering System

### Overview

The viewport uses **column-based ray-casting** similar to original Dungeon Master, rendering a 112×136 pixel first-person view.

### Main Files
- **Viewport.cpp** (7,290 lines)
- **Core function**: `DrawViewport(facing, x, y)` at line ~6694

### Rendering Architecture

#### View Distance System

Renders in discrete distance layers from near to far:
- **D1**: 1 tile ahead (largest on screen)
- **D2**: 2 tiles ahead
- **D3**: 3 tiles ahead
- **D4**: 4 tiles ahead (smallest, at horizon)

Each distance has predefined screen rectangles for:
- Left/center/right walls
- Floor/ceiling
- Object positions (0-3 per tile)

#### Cell Traversal

```
1. Start from party position (x, y) and facing direction
2. Iterate through cells in view frustum (5×4 grid)
3. For each visible cell:
   a. Get cell flags
   b. Determine room type
   c. Draw walls (if any)
   d. Draw floor/ceiling
   e. Draw decorations
   f. Draw objects in cell
   g. Register clickable buttons
```

#### Wall Rendering

Uses **skin system** for texture mapping:

**SKIN_CACHE class** (data.cpp):
- `GetSkin(level, x, y)`: Returns texture ID for cell
- Skins vary by level (stone, wood, brick, etc.)
- Default skins stored in EXPOOL (extended pool database)

**Wall Graphics**:
- Pre-rendered perspective views at each distance
- Graphics loaded from `graphics.dat`
- Decorations (cracks, torches, etc.) composited on top

#### Graphics Data

**BACKGROUND_LIB class**: Manages all background graphics
- `GetBitmap()`: Raw bitmap data
- `GetMask()`: Transparency masks
- LRU cache for frequently used graphics

**Graphic Categories**:
- Wall textures (front, side views at each distance)
- Floor/ceiling textures
- Decorations (torches, cracks, rings, etc.)
- Object sprites (items, monsters)

#### Viewport Output

- Renders to `d.pViewportBMP` (112×136 pixels)
- Uses 4-bitplane format (16 colors, Atari ST heritage)
- VBL interrupt copies viewport to screen buffer
- Final display at `d.LogicalScreenBase`

#### Object Rendering

Objects rendered as sprites:
- **Monsters**: Animated, multiple frames per creature
- **Items**: Small icons (weapons, potions, food, etc.)
- **Effects**: Fireballs, lightning, poison clouds

**Click Detection**:
- Objects create entries in `ViewportObjectButtons[]`
- Mouse clicks test against button rectangles
- Returns clicked object RN (Record Name)

---

## 4. Data Structures

### Global Data Structure

Almost all game state stored in global structure `d` (Data.h):
```cpp
class DATA {
    // Party state
    CHARDESC CH16482[4];        // 4 champions
    ui16 partyX, partyY;        // Party position
    ui8 partyLevel;             // Current level
    ui8 partyFacing;            // Direction (0-3)

    // Dungeon
    LEVELDESC *pLevelDescriptors;
    ui8 ***pppdPointer10450;    // 3D cell flags [level][x][y]
    RN *objectList;             // Object list
    ui16 *objectListIndex;      // Column index
    ui16 *objectLevelIndex;     // Level index

    // Databases
    DATABASES databases;        // All object databases

    // Timing
    ui32 Time;                  // Game time in ticks
    ui16 Speed;                 // VBLs per tick
    ui16 vblCount;              // VBL counter
    ui8 clockTick;              // Tick flag

    // Graphics
    ui8 *pViewportBMP;          // Viewport bitmap
    BACKGROUND_LIB backgroundLib;
    SKIN_CACHE skinCache;

    // ... hundreds more fields
};

extern DATA d;  // Global instance
```

### Level/Map Structures

#### LEVELDESC (CSB.h line ~2084)
```cpp
struct LEVELDESC {
    ui16 cellOffset;        // Offset in cell flag array
    ui8  offsetX;           // Level X offset in dungeon
    ui8  offsetY;           // Level Y offset
    i16  word8;             // Packed: level#, columns, rows
    i16  word10;            // Wall/floor decoration counts
    i16  word12;            // Door decorations

    ui8 LastColumn()        // Max column index
    ui8 LastRow()           // Max row index
    ui8 numMonsterType()    // Types of monsters
};
```

**Level Storage**:
- `d.pLevelDescriptors[level]`: Array of level descriptors
- `d.pppdPointer10450[level][x][y]`: 3D cell flags array
- `d.LoadedLevel`: Currently loaded level number

#### Cell Flags (CELLFLAG)

1 byte per cell encoding room type and state:

```cpp
typedef ui8 CELLFLAG;

// Bits 5-7: Room type
enum ROOMTYPE {
    roomSTONE = 0,      // Wall
    roomOPEN = 1,       // Floor
    roomPIT = 2,        // Pit (fall through)
    roomSTAIRS = 3,     // Stairs up/down
    roomDOOR = 4,       // Door
    roomTELEPORTER = 5, // Teleporter
    roomFALSEWALL = 6,  // Trick wall
};

// Bits 0-4: Type-specific flags
```

**Type-Specific Flags**:

**roomSTONE** (Wall):
- Bits 0-3: Random decoration on West/South/East/North

**roomDOOR**:
- Bits 0-2: Door state (0=open, 4=closed, 5=bashed)
- Bit 3: Orientation (0=EW, 1=NS)

**roomSTAIRS**:
- Bit 2: Direction (0=down, 1=up)
- Bit 3: Orientation (0=EW, 1=NS)

**roomPIT**:
- Bit 0: False pit (don't fall)
- Bit 2: Obscure (not obvious)
- Bit 3: Open (will fall through)

**roomTELEPORTER**:
- Bit 2: Visible
- Bit 3: Active

**roomFALSEWALL**:
- Bit 0: Visible but open
- Bit 2: Active (invisible and open)

### Object System - RN (Record Name)

#### RN Class (CSBTypes.h line 269)

The core of Dungeon Master's object system:

```cpp
class RN {
private:
    ui16 indirectIndex;  // Index into indirect tables

public:
    DBTYPE dbType()      // Returns database type (0-15)
    ui16 idx()           // Returns index within database
    ui8 pos()            // Position in cell (0-3)
    RN pos(ui32 p)       // Set position

    bool operator == (RN rn)
    bool operator == (RNVAL i)
};
```

**Indirect Indexing System**:
```
RN.indirectIndex → dataTypeMap[i] → dbType & pos
                → dataIndexMap[i] → actual DB index
```

Benefits:
- Objects can move between databases without updating references
- Allows gaps in database arrays (deleted objects)
- Special values: `RNnul` (0xffff), `RNeof` (0xfffe)

**Special RN Values** (RNVAL enum):
```cpp
RNeof             = 0xfffe  // End of linked list
RNnul             = 0xffff  // Null/empty
RNFireball        = 0xff80  // Fireball spell
RNPoison          = 0xff81  // Poison cloud
RNLightning       = 0xff82  // Lightning bolt
RNDispellMissile  = 0xff83  // Dispel magic
// ... more spell constants
```

#### Database Types (DBTYPE enum, line 213)

```cpp
enum DBTYPE {
    dbDOOR      = 0,   // Doors (4 bytes)
    dbTELEPORTER= 1,   // Teleporters (6 bytes)
    dbTEXT      = 2,   // Text strings (2 words)
    dbACTUATOR  = 3,   // Switches, pressure plates (8 bytes)
    dbMONSTER   = 4,   // Creatures (16 bytes)
    dbWEAPON    = 5,   // Weapons (4 bytes)
    dbCLOTHING  = 6,   // Armor, clothes (4 bytes)
    dbSCROLL    = 7,   // Scrolls (4 bytes)
    dbPOTION    = 8,   // Potions (4 bytes)
    dbCHEST     = 9,   // Containers (8 bytes)
    dbMISC      = 10,  // Food, keys, gems, etc. (4 bytes)
    dbEXPOOL    = 11,  // Extended pool (variable)
    db12        = 12,  // Unused
    db13        = 13,  // Unused
    dbMISSILE   = 14,  // Projectiles (8 bytes)
    dbCLOUD     = 15,  // Poison/spell clouds (4 bytes)
    dbUNKNOWN   = 16
};
```

#### DATABASES Class (data.cpp line ~434)

Manages all object databases:

```cpp
class DATABASES {
    DBCOMMON *m_Address[16];    // Pointers to each DB
    i32 m_numEnt[16];           // Entry count per DB

    void Allocate(dbNum, numEntries)
    RN FindEmptyDBEntry(dbType)
    DBCOMMON *GetCommonAddress(RN object)

    template<class T> T* GetAddress(RN object)
};
```

All database records start with common header:

```cpp
class DBCOMMON {
    RN m_link;  // Next object in linked list
    // ... type-specific fields follow
};
```

### Champion Structure

#### CHARDESC (Data.h, ~line 16482)

Each champion (~832 bytes):

```cpp
struct CHARDESC {
    char name[12];                  // Name
    i16 m_wHP, m_wMaxHP;           // Hit points
    i16 m_wStamina, m_wMaxStamina; // Stamina
    i16 m_wMana, m_wMaxMana;       // Mana

    ATTRIBUTE strength;             // 3 bytes (current/max/min)
    ATTRIBUTE dexterity;
    ATTRIBUTE wisdom;
    ATTRIBUTE vitality;
    ATTRIBUTE antimagic;
    ATTRIBUTE antifire;

    RN slots[30];                   // Inventory slots:
                                    // 0-1: hands
                                    // 2-7: body armor
                                    // 8-9: neck
                                    // 10-17: backpack
                                    // 18-29: chest

    i16 skills[20];                 // Skill levels (4 per class)
    i32 experience[4];              // Experience points

    i16 load;                       // Current carry weight
    i16 maxLoad;                    // Max carry capacity

    ui8 food, water;                // Food/water levels

    // ... many more fields for UI, effects, etc.
};
```

Party stored in `d.CH16482[4]` (max 4 champions).

---

## 5. File Loading

### Dungeon.dat Loading

#### Main Function
`ReadDatabases()` in `SaveGame.cpp` line ~2324

#### Loading Process

```cpp
1. Open DUNGEON.DAT file
2. Check for extended features block (new format)
3. Optional: Decompress entire file to memory (if compressed)
4. Read DUNGEONDATINDEX header (44 bytes):
   - Random seed / dungeon ID
   - Number of levels
   - Database sizes [16]
   - Starting party position
   - Object list size
   - Text array size
5. Swap header to little-endian if needed
6. Allocate and read level descriptors (16 bytes × numLevels)
7. Allocate and read object indices:
   - objectLevelIndex (ui16 × numLevels)
   - objectListIndex (ui16 × numColumns)
8. Allocate and read object list (RN array)
9. Read text array (compressed or indirect)
10. For each database 0-15:
    a. Allocate memory (size × (entries + extra slots))
    b. Read data from file
    c. Swap endianness if needed
    d. Initialize empty entries
11. Read cell flags for all levels
12. Build 3D pointer array for fast access
13. Verify checksum (optional)
```

#### DUNGEONDATINDEX Structure

```cpp
struct DUNGEONDATINDEX {
    ui16 randomSeed;        // Dungeon ID (99=DM, 13=CSB, etc.)
    ui16 mapDataSize;       // Total cell data size
    ui8  numLevels;         // Number of levels
    ui8  padding;
    ui16 textDataSize;      // Size in words
    ui16 startingPos;       // Packed position + facing
    ui16 objectListSize;    // Size in words
    ui16 dbSizes[16];       // Objects per database
};
```

**Starting Position Encoding**:
```
Bits 11-10: Facing (00=N, 01=E, 10=S, 11=W)
Bits 9-5:   Y coordinate
Bits 4-0:   X coordinate
```

### Graphics.dat Loading

#### Main Function
`ReadCSBgraphic()` in `Graphics.cpp`

#### File Structure

```
1. Header: Number of graphics
2. Section table: Offset and size for each graphic
3. Compressed graphic data (IMG1/IMG2 format)
```

#### Graphic Types (CSB_GRAPHICTYPE)

```cpp
enum CSB_GRAPHICTYPE {
    ViewportOverlays = 0,    // Special effects
    Portraits = 1,           // Champion faces
    Sounds = 2,              // PCM audio
    BackgroundGraphics = 3,  // Walls, floors, objects
    OverlayPalettes = 4,     // Color palettes
    AltMonsterGraphics = 5,  // Alternate creature sprites
    WallDecorations = 6,     // Cracks, torches, etc.
    FloorDecorations = 7,    // Floor items, debris
};
```

#### BACKGROUND_LIB Class

Graphics loaded on-demand with LRU caching:

```cpp
class BACKGROUND_LIB {
    GetBitmap(index)     // Returns raw bitmap
    GetMask(index)       // Returns transparency mask
    LoadGraphic(index)   // Load from file
    FreeOldest()         // LRU cache eviction
};
```

**IMG1/IMG2 Format**:
- Header: width (2 bytes), height (2 bytes)
- Data: RLE-compressed nibbles (4-bit values)
- 16 color palette indexes
- Endianness: IMG1=big-endian, IMG2=little-endian

---

## 6. Object System

### Object Placement

Objects organized in **linked lists per tile**:

```
Cell (x, y):
  objectList[index] → RN (first object)
      ↓ m_link field
  objectList[...] → RN (second object)
      ↓ m_link
  objectList[...] → RN (third object)
      ↓ m_link
  RNeof (end marker)
```

### Object Index System

**Two-level indexing** for performance:

1. **Level Index**: `objectLevelIndex[level]` → column offset
2. **Column Index**: `objectListIndex[column]` → object list index

**Finding First Object**:

```cpp
RN FindFirstObject(x, y) {
    // 1. Check if cell has objects
    CELLFLAG flags = GetCellFlags(x, y);
    if (!(flags & 0x10))  // Bit 4 = has objects
        return RNeof;

    // 2. Calculate column index
    ui16 column = objectLevelIndex[d.partyLevel] + x;

    // 3. Get base index in object list
    ui16 baseIndex = objectListIndex[column];

    // 4. Add row offset (count cells with objects in this column)
    ui16 offset = CountObjectCells(column, 0, y);

    // 5. Return first object
    return objectList[baseIndex + offset];
}
```

### Object Linking

**Adding Object**:
```cpp
AddObjectToRoom(RN newObj, RN prevObj, x, y) {
    if (prevObj == RNnul) {
        // Insert at head
        newObj.m_link = objectList[index];
        objectList[index] = newObj;
    } else {
        // Insert after prevObj
        newObj.m_link = prevObj.m_link;
        prevObj.m_link = newObj;
    }
}
```

**Removing Object**:
```cpp
RemoveObjectFromRoom(RN obj, x, y) {
    // Find previous object in list
    RN prev = FindPrevObject(obj, x, y);
    if (prev == RNnul) {
        // Was first object
        objectList[index] = obj.m_link;
    } else {
        // Unlink from chain
        prev.m_link = obj.m_link;
    }
    obj.m_link = RNnul;
}
```

### Object Iteration

```cpp
// Iterate all objects in cell
RN obj = FindFirstObject(x, y);
while (obj != RNeof) {
    // Process obj
    ProcessObject(obj);

    // Get next in chain
    DBCOMMON *common = databases.GetCommonAddress(obj);
    obj = common->m_link;
}
```

---

## 7. Critical Files for MVP

### Must Implement (Core Engine)

| File | Lines | Purpose |
|------|-------|---------|
| CSBCode.cpp | 11,445 | Main game loop, movement, core logic |
| Viewport.cpp | 7,290 | 3D rendering engine |
| data.cpp | 2,000+ | Database management, RN system |
| SaveGame.cpp | 2,800+ | Load dungeon.dat (ReadDatabases) |
| Timer.cpp | 1,500+ | Timer processing |

### Essential Headers

| File | Purpose |
|------|---------|
| CSBTypes.h | RN class, basic types, CELLFLAG |
| Data.h | Main DATA structure, all game state |
| CSB.h | LEVELDESC, DUNGEONDATINDEX, TIMER |
| Objects.h | Object type enums |

### Supporting Systems

| File | Purpose |
|------|---------|
| Code11f52.cpp | Helper functions (GetCellFlags, etc.) |
| Graphics.cpp | Bitmap operations, screen management |
| MoveObject.cpp | Object movement in dungeon |
| system.cpp | File I/O wrappers |

### For Basic MVP

**Minimum implementation order**:

1. **Data Layer** (~1,500 LOC):
   - RN system (indirect indexing)
   - Database loading from dungeon.dat
   - Cell flags and level descriptors

2. **Core State** (~500 LOC):
   - Party position (x, y, level, facing)
   - Level management
   - Object lists

3. **Movement** (~800 LOC):
   - Input handling (arrow keys)
   - Collision detection
   - Party repositioning
   - Basic stamina cost

4. **Simple Rendering** (~2,000 LOC):
   - Wall detection and drawing
   - Basic floor/ceiling
   - Placeholder graphics (colored rectangles)
   - Distance-based projection

5. **Main Loop** (~500 LOC):
   - Tick-based timing
   - Input → Movement → Render cycle
   - No timers/monsters initially

**Estimated Total for MVP**: 5,000-8,000 LOC (vs 111,330 total)

### Deferred for Post-MVP

- Combat system
- Monster AI
- Magic system
- Inventory management
- Save/load game state
- Sound effects
- UI polish (portraits, stats display)
- Timer-driven events
- Projectiles and spells

---

## 8. Implementation Recommendations

### TypeScript Port Strategy

#### Phase 1: Data Foundation
1. Create TypeScript equivalents of core types:
   - `RN` class with indirect indexing
   - `CELLFLAG` enum and helpers
   - Database record interfaces
2. Implement dungeon.dat parser:
   - Read header and level descriptors
   - Load object lists
   - Parse cell flags
   - Build 3D array for cell access
3. Implement graphics.dat parser (reuse existing JS code):
   - IMG1/IMG2 decompression
   - Palette management

#### Phase 2: Core Engine
1. Game state management:
   - Party position and facing
   - Current level
   - Simple champion data (just for movement)
2. Input system:
   - Keyboard arrow keys
   - Optional: Click detection on canvas
3. Movement system:
   - `MoveParty()` implementation
   - Collision detection against walls
   - Cell type handling (floor, door, pit, stairs)

#### Phase 3: Basic Rendering
1. Canvas-based viewport:
   - 112×136 pixel rendering area (scale up for modern screens)
   - HTML5 Canvas 2D context
2. Wall rendering:
   - Distance layers (D1-D4)
   - Texture mapping from graphics.dat
   - Start with solid colors, add textures later
3. Floor/ceiling:
   - Simple perspective grid initially
   - Full textures in polish phase

#### Phase 4: Integration
1. Main game loop:
   - `requestAnimationFrame()` for timing
   - Convert VBL system to modern timing
   - Input → Update → Render cycle
2. Level transitions:
   - Stairs up/down
   - Level loading
3. Teleporters (basic)

#### Phase 5: Polish
1. Real textures from graphics.dat
2. Decorations (torches, cracks)
3. Object rendering (items on floor)
4. Sound effects (reuse existing JS code)

### Key Architectural Decisions

#### Use Modern JavaScript Features
- `class` for object orientation
- `Map<>` and `Set<>` for lookups
- `Uint8Array` / `Uint16Array` for binary data
- `async/await` for file loading

#### Maintain CSBWin Semantics
- Keep RN indirect indexing (enables future features)
- Preserve cell flag bit encoding
- Match movement collision logic exactly
- Use same coordinate system (origin at top-left)

#### Optimize for Web
- Load graphics progressively (not all at once)
- Use web workers for heavy parsing if needed
- Cache rendered wall/floor tiles (sprites)
- Consider WebGL for viewport rendering (future)

#### Testing Strategy
- Unit tests for RN system
- Unit tests for cell flag parsing
- Unit tests for coordinate math
- Integration test: Load level 1, verify structure
- Manual test: Walk through corridors without bugs

### Estimated Effort

| Phase | LOC | Effort |
|-------|-----|--------|
| Data foundation | 1,500 | 3-5 days |
| Core engine | 1,000 | 2-3 days |
| Basic rendering | 2,000 | 4-6 days |
| Integration | 500 | 1-2 days |
| **MVP Total** | **5,000** | **10-16 days** |
| Polish | 2,000 | 3-5 days |
| **Playable Total** | **7,000** | **13-21 days** |

### Critical Gotchas

1. **Endianness**: Original data files are big-endian (Atari ST). Conversion needed.
2. **Coordinate Systems**: CSBWin uses (column, row) not (x, y). Careful!
3. **Bit Packing**: Extensive use of bit fields. TypeScript doesn't have bit fields; use bit masks.
4. **Global State**: CSBWin uses global `d` structure. Consider encapsulation in TypeScript.
5. **Memory Management**: C++ uses manual allocation. JavaScript is GC'd; watch for leaks in large arrays.
6. **Timing**: VBL system at 60Hz won't match `requestAnimationFrame()` exactly. Adjust for smoothness.
7. **Graphics Format**: 4-bitplane format needs conversion to RGBA for canvas.

---

## Summary

CSBWin is a well-architected port of Dungeon Master with clear separation of concerns:

- **Game Loop**: VBL-based timing at ~60Hz
- **Movement**: Tile-based with collision detection
- **Rendering**: Column-based ray-casting viewport
- **Data**: Indirect RN object system with 16 specialized databases
- **Storage**: Binary files (dungeon.dat, graphics.dat) with optional compression

**MVP Requirements**:
- Parse dungeon.dat (levels, objects, cell flags)
- Parse graphics.dat (walls, floors)
- Implement party movement with collision
- Render first-person view (walls + floor/ceiling)
- Main loop with keyboard input

**Estimated MVP**: 5,000-8,000 lines of TypeScript, achievable in 2-3 weeks.

This architecture is proven and suitable for web port with modern JavaScript features.
