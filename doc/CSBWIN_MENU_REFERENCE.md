# CSBWin Menu / Dialog Reference (Sourced)

Everything here is read out of `doc/CSBwin-src/` or dumped from `graphics.dat` with the
port's own parser. Rectangles marked **(from data)** were printed by
`tools/dump-save-menu.ts`, which asserts them on every run.

CSBWin has exactly two menu primitives: **`_DoMenu` draws**, **`_WaitForMenuSelect` runs
the modal click loop**. Neither draws a button frame — the frames are painted into
**graphic 0**, and the layouts differ only by which parts of that bitmap get blitted over
themselves.

(`Chaos.cpp` has a second, unrelated dialog system — `DrawDialogBoxOutline`,
`AddDialogButton`, `_UtilityDialogBox` — but that belongs to the standalone CSB *Utility*
program, not to the dungeon. It is not ported.)


## The disk icon

The icon is not hit-tested by any special code. It is entry 1 of the inventory panel's
secondary button list, which `ShowHideInventory` installs on open
(`doc/CSBwin-src/CSBCode.cpp:7577` — `d.SecondaryButtonList = d.Buttons17760;`, swapped
back to `d.Buttons17304` on close at `:7540`).

**(from data)** `buttons17760[1] = { word0: 140, x 174..182, y 36..44, button: 2 }` — an
8×8 left-click-only hot spot in screen coordinates. Its neighbours in the same list are
145 (sleep, x 188..204) and 11 (close inventory, x 210..218, entry 3). Button 11 is also
entry 0, the whole screen for the right button. In a data set with the Hint Oracle, entry
3 is the Oracle's button (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "In the port: the
inventory's button").

This port already installs `buttons17760`: `syncInventoryButtons`
(`src/renderer/ui/Mouse.ts`). Until the save menu existed, id 140 simply fell through
`handleMouseButton` unhandled.

The dispatch is a **deferral**, not a call (`doc/CSBwin-src/Mouse.cpp:1847-1866`):

```c
  if (D6W == 140)
  {
    if (   ((ui16)d.NumCharacter > 0)
        && (d.PotentialCharacterOrdinal == 0))
    {
      //DisplayDiskMenu(_9_);
      //We cannot call 'DisplayDiskMenu' here because
      //it would result in recursive call to ourselves.
      //So we set the flag and return. ...
      DiskMenuNeeded = true;
    };
```

`DiskMenuNeeded` is cleared at the top of every `HandleMouseEvents`
(`doc/CSBwin-src/Mouse.cpp:1471`) and acted on by each of its callers — the main loop
(`CSBCode.cpp:772`), `_WaitForMenuSelect` itself (`Menu.cpp:75`, so the menu can be
re-opened from inside a menu), the prison-door loop (`CSBCode.cpp:9654`) and the
death/restart loop (`Code1f9e6.cpp:273`).

Both guards matter: **no champion in the party**, or a champion only provisionally in it
(the Hall of Champions), and the icon does nothing.


## Graphic 0 — the dialog bitmap

`_DoMenu` opens with `ExpandGraphic((i8*)d.compressedGraphic0, d.pViewportBMP, 0, 0)`
(`doc/CSBwin-src/Menu.cpp:268`). `d.compressedGraphic0` is filled by `ReadGraphic(0, …)`
(`doc/CSBwin-src/Graphics.cpp:2028-2031`), so it is **item 0 of `graphics.dat`** —
239 bytes after the file's own decompression, expanding to **224×136**, one byte per
pixel. `GraphicsLoader.getImage(0)` produces exactly that, so the port needs no separate
`ExpandGraphic`.

The art, in *viewport* coordinates (measured, not guessed):

| region | extent | colours |
| --- | --- | --- |
| outer background | 0..223 × 0..135 | 1, with a colour-2 edge at x=0 and y=0 |
| **title panel** | x 10..213, y 10..51 | border 12 (top/left), shadow 3, interior **5** at x 12..212, y 12..50, bottom edge 2 at y=51 |
| **full-width button frame** | x 10..213, y 62..89 | border 12, black 0, bevel 10/3, interior **5** at y 68..83 |
| **two half-width button frames** | y 100..125, left x 10..110, right x 122..213 | same bevel, interiors at y 106..119 |

