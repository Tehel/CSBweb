# CSBWin UI Rendering Reference (Verified)

This document lists UI rendering facts that are directly visible in the CSBWin C++ source. Every item below is backed by explicit code or data declarations.

## Screen + viewport composition

- The viewport buffer is copied into the screen at `d.LogicalScreenBase + 5280`, then 112 bytes per row for 136 rows (`doc/CSBwin-src/CSBCode.cpp:1027`, `doc/CSBwin-src/CSBCode.cpp:1033`). This places the viewport at screen x=0 and y=33 (5280 / 160 bytes per row).
- The viewport buffer is allocated as 15232 bytes with separate subregions for black and floor caches (`doc/CSBwin-src/CSBCode.cpp:10245`, `doc/CSBwin-src/CSBCode.cpp:10246`).
- `BLT2Viewport(src, rect, P3, P4)` forwards to `TAG0088b2(src, d.pViewportBMP, rect, 0, 0, P3, 112, P4)` (`doc/CSBwin-src/Menu.cpp:15-28`). **`P3` is a source *byte* width and `P4` the transparent colour** — the hardcoded `112` is the destination byte width of the 224-pixel viewport, so at 4bpp one byte is two pixels. **Our `blitBasicGraphicToViewport` takes `srcStride` in pixels, i.e. exactly twice CSBWin's `P3`.** Every call in `src/renderer/ui/` follows that: graphic 29 is 16→32, graphics 30/31 are 24→48, graphic 32 is 48→96, and graphics 20/23/25/40 are 72→144. Transcribing `P3` unchanged draws the graphic at half width.

## Static UI background regions

- The UI backdrop is cleared with three rectangles: top bar, right side panel, and scrolling text area (`doc/CSBwin-src/CSBCode.cpp:10666`, `doc/CSBwin-src/CSBCode.cpp:10667`, `doc/CSBwin-src/CSBCode.cpp:10668`).
- These rectangles come from `wRectPos1780`, `wRectPos1788`, and `wRectPos1796`, which are part of graphic `0x232` and swapped on load (`doc/CSBwin-src/Data.h:1414`, `doc/CSBwin-src/Data.h:1415`, `doc/CSBwin-src/Data.h:1416`).

## Portrait/status bar layout (top row)

- Each portrait slot uses `x = 69 * chIdx`, `y = 0..28`, `x2 = x1 + 66` to clear the area and draw shield dots (`doc/CSBwin-src/Character.cpp:1253`, `doc/CSBwin-src/Character.cpp:1262`, `doc/CSBwin-src/Character.cpp:1265`).
- Shield overlays use basic graphics 37/38/39 and are drawn into the portrait rectangle (`doc/CSBwin-src/Character.cpp:1271`, `doc/CSBwin-src/Character.cpp:1285`).
- The in-portrait status box portrait (inventory open) is drawn at `x = 69 * chIdx + 7`, `x2 = x1 + 31`, `y = 0..28` (`doc/CSBwin-src/Character.cpp:4666`, `doc/CSBwin-src/Character.cpp:4667`).
- Dead portraits draw basic graphic 8 and print the name at `x = LOCAL_4 + 1`, `y = 5` (`doc/CSBwin-src/Character.cpp:1306`, `doc/CSBwin-src/Character.cpp:1307`).
- The name strip for living characters uses `y = 0..6`, `x = LOCAL_4 .. LOCAL_4 + 42` and is filled before `TextOutToScreen(LOCAL_4+1, 5, ...)` (`doc/CSBwin-src/Character.cpp:1348`, `doc/CSBwin-src/Character.cpp:1351`, `doc/CSBwin-src/Character.cpp:1356`).

## Party position/dir indicators

