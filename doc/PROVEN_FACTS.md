# Proven Facts from CSBWin Source Code

## 100% VERIFIED from Source Code

### Graphics Indices (CSBCode.cpp line 2877)
```cpp
firstWallGraphic = 77 + 13 * newWallGraphicSet;  // = 77 for wallSet 0
```

For default wall set (0):
- Door bitmaps: graphics 77-83 (indices 0-6)
- **Wall bitmaps: graphics 84-89** (indices 7-12)

From line 2884:
```cpp
for (i=0; i<6; i++)
{
  ReadAndExpandGraphic(firstWallGraphic + 7 + i, d.pWallBitmaps[i], 0, 0);
};
```

**d.pWallBitmaps[] mapping:**
- `pWallBitmaps[0]` = graphic **84**
- `pWallBitmaps[1]` = graphic **85**
- `pWallBitmaps[2]` = graphic **86**
- `pWallBitmaps[3]` = graphic **87**
- `pWallBitmaps[4]` = graphic **88**
- `pWallBitmaps[5]` = graphic **89**

Line 2893: Mirror operation creates pWallBitmaps[6] from pWallBitmaps[5]:
```cpp
MakeMirror(d.pWallBitmaps[5], d.pWallBitmaps[6], ...);
```
- `pWallBitmaps[6]` = **mirrored copy** of `pWallBitmaps[5]` (CSBWin does not read a separate “graphic 90” into `pWallBitmaps[6]`)

### Wall Bitmap Allocation Sizes (CSBCode.cpp lines 10104-10113)

These are CSBWin’s allocated buffer sizes for the wall bitmaps (Atari ST planar bytes):

```cpp
d.pWallBitmaps[5] = allocateMemory(392, 1);
d.pWallBitmaps[6] = allocateMemory(392, 1);
d.pWallBitmaps[4] = allocateMemory(3264, 1);
d.pWallBitmaps[3] = allocateMemory(5112, 1);
d.pWallBitmaps[2] = allocateMemory(14208, 1);
d.pWallBitmaps[1] = allocateMemory(2176, 1);
d.pWallBitmaps[0] = allocateMemory(2176, 1);
```

### Cell to Bitmap Mapping (Viewport.cpp lines 2267-2279)
From `StdBitmapPointers()` function:

```cpp
case BMP_StdWallBitmapF3L2:   return d.pWallBitmaps[5];  // graphic 89
case BMP_StdWallBitmapF3L1:   return d.pWallBitmaps[4];  // graphic 88
case BMP_StdWallBitmapF3:     return d.pWallBitmaps[4];  // graphic 88
case BMP_StdWallBitmapF3R1:   return d.pWallBitmaps[4];  // graphic 88
case BMP_StdWallBitmapF3R2:   return d.pWallBitmaps[6];  // mirrored copy of pWallBitmaps[5]
case BMP_StdWallBitmapF2L1:   return d.pWallBitmaps[3];  // graphic 87
case BMP_StdWallBitmapF2:     return d.pWallBitmaps[3];  // graphic 87
case BMP_StdWallBitmapF2R1:   return d.pWallBitmaps[3];  // graphic 87
case BMP_StdWallBitmapF1L1:   return d.pWallBitmaps[2];  // graphic 86
case BMP_StdWallBitmapF1:     return d.pWallBitmaps[2];  // graphic 86
case BMP_StdWallBitmapF1R1:   return d.pWallBitmaps[2];  // graphic 86
case BMP_StdWallBitmapF0L1:   return d.pWallBitmaps[1];  // graphic 85
case BMP_StdWallBitmapF0R1:   return d.pWallBitmaps[0];  // graphic 84
```

### Rectangle Usage Pattern (Viewport.cpp lines 2304-2317)
From `StdRectanglePointers()` function:

```cpp
case RECT_StdWallRectangleF3L2:   return &d.wallRectangles[13];
case RECT_StdWallRectangleF3L1:   return &d.wallRectangles[1];
case RECT_StdWallRectangleF3:     return &d.wallRectangles[0];
case RECT_StdWallRectangleF3R1:   return &d.wallRectangles[2];
case RECT_StdWallRectangleF3R2:   return &d.wallRectangles[12];
case RECT_StdWallRectangleF2L1:   return &d.wallRectangles[4];
case RECT_StdWallRectangleF2:     return &d.wallRectangles[3];
case RECT_StdWallRectangleF2R1:   return &d.wallRectangles[5];
case RECT_StdWallRectangleF1L1:   return &d.wallRectangles[7];
case RECT_StdWallRectangleF1:     return &d.wallRectangles[6];
case RECT_StdWallRectangleF1R1:   return &d.wallRectangles[8];
case RECT_StdWallRectangleF0L1:   return &d.wallRectangles[10];
case RECT_StdWallRectangleF0:     return &d.wallRectangles[9];
case RECT_StdWallRectangleF0R1:   return &d.wallRectangles[11];
```

### RectPos Structure (CSB.h line 1367)
```cpp
struct wordRectPos {
  i16 x1; i16 x2; i16 y1; i16 y2;
};

struct byteRectPos {
  ui8 x1; ui8 x2; ui8 y1; ui8 y2;
  ui8 uByte4; ui8 uByte5; ui8 uByte6; ui8 uByte7;
};

union RectPos { wordRectPos w; byteRectPos b; };
```

### Blitting Function (CSBCode.cpp line 2930)
```cpp
void BltShapeToViewport(ui8 *P1, RectPos *P2)
{
  D0W = (UI8)(P2->b.uByte4);  // source bytes/line (stride)
  if (D0B != 0)
  {
    TAG0088b2((ui8 *)P1,                   // src bitmap
              (ui8 *)d.pViewportBMP,       // dst viewport
              P2,                           // destination RectPos
              (UI8)(P2->b.uByte6),          // srcX
              (UI8)(P2->b.uByte7),          // srcY
              (UI8)(P2->b.uByte4),          // src bytes/line
              112,                          // dst bytes/line (224 pixels wide)
              10);                          // transparent color
  };
}
```

**Key insight**:
- `P2->b.uByte4` = source bytes/line (stride)
- `P2->b.uByte6` / `P2->b.uByte7` = source X/Y offsets (pixels)
- Destination rectangle comes from `RectPos` (`TAG0088b2()` reads `RectPos.b.*` when `d.UseByteCoordinates != 0`)

### Cell System (Viewport.cpp lines 347-355)
```cpp
i8 relativeX[21] = {
  -2,+2,-2,+2,-1,+1,+0,-1,+1,+0,-2,+2,-1,+1,+0,-1,+1,+0,-1,+1,+0
};

i8 relativeY[21] = {
  4,4,3,3,4,4,4,3,3,3,2,2,2,2,2,1,1,1,0,0,0
};
```

Cell indices (lines 323-346):
- RF4L2=0, RF4R2=1
- RF3L2=2, RF2L2=3
- RF4L1=4, RF4R1=5, RF4=6
- RF3L1=7, RF3R1=8, RF3=9, RF3R2=10
- RF2R2=11, RF2L1=12, RF2R1=13, RF2=14
- RF1L1=15, RF1R1=16, RF1=17
- RF0L1=18, RF0R1=19, RF0=20

### Rendering Order (Viewport.cpp lines 6694-7120)
```cpp
DrawViewport() {
  // 1. Summarize all 21 cells
  for (each cell) {
    calculate position
    get room type
  }

  // 2. Render in CSBWin's fixed cell order
  for (userCellNum = 0; userCellNum < 21; userCellNum++) {
    Interpret(pStdDrawCode[userCellNum][graphicRoomType], ...);
  }
}
```

### Stairway Traversal (CSBCode.cpp lines 7733-7783, 7905-7910, 8009-8217)
Turn or movement actions trigger stair traversal in these cases:

```cpp
if (BITS5_15(cellFlags) == 3) {
  TraverseStairway(D7W & 4, true); // called from _TurnParty when standing on stairs
}
...
startingInStairwell = rtFrom==roomSTAIRS;
if (startingInStairwell && (direction==2)) { // backward
  TraverseStairway(cellFlagsFrom & 4, true);
}
...
if (rtTo == roomSTAIRS) {
  d.partyX = newX;
  d.partyY = newY;
  TraverseStairway(cellFlagsTo & 0x04, true);
}
```

`TraverseStairway()` moves the party between levels and can be inhibited by the party-move filter:

```cpp
newPartyLevel = IncrementLevel(d.partyLevel, UpOrDown == 0 ? 1 : -1, &x, &y);
newPartyFacing = ExitStairsDirection(x, y, newPartyLevel);
CallPartyMoveFilter(&partyMoveData);
if (partyMoveData.flags & PM_INHIBITMOVE) return;
```

It then sets `d.newPartyLevel`, `d.partyX` and `d.partyY` (`doc/CSBwin-src/CSBCode.cpp:7775-7781`)
and loads nothing: for a moment the party stands at the new x and y on the level it left.
A pit does the same through `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:3321-3323`). The
main loop's tick loads the new level first (`LoadPartyLevel`, `CSBCode.cpp:621`), runs
the timers, loads again if they moved the party (`:635`), and only then draws the viewport
(`DrawViewport`, `:638`). So no frame ever shows the new square on the old level.

### Exit Stair Facing (Code11f52.cpp lines 290-325)
`ExitStairsDirection()` searches for a non-blocking adjacent cell on the destination level:

```cpp
rt = (ROOMTYPE)(cf >> 5);
if (rt == roomSTONE) continue;
if (rt == roomSTAIRS) continue;
if (rt == roomFALSEWALL) {
  if ((cf & 5) == 0) continue; // false walls passable only if bit 0 or 2 set
}
return (ui16)direction;
```

### Level Mapping for Stairs (CSBCode.cpp lines 4709-4759)
`IncrementLevel()` converts (x,y) to absolute dungeon coords via the current level's offsets,
then searches for a level descriptor with matching `level` number and a bounding box that contains
those absolute coords. If found, it returns the new map index and adjusted (x,y).

### Text Retrieval and Decode (SaveGame.cpp lines 2221-2272, CSBCode.cpp lines 5487-5707)
CSBWin converts the raw text word array into an “indirect text” table during load:

```cpp
for each DB2 text record with link != RNnul:
  oldIndex = pDB2->index(); // word offset into text array
  len = ComputeTextLength(text + oldIndex); // in 16-bit words
  d.indirectTextIndex[newIndex] = d.sizeOfCompressedText;
  copy len words into d.compressedText;
  pDB2->index(newIndex); // replace word offset with indirect index
```

`DecodeText()` uses the DB2 index to locate the compressed word stream:

```cpp
A2 = d.compressedText + d.indirectTextIndex[DB2.index()];
```

Decoding rules for wall texts (`typeOfText == 0`):
- Codes 0–25, 26 (space), 27 (period) are output **as raw byte values** (font indices).
- Separator code 28 outputs byte `0x80` (line break marker).
- End code 31 terminates; `0x81` is appended as the final terminator.

Escape code tables used by `DecodeText()` live in graphics.dat item `0x22f` (Data.h:1070-1072):
- `Byte10080[64]`: escape code 1 table (2-byte strings, used for all text types)
- `Byte10336[256]`: escape code 2 table for wall texts (`typeOfText == 0`)
- `Byte10016[256]`: escape code 2 table for non-wall texts

A hero text goes through the same tables: `AddCharacter` decodes it with
`DecodeText(…, 0x8002, 990)` (`doc/CSBwin-src/Character.cpp:544-547`). In `dm-atari-1.3-fr`
SYRA's title is "L}ENFANT DE SAUVAGE": its `%H` is that set's `Byte10016` entry H, "}",
and the title is nineteen characters, the most `AddCharacter` accepts (`:580`). Shown by
`tools/dump-preset-heroes.ts`, which also recruits SYRA from the mirror in that game.

Every text goes through the escape tables, whatever its type (`CSBCode.cpp:5559-5574`),
the text the party finds on a square it enters included: `PlaceOrRemoveObjectInRoom`
decodes it with `DecodeText(text, …, 1, 990)` and queues it with `QuePrintLines(15, text)`
(`Code11f52.cpp:3960-3963`). In `dm-atari/dungeon.dat` the one visible such text is on
level 0 at (9, 1), and three of its pieces are escapes: "IT IS TOO BAD YOU DID NOT DISCOVER
THE TRUE SECRET OF THE FIRESTAFF. NOW THAT I HAVE IT I HAVE NO FURTHER NEED FOR YOU!"
(`tools/dump-room-text.ts`).

A timer shows a text too. `ProcessTT_OPENROOM` sets, clears or toggles a text's `show`
bit, and when that shows a hidden text on the party's own square it decodes it with
`DecodeText(…, 1, 990)` and queues it with `QuePrintLines(15, text)`, whatever
`DecodeText` returns (`Timer.cpp:1712-1743`). A `TT_DESSAGE` or a parameter message
leaves the square's texts alone (`:1715-1716`), and of its actuators reaches only the
DSAs (`:1760-1761`). In `dm-atari/dungeon.dat` the floor actuator on level 0 at (1, 4)
shows the text under it that way, "WELCOME BACK BRAVE ADVENTURERS."
(`tools/dump-open-room-text.ts`).

Every `DecodeText` ends in `SubstituteCharacterNames` (`CSBCode.cpp:5664-5667`,
`:5367-5482`), which replaces three escapes written in the text's own letters: `.Q.A` is
the champion holding the cursor (`d.HandChar`), `.Q.B` to `.Q.E` the first to fourth
champion, and `.Q.F` to `.Q.K` print nothing; `.R.` and four hex digits is a global text,
the `EXPOOL` record `(EDT_GlobalText << 24) | index` (`EDT_GlobalText` is 10,
`CSB.h:1573`) read byte by byte in memory order up to its zero (`SubstituteGlobalText`,
`:5309-5333`); `.N.` and two digits is a global variable in decimal
(`SubstituteGlobalVariable`, `:5335-5352`). A digit is a letter from `A` (0) to `P` (15).
A wall text, in codes, is looked at only when it holds a `.Q.` (`bcdstrstr`,
`:5354-5365`), and then all three are replaced. A substitution that fails, a champion
past `d.NumCharacter`, nobody holding the cursor, a missing record or a variable past
`numGlobalVariables`, stops the copy there: the text ends at that point, and
`DecodeText` returns -1. Only the text the party finds on a square checks for -1, and
then queues nothing (`Code11f52.cpp:3960`). Conflux 3.5 names a companion `.R.AAHL`,
global text 123, in 224 decodings of its texts; `dm-atari` has none of the three
(`tools/dump-text-substitution.ts`).

### Bytecode Example (Viewport.cpp line 979)
```cpp
ui16 StdDrawF3Stone[] = {
  StdWallBitmapF3,   StdWallRectangleF3,   StdBltShape,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallText,
  F3,  wallDecorationFront,  WallF3Front,  StdDrawWallDecoration,
  Alcove, JumpZ, 5,
      F3Contents,  F3xy, F3 , DrawOrder00,  StdDrawRoomObjects,
  Return
};
```

First 3 instructions: Push bitmap pointer, push rectangle pointer, blit.

## Where the rectangle/offset data lives

CSBWin does not hard-code the `RectPos` coordinate tables in C++ source; they are loaded from `graphics.dat` at startup as part of “graphic `0x22e`”:

- `CSBCode.cpp:10125`: `ReadAndExpandGraphic(0x8000|0x22e, (ui8 *)d.Byte7248+2, 0,0);`
- `Data.h:1109+`: marks the loaded region as “Start of graphic 0x22e”
- `Data.h:1238`: `RectPos wallRectangles[14];` (and many related viewport rectangles) are within that region

## Audio sample rates (deliberate divergence from CSBWin)

Sounds in `graphics.dat` are **4-bit unsigned mono PCM** (SND items, `SNDexpand`).

Playback rates:
- **5486 Hz** for every sound, **except**
- **4237 Hz** for the second (front) variant of the door sound.

Provenance: these rates come from the original hand-made JavaScript proof-of-concept
(`static/js/mediaindex.js`, retired in Phase 14 — recoverable from git history) and were
validated by the project author against the real Atari ST software running under emulation
and against video of the game on vintage hardware. **CSBWin's own playback rates are wrong
here.** This paragraph is now the only surviving record of those rates' origin.

This is therefore one of the very few places where we intentionally do *not* follow
CSBWin. Do not "fix" `ratesDefault` / the door rates in `src/audio/soundsIndex.ts` to
match the C++ source.

The door sound specifically was verified correct in DMweb: the divergence toward the JS
pitch has already been applied and matches the real game. (`NOTES.md` still carries an
older entry saying doors sound wrong — that entry is stale.)

## `dm-atari/graphics.dat` is CSBWin's with three items from the 1.2 disk (deliberate divergence from CSBWin)

`static/gamefiles/dm-atari/graphics.dat` (md5 `6e1396f7abcfb1899e79d671390b41ce`) is the
`graphics.dat` CSBWin's DM package ships (`dm-windows/`, md5
`0b5e042f2c7f2752bac78292cc6bb07e`) with the compressed bytes of three items, 5, 232 and
`0x22e`, taken from the English Atari ST 1.2 disk's (`dm-atari-1.2/`, md5
`9ce2eaf7a9e78620e3f17594437caffa`), both size tables following. Each donated item
differs from CSBWin's only where said below, and every other item is CSBWin's byte for
byte. `tools/dump-dm-atari-graphics.ts` proves all of it and rebuilds the file
(`--write`). `graphics.dat` carries no checksum, and CSBWin's graphics signature, an MD5 of
the file (`doc/CSBwin-src/data.cpp:1943-1975`), is checked only against an expected value
a save or a dungeon states (`doc/CSBwin-src/Graphics.cpp:1784-1805`); DM's state none, and
the port writes none (`src/data/CsbwinExtendedFeatures.ts`).

**Item 5, the credits scroll.** Decompressed, CSBWin's differs from 1.2's in four bytes
(1398, 2283, 3096, 3983: 169 against 1.2's 185). They are the high nibbles of four
opcodes, `0xA` in CSBWin's and `0xB` in 1.2's, and CSBWin's stream draws four lines of the
text wrong from "Dennis Walker" down, then stops four pixels short of the picture; 1.2's
fills it exactly (`tools/dump-image-codec.ts`). Golden frame `08-credits` shows 1.2's.

**Item `0x22e`, `Byte4100[55]`: Crack Switch (In) placement.** Each wall ornament is drawn
through one of eight coordinate sets (`d.wallDecorationPosition[8][13]`), chosen per global
ornament number by `d.Byte4100[60]` (`doc/CSBwin-src/Code390e.cpp:232-234`, used at
`doc/CSBwin-src/CSBCode.cpp:3218-3220`). Both tables come from item `0x22e`, and
`Byte4100` starts at its byte 3146. CSBWin's file (and the Conflux 3.5 one) hold:

| Ornament | `Byte4100` | Front view (relative position 12) | Bitmaps (side, front) |
| --- | --- | --- | --- |
| 50 Crack Switch (Out) | 2 | y 92–119, low on the wall | 16×19, 32×28 |
| 55 Crack Switch (In) | 0 | y 36–63, eye level | 16×19, 32×28 |

1.2's holds 2 for both, at byte 3201, and that is the item's only difference. Names from
`doc/CSBwin-src/AsciiDump.cpp:957` (50) and by the Out/In pairing of 49/54 (`:951`, `:960`).
The two bitmaps are the same crack, with the button out and pushed in.

Where it shows: level 4, the east face of (13,29), seen from (14,29) facing west. Two
once-only type-1 switches: #601 (ornament 55, local action 1) first, #163 (ornament 50,
opens the grid at (13,28)) second. A wall shows its last actuator's ornament
(`doc/CSBwin-src/Codea59a.cpp:136-139`), so 50 is shown until the click; local action 1
is `RotateActuatorList` (`doc/CSBwin-src/Mouse.cpp:249-252`,
`doc/CSBwin-src/Code11f52.cpp:3465`), which moves #601 last, so 55 is shown after it. With
CSBWin's file the pressed crack jumps to eye level; with 1.2's, as on the Atari ST the
author played, it stays where the Out crack was. The port reads the table as it stands,
as CSBWin does, so the `dm-windows` set shows CSBWin's behaviour and `dm-atari` the
original's. `tools/dump-crack-switch.ts` asserts both, and golden frame `09-crack-switch`
shows the pressed switch. Do not put CSBWin's items back into `dm-atari/`.

**Graphic 232, Crack Switch (In)'s front view** (`121 + 2*55 + 1`, 32x28). 1.2 encodes it
in 120 bytes to CSBWin's 108, both stored uncompressed, and the two decode to the same
picture except in 8 pixels: (12,2), (13,2), (11,3) and (12–14,3), (12,4), (13,4). They are
exactly the pixels where Crack Switch (Out)'s front view (graphic 222) draws its button.
CSBWin's leaves them black, an empty crack; 1.2's draws the button in darker colours (1 and
12, against 222's 2 and 1), pushed in. The side views (221, 231) are the same in both
files. Every wall carrying ornament 55 draws this bitmap: in the stock dungeon level 4
(13,29), level 8 (1,15) and (24,26), level 9 (11,26), each beside its ornament-50 twin.
Golden frame `09-crack-switch` shows the button.

## The Timer-A values in `StartSound` are the sample rates

`StartSound`'s second argument is the Atari ST Timer-A data value the original loaded to clock
the sample out. CSBWin throws it away:

```cpp
void StartSound(ui8 *SoundBytes,
                i32  /*timerData*/,
                i32  highVolume)      // doc/CSBwin-src/Sound.cpp:647
```

and then hard-codes 6000 Hz in `SoundDecode` (`doc/CSBwin-src/Sound.cpp:293`,
`WavBuf->nSamplesPerSecond = 6000;`). So the pitch information survives only in the call
sites, and only two of them pass anything but the table value — the dungeon entrance:

- `doc/CSBwin-src/CSBCode.cpp:9536` — `StartSound(d.Pointer22968, 112, 1)`, the latch click.
- `doc/CSBwin-src/CSBCode.cpp:9399` — `StartSound(d.Pointer22964, 145, 1)`, the door grind.

With the MFP's 1:4 prescaler the rate is `2457600 / 4 / timerData`:

| timer data | rate |
| --- | --- |
| 112 | 5485.7 Hz |
| 145 | 4237.2 Hz |

Those are, to the Hertz, `ratesDefault[0]` and the door sound's second variant in
`src/audio/soundsIndex.ts` — the two rates the entry above says came from the hand-made JS
proof-of-concept and were validated against real hardware. Two independent derivations landing
on the same pair is as close to a proof as this project gets that the divergence from CSBWin's
6000 Hz is the right one, and it also fixes which variant is which: **index 0 is timer 112,
index 1 is timer 145**. `timerDataToRateIndex` (`src/renderer/intro/IntroHost.ts`) is that
mapping, asserted in `tools/dump-intro.ts`.

## `ExpandGraphic`'s `0x20` opcode bit is never consulted

The image codec's extended opcodes (`doc/CSBwin-src/CSBCode.cpp:10884-10896`) branch like
this:

```c
tag0214be:
  D2W &= 15;  D1L = 0;  D1B = *(A0++);
  if ((D3W & 0x40)==0) goto tag0214d0;
  D1W <<= 8;  D1B = *(A0++);
tag0214d0:
  D1W += 1;
  if ((D3W&0x10)==0) goto tag021482;   // a solid colour run
  if ((D3W&0x20)==0) goto tag021558;   // literal nibbles
  A2 = A1-D7W;                          // copy the line above
```

`0x40` is "the count is 16-bit" and `0x10` splits run from not-run. **`0x20` is only tested
once `0x10` is already set**, so on the run branch it means nothing: `0xA` is `0x8` and `0xE`
is `0xC`. A decoder that gives `0xA` or `0xE` a meaning of its own desynchronises the stream.
Graphic 5, the credits scroll, is the only image in either shipped data set that uses one.

## The copy-the-previous-line opcode ends with a pixel of its own colour

`0xB` and `0xF` are "copy N pixels from the line above" — and then one more pixel, of the
colour in the opcode's low nibble. That trailing pixel is a **fall-through**, not a separate
step: the copy loop at `tag0214e4` runs off its end straight into `tag0214f2`, which is the
same `BSR(021570)` "place one pixel" subroutine the single-pixel opcode uses
(`doc/CSBwin-src/CSBCode.cpp:10914-10924`):

```c
tag0214e4:
  BSR(0214fa,0214e6);
  if (D5L == 0) goto tag0214ec;
  A2 = (pnt)D5L;
tag0214ec:
  A2 += 8;
  if (D1W != 0) goto tag0214e4;
tag0214f2:                       // <- no jump here; the loop above falls in
  BSR(021570,0214f6);
  goto tag021470;
```

Dropping it costs one pixel per opcode, which on a 320-wide image with hundreds of them puts
the whole picture out of register. Asserted in `tools/dump-image-codec.ts`.

## `d.Palette11914` is black

Nothing in CSBWin ever writes it. Its only references in the whole tree are its declaration at
`doc/CSBwin-src/Data.h:868` and five `FadeToPalette` reads (`Menu.cpp:287`,
`CSBCode.cpp:9578`, `:9639`, and the two in `Code1f9e6.cpp`), and `d` is a zero-initialised
global. So every "fade to `Palette11914`" in the source is a fade to black, and the name
carries no other meaning.

## See-Thru-Walls is a counter read as a boolean

`d.SeeThruWalls` (`doc/CSBwin-src/Data.h:768`, an `i8`) is a **counter**, not a flag:

- `doc/CSBwin-src/Magic.cpp:1314` — the spell increments it.
- `doc/CSBwin-src/Attack.cpp:2016` — an attack path also increments it.
- `doc/CSBwin-src/CSBCode.cpp:6549` — timer type `TT_73` decrements it.

The viewport reads it as a boolean, every frame, through one bytecode opcode:

```cpp
case SeeThroughWalls: push(d.SeeThruWalls?1:0);   // Viewport.cpp:2638
```

So overlapping casts stack their durations rather than their effect, and the renderer must
consult the counter per frame rather than latch a flag.

It opens three things in the viewport, and no other:

- **The wall straight ahead, one square away.** Only `StdDrawF1Stone` tests it
  (`doc/CSBwin-src/Viewport.cpp:1048-1087`); every other wall program draws as without the
  spell. Before the wall is drawn, the viewport at (`SeeThruWallsRect.b.uByte4`,
  `.uByte6`) = (64, 19), where the cells behind have already drawn, is copied into derived
  graphic 1 (4560 bytes, 96x95, `CSBCode.cpp:10248`) with no transparent colour. The hole
  mask, graphic 41 (96x95, `BMP_StdHoleInWallBitmap`, `Viewport.cpp:2292`), is laid over it
  with colour 10 transparent. After the wall, its decoration, text and alcove contents,
  the derived graphic goes back into the viewport at `SeeThruWallsRect2` (64..159, 19..113)
  with colour 9 transparent. So where the mask is 10 the view behind shows, where it is 9
  the wall does, and the mask's other colours draw the hole's rim. Whatever behind the wall
  is itself colour 9 shows as wall.
- **The edge of a door the party stands in.** `StdDrawF0DoorEdge` draws its frame with
  `StdDrawSeeThruDoorEdge` instead (`Viewport.cpp:1791-1800`, `:2576-2587`): door bitmap 1
  (1968 bytes) is copied, graphic 41 laid over it at `(RectPos *)d.uByte2542` with colour 9
  transparent, and the copy drawn at `DoorTrackTopRect[6]`. The source X offset is
  `DoorTrackTopRect[0].b.x1 - SeeThruWallsRect.b.uByte4` = 192 - 64 = 128, which CSBWin's
  comment says "isn't right": in a 96-pixel-wide graphic that is row 1, pixel 32, so the
  95 rows read run one row past graphic 41's end. The port writes nothing for the pixels
  past the end, and that last row keeps the door edge's own.
- **A door in the nearest rank** is recoloured with door ornament 17
  (`TAG004b26(17, 2)`, `doc/CSBwin-src/CSBCode.cpp:4168-4174`).

## Every `AdjustSkills` runs the filter, and every level gained is announced

`AdjustSkills` (`doc/CSBwin-src/Magic.cpp:185`) is the same for every caller: it runs the
Adjust Skills Filter DSA (`:252-311`), and when the basic skill's mastery rises it calls
`LevelUp`, which prints a linefeed and then "<NAME>", " JUST GAINED A ", the skill's name,
" LEVEL", all in `d.Byte1386[chIdx]` (`:172-176`). So a monster's blow, which trains
defence skill 7 (`Monster.cpp:4535`), is filtered and announced like a spell or an
actuator's skill increase.

The masteries it compares come from `DetermineMastery`, which returns 1 while the party
sleeps (`Code17818.cpp:28-35`): the experience is still added, but a sleeping champion
never levels up. A monster's blow wakes the party before it trains defence
(`Monster.cpp:4530`).

The filter may answer another `chIdx` and `skillNumber` (`Magic.cpp:304-305`), but the
champion (`pcA2`), the skill credited (`psA3`), `basicSkill` and `oldMastery` were all
taken before it (`:233-250`). So the experience still goes to the original champion's
original skill. The answer decides only whether that champion's basic skill is credited
too (`skillNumber >= 4`, `:332`), whose mastery is compared with the old one (`:341`), and
who gets `LevelUp` (`:354`).

Evidence: `tools/dump-adjust-skills.ts`.

## Throwing awards skill 10 with a literal experience base

`doc/CSBwin-src/Mouse.cpp:724-737`:

```cpp
D6W = 8;
D5W = 1;
if (objD4.dbType() == dbWEAPON)
{
  D6W += 4;
  weaponDescA2 = TAG0099d2(objD4);
  if (weaponDescA2->uByte1 <= 12)
  {
    D5W = weaponDescA2->uByte3;
    D6W = sw(D6W + D5W/4);
  };
};
AdjustSkills(chIdx, 10, D6W, ASW_ThrowByCharacter);
```

The skill number is the literal `10` — there is no lookup table for it. The experience is
`8`, `+4` for a weapon, and `+ uByte3/4` for a weapon whose `uByte1 <= 12`. That test
includes classes 0 and 2, so swords, maces, clubs, the dagger and the axes get the bonus
too, not only the throwing weapons. The object's weight plays no part; it only sets the
stamina cost (`TAG016382`, `Mouse.cpp:653-667`) and the distance.

## An attack at an empty square is a miss; one at any closed door is a hit

`AttackWithPhysicalForce` returns 0 when no monster is in the square, and `_Attack` treats
that 0 as a miss, halving both `experienceGained` and `disableTime`
(`doc/CSBwin-src/Attack.cpp:1834-1838`). A wall is no different from empty air.

BASH, HACK, BERZERK, KICK, SWING and CHOP first check the cell in front for
`roomDOOR` with `(flags & 7) == 4`, a closed door (`Attack.cpp:1794-1812`); CSBWin's comment
"Is it a breakable door?" is wrong. Breakability is checked afterwards in `HitDoor`, which
returns 0 for a door `canOpenWithAxe()` refuses or a force below `DoorTOC`
(`doc/CSBwin-src/Code11f52.cpp:2276-2281`). The arm then `break`s with `successfulAttack`
still at its initial 1, so every blow at a closed door, breakable or not, earns the full
`experienceForAttacking` with a busy time of 6. See `doc/TRAINING.md` for what that means in
play.

## Spell experience uses the spell record's `byte5`

CSBWin passes `spellByte5` as the skill number for both spell `AdjustSkills` calls —
`ASW_CastSpell1` on a wisdom-check failure (`doc/CSBwin-src/Magic.cpp:1226`) and
`ASW_CastSpell2` on success (`doc/CSBwin-src/Magic.cpp:1396`). `byte5` comes from the
`SPELL` record in graphics `0x230`; it is not derived from the champion's class.

## A spell filter's overrides: what `CastSpell` takes from them, and when

`CastSpell` (`doc/CSBwin-src/Magic.cpp:1090`) switches on `spellParameters.action` first
(`:1110-1136`): 1 aborts silently, 2-7 print their message (6 with the caster's name for
`%`, `StandardSpellMessage`, `:1059`) and abort, applying the filter's `disableTime` if it
is not -1 (`:1137-1149`); 0 and every other value print nothing and carry on. Only then
come `if (chIdx >= d.NumCharacter) return 0;` and `if (pcA3->HP() == 0) return 0;`
(`:1150-1153`), so an abort prints even for a dead caster. The difficulty is
`D4W = sw(pSpell->skillRequired + spellPower)` — the spell's own skill — while the
filter's `skillRequired` replaces the spell's only in the experience,
`(STRandom() & 7) + 16 * D4W + 8 * (spellPower - 1) * skillRequired + D4W * D4W`
(`:1197-1211`). A filter's `missileType` replaces `BITS4_9(pSpell->word6)` (`:1201-1205`),
which is what classes 2 and 3 act on; the class-1 potion type is `pSpell->word6` whatever
the filter says (`:1250`). Evidence: `tools/dump-cast-spell.ts`.

## Zokathra goes into a hand, or is dropped like any drop

`CastSpell`'s class-3 type 7 makes a `misc_ZokathraSpell` in a new misc record
(`doc/CSBwin-src/Magic.cpp:1356-1359`) and puts it in the caster's first empty hand, slot 0
before slot 1, with `AddCharacterPossession` (`:1360-1378`). With both hands full it is
dropped in the party's cell on the party's level, `MoveObject(obj_2, -1, 0, d.partyX,
d.partyY, NULL, NULL)` between a `LoadLevel(d.partyLevel)` and a `LoadLevel(oldLevel)`
(`:1380-1387`), so it lies at corner 0 and the pads there see it placed, with
`unchangedRoom` true because the party stands there. When no misc record is free, nothing
is made (`:1357`). Evidence: `tools/dump-cast-spell.ts`.

## Blocked movement has no message

CSBWin answers a blocked move with a **sound only**. Verified by grep over the whole of
`doc/CSBwin-src/`: none of "A wall blocks your path", "You step into a pit", "You feel a
strange sensation", "You find stairs" or "The edge of the dungeon blocks your path" exists
anywhere in the C++ source. They were invented by this port and were removed in Phase 14.

## `DB4.uByte4` packs the monster type with the alternate-graphic selector

`doc/CSBwin-src/CSB.h:1113-1116`:

```cpp
MONSTERTYPE monsterType(void) {return (MONSTERTYPE)(uByte4&0x1f);};
i32 alternateGraphics(void){return (uByte4>>5)&0x7;};
```

The type must be masked to five bits before indexing `MonsterDescriptor[27]`. This port
read the whole byte as the type until Phase 12; the shipped Dungeon Master data happens to
set no alternate-graphic bits, which is why nothing had gone visibly wrong.

## `DB4.numMonM1` is a count minus one, everywhere

`doc/CSBwin-src/CSB.h:1123`: `ui16 numMonM1(void){return BITS5_6(word14);};` — and every
CSBWin caller treats it that way, including `CreateMonster`'s `do { … } while
((numMonM1--) != 0)` loop (`doc/CSBwin-src/Monster.cpp:206-217`).

Before Phase 12 this port stored it as a 1-based count, and two of its three readers
(`TimerSystem.ordinalOfMonsterAtPosition`, `Game.applyMissileDamageToMonster`) used it as
`numMonM1` anyway. The field is now named and stored as CSBWin has it.

## `DB4.uByte5` is either the `ITEM16` index or the packed positions

`doc/CSBwin-src/CSB.h:1084-1087`:

```cpp
ui8  uByte5; //ITEM16 index when the monster group is on
             // the same level as the party.  Else it is
             // four 2-bit fields with positions of each
             // group member.
```

`AttachItem16ToMonster` swaps one reading for the other — `pi16A2->positions() =
pDB4A3->groupIndex(); pDB4A3->groupIndex(item16Index);`
(`doc/CSBwin-src/CSBCode.cpp:6087-6088`) — and `DetachItem16` swaps it back
(`doc/CSBwin-src/CSBCode.cpp:6127-6128`).

CSBWin distinguishes the two with a bare bound check, `if (pDB4->groupIndex() <
d.MaxITEM16)` (`doc/CSBwin-src/Monster.cpp:531`). That is sound only because a monster
off the party's level has its index deliberately parked out of range at `0xd8`, or `0xff`
when it fills the whole cell (`doc/CSBwin-src/MoveObject.cpp:517-518`).

## `AttackNames` is NUL-separated, unlike `ObjectNames`

`GetAttackTypeName` walks forward over `n` NUL terminators rather than indexing
(`doc/CSBwin-src/CSBCode.cpp:8609-8626`):

```cpp
for (A3 = d.AttackNames; D7W-- != 0; )
{
  while ( *(A3++) != 0) {}; // Skip one string
};
```

`ObjectNames` in graphic `0x22c` uses the opposite convention — the high bit of the last
byte of each entry terminates it. The two tables are not interchangeable.

## `LEGALATTACKS` byte 6 is dead data

`doc/CSBwin-src/Character.cpp:4932` is the only reader, and it is commented out:

```cpp
//Not used anywhere!!  // d.Word20262 = *(pLegalAttacks+6);//This seems wrong but who cares?
```

Bit 7 of bytes 4 and 5, by contrast, is live: it means the wielded item must have charges
left before that attack option is offered (`doc/CSBwin-src/Character.cpp:4789-4792`).

## Monster sight is halved by darkness, and never falls below 1

`doc/CSBwin-src/Monster.cpp:577-584`:

```cpp
D5W = pmtDesc->sightDistance();
if (!pmtDesc->canSeeInDark())
{
  D5W = sw(D5W - d.CurrentPalette/2);
};
w_18 = sw(Larger(1, D5W));
if (d.OrthogonalDistance2Party > w_18) return 0; //Cannot see the party then zero.
```

`sightDistance()` is `word14` bits 0-3, and the subtrahend is the *viewport palette index* — so
the effect of darkness on monster perception is derived from the same value that dims the
screen. Even in total darkness a monster still sees one cell.

## `d.CurrentPalette` is set where the light changes, by `SelectPaletteForLightLevel`

`SelectPaletteForLightLevel` (`doc/CSBwin-src/CSBCode.cpp:7242-7336`) is the only writer
of `d.CurrentPalette`. The VBL handler only reads it, to load `d.Palette552[d.CurrentPalette]`
once `d.Word11778` says it changed (`:1011-1016`), and so does `Blocked` (above). Its
callers are the places the light changes: a torch into or out of a hand and an Illumulet
on or off the neck (`Character.cpp:1867`, `:1903`, `:1992`, `:2017`), a `TT_LIGHT` timer
(`CSBCode.cpp:6517`), `LoadPartyLevel` (`:819`), `NinetySecondUpdate` (`:7384`),
`SetBrightnessTimer` (`Magic.cpp:839`) and the fusion (`Attack.cpp:2275`).

- A level whose `experienceMultiplier()` is 0 is palette 0, whatever the light (`:7254-7258`).
- `LOCAL_26[8]` takes each champion's hand 1, then hand 0: a torch's `charges()` if its
  `GetBasicObjectType` is `Torch_a`-`Torch_d`, else 0 (`:7261-7280`). The loop runs to
  `d.NumCharacter`, so a Hall of Champions recruit's torch counts, unlike in
  `NinetySecondUpdate`.
- A selection sort brings the four brightest to the front; the fifth entry, which is also
  summed, is whatever the swaps left there (`:7281-7294`).
- Each of the first five non-zero charges adds `(Word1074[charges] << shift) >> 6 & 0x3ff`,
  with `shift` 6 for the brightest and one less for each torch after it, down to 0
  (`:7295-7307`). Then `d.Brightness` is added (`:7308`).
- A total above 0 is palette `i` for the first `d.PaletteBrightness[i]` not above it
  (`:7309-7317`); the Atari DM table is `99 75 50 25 1 0`, so the search stops by 5. A
  total of 0 or less is palette 5 (`:7318-7321`).

Evidence: `tools/dump-light-level.ts`.

## `Blocked()` de-duplicates the group's facings before testing

`doc/CSBwin-src/Monster.cpp:542-563` builds a list of the group's *distinct* facings and tests
`IsItInThisDirection` once per distinct value. A group of four monsters all facing north
therefore performs one cone test, not four. A `See360()` monster skips the facing test
entirely via `goto tag00c2fe`.

The function is named `Blocked` but answers the opposite question: it returns the distance to
the party when the party **can** be seen, and 0 when it cannot.

## `IsItInThisDirection` accepts a cone one cell wider than a diagonal

`doc/CSBwin-src/Code11f52.cpp:2171-2174`:

```cpp
if (ahead < 0) return false;
// It is in front of us or even with us.
if (abs(sideways)>ahead+1) return false;
return true;
```

`ahead == 0` (level with the monster) counts as in front, and the sideways tolerance is
`ahead + 1` rather than `ahead`. So a monster at (0,0) facing north accepts a target at
(1,0) — directly beside it.

## `GetPrimaryAndSecondaryDirection` treats north specially

`doc/CSBwin-src/Code11f52.cpp:2233-2240`: having found a primary direction whose `dir + 1`
neighbour is not also in cone, CSBWin only tries the `dir + 3` neighbour when `dir != 0`:

```cpp
if (   (dirD4 != 0)
    || (IsItInThisDirection(
                 d.SecondaryDirection = (DIRECTION)((dirD4+3)&3),
                 ...)==0)  )
```

The `||` short-circuits, so for `dirD4 == 0` the second test runs but its result is discarded
and the random-secondary branch is taken regardless. Preserved in the port.

## Monsters step onto fake pits and false walls only if they recognise them

`doc/CSBwin-src/Monster.cpp:681-703`. Bit 0 of the cell flag marks a *fake* pit or false wall,
and `PossibleMove`'s `RFPAW` parameter (RecognizesFalsePitsAndWalls) decides whether the
monster is fooled:

```cpp
if (!((D5W&1)?RFPAW:(D5W&1))) //Can monster walk on fake pit?
```

The expression reads oddly but is just "if bit 0 is set, use RFPAW; otherwise false". A
levitating monster ignores an open pit outright, fake or not. `PossibleDoubleMove` hard-codes
`RFPAW` to 0 for the second step (`doc/CSBwin-src/Monster.cpp:814`).

## A Fluxcage stops only invincible monsters

`doc/CSBwin-src/Monster.cpp:705-721`: the Fluxcage scan in `PossibleMove` is inside
`if (pmtDesc->invincible())`. Since Lord Chaos and the Grey Lords are the only `invincible`
types in the shipped data, a Fluxcage is inert against everything else — which is what makes
it the tool for herding Lord Chaos in the fusion endgame.

## A spell is launched as its own RN

`LaunchMissile` stores its `object` argument as the missile's projectile as it is
(`doc/CSBwin-src/Magic.cpp:17-70`). A monster's spell reaches it as the bare `RNFireball`
… `RNPoisonBolt` value (`doc/CSBwin-src/Monster.cpp:1194-1203`), and so does a
champion's spell attack, through `LaunchObject` (`doc/CSBwin-src/Magic.cpp:449-462`). No
record is built for a spell: only a shooter's rocks, arrows and boulders are objects
made on the spot (`constructPredefinedMissile`).

## A thrown weapon flies as its own missile graphic

`GetGraphicClass` (`doc/CSBwin-src/Code51a4.cpp:2838-2870`) chooses how a missile's flying
object is drawn (`:2315`). A spell gets a fixed negative class; a weapon gets
`-BITS8_12(WEAPONDESC.word4)` when that field is non-zero; anything else gets its
`d.ObjDesc` graphic class, and is drawn as it lies on the floor (`:2563-2590`). A negative
class `-n` is `d.struct5688[n-1]`, drawn from graphic `316 + uByte0` plus 0, 1 or 2 for
the view (`:2318-2320`, `:2463`). In DM's `graphics.dat` nineteen weapon types have one:
the swords, the axes, the clubs, the dagger, the arrow (`n = 1`, so class `-1` is a real
missile graphic), the Slayer, the poison dart and the throwing star. The torch, the bow,
the staffs and the rest fly as their floor picture. `tools/dump-missile-draw.ts` checks it.

## `movementTicks06 == 255` means the monster never moves

`doc/CSBwin-src/Monster.cpp:669`: `if (pmtDesc->timePerMove() == 255) return 0;` — the first
thing `PossibleMove` tests. Monster type 11 (Black Flame) has exactly this value in the
shipped data.

## Turning away takes two steps, and worms turn in pairs

`doc/CSBwin-src/Monster.cpp:838-846`: a monster whose facing is 180° from the preferred
direction turns only 90°, to a randomly chosen side:

```cpp
D0W = (I16)((D0W - preferredDirection) & 3); // relative to preference
if (D0W == 2) // if facing away from party
{
  newDir = ((STRandom() & 2) + preferredDirection + 1) & 3;
```

`TurnMonster`'s `P4` parameter means "treat the monsters as pairs" — a `horizontalSize == 1`
monster occupies two corners and both halves must face the same way, so the partner at
`monsterIndex ^ 1` is set too. `d.Time13130`/`d.pI1613134` then suppress a second pair-turn in
the same tick. In `TurnMonsterGroup` every member turns on a coin toss *except* member 0,
which always turns (`doc/CSBwin-src/Monster.cpp:893`).

## `DoorTOC` is two of four `DoorCharacteristics` entries, chosen per level

`doc/CSBwin-src/CSBCode.cpp:5780-5783`:

```cpp
D0W = d.pCurLevelDesc->Door1Type();
d.DoorTOC[0] = d.DoorCharacteristics[D0W];
D0W = d.pCurLevelDesc->Door2Type();
d.DoorTOC[1] = d.DoorCharacteristics[D0W];
```

`DoorCharacteristics[4]` lives in `graphics.dat` item `0x22f` at absolute 9760
(`doc/CSBwin-src/Data.h:1073`); `DB0.doorType` is a single bit selecting which of the level's
two. The low byte is the force needed to bash the door (`doc/CSBwin-src/Code11f52.cpp:2277`)
and bit 8 marks a door monsters may walk through (`doc/CSBwin-src/Monster.cpp:320`).

## A door's ornament is drawn onto its bitmap, from four tables of item `0x22e`

`DrawDoor` copies the door's graphic into `tempBitmap`, draws on the copy and blits that
(`doc/CSBwin-src/CSBCode.cpp:4151-4190`), in this order: the door's own ornament,
`TAG004b26(DB0.ornateness(), nearness)` (`:4155`); a lightning door's random mirror and flip
(`:4156-4166`); `TAG004b26(17, 2)` for the centre F1 door under See-Thru-Walls (`:4168-4174`);
and `TAG004b26(16, nearness)` for a bashed one (`:4182-4185`). Nearness is 2 at F1, 1 at F2,
0 at F3 (`doc/CSBwin-src/Viewport.cpp:2594-2598`).

`TAG004b26(ornament, nearness)` (`CSBCode.cpp:3993-4059`) does nothing for ornament 0, and
otherwise reads slot `ornament - 1` of `d.Word2514[17][2]`: a graphic and a position set.
`ReadGraphicsForLevel` fills slot `i` from the level's `DoorDecorationTOC[i]` with graphic
`303 + TOC[i]` and set `d.Byte4122[TOC[i]]` (`doc/CSBwin-src/Code390e.cpp:275-284`), and
never clears the slots past the level's count. Slots 15 and 16 are set once, to graphics
301 and 302 in set 1 (`CSBCode.cpp:10251-10262`). `Word2514` is declared `[1][2]` and
followed by `FILL(2510,2446)`, 64 bytes, so the seventeen slots fit (`Data.h:1320-1321`).

The ornament's rectangle on the door's bitmap is `d.Byte5070 + 18*set + 6*nearness`, a
6-byte `x1 x2 y1 y2 widthBytes height`. `Byte5070` is declared 12 bytes, and the four sets
run on into `Byte5058[60]`, which follows it (`Data.h:1149-1150`); `Byte5058[18*set]` is the
set's F1 rectangle. At F1 the ornament's graphic is drawn as it is. Nearer than that it is
first shrunk (`ShrinkBLT`) from its F1 size to the rectangle's, through the colour map
`d.Byte4172` at F3 or `d.Byte4188` at F2, into derived graphic `68 + 2*slot + nearness`. It
is drawn with colour 9 transparent. In `graphics.dat`, every ornament's F1 rectangle is its
graphic's size, and set 1's three rectangles are the whole door at each nearness
(`tools/dump-door-ornaments.ts`).

## `AddFootprintEntry` is acknowledged broken, and still load-bearing

`doc/CSBwin-src/Code11f52.cpp:4343-4346` carries Paul Stevens' own verdict:

```cpp
void AddFootprintEntry(i32 /*newX*/,i32 /*newY*/, ui16 deltaTime)
{ //I think this is much hogwash.  Does nothing useful.
  //Is full of errors.  Perhaps an old, abandoned
  //debug trace or something.
```

It is nonetheless the only writer of `d.Byte13220`, the age bytes that
`GetBestMonsterFacingP1` reads to decide whether a footprint is fresh enough to follow
(`doc/CSBwin-src/Monster.cpp:617-620`). Its loop overwrites every entry it walks past with one
value, and never reaches entry 0 (`while (index-- != 1)`, `:4354`). It is ported as written.

## A full trail is the last 24 squares walked: `MemMove` takes its source first

`MemMove(ui8 *src, ui8 *dest, i32 byteCount)` is `memmove(dest, src, byteCount)`
(`doc/CSBwin-src/CSBCode.cpp:824-827`): the source is the **first** argument. So
`DeleteFootprintEntry`'s

```cpp
MemMove((ui8 *)&d.PartyFootprints[D7W+1],(ui8 *)&d.PartyFootprints[D7W],2*D6W);
MemMove((ui8 *)&d.Byte13220[D7W+1],(ui8 *)&d.Byte13220[D7W],D6W);
```

(`doc/CSBwin-src/Code11f52.cpp:4328-4329`) copies the entries above `P1` down one, prints
and ages alike: an ordinary removal. `MoveObject` deletes entry 0 while the count is 24 or
more, then appends (`:3228-3246`), so the trail is always the last 24 squares the party
walked, oldest first, and the magic range slides down with them (`:4331-4337`). The
ten-second update's drop of the oldest print (`doc/CSBwin-src/Code17818.cpp:181-195`)
leaves the rest in order. Evidence: `tools/dump-magic-footprints.ts`, and
`tools/dump-footprint-decoration.ts` for a print drawn from a trail that has been round.

## The party's trail grows from empty

In `MoveObject`'s footprint block (`doc/CSBwin-src/Code11f52.cpp:3227-3246`) the
`if (D6W != 0)` guards only the first `AddFootprintEntry`, the one that ages the departed
square. The count still grows and the new square is still stored, so the first move a
party with champions makes stores print 0. CSBWin's own saves show it:
`csbgame-early-1hero.dat` has `NumFootprintEnt` 0 and `csbgame-early-2hero-renamed.dat`,
later in the same game, 1.

## YA BRO ROS marks the trail from the cast onwards

The magic footprints are a range of the one trail, `[d.IndexOfFirstMagicFootprint,
d.IndexOfLastMagicFootprint)`, and nothing else. The spell opens it at the trail's end
(`doc/CSBwin-src/Magic.cpp:1331-1342`):

```cpp
d.MagicFootprintsActive++;
d.IndexOfFirstMagicFootprint = d.NumFootprintEnt;
if (spellPower < 3) d.IndexOfLastMagicFootprint = d.IndexOfFirstMagicFootprint;
else                d.IndexOfLastMagicFootprint = 0;
```

Every party move while `d.MagicFootprintsActive != 0` sets the end to the new count
(`doc/CSBwin-src/Code11f52.cpp:3237-3241`), `DeleteFootprintEntry` lowers both ends as the
ring shifts (`:4331-4337`), and `SummarizeRoomInfo` draws a print whose index lies in the
range (`doc/CSBwin-src/Codea59a.cpp:406-416`). The spell's power therefore matters only
until the party's first move: an end of 0 marks nothing, the weak spell's empty range
marks nothing either, and the first move makes both the same. The timer's end,
`TT_79`, only decrements the counter (`CSBCode.cpp:6572`), so a range outlives the spell.

`SummarizeRoomInfo` tests only a cell whose `cfD4` the room-type switch left non-zero
(`doc/CSBwin-src/Codea59a.cpp:401`): an open floor, a teleporter and a door set it to 1
(`tag00a85c`, `:307`), an open false wall too, since it falls through into `roomOPEN`
(`:293-308`), and a pit keeps its flag bit 0 when bit 3 is set, else counts as open floor
(`:263-275`). Stairs clear it (`:373`), and a stone or closed false wall returns before the
test. It takes only the newest print on the cell, `SearchFootprints`' 1-based index less
one, and sets bit 15 of `decorations[2]` (`:402-416`), the floor decoration. On the same
cells, once `d.Time > 0`, the cell's extended cell flag `ECF_FOOTPRINTS` sets that bit too
(`:419-425`): `GetExtendedCellFlag` reads bit `y` of longword 0 of the column's `EXPOOL`
record, and finds nothing in a record shorter than eight longwords
(`doc/CSBwin-src/data.cpp:1679-1689`). Only a DSA's `&ECF!` or a custom dungeon writes one.
The port: `summarizeRoomInfoCsbwin` with the `PartyFootprints` and the game's `d.Time`
`DrawViewport` hands it. Evidence: `tools/dump-footprint-decoration.ts`.

## The footprint graphic is slot 15 of `d.LoadedFloorDecorations`, which no level fills

`DrawFloorDecorations` draws a floor decoration from `d.LoadedFloorDecorations[16][2]`, a
first graphic and a rectangle set per slot (`doc/CSBwin-src/CSBCode.cpp:3871-3892`), and
never from the level's `FloorDecorationTOC`. A level load fills the level's own slots,
`{247 + 6 * FloorDecorationTOC[i], d.Byte4110[FloorDecorationTOC[i]]}`
(`doc/CSBwin-src/Code390e.cpp:263-274`), and `NumFloorDecorations()` is four bits
(`doc/CSBwin-src/CSB.h:2119`), so it reaches slot 14 at most. Slot 15 is the footprints',
set once by `ReadTablesFromGraphicsFile` (`doc/CSBwin-src/CSBCode.cpp:10270-10273`):

```cpp
d.LoadedFloorDecorations[15][0] = 241;
d.LoadedFloorDecorations[15][1] = 1;
```

Bit 15 of the ordinal draws it, as ordinal 16, after the cell's own decoration
(`:3984-3987`), and alone when the ordinal is otherwise 0 (`:3812-3818`). The canary for
both numbers: graphics 241-246 are the sizes of set 1's nine rectangles, each at
`241 + d.RelativeCellGraphicIncrement[cell]`, and of neither other set's. The port:
`InterpreterContext.loadedFloorDecorations`, which `ViewportRenderer` fills.
Evidence: `tools/dump-footprint-decoration.ts`.

## A monster follows staler footprints the keener its nose

`doc/CSBwin-src/Monster.cpp:615-620`:

```cpp
D6W = SearchFootprints(mapX, mapY);
if (D6W != 0)
{
  w_10 = STRandom0_3();
  D0W = sw(w_10 + (UI8)(d.Byte13220[D6W-1]));
  if (D0W > 30 - 2*D7W)
```

`D7W` is `smellingDistance()`, so the threshold `30 - 2 * smell` *falls* as the nose improves.
Note the index skew, which is CSBWin's and not a transcription slip: the age is read at
`D6W - 1` but the followed print at `D6W` (`doc/CSBwin-src/Monster.cpp:624-625`).

## `DamageMonster` renumbers per-member timers only in fear state 6

`doc/CSBwin-src/Code11f52.cpp:1147` gates the entire timer-renumbering block — and the
survivors' bravery check with it — on the group's fear state:

```cpp
if (pMonster->fear() == StateOfFear6)
{
  TIMER_SEARCH timerSearch;
  while (timerSearch.FindNextTimer())
  { ... delete or renumber the per-member timer ... };
  if (onPartyLevel)
  { ... maybe drop to StateOfFear5 ... };
};
```

This looks like an omission until you find where per-member timers come from:
`MaybeDelTimers_Fear6_TurnIndividuals` (`doc/CSBwin-src/Monster.cpp:1436`) sets fear to 6 and
*then* creates a `TT_MONSTER_B<n>` per member. Outside state 6 a group has only its group
timer, so there is nothing per-member to renumber.

## The group timer survives `DamageMonster`'s renumbering by arithmetic, not by a test

The scan range is `TT_MONSTER_A0` (33) to `TT_MONSTER_B3` (41), which **includes**
`TT_MONSTER_Bgroup` (37). CSBWin does not exclude it explicitly; instead

```cpp
d4Index = tt - TT_MONSTER_B0;// -= 38;
```

yields `-1` for the group timer, which matches neither `d4Index == indexInGroup` nor
`d4Index > indexInGroup`, so it falls through untouched
(`doc/CSBwin-src/Code11f52.cpp:1155-1163`). Note the asymmetry: `TT_MONSTER_Agroup` (32) is
below the range and excluded outright.

## A dying group member is compacted over, not blanked

`doc/CSBwin-src/Code11f52.cpp:1217-1232` shifts every survivor above the dead member down one
slot, moving **five parallel things** together: `hitPoints6[]`, the packed position byte, the
packed facing byte, `singleMonsterStatus[]`, and (per the entry above) the queued per-member
AI timers. Only then does `numMonM1` decrement. The position byte is masked to `0x3f` before
being written back, discarding the now-vacated top field.

The consequence for callers: live members are always packed into the low indices, so "the
first member with hit points" is a valid way to pick a target.

## `MonsterDroppings` words are split by range, not by a type field

`doc/CSBwin-src/Code11f52.cpp:735-753`. Bit 15 of a word means "drop only on a coin toss";
the low 15 bits are then classified by magnitude:

- `>= 127` → misc, minus 127
- `>= 69` → clothing, minus 69
- `>= 23` → weapon, minus 23
- below 23 → skipped entirely

Verified against the shipped data: `mon_Screamer`'s list at `MonsterDroppings[15]` yields
`misc` type 33, which is `misc_ScreamerSlice` (`doc/CSBwin-src/Objects.h:220`).

Only `mon_DethKnight` sets the cursed flag on its droppings
(`doc/CSBwin-src/Code11f52.cpp:712`), and a monster type absent from the switch drops nothing
at all via its `default: return`.

## `Byte10340[4]` is the group facing byte for an unattached monster

The first four bytes of `graphics.dat` item `0x22f` are `0x00 0x55 0xaa 0xff` — each a
direction replicated into all four 2-bit fields. `MonsterFacingByte` returns
`d.Byte10340[pDB4->facing()]` when the group has no `ITEM16`
(`doc/CSBwin-src/Code11f52.cpp:229`), because such a group faces one way as a whole rather
than per member.

## `DamageMonster`'s `P6` parameter defers the droppings rather than suppressing them

With `P6 == 0` the group is not removed and `CreateAndDropObject` is not called; instead the
dead member's position is pushed onto `d.Byte13050[d.Word13046++]`
(`doc/CSBwin-src/Code11f52.cpp:762`) and `TAG00b522` (`:802`) drops them once the monster has
finished moving. This is how a monster killed mid-move leaves its remains at the destination
rather than the origin.

## `MoveObject`'s monster return value encodes the `ITEM16` slot

`doc/CSBwin-src/Code11f52.cpp` returns `LOCAL_14` from the monster branch (`:3423`), or 1 from
an earlier `return (1)` when the group left the dungeon (a missile on the way out, `:2852`; a
fatal fall or a forbidden level, `:3171`; abeyance, `:3356`). Every caller treats any non-zero
value alike. `LOCAL_14` is 0 for a plain step, `TeleportMonster`'s value after a teleport (1,
or `groupIndex + 2` for a fear-state-6 group on the party's level, `:2377-2384`), 1 after a
detach, and one more after an attach. A value above 1 selects the slot handed to
`ClearAttacking_DeleteMovementTimers` (`:3413`). The whole derivation, and the slot-0 quirk
it leads to, is under "What `MoveObject` returns for a monster, and the AI stops on anything
but 0".

## A monster whose destination is occupied is parked, not dropped

`doc/CSBwin-src/Code11f52.cpp:3336-3359`. When the destination square holds the party or
another monster, CSBWin deletes the group's movement timers, detaches its `ITEM16`, and calls
`CreateMovementTimer` — putting it on a `TT_60` (silent) or `TT_61` (audible) timer that
retries every 5 ticks (`ProcessTimer60and61`, `doc/CSBwin-src/Timer.cpp:2566`). The comment
at `MoveObject`'s head calls this "abeyance".

`ProcessTimer60and61` has one special case: `mon_LordChaos` gets a 25% chance per retry to
step one square at random and try there instead, provided the new square is open, a
teleporter, a pit or a door (`OpenTeleporterPitOrDoor`, `doc/CSBwin-src/Timer.cpp:625`). That
is how he escapes a corner he has been walled into.

## Monster AI timers are addressed by map square, and only a DSA move re-aims them all

Timer types 29-41 are found by `uByte6`/`uByte7` (`doc/CSBwin-src/Monster.cpp:1320-1327`).
`MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:3327-3424`) never re-aims
them: it starts fresh ones and deletes the old square's only when the `ITEM16` was
attached, detached or teleported (`LOCAL_14 != 0`, `:3402-3421`). The AI's own steps
(`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`) re-aim just the timer being processed,
`timer_70`, to `d.NewX` / `d.NewY` once `MoveObject` returned 0, so any other AI timer of
the group stays at the square it left. Only a DSA cell move rewrites them all in place,
when `MoveObject` returned 0 (`doc/CSBwin-src/MoveObject.cpp:539-571`):

```cpp
if (pTimerA->timerUByte6() != srcLocr.x) continue;
if (pTimerA->timerUByte7() != srcLocr.y) continue;
pTimerA->timerUByte6(ub(locr.x));
pTimerA->timerUByte7(ub(locr.y));
```

Evidence: `tools/dump-monster-pad.ts` section 5, `tools/dump-dsa-move.ts` section 6.

## `CheckMoveFromMissile` reports only a total wipe-out

`doc/CSBwin-src/Code11f52.cpp:2740-2746` — it returns 1, making `MoveObject` abandon the move,
only when `d.MonsterDamageResult == 2` (`ALL_MONSTERS_DIED`):

```cpp
gameTimers.DeleteTimer(saveTimerIndex);
if (d.MonsterDamageResult == 2)
{
  return (1);
};
```

A missile that kills *some* of the group does not stop the move. `d.MonsterDamageResult` is a
global precisely because the call chain between `DamageMonster` and here carries no return
value.

## Only `MissileTimer` writes the missile filter's globals, and the timer copy outlives it

`doc/CSBwin-src/Timer.cpp:176-177` declares `RN missileFilterObject = RNnul;` and
`TIMER missileFilterTimer;`. `MissileTimer` copies the timer it runs into the second
(`:220`) and points the first at its missile (`:221`). Each of its six exits sets
`missileFilterObject = RNnul` (`:254`, `:272`, `:287`, `:362`, `:416`, `:427`), and none
touches the copy. Nothing else in the tree writes either: outside `Timer.cpp` they appear
only in `MissileEncounterFilter`, which reads the copy's direction as the DSA's parameter 6,
`BITS10_11(missileFilterTimer.timerWord8())` (`doc/CSBwin-src/Code11f52.cpp:1681`).
`CheckMoveFromMissile` (`:2530-2776`) uses neither.

So the filter's parameter 6 is the direction of the last missile `MissileTimer` ran, also
for an encounter no missile timer caused: a party or a monster walking away from a missile,
or `CheckMonsterVersusMissiles`. It is 0, the zeroed global's, before any missile has
flown. A move made from inside a missile timer, by a filter's DSA, still checks the
missiles it leaves. `tools/dump-move-from-missile.ts` checks both.

## While `MissileTimer` runs, its missile names timer 0xffff, which is the copy

`MissileTimer` sets the missile record's `timerIndex(0xffff)` before anything else
(`doc/CSBwin-src/Timer.cpp:224-226`; the index it saves there is never read again), and
only its last line gives the record a real index again, the one `SetTimer` returns for
the copy (`:428`). `GameTimers::pTimer(0xffff)` returns `&missileFilterTimer`, and dies
if `missileFilterObject` is `RNnul` (`:700-714`). The copy's function is already
`TT_Missile` on the first tick (`:231-234`).

So everything that looks the missile's timer up from inside `MissileTimer` reads the copy:
`MoveObject`'s `d.NewDir` for the missile's own move (`Code11f52.cpp:2891-2898`), and
`CheckMoveFromMissile`'s function test (`:2720`), which therefore meets a missile in its
first tick in a corner someone leaves. A hit there calls `DeleteTimer(0xffff)` (`:2742`),
which writes `m_timers[0xffff]`, outside the array (`Timer.cpp:965`): undefined. The port
answers the index with the copy the same way (`TimerQueue.getTimer`) and its
`deleteTimer(0xffff)` deletes nothing. `tools/dump-move-from-missile.ts` case 3 checks the
encounter, and `tools/dump-missile-teleport.ts` the direction a teleporter turns, which is
the copy's.

## `item16Attached` is a conjunction, not a lookup

`doc/CSBwin-src/Code11f52.cpp:3122`:

```cpp
item16Attached = (AttachedLevel_4 == d.partyLevel) && (oldX>=0);
        // proper level && oldX>=0 means ITEM16 exists
```

`oldX < 0` is CSBWin's way of saying "this object is not currently in the dungeon" — it is
being placed rather than moved — so it cannot have a slot yet whatever level it is going to.

## Fear state is the monster AI's whole personality

`ProcessTimers29to41`'s type-37 branch (`doc/CSBwin-src/Monster.cpp:4106-4452`) dispatches
almost entirely on `DB4.fear()`:

| State | Behaviour |
| --- | --- |
| 0 | Calm. If the party is unseen, hunt it by smell; otherwise close in |
| 2 | Calm, but seeing the party only makes it wait a move interval |
| 3 | Calm; seeing the party at range flips it to 7 |
| 5 | Fleeing — `Try_To_Move` runs *away* from the party |
| 6 | Broken formation: each member has its own timer and acts alone |
| 7 | Charging: head straight for the party's last known square |

Only `MaybeDelTimers_Fear6_TurnIndividuals` (`doc/CSBwin-src/Monster.cpp:1436`) creates the
per-member `TT_MONSTER_B<n>` timers, and it sets fear to 6 as it does — which is why
`DamageMonster` only renumbers those timers in state 6.

## A fleeing monster moves faster than a hunting one

`Try_To_Move` (`doc/CSBwin-src/Monster.cpp:2196`) and `D4D0Finish`
(`doc/CSBwin-src/Monster.cpp:2561`) both shorten the move interval before running:

```cpp
timePerMove = sw(timePerMove - timePerMove/4);   // Try_To_Move: flee at 3/4 the interval
timePerMove = sw((timePerMove + 1)/2);           // D4D0Finish: charge at half
```

`Try_To_Move` also turns the direction to the party 180° — both the primary *and* the
secondary — so a frightened monster runs directly away.

## `w_54 == -1` means "a move was deferred, not skipped"

Every movement path computes `D4W = timePerMove/2 - w_54; bool_36 = D4W <= 0`
(`doc/CSBwin-src/Monster.cpp:2404-2423` and elsewhere). When enough time has passed the
monster steps and `bool_36` is true; otherwise `timePerMove` is *replaced* by the remaining
time and `w_54` is set to -1, which then suppresses the random re-facing in
`Turn_Monsters_As_Group` and stops `Process_Invincible_And_Finish` retrying.

## `Process_Invincible` calls `FindPossibleMove` for its side effects

`doc/CSBwin-src/Monster.cpp:1638`: the return value is discarded. The call is there because
`PossibleMove` populates `d.FluxCages[]` and `d.FluxCageCount`
(`doc/CSBwin-src/Monster.cpp:705-721`), which the three tests immediately below it read.
Delete the call as dead and Lord Chaos stops noticing Fluxcages.

An invincible monster also moves **two squares at a time** — `PossibleDoubleMove`, and
`mapX + 2*DeltaX` — and buzzes on arrival with sound ordinal 17.

## The pre-melee sidestep has a deliberately dead branch

`doc/CSBwin-src/Monster.cpp:3956-3960`: a lone monster about to melee has a 50% chance to
take a branch whose only statement is commented out in CSBWin:

```cpp
if ( (indexOfLastMonster == 0) && (STRandomBool() != 0) )
{
  //                  pI16A2->uByte3 = 0xff;
}
```

The branch still consumes its `STRandomBool()`, so removing it would desynchronise the random
stream from CSBWin's even though no state changes. Ported as written.

## `MonsterAttacks` decides *how* to attack before it attacks

`doc/CSBwin-src/Monster.cpp:944` does not deal damage directly. It fills in an
`attackParameters` block — target, missile or melee, which missile, range, damage, sound —
hands the whole block to the Monster Attack Filter DSA, which may rewrite any field
(`:1160-1166`), and only then acts on it. That is why the parameters are a struct rather
than locals, and why the port keeps them as one object.

Two ways a target is chosen. A `word2Bit4` monster picks a *random* live champion, walking
forward from `STRandom0_3()` until it finds one; everything else uses
`GetCharacterToDamage`, which only reaches the party when adjacent
(`doc/CSBwin-src/CSBCode.cpp:6899`) and takes the first live champion in the order
`Byte586` gives for that side. CSBWin's comment on the random path is worth keeping: "For
four years we didn't increment heroToDamage!"

## Only some monsters throw, and each type throws its own thing

`monsterShouldLaunchMissile` requires `word14_12_15 > 1` *and* either distance above 1 or a
coin toss (`doc/CSBwin-src/Monster.cpp:1034-1036`) — so a thrower next to you sometimes
punches instead. The missile is fixed per type (`:1040-1075`): Vexirk and Lord Chaos roll
between a fireball and one of four spells, Slime Devils spit poison, Flying Eyes throw
lightning seven times in eight, Zytaz alternate poison cloud and fireball, Demons and
Dragons breathe fire. Everything else has no missile at all: `missile` starts as `RNnul`
(`:1041`), so the block's `missileType` is 0xffff, not 0 (`:1076`), and the launch switch,
which lets only the seven spell RNs through, skips it (`:1179-1191`). Checked by
`tools/dump-monster-missile-type.ts` over every monster type in the shipped dungeon.

## A giggler's blow steals only from the ready hand

A giggler's attack (`monsterShouldSteal`, `doc/CSBwin-src/Monster.cpp:1080`) goes to
`StealFromCharacter` (`:239`) instead of `MonsterDamagesCharacter` (`:1231-1234`). It makes
`100 - Quickness` worth of tries, twenty a try, while the champion is not lucky
(`IsCharacterLucky(pcA2, D7W)`, so the luck needed falls as the tries go). Each try looks
at slot `d.uByte13126[D5W]`, `D5W` starting at `STRandom(8)` and stepping by one, and a slot
of 13 would be a random backpack slot, `13 + STRandom(17)` (`:254-258`). A filled slot is
emptied with `RemoveCharacterPossession` onto the group's possessions: as the head when it
has none, else by `AddObjectToRoom` with no cell, which clears the object's link and hangs
it off the last object of the chain (`doc/CSBwin-src/Code11f52.cpp:428`, `:491-499`). Then
an unused `STRandom(8)`, and one time in eight, or on `STRandomBool` when something was
taken, the group's `ITEM16.uByte5` becomes `STRandom(64) + 20` and its fear state 5
(`Monster.cpp:277-285`).

`d.uByte13126[8]` is never written. Its only reference is that read. `DBank::Initialize`
zeroes all of `d` (`doc/CSBwin-src/CSBCode.cpp:329`), none of the four graphics loaded
into `d` reaches it (`CSBCode.cpp:10125-10162`; the nearest, `0x231` and `0x22f`, span
addresses 18936-16885 and 10340-7255), and
it lies below the 3328 bytes of the save's character block (`Data.h:765-785`). So every
try names slot 0: a giggler takes what is in the ready hand, or nothing, and the backpack
arm never runs. Checked by `tools/dump-giggler-steal.ts`.

## Two independent chances to avoid a blow entirely

`MonsterDamagesCharacter` (`doc/CSBwin-src/Monster.cpp:4536-4545`) checks, before rolling any
damage:

```cpp
D0W = sw(Quickness(chA2));
D1W = sw(STRandom(32));
D3W = mtDesc.dexterity12;
D1W = sw(D1W + D3W + w_2 - 16);
if ( (D0W >= D1W) && (STRandom0_3() != 0) ) return 0;
if (IsCharacterLucky(chA2, 60)) return 0;
```

Being quicker than the monster is not enough on its own — it still needs a 3-in-4 roll. A
**sleeping** party is woken by the blow *first* — `if (d.PartySleeping != 0) WakeUp();`
(`doc/CSBwin-src/Monster.cpp:4531`) — so by the `if (d.PartySleeping == 0)` guarding both
checks (`:4536`) it is awake (`WakeUp` clears it, `CSBCode.cpp:7051`), and it gets them
like anyone else.

`IsCharacterLucky` (`doc/CSBwin-src/Character.cpp:2165`) then moves Luck by 2 in the
*opposite* direction to the outcome: down when it saved you. Luck is spent by using it.

## The damage formula is deliberately many-stage

`doc/CSBwin-src/Monster.cpp:4561-4580`: a base of
`2*experienceMultiplier + Random(16) + attack10`, less twice the champion's Fighter mastery;
if that lands at 1 or below there is a 50% chance of no damage at all and otherwise a floor
of `Random(0..3) + 2`. Then halve, add two random terms, add another random term, quarter,
add `Random(0..3) + 1`, and on a coin toss subtract `Random(damage/2 + 1) - 1`.

No shorter form reproduces the distribution, so it is ported step for step.

## Wounds come from the blow exceeding a vitality-scaled threshold, then doubling

`doc/CSBwin-src/Character.cpp:2789-2803`. The threshold starts at
`TAG016426(char, Vitality, Random(128) + 10)` and **doubles** each time a body part is
marked, so one large hit can wound several places and a small one wounds none:

```cpp
D6W = TAG016426(pcA3, 4, D0W);
if (D7W > LOCAL_10)
{
  do
  {
    LOCAL_20 = sw(STRandom(8));
    D1W = sw((1 << LOCAL_20) & mask);
    d.PendingOuches[chIdx] |= D1W;
    D6W <<= 1;
    ...
```

Note the candidate bit is `1 << Random(8)` masked by the monster's wound mask, so a roll
outside the mask marks nothing that round. Measured against the shipped data: 163 of 200
hits of 300 damage wound, 0 of 200 hits of 6.

## `TAG016426` has a second branch for very high attributes

`doc/CSBwin-src/Character.cpp:2060-2062`: when `170 - attribute` falls below 16 — an
attribute above 154 — the function divides by 8 flat instead of scaling:

```cpp
if (D7W < 16) { D0W = sw(P3 >> 3); }
else { D0W = ScaledMultiply(P3, 7, D7W); }
```

Easy to miss, and it only shows up on a champion with an exceptional stat.

## Champion bones carry `value = 2` and the champion's own party position

`KillCharacter` (`doc/CSBwin-src/Character.cpp:2626-2645`) drops all possessions, then makes
a `misc_BonesOfHero` with `important(true)` and `value(2)` — the 2 is what distinguishes a
dead champion's bones from an ordinary bones item. The object's position within the cell is
set from `pcA3->charPosition`, so the bones appear where that champion stood, and
`expool.AddChampionBonesRecord` records the bones↔fingerprint pairing for resurrection.

The bones are set down with `MoveObject(objD4, -1, 0, d.partyX, d.partyY)`, exactly as
the possessions are, so over an open pit they fall to the level below; the expool record
is added afterwards, unconditionally, with the same `objD4`, so it pairs the bones wherever
they came to rest. Evidence: `tools/dump-champion-death.ts` section 7 (2 of 49 checks fail
before C31's fix).

Unconditionally also means whatever the fingerprint: `AddChampionBonesRecord` stores
`fingerprint & 0xffff` with no test (`doc/CSBwin-src/data.cpp:1636-1643`), so a fingerprint
of 0 — `AddCharacter`'s for a champion recruited at level 0, (0, 0)
(`Character.cpp:513-516`) — pairs the bones like any other. Evidence:
`tools/dump-vi-altar.ts` section 1b (2 checks fail before the fix).

## `EXPOOL` is a directory block, free lists by record length, and 32 hash chains

`EXPOOL`, database 11, is an array of 256-byte `DB11` blocks
(`doc/CSBwin-src/CSB.h:1280-1288`) which `class EXPOOL` addresses as one array of
longwords, `m`, 64 to a block (`doc/CSBwin-src/data.cpp:1507-1675`). In a file every
longword is big-endian (`DB11::swap`, `data.cpp:1458-1467`), and a block's first is its
link, always `RNeof`, over its `size`.

- **Block 0 is the directory**, made by `Setup` with `size` 0 when the database has no
  block (`:1507-1522`), which `ReadDatabases` calls last (`doc/CSBwin-src/SaveGame.cpp:2773`).
  `m[n]`, for `n` from 2 to 31, heads the free list of the records of `n` longwords, and
  `m[32]` to `m[63]` head the hash chains, a key's being `32 + ((key * 0xbb40e62d) >> 27)`.
  A head with bit 31 set names a second table of 64 heads, indexed by the hash's next six
  bits; `Write`, `Read` and `Locate` all follow one, and nothing in the source makes one.
- **Every other block holds records of one length**, its `size`: `enlarge(size)` appends
  a block and cuts it into `63 / size` records, each a link, the key, and `size - 2`
  longwords of data (`:1610-1633`).
- **`Write(key, record, size)`** takes the first free record of `size + 2` longwords,
  after an `enlarge` if there is none, and puts it at the head of the key's chain
  (`:1530-1547`). It replaces nothing: two records may share a key, and the newer is the
  one found. `size` is 29 at most. Conflux 3.5's `dungeon.dat` holds such records: 57
  keys have from 2 to 9 records each, and the copies differ in 43 of them. All 57 are
  `EDT_Database` keys: 27 `EDBT_MonsterNames`, 28 `EDBT_AltMonGraphics` and both
  `EDBT_GlobalVariables` keys, whose 9 and 4 records `tools/dump-dsa-save.ts` counts. Its
  pool has no second table.
- **`Read`** returns the key's first record and hands its longwords back to the head of
  their free list (`:1549-1575`); **`Locate`** leaves the record where it is
  (`:1582-1608`). Both return the record's length, or -1.

`SaveGame` `Read`s and `Write`s 24 palette records of 16 longwords, keys
`(EDT_Palette << 24) + i`, into the pool at every save (`SaveGame.cpp:1152-1164`), so
every CSBWin save has them. They are the overlay palette's 1536 bytes, red, green, then
blue, 512 of each, copied into the pool's native longwords: a file's `DB11::swap` writes
each with `LE32` (`data.cpp:1458-1467`), so a longword read big-endian is its four bytes
taken little-endian. A read takes them back only when all 24 are there, and otherwise
keeps the palette it has (`SaveGame.cpp:1761-1789`), which is the identity
`ClearOverlayPalette` makes (`data.cpp:117-145`), since `d.Initialize()` clears it
(`CSBCode.cpp:482`) before every read (`CSBCode.cpp:11356`, `Code1f9e6.cpp:309`). Every
committed save holds that identity. Evidence: `tools/dump-dsa-save.ts` section 8. `src/data/CsbwinExpool.ts` is the port, over the file's bytes.
Evidence: `tools/dump-expool.ts`. Seven of the eight committed saves hold those 24
records and nothing else, and 24 writes into an empty pool give their 2304 bytes exactly:
the directory, the eight blocks of three records, every link and chain. `csbgame7.dat`
holds them among others, and CSBWin's loop run over each of the eight leaves its bytes as
they were.

## The DSA global variables are the `EXPOOL` records a read finds

`numGlobalVariables` is not a constant. Every game read, a new game's from `dungeon.dat`
as a save's (`goto tag01eec4`, `doc/CSBwin-src/SaveGame.cpp:1533`), clears the globals
and `Locate`s `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i` for `i` from 0:
each record of at least sixteen longwords gives sixteen globals, their values with them,
and the first one missing or shorter ends the count (`:1746-1760`). A dungeon editor
makes those records; nothing in CSBWin's source writes one. So a dungeon with none has no
global variable, and `GLOBALSTORE` and `GLOBALFETCH` refuse every index, the fetch giving
`0xcdcdcdcd` (`doc/CSBwin-src/DSA.cpp:1268-1275`, `:1302-1311`). Conflux 3.5's
`dungeon.dat` has two records, so 32 globals, the first eight `0, 1, 0, 1, 3, 3, 3, 3`;
3D2D1D's and every save of `tools/fixtures/` have none.

`SaveGame` copies the globals back through `Locate`'s pointer, sixteen to each record
(`SaveGame.cpp:1141-1148`), so a record keeps its place in the pool and a save adds
none. A record missing or shorter than sixteen gets the message "Error saving global
variables".

The DSAs go in the Extended Features block, behind the object maps, when `numDSA`
(`countDSAs`, `:935`) is not 0 (`:989-992`): `WriteDSAs` writes each DSA's number and
`DSA::Write`'s fields, through `WCS`, which sums every byte as `FormChecksum` does from
`0xffff`, and closes with that sum (`:767-780`, `doc/CSBwin-src/DSA.cpp:5672-5695`,
`:5764-5805`, `doc/CSBwin-src/data.cpp:1796-1869`). `m_description` is written whole, 80
bytes. Conflux's 131 DSAs written so are its file's section, byte for byte, the string's
tail zero in every description. Evidence: `tools/dump-dsa-save.ts`.

## A champion bones record is keyed by the bones' slot in the object indirect index

`AddChampionBonesRecord` writes one longword, `fingerprint & 0xffff`, under the key
`(EDT_ChampionBones << 24) | bonesObject.ConvertToInteger()`
(`doc/CSBwin-src/data.cpp:1636-1643`, `CSB.h:1571`), and `ConvertToInteger` is the RN's
`indirectIndex` (`doc/CSBwin-src/CSBTypes.h:371`): the slot, not a packed RN, and in a
save the file's own numbering (see "An RN in a save file is an indirect index"). A slot
keeps its number when the object moves within its cell, since the position is in
`dataTypeMap` (`CSBTypes.h:336-342`).

`ProcessTT_ViAltar` takes the record with `GetChampionBonesRecord`, a `Read`
(`doc/CSBwin-src/Timer.cpp:2750`), and does so before it looks at the champion: bones it
then refuses, their champion alive (`:2759`) or in no wings (`:2775`), stay on the
floor with no record, and a later offering reads their `value` as the champion's index
(`:2788`). `tools/dump-vi-altar.ts` section 3b stages it. `DropObject`, `DescribeObject` and
`DrawNameOfHeldObject` copy it with `CopyChampionBonesRecord`, a `Locate`
(`Mouse.cpp:903`, `Character.cpp:3563`, `Code11f52.cpp:49`). Each wants a record of
exactly one longword.

The port keys the record by the bones' RN, its slot, and reads and writes `EXPOOL` as
the file has it. Evidence: `tools/dump-vi-altar.ts` section 7 saves a game with bones on
the floor, finds the record in the file's own pool under the bones' slot (1947), which
the file's index names as the bones' record, and resurrects from it in a game that loads
the file. Four of the committed saves (`csbgame3`, `4`, `6` and `7`) have a block of
three-longword records, the length of a bones record, with every record free.

## `KillCharacter` is the only way a champion's hit points reach zero

Nothing in CSBWin assigns `HP(0)` outside `KillCharacter` (`doc/CSBwin-src/Character.cpp:2526`).
Every path that can kill goes through `DamageCharacter` (`:2703`), whose blow the tick's
`DisplayCharacterDamage` then takes off the HP, calling `KillCharacter` when it would reach
zero (see "`DamageCharacter` only adds to `d.PendingDamage`" below). `KillCharacter` drops
the possessions, leaves the bones, moves the cursor and the magic tab, and sets
`d.GameIsLost`. Two are easy to miss because they do not look like attacks:

- `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4413`) clamps stamina at zero and turns
  the **overshoot** into `DamageCharacter(chIdx, overshoot/2, 0, 0)`. Mask and kind are
  both zero, so exhaustion ignores armour and cannot wound — but it kills.
- `ProcessMissileEncounter`'s party arm (`:1947-1958`, `:2044-2056`) resolves the corner
  the missile arrived at with `CharacterAtPosition` — returning if it holds nobody
  living — and applies `DamageCharacter(chIdx, damage, 12, d.Word12964)`. The wound mask
  **12** is a literal: a missile can mark the torso and the legs, nothing else.

The missile is spent either way. A dispel missile does a champion no damage at all and
still lands, because the consume happens after the `if (D4W != 0)` block, not inside it.

## `DetermineMagicDamage` returns three things, two of them through globals

`doc/CSBwin-src/Code11f52.cpp:1557`. It returns the damage and leaves `d.Word12962` (a
poison strength) and `d.Word12964` (the `DamageCharacter` *kind*) behind. The arms are
not variations on one formula, and the `kind` identifies which one a projectile took:

| projectile | kind | damage | poison |
| --- | --- | --- | --- |
| a thrown weapon | 3 | `WEAPONDESC.uByte3` + weight/2 | — |
| anything else thrown | 3 | random 0-3 + weight/2 | — |
| `RNPoison` (cloud) | **3** | (0..15) + (0..31) | that first roll + 10 |
| `RNDispellMissile` and up | 5 | **0**, returns early | — |
| `RNPoisonBolt` | 5 | **1**, returns early | the whole remaining range |
| `RNLightning` | 7 | 5 × (2×(0..15) + 10) | — |
| any other spell | 1 | 2×(0..15) + 10 | — |

`RNPoison` is the trap: it is handled *before* the kind is ever changed, so a poison
cloud keeps the default 3 while every other spell does not. The common tail then folds
in the remaining range and floors the result at half itself, so a nearly spent missile
still stings.

## The spell RNs have a gap at `0xff85`

`doc/CSBwin-src/CSBTypes.h:236-249`. `RNFireball` 0xff80, `RNPoison` 0xff81,
`RNLightning` 0xff82, `RNDispellMissile` 0xff83, `RNZoSpell` 0xff84, then **nothing at
0xff85**, `RNPoisonBolt` 0xff86, `RNPoisonCloud` 0xff87. Counting through the enum
instead of reading the values gives `RNPoisonBolt` = 0xff85 and everything after it is
wrong; assuming `RNPoison` and `RNPoisonBolt` are adjacent gives the same result. They
live in `src/core/spellRn.ts` once, for that reason.

## `OBJ_NAME_INDEX` is commented in hex, and both places bones are named do the lookup

CSBWin's object-name enum (`doc/CSBwin-src/Objects.h:438-659`) carries its values as **hex**
comments, sometimes with the decimal beside them and sometimes not:

```cpp
objNI_OpenChest,      //91
objNI_Bones_a,        //93
objNI_Moonstone,      //7a 122
```

So `objNI_Bones_a` is 0x93 = **147**, not 93. Nine of `src/core/objectNameIndex.ts`'s
constants had been read as decimal or taken off the neighbouring line. The name table in
`graphics.dat` is the arbiter — `tools/dump-object-name-index.ts` asserts the string each
constant lands on, which is the only thing that tells a right index from a plausible one.

Two of the enumerators are named for the item's *powered* form while the table holds the
plain one: `objNI_Storm_a` (23) is `BOLT BLADE` and `objNI_RABlade_a` (25) is `FURY`. Each
modifiable object owns two or three consecutive slots that all carry the same name; only
the icon changes with the charge (`doc/CSBwin-src/data.cpp:627-660`).

**Bones are named in two places, and both do the same four-step lookup**: the eye's object
panel (`doc/CSBwin-src/Character.cpp:3549-3580`) and `DrawNameOfHeldObject`
(`doc/CSBwin-src/Code11f52.cpp:31-59`), the 14-character line at screen (0xe9, 0x25) naming
what the cursor carries. Both key on the **name index** being `objNI_Bones_a` — not on the
`DB10` misc type — both refuse bones whose `value()` is 0, and both prefix the champion's
name with no separator: `StrCpy(name); StrCat(d.ObjectNames[objNID6])` gives `HALKBONES`.
`DrawNameOfHeldObject` uses `RN::NameIndex()`, the resolved index, so a compass in hand
reads the way the party faces and a lit torch reads its burn state.

## `DescIndex`, `GetBasicObjectType` and `NameIndex` — three steps, three sentinels

Ported once, in `src/engine/objectIndex.ts`; `tools/dump-object-index.ts` asserts them over
every record of `dungeon.dat`.

- **`RN::DescIndex`** (`doc/CSBwin-src/data.cpp:568-600`) returns -1 for `RNempty`, which is
  **0x0000** (`doc/CSBwin-src/CSBTypes.h:249`) — not `RNnul` (0xffff, `:238`) nor `RNeof`
  (0xfffe, `:237`). Those two fall to the `default` arm anyway, since their `dbType()` is
  15. A chest's row is `BITS1_2(word4) + objDI_Chest` (`:582`), not a constant 1; a
  scroll's is `objDI_Scroll` without reading the record at all.
- **`GetBasicObjectType`** (`doc/CSBwin-src/CSBCode.cpp:1245-1258`) tests `RNnul` itself,
  then answers `objNI_NotAnObject` (0xff) for a -1 row, else `d.ObjDesc[row].objectType()`.
  A scroll's basic type is `objNI_OpenScroll` (30): only `NameIndex` turns a closed one
  into `objNI_Scroll`.
- **`RN::NameIndex`** (`doc/CSBwin-src/data.cpp:612-700`) is the only one of the three
  that reads object *state*: compass + `d.partyFacing`, lit torch + `d.Byte640[charges]`,
  closed scroll, a waterskin / Illumulet / Jewel Symal whose `value()` (`BITS14_15(word2)`,
  `doc/CSBwin-src/CSB.h:1273`) is non-zero, and the six charged weapons.
- **Who uses which.** `DetermineMastery` reads the weapon and the neck through
  `NameIndex` (`doc/CSBwin-src/Code17818.cpp:76`, `:98`), and so does `MaxLoad` for the
  feet (`doc/CSBwin-src/Code11f52.cpp:4303`). `DoesPartyHave`
  (`doc/CSBwin-src/Code11f52.cpp:3623-3670`) uses `GetBasicObjectType`, and opens every
  carried chest to compare its contents too.

## The cast button passes `CastMagic` no mana cost

`doc/CSBwin-src/Magic.cpp:564`: `d.clockTick = CastMagic(0);` — the argument is an unnamed
`const i32` (`Magic.cpp:928`). The mana was already spent rune by rune as the incantation
was built, so casting totals nothing.

## A rune's mana is truncated to a whole point

`TAG01b990` (`doc/CSBwin-src/CSBCode.cpp:8970-8980`) costs a rune `Byte19010[6 * step +
button]`, and for any rune after the first multiplies it by `Byte19016[first - 96]` (8, 12,
16, 20, 24 or 28) and shifts right by 3. An odd base after UM, EE or MON therefore drops
half a point: VI after UM costs `(3 * 12) >> 3 = 4`, not 4.5. A cost above `Mana()` refuses
the rune whole; `BackspaceMagicSelection` gives nothing back (`Magic.cpp:806-822`).
`tools/dump-magic-panel.ts` checks all 36 second-rune costs.

## The caster tabs are hit-tested by fixed x ranges

`_HandleMagicClick` (`doc/CSBwin-src/Magic.cpp:596-699`) does not search a button list for
the tabs: for `clickY <= 48` it picks a champion from literal x ranges for each
`d.MagicCaster`, which match the tabs `DrawSpellControls` draws (`Character.cpp:4984-5087`),
so the caster's own wide tab and the two-pixel gaps pick nobody. With the fourth champion
casting, the first champion's range is `clickX <= 244`. `clickX` 512-515 name champions 0-3.
Either way the click returns without reaching the keypad, and the pick counts only below
`d.NumCharacter` and past `SelectMagicCaster`'s dead-champion refusal (`:724`).

## Every inventory click is gated on `d.HandChar`, and the party always owns it

`doc/CSBwin-src/Mouse.cpp:1600-1606` — the button ids 28 to 65, which are the inventory
slots and the two hands of each champion, only reach `HandleClothingClick` when somebody
owns the mouse cursor:

```cpp
if ((D6W>=28)&&(D6W<66))
{
  if (d.HandChar != -1) //owner of cursor
  {
    HandleClothingClick(D6W-20);
  };
```

The chest area gates the same way (`doc/CSBwin-src/CSBCode.cpp:8509-8511`, via
`D4W = (d.HandChar == -1) ? 1 : 0`). `HandleClothingClick` itself
(`doc/CSBwin-src/CSBCode.cpp:6928`) does **not** test it, and neither does the
party-block path that reaches it through `TAG019c34`
(`doc/CSBwin-src/CSBCode.cpp:8376-8381`) — so the gate belongs to those two callers only.

That makes `SetHandOwner` (`doc/CSBwin-src/CSBCode.cpp:8390`) load-bearing rather than
cosmetic, and CSBWin never leaves a formed party without an owner. It is set:

| where | when |
| --- | --- |
| `Character.cpp:706-710` | `if (d.NumCharacter == 1) SetHandOwner(0)` — the first champion to join |
| `CSBCode.cpp:6787-6791` | same rule at the end of resurrect/reincarnate |
| `Character.cpp:2684-2686` | `if (chIdx == d.HandChar) SetHandOwner(D5W)` — the owner died, D5W is the first living champion |
| `CSBCode.cpp:8366`, `:8374` | the player clicks a party block, or one of its sub-buttons 16-19 |
| `CSBCode.cpp:6641-6644` | `SetHandOwner(-1)` when the last champion is cancelled out of the mirror |
| `SaveGame.cpp:1020`, `:1636` | saved as `gb2.handChar`, restored into `d.HandChar` |

`SetHandOwner` refuses a champion whose `HP()` is 0 (`:8396`) and sets the new owner's
`facing` to the party facing (`:8417`). Its `load` arithmetic — the object in hand is
weighed against whoever holds the cursor — has no counterpart in this port, which
recomputes a champion's load from its possessions instead of tracking it incrementally.

## Not every preset hero starts with possessions

DAROOU's `HeroInventoryItem[]` in `dungeon.dat` is empty; HALK's holds four records and
WU TSE's six. A test that takes "the first preset hero" and expects something in a slot
is testing the wrong hero, not a broken `assignPresetHeroPossessions`. HALK's weapon hand
is rn 37976, `WEAPON#88` — the same record `tools/dump-level-items.ts` finds lying in
HALK's mirror cell (7,8) on level 0.

## `WEAPONDESC` is six bytes, and only the first was being read

`weapons[46]` in graphic `0x22f` (absolute 8658) holds a `WEAPONDESC`
(`doc/CSBwin-src/CSB.h:1349`): `weight`, `uByte1`, `uByte2`, `uByte3`, `word4`. The port
read byte 0 and skipped the rest, which is why every consumer of the other three had to
be estimated.

The weight column is the canary that the base and stride are right — it reproduces the
weights Dungeon Master's own manual prints: arrow 0.2 kg, throwing star 0.1, rock 1.0,
sling 1.9, crossbow 2.8, club 3.6, axe 4.3.

`uByte1` is a class number that selects which skill a throw draws mastery from
(`doc/CSBwin-src/Character.cpp:2331-2353`), and it partitions the shipped weapons
exactly along Dungeon Master's fighter skills:

| `uByte1` | skill | weapons |
| --- | --- | --- |
| 0 or 2 | 4, Swing | swords, axes, maces, clubs |
| 1-15 (not 0) | 10, Throw | arrow, slayer, rock, poison dart, throwing star |
| 16-111 | 11, Shoot | bow, crossbow, sling |
| 112+ | none | staves, wands, the Firestaff |

`uByte2` is added straight to the throwing distance and is what makes a weapon a good
throwing weapon (throwing star 3, rock 6, club 19, axe 49). `uByte3` is the throw's
damage contribution and also the `+ uByte3 / 4` term in the throw's skill gain
(`doc/CSBwin-src/Mouse.cpp:731-735`).

## Throwing distance *rises* with weight before it collapses

`DetermineThrowingDistance` (`doc/CSBwin-src/Character.cpp:2295-2314`) is not
"heavier throws shorter". With `S = MaxLoad/16`:

| object weight | effect on the distance |
| --- | --- |
| `w <= S` | `+ w - 12` — heft **helps**, linearly |
| `S < w <= (S-12)/2 + S` | `+ (w - S)/2` — still helps, at half rate |
| beyond that | `- 2 * (w - midpoint)` — collapses, at double rate |

Measured with `tools/dump-throwing.ts` on a strength-10 champion (`MaxLoad` 180, so
`S = 11`): compass (0.1 kg) 2.9, waterskin (0.3) 3.9, cheese (0.8) 6.4, worm round (1.1)
8.0 — then bones (1.5) drops to 4.5 and a boulder (8.1) to 0.

Two more terms after that: `StaminaAdjustedAttribute` scales the lot when the champion
is below half stamina, and a wound on **that hand** — bit 1 for hand 0, bit 2 for hand 1
(`:2367-2372`) — halves it. Measured: a rock throws 31.4 from a healthy fighting hand,
15.5 with that hand wounded, and 31.3 from the *other* hand at the same moment.

## Throwing raises the skill before it reads the mastery that sets the range

`ThrowByCharacter` (`doc/CSBwin-src/Mouse.cpp:736-742`) calls
`AdjustSkills(chIdx, 10, …)` and only then `DetermineMastery(chIdx, 10)`, so a throw
that levels the skill flies that little bit further. All three missile statistics come
out of that one mastery value:

```
range     = D7 + STRandom(16) + D7/2 + mastery      (D7 = throwingDistance + weaponBonus)
damage    = ApplyLimits(40, 8*mastery + (STRandom()&31), 200)
decayRate = Larger(5, 11 - mastery)
```

`weaponBonus` is 1 for anything that is not a weapon, and `weaponDesc->uByte3` for a
weapon of class 12 or below — the throwables. Staves and wands, class 128 and up, gain
nothing from being thrown.

## `MaxLoad` is rounded down to a multiple of 10

`MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4280`) is `8 * Strength + 100`, stamina-adjusted,
less an eighth for any wound (a quarter if the torso is hurt, bit 4), plus a sixteenth for
Elven Boots in slot 5, then `+9` and rounded down to a multiple of 10. A strength-50
champion at full stamina gets exactly 500; at 10/100 stamina, 300; with a wounded torso, 380.

## A cloud's lifespan *is* its shrink rule

Every branch of `ProcessTT_25` (`doc/CSBwin-src/Timer.cpp:436`) either reschedules the
timer one tick later or falls out of the switch, and falling out is how a cloud dies —
`RemoveObjectFromRoom` then `DeleteDBEntry`. So each cloud type's shrink rule and its
lifespan are the same rule:

| type | `0xff80 +` | per tick | lives |
| --- | --- | --- | --- |
| Fireball | 0 | bursts a door (`HitDoor`), nothing else | 1 tick |
| Lightning | 2 | half damage, then the fireball branch | 1 tick |
| Dispell | 3 | damages non-material monsters only | 1 tick |
| Poison | 7 | hurts whoever stands in it, `value -= 3` while `value >= 6` | ~85 ticks |
| Monster death | 40 (`CT_DEATH`) | `value -= 40` while `value > 55` | 3-6 ticks |
| Vi altar | 100 | `cloudType++`, sound 5, always reschedules | until its type leaves range |

The renderer scales the puff by `value` (`DrawClouds` in `DrawRoomObjects.ts`, the
`max(4, (cloudScale * max(48, value+1)) >> 8)` term), so the shrink *is* the animation:
a death cloud made at 255 steps 255 → 215 → 175 → 135 → 95 → 55 and is gone, visibly
dispersing. Measured with `tools/dump-clouds.ts`; a real monster killed on level 2 leaves
a cloud of value 110, which clears in exactly 3 ticks.

The poison cut-off is tested **before** the subtraction (`:597`), so the last value a
poison cloud lives through is 3, not 6 — 255 less a multiple of 3 never lands on 6.

## `GameTimers::SetTimer` copies the timer, and that matters

CSBWin's `SetTimer(TIMER *)` copies the struct into its timer array, so a caller can
reuse one local `TIMER` as a template across a loop. `MaybeDelTimers_Fear6_TurnIndividuals`
(`doc/CSBwin-src/Monster.cpp:1476-1553`) does exactly that: it mutates one `timer_70` and
calls `SetMonsterTimerB` once per group member.

Storing the object by reference instead puts the *same* entry in the queue up to four
times, and every later mutation rewrites entries already queued behind the heap's back:
a timer whose key changes in place is out of heap order, and the head is no longer sure to
be the timer due first. `TimerQueue.addTimer` copies and mints the index, and callers must
read the queued `index` from its **return**, which is what CSBWin does at
`doc/CSBwin-src/Timer.cpp:429`.

## Skill makes a champion's blows harder, not more frequent

`DeterminePhysicalAttackDamage` (`doc/CSBwin-src/Attack.cpp:532`) decides whether the blow
connects at all with `Quickness` — dexterity, stamina and load — against the monster's
`dexterity12` plus `random(32)` plus the level's experience multiplier, less 16
(`:601-607`). **Mastery is not in that comparison.** It enters only afterwards, twice: via
`DetermineThrowingDistance`'s `2 * mastery` term (`doc/CSBwin-src/Character.cpp:2416`) and
a flat `+10` when `random(64) < mastery` (`:876-882`).

Measured with `tools/dump-player-attacks.ts`, 300 SWINGs each at the same Worm group on
level 3: a champion at skill-4 mastery 4 landed 213 blows for 798 damage; one at mastery 8
landed 212 for 915. Same frequency, a fifth more damage.

## A blow has two damage rolls, and the second is the reason weak champions can fight

If the first roll — throwing distance, scaled by `Byte19958[attackType]/32`, less the
monster's `defense08` and two `random(32)` draws — comes out at 1 or below, or the champion
could not throw at all, CSBWin does **not** return a miss (`doc/CSBwin-src/Attack.cpp:702`).
It takes a second, much noisier roll: `random(4)`, and a zero there *is* a miss, but
otherwise the running total is rebuilt from `random(16)`, `random(4)` and a 1-in-4 chance
of `max(0, random(16) + D6W)`. Both roads then meet at the same tail — halve, add noise,
halve twice more, `+random(4)+1`.

Without that branch a champion whose throwing distance cannot out-roll a well-armoured
monster's defence could never do anything at all. It is also why damage is so noisy:
`STRandom` is drawn up to nine times for one blow.

## Three named blades are special-cased in the damage formula

By `objNI_*`, not weapon type (`doc/CSBwin-src/Attack.cpp:673-698`, `:884-905`):

| blade | `objNI_` | effect |
| --- | --- | --- |
| Diamond Edge | 39 | the monster's defence term loses a quarter |
| Executioner | 43 | the monster's defence term loses an eighth |
| Vorpal Blade | 40 | the *only* weapon that can hurt a non-material monster; against anything solid its damage is halved, and a halved blow that rounds to 0 misses outright |

A non-material monster (`MONSTERDESC.word2` bit 6) is otherwise untouchable by physical
force: the whole formula is skipped and the champion spends `2 + random(1)` stamina
(`:923-945`). Only the Vorpal Blade or `atk_DISRUPT` gets past it. Measured: 60 SWINGs at
a Rive dealt 0, 60 DISRUPTs dealt 429.

## The back rank cannot swing past the front rank

`AttackWithPhysicalForce` (`doc/CSBwin-src/Attack.cpp:1093-1108`) takes
`(charPosition + 4 - facing) & 3` and acts only on values 2 and 3 — the two corners behind
the direction being attacked. It then looks one corner along for 3, two for 2, and if a
living champion is standing there the attack is abandoned with
`d.attackDamageToDisplay = -1`, which the panel flashes as "CAN'T REACH". The switch's
fallthrough is what pairs "relative 2" with "step 3": `case 2` sets `D6W = 2` and falls
into `case 3`, which increments it.

## The party's turn rotates every champion's corner *and* facing

`MoveObject` for the party (`doc/CSBwin-src/Code11f52.cpp:4085-4098`) adds the turn delta
to both `charPosition` and `facing` for every champion. Two consequences that are easy to
miss:

- A champion's own attacks aim by `pChar->facing`, not `d.partyFacing` — only the spell,
  throw and shoot attacks call `SetCharToPartyFacing` first
  (`doc/CSBwin-src/Attack.cpp:1288`). A champion whose facing never rotated keeps swinging
  in the direction the party faced when they joined.
- `(charPosition - partyFacing)` is therefore **invariant** under turning, so the corner
  marker in a champion's box does not move when the party turns.

`charPosition` is consequently *not* the champion's slot in the four portrait boxes:
`DrawAttackButton` and `DrawCharacterState` are indexed by champion number
(`doc/CSBwin-src/Character.cpp:4820`), which never moves.

**A box with no champion in it is black.** `DrawAllCharacterState` calls
`DrawCharacterState` for `i < d.NumCharacter` only (`doc/CSBwin-src/CSBCode.cpp:6831-6834`),
so boxes past the last champion are never drawn: no grey fill, no name strip, no hands.
Both ways a box empties fill it with colour 0 — cancelling a Hall of Champions candidate
(`doc/CSBwin-src/CSBCode.cpp:6641-6649`) and removing a champion
(`doc/CSBwin-src/Character.cpp:5387-5398`). A dead champion's box is not empty: it gets
graphic 8, the bones, and the name (`doc/CSBwin-src/Character.cpp:1296-1302`).
`tools/dump-marching-order.ts` checks the empty fourth box.

**Every click that names a champion names the box, never the corner.**
`HandleClothingClick` resolves the champion it acts on as `d.CH16482[D7W]`
(`doc/CSBwin-src/CSBCode.cpp:6956`), where `D7W` is `button/2` for the eight top-bar
hands and `d.SelectedCharacterOrdinal-1` for the paper doll and the backpack
(`:6933-6946`); `_HandleMagicClick` hands `SelectMagicCaster` the same kind of index
(`doc/CSBwin-src/Magic.cpp:689-696`), and so does `SetHandOwner`. Matching a click
against `charPosition` instead is invisible until the party turns and then silently
routes it to a different champion — `tools/dump-inventory-routing.ts` is the standing
check, since the inventory *drawn* is the right one either way.

## The attack menu's options are gated on mastery, the first one never

`GetLegalAttackTypes` (`doc/CSBwin-src/Character.cpp:4772`) always offers
`legalAttacks[attackClass].byte0[0]`, which is what makes every weapon usable by anybody.
Options 1 and 2 carry a required mastery in bytes 4 and 5 of the same row, and bit 7 of
that byte means "only while the object has charges left". A sword (attack class 13) offers
SWING at no cost, PARRY at mastery 2 and CHOP at mastery 3; an empty hand (class 2) offers
PUNCH, KICK and WAR CRY, all free.

`d.Byte20256` records the requirement that was met, and nothing ever reads it —
`DrawLegalAttackTypes` does not draw it.

## The attack panel keeps its last drawing until the next tick

Only two functions draw the panel under the viewport: `DrawLegalAttackTypes`
(`doc/CSBwin-src/CSBCode.cpp:8719-8794`), which fills it black and draws the buttons if
`d.Word20252` is set, else the open menu, and clears `d.Word20250`; and `_FlashAttackDamage`
(`doc/CSBwin-src/Attack.cpp:949-1042`), which draws the damage and waits `VBLDelay(15)`.
`DrawAttackButton` draws one button, and nothing while `d.Word20252` is 0
(`doc/CSBwin-src/Character.cpp:4827`). `TAG01b1c0`, which every close of the menu goes
through (the PASS and the attacks in `_ExecuteAttack`, `:4976`), draws nothing on the panel:
it sets `d.AttackingCharacterOrdinal = 0` and `d.Word20250 = 1` (`:4887-4897`). So the
closed menu stays on the screen until the next tick's `TAG01b29a`
(`doc/CSBwin-src/CSBCode.cpp:8843-8854`) flashes the damage over it, or draws the
buttons. After the flash, `d.Word20250` is still 1, so the damage stays up until the tick
after, whose `TAG01b29a` draws the buttons. `tools/dump-attack-panel.ts` checks the port.

`TAG01b29a` turns no champion to face their attacker while the party sleeps or a candidate
stands at a mirror (`d.PotentialCharacterOrdinal`, `doc/CSBwin-src/CSBCode.cpp:8808-8816`),
and leaves `maxRecentDamage` as it is, so a blow taken then turns the champion at the first
tick after. Either way it closes an open menu (`TAG01b1c0`) and stops. Asleep it stops
anyway; with a candidate it goes on to service `d.Word20250`.

## `TAG01b29a` runs after `d.Time++`, and after the put-back of a flash

The main loop's tick (`doc/CSBwin-src/CSBCode.cpp:636-688`) runs `DrawViewport` (`:638`),
`WaitForButtonFlash` (`:655`), then, while `d.GameIsLost == 0`, `d.Time++` (`:660`),
`scrollingText.ClockTick()`, `SmartDiscard(false)`, `NinetySecondUpdate` every 512 ticks,
`d.freezeLifeTimer--` (`:676-684`), `TAG01b29a` (`:685`) and `TenSecondUpdate`
(`:686-688`). `WaitForButtonFlash` waits for the VBL that puts a flashed rectangle back
(`:8561-8601`), so what `TAG01b29a` draws in a tick that flashed a button comes after the
put-back. The port's pass does not wait (`DEBT.md` H): `Game.gameTick` calls the host's
`tag01b29a` in its place and paints it at once, unless that tick asked for a put-back, in
which case the rest of the VBL paints nothing (`Game.paintHeld`) and the put-back's redraw
paints it. `tools/dump-button-flash.ts` checks the order and the held paint.

## `atk_SHOOT` throws away the damage it computes

`doc/CSBwin-src/Attack.cpp:1905-1906`:

```c
pParam->attdep.shoot.damage = 2 * (pWeapon_18->word4 + w_42);
pParam->attdep.shoot.damage = D4W;
```

`D4W` is the launcher's weapon class with 16 or 32 subtracted — a number from 0 to 15 — so
a shot's damage is its weapon class, and the mastery-scaled figure on the line above is
dead. Preserved, because it is what the real game does.

## FREEZE LIFE is capped twice

`atk_FREEZELIFE` (`doc/CSBwin-src/Attack.cpp:2043-2068`) is worth 70 from a charged item,
30 from `misc_MagicalBoxA` and 125 from `misc_MagicalBoxB` — and a box is consumed outright
rather than losing a charge. The increment is then clipped so the total cannot pass **200**,
and the final store clips again at 255. Measured from zero: 70 → 140 → 200 → 200.

## `CT_FLUXCAGE` is 50, not 7

`CLOUDTYPE` (`doc/CSBwin-src/CSB.h:1320`) is `CT_FIREBALL 0, CT_DISPELL 3, CT_OPENDOOR 4,
CT_POISON 7, CT_DEATH 40, CT_FLUXCAGE 50`. `MonsterPerception`'s fluxcage test was
comparing against 7, so an invincible monster was stopped by a **poison cloud** and walked
straight through a Fluxcage — which is the mechanism the Lord Chaos fusion depends on. The
renderer had it right (`cloudType === 50`). The constants now live in
`src/engine/cloudTypes.ts`.

## A Fluxcage is not a cloud with a life

`CreateFluxcage` (`doc/CSBwin-src/Code11f52.cpp:1515`) is not `CreateCloud`: it gets no
`TT_25`, so it never shrinks and damages nothing. It gets a single `TT_24` at
`d.Time + 100`, which removes the record and frees it — and `TT_24` does nothing at all
once `d.Word11694` (game won) is set, so the cage around Lord Chaos stays up through the
endgame.

## The eye draws over a Hall of Champions candidate's Resurrect menu

- While a candidate is on trial, `TAG0189d4` puts graphic 40, the Resurrect / Reincarnate
  / Cancel menu, where the panel goes and sets `d.DisplayResurrectChestOrScroll = 5`
  (`doc/CSBwin-src/Character.cpp:3836-3858`).
- The eye is button 71, and `HandleMouseEvents` sends it to `ClickOnEye` with no
  `PotentialCharacterOrdinal` gate (`doc/CSBwin-src/Mouse.cpp:1659-1664`), unlike the
  buttons around it (`:1616`, `:1645`, `:1685`).
- `_ClickOnEye` (`doc/CSBwin-src/Viewport.cpp:7257-7290`) draws the skills (`TAG019036`,
  empty-handed) or the held object's description over whatever is there, and does not
  write `d.DisplayResurrectChestOrScroll`, which stays 5.
- `QuitPressingEye` (`doc/CSBwin-src/CSBCode.cpp:7399-7413`) calls `TAG0189d4`, which
  draws the menu again.

The port redraws the panel every frame, so `drawInventoryScreen` tests the held eye before
the candidate. Evidence: `tools/dump-mastery-panel.ts`, last section.

## The mastery names are a code table, and six of them start with a rune

`d.Pointer16770[17]` (`doc/CSBwin-src/CSBCode.cpp:370-384`) holds the rank names the eye
panel prints, indexed directly by what `DetermineMastery` returns:

```
[2] NEOPHYTE   [3] NOVICE   [4] APPRENTICE  [5] JOURNEYMAN  [6] CRAFTSMAN
[7] ARTISAN    [8] ADEPT    [9] EXPERT      [10] ` MASTER   [11] a MASTER
[12] b MASTER  [13] c MASTER [14] d MASTER  [15] e MASTER   [16] ARCHMASTER
```

Slots 0 and 1 are never read: `drawAttributePanel`'s port of
`doc/CSBwin-src/Character.cpp:4590-4605` clamps with `Smaller(16, mastery)`, skips a role
whose mastery is 1, and CSBWin dies outright on 0.

Two things about it are unusual:

- **It is a hardcoded table, not extracted from `graphics.dat`.** One of the rare
  exceptions to the extract-at-runtime rule — the strings live in the executable, so they
  belong in code here too. (The same names appear again as `pnt4772` in
  `doc/CSBwin-src/Chaos.cpp:513`, padded to 11 characters and **0-based**, for the CSB
  editor's dialog. Do not confuse the two indexings.)
- **The six master ranks begin with `` ` `` and `a`..`e`** (0x60, 0x61..0x65). In the DM
  font, graphic `0x22d`, those codes hold rune glyphs — Lo, Um, On, Ee, Pal, Mon — so
  "a MASTER" is the rune for Um followed by a space and MASTER, not a letter A.
  `TextOut_OneLine` indexes the font with the raw byte (`doc/CSBwin-src/Graphics.cpp:335`)
  and never changes case, so these lines must go through `drawTextLineIndexRaw`; the
  upper-casing `drawTextLineIndex` turns the rune into an 'A'.

The object panel uses the same six glyphs for a potion's power
(`doc/CSBwin-src/Character.cpp:3599-3615`). When the selected champion's priest mastery,
`DetermineMastery(d.SelectedCharacterOrdinal-1, 2)`, is above 1 (neophyte or better),
the name of any potion but the water flask and the empty flask is prefixed with the
character `95 + strength()/40` and a space. Without the `0x8000` flag, a temporary
adjustment counts. The line is printed with `TextToViewport(134, 68, COLOR_13, …, false)`,
so it too goes through `drawTextLineIndexRaw`. `tools/dump-mastery-panel.ts` renders the
panel at every power step.

The rank is read with the `0x8000` flag — `DetermineMastery(chIdx, role|0x8000)`
(`doc/CSBwin-src/Character.cpp:4593`) — so the panel shows the **earned** rank and a
temporary adjustment from a spell or potion does not move it.

Covered by `tools/dump-mastery-panel.ts`, which renders the real panel and compares the
pixels against the strings spelled out independently in the tool.

## The column index is saved state, not dungeon structure

`d.objectListIndex` holds, for every column of every level, the index at which that
column's run of entries begins in `d.objectList` (`doc/CSBwin-src/Data.h:1050`;
`d.pCurrentLevelObjectIndex` is the pointer into it for the loaded level, repointed by
`LoadLevel` at `doc/CSBwin-src/CSBCode.cpp:5785`). `GetObjectListIndex` walks from that
base past every earlier cell in the column that carries the has-objects bit
(`doc/CSBwin-src/CSBCode.cpp:5103-5127`), so **every** cell chain in the dungeon is read
through it.

It is not fixed at load time. When an object leaves a cell that then holds nothing, CSBWin
clears the cell's `0x10` bit, memmoves the tail of `objectList` down over the vacated slot,
and then decrements the index of **every following column, in this level and all higher
ones** (`doc/CSBwin-src/CSBCode.cpp:5211-5224`):

```
      //Now we need to fix the column indexes.
      puwA2 = &d.pCurrentLevelObjectIndex[mapX+1];
      D5W = d.numColumnPointers; // for all levels
      ...
      while ((D5W--) != 0) (*(puwA2++))--;
```

Dropping into an empty cell is the mirror image. So an ordinary pick-up or drop rewrites
the array, and it is state that play changes.

`SaveGame` writes it accordingly, between the level descriptors and the object list it
indexes (`doc/CSBwin-src/SaveGame.cpp:1178`):

```
    D0W = WriteAndChecksum((ui8 *)d.objectListIndex, pwA3, 2*d.numColumnPointers);
    ...
    D0W = WriteAndChecksum((ui8 *)d.objectList,      pwA3, 2*d.dungeonDatIndex->ObjectListLength());
```

The 44-byte header goes out with it (`:1168`), carrying `ObjectListLength()` and the
per-database record counts, which the same mutations maintain.

**Consequence for a save format.** `objectList` and `columnIndex` are one structure and
must be restored together. Restoring the list against a stale index shifts the base of
every column after the first divergence, so cells read their neighbours' chains: objects
disappear from the cells that hold them (a pressure plate stops existing), surface in
cells that never had them (a monster apparently out of bounds, an item on the wrong
tile), and a load stops being idempotent — what happened *between* two loads changes what
the second one produces.

Note one deliberate difference in our port: CSBWin keeps `objectList` at a fixed
allocation and nulls the vacated last entry, while `DungeonState` splices the array and
tracks the length in `header.objectListSize`. Both are self-consistent; only the second
needs the length saved.

Covered by `tools/dump-savegame.ts`.

## `EXTENDEDFEATURESBLOCK` offsets, and `gameInfoSize` is signed

The block is a plain, naturally-aligned 512-byte struct
(`doc/CSBwin-src/CSB.h:463-511`). Byte offsets:

| Off | Field | Off | Field |
| --- | --- | --- | --- |
| 0 | `sentinel[20]` | 44 | `gameInfoSize` |
| 20 | `dataMapLength` | 48 | `cellFlagArraySize` |
| 24 | `dataTypeMapChecksum` | 52 | `graphicsSignature1` |
| 28 | `dataIndexMapChecksum` | 56 | `graphicsSignature2` |
| 32 | `extendedFeaturesChecksum` | 60 | `spellFilterLocation` |
| 36 | `version` | 64 | `extendedFlags` |
| 37 | `flags` | 68 | `overlayOrdinal` |
| 38 | `numDSA` | 72.. | `overlayP1..P4` |
| 40 | `editingOptions` | 92 | `CSBgraphicsSignature1` |

Read one field too far — `spellFilterLocation` at 64 and `extendedFlags` at 68 — a
committed save's `extendedFlags`, 0xf8 with `SequencedTimers` and `ExtendedTimers` in it,
comes out as its `overlayOrdinal`, 0, and chooses a 10-byte `TIMER` where the file has 16.

**`gameInfoSize` is declared `ui32` but is signed everywhere it is used.** The global
is `i32` (`doc/CSBwin-src/Data.h:118`, `doc/CSBwin-src/data.cpp:271`), `ReadGameInfo`
and `WriteGameInfo` both take `i32 size`, and the writer sets

```
      efb.gameInfoSize = 0;
      if (gameInfo != NULL) efb.gameInfoSize = gameInfoSize-1;
```

(`doc/CSBwin-src/SaveGame.cpp:977-978`), so an allocated-but-empty game info writes
**-1**, i.e. `0xffffffff`. `WriteGameInfo` then writes nothing for it, so the field
occupies **no bytes in the file** and the read head must not advance. Read unsigned, the
4294967295 walks past the end of the file and GAMEBLOCK1 never parses. The eight
committed saves all hold a `gameInfoSize` of 32.

Covered by `tools/dump-csbwin-save.ts`.

## `CHARDESC.title` is 20 bytes, not 16

`CHARDESC` (`doc/CSBwin-src/CSB.h:2483`) declares

```
  char  name[8];   // 00
  char  title[16]; // 08 // size??
  i16 wordx24;     // Not swapped because I don't see it used.
  ui8 FILL26[28-26];
  ui8 facing;      //28
```

Paul Stevens' own `// size??` is the tell. `AddCharacter` copies the title from the
decoded `dbTEXT` record and rejects a character only at `D6W >= 19`, then writes the
terminator with `title[D6W] = 0` (`doc/CSBwin-src/Character.cpp:578-587`), so index 19
is a legal write. Title bytes therefore run 8..27 inclusive, and `facing` at 28 closes
the span exactly. **`title[16]`, `wordx24` and `FILL26[2]` are one 20-byte field.**

`name` is written by the same function's first loop, which rejects at `D6W >= 7` and
terminates with `name[D6W] = 0`, so a name is at most 7 characters in an 8-byte field.

Neither field is byte-swapped — `swapCharacter` lists every field it swaps and these
are not among them (`doc/CSBwin-src/SaveGame.cpp:490-521`) — so both are read as plain
bytes regardless of endianness.

The 20-byte span is now confirmed from data as well: in the saves made to test it,
`IAIDO` carries `RUYITO CHIBURI` and `ELIJOH` carries `NO SPC AFTER NAME` — 17
characters plus terminator — starting at offset 8 with nothing lost.

⚠️ **Open question, not a fact.** In the three oldest committed saves several
champions' titles read back with their first character replaced by 0: `SHE DEVIL` → `\0HE DEVIL`,
`SHADOWSEEK` → `\0HADOWSEEK`, `THE BARBARIAN` → `\0HE BARBARIAN`, against the preset
names `tools/dump-preset-heroes.ts` reads from `dungeon.dat`. It is a property of the
files, not of the reader: within one save, `HALK` loses its `T` while `LEYLA` and
`ALEX` keep `SHADOWSEEK` and `ANDER` intact, so no fixed offset explains it. The
suspicion was a champion-naming path writing its NUL at `name[8]`, which is `title[0]`.
**That has now been tested and ruled out.** Three saves were made specifically to
provoke it — a champion resurrected and left alone, one reincarnated and renamed with
the name field padded with spaces to walk the cursor into the title, and one
reincarnated and renamed using Enter to move fields — and all three come back with
name at 0 and title at 8, whole. So neither resurrection, nor reincarnation, nor
renaming by either keyboard route clobbers `title[0]`; whatever does it is specific to
how those older files were produced. Do not "fix" the reader for it.

## The dungeon image layout in a save file, and the two record sizes that change

Blocks 7-14 of a save (the dungeon image) are plain and uncompressed. This is the
layout, all of it now verified: for **ten genuine save files** (eight of DM, and
Chaos Strikes Back's `mini.dat` and `csbgame2.dat`) the sum of every
section length from the 44-byte header to the end of the cell flags lands exactly on
`EOF - 2`, the byte before `WriteAndChecksum`'s final word
(`doc/CSBwin-src/SaveGame.cpp:1222`). One wrong record size anywhere and it misses.

```
44                           DUNGEONDATINDEX
16 * numMaps                 level descriptors
2  * totalColumns            objectListIndex   (column index)
2  * objectListSize          objectList
   … text section, below …
Σ  count[db] * size[db]      the 16 databases, in order
cellFlagArraySize            cell flags        (EXTENDEDFEATURESBLOCK+48, else header word 2)
2                            final checksum
```

`numMaps` is the header's byte, and nothing bounds it: `ReadDatabases` reads
`16 * NumLevel()` bytes of descriptors whatever it says (`doc/CSBwin-src/SaveGame.cpp:2411-2427`).
Conflux 3.5 has 64 levels, and a save of it reads back (`tools/dump-dsa-save.ts`).

**Two record sizes are not the `dungeon.dat` ones.** This is what defeats the obvious
arithmetic:

- **ACTUATOR (db 3) is 10 bytes, not 8.** `dbEntrySizes[dbACTUATOR]` is the *big* size
  and the small one is the special case — `ReadDatabases` writes it as a subtraction,
  `if ((D6W==dbACTUATOR) & !bigActuators) D4W -= 2;`
  (`doc/CSBwin-src/SaveGame.cpp:2571-2575`), and a file without the flag is fixed up on
  load by `MakeBigActuators`, which inserts two zero bytes per record (`:2287-2301`).
- **SCROLL (db 7) is 6 bytes, not 4**, from extended-features version `'B'` on.
  `readScrollDatabase` branches on it and says why: "The old version had a 10-bit index
  into the text database. The new version has an RN reference to the text."
  (`:2189-2200`).

**The text section is little-endian, and its header field means something else.**

```
4 * NumWordsInTextArray      indirectTextIndex   (LE32 word offsets)
4                            sizeOfCompressedText (LE32)
2 * sizeOfCompressedText      compressedText
```

Two traps in three lines:

- `NumWordsInTextArray` (header offset 6) does **not** count text words in a save.
  `ConvertToIndirectText` overwrites it with the index length
  (`doc/CSBwin-src/SaveGame.cpp:2272`), so it counts index *entries*. In the DM saves
  it reads 125 while `dungeon.dat`'s own value is 1749 — and 1749 reappears as
  `sizeOfCompressedText`, because the compressed text is still the same text.
- Both the index and the size word are **little-endian**, alone in an otherwise
  big-endian image. `SwapIndirectTextIndex` guards the write the same way
  `SwapExtendedFeaturesBlock` does, so on the shipping little-endian build it is a
  no-op and the block keeps native order.

**A save with no Extended Features block declares no cell flag size.** `ReadDatabases`
then takes the image header's `LegacyCellFlagArraySize`, its word 2
(`doc/CSBwin-src/SaveGame.cpp:2412-2415`, `CSB.h:2072`), and does so too when the block
declares 0. Chaos Strikes Back ships its saves in that Atari-era form: `mini.dat` and
`csbgame2.dat` (`static/gamefiles/csb/`) carry no block, their word 2 is 8763, and with it the layout closes on the
final word. 8763 is also the extent of the eleven levels' cell flags and tables as their
descriptors place them. Covered by `tools/dump-atari-saves.ts`.

Two independent confirmations beyond the closure sum: a 48-byte window lifted from
`dungeon.dat`'s map-data section is found in an early save exactly at the computed cell
flag offset, and its door database appears exactly at the computed database offset.

Covered by `tools/dump-csbwin-save.ts`.

## A thrown object keeps its id: `ObjectInHand` and `MISSILE.projectileObject`

Two saves taken either side of a throw settle both fields at once. In
`tools/fixtures/csbgame-item-on-cursor.dat` a sword sits on the cursor and
`gb2.ObjectInHand` is `0x4d`; in `csbgame-flying-sword.dat`, the same session moments
later, the cursor is empty (`0xffff`) and the one live MISSILE record carries
`projectileObject = 0x4d`, `rangeRemaining = 77`, `damageRemaining = 20`,
`timerIndex = 2` against `NumTimer = 3`.

`0xffff` in `gb2.ObjectInHand` is the empty hand, and **`timerIndex == 0xffff` marks a
free slot** in the MISSILE pool. The writer is `gb2.ObjectInHand =
d.objectInHand.ConvertToInteger()` (`doc/CSBwin-src/SaveGame.cpp:1033`), and the loader
takes the word back with `NonExtendedInteger` (`:1649`) and converts it unless it is
`RNnul` (`:2753-2760`) — so an empty hand must be written as `RNnul`, never `RNempty`
(0, `CSBTypes.h:249`), which would come back as an object in hand. All seven
committed saves with an empty hand hold `0xffff`. The pool is allocated at full size regardless of what
is happening: all eight committed saves carry 60 missile and 50 cloud records, so a
record count says nothing about how many missiles are in flight — only a live
`timerIndex` does.

## The new scroll record, and where big actuators put their extra bytes

Both of the record sizes that differ in a save also differ in *shape*, and getting the
size right without the shape would read every field one word out.

**ACTUATOR gains its two bytes at the end.** `MakeBigActuators` walks each record
backwards from the top of its new slot, writing the two zero bytes *first* and then
copying the old bytes beneath them (`doc/CSBwin-src/SaveGame.cpp:2287-2310`):

```
    //Insert two zero bytes.
    *(--destination) = 0;
    *(--destination) = 0;
    //copy oldSize bytes;
    for (j=0; j<oldSize; j++) *(--destination) = *(--source);
```

So the first four words are unchanged and the new word is appended — which is exactly
what `ActuatorRecord.word8` was already reserved for.

**SCROLL is re-laid-out, not extended.** `DB7` (`doc/CSBwin-src/CSB.h:1195-1216`) keeps
its old form in comments beside the new one:

```
// old Scroll  i16 m_word2; // bits 0-9 = text index, bits 10-15 = ????
  RN m_RNtext;
  ui16 m_word4; // Bit 0 = open
```

So the 6-byte record is link, then a **full RN** to the text record, then a word whose
bit 0 is "open" — where the 4-byte record packed both into one word, with "open" read
from the high bits. The RN is a slot of the object indirect index (see "An RN in a save
file is an indirect index" below), and the record index it names is what the old field
held, so the reader keeps that as `textReference` and every reader of it keeps working.

`readNewScrollDatabase` reads the whole database flat at `dbEntrySizes[dbSCROLL]` per
record (`doc/CSBwin-src/SaveGame.cpp:2168-2187`); the old-format branch beside it is
what converts a pre-'B' file.

Covered by `tools/dump-csbwin-world.ts`, which parses the image of every committed save
into a real `DungeonData` and checks that the early ones' cell flags are **identical**
to `dungeon.dat`'s. That is the sharpest available check on all of this: the cell flags
are the last section in the image, so their position depends on every length before
them, and one wrong record size moves them.

One thing that is *not* a measure of play: **the object list is longer in every save
than in `dungeon.dat`** — 1982 against 1682 for DM, in the earliest save as much as the
latest. CSBWin grows it while loading. Compare cell flags, never object-list length.

## An RN in a save file is an indirect index, not a packed `[pos][db][idx]`

It is not a quirk of the file format — it is how `RN` works in CSBWin at all, and in
this port (`src/core/RnMaps.ts`). `dungeon.dat` stores an object reference as the Atari
ST bitfield, `[position:2][category:4][index:10]`. CSBWin does not keep them that way.
`class RN` holds one `ui16 indirectIndex` and nothing else
(`doc/CSBwin-src/CSBTypes.h:268-370`); every accessor goes through two global arrays:

```c
DBTYPE dbType(void) const { return DBTYPE(dataTypeMap[indirectIndex] & 0xf); };
ui8    pos   (void) const { return (dataTypeMap[indirectIndex] >> 4) & 3; };
ui16   idx   (void) const { return dataIndexMap[indirectIndex]; };
```

The conversion happens once, when an original dungeon is read. `ConvertListOfObjects`
walks every chain, splits each packed RN into `(pos, db, idx)`, appends the pair to the
two maps and overwrites the RN with the map slot number
(`doc/CSBwin-src/SaveGame.cpp:1916-2018`). `ConvertCharacters` (`:2046-2064`) does the
same for all thirty possession slots of each champion and `ConvertTimers` (`:2021-2044`)
for the object-carrying timers — functions 24/25, 48/49 and 60/61. From then on *every*
RN in memory, and therefore every RN written into a save, is a slot number.

The maps travel in the save so the numbering survives: `ReadExtendedFeatures` reads
`dataMapLength` bytes of `dataTypeMap` and `2*dataMapLength` bytes of `dataIndexMap`
immediately after the 512-byte Extended Features block and dies if either `FormChecksum`
misses (`:355-376`). They are the first two sections of the file.

**Byte order.** `dataTypeMap` is bytes. `dataIndexMap` is 16-bit **little-endian**:
`SwapDataIndexMap` applies `BE16` (`:167-172`), which is a no-op on a little-endian host
(`doc/CSBwin-src/CSBTypes.h:156-161`) — CSBWin's `BE16` means "stored in PC order", as
in the Extended Features header and the indirect text index. Measured across the twelve
committed saves: read little-endian the largest index is 682, read big-endian 0xff01.

**Slot 0 is never used** ("Don't use entry zero", `:1968-1973`). Values from `0xff00` up
are `RNVAL` literals — the spell RNs, `RNeof` 0xfffe, `RNnul` 0xffff — and are not slot
numbers; `RN::CreateSpell` writes `0xff80 + n` straight into the field
(`doc/CSBwin-src/data.cpp:533-537`).

**An `RNVAL` read as a slot is `dbUNKNOWN`, and has no corner or record.** The maps stop
growing short of slot 0xff00: `RN(DBTYPE, dbIndex)` at 64000 (`doc/CSBwin-src/data.cpp:455-504`),
`AllocateIndirectIndex` at `0xff00 - 100` (`SaveGame.cpp:2120-2140`), and
`FindEmptyDBEntry` there too unless the object is `important` (`data.cpp:973-988`). So,
short of a hundred important objects past that mark, `checkIndirectIndex` refuses every
`RNVAL`, as it refuses 0 (`data.cpp:518-527`). On a refusal it puts up the message box
"Illegal object Indirect Index", and a `_DEBUG` build dies. Then `dbType()` returns
`dbUNKNOWN` (`CSBTypes.h:324-330`), while `pos()`, `pos(p)` and `idx()` go on to read or
write `dataTypeMap` / `dataIndexMap` past their end (`:331-347`). `RN::DescIndex` asks
`dbType()` alone, unless the RN is `RNempty` (`data.cpp:568-600`), so for `RNnul` and
`RNeof` it is -1 without a corner or a record being read. The port's `RnMaps` answers
`dbUNKNOWN` the same way and throws where CSBWin would read outside the maps
(`tools/dump-object-index.ts`).

**A freed slot is `dataTypeMap[i] == 0xff`, `dataIndexMap[i] == 0xffff`.**
`DeleteDBEntry` writes both, together with `RNnul` over the record's own link
(`doc/CSBwin-src/data.cpp:993-1015`); `AllocateIndirectIndex` and `RN::RN(DBTYPE, idx)`
reuse such slots. A free record can go on naming one: `DeleteDBEntry` leaves the rest of
the record as it was, so its possession or contents chain still points at a slot that may
have been freed since, and the referring record is itself free, its link `RNnul`. CSBWin
never looks: a free record is
reached only by the allocator, which clears it before handing it out. So the port reads a
free record's other RNs as `RNnul`.

**Two slots may name the same `(db, idx)`.** `ConvertListOfObjects` reuses a record's slot
only for a missile's flying object (`DuplicateOK`, `:1918`), but `convertScrolls` gives
every scroll's text a slot of its own (`AllocateIndirectIndex`, `:2153`) beside any the
chains gave it. In DM's `dungeon.dat` the free scroll 33 names text 123, which is a wall's
text in a chain, so the port's conversion of it holds one such pair, slots 1779 and 1945.

Evidence: `tools/dump-csbwin-world.ts` walks every object chain in all eight saves —
1893 to 1908 objects each, chains up to 31 deep, through chests and monster possessions
— and finds no reference to a free record, no index past a database, no category without
a database and no cycle. The early saves hold `dungeon.dat`'s 1911 objects less exactly
what the chosen heroes carried out of their mirrors. `tools/dump-csbwin-party.ts` asserts
that all 30 possession slots of every champion in every save name a **live** record in
one of the six carryable databases; read as packed RNs they had been decoding to doors
and teleporters with indices in the hundreds.

## The `TIMER` record, and the two shapes a save can hold it in

A timer is 10, 12 or 16 bytes depending on two Extended Features flags, and the short
forms are not truncations — they are earlier versions that `LoadGame` upgrades in place
before it does anything else with them (`doc/CSBwin-src/SaveGame.cpp:1687-1723`). The
16-byte form (`doc/CSBwin-src/CSB.h:1799-2052`):

```
 0  ui32 m_time            big-endian
 4  ui8  timerFunction     TIMERTYPE
 5  ui8  m_timerUByte5     commonly 0; a champion index for functions 11/12/13/72/75
 6  ui8  m_timerUByte6     commonly mapX
 7  ui8  m_timerUByte7     commonly mapY
 8  ui8  m_timerUByte8
 9  ui8  m_timerUByte9     commonly the action: set / clear / toggle
10  ui16 m_timerSequence   big-endian; breaks ties between equal times
12  ui8  m_timerLevel
13  ui8  unused13[3]
```

**Where the level lives depends on the form.** In the 16-byte form `m_time` is the whole
32-bit clock and the level has byte 12. In the 10- and 12-byte forms the level is the
*top* byte of `m_time` (`doc/CSBwin-src/CSB.h:1818-1821`). `ConvertToExtendedTimers`
spells the split as `Level(time & 0xff)` and `Time(time & 0xffffff00)`
(`doc/CSBwin-src/Timer.cpp:2899-2919`), which looks inverted until you notice its own
comment — "the timers are still in big-endian order!" — so it is working on the unswapped
word. Read straight from the file the same split is `level = value >>> 24`,
`time = value & 0xffffff`.

**Bytes 6-7 and 8-9 are read both ways.** `timerObj6`/`timerObj8` are RNs,
`timerWord6`/`timerWord8` are 16-bit words, and `swapTimers` switches on the function
code to decide which (`doc/CSBwin-src/SaveGame.cpp:565-607`). Same byte order either
way, so a reader can simply take both.

**The timer queue is `MaxTimer` big-endian words of which the first `NumTimer` are
live**, each an index into the table, in the array order of CSBWin's binary heap (see
"CSBWin's timer queue is a binary heap"). `LoadGame` restores it verbatim and never
reorders it (`GameTimers::swapTimerQue`, `doc/CSBwin-src/Data.h:1582`). Re-inserting the
timers through `SetTimer` instead would build another array, and would also run the
duplicate-timer rules over timers that legitimately coexist, and drop some.

Proven by two save files made to order: `csbgame4-door-opening.dat` and
`csbgame4-door-closing.dat`, both a fresh game with the party at (1,15) facing north, one
step from the door at (1,14), each saved while that door was in motion. Each carries two
timers, and the door timer's sixteen bytes differ in exactly one:

```
opening  00 00 01 5d  01 00 01 0e 00 00  00 33 00 cd cd cd
closing  00 00 00 fd  01 00 01 0e 00 01  00 19 00 cd cd cd
         |m_time   |  |fn |u5 |x  |y  |u8 |u9| |seq | |lvl
```

`fn` is 1 (`TT_DOOR_STEP`), `x`,`y` are the cell the party faces, and `u9` is the action.
The `0xcd` tail is `TIMER`'s constructor fill (`doc/CSBwin-src/CSB.h:1805-1816`), which
is itself a check that byte 12 really is the level and 13-15 really are unused.
`tools/dump-csbwin-timers.ts` restores each save into a real `Game`, turns the clock, and
watches the door: one opens and the other shuts, from the same starting state, driven by
nothing but that byte.

A trap worth recording, because the tool's first assertions had it backwards: **a door's
cell-flag state counts how far the door has come *down***. `0` is fully open and `4`
fully shut (`doc/CSBwin-src/CSBTypes.h:185-192`: "00 = open, 01 = almost open, 02 = half
open, 03 = almost closed, 04 = closed, 05 = door has been bashed open"). Both saves start
at 2.


## A champion's title can lose its first character, and CSBWin then prints none

Several genuine saves hold a title whose first byte is a NUL: `SHE DEVIL` stored as
`\0HE DEVIL`, `THE BARBARIAN` as `\0HE BARBARIAN`, `RUYITO CHIBURI` as
`\0UYITO CHIBURI`. It is in the files, not in any reader — inside one save `HALK` loses
the `T` of `THE BARBARIAN` while `LEYLA` keeps `SHADOWSEEK` and `ALEX` keeps `ANDER`
whole, so no offset error can explain it.

**It is not corruption. It is a reincarnated champion whose title was left empty**, and
the "missing" letters are the *old* title showing through.

`_ReIncarnate` opens by clearing **one byte** of each field
(`doc/CSBwin-src/Code13ea4.cpp:57-58`):

```c
  D7W = 0;
  pChar->name[0] = 0;
  pChar->title[0] = 0;
```

Not `ClearMemory`, not the whole array — byte 0. Everything the champion was called
before is still sitting in bytes 1..19. Each keystroke then writes
`A2[D7W++] = D5B; A2[D7W] = 0;` (`:264-265`), advancing the terminator one character at a
time. So a player who types a name and then presses Return through the title screen
without typing a title leaves `title[0] == 0` with the previous title's bytes 1..19
untouched:

```
before   S  H  E     D  E  V  I  L  \0 ...
after    \0 H  E     D  E  V  I  L  \0 ...
```

The name never shows it, for the same reason it is invisible in play: the player retypes
the same name over the same bytes, so the padding past its terminator was already zero
from `AddCharacter`'s `ClearMemory((ui8 *)pcA3, 800)` (`doc/CSBwin-src/Character.cpp:481`)
and stays zero. Only the title, which is *not* retyped, keeps its tail. Reincarnating a
hero at the mirrors and keeping their name is an ordinary thing for a player to do, which
is why several files have it and a save made to provoke it does **not** — a test that
types a title overwrites the remnant and comes back clean.

**Nothing repairs or tolerates it on the way out, and nothing needs to.** The title is a
C string and `TextToViewport(LOCAL_6, 7, D4W, pcA3->title, false)`
(`doc/CSBwin-src/Character.cpp:1338`) stops at the NUL, so CSBWin prints a **blank
title** — exactly what the player asked for. The only decision taken from `title[0]` is
whether to leave a 6-pixel gap after the name (`:1327-1337`), and a zero byte falls
through all three of its tests and takes the gap.

So this port must not "correct" the byte, and must not read past it either:
`decodeCharField` now stops at the first NUL like the C string it is. Reading on — which
it used to do — displayed `HE DEVIL` where the real game displays nothing.

### A second, rarer path to the same byte

Worth recording because it is a genuine bug rather than a consequence of a design, and it
would produce an identical-looking file. `EditCharacterName`'s insert branch
(`doc/CSBwin-src/Chaos.cpp:5273`, the write at `:5323-5324`):

```c
else
{ // insert in the middle
    i32 i;
    for(i=max_len;i>=e.EditBoxPosition;i--)
        name[i+1] = name[i];
    name[e.EditBoxPosition] = key;
}
```

The shift loop starts at `max_len` unconditionally rather than at the string's length.
For the name field `max_len == 7` (`:5287`), so the **first iteration is
`name[8] = name[7]`** — and `name` is `char[8]` immediately followed by the title
(`name` at `+772`, title at `+780`, confirmed by `doc/CSBwin-src/Chaos.cpp:3997`), so
`name[8]` *is* `title[0]`, and for any well-formed name the value copied is zero. It
fires only when the caret is clicked *inside* the name (`:3979-3986`; clicking past the
end clamps to the length and takes the safe append path), and the `max_len = 18` title
branch is dead code — nothing ever sets `e.EditBoxSelected` to 1 — so every insert edit
lands on `title[0]`. This is the editor, though, not the game: the reincarnate screen
above is what a player actually touches.

**Every other naming path is correctly bounded**, and this is worth knowing before
porting any of them: `AddCharacter` stops at `D6W >= 7` and writes its terminator at
`name[7]` at worst (`doc/CSBwin-src/Character.cpp:553-567`); the reincarnate screen gates
the name at `D7W == 7` and the title at 19 (`doc/CSBwin-src/Code13ea4.cpp:64-68,266`);
`CopyCharacter`, `SaveToWings`/`GetFromWings` and `RemoveCharacter`'s compaction all move
the whole 800-byte struct; and `swapCharacter` touches nothing below offset 32
(`doc/CSBwin-src/SaveGame.cpp:490-542`).

<sub>One unrelated off-by-one found next door, worth knowing before porting the spacing
rule: the Hall-of-Champions copy of it reads `*(A0+9)`, which is `title[1]`, not
`title[0]` (`doc/CSBwin-src/Code1f9e6.cpp:186-198`).</sub>

## `CHARDESC` carries the champion's portrait as pixels, not an index

`CHARDESC` declares `i8 portrait[1]` at offset **336** followed by
`ui8 FILL337[800-337]` (`doc/CSBwin-src/CSB.h:2593-2594`). The two are one field: 464
bytes, which is exactly `32*29/2` — a 32x29 four-bitplane bitmap, and the last thing in
the 800-byte record.

There is no portrait *index* anywhere in the struct. `AddCharacter` blits the picture in
once, at the moment the champion joins, and the character record owns it from then on
(`doc/CSBwin-src/Character.cpp:486-508`):

```c
  if (charID <= 23)
  {
    TAG0088b2(GetBasicGraphicAddress(26), (ui8 *)pcA3->portrait,
              (RectPos *)d.Byte1390, (charID&7)<<5, (charID>>3)*29, 128, 16, -1);
  }
  else
  {
    TAG0088b2((ui8 *)GetExternalPortraitAddress(charID), (ui8 *)pcA3->portrait,
              (RectPos *)d.Byte1390, 0, 0, 16, 16, -1);
  };
```

`charID <= 23` cuts basic graphic 26, a 256x87 sheet of 24 cells at `(charID&7)<<5` by
`(charID>>3)*29`; anything above 23 comes from `CSBgraphics.dat`
(`GetExternalPortraitAddress`, `doc/CSBwin-src/Bitmaps.cpp:540-569`, which insists on
32 by 29 at `:561`) and **has no cell to be an index into**. Every later draw copies the
record's own bytes back out at 16 bytes per line — `CharacterPortraitToStatusBox`
(`doc/CSBwin-src/Character.cpp:4644-4656`), called from `DrawCharacterStatusBox` only
when that champion's inventory is open (`:1289-1293`).

**The bytes are not swapped on save.** `swapCharacter` lists every field it byte-swaps
and the portrait is not among them (`doc/CSBwin-src/SaveGame.cpp:490-521`), so a save
file holds the Atari layout verbatim: per group of 16 pixels, four big-endian plane
words; plane 0 carries bit 0 of the colour index, and the leftmost pixel is bit 15. That
is the format `TAG0088b2` reads, four consecutive `LE16(*puwA0++)` per group
(`doc/CSBwin-src/Graphics.cpp:764-779`).

Verified, not inferred: decoded that way, the portrait of **every champion in every
committed save** in `tools/fixtures/` reproduces a cell of basic graphic 26
pixel for pixel, 928 of 928 (`tools/dump-csbwin-load.ts`). A wrong offset, a reversed
plane order or a byte swap each still yield a plausible 32x29 block, and none of them
match.

Consequence for the port: `Champion.portrait` holds those 928 palette indices, and the
status box prefers them. `Champion.portraitGraphic` — the graphic-26 cell — remains for
champions this engine creates, because the engine holds no graphics to blit from, but it
is this port's shortcut and not a CSBWin field. A champion out of a genuine save has
pixels and no index at all, which is why a loaded party once showed four empty boxes.

## A `CHARDESC` slot past the party holds zeros, or the champion who left it

`d.CH16482[4]` is four records whatever `d.NumCharacter` is
(`doc/CSBwin-src/Data.h:766`). What a slot no champion fills holds:

- **Zeros at every start.** `RN`'s default constructor sets `0xffff`
  (`doc/CSBwin-src/CSBTypes.h:300`), but `DBank`'s own constructor, which runs after its
  members', does `memset (this,0,sizeof (*this))` (`doc/CSBwin-src/CSBCode.cpp:314-317`),
  and so does `DBank::Initialize` (`:323-330`), called at each start and restart
  (`:11305`, `:11356`, `Code1f9e6.cpp:309`). So a never-filled slot's thirty possessions
  are RN 0, not `RNnul`. Every committed save with fewer than four champions holds 800
  zero bytes in each slot past the party.
- **The candidate a Cancel turned away.** Button 162 of `_ResurrectReincarnateCancel`
  takes one off `d.NumCharacter` and clears nothing (`CSBCode.cpp:6629-6640`), so the
  record stays, possessions and all; those objects are still in the mirror's cell.
- **A save's own after a load**: the file carries all four records, 3328 bytes with the
  party tail (`SaveGame.cpp:1126`, `:1676`).

`AddCharacter` clears 800 bytes of the slot before it fills it
(`doc/CSBwin-src/Character.cpp:481`), and every loop over the champions stops at
`d.NumCharacter`, so the one reader of such a slot is `&CHPOSS`, which bounds its index
to 0-3 and no further (`DSA.cpp:3342-3347`). On a never-filled slot it pushes 0, since
it pushes -1 only for `RNnul` (`:3353-3354`). The port keeps the slots as
`PartyState.vacantCharacters`; `tools/dump-dsa-characters.ts` (3b, 3c),
`tools/dump-hall-of-champions.ts` (Cancel) and `tools/dump-character-block.ts` (5) check
the three ways in.

## `CHARDESC.incantation` is a C string, and a cast leaves the rest of it behind

The four bytes at offset 34 are the spell being composed. Every reader of them measures
with `StrLen`: `D0W = StrLen((char *)pcA3->incantation); if (D0W == 0) return;`
(`doc/CSBwin-src/Magic.cpp:812-813`). The writer maintains the terminator by hand —
`pcA3->incantation[D7W] = D0B; pcA3->incantation[D7W + 1] = 0;`
(`doc/CSBwin-src/CSBCode.cpp:8985-8986`) — and `byte33` at offset 33 is `D7W`, the cursor
into it, wrapping at four.

**What a cast leaves behind matters.** `CastSpell` clears only the first byte:

```c
    pcA3->incantation[0] = 0;
    pcA3->byte33 = 0;
```

(`doc/CSBwin-src/Magic.cpp:951-952`), so the symbols after it stay in the record. Real
saves hold exactly that: `00 66 00 76` is in `csbgame7.dat`. To CSBWin that is an *empty*
incantation — `StrLen` stops at byte 0 — with dead bytes trailing.

This port read the field as "the non-zero bytes", which resurrected them: a champion
restored with that field had two runes pending that the real game does not show.
Fixed by reading the terminated prefix, as CSBWin does. The dead tail is kept separately
(`Champion.incantationField`) only so the save writer can put the record back byte for
byte; it is used only while it still agrees with the live prefix, so a rune typed after
the load is never overwritten by it.

**`byte33` is always `StrLen(incantation) & 3`**, so it is derived, not stored. It has
five writers, and each keeps it there: the add stores `(D7W + 1) & 3` after writing rune
`D7W` and a terminator after it (`doc/CSBwin-src/CSBCode.cpp:8984-8988`); the backspace
stores `(byte33 + 3) & 3` and zeroes that byte (`Magic.cpp:814-817`); the cast
(`:951-952`, above) and the two champion resets (`Character.cpp:2648-2649`, `:5293-5294`)
store 0 with `incantation[0] = 0`. After four runes it wraps to 0 while `StrLen` is 4.
`tools/dump-character-block.ts` packs all eight committed saves with the derived value
byte for byte. This port used to carry the file's `byte33` instead, which went stale as
soon as a rune was typed after the load.

<sub>Note the terminator write at `incantation[D7W + 1]` with `D7W == 3`: `incantation`
is `i8[4]`, so that is a write to `FILL38[0]`. It is zero in every committed save, and
this port writes zero there.</sub>

## Packing `CHARDESC` back: the six fields with no reader

Writing block 4 needs the whole 800-byte record, including what the game never reads
back. Everything below is verified by `tools/dump-character-block.ts`, which packs the
block again for each of the eight committed saves and compares with the file's own
bytes — all eight are byte-identical, empty slots, dead incantation tails and all.

| Offset | Field | What to write |
| --- | --- | --- |
| 30 | `byte30` | **1** — `pcA3->byte30 = 1;` (`doc/CSBwin-src/Character.cpp:517`) |
| 31 | `byte31` | **2** — `pcA3->byte31 = 2;` (`:518`) |
| 43 | `uByte43` | 0 |
| 38-39, 91, 286-335 | the `FILL` runs | 0 — `ClearMemory((ui8 *)pcA3, 800)` (`:481`) |
| 212-271 | an empty possession slot | **0xffff** (`RNnul`), in all 656 empty slots of the committed saves |
| 3287-3327 | `Byte13195[41]`, the party tail's own filler | 0 |

An unused champion slot is 800 zero bytes, not a record with zero fields: `AddCharacter`
clears it before it writes anything, and a save holds whatever the last `RemoveCharacter`
compaction left, which is zeros.

Two more, which have readers but not in this port, so they are carried rather than
derived: `timerIndex` at 46 (the timer that erases the damage readout over a portrait,
`doc/CSBwin-src/CSBCode.cpp:7176-7190`, -1 in every committed save) and `charFlags` at 48,
whose bit 4 is the champion's **gender** — the only place it is recorded.

`facing3` at 40 is **not** cleared: `AddCharacter` sets it with `facing`, both to
`d.partyFacing` (`doc/CSBwin-src/Character.cpp:522`, `:531`), so a recruit that has never
been hit saves the party's facing there. It is the way the portrait turns on the next hit
(`Monster.cpp:1242` sets it, `CSBCode.cpp:8826-8832` applies it). The port's recruit wrote
0 until D3's `facing3` fix (`tools/dump-hall-of-champions.ts`, a mirror faced west).

### `CHARDESC.load` agrees with this port's own sum

CSBWin keeps `load` (offset 272) incrementally, adjusting it at each of its eight
possession writers; this port re-sums it from the object weights instead
(`src/engine/CharacterStats.ts`). For all **18 champions of the eight committed
saves** the two agree exactly (`tools/dump-csbwin-load.ts`). That is the only outside
check the weight system has: `WEAPONDESC`, the clothing and misc weight arrays, the
water-flask rule and the recursion into chests all have to be right for it to hold.

## CSBWin has no keyboard controls — every key binding is a synthetic mouse click

There is no key handler for the game panels anywhere in CSBWin. `ReadConfigFile`
(`doc/CSBwin-src/CSBUI.cpp:741`) parses `config.txt` (`config.linux` on Linux,
`:724-727`) into a `KEYXLATE` table (`:514`), whose rows are `(scancode, value, mode,
type)` and whose `translate` is a linear search (`:544`). A `KEY` line binds a character,
a `SCAN` line a scancode, and an **`MSCAN` line binds a key to a screen point and a mouse
button**: it stores `(x<<16)+y` as the value, with type `TYPEMSCANL` or `TYPEMSCANR`
(`:783-796`).

`UIM_KEYDOWN` (`:1120`) then tries the table three times — `TYPESCAN` first, which queues
a key, then `TYPEMSCANL` and `TYPEMSCANR`, which do not queue anything at all:

```c
OnMouseSwitchAction(2, key>>16, key & 0xffff);   // or 1, for the right button
OnMouseSwitchAction(0);
```

(`:1147-1157`). That is the same pair `UIM_LEFT_BUTTON_DOWN` raises for a real click
(`:1186`), and `OnMouseSwitchAction` with an explicit `x` writes `d.NewMouseX` /
`d.NewMouseY` before calling `OnMouseClick` (`doc/CSBwin-src/system.cpp:464-472`). So a
bound key is indistinguishable from the player clicking that pixel, and every guard on
the panel — `d.PotentialCharacterOrdinal`, the caster test, `word20252` — applies to it
for free.

Two consequences for a port. A key can only ever mean *one* button list entry, because
the point is fixed: no CSBWin binding can open an attack menu while another is open, since
with one open the panel area is the option list (`handleAttackAreaClick`). And the shipped
`config.txt` is not part of the source tree — the bindings are the player's, not the
game's.

## The timer array has a size and a free list, and a save carries both

`m_firstAvailTimer` (`doc/CSBwin-src/Data.h:1540`) is the slot the next timer takes. Four
places maintain it:

- `SetTimer` allocates at it — `D5L = m_firstAvailTimer`, `ASSERT(m_firstAvailTimer <
  m_maxTimers)` (`doc/CSBwin-src/Timer.cpp:1129-1130`) — and then walks it forward to the
  next `TT_EMPTY` entry (`:1195-1198`).
- `DeleteTimer` marks the slot `TT_EMPTY` and lowers the cursor to it if it is lower
  (`doc/CSBwin-src/Timer.cpp:965-969`). `GetNextTimerEntry` copies the head of the queue
  out and then calls `DeleteTimer` on it (`:1222-1233`), so **firing a timer frees its
  slot** — the array is not append-only.
- `SetTimer`, first of all, jumps it when the table is within five of full: once
  `m_numTimer >= m_maxTimers - 5`, it sets the cursor to `m_maxTimers`, past every hole,
  and `EnlargeTimerQueue((m_maxTimers+10)*5/4)` grows the table, or `die(45)` at 5000
  (`doc/CSBwin-src/Timer.cpp:999-1008`). This is before the duplicate rules, so it happens
  even for a timer those rules then drop. The five slots below the old size stay empty
  until a `DeleteTimer` below the cursor lowers it.
- `LoadGame` reads the cursor straight back out of the file: it is written as
  `gb2.FirstAvailTimer` (`doc/CSBwin-src/SaveGame.cpp:1023`) and restored at `:1640`.

So the cursor is the lowest free slot until the table first fills, and not after.

The size, `m_maxTimers`, is `gb2.MaxTimers` in a save, which `LoadGame` allocates
(`doc/CSBwin-src/SaveGame.cpp:1638`); `Allocate` only ever grows the table
(`Timer.cpp:657-685`). A new game allocates 100 (`SaveGame.cpp:2549`), then, for the
monster database and every database from the missiles on, one more per record
(`:2612-2616`), a record count being the file's count plus `d.Byte7302[db]` extra ones
(`:2556-2564`). `Byte7302[16]` (`Data.h:1099`) sits in graphics.dat item 0x22f right after
`ObjDesc[180]`, and reads `0,0,0,0,75,100,120,0,5,0,140,0,0,0,60,50` in the stock file, so
the stock dungeon's table is 100 + (182 + 75) + (0 + 60) + (0 + 50) = 467, the
`gb2.MaxTimers` of every committed save. `tools/dump-timer-heap.ts` section 5, and
`tools/dump-save-roundtrip.ts` 3b for a filled table through a save.

Why it is not merely tidy numbering: a restore is followed by `ProcessMonstersOnLevel`,
which deletes and re-creates the movement timers of every monster group on the party's
level. The game start calls `LoadPartyLevel(d.partyLevel)`
(`doc/CSBwin-src/CSBCode.cpp:10491`), which runs `TAG00bd40` to detach every group and then
`ProcessMonstersOnLevel` (`:795`, `:818`). A save does the same once the file is closed
(`doc/CSBwin-src/SaveGame.cpp:1237-1245`), so that the game played on after a save is the
one a restore of it gives back; a save that fails jumps past it, to `SaveError` (`:1264`).
`tools/dump-save-roundtrip.ts` steps the two side by side and asserts they agree on every
tick (`Game.saveWritten`, which the disk menu calls once its write succeeds). Without slot reuse every load
abandons one slot per re-created timer — two per save/load cycle on `csbgame7.dat`,
without bound, in an array CSBWin lets reach 5000 entries before `die(45, "No empty Timer
entries")` (`doc/CSBwin-src/Timer.cpp:1003-1009`). `tools/dump-save-roundtrip.ts` runs
five cycles and asserts the table neither grows nor gains a hole.

What load legitimately *does* change, for the same reason, and so is excluded from that
tool's equality checks by name: the re-created timers take fresh `sequence` stamps, the
random stream advances, and `NextMonsterUpdateTime` (`doc/CSBwin-src/CSBCode.cpp:5842`)
re-rolls each group member's `singleMonsterStatus` walk offsets — so a monster's sprite
can sit a pixel further over after a load. CSBWin does all three.

## `TIMER.unused13` is 0xcd in a slot that has been used, 0 in one that has not

The three bytes that round `TIMER` up to sixteen are declared padding — `ui8 unused13[3];
//To make multiple of 32 bits.  Altogether 16 bytes.` (`doc/CSBwin-src/CSB.h:2011`) — and
nothing ever reads them. They are nevertheless not zero in a real save, and the reason is
worth writing down because it is the only thing in blocks 2-6 that a writer cannot
reproduce from state.

Two places put bytes there:

- `GameTimers::Allocate` grows the array and `memset`s each **new** slot to 0
  (`doc/CSBwin-src/Timer.cpp:678-683`).
- `SetTimer` fills a slot with `memcpy(A0, A1, sizeof(TIMER))` (`:1132`) from the
  caller's `TIMER`, whose constructor assigns **0xcd** to `m_timerSequence`, the five
  `m_timerUByteN`, `m_timerLevel` and all three of `unused13`
  (`doc/CSBwin-src/CSB.h:1805-1816`). Every other one of those is overwritten before the
  copy; `unused13` is not.

So the field is a high-water mark of slot allocation: 0xcd below the highest slot the
game has ever taken, 0 above it. Measured on the eight committed saves, which all carry
16-byte timers, and the split is exact — no slot holds a third value, and the boundary
sits at or above `FirstAvailTimer` in every one:

| save | live timers | 0xcd slots | first zero slot | `FirstAvailTimer` |
| --- | --- | --- | --- | --- |
| `csbgame-early-1hero.dat` | 1 | 1 | 1 | 1 |
| `csbgame4-door-opening.dat` | 2 | 2 | 2 | 2 |
| `csbgame7.dat` | 76 | 110 | 110 | 76 |

This port keeps no such mark, so `saveSaveGameState` writes 0xcd for a slot that is live
*now* and 0 otherwise — right for a slot CSBWin has never freed, and invisible either
way. `tools/dump-save-blocks-vs-file.ts` asserts every other byte of block 5 against the
file and exempts these three in freed slots by name.

**The timer queue past `NumTimer` is the same kind of debris.** CSBWin writes all
`MaxTimer` words of `m_timerQueue` (`doc/CSBwin-src/SaveGame.cpp:1136`) and `LoadGame`
believes only the first `NumTimer` of them; the rest are what a longer queue left behind
— 34 stale indices in `csbgame7.dat`. The writer zeroes them.

## Three fields of the dungeon image header no reader here was keeping

Writing blocks 7 and 8 back is what exposed them: a section cannot be re-emitted from a
model that does not hold it, and `DungeonLoader` was reading past all three.

- **`LEVELDESC.FILL2[4]`** (`doc/CSBwin-src/CSB.h:2092`) — four bytes between `cellOffset`
  and `offsetX`. CSBWin names them nothing, reads them nowhere, and `swapLevelDescriptors`
  steps over them, swapping `cellOffset`, `word8`, `word10`, `word12` and `word14` and
  nothing else (`doc/CSBwin-src/SaveGame.cpp:609-620`). The loader used to read them as
  "component flags (DM2 only)" and an "unused word" and discard both.
- **The low byte of `DUNGEONDATINDEX::word4`.** `NumLevel()` is `BITS8_15(word4)`
  (`doc/CSBwin-src/CSB.h:2068`), so the level count is the *high* byte of a big-endian
  word and the low byte is unnamed. The loader read `numMaps` and then `skip(1)`.
- **Bits 8-11 of `LEVELDESC.word12`.** CSBWin declares `NumDoorDecorations` for bits 0-3,
  `numMonsterType` for 4-7 and `experienceMultiplier` for 12-15, and nothing at all for
  8-11 (`doc/CSBwin-src/CSB.h:2104-2126`).

The first two are zero in `dungeon.dat` and in all eight committed saves. **The third
is not**: across the fourteen DM levels bits 8-11 take the values 0, 1, 3 and 4. So it is
real data with no known meaning, and dropping it would have made every level descriptor
this port writes differ from the one it read.

All three now live on `DungeonHeader.word4Low` and `MapDescriptor.fill2` /
`MapDescriptor.word12Bits8_11`, named as CSBWin names them where it names them at all, and
documented as unread. `tools/dump-dungeon-image-blocks.ts` is the check: blocks 7, 8, 9 and
14 written again from a parsed world and compared with the file's own bytes, for
`dungeon.dat` and for every save. Blanking `word12Bits8_11` in the writer fails it on
levels 3, 5 and 12 of every one of the nine files.

### The cell flag array's length is derivable, and lands on the declared value

Each level's cells start at its `LEVELDESC.cellOffset` and run `width * height` bytes,
immediately followed by four per-level tables whose lengths the descriptor gives — monster
types, then the wall, floor and door decoration tables (`SetPartyLevel`,
`doc/CSBwin-src/CSBCode.cpp:5778+`). The far end of the last of them is the array's length.
Computed that way it is **12366** for `dungeon.dat` and for every committed save — which is
exactly `dungeon.dat`'s `LegacyCellFlagArraySize` (`word2`) and the saves'
`EXTENDEDFEATURESBLOCK.cellFlagArraySize`.

The two are not interchangeable, which is why `word2` is carried rather than recomputed:
`ReadDatabases` prefers `cellflagArraySize` and falls back to `LegacyCellFlagArraySize`
only when that is 0 (`doc/CSBwin-src/SaveGame.cpp:2412-2415`), and the committed saves
fill only the block's — `word2` is 0 in all eight.

## Ten more fields the record parsers were dropping, and the whole of `EXPOOL`

The same lesson as the header fields above, on a larger scale: writing block 13 back is
what found them, because a record cannot be re-emitted from a model that does not hold it.
Each is a bit range that `DungeonLoader` read past, against the `DBn` class it belongs to
in `doc/CSBwin-src/CSB.h:818-1345`. They are all carried on the record now, named for the
bits they occupy, and all optional — a record this engine creates at runtime has no
original bytes to preserve.

| Record | Bits | Set in the data? |
| --- | --- | --- |
| `DB0` door | `word2` bits 9-15, marked `????` (`:822-829`) | no |
| `DB1` teleporter | the low byte of `word4`; only `destLevel()` = bits 8-15 is named (`:863-870`) | no |
| `DB2` text | `word2` bits 1-2, between `show()` and `index()` (`:988-1002`) | no |
| `DB4` creature | `word14` bits 4, 7 and 15 (`:1096-1139`) | **yes** — `creature[38]` of `dungeon.dat` holds `word14 = 0x490`, bits 4, 7 and 10 |
| `DB6` clothing | `word2` bits 14-15 (`:1176-1192`) | no |
| `DB7` scroll, 4-byte form | `word2` bits 10-15, the old `b10_15()` (`:1199-1206`) | **yes** — bit 10 |
| `DB7` scroll, 6-byte form | `m_word4` bits 1-15, and `m_RNtext`'s position and category (`:1195-1216`) | **yes** — arbitrary values, see below |
| `DB9` chest | all of `m_word4` but bits 1-2, and `m_uByte6[2]` (`:1236-1250`) | **yes** — bits 0 and 3-7 of `m_word4` |
| `DB10` misc | `cursed()` bit 8 and `subType()` bits 9-13 (`:1300-1305`) | no |

"Set in the data?" is measured over `dungeon.dat` and the eight committed saves, and it
is the difference between a field a canary can prove and one it cannot: blanking any of
the six that are set fails `tools/dump-dungeon-image-blocks.ts`, and blanking the rest
cannot, because they are already zero. They are carried anyway, for the reason `FILL2` is:
nothing derives them, and a third-party dungeon is free to use them.

**The new scroll's `m_word4` is allocation debris, and is written back verbatim.** The
struct comment says "Bits 1-15 unused", and they are — but they are not *zero*:
`convertScrolls` sets bit 0 alone with `pScroll->open(openFlag==0)`, which is
`SETWBITS0_0` over whatever the six-byte record already held
(`doc/CSBwin-src/SaveGame.cpp:2144-2166`), and the record was grown in place from the
four-byte form. A genuine save therefore carries values like `0x1c02`, `0x586c` and
`0xa030` there. This is `TIMER.unused13` again: CSBWin never reads it, and the only way to
write the file back byte for byte is to carry it.

**`EXPOOL` — database 11 — had no parser at all.** `getDatabaseRecordSize` returned 256 so
the layout would close, and the bytes were then skipped and discarded; the one consumer,
`parseSpecialLocationsFromSaveData`, hashes its own copy straight out of the save file.
`DungeonData.expool` now keeps the whole section as bytes (9 records in the seven
made-to-order saves, 13 in `csbgame7.dat`), which is what lets a save be written back carrying the EXPOOL it was
read with. `SaveGame` deposits the DSA global variables and the 24 overlay palette
records into EXPOOL immediately before the image (`doc/CSBwin-src/SaveGame.cpp:1141-1164`).
The port writes both ("The DSA global variables are the `EXPOOL` records a read finds",
and the overlay palette in "`EXPOOL` is a directory block, free lists by record length,
and 32 hash chains").

## Block 15: `WriteAndChecksum` sums bytes, and the closing word is big-endian

`WriteAndChecksum` writes a section and then adds each of its **bytes** into a local
`ui16` starting from zero, and adds that into a running total
(`doc/CSBwin-src/SaveGame.cpp:679-698`). Since every section is accumulated the same way,
the result is simply the sum of every byte of blocks 7-14 modulo 65536. The total is reset
to 0 immediately before the image header goes out (`:1166`), so nothing from blocks 0-6 is
in it, and it is written through `LE16` (`:1220-1222`) — a byte swap on the little-endian
build CSBWin ships as — so it lands **big-endian** like the rest of the image.

Verified the strongest way available: `tools/dump-dungeon-image-blocks.ts` computes the
sum over each committed save's **own** image bytes and compares it with the word that save
ends with. All fourteen agree, so the formula is measured against CSBWin's arithmetic
rather than against ours.

## An RN in block 10 or block 13 is the file's own word

Every word of the object list, and every RN of a database record, is a slot of the object
indirect index. The port keeps a save's slots and its maps as they were read, and writes
them back so: blocks 10 and 13 are the file's own bytes, RNs included
(`tools/dump-dungeon-image-blocks.ts`), and block 0 carries the file's maps slot for slot
(`tools/dump-save-blocks-vs-file.ts`).

One class of word is the exception: **the second RN of a free record**.
`DeleteDBEntry` writes `RNnul` over a record's link and frees the indirect slot that named
it, but leaves the rest of the record alone (`doc/CSBwin-src/data.cpp:993-1015`), so a
deleted record routinely still points its possession or contents chain at a slot that has
since been freed. The reader
reads those as `RNnul` (`readRNOfRecord`), and the writer puts `RNnul` back. There are 135
to 256 of them per committed save; the tool counts and reports them, exactly as
`tools/dump-save-blocks-vs-file.ts` exempts `TIMER.unused13`. In `csbgame-early-1hero.dat`
they are 136 words, and they and the closing checksum are the 274 bytes by which the file
written back differs from the file (`tools/dump-save-file-roundtrip.ts`).

## Everything CSBWin converts to slot numbers, and in what order

`ConvertListOfObjects` is called from these places, when an original dungeon is read
(`doc/CSBwin-src/SaveGame.cpp`):

1. **Every cell chain** — one call per column pointer, `:2736`.
2. **The object-carrying timers** — `ConvertTimers`, `:2745`. It switches on the timer
   function: 48 and 49 carry `timerObj6` (bytes 6-7), 24, 25, 60 and 61 carry `timerObj8`
   (bytes 8-9), `:2027-2050`. Every other function reads those bytes as plain numbers.
3. **The thirty possession slots of every champion** — `ConvertCharacters`, `:2746`.
4. **`d.objectInHand`** — `:2753-2760`, guarded on it not being `RNnul`.

Each call records the reference's **position** into `dataTypeMap` as well as allocating
the slot, which matters because an object a champion is carrying is in no cell chain at
all.

The order is the one above, and CSBWin's rule is **first writer wins** — a second
reference to an already-converted object reuses the slot without touching it
(`duplicate >= 0`, `:1958-1964`); the one case CSBWin allows a duplicate for is a
missile's flying object (`DuplicateOK`, `:1918`).

The port numbers a `dungeon.dat` the same way (`convertObjectReferences`,
`src/data/CsbwinDungeonConversions.ts`). A `dungeon.dat` holds no timer, champion or
object in hand, so only the cell chains apply, and the numbering comes out as CSBWin's
(see "DM's two `dungeon.dat` files"). A save's RNs are slots already, a timer's object
among them: `parseTimers` keeps the raw word, as every other RN of the file is kept.
`csbgame-flying-sword.dat` is the save made to order for it: one live timer, function 49,
`timerObj6 = 0x79a`.

## `ReadDatabases` converts an original dungeon once, and a save is written only converted

`LoadGame` and "new game" go through the same reader, and it is the reader that turns a
`dungeon.dat`-shaped image into the shape a save file is written in. Three conversions,
each gated on a flag the Extended Features block declares — so they fire for an original
dungeon, where the flags are false, and not for a save, where they are true
(`doc/CSBwin-src/SaveGame.cpp`):

| Conversion | Gate | Called at | What it does |
| --- | --- | --- | --- |
| `MakeBigActuators` (`:2287-2314`) | `!bigActuators` | `:2604-2607`, inside the ACTUATOR read | ACTUATOR 8 bytes → 10 |
| `ConvertToIndirectText` (`:2221-2276`) | `!indirectText` | `:2645-2648`, after the last database | raw text array → index + compressed text |
| `ConvertListOfObjects` over every cell chain (`:1916-2018`) | `ExtendedFeaturesVersion == '@'` | `:2714-2746`, after the last database | packed RNs → slots of the object indirect index |
| `convertScrolls` (`:2144-2166`) | `ExtendedFeaturesVersion < 'B'` | `:2768-2772`, last of all | SCROLL 4 bytes → 6, 10-bit index → RN |

The **order** is not cosmetic: `convertScrolls` runs after `ConvertToIndirectText`, so the
TEXT record index a scroll's new RN names is the post-conversion one, and after the
chains are numbered, so its `AllocateIndirectIndex` takes the slots after theirs.

Running one twice does not raise an error, it produces a corrupt world — a second
`ConvertToIndirectText` decodes the index it built last time as if it were text, and DM's
1749 words of text come back as 1436. So the gates are the whole safety argument, and
this port uses the same ones (`src/data/CsbwinDungeonConversions.ts`;
`tools/dump-dungeon-conversions.ts` measures the corruption rather than describing it).
`MakeBigActuators` is likewise destructive twice over — the second pass zeroes the
`word8` the first one lifted out of a DSA actuator's parameters. `convertScrolls` twice
names the same texts, rebuilt from a field it never overwrites, in a new slot each.

**The evidence is exact, because every committed save holds this same dungeon
converted.** All eight were started from the DM Windows package's
`dungeon.dat`, which is the same dungeon that CSBWin had already converted (see "DM's two
`dungeon.dat` files"). So the converted form is in the files: converting
`static/gamefiles/dm-atari/dungeon.dat` here and comparing gives 0 differences in the
125-entry indirect text index, 0 in all 1749 words of compressed text, 0 in every TEXT
record's rewritten index word, 0 in the text record every scroll's new RN names and in its
`open` bit, and 0 in every actuator's `word8`.

## A free scroll's text in a CSBWin file

DM's scroll 33 is a free record. In the DM Windows package's `dungeon.dat` and in every
save of `tools/fixtures/`, all written by CSBWin, its text word is 0x047B, its four-byte
form's word (text 123, bit 10 set), where `convertScrolls` would have written a slot,
and scroll 34's text is slot 1945, the slot after scroll 32's 1944. The CSBWin that wrote
them gave the free record no slot. `convertScrolls` in `doc/CSBwin-src/` converts every
record, free or not (`SaveGame.cpp:2151-2163`), and the port follows it: scroll 33's text
gets slot 1945 and scroll 34's 1946, and a converted DM `dungeon.dat` has 1947 slots
where those files have 1946. The texts the slots name are the same
(`tools/dump-extended-dungeon.ts`, `tools/dump-dungeon-conversions.ts`).

## DM's two `dungeon.dat` files

`static/gamefiles/dm-atari/dungeon.dat` (33442 bytes) is the original Atari file: no
Extended Features block, 8-byte actuators, 4-byte scrolls, raw text. The DM Windows
package's (`static/gamefiles/dm-windows/dungeon.dat`, 42025 bytes, the `dm-windows` data
set) is **the same dungeon re-saved by CSBWin** in the shape a save is written in.
Its `graphics.dat` is byte-identical to `dm-atari`'s.

Read through its block by `DungeonLoader.loadDungeonDat` (the image with `bigActuators`,
`newScrolls`, `indirectText`, `expool` and the file's object map as its `RnMaps`), and
compared with `dm-atari` after `convertOriginalDungeon`, the following are identical
(`tools/dump-extended-dungeon.ts`): the header (seed 99, start (1,3) facing 2, 14 levels), every level
descriptor, every cell flag and per-level table, the object list, all the text, and
every record of 10 of the 13 databases. The rest differ only as follows:

- **The 24 mirrors** (type-127 actuators): cleaned of the leftover bits in CSBWin's
  portrait fields, `word4` bits 0-11 and `word6` bits 0-11 and 14-15. `word6` bits 12-13
  (`Position`) keep the Atari values. Today's `ExtendPortraits` zeroes those too
  (`doc/CSBwin-src/SaveGame.cpp:1422`), so an earlier CSBWin wrote this file. Against
  `dm-atari` converted, 18 mirrors differ, in those two bits alone; the other six sit at
  position 0.
- **29 scrolls** carry allocation debris in `m_word4` bits 1-15 (see "A converted
  scroll's `m_word4` upper bits are allocation debris"). The free scroll, record 33,
  holds `RNnul` for its text, and scroll 34's text is slot 1945, one below the port's
  (see "A free scroll's text in a CSBWin file").

The object list is identical slot for slot: the port's `ConvertListOfObjects` numbers
DM's 1911 objects, sub-chains included, into slots 1 to 1911 as the CSBWin that wrote
the file did.
- **One EXPOOL record**, empty (`0xfffe`, then zeros).

The 8583 extra bytes are all format: 6385 of prefix (the 512-byte header, a 1946-slot
object map at 3 bytes a slot, 32 bytes of game information reading "No game information
was provided", and the 3-byte terminator of an empty DSA level index), 1366 for the big
actuators, 504 for the indirect-text index and its size word, 256 for the EXPOOL record,
70 for the six-byte scrolls, and a trailing word.

The header declares `flags` 0xeb: `LevelDSAInfoPresent`, `IndirectText`,
`ExpandedPortraits`, `DMRules`, `BigActuators`, and bit 0x02, which
`EXTENDEDFEATURESBLOCK::FLAGS` does not name (`doc/CSBwin-src/CSB.h:472-481`). It also
declares `extendedFlags` 0xf0: `ExtendedWallDecorations`, `SequencedTimers`,
`DefaultDirectX` and `ExtendedTimers`, with `DMRulesOption` clear. The two timer flags
choose only the size of a timer record in a save (`doc/CSBwin-src/Chaos.cpp:1695-1697`).
The one flag that changes play is `DMRules`: `_ShowPrisonDoor` then forces `DM_rules` on
(`doc/CSBwin-src/CSBCode.cpp:10672-10676`), which a game started from `dm-atari` never
gets from its file.

The committed saves show which file their games were started from. All eight have `flags`
0xe9, keep `Position` on 15 to 17 of the mirrors they still hold and carry `DMRules`: the
Windows package's file. A game started from `dm-atari`, cleaned by `ExtendPortraits`,
holds mirrors with `word6` entirely zero.

## A compressed `dungeon.dat`: CSB's prison

When the game is not a resumed one, `ReadDatabases` reads 8 bytes and, if their first word
is 33028, takes the long at 2 as the expanded size and the word at 6 as `d.Word22592`,
then expands the rest of the file with `ExpandData` and fetches the image from that buffer
(`doc/CSBwin-src/SaveGame.cpp:2346-2374`). Otherwise it rewinds and `Word22592` keeps the
13 `_ReadEntireGame` set (`:1470`). `ExpandData` (`CSBCode.cpp:9864-9929`, with `getBits`
at `:9846`) reads two tables of 4 and 16 bytes, then big-endian words bit by bit from the
top: `0xx` is the first table's entry, `10yyyy` the second's, `11zzzzzzzz` a literal
byte. Its count is the word `D7W`.

CSB's `dungeon.dat` (`static/gamefiles/csb/`) is compressed: 2098 bytes, 2622 expanded,
`Word22592` 12. The image is two levels (20x16 and 21x16), sentinel 8, start (9,0) facing
2, with 4 doors, 26 texts, 30 actuators and 12 groups. Level 0 is where the champions are
chosen: 24 type-127 actuators, the mirrors, values 0 to 23, each facing a square whose
`TEXT` is the champion's, as DM's Hall of Champions has them, and a text at (9,2):
"THERE IS ONLY ONE LEVEL HERE. FIRST CHOOSE YOUR CHAMPIONS...THEN SAVE THE GAME... THEN
RESTART WITH THE UTILITY DISK." (`tools/peek-dungeon.ts`). Its sections end two bytes short of
2622, and those two bytes are the checksum `ReadDatabases` compares with the byte sum of
everything `FetchDataBytes` fetched (`SaveGame.cpp:2654-2658`, `CSBCode.cpp:9081-9106`):
0x939f, which the port's expansion reproduces (`tools/dump-compressed-dungeon.ts`). A
file without the word, as DM's `dungeon.dat` is, skips the comparison, since
`StreamInput` fails to read it.

`ReadExtendedFeatures` runs first (`:2347`), so a `dungeon.dat` may open with an Extended
Features block, and the 8 bytes and the image come after it. A compressed body behind a
block is read from byte 8 plus the block's size, and its length is the file's less both,
unless the block's `ExtendedFeaturesVersion` is `'@'`: then the body is read from byte 8
of the file and its length is the file's less 8 (`:2362-2369`). No shipped file has a
compressed body behind a block; the port reads one built in front of CSB's as CSB's own
(`tools/dump-extended-dungeon.ts`). The block then declares the image's shape and maps its
object references as a save's does, and sets the rules (see "`DM_rules` and
`DMRulesDesignOption`…").

The same comparison holds for every image `ReadDatabases` reads, a save's included.
Every section from the header to the end of the cell flags goes through
`FetchDataBytes`, the scroll database's too (`readOldScrollDatabase` and
`readNewScrollDatabase`, `SaveGame.cpp:2073-2188`), so the sum covers each byte of that
range once. The cell flags' length is the Extended Features block's `cellFlagArraySize`,
or the header's word 2 when that is 0 (`:2412-2419`). The word goes through `LE16`, a
byte swap on the little-endian build, so it is big-endian, as `WriteAndChecksum` writes
it (`:1222`). `StreamInput` fails when fewer bytes remain than it is asked for
(`CSBCode.cpp:9027-9043`), so one stray byte after the cell flags is no word either. A
mismatch returns 0, and `_ReadEntireGame` goes to `tag01efee` (`:1741-1742`). The port
throws "dungeon image checksum mismatch" from `DungeonLoader`
(`tools/dump-image-checksum.ts`).

## "MAKE NEW ADVENTURE" copies a saved game's party into `mini.dat`, block by block

The UTILITY's button 13 (`_TAG004518`, `doc/CSBwin-src/Chaos.cpp:3949-3973`) reads a saved
game into the first of two 4112-byte records and `mini.dat` into the second
(`_ReadSavedGame`, `:2207-2496`), copies the party with `TAG002724` (`:2571-2680`) and
writes the second record as a new file with `_TAG000fc4` (`:1643-1898`). It works on the
blocks as the file holds them, unscrambled but not byte-swapped.

- **The checks.** The saved game is refused with "ALREADY UTILIZED" unless its
  `Byte22596` is 1 or its `Word22594` is 1, and also when its `Word22592` is past 13
  (`_TAG00260e`, `:2501-2546`); a Dungeon Master save CSBWin wrote has 2, 1 and 13, and a
  prison save 12 for the last ("A compressed `dungeon.dat`: CSB's prison"). With no
  party it is message 29, and a champion with no name, or two whose names compare
  equal with `strcmp`, is message 20 (`_CheckChampionNames`, `:1434-1462`). `mini.dat`
  must have `Byte22596` 2 or more and `Word22592` 13 (`_TAG0026c4`, `:2551-2566`).
- **The copy.** Into `mini.dat`'s record go `GAMEBLOCK1` bytes 256-295 and `Word22594`
  of the saved game, its `RandomGameID` plus one, its 3200 bytes of `CHARDESC`s and its
  champion count (`gb2.numcharacter`); everything else is `mini.dat`'s, the party's
  place and the 128 bytes of party state after the `CHARDESC`s included. Each champion
  is turned by `mini.dat`'s facing less the saved game's, facing and corner; bytes 30-34
  become 1, 2, -1, 0, 0; damage, poison, wounds and word 64 are cleared, and both timer
  words -1; health, stamina and mana take their maxima; food then water are
  `1500 + (STRandom() & 255)`; each attribute's current value takes its maximum and its
  minimum becomes 30, Luck's 10; each skill's temporary adjustment is 0, its experience
  kept; the thirty possession slots are `RNnul`, and load and shield 0.
- **Three writes read a big-endian field as the little-endian build holds it.**
  `LoadLong` and `StoreLong` take the low word first (`:789-821`), so "`RandomGameID` + 1"
  adds 1 to the file's first byte, the field's highest. An Atari save's `Word22594` is
  set by `wordGear(+376) = 1` (`:2595`), which leaves the bytes `01 00`, 256. And
  `charFlags` is `LE16(LE16(wordGear(+48) & 16))` (`:2644`): the mask falls on the word
  as memory holds it, so of the file's word it keeps 0x1000 and clears 0x10,
  `CHARFLAG_male`. 0x1000 is `CHARFLAG_portraitChanged` (`CSB.h:2471`), and nothing in
  CSBWin reads `CHARFLAG_male`: `AddCharacter` sets it (`Character.cpp:594`) and that is
  its only use. The `ASSERT`s that flag the first two ("check for LE") are compiled out
  of the release build (`CSBTypes.h:98-103`). The port keeps `CHARFLAG_male` instead
  (`DEBT.md` H).
- **The file.** `_TAG000fc4` sets `Byte22598` to 2, which `SaveGame` never writes, zeroes
  the sixteen words from 312 (the five hashes and `totalMoveCount`), and writes
  `GAMEBLOCK1` with `WriteFirstBlock` (`:1376-1418`), the fold `ScrambleAndWrite` makes,
  then the other five blocks with hash 0 and the dungeon as `TAG00142e` read it, closed
  by its byte sum. An Extended Features block is written only when `mini.dat` opened with
  one; CSB's has none.

`static/gamefiles/csb/csbgame2.dat` is such a file, made from this `mini.dat`: its
`Byte22598` is 2, and made again from itself and `mini.dat` with its own food, water and
`RandomGameID` in place of the draws it is the file byte for byte
(`tools/dump-new-adventure.ts`, which holds the port's `src/engine/Chaos.ts` to every
field above).

## A failed read ends at `tag01efee`

Every `goto tag01efee` in `_ReadEntireGame` is a read that failed: a stream's checksum
(`doc/CSBwin-src/SaveGame.cpp:1601`, `:1621`, `:1673-1697`), `ReadDatabases` returning 0 (`:1741-1742`), and
the checks after it (`:1824-1831`). `tag01efee` fades to `d.Palette11978`, then branches on
`d.PartyHasDied` (`:1895-1907`):

- **0, the boot.** `PRINTLINE("SAVED GAME DAMAGED!")` and `die(0xbad)`. `die` puts up a
  "System Error" message box and ends in `UI_Die` (`CSBCode.cpp:86-112`), which throws
  out of the program (`CSBUI.cpp:1393-1396`).
- **Not 0, after a lost game.** `DoMenu(_14_, "SAVED GAME DAMAGED!", "PUT THE CHAOS
  STRIKES BACK DISK IN ~", "OK", …, 1, 1, 1)`, `WaitForMenuSelect(_6_, 1, 1, 0, 0)`
  between `STShowCursor` and `STHideCursor`, then `goto tag01ec56`, which returns -1
  (`:1556-1559`). The string reaches `DoMenu` without `SubstDiskLetter`, so the "~" is
  drawn as it stands. `_GameSetup`'s loop takes the -1 as a failed read and puts the
  entrance up again (`CSBCode.cpp:10634-10641`). `d.PartyHasDied` is set by the credits'
  RESTART THIS GAME (`Mouse.cpp:1798`).

A new game's read is the same `_ReadEntireGame`, made once the entrance's doors have
opened on ENTER: it opens `dungeon.dat` (`SaveGame.cpp:1480-1486`), where a file that will
not open is `die(50)` with "Cannot open dungeon file", not `tag01efee`, and then
`ReadDatabases` (`:1740-1742`), whose failure is. Before any read, `d` is as
`d.Initialize()` leaves it, and `d.Initialize()` seeds `d.RandomNumber` from the host's
`rand()` and draws nothing (`CSBCode.cpp:350-351`); `d.RandomGameID`'s two draws are the
read's (`SaveGame.cpp:1523-1532`).

The port's boot runs `tag01efee` in `src/renderer/intro/BootSequence.ts`, reached from
the load-only chooser (`restoreChosenSave`, `src/renderer/ui/SaveMenu.ts`) and from a new
game's read (`readNewGame` there, over `Game.readDungeonDat`). The page builds its `Game`
over the empty world (`emptyDungeonData`) and reads `dungeon.dat` into it after ENTER. At
the boot, the line is a one-button menu and its click goes back to the title (`DEBT.md`
H); a `dungeon.dat` that will not open throws `Die`, which the page reports as it reports
any error that ends `init`. The full save menu, which CSBWin does not have, keeps its
status line. Evidence: `tools/dump-bad-saved-game.ts`, and `tools/dump-new-game.ts` for the
empty world's random stream.

## A one-button menu takes no key

`_WaitForMenuSelect` has an arm for a one-button menu that reads the keyboard
(`doc/CSBwin-src/Menu.cpp:82-93`), but it cannot select the button. `UI_CONSTAT` returns 1
when a key is queued and 0 otherwise (`CSBUI.cpp:1370-1374`), and the arm then calls
`NotImplemented(0x1d25a)` in place of `DIRECT_CONIN`. `NotImplemented` puts up a message
box and calls `UI_Die`, which ends the program (`system.cpp:177-189`). Its `D0W == 13` test
compares `UI_CONSTAT`'s 0 or 1, so it is never true. Only a click ends such a menu. The
port's `waitForMenuSelect` (`src/renderer/intro/BootSequence.ts`) ignores keys, where
CSBWin would end.

## `ExtendPortraits` cleans the mirrors of every file read without `ExpandedPortraits`

`_ReadEntireGame` calls `CheckCelltypes()`, `CheckMonsters()` and `ExtendPortraits()` once
the whole file is read (`doc/CSBwin-src/SaveGame.cpp:1825-1827`), for a new game and a
save alike. `ExtendPortraits` (`:1402-1426`) returns at once if `extendedPortraits` is set.
Otherwise, for every actuator whose link is not `RNnul` and whose type is 127 (a Hall of
Champions mirror), it zeroes `ClearResponses`, `SetResponses`, `ToggleResponses`, the
unused bits, `State`, `BlockDisables`, `DisableMessage` and `Position`
(`CSB.h:1055-1069`): `word4` bits 0-11 and the whole of `word6`. The wall graphic ordinal
and the type/value word are kept. Then it sets `extendedPortraits`.

The flag does not outlive a read: `_ReadEntireGame` sets it `false` before anything else
(`:1462`, marked 20150806), and only `ReadExtendedFeatures` assigns it, from
`flags & ExpandedPortraits` (0x20, `:403`). So every file with no Extended Features block
is cleaned (DM's `dm-atari/dungeon.dat`, CSB's prison and its Atari-era saves), and so is
a block without the flag. `SaveGame` always sets it (`:963`), so a file CSBWin writes is
never cleaned again.

In `dm-atari/dungeon.dat` all 24 mirrors carry leftover bits there (`word4` 0xa080, and
`word6` non-zero on 23 of them). Mirror 286 (champion 20, level 0 at (17,10)) has `word4`
0xa880, which reads `State` = 4, `PORTRAIT_HideGraphic`: uncleaned, its frame would not
be drawn (`Codea59a.cpp:134-137`). The port runs it at the end of `DungeonLoader`'s parse,
gated on `DungeonImageOptions.expandedPortraits`, which `loadCsbwinWorld` takes from the
save's block (`tools/dump-extend-portraits.ts`).

## The "simple" encipherment is `RC4.cpp`'s own cipher, with a key of one byte

`RC4.cpp` opens with "This is NOT the RC4 encryption algorithm!!!! Only the key
preparation is from RC4" (`doc/CSBwin-src/RC4.cpp:1-3`), and it is so:

- `RC4_prepare_key` (`:20-48`) fills 8192 bytes of state with `(unsigned char)counter`,
  runs RC4's key schedule over the first 256, then for each byte from 256 up takes one
  step of RC4's output over the first 256 and XORs that byte into `state[counter]`.
- `swap_byte` is the XOR swap (`:14`), so an entry swapped with itself becomes 0: the
  first 256 bytes are not a permutation (32 of them are 0 under the simple key).
- `RC4_encipher(buffer, len, position)` (`:52-55`) XORs the buffer with
  `state[(position + i) % 8192]`: the state is the stream, and it repeats every 8192
  bytes of the file.

A file is behind it when `SimpleEncryption` (`EF_FLAGS` 0x04) is in its Extended
Features block. The key is `simple[0] = 1; simple[1] = 0; RC4_prepare_key(simple, 1)`:
one byte, the second never read (`doc/CSBwin-src/SaveGame.cpp:326-329`, and `SaveGame`'s
at `:915-918`). `ReadExtendedFeatures` deciphers the 512 bytes it has read at position 0
when they do not open with the sentinel, and marks the file enciphered if they then do
and carry the flag (`:324-338`); from there `READ` deciphers every buffer by its position
in the file (`doc/CSBwin-src/system.cpp:301-313`), and `WRITE` enciphers the same way
(`:315-329`). The whole file is enciphered, the block included.

`ReadExtendedFeatures` sets the global `simpleEncipher` with the file's mark (`:337`),
and nothing clears it (`doc/CSBwin-src/data.cpp:243`). `SaveGame` then marks every save
file enciphered with the same key (`SaveGame.cpp:914-920`) and sets `SimpleEncryption`
in its block (`:943-946`): once an enciphered file is read, every save is enciphered,
whatever file is read after it.

`rc4PrepareKey` and `rc4Encipher` (`src/data/CsbwinExtendedFeatures.ts`) are the two
functions, and `simpleEncipher` puts a whole file through them. `readExtendedFeatures`
hands back an enciphered file deciphered whole, which every reader reads on from;
`ctx.rules.simpleEncipher` is the global, and `saveSaveGameState` enciphers a save whose
block declares `SimpleEncryption`. `tools/dump-extended-features-read.ts` checks the
stream against `RC4.cpp` compiled as it stands, and against Conflux 3.5's `dungeon.dat`
(`static/gamefiles/conflux-3.5-b8/`), which is such a file: deciphered, it opens with the
sentinel, its `flags` are 0xff, the block's checksum matches, and so do the two object
maps' behind it, 59775 bytes read by their position. Its image reads to the file's last
word, the sum of every byte before it. The tool also enciphers DM's CSBWin
`dungeon.dat` as CSBWin would, and holds a game on it to an enciphered save.

## A block `ReadExtendedFeatures` gives up on is no block

`ReadExtendedFeatures` notes the file position, reads 512 bytes, and in four cases seeks
back to that position and returns 0 (`doc/CSBwin-src/SaveGame.cpp:320-353`):

- fewer than 512 bytes were read (`:323`);
- `strcmp(efb.sentinel, " Extended Features ") != 0`, and deciphered under the simple key
  the same test still fails (`:324-343`). `strcmp` wants the terminator, so `sentinel[19]`
  must be 0;
- the sentinel is there once deciphered, but `flags` has no `SimpleEncryption`
  (`:333-343`);
- `FormChecksum` over the 512 bytes, with `extendedFeaturesChecksum` zeroed, is not the
  stored value (`:345-353`).

Its two callers take the 0 as `ExtendedFeaturesSize` and read on from the file's first
byte: `LoadGame` reads GAMEBLOCK1 there (`:1599-1601`), and `ReadDatabases` the dungeon's
first eight bytes (`:2348-2350`). A damaged block is therefore never an error of its own.
The file fails, or not, by what its first bytes are when read as something else: a save
whose block has one byte changed fails `ReadUnscrambleBlock`, which is `tag01efee`.

`ExtendedFeaturesVersion` is `'@'` and every flag false from the function's first lines
(`:305-315`), so a file given up on is read in the original shapes. The two errors the
function does raise come later, once the block is believed: the object maps' checksums
and lengths, "Extended features damaged" and `die(0xe3ee17)` (`:367-376`).

`readExtendedFeatures` (`src/data/CsbwinExtendedFeatures.ts`) returns its no-block
result in the four cases, checked by `tools/dump-extended-features-read.ts`.

## `CheckMonsters` overwrites a save's attached groups, and the game's start puts them back

`CheckMonsters` (`doc/CSBwin-src/SaveGame.cpp:1342-1365`) walks every cell of every level
and calls `CheckMonster` (`:1279-1340`) on each group and each group among its
possessions. By the creature's `horizontalSize`: size 1 cuts a group of more than two to
`numMonM1` 1 with `groupIndex` 2, and gives a pair whose positions are not opposite
(`pos1 ^ pos2 != 2`) `groupIndex` 2; size 2 cuts a group to one, and gives any group whose
`groupIndex` is not 255 that value. Each fix also sets `facing` 0. `numMonster` is read
once, before the cut. The two warnings ("Too many monsters of size 2", "… of size 4") are
shown once per process (`static bool`); the two "improperly positioned" ones are commented
out. `CheckCelltypes` (`:1367-1400`) makes every cell of room type above 6 open floor,
keeping the low five bits.

A save holds the `ITEM16` index in `groupIndex` for every group on the party's level:
`SaveGame` writes the file before `TAG00bd40` detaches them (`:1243`), and
`_ReadEntireGame` reads the pool back (`:1668-1675`) before these run (`:1825-1826`). So
`CheckMonster` reads an index as positions, and every attached size-2 group whose index is
not 255 gets 255 and `facing` 0. The game's start undoes it: `LoadPartyLevel` begins with
`TAG00bd40` (`CSBCode.cpp:795`), and `DetachItem16` writes `groupIndex` and `facing` back
from the slot (`CSBCode.cpp:6127-6131`), not from the record. Only a cut `numMonM1` stays.

Measured (`tools/dump-check-monsters.ts`): `dm-atari/dungeon.dat` has no room type above 6
and no group `CheckMonsters` changes. The committed saves and CSB's `mini.dat` and
`csbgame2.dat` need no cut either; what it touches in them is 12 attached size-2 groups
(two in `csbgame7.dat` and five in each of CSB's, of monster types 9 and 0), and in
`csbgame7.dat` their slots' facing (2) comes back after the restore where the check
wrote 0. CSB's `graphics.dat` gives the 27 monster types the same sizes as DM's.

## `DM_rules` and `DMRulesDesignOption` are process-wide, and only a block sets them

`DM_rules` (`doc/CSBwin-src/data.cpp:251`) and `DMRulesDesignOption` (`CSBUI.cpp:137`) are
plain globals, both `false` at start, outside `d.`. `DM_rules` is read in one place: the
reincarnation in `_ResurrectReincarnateCancel` lowers attributes 1-6 and scales HP,
stamina and mana only `if (!DM_rules)` (`CSBCode.cpp:6740`, `:6761`).

They are assigned in four places:

- `ReadExtendedFeatures`: `DMRulesDesignOption` from `flags & DMRules` (0x40),
  `DM_rules` from `extendedFlags & DMRulesOption` (0x08) (`SaveGame.cpp:392-398`). A file
  with no block never reaches it, so both keep what they held: a new game on
  `dm-atari/dungeon.dat`, and CSB's Atari-era saves. A new game on
  `dm-windows/dungeon.dat` gets `DMRulesDesignOption` and not `DM_rules`
  (`tools/dump-extended-dungeon.ts`). The port reads a new game's in
  `Game.readNewGameRules`, a save's in `applyCsbwinSave`.
- `_ShowPrisonDoor`, once `GameSetup(_1_, 1)` has read the game, new or resumed:
  `if (DMRulesDesignOption) DM_rules = true` (`CSBCode.cpp:10672-10676`). The restart
  after a lost game calls `GameSetup(_25_, 0)` straight (`Code1f9e6.cpp:310`), without it.
- The player's "DM Rules" menu item toggles `DM_rules` (`CSBUI.cpp:912-914`), at any
  time. The menu's check mark is set from `DM_rules` each time the menu opens
  (`WM_INITMENUPOPUP`, `CSBwin.cpp:1116`, `:1162-1166`).
- Playback of a recording (`Recording.cpp:285`, `:291`).

`SaveGame` writes both back (`SaveGame.cpp:950-955`). All eight committed saves carry
both bits.

## `NumWordsInTextArray` means two different things either side of the conversion

`DUNGEONDATINDEX::word6` sizes the raw text array in a `dungeon.dat` — 1749 words for DM
— and `ConvertToIndirectText` overwrites it with the **length of the indirect index**,
`NumWordsInTextArray((ui16)indirectIndexLen)` (`doc/CSBwin-src/SaveGame.cpp:2274`). All
eight committed saves declare 125, which is exactly the number of TEXT records with a
non-null link. A writer that carried the loaded value through would declare 1749 in a
save and send its reader 3248 bytes past the end of the text section.

`DB2::index()` — `word2` bits 3-15 — changes meaning in the same breath
(`pDB2->index(newIndex)`, `:2270`): a word offset into the text array before, an entry
number in `indirectTextIndex` after. This port models it as CSBWin does, one field with
two meanings (`TextRecord.textOffset`), and `textStart` is the single place that resolves
which. It used to keep a *second* field for the converted value, which meant a genuine
save — which arrives already converted, so nothing ever set the second field — decoded
every wall text, scroll and message from the wrong place in the compressed array.

A record whose link is `RNnul` is skipped outright (`:2237`) and keeps its old index, so
the index is shorter than the database and free records are not addressable through it.

## `MakeBigActuators` runs before the byte swap, so CSBWin reads the wrong `word2`

`ReadDatabases` calls it between `FetchDataBytes` and `db.swap(dbACTUATOR)`
(`doc/CSBwin-src/SaveGame.cpp:2601-2608`). `DB3::swap` is what turns the file's
big-endian words into host order (`doc/CSBwin-src/data.cpp:1319-1325`), so on the
little-endian build CSBWin ships, `DB3::MakeBig`'s `actuatorType()` reads bits 0-6 of a
word that still holds the file's byte order — which is bits **8-14** of the true `word2`,
the actuator's value rather than its type (`LE16` is a real byte swap under
`_littleEndian`, `doc/CSBwin-src/CSBTypes.h:140-149`).

This port's records are decoded by the time the conversion sees them, so it reads the
type CSBWin meant. The two agree for any dungeon with no type-47 actuator under *either*
reading, and DM's `dungeon.dat` has none under either — 0 of 683 decoded, 0 of 683 read
the way CSBWin reads them. `tools/dump-dungeon-conversions.ts` asserts that rather than
assuming it, so a third-party dungeon that would expose the difference fails loudly.

`MakeBig` itself carries a second quirk, transcribed rather than repaired:
`word8 = ((word6 >> 12) & 0xc0) | ((word4 >> 14) & 0x03)` (`doc/CSBwin-src/data.cpp:1327-1334`)
can never set bits 6-7, because `word6` is sixteen bits wide — yet `ParameterB` reads
`(word8 & 0x0c) << 14`, a different pair of bits again (`:1341-1344`). No dungeon this
project holds has a DSA actuator, so nothing here can tell which was intended.

## A converted scroll's `m_word4` upper bits are allocation debris

`convertScrolls` writes `pScroll->open(openFlag==0)` — bit 0 of the new `m_word4` — over
whatever the two bytes the record just grew by happened to contain, and nothing
initialises them (`doc/CSBwin-src/SaveGame.cpp:2144-2166`;
`readOldScrollDatabase` allocates the six-byte form and fills four). Measured in
every committed save, records 0-5 carry 3585, 530, 5132, 532, 3587 and 536 in bits 1-15, and 28
of the 35 scrolls are non-zero. The port carries them verbatim when it reads a save
(`ScrollRecord.word4Bits1_15`) and writes 0 for a scroll it converts itself, which is the
only honest value; `tools/dump-dungeon-conversions.ts` reports the count rather than
comparing it, the same treatment `TIMER.unused13` gets.

A **free** scroll — link `RNnul`, which DM has exactly one of, record 33 — is converted by
CSBWin like any other and keeps a valid text slot. This port's reader drops a free
record's secondary RN rather than resolve a slot `DeleteDBEntry` may since have freed
(`doc/CSBwin-src/data.cpp:993-1015`), and its writer puts `RNnul` back, so that one record
is exempt from the comparison by name.

## The Extended Features header a live game writes, field by field

`SaveGame` builds it from `memset(&efb,0,512)` and assigns fourteen things
(`doc/CSBwin-src/SaveGame.cpp:915-980`); everything it does not assign is genuinely zero
rather than merely unknown. Measured across the committed saves, the eight fields that
are always zero are `editingOptions`, `graphicsSignature1/2`, `csbGraphicsSignature1/2`,
`spellFilterLocation`, `hintKey[8]` and `overlayOrdinal` with its four parameters.

`flags` gets four bits unconditionally — `LevelDSAInfoPresent` (`:940`), `IndirectText`,
`ExpandedPortraits` and `BigActuators` (`:961-963`) — which is 0xa9. The committed saves
carry 0xe9, the same four plus `DMRules`, written from `DMRulesDesignOption` (`:952-953`).
`SimpleEncryption` and `AutoRecord` are the other two, both conditional and both off
everywhere.

`extendedFlags` gets three unconditionally (`:964-966`): `SequencedTimers`,
`ExtendedTimers` — which together select the 16-byte `TIMER` — and `DefaultDirectX`,
which is 0xe0. The committed saves add
`ExtendedWallDecorations` and `DMRulesOption`, written from `DM_rules` (`:950-951`), for 0xf8.

`LevelDSAInfoPresent` is not decorative: `ReadExtendedFeatures` reads the DSA level index
back only when that bit is set (`:387-390`), and the index is always written — so a
header without the bit leaves three bytes of terminator for GAMEBLOCK1 to eat.

`gameInfoSize` is 0 for "no game information at all" and `gameInfoSize - 1` when there is
some (`:977-978`), which makes **-1** an allocated-but-empty string. A port with no game
information writes 0.

## A live timer keeps its object in three places, and a file has one

CSBWin's `TIMER` has one byte pair at 6-7 and one at 8-9, read either as two bytes or as
one word depending on the timer function (`doc/CSBwin-src/CSB.h:1818-1860`). This port's
live `TimerEntry` carries `uByte6..9`, `timerWord6`, `timerWord8` **and** an `object`
field with no byte at all — so writing one to a file is a collapse, and it was being done
wrong in two ways at once.

`MagicSystem.launchMissile` puts the missile record's RN on `TimerEntry.object` and passes
the launch square as `x, y`, so a saved missile timer went out with its launch square in
bytes 6-7 — where `ConvertTimers` says the object lives — and zeros in bytes 8-9, where
the packed `[x:5][y:5][direction:2][decay:4]` word belongs, because `pos` and `action` are
both 0 for a missile. `csbgame-flying-sword.dat` settles both: function 49, bytes 6-7
`07 9a` (the object's indirect slot) and bytes 8-9 `a9 09` (the packed word,
`timerWord8`). `Game.collapseTimerBytes` is the one place the three representations meet
now, and `restoreTimerQueue` is its inverse.

The other conflict is benign and is guarded rather than assumed: a magic shield or poison
timer keeps a **count** in `timerWord6` while `uByte6`/`uByte7` are zero, because
`MagicSystem.queueUtilityTimer` passes `x = y = 0`. The two representations can only disagree
when one of them is zero, since no creator sets both.

**And the reader has to resolve what the writer encoded.** `parseTimers` keeps bytes 6-9
as it finds them, which is right for the timer functions that read them as plain numbers
and wrong for the six that do not: in a save those two bytes are an indirect slot, not an
RN. Nothing consumed one until the engine started restoring a timer's object at all;
`CsbwinSaveGame.resolveTimerObjects` is where the translation happens now, and without it
a restored missile names whatever record our own numbering put at that slot.

## A missile flying off the map meets the exterior wall

When the cell a missile leaves its own for is off the map, `MissileTimer` sets its room to
`roomEXTERIOR` (20, `doc/CSBwin-src/CSB.h:571`) whatever `GetCellFlags` answered
(`doc/CSBwin-src/Timer.cpp:321-330`), and `nextIsStoneWall` counts it as stone (`:340`).
So the missile meets it through `ProcessMissileEncounter(roomEXTERIOR, origMapX, origMapY,
origMapX, origMapY, curPos, …)` (`:349-364`), whose exterior arm runs filter 6 and ignores
its answer (`Code11f52.cpp:1841-1843`), where the stone arm lets filter 4 keep the missile
flying (`:1835-1840`). The shared tail follows (`:2044-2135`), which always returns 1: a
spell becomes its cloud in the square it was flying from (`CreateCloud`, `:2099`), anything
else sounds and drops there. Evidence: `tools/dump-missile-exterior.ts`.

## A door-blocked missile drops at its own `.pos()`, not at the `objectPos` it filters with

`MissileTimer` (`doc/CSBwin-src/Timer.cpp:302-423`) tracks a flying missile's position
within a cell as one of four corners, hopping to the adjacent corner every tick along the
direction of travel. On the tick that transition would carry it out of its *current* cell
(`leavingThisCell` true), the missile's own RN gets `.pos(curPos)` written before
`MoveObject` carries it into the new cell (`:382`, `:393`) — an explicit write. On the tick
a closed door instead blocks that same kind of internal transition (`leavingThisCell`
false, `:399-419`), no such write happens: the RN's `.pos()` bits are simply left at
whatever they already were, one hop behind.

But `curPos` itself *is* still advanced first, unconditionally, at `:370-377`, and that
advanced value is what gets threaded into `ProcessMissileEncounter` as its `objectPos`
parameter (`:411`) — used there for `MissileEncounterFilter` and, for a shattered potion,
`CreateCloud`'s position. `ProcessObjectFromMissile`, the function every encounter path
ends in, ignores that parameter entirely and drops the object at `missile.pos()`
(`:156-157`, `objD6.pos(missile.pos())`) — the *unadvanced* value, since `missile` is the
same RN whose position field the door-blocked path never touched.

So a plain thrown weapon or misc item that a closed door stops lands one corner short of
where the same call's `objectPos` points — proven by contrast: a shattered potion's cloud
(which *does* use `objectPos`) and the dropped-but-not-shattered item it would have left
behind sit at two different corners of the same door cell for the identical encounter.
`TimerSystem.processObjectFromMissile` used to take a caller-supplied `posInCell` and drop
there, collapsing the two into one value; it now derives the drop corner from the missile
RN it already holds. `tools/dump-missile-drop.ts`'s door scenario is the evidence: it
records the missile's resting corner the tick before a real closed door blocks it, then
checks the landed item sits there and not at the corner `objectPos` would have used.

## `QueueSound`'s argument is an ordinal into the sound table, not a SND item number

Every `QueueSound(soundNum, x, y, dt)` call in CSBWin passes a small integer — 0, 4, 5,
13, 20, … — that indexes `d.sound1772`, the sound table `graphic232` carries
(`TimerSystem.SoundQueue`'s own doc comment already established this for the monster
code; it holds just as much for the impact/cloud code). Each table entry supplies the
actual SND item (`word0`), a playback-rate variant, and the two distance thresholds that
decide volume and audibility — the ordinal is a lookup key, not the sound.

Two ordinals used by a thrown object's impact resolve to specific SND items worth
knowing, confirmed by extracting the real `graphics.dat` table: ordinal 0 → item 533
(a falling item), ordinal 4 → item 536, ordinal 5 → item 537, ordinal 13 → item 545, and
ordinal 20 → item **537 again** — the same SND item as ordinal 5, at a shorter falloff
distance (`byte7`: 4 against 7) and a slightly different playback-rate byte. `CreateCloud`
(`doc/CSBwin-src/Code11f52.cpp:1436`) picks between exactly these two, `size>80 ? 5 : 20`,
for a fireball, poison bolt or lightning bolt — so a small blast is the *same* explosion
sample, just quieter, never ordinal 13's unrelated sample.

The volume is the ordinal's, decided in `QueueSound` and not by whoever plays the sample.
From the orthogonal distance `|dx| + |dy|`, `LOCAL_12` is 1 at or below the entry's
`byte6`, 0 above it, and -1 at or above `byte7`, and a -1 is not played
(`doc/CSBwin-src/CSBCode.cpp:1867-1876`, `:1878`), unless the sound filter's DSAs play
it (see "The sound filter hands a sound to the dungeon's DSAs"). `StartSound` receives `LOCAL_12` as
`highVolume` (`:1894-1896`) and attenuates a 0 eighteen times
(`doc/CSBwin-src/Sound.cpp:662-663`). So ordinal 5 (`byte6` 3, `byte7` 7) is loud up to
three squares and quiet up to six, and ordinal 20 (0 and 4) is loud only on the square
and quiet up to three, although both play item 537. `tools/dump-queue-sound.ts` case 9.

A sound queued with `deltaTime > 1` is not played: `QueueSound` sets a `TT_20` (20) due at
`d.Time + (deltaTime & 0xffff) - 1`, on `d.LoadedLevel`, with the entry's `byte4` in
`timerUByte5`, the square in `timerUByte6`/`timerUByte7` and the ordinal in `timerWord8`
(`doc/CSBwin-src/CSBCode.cpp:1832-1848`), after the other-level test that drops any sound
with a non-zero `deltaTime` (`:1827-1830`). When it fires, `ProcessTimers` calls
`QueueSound(timerWord8, timerUByte6, timerUByte7, 1)` (`:6485-6492`) with the timer's level
loaded. The callers with a delay are a champion's wound, `deltaTime` 2
(`Monster.cpp:4584`), the door bash (`Attack.cpp:1808`) and a group's death.
`tools/dump-queue-sound.ts` case 10.

`ProcessMissileEncounter`'s shared ending (`Code11f52.cpp:2101-2121`) and `CreateCloud`'s
own sound (`Code11f52.cpp:1432-1447`) are the two call sites `TimerSystem` used to read
past — `playMissileImpactSound` and `playCloudSound` called `playSound` with a hand-typed
`SoundIndex` graphics.dat item instead of `queueSound` with CSBWin's literal ordinal, and
along the way substituted ordinal 5's item for ordinal 4's (a plain object's impact) and
ordinal 13's item for ordinal 20's (a small blast) — see PLAN.md for the fix and its
evidence.

## The sound filter hands a sound to the dungeon's DSAs, a silent one included

`QueueSound` calls `SoundFilter(soundNum, LOCAL_12, &soundLocr)` once it has the volume,
-1 included, and before it drops a silent sound, with `soundLocr` the square on
`d.LoadedLevel` (`doc/CSBwin-src/CSBCode.cpp:1825`, `:1877-1878`); a 0 back means the
filter took the sound, and `QueueSound` plays nothing. `SoundFilter`
(`doc/CSBwin-src/Sound.cpp:670-756`) runs every type-47 actuator at `ESL_SOUNDFILTER`'s
location (8, `CSB.h:1543`), each with `continue` (`:744`), under one `NEWDSAPARAMETERS`.
Each sees nine parameters (`:730-739`): the ordinal plus 1, the volume, `dx*dx + dy*dy`
from the party's square, the sound's level, x and y, `gameVolume`, `NoSound`, and the
distance in hundredths, three integer Newton steps from `100 * max(dx, dy)` when the
squared distance is not 0 (`:698-704`): 141 for (1, 1), 500 for (3, 4). It returns 0 when a
DSA ran, 1 when none did, and 2 at once while its DSAs run (`filterActive`, `:672-676`,
`:749-754`), so a sound they queue plays on. The DSA plays the sound if it pleases, with
`&SOUND` (`PlayCustomSound`, `:1039-1062`). `gameVolume` is the volume menu's
(`VOLUME_FULL`, 0, by default) and `NoSound` a recording's `#NoSound` line (false by
default, `doc/CSBwin-src/data.cpp:249`, `:277`, `Recording.cpp:321-328`).
`tools/dump-sound-filter.ts`.

## The action name filter runs its location's first DSA, found once, for each option offered

`DrawLegalAttackTypes` names each of the three rows with `GetAttackTypeName`, whose argument's
low byte indexes `AttackNames` and is nothing at 255 (`doc/CSBwin-src/CSBCode.cpp:8609-8627`),
and hands each row below `numAttackOption`, the rows offered, to `ActionNameFilter` with that
name as its default (`:8772-8778`). `numAttackOption` is 3, 2 when `PossibleAttackTypes[2]` is
-1, and 1 when `[1]` is (`:8745-8756`). `ActionNameFilter` (`:8634-8713`) looks for its DSA
the first time only: `actionNameDSA` starts as `RNnul` and becomes the first type-47 actuator
at `ESL_ACTIONNAMEFILTER`'s location (10, `CSB.h:1545`), with `break`, or `RNeof`, and keeps
it for the life of the process (`:8631`, `:8638-8675`). It sets five parameters
(`:8691-8696`): the champion, the option, -1, `numAttackOption` and the option's attack type.
After the run, parameter 4 becomes the option's attack type, cut to an `i8` (`:8699`), which
is what `ExecuteAttack` then performs; parameter 2, a `ui32`, names the row with the global
text `(EDT_GlobalText << 24) | p` read as a `char *` when it is below 0x10000 and the record's
size is above 0 (`:8700-8711`), so the -1 it starts at leaves the default. The name drawn
for a retyped row is the type it had. `tools/dump-action-name-filter.ts`.

## The feeding filter runs every DSA at its location on the whole feeding block

`_FeedCharacter` works out what the object on the cursor is worth into a `FEEDPARAMETERS`
block (`doc/CSBwin-src/Character.cpp:3936-3997`, `:4032-4285`) and then, before anything
changes, runs every type-47 actuator at `ESL_FEEDINGFILTER`'s location (1, `CSB.h:1536`),
each with `continue` (`:4288-4344`): the count is `sizeof(fp) / 4`, 27, and the words are
the block's 27 longwords in the struct's order, a `bool32` as 1 or 0, copied in before each
DSA and back after it (`:4333-4336`), so each DSA sees the block the one before left. The
feeding then does what the block says, `performFeeding` first (`:4350`). The block's
`location` is the party's square and facing as a `LOCATIONREL` (`:4034-4038`), and a scroll
gets no `objectType` (`:4087-4091`). What the block cannot change: the champion fed is
`chIdx`, and the waterskin's gulp is taken by `objNID6`, both read before the filter
(`:4095`, `:4457`). Two sums reachable only through the filter: `shieldStrengthAdjust` is a
`ui32` (`:3953`), so `shieldStrength + shieldStrengthAdjust < 0` is never true and a
negative adjustment leaves the sum's low 16 bits (`:4366-4374`); and `value(value() - 1)`
sets a waterskin's two bits (`CSB.h:1274`), so an empty one emptied again holds 3
(`:4457-4460`). `tools/dump-feeding-filter.ts`.

## The character death filter and the damage filter run their location's first DSA

`KillCharacter` and `DamageCharacter` each walk the chain at their filter's location,
`ESL_CHARDEATHFILTER` (11) and `ESL_DAMAGECHARFILTER` (15, `doc/CSBwin-src/CSB.h:1546`,
`:1550`), and `break` once the first type-47 actuator has run (`Character.cpp:2586`,
`:2888`), each on parameters of its own (`:2550`, `:2844`). The death filter runs first
thing, before the champion's HP are set to 0 (`:2535-2596`), with a count of 1 and the
champion's index; nothing is read back. The damage filter runs once the damage is worked
out, wounds and wake-up included, and before it is added to `d.PendingDamage`, with a count
of 7: the champion's index and fingerprint, the damage asked for, the damage worked out,
the wound mask, the kind (`P4`) and 0 (`:2876-2883`). Its word 3 comes back into `D7L`
(`:2886`), and the low word is what is added and returned (`:2900-2901`), so a DSA may deal
0, or a negative amount, which takes damage off what is pending. The `if (D7W <= 0) D7W = 0`
before it (`:2814-2817`) never fires: every path to it has returned on a damage of 0 or
less. `tools/dump-char-damage-filter.ts`.

## The `QueueSound` calls, and the level each is on

| Sound | CSBWin's call | Ordinal → SND item | Level |
| --- | --- | --- | --- |
| The door button | `QueueSound(1, d.partyX, d.partyY, 1)` (`doc/CSBwin-src/Mouse.cpp:1079`) | 1 → 534 | the party's |
| A wall switch | `QueueSound(1, d.partyX, d.partyY, 1)` (`Mouse.cpp:542`) | 1 → 534 | the party's |
| A pressure pad | `QueueSound(soundPRESSUREPAD, mapX, mapY, 1)` (`Code11f52.cpp:3864`), `soundPRESSUREPAD` = 1 (`CSB.h:623`) | 1 → 534 | the pad's |
| The party through a teleporter | `QueueSound(soundTELEPORT, d.partyX, d.partyY, 0)` (`Code11f52.cpp:2964`), `soundTELEPORT` = 17 (`CSB.h:625`) | 17 → 547 | not tested (`deltaTime` 0) |
| A group through a teleporter | `QueueSound(17, newX, newY, 1)` (`Code11f52.cpp:2985`) | 17 → 547 | the destination's |
| A door's step | `QueueSound(2, x, y, 1)` (`Timer.cpp:1375`) | 2 → 535 | the timer's |
| The wall bump | `QueueSound(18, d.partyX, d.partyY, 0)` (`CSBCode.cpp:8289`) | 18 → 549 | not tested (`deltaTime` 0) |
| The gulp | `QueueSound(fp.gulp, d.partyX, d.partyY, 0)` (`Character.cpp:4485`), `fp.gulp = 8` (`:4111`, `:4126`, `:4282`) | 8 → 540 | not tested (`deltaTime` 0) |
| A new group | `QueueSound(soundTELEPORT, mapX, mapY, 1)` in `CreateMonster` (`Monster.cpp:230`), once `MoveObject` has put it on `d.LoadedLevel` (`curLevel = d.LoadedLevel`, `Code11f52.cpp:2857`) | 17 → 547 | the group's |
| A door coming down on a group | `QueueSound(4, x, y, 1)` (`Timer.cpp:1352`) | 4 → 536 | the timer's |
| An audible generator | `QueueSound(soundTELEPORT, targetX, targetY, 1)` (`Timer.cpp:1798`) | 17 → 547 | the timer's |
| A group out of abeyance | `QueueSound(17, D7W, D6W, 1)` (`Timer.cpp:2591`), `TT_61` only | 17 → 547 | the timer's |
| A group's death | `QueueSound(droppedWeapon?0:soundMONDEATH, D7W, D6W, bodyPartSoundDelay)` (`Code11f52.cpp:913`) | 4 → 536, 0 → 533 | the group's |
| A missile's impact | `QueueSound(soundNum, missileX, missileY, 1)` (`Code11f52.cpp:2120`) | 0 → 533 for a weapon | the missile's |
| A missile's cloud | `QueueSound(size>80 ? 5 : 20, …, 1)`, else `QueueSound(13, …, 1)` (`Code11f52.cpp:1436-1445`) | 5, 20 → 537; 13 → 545 | the missile's |
| The `RNffe4` cloud's tick | `QueueSound(5, D7W, D6W, 1)` (`Timer.cpp:556`) | 5 → 537 | the timer's |

The level is the one `QueueSound` tests, `d.LoadedLevel`, and only when `deltaTime` is
non-zero (`CSBCode.cpp:1827-1830`). A timer's is its own: `ProcessTimers` calls
`LoadLevel(timeEnt.Level())` before it acts on each (`CSBCode.cpp:6416-6417`). A teleporter
loads its destination level before either sound (`LoadLevel(curLevel)`,
`Code11f52.cpp:2955`). The party's sound is queued once `d.partyX` and `d.partyY` are the
destination's (`:2960-2961`), so it is at distance 0, and the group's before
`TeleportMonster` (`:2988`). A door's step queues its sound on every step, unconditionally.
The items and thresholds are `dm-atari/graphics.dat`'s sound table: ordinal 1 is heard up
to 2 squares away (`byte6` 0, `byte7` 3), ordinal 2 up to 5 (3, 6), ordinal 17 up to 3
(1, 4). `tools/dump-queue-sound.ts` and `tools/dump-party-collision.ts` check each call.

## A melee blow shatters a door two ticks late, and cancels the door's own timers

`Attack.cpp`'s door arm — `BASH`, `HACK`, `BERZERK`, `KICK`, `SWING` or `CHOP` aimed at a
shut breakable door — calls `HitDoor(x, y, strength, 0 /*not a ZO spell*/, 2 /*delay*/)`
(`doc/CSBwin-src/Attack.cpp:1803-1808`). With a non-zero delay `HitDoor` does not touch the
cell: it queues a `TT_BASH_DOOR` (= 2, `doc/CSBwin-src/CSB.h:1748`) at `d.Time + delay` on
the loaded level with the cell in `timerUByte6/7` (`doc/CSBwin-src/Code11f52.cpp:2285-2292`),
and still returns 1. `ProcessTT_BASH_DOOR` then sets the cell's low three bits to 5
(`doc/CSBwin-src/Timer.cpp:1492-1498`). Only the zero-delay call — a fireball's — shatters
the door at once.

`SetTimer` gives `TT_BASH_DOOR` a rule of its own (`doc/CSBwin-src/Timer.cpp:1102-1123`):
every `TT_1` or `TT_DOOR` timer with the same `timerWord6` (the cell) and level is deleted,
whatever its time — so a door that was opening or closing stops being animated before it
shatters. Evidence: `tools/dump-player-attacks.ts` case 8.

## A missile hits the monster in its corner, for `64 × magic / defense`

`ProcessMissileEncounter`'s monster arm (`doc/CSBwin-src/Code11f52.cpp:1960-2042`):

- The group is `FindFirstMonster(objX, objY)` (`:1960`) on `d.LoadedLevel`, the level the
  whole encounter works on (`missileLocr.l = d.LoadedLevel`, `:1765`). The timer loop loads
  a timer's level before it runs it (`LoadLevel(timeEnt.Level())`,
  `doc/CSBwin-src/CSBCode.cpp:6416-6417`), so during a monster's turn that is the monster's
  own level, and `CheckMonsterVersusMissiles` (`Monster.cpp:4462`) meets missiles on every
  level. The member that sidesteps before a melee then takes its new corner only
  `if (d.MonsterDamageResult != 1)` (`Monster.cpp:3966`): a missile that killed some of the
  group but not all leaves the corners as the encounter left them.
- The victim is `OrdinalOfMonsterAtPosition(group, objectPos)` (`:1961-1962`) — the member
  in the corner the missile reached. An ordinal of 0 returns 0, and the missile flies on,
  unless the group is `drawAsSize4()`, when member 1 is hit (`:1963-1967`).
- A **fireball reaching a Black Flame heals it**: `hitPoints6[i] = Smaller(1000, hp +
  DetermineMagicDamage(...))`, then the missile is removed and returns 1 — no damage, no
  sound, no cloud (`:1976-1996`).
- A non-material monster ignores everything but `RNDispellMissile` (`:1998-2001`).
- The blow is `D0L = 64 * (DetermineMagicDamage(...) & 0xffff)`, then `D5W = sw((D0L &
  0xffff) / defense08)` with a `defense08` of 0 read as 1 (`:2006-2012`). A blow of 0
  `break`s out of the switch: no `DamageMonster`, but the missile still lands through the
  shared tail. Otherwise it adds `DeterminePoisonDamage(type, d.Word12962)` — the poison
  strength `DetermineMagicDamage` just set — and calls `DamageMonster(group, ordinal-1, x,
  y, D5W + D1W, 1, false, pmmr)` (`:2013-2024`).
- If anyone survives, `ProcessTimers29to41(x, y, TT_M2, 0)` (`:2025-2028`).
- A dagger, arrow, slayer, poison dart or throwing star sticks in a monster that
  `absorbsDaggersEtc` only when the blow killed nobody (`:2031-2041`).

**A thrown potion is a potion until the tail.** `RNprojectile` keeps the Ven or Ful
potion's own RN through the whole switch (`:1771-1810`); only the tail swaps in the cloud
(`if (w_56 != 0) RNprojectile = obj_26`, `:2060-2063`). So the blow a bomb lands on a
monster, a champion or a door is `DetermineMagicDamage` of the potion — a random 0-3 plus
half its weight — and the explosion comes after it, and `nonPoison_Spell` is false for a
potion. Evidence: `tools/dump-missile-monster.ts`.

**A monster walks into a missile only when its positions byte is that missile's corner.**
Both calls of `CheckMonsterVersusMissiles` pass the group's whole positions byte,
`pI16A2->positions()` (`Monster.cpp:3882`, `:3960`), and the scan skips every missile with
`objD6.pos() != position` (`:4478`). `RN::pos()` is `(dataTypeMap[…] >> 4) & 3`
(`CSBTypes.h:331-335`), 0 to 3, so a byte with any of bits 2-7 set meets no missile: a lone
monster spread over its cell (`positions() = 0xff`, `:3855`) never does, nor one whose byte
still holds a second member's corner. Evidence: `tools/dump-missile-monster.ts` scenario 6.

## Torches burn down every 512 ticks, and a recruit's does not

The game tick calls `NinetySecondUpdate` when `(d.Time & 511) == 0`
(`doc/CSBwin-src/CSBCode.cpp:680-683`, commented "about every 85 seconds") — every 512
ticks, not every 90 × 4 = 360. `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7339-7387`)
loops over `d.NumCharacter` champions, **one fewer while `d.PotentialCharacterOrdinal != 0`**
(`:7351-7352`) — the recruit standing in a Hall of Champions mirror is always the last
champion, so their torch does not burn. For hand 1 then hand 0, an object whose `NameIndex`
lies in `objNI_Torch_a..objNI_Torch_d` with non-zero `charges()` gets `(charges - 1) & 15`,
and loses `important` when that reaches 0 (`:7356-7373`). `SelectPaletteForLightLevel` and
`DrawEightHands` follow unconditionally — the `if (D5W != 0)` around them is commented out
(`:7382-7386`). Evidence: `tools/dump-ninety-second-update.ts`.

## `DamageCharacter` spares a mirror recruit and everyone once the game is won

`DamageCharacter` (`doc/CSBwin-src/Character.cpp:2703`) opens with `D7W = sw(damage)` and
four guards, in this order (`:2712-2717`): `chIdx == -1` returns 0; `chIdx+1 ==
d.PotentialCharacterOrdinal` returns `chIdx+1`; `d.Word11694 != 0` returns `d.Word11694`;
`D7W <= 0` returns 0. Only then is `HP() == 0` checked (`:2725`). `d.Word11694` is "set when
game is won" (`doc/CSBwin-src/Data.h:927`) and only ever set to 1 (`Attack.cpp:2268`,
`Timer.cpp:2371`). So the recruit standing in a Hall of Champions mirror, and every champion
after the win, cannot be hurt — yet the call reports non-zero, and a caller such as a
missile's poison coin toss (`Code11f52.cpp:2046-2054`) proceeds as if damage was dealt.
Evidence: `tools/dump-champion-death.ts` → "DamageCharacter's early guards".

## `DamageCharacter` only adds to `d.PendingDamage`; the tick takes it off and shows it

`DamageCharacter` (`doc/CSBwin-src/Character.cpp:2703`) does not touch the HP. Its wound
roll ORs into `d.PendingOuches[chIdx]` (`:2803`), and its last act is
`d.PendingDamage[chIdx] += D7W` (`:2900`); it returns `D7W`. Both arrays are `i16[4]`
(`doc/CSBwin-src/Data.h:761-762`) and are not in the save.

`DisplayCharacterDamage` (`doc/CSBwin-src/CSBCode.cpp:7084`) runs once a main-loop tick,
after the timers, `DrawViewport` and `StartQueuedSound` and before the `d.GameIsLost` test
(`:638`, `:656-658`). So the frame of the tick is drawn with the HP of before the blow, and
a champion killed in it loses the game in that same tick. For each champion
(`:7096-7202`): `ouches |= PendingOuches`, which is cleared; then, with `PendingDamage`
non-zero, it is cleared, and the rest is skipped for the recruit in a mirror
(`PotentialCharacterOrdinal`) and for a champion already at 0 HP. HP minus the damage at 0
or below is `KillCharacter` and nothing else. Otherwise the HP is set and the box shows the
loss:

- inventory closed: graphic 15 blitted masked with colour 10 into `x 69*chIdx..+47, y 0..6`
  (over the name), the figure at `x = 69*chIdx + 19 / 16 / 13` for one / two / three or
  more digits, `y = 5`;
- that champion's inventory open: graphic 16 into `x 69*chIdx+7..+38, y 0..28` (over the
  portrait), the figure at `x = 69*chIdx + 21 / 18 / 15`, `y = 16`.

The figure is `TAG014af6(damage, 0, 3)` (`doc/CSBwin-src/Character.cpp:1038`): the digits
with no leading blanks, 9999 at most, drawn by `TextOutToScreen` in colour 15 on 8. The
graphics are 48x7 and 32x29, the rectangles' sizes.

Then a `TT_12` at `d.Time + 5` on `d.partyLevel`, `timerUByte5 = chIdx`, its index in
`CHARDESC.timerIndex`; if one is already pending, its time and level are rewritten and
`AdjustTimerPriority` re-sorts it, so a second loss shows only the new figure and keeps it
five more ticks. `TT_12` runs `TAG011366` (`CSBCode.cpp:6477`, `Timer.cpp:2686`):
`timerIndex = -1`, return if HP is 0, else `CharacterPortraitToStatusBox` with the
inventory open or `CHARFLAG_cursor` and `DrawCharacterState` (the name) with it closed.

Two of `DrawCharacterState`'s redraws go over the figure before then
(`doc/CSBwin-src/Character.cpp:1229`). Wherever CSBWin sets either flag it calls
`DrawCharacterState` in the same function, so neither is ever left pending:

- `CHARFLAG_portraitChanged` fills the whole box, `x 69*chIdx..+66, y 0..28`, and draws
  the portrait (inventory open) or the name (closed) back (`:1255-1297`). Set by
  `MarkAllPortraitsChanged` for every champion (`CSBCode.cpp:6276-6284`), which is called
  when a spell or fire shield starts (`MagicShield`, `Attack.cpp:1237`), when the party
  shield does (`Magic.cpp:1329`), when any of the three ends (`TT_74`, `TT_77`, `TT_78`,
  `CSBCode.cpp:6550-6571`) and in the fusion (`Attack.cpp:2279`); for one champion by a
  Ya potion (`Character.cpp:4393`, drawn at `:4492`) and its `TT_72` (`CSBCode.cpp:6545-6547`);
  by `ShowHideInventory` for the champion whose inventory closes and the one whose opens
  (`:7464`, `:7506-7514`); and by `KillCharacter` (`Character.cpp:2597`).
- `CHARFLAG_cursor`, with the champion's inventory closed, fills the name's rectangle,
  `x 69*chIdx..+42, y 0..6`, and prints the name (`:1343-1355`). Graphic 15's columns 43
  to 47 are colour 10, its mask, so that rectangle covers all of the figure. With the
  inventory open the name goes into the viewport instead (`:1322-1339`) and the figure
  over the portrait stays. Set by `SetHandOwner` on the old owner and on the new one,
  the recruit in a mirror excepted (`CSBCode.cpp:8401-8407`, `:8421-8423`).

Evidence: `tools/dump-character-damage.ts`.

## A wall bump hurts the two champions on the wall side, and is silent if nobody is hurt

`MoveParty` (`doc/CSBwin-src/CSBCode.cpp:7944`) inhibits a move into stone, a door whose
state is not 0, 1 or 5, or a false wall with neither bit 0 nor bit 2 set (`:8224-8261`).
Off the map, `GetCellFlags` returns 0, 1, 2, 4 or 8 (`:4609-4662`) — room type 0, stone —
so the edge of a level is bumped like a wall. With `d.NumCharacter != 0`
(`:8263-8291`), the side of the new cell being crossed is `direction + partyFacing + 2`,
and `GetCharacterToDamage(newX, newY, side & 3)` and `(side + 1) & 3` pick two champions
through `DetermineAttackOrder` / `Byte586` — the two nearest the wall. Each gets
`DamageCharacter(ch, 1, 24, 2)`: one point on the legs and feet, with armour halved, which
an unarmoured champion takes as `1 × 130 >> 6 = 2` (`Character.cpp:2780-2789`). Sound 18 is
queued **only if** either call returned non-zero (`:8287-8290`), so an empty party, or a
blow the armour absorbs, bumps silently. Evidence: `tools/dump-party-collision.ts`.

## Every attempted step costs stamina, bump or not; a turn costs nothing

Before `MoveParty` (`doc/CSBwin-src/CSBCode.cpp:7944`) looks at the destination, it sets
each champion's `staminaAdjustment` to `sw((3 * load) / MaxLoad(pCharacter) + 1)`
(`:8088-8101`; `load` is `CHARDESC`'s `ui16`, `CSB.h:2584`), passes them to the party-move
filter, and — unless the filter inhibits the move — calls `AdjustStamina(charIdx, …)` for
every `charIdx < d.NumCharacter` (`:8129-8135`). That is before the stairwell exit, the
wall and the monster checks, so a step refused by any of them costs as much as a step
taken. `MaxLoad` is stamina-adjusted (`Code11f52.cpp:4287`), so a tired champion pays
more for the same load. `AdjustStamina` (`Code11f52.cpp:4413`) floors stamina at 0 and
turns the overshoot into `DamageCharacter(chIdx, over / 2, 0, 0)`. A turn is
`TurnParty` (`:7854`), which charges nothing. Evidence: `tools/dump-party-collision.ts`
case 7.

## A turn lifts the party off its square and places it back

Off the stairs, `_TurnParty` brackets `SetPartyFacing((d.partyFacing + deltaFacing) & 3)`
with `PlaceOrRemoveObjectInRoom(d.partyX, d.partyY, RN(RNnul), true, 0, NULL)` before and
the same with `1` after (`doc/CSBwin-src/CSBCode.cpp:7912-7934`). The fourth argument is
`unchangedRoom`, the fifth `place` (`Code11f52.cpp:3882-3888`). So every actuator on the
square gets `PressurePadOrAlcove` twice, the room unchanged: once as the party leaves,
facing the old way, once as it comes back, facing the new one (`d.partyFacing`, which
`PressurePadOrAlcove` reads, `:3776`). On stairs a turn is `TraverseStairway(D7W & 4,
true)` instead (`CSBCode.cpp:7906-7909`). Evidence: `tools/dump-party-move.ts` case 7.

## The move delay is `d.partyMoveDisableTimer`, in ticks, from the slowest living champion

A step `MoveParty` takes — the `D5W == 0` arm, after `MoveObject` — sets
`d.partyMoveDisableTimer` to `time2move`, which starts at 1 and takes `Larger` with
`TimeToMove` of every champion whose `HP() != 0`, and clears `d.Word11712`
(`doc/CSBwin-src/CSBCode.cpp:8315-8349`); a party-move filter's `PM_SETDELAY` /
`PM_ADDDELAY` can override it (`:8122-8128`, `:8336-8346`). A stairway, taken by walking
in or backing out, sets neither. `TimeToMove` (`:7003`) is 2, or 3 once
`8 * load > 5 * MaxLoad`, while `MaxLoad > load`; otherwise
`4 + ((4 * (load - MaxLoad)) & 0xffff) / MaxLoad`. `ouches & 32` adds 1 (2 when
overloaded) and Boots of Speed (`objNI_BootsOfSpeed`, 0xc2, `Objects.h:639`) on the feet
take 1 off. Each tick decrements the timer and `d.Word11712` while non-zero
(`:689-695`). `HandleMouseEvents` (`Mouse.cpp:1349`), called by the main loop with
`delta = 1` (`CSBCode.cpp:748`), leaves the head of the mouse queue in place — it is
retried, not dropped — while `lastTime != 0 && d.Time < lastTime + delta`
(`Mouse.cpp:1468-1476`), and, for buttons 3-6 (the steps), while
`d.partyMoveDisableTimer != 0` or `d.Word11712 != 0` and
`((d.partyFacing + button - 3) & 3) == d.Word11714` (`:1482-1496`). Every event it handles
stamps `lastTime = d.Time`, so turns and steps run at most one per tick, and a turn
(buttons 1-2, `TurnParty`) ignores the move delay. A throw ends
`d.Word11712 = 4; d.Word11714 = d.partyFacing;` (`Mouse.cpp:753-754`): for 4 ticks the
party cannot step in the direction it threw. `lastTime` is reset by the initialise call
(`delta == -999887`, `:1372-1376`) a game load makes (`SaveGame.cpp:1661`); the three
words are saved in `GAMEBLOCK2` (`SaveGame.cpp:1029-1031`, `:1645-1647`). Evidence:
`tools/dump-party-collision.ts` case 8, `tools/dump-live-save-file.ts`.

## Only stone, a shut door and a solid false wall stop a step

`MoveParty` sets its inhibit flag `D5W` for `roomSTONE`, for `roomDOOR` whose state
(`cellFlags & 7`) is not 0, 1 or 5, and for `roomFALSEWALL` with neither bit 2 nor bit 0
set (`doc/CSBwin-src/CSBCode.cpp:8224-8261`); `roomSTAIRS` is handled before it
(`:8206-8221`). Every other room type — open, pit, teleporter, and type 7, which
`ROOMTYPE` does not even name (`CSB.h:560-566`) — is entered. Neither the Atari
`dungeon.dat` nor any committed save has a type-7 cell. Evidence:
`tools/dump-party-collision.ts` case 11.

## A tick falls due every `d.Speed` VBLs, counted on every VBL

`checkVBL` calls `vblInterrupt` on every VBL while `verticalIntEnabled`
(`doc/CSBwin-src/system.cpp:619-630`), whatever the main loop is doing: a pass, a
`RESTARTABLE` sequence's `wvbl`, a frozen game. After the message strip's scroll
(`CSBCode.cpp:971-1004`) and the button flash (`:1028-1038`), the handler adds one to
`d.vblCount` and sets `d.clockTick = 1` once `d.vblCount >= d.Speed` (`:1065-1077`). The top
of every tick sets `d.Speed` to `speedTable[gameSpeed].vblPerTick` while awake and zeroes
`d.vblCount` (`:612-617`); `SPEED_NORMAL`'s is 15 (`CSBwin.cpp:180`), so a tick every 15
VBLs. `d.clockTick` is cleared only by the end of a tick (`:704`) or by a handler, so a tick
that falls due while the loop cannot run it (frozen, `:765`, or held in a sequence) stays
due and runs in the first pass that can. The port counts VBLs the same way
(`vblInterrupt`, `src/engine/LoopState.ts`), and the page runs as many VBLs as the wall
clock holds (`Game.gameLoop`). Evidence: `tools/dump-vbl-clock.ts`.

## `MainLoop` opens with a tick

`_MainLoop`'s first statement is `tag000698`, the top of a tick
(`doc/CSBwin-src/CSBCode.cpp:586-601`): a game that starts, or that `_StartCSB` restarts
after the credits (`:11320-11327`), runs `ProcessTimers`, `DrawViewport` and `d.Time++`
before it reads any input, and that `DrawViewport` is the game's first view. The count
starts there (`d.vblCount = 0`, `:617`), so the second tick is `d.Speed` VBLs on. The
port's tick belongs to a pass, so `d.clockTick` is set where `MainLoop` would be entered
(`Game.start`, `Game.resumeMainLoop`) and the first VBL's pass ticks. A game read in play,
which only the port has (the save menu's LOAD, F9), is followed by the same tick
(`Game.applyRuntimeSaveState`), and the page draws no first view of its own. Evidence:
`tools/dump-vbl-clock.ts`.

## A refused move throws away all queued input, and postpones a due tick by one VBL

When `MoveParty`'s inhibit flag `D5W` is set — terrain, or with champions a monster in the
cell — it ends `DiscardAllInput(); d.clockTick = 0;` (`doc/CSBwin-src/CSBCode.cpp:8310-8314`),
whether or not the party is empty. `DiscardAllInput` (`:7532`) drains the key queue
through `UI_CONSTAT` / `UI_DIRECT_CONIN` (`CSBUI.cpp:1374-1391`) and resets the mouse
queue (`d.MouseQStart = 0`, `d.MouseQEnd = MOUSEQLEN-1`), so every move keyed or clicked
behind the bump is lost. `d.clockTick` is the "a tick is due" flag: the main loop runs a
tick only when it is non-zero (`:763-764`) and clears it after each (`:704`); the VBL
handler sets it on **every** VBL once `d.vblCount >= d.Speed` (`:1066-1077`), and
`vblCount` is reset only at the top of a tick (`:617`). So zeroing it cancels nothing: a
tick already due runs one VBL later. How much input that can be is the next entry.
Evidence: `tools/dump-party-collision.ts` case 6.

## Clicks and keys share one mouse queue of 8, handled one entry per tick

`MOUSEQLEN` is **8**: `doc/CSBwin-src/Data.h:1513` is `//#define NoKeyQue`, commented out,
so `#define MOUSEQLEN 3` (`:1515`) is the dead branch and `#define MOUSEQLEN 8` (`:1517`)
the live one — `NoKeyQue` is defined nowhere in the tree. (This entry used to say 3,
reading `:1515` without its `#ifdef`.) The ring keeps one slot empty: `MouseQStart` is
the next entry to handle, `MouseQEnd` the last one queued, `MouseQEnd + 1 == MouseQStart`
is empty, and `numEnt = (MouseQEnd - MouseQStart + 1 + MOUSEQLEN) % MOUSEQLEN`.

- **A click** is turned into a button by `SearchButtonList` over the primary, then the
  secondary list, and queued with its point only if it hit one and `numEnt < MOUSEQLEN-2`
  — "no room for a matching 'UnClick'" otherwise (`OnMouseClick`,
  `doc/CSBwin-src/CSBCode.cpp:7607-7696`). So a click is taken while fewer than six wait.
- **The button-up** is `0x0add`, queued while `numEnt < MOUSEQLEN-1` (`OnMouseUnClick`,
  `:7581-7600`), whether or not its click was.
- **A key** is translated to its button by `TAG0196da` and refused only when
  `MouseQEnd + 2 == MouseQStart` (`:8439-8443`) — seven waiting. The key queue in front
  (`CSBUI.cpp:143-145`, a 3-slot ring) is emptied into it one key per message by the main
  loop (`CSBCode.cpp:707-712`), so it is not what refuses a key.
- **`HandleMouseEvents`** (`doc/CSBwin-src/Mouse.cpp:1349`) handles at most the head, and
  the main loop calls it again while its result has bit 0 set (`CSBCode.cpp:746-761`). A
  step held by the move delay stays at the head (the previous entry), and everything
  behind it waits too. The button-up clears the mouse and eye/mouth state and returns
  `result |= 1` without stamping `lastTime`, so the next entry follows in the same pass
  (`Mouse.cpp:1523-1549`). Every other button stamps `lastTime = d.Time` (`:1550-1807`):
  a click holds the turn or step behind it to the next tick exactly as a turn does.
- The on-screen arrows are buttons 1-6 in `buttons17304` (graphic 231), the same numbers
  the movement keys become; `HandleMouseEvents` sends 1-2 to `TurnParty` and 3-6 to
  `MoveParty` (`:1550-1570`). Button 80 is the viewport, `HandleClickInViewport`
  (`:1665-1670`).
- While `d.PressingEye` or `d.PressingMouth` is set, every button tested after 81 —
  140 the disk icon, 145-148, 200-216 — is swallowed, `lastTime` stamped
  (`Mouse.cpp:1679-1680`); only the button-up, which comes before, lets go.

Evidence: `tools/dump-mouse-queue.ts` (it crashes before the port had the queue; case 8
fails before the eye gate),
`tools/dump-party-collision.ts` case 9.

## A door button or a wall switch makes a tick due; a touch that fires nothing postpones one

- The door button sets `d.clockTick = 1` before it queues the switch sound and the
  `TT_DOOR` for `d.Time + 1` (`doc/CSBwin-src/Mouse.cpp:1078-1085`). The main loop tests
  `d.clockTick` right after `HandleMouseEvents` (`CSBCode.cpp:763-764`), so the tick runs
  in the VBL of the click. The door moves in the tick after it: a tick runs
  `ProcessTimers` before its `d.Time++` (`CSBCode.cpp:626`, `:660`), so the tick the click
  brings on sees the `d.Time` the timer was set from. The same holds for any timer a click
  or a key sets for `d.Time + n`: it fires in the n+1th tick after. `LoadGame` sets
  `d.Time = gb2.Time` (`SaveGame.cpp:1624`), so the first tick after a load runs the timers
  due by the saved `d.Time`, and whatever a click sets before that tick is set from it.
  `ProcessTimers` has no time of its own: it is `bool ProcessTimers(void)`
  (`CSBCode.cpp:6383`) and runs what is due by `d.Time`, the one clock, which the port
  keeps in `ctx.state.tickCount` (evidence: `tools/dump-csbwin-timers.ts`, its last case).
  It is called from the main loop's tick (`CSBCode.cpp:627`) and from `_FusionSequence`
  (`Attack.cpp:2199`), nowhere else: not from `DropObject`, the pick-up or `MoveParty`, so
  a timer a drop or a step queues for `d.Time` waits for the tick like any other
  (evidence: `tools/dump-drop-move-object.ts` case 5, `tools/dump-party-collision.ts`
  case 1).
- `TouchWallF1` returns, touching nothing, when the cell ahead is off the map
  (`Mouse.cpp:784-787`), and otherwise sets `d.clockTick = TouchWall(...)` (`:788`).
  `TouchWall` returns 1 when a switch fired, `result = 1` under `if (!switchOpen)`
  (`:537-539`), and 0 otherwise (`:315`). So a switch makes a tick due at once, and a
  touch that fired nothing puts off a tick that was due by one VBL, as a refused move does.

Evidence: `tools/dump-mouse-queue.ts`, case 9.

## The other handlers that write `d.clockTick`

- `_TurnParty` and `MoveParty` open with `if (extraTicks) d.clockTick = 1;`
  (`doc/CSBwin-src/CSBCode.cpp:7866-7869`, `:8084-8087`), before either can return.
  `extraTicks` is the "Extra Ticks" option (`OPT_EXTRATICKS`, `CSBUI.cpp:987-988`), `true`
  from the start (`data.cpp:279`) and turned off only to play a recording back
  (`CSBUI.cpp:964`, `:2160`, `:2201`, `Recording.cpp:300-303`). So every turn and step runs
  a tick in its own VBL, which counts one off the move delay the step has just set, and a
  refused step's `d.clockTick = 0` (`:8310-8314`) comes after it.

- `ShowHideInventory` sets `d.clockTick = 1` once past its return for a dead champion
  (`chIdx != 4` only) and its returns while the mouth or the eye is pressed
  (`doc/CSBwin-src/CSBCode.cpp:7434-7441`), whoever calls it: buttons 7-11, 83 and 145
  (`Mouse.cpp:1618`, `:1628`, `:1689`), and the Hall of Champions menu's Cancel and
  Resurrect or Reincarnate (`CSBCode.cpp:6634`, `:6807`). `AddCharacter`'s call
  (`Character.cpp:796`) is made from inside `TouchWall` (`Mouse.cpp:518`), so
  `TouchWallF1`'s `d.clockTick = TouchWall(...)` (`:788`) overwrites it.
- The pick-up, `TAG01a148`, ends with `d.clockTick = 1` (`Mouse.cpp:840`), which its
  returns skip: no cursor owner (`:802`), a monster that is not levitating at the position
  (`:819`), and a cursor filter's cancel (`:835`). The test for an object in the slot
  (`:825`) does not guard it.
- `DropObject` ends with `d.clockTick = 1` (`Mouse.cpp:964`).
- The attack menu, `_TAG019fac`, sets `d.clockTick = (i16)intResult` after an option's
  `ExecuteAttack` (`Character.cpp:4716-4717`). PASS, button 112, calls `ExecuteAttack(-1)`
  and writes nothing (`:4679-4682`). `ExecuteAttack` returns 0 without attacking when the
  option's attack type is 255 (`:4955-4959`), and `Attack`'s result otherwise.
- The cast button, 108, sets `d.clockTick = CastMagic(0)` (`Magic.cpp:564`), and
  `CastMagic` returns `CastSpell`'s result with 3, the potion cast without a flask, made 0
  (`:945-956`).

So a click that did something makes a tick due in its own VBL, and an attack or a cast
that came to nothing puts off a tick that was due, as a refused move does.

Evidence: `tools/dump-mouse-queue.ts`, case 10; `tools/dump-hall-of-champions.ts`;
`tools/dump-party-collision.ts`, cases 8 and 10.

## The party moves through one `MoveObject`, in one order

Every move of the party is `MoveObject(RN(RNnul), oldX, oldY, newX, newY, …)`
(`doc/CSBwin-src/Code11f52.cpp:2796`) on the party's level, each caller passing its own
cells: the step `(partyX, partyY, newX, newY)`, or `(-1, 0, newX, newY)` out of a stairwell
(`CSBCode.cpp:8318-8325`); the climb down `(partyX, partyY, pitX, pitY)` with
`d.SupressPitDamage` set (`Attack.cpp:2031-2033`); the DSA teleport and the wiggle the
party's own square twice (`DSA.cpp:4604-4608`, `Timer.cpp:2443`); the stairs a lift,
`(partyX, partyY, -1, 0)`, twice for a step into them, first off the square left and then
off the stairs (`CSBCode.cpp:8212`, `:7774`). A turn off the stairs is not a `MoveObject`
(`:7910-7934`). Inside, in this order:

1. With `oldX >= 0`, `CheckMoveFromMissile(oldX, oldY, newX, newY)` (`:2847-2853`). Its
   `return 1`, which ends the move, reads the global `d.MonsterDamageResult == 2`
   (`:2743`), for the party too.
2. With `newX >= 0`, `d.partyX`/`d.partyY` are set to the new square (`:2868-2869`) and
   follow every teleporter jump (`:2960-2961`, with `SetPartyFacing`, `:2967-2977`) and
   every pit fall (`:3055-3056`), so a fall hurts, and a champion it kills drops what
   they carry, on the square the party fell into.
3. Back on its square facing as it did, nothing more happens (`:3194-3201`). Otherwise a
   footprint is left when it left its square (`:3224-3247`).
4. With `oldX >= 0`, the old square's pads (`:3258-3268`). With `newX < 0`, that is all
   (`:3297`).
5. A monster on the square the party landed on is deleted: `DropMonsterRemains(…, 1, …)`
   and `DeleteMonster` (`:3298-3308`). The step refuses a square with a monster only for a
   party with champions (`CSBCode.cpp:8286-8304`), so an empty party walks onto one and
   deletes it.
6. On its level, the new square's pads (`:3309-3317`); on another, `d.newPartyLevel`
   (`:3319-3324`), and the next section.

Evidence: `tools/dump-party-move.ts`, and `tools/dump-party-collision.ts` case 1.

## A level change discards all input, at the top of the next tick

Taking a stairway, falling or being teleported to another level only sets
`d.newPartyLevel`. The main loop acts on it at the top of the next tick —
`LoadPartyLevel(d.newPartyLevel); MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY);
d.newPartyLevel = -1; DiscardAllInput();` (`doc/CSBwin-src/CSBCode.cpp:615-623`) — and,
if `ProcessTimers` changed level, loops back there in the same tick
(`if (d.newPartyLevel != -1) goto tag0006a4;`, `:635`) and runs `ProcessTimers` again.
`HandleMouseEvents` comes later in the loop (`:748`). So every key or click queued
between the arrival and that tick is lost. A move queued before a timer — an opening
pit, a teleporter switched on — carries the party to another level is lost too, and never
runs on the new level. Evidence: `tools/dump-party-collision.ts` cases 10 and 12.

Until that tick the party is half moved. The move sets `d.partyX` and `d.partyY` to the new
level's square (`Code11f52.cpp:2868-2869`, `:2960-2961`, `:3055-3056`; `TraverseStairway`,
`CSBCode.cpp:7775-7777`) and leaves `d.partyLevel` alone, which in play only
`SetPartyLevel` moves on (`:5793`), from `LoadPartyLevel` (`:796`); the other writers are
the game's start and load (`:9563`, `SaveGame.cpp:1635`, `:2409`). `ProcessTimers` does not test
`d.newPartyLevel`, so a timer due after the move in the same pass runs with the new square,
the old `d.partyLevel` and the old level's groups attached. `d.newPartyLevel = -1` comes
after the arrival's `MoveObject` (`:620-622`), so a level change that `MoveObject` makes
is dropped. The viewport is drawn only after the check (`:635-639`). Evidence:
`tools/dump-party-collision.ts` cases 10 and 12, `tools/dump-party-move.ts` case 6.

## At most 31 groups wait on one square; the next is deleted unless it is unique or carries something

`CreateMovementTimer` (`doc/CSBwin-src/Code11f52.cpp:2446`) counts the active timers of its
own kind — `TT_60`, or `TT_61` for an audible arrival — whose `uByte6`, `uByte7` and level
are the target square (`:2463-2472`). At `count >= 31` (`:2473`) it deletes the object with
`DeleteDBEntry` and returns without a timer (`:2508-2512`) — unless the object is a
monster that is `Unique()` or whose `possession()` is not `RNeof` (`:2488-2506`), which is
queued anyway. The `static bool error` guards only a commented-out message box. `DB4`'s
`invisible()`, `drawAsSize4()`, `Unique()` and `Poisoned()` each AND their `word14` bit
with a design option — `invisibleMonsters` for the first, `drawAsSize4Monsters` for the
other three (`CSB.h:1125-1132`) — read from a save's extended-features block
(`SaveGame.cpp:394-400`) and `false` by default (`data.cpp:77-78`). None of the 182
creature records in `dm-atari/dungeon.dat` sets any of bits 11-14. Evidence:
`tools/dump-monster-move.ts` case 4.

## A wall text's glyph is read from graphic 120 with no check of its code

`DrawWallDecoration` draws a text's words only on the wall in front of the party
(`relativePosition == 12`, `doc/CSBwin-src/CSBCode.cpp:3245-3290`). A line is the bytes
up to one of 128 or more, 18 at most (`:3268-3271`), at `x1 = 112 - 4*length`,
`y2 = d.Byte4196[line]` (48, 59, 75, 86), `y1 = y2 - 7`, each glyph 8 pixels on. Each
byte is one `TAG0088b2(font, viewport, &rect, 8*code, 0, 144, 112, 10)` (`:3278-3285`)
from graphic 120, 288x8: 36 glyphs. `TAG0088b2` addresses its source as
`src + srcY*srcByteWidth + srcX/2` (`doc/CSBwin-src/Graphics.cpp:559`), and nothing checks
`code`, so a code of 36 or more reads on into the rows below: glyph `code - 36` one row
up, its last row read from past the graphic's end. Nothing checks the line count against
`Byte4196[4]` either.

No data here reaches either: the 58 wall texts of `dm-atari` and of `dm-atari-1.3-fr`
have four lines at most, 14 and 15 glyphs a line at most, and no code past 35. The French
set's two texts that decode to a 50 are a scroll's and a teleporter square's message
(`doc/ATARI_ST_DISK_REFERENCE.md` → "The French 1.3 disk").

Evidence: `tools/dump-wall-text.ts`.

## A cloud's flip and mirror are two viewport coin flips; a missile's are not random at all

`DrawClouds` (`doc/CSBwin-src/Code51a4.cpp:257-260`) sets `w_142 = STRandomBool() != 0`
(the vertical flip, `TAG008840`, `:2787`) and then `LOCAL_36 = STRandomBool() != 0` (the
`Mirror`, `CSBCode.cpp:4361`) for every cloud that reaches `tag006932`. Inside `DrawViewport`
`d.RandomNumber` is swapped for a function-static `viewportRandom`, initialised to
`0x34175432` (`Viewport.cpp:6697`, `:6705-6707`, restored at `:7174-7175`), so these draws
never touch the game's stream. `GraphicRandom` (`CSBCode.cpp:564`) is a different generator
(`>> 7`, not `STRandomBool`'s `>> 8`) whose only callers are in `DrawTeleporter`.

When mirrored, `LOCAL_30 = 2 * (7 - ((LOCAL_22-1) & 7))` (`:261-264`) skips the row padding
that `Mirror` moved to the left of a 16-pixel-aligned row, and at the left edge the source
column is `Larger(LOCAL_30, LOCAL_22 - x - 1)` (`:280-287`) — a maximum, not a sum, so a
mirrored cloud is clipped by less than its overhang. The rectangle is
`y1 = Larger(0, y - LOCAL_24/2 + (LOCAL_24 even))`, `y2 = Smaller(135, y + LOCAL_24/2)`,
`x1 = ApplyLimits(0, x - LOCAL_22 + 1, 223)`, `x2 = Smaller(223, x + LOCAL_22)` (`:265-279`).

Missiles (`Code51a4.cpp:2356-2465`) derive their mirror (`LOCAL_36`) and flip (`w_142`)
from the graphic's `word4`, the timer's direction bits, the relative position and
`(mapX + mapY) & 1`; nothing in them is random. Evidence: `tools/dump-cloud-draw.ts`.

## A cloud's size, graphic and colour map, and the cloud under the party

All in `DrawClouds` (`doc/CSBwin-src/Code51a4.cpp:76-321`) and `TAG005088` (`:21-74`).

- **Scale.** An ordinary cloud's scale is
  `Larger(4, Byte5758[RelativeCellNumber/3] * Larger(48, value+1) >> 8) & 0xfffe`
  (`:251-254`); a type-101 cloud's is `d.Word7222[3·cell + 2]` (`:230-234`). `Byte5758` is
  `10, 16, 23, 32, 32, 0`, so a value-0 cloud is drawn at scale 4, not full size.
- **Size.** `TAG005088(type, scale)` clamps the *scale* to 32 (`:29`), then half-width
  `(scale·Byte5696[2·type] + scale/2) / 32` and height `(scale·Byte5696[2·type+1] + scale/2) / 32`.
  `Byte5696` is `80,111, 64,97, 80,91, 80,91` — the three graphics 348-350 are 160×111,
  128×97 and 160×91 — so a full-size cloud is 160 pixels wide.
- **Graphic and colour map.** At scale 32 a type 0-2 cloud is graphic `348 + type` as is.
  Anything else is `ShrinkBLT` of graphic `348 + Smaller(type, 2)` (`:50`): type 3, the
  poison cloud (cloud type 40), borrows graphic 350 and is always recoloured through
  `d.Byte5712`; types 0-2 go through `d.IdentityColorMap` (`:52-58`).
- **Lightning** (cloud type 100) takes its position *and* its scale from
  `d.Word7246[3·(RelativeCellNumber-3)]` (`:143-150`), shrunk through the identity map
  except in cell 9 (`:151-160`). `Word7246` is declared 12 words, but cells 3-9 index it up
  to word 20: it runs on into `d.Word7222`, which follows it in the struct (7246 − 2·12 =
  7222). Read as 21 words it is 3 triples per row — `(112,53,15) (24,53,15) (194,53,15)`,
  `(112,59,20) (15,59,20) (208,59,20)`, `(112,70,32)` — each x, y, scale.
- **The cell under the party** (`RelativeCellNumber == 12`, `:178-218`) draws graphic
  `351 + 3·D4W + (value>>5 != 0) + (value>>5 > 3)`, where `D4W` is 0 for cloud types 0/2,
  1 for most, 2 for types 6/7 and for 40 (poison, counted `3 - 1`). The poison one is
  recoloured through `d.Byte5712`. `TAG008c98` (`doc/CSBwin-src/Graphics.cpp:1169-1326`,
  with `P9 = 138`, which is `-118` as a byte, so `P9 &= 0x7f` = 10 is the transparent colour and
  no mask is read) fills `d.Word2530` 16 pixels at a time, row by row, from the graphic
  read as one run of 16-pixel groups: it starts at group `STRandom() & 63` and goes back
  to group 0 on reaching group `STRandom0_3() + 87`. `d.Word2530` is the last 4 bytes of
  graphic 0x22e (`Data.h:1316`), a byte `RectPos`, `x 0..223, y 0..135`: the whole
  viewport. Both draws come from the viewport's stream (see the section above). C++ leaves
  the order of the two argument draws unspecified; the port evaluates them right to left
  (`STRandom()` first), the order of the 68000 original and of the x86 compilers. That order
  is an assumption, not a verified fact.
- **Graphics 351-359 are 48×31**, not the 48×32 that `GetBasicGraphicAddress(n, 48, 32)`
  asks for. CSBWin pads the buffer with a garbage row ("This error occurs in the standard
  Graphic.dat", `Graphics.cpp:2560-2570`). The tiling wraps within 90 groups, which is 30
  rows, so it never reads the padding row.
- **An alcove's clouds are drawn.** `DrawRoomObjects` calls `DrawClouds` whatever the
  drawing order (`Code51a4.cpp:2768-2773`), so with order 0 (an alcove) it does so with the
  alcove's `CurAbsPos = (facing+2)&3` (`:2177-2183`). A cloud of type 100 or more is drawn
  only at `CurAbsPos` and only in cells 3-9 (`:111-114`). This is how the Vi altar shows
  its resurrection: `ProcessTT_ViAltar` puts an `RNffe4` cloud, type 100 (lightning), on the
  bones in the altar's alcove (`Timer.cpp:2730`), and its first `TT_25` turns it into type
  101 (the explosion, drawn as cloud graphic 0, `Code51a4.cpp:116`) for one tick before the
  next removes it (`Timer.cpp:553-557`, `:613-618`).
- **Clouds are drawn in fifteen cells, objects in ten.** `ProcessOnePosition` notes a
  cloud in the chain whatever the cell (`Code51a4.cpp:2219-2221`), and `DrawRoomObjects`
  then calls `DrawClouds` (`:2768-2773`), which counts the cell as `RelativeCellNumber + 3`
  (`:100`): 0-2 are the row four ahead (F4, F4L1, F4R1, which the bytecode passes as -3,
  -2, -1: `objectDrawingLocations`, `Viewport.cpp:2419`), 13 and 14 the cells beside the
  party (F0L1, F0R1; 10 and 11). Objects and missiles are drawn in cells 0-9 only
  (`:2223-2224`, `:2301-2302`), a monster in 0-11, and the row four ahead stops at its
  first position (`:2254-2258`). `d.Word7042[30]`, `d.Word7162[60]` and `d.Byte5758[6]`
  (`Data.h:1114-1115`, `:1138`) hold all fifteen: the far row is at y 47, x 111, 57 and
  167, at `Byte5758[0]` = 10; the side cells at y 60, x -53 and 276, at `Byte5758[4]` =
  32, so a full cloud there shows as a strip at the viewport's edge. A Fluxcage's shimmer
  needs cell 4 or more (`:166-171`), so it is drawn beside the party, from
  `d.teleporterRectangles[10]` and `[11]`, and not four rows ahead.

Evidence: `tools/dump-cloud-draw.ts` sections 4-7, 9 and 10.

## The teleporter's shimmer is `TAG008c98` over a stream of 16-pixel groups

`DrawTeleporter` (`doc/CSBwin-src/CSBCode.cpp:4266-4302`) calls `TAG008c98`
(`doc/CSBwin-src/Graphics.cpp:1169-1316`) with the source graphic `73 + x1` of the cell's
`d.teleporterRectangles` entry (the Fluxcage's `x1 + 1` makes it 74), the wall rectangle
as the destination, `P6 = x2 + GraphicRandom(2)`, `P7 = GraphicRandom(32)`, `P8 = 112`,
`P9 = y1`, `P10 = uByte6`, `P11 = 0`.

- **The fill.** A temporary bitmap `w_2 = (x2 - x1) / 16 + 1` groups wide, as tall as the
  wall rectangle, is filled group by group from the source read as one run of 16-pixel
  groups: from group `P7`, back to group 0 when the count reaches `P6`. Then `TAG0088b2`
  blits it with `P10`, `P11` as source offsets and `P9` transparent.
- **The mask.** When `P9`'s low byte has bit 7 clear, the mask is `tempBitmap`, which holds
  the first `uByte4 * uByte5` bytes of graphic `69 + (y2 & 0x7f)`, `Mirror`ed when bit 7 of
  `y2` is set. It is read one group per group filled, never wrapping, and only its first
  word, plane 0: the source planes are ANDed with it (`:1276-1282`). The pixels it clears
  are then given colour `P9`: for 10, planes 1 and 3 are ORed with its complement
  (`tag008da4`). 0 leaves them 0. Every other value stops in `NotImplemented`. With bit 7
  set, no mask is read and `P9 &= 0x7f` (unless the byte is -1).
- **The data.** Graphics 73 and 74 are 32×32, 64 groups; `x2` is 59-63, so the run wraps
  before the source ends and after any `P7`. The six masked rectangles have `y1 = 10` and
  masks 69-72 (96×51, 80×71, 64×111, 32×136, all 0 or 15), each exactly as many groups as
  its fill. The other six have `y1 = 138`, no mask, and `y2 = 0xff`.
- C++ leaves the order of the two `GraphicRandom` draws unspecified. The port takes them
  right to left (`P7` first), as for the cloud under the party. That order is an
  assumption, not a verified fact.

`tools/dump-teleporter-shimmer.ts` checks the data and compares the port's drawing with the
C++ loop run over bitplane words.

## A two-corner monster is drawn in the cell's halves and middles, not at its corners

`ProcessOnePosition` (`doc/CSBwin-src/Code51a4.cpp:2106`) calls `DrawMonster`
(`:352-961`) once per nibble of the drawing order, with the relative position as
`positionWithinCell`, the list *after* the shift, and `PositionListIndex` counting from 1
(`:2186-2189`). `DrawMonster` then chooses the entry of the monster's `d.s6982` set
(`MonsterXYonScreen`, set `ITEM12.uByte10 >> 4`) it draws at (`:410-561`):

- `OrdinalOfMonsterAtPosition` picks the member at `CurAbsPos`; none is a return, except
  for a two-corner monster (`horizontalSize() == 1`), which carries on with index -1.
- Positions `255` (centred): drawn only at the list's end and not on a door's far side, at
  entry 4, or 3 for a two-corner monster seen from the side (`:485-498`).
- A cell-filler (`horizontalSize() == 2`) whose positions are not 255 is not drawn at all:
  Stevens' "people have taken advantage of this ... uh .. feature" (`:471-484`).
- A one-corner monster is drawn at its relative position.
- A two-corner monster is drawn only when `LOCAL_96` (`positionWithinCell <= 1` or the first
  nibble, and the list ending or its next nibble ≥ 3: the last far position) or at the list's
  end. At `LOCAL_96` (not a door's near side) it is drawn at entry 2 when seen from the side, a
  member being there. At the end (not a door's far side), seen from the side, at entry 4.
  Seen from the front or back, at entry 0 or 1 by the member's corner (0 when it is
  `facing` or `facing-1`), and then, with `w_94 = numMonM1`, the other member's status
  again at the other of 0 and 1 (`:946-958`), with the first member's view.
- In set 1 (the rat, the worm, the ruster and the cell-fillers) entries 0/1 are the
  left/right half, 2 the far middle, 3 the middle and 4 the near middle.
- Cells 10 and 11, beside the party, draw monsters (only objects, missiles stop at 9,
  `:2223-2224`, `:2301-2302`), from the set's cells 9 and 10 (`:562-566`), 100 pixels to
  the side.

The mirror (`:592-864`): near (cells 6+), a side view facing right, an attack view with the
member's mirror bit, or a front view with `NonAttackingMirrorOK()` and the mirror bit. Two
rows ahead (cells 3-5): a side view facing right, an attack view with the mirror bit, or a
front view when word4 bits 7 and 8 are both set (`b_102`, `:797-800`), whatever the mirror
bit. The fourth term, `frontViewMirror_106 && !NonAttackingMirrorOK()` (`:864`), can never
hold, since `frontViewMirror_106` needs `NonAttackingMirrorOK()` (`:693`); the 68000 code in
the comment above it tests the bit the other way round. Three rows ahead,
`frontViewMirror_106 = false` (`:810`) and `b_102` is false. The rat has bits 7 and 8, so its
front view two rows ahead is always mirrored. The sprite's rectangle is
`y2 = Smaller(y, 135)`, `y1 = Larger(0, y - height + 1)`, read from source row 0
(`TAG0088b2(..., srcOffsetX, 0, ...)`), so a sprite cut at the top loses its bottom rows.
Evidence: `tools/dump-monster-draw.ts`.

## A skill-increaser actuator credits the cursor's owner, and an alcove passes it no position

`PerformLocalAction` (`doc/CSBwin-src/Mouse.cpp:238-256`) runs local action 10 at once as
`SkillIncreaser(8, 300, mapPos == -1 ? 0 : 1)` and stores every other type for
`RotateActuatorList` (`Code11f52.cpp:3466-3526`). `SkillIncreaser` (`Mouse.cpp:209-230`)
with a position gives all 300 to `d.HandChar` — the champion who owns the cursor — and to
nobody if it is `-1`; there is no cell lookup. Without one it gives `sw(300 / d.NumCharacter)`
to each champion whose `HP() != 0`, so the dead count in the divisor. Wall actuators touched
by hand pass their wall position (`Mouse.cpp:402`, `:411`, `:462`, `:593-595`), but
`PressurePadOrAlcove` always passes `-1` (`Code11f52.cpp:3875`), for an alcove as much as for
a floor pad. Evidence: `tools/dump-local-action.ts`.

## A wall face shows its last actuator's ornament, none included, and a type 5 rotates its own square

`SummarizeStoneRoom` first fills the three faces with random decorations
(`TAG00a4a2`, `doc/CSBwin-src/Codea59a.cpp:76`). Then every actuator on a face, except a
type 127 with `PORTRAIT_HideGraphic`, writes its `wallGraphicOrdinal()` there **whatever
it is, 0 included**, and marks the face real; an ordinal above `d.NumWallDecoration` is
written as 0 (`:134-153`). So the last actuator on a face decides its ornament. One with no
ornament hides an alcove before it, and any actuator hides the random decoration.

Level 5's hidden alcove is built on this. The west face of (13,19) on map 5 holds #550
(type 0, the alcove ornament) and then #549 (type 5, no ornament, local action 1), so it is
bare stone. A type 5 under a stone-room timer stores its new value (`doc/CSBwin-src/Timer.cpp:2278`)
before the `andOrEdge()` filter can skip the action (`:2297-2327`). It then calls
`QueueSwitchAction` with the **timer's** square and its own position (`:2331-2346`), and a
local action records those for `RotateActuatorList`. A counter instead passes its own
target (`:1610-1612`, `:1657`, `:1672`). `ProcessTT_STONEROOM` ends with
`RotateActuatorList()` (`:2382`). Its other two callers are `PlaceOrRemoveObjectInRoom`
(`doc/CSBwin-src/Code11f52.cpp:4039`) and `TouchWall` (`doc/CSBwin-src/Mouse.cpp:603`).
When the fourth of the room's objects brings counter #616 to zero, #549 fires and
#550 moves behind it, and the alcove shows. Evidence: `tools/dump-hidden-alcove.ts`.

## A DSA can move a cloud out of a cell, and the cloud's timer goes with it

`MoveObject` (`doc/CSBwin-src/MoveObject.cpp:721-790`) runs `CheckSource` / `CheckDestination`
twice, once to check and once to do it. Only the cell source lets a cloud go: the character,
monster and chest sources and every destination but a cell refuse one with
`SER_NoCloudsPlease` / `DER_NoCloudsPlease` (`:156`, `:290`, `:349`, `:426`, `:446`, `:618`,
`:658`). On the **check** pass `FindCellSource` finds the cloud's `TT_25` or `TT_24` timer
with a `TIMER_SEARCH` — the first match in its order, see "`TIMER_SEARCH` walks the queue
backwards" — and returns its handle, or `SER_BadCloudTimer` if there is none (`:227-245`); the doing pass does not search again, so the handle from the check is
the one used. `FindCellDestination` then sets that timer's `uByte6/7` to the new square and
its level to the new level (`:522-529`).

The timer's corner is set from `d.NewPos` there — a leftover from whichever `MoveObject`
last had a destination — but it does not survive: an `RN`'s corner lives in the indirect
index table (`CSBTypes.h:336-341`), not in the `RN`, and `FindCellDestination` ends with
`object.pos(p)` (`MoveObject.cpp:538`), which overwrites it for every holder of that `RN`.
`RN`'s `==` / `!=` compare the indirect index alone (`CSBTypes.h:349-356`), so the timer
search ignores the corner too.

A missile moved by a DSA has its timer's `timerWord8` low ten bits set to the new square —
direction and decay kept — and its level to the new level (`MoveObject.cpp:574-596`).
Evidence: `tools/dump-dsa-move.ts`.

## A DSA cell move is two low-level `MoveObject`s, except for a monster that stays on the party's level

`FindCellSource` lifts the object with `MoveObject(obj, x, y, -1, 0)` on the source level
(`doc/CSBwin-src/MoveObject.cpp:203-220`) and `FindCellDestination` sets it down with
`MoveObject(obj, -1, 0, x, y)` on the destination level, then `object.pos(p)`
(`:531-538`). Both are the low-level `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`), so:

- What is set down runs the teleporter / pit loop at once: an item on an active teleporter
  is carried on, an item on an open pit falls. So does a **cloud**: `Levitating`
  (`Code11f52.cpp:2417-2437`) is true for a missile and a flying monster only — the
  cloud-type-50 test is commented out — and the pit arm wants `!levitated` and a type of
  `dbMONSTER` or more (`:3015-3021`). A missile goes through teleporters and not pits.
- Lifting and setting down press pads through `PlaceOrRemoveObjectInRoom`, except for a
  levitating thing, which uses `RemoveObjectFromRoom` / `AddObjectToRoom` (`:3272-3274`,
  `:3427-3429`). Its `unchangedRoom` argument is whether **the party stands on that
  square** on the loaded level (`:3278-3293`, `:3433-3448`), not whether source and
  destination are the same.
- A teleporter turns an item's corner only when `oldX != -1` (`:3000-3006`), so a DSA
  drop keeps the corner it came with through the loop and the pads, and `object.pos(p)`
  sets the final one afterwards.
- A **monster** is not lifted when the destination is a cell, and the source and
  destination are both on the party's level (`MoveObject.cpp:203-220`). Instead
  `MoveObject(object, srcX, srcY, x, y)` moves it square to square, keeping its `ITEM16`,
  and when that returns 0 every monster-AI timer (`TT_FIRST_MONSTER_AI`..`TT_LAST_MONSTER_AI`)
  on the old square is pointed at the new one (`:539-571`). Otherwise its `groupIndex` is
  set to `0xd8`, or `0xff` for a monster whose `horizontalSize` is 2 (`:504-521`), before
  `MoveObject(-1, 0, x, y)`, whose monster branch attaches an `ITEM16` and starts the AI
  timers if it lands on the party's level (`Code11f52.cpp:3363-3405`). A monster lifted
  *off* the party's level is not detached — `MoveObject` with `newX < 0` returns before
  its monster branch (`:3297`).

Evidence: `tools/dump-dsa-move.ts` sections 4-8.

## A new object takes a slot naming a free record, else the lowest free record from index 1

Every `FindEmptyDB<n>Entry` (`doc/CSBwin-src/CSBCode.cpp:4942-5084`) calls
`DATABASES::FindEmptyDBEntry` (`doc/CSBwin-src/data.cpp:918-990`), and only if that returns
`RNnul` falls back on `MakeMoreRoomInDB`. `FindEmptyDBEntry` first walks the indirect index
from slot 1 (`:933-953`): it notes the lowest free slot (`dataIndexMap[i] == 0xffff`), and
stops at the first slot of the database whose record's link is `RNnul`, taking that slot
and that record, which may be record 0. Failing that, it takes the record at the lowest
index **from 1** whose link is `RNnul` (`:954-966`). Only when there is none does it
`Enlarge` the database (`:967-972`), which grows it by 100 records, clears them to link
`RNnul`, sets the first to `RNeof` and returns its index, the old length
(`data.cpp:862-876`), named through `RN(dbType, index)`. The record goes into the lowest
free slot, or a new one at the end of the maps: refused, `RNnul`, once the maps are over
`0xff00 - 100` long, unless the caller passes `important` (`:973-988`), which a DSA's copy
and a champion's bones do (`DSA.cpp:1773-1868`, `Character.cpp:2625`). The slot names the
record at corner 0, and the record is cleared, its link `RNeof` (`:986-991`).

`Enlarge` stops at `db.Max`: 8000 records, 16000 for the actuators and 768 for database 15
(`CSB.h:1646`, `data.cpp:823-827`), and grows by 100 even from within 100 of it. It sets
the header's `DBSize` to the new size (`:862`), so a save declares the cleared records and
carries them. It would ask the player first, but sets `AutoEnlarge` on the line before
(`:843`), and the `m_noEnlarge` bit it checks is never set (the line that set it, `:848`, is
commented out).

`DeleteDBEntry` is what frees a record: link `RNnul`, and the one slot naming it freed,
`0xff`/`0xffff` (`data.cpp:993-1015`). Its walk starts at slot 0, and when two slots name
the record, or its slot carries bit `0x80`, it returns at once, "Cloned!!!", and frees
neither. Slot 0 is `0`/`0` (`SaveGame.cpp:1968-1973`), which names door 0: deleting door 0
while a chain holds it changes nothing. A slot names a free record only if something made
one for it, so record 0, once freed with its slot, is not taken again.

`dungeon.dat` ships free records: weapon 105 (of 107), scroll 33, potion 37, misc 8 and
116 (of 280). The first arrow `ConstructPredefinedMissile` (`Mouse.cpp:105`) makes is weapon 105.
Evidence: `tools/dump-db-reuse.ts`; `Enlarge`, `tools/dump-make-more-room.ts` section 0.

## `SmartDiscard` thins a database only at 6000 records in use, and never an important object

`SmartDiscard(false)` runs once per tick of the main loop (`doc/CSBwin-src/CSBCode.cpp:678`).
Each call is one step of a cycle over the weapon, clothing and misc databases, in that order
from a start, which `SmartDiscard(true)` makes after `ReadEntireGame` (`:10635-10636`) and at
the tail of a save (`SaveGame.cpp:1245`) by setting misc as the current database
(`SmartDiscard.cpp:747-757`, `:764-798`). A step counts fifty records whose link is not
`RNnul` (`:799-876`). Once all are counted, a count below `db.Max(n) * 3/4` moves on to the
next database (`:807-815`). `db.Max` is 8000 for every database but actuators (16000) and
database 15 (768) (`CSB.h:1646`), so the limit is 6000. At or above it the dungeon is scanned,
fifty objects a step (`:877-883`, `:622-660`), into a heap of the 200 highest priorities
(`:11`, `:173-201`), and then one object is discarded per step, highest first, until the
count is back below 6000 (`:884-900`, `:662-732`). The count drops by one for every attempt,
including a failed one.

The priority is `20 + |level - partyLevel|` off the party's level and the square distance
`|x - partyX| + |y - partyY|` on it. The Nth object of a type on a corner adds N, plus
`N - 20` more past twenty, or ten times that for clothing (`:517-607`). An object whose
`important()` bit is set is never listed. On a cell whose chain has an actuator of type 1-9
or 16 before the object, neither is the first of each type on each corner (`:491-510`,
`:543-546`). Before it discards, `DiscardObject` scans the cell again and goes ahead only if
the object is still listed at a priority no lower (`:712-714`, `:345-356`). The discard is
`MoveObject(obj, x, y, -1, 0)` on the object's level, then `DeleteDBEntry` (`:716-721`).

`dungeon.dat` sets `important()` (bit 7 of `word2` for `DB5`, `DB6` and `DB10`,
`CSB.h:1165`, `:1185`, `:1269`) on every weapon, garment and misc object it places, on floors,
in chests and in monsters' hands, except three floor weapons. So what `SmartDiscard` can take
is what play creates. Evidence: `tools/watch-smart-discard.ts`.

## A full database throws one object out of the dungeon: `MakeMoreRoomInDB`

Every `FindEmptyDB<n>Entry` (`doc/CSBwin-src/CSBCode.cpp:4942-5084`) falls back on
`MakeMoreRoomInDB` (`Character.cpp:182-358`) when `FindEmptyDBEntry` returns `RNnul`, and
reuses the record it returns. It first tries `Enlarge` again (`:214-218`), and for the cloud
database gives up (`:220-223`). Then it sweeps: from `d.LevelCleared[db]` (`Data.h:941`, zero
at the start), stepping past the party's level (`:225-232`), square by square, column by
column, through each square's floor chain (`:233-331`). On the party's level it skips any
square within 5 of the party on both axes, `uw(x - partyX + 5) <= 10` (`:250-256`). In a
chain, an actuator of type 0 is passed and any other ends the square (`:260-264`). The first
object of the database that is not `important()` is taken (`:268-327`):

- a monster group: `DropMonsterRemains(x, y, rn, -1, level, dropResidue < 2)`, which drops
  what it carries and no droppings, then `DeleteMonster`;
- a missile: its timer deleted (`TAG00e156`, `Code11f52.cpp:1545-1551`), then
  `RemoveObjectFromRoom` and `ProcessObjectFromMissile`, which drops its object;
- a weapon, garment, misc object or potion: `MoveObject(rn, x, y, -1, 0)`;
- any other database: the record is returned where it lies (`default:`).

`d.LevelCleared[db]` becomes that level and the record is returned at corner 0. A level with
nothing to take moves the sweep on, skipping the party's level. Back at the level it started
on, it goes to the party's level. When the party's level (or a one-level dungeon) has nothing
either, `LevelCleared` is set to it and the result is `RNnul` (`:340-355`).

The function is the Atari original's (`TAG009d9e`, the `00a0a8` address comment); `Enlarge`
is CSBWin's addition. The original's databases did not grow: a new game sizes each at the
file's record count plus `d.Byte7302[db]` spares (`SaveGame.cpp:2556-2564`, with a
commented-out cap of 1024, and 768 for database 15). The stock `Byte7302` gives 420 misc
records (280 + 140), 207 weapons, 241 clothing, 257 monsters, 60 missiles and 50 clouds.
`dungeon.dat` plants every monster group `important()`, so only a spawned group can go.

A group or a missile is thrown out through `DeleteDBEntry` (`DeleteMonster`,
`Code11f52.cpp:1040`; `ProcessObjectFromMissile`, `Timer.cpp:167`), which frees its slot, so
the RN returned names no record. Its `dbType()` is `dbUNKNOWN`, 16, and its `idx()` 0xffff,
so `FindEmptyDB4Entry`'s `GetRecordAddressDB4` reads `m_Address[16]`, past the sixteen
databases (`CSBCode.cpp:4845-4849`, `data.cpp:735-743`, `CSB.h:1610`); its `ASSERT` is
compiled only under `_DEBUG` (`CSBTypes.h:99-103`). The port names the freed record anew
(`DEBT.md` H).
Evidence: `tools/dump-make-more-room.ts`.

## A DSA's `&DEL` frees nothing until the run is over, and tells the caller if it deleted itself

`EX_DEL` (`doc/CSBwin-src/DSA.cpp:1643-1737`) removes the object from its square, the cursor
or a champion's possessions, then hands it to `DSADBANK::DeleteObject` (`:157-163`), which
only pushes it on the run's `m_objectDeleteList` **through the record's own link**; a
scroll's text is pushed first (`:1715-1722`). The records stay allocated for the rest of the
run. `ProcessDSATimer6` calls `ConsumateDeletes` (`:178-191`) after `PutState` (`:5483`):
it frees the whole list and returns whether the DSA's own actuator (`objSlave`) was on it,
and that is `ProcessDSATimer6`'s return value (`:5486`). All three timer walks that run a
DSA — `TT_5` (`Timer.cpp:1757`), `TT_6` (`:2230`) and `TT_7` (`:1433`) — `break` out of
the cell's object chain when it is true, since the slave's link now belongs to the delete
list. Filters (`ProcessDSAFilter`, `DSA.cpp:5315-5325`) ignore it. Evidence:
`tools/dump-dsa-delete.ts`.

## A DSA filter runs on a parameter array of its own; the party attack's, the action name's and the feeding's write the current one

`pDSAparameters` (`doc/CSBwin-src/DSA.cpp:43-44`) points at the array `&NUMPARAM`, `&PARAM@`
and `&PARAM!` read and write: word 0 is the count, words 1 to 100 the parameters.
`NEWDSAPARAMETERS` (`doc/CSBwin-src/CSB.h:4220-4235`) points it at an array of its own for
the scope it is declared in, sets that array's count to 0 and leaves its words
uninitialised, and points it back at the caller's when the scope ends. Every filter is
called inside one: `KillCharacter`, `DamageCharacter`, `SetPossession`
(`Character.cpp:2550`, `:2844`, `:2937`), `DescribeObject` (`:3435`), the monster-delete
filter (`Code11f52.cpp:928`), the missile-encounter filter (`:1645`), `AdjustSkills`
(`Magic.cpp:196`), `CallSpellFilter` (`:876`), `SoundFilter` (`Sound.cpp:692`),
`MonsterAttacks` (`Monster.cpp:1153`), the post-monster-move filter (`:3174`),
`ProcessTimers29to41` (`:3321`) and `CallPartyMoveFilter` (`CSBCode.cpp:7805`); and so is
the DSA `ActivateDSA` starts, "Ensure
DSAparameters[0] = 0" (`Timer.cpp:1525`). A filter's count and words are therefore gone
once it returns, and a DSA run after it, or the program that reached it, finds its own.
`&PARAM@` reads no word past a count of 0 or more (`DSA.cpp`'s `STKOP_ParamFetch`), so the
uninitialised words cannot be read: only a parameter message whose record is gone sets a
count of -1, and on the outer array (see "`&PARAM@` compares the count unsigned"). Three
filters are the exception. `_FeedCharacter` declares no `NEWDSAPARAMETERS`
(`Character.cpp:4004-4497`), so the feeding filter's DSAs leave its count, 27, and the
block in the caller's array (`:4333-4336`). `ActionNameFilter`'s `NEWDSAPARAMETERS` is declared in the block
that looks for its DSA (`CSBCode.cpp:8653`), which closes before the DSA runs (`:8675`,
`:8697`), so it writes its count, 5, and its words into the caller's array, and leaves them
there. The party attack filter:
`SetupDSAParam` lays `ATTACKPARAMETERS` over the current array, writes its count as
`sizeof(ATTACKPARAMETERS)`, 124, and zeroes its 31 words, at every `_Attack` that gets past
its first two returns, filter or none (`Attack.cpp:1346-1360`, `:1673`). Evidence:
`tools/dump-dsa-parameters.ts`.

## The viewing filter runs every DSA at its location, and the scroll's loop follows the object a DSA leaves

`DescribeObject`'s two viewing-filter sites, the scroll's and the description's
(`doc/CSBwin-src/Character.cpp:3476-3518`, `:3736-3770`), walk the chain at
`ESL_VIEWINGFILTER`'s location and run every type-47 actuator on it, each a filter call
with the parameters set afresh, and go on with `continue`; so does `TAG019036`'s, at the
eye click (`:4571-4575`). The description's parameter 0 is the file-scope `phraseMask` as it
stands (`:3762`), so a DSA sees what the `&DESCRIBE` of a DSA before it did, and nothing is
read back: the mask and the phrases change only through `ModifyDescription`
(`:3797-3830`). The scroll's parameter 0 is 0 (`:3502`). After each run the scroll's site
reads parameter 1 back into the loop's own `obj` whenever `checkIndirectIndex` takes it,
and draws it if it is a scroll (`:3509-3516`); `continue` then steps along that object's
chain, not the actuators'. Parameter 1 starts as the scroll being read, a valid object, so
a DSA after the first runs only if the first stores an invalid object there. Evidence:
`tools/dump-viewing-filter.ts`.

`&DESCRIBE` with a location, `ModifyDescription` (`Character.cpp:3816-3830`), sets the phrase
from every text at the location whose corner matches, with no `IsValid`, so the last such
text wins, and enables the phrase whatever the text holds, an empty one included. It reads
each with `GetText` (`doc/CSBwin-src/AsciiDump.cpp:362-456`), not `DecodeText`: the same
codes and escape tables as `DecodeText` for a text that is not a wall's, but whatever the
`show` bit, with no line feed in front, `/` for code 28, no length limit and no
`SubstituteCharacterNames`. On every text in use in `dm-atari` and Conflux, `GetText`
reads what `DecodeText` at `0x8001` reads before its substitution, but for that line feed
and code 28. Evidence: `tools/dump-viewing-filter.ts`.

## A DSA's `I_` operation acts only when its record reaches the `ESL_INDIRECTACTIONS` DSA

`&%TELEPORTPARTY`, `&%DEL` and the thirteen other `I_` operations do not act: `Indirect`
(`doc/CSBwin-src/DSA.cpp:2093-2192`) pops their operands into a parameter record and sets a
`TT_ParameterMessage` timer to the dungeon's `ESL_INDIRECTACTIONS` location, due this tick
unless `&%DELAY` put it off. The operation runs only when the DSA there executes
`&%INDIRECT` on that record (`:2345-2391`), with the stack, the array variables and the
parameters the sender had. With no such location the operation does nothing, and pops
nothing (`:2109-2120`). `STKOP_I_FilteredCast` has no case in `EX_AMPERSAND`: no operation
writes such a record, and `&%INDIRECT` alone knows it (`:2358`). The record format and the
counts are in `doc/CSBWIN_DSA_REFERENCE.md` → "STKOP message and sound operations".
Evidence: `tools/dump-dsa-indirect.ts`.

## `&THROW` throws a spell only for the eight words `ThrowMissile` lists

`ThrowMissile` (`doc/CSBwin-src/Timer.cpp:2016-2078`), the DSA's `&THROW`
(`DSA.cpp:4558-4582`), switches on `missileType & 0xffff` (`:2029-2040`): `RNFireball`,
`RNPoison`, `RNLightning`, `RNDispellMissile`, `RNZoSpell`, `RNPoisonBolt`, `RNPoisonCloud`
and `RNMonsterDeath` are `CreateSpell(missileType & 0x7f)`, the word itself; 0 throws the
first object of a database above `dbMONSTER` and up to `dbMISC` whose corner is the object
location's, `RemoveObjectFromRoom`d first (`:2041-2061`). Any other word leaves the object
`RNeof`, and nothing is thrown (`:2063`), however close to a spell it is: `0xff85` and
`0xff90` throw nothing. Beside it, `&MISSILEINFO!` pops its direction, damage and range
only when `checkIndirectIndex` takes the slot it popped first (`DSA.cpp:2831-2837`), so an
invalid slot leaves them on the stack. Evidence: `tools/dump-dsa-missiles.ts`.

## `&INSMON` rebuilds the facing byte from the record, and copies no status

`InsertMonsterInGroup` (`doc/CSBwin-src/Monster.cpp:4742-4820`), the DSA's `&INSMON`, takes
`pMonster->facing()`, `word14` bits 8-9, sets the new member's two bits to it with
`SetMonsterFacingBits`, and writes that byte with `SetMonsterFacingByte` (`:4786-4788`). On
the party's level the byte is the `ITEM16`'s, so member 0 and the new member face the
record's direction, which is stale there, and every other member faces north (0). Its
"fifth" step copies member 0's `singleMonsterStatus` only through `pItem16`, which is
declared `NULL` and never assigned (`:4747`, `:4815-4818`): the new member keeps the status
its slot held. Three more of the monster family's edges: `&MONPOSS` of a slot that is no
group pushes 0xffff, because its `object` is a default `RN`, `RNnul`, which is not `RNeof`
(`DSA.cpp:3364`, `:3385`, `CSBTypes.h:300`, `:371`); `&MONSTER!`'s `num` is a `ui32`, so
`i < num - 2` lets a `num` of 0 or 1 write all four hit points (`DSA.cpp:4101`); and
`&MONL&D` returns before its pop outside the monster move filter (`:4775`), leaving its
index on the stack. Evidence: `tools/dump-dsa-monsters.ts`.

## A missile at a door: Zo works the button, grates let small things through, the rest hit it

The door arm of `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:1844-1935`), in order:

1. A Zo spell (`RNZoSpell`) at a door whose state is not 5 queues
   `CreateTimer(TT_DOOR, x, y, 0, 2, d.Time + 1)` if the door has its switch bit
   (`DB0::doorSwitch`, `word2` bit 6, `CSB.h:843`), and then `break`s to the shared tail
   whether or not it did — so the spell is spent even at an open door (`:1852-1864`).
2. A door that is broken (5) or open (0, 1) lets the missile on (`return 0`, `:1865`).
3. `D0B = BITS8_15(d.DoorTOC[doorType]); if (D0W & 2)` (`:1869-1870`) — bit 1 of the
   **high** byte (0x200) marks a door missiles may pass (`Monster.cpp:323` reads bit 0,
   0x100, for monsters). A cloud-typed projectile (a spell) passes if
   `IsNonPhysicalSpell()`, i.e. `>= RNDispellMissile` (0xff83, `CSBTypes.h:373`). A thrown
   object draws `STRandom(128)` and passes if `rangeRemaining` beats it, its
   `ObjDesc.word4 & 0x100` (pouch) is set, and it is not a key (`RN::IsAKey`, a misc whose
   name index is 0xb0-0xbf, `data.cpp:686-694`) (`:1912-1917`). Passing is `return 0`.
   In `graphics.dat` only `DoorCharacteristics[0] = 0x36e` has the bit.
4. Otherwise `D5W = DetermineMagicDamage + 1`, then the type-2 missile filter, then
   `HitDoor(x, y, D5W + (STRandom() & 0xffff) % D5W, false, 0)` (`:1922-1934`) — not an
   explosion, so it needs `canOpenWithAxe`, and the force must reach `DoorTOC & 0xff`.

Evidence: `tools/dump-missile-door.ts`.

## A teleporter that switches on under a cloud takes the cloud's timer along too

`WiggleEverything` (`doc/CSBwin-src/Timer.cpp:2428-2512`) — run when a teleporter or pit
switches on (`ProcessTT_TELEPORTER`, `ProcessTT_PITROOM`) — moves every object above
`dbMONSTER` in the cell with `MoveObject(obj, x, y, x, y)`, then fixes up the timers that
name it: a missile's own timer gets `d.NewX` / `d.NewY` / `d.NewDir` in `timerWord8`, the
placed `RN` at `d.NewPos` and `d.NewLevel` (`:2476-2489`); for a cloud, a `TIMER_SEARCH` over
**every** timer sets each `TT_25` or `TT_24` whose `timerObj8()` is the cloud to `d.NewX`,
`d.NewY`, the cloud at `d.NewPos` and `d.NewLevel` (`:2491-2510`). The compare is `RN`'s
`!=`, which ignores the corner (`CSBTypes.h:349-356`); nothing checks the level. A cloud
cannot fall, so in practice this is a teleporter's doing. Evidence:
`tools/dump-wiggle-cloud.ts`.

## A Fluxcage lasts 100 ticks, and its `TT_24` names the cage in bytes 8-9

`CreateFluxcage` (`doc/CSBwin-src/Code11f52.cpp:1515-1539`) takes a DB15 slot, adds it to the
square at `RNempty` (centred), sets `CT_FLUXCAGE`, and queues a `TT_24` at `d.Time + 100` on
`d.LoadedLevel` with `timerObj8()` = the cage and `uByte6/7` = the square. `TT_24`
(`CSBCode.cpp:6494-6510`) does nothing once `d.Word11694` (game won) is set; otherwise it
`RemoveObjectFromRoom(timerObj8(), uByte6, uByte7)` and frees the record by writing -1 to its
link. Evidence: `tools/dump-clouds.ts` section 6.

## Only `MonsterAttacks` sets `d.LastMonsterAttackTime`

Outside the save code (`SaveGame.cpp:1027`, `:1643`) and its start value of -200
(`CSBCode.cpp:353`), the one writer is `MonsterAttacks` (`doc/CSBwin-src/Monster.cpp:982`),
`d.LastMonsterAttackTime = d.Time`, right after the `d.NumCharacter == 0` guard and before the
attack is chosen. A missile reaching the party does not set it. Its readers are `AdjustSkills`
(`Magic.cpp:219-247`: skills 4-11 earn half when the last attack is more than 150 ticks old,
and skills 4 and up earn double when it is less than 25 ticks old)
and the per-champion facing reset in the tick (`Code17818.cpp:420-428`: a champion turned away
from the party's facing turns back once 60 ticks pass without one). A save carries it as
an `i32` (`GAMEBLOCK2`, `SaveGame.cpp:125`), so a game no monster has attacked writes -200 as
`ff ff ff 38`: the seven made-to-order saves and CSB's two hold it. Evidence:
`tools/dump-last-monster-attack.ts`.

## `TIMER_SEARCH` walks the queue backwards, and `SetTimer` mostly keeps the old timer

`TIMER_SEARCH`'s constructor copies the **queue** (`m_timerQueue`, the heap array: see "CSBWin's
timer queue is a binary heap") into `m_searchList` (`CreateSearchList`,
`doc/CSBwin-src/Timer.cpp:1209-1215`), and `FindNextTimer` (`:2924-2933`) starts at its end and
counts down: the heap's last array entry is visited first, which is not in general the timer
due last, and slot numbers play no part. Because it walks a copy, `DeleteTimer` on the current entry is safe.
Every "first match" in CSBWin's timer searches — `SetTimer`'s duplicate rules, the DSA's
cloud-timer lookup (`MoveObject.cpp:233-241`) — is first in that order.

`SetTimer`'s duplicate rules (`Timer.cpp:1011-1125`), with "matches" meaning same `Time()`,
`Level()` and `timerWord6()` (the square):

- **New map timer (5-10)**, only while `deleteDuplicateTimers != 0` (initialised -1,
  `data.cpp:64`; a save may set it, `SaveGame.cpp:1802-1804`): the first matching **map timer
  of any function** — a `TT_STONEROOM` only with the same `uByte8` — takes the new `uByte9`
  and is returned; the new one is not queued. Failing that, the first matching `TT_1` is
  deleted — the new `uByte9` becoming `1 - old.uByte9` if it was 2 — and the new one is queued.
- **New `TT_1`**: the first matching `TT_DOOR` or `TT_1` is returned and the new one dropped.
  A `TT_DOOR` changes only if its `uByte9` is 2, to `1 - new.uByte9`; a `TT_1` takes the new
  `uByte9`. Matching timers of other functions are passed over.
- **New `TT_BASH_DOOR`**: every `TT_1` / `TT_DOOR` on the square and level is deleted, at any
  time (already in "A melee blow shatters a door two ticks late").

The returned handle is the kept timer's, so a caller storing the index stores the old slot.
A timer that is queued is stamped `m_timerSequence++` as it goes into its slot (`:1189`, under
`SEQUENCED_TIMERS`, defined in `stdafx.h:17`); a dropped duplicate consumes no number. The
counter is a `ui16` (`Data.h:1542`). The timer that finds it at 0xffff first repacks the
stamps of the queued timers (`:1136-1188`): the stamps are cut into pages of 32
(`TimerSequencePageSize`, `:1135`), the pages in use are renumbered 0, 1, 2… in their order,
and each stamp keeps its offset in its page, so the queue's order is unchanged. The counter is
not reset: that timer takes 0xffff and the next one 0, which sorts before every repacked stamp
due on the same tick. A dropped duplicate returns before the repack.
Evidence: `tools/dump-timer-dedupe.ts`, and for the repack `tools/dump-timer-sequence.ts`.

## Actuator type 8 counts what is in a carried chest, and what is on the cursor

`DoesPartyHave` (`doc/CSBwin-src/Code11f52.cpp:3622-3680`), the test of a type-8 floor sensor,
walks the 30 possessions of every champion whose `HP() != 0`, comparing each one's
`GetBasicObjectType` with the actuator's value; a possession that is `objNI_Chest` (0x90,
`Objects.h:585`) has its `contents()` chain compared as well. After the last champion it sets
`w_4 = 1`, loads `d.objectInHand` and jumps back into the loop body (`goto tag012e14`,
`:3672-3678`), so the object on the cursor — and, if it is a chest, its contents — counts too,
whoever holds the cursor. Evidence: `tools/dump-does-party-have.ts`.

## A walking monster presses and releases floor pads; a flying one does not

`MoveObject`'s monster branch lifts and sets down a group that is not `Levitating` through
`PlaceOrRemoveObjectInRoom` (`doc/CSBwin-src/Code11f52.cpp:3287` to remove,
`:3392` to place), so its actuators run as for an item. Leaving, `unchangedRoom` is
whether the party stands on the square on the loaded level; arriving, it is hard-wired
`false` ("Not current room. Room changed."). A flying group uses `RemoveObjectFromRoom` /
`AddObjectToRoom` (`:3274`, `:3386`) and presses nothing. The removal
(`:3257-3296`) comes before the test for a party or monster on the destination
(`:3335-3358`), so a group that goes into abeyance has released its pad first.

A group that is **deleted** leaves its pad the same way. `DeleteMonster` clears the group's
hit points (`doc/CSBwin-src/Code11f52.cpp:1037`) and then lifts it with `MoveObject(obj, x, y,
-1, 0)` (`:1038`), before freeing the record and its `ITEM16`. With no hit points left,
`CheckMoveFromMissile` returns 0 at once (`:2593-2596`); with `newX < 0`, `MoveObject` skips the
loop, lifts the group as above (`:3257-3296`) and returns 0 before the monster branch (`:3297`).

Evidence: `tools/dump-monster-pad.ts` sections 1-4 and 6 (6: 1 of 4 checks fails before), on a
type-1 pad from `dungeon.dat`.

## A dropped and a thrown object are set down by `MoveObject`, with `oldX` -1 and -2

`DropObject` sets the cursor's object down with `objD4.pos(w_4); MoveObject(objD4, -1, 0,
D6W, D5W, NULL, NULL)` (`doc/CSBwin-src/Mouse.cpp:881-889`), and `ProcessObjectFromMissile`
sets a thrown object down, when no monster takes it, with `MoveObject(objD6.pos(missile.pos()),
-2, 0, mapX, mapY, NULL, NULL)` (`Timer.cpp:151-159`; a spell or a cloud is never set down,
`:138`). Both go through the teleporter / pit loop and `PlaceOrRemoveObjectInRoom`, whose
`unchangedRoom` is "the party stands on that square" (`Code11f52.cpp:3433-3448`, see "A DSA
cell move is two low-level `MoveObject`s") — so an item dropped at the party's feet does not
press a type-1 pad the party is already on. The two differ at a relative teleporter: it turns
the object's corner only when `oldX != -1` (`:3000-3006`), so a dropped object keeps the
corner it was dropped at and a thrown one (`-2`) is turned.

Evidence: `tools/dump-drop-move-object.ts` (3 of 8 checks fail before).

## `MoveObject` takes a monster or an object down stairs and out, turning its corner

In `MoveObject`'s loop (`doc/CSBwin-src/Code11f52.cpp:3108-3131`), a square that is neither an
active teleporter nor a pit the thing falls into ends the loop unless it is stairs
(`D5W != 3`, `:3110`). The party (`RNnul`), a missile and any type below `dbMONSTER` break there too;
so a monster, an item or a cloud on stairs goes on: one level down with `IncrementLevel` when
bit 2 of the cell is clear (`:3114-3118`; bit 2 set means the stairs go up, and then the level
does not change), then one square out in `ExitStairsDirection`'s direction on the level it is
now on (`:3119-3123`; the first neighbour, N-E-S-W, that is not stone, not stairs, and not a
false wall with bits 0 and 2 clear, else `d.partyFacing`, `:290-325`). Its corner becomes
`((((pos - back + 1) & 2) >> 1) + back) & 3`, where `back = (dir + 2) & 3` faces the stairs
(`:3124-3130`), and the loop goes on from the new square. There is no levitation test, so a
flying monster takes the stairs too.

`objD7.pos(p)` changes the object itself, not a copy: `RN::pos(p)` writes the corner into the
global `dataTypeMap` entry for the RN's indirect index (`CSBTypes.h:336-341`), and `RN`
equality compares only that index (`:349-356`, `IsSameObjectAs` `:362-365`). So does an
integer compare: `ConvertToInteger` returns the indirect index (`:371`), as in the DSA's
`&DEL` (`DSA.cpp:1690`). No compare in CSBWin sees a corner. The port's ID carries the corner,
so its chain walkers compare with `rnEquals`, and a group the stairs turned is set down under
the turned ID.

A DSA's cell move sets the corner *after* its `MoveObject` (`MoveObject(object, -1, 0, x, y)`,
then `object.pos(p)`, `MoveObject.cpp:537-538`), so a group a DSA sends down the stairs ends in
the DSA's corner. The same-level monster branch (`:546`) sets none, and the stairs' turn stands.

Evidence: `tools/dump-stairs-move.ts`: the corner of an item and of a group, a lift with the
ID the group came with, and the DSA's corner.

## `WiggleEverything` moves each object with `MoveObject`, and walks a counted stretch of the chain

When a teleporter switches on or a pit opens, `WiggleEverything` (`doc/CSBwin-src/Timer.cpp:2428`)
moves the party, then the first monster, then every object of a type above `dbMONSTER`, each
with `MoveObject(obj, x, y, x, y)` — so a cloud falls down the pit (it is not `Levitating`),
a missile presses no pad, and `unchangedRoom` is "the party stands on that square" (see "A DSA
cell move is two low-level `MoveObject`s"). The object loop starts at `FindFirstDrawableObject`
(the first object of type `dbMONSTER` or above, `CSBCode.cpp:5140-5149`), counts the objects
above `dbMONSTER` from there (`Timer.cpp:2451-2460`), and then walks that many links, reading
each one's successor before moving it (`:2461-2466`). The count stops an object moved back
into the same cell from being moved twice; it also means that a monster still in the chain
uses up one step, so the last object is not moved. A moved missile's timer gets `d.NewX`,
`d.NewY`, `d.NewDir` in `timerWord8`, keeping bits 12-15, the ID with `d.NewPos`, and
`d.NewLevel` (`:2474-2489`).

The monster goes through the same `MoveObject`, so it is teleported, falls, detaches or
attaches its `ITEM16` and gets fresh AI timers like any other monster move. A group that ends
on the square it started on — a teleporter not open to monsters, or one aimed at its own square
— takes `MoveObject`'s unchanged-room return (`Code11f52.cpp:3183-3213`): `return 0` before
anything is lifted, so no pad sees it leave or arrive. Only the stairs turn a monster's corner
(`:3124-3130`), and they always move it to another square.

Evidence: `tools/dump-wiggle-objects.ts` (the moves; the count's monster case has no scenario),
`tools/dump-wiggle-monster.ts` (the monster; 5 of 9 checks fail before).

## What `MoveObject` returns for a monster, and the AI stops on anything but 0

`MoveObject`'s monster branch returns `LOCAL_14` (`doc/CSBwin-src/Code11f52.cpp:3423`), or 1
for a group that left the dungeon on the way. `LOCAL_14` is set in the loop only by
`TeleportMonster` (`:2988`), which returns `groupIndex() + 2` for a fear-state-6 group whose
attached level is the party's and 1 otherwise (`:2377-2386`); a pit fall does not touch it.
After the loop, leaving the party's level with an `ITEM16` sets it to 1 (`:3364-3369`) and
arriving there without one does `LOCAL_14++` (`:3370-3378`). So a plain step is 0, a teleport
1, a group placed from nowhere onto the party's level 1, and a teleport onto the party's
level from another 2. Anything above 1 runs `ClearAttacking_DeleteMovementTimers(
&d.Item16[LOCAL_14 - 2], oldX, oldY)` (`:3409-3414`): for that last case, slot 0, whoever
owns it. `MoveObject` never writes the `ITEM16`'s `uByte10`/`uByte11` or `ubPrevX`/`ubPrevY`;
only `AttachItem16ToMonster` sets the first pair (`CSBCode.cpp:6088-6091`).

Every teleporter of a chain turns the group through the `ITEM16` of its attached level:
`TeleportMonster(DB1A2, objD7, AttachedLevel_4, !item16Attached)` (`:2988`), whatever level
the chain has reached.

A group that falls is hurt by `DamageMonsterGroup(pDB4, oldX, oldY, 20, 0, !item16Attached)`
(`:3096-3097`) — its old square, and `P5 = 0`, so the last member's death is not applied
(`:1110`) and dead members' droppings wait in `d.Byte13050` for `TAG00b522`, which drops
them at the square the group fell to (`:3101-3104`). `DamageMonsterGroup` empties that list
first (`d.Word13046 = 0`, `:1333`). If the whole group died the loop stops (`:3100`). After the
loop, a group the fall killed, or one whose type is not allowed on the level it ended on,
is deleted (`:3147-3176`): `TAG00b522`, `DropMonsterRemains` at the new square, and
`DeleteMonster` at the old one when it had one — a group placed from nowhere keeps its
record. `MoveObject` returns 1.

The AI's four `MoveObject` calls (`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`) all end the
turn on a non-zero value, and otherwise re-aim only `timer_70`'s square, to `d.NewX`,
`d.NewY` (`:1719-1720`, `:2111-2112`, `:2448-2449`, `:2927-2928`). `CreateMonster` returns
`RNnul` whenever `MoveObject` is non-zero (`Monster.cpp:222-231`), which includes every group
made on the party's level, and only otherwise queues the teleport sound; its one caller, the
generator, ignores the value and queues the sound itself when it is audible
(`Timer.cpp:1787-1800`).

The generator works on its own level, whatever the party's: `ProcessTimers` loads the
timer's level first (`CSBCode.cpp:6416-6417`), so the hit-point multiplier is the
actuator's, or that level's `experienceMultiplier()` when the actuator's is 0
(`Timer.cpp:1782-1786`), and `CreateMonster` makes the group on that level at the
generator's x and y. Every member's hit points are then
`baseHealth * multiplier + STRandom() % (baseHealth / 4 + 1)` (`Monster.cpp:207`). In
`dm-atari/dungeon.dat` most generators have a multiplier of 0 and take the level's.
Evidence: `tools/dump-monster-generator.ts`.

Evidence: `tools/dump-monster-move-code.ts` (13 of 17 checks fail before the fix),
`tools/dump-monster-move.ts` case 1.

## A dying champion's possessions drop in `d.DropOrder` order, through `MoveObject`

`DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2499-2520`) walks `D4W` 0-29 and takes
slot `d.DropOrder[D4W]` out with `RemoveCharacterPossession`, skips an `RNnul`, turns the
object to the champion's `charPosition` and sets it down with `MoveObject(obj, -1, 0,
d.partyX, d.partyY)` — so a dropped possession presses a pad, falls down an open pit or
goes through a teleporter, as any cursor drop does. `AddObjectToRoom` appends to the end
of the cell's chain (`doc/CSBwin-src/Code11f52.cpp:392`), so the chain lists the objects in
`DropOrder` order.

`d.DropOrder[30]` is an `i16` table in graphic `0x232` (`doc/CSBwin-src/Data.h:1405`,
byte-swapped at `CSBCode.cpp:10206`). The item is read to `d.Byte1832+2` (`:10197`), so
the name `1586` puts it at byte 1830 − 1586 = 244 of the item, straight after `Word1588`.
In the Atari DM `graphics.dat` it reads

    5, 4, 9, 8, 7, 12, 6, 11, 3, 13, 14, 15, … 29, 10, 2, 0, 1

a permutation of the thirty slots: the hands go last, the neck just before them.
When the dying champion's inventory is the one open, `KillCharacter` hides it
(`ShowHideInventory(4)`, `Character.cpp:2622`) before it calls `DropAllPossessions`
(`:2624`).

Evidence: `tools/dump-champion-death.ts` section 7 (2 of 45 checks fail before the fix;
the `DropOrder` permutation check is its canary).

## `RemoveCharacterPossession` undoes the Illumulet, the Jewel Symal, the scroll and the torch

`RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1822-1930`) empties the slot
first, returns `RNnul` for an empty one, and then tests `objRemoved.NameIndex()` — the
*modified* name, so a lit torch is any of `objNI_Torch_a`-`_d` and a worn Illumulet is
`_b`:

- slot 10, an Illumulet (`objNI_Illumulet_a`-`_b`): `value(0)`, and `d.Brightness -=
  d.Word1074[2]` (`:1860-1867`); a Jewel Symal (`_a`-`_b`): `value(0)` (`:1869-1875`);
- slot 1: `CHARFLAG_weaponAttack`, `TAG01b1c0()` if `d.AttackingCharacterOrdinal` is this
  champion, and a scroll (`objNI_OpenScroll`-`objNI_Scroll`) gets `open(false)`
  (`:1882-1895`);
- slot 0 or 1, a torch: `litTorch(0)` — the charges stay (`:1897-1904`);
- slot 1 with this champion's inventory open: a chest is repacked (`:1906-1914`).

`AdjustStatsForItemCarried(pcA3, slot, -1, obj)` runs before all of these (`:1858`), and
the object's weight comes off `load` last. In the Atari DM data `d.Word1074[2]` is 12, the
torch is weapon type 2, the Jewel Symal misc type 2 and the Illumulet misc type 3.
Evidence: `tools/dump-champion-death.ts` section 8 (5 of 56 checks fail before C30's fix).

## `AddCharacterPossession` lights only an unlit torch, and repacks nothing

`AddCharacterPossession(chIdx, object, place)` (`doc/CSBwin-src/Character.cpp:1936-2037`)
returns at once for `RNnul` and otherwise overwrites the slot: every caller has found it
empty first. After `AdjustStatsForItemCarried(pcA3, place, +1, object)` (`:1970`) it tests
`object.NameIndex()`, taken before any of these changes it:

- slot 1: `CHARFLAG_weaponAttack`, `TAG01b1c0()` if `d.AttackingCharacterOrdinal` is this
  champion (`:1976-1980`), and a scroll (`objNI_OpenScroll`-`objNI_Scroll`) gets
  `open(true)` (`:1981-1986`);
- slot 0 or 1, a torch named `objNI_Torch_a`: `litTorch(1)` (`:1988-1994`). An unlit torch
  always reads `_a`; a lit one reads `_a + d.Byte640[charges]` (`data.cpp:639-645`);
- slot 10, an Illumulet: `value(1)` and `d.Brightness += d.Word1074[2]` (`:2011-2019`); a
  Jewel Symal: `value(1)` (`:2022-2028`).

Unlike the removal it repacks no chest: a chest or scroll going into the open inventory's
weapon hand only marks `CHARFLAG_chestOrScroll` (`:1997-2004`). `AddCharacter` calls it for
each mirror object inside the slot-choice loop, as the slot is chosen (`:789`), and the
Hall of Champions' Cancel takes the champion back out without `RemoveCharacterPossession`
(`CSBCode.cpp:6629-6658`): a cancelled recruit's Illumulet leaves the party lit, and their
torch stays lit in the mirror's cell. ZED's mirror hands out a torch, which lands in his
weapon hand. Evidence: `tools/dump-item-bonuses.ts` section 5 (7 of 109 checks fail before
C34's fix).

## `AdjustStatsForItemCarried`: what a carried object does to its bearer

`AdjustStatsForItemCarried(pChar, possessionIndex, addOrRemove, item)`
(`doc/CSBwin-src/Character.cpp:1569-1780`) tests `item.NameIndex()` and the slot, first
match wins:

| Condition | Adjusts | By |
| --- | --- | --- |
| a *cursed* weapon or garment in slots 0-12 (misc objects are not tested) | Luck | -3 |
| a Rabbit's Foot in any slot below 30 | Luck | +10 |
| slot 1: the Mace of Order | Strength | +5 |
| slot 1: Staff of Claws (`_a`-`_c`) | MaxMana | +4 |
| slot 1: Staff, Wand, TeoWand, Yew Staff, Staff of Irra, Cross of Neta, Serpent Staff, Dragon Spit, Sceptre of Lyf | MaxMana | 2, 1, 6, 4, 10, 8, 16, 7, 5 |
| slot 1: Side Splitter, Dragon Fang, Vorpal Blade | MaxMana | 1, 2, 4 |
| slot 4 (legs): Powertowers | Strength | +10 |
| slot 2 (head): Crown of Nerra / Dexhelm | Wisdom / Dexterity | +10 |
| slot 3 (body): Flamebain / Cloak of Night | AntiFire / Dexterity | +12 / +8 |
| slot 10 (neck): Jewel Symal (`_a`-`_b`) / Cloak of Night / Moonstone | AntiMagic / Dexterity / MaxMana | +15 / +8 / +3 |

A curse is tested before everything else, so a cursed staff in the weapon hand gives -3
Luck and no mana. An attribute bonus moves its maximum, current and minimum alike
(`IncrMaximum` / `IncrCurrent` / `IncrMinimum`, unsigned bytes that wrap — four curses
take the Luck minimum of 10 to 254, which the getter reads as 0); MaxMana is set to
`MaxMana() + D4W` and the current mana is untouched. Callers: `AddCharacterPossession`
(`:1970`, `+1`), `RemoveCharacterPossession` (`:1858`, `-1`), and `SetCursed` (`:1801`,
`:1815`), which brackets the curse change. The bonus is baked in, so a save stores the
adjusted attributes. In the Atari DM object names five of these objects carry DM's names,
not the CSB identifiers': Staff of Irra is STAFF OF MANAR, Cross of Neta SNAKE STAFF,
Serpent Staff THE CONDUIT, Side Splitter DELTA, Dragon Fang THE INQUISITOR. In the Hall
of Champions TIGGY carries a Wand, CHANI a Moonstone, BORIS a Rabbit's Foot, GOTHMOG a
Cloak of Night and NABI a Staff. Evidence: `tools/dump-item-bonuses.ts`.

`SetCursed` (`doc/CSBwin-src/Character.cpp:1782-1816`), the DSA's `&CURSE!`, finds the
bearer with two nested loops, `ch` over `d.NumCharacter` and `loc` over 30 slots, and its
`break` leaves only the inner one. So `pCH` is the bearer, but `loc` is the slot found
only when the bearer is the last champion; for any other the later champions' loops run
it to 30, and both `AdjustStatsForItemCarried` calls pass slot 30, which matches no row
of the table above. A curse laid on the last champion's carried weapon or garment costs 3
Luck at once and lifting it gives them back. On another champion's the Luck does not
move, but `RemoveCharacterPossession` takes the curse off at the real slot (`:1858`), so
the object taken off gives 3 Luck that were never taken: a permanent gain. The port
passes the slot found for every champion (`DEBT.md` H). Evidence:
`tools/dump-dsa-objects.ts`.

## The disk menu saves an open chest packed

While a chest is open in the inventory its objects are in `d.rnChestContents` and out of
its chain: `ShowChestContents` clears their links and the chest's `contents`
(`doc/CSBwin-src/Character.cpp:3088-3101`). The disk menu's `TAG02076e`
(`SaveGame.cpp:860`) repacks it when `d.DisplayResurrectChestOrScroll == 4`
(`Character.cpp:5116-5125`), so the save writes the objects in the chest, and
`TAG0207cc` (`SaveGame.cpp:1274`) shows the inventory again, which opens the chest again
(`CSBCode.cpp:9952-9958`). `_ReadEntireGame` (`SaveGame.cpp:1435`) calls neither. The whole
pair is in `doc/CSBWIN_MENU_REFERENCE.md` → "Entering and leaving". Evidence:
`tools/dump-save-menu.ts`, "the disk menu over an open chest".

## `d.Word11722` is always zero

The main loop calls `TAG02076e(); TAG0207cc();` about every ten seconds while
`d.Word11722` is non-zero (`doc/CSBwin-src/CSBCode.cpp:766-774`), and never does.
`DBank::Initialize` zeroes the whole bank and sets `Word1870 = 1` (`CSBCode.cpp:328-331`).
The only live write of `d.Word11722` is `TAG00456c`'s `|= 1` (`:3059-3061`), behind
`if (d.Word1870 == 0)` (`:3055`), and nothing writes `d.Word1870` again: its other
mentions are reads (`:959`, `:3301`) and `Pointer2066[2]`, which nothing reads. The other
writes are inside comments (`:1932`, `Viewport.cpp:4608`). So the port has no
counterpart of the call.

## Changing the marching order: a champion in hand is a square turned cursor

Buttons 125-128 of `Buttons17196` are the four squares of the top view of positions, in
`d.wRectPos1454`'s order and counted from the party's facing, and they call `TAG0025a6`
with no guard (`doc/CSBwin-src/Mouse.cpp:1586-1597`, `CSBCode.cpp:2053`). With nobody in
hand (`d.Word23144 == 0`) it picks up `CharacterAtPosition((d.partyFacing + p) & 3)`, if
anyone: the square becomes the cursor and is filled with colour 0, and `d.Word23144 = p + 1`
(`:2061-2113`). `DrawCharacterState` leaves that square alone while `d.Word23144` names it
(`Character.cpp:1458-1461`). With a champion in hand, the next click puts them down facing
`d.partyFacing`, and the champion on the target square, if any, takes the square they left
(`CSBCode.cpp:2115-2151`).

The cursor is 21x16, drawn 9 pixels left of the pointer and 7 above it (`d.Word23156`,
`d.Word23158`, `:2308-2322`). `d.Pointer23178` is the square, with colour 0 transparent,
over its shadow two pixels down and right (`d.wRectPos23214`, `:449-452`) recoloured through
`d.Byte1382`, which maps every colour but 12 to 0. `d.Pointer23182` has the same shadow
under the square recoloured through `d.Byte1366`, which maps every colour but 12 to 4
(`:2069-2107`). `ShrinkBLT` of a buffer to itself at the same size only recolours it, colour
`c` becoming `pColorMap[c] / 10` (`Graphics.cpp:457-479`). With
`d.DynamicPaletteSwitching`, the cursor rows on screen row 29 and below come from
`d.Pointer23182` (`CSBCode.cpp:2325-2386`). `DynamicPaletteSwitching` follows
`MarkViewportUpdated`'s argument (`:908`, `:2903-2918`): 1 once the dungeon view is drawn
(`Viewport.cpp:7168-7169`), 0 once the inventory covers it (`Character.cpp:1511`).

Each VBL, a pointer left of x 274 or below y 28 lets go through `TAG002818`, which draws
`d.Pointer23178` back into the square (`CSBCode.cpp:938-945`, `:2155-2195`). The button -1
it records is for a replay only (`Mouse.cpp:1800-1805`).

`KillCharacter` and `RemoveCharacter` clear `d.Word23244`, a graphics reference count
(`Graphics.cpp:1770`), where the drag's word is `d.Word23144` (`Character.cpp:2653-2658`,
`:5299-5304`). So a champion who dies in hand stays in hand. Put down, they are
`CharacterAtPosition`'s -1, and `TAG0025a6` writes their facing and position to
`d.CH16482[-1]` (`CSBCode.cpp:2120-2122`, `:2147`). Evidence: `tools/dump-marching-order.ts`.

## An object in hand is a colour-4 silhouette over the dungeon view

`CreateObjectCursor` builds two 32x18 cursors from the object's icon
(`doc/CSBwin-src/CSBCode.cpp:1976-2027`). `d.Pointer23186` is the icon at `d.Byte23206`
(0-15) over its shadow at `d.Byte23202` (2-17), recoloured through `d.Byte1382` to colour 0
(`CSBCode.cpp:441-448`). `d.Pointer23190` has the same shadow under the icon's silhouette,
recoloured through `d.Byte1366` to colour 4. `CreateCursorBitmap` reaches the object cursor
only at `tag0029e0`, which is the viewport, and the portraits less the selected champion's
and the name strip (`y <= 6`). Everywhere else, from `y >= 169`, `x >= 274` or `x >= 224`
below the portraits, the cursor is the arrow, object in hand or not (`:2233-2252`). The
object cursor is drawn 8 pixels left of and 8 above the pointer (`d.Word23156`,
`d.Word23158`). With `d.DynamicPaletteSwitching`, the rows on screen row 29 and below come
from `d.Pointer23190` (`:2290-2308`, `:2319-2388`). So, over the dungeon view, an icon never
goes through the viewport palette. That palette is `Palette552[light]`
(`WinScreen.cpp:1493-1496`), whose colours 9 and 10 `ModifyPalettes` sets from the level's
monsters (`Code390e.cpp:323-343`, `CSBCode.cpp:2839`). Colour 4 is `066` at every light
level. The port shows the icon itself there by default, an extra recorded in `DEBT.md` H.
Evidence: `tools/dump-object-cursor.ts`.

## A load keeps the message area

CSBWin saves no message state: `SCROLLING_TEXT::Serialize` is declared
(`doc/CSBwin-src/Data.h:1665`) and has no body and no caller. `LoadGame` keeps the rows on
screen and rebases their timeouts onto the loaded clock with
`scrollingText.ResetTime(b.gb2.Time)`, just before `d.Time = b.gb2.Time`
(`SaveGame.cpp:1623-1624`, `ResetTime` at `CSBCode.cpp:1564`). The port does the same in
`applyRuntimeSaveState`, which every load reaches. A load over a sleeping party (the port's
in-game load; CSBWin loads only when a game starts) also shrinks the rows back, as the next
tick's `SetNewSpeed(0, 15)` would (`CSBCode.cpp:612-616`). Evidence: `tools/dump-sleep.ts`.

## The message area: one entry a pass, a scanline a VBL

- **The order in a VBL.** `checkVBL` runs `vblInterrupt` and then hands the main loop its
  `UIM_VBL` (`doc/CSBwin-src/system.cpp:624-630`, dispatched at `CSBUI.cpp:1253-1272`).
  The loop's pass runs `HandleMouseEvents`, the tick when `d.clockTick` is set, and then
  takes one `printQueue` entry at `tag0007c8` (`CSBCode.cpp:714-721`). Frozen, the pass
  skips the tick and still takes the entry (`:765`). The disk menu holds the loop in
  `DisplayDiskMenu` (`:762`), so no entry is taken while it is open.
- **The scroll.** `ScrollUp` sets `d.PushTextUp = 1` and `d.TextScanlineScrollCount = 0`
  (`:1583-1596`); the count starts the game at -1 (`:352`). Each VBL moves the strip up a
  scanline and blanks the bottom `count` scanlines, until the count reaches 7 and turns
  to -1; the next VBL clears `d.PushTextUp` (`:971-1004`). Until then `ClockTick` places
  nothing (`:1526-1527`) and `RemoveTimedOutText` removes nothing (`:1505-1508`).
- **Who places a piece a scroll held back.** `ClockTick`'s only callers are the tick
  (`:677`), the end of `PrintLines` (`:1736`) and `_ProcessTimersViewportAndSound`
  (`Attack.cpp:2211`). With the print queue empty, the piece waits for the next tick.
- **`DiscardText`** stops the scroll, drops the pieces waiting and blanks the strip, and
  leaves the print queue, `d.TextTimeout` and `d.PrintColumn` alone (`CSBCode.cpp:1441-1464`).

The port: `Game.runFrame` and `ScrollingText` (`doc/CSBWIN_MESSAGES_REFERENCE.md` → "The
port"). Evidence: `tools/dump-messages.ts`.

## The button flash: one VBL inverts plane 2, the next puts it back

`_FlashButton(x1, x2, y1, y2)` (`doc/CSBwin-src/CSBCode.cpp:7713-7730`) waits out a pending
flash, stores the rectangle in `d.FlashButnX1`…`Y2`, sets `d.FlashButnActive` and waits a
VBL. The VBL handler clears `d.FlashButnActive`, toggles `d.Word11776` and calls
`vblFlashButn` (`:1028-1038`), which flips the word at `+4` of every 16-pixel group from
`x1` to `x2` on rows `y1` to `y2`, corners included (`VBL.cpp:60-122`): bit plane 2, which
`UnpackScreen` makes bit 2 of the pixel's index (`WinScreen.cpp:314-330`), so a flashed
pixel is `index ^ 4`. `WaitForButtonFlash` (`CSBCode.cpp:8561-8601`) waits out a pending
flash, then, while `d.Word11776` is set, sets `d.FlashButnActive` and waits a VBL, which
inverts the rectangle back. The main loop calls it at `tag000730`, after the tick's
`DrawViewport` (`:638`, `:655`), and after the mouse queue on a pass whose `d.clockTick` is 0
(`:763`); `CastMagic` (`Magic.cpp:939`), `TAG02076e` (`Character.cpp:5113`) and
`_FusionSequence` (`Attack.cpp:2273`) call it too. The game start clears both words
(`CSBCode.cpp:10477-10478`).

The movement arrows: `_TurnParty` flashes `(0xea, 0x105, 0x7d, 0x91)` for a turn left and
`(0x123, 0x13e, 0x7d, 0x91)` for a turn right (`CSBCode.cpp:7896-7903`), after the
party-move filter and before the stairs. `MoveParty` returns `&d.MoveButn18496[button - 3]`
(`:8137-8139`), which `HandleMouseEvents` flashes (`Mouse.cpp:1556-1567`). It sets that
result before the wall and monster tests, so a step they refuse, which brings no tick
(`CSBCode.cpp:8310-8314`), flashes as well; only the filter's refusal (`:8120`) returns
`NULL`. In `dm-atari/graphics.dat`, `d.MoveButn18496` is forward `(263-289, 125-145)`, right
`(291-318, 147-167)`, backward `(263-289, 147-167)` and left `(234-261, 147-167)`.
`tools/dump-button-flash.ts` checks the flash of all six arrows, the spell panel and the
attack menu.

The spell panel: `_MagicSelection` (`doc/CSBwin-src/Magic.cpp:545-581`) is `RESTARTABLE`.
The cast (button 108, only with a first rune) flashes `(0xea, 0x12f, 0x3f, 0x49)` and calls
`CastMagic`, whose first act is `WaitForButtonFlash`: one VBL inverted, and the cast after
the put-back. A rune or the take-back (101-107) flashes `d.Word18552[4 * (button - 101)]`,
then `wvbl(_3_)`, then `WaitForButtonFlash`, and only then `TAG01b990` or
`BackspaceMagicSelection`: two VBLs inverted, and the keypad still shows the pressed rune.
In `dm-atari/graphics.dat`, `d.Word18552`, read between `Word18560` and `d.MoveButn18496`
in graphic `0x231`, is exactly the click rectangles of buttons 101-107 in the magic
panel's button list, and the cast's literal rectangle is button 108's.

The attack menu: with a menu open, `_TAG019fac` (`doc/CSBwin-src/Character.cpp:4677-4717`)
flashes PASS (button 112) at `(0x11d, 0x13f, 0x4d, 0x53)` and the options (113-115) at
`(0xea, 0x13e, 0x56, 0x60)`, `(…, 0x62, 0x6c)` and `(…, 0x6e, 0x78)`, each before its
`ExecuteAttack`, and an option offered past `d.Word20248` flashes nothing. Nothing after the
flash waits but the fusion's own `WaitForButtonFlash` (`Attack.cpp:2273`): a blow that
lands sets `d.clockTick`, so the tick draws the option inverted and the next VBL puts it
back; a PASS, or a blow that returns 0, brings no tick, and the pass's wait (`CSBCode.cpp:763`)
puts it back. In `dm-atari/graphics.dat`, `d.Buttons17892` holds the options' flash
rectangles exactly as click rectangles, and PASS's as `(285-318, 77-83)`, a column short of
its flash. CSBWin flashes nothing on a blow itself: an attack's one light change is
`atk_LIGHT` (`Attack.cpp:2077`). `_InvertButton` serves only `Chaos.cpp`'s
`_UtilityDialogBox` and `_TAG004518`, not the game's screens.

## PASS reads `d.PossibleAttackTypes[-1]`, which is always 0

`_ExecuteAttack(-1)` tests `(UI8)(d.PossibleAttackTypes[P1]) == 255` before it looks at
`P1` (`doc/CSBwin-src/Character.cpp:4955-4959`), so a PASS reads the byte before the array.
That is a byte of `d.unused20262` (`Data.h:621-622`), which nothing in the tree writes, so
it is 0 and the PASS goes through to `TAG01b1c0`. The port skips the test for -1
(`executeAttack`, `src/renderer/ui/Attack.ts`), with the same result.

## The cursor is drawn by the VBL handler, and by nothing else

`checkVBL` reads the pointer with `UI_GetCursorPos`, and when it is on the 320x200 screen
writes it to `d.NewMouseX`/`d.NewMouseY` and `d.CurMouseX`/`d.CurMouseY`, and sets
`d.Word23130` if `d.Word23134` is set (`doc/CSBwin-src/system.cpp:596-616`). It draws
nothing. The VBL handler, on `d.Word23130`, clears it, sets `d.Word23132` and calls
`CreateCursorBitmap` (`CSBCode.cpp:1044-1052`), which takes `d.NewCursorX`/`d.NewCursorY`
from `d.CurMouseX`/`d.CurMouseY` (`:2228-2233`). A VBL that finds `d.Word23132` set passes
it to `TAG000bb0`, which takes the cursor off the screen (`:947-948`, `:957`, `:863`,
`:887-889`), and then calls `DrawCursor` (`:1040-1043`), which draws at
`d.NewCursorX`/`d.NewCursorY` and makes them `d.CurCursorX`/`d.CurCursorY` (`:2407-2413`).
`DrawCursor` has two callers, both in the VBL handler (`:968`, `:1042`).

So the cursor moves once a VBL at most. The port's `GameInput.mouseMove` records the
pointer and draws nothing, and the page's frame, a VBL's, composes the screen when the
pointer has moved (`GameScreen.takeCursorMoved`, `wire` in `src/main.ts`).
`tools/probe-frames.mjs` checks that fifty moves between two VBLs paint nothing
themselves, and that the next VBL's frame has the cursor where the pointer last was.

## The key tables: CSBWin's own keys

- **What a key is.** `UIM_KEYDOWN` turns a PC key into an Atari key through `config.txt`'s
  `SCAN` lines (`keyxlate.translate(…, TYPESCAN)`, `doc/CSBwin-src/CSBUI.cpp:1120-1139`);
  CSBWin has no built-in map. `TAG0196da` then compares the ASCII code, or, for a key with
  none, the scancode moved to the high byte (`if ((key&0xffff) == 0) key >>= 8`,
  `CSBCode.cpp:8438`).
- **The adventure tables** (`d.pKeyXlate2 = Byte18400`, `d.pKeyXlate1 = Byte18428`,
  `CSBCode.cpp:7058-7059`, `:10489-10490`), as graphics.dat `0x231` holds them.
  `Byte18400`: F1-F4 (`0x3b00`-`0x3e00`) are buttons 7-10, the four inventories; Ctrl-S
  (`0x13`) is 140, the disk menu; Esc (`0x1b`) is 147, the freeze. `Byte18428`: Insert
  (`0x5200`) is 1 and Clr/Home (`0x4700`) 2, the turns; up (`0x4800`) is 3, right
  (`0x4d00`) 4, down (`0x5000`) 5, left (`0x4b00`) 6 — so the left and right arrows strafe.
- **Every match is written.** `TAG0196da` stops at the first `pKeyXlate2` match, but goes
  on through `pKeyXlate1`, writing each match one queue slot further back and moving
  `d.MouseQEnd` with it (`CSBCode.cpp:8446-8475`): a key bound twice would leave only the
  last match queued, over the entry before it. No keyscan appears twice in any mode's
  pair of tables.

The port: `keyScanOf` and `translateKey` (`src/renderer/ui/Keyboard.ts`), queued by
`GameInput.keyDown` (`src/renderer/GameInput.ts`) before the port's own bindings, except F1-F4, which select the caster
(`DEBT.md` H). Evidence: `tools/dump-key-bindings.ts`.

## The freeze: button 147 in, button 148 out, no tick in between

- **The keys and buttons.** `TAG0196da` turns a key into a button through `d.pKeyXlate2`,
  then `d.pKeyXlate1` (`doc/CSBwin-src/CSBCode.cpp:8428-8475`), `KeyXlate` pairs
  `{mouse, keyscan}` ending at `mouse == 0` (`CSB.h:1379-1383`), read from graphics.dat
  `0x231`. Esc (`0x1b`) is 147 in the adventure table `Byte18400` and in the sleep table
  `Byte18440`, and 148 in the frozen table `Byte18448`, which holds nothing else. Button
  147 is also a left click on the single pixel x 0, y 198 of the adventure list
  `Buttons17196`: its rectangle is x 0-1, y 198-199, and `SearchButtonList` excludes the
  upper bounds (`CSBCode.cpp:7561-7564`). `Buttons17832`, the frozen list, is button 148
  over the whole screen for either mouse button.
- **Button 147** (`Mouse.cpp:1731-1759`), after the pressed-eye and pressed-mouth returns
  (`:1679-1680`) and with no other guard: `d.ClockRunning = 0`, `gameFrozen = true`,
  `TAG02076e()`, the viewport flooded with 0 and `TextOut_OneLine(d.pViewportBMP, 112, 81,
  69, 4, 0, "GAME FROZEN", …)`, `MarkViewportUpdated(2)` (which keeps the palette mode in
  force, `CSBCode.cpp:2906-2908`), the button lists and key tables saved (`:1748-1751`) and
  replaced by `Buttons17832` / NULL and `Byte18448` / NULL, `DiscardAllInput()`. The
  inventory is drawn into the viewport bitmap (`TAG022a60(17, d.pViewportBMP)`,
  `CSBCode.cpp:7493`), so the flood covers an open inventory too.
- **While frozen**, the main loop runs no tick: `if (d.ClockRunning == 0) goto tag0007b4;`
  (`CSBCode.cpp:765`) leaves a due tick due. `HandleMouseEvents` throws away every entry but
  148, one per call, without stamping `lastTime` (`Mouse.cpp:1433-1444`), and exempts 148
  from the one-entry-per-tick limit (`thawCommand`, `:1463-1476`), since no tick can come.
  A viewport click (button 80) also tests `d.ClockRunning` (`:1667`), which the filter
  makes unreachable outside a recording's playback.
- **Button 148** (`:1760-1773`): `d.ClockRunning = 1`, `gameFrozen = false`, `TAG0207cc()`,
  the saved lists and key tables back (`:1766-1769`), `DiscardAllInput()`. The tick that
  fell due while frozen runs in the same pass.
- **Asleep**, `TAG02076e` returns at once (`Character.cpp:5111`) and `TAG0207cc` only
  redraws the sleep screen (`CSBCode.cpp:9938-9942`), so a freeze from the sleep screen
  thaws back to "WAKE UP" and the sleep lists.
- `d.ClockRunning` and `gameFrozen` are not saved; the game start sets `d.ClockRunning = 1`
  (`CSBCode.cpp:10549`).

The port: `handleMouseButton` (`src/renderer/ui/Mouse.ts`) and `freeze` / `thaw`
(`src/engine/LoopState.ts`), the key tables in `UITables`' `graphic231.keys`. Evidence:
`tools/dump-freeze.ts`.

## Sleep: button 145 in, button 146 or a blow out, a tick every VBL in between

The sleep icon is button 145 in the inventory list `buttons17760` (x 188-204, y 36-44,
left button), so it is only clickable with an inventory open. Its handler
(`doc/CSBwin-src/Mouse.cpp:1683-1708`), unless `d.PotentialCharacterOrdinal` is set:
`ShowHideInventory(4)` if one is open, `TAG02076e()` (shade the movement arrows, magic
and weapon-ready areas), `d.PartySleeping = 1`, `DisplaySleepScreen()`, `d.Speed = 0`,
`PrimaryButtonList = Buttons17796`, `SecondaryButtonList = NULL`,
`pKeyXlate2 = Byte18440`, `pKeyXlate1 = NULL`, `DiscardAllInput()`.

- `d.Speed = 0` makes `vblCount >= d.Speed` true on every VBL (`CSBCode.cpp:1066-1077`):
  one game tick per VBL, instead of one per `speedTable[gameSpeed].vblPerTick` (15 at
  normal speed, `CSBwin.cpp:180`). The top of the tick restores `d.Speed` only while
  awake (`CSBCode.cpp:612-616`).
- `Buttons17796` (graphics.dat `0x231`) is two entries, both button 146 over the viewport
  x 0-223, y 33-168, mouse masks 2 and 1. `Byte18440` is two `KeyXlate`s: `{146, 0x0d}`
  (Return) and `{147, 0x1b}` (Esc, the freeze). `Byte18448`, the frozen game's table, is
  `{148, 0x1b}`.
- `DisplaySleepScreen` (`CSBCode.cpp:8542`) floods the viewport with 0 and writes
  "WAKE UP" in colour 4 at viewport (93, 65). `TextOut_OneLine` starts at row `y - 4`
  (`Graphics.cpp:320`), so the glyphs occupy rows 61-65. The main loop skips
  `DrawViewport` while asleep (`CSBCode.cpp:637`).
- `WakeUp` (`CSBCode.cpp:7047`): `d.clockTick = 1`, `d.PartySleeping = 0`, the speed back,
  `FloorAndCeilingOnly()`, the adventure lists `Buttons17196` / `Buttons17304` and key
  tables back, `DiscardAllInput()`, `TAG0207cc()`. It is called by button 146, by
  `MonsterDamagesCharacter` before its dodge test (`Monster.cpp:4531`), and by
  `DamageCharacter` after the wound roll on the `P4 != 0` branch only
  (`Character.cpp:2809-2812`). `d.clockTick = 1` makes the tick run in the same pass.
  When the wake-up comes from inside a tick, the tick's own `d.clockTick = 0`
  (`CSBCode.cpp:704`) cancels it.
- `d.PartySleeping` is not saved. `d.PartySleeping = 0` is set at game start
  (`CSBCode.cpp:10479`).
- Falling asleep calls `scrollingText.SetNewSpeed(d.Speed, 0)` (`Mouse.cpp:1696`) and
  `WakeUp` calls `SetNewSpeed(d.Speed, 15)` (`CSBCode.cpp:7053`), so the message rows on
  screen last sixteen times as many ticks asleep, and waking divides what is left by 16,
  rounding up. The formula is in `doc/CSBWIN_MESSAGES_REFERENCE.md` → "Timeouts". Evidence:
  `tools/dump-sleep.ts`.
- Asleep, `DetermineMastery` returns 1 for every skill (`Code17818.cpp:29-36`). So
  `TenSecondUpdate`'s mana roll is `random112 < Wisdom + 2`, and each point of mana costs
  `max(7, 16 - 2)` = 14 stamina, whatever the champion's Wizard and Priest levels
  (`:215-240`).

Evidence: `tools/dump-sleep.ts`.

## An empty-handed viewport click tests the objects before the front wall

`HandleClickInViewport`, empty-handed (`doc/CSBwin-src/Mouse.cpp:1097-1158`), after the
door-switch test at `:1053-1095`, loops `D5W` over `ViewportObjectButtons[0..5]` and acts
on the **first** rectangle hit, then returns (`:1099-1136`):

- `D5W` 0-4 are the objects drawn in the cell under the party and the cell ahead.
  `TAG01a148(D5W)` picks the object up (`:1132`).
- `D5W` 5 is the front wall's F1 decoration. Only two places set it: the decoration
  drawer (`CSBCode.cpp:3299`) and the door button (`:4081`). A side wall's decoration
  never sets it, and neither does wall text, which returns before `:3299`. On button 5,
  `TouchWallF1()` runs only `if (d.FacingAlcove == 0)` (`Mouse.cpp:1123-1128`). So a
  click on an alcove's wall touches nothing.
- An alcove's objects are drawn inside its decoration, so button 4 lies within
  button 5. Testing the objects first is what lets the player take an object out of an
  alcove.
- If no button is hit, and the party is not facing an alcove, `d.CellTypeJustAhead` is
  0, and the cell ahead is stone or a false wall with `(cf & 5) == 0`, then a click with
  33 ≤ x ≤ 189 and 44 ≤ y ≤ 150 plays sound 4 at the party, with no delay
  (`QueueSound(4, d.partyX, d.partyY, 0)`, `:1138-1157`). Ordinal 4 is SND item 536.
- The two stone tests differ. `d.CellTypeJustAhead` is `roomData[17].roomType`
  (`Viewport.cpp:6782-6785`), and `SummarizeRoomInfo` makes a false wall stone whenever
  it is not open, `(cf & 4) == 0` (`Codea59a.cpp:278-279`). `(cf & 5) == 0` also wants it
  not imaginary. So a closed imaginary false wall (level 2, (7,9), `cf` 0xc1, in the
  shipped dungeon) has `d.CellTypeJustAhead == 0` and is silent.
- With an object in hand, the click tests `d.CellTypeJustAhead == 0` alone (`:1165`).
  Then only the two near drop areas and button 5 answer (`:1167-1180`), with no throw.
  So before that closed imaginary false wall a click in the throw area does nothing.

Evidence: `tools/dump-viewport-click.ts`.

## A busy champion is `CHARFLAG_attackDisable`, and one function each sets and clears it

- `CHARFLAG_attackDisable` is bit 0x0008 of `CHARDESC.charFlags` (`doc/CSBwin-src/CSB.h:2460`),
  inside `CHARFLAG_nonGraphicFlags` (0x007f, `:2459`). `DrawCharacterState` ends with
  `charFlags &= CHARFLAG_nonGraphicFlags` (`Character.cpp:1514`), which keeps it, and a save
  carries it with the rest of `charFlags`.
- Four places in the tree touch it. `DisableCharacterAction` sets it, with
  `CHARFLAG_weaponAttack`, only when the champion has no busy timer, `busyTimer < 0`
  (`Magic.cpp:528-531`). `EnableCharacterAction`, the `TT_11`, clears it unconditionally,
  after `busyTimer = -1` (`Timer.cpp:2645-2646`). `DrawAttackButton` shades the hand while it,
  `d.PotentialCharacterOrdinal` or `d.PartySleeping` is set (`Character.cpp:4875-4880`), and
  `PrepareAttack` opens no menu while it is set (`:4916`), by key or by a click on the hand
  (evidence: `tools/dump-key-bindings.ts`).
- A champion busied again while busy keeps the bit, and the busy timer is replaced: with
  `D7 = d.Time + delay` and the old timer due at `D6`, the new one is due at
  `D7 + ((D6 - d.Time) >> 1)` if `D7 >= D6`, else at `D6 + delay / 2` (`Magic.cpp:514-527`).
  `DisableCharacterAction` has no guard on the delay (`Magic.cpp:502-537`): 0 ticks busies
  an idle champion with a `TT_11` due at `d.Time`, and replaces a busy one's timer with one
  due when the old one was. Every replacement's `timerUByte6`, the slot a throw refills, is
  0 (`:512`). The callers guard it themselves: an attack disables only for a non-zero time
  (`Attack.cpp:2149-2152`). Evidence: `tools/dump-throwing.ts` section 9.
- IAIDO is saved busy in `csbgame-flying-sword.dat`: `charFlags` 0x0018,
  with a `TT_11` as his `busyTimer`.
- `_ExecuteAttack` records the attack in `attackType` after running it
  (`Character.cpp:4974`), and `EnableCharacterAction` forgets it, ending with
  `attackType = -1` (`Timer.cpp:2680`). In between, it zeroes `word64` only while an attack
  is recorded (`:2647-2653`), and reloads the bow from slot 12, then 7-9, only while that
  attack is `atk_SHOOT`, hand 0 is empty and the champion is alive (`:2654-2673`). So the
  `TT_11` of a spell cast after a shot reloads nothing.
- No champion has two `TT_11`s queued: `DisableCharacterAction`, the only place that
  queues one, deletes the champion's busy timer first (`Magic.cpp:513-525`), and nothing
  else deletes it. So the `TT_11` that fires is always the champion's `busyTimer`.

Evidence: `tools/dump-save-roundtrip.ts`, section 5, and `tools/dump-throwing.ts`,
section 8.

## CSBWin's timer queue is a binary heap

- `m_timerQueue` holds `m_numTimer` indices into `m_timers`, as a min-heap over
  `TIMER::operator<` (`doc/CSBwin-src/Timer.cpp:765-810`): the earlier time, then a
  parameter message before anything else, then the higher function code, then the higher
  `timerUByte5` (the lower, between two parameter messages), then the lower sequence stamp.
- `SetTimer` appends the new index and calls `AdjustTimerQueue` on it (`:1200-1202`).
  `AdjustTimerQueue(i)` (`:831-896`) moves the entry up while it is less than its parent,
  `(i - 1) >> 1`, and only if it did not move, down toward the lesser of its children
  `2i + 1` and `2i + 2`.
- `GetNextTimerEntry` takes `m_timerQueue[0]` and deletes it (`:1222-1235`). `DeleteTimer`
  moves the last entry into the vacated position and calls `AdjustTimerQueue` there
  (`:959-984`).
- `LoadGame` unscrambles the array into place and never reorders it (`SaveGame.cpp:1693-1699`),
  so a save's block 6 is the heap as it stood. Every committed save's queue is heap-ordered
  by time, and none with more than two timers is sorted: 33 of `csbgame7.dat`'s 76 entries
  follow a later one.
- Two timers equal on all of that are ordered by their slots: `operator<` ends with
  `if (&timer2 >= this) return true;` (`Timer.cpp:790`, `:807`), so a timer is less than
  itself.
- `TIMER_SEARCH::AdjustTimerPriority` is `AdjustTimerQueue` at the timer's queue position
  (`:913-916`), for a timer whose key its caller changed in place.
- A search that deletes or re-sorts as it walks leaves an array that depends on the order
  of the walk, which is `TIMER_SEARCH`'s, from the heap's last array entry (see
  "`TIMER_SEARCH` walks the queue backwards"): `DeleteMonsterMovementTimers`
  (`Monster.cpp:1297-1330`), `CurePoison` (`Character.cpp:3007-3031`), `DamageMonster`'s
  renumbering, which deletes and re-sorts in one walk (`Code11f52.cpp:1148-1196`), and
  `SetTimer`'s `TT_BASH_DOOR` rule (`Timer.cpp:1102-1123`).

`TimerQueue` keeps the same heap, with `timerLess` for `operator<`, and a save writes its
array. Evidence: `tools/dump-timer-heap.ts`. Every committed save's queue is a heap under
`timerLess`, and each of three comparators with one rule broken fails on some save;
`csbgame7.dat`'s queue drains in `timerLess` order; hand-worked arrays after each insertion
and deletion; and a loaded game runs every timer due by its first tick,
`csbgame-flying-sword.dat`'s IAIDO `TT_11` among them.


## A lost game ends on the tick of death, with the palette switching off

`KillCharacter` sets `d.GameIsLost` when no champion is left
(`doc/CSBwin-src/Character.cpp:2680`). The tick that follows, or the one it happens in, runs
its timers as usual; then `if (d.GameIsLost == 0)` (`doc/CSBwin-src/CSBCode.cpp:658`) guards
everything from `d.Time++` to the mouse queue, and `MainLoop` returns (`:777-778`) without
`d.Time` moving on. `_StartCSB` sets `d.DynamicPaletteSwitching = 0` and calls
`ShowCredits(_3_, d.GameIsLost)` (`:11322-11326`). Nothing turns the switching back on:
the VBL restores it from `d.Word11740` only while `d.ViewportUpdated` is set (`:906-909`),
and `MarkViewportUpdated` consumes that flag at once by calling `vblInterrupt()` itself
(`:2916-2917`, `:1006-1010`). So `_ShowCredits` takes its fade to black, not the `Darken`
steps (`doc/CSBwin-src/Code1f9e6.cpp:148-170`), from `globalPalette`, which the VBL kept
equal to `d.Palette11978` (`doc/CSBwin-src/WinScreen.cpp:1493-1498`). The rest of the
screen is in `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` → "The end of the game";
`tools/dump-show-credits.ts` checks both halves.


## "RESTART THIS GAME" clears `d` before the chooser, so any save loads after it

The button `0xd7` on the end screen is the only writer of `d.PartyHasDied = 1`
(`doc/CSBwin-src/Mouse.cpp:1798`). Pressed, `_ShowCredits` runs `Cleanup(false)` and
`d.Initialize()` (`doc/CSBwin-src/Code1f9e6.cpp:302`, `:309`) before `GameSetup(_25_, 0)`
(`:310`), and `DBank::Initialize` begins with `memset(this, 0, sizeof(*this))`
(`doc/CSBwin-src/CSBCode.cpp:329`). `d.PartyHasDied`, `d.RandomGameID` and
`d.CanRestartFromSavegame` are all members of `DBank` (`doc/CSBwin-src/Data.h:606-614`), and
so is `d.gameState`. So the chooser `GameSetup` opens reads with `d.PartyHasDied` 0, and its
"THAT'S NOT THE SAME GAME" test, taken only while that flag is set
(`doc/CSBwin-src/SaveGame.cpp:1604-1606`), never runs: every save loads after a restart.
The same zeroed `d.gameState` is `GAMESTATE_ResumeSavedGame`, which is why the chooser, not
the entrance, comes first. `tools/dump-show-credits.ts` checks the button, and
`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` → "The end of the game" has the rest of the screen.

## A restart empties the message strip, and keeps `printQueue`

Between "RESTART THIS GAME" and the next `MainLoop`, `Cleanup(false)`'s
`scrollingText.Cleanup()` frees the pieces waiting (`doc/CSBwin-src/data.cpp:2015`,
`doc/CSBwin-src/Graphics.cpp:2207`, `doc/CSBwin-src/CSBCode.cpp:1434-1439`), `d.Initialize()`
zeroes the print position, `d.PushTextUp` and `d.PartySleeping` and sets
`d.TextScanlineScrollCount = -1` (`CSBCode.cpp:329`, `:352`), `TAG001c6e` sets the four
`d.TextTimeout` to -1 (`:1773-1779`), and `TAG021028` blanks the strip, or the whole screen
(`:10536`, `:10543`). `printQueue` is a global (`:200`) whose only reader is the main loop
(`:716`), so an entry queued before the death is printed in the new game's first pass.
`doc/CSBWIN_MESSAGES_REFERENCE.md` → "Persistence" has the detail;
`tools/dump-messages.ts` checks `ScrollingText.restart`.

## A won game without palette switching fades up to black

`_ShowCredits`' `LOCAL_78` is a `static PALETTE` (`doc/CSBwin-src/Code1f9e6.cpp:76`), and its
only writer is the `d.DynamicPaletteSwitching` branch, which saves `d.Palette11978` in it
(`:150`). The won screen always ends in `FadeToPalette(&LOCAL_78)` (`:218`), so a win reached
with switching off — an inventory open — fades the champions up to sixteen zeros, black,
and stays there (`RepeatGame` false, `:219-222`). The glyphs `DisplayHeroName` prints with
(`:39-57`, `A`-`Z` minus 0x40) are font 0x22d's codes 1-26, which differ from its `A`-`Z`.
`tools/dump-show-credits.ts` checks both.

## The CSB win ends the tick where it happens, and 300 VBLs later the game

An actuator of type 18 under a stone-room timer wins the game at any position: the arm is
the `else` of `if (type in 7-10, 14, 15 && position == timer's)`
(`doc/CSBwin-src/Timer.cpp:2355-2372`). It sets `d.CanRestartFromSavegame = 0` and
`d.Word11694 = 1` and returns true before `RotateActuatorList` (`:2382`); `ProcessTimers`
returns true at once, leaving the timers behind it queued (`doc/CSBwin-src/CSBCode.cpp:6459-6464`),
and `MainLoop` runs `VBLDelay(_1_, 300)` and `ShowCredits(_2_, 1)` (`:627-633`), which does
not return. `tools/dump-show-credits.ts` checks it.

## A `RESTARTABLE` sequence holds the main loop, and `_ProcessTimersViewportAndSound` is its tick

`_VBLDelay(n)` is `n` calls of `wvbl` (`doc/CSBwin-src/CSBCode.cpp:1137-1147`): `n` VBLs go
by, `VBLDelay(0)` waits for none, and while a sequence called from the loop waits, the loop
makes no pass (no `HandleMouseEvents`, no tick, no print-queue entry). `_FusionSequence`
waits `if (testdelay) VBLDelay(MS2VBL(testdelay))` again and again, with `testdelay = 500`
and `MS2VBL(ms) = ms/16` (`Attack.cpp:17-19`): 31 VBLs.
Its tick is `_ProcessTimersViewportAndSound` (`Attack.cpp:2192-2213`), which only
`_FusionSequence` calls: `ProcessTimers()`, and on a win `VBLDelay(300)` and
`ShowCredits(1)`, which does not return (`:2199-2204`); then `DrawViewport`, `display`,
`StartQueuedSound`, `d.Time++` after the timers, the overlay's timeout,
`parameterMessageSequence = 0` and `scrollingText.ClockTick()`. Nothing else of the main
loop's tick: no periodic update, no timer countdown.
When the sequence returns, the pass that called it goes on where it stopped, in that VBL.
`_MagicSelection` is reached through `HandleMouseEvents`' button 100, which stamps
`lastTime` and returns `result`, 0 (`Mouse.cpp:1369`, `:1633-1641`), so
`while (intResult & 1)` takes no further entry, and `if (d.clockTick == 0)` and the tick
follow (`CSBCode.cpp:747-765`): the tick that `d.clockTick = CastMagic(0)` (`Magic.cpp:564`)
makes due, or one the VBL count made due during a rune's flash, runs in the VBL the
sequence returns, and the entry queued behind the click is taken in the next.
The port: `LoopScript`, `Game.runScript` and `Game.processTimersViewportAndSound`;
`Game.runFrame` finishes the held pass in the VBL the script ends.
Evidence: `tools/dump-loop-script.ts`, and `tools/dump-mouse-queue.ts` for the cast and the rune.

## The fusion: a dispell cloud, then Lord Chaos's escape

`_Fusion` (`doc/CSBwin-src/Attack.cpp:133`) runs the `NewFusion` branch: `#define NewFusion`
sits right above its `#ifdef` (`:161-162`), so the `OldFusion` code (`:214-257`) is dead.
In order:

- A square off the loaded level returns before anything (`:150-157`). Otherwise a dispell
  cloud, `CreateCloud(RNDispellMissile, 0xff, x, y, x, y, 0xff)`, lands on it (`:158`),
  Lord Chaos or not; without him `_Fusion` returns there (`:159-160`).
- The four directions, north, east, south, west, are shuffled: for `i` from 3 down to 1,
  swap `direction[i]` with `direction[STRandom(i+1)]` (`:163-171`).
- For each direction, CSBWin notes whether the square next to him is a Fluxcage or a wall
  (`IsCellWall`: stone or false wall, `:106-111`); whether it is open or a pit
  (`IsCellOpenOrPit`, `:113-118`) and unoccupied (`IsCellOccupied`: a monster, or the
  party, `:120-127`); and whether the square two away is on the map (`legalXY`, `:99-104`),
  open or a pit, unoccupied, and not a Fluxcage (`:172-186`).
- He moves to the first square next to him, in shuffled order, that is free and neither a
  Fluxcage nor a wall (`:187-199`); failing that, to the first square two away whose near
  square is neither a Fluxcage nor a wall (`:200-212`). The near square may be occupied,
  so he can jump over the party or another monster. A `MoveObject` that returns 0 starts
  his movement timers where he lands (`StartMonsterMovementTimers`) and ends `_Fusion`;
  one that does not tries the next square.
- With nowhere to go, "Sorry, Mr. Chaos. You are toast." (`:213`): `FusionSequence(_3_)`
  (`:259`).

The port: `AttackSystem.fusion`. Evidence: `tools/dump-fusion.ts`.

## `_FusionSequence`: the end of the game

`_FusionSequence` (`doc/CSBwin-src/Attack.cpp:2220`) is called only from `_Fusion` with
Lord Chaos boxed in (`:259`), and `Fusion(_8_, …)` in `_Attack` (`:1971`) and
`Attack(_1_, …)` in `_ExecuteAttack` (`Character.cpp:4972`) never return from it: nothing
after them runs. So `TAG01b1c0` leaves the attack menu on the panel to the end, `_TAG019fac`
does not set `d.clockTick` (`Character.cpp:4717`), and `HandleMouseEvents` does not stamp
`lastTime = d.Time` (`Mouse.cpp:1647-1649`). Meanwhile the pass waits in `wvbl`
(`system.cpp:639-661`) and the UI only queues: a click goes into the mouse queue, a key
into the key queue or through `OnMouseSwitchAction` into the same mouse queue
(`CSBUI.cpp:1120-1164`, `:1185-1222`), and no pass takes either before the credits.
In order:

- `d.Word11694 = 1`; the inventory hidden if open; `WaitForButtonFlash`; `d.Brightness =
  200` and `SelectPaletteForLightLevel`; the party, spell and fire shields all 100;
  `MarkAllPortraitsChanged` (`:2268-2279`).
- The monster on the square in front: `hitPoints6[0] = 10000`, position byte 255, and
  facing byte `(d.partyFacing + 2) & 3` (`:2281-2287`). With an `ITEM16` that is the raw
  value, not the byte's four copies (`SetMonsterFacingByte`, `Code11f52.cpp:237-252`).
- Every Fluxcage on the party's square, then on his, removed, one per scan from the
  square's first drawable object (`:2288-2302`).
- Six fireballs on his square, sizes 55 to 255 by 40, each shown and followed by
  `VBLDelay(MS2VBL(500))`, 31 VBLs (`:2305-2313`); sound 17, `mon_25`, 31 VBLs
  (`:2314-2318`); six dispells the same way (`:2319-2326`).
- The flicker: for `D6W` 3, 2, 1 and `D7w` 4 down to 1, sound 17 and the type set to
  `mon_25` on odd `D7w`, `mon_LordChaos` (23) on even, each shown `D6W - 1` times with 31
  VBLs: twelve views, and the last four type changes are never shown (`:2327-2352`).
- A size-255 fireball, 25 VBLs before it and 50 after, and a size-255 dispell, 50 VBLs
  after (`:2353-2363`); `mon_GreyLord`, 31 VBLs; `d.Word1868 = 1`, 31 VBLs (`:2364-2369`).
  That is the only write of `d.Word1868`, and its one read is `DrawRoomObjects`: while it
  is set, a Fluxcage's teleporter shimmer is not drawn (`Code51a4.cpp:2774`), so the
  cages still around the Grey Lord vanish from the view.
- Every monster on the level but his deleted, after `ProcessMonsterDeleteFilter` with
  `DMW_Fusion` (`:2370-2387`), 31 VBLs (`:2388-2389`).
- The texts of cell (0, 0) of the party's level, which `ProcessTimers` loads again after
  each timer (`CSBCode.cpp:6582`), gathered in chain order into `obj_26[8]` (`:2228`,
  `:2390-2396`): a ninth would run past the array. Each is decoded with
  `DecodeText(…, 0x8001, 200)`, which writes a linefeed first (`CSBCode.cpp:5511-5514`), so
  the byte compared, `b_226[1]`, is the text's first letter. The loop makes one pass per
  text, and each pass prints the first text in chain order whose letter is `b_9`, 'A' at
  the start, and only then moves `b_9` on (`:2398-2422`): a missing letter ends the texts,
  however many passes are left. The letter is overwritten with a linefeed and the rest
  printed with `PrintLines(15, …)` straight onto the strip, not through `printQueue`, then
  a view and `VBLDelay(780)` (`:2410-2416`). `TAG00187e`, called before each, writes only
  the hint oracle's `f.` state (`Hint.cpp:1816-1821`), which only `Hint.cpp` reads.
- "THE END." between linefeeds, then `VBLDelay(600)`, `d.CanRestartFromSavegame = 0` and
  `ShowCredits(1)` (`:2424-2429`).

In `dm-atari/dungeon.dat` cell (0, 0) of level 12 holds four texts, chained D, C, B, A:
"THANK YOU MY FRIENDS. …", "ONLY BY LEARNING THE TRUTH …", "BY YOUR BRAVE DEEDS …" and
"YOUR NAMES WILL BE RECORDED …".

Each view is a `_ProcessTimersViewportAndSound`: 33 of them and 1593 VBLs besides the
texts, and each text printed adds a view and 780 VBLs, so 37 and 4713 in the shipped
dungeon. The port: `AttackSystem.fusionSequence`, the suspended callers in
`executeAttack` and `handleAttackAreaClick` (`src/renderer/ui/Attack.ts`), and the dead
keys in `handleUIKey`. Evidence: `tools/dump-fusion.ts`,
`tools/dump-key-bindings.ts` for the menu and the keys, and `tools/dump-cloud-draw.ts` for
the shimmer.

## The Grey Lord's speech reaches the strip one row per text once the strip scrolls

Each of the four texts is one long line, which `PrintLines` wraps at 53 columns into two or
three rows (`doc/CSBwin-src/CSBCode.cpp:1723-1732`). A row past the strip's fourth is a
scroll: `ClockTick` starts it and returns, and places nothing more until a later
`ClockTick` finds the scroll over (`:1526-1538`). `ClockTick` has three callers, the tick
(`:677`), the end of `PrintLines` (`:1736`) and `_ProcessTimersViewportAndSound`
(`doc/CSBwin-src/Attack.cpp:2211`), and `_VBLDelay` is none of them: it only waits
(`CSBCode.cpp:1137-1147`). In `_FusionSequence` a text's `PrintLines` and its view follow
each other with no VBL between them, then come 780 VBLs (`Attack.cpp:2412-2415`), so each
text gets one scroll, and the row that scroll opened is filled when the next text is
printed, thirteen seconds later. "THE END." and its two linefeeds are three `PrintLines`
in a row (`:2424-2426`), one scroll more at most.

So what is read depends on `d.PrintRow` when the fusion starts. On a strip that has
scrolled before, `d.PrintRow` is 3 and every row is a scroll: nothing shows for the first
thirteen seconds, then one row per text, and the credits come with the second row of "ONLY
BY LEARNING THE TRUTH …" the last one shown. On a strip that has printed nothing,
`d.PrintRow` is 0: "THANK YOU MY FRIENDS. …" and two rows of the second text show at once,
and the credits come with "BY YOUR BRAVE DEEDS …" complete and "YOUR NAMES WILL BE
RECORDED …" never shown. `RemoveTimedOutText` and `PrintLines` still carry the waits
(`wvbl`, `RESTART`) CSBWin commented out when it made the strip a queue (`:1498-1502`,
`:1682-1685`).

The port does not show the speech this way. Its waits after a text and after "THE END."
are CSBWin's VBLs, 780 and 600, with the strip's clock run on each of them
(`vblDelayPlacingText`, `src/engine/AttackSystem.ts`), so a row is placed in the VBL its
scroll ends: every text is whole within 24 VBLs of its `PrintLines` and stays until the
next is printed, and "THE END." is on the strip when the credits come, from either
`d.PrintRow` (`DEBT.md` H, "The ending's speech is shown whole"). Evidence:
`tools/dump-fusion.ts`.

## `AddObjectToRoom` clears the new object's link before either arm

`AddObjectToRoom(newObj, prevObj, mapX, mapY, pmmr)` (`doc/CSBwin-src/Code11f52.cpp:392`)
sets `newObj`'s link to `RNeof` (`:428`) before it looks at `mapX`, so the object always
ends its chain and never brings the rest of an old chain with it. With a cell, it becomes
the first object of a cell whose `0x10` flag is clear (the flag set, the column indexes
past it bumped, and the object list opened up at its slot, `:455-482`), is stuffed into
an `RNeof` root when the flag is set but the cell holds nothing (`:441-453`, tolerated for
converted dungeons), or is hung off the last object of the cell's chain (`:491-499`).
With `mapX` -1 there is no cell, and it is hung off the last object of the chain
`prevObj` is in. The port: `DungeonState.addObjectToCell` and
`DungeonState.addObjectToChain`. Evidence: `tools/dump-add-object-to-room.ts`.

## `GAMEBLOCK1`: what `SaveGame` writes there, and which two fields are little-endian

`SaveGame` allocates the 512-byte block, memsets it (`doc/CSBwin-src/SaveGame.cpp:864-865`)
and fills it from `d.`: `SaveOption` (306) is 1 for "SAVE AND PLAY" and 0 for "SAVE AND
QUIT" (`:893`, `:1058`), then `Byte22808[132]` (380), `RandomGameID` (308), `Byte22596`
(301, `ub(d.Word22596)`), `Byte22598` (300, `(i8)d.Word22598`), `Word22594` (376) and
`Word22592` (378) (`:1059-1064`), the five hashes 0 and `totalMoveCount` (322)
(`:1067-1072`), and the five checksums (`:1091-1107`). `swapBlock1` byte-swaps
`RandomGameID`, the hashes, the checksums, `Word22594` and `Word22592` and nothing else
(`:435-453`), so on the little-endian build **`SaveOption` and `totalMoveCount` are
little-endian in the file**. Measured on all eight committed saves: `SaveOption` reads
`01 00`, and `totalMoveCount` is a small
little-endian count (`35 00 00 00`, 53 moves, in `csbgame-early-1hero.dat`).

`ScrambleAndWrite` zeroes words 0-126, folds them into `D6` by turns of add, xor, subtract
and xor, writes word 127 as `D6 ^ D5`, `D5` being the sum of the second half's words, and
scrambles the second half with word 29, which is 0, as its hash (`:706-750`). The reader's
fold over all 128 words therefore ends at `D5` (`ReadUnscrambleBlock`,
`doc/CSBwin-src/CSBCode.cpp:9167-9196`). The reader takes any words 0-126 that fold so:
each zero is written in place of a commented-out `STRandom()` (`SaveGame.cpp:725-738`),
and `static/gamefiles/csb/mini.dat` holds 127 words that are not zero there. No other
block's hash or checksum covers a field of `GAMEBLOCK1`, so a field of its second half
is rewritten by changing that field and word 127 alone: `stampRandomGameID`
(`src/data/SaveGameLoader.ts`) writes `RandomGameID` so, six bytes of the file
(`tools/dump-save-stamp.ts`). Bytes 256-299 of `Byte740`, `FILL438` (302) and
`Checksum354`…`374` are never assigned. They are zero in every committed save.

`_ReadEntireGame` sets `d.Word22596 = 2`, `d.Word22598 = 1`, `d.Word22594 = 1`,
`d.Word22592 = 13` before anything else (`SaveGame.cpp:1467-1470`); only a compressed
`dungeon.dat` (first word 33028) changes `Word22592`, to its word 3 (`:2350-2358`). A new
game draws `d.RandomGameID` as the product of the low words of two `STRandom()` draws
(`:1523-1532`). `LoadGame` copies `totalMoveCount`, `RandomGameID` and `Byte22808`
(`:1603`, `:1610-1611`) and `Word22598` from its byte (`:1859-1860`); when `Byte22596` is 1,
an Atari DM save, it sets `Word22592` to 10 for fourteen levels and a sentinel of 99, 13
for ten levels and 76, and 0 otherwise, and keeps the 2 and 1 above (`:1861-1877`);
otherwise it copies all three words (`:1878-1881`). Every committed save holds 1, 2, 1
and 13. `tools/dump-save-blocks-vs-file.ts` rewrites block 1 of each and finds it
byte-identical outside the unassigned bytes above and the checksums of the timer debris
blocks 5 and 6 already exempt.

## `totalMoveCount` counts every mouse-queue entry `HandleMouseEvents` takes, once

`RECORDFILE::Record(MouseQueueEnt *)` adds one to the global `totalMoveCount` for an entry
below 0x2000, the no-op (button 0x64 at 0x114, 0x2f) aside, whether or not a recording is
open (`doc/CSBwin-src/Recording.cpp:1011-1019`, `doc/CSBwin-src/data.cpp:253`).
`HandleMouseEvents` records the entry it takes once it is past the frozen-game discard and
the held-step test, button 80 excepted (`doc/CSBwin-src/Mouse.cpp:1432-1506`). Button 80
goes to `HandleClickInViewport` whenever `d.ClockRunning` (`:1665-1668`), which is 0 only
while the game is frozen (`:1733`, `:1762`), when the entry was discarded before this point.
`HandleClickInViewport` records exactly once on each of its paths (`:1031-1251`), and a
throw from the hand records in `ThrowByCharacter`, which then returns 1 (`:701-704`, `:756`), after which the
viewport returns without recording again; a throw that returns 0 records nothing and falls
through to the tail's record. So every entry taken past the held-step test counts once.
The keyboard mode's entries are 0x4444 (`doc/CSBwin-src/Code13ea4.cpp:149-153`, `:228-232`) and a new
game's is 0x3333 (`SaveGame.cpp:1515-1520`), neither of which counts. `totalMoveCount` is
not `d.`'s, so a new game after a restart counts on. `tools/dump-mouse-queue.ts` checks the
count, and `tools/dump-new-game.ts` the restart.

## CSB's `graphics.dat`: the long 0x231, and six tables of its own

`ReadTablesFromGraphicsFile` asserts item 0x231 is 0x804 or 0x7d4 bytes, and fills
`d.Buttons16932` from its hardcoded `missingButtons` only for the short one
(`doc/CSBwin-src/CSBCode.cpp:10135-10151`). DM's `graphics.dat` (the Atari file, and the DM
Windows package's, which is the same file) is 0x7d4 bytes there. The CSB Windows package's
is 0x804, and its last 48 bytes are `missingButtons` word for word: `ENTER` (0xc8, x
244-298, y 45-58), `RESUME` (0xc9, 244-298, 76-93) and the credits (0xca, 248-293,
187-199), each on the left button, then a zero terminator. Both files have 563 items. Of
the 35 tables `buildGameTables` holds, CSB's differ from DM's in six: `monsterDesc`,
`spells`, `skillNumber`, `experienceForAttacking`, `byte20046` and `textDecode`.
`tools/dump-data-sets.ts` checks both.

## The French 1.3 `graphics.dat`: longer words

CSBWin was written for the English files, and two of its constants are the English words'
sizes. The French 1.3 file (`static/gamefiles/dm-atari-1.3-fr/`) breaks both, so the port
reads each size from the file (`DEBT.md` H, "Word sizes from the file").

- **Item `0x230` is 1356 bytes.** `ReadTablesFromGraphicsFile` asserts 0x4e8 (1256)
  (`doc/CSBwin-src/CSBCode.cpp:10153`) and reads it into a struct with `AttackNames[300]`
  (`doc/CSBwin-src/Data.h:649`). The French names (`FENDRE` … `FUSIONNER`, 44 of them and
  their padding) take 400 bytes; the attack tables before them and the 584 bytes after
  them (`legalAttacks[44]`, `Unused19218`, `Spells[25]`, `Byte19016`, `Byte19010`) are 1.2's
  byte for byte. Read at CSBWin's fixed offsets, the spell table starts 100 bytes early,
  in the names' tail, and no incantation matches a spell. `parseGraphic230`
  (`src/data/tables/UITables.ts`) takes the names' length as what lies between the attack
  tables and that tail: 300 in every other set.
- **Graphic 30, the food label, is 96 pixels wide** ("NOURRITURE"; "FOOD" is 48).
  `DisplayFoodWater` blits graphics 30, 31 and 32 with a source width of 24, 24 and 48
  bytes (`doc/CSBwin-src/Viewport.cpp:7243-7247`): 48, 48 and 96 pixels. The French
  `0x232` widens `wRectPos950` to x 112-207 to match (the word at byte 882, `x2`, 159 in
  1.2) and narrows `wRectPos958` to x 112-143 for "EAU" (byte 874, 159 in 1.2), which is
  still 48 wide. At CSBWin's stride, each row of the food label reads two of the graphic's
  rows. `drawFoodWaterPanel` (`src/renderer/ui/Character.ts`) reads each word at its own
  width, the same pixels in every other set.

`tools/dump-data-sets.ts` checks both: the French set's tables differ from 1.2's in
`attackNames` and `textDecode` only, and in every set graphics 30-32 cover their
rectangles.

## The spell counters have no floor

Six party-wide counters are raised by a spell and taken back by its timer, and nothing
holds any of them at zero:

| Counter | Type | Raised | Taken back |
| --- | --- | --- | --- |
| `d.Invisible` | `i8` (`doc/CSBwin-src/Data.h:783`) | `d.Invisible++` (`Magic.cpp:1319`) | `TT_71`: `d.Invisible--` (`CSBCode.cpp:6519`) |
| `d.SeeThruWalls` | `i8` (`Data.h:768`) | `++` (`Magic.cpp:1314`, `Attack.cpp:2016`) | `TT_73`: `--` (`CSBCode.cpp:6549`) |
| `d.MagicFootprintsActive` | `i8` (`Data.h:769`) | `++` (`Magic.cpp:1333`) | `TT_79`: `--` (`CSBCode.cpp:6572`) |
| `d.PartyShield` | `i16` (`Data.h:770`) | `sw(d.PartyShield + timerWord6)` (`Magic.cpp:1328`) | `TT_74`: `sw(d.PartyShield - timerWord6)` (`CSBCode.cpp:6551`) |
| `d.SpellShield` | `i16` (`Data.h:772`) | `sw(… + timerWord6)` (`Attack.cpp:1219`) | `TT_77`: `sw(… - timerWord6)` (`CSBCode.cpp:6566`) |
| `d.FireShield` | `i16` (`Data.h:771`) | `sw(… + timerWord6)` (`Attack.cpp:1228`) | `TT_78`: `sw(… - timerWord6)` (`CSBCode.cpp:6569`) |

A counter goes below zero when a timer takes back more than is there.
`_FusionSequence` writes 100 over the three shields (`Attack.cpp:2276-2278`) while the
timers of the shields cast before it still hold their amounts, and a save holds the
counters and the timers apart: the six are in block 4's tail, the bytes signed
(`readCsbwinPartyTail`, `src/data/CsbwinCharacters.ts`).

The readers take the value as it stands:

- the three `i8` counters are tested `!= 0` (`Monster.cpp:527`, `Code11f52.cpp:3238`,
  `Viewport.cpp:2639`, `CSBCode.cpp:4171`), so one below zero is a spell still running;
- the shield dots test `> 0` (`Character.cpp:1266-1274`), and a new shield is quartered
  when the counter is `> 50` (`Magic.cpp:1324`, `Attack.cpp:1215`, `:1224`);
- `DamageCharacter` takes the spell or the fire shield off the blow,
  `sw(D7W - d.SpellShield)` (`Character.cpp:2768`, `:2775`), and `TAG01680a` adds
  `d.PartyShield` to the armour (`:2456`), so a shield below zero adds to the damage.

`tools/dump-character-damage.ts` checks the six timers, the wrap at each type's lowest
value, the save's bytes, and the blow and the armour under a shield below zero.

## `TAG01680a`: a wounded part and a sleeping party are less protected

`TAG01680a(chIdx, possessionIndex)` (`doc/CSBwin-src/Character.cpp:2391`) is the armour
of one body part, which `DamageCharacter` averages over the parts a blow could land on
(`:2741`). Every sum in it is cast to `i16`. In order:

1. the shields in the two hands, weighted by `d.Byte1412[possessionIndex]` (`:2403-2431`);
2. `STRandom() % (Vitality / 8 + 1)`, halved when bit 15 of the index is set (`:2437-2446`);
3. `+ word64 + shieldStrength + d.PartyShield` and the shields' term (`:2453-2457`);
4. for a part above 1, the garment worn there (`:2463-2477`);
5. `if (pcA3->ouches & (1 << possessionIndex)) D7W = sw(D7W - (STRandom0_3() + 8))`
   (`:2478-2481`): a wounded part loses 8 to 11, at the cost of one more random draw;
6. `if (d.PartySleeping) D7W >>= 1` (`:2482-2485`);
7. `ApplyLimits(0, D7W >> 1, 100)` (`:2486`).

`armourStrength` (`src/engine/MonsterAttack.ts`) is its port, and
`tools/dump-character-damage.ts` replays the draws from the seed for a whole part, a
wounded one, a sleeping party, and both.

## The timer-type modifier lasts one timer, and every site reads it afresh

`timerTypeModifier[3]` (`doc/CSBwin-src/CSBCode.cpp:21`) is the action SET, CLEAR and
TOGGLE stand for. `ProcessTimers` sets it to 0, 1, 2 before every timer (`:6412-6414`); a
DSA's `&MODIFYMESSAGE` (`DSA.cpp:4931-4947`) changes it for the rest of that timer only,
each of its three actions popped `unsigned int` and capped at 3, so a 5 or a -1 is 3.
Each site reads `timerTypeModifier[pTimer->timerUByte9()]` when it needs it, not once:

- `ProcessTT_OPENROOM` and `ProcessTT_STONEROOM` test it for 3 at each object of the square
  and read it again for a text, a counter (`OperateCounterActuator`, `Timer.cpp:1609`,
  `:1624`) and a type 5 (`:2258`), so a DSA early in the chain changes what the objects
  after it do, and a 3 ends the square (`:1712`, `:2195`). `ProcessTT_FALSEWALL` tests it
  at each object and reads it once more after the loop (`:1416`, `:1439`), where a 3 sets
  the wall, being neither TOGGLE nor CLEAR.
- `ProcessTT_DOOR`, `ProcessTT_PITROOM` and `ProcessTT_TELEPORTER` hand it to
  `ActivateDSA`, then read it again: a TOGGLE writes SET or CLEAR into `uByte9`
  (`:1571-1575`, `:2536-2546`, `:2404-2408`). Past that the door and the pit read the raw
  `uByte9` (`:1578`, `:2548`), the teleporter reads it through the modifier again (`:2409`),
  so a SET that a DSA made a TOGGLE leaves a closed teleporter closed. `ProcessTT_DOOR`
  reads the door state only after `ActivateDSA` (`:1563-1569`), so its DSAs run on a
  bashed door too, and it never tests the room type.
- `ActivateDSA` (`:1500-1538`) runs each DSA on a timer of its own whose `uByte9` is the
  action already read through the modifier, which `ProcessDSATimer6` reads through it once
  more (`DSA.cpp:5351`, `:5383`). A timer just reset reads the same either way.
- `ProcessPortraitTimer6` reads the raw `uByte9` (`Timer.cpp:2115`).

A `uByte9` past 2, which `&MESSAGE` can queue, reads past the array; the port reads it as
3, no action. Evidence: `tools/dump-timer-modifier.ts`.

## `&PARAM@` compares the count unsigned, and does nothing past 100

`STKOP_ParamFetch` (`doc/CSBwin-src/DSA.cpp:2956-2998`) pops `i` and `n` as `ui32`. An `n`
past 100, a negative one included, only says "too many parameters". Otherwise `n` is
compared with the count, `pDSAparameters[0]`, unsigned: a count of -1, which a parameter
message whose `EXPOOL` record is gone leaves (`Timer.cpp:1401`, `:1701`, `:2180`), is
never short, and the `n` words are copied as they stand. Past a short count, the variables
are marked `DVT_NonParameter` (`:2975-2979`) and keep their values, but any read of a
variable that is not `DVT_WellDefined` zeroes it (`DSADBANK::Var`, `:141`, `NoValue`,
`:227-238`), so they read 0, and `&PARAM!` skips them. `STKOP_ParamStore` (`:3000-3020`)
does nothing past 100 either. Evidence: `tools/dump-dsa-parameters.ts`.

## A DSA's extended cell flags are one `EXPOOL` record a column, and `&ECF!` re-adds it

`&ECF@` and `&ECF!` (`doc/CSBwin-src/DSA.cpp:3270-3327`) key a record on
`(EDT_ExtendedCellFlags << 24) | (l << 5) | x`: eight longwords, one a flag, holding the
flag of the column's row `y` in bit `y`, the layout `GetExtendedCellFlag` reads
(`data.cpp:1679-1690`). `&ECF!` takes the record out with `expool.Read`, zeroes it if it
is missing or shorter than eight, changes the one cell's bits and writes it back, so the
column keeps exactly one record and its other rows' flags; only the low eight bits of the
flags are kept. `ExamineCell`, behind `&THISCELL` and `&NEIGHBORS` (`:2210-2320`), gives a
door its state's bit with `=` rather than `|=` (`:2276`), which changes nothing since the
bits are still 0 there, and has no case for room type 7, whose cell matches no mask. `&J*`
and `&G*` both pop the state first and the column second (`:4738-4739`, `:4749-4750`).
Evidence: `tools/dump-dsa-dungeon.ts`.
