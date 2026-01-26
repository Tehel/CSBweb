# CSBWin UI Rendering Reference (Verified)

This document lists UI rendering facts that are directly visible in the CSBWin C++ source. Every item below is backed by explicit code or data declarations.

## Screen + viewport composition

- The viewport buffer is copied into the screen at `d.LogicalScreenBase + 5280`, then 112 bytes per row for 136 rows (`doc/CSBwin-src/CSBCode.cpp:1017`, `doc/CSBwin-src/CSBCode.cpp:1023`). This places the viewport at screen x=0 and y=33 (5280 / 160 bytes per row).
- The viewport buffer is allocated as 15232 bytes with separate subregions for black and floor caches (`doc/CSBwin-src/CSBCode.cpp:10121`, `doc/CSBwin-src/CSBCode.cpp:10122`).

## Static UI background regions

- The UI backdrop is cleared with three rectangles: top bar, right side panel, and scrolling text area (`doc/CSBwin-src/CSBCode.cpp:10542`, `doc/CSBwin-src/CSBCode.cpp:10543`, `doc/CSBwin-src/CSBCode.cpp:10544`).
- These rectangles come from `wRectPos1780`, `wRectPos1788`, and `wRectPos1796`, which are part of graphic `0x232` and swapped on load (`doc/CSBwin-src/Data.h:1399`, `doc/CSBwin-src/Data.h:1400`, `doc/CSBwin-src/Data.h:1401`).

## Portrait/status bar layout (top row)

- Each portrait slot uses `x = 69 * chIdx`, `y = 0..28`, `x2 = x1 + 66` to clear the area and draw shield dots (`doc/CSBwin-src/Character.cpp:1248`, `doc/CSBwin-src/Character.cpp:1257`, `doc/CSBwin-src/Character.cpp:1260`).
- Shield overlays use basic graphics 37/38/39 and are drawn into the portrait rectangle (`doc/CSBwin-src/Character.cpp:1266`, `doc/CSBwin-src/Character.cpp:1280`).
- The in-portrait status box portrait (inventory open) is drawn at `x = 69 * chIdx + 7`, `x2 = x1 + 31`, `y = 0..28` (`doc/CSBwin-src/Character.cpp:4649`, `doc/CSBwin-src/Character.cpp:4650`).
- Dead portraits draw basic graphic 8 and print the name at `x = LOCAL_4 + 1`, `y = 5` (`doc/CSBwin-src/Character.cpp:1301`, `doc/CSBwin-src/Character.cpp:1302`).
- The name strip for living characters uses `y = 0..6`, `x = LOCAL_4 .. LOCAL_4 + 42` and is filled before `TextOutToScreen(LOCAL_4+1, 5, ...)` (`doc/CSBwin-src/Character.cpp:1343`, `doc/CSBwin-src/Character.cpp:1346`, `doc/CSBwin-src/Character.cpp:1351`).

## Party position/dir indicators

- The facing/position indicator uses `wRectPos1454[4]`, filled with the character color, and overlays basic graphic 28 with a 19-pixel X offset per facing (`doc/CSBwin-src/Character.cpp:1464`, `doc/CSBwin-src/Character.cpp:1468`, `doc/CSBwin-src/Character.cpp:1471`).
- `wRectPos1454` is part of graphic `0x232` (`doc/CSBwin-src/Data.h:1408`).

## Attack buttons (right panel)

- Each attack button rectangle is `x = 22 * chIdx + 233`, `x2 = x1 + 19`, `y = 86..120` (`doc/CSBwin-src/Character.cpp:4828`, `doc/CSBwin-src/Character.cpp:4831`).
- The icon is drawn inside `x = x1 + 2 .. x2 - 2`, `y = 95..110` after filling the button with color 4 (`doc/CSBwin-src/Character.cpp:4869`, `doc/CSBwin-src/Character.cpp:4870`, `doc/CSBwin-src/Character.cpp:4872`).
- Disabled attacks are shaded via `ShadeRectangleInScreen` (`doc/CSBwin-src/Character.cpp:4879`).

## Attack option panel (weapon-ready area)

- The weapon-ready area is cleared with `Word20` (RectPos from graphic `0x232`) (`doc/CSBwin-src/CSBCode.cpp:8729`, `doc/CSBwin-src/Data.h:1485`).
- If attack options are shown, a basic graphic (10) is blitted into one of `wRectPos20202/20210/20218` based on how many options exist (`doc/CSBwin-src/CSBCode.cpp:8746`, `doc/CSBwin-src/CSBCode.cpp:8757`).
- The attacker name is drawn at `(x=235, y=83)` and option lines at `(x=241, y=93 + 12*D7)` (`doc/CSBwin-src/CSBCode.cpp:8764`, `doc/CSBwin-src/CSBCode.cpp:8782`).
- `Word20242` and `wRectPos20202..wRectPos20218` are stored in graphic `0x230` (`doc/CSBwin-src/Data.h:630`, `doc/CSBwin-src/Data.h:631`).

## Spell controls