So the art already carries a full-width frame on the upper row and a split pair on the
lower row. The layouts patch it:

| options | patch | label positions (viewport) |
| --- | --- | --- |
| 1 | copy `rect18576` = (0,0)-(223,74) from source (0,14) into a temp buffer, blit it back at `rect18584` = (0,51)-(223,125) — slides the panel and frame down so the one button sits on the bottom row | (112,114) |
| 2 | self-blit `rect18592` = (102,89)-(122,125) from source (102,52) — paints background over the gap between the bottom frames, merging them into one | (112,77), (112,114) |
| 3 | none | (112,77), (59,114), (166,114) |
| 4 | self-blit `rect18600` = (102,62)-(122,97) from source (102,99) — copies the gap *up*, splitting the top frame in two | (59,77), (166,77), (59,114), (166,114) |

All four rectangles are **(from data)**, `graphics.dat` item 0x231, already extracted as
`graphic231.rect18576` … `rect18600` (`src/data/tables/UITables.ts`).

`_DoMenu` also stamps `"V2.0"` at (192,7), fg 2 on bg 1 (`Menu.cpp:272-280`).


## Text metrics

`CenteredText` (`doc/CSBwin-src/Menu.cpp:192`):

```c
  D0W = StrLen(text);
  x = sw(x - D0W*3);
  TextOut_OneLine(dest, 112, x, y, 9, 5, text, 999, false);
```

A fixed 6-pixel cell, so centring is `x - 3*len`; **fg 9 on bg 5**. The glyph cell starts
at `y-4` and is 6 rows tall (`doc/CSBwin-src/Graphics.cpp:318`, `:211`) — which is
already `drawTextLineIndex`'s convention in `src/renderer/csbwin/TextRenderer.ts`.

Titles (`Menu.cpp:352-449`) start at **y = 29**, or **21** when `SplitLongLine` split
them, and step 8 pixels a line. `title1` is **fg 11**, `title2` **fg 9**, both on bg 5,
and both are centred on `113 - 3*len` — note **113**, not 112, one pixel right of where
the button labels centre.

`SplitLongLine` (`Menu.cpp:211`): a string shorter than 30 characters is left alone;
otherwise it scans forward from `len/2` for the first space and breaks there. If there is
no space at or after the midpoint the whole string stays on line one and line two is
empty — CSBWin does not fall back to a hard break.


## Where the box lands

```c
  if (I1 != 0)
  {
    rectpos.w.y1 = 33;  rectpos.w.y2 = 168;
    rectpos.w.x1 = 47;  rectpos.w.x2 = 270;
    BLT2Screen(d.pViewportBMP, &rectpos, 112, -1);
  }
  else { MarkViewportUpdated(0); wvbl(_1_); };
```

(`Menu.cpp:450-465`.) With `I1 == 0` the bitmap stays in the viewport, which is already at
screen **(0,33)**; with `I1 != 0` it is blitted to screen **(47,33)**, centred. The
in-game disk menu uses `I1 == 0`, so the portraits and panels stay visible beside it; the
boot-time load screen and "GAME LOADED, READY TO PLAY." (`CSBCode.cpp:10623-10632`) use
`I1 == 1`.

`videoMode` becomes `VM_CENTERMENU` when `ClearOldScreen` is set and `VM_LEFTMENU`
otherwise (`Menu.cpp:465-472`); `ClearOldScreen` also `ClearMemory(d.LogicalScreenBase,
32000)` first (`:291`), and `FadeOldScreen` fades to `d.Palette11914` before and
`d.Palette11978` after (`:287`, `:475`). None of the three is used by the disk menu. The port
does the fades and the clear on the intro host around `doMenu`'s drawing (`doMenuCentred`,
`src/renderer/intro/BootSequence.ts`), since only a pre-game screen owns the colour
registers.

