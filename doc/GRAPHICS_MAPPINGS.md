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

| pWallBitmaps index | Loaded via ReadAndExpandGraphic() | Allocated bytes (CSBCode.cpp:10228+) |
|--------------------|-----------------------------------|--------------------------------------|
| pWallBitmaps[0]    | graphics.dat index 84             | 2176                                 |
| pWallBitmaps[1]    | graphics.dat index 85             | 2176                                 |
| pWallBitmaps[2]    | graphics.dat index 86             | 14208                                |
| pWallBitmaps[3]    | graphics.dat index 87             | 5112                                 |
| pWallBitmaps[4]    | graphics.dat index 88             | 3264                                 |
| pWallBitmaps[5]    | graphics.dat index 89             | 392                                  |
| pWallBitmaps[6]    | mirrored copy of pWallBitmaps[5]  | 392                                  |

### Cell to Bitmap Mapping

From Viewport.cpp lines 2267-2279 (StdBitmapPointers function):

| Cell Position | Uses pWallBitmaps |
|---------------|-------------------|
| F3L2          | [5]               |
| F3L1          | [4]               |
| F3            | [4]               |
| F3R1          | [4]               |
| F3R2          | [6] (mirror of [5]) |
| F2L1          | [3]               |
| F2            | [3]               |
| F2R1          | [3]               |
| F1L1          | [2]               |
| F1            | [2]               |
| F1R1          | [2]               |
| F0L1          | [1]               |
| F0R1          | [0]               |

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

CSBWin loads the viewport coordinate/rectangle tables from `graphics.dat` at startup as part of “graphic `0x22e`”:

- `CSBCode.cpp:10249`: `ReadAndExpandGraphic(0x8000|0x22e, (ui8 *)d.Byte7248+2, 0,0);`
- `Data.h:1124+`: marks the loaded region as “Start of graphic 0x22e”
- `Data.h:1253`: `RectPos wallRectangles[14];` (and many related rectangles) are within that region

So the coordinates and source parameters (`RectPos.b.uByte4..uByte7`) exist in the shipped data tables; they are not hard-coded in C++.

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
