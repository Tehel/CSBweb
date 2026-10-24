# CSBWin Title Screen / Dungeon Entrance Reference (Sourced)

Everything before the party is in the dungeon: the title animation, the entrance screen with
its three buttons, the door-opening animation, the credits scroll and the "Resume" path. And
the end of the game, `_ShowCredits`, which draws through the same hardware.
Every line number is `doc/CSBwin-src/<File>.cpp:<line>`. Rectangle and button values marked
**(from data)** were printed by `tools/checks/intro.ts`, which asserts them on every run.

The port is `src/renderer/intro/`: `IntroHost.ts` (the hardware these screens talk to),
`TitleSequence.ts`, `PrisonDoor.ts`, `PrisonLevel.ts`, `ShowCredits.ts` and `BootSequence.ts`
(the wiring).


## The startup chain

`UIM_INITIALIZE` (`CSBUI.cpp:928`) pushes `st_AskWhatToDo` onto the dispatcher stack. Every
function below is a `RESTARTABLE` coroutine: `RESTARTMAP` / `RESTART(n)` are resume points,
so all of their locals are `static`. An `await host.vbl(n)` in this port is the same
suspension point, which is why the three screens are `async`.

```
_AskWhatToDo                  CSBCode.cpp:11573
 ├ init: Cleanup, d.Initialize, CountFloppyDrives, InitializeHeap,
 │       ReadGraphicsIndex, ReadTablesFromGraphicsFile
 ├ _DisplayChaosStrikesBack   CSBCode.cpp:9308    the title animation
 ├ ReadFloorAndCeilingBitmaps(0) / ReadWallBitmaps(0)
 └ DoMenu QUIT / DUNGEON / UTILITY / HINT        :11613
    └ "DUNGEON" → do { _StartCSB } while (RepeatGame)
       └ _StartCSB            CSBCode.cpp:11525
          ├ _ShowPrisonDoor   CSBCode.cpp:10780
          │   ├ _GameSetup(1) CSBCode.cpp:10713
          │   │   ├ _TAG01f746  :9577             the entrance screen
          │   │   │   ├ _TAG01f5ea   :9667        draws it
          │   │   │   ├ _TAG01f928   :9753        the credits scroll
          │   │   │   └ _OpenPrisonDoors :9485    the doors
          │   │   └ _ReadEntireGame  SaveGame.cpp:1536
          │   └ _TAG021028    CSBCode.cpp:10584   hand-off to the adventure UI
          └ _MainLoop         CSBCode.cpp:596
```

**Not ported: the launcher menu.** CSBWin needs `QUIT / DUNGEON / UTILITY / HINT` because one
binary runs three programs. This one runs the dungeon.

**A second copy of the title animation is dead code.** `_GameSetup:10604` has
`//DisplayChaosStrikesBack(_1_);` commented out, so it plays once per program run from
`_AskWhatToDo`, not again between games.


## The graphics

| item | pointer (`Data.h:255-275`) | what it is | DM size |
| --- | --- | --- | --- |
| 1 | (temporary) | the title screen, three bands in one 320×200 image | 3697 |
| 2 | `d.Pointer22952[0]` | prison door, **left** half, 128×161 | 2682 |
| 3 | `d.Pointer22952[4]` | prison door, **right** half, 128×161 | 2741 |
| 4 | `d.Pointer22956` | "Prison entrance minus door", 320×200 | 9845 |
| 5 | `d.Pointer22960` | the credits scroll, 320×200 | 6144 |
| 534 | `d.Pointer22968` | the latch click | 39 |
| 535 | `d.Pointer22964` | the door grind | 854 |

Graphic 1's three bands, and the rectangles that cut them out:

| rows | band | rectangle |
| --- | --- | --- |
| 0..79 | the "Dungeon" logo | the `ShrinkBLT` source |
| 80..136 | the "Master" script | `Word44` stashes it, `Word36` places it |
| 137..152 | the word "Presents" | `Word52` |

The labels on the entrance screen — ENTER, RESUME — and the little scroll at the bottom
right are **painted into graphic 4**. Nothing is drawn as text at runtime.


## The rectangles, `graphics.dat` item 0x232

**(from data)**, inclusive coordinates, width `x2-x1+1`:

| field | x1 | x2 | y1 | y2 | size | used by |
| --- | --- | --- | --- | --- | --- | --- |
| `Word36` | 0 | 319 | 118 | 174 | 320×57 | "Master", final position |
| `Word44` | 0 | 319 | 0 | 56 | 320×57 | "Master", stashed |
| `Word52` | 0 | 319 | 90 | 105 | 320×16 | "Presents" |
| `Word60` | 0 | 223 | 3 | 138 | 224×136 | the viewport into the door buffer |
| `Word68` | 0 | 100 | 0 | 160 | 101×161 | the left door, sliding |
| `Word76` | 109 | 231 | 0 | 160 | 123×161 | the right door, sliding |
| `Word84` | 0 | 231 | 0 | 160 | 232×161 | the entrance interior, saved |
| `Word92` | 0 | 104 | 30 | 190 | 105×161 | the left door, static |
| `Word100` | 105 | 231 | 30 | 190 | 127×161 | the right door, static |
| `Word108` | 120 | 199 | 95 | 108 | 80×14 | "THE END", graphic 6 |