**Therefore viewport coordinates convert to screen coordinates by adding (0,33) for the
in-game menu and (47,33) for the centred one** — which is why the extracted button
rectangles below are already in screen space, and why the two sets differ by exactly 47.


## The button rectangles

`d.pButn18970[2][4]` is wired at `doc/CSBwin-src/CSBCode.cpp:314-321`;
`_WaitForMenuSelect` picks `d.pButn18970[P2][numButton-1]` (`Menu.cpp:64`). Set 0 is the
in-viewport menu, set 1 the centred one. Every entry is left-button (`button = 2`) and the
ids are **210..213**. **(from data)**, all screen coordinates:

| n | set 0 (`buttons18624/18660/18708/18768`) | set 1 (`buttons18792/18828/18876/18936`) |
| --- | --- | --- |
| 1 | 210: x 16..207, y 138..152 | 210: x 63..254, y 138..152 |
| 2 | 210: 16..207 y 101..115; 211: 16..207 y 138..152 | same, x 63..254 |
| 3 | 210: 16..207 y101; 211: 16..101 y138; 212: 123..207 y138 | 210: 63..254 y101; 211: 63..148 y138; 212: 170..254 y138 |
| 4 | 210: 16..101 y101; 211: 123..207 y101; 212: 16..101 y138; 213: 123..207 y138 | 210: 63..148 y101; 211: 170..254 y101; 212: 63..148 y138; 213: 170..254 y138 |

`x2`/`y2` are exclusive (`SearchButtonList`), so a full-width button is 191×14 and a
half-width one 85×14. Their centres match the label positions: 16..207 centres on 111.5,
and the labels are drawn at 112.


## The modal loop

`_WaitForMenuSelect` (`doc/CSBwin-src/Menu.cpp:33`) gets its modality by replacing the
whole input mapping and restoring it afterwards:

```c
  savePrimaryButtonList = d.PrimaryButtonList;
  saveSecondaryButtonList = d.SecondaryButtonList;
  LOCAL_12 = d.pKeyXlate2;  LOCAL_16 = d.pKeyXlate1;
  d.pKeyXlate1 = NULL;  d.pKeyXlate2 = NULL;
  d.SecondaryButtonList = NULL;
  d.PrimaryButtonList = d.pButn18970[P2][numButton-1];
  d.Word11764 = 99;
```

