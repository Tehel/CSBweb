# CSBWin UI Rendering Reference (Verified)

This document lists UI rendering facts that are directly visible in the CSBWin C++ source. Every item below is backed by explicit code or data declarations.

## Screen + viewport composition

- The viewport buffer is copied into the screen at `d.LogicalScreenBase + 5280`, then 112 bytes per row for 136 rows (`doc/CSBwin-src/CSBCode.cpp:1017`, `doc/CSBwin-src/CSBCode.cpp:1023`). This places the viewport at screen x=0 and y=33 (5280 / 160 bytes per row).
- The viewport buffer is allocated as 15232 bytes with separate subregions for black and floor caches (`doc/CSBwin-src/CSBCode.cpp:10121`, `doc/CSBwin-src/CSBCode.cpp:10122`).
- `BLT2Viewport(src, rect, P3, P4)` forwards to `TAG0088b2(src, d.pViewportBMP, rect, 0, 0, P3, 112, P4)` (`doc/CSBwin-src/Menu.cpp:15-28`). **`P3` is a source *byte* width and `P4` the transparent colour** — the hardcoded `112` is the destination byte width of the 224-pixel viewport, so at 4bpp one byte is two pixels. **Our `blitBasicGraphicToViewport` takes `srcStride` in pixels, i.e. exactly twice CSBWin's `P3`.** Every call in `src/renderer/ui/` follows that: graphic 29 is 16→32, graphics 30/31 are 24→48, graphic 32 is 48→96, and graphics 20/23/25/40 are 72→144. Transcribing `P3` unchanged draws the graphic at half width.

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
- Only a living champion has a square: `DrawCharacterState` draws it inside `if (pcA3->HP() != 0)` (`doc/CSBwin-src/Character.cpp:1308`), and `KillCharacter` fills a dying champion's with colour 0 (`doc/CSBwin-src/Character.cpp:2664-2667`). A box with no champion has none either, so an empty party's top view is black.

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

## Held object label

- `DrawNameOfHeldObject` draws the cursor item name at `(x=0xe9, y=0x25)` using text color `4`, background `0`, and a fixed length of `14` characters (`doc/CSBwin-src/Code11f52.cpp:32-72`, `doc/CSBwin-src/Character.cpp:82-112`).

## Movement buttons

- Movement buttons are drawn by blitting basic graphic 13 into `Word28` (`doc/CSBwin-src/Character.cpp:5101`).
- `Word28` is part of graphic `0x232` (`doc/CSBwin-src/Data.h:1484`).

## Text rendering and message area

- `TextOutToScreen` renders through `TextOut_OneLine` into `d.LogicalScreenBase` with a width of 160 bytes (320 pixels) (`doc/CSBwin-src/CSBCode.cpp:1757`).
- The font data is loaded from graphic `0x822d` into `d.Pointer12926` (`doc/CSBwin-src/CSBCode.cpp:1776`).
- `TextOut_OneLine` advances characters in 6-pixel steps and uses `x` modulo 16-bit alignment logic (`doc/CSBwin-src/Graphics.cpp:321`, `doc/CSBwin-src/Graphics.cpp:346`).
- A glyph is 5 pixels wide, the font's bits 4..0, and starts at the pen: `BltOneChar` shifts the byte left by `11-D3W`, so bit 4 lands on pixel `x` and bit 0 on `x+4` (`doc/CSBwin-src/Graphics.cpp:218`). The font never sets bit 5. The mask `0x07ff07ff >> D3W` clears the same five pixels only (`doc/CSBwin-src/Graphics.cpp:341`), so a background colour fills `x..x+4` and the sixth pixel of the cell, the gap before the next character, keeps what was under it.
- So every text call takes CSBWin's pen x unchanged, never nudged by a pixel: `TextToViewport(x, …)` is screen x `x` (the viewport sits at x 0), e.g. the inventory's name at 3 (`doc/CSBwin-src/Character.cpp:1324`), `HEALTH` at 5 (`doc/CSBwin-src/CSBCode.cpp:7498`), the current/`/`/max values at 55/73/79 (`doc/CSBwin-src/Character.cpp:1070-1076`), `LOAD` at 104 and the weight at 148 (`:1440`, `:1454`), masteries and attributes at 108/174/192 (`:4603-4634`), the eye's object name at 134 (`:3617`); the spell runes at `225 + 14*(i+1)` (`doc/CSBwin-src/CSBCode.cpp:8950-8955`) and the incantation at `232 + 9*(i+1)` (`doc/CSBwin-src/Magic.cpp:783-795`). `tools/dump-mastery-panel.ts` and `tools/dump-magic-panel.ts` check the last three.
- The scrolling text system places lines at `x = PrintColumn * 6`, `y = PrintRow * 7 + 177` (commented but still authoritative for spacing) (`doc/CSBwin-src/CSBCode.cpp:1622`).

