# Bytecode Renderer Implementation Plan

## Overview

CSBWin uses a bytecode interpreter system to render each of the 21 cells. The `pStdDrawCode[21][8]` array maps [cellNumber][roomType] to bytecode programs that specify exactly which graphics to draw and where.

## Bytecode Structure

Example from Viewport.cpp line 979:
```cpp
ui16 StdDrawF3Stone[] =
{
  StdWallBitmapF3,   StdWallRectangleF3,   StdBltShape,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallText,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallDecoration,
  Alcove,
      JumpZ, 5,
          F3Contents,  F3xy, F3 , DrawOrder00,  StdDrawRoomObjects,
  Return
};
```

## Key Opcodes

From Viewport.cpp lines 370-500:

- **StdBltShape** - Blit a bitmap graphic
  - Takes: bitmap index, rectangle index
  - Draws the graphic at the specified screen position

- **StdDrawWallText** - Draw text on wall
  - Takes: cell, decoration type, wall side

- **StdDrawWallDecoration** - Draw wall decoration (alcove, button, etc.)
  - Takes: cell, decoration type, wall side

- **StdDrawRoomObjects** - Draw objects in this cell
  - Takes: contents list, xy position, cell, draw order

- **JumpZ** - Conditional jump
  - Skip N instructions if condition is false

- **Return** - End of program

## Bitmap and Rectangle Constants

From Viewport.cpp lines 60200-60300:

```cpp
StdWallBitmapF3L2    = 60258,
StdWallBitmapF3L1    = 60259,
StdWallBitmapF3      = 60260,
StdWallBitmapF3R1    = 60261,
StdWallBitmapF3R2    = 60262,
StdWallBitmapF2L1    = 60263,
StdWallBitmapF2      = 60264,
StdWallBitmapF2R1    = 60265,
StdWallBitmapF1L1    = 60266,
StdWallBitmapF1      = 60267,
// ... etc
```

These constants are pointers/references to actual bitmap data structures that contain:
1. The graphics.dat index
2. The screen rectangle coordinates

## Implementation Strategy

### Option 1: Full Bytecode Interpreter

Implement a proper bytecode VM that:
1. Reads bytecode programs from pStdDrawCode array
2. Executes opcodes sequentially
3. Maintains execution context (registers, flags)
4. Handles jumps and conditionals

**Pros:**
- Most accurate to original
- Handles all edge cases
- Extensible for mods

**Cons:**
- Complex implementation
- Need to port all bytecode programs
- Need to extract all bitmap/rectangle mappings

### Option 2: Direct Translation

For each bytecode program, create equivalent TypeScript function:

```typescript
function renderF3Stone(cell: CellId, blit: GraphicsBlit) {
    // StdWallBitmapF3, StdWallRectangleF3, StdBltShape
    blit.blitGraphic(WALL_BITMAP_F3, WALL_RECT_F3, true);

    // F3, wallDecorationFront, WallF3Front, StdDrawWallText
    drawWallText(cell, DecoType.FRONT, WallSide.F3_FRONT);

    // F3, wallDecorationFront, WallF3Front, StdDrawWallDecoration
    drawWallDecoration(cell, DecoType.FRONT, WallSide.F3_FRONT);

    // Alcove check + objects
    if (hasAlcove(cell)) {
        drawRoomObjects(cell);
    }
}
```

**Pros:**
- Simpler to implement
- More readable
- Faster execution

**Cons:**
- Manual translation of ~100 programs
- Less accurate if we make mistakes
- Harder to maintain

### Option 3: Hybrid Approach

Create a mini-DSL (Domain Specific Language) that represents the bytecode but is easier to work with:

```typescript
const F3Stone = [
    { op: 'blit', bitmap: 'WALL_F3', rect: 'WALL_F3' },
    { op: 'wallText', cell: 'F3', deco: 'FRONT', side: 'FRONT' },
    { op: 'wallDeco', cell: 'F3', deco: 'FRONT', side: 'FRONT' },
    { op: 'ifAlcove', then: [
        { op: 'objects', cell: 'F3', order: 0 }
    ]}
];
```

## Critical Missing Information

To implement any of these, we need:

1. **Graphics Index Mappings**
   - Which graphics.dat index corresponds to each wall bitmap constant?
   - Example: `StdWallBitmapF3` → graphics index ???

2. **Screen Rectangle Coordinates**
   - Exact X, Y, Width, Height for each cell position
   - Example: `StdWallRectangleF3` → { x: ??, y: ??, w: ??, h: ?? }

3. **Bytecode Programs**
   - All 21 × 8 = 168 programs from pStdDrawCode array
   - Currently only a few are documented

## How to Extract Missing Info

### Method 1: Runtime Analysis
- Run CSBWin in debugger
- Break on bitmap blit operations
- Log graphics index + screen coordinates for each cell

### Method 2: Static Analysis
- Find where bitmap pointers are initialized
- Trace through skin loading code
- Extract constants from Data.h or skin files

### Method 3: Visual Matching
- Export all graphics as PNGs (already done)
- Manually match visual appearance to cell positions
- Reverse-engineer the mappings

### Method 4: Use Exported PNGs
Since we already have tools/output/ with exported graphics:
- Look at viewport_017_224x136.png (full rendered viewport)
- Compare with individual wall graphics
- Identify which graphics appear at which positions

## Recommendation

For fastest progress with reasonable accuracy:

1. **Start with visual analysis** of exported PNGs to identify correct graphics for common cases (stone walls at D0-D3)

2. **Implement Option 2 (Direct Translation)** for the most common cell+roomtype combinations:
   - F3 Stone (front center at distance 3)
   - F2 Stone, F1 Stone, F0 Stone
   - F3R1 Stone, F3L1 Stone (right/left at distance 3)
   - Similar for distances 2, 1, 0

3. **Add support incrementally**:
   - Start with just stone walls
   - Add open spaces
   - Add doors
   - Add stairs, pits, teleporters
   - Add decorations last

4. **Extract exact coordinates** by examining one full rendered viewport graphic and measuring where each cell appears

This gets us a working renderer quickly while leaving room to refine with bytecode later.