- The facing/position indicator uses `wRectPos1454[4]`, filled with the character color, and overlays basic graphic 28 with a 19-pixel X offset per facing (`doc/CSBwin-src/Character.cpp:1469`, `doc/CSBwin-src/Character.cpp:1473`, `doc/CSBwin-src/Character.cpp:1476`).
- `wRectPos1454` is part of graphic `0x232` (`doc/CSBwin-src/Data.h:1423`).
- Only a living champion has a square: `DrawCharacterState` draws it inside `if (pcA3->HP() != 0)` (`doc/CSBwin-src/Character.cpp:1313`), and `KillCharacter` fills a dying champion's with colour 0 (`doc/CSBwin-src/Character.cpp:2669-2672`). A box with no champion has none either, so an empty party's top view is black.

## Attack buttons (right panel)

- Each attack button rectangle is `x = 22 * chIdx + 233`, `x2 = x1 + 19`, `y = 86..120` (`doc/CSBwin-src/Character.cpp:4845`, `doc/CSBwin-src/Character.cpp:4848`).
- The icon is drawn inside `x = x1 + 2 .. x2 - 2`, `y = 95..110` after filling the button with color 4 (`doc/CSBwin-src/Character.cpp:4886`, `doc/CSBwin-src/Character.cpp:4887`, `doc/CSBwin-src/Character.cpp:4889`).
- Disabled attacks are shaded via `ShadeRectangleInScreen` (`doc/CSBwin-src/Character.cpp:4896`).

## Attack option panel (weapon-ready area)

- The weapon-ready area is cleared with `Word20` (RectPos from graphic `0x232`) (`doc/CSBwin-src/CSBCode.cpp:8834`, `doc/CSBwin-src/Data.h:1500`).
- If attack options are shown, a basic graphic (10) is blitted into one of `wRectPos20202/20210/20218` based on how many options exist (`doc/CSBwin-src/CSBCode.cpp:8851`, `doc/CSBwin-src/CSBCode.cpp:8862`).
- The attacker name is drawn at `(x=235, y=83)` and option lines at `(x=241, y=93 + 12*D7)` (`doc/CSBwin-src/CSBCode.cpp:8869`, `doc/CSBwin-src/CSBCode.cpp:8887`).
- `Word20242` and `wRectPos20202..wRectPos20218` are stored in graphic `0x230` (`doc/CSBwin-src/Data.h:639`, `doc/CSBwin-src/Data.h:640`).

## Spell controls

- Spell control background uses `Word20242` (graphic `0x230`) and is cleared before button flashes (`doc/CSBwin-src/Character.cpp:5024`, `doc/CSBwin-src/Data.h:639`).
- Spell control highlight rectangles use explicit coordinates with `vblFlashButn`: `(0xe9..0x115, 0x2a..0x31)` and related segments based on active characters (`doc/CSBwin-src/Character.cpp:5031`, `doc/CSBwin-src/Character.cpp:5038`).
- The active caster name is drawn at `(0xeb, 0x30)`, with other cases using `(0xf9, 0x30)` and `(0x107, 0x30)` (`doc/CSBwin-src/Character.cpp:5032`, `doc/CSBwin-src/Character.cpp:5070`, `doc/CSBwin-src/Character.cpp:5087`).

## Held object label

- `DrawNameOfHeldObject` draws the cursor item name at `(x=0xe9, y=0x25)` using text color `4`, background `0`, and a fixed length of `14` characters (`doc/CSBwin-src/Code11f52.cpp:66-107`, `doc/CSBwin-src/Character.cpp:83-113`).

## Movement buttons

- Movement buttons are drawn by blitting basic graphic 13 into `Word28` (`doc/CSBwin-src/Character.cpp:5126`).
- `Word28` is part of graphic `0x232` (`doc/CSBwin-src/Data.h:1499`).

## Text rendering and message area

