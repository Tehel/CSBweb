# CSBWin Input and Viewport Interaction Reference (Sourced)

This document captures verified input handling from the CSBWin C++ source under `doc/CSBwin-src/`.

## Mouse switch handling and button routing

- `CSBUI.cpp` handles `UIM_LEFT_BUTTON_DOWN/UP` and `UIM_RIGHT_BUTTON_DOWN/UP` by calling `OnMouseSwitchAction(0x2/0x1)` and `OnMouseUnClick` (`doc/CSBwin-src/CSBUI.cpp`).
- `OnMouseSwitchAction` updates `d.MouseSwitches` and calls `OnMouseClick` (using `d.NewMouseX/Y` when x/y are `-1`), while releases are queued via `OnMouseUnClick` (`doc/CSBwin-src/system.cpp`).
- `OnMouseClick` uses `SearchButtonList` against `PrimaryButtonList` then `SecondaryButtonList` to map clicks to button IDs, and enqueues matches into the mouse queue; `SearchButtonList` only matches when `buttons & ent->button` is non-zero (`doc/CSBwin-src/CSBCode.cpp`).
- `HandleMouseEvents` processes the mouse queue at most once per tick (delta), dispatching by button ID; button ID `100` routes to `HandleMagicClick` (`doc/CSBwin-src/Mouse.cpp`).
- `TAG021028` sets `PrimaryButtonList = d.buttons17196` and `SecondaryButtonList = d.buttons17304` for the normal adventure UI mode (`doc/CSBwin-src/CSBCode.cpp`).
- Entering sleep mode sets `PrimaryButtonList = d.buttons17796` and clears `SecondaryButtonList`, while frozen mode sets `PrimaryButtonList = d.buttons17832` and clears `SecondaryButtonList` (`doc/CSBwin-src/Mouse.cpp`).

## Viewport object hit-testing and pickup/drop

- `DrawViewport` clears `ViewportObjectButtons[6]` each frame with `memset` and sets each button's `x1` to `0xff` via `fillWithByte` before rendering (`doc/CSBwin-src/Viewport.cpp`).
- `DrawSingleObject` marks items as touchable only for distance 0, center column, and non-missile draws; it updates `ViewportObjectButtons[relativeLocationWithinCell]` with the object rect (expanding if needed, with a small-height Y adjustment) and stores `rn10574[relativeLocationWithinCell] = objRN` (`doc/CSBwin-src/Code51a4.cpp`).
- `HandleClickInViewport` loops `ViewportObjectButtons[0..5]` when empty-handed; for positions `0..4` it calls `TAG01a148`, which uses `CURSORFILTER_PickFromFloor`, moves the object from the current cell (`pos < 2`) or front cell (`pos >= 2`), and places it on the cursor (`doc/CSBwin-src/Mouse.cpp`). The first button hit wins, so the objects (0-4) are tested before the front wall (5); an alcove's objects lie inside its button 5. Button 5 calls `TouchWallF1` only when `d.FacingAlcove == 0` (`doc/CSBwin-src/Mouse.cpp:1099-1135`).
- `DropObject` maps viewport drop positions to cell positions by converting `pos` to `(partyFacing + pos) & 3`, treating `pos == 4` (alcove) as `pos = 2` and always dropping into the front cell for `pos >= 2`, then calls `MoveObject` and clears the cursor (`doc/CSBwin-src/Mouse.cpp`).
- `TestThrow` only allows throws when `47 <= clickY <= 102`; it uses `clickX` bands (`32..111` for left, `111..191` for right) and blocks the extreme side bands (`<64` / `>163`) when the front cell is `roomDOORFACING` (`doc/CSBwin-src/Mouse.cpp`).

## False wall click gating

- `d.CellTypeJustAhead` is `roomData[17].roomType` as `SummarizeRoomInfo` leaves it (`doc/CSBwin-src/Viewport.cpp:6782-6785`), and a false wall summarises as stone while it is not open, `(cellFlag & 0x04) == 0` (`doc/CSBwin-src/Codea59a.cpp:278-279`). `CellTypeJustAhead == 0` picks the cursor's stone arm (`doc/CSBwin-src/Mouse.cpp:1165`), so a closed imaginary false wall takes it too.
- The stricter `(cellFlag & 0x05) == 0`, a false wall neither open nor imaginary, gates only the empty-handed bare-stone sound, inside a `CellTypeJustAhead == 0` test (`doc/CSBwin-src/Mouse.cpp:1139-1147`). `MissileTimer` uses the same test for a solid false wall (`doc/CSBwin-src/Timer.cpp:344`).
