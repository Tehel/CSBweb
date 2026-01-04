# Next Steps for Viewport Renderer

## Current Status

✅ **Graphics indices extracted** from CSBWin source code (graphics 84-90 for walls)
✅ **Cell-based rendering architecture** implemented correctly
✅ **Source rectangle clipping** supported in GraphicsBlit
✅ **Close walls (F0L1, F0R1) rendering correctly** - proves the system works!

❌ **Screen rectangle coordinates** not yet accurate for all cells
❌ **Floor and ceiling graphics** not rendering
❌ **Lateral walls at distance** not positioned correctly

## The Problem

CSBWin stores wall rectangle coordinates in `d.wallRectangles[14]` array, but this data is either:
1. Hardcoded in the compiled binary (not visible in source)
2. Computed at runtime from graphics metadata
3. Loaded from an external data file we haven't found

## Solutions (in order of accuracy)

### Solution A: Extract from CSBWin Binary (Most Accurate)
Run CSBWin in a debugger and dump the rectangle values:

1. Set breakpoint at `BltShapeToViewport` (CSBCode.cpp:2930)
2. Load a simple dungeon
3. Log all rectangle coordinates as they're used
4. Export to TypeScript constants

**Tools needed**: Visual Studio debugger or similar

### Solution B: Visual Measurement from viewport_017_224x136.png
Open `tools/output/viewport_017_224x136.png` which shows a complete rendered scene:

1. Measure pixel positions of each visible wall segment
2. Identify which graphic appears where
3. Map back to cell IDs
4. Update `CELL_SCREEN_RECTS` in cellTypes.ts

**Tools needed**: Image editor with pixel coordinates (GIMP, Photoshop, etc.)

### Solution C: Reverse Engineer from Graphics Sizes
Using the known graphics sizes and DM perspective geometry:

1. Graphics 84,85 are 32×136 (full height sides) - ✅ WORKING
2. Graphic 86 is 256×111 (sprite sheet for D1 walls)
3. Graphic 87 is 144×71 (D2 walls)
4. Graphic 88 is 128×51 (D3 walls)
5. Graphics 89,90 are corners

Calculate where each should appear using perspective rules.

### Solution D: Port CSBWin's Bytecode System (Most Complete)
Implement full bytecode interpreter with exact CSBWin logic:

1. Port all bytecode programs from `pStdDrawCode[21][8]`
2. Implement bytecode interpreter opcodes
3. Let CSBWin's logic determine everything

**Most accurate long-term, but most work**

## Recommended Immediate Action

**Option B + C Combination**:

1. Open `tools/output/viewport_017_224x136.png`
2. Visually identify where walls appear at each distance
3. Measure key anchor points
4. Use graphics sizes to calculate intermediate positions
5. Update `CELL_SCREEN_RECTS` with measured/calculated values
6. Test and iterate

## What's Known to Work

From CSBWin source (CONFIRMED):
- Graphics 84-90 are correct wall graphics
- F0L1 uses graphic 85 (32×136) at x=0, width=32
- F0R1 uses graphic 84 (32×136) at x=192, width=32

These are rendering correctly, which proves our architecture is sound.

## Missing Pieces

1. **Exact screen rectangles** for F1, F2, F3, F4 cells
2. **Source rectangle offsets** for sprite sheet clipping (graphic 86)
3. **Floor/ceiling graphics** and their positions
4. **Door graphics** and animation frames
5. **Decoration and object rendering**

## Files to Update

Once rectangles are determined:
- `src/renderer/cellTypes.ts` - Update `CELL_SCREEN_RECTS`
- Add source rectangle offsets (srcX, srcY, srcWidth, srcHeight) where needed
- `src/renderer/CellRenderer.ts` - Add floor/ceiling rendering
- Test with actual dungeon navigation

## Testing Strategy

1. Start in a long corridor
2. Walk forward observing walls at each distance
3. Turn and verify side walls
4. Compare with original DM or CSBWin screenshots
5. Iterate on rectangle positions until perfect match