- `TextOutToScreen` renders through `TextOut_OneLine` into `d.LogicalScreenBase` with a width of 160 bytes (320 pixels) (`doc/CSBwin-src/CSBCode.cpp:1774`).
- The font data is loaded from graphic `0x822d` into `d.Pointer12926` (`doc/CSBwin-src/CSBCode.cpp:1805`).
- `TextOut_OneLine` advances characters in 6-pixel steps and uses `x` modulo 16-bit alignment logic (`doc/CSBwin-src/Graphics.cpp:322`, `doc/CSBwin-src/Graphics.cpp:347`).
- A glyph is 5 pixels wide, the font's bits 4..0, and starts at the pen: `BltOneChar` shifts the byte left by `11-D3W`, so bit 4 lands on pixel `x` and bit 0 on `x+4` (`doc/CSBwin-src/Graphics.cpp:219`). The font never sets bit 5. The mask `0x07ff07ff >> D3W` clears the same five pixels only (`doc/CSBwin-src/Graphics.cpp:342`), so a background colour fills `x..x+4` and the sixth pixel of the cell, the gap before the next character, keeps what was under it.
- So every text call takes CSBWin's pen x unchanged, never nudged by a pixel: `TextToViewport(x, …)` is screen x `x` (the viewport sits at x 0), e.g. the inventory's name at 3 (`doc/CSBwin-src/Character.cpp:1329`), `HEALTH` at 5 (`doc/CSBwin-src/CSBCode.cpp:7557`), the current/`/`/max values at 55/73/79 (`doc/CSBwin-src/Character.cpp:1071-1077`), `LOAD` at 104 and the weight at 148 (`:1445`, `:1459`), masteries and attributes at 108/174/192 (`:4620-4651`), the eye's object name at 134 (`:3634`); the spell runes at `225 + 14*(i+1)` (`doc/CSBwin-src/CSBCode.cpp:9055-9060`) and the incantation at `232 + 9*(i+1)` (`doc/CSBwin-src/Magic.cpp:786-798`). `tools/checks/mastery-panel.ts` and `tools/checks/magic-panel.ts` check the last three.
- The scrolling text system places lines at `x = PrintColumn * 6`, `y = PrintRow * 7 + 177` (commented but still authoritative for spacing) (`doc/CSBwin-src/CSBCode.cpp:1632`).

## Icon grid (hands, backpack, chest)

- `IconDisplay[46]` defines icon slots: 8 hands, 30 backpack/clothing, 8 chest (`doc/CSBwin-src/Data.h:1459`).
- `DrawItem` uses `IconDisplay.pixelX/pixelY` to create a 16x16 destination rect for each slot (`doc/CSBwin-src/Character.cpp:36`, `doc/CSBwin-src/Character.cpp:42`).
- Slots < 8 draw into `d.LogicalScreenBase`, slots >= 8 draw into `d.pViewportBMP` (inventory view) (`doc/CSBwin-src/Character.cpp:62`, `doc/CSBwin-src/Character.cpp:72`).
- `Word612[7]` selects the graphic group for object icons (`doc/CSBwin-src/Data.h:1469`, `doc/CSBwin-src/Character.cpp:49`).
- Body part slots (0..5) draw an 18×18 frame before the icon using basic graphic `33` (healthy) or `34` (wounded), with rect expanded to `x-1..x+17` and transparency color `12` (`doc/CSBwin-src/Character.cpp:1152-1219`), in the champion bar's hands as in the inventory. The weapon hand (slot 1) of the champion whose attack menu is open (`d.AttackingCharacterOrdinal`) has graphic `35`, the cyan box, instead (`:1207-1209`). CSBWin 20230608's `TAG01b1c0` clears the ordinal before it redraws the attacker, so the cyan box goes when the menu closes, after a PASS or an attack of no delay too (`doc/CSBwin-src/Character.cpp:4904-4923`); the 2016 source redraws first, and its comment says the box then stayed. `tools/checks/hand-boxes.ts` checks all three boxes.

## Chest view and slots