`d.Word11764` is written in one place only (`doc/CSBwin-src/Mouse.cpp:1931-1935`):
`if ((D6W >= 210) && (D6W <= 213)) d.Word11764 = sw(D6W - 209);`. Everything else in the
panel is unreachable because both lists were replaced. Keyboard: **no key selects a
button.** Key translation is off, and the one-button arm that reads a key calls
`NotImplemented`, which ends CSBWin (`Menu.cpp:82-93`; `doc/PROVEN_FACTS.md` → "A
one-button menu takes no key"). On exit the two
button lists and both `pKeyXlate`s are restored and `DiscardAllInput()` is called.

### Nothing pauses the clock

There is no pause flag. `d.Time++` occurs in exactly two places — the main loop
(`doc/CSBwin-src/CSBCode.cpp:670`, which also drives `scrollingText.ClockTick`, the timer
processing in `TAG01b29a`, `TenSecondUpdate` and `NinetySecondUpdate`) and
`doc/CSBwin-src/Attack.cpp:2210`. While the menu loop is running, control never returns
to `CSBCode.cpp:670`: the inner loop only does `HandleMouseEvents` + `wvbl`
(`Menu.cpp:68-98`). So the clock, the timers and the monsters are frozen as a
side-effect of the loop structure.

(The separate *freeze game* button, id 147, is a real clock stop: `d.ClockRunning = 0`,
`videoMode = VM_FROZEN`, `"GAME FROZEN"` at (81,69) fg 4 / bg 0, and
`d.PrimaryButtonList = d.Buttons17832` so only id 148 thaws it — `Mouse.cpp:1870-1912`,
`doc/PROVEN_FACTS.md` → "The freeze". It is *not* what the disk menu uses.)

Since nothing in this port can block, the loop is turned inside out exactly as
`ReIncarnate.ts` turns `_ReIncarnate` inside out: the state lives on `UIState`, the draw
runs every frame from that state, and the click handler is one iteration of the loop
body. The clock is then stopped explicitly by setting `ctx.state.paused`, which is the
honest equivalent of "the main loop is not running".

### The press animation

`Menu.cpp:100-180`, drawn straight into the screen (160 bytes/line):

1. Copy the chosen button's rectangle, then `x1 -= 3; x2 += 3; y1 -= 3; y2 += 4`.
2. Save that screen area off, `wvbl`.
3. Pass A — top edge and left edge in colour **5**, bottom edge and right edge in colour
   **0**; `VBLDelay(5)`.
4. Pass B — inner top and inner left (y1+1, x1+1) in **5**, inner right (x2-1) and inner
   bottom (y2-2) in **0**, plus an outer bottom (y2+2) and outer right (x2+3) highlight
   in colour **13**; `VBLDelay(5)`. It is painted over pass A, which stays up until the
   restore.
5. Restore the saved pixels (`x2 += 3; y2 += 3` first), restore the input state,
   `DiscardAllInput()`.

Ten VBLs is **1/6 s at 60 Hz**, which is how long the port holds it. `drawMenuPress`
(`src/renderer/ui/Menu.ts`) paints pass A alone for the first five, then pass A with pass B
over it, so the save menu, which redraws the whole screen each frame, shows what CSBWin's
screen holds. Evidence: `tools/dump-save-menu.ts`, "the press animation".


## Entering and leaving

`TAG02076e` (`doc/CSBwin-src/Character.cpp:5133`) runs *before* the menu
(`SaveGame.cpp:877`), and on the way to sleep (`Mouse.cpp:1830`), at the freeze (`:1875`)
and once a Hall of Champions candidate's inventory is shown (`Character.cpp:798`):

```c
  if (d.PartySleeping) return;
  WaitForButtonFlash();
  if (d.SelectedCharacterOrdinal)
  { if (d.DisplayResurrectChestOrScroll == 4) RepackChest(); }
  else
  { ShadeRectangleInScreen((RectPos *)d.Word28, 0); }   // movement arrows
  ShadeRectangleInScreen((RectPos *)d.Word12, 0);       // magic area
  ShadeRectangleInScreen((RectPos *)d.Word20, 0);       // weapon ready area
  SetCursorShape(0);
```

Note the either/or: an **open** inventory gets its chest repacked, a **closed** one gets
the movement arrows shaded. The repack is what puts the chest's objects in the save: an
open chest's objects are in `d.rnChestContents`, out of its chain: `ShowChestContents`
clears their links and the chest's `contents` (`Character.cpp:3093-3106`), and `RepackChest` links them
back (`:3113-3159`). `SetCursorShape(0)` clears `d.Word23146`, the object cursor,
and sets `d.CursorShape` to 0, the arrow (`CSBCode.cpp:1992-2001`), and the cursor draw
takes the arrow for both (`CSBCode.cpp:2287-2288`).

The arrow lasts only until the cursor is set from the hand again, and `TAG0207cc` is not
the only thing that does it. `RemoveObjectFromHand` calls `TAG002572` (`Mouse.cpp:637`),
and `ObjectToCursor` with its second argument 0 calls `CreateObjectCursor`
(`CSBCode.cpp:6923-6930`), which sets `d.Word23146` again (`:2005-2013`). Both run under the
Hall of Champions' `TAG02076e`, whose candidate's inventory takes clicks:
`HandleClothingClick` empties the hand with the first and fills it with
`ObjectToCursor(objD4, 0)` (`:7033-7051`), and feeding empties it with the first
(`Character.cpp:4497`). So an object taken from the candidate's inventory is on the cursor,
and the three areas stay shaded.

`TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:10058-10092`) is the mirror, called on the way out
(`SaveGame.cpp:1375`, and at `:871` after "SAVES ARE DISABLED", which skipped
`TAG02076e`), at the thaw (`Mouse.cpp:1904`), last in `WakeUp` (`CSBCode.cpp:7120`), and
by `_ResurrectReincarnateCancel` once the candidate's inventory is hidden (`:6716`,
`:6867`). The main loop's call of the pair is dead (`doc/PROVEN_FACTS.md` →
"`d.Word11722` is always zero"). Asleep it only redraws the sleep screen (`:10062-10066`). Otherwise it selects
the magic caster again through `SelectMagicCaster` with `d.MagicCaster` set to -1 first,
which refuses a dead champion (`Magic.cpp:726-727`) and so leaves none; sets
`d.Word20252 = 1`, the attack buttons, when no attack menu is open (`:10072-10075`); redraws
the legal attack types; either shuts the open inventory without a repack
(`d.SelectedCharacterOrdinal = 0`) and shows it again with `ShowHideInventory(D7W-1)`, or
redraws the viewport and movement buttons (`:10077-10088`); then `TAG002572` puts the cursor
back from the hand (`:2059-2079`).