They are the last 136 bytes of a 1826-byte item and they are read by a parser that walks the
whole thing field by field, so `tools/checks/intro.ts` checks each one against something
CSBWin states independently: `Word84` against `allocateMemory(20608,0)` at `:9603`, `Word60`
against the `SrcByteWidth` of 112 at `:9521`, `Word44` against `pGraphic += 9120; // =57*160`
at `:9376`, and `Word92`/`Word100` against each other tiling 0..231 with no seam.
`tools/checks/show-credits.ts` checks `Word108` against graphic 6, 80×14: the 40-byte source
width of `BLT2Screen(…, d.Word108, 40, -1)` and the 560 bytes `A3` skips past it
(`Code1f9e6.cpp:136`, `:229`).

Note `Word84`, `Word100` and `Word76` all reach **x = 231**, eight columns past the 224-wide
viewport. The door art and the interior save therefore cover a sliver of wall to the right of
the opening; the engraved button panels proper (`Word12`, `Word20`, `Word28`, all
`x 224..319`) are only untouched from x = 232 on.

Two palettes come out of the same item: `Palette360` for the entrance, `Palette328` for the
credits. A third, `d.Palette11914`, is what every screen here fades *out* to — and nothing in
the whole CSBWin tree ever writes it. Its only references are its declaration at `Data.h:883`
and five `FadeToPalette` reads, and `d` is a zero-initialised global, so **`Palette11914` is
black**.


## `_FadeToPalette` — Graphics.cpp:1625

Eight vertical blanks; on each one every colour register steps at most one unit closer to the
target in each of its three 3-bit components:

```c
  for (D4W=0; D4W<8; D4W++)
  {
    wvbl(_1_);
    display();
    for (D5W=0; D5W<16; D5W++)
    {
      D7W = pPalette[D5W];   D6W = P1->color[D5W];
      D0W = D7UW & 7;        D1W = D6UW & 7;
      if (D0W > D1W) D7W--;  if (D1W > D0W) D7W++;
      …same for &0x70 and &0x700…
    };
  };
```

Always exactly eight, and eight is always enough: no 3-bit component can be further than 7
away. That is why one fixed loop serves "fade to black", "fade up" and the bare
`FadeToPalette(_7_)` at `:9448` whose comment is *"Just delay."*


## The title animation — `_DisplayChaosStrikesBack`, CSBCode.cpp:9308

CSBWin's name is Chaos Strikes Back's, because that is the game it was disassembled from. The
routine belongs to the shared engine and is driven entirely by graphic 1 and the 0x232
rectangles, so with Dungeon Master's data it plays **Dungeon Master's** title.

1. `:9350` — all sixteen registers to `0x002`, fade, clear the screen.
2. `:9354` — blit "Presents" from graphic 1 row 137 into `Word52`; set colour 15 to `0x777`;
   `videoMode = VM_PRESENTS` (`:9365`); fade. The word appears.
3. `:9367` — stash rows 80..136 (`Word44`) for later.
4. `:9382` — build **eighteen** pre-shrunk copies of the 320×80 logo:
   ```c
   for (D7W=0, width=48, height=12; D7W<18; D7W++, width+=16, height+=4)
   {
     ShrinkBLT((ui8 *)A3, LOCAL_88[D7W], 320, 80, width, height, d.IdentityColorMap);
     left = (320-width)/2;  top = (160 - height)/2;   // note 160, not 200
   };
   ```
   Sizes 48×12 … 320×80; the last lands at y 40..119.
5. `:9430` — colour 15 back to `0x002`; "Presents" fades out.
6. `:9439` — the logo palette: `[3]=0x541 [4]=0x421 [5]=0x651 [6]=0x531 [8]=0x772 [15]=0x700`,
   with `[10]` and `[12]` held at `0x002` so "Master" stays invisible. Fade, as a delay.
7. `:9449` — the zoom: eighteen frames, `VBLDelay(2)` each, alternating two video buffers.
   Both buffers were cleared once and never again, which is safe only because each frame
   strictly covers the one two steps back.
8. `:9465` — "Master" onto the visible buffer at `Word36`, transparent colour 0; then
   `[10]=0` (black print) and `[12]=0x700` (red), fade, `VBLDelay(20)`.

Total ≈ 5×8 + 18×3 + 30 ≈ 116 vertical blanks, near enough two seconds.

**Guard not ported:** `:9327` `if (d.iAvailableMemory < 138060) RETURN;` silently skips the
whole sequence on a machine that cannot spare 133 KB for the frames.

### A thumbnail in place of the animation (the port's, not CSBWin's)

A set whose author checked "As the title" on the form that adds it (`DataSet.thumbnailAsTitle`,
`src/ui/addDataSetForm.ts`) shows its thumbnail, `<id>-thumbnail.png` or a local record's image,
where the animation would play (`src/renderer/intro/TitlePicture.ts`). CSBWin cannot: it always
plays the animation above, from graphic 1, through registers its code sets. Nothing goes in
`DEBT.md` H, as with the thumbnail itself: CSBWin plays its animation for such a set.

- **The reduction** (`reduceTitlePicture`): the 320x200 image, a pixel short of opaque taken
  over black, cut by median cut into at most sixteen boxes, the box of the widest channel
  cut first, at its pixels' median. Each box's register is its mean colour, each component the
  nearest of the Atari's eight levels shown x36 (`atariToRGB`); each pixel takes the register
  nearest its colour as the canvas shows it. No dithering. The page reads the image without
  colour management (`createImageBitmap`, `colorSpaceConversion: 'none'`), so a PNG gives
  every player the same screen, the tool's (`tools/checks/title-picture.ts`, the Theron cover
  pinned).
