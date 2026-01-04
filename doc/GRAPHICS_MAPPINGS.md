# Graphics Mappings Extracted from CSBWin

## Wall Graphics Indices (for wallSet = 0)

From CSBCode.cpp line 2877:
```cpp
firstWallGraphic = 77 + 13 * newWallGraphicSet;  // = 77 for default set 0
```

From CSBCode.cpp line 2884:
```cpp
ReadAndExpandGraphic(firstWallGraphic + 7 + i, d.pWallBitmaps[i], 0, 0);
```

### Wall Bitmap Mapping

| pWallBitmaps index | Graphics.dat index | Size (from GRAPHICS_ORGANIZATION.md) |
|--------------------|-------------------|--------------------------------------|
| pWallBitmaps[0]    | 84                | 32×136                               |
| pWallBitmaps[1]    | 85                | 32×136                               |
| pWallBitmaps[2]    | 86                | 128×200                              |
| pWallBitmaps[3]    | 87                | 64×111                               |
| pWallBitmaps[4]    | 88                | 96×62                                |
| pWallBitmaps[5]    | 89                | 16×49                                |
| pWallBitmaps[6]    | 90                | 80×46                                |

### Cell to Bitmap Mapping

From Viewport.cpp lines 2267-2279 (StdBitmapPointers function):

| Cell Position | Uses pWallBitmaps | Graphics Index |
|---------------|-------------------|----------------|
| F3L2          | [5]               | 89             |
| F3L1          | [4]               | 88             |
| F3            | [4]               | 88             |
| F3R1          | [4]               | 88             |
| F3R2          | [6]               | 90             |
| F2L1          | [3]               | 87             |
| F2            | [3]               | 87             |
| F2R1          | [3]               | 87             |
| F1L1          | [2]               | 86             |
| F1            | [2]               | 86             |
| F1R1          | [2]               | 86             |
| F0L1          | [1]               | 85             |
| F0R1          | [0]               | 84             |

## Screen Rectangle Mapping

From Viewport.cpp lines 2304-2317 (StdRectanglePointers function):

| Cell Position | Uses wallRectangles | Index |
|---------------|---------------------|-------|
| F3L2          | [13]                | 13    |
| F3L1          | [1]                 | 1     |
| F3            | [0]                 | 0     |
| F3R1          | [2]                 | 2     |
| F3R2          | [12]                | 12    |
| F2L1          | [4]                 | 4     |
| F2            | [3]                 | 3     |
| F2R1          | [5]                 | 5     |
| F1L1          | [7]                 | 7     |
| F1            | [6]                 | 6     |
| F1R1          | [8]                 | 8     |
| F0L1          | [10]                | 10    |
| F0            | [9]                 | 9     |
| F0R1          | [11]                | 11    |

## Rectangle Coordinates

RectPos structure (CSB.h line 1367):
```cpp
struct wordRectPos {
  i16 x1; i16 x2; i16 y1; i16 y2;
};
```

The actual coordinate values are loaded at runtime from game data. We need to either:
1. Extract them by running CSBWin in a debugger
2. Reverse-engineer from graphics sizes and viewport layout
3. Use the exported full viewport graphic (index 17) to measure positions

## Door Graphics Indices (for wallSet = 0)

From CSBCode.cpp line 2880:
```cpp
ReadAndExpandGraphic(firstWallGraphic + i, d.pDoorBitmaps[i+1], 0, 0);
```

| pDoorBitmaps index | Graphics.dat index |
|--------------------|-------------------|
| pDoorBitmaps[1]    | 77                |
| pDoorBitmaps[2]    | 78                |
| pDoorBitmaps[3]    | 79                |
| pDoorBitmaps[4]    | 80                |
| pDoorBitmaps[5]    | 81                |
| pDoorBitmaps[6]    | 82                |
| pDoorBitmaps[7]    | 83                |

## Complete Bytecode Programs

### pStdDrawCode Array Structure

From Viewport.cpp lines 1952-2201, the `pStdDrawCode[21][8]` array maps:
- First index [0-20]: Cell number (RF4L2, RF4R2, RF3L2, etc.)
- Second index [0-7]: Room type (Stone=0, Open=1, Pit=2, Teleporter=3, DoorEdge=4, DoorFacing=5, StairEdge=6, StairFacing=7)

### Example: F3 Stone Wall

From Viewport.cpp line 979:
```cpp
ui16 StdDrawF3Stone[] = {
  StdWallBitmapF3,   StdWallRectangleF3,   StdBltShape,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallText,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallDecoration,
  Alcove,
      JumpZ, 5,
          F3Contents,  F3xy, F3 , DrawOrder00,  StdDrawRoomObjects,
  Return
};
```

Translation:
1. `StdWallBitmapF3, StdWallRectangleF3, StdBltShape` → Blit graphic 88 at rectangle[0]
2. `F3, wallDecorationFront, WallF3Front, StdDrawWallText` → Draw wall text if present
3. `F3, wallDecorationFront, WallF3Front, StdDrawWallDecoration` → Draw decorations
4. `Alcove, JumpZ, 5` → If has alcove, draw objects inside
5. `Return` → End

## Implementation Strategy

### Phase 1: Hardcode Basic Graphics (Current Status)

Use the extracted graphics indices for stone walls:
- Distance 3: Graphics 88, 89, 90
- Distance 2: Graphic 87
- Distance 1: Graphic 86
- Distance 0: Graphics 84, 85

Estimate rectangle positions based on graphics sizes.

### Phase 2: Extract Exact Rectangles

Method A: Visual measurement from viewport_017_224x136.png
- Export and examine the full rendered viewport
- Measure pixel positions of each visible wall segment

Method B: Runtime extraction from CSBWin
- Run CSBWin with dungeon.dat in debugger
- Break at BltShapeToViewport calls
- Log rectangle coordinates for each cell

Method C: Search for hardcoded data
- Rectangles might be in a data segment or resource file
- Check for arrays of i16 values in Data.h or data.cpp

### Phase 3: Implement Bytecode Interpreter

Create a proper interpreter for the pStdDrawCode programs:
```typescript
const pStdDrawCode = [
  // [cellNum][roomType] → bytecode program
  [ /* RF4L2 programs */ ],
  [ /* RF4R2 programs */ ],
  // ...
];

function interpret(program: number[], roomData: RoomData[]) {
  // Execute opcodes
}
```

## Next Steps

1. ✅ Extract graphics indices (DONE)
2. ⏳ Extract or estimate rectangle coordinates
3. ⏳ Port bytecode programs from CSBWin
4. ⏳ Implement bytecode interpreter
5. ⏳ Test with actual dungeon rendering