`_ReadEntireGame` (`SaveGame.cpp:1536`), the load at the entrance, calls neither.

The port: `tag02076e` and `tag0207cc` in `src/renderer/ui/Mouse.ts`, which `SaveMenu.ts`
calls around its full screen and not its load-only one, the freeze around its frozen game,
and the sleep click before the engine's `sleep`. The engine's callers, `wakeUp` and
`HallOfChampions`, reach them through `GameHost`'s `tag02076e` and `tag0207cc`. The redraws are the frame's: `tag02076e` sets `UIState.shadedByTag02076e` and
`tag0207cc` clears it, and while it is set `GameScreen.presentViewport` shades the three
areas. The arrow is `UIState.arrowCursorShape`, which `tag02076e` sets and `tag002572` clears
(`tag0207cc`, `handleClothingClick` and the feeding call it); while it is set
`drawCursorItem` draws the arrow. No inventory is drawn while the menu is up.
Evidence: `tools/dump-save-menu.ts`, "the disk menu over an open chest";
`tools/dump-sleep.ts` and `tools/dump-hall-of-champions.ts` for the other callers, the
latter also for the candidate's object on the cursor.


## What the disk menu itself does

`_DisplayDiskMenu` (`doc/CSBwin-src/SaveGame.cpp:825`):

- `:855` `DiskMenuNeeded = false;`
- `:856-873` if saves are disabled: `DoMenu(…, "SAVES ARE DISABLED", "OK", …)` and return.
- `:889-901` the three-button menu — title2 `"READY TO SAVE GAME"`, options
  `"SAVE AND PLAY"`, `"SAVE AND QUIT"`, `"CANCEL"`, then `WaitForMenuSelect(3, 0, 0, 0)`.
- `:915` result 3 (CANCEL) jumps to the exit; otherwise `D6W = (D5W == 1)` records
  "and play" and `SelectSaveGame(0, 0, 1)` (`:920`) chooses the slot.
- `:925` `DoMenu(…, "SAVING GAME . . .", 0, …)` — a title-only menu with no buttons, left
  on screen during the write; `:926-932` rotates the `.BAK`; `:1363-1369`
  `"UNABLE TO SAVE GAME!"` + `"OK"` on failure.
- `:1346-1350` "save and quit" runs `ShowCredits`.
- `:1372-1376` the exit path: `FreeTempMemory(512); InsertDisk(…); TAG0207cc();`.

The load side is `_ReadEntireGame` (`:1536`): `DoMenu(…, "LOAD SAVED GAME", "CANCEL",
NULL, NULL, 1, 1, 1)` at `:1665` — note `I1 = ClearOldScreen = FadeOldScreen = 1`, the
centred, full-screen variant — then `WaitForMenuSelect(2, 1, 2, 1)` and
`SelectSaveGame(1, 1, 1)` at `:1688`.

### The four slots

`_SelectSaveGame` (`doc/CSBwin-src/CSBCode.cpp:9862`). The limit is literally
`char fNames[4][20]` (`:9868-9885`) holding `"  CSBGAME.DAT"`, `"  CSBGAME2.DAT"`,
`"  CSBGAME3.DAT"`, `"  CSBGAME4.DAT"` — two leading spaces reserved for a rank letter.

