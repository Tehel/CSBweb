# Graphics.dat Organization for Viewport Rendering

## Investigation Results

Based on analysis of graphics.dat file with 563 total graphics, organized by dimensions and purpose.

## Key Findings

### Viewport-Sized Graphics (224×136)
- **Index 0**: Empty/floor viewport (239 bytes)
- **Index 17**: Full rendered viewport (714 bytes)

These are the exact size of the DM viewport and likely serve as backgrounds or complete viewport frames.

### Title/Large Graphics (320×200)
- Indices 1, 4, 5: Title screens and backgrounds
- These are full Atari ST screen resolution

### Wall Graphics - Tall Aspect Ratios

Wall graphics appear to be organized by distance and position. Tall aspect ratios (height > width * 2) indicate wall segments:

**Distance 0 (Close - Full height ~136px)**:
- Index 72: 32×136 - Very close wall
- Index 84-85: 32×136 - Close wall variations

**Distance 1 (~94-123px height)**:
- Index 77: 32×123
- Index 78: 32×94
- Index 94: 32×100
- Index 101: 32×91

**Distance 2 (~60-71px height)**:
- Index 70: 80×71
- Index 71: 64×111 (might be side wall)
- Index 103: 32×60

**Distance 3 (~40-51px height)**:
- Index 69: 96×51
- Index 79: 48×65
- Index 80-81: 32×44, 32×43
- Index 90-91: 80×46, 96×46
- Index 96-98: Various 32-96 width, 41-44 height

**Distance 4 (Far ~<40px height)**:
- Index 89: 16×49 (narrow far wall)
- Index 105-107: Small walls

### Floor/Ceiling Graphics

**Large floor segments**:
- Index 75: 224×70 - Near floor
- Index 76: 224×29 - Far floor
- Index 86: 256×111 - Large floor section
- Index 87-88: 144×71, 128×51 - Medium floor sections
- Index 95: 160×100
- Index 102: 160×91

### Door Graphics

Square/near-square graphics likely doors:
- Index 73-74: 32×32 (small door or door detail)
- Index 92-93, 99-100: 64×62, 96×62 (medium doors)
- Index 108-119: Series of 48×41, 64×61, 96×88 (doors at different distances)

### Small Elements (Decorations/UI)

**Very wide/thin graphics (likely decorations)**:
- Index 82-83: 128×4, 96×3 (horizontal elements)
- Index 120: 288×8 (wide horizontal strip)
- Index 6-15: Various 48-96 width, 5-45 height (UI elements, text, decorations)

### Object Graphics (Index 121+)

Starting around index 121, regular pattern of sizes:
- 32×48 series (indices 121, 123, 125, 127)
- 96×56 series (indices 122, 124, 126, 128)
- 16×19 and 32×28 pairs (indices 129-140)

Likely objects/creatures at different distances.

## Wall Graphics Organization Pattern

Based on CSBWin's cell system and the graphics analysis, walls appear organized as:

### Front-Facing Walls (Center View)
Organized by distance (0-4), with decreasing height:
- **D0**: 32×136 (indices 72, 84-85)
- **D1**: 32×91-123 (indices 77-78, 94, 101)
- **D2**: 32-64×60-71 (indices 70-71, 103)
- **D3**: 32-96×41-51 (indices 69, 79-81, 90-91, 96-98)
- **D4**: 16-32×<40 (indices 89, 105-107)

### Side Walls (L/R Views)
Narrower widths, appear at angles:
- Likely mixed in with front walls
- Different aspect ratios for perspective

### Corner Views
- Square or near-square sections
- Indices 73-74 (32×32)

## Floor/Ceiling Pattern

**Near to far organization**:
1. **D0-D1** (Close): 224×70 (index 75)
2. **D2** (Medium): 224×29 (index 76), 160×100 (index 95)
3. **D3** (Far): 144×71 (index 87), 128×51 (index 88)
4. **D4** (Very far): Smaller sections

## Recommended Rendering Approach

Based on CSBWin's system and our graphics analysis:

###1. Cell-Based Rendering

Define 21 cells with relative positions (from `VIEWPORT_RENDERING.md`):
- **RF4L2, RF4R2** (distance 4, left/right 2)
- **RF3L2, RF3L1, RF3, RF3R1, RF3R2** (distance 3)
- **RF2L2, RF2L1, RF2, RF2R1, RF2R2** (distance 2)
- **RF1L1, RF1, RF1R1** (distance 1)
- **RF0L1, RF0, RF0R1** (distance 0)

### 2. Graphics Mapping System

Create lookup tables:
```typescript
interface WallGraphic {
    front: number;      // Graphic index for front view
    left: number;       // Graphic index for left side
    right: number;      // Graphic index for right side
    leftCorner: number; // Graphic index for left corner
    rightCorner: number;// Graphic index for right corner
}

// One entry per distance (0-4)
const stoneWalls: WallGraphic[] = [
    { front: 72, left: 84, right: 85, leftCorner: 73, rightCorner: 74 }, // D0
    { front: 77, left: 78, right: 94, leftCorner: 80, rightCorner: 81 }, // D1
    // ... etc
];
```

### 3. Screen Rectangle Mapping

Each cell has predetermined screen coordinates where graphics should be blitted:
```typescript
interface RectPos {
    x: number;
    y: number;
    width: number;
    height: number;
}

const cellRectangles: { [key: string]: RectPos } = {
    'RF3': { x: 80, y: 20, width: 64, height: 111 },  // Example
    'RF2': { x: 64, y: 30, width: 96, height: 71 },
    // ... etc for all 21 cells
};
```

### 4. Rendering Order

1. Draw floor/ceiling background
2. Render cells from far to near (D4 → D3 → D2 → D1 → D0)
3. Within each distance, render: back walls, side walls, front walls
4. Draw decorations/alcoves/doors
5. Draw objects/creatures
6. Draw UI overlay

## Next Steps

1. **Map exact graphics to cells**: Identify which graphic goes with which cell position
2. **Define screen rectangles**: Determine exact X,Y positions for each cell
3. **Build graphics index tables**: Create lookup tables for walls/floors/objects by type and distance
4. **Implement blitting system**: Port CSBWin's BltShapeToViewport functionality
5. **Test with simple scene**: Render a single corridor to verify system

## Tools Created

- `tools/inspect-graphics.ts` - Lists all graphics with dimensions
- `tools/export-graphics.ts` - Exports graphics as PNG files for visual inspection
- Output in `tools/output/` directory with format `category_###_WxH.png`

## References

- [VIEWPORT_RENDERING.md](VIEWPORT_RENDERING.md) - CSBWin rendering system analysis
- [CSBWIN_ARCHITECTURE.md](CSBWIN_ARCHITECTURE.md) - Overall architecture
- CSBWin source: `Viewport.cpp` lines 340-7000
- Graphics exports in `tools/output/`
