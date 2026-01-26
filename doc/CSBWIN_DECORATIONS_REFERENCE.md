# CSBWin Wall/Floor Decorations Reference (Sourced)

This document captures verified decoration behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Decoration eligibility (stone walls)

- `CSBTypes.h` defines stone `CELLFLAG` bits for random wall decorations: bit 0 west, bit 1 south, bit 2 east, bit 3 north; out-of-bounds cells are treated as stone with the appropriate bit set for random decoration eligibility (`doc/CSBwin-src/CSBTypes.h`).

## SummarizeStoneRoom

- `SummarizeStoneRoom` computes right/rear/left masks from `cellFlags` based on `facing`, then calls `TAG00a4a2` to populate `rslt->decorations[0..2]` with random wall decorations (`doc/CSBwin-src/Codea59a.cpp`).
- `TAG00a4a2` uses `NumRandomWallDecoration()` and calls `RandomWallDecoration` three times (right/rear/left) with `probability=30`; it clears any decoration that corresponds to an alcove (`IsAlcove`) when the cell is out of bounds or `FalseStoneWall` is set (`doc/CSBwin-src/CSBCode.cpp`).
- `RandomWallDecoration` returns `0` if the side mask is zero; otherwise it hashes `(2000 + (mapX<<5) + P4)` and `(3000 + (LoadedLevel<<6) + width + height)` and returns `index+1` when the hash result is less than the random-decoration count (`doc/CSBwin-src/CSBCode.cpp`).
- `SummarizeStoneRoom` scans objects with `dbType <= dbACTUATOR`; for `dbTEXT` with `show()` it sets `rslt->text[relativePosition-1]`, and for `dbACTUATOR` it sets `rslt->decorations[relativePosition-1]` from `wallGraphicOrdinal()` unless hidden by portrait flags (`doc/CSBwin-src/Codea59a.cpp`).
- It handles DSA type 47 by storing `0x10000 | ParameterA()` for custom graphics, and sets `championPortraitOrdinal` when `actuatorType() == 127` and the portrait is visible (`doc/CSBwin-src/Codea59a.cpp`).
- `SummarizeStoneRoom` clears `rslt->decorations[i]` when there is wall text on that side but no real decoration, and applies the false-stone visibility restriction before returning `rn2` (`doc/CSBwin-src/Codea59a.cpp`).

## SummarizeOpenRoom (floor decorations)

- For `roomOPEN`, the code calls `RandomWallDecoration((cellFlags & 8), NumRandomFloorDecorations(), x, y, 30)` to select a floor decoration ordinal, then scans `dbACTUATOR` records to override `decorations[2]` with `wallGraphicOrdinal()` when it falls within `NumFloorDecorations()`; DSA type 47 can override with `0x4000 | ParameterB()` (`doc/CSBwin-src/Codea59a.cpp`).

## Floor decoration rendering

- `Viewport.cpp` defines `floorDrawingLocations[21]` as `{0,0,0,0,0,0,0,0,2,1,0,0,3,5,4,6,8,7,0,0,9}` for mapping relative cell indices to floor-decoration positions before calling `DrawFloorDecorations` (`doc/CSBwin-src/Viewport.cpp`).
- `DrawFloorDecorations` converts a floor decoration ordinal to a graphic number via `base = 247 + 6 * FloorDecorationTOC[index]` and `graphicNumber = base + RelativeCellGraphicIncrement[relativeCell]`, then uses `floorDecorDesc[set][relativeCell]` where `set = Byte4110[FloorDecorationTOC[index]]` (`doc/CSBwin-src/CSBCode.cpp`).