## Icon grid (hands, backpack, chest)

- `IconDisplay[46]` defines icon slots: 8 hands, 30 backpack/clothing, 8 chest (`doc/CSBwin-src/Data.h:1444`).
- `DrawItem` uses `IconDisplay.pixelX/pixelY` to create a 16x16 destination rect for each slot (`doc/CSBwin-src/Character.cpp:35`, `doc/CSBwin-src/Character.cpp:41`).
- Slots < 8 draw into `d.LogicalScreenBase`, slots >= 8 draw into `d.pViewportBMP` (inventory view) (`doc/CSBwin-src/Character.cpp:61`, `doc/CSBwin-src/Character.cpp:71`).
- `Word612[7]` selects the graphic group for object icons (`doc/CSBwin-src/Data.h:1454`, `doc/CSBwin-src/Character.cpp:48`).
- Body part slots (0..5) draw an 18×18 frame before the icon using basic graphic `33` (healthy) or `34` (wounded), with rect expanded to `x-1..x+17` and transparency color `12` (`doc/CSBwin-src/Character.cpp:1147-1214`).

## Chest view and slots

- `ShowChestContents` draws the chest panel graphic `25` into `wRectPos926` with a 72-byte stride (144 pixels at 4bpp) and transparency color 8, placing it in the same panel area as food/water or scrolls (`doc/CSBwin-src/Character.cpp:3051-3054`).
- When the chest display comes from the weapon hand (`P3 == 0`), `ShowChestContents` draws the open chest icon into slot `9` via `DrawItem(9, objNI_OpenChest)` (`doc/CSBwin-src/Character.cpp:3047-3050`).
- Chest contents are copied into `d.rnChestContents[0..7]` and rendered using `DrawItem(D7W+38, ...)`, with empty slots filled by `objNI_NotAnObject` (`doc/CSBwin-src/Character.cpp:3055-3069`).
- While the chest is displayed, CSBWin clears each item's link and sets the chest's `contents` link to `RNeof` to avoid stale/looped lists (`doc/CSBwin-src/Character.cpp:3088-3101`).
- `RepackChest` rebuilds the chest linked list from `d.rnChestContents`, setting the first item as `contents` and chaining the rest via `AddObjectToRoom` (`doc/CSBwin-src/Character.cpp:3128-3149`).
- Chest display is triggered through `DescribeObject` when the DB type is `dbCHEST` (`doc/CSBwin-src/Character.cpp:3534-3536`), which is called both from eye-click (`doc/CSBwin-src/Viewport.cpp:7284-7286`) and when the selected character's weapon hand holds a chest (`doc/CSBwin-src/Character.cpp:3864-3894`, `doc/CSBwin-src/Data.h:742-746`).
- `HandleClothingClick` reserves chest slot indices 30..37 (after subtracting 20), mapping them to `d.rnChestContents[D6W-30]` for click handling (`doc/CSBwin-src/CSBCode.cpp:6918-6953`).

## Eye click and inspection flow

- `ClickOnEye` sets `PressingEyeOrMouth`/`PressingEye`, draws the eye icon (`objNI_Special_e`), and if the hand is empty calls `TAG019036` (attributes); otherwise it calls `DescribeObject(d.objectInHand, 1)` (`doc/CSBwin-src/Viewport.cpp`).

## Mouth click and feeding