- Spell control background uses `Word20242` (graphic `0x230`) and is cleared before button flashes (`doc/CSBwin-src/Character.cpp:4999`, `doc/CSBwin-src/Data.h:630`).
- Spell control highlight rectangles use explicit coordinates with `vblFlashButn`: `(0xe9..0x115, 0x2a..0x31)` and related segments based on active characters (`doc/CSBwin-src/Character.cpp:5006`, `doc/CSBwin-src/Character.cpp:5013`).
- The active caster name is drawn at `(0xeb, 0x30)`, with other cases using `(0xf9, 0x30)` and `(0x107, 0x30)` (`doc/CSBwin-src/Character.cpp:5007`, `doc/CSBwin-src/Character.cpp:5045`, `doc/CSBwin-src/Character.cpp:5062`).

## Movement buttons

- Movement buttons are drawn by blitting basic graphic 13 into `Word28` (`doc/CSBwin-src/Character.cpp:5101`).
- `Word28` is part of graphic `0x232` (`doc/CSBwin-src/Data.h:1484`).

## Text rendering and message area

- `TextOutToScreen` renders through `TextOut_OneLine` into `d.LogicalScreenBase` with a width of 160 bytes (320 pixels) (`doc/CSBwin-src/CSBCode.cpp:1757`).
- The font data is loaded from graphic `0x822d` into `d.Pointer12926` (`doc/CSBwin-src/CSBCode.cpp:1776`).
- `TextOut_OneLine` advances characters in 6-pixel steps and uses `x` modulo 16-bit alignment logic (`doc/CSBwin-src/Graphics.cpp:321`, `doc/CSBwin-src/Graphics.cpp:346`).
- The scrolling text system places lines at `x = PrintColumn * 6`, `y = PrintRow * 7 + 177` (commented but still authoritative for spacing) (`doc/CSBwin-src/CSBCode.cpp:1622`).

## Icon grid (hands, backpack, chest)

- `IconDisplay[46]` defines icon slots: 8 hands, 30 backpack/clothing, 8 chest (`doc/CSBwin-src/Data.h:1444`).
- `DrawItem` uses `IconDisplay.pixelX/pixelY` to create a 16x16 destination rect for each slot (`doc/CSBwin-src/Character.cpp:35`, `doc/CSBwin-src/Character.cpp:41`).
- Slots < 8 draw into `d.LogicalScreenBase`, slots >= 8 draw into `d.pViewportBMP` (inventory view) (`doc/CSBwin-src/Character.cpp:61`, `doc/CSBwin-src/Character.cpp:71`).
- `Word612[7]` selects the graphic group for object icons (`doc/CSBwin-src/Data.h:1454`, `doc/CSBwin-src/Character.cpp:48`).

## Eye click and inspection flow

- `ClickOnEye` sets `PressingEyeOrMouth`/`PressingEye`, draws the eye icon (`objNI_Special_e`), and if the hand is empty calls `TAG019036` (attributes); otherwise it calls `DescribeObject(d.objectInHand, 1)` (`doc/CSBwin-src/Viewport.cpp`).

## Item description panel

- `DescribeObject` draws the item-info panel using basic graphics `20` (food/water box) and `29`, draws the object name at `(134, 68)` and icon at `(111, 59)`, and formats the weight as `WEIGHS {weight/10}.{weight%10} KG.` using `GetObjectWeight` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` sets phrase labels `{CONSUMABLE, POISONED, BROKEN, CURSED}`, computes `phraseMask` from item flags (`weapon/clothing` flags or `ObjDesc.word4` for potion/misc), prints the combined phrase list via `EncodeDescriptivePhrases`, and prints weight when `phraseMask & 0x40` is set (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prints waterskin fullness strings based on `DB10->value()` (`(EMPTY)`, `(ALMOST EMPTY)`, `(ALMOST FULL)`, `(FULL)`), and prints `PARTY FACING {dir}` for compass items (`objNI_Compass_N..objNI_Compass_W`) (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prefixes potion names (except water/empty flasks) with `char(95 + strength/40)` when `DetermineMastery(selectedChampion, 2) > 1` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` builds hero bones names by concatenating the champion name with `ObjectNames[objNI_Bones_a]` when `DB10->value()` is non-zero and `CopyChampionBonesRecord` resolves a valid champion (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` invokes the `ESL_VIEWINGFILTER` DSA (special location) with `pDSAparameters[1]=phraseMask`, `pDSAparameters[2]=objectId`, `pDSAparameters[3]=selectedChampion`, and `pDSAparameters[0]=3`, allowing `STKOP_Describe` (`ModifyDescription`) to override phrase text/colors (`doc/CSBwin-src/Character.cpp`).

## Scroll display

- `DisplayScroll` decodes scroll text with `DecodeText(..., 0x8002)`, blits basic graphic `23` into `wRectPos926`, caps to `MAX_LINES_IN_SCROLL` (9), centers lines starting at `y = 92 - (7 * numLines / 2)`, and uses `DisplayScrollText_OneLine` to draw each line with `MAX_SCROLL_LINE_LENGTH` (16) and text color `0` over background `15` (`doc/CSBwin-src/Character.cpp`).
- `DisplayScrollText_OneLine` remaps characters by subtracting `64` for `'A'..'Z'` and subtracting `0x60` for bytes `>= 0x7b` before calling `TextOut_OneLine` (`doc/CSBwin-src/Character.cpp`).