```c
    for (i=0; i<4; i++) {
      modifiedTime[i] = unknownTime;                 // 0xffffffffffffffff
      file = OPEN(fNames[i]+2,"rb");
      if (file >= 0) { modifiedTime[i] = MODIFIEDTIME(file); CLOSE(file); }
      else if (checkExist) strcpy(fNames[i],"   ");  // blank the whole name
    };
    for (i=0; i<4; i++) {           // four passes: repeatedly take the oldest
      j=0; for (k=1;k<4;k++) if (modifiedTime[k] < modifiedTime[j]) j = k;
      if (modifiedTime[j] != unknownTime) { fNames[j][0] = (char)('A'+i); modifiedTime[j] = unknownTime; }
    };
```

(`:9890-9924`.) So each existing file is prefixed by its recency rank — **'A' is the
oldest, 'D' the newest** — and the list *is* the four-button menu (`:9928-9940`). There is
no scrolling list widget anywhere in CSBWin, and the only per-slot information shown is
the filename and that letter. `P1` doubles as `I1`, `ClearOldScreen`, `FadeOldScreen`
*and* as the button-set selector.


## Deliberate divergences in this port

The save/load screen this port puts behind the disk icon is **not** `_DisplayDiskMenu`.
It keeps `_DoMenu`'s art, colours, text metrics and press animation, and replaces the
four-slot chooser. Recorded here so the difference is never mistaken for a porting error:

1. **An unbounded, scrolling list of saves** instead of four fixed slots. CSBWin's limit
   is a stack array and its chooser is a four-button menu; neither survives contact with
   "save as often as you like". The list has two levels: a heading for each playthrough
   (`d.RandomGameID`), the last one used first, and under it its saves, newest first,
   which a click on the heading folds away and brings back. SAVE writes over the
   selected save, as CSBWin's writes over the slot chosen; with no empty slot to choose,
   a save of its own is made from the heading of the running game's playthrough, or,
   for a game with no save yet, from a first row, "NEW SAVE", which the load-only
   chooser does not have. LOAD on a heading reads the last save used of its playthrough.
   The panel shows fifteen rows beside a scrollbar drawn after a GEM window's, in the
   dialog's two colours: a boxed arrow at each end, and a plain slider in a track
   dithered where rows lie beyond the panel. A click on an arrow scrolls a row, as the
   wheel does, and neither moves the selection.

   **The list is in a dialog of its own**, 304×184 at (8,8), not in one of `_DoMenu`'s
   four layouts of graphic 0 in the viewport's place. It is drawn from three pieces of
   that graphic, each at the size wanted by keeping its corners and repeating the column
   and the row just inside them, so no new art is invented: the grey frame (the whole
   bitmap, nine pixels kept a side), the title panel ((10,10)-(213,51), two kept) and the
   left frame of the bottom pair ((10,99)-(107,125), six columns kept a side and every
   row). Two panels, the list's and the preview's, stand over four button frames: LOAD,
   SAVE, EXPORT and CANCEL. A frame takes the rectangle CSBWin's table gives graphic 0's
   own, the frame less six pixels a side, and its label where `_DoMenu` centres one
   (`buttonRect` and `buttonLabelAt`, `src/renderer/ui/SaveMenu.ts`); a button that can
   do nothing has no label, as CSBWin's empty slot has none (`CSBCode.cpp:9896`).

   **The screen under it is cleared**, in the game too. The disk menu's `_DoMenu` gets 0
   for `ClearOldScreen` and leaves the picture around the viewport
   (`SaveGame.cpp:889-901`); the dialog would leave an 8-pixel ring of it.
2. **Per-save day, time and level, under its playthrough's party**, where CSBWin shows a
   filename and a rank letter. The rank letter is what the date replaces; the ordering
   rule within a playthrough is the same one (`modifiedTime`), only shown directly and
   newest-first rather than oldest-letter-first. **A panel beside the list previews the
   save LOAD would read**, the selected one or a heading's last save used: its
   champions' names, its level, its play time and the day and time it was saved
   (`formatSavePreview`, `src/data/saves/SaveStore.ts`). CSBWin shows nothing of a
   slot's contents.
