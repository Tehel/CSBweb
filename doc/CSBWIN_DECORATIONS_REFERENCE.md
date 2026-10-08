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
- `DrawFloorDecorations` converts a floor decoration ordinal to a graphic number through `d.LoadedFloorDecorations[index]`, a `{base, set}` pair: `graphicNumber = base + RelativeCellGraphicIncrement[relativeCell]`, drawn in `floorDecorDesc[set][relativeCell]` (`doc/CSBwin-src/CSBCode.cpp:3936-3957`). A level load fills the level's slots with `base = 247 + 6 * FloorDecorationTOC[index]` and `set = Byte4110[FloorDecorationTOC[index]]` (`doc/CSBwin-src/Code390e.cpp:263-274`).
- Slot 15 is the magic footprints', graphic 241 in set 1, set once (`doc/CSBwin-src/CSBCode.cpp:10394-10397`). Bit 15 of the ordinal (`SummarizeRoomInfo`'s footprint bit) draws it as ordinal 16 on top of the cell's own decoration (`:4049-4052`).

## Decoration draw positions, and cropping at the screen edges

`relativePosition` (the `wallDecorationDrawLocation` the cell programs push) indexes a
13-entry rectangle set. `d.WallDecorationDerivedGraphicOffset` = `0,0,1,1,1,2,2,3,3,3,4,4`
groups them (`doc/CSBwin-src/CSBCode.cpp:3516-3520`):

| Position | Wall |
| --- | --- |
| 0, 1 | F3 side walls (left, right) |
| 2, 3, 4 | F3 front walls (left, centre, right) |
| 5, 6 | F2 side walls (left, right) |
| 7, 8, 9 | F2 front walls (left, centre, right) |
| 10, 11 | F1 side walls (left, right) |
| 12 | the wall immediately in front of the party |

Positions **7 and 9** are the ones that need care. Both take `pWidthDescriptor =
rectSet[8]` — the F2 *centre* rectangle — so the decoration is scaled to the full
front-wall width even though the slot it is drawn into is narrower and pinned to a screen
border (`[7].x1` is always 0, `[9].x2` always 223). Only part of the bitmap is therefore
visible, and CSBWin picks which part with `srcOffsetX` (`:3599-3623`):

- position **9** runs off the *right* edge, shows its **left** end, `srcOffsetX = 0`;
- position **7** runs off the *left* edge, shows its **right** end, so
  `srcOffsetX = finalBitmapWidth - (pWDP->rect.x2 - pWDP->rect.x1)` — CSBWin's comment is
  "Jst ahead to the left. Truncate graphic" (`:3608`). The window then finishes exactly on
  the bitmap's last column.

Getting position 7 wrong is visible as a decoration cropped on the wrong side *and*
apparently detached from the screen border, because the transparent margin that should
have been off-screen is drawn instead.

The third `srcOffsetX` arm, `15 - (finalBitmapWidth & 15)` for the mirrored far-right
sidewalls (positions 1 and 6, `:3597`), is an artefact of CSBWin's storage rather than a
visual rule: `MakeMirror` reverses a **byte-aligned** buffer `pWDP->width` bytes wide, so
the reversed image ends up `ceil16(w) - w` pixels from the left and the offset takes it
back. A port that mirrors the exact `finalBitmapWidth + 1` bitmap has no such padding and
must **not** apply it.

## Hall of Champions portraits

The mirror is two independent things drawn by the same call: a wall decoration (the
picture frame) and, layered on top, a portrait from graphic 26.

- `SummarizeStoneRoom` sets `rslt->championPortraitOrdinal = (value() & 511) + 1` when the
  cell holds an `actuatorType() == 127` at **relative position 2** — the summarized cell's
  rear wall, which is only the mirror while the party is looking at it — and the actuator's
  state lacks `PORTRAIT_HidePortrait` (`doc/CSBwin-src/Codea59a.cpp:154-167`). The `+ 1`
  makes it 1-based so that 0 can mean "no portrait".
- `StdDrawWallDecoration` passes that ordinal to `DrawWallDecoration` as its fourth
  argument (`doc/CSBwin-src/Viewport.cpp:2949-2957`).
- The two halves are genuinely independent, and `DrawWallDecoration` is written to allow
  either alone: it returns early only when **both** `graphicOrdinal` and
  `championPortraitOrdinal` are 0 (`doc/CSBwin-src/CSBCode.cpp:3247`), draws the frame
  only under `if (graphicIndex >= 0)` (`:3738`), and draws the portrait only under
  `if (relativePosition == 12)` (`:3750`). So `PORTRAIT_HideGraphic` gives a bare portrait
  with no frame, and every ordinary decoration takes the frame path with no portrait.
- **Only relative position 12** — the wall of the cell the party is standing against —
  ever shows a face. A mirror one or more cells away draws its frame and empty glass.
- The portrait blit (`:3751-3781`) is
  `TAG0088b2(GetBasicGraphicAddress(26), d.pViewportBMP, (RectPos *)d.Byte2546,
  (charID & 7) << 5, 29 * (charID >> 3), 128, 112, 1)` where `charID` is the ordinal minus
  one. Graphic 26 is a **256x87** sheet of 32x29 cells, 8 per row, so charIDs 0..23 are the
  built-in portraits and `charID & 7` / `charID >> 3` are the column and row. Above 23,
  `GetExternalPortraitAddress` supplies a 16-byte-wide standalone bitmap instead — a CSB
  extension no shipped DM hero uses. ⏳ Not ported.
- **The transparent colour is 1**, not the 10 that `BltShapeToViewport` uses everywhere
  else. That is what lets the mirror's glass show around the head.
- `d.Byte2546` is a byte-form `RectPos` in the tail of graphics.dat item `0x22e`,
  immediately before `uByte2542` (`doc/CSBwin-src/Data.h:1326`). In the shipped data it
  reads `0x60, 0x7f, 0x23, 0x3f` = x 96..127, y 35..63 — exactly one 32x29 portrait cell,
  centred in the 224-pixel viewport. A single fixed rectangle suffices because position 12
  is always the same wall at the same distance.
- Taking the champion sets the actuator's type to 0 (`doc/CSBwin-src/CSBCode.cpp:6757`),
  which stops `championPortraitOrdinal` being set but leaves the decoration arm — whose
  test is `actuatorType() != 127` — reading `wallGraphicOrdinal()` as before. The frame
  therefore stays and only the face disappears, which is what a spent mirror looks like in
  DM.