- `ShowChestContents` draws the chest panel graphic `25` into `wRectPos926` with a 72-byte stride (144 pixels at 4bpp) and transparency color 8, placing it in the same panel area as food/water or scrolls (`doc/CSBwin-src/Character.cpp:3056-3059`).
- When the chest display comes from the weapon hand (`P3 == 0`), `ShowChestContents` draws the open chest icon into slot `9` via `DrawItem(9, objNI_OpenChest)` (`doc/CSBwin-src/Character.cpp:3052-3055`).
- Chest contents are copied into `d.rnChestContents[0..7]` and rendered using `DrawItem(D7W+38, ...)`, with empty slots filled by `objNI_NotAnObject` (`doc/CSBwin-src/Character.cpp:3060-3074`).
- While the chest is displayed, CSBWin clears each item's link and sets the chest's `contents` link to `RNeof` to avoid stale/looped lists (`doc/CSBwin-src/Character.cpp:3093-3106`).
- `RepackChest` rebuilds the chest linked list from `d.rnChestContents`, setting the first item as `contents` and chaining the rest via `AddObjectToRoom` (`doc/CSBwin-src/Character.cpp:3133-3154`).
- Chest display is triggered through `DescribeObject` when the DB type is `dbCHEST` (`doc/CSBwin-src/Character.cpp:3548-3550`), which is called both from eye-click (`doc/CSBwin-src/Viewport.cpp:7291-7293`) and when the selected character's weapon hand holds a chest (`doc/CSBwin-src/Character.cpp:3881-3911`, `doc/CSBwin-src/Data.h:757-761`). Every caller of `ShowChestContents` and `RepackChest` is in `doc/PROVEN_FACTS.md` → "A chest is opened and repacked at events, never by drawing".
- `HandleClothingClick` reserves chest slot indices 30..37 (after subtracting 20), mapping them to `d.rnChestContents[D6W-30]` for click handling (`doc/CSBwin-src/CSBCode.cpp:6977-7012`).

## Eye click and inspection flow

- `ClickOnEye` sets `PressingEyeOrMouth`/`PressingEye`, hides the pointer until `QuitPressingEye`, draws the eye icon (`objNI_Special_e`), and if the hand is empty calls `TAG019036` (attributes); otherwise it calls `DescribeObject(d.objectInHand, 1)` (`doc/CSBwin-src/Viewport.cpp:7264-7297`). The held mouth hides it too; see `doc/PROVEN_FACTS.md` → "The held eye and mouth hide the pointer until the release".

## Mouth click and feeding

- The mouth button dispatch uses `D6W == 70` to call `FeedCharacter` (`doc/CSBwin-src/Mouse.cpp:1792-1795`), while eye uses `D6W == 71` (`doc/CSBwin-src/Mouse.cpp:1798-1801`).
- When the hand is empty, `FeedCharacter` returns if the eye panel already shows food and water (`d.DisplayResurrectChestOrScroll == 0`); otherwise it sets `PressingMouth`/`PressingEyeOrMouth`, shows food/water (`DisplayFoodWater`) over the panel, and waits for the release, `QuitPressingMouth` (`doc/CSBwin-src/Character.cpp:4058-4075`, `doc/CSBwin-src/CSBCode.cpp:7449-7454`). See `doc/PROVEN_FACTS.md` → "The mouth held with an empty hand".
- `FeedCharacter` only allows items with `ObjDesc.word4 & 1` (can put in mouth), otherwise it rejects chests and scrolls (`doc/CSBwin-src/Character.cpp:4088-4096`).
- Waterskins (`objNI_Waterskin..objNI_Water`) give `waterValue = 800` when non-empty, set `gulp = 8`, and later decrement the waterskin value by one (`doc/CSBwin-src/Character.cpp:4116-4130`, `doc/CSBwin-src/Character.cpp:4468-4477`).
- Water flasks (`potion_WaterFlask`) give `waterValue = 1600` and convert to `potion_EmptyFlask` (`doc/CSBwin-src/Character.cpp:4279-4286`, `doc/CSBwin-src/Character.cpp:4468-4473`).
- Food (`objNI_Apple..objNI_DragonSteak`) adds `FoodValue[objNI-objNI_Apple]`, sets `chew = true`, `gulp = 8`, and clears the hand (`doc/CSBwin-src/Character.cpp:4290-4299`, `doc/CSBwin-src/Character.cpp:4488-4499`).
- Food/water values are clamped with `LIMIT(-1023, value + delta, 2048)` (`doc/CSBwin-src/Character.cpp:4442-4444`), and `QueueSound(gulp)` plays when `gulp >= 0` (`doc/CSBwin-src/Character.cpp:4500-4502`).
- Chew animation blits `objNI_Special_h`/`objNI_Special_g` at `(56,46)` with 8‑VBL delays, twice (`doc/CSBwin-src/Character.cpp:4454-4462`, `doc/CSBwin-src/Graphics.cpp:182-190`).
- When `fp.emptyHand` is set, CSBWin calls `CURSORFILTER_Eat`, removes the object from the hand, and deletes the DB record (`doc/CSBwin-src/Character.cpp:4488-4499`, `doc/CSBwin-src/Character.cpp:4509-4511`).