3. **No "SAVE AND QUIT"**: a page does not quit, and loading another game's save is how a
   player leaves one (`doc/SAVES.md` → "The dialog").
4. **EXPORT**, which has no counterpart. CSBWin's saves are files of its directory,
   there to be copied; the port's are rows of the browser's IndexedDB, which nothing
   outside the page reads. EXPORT downloads the selected save's file as the store holds
   it, the bare `.dat`, which CSBWin opens (`doExport`, `src/renderer/ui/SaveMenu.ts`).
5. **An import**, which has none either: in CSBWin a file put in the game's directory
   under one of the four names is a save of that game. A file dropped on the page while
   the dialog is up, the disk menu's or the entrance's chooser, is held against the data
   set's dungeon by its walls and stored as a row (`saveMenuDrop`,
   `src/renderer/ui/SaveMenu.ts`; `GameSaves.importSave`, `src/engine/GameSaves.ts`).
   A save that is most of that dungeon and not the whole is asked about in a two-option
   `_DoMenu` menu, centred, in the dialog's place: "THIS LOOKS LIKE A SAVE FROM A
   MODIFIED VERSION OF" over the dungeon's name, with CONFIRM and CANCEL. A save of
   another dungeon, or of an unknown one, is refused in a one-option menu, under OK. A
   file that does not read is the dialog's message, CSBWin's own "SAVED GAME DAMAGED!"
   (`SaveGame.cpp:2118`).
6. **Esc and right-click cancel.** CSBWin's menus take no key at all. This is an
   addition, not a changed behaviour, as are the list's other keys (the arrows, Home
   and End, Page Up and Down, Enter for LOAD), the wheel, and a double click on a save,
   which is LOAD. The entrance's chooser takes them as the disk menu does.
7. **A question before a load or a save across playthroughs.** CSBWin's four slots are
   one directory's, and it tests `d.RandomGameID` only when a lost game is read again,
   where it refuses the save: "THAT'S NOT THE SAME GAME" (`SaveGame.cpp:1729-1731`). The
   port's list holds every playthrough of the data set, so LOAD and SAVE on a save of
   another playthrough than the running game's, and LOAD on its heading, put that line
   up as a two-option
   `_DoMenu` menu, centred, in the dialog's place, the action over CANCEL, and act on
   the first. Esc and a right-click there cancel the question alone. The load-only
   chooser never asks.
8. **No "GAME LOADED, READY TO PLAY."** After a load at the entrance, CSBWin's
   `_TAG021028` loops on that menu, PLAY GAME over ASCII DUMP (`CSBCode.cpp:10617-10639`).
   The port puts none up: a loaded game is played at once, and `AsciiDump` is unported
   (`DEBT.md` G14). What the menu did to the chooser's picture is kept, the fade to
   black and the cleared screen (`tag021028`, `src/renderer/intro/BootSequence.ts`).
9. **The dialog while saves are disabled.** After a DSA's `&DISABLESAVES`, CSBWin's disk
   menu is only "SAVES ARE DISABLED" over OK (`SaveGame.cpp:856-873`): it did nothing
   but save. The port's dialog loads and exports too, so it opens as ever with that
   line as its message, SAVE inert and unlabelled, and no "NEW SAVE" row
   (`savesDisabled`, `src/renderer/ui/SaveMenu.ts`). F5 says the same line and saves
   nothing (`GameSaves.quickSave`).

The faithful `_DoMenu` / `_WaitForMenuSelect` port lives in `src/renderer/ui/Menu.ts` and
is used unchanged for the title-only and one-button menus (`"SAVING GAME . . ."`,
`"UNABLE TO SAVE GAME!"`), and for the boot's "SAVED GAME DAMAGED!", whose `_WaitForMenuSelect`
runs on the intro host (`waitForMenuSelect`, `src/renderer/intro/BootSequence.ts`). The
extension lives in `src/renderer/ui/SaveMenu.ts`.
