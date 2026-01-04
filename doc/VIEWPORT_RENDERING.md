# Dungeon Master Viewport Rendering System

## Overview

Dungeon Master uses a **2.5D sprite-based rendering system**, NOT true 3D ray-casting. The viewport is constructed by blitting pre-rendered bitmap graphics to fixed screen positions based on the dungeon layout visible from the party's position.

## Key Concepts

### 1. Cell-Based Visibility System

The viewport is divided into **21 cells** representing relative positions from the party:

```
Distance 4:  [L2]           [L1]      [Center]      [R1]           [R2]
Distance 3:       [L2]  [L1]      [Center]      [R1]  [R2]
Distance 2:            [L2]  [L1]  [Center]  [R1]  [R2]
Distance 1:                 [L1]  [Center]  [R1]
Distance 0:                 [L1]  [Center]  [R1]
```

Relative positions (from `Viewport.cpp` lines 347-355):

```cpp
i8 relativeX[21] = {
  -2,+2,-2,+2,-1,+1,+0,-1,+1,+0,-2,+2,-1,+1,+0,-1,+1,+0,-1,+1,+0
};

i8 relativeY[21] = {
  4,4,3,3,4,4,4,3,3,3,2,2,2,2,2,1,1,1,0,0,0
};
```

Cell numbering constants (lines 323-346):
- RF4L2=0, RF4R2=1 (distance 4, left/right 2)
- RF3L2=2, RF3R2=3 (distance 3, left/right 2)
- RF3L1=7, RF3=6, RF3R1=8 (distance 3)
- RF2L2=10, RF2R2=11 (distance 2, left/right 2)
- RF2L1=12, RF2=14, RF2R1=13 (distance 2)
- RF1L1=15, RF1=17, RF1R1=16 (distance 1)
- RF0L1=18, RF0=20, RF0R1=19 (distance 0 - party position)

### 2. Rendering Algorithm (DrawViewport function, line 6694)

```
1. For each of the 21 cells:
   a. Calculate absolute dungeon coordinates using RelativeXY()
   b. Get the "skin" (graphics set) for that cell
   c. Summarize room info (room type, decorations, objects)

2. For each cell again:
   a. Get bytecode/opcode program for that cell's room type
   b. Execute Interpret() which:
      - Determines which graphics to draw
      - Calls BltShapeToViewport() or similar
      - Draws to predetermined screen rectangles

3. Draw objects in cells (furthest to nearest for proper occlusion)

4. Apply mirroring (for animation variety)
```

### 3. Graphics Blitting

Graphics are NOT texture-mapped onto 3D surfaces. Instead:

- **Pre-rendered bitmaps** exist for walls, floors, ceilings at each distance/angle
- Each graphic has a **fixed screen rectangle** where it should be drawn
- Graphics are blitted (copied) to viewport buffer
- Multiple graphics can be layered (walls, then decorations, then objects)

Key blitting functions (from CSB.h lines 3098-3218):
- `BltShapeToViewport()` - Blit a shaped graphic
- `BltRectangleToViewport()` - Blit rectangular graphic
- `GraphicToViewport()` - Draw graphic by index
- `MirrorGraphicToViewport()` - Draw mirrored version

### 4. Wall Graphics Structure

From examination of CSBWin code and graphics.dat structure:

- Wall graphics are organized by:
  - **Distance** (0-4)
  - **Position** (left side, center, right side)
  - **Wall type** (stone, door, etc.)
  - **View angle** (front view, side view, corner views)

- Each visible wall configuration has a **specific pre-rendered bitmap**
- Graphics indices map to these specific views
- No runtime texture sampling or 3D projection needed

### 5. Opcode/Bytecode System

The rendering uses an interpreter pattern:
- Each cell type has bytecode describing what to draw
- Opcodes like:
  - `StdBltShape` - Blit a standard shape
  - `StdDrawWallDecoration` - Draw wall decoration
  - `StdDrawFloorDecoration` - Draw floor decoration
  - `DoorSwitch` - Handle door graphics
  - `StdDrawTeleporter` - Draw teleporter effect

### 6. Object Drawing

Objects (items, creatures) are drawn AFTER walls:
- Objects are sorted by distance (far to near)
- Each object type has graphics for different distances/angles
- Objects are composited on top of background

## Implementation Approach for TypeScript Port

To properly port this system:

1. **Define the 21 cell positions** with relative coordinates
2. **Create a cell evaluation system** that determines:
   - What room type is in each cell
   - What decorations/objects are present
   - Which graphics should be drawn
3. **Build a graphics index mapping** for:
   - Wall graphics by distance/position/type
   - Floor/ceiling graphics by distance
   - Door graphics by state/distance
   - Object graphics by type/distance/angle
4. **Implement blitting system**:
   - Load pre-rendered bitmaps from graphics.dat
   - Draw to fixed screen positions
   - Handle transparency/masking
   - Layer graphics properly (back to front)
5. **Render in correct order**:
   - Far cells to near cells
   - Walls, then decorations, then objects within each cell

## Key Differences from Ray-Casting

| Ray-Casting (Wolfenstein 3D) | DM 2.5D Sprites |
|-------------------------------|-----------------|
| Cast rays through 3D space | Pre-defined cell positions |
| Sample textures at runtime | Pre-rendered bitmaps |
| Calculate wall heights | Fixed graphics for each distance |
| Continuous viewing angles | Discrete 4-direction facing |
| Runtime 3D projection | Pre-computed perspectives |

## References

- `doc/CSBwin-src/Viewport.cpp` - Main rendering code
- Lines 6694-6900: `DrawViewport()` function
- Lines 347-355: Cell relative positions
- Lines 370-500: Opcode definitions
- `doc/CSBwin-src/CSB.h` - Function declarations
- `doc/CSBwin-src/Data.h` - Data structures

## Graphics.dat Structure (for viewport)

Based on typical DM structure:
- Graphics 0-100: Wall bitmaps at various distances/angles
- Graphics 100-200: Floor/ceiling decorations
- Graphics 200-300: Door graphics
- Graphics 300-400: Object/creature sprites
- Graphics 400-500: UI elements

Exact indices need to be determined by examining graphics.dat or CSBWin lookup tables.
