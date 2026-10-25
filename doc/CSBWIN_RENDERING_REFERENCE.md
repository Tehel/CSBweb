# CSBWin Graphics Rendering Reference

Complete reference for how CSBWin (the C++ Dungeon Master port) implements graphics rendering, with direct references to source code locations.

## Table of Contents
1. [Graphics System Initialization](#graphics-system-initialization)
2. [Memory Architecture](#memory-architecture)
3. [Graphics Loading](#graphics-loading)
4. [DrawViewport: The Main Render Loop](#drawviewport-the-main-render-loop)
5. [Floor and Ceiling Rendering](#floor-and-ceiling-rendering)
6. [Wall Rendering](#wall-rendering)
7. [Bytecode System](#bytecode-system)
8. [Blitting Operations](#blitting-operations)
9. [Screen Output](#screen-output)
10. [Scaled Sprite Rendering](#scaled-sprite-rendering)
11. [CSBgraphics Decorations](#csbgraphics-decorations)
12. [CSBgraphics Container Format](#csbgraphics-container-format)
13. [Backgrounds and Skins](#backgrounds-and-skins)
14. [Bytecode Interpreter Details](#bytecode-interpreter-details)
15. [Virtual graphics](#virtual-graphics)
16. [Skins in the data sets](#skins-in-the-data-sets)

---

## Graphics System Initialization

### Startup Sequence

**Location**: `CSBCode.cpp` lines 10104-10160

```cpp
// Allocate memory for bitmaps
d.pCeilingBitmap = allocateMemory(CEILING_BITMAP_SIZE, 1);
d.pFloorBitmap = allocateMemory(FLOOR_BITMAP_SIZE, 1);

// Allocate memory for wall bitmaps
d.pWallBitmaps[5] = allocateMemory(392, 1);
d.pWallBitmaps[6] = allocateMemory(392, 1);
d.pWallBitmaps[4] = allocateMemory(3264, 1);
d.pWallBitmaps[3] = allocateMemory(5112, 1);
d.pWallBitmaps[2] = allocateMemory(14208, 1);
d.pWallBitmaps[1] = allocateMemory(2176, 1);
d.pWallBitmaps[0] = allocateMemory(2176, 1);

// Allocate unified viewport buffer (15232 bytes)
d.pViewportBMP = allocateMemory(15232, 1);
d.pViewportBlack = d.pViewportBMP + 3248;    // Offset for black area
d.pViewportFloor = d.pViewportBlack + 4144;  // Offset for floor area
```

**Key Points**:
- All graphics memory allocated at startup
- Viewport buffer is a **single contiguous block** divided into sections
- Pointers used to reference different sections

### Memory Sizes

```cpp
// From the allocations:
CEILING_BITMAP_SIZE = 3248 bytes  // 29 scanlines at 112 bytes/line
FLOOR_BITMAP_SIZE   = 7840 bytes  // 70 scanlines at 112 bytes/line
Black area          = 4144 bytes  // 37 scanlines at 112 bytes/line

// Wall bitmap sizes:
Bitmaps 0-1: 2176 bytes each (closest walls)
Bitmap 2:    14208 bytes
Bitmap 3:    5112 bytes
Bitmap 4:    3264 bytes
Bitmaps 5-6: 392 bytes each (far corners; 6 is a mirror buffer)
```

---

## Memory Architecture

### Viewport Buffer Layout

**Location**: `CSBCode.cpp` lines 10121-10123

```
Address          Size    Section           Purpose
═══════════════════════════════════════════════════════════
d.pViewportBMP   3248    Ceiling section   Top 29 scanlines
                                           (224 pixels × 29 lines)
───────────────────────────────────────────────────────────
+3248            4144    Black section     Middle 37 scanlines
d.pViewportBlack                           (cleared to black)
───────────────────────────────────────────────────────────
+7392            7840    Floor section     Bottom 70 scanlines
d.pViewportFloor                           (224 pixels × 70 visible)
═══════════════════════════════════════════════════════════
Total: 15232 bytes
```

### Atari ST Bitmap Format

**Bitplane Organization**:
```
Width: 224 pixels (0x70 bytes per scanline)
Bitplanes: 4 (for 16 colors)
Bytes per scanline: (224 / 16) × 2 × 4 = 112 bytes

Pixel encoding: Interleaved bitplanes
  For each 16-pixel group: 4 words (one per plane), interleaved
```

**Reference**: `Mirror()` is called with `0x70` which is **bytes per scanline** (112), not pixels:
- `Viewport.cpp` line 6743: `Mirror(d.pViewportFloor, 0x0070, 0x0046)`
- `Viewport.cpp` line 6753: `Mirror(d.pViewportBMP, 0x0070, 0x001d)`

---

## Graphics Loading

### ReadFloorAndCeilingBitmaps()

**Location**: `CSBCode.cpp` lines 2858-2867

```cpp
void ReadFloorAndCeilingBitmaps(i16 P1)
{
  if (P1 != d.CurrentFloorAndCeilingGraphic)
  {
    d.CurrentFloorAndCeilingGraphic = P1;
    ReadAndExpandGraphic(P1 * 2 + 75, d.pFloorBitmap, 0, 0, FLOOR_BITMAP_SIZE);
    ReadAndExpandGraphic(P1 * 2 + 76, d.pCeilingBitmap, 0, 0, CEILING_BITMAP_SIZE);
  };
}
```

**Logic**:
- Only loads if set has changed (caching)
- Floor graphic = `P1 * 2 + 75` (typically 75 for set 0)
- Ceiling graphic = `P1 * 2 + 76` (typically 76 for set 0)
- Decompresses and stores in dedicated buffers

### ReadWallBitmaps()

**Location**: `CSBCode.cpp` lines 2870-2905

```cpp
void ReadWallBitmaps(i16 newWallGraphicSet)
{
  i32 i;
  i32 firstWallGraphic;
  if ( (newWallGraphicSet != d.CurrentWallGraphic) || (d.PartyHasDied != 0) )
  {
    d.CurrentWallGraphic = newWallGraphicSet;
    firstWallGraphic = sw(77 + 13 * newWallGraphicSet);

    // Load door graphics (7 graphics)
    for (i=0; i<7; i++)
    {
      ReadAndExpandGraphic(firstWallGraphic + i, d.pDoorBitmaps[i+1], 0, 0);
    };

    // Load wall graphics (6 graphics: 84-89)
    for (i=0; i<6; i++)
    {
      ReadAndExpandGraphic(firstWallGraphic + 7 + i, d.pWallBitmaps[i], 0, 0);
    };

    // Create mirrored door graphic
    MakeMirror(d.pDoorBitmaps[2],
               d.pDoorBitmaps[0],
               d.DoorFrameRect[0].b.uByte4,
               d.DoorFrameRect[0].b.uByte5);

    // Create mirrored wall bitmap (pWallBitmaps[6] from pWallBitmaps[5])
    MakeMirror(d.pWallBitmaps[5],
               d.pWallBitmaps[6],
               d.wallRectangles[12].b.uByte4,
               d.wallRectangles[12].b.uByte5);
  };
}
```

**Wall Graphics Mapping** (set 0):
```
firstWallGraphic = 77 + 13 * 0 = 77

Graphics 77-83: Door graphics (7 graphics)
Graphics 84-89: Wall graphics (6 graphics)
  pWallBitmaps[0] = graphic 84  // F0R1 - closest right
  pWallBitmaps[1] = graphic 85  // F0L1 - closest left
  pWallBitmaps[2] = graphic 86  // F1 - distance 1
  pWallBitmaps[3] = graphic 87  // F2 - distance 2
  pWallBitmaps[4] = graphic 88  // F3 - distance 3
  pWallBitmaps[5] = graphic 89  // F3L2 - far corner
  pWallBitmaps[6] = mirrored copy of pWallBitmaps[5] (not read from graphics.dat)
```

**Key Points**:
- Only loads when wall set changes (caching)
- Creates mirrored versions dynamically (saves memory)
- Door and wall graphics loaded together

---

## DrawViewport: The Main Render Loop

### Function Signature

**Location**: `Viewport.cpp` line 6694

```cpp
void DrawViewport(i32 facing, i32 x, i32 y)
```

**Parameters**:
- `facing`: Direction party is facing (0=N, 1=E, 2=S, 3=W)
- `x`, `y`: Party position in dungeon coordinates

### Execution Flow

```cpp
void DrawViewport(i32 facing, i32 x, i32 y)
{
  SUMMARIZEROOMDATA roomData[21];

  // 1. FLOOR AND CEILING (Conditional)
  if (d.Word11684 != 0)
  {
    FloorAndCeilingOnly();  // Line 6732
  };

  // 2. MIRROR SELECTION
  d.UseMirrorImages = (I16)((x + y + facing)&1);
  if (d.UseMirrorImages != 0)
  {
    // Mirror Floor
    if (!skipDrawing) Mirror(d.pViewportFloor, 0x0070, 0x0046);  // Line 6743
    // ... setup mirrored wall bitmap pointers
  }
  else
  {
    // Mirror Ceiling
    if (!skipDrawing) Mirror(d.pViewportBMP, 0x0070, 0x001d);  // Line 6753
  };

  // 3. GATHER ROOM DATA FOR ALL 21 CELLS
  for (userCellNum = 0; userCellNum < 21; userCellNum++)
  {
    roomData[userCellNum].x = x;
    roomData[userCellNum].y = y;

    // Calculate absolute position
    RelativeXY(facing,
               relativeY[userCellNum],
               relativeX[userCellNum],
               &roomData[userCellNum].x,
               &roomData[userCellNum].y);  // Line 6770

    // Get skin (custom graphics set)
    roomData[userCellNum].skinNumber =
      skinCache.GetSkin(d.LoadedLevel,
                        roomData[userCellNum].x,
                        roomData[userCellNum].y);

    // Analyze cell contents
    SummarizeRoomInfo(&roomData[userCellNum], facing);  // Line 6780

    roomData[userCellNum].relativeCellNumber = userCellNum;
  };

  // 4. EXECUTE BYTECODE FOR ALL 21 CELLS
  for (userCellNum = 0; userCellNum < 21; userCellNum++)
  {
    if (roomData[userCellNum].skinNumber != 0)
    {
      // Execute custom skin code
      pCode = backgroundLib.GetCode(roomData[userCellNum].skinNumber);
      if (pCode != NULL)
      {
        mainOffset = pCode[0];
        startOffset = pCode[mainOffset + 8*userCellNum +
                           roomData[userCellNum].graphicRoomType];
        Interpret(pCode, startOffset, roomData, userCellNum, facing);  // Line 6803
      };
    }
    else
    {
      // Execute standard bytecode
      Interpret(pStdDrawCode[userCellNum][roomData[userCellNum].graphicRoomType],
                0,
                roomData,
                userCellNum,
                facing);  // Line 6810
    };
  };

  // ... additional rendering for corners (RF3L2, RF3R2)
}
```

### Key Control Variables

**d.Word11684**: Floor/ceiling redraw flag
- **Location**: Set throughout codebase when screen needs refresh
- **Line 3330**: Cleared to 0 by `FloorAndCeilingOnly()`
- **Lines**: Set to 1 by menu operations, graphics changes
- **Purpose**: Caching mechanism - only redraw floor/ceiling when needed

**d.UseMirrorImages**: Mirror selection flag
- **Line 6741**: `d.UseMirrorImages = (I16)((x + y + facing)&1);`
- **Purpose**: Alternates which surface (floor/ceiling) gets mirrored
- **Effect**: Creates visual variety by flipping textures

---

## Floor and Ceiling Rendering

### FloorAndCeilingOnly()

**Location**: `Viewport.cpp` lines 3322-3330

```cpp
void FloorAndCeilingOnly(void)
{
  static i32 count=0;
  if ((VBLMultiplier!=1) && (((count++)%1) != 0) && (VBLMultiplier!=99)) return;

  Instrumentation(icntFloorAndCeiling);

  ClearMemory(d.pViewportBlack, 4144);                  // Clear black area
  MemMove(d.pCeilingBitmap, d.pViewportBMP, 3248);     // Copy ceiling
  MemMove(d.pFloorBitmap, d.pViewportFloor, 7840);     // Copy floor

  d.Word11684 = 0;  // Clear flag - don't redraw until needed
}
```

**MemMove Parameters**: `MemMove(source, destination, size)`
- **Source**: Template bitmap buffer (pCeilingBitmap, pFloorBitmap)
- **Destination**: Section of viewport buffer (pViewportBMP, pViewportFloor)
- **Size**: Number of bytes to copy

**Process**:
1. Clear the black middle section (4144 bytes)
2. Copy ceiling template → viewport ceiling section (3248 bytes)
3. Copy floor template → viewport floor section (7840 bytes)
4. Clear redraw flag (caching)

**Result**: Viewport buffer now contains floor and ceiling, ready for walls to be drawn on top

### Mirror Operations

**Location**: `Viewport.cpp` lines 6743, 6753

```cpp
// Floor mirroring
Mirror(d.pViewportFloor, 0x0070, 0x0046);
// Parameters: (buffer, width=112 bytes/scanline, height=70 scanlines)

// Ceiling mirroring
Mirror(d.pViewportBMP, 0x0070, 0x001d);
// Parameters: (buffer, width=112 bytes/scanline, height=29 scanlines)
```

**Mirror Function**:
- Horizontally flips the bitmap in-place
- Width: 0x70 = 112 bytes/scanline (224 pixels wide in 4-plane ST format)
- Height: Number of scanlines to mirror

**Purpose**: Creates visual variety without storing multiple versions

---

## Wall Rendering

### Wall Rectangle Definitions

**Location**:
- The rectangle *usage mapping* is in `Viewport.cpp` (`StdRectanglePointers`), e.g. `RECT_StdWallRectangleF3` returns `&d.wallRectangles[0]` (`Viewport.cpp:2304-2317`).
- The rectangle coordinate values and source parameters live in the `DATA` structure as part of the tables loaded from `graphics.dat` at startup:
  - `CSBCode.cpp:10249` loads “graphic `0x22e`” into `d.Byte7248+2`
  - `Data.h:1124+` labels this region “Start of graphic 0x22e” and includes `RectPos wallRectangles[14];` within it (`Data.h:1253`).

### Standard bitmap/rectangle selection

The interpreter resolves “standard” bitmap and rectangle selectors via:
- `StdBitmapPointers()` (`Viewport.cpp:2261-2296`)
- `StdRectanglePointers()` (`Viewport.cpp:2298-2409`)

For exact opcode numeric values, see `doc/CSBWIN_VIEWPORT_REFERENCE.md` (it is generated directly from `Viewport.cpp`’s `enum OPCODE`).

---

## Bytecode System

### The Interpret Function

**Location**: `Viewport.cpp` line 6794 (estimated based on call sites)

```cpp
void Interpret(
  ui16 *pCode,              // Bytecode program
  i16 startOffset,          // Starting position in program
  SUMMARIZEROOMDATA *roomData,  // Data for all 21 cells
  i32 userCellNum,          // Current cell being drawn
  i32 facing                // Party facing direction
)
```

**Purpose**: Stack-based virtual machine that executes bytecode programs to render cells

### Bytecode Program Structure

**Location**: `Viewport.cpp` lines 1005-1200+ (example programs)

Example: Stone wall at F3 center (distance 3, front)
```cpp
// Drawing cell F3 (cell #4), room type STONE
ui16 pStdDrawCode[21][8][...] = {
  ...
  // Cell 4 (RF3 - distance 3 center)
  {
    // RoomType: STONE (0)
    StdWallBitmapF3,      // Push bitmap index 4 (graphic 88)
    StdWallRectangleF3,   // Push rectangle index 0 (64,20,160,71)
    StdBltShape,          // Pop both, blit bitmap to rectangle
    Return,               // End program
  },
  ...
};
```

### Key Opcodes

**Control Flow**:
```cpp
Return                = 65535,  // End execution
JumpZ                 = 60029,  // Jump if top of stack is zero
JumpNZ                = 60030,  // Jump if top of stack is non-zero
Literal               = 60031,  // Push immediate value
```

**Drawing Operations**:
```cpp
StdBltShape              = 60000,  // Blit bitmap to rectangle
StdDrawWallText          = 60001,  // Draw text on wall
StdDrawRoomObjects       = 60003,  // Draw objects in room
StdDrawFloorDecoration   = 60004,  // Draw floor decorations
StdDrawCeilingPit        = 60005,  // Draw ceiling pits
StdDrawDoor              = 60006,  // Draw door
StdDrawDoorSwitch        = 60007,  // Draw door switch
```

**Data Query Opcodes** (examples):
```cpp
F3                    = 60112,  // Push cell F3 number
F3L1                  = 60111,  // Push cell F3L1 number
Alcove                = 60214,  // Check if alcove present
HasDecoration         = 60215,  // Check if decoration present
```

### Opcode Handler Pattern

Each opcode type has an internal handler function that:
1. **Data opcodes**: Push values onto the stack
2. **Condition opcodes**: Evaluate conditions, push 0 or 1
3. **Action opcodes**: Pop arguments from stack, perform action
4. **Control opcodes**: Modify program counter

---

## Blitting Operations

### BltShapeToViewport()

**Location**: `CSBCode.cpp` line 2930 (TAG00437e)

```cpp
void BltShapeToViewport(ui8 *P1, RectPos *P2)
{
  dReg D0;
  ASSERT(verifyRectPos(P2),"rectpos");
  D0W = (UI8)(P2->b.uByte4);
  if (D0B != 0)
  {
    TAG0088b2((ui8 *)P1,                   // src
              (ui8 *)d.pViewportBMP,       // dst (viewport buffer)
              P2,                          // destination RectPos
              (UI8)(P2->b.uByte6),         // srcX (pixels)
              (UI8)(P2->b.uByte7),         // srcY (pixels)
              (UI8)(P2->b.uByte4),         // src bytes/line
              112,                         // dst bytes/line (224 pixels wide)
              10);                         // transparent color index
  };
}
```

**Key Points**:
- `TAG0088b2()` is the core blitter; `10` is used as a color-key (transparent color index)
- `112` is **bytes per scanline**, not pixels

### RectPos Structure

**Location**: `CSB.h` line 1366

```cpp
struct wordRectPos { i16 x1; i16 x2; i16 y1; i16 y2; };
struct byteRectPos { ui8 x1; ui8 x2; ui8 y1; ui8 y2; ui8 uByte4; ui8 uByte5; ui8 uByte6; ui8 uByte7; };
union RectPos { wordRectPos w; byteRectPos b; };
```

**Usage**:
- `x1, y1`: Top-left corner
- `x2, y2`: Bottom-right corner (inclusive in CSBWin screen usage, e.g. `Menu.cpp:452-455`)
- Width = `x2 - x1 + 1`
- Height = `y2 - y1 + 1`

---

## Screen Output

### BLT2Screen()

**Location**: `Menu.cpp` line 457

```cpp
BLT2Screen(d.pViewportBMP, &rectpos, 112, -1);
```

**Parameters**:
- `d.pViewportBMP`: Source buffer (viewport)
- `&rectpos`: Rectangle defining screen area
  - `x1=47, y1=33, x2=270, y2=168` (line 452-455)
- `112`: Source **bytes per scanline** (224 pixels wide in Atari ST 4-plane format; see `CSBCode.cpp:1127-1141`)
- `-1`: “no transparency” color-key (passed through to `TAG0088b2()` as `transparentColor`)

**Purpose**: Copy viewport buffer to actual screen memory at position (47, 33)

### Screen Rectangle

**Location**: `Menu.cpp` lines 452-455

```cpp
rectpos.w.y1 = 33;   // Top of viewport on screen
rectpos.w.y2 = 168;  // Bottom of viewport on screen
rectpos.w.x1 = 47;   // Left edge of viewport on screen
rectpos.w.x2 = 270;  // Right edge of viewport on screen
```

**Viewport on Screen**:
- Position: (47, 33)
- Size: 224×136 pixels (inclusive coordinates)
- Full screen: 320×200 pixels

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION                                       │
│    - Allocate viewport buffer (15232 bytes)             │
│    - Load floor/ceiling bitmaps                         │
│    - Load wall bitmaps                                  │
│    - Create mirrored versions                           │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 2. FLOOR/CEILING (Cached - only when d.Word11684 != 0) │
│    FloorAndCeilingOnly():                               │
│    - Clear black section                                │
│    - MemMove ceiling → pViewportBMP                     │
│    - MemMove floor → pViewportFloor                     │
│    - Clear d.Word11684 flag                             │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 3. MIRROR (Every frame)                                 │
│    Based on (x + y + facing) & 1:                       │
│    - Mirror floor OR ceiling                            │
│    - Updates wall bitmap pointers if mirroring          │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 4. ROOM DATA GATHERING (Loop 1: cells 0-20)            │
│    For each cell:                                       │
│    - RelativeXY() → absolute coordinates                │
│    - GetSkin() → custom graphics set                    │
│    - SummarizeRoomInfo() → analyze tile type            │
│    - Store in roomData array                            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 5. BYTECODE EXECUTION (Loop 2: cells 0-20)             │
│    For each cell:                                       │
│    - Get bytecode program for cell + room type          │
│    - Interpret(program, roomData, cell, facing)         │
│      ├─ Execute opcodes (push/pop stack)                │
│      ├─ StdBltShape → BltShapeToViewport()             │
│      │   ├─ Get bitmap + rectangle from stack           │
│      │   ├─ Loop through pixels                         │
│      │   ├─ Skip if color == 10 (transparent)           │
│      │   └─ Write to viewport buffer                    │
│      └─ Other drawing operations (doors, objects, etc.) │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 6. SCREEN OUTPUT                                        │
│    BLT2Screen():                                        │
│    - Copy viewport buffer → screen memory               │
│    - Position at (47, 33)                               │
│    - Size 224×136 pixels                                │
└─────────────────────────────────────────────────────────┘
```

---

## Key Architectural Patterns

### 1. Memory Buffer System
- **Single unified buffer** for viewport (ceiling + black + floor)
- **Separate template buffers** for floor/ceiling sources
- **Direct memory operations** (MemMove, ClearMemory)

### 2. Caching Strategy
- Floor/ceiling only redrawn when flag set
- Wall graphics loaded once per set
- Mirrored versions created dynamically

### 3. Data-Driven Rendering
- Bytecode programs define all drawing
- Custom skins can override default programs
- Room type determines which program executes

### 4. Transparency Model
- **Color index 10 = transparent**
- Skip drawing these pixels (color-key transparency)
- No alpha blending - simple skip logic

### 5. Coordinate Systems
- **Viewport space**: 224×136 pixels (render target)
- **Screen space**: 320×200 pixels (full display)
- **Dungeon space**: Grid coordinates (x, y)
- **Relative space**: Distance/direction from party

---

## Scaled Sprite Rendering

### ShrinkBLT

**Location**: `Graphics.cpp`

- `ShrinkBLT` downsizes bitplane graphics using fixed-point accumulators derived from `(srcWidth<<10)/dstWidth` and `(srcHeight<<10)/dstHeight`, seeds them with `+0x7fff`, and applies a 16-entry color map by dividing `pColorMap[color] / 10` to obtain the 4-bit output value (switch over `D5W/10`).
- It advances source rows using the width rounded to 16-pixel hunks.

### Scaled monsters

**Location**: `Code51a4.cpp`

- Monsters at distance 1/2 use `ShrinkBLT` with scale factors `20/32` or `16/32` and color maps `d.Byte6628` (medium) / `d.Byte6612` (far).
- The transparent color is selected by mapping the base transparent index through the same color map and dividing by 10.

### Monster palette selection (special colors)

**Location**: `Code390e.cpp`, `CSBCode.cpp`, `AsciiDump.cpp`

- `ReadGraphicsForLevel()` updates the viewport palettes before rendering a level: it calls `ModifyPalettes(9, 8)` and `ModifyPalettes(10, 12)` for defaults, then iterates over the level’s monster-type list (`pCurLevelDesc->numMonsterType()` entries read via `EndOfCELLFLAGS`) and applies per-monster overrides from `ITEM12.uByte11` (graphics `0x22e`) (`Code390e.cpp:323-343`).
  - `uByte11` low nibble selects a **special color scheme** for palette index `9`; high nibble selects a scheme for palette index `10`. A nibble value of `0` means “no override”.
- `ModifyPalettes(whichColor, newColor)` applies the selected scheme to **all six viewport palettes** (`Palette552[0..5]`) and also updates the **distance color maps** `Byte6628` (medium) and `Byte6612` (far) for that color index (`CSBCode.cpp:2895-2910`).
  - The special-color table is `specialColors[13][7]` (from graphics `0x22e`): 6 palette entries (one per light level) plus a final word containing the two distance-map bytes (low byte → `Byte6628`, high byte → `Byte6612`).
  - `AsciiDump.cpp` labels these as “Special Colors (for monsters on different levels)”.
- `SelectPaletteForLightLevel()` chooses `CurrentPalette` based on torch brightness and `PaletteBrightness`, so the monster colors come from `Palette552[CurrentPalette]` (`CSBCode.cpp:7301+`).

### Scaled floor items

**Location**: `Code51a4.cpp`

- Floor items at distance 1/2 use `ShrinkBLT` with scale factors `20/32` or `16/32` and color maps `d.Byte5744` (medium) / `d.Byte5728` (far).
- `dstWidth = (scaledWidthBytes << 1)` and `dstHeight = scaledHeight`.

### Missile sprite parity

**Location**: `Code51a4.cpp`

- Missile drawing switches on `(w124 & 1) != (facing & 1)` (parity test) to choose mirror/flip and graphic offset; it does not compare full facing.

---

## CSBgraphics Decorations

### ReadWallDecoration

**Location**: `CSBCode.cpp`

- `ReadWallDecoration` calls `ReadCSBgraphic(CGT_WallDecoration, id, 92, ...)`.
- Extended wall decorations (flag `graphicOrdinal & 0x10000`) use the CSBgraphics.dat data layout: 13 `DECORATION_DESC` placements, then a 2-byte pad, then side bitmap bytes (size `desc[11].width * desc[11].height`), then front bitmap bytes (size `desc[12].width * desc[12].height`), with `desc[11]` and `desc[12]` serving as source size descriptors. The bitmaps are Atari bitplanes, as a `graphics.dat` graphic is in memory (`doc/PROVEN_FACTS.md` → "A `CSBgraphics.dat` wall or floor decoration's bitmaps are Atari bitplanes").

### ReadFloorDecoration

**Location**: `CSBCode.cpp`

- `ReadFloorDecoration` reads `CGT_FloorDecoration` (minimum size 92).
- Extended floor decorations (flag `graphicOrdinal & 0x4000`) use 9 `DECORATION_DESC` entries followed by a 16-bit `mirrorFlags` and the bitmap, bitplanes as a wall's, at `&desc[9] + 2` (`doc/CSBwin-src/CSBCode.cpp:3898`).
- `DrawFloorDecorations` mirrors when `(((mirrorFlags >> (d.partyFacing + 9)) ^ (mirrorFlags >> relativeCell)) & 1) != 0`.

---

## CSBgraphics Container Format

### ReadCSBgraphic

**Location**: `Graphics.cpp`

- `ReadCSBgraphic` validates the `CSBg` sentinel, reads `version` and `numSection`, scans `SECTIONHEADER` entries to find matching `{type,id}`, then decompresses with `OVLDECODE` using 32-bit codewords and a table that grows when the code equals `maxTableLen-1`.

---

## Backgrounds and Skins

### Background data structures

**Location**: `CSB.h`

- `BACKGROUND_MASK` is defined with `srcX`, `srcY`, `dstX`, `dstY`, `width`, `height` in pixel units (with `srcX` multiple of 16) and a trailing `mask[]` array.
- `CGT_Backgrounds = 3` in `CSB_GRAPHICTYPE` for background assets.

### Background library

**Location**: `Viewport.cpp`

- `BACKGROUND_LIB::FindGraphicInCache` loads background assets via `ReadCSBgraphic(CGT_Backgrounds, graphicID, ...)` and caches them by `BACKGROUND_GRAPHIC.id`, searching the array from its start (`doc/CSBwin-src/Viewport.cpp:5808-5846`). The port is `src/data/BackgroundLib.ts`, checked by `tools/checks/background-lib.ts`.
- A graphic `GetBackgroundGraphic` does not find gets an entry of size -1 and no data (`Viewport.cpp:5862-5879`). Every later search finds that entry first, and every size check refuses it, so the section is never read again until `Cleanup`, and a graphic `CreateBackgroundGraphic` makes with that id afterwards is never found: `BackgroundGraphicExists` refuses the size -1 entry, so the create goes ahead and adds a second one behind it (`:5882-5906`). `BackgroundGraphicExists` records no miss, and reads the file again at each call (`:5848-5859`).
- `mustExist`, passed through to `ReadCSBgraphic`: `GetBitmap` and `GetDecorationBitmap` pass true, so a missing section ends `ReadCSBgraphic`'s `firstTime` (its "Missing section" message); `GetSkinDef`, `GetCode`, `GetMask` and `MaskExists` pass false (`Graphics.cpp:3280-3289`).
- A background section is CSBWin's native memory, so its words are little-endian: `CSBgraphics.dat`'s skin index reads 51 skins in Conflux 3.5's file, and each program's first word is its `mainOffset`.
- `BACKGROUND_LIB::GetSkinDef` reads background graphic ID `1` as the skin index: `pSkinIndex[0]` is the number of skins and `pSkinIndex[skinNum+1]` is the byte offset to that skin definition; it rejects entries where `skinDefOffset + minimumSize >= actualSize`.
- `GetSkinID` returns `pSkinDef[IDnum]`; `GetFloorGraphicID`/`GetMiddleGraphicID`/`GetCeilingGraphicID`/`GetWallGraphicID` map to indices `0..3`, `GetFloorMaskID`/`GetMiddleMaskID`/`GetCeilingMaskID`/`GetWallMaskID` map to `4..7`, and `GetCode` uses index `8` with a minimum code size of `2 * (1 + 8*21)` bytes.
- `GetWallDecorationID` expects `pSkinDef[9]` to be the floor-decoration count, skips `numFloorDec + 1` entries, then reads a wall-decoration count and IDs from the same array. It bounds its word index by `skinDefSize`, a count of bytes, so a word up to twice past the section's end passes (`Viewport.cpp:5752-5770`).
- In Conflux 3.5's and The Towers of Chaos 3.3's files a skin definition is thirteen words: the nine IDs, a floor-decoration count of 0, a wall-decoration count of 0 and two words of 0. Conflux's index holds 51 skins; skins 1 to 49 run programs 61 to 64, and skin 50 has none. The Towers' holds 38, and the offsets of skins 34 to 37 lie at the index's end or past it, so `GetSkinDef` refuses them (`tools/checks/background-lib.ts`).
- A program section is word 0, the start address in words, then the code, then the 168 cell addresses `pCode[pCode[0] + 8 * cell + graphicRoomType]`, followed by one `Return` (60000), the section's last word, in all five programs of the two files.
- A mask is a twelve-byte header and `(width + 15) / 16 * height` words of mask, the size `CreateNewMask` gives one (`Viewport.cpp:5498`); in both files' mask sections each ends where the next starts, and the last within the section. Every mask section a skin names holds 21 masks, but for the two of Conflux's that hold one.
- A bitmap section's first longword is its width, as `CreateVirtualBitmap` writes one (`Viewport.cpp:5473`): whole sixteen-pixel groups, from 96 to 416 pixels in Conflux's.
- `BACKGROUND_LIB::GetMask` ignores its `minimumSize`, and reads as `MaskExists` does. It treats background graphics as `ui32` arrays: `pGraphic[0]` is the number of masks and `pGraphic[masknum+1]` is the byte offset for the mask; it returns null if the offset is `0` or out of bounds.
- `BACKGROUND_LIB::GetDecorationBitmap` expects a layout of `ui16 numDecoration`, `ui16 offsets[numDecoration]`, `ui16 numLocation`, then `numLocation` entries; it returns `pBitmap` at the chosen offset and `pLocation` pointing at the selected location entry (cast to `ui8 *`).

### Drawing a skin's graphics

**Location**: `Viewport.cpp`

- `DrawCustomGraphic` pops `maskNumber`, `maskID`, `graphicID`, reads `GetMask(maskID, maskNumber, 12)` then `GetBitmap(graphicID, 2)`, and calls `ApplyBackground`; its `GTRACE` line, and under `_DEBUG` a second with the mask's `dstX`, `dstY`, `width` and `height` (`doc/CSBwin-src/Viewport.cpp:3070-3089`). `DrawCustomDecoration` pops `locationNumber`, `decorationNumber`, `decorationID`, and calls `ApplyDecoration` unless `GetDecorationBitmap` refuses; it has no `GTRACE` (`:3109-3122`). The port is `src/renderer/bytecode/ApplyBackground.ts`, checked by `tools/checks/custom-graphics.ts`.
- Both draw into `d.pViewportBMP`, the viewport in the Atari's form: 136 lines of 112 bytes, each sixteen pixels four big-endian plane words. A bitmap section's pixels and a mask's words are in that byte order, and a mask byte selects the eight pixels of the viewport byte it is ANDed with; only the headers, a bitmap's width longword and a mask's six words, are little-endian. The routines work on bytes, so the port runs them on the viewport converted to those bytes, a line at a time (`ViewportBMP`).
- `ApplyBackground` refuses a missing mask or bitmap, a `dstX` over 224 and a `width` that is not whole groups. When `dstX` and `srcX` are both on a group's start it copies whole groups, `m = *pMask | (*pMask << 16)` over each pair of plane words, after two checks in `i32` units: the blit's end within the viewport's 3808 longwords and within the bitmap. It does not clip: the address is `28*dstY + dstX`, so a negative `dstX` starts each line's blit at the end of the line above, and one past the right edge runs on at the next line's start (`:6451-6504`).
- Otherwise `ApplyBackground3` shifts the source's bytes against the destination's in four cases of the destination's bit (`SMR`, under 8 or not) and the source's shift (`SSR`, from `srcX & 15` to `dstX & 15`), clips the line at the viewport's right edge, and handles a negative `dstX` by skipping its whole groups (`:6131-6447`). Its only size check is the source's pixels. `BACKGROUND_MASK` says `srcX` must be on a group's start (`CSB.h:332`), and with it so every case draws the mask's pixels exactly. Off that rule the cases are wrong in ways of their own: a destination bit under 8 with a source shift of 8 or more draws nothing, its body being commented out with a `NotImplemented(0xcc12)`; a destination on a group's start reads the wrong source bytes for a source bit under 8; a destination bit of 8 or more with a shift under 8 reads its source a byte behind. Every mask of Conflux 3.5's and The Towers of Chaos 3.3's files has `srcX` on a group's start, and every one a skin names draws exactly (`tools/checks/custom-graphics.ts`).
- `ApplyDecoration` reads a decoration as a byte of width and one of height, then per group a mask word and four plane words, and its location as a byte of x, taken down to a group, and one of y. Its group loop runs `for (col=0; col<width; col+=2)` over `width/16` groups, so it draws the first half of each line, rounded up, and the next line is read from where the last stopped (`:6507-6548`). No data set here has a decoration, so the port keeps it as written.

### Skin cache

**Location**: `data.cpp`

- `SKIN_CACHE::GetSkin` loads expool records with `recId = (EDT_Skins << 24) + (level << 4) + (x / 2)`; the per-cell index is `(2 * y) + (x & 1)` and returns `0` for out-of-range or missing data.
- `SKIN_CACHE::GetDefaultSkin` reads expool record `recId = (EDT_Skins << 24) + 0x800000` into a 64-byte `defaultSkins` array and returns `defaultSkins[level]`.
- A cell's skin is kept nowhere but in those `EXPOOL` records, so a save keeps it with the rest of database 11. One record holds a column pair, two bytes a row: `memcpy` copies the record's native longwords into `m_columns` (`doc/CSBwin-src/data.cpp:2084`), and `DB11::swap` reads them little-endian (`data.cpp:1461-1470`), so byte `i` of a record is bits `8 * (i & 3)` up of its longword `i >> 2`. The default skins record is read the same way, byte `level` (`data.cpp:2119-2138`).
- `GetSkin` returns 0 for a negative level, for `x`/`y` below 0 or past the level's `LastColumn()`/`LastRow()`, for a column pair with no record, and for an index past the record (`data.cpp:2092-2116`). `Load` keeps one level's records, and forgets them all when another level is asked (`data.cpp:2065-2090`). `GetDefaultSkin` returns 0 while `EXPOOL` is not open, and reads its record only once, until `Cleanup` (`Graphics.cpp:2231`). `Cleanup` runs from `CleanupGraphics`, which `Cleanup(false)` calls (`data.cpp:2019`) before every game is read: at the start of `_StartCSB` and of each game it repeats (`CSBCode.cpp:11539`, `:11587`, `:11659`), and before a game set up again after a lost one (`Code1f9e6.cpp:302`). The port builds a new `SkinCache` with every world `DungeonState` takes (`src/engine/SkinCache.ts`).
- The byte order shows in Conflux 3.5's skins: read little-endian, 13% of its 11407 skinned cells are solid rock, which is two thirds of its cells; read big-endian, which moves each byte to the other corner of its two by two, 45% are (`tools/checks/skins.ts`).
- `SetSkin` does nothing when the byte already holds the skin, or when the index is past the record and the skin is 0. Otherwise it reads and deletes the old record, widens it to 64 bytes of zeros, sets the byte, and writes the record back trimmed of its trailing zero bytes to whole longwords, or writes none when every byte is 0 (`data.cpp:2142-2175`).
- `&GETSKIN` pops a location, `y` in bits 0-4, `x` in 5-9 and the level in 10-15, and pushes `GetSkin`; `&SETSKIN` pops the location, then the skin, and calls `SetSkin` with its low byte (`doc/CSBwin-src/DSA.cpp:3108-3136`). The viewport asks `d.LoadedLevel`.

### DrawViewport skin selection

**Location**: `Viewport.cpp`

- `DrawViewport` sets `roomData[userCellNum].skinNumber` from `skinCache.GetSkin` (fallback to `GetDefaultSkin`), on `d.LoadedLevel`, and for non-zero skins selects custom code with `mainOffset = pCode[0]` and `startOffset = pCode[mainOffset + 8*userCellNum + roomData[userCellNum].graphicRoomType]` before calling `Interpret` (`Viewport.cpp:6784-6813`). The port is `DrawViewport` and `skinProgramStart` (`src/renderer/DrawViewport.ts`); in Conflux 3.5's and The Towers of Chaos 3.3's programs, the code each cell's address leads to draws that cell's objects (`tools/checks/skin-programs.ts`).
- A skinned cell whose skin has no program (`GetCode` null) draws nothing (`Viewport.cpp:6796-6813`).
- `CustomBackgrounds` is compiled out (`#ifndef newgraphics`, and `newgraphics` is defined at `Viewport.cpp:315`). It uses `skinCache` and `backgroundLib.GetSkinDef` to apply background masks/bitmaps: `pSkinDef[0]/[4]` (mask size 64, bitmap size 7840), `pSkinDef[2]/[6]` (size 3248), and for `roomNum < 5` `pSkinDef[1]/[5]` (size 4144).

---

## Bytecode Interpreter Details

**Location**: `Viewport.cpp`

- The data stack and the return stack are static rings of 256 `ui16`, indexed by a `ui8` that `push` decrements first, kept from one `Interpret` to the next; `pop` returns an `i16` (`Viewport.cpp:2215-2247`). `popRN` reads the word unsigned (`:2249-2258`); `StdDrawRoomObjects` takes its contents that way (`:2921`).
- `Interpret` starts at `code + startAddr`, pushes a return-stack sentinel `0xffff`, treats opcodes `< 60000` as subroutine calls (push return address, jump to absolute offset), and `Return` pops back to that address until the sentinel (`:2473-2474`, `:3024-3028`, `:3299-3308`). An opcode of 60000 or more with no case ends `Interpret` with `InterpretError`, the sentinel left on the return stack: `FloorDecorationID` (60309) is one, in the enum and in no case.
- A jump's operand is read as `(i16)n` and added to `P` after the operand (`:2870-2881`).
- `LESS` and `GREATER` pop the top as `n` and compare it with the word under it: `n = pop(); push((n<pop()) ? 1 : 0)`, so `a b LESS` is `b < a`. `ULESS` compares the two as unsigned `i32`s, `SLASH` divides the second by the top, `ROLL` takes its count from the top, and `PICK` replaces the top `t` with the word `t` below it (`:3123-3193`).
- `IsOdd` is `(d.partyLevel + d.partyX + d.partyY + d.partyFacing) & 1` (`:3192`).
- The skin programs of Conflux 3.5 and The Towers of Chaos 3.3 leave a word on the data stack on some paths: Conflux's program 64, at cell F3L1's address (word 561), pushes `Literal 0`, and on the path that draws the standard wall drops it and pushes `Literal 1`; neither path pops what it left. No program leaves more than one, and every one returns to its sentinel (`tools/checks/skin-programs.ts`). Every standard program leaves both stacks as it found them (`tools/checks/render-probe.ts`).

---

## Virtual graphics

**Location**: `Viewport.cpp`

A skin's program makes graphics of its own, which it then draws with as it draws the
file's: a bitmap transformed from another (`CreateVirtualBitmap`), a mask transformed from
another (`CreateVirtualMask`), and a transform kept in a mask section for a later
`CreateVirtualBitmap` (`CreateVirtualAffineMask`). The port is `src/data/CustomBitmap.ts`
and the creators of `src/data/BackgroundLib.ts`, checked by `tools/checks/virtual-graphics.ts`.

- `AFFINEMASK` is twelve `i32`s: `Cxx`, `Cxy`, `Cxc`, `Cyx`, `Cyy`, `Cyc`, `srcX`, `srcY`, `srcWidth`, `srcHeight`, `dstWidth`, `dstHeight` (`doc/CSBwin-src/CSB.h:341-355`).
- `AffineTransform4` and `AffineTransform1` read destination pixel (`col`, `row`) from source pixel `srcX + ((Cxx*col + Cxy*row + Cxc + 16) mod 32*srcWidth) / 32`, and likewise in y with `Cyx`, `Cyy`, `Cyc`, `srcY` and `srcHeight`; `mod` is `((a % m) + m) % m`. The coefficients are in 32nds of a pixel, and the `+ 16` rounds to the nearest source pixel: `Cxx` 16 reads pixel `(col + 1) / 2` (`Viewport.cpp:196-216`, `:248-268`).
- `CUSTOMBITMAP` reads and writes a pixel a byte at a time, in the viewport's byte order: for pixel `x` of its group, the first byte of each plane word for `x & 15` under 8, the second otherwise. A bitmap's planes are four words a group, a mask's one. `GetPixel4` and `GetPixel1` return -1 when the group's first word index is past `m_maxIndex`, which they call the first word not accessible but read when equal; `PutPixel4` of -1 sets all four planes, colour 15 (`:108-194`, `:218-245`, `:270-280`).
- The opcode `CreateVirtualBitmap` pops `maskNumber`, `maskID`, `virtualGraphicID`, `graphicID`, and does nothing without `GetBitmap(graphicID, 2)` or `GetMask(maskID, maskNumber, 48)`, which it reads as an `AFFINEMASK` (`:3090-3108`). `BACKGROUND_LIB::CreateVirtualBitmap` refuses a `dstWidth` that is not whole groups, and a `virtualGraphicID` of which a graphic of two bytes or more exists. It makes a graphic of `4 * (dstSize + 1)` bytes, where `dstSize = dstWidth * dstHeight / 2` already counts bytes, so four times what the pixels need; its first longword is `dstWidth`. The source's `m_maxIndex` is `2 * (srcSize - 1)` words for a section of `srcSize` longwords (`:5452-5488`).
- The opcode `CreateVirtualMask` pops the new mask's number and ID, the six coefficients from `Cyc` back to `Cxx`, a `BACKGROUND_MASK` header from `height` back to `srcX`, and the old mask's number and ID. It refuses a `width` of 0 or not whole groups, makes room for the new mask with `CreateNewMask`, and fills it with `CreateVirtualMask`'s transform of `GetMask(oldMaskID, oldMaskNumber, 6)`, whose width and height are the source's, the new mask's the destination's, and `srcX`, `srcY` 0 (`:3212-3252`, `:5610-5631`).
- `CreateNewMask` finds or makes the mask section (a count of 0 when made), and when `number` is not below the count grows the index to `number + 1` entries: the masks move up by four bytes an added entry, the added entries are 0, and the offsets already there move up by as much. An entry that is not 0 is refused, with a "Design Error" message box ("Creating a Virtual Mask that already exists.") once per run. The new mask goes at the section's end, `(width + 15) / 16 * height` words and its header; CSBWin copies `sizeof (BACKGROUND_MASK)`, fourteen bytes, so a first mask word from its caller's stack, which the transform then writes over (`:5491-5547`).
- The opcode `CreateVirtualAffineMask` pops the new mask's number and ID and the twelve fields from `dstHeight` back to `Cxx`, refuses a `dstWidth` of 0 or not whole groups, and keeps the transform with `CreateNewAffineMask` (`:3253-3284`), which is `CreateNewMask` for 48 bytes but for one line: growing the index by `n` entries, it moves the offsets already there up by 4, not `4 * n` (`:5584`). No transform of Conflux 3.5's or The Towers of Chaos 3.3's programs grows its section's index by more than one entry past offsets it holds, so it does not show (`tools/checks/virtual-graphics.ts`).
- The programs ask `NeedVirtualMaskQ` before making a mask, so each is made once. `CreateVirtualBitmap` they call at every view, and it returns at once for a bitmap already made. From every square of the party's starting level, Conflux's programs make 9 virtual bitmaps, 67 virtual masks and 5 transforms, and draw a virtual bitmap through a virtual mask in 120 ways; The Towers of Chaos' make 2, 27 and 2, and draw 27. Every pixel they read lies within its source (`tools/checks/virtual-graphics.ts`).

## Skins in the data sets

- **Conflux 3.5** has skins on 11407 cells, 42 different ones, and a default skin on most levels: 11, which has no graphics and runs program 64, so nearly every view of Conflux runs a skin's program. Its `CSBgraphics.dat` has 51 skins, 90 background sections and four programs (61 to 64). Its DSAs never call `&GETSKIN` or `&SETSKIN` (`tools/checks/skins.ts`, `tools/checks/background-lib.ts`).
- **The Towers of Chaos 3.3** has skins 1, 2, 3, 5 and 6 on 4530 cells, and its default skins are all 0. Its `CSBgraphics.dat` has 38 skins, 21 background sections and one program (64), which uses a subset of Conflux's skin opcodes, the virtual graphics among them.
- **`tools/fixtures/gamefiles/csbgraphics/CSBgraphics.dat`**, a designers' library no data set plays, also holds 90 background sections. 3D2D1D's file has the default skins record, all 0.
- Of the skin opcodes (60302 to 60362) the programs use 33, among them the three that make virtual graphics, and not `DrawCustomDecoration`, `WallDecorationID` or `FloorDecorationID` (`tools/checks/skin-programs.ts`).

---

## Critical Code References

### Primary Rendering
- `Viewport.cpp:6701` - DrawViewport() main loop
- `Viewport.cpp:3329` - FloorAndCeilingOnly() cached rendering
- `Viewport.cpp:6801` - Interpret() bytecode execution
- `CSBCode.cpp:2986` - BltShapeToViewport() (calls `TAG0088b2`)

### Graphics Loading
- `CSBCode.cpp:10228-10284` - Memory allocation
- `CSBCode.cpp:2914-2923` - ReadFloorAndCeilingBitmaps()
- `CSBCode.cpp:2926-2961` - ReadWallBitmaps()

### Screen Output
- `Menu.cpp:452-457` - BLT2Screen() viewport to screen

### Opcode Definitions
- `Viewport.cpp:375-720` - Opcode enum definitions
- `Viewport.cpp:1005+` - Standard bytecode programs

### Constants
- `Viewport.cpp:6750` - Floor mirror width (0x70 = 112 bytes/scanline)
- `Viewport.cpp:6760` - Ceiling mirror width (0x70 = 112 bytes/scanline)
- `Viewport.cpp:2954` - Transparent color index (10)

---

## Differences from Atari ST Original

CSBWin is a **port**, not the original Atari ST code. Key differences:

1. **Memory Management**: Uses Windows/Mac memory allocation instead of fixed Atari ST memory
2. **Screen Resolution**: Supports higher resolutions (scaled up from 320×200)
3. **Graphics Format**: Converts Atari ST bitplane format to platform-specific format
4. **File Paths**: Modern filesystem instead of Atari ST file system
5. **Performance**: Optimizations for modern CPUs

However, the **rendering logic** is preserved from the original, making CSBWin an accurate reference for understanding Dungeon Master's graphics system.

---

*This document is based on analysis of CSBWin source code (C++ port of Dungeon Master) and serves as a reference for mechanical porting efforts.*