- The mouth button dispatch uses `D6W == 70` to call `FeedCharacter` (`doc/CSBwin-src/Mouse.cpp:1653-1656`), while eye uses `D6W == 71` (`doc/CSBwin-src/Mouse.cpp:1659-1662`).
- When the hand is empty, `FeedCharacter` sets `PressingMouth`/`PressingEyeOrMouth`, shows food/water (`DisplayFoodWater`), and defers until mouse release (`doc/CSBwin-src/Character.cpp:4041-4058`).
- `FeedCharacter` only allows items with `ObjDesc.word4 & 1` (can put in mouth), otherwise it rejects chests and scrolls (`doc/CSBwin-src/Character.cpp:4071-4079`).
- Waterskins (`objNI_Waterskin..objNI_Water`) give `waterValue = 800` when non-empty, set `gulp = 8`, and later decrement the waterskin value by one (`doc/CSBwin-src/Character.cpp:4099-4113`, `doc/CSBwin-src/Character.cpp:4451-4460`).
- Water flasks (`potion_WaterFlask`) give `waterValue = 1600` and convert to `potion_EmptyFlask` (`doc/CSBwin-src/Character.cpp:4262-4269`, `doc/CSBwin-src/Character.cpp:4451-4456`).
- Food (`objNI_Apple..objNI_DragonSteak`) adds `FoodValue[objNI-objNI_Apple]`, sets `chew = true`, `gulp = 8`, and clears the hand (`doc/CSBwin-src/Character.cpp:4273-4282`, `doc/CSBwin-src/Character.cpp:4471-4482`).
- Food/water values are clamped with `LIMIT(-1023, value + delta, 2048)` (`doc/CSBwin-src/Character.cpp:4425-4427`), and `QueueSound(gulp)` plays when `gulp >= 0` (`doc/CSBwin-src/Character.cpp:4483-4485`).
- Chew animation blits `objNI_Special_h`/`objNI_Special_g` at `(56,46)` with 8‑VBL delays, twice (`doc/CSBwin-src/Character.cpp:4437-4445`, `doc/CSBwin-src/Graphics.cpp:181-189`).
- When `fp.emptyHand` is set, CSBWin calls `CURSORFILTER_Eat`, removes the object from the hand, and deletes the DB record (`doc/CSBwin-src/Character.cpp:4471-4482`, `doc/CSBwin-src/Character.cpp:4492-4494`).

## Item description panel

- `DescribeObject` draws the item-info panel using basic graphics `20` (food/water box) and `29`, draws the object name at `(134, 68)` and icon at `(111, 59)`, and formats the weight as `WEIGHS {weight/10}.{weight%10} KG.` using `GetObjectWeight` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` sets phrase labels `{CONSUMABLE, POISONED, BROKEN, CURSED}`, computes `phraseMask` from item flags (`weapon/clothing` flags or `ObjDesc.word4` for potion/misc), prints the combined phrase list via `EncodeDescriptivePhrases`, and prints weight when `phraseMask & 0x40` is set (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prints waterskin fullness strings based on `DB10->value()` (`(EMPTY)`, `(ALMOST EMPTY)`, `(ALMOST FULL)`, `(FULL)`), and prints `PARTY FACING {dir}` for compass items (`objNI_Compass_N..objNI_Compass_W`) (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prefixes potion names (except water/empty flasks) with `char(95 + strength/40)` when `DetermineMastery(selectedChampion, 2) > 1` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` builds hero bones names by concatenating the champion name with `ObjectNames[objNI_Bones_a]` when `DB10->value()` is non-zero and `CopyChampionBonesRecord` resolves a valid champion (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` invokes the `ESL_VIEWINGFILTER` DSA (special location) with `pDSAparameters[1]=phraseMask`, `pDSAparameters[2]=objectId`, `pDSAparameters[3]=selectedChampion`, and `pDSAparameters[0]=3`, allowing `STKOP_Describe` (`ModifyDescription`) to override phrase text/colors (`doc/CSBwin-src/Character.cpp`).

## Inspection arrow indicator

- `TAG018238` blits basic graphic `18` (weapon-hand view) or `19` (eye view) into `wRectPos934` with an 8-byte stride and transparency color 8 (`doc/CSBwin-src/Character.cpp:3270-3274`).
- `DescribeObject` always calls `TAG018238(P2)` after drawing the object panel; `P2` is `0` when called from weapon-hand view (`TAG0189d4`) and `1` when called from eye view (`_ClickOnEye`) (`doc/CSBwin-src/Character.cpp:3794`, `doc/CSBwin-src/Character.cpp:3864-3894`, `doc/CSBwin-src/Viewport.cpp:7284-7286`).

## Scroll display

- `DisplayScroll` decodes scroll text with `DecodeText(..., 0x8002)`, blits basic graphic `23` into `wRectPos926`, caps to `MAX_LINES_IN_SCROLL` (9), centers lines starting at `y = 92 - (7 * numLines / 2)`, and uses `DisplayScrollText_OneLine` to draw each line with `MAX_SCROLL_LINE_LENGTH` (16) and text color `0` over background `15` (`doc/CSBwin-src/Character.cpp`).
- `DisplayScrollText_OneLine` remaps characters by subtracting `64` for `'A'..'Z'` and subtracting `0x60` for bytes `>= 0x7b` before calling `TextOut_OneLine` (`doc/CSBwin-src/Character.cpp`).