## Item description panel

- `DescribeObject` draws the item-info panel using basic graphics `20` (food/water box) and `29`, draws the object name at `(134, 68)` and icon at `(111, 59)`, and formats the weight as `WEIGHS {weight/10}.{weight%10} KG.` using `GetObjectWeight` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` sets phrase labels `{CONSUMABLE, POISONED, BROKEN, CURSED}`, computes `phraseMask` from item flags (`weapon/clothing` flags or `ObjDesc.word4` for potion/misc), prints the combined phrase list via `EncodeDescriptivePhrases`, and prints weight when `phraseMask & 0x40` is set (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prints waterskin fullness strings based on `DB10->value()` (`(EMPTY)`, `(ALMOST EMPTY)`, `(ALMOST FULL)`, `(FULL)`), and prints `PARTY FACING {dir}` for compass items (`objNI_Compass_N..objNI_Compass_W`) (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` prefixes potion names (except water/empty flasks) with `char(95 + strength/40)` when `DetermineMastery(selectedChampion, 2) > 1` (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` builds hero bones names by concatenating the champion name with `ObjectNames[objNI_Bones_a]` when `DB10->value()` is non-zero and `CopyChampionBonesRecord` resolves a valid champion (`doc/CSBwin-src/Character.cpp`).
- `DescribeObject` invokes every `ESL_VIEWINGFILTER` DSA (special location) in turn with `pDSAparameters[1]=phraseMask`, `pDSAparameters[2]=objectId`, `pDSAparameters[3]=selectedChampion`, and `pDSAparameters[0]=3`, allowing `STKOP_Describe` (`ModifyDescription`) to override phrase text/colors; no parameter is read back (`doc/CSBwin-src/Character.cpp:3753-3787`, and `doc/PROVEN_FACTS.md` → "The viewing filter runs every DSA at its location").

## Inspection arrow indicator

- `TAG018238` blits basic graphic `18` (weapon-hand view) or `19` (eye view) into `wRectPos934` with an 8-byte stride and transparency color 8 (`doc/CSBwin-src/Character.cpp:3275-3279`).
- `DescribeObject` always calls `TAG018238(P2)` after drawing the object panel; `P2` is `0` when called from weapon-hand view (`TAG0189d4`) and `1` when called from eye view (`_ClickOnEye`) (`doc/CSBwin-src/Character.cpp:3811`, `doc/CSBwin-src/Character.cpp:3881-3911`, `doc/CSBwin-src/Viewport.cpp:7291-7293`).

## Scroll display

- `DisplayScroll` decodes scroll text with `DecodeText(..., 0x8002)`, blits basic graphic `23` into `wRectPos926`, caps to `MAX_LINES_IN_SCROLL` (9), centers lines starting at `y = 92 - (7 * numLines / 2)`, and uses `DisplayScrollText_OneLine` to draw each line with `MAX_SCROLL_LINE_LENGTH` (16) and text color `0` over background `15` (`doc/CSBwin-src/Character.cpp`).
- `DisplayScrollText_OneLine` remaps characters by subtracting `64` for `'A'..'Z'` and subtracting `0x60` for bytes `>= 0x7b` before calling `TextOut_OneLine` (`doc/CSBwin-src/Character.cpp`).