- **The showing** (`showTitlePicture`): a fade to black, as the animation's first; the picture
  put up under black registers; `_FadeToPalette` to its registers (eight VBLs, which from black
  reach any shade); `TITLE_PICTURE_HOLD_VBLS`, 90, the author's choice; a fade to black, and the
  screen cleared. 114 VBLs in all (`tools/checks/intro.ts`).
- The FTL logo before it is untouched, and the startup animations setting turns both off. A
  set without a thumbnail, or with one of another size than 320x200 (an older record's), plays
  the animation. The welcome page goes on showing the thumbnail in full colour.

### `ShrinkBLT` — Graphics.cpp:381

A nearest-neighbour minifier walking the source with a 16.16 fixed-point accumulator:

```c
  D1L = srcWidth<<10;  D1L = (D1UL/D3UW) & 0xffff;  D1L <<= 6;  A2 = D1L;  // the step
  D1UL >>= 1;  D1L += 0x7fff;  LOCAL_8 = D1L;                              // the start
```

So `step = ((srcW*1024 / dstW) & 0xffff) << 6` and `srcIndex(i) = (start + i*step) >> 16`,
same for the rows. The truncation to sixteen bits before the shift is transcribed, not
tidied: which source column each of 48 destination columns lands on is visible at that scale.
`d.IdentityColorMap` makes the per-pixel colour map a no-op.


## The entrance screen — `_TAG01f746`, CSBCode.cpp:9577

### Setup, `:9592-9639`

```c
  d.PrimaryButtonList = d.Buttons16932;
  d.SecondaryButtonList = NULL;  d.pKeyXlate2 = NULL;  d.pKeyXlate1 = NULL;
  for (D7W=0; D7W<8; D7W++) d.Pointer22952[D7W] = allocateMemory(10304, 0);
  d.Pointer22920 = allocateMemory(20608,0);   // the pristine interior
  d.Pointer22916 = allocateMemory(20608,0);   // the animation's working buffer
```

`d.Pointer22952` is an array of eight pointers (`Data.h:267-275`). Slots **0..3** hold the
left half at sub-word shifts of 0/4/8/12 pixels, **4..7** the right half — so the animation
only ever blits whole 16-pixel words, with the `D7W & 3` slot supplying the sub-word part
and the source x offset the rest.

The right half's slots are redundant: slot `n+4` holds the door shifted right by `4n` and the
animation then reads it from `4n` in, which cancels. All of its motion comes from `Word76.x1`
walking right. The port transcribes it anyway rather than simplify, to stay greppable.

### Drawing — `_TAG01f5ea`, CSBCode.cpp:9667

```c
  d.partyLevel = 255;  d.Word11684 = 1;  d.width = 5;  d.height = 5;
  d.LevelCellFlags = LOCAL_128;  d.pCurLevelDesc = &LOCAL_170;   // a static, zeroed LEVELDESC
  fillWithByte((ui8 *)LOCAL_154[0], 25, 0, 1);
  for (D7W=0; D7W<5; D7W++) { LOCAL_128[D7W] = LOCAL_154[0]+5*D7W; LOCAL_154[2][D7W] = 32; };
  LOCAL_154[1][2] = 32;
  FadeToPalette(_1_,&d.Palette11914);       // to black
  videoMode = VM_PRISONDOOR;
  ExpandGraphic((i8 *)d.Pointer22956, d.LogicalScreenBase, 0, 0);   // graphic 4
  DrawViewport(2, 2, 0); //facing south, x=2; y=0.
  d.ViewportUpdated = 0;  d.UseByteCoordinates = 0;
  TAG0088b2(d.LogicalScreenBase, d.Pointer22920, d.Word84, 0, 30, 160, 128, -1);
  BLT2Screen(d.Pointer22952[0], (RectPos *)d.Word92, 64, -1);   // left half
  BLT2Screen(d.Pointer22952[4], (RectPos *)d.Word100, 64, -1);   // right half
  FadeToPalette(_2_,&d.Palette360);
```

**The corridor behind the doors is not a painting.** It is the real viewport renderer over a
synthetic level. `LOCAL_154` is indexed `[x][y]`, cell flags are `[roomType:3][hasObjects:1]
[attributes:4]`, and 32 is `0x20` — room type 1, `OPEN`. So:

```
x→   0   1   2   3   4
y=0  .   .   O   .   .
y=1  .   .   O   .   .
y=2  .   O   O   .   .
y=3  .   .   O   .   .
y=4  .   .   O   .   .
```

a north-south corridor at x=2 with one opening off it at (1,2). `DrawViewport(facing, x, y)`
(`Viewport.cpp:6701`) puts the party at (2,0) facing south, so the opening is on its right,
two cells ahead. No cell has the `hasObjects` bit, so `SummarizeRoomInfo` never walks an
object chain.

The zeroed `LEVELDESC` is what makes the rest work: wall style 0, floor/ceiling style 0, no
wall decorations, no doors — matching the bitmaps `_GameSetup` loaded at `:10730-10731`.

`d.partyLevel = 255` also reaches `DrawViewport`'s tail: `MarkViewportUpdated((d.partyLevel!=255)?1:0)`
at `Viewport.cpp:7176` forces the VBL copy of `d.pViewportBMP` to the screen straight away,
and skips the `FloorAndCeilingOnly()` repaint. That is why the `Word84` save, taken from the
*screen*, already contains the corridor.

### The buttons — `d.Buttons16932`

`Data.h:726` declares `btn Buttons16932[4]`, the last 48 bytes of `graphics.dat` item 0x231.
Dungeon Master's item 0x231 is 0x7d4 bytes and stops exactly 48 short, so
`ReadTablesFromGraphicsFile` patches in a hardcoded copy (`CSBCode.cpp:10268-10281`):

```c
  btn missingButtons[4] =
  {
    {0x00c8,0x00f4,0x012a,0x002d,0x003a,0x0002},
    {0x00c9,0x00f4,0x012a,0x004c,0x005d,0x0002},
    {0x00ca,0x00f8,0x0125,0x00bb,0x00c7,0x0002},
    {0x0000,0x0000,0x0000,0x0000,0x0000,0x0000}
  };
  ASSERT((d.GraphicDecompressedSizes[0x231] == 0x804)
      || (d.GraphicDecompressedSizes[0x231] == 0x7d4), "graphicSize231");
  if (d.GraphicDecompressedSizes[0x231] == 0x7d4) { d.Buttons16932[0] = missingButtons[0]; … };
```

DM's `graphics.dat` takes that branch: `extractUITables` returns an empty `buttons16932`
under exactly the same condition and `MISSING_PRISON_DOOR_BUTTONS`
(`src/renderer/intro/PrisonDoor.ts`) stands in. Chaos Strikes Back's item 0x231 is the
0x804-byte form, and its last 48 bytes are those four buttons word for word, which
`extractUITables` reads (`tools/checks/data-sets.ts`, `doc/PROVEN_FACTS.md`).

**(from data)** — `struct btn` is `{ i16 word0; i16 xMin, xMax, yMin, yMax; i16 button; }`
(`CSB.h:1662`), and the mask is `2 = left, 1 = right`:

| id | rect | mask | meaning |
| --- | --- | --- | --- |
| 200 | x 244..298, y 45..58 | left | enter the dungeon |
| 201 | x 244..298, y 76..93 | left | resume a saved game |
| 202 | x 248..293, y 187..199 | left | the scroll → credits |
| 0 | — | — | terminator |

Hit-testing is **half-open on the maxima** (`SearchButtonList`, `CSBCode.cpp:7621`):
`x < xMax && x >= xMin && y >= yMin && y < yMax`. `searchButtonList`
(`src/renderer/ui/HitTest.ts`) already does this.

`d.gameState` (`CSB.h:39-42`): `ResumeSavedGame = 0`, `EnterPrison = 1`, `AtPrisonDoor = 99`,
`GAMESTATE_202 = 202`. The handlers are `Mouse.cpp:1913-1930`: 200 and 201 only set
`d.gameState`, which breaks the inner loop; 202 runs the credits in place and leaves
`GAMESTATE_202`, which the outer loop uses to redraw the entrance.

**The port's fourth button, RISE** (`RISE_BUTTON`, `src/renderer/intro/PrisonDoor.ts`), is
not CSBWin's: it is the UTILITY's "MAKE NEW ADVENTURE" brought to the entrance of a data
set with a `mini.dat`, CSB's (`doc/SAVES.md` → "RISE makes a save of its own"). Id 0xcb, x 247..301, y 163..180, left, put
before the list's terminator; it sets a `d.gameState` of the port's own, 203, and goes on
as RESUME does, the doors shut. Its picture is carved into a copy of graphic 4: RESUME's
gem (14x14 at (243,78)) and the 7x8 cells of PRISON's R, I, S and RESUME's first E, each
without the panels' bare stone (colour 10), with the gem at (246,165) and the letters as
RESUME's stand to its gem. Its rectangle stands to its gem as RESUME's does
(`tools/checks/rise.ts`).

### The loop, `:9641-9664`

```c
  do
  {
    TAG01f5ea(_1_);
    STShowCursor(HC50);  UI_BeginRecordOK(true);  DiscardAllInput();
    d.gameState = GAMESTATE_AtPrisonDoor;
    do
    {
      wvbl(_2_);
      do { HandleMouseEvents(_4_,0); } while (intResult & 1);
      if (DiskMenuNeeded) DisplayDiskMenu(_6_);
    } while (d.gameState == GAMESTATE_AtPrisonDoor);
  } while (d.gameState == GAMESTATE_202);
  UI_BeginRecordOK(false);
  StartSound(d.Pointer22968, 112, 1);   // the latch
  VBLDelay(_3_,20);
  STHideCursor(HC33);
  if (d.gameState != GAMESTATE_ResumeSavedGame) OpenPrisonDoors(_5_);
```

**`DiskMenuNeeded` is not ported.** Only button 140 sets it, that button is not in
`Buttons16932`, and it additionally demands `d.NumCharacter > 0` (`Mouse.cpp:1852-1867`). It
is unreachable from this screen.

The latch click and the twenty-blank pause happen on both paths; **the doors only open on a
fresh game.**


## The mouse pointer

`_TAG01f746` shows it right after the screen is drawn (`:9643` `STShowCursor(HC50)`) and
hides it again before the doors move (`:9660` `STHideCursor(HC33)`); `_TAG01f928` hides it on
the way into the credits (`:9762` `STHideCursor(HC34)`) and the outer loop shows it again when
it redraws. `_ReadEntireGame` shows it before the file chooser (`SaveGame.cpp:1687`). The
title animation never touches it, so it stays hidden from boot.

**There is no recolouring anywhere.** `CreateCursorBitmap` picks `A3 = d.Byte1222`, the arrow
(`CSBCode.cpp:2267`), and blits it as it stands; the hand at `d.Byte1350` only replaces it
when `d.CursorShape != 0`, which means an object is on the cursor (`:2288`). The arrow is
sixteen rows of four bitplane words — 128 bytes at the end of item 0x232, right after the two
16-byte colour maps `CreateObjectCursor` uses for the *object* cursor — and it is drawn in
just two colours:

```
00..............      0  = the outline
040.............      4  = the body
0440............      .  = colour 12, transparent (`Flood(d.CursorBitmap, 12, …)`, `:2307`)
04440...........
```

So the screen's palette decides what colour it is. Index 4 is `0x654` under the entrance's
`Palette360` — the beige of the stonework around the buttons — and `0x066` under the
adventure palette. Same bitmap, different screen.

The hot spot is the top-left corner: `d.Word23156` and `d.Word23158`, the offsets
`DrawCursor` subtracts (`:2450`, `:2469`), are both 0 for the arrow (`:2293-2294`) and
become 8 for the object cursor (`:2327-2328`).

`DrawCursor` and `RemoveCursor` (`:2432`, `:2231`) run from the VBL handler and bracket each
other: the cursor is composited over the frame and lifted again, so it is never part of the
picture. `withCursor` (`src/renderer/intro/IntroHost.ts`) is that pair. The one addition this
port needs is a repaint on mouse movement — CSBWin gets one free from the 60 Hz interrupt,
and the entrance screen is otherwise completely static between clicks.


## The door animation — `_OpenPrisonDoors`, CSBCode.cpp:9485

Thirty-one frames, six vertical blanks each (≈3.1 s), four pixels of travel per frame.

```c
  LOCAL_4 = d.LogicalScreenBase + 4800;      // = screen row 30
  LOCAL_8 = (ui8 *)pntGear((pnt)A3 + 36);    // d.Pointer22916, the working buffer
  for (D7W = 1; D7W != 32; D7W++)
  {
    if ((D7W % 3) ==1)
    {
      while (CheckSoundQueue()) wvbl(_2_);
      StartSound(d.Pointer22964, 145, 1);    // graphic 535
    };
    MemMove(pntGear(A3+32), pntGear(A3+36), 20608);              // restore the interior
    TAG0088b2(d.pViewportBMP, pntGear(A3+36), d.Word60, 0,0, 112,128, -1);
    if (((RectPos *)d.Word68)->w.x2 >= 0)
    {
      TAG0088b2(A3[D7W&3], pntGear(A3+36), d.Word68, (D7W&0xfc)*4, 0, 64,128, -1);
      ((RectPos *)d.Word68)->w.x2 -= 4;
    };
    TAG0088b2(A3[(D7W&3)+4], pntGear(A3+36), d.Word76, (D7W&3)*4, 0, 64,128, -1);
    ((RectPos *)d.Word76)->w.x1 += 4;
    for (i=0; i<6; i++) { CheckSoundQueue(); wvbl(_1_); };
    …copy 232×161 from the working buffer to the screen at row 30…
  };
```

- **Sound:** graphic 535 on frames where `D7W % 3 == 1` — 1, 4, 7 … 31, eleven plays.
- **The left half's travel** is `4*D7W`: the slot supplies 0/4/8/12 and `(D7W & 0xfc)*4` the
  multiples of sixteen. Its rectangle's `x2` shrinks by 4 a frame and goes negative at frame
  27, after which the guard stops drawing it — by then it is off the screen anyway.
- **The right half** reaches `x1 = 229` on the last frame while its rectangle ends at 231, so
  it stops with a **three-column sliver** still showing at the frame edge. That is the
  original's behaviour, not a rounding error here.
- **`d.Word68` and `d.Word76` are mutated in place** and never restored — only the next
  `ReadTablesFromGraphicsFile` puts them back. This port walks local copies instead: the
  doors open once per run, so the two are equivalent, and a table the parser owns should not
  be edited.


## The credits scroll — `_TAG01f928`, CSBCode.cpp:9753

Not `_ShowCredits`. That one (`Code1f9e6.cpp:66`, *"The game is lost! Or won!!!"*) is the
end-of-game sequence, reached from `CSBCode.cpp:11560`, `:641` and SaveGame.cpp's "SAVE AND
QUIT". The entrance scroll is its own function and is a still picture and a wait:

```c
  STHideCursor(HC34);
  FadeToPalette(_1_,&d.Palette11914);
  ExpandGraphic((i8 *)d.Pointer22960, d.LogicalScreenBase, 0, 0);   // graphic 5
  videoMode = VM_CREDITS;
  FadeToPalette(_2_,&d.Palette328);
  do
  {
    wvbl(_3_);
    D0W = --LOCAL_2;
    if (D0W == 0) break;
    if (d.MouseSwitches != 0) break;
  } while (UI_CONSTAT()==0);
  d.gameState = GAMESTATE_202;
```

`LOCAL_2` is a function-static initialised to 0 and never reset, so the counter runs 65535
vertical blanks — about eighteen minutes — the first time and picks up where it left off on
any later visit. That is almost certainly an artifact of the coroutine rewrite rather than the
68000 original, and it is unreachable in practice. **This port waits for the click or key and
does not keep the counter.**


## The credits bitmap needed a codec fix

Graphic 5 is the only image in either data set that uses opcode `0xA`, and the decoder this
project had — written from the dmweb.free.fr format notes rather than from `ExpandGraphic` —
read it as "add (nib2+1) transparent pixels" without even consuming its count byte. CSBWin
has a plain colour run there. The scroll came out sliding right from (78,55) on, wrapping at
the bottom. `0xE` and `0xD` were wrong in the same way and are used only by the *tables*
0x22e..0x232, which are never decoded as images.

`src/core/imageDecoder.ts` is now a transcription of `CSBCode.cpp:10961` and carries the
opcode table; `tools/checks/image-codec.ts` holds graphic 5 up against
`tools/reference/csbwin-credits.png`, a capture of CSBWin's own screen.


## "Resume" — SaveGame.cpp:1536

Button 201 sets `d.gameState = GAMESTATE_ResumeSavedGame`; `_TAG01f746` exits without opening
the doors, and `_GameSetup` runs its retry loop:

```c
  for (;;)
  {
    ReadEntireGame(_4_);
    SmartDiscard(true);
    if (i16Result == 1) break;
    openGraphicsFile();
    TAG01f746(_1_);            // a failed or cancelled load puts the entrance back up
  };
```

`_ReadEntireGame` skips `dungeon.dat` entirely on this path (`:1574`) and goes **straight to
the file chooser** — there is no "READY TO SAVE GAME" menu first, unlike the in-game disk
icon. It calls `SelectSaveGame(_9_, 1, 1, 1)` (`:1688`), against the disk icon's
`SelectSaveGame(_5_, 0, 0, 1)` (`:920`):

| | entrance "Resume" | in-game disk icon |
| --- | --- | --- |
| preceding menu | none | `SAVE AND PLAY / SAVE AND QUIT / CANCEL` |
| `P1` | 1 → `_DoMenu`'s `FadeOldScreen` + `ClearOldScreen`, so the chooser is on **black** | 0 → overlays the live game screen |
| `checkExist` | 1 → a slot with no file behind it has its name blanked to `"   "` and cannot be chosen (`CSBCode.cpp:9904`) | 0 → all four always shown, a new file may be created |
| `disableSaves` | not consulted | short-circuits to `"SAVES ARE DISABLED"` |

This port reaches the same place through `openSaveMenu(ui, 'loadOnly')` — the same unbounded
list as the disk icon, with no SAVE button — drawn on a cleared screen by
`GameScreen.drawDialogOnly`, the cursor over every redraw of it. Cancelling puts the entrance back up, as the retry
loop does. A save that fails its read closes the chooser and goes to `tag01efee`: "SAVED
GAME DAMAGED!", then the entrance after a lost game, or the title at the boot, where CSBWin
ends (`doc/PROVEN_FACTS.md` → "A failed read ends at `tag01efee`"). The four fixed slots, the recency letters and this port's other divergences from
them are in `doc/CSBWIN_MENU_REFERENCE.md`.

RISE reaches the same chooser in its `rise` mode, over every data set's saves, and its LOAD
makes a new adventure from the save chosen and reads that; a refusal is the utility's
message in a one-button menu, then the entrance (`doc/SAVES.md` → "RISE makes a save of its
own").

A load ends the chooser with `STHideCursor(HC33)` (`SaveGame.cpp:1689`), and `_GameSetup`
returns into `_TAG021028` (`CSBCode.cpp:10801`), the hand-off to the adventure. With
`d.gameState` still `GAMESTATE_ResumeSavedGame` it first loops on a menu
(`CSBCode.cpp:10617-10639`):

```c
    for (;;)
    {
      DoMenu(_6_, NULL, "GAME LOADED, READY TO PLAY.", "PLAY GAME", "ASCII DUMP",
             NULL, NULL, 1, 1, 1);
      STShowCursor(HC33);
      WaitForMenuSelect(_2_, 2,1,0,0);
      STHideCursor(HC33);
      if (i16Result == 1) break;
      AsciiDump();
    } ;
```

then `wvbl(_4_)` and a cleared screen (`:10659-10660`) before the adventure's palette and
first frame. The restart after a lost game calls `_TAG021028` too (`Code1f9e6.cpp:318`), so
its chooser ends in the same menu. `DoMenu`'s three 1s are the chooser's own: a fade to black,
a cleared screen, the menu centred at (47, 33), and a fade up to `d.Palette11978`
(`doc/CSBWIN_MENU_REFERENCE.md`).

**The port puts no menu up**: a loaded game is played at once, a deliberate divergence
(`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port"), and `AsciiDump`
is unported (`DEBT.md` G14). `tag021028` in `src/renderer/intro/BootSequence.ts`, after
`showPrisonDoor` and after the restart's chooser, on the intro host, keeps the rest: the
fade to black and the cleared screen that `DoMenu` gave the chooser's picture, then
`wvbl(_4_)` and the cleared screen. Evidence: `tools/checks/bad-saved-game.ts`, "a save
read" (one fade, four VBLs, no wait for a click), and the golden frame
`tools/frames/12-game-loaded.png`, the loaded game's first view, a click on LOAD after
the entrance.

The chooser closes once the save is read, after the click, so the port's wait for input also
ends when it closes, and the chooser's last picture stays up for that fade.

One CSBWin behaviour deliberately not reproduced: choosing an empty slot there falls back to
`DUNGEON.FTL` and sets `GAMESTATE_EnterPrison` (`SaveGame.cpp:1697-1711`), so "Resume" on
nothing silently starts a new game. An unbounded list has no empty slots to choose.


## The two sound pitches

`StartSound(d.Pointer22964, 145, 1)` for the doors and `StartSound(d.Pointer22968, 112, 1)`
for the latch. CSBWin **drops** that middle argument —

```c
void StartSound(ui8 *SoundBytes, i32 /*timerData*/, i32 highVolume)   // Sound.cpp:652
```

— and hard-codes 6000 Hz in `SoundDecode` (`Sound.cpp:298`). This port does not: see
`doc/PROVEN_FACTS.md` → "The Timer-A values in `StartSound` are the sample rates".


## The end of the game — `_ShowCredits`, Code1f9e6.cpp:66

`_ShowCredits(P1)` is reached three ways: `_StartCSB` once `MainLoop` has returned, with
`d.GameIsLost` (`CSBCode.cpp:11557-11561`); `MainLoop` itself when `ProcessTimers` reports the
CSB win (`:636-643`); and "SAVE AND QUIT" with `P1 = 0` (`SaveGame.cpp:1350`). `_FusionSequence`
ends in it too (`Attack.cpp:2431`). The port has the first two
(`src/renderer/intro/ShowCredits.ts`, `Game.gameTick`) and the fusion's
(`AttackSystem.fusionSequence`); it has no "SAVE AND QUIT"
(`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port").

**The tick of death.** `KillCharacter` sets `d.GameIsLost` (`Character.cpp:2685`). The tick
has run its timers; at `tag000730` it runs `WaitForButtonFlash`, `StartQueuedSound` and
`DisplayCharacterDamage`, and then `if (d.GameIsLost == 0)` (`CSBCode.cpp:668`) guards the
whole rest of the loop — `d.Time++`, the periodic updates, the mouse queue — so `MainLoop`
returns (`:787-788`). A death between ticks, from a mouse handler, waits for the next tick,
which runs its timers and ends the same way.

**The lost game, `P1 = 1`, `d.Word11694 = 0`:**

1. `SetCursorShape(0)`, `STHideCursor(HC50)`, and both button lists and both key tables
   emptied (`:116-121`).
2. `QueueSound(6, d.partyX, d.partyY, 0)`, the dying sound, and `VBLDelay(240)` (`:126-127`).
3. Graphics 6 (80×14, "THE END") and 5 (the credits picture, read compressed as `0x8005` and
   expanded later) are read (`Code1f9e6.cpp:132-145`).
4. `d.DynamicPaletteSwitching` is 0, so `FadeToPalette(Palette11914)` — to black — rather
   than the `Darken` steps (`:148-170`). It is 0 because `_StartCSB` cleared it, and the VBL
   that could restore it from `d.Word11740` does so only while `d.ViewportUpdated` is set
   (`CSBCode.cpp:916-919`), which `MarkViewportUpdated` has already consumed by calling
   `vblInterrupt()` itself (`:2972-2973`, `:1016-1020`; the `d.Word23138` guard around that
   block at `:934` is set only for an instant inside `STHideCursor`, `Mouse.cpp:1987-1996`).
   The fade starts from
   `globalPalette`, which the VBL had kept equal to `d.Palette11978`
   (`WinScreen.cpp:1493-1498`), that is `d.Palette552[0]` (`CSBCode.cpp:10747`).
5. `tag01fd10`: the screen cleared, graphic 6 blitted to `d.Word108`, and a palette of sixteen
   `0x002` (`fillMemory(&LOCAL_110, 16, 2, 2)`) with colour 15 at `0x777` faded up; then
   `VBLDelay(300)`, the first time only (`LOCAL_132`) (`:227-238`).
6. With `d.CanRestartFromSavegame` set, the "RESTART THIS GAME" button (`:240-282`).
   `d.CanRestartFromSavegame` is set by a save (`SaveGame.cpp:1358`) and a load (`:2087`),
   and cleared by a new game (`:1594`) and the two wins. The frame `d.Word116` is filled
   with colour 1 and, a VBL later, the face `d.Word124` with 0 and
   `TextOutToScreen(110, 0x9a, 4, 0, "RESTART THIS GAME")`; `LOCAL_46` gets colour 1 at
   `0x437` and 4 at `0x777`, and the fade to it shows the button. `d.Buttons16956[0]` is
   rewritten as button `0xd7` over `(0x67, 0x91)-(0xd9, 0x9f)`, `d.Word116` exactly, and
   keeps its left-button mask. Then up to 899 VBLs (`for (D7W=900; --D7W!=0 && …)`) of
   `HandleMouseEvents`, whose button `0xd7` sets `d.PartyHasDied` (`Mouse.cpp:1937`). A
   key pressed meanwhile is not read, and ends the credits wait of step 7 after one VBL.
   Pressed (`:283-322`): the fade to `LOCAL_110`, the screen cleared, the fade to
   `d.Palette552[0]`, then `Cleanup(false)` and `d.Initialize()`, which clear the whole of
   `d`, and `GameSetup(_25_, 0)`. With `d.gameState` zeroed, `GAMESTATE_ResumeSavedGame`,
   its `ReadEntireGame` is the save chooser; a cancel puts the entrance up, and its
   "enter" reads `dungeon.dat` through the same `_ReadEntireGame`
   (`CSBCode.cpp:10758-10765`, `SaveGame.cpp:1579-1594`). `ShowCredits` then returns, and
   `_StartCSB` runs `MainLoop` again (`CSBCode.cpp:11555-11562`). The port runs the
   chooser and the entrance over the end screen's host, then `showEndOfGame`
   (`src/renderer/intro/EndOfGame.ts`) reads a new game with `Game.readNewGame` if the entrance was entered,
   puts the screen's play state back (`GameScreen.initializePlayState`) and starts the
   loop. Otherwise, after 899 VBLs, the fade to `LOCAL_110`, the dark blue (`:326`).
7. Graphic 5 over the whole screen, faded to `d.Palette328`, and a wait of one VBL a poll
   until a button is held (`d.MouseSwitches`) or a key waits (`UI_CONSTAT()`) (`:328-337`).
   Unlike the entrance's scroll, this loop has no counter to run out.
8. With `d.CanRestartFromSavegame` set, the fade to `LOCAL_110` and back to 5, without the
   300 VBLs (`LOCAL_132`, `:339-348`). Otherwise `UI_PushMessage(UIM_TERMINATE)` (`:349`):
   CSBWin closes. The port leaves the credits up (`DEBT.md` → H).

**"THAT'S NOT THE SAME GAME" cannot happen after a restart.** `_ReadEntireGame` refuses a
save of another `d.RandomGameID` only while `d.PartyHasDied` is set
(`SaveGame.cpp:1729-1730`), but the restart's `d.Initialize()` (`Code1f9e6.cpp:309`) has
zeroed both, members of `DBank` (`Data.h:615`, `:623`), with `memset(this, 0, …)`
(`CSBCode.cpp:339`) before `GameSetup` reads anything. Button `0xd7` is the only writer of
`d.PartyHasDied` = 1. So every save loads after a restart, in CSBWin as in the port.

**The won game, `P1 = 1`, `d.Word11694 = 1`** (`:122-225`). The CSB win (actuator type 18,
`Timer.cpp:2366-2371`) and `_FusionSequence` (`Attack.cpp:2270`) set `d.Word11694`, and both
reach `_ShowCredits` without `_StartCSB`'s clearing of `d.DynamicPaletteSwitching`.

**The CSB win.** `ProcessTT_STONEROOM` meets an actuator of type 18, at any position — the
arm is the `else` of the missile launchers' `type && position` test — and sets
`d.CanRestartFromSavegame = 0` and `d.Word11694 = 1` and returns true at once, without its
`RotateActuatorList` (`Timer.cpp:2355-2372`). `ProcessTimers` returns true straight away,
the timers behind it left queued (`CSBCode.cpp:6518-6523`), and `MainLoop` runs
`VBLDelay(_1_, 300)` and `ShowCredits(_2_, 1)` (`:637-643`), which never returns: the rest
of the tick, `d.Time++` and `scrollingText.ClockTick()` among it, does not run. The port's
`Game.gameTick` stops there, and `runFrame` then runs 300 VBLs of `vblInterrupt` alone
before `GameHost.showCredits(true)`. `d.Word11694` is `GameState.gameWon`.

1. As the lost game's step 1, but no dying sound and no wait (`Code1f9e6.cpp:124`).
2. Graphic 208, the champion frame, is read after graphic 6 (`:138-143`): 64×43, the 1376
   bytes `A3` skips.
3. With `d.DynamicPaletteSwitching` set: `d.Palette11978` saved in `LOCAL_78`, then eight
   times a VBL and `Darken` (`:27`: each non-zero channel down one) on every colour of
   `d.Palette11946` and `d.Palette11978`, which takes the 3-bit channels to black; a VBL,
   and `LOCAL_78` copied back into `d.Palette11978` (`:148-166`). The display showed
   `d.Palette11978` through `globalPalette` meanwhile (`WinScreen.cpp:1493-1498`), so
   `globalPalette` is left black. Without it, the lost game's fade to black (`:168-170`).
   `LOCAL_78` is a `static` (`:76`) and this is its only writer, so without switching it
   holds the zeros the program started with.
4. `Flood(d.LogicalScreenBase, 12, 0xfa0)`, the whole screen in colour 12 (`:175`). For
   each champion `D7W`, `D6W = 48 * D7W` (`:176-215`): graphic 208 at `d.Word132` with
   colour 10 transparent, the portrait at `d.Word140` with colour 1 transparent;
   `DisplayHeroName(87, D6W += 14, 9, name)`; the title at `6 * StrLen(name) + 87`, 5
   further unless `name[9]` — the title's second byte — is `,`, `;` or `-`, on the same
   line, `D6W` then one lower; and for each base skill whose `DetermineMastery(D7W, skill |
   0xc000)`, capped at 16, is not 1, `d.Pointer16770[mastery] + " " + d.Pointer16596[skill]`
   at `(105, D6W += 8)` in colour 13 (0 dies, `0x8d49`). Then `d.Word132` and `d.Word140`
   move 48 down. `DisplayHeroName` (`:39`) takes `A`-`Z` down 0x40 to glyphs 1-26 of the
   font, which are other letterforms than `A`-`Z` at 65-90, and prints on colour 12.
5. `d.DynamicPaletteSwitching = 0`, and the fade to `LOCAL_78` (`:217-218`). Then
   `for (i=0; (i<2000)&&(RepeatGame) || (!RepeatGame); i++) wvbl(_24_);` (`:219-222`):
   with `RepeatGame` false it never ends, and the champions stay up for good.

The port gives `IntroHost` a `palette11946`, drawn over the viewport by `present` while it is
set, for step 3; the page's is the viewport palette the adventure showed, or `null` with an
inventory open (`GameScreen.palette11946`). `tools/checks/show-credits.ts` checks both branches.


## Skipping it

`?intro=0` skips the FTL logo, the title animation and the entrance entirely and boots straight
into a fresh dungeon (`DEBT.md` H). The page's Debug setting does not. `tools/probe-frames.mjs` passes
the query parameter for its first six frames and then loads the app again without it for the
entrance and the credits.
