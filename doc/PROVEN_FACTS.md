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

One related effect is **not** ported: while the counter is non-zero, CSBWin recolours a
door in the nearest rank via `TAG004b26(17, 2)` (`doc/CSBwin-src/CSBCode.cpp:4171-4174`).

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
`8`, `+4` for a weapon, and `+ uByte3/4` for a weapon whose `uByte1 <= 12`.

## Spell experience uses the spell record's `byte5`

CSBWin passes `spellByte5` as the skill number for both spell `AdjustSkills` calls —
`ASW_CastSpell1` on a wisdom-check failure (`doc/CSBwin-src/Magic.cpp:1226`) and
`ASW_CastSpell2` on success (`doc/CSBwin-src/Magic.cpp:1396`). `byte5` comes from the
`SPELL` record in graphics `0x230`; it is not derived from the champion's class.

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
value, and `DeleteFootprintEntry`'s `MemMove` shifts the tail *up* rather than down
(`doc/CSBwin-src/Code11f52.cpp:4328-4329`). Both are ported as written.

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

`doc/CSBwin-src/Code11f52.cpp` returns `LOCAL_14` from the monster branch (`:3424`), and the
value carries three different meanings:

- `1` from `return (1)` at `:3358` means the group is **no longer in the dungeon** — the
  destination held the party or another monster, so it went into abeyance.
- `0` means nothing about the `ITEM16` changed.
- `1` (as `LOCAL_14`) means the slot was attached or detached by this move.
- `> 1` comes only from `TeleportMonster`, which returns `groupIndex + 2` when the group is on
  the party's level and in `StateOfFear6` (`doc/CSBwin-src/Code11f52.cpp:2377-2384`) — so the
  caller can recover the slot index as `LOCAL_14 - 2` and call
  `ClearAttacking_DeleteMovementTimers` on it (`:3411`).

The overlap between "returned 1 because removed" and "LOCAL_14 == 1" is only safe because the
two are reached by different `return` statements.

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

## Monster AI timers are addressed by map square, so a move must retarget them

Timer types 29-41 are found by `uByte6`/`uByte7` (`doc/CSBwin-src/Monster.cpp:1320-1327`).
A group that moves without its `ITEM16` changing keeps its timers, so CSBWin rewrites their
coordinates in place rather than recreating them (`doc/CSBwin-src/MoveObject.cpp:551-565`):

```cpp
if (pTimerA->timerUByte6() != srcLocr.x) continue;
if (pTimerA->timerUByte7() != srcLocr.y) continue;
pTimerA->timerUByte6(ub(locr.x));
pTimerA->timerUByte7(ub(locr.y));
```

Miss this and the group goes on waking up at the square it left.

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
coin toss (`doc/CSBwin-src/Monster.cpp:1025-1027`) — so a thrower next to you sometimes
punches instead. The missile is fixed per type (`:1029-1058`): Vexirk and Lord Chaos roll
between a fireball and one of four spells, Slime Devils spit poison, Flying Eyes throw
lightning seven times in eight, Zytaz alternate poison cloud and fireball, Demons and
Dragons breathe fire. Everything else has no missile at all and the launch is skipped.

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
**sleeping** party gets neither check; it is woken by the blow instead.

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

## `KillCharacter` is the only way a champion's hit points reach zero

Nothing in CSBWin assigns `HP(0)` outside `KillCharacter` (`doc/CSBwin-src/Character.cpp:2526`).
Every path that can kill ends at `DamageCharacter` (`:2703`), which is what drops the
possessions, leaves the bones, moves the cursor and the magic tab, and sets
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

The renderer scales the puff by `value` (`BytecodeInterpreter`, the
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

Storing the object by reference instead — as `TimerQueue.addTimer` did — puts the *same*
entry in the queue up to four times, and every later mutation rewrites entries already
queued. The queue then stops being sorted, and because `processTimers` stops at the first
entry that is not yet due, every timer behind the misplaced one stalls. `addTimer` now
copies and mints the index, and callers must read the queued `index` from its **return**,
which is what CSBWin does at `doc/CSBwin-src/Timer.cpp:429`.

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
  font, graphic `0x22d`, those codes hold rune glyphs — Lo, Um, On, Ee, Ux, Mon — so
  "a MASTER" is the rune for Um followed by a space and MASTER, not a letter A.
  `TextOut_OneLine` indexes the font with the raw byte (`doc/CSBwin-src/Graphics.cpp:335`)
  and never changes case, so these lines must go through `drawTextLineIndexRaw`; the
  upper-casing `drawTextLineIndex` turns the rune into an 'A'.

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

This port read `spellFilterLocation` at 64 and `extendedFlags` at 68 — both one field
too far — until three genuine saves were read. It went unnoticed because in the two
older ones every word from 52 to 72 is zero. The third has
`extendedFlags = 0xe0` (`SequencedTimers | DefaultDirectX | ExtendedTimers`), which
at the wrong offset read as 0 and chose a 10-byte `TIMER` where the file has 16.

**`gameInfoSize` is declared `ui32` but is signed everywhere it is used.** The global
is `i32` (`doc/CSBwin-src/Data.h:118`, `doc/CSBwin-src/data.cpp:271`), `ReadGameInfo`
and `WriteGameInfo` both take `i32 size`, and the writer sets

```
      efb.gameInfoSize = 0;
      if (gameInfo != NULL) efb.gameInfoSize = gameInfoSize-1;
```

(`doc/CSBwin-src/SaveGame.cpp:977-978`), so an allocated-but-empty game info writes
**-1**, i.e. `0xffffffff`. `WriteGameInfo` then writes nothing for it, so the field
occupies **no bytes in the file** and the read head must not advance.
`static/gamefiles/saves/csbgame3.dat` is exactly this case; read unsigned, the
4294967295 walks past the end of the file and GAMEBLOCK1 never parses.

Proved arithmetically as well as by checksum: across the three saves the distance from
the end of the data maps to GAMEBLOCK1 is 3185, 3185 and 3153 bytes, and the DSA level
index is 3153 bytes in all three — the 32-byte difference is precisely the two files
whose `gameInfoSize` is 32. The one with `-1` contributes zero.

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
layout, all of it now verified: for **twelve genuine save files** the sum of every
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
cellFlagArraySize            cell flags        (from EXTENDEDFEATURESBLOCK+48)
2                            final checksum
```

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

Two independent confirmations beyond the closure sum: a 48-byte window lifted from
`dungeon.dat`'s map-data section is found in an early save exactly at the computed cell
flag offset, and its door database appears exactly at the computed database offset.

Covered by `tools/dump-csbwin-save.ts`.

## A thrown object keeps its id: `ObjectInHand` and `MISSILE.projectileObject`

Two saves taken either side of a throw settle both fields at once. In
`static/gamefiles/saves/csbgame-item-on-cursor.dat` a sword sits on the cursor and
`gb2.ObjectInHand` is `0x4d`; in `csbgame-flying-sword.dat`, the same session moments
later, the cursor is empty (`0xffff`) and the one live MISSILE record carries
`projectileObject = 0x4d`, `rangeRemaining = 77`, `damageRemaining = 20`,
`timerIndex = 2` against `NumTimer = 3`.

`0xffff` in `gb2.ObjectInHand` is the empty hand, and **`timerIndex == 0xffff` marks a
free slot** in the MISSILE pool. The pool is allocated at full size regardless of what
is happening: all twelve sample saves carry 60 missile and 50 cloud records, so a
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
from the high bits. Once that RN has been put back into packed form its low ten bits are
the text record's index, so `rn & 0x3ff` recovers precisely what the old field held and
every existing reader of `textReference` keeps working. *Put back into packed form* is
not a formality: in a save file the stored RN is a slot number in the object indirect
index, not a packed RN — see "An RN in a save file is an indirect index" below.

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

This is the fact that made every object reference inside a genuine CSBWin save read as
nonsense, and it is not a quirk of the file format — it is how `RN` works in CSBWin at
all. `dungeon.dat` stores an object reference as the Atari ST bitfield this port uses
everywhere, `[position:2][category:4][index:10]`. CSBWin does not keep them that way.
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

**A freed slot is `dataTypeMap[i] == 0xff`, `dataIndexMap[i] == 0xffff`.**
`DeleteDBEntry` writes both, together with `RNnul` over the record's own link
(`doc/CSBwin-src/data.cpp:993-1015`); `AllocateIndirectIndex` and `RN::RN(DBTYPE, idx)`
reuse such slots. Three of the twelve committed saves reference one — `csbgame2.dat`'s
`monster[158]` still points its possession chain at slot 361 — and in every case the
referring record is itself free, its link `RNnul`. CSBWin never looks: a free record is
reached only by the allocator, which clears it before handing it out. So a free record's
other RNs are read and dropped rather than resolved; refusing them would make a
perfectly good save unreadable.

**Where this port draws the line.** `dataIndexMap` is 16 bits wide and a packed RN's
index field is 10, so a database of more than 1024 records cannot be expressed here.
CSBWin allows 64000. No shipped DM dungeon comes close — the largest index in any
committed save is 682 — but `CsbwinObjectIndex.resolve` throws rather than alias. The
same applies to two slots naming the same `(db, idx)`, which `ConvertListOfObjects`
permits only for a missile's flying object (`DuplicateOK`, `:1918`): `countAliases`
reports it, and the shipped dungeon has none.

Evidence: `tools/dump-csbwin-world.ts` walks every object chain in all twelve saves —
1783 to 1908 objects each, chains up to 31 deep, through chests and monster possessions
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
live**, each an index into the table, and the order **is** the firing order. CSBWin keeps
it sorted as it inserts and restores it verbatim — it never re-sorts on load
(`GameTimers::swapTimerQue`, `doc/CSBwin-src/Data.h:1582`). Re-inserting them through
`SetTimer` instead would also run the duplicate-timer rules over timers that legitimately
coexist, and drop some.

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
committed save** in `static/gamefiles/saves/` reproduces a cell of basic graphic 26
pixel for pixel, 928 of 928 (`tools/dump-csbwin-load.ts`). A wrong offset, a reversed
plane order or a byte swap each still yield a plausible 32x29 block, and none of them
match.

Consequence for the port: `Champion.portrait` holds those 928 palette indices, and the
status box prefers them. `Champion.portraitGraphic` — the graphic-26 cell — remains for
champions this engine creates, because the engine holds no graphics to blit from, but it
is this port's shortcut and not a CSBWin field. A champion out of a genuine save has
pixels and no index at all, which is why a loaded party once showed four empty boxes.

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
saves hold exactly that: `00 69 6f 00` and `00 66 00 76` are both in the committed
files. To CSBWin those are an *empty* incantation — `StrLen` stops at byte 0 — with two
dead bytes trailing.

This port read the field as "the non-zero bytes", which resurrected them: a champion
restored from `csbgame4.dat` had two runes pending that the real game does not show.
Fixed by reading the terminated prefix, as CSBWin does. The dead tail is kept separately
(`Champion.incantationField`) only so the save writer can put the record back byte for
byte; it is used only while it still agrees with the live prefix, so a rune typed after
the load is never overwritten by it.

<sub>Note the terminator write at `incantation[D7W + 1]` with `D7W == 3`: `incantation`
is `i8[4]`, so that is a write to `FILL38[0]`. It is zero in every committed save, and
this port writes zero there.</sub>

## Packing `CHARDESC` back: the six fields with no reader

Writing block 4 needs the whole 800-byte record, including what the game never reads
back. Everything below is verified by `tools/dump-character-block.ts`, which packs the
block again for each of the fourteen committed saves and compares with the file's own
bytes — all fourteen are byte-identical, empty slots, dead incantation tails and all.

| Offset | Field | What to write |
| --- | --- | --- |
| 30 | `byte30` | **1** — `pcA3->byte30 = 1;` (`doc/CSBwin-src/Character.cpp:515`) |
| 31 | `byte31` | **2** — `pcA3->byte31 = 2;` (`:516`) |
| 43 | `uByte43` | 0 |
| 38-39, 91, 286-335 | the `FILL` runs | 0 — `ClearMemory((ui8 *)pcA3, 800)` (`:478`) |
| 212-271 | an empty possession slot | **0xffff** (`RNnul`), in all 656 empty slots of the committed saves |
| 3287-3327 | `Byte13195[41]`, the party tail's own filler | 0 |

An unused champion slot is 800 zero bytes, not a record with zero fields: `AddCharacter`
clears it before it writes anything, and a save holds whatever the last `RemoveCharacter`
compaction left, which is zeros.

Two more, which have readers but not in this port, so they are carried rather than
derived: `timerIndex` at 46 (the timer that erases the damage readout over a portrait,
`doc/CSBwin-src/CSBCode.cpp:7176-7190`, -1 in every committed save) and `charFlags` at 48,
whose bit 4 is the champion's **gender** — the only place it is recorded.

### `CHARDESC.load` agrees with this port's own sum

CSBWin keeps `load` (offset 272) incrementally, adjusting it at each of its eight
possession writers; this port re-sums it from the object weights instead
(`src/engine/CharacterStats.ts`). For all **42 champions of the fourteen committed
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

## The timer array has a free list, and a save carries its cursor

`m_firstAvailTimer` (`doc/CSBwin-src/Data.h:1540`) is the lowest slot of the timer array
holding no live timer. Three places maintain it:

- `SetTimer` allocates at it — `D5L = m_firstAvailTimer`, `ASSERT(m_firstAvailTimer <
  m_maxTimers)` (`doc/CSBwin-src/Timer.cpp:1129-1130`) — and then walks it forward to the
  next `TT_EMPTY` entry (`:1195-1198`).
- `DeleteTimer` marks the slot `TT_EMPTY` and lowers the cursor to it if it is lower
  (`doc/CSBwin-src/Timer.cpp:965-969`). `GetNextTimerEntry` copies the head of the queue
  out and then calls `DeleteTimer` on it (`:1222-1233`), so **firing a timer frees its
  slot** — the array is not append-only.
- `LoadGame` reads the cursor straight back out of the file: it is written as
  `gb2.FirstAvailTimer` (`doc/CSBwin-src/SaveGame.cpp:1023`) and restored at `:1640`.

The invariant that falls out of the first two is that the cursor is always the *lowest*
free slot, which is why this port derives it from the holes in the restored table on load
rather than adding a field to the save format.

Why it is not merely tidy numbering: `LoadGame` is followed by `ProcessMonstersOnLevel`
(`doc/CSBwin-src/SaveGame.cpp:1240-1244`), which deletes and re-creates the movement
timers of every monster group on the party's level. Without slot reuse every load
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
game has ever taken, 0 above it. Measured on the twelve committed saves that carry
16-byte timers, and the split is exact — no slot holds a third value, and the boundary
sits at or above `FirstAvailTimer` in every one:

| save | live timers | 0xcd slots | first zero slot | `FirstAvailTimer` |
| --- | --- | --- | --- | --- |
| `csbgame-early-1hero.dat` | 1 | 1 | 1 | 1 |
| `csbgame4-door-opening.dat` | 2 | 2 | 2 | 2 |
| `csbgame3.dat` | 4 | 20 | 20 | 3 |
| `csbgame5.dat` | 26 | 41 | 41 | 25 |
| `csbgame7.dat` | 76 | 110 | 110 | 76 |

This port keeps no such mark, so `saveSaveGameState` writes 0xcd for a slot that is live
*now* and 0 otherwise — right for a slot CSBWin has never freed, and invisible either
way. `tools/dump-save-blocks-vs-file.ts` asserts every other byte of block 5 against the
file and exempts these three in freed slots by name.

**The timer queue past `NumTimer` is the same kind of debris.** CSBWin writes all
`MaxTimer` words of `m_timerQueue` (`doc/CSBwin-src/SaveGame.cpp:1136`) and `LoadGame`
believes only the first `NumTimer` of them; the rest are what a longer queue left behind
— 34 stale indices in `csbgame7.dat`, 50 in `csbgame4.dat`. The writer zeroes them.

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

The first two are zero in `dungeon.dat` and in all fourteen committed saves. **The third
is not**: across the fourteen DM levels bits 8-11 take the values 0, 1, 3 and 4. So it is
real data with no known meaning, and dropping it would have made every level descriptor
this port writes differ from the one it read.

All three now live on `DungeonHeader.word4Low` and `MapDescriptor.fill2` /
`MapDescriptor.word12Bits8_11`, named as CSBWin names them where it names them at all, and
documented as unread. `tools/dump-dungeon-image-blocks.ts` is the check: blocks 7, 8, 9 and
14 written again from a parsed world and compared with the file's own bytes, for
`dungeon.dat` and for every save. Blanking `word12Bits8_11` in the writer fails it on
levels 3, 5 and 12 of every one of the fifteen files.

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
only when that is 0 (`doc/CSBwin-src/SaveGame.cpp:2412-2415`), and the saves differ on
which they fill — `word2` is 0 in most of them and 12366 in `csbgame3.dat`.

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

"Set in the data?" is measured over `dungeon.dat` and all fourteen committed saves, and it
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
`DungeonData.expool` now keeps the whole section as bytes (3 records in `csbgame.dat`, 13
in `csbgame7.dat`), which is what lets a save be written back carrying the EXPOOL it was
read with. Note that `SaveGame` deposits the 100 DSA global variables and the 24 overlay
palette records into EXPOOL immediately before the image
(`doc/CSBwin-src/SaveGame.cpp:1141-1162`); this port maintains neither, so the carried
copy is what a file it writes will hold.

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

## An RN in block 10 or block 13 cannot be byte-identical, and need not be

Every word of the object list, and the link word of every database record, is an RN — a
slot number in the object indirect index. `buildObjectIndirectIndex` numbers those slots
its own way (every record of every database, in `DBType` then index order, slot 0 left
free), where CSBWin numbers them in whatever order `ConvertListOfObjects` happened to walk
the world. Nothing outside the file refers to a slot number: `ReadExtendedFeatures` reads
the maps back before anything resolves an RN through them
(`doc/CSBwin-src/SaveGame.cpp:355-376`), so a save only has to agree with itself.

Measured on `csbgame.dat`: 787 of the object list's 1982 words happen to match CSBWin's
anyway, and 1195 do not. On `dungeon.dat`, which stores packed RNs and has no indirect
index at all, every one of the 1682 matches — which is why that file is kept in the tool
as the case where blocks 10 and 13 *are* byte-compared.

For a save, those words are checked by resolving instead: the maps are written, read back
through `readObjectIndirectIndex` (which verifies both `FormChecksum`s), and each word
resolved through them must equal what the reader got by resolving CSBWin's word through
CSBWin's maps. That is a weaker argument than the byte comparisons around it — it would
survive a bug our encode and our resolve shared — and the tool says so where it makes it.

One class of word is neither compared nor resolvable: **the second RN of a free record**.
`DeleteDBEntry` writes `RNnul` over a record's link and frees the indirect slot that named
it, but leaves the rest of the record alone (`doc/CSBwin-src/data.cpp:993-1015`), so a
deleted record routinely still points its possession or contents chain at a slot that has
since been freed — `csbgame2.dat`'s `monster[158]` at slot 361 is the case. The reader
drops those (`readRNOfRecord`), so the writer has nothing to put back but `RNnul`. There
are 135 to 269 of them per committed save; the tool counts and reports them, exactly as
`tools/dump-save-blocks-vs-file.ts` exempts `TIMER.unused13`.

## Everything CSBWin converts to slot numbers, and in what order

`ConvertListOfObjects` is called from five places, and a writer that renumbers the index
has to reach all five or it will write a file whose references point at the wrong records
(`doc/CSBwin-src/SaveGame.cpp`):

1. **Every cell chain** — one call per column pointer, `:2736`.
2. **The object-carrying timers** — `ConvertTimers`, `:2745`. It switches on the timer
   function: 48 and 49 carry `timerObj6` (bytes 6-7), 24, 25, 60 and 61 carry `timerObj8`
   (bytes 8-9), `:2027-2050`. Every other function reads those bytes as plain numbers.
3. **The thirty possession slots of every champion** — `ConvertCharacters`, `:2746`.
4. **`d.objectInHand`** — `:2753-2760`, guarded on it not being `RNnul`.

Each call records the reference's **position** into `dataTypeMap` as well as allocating
the slot, which matters because an object a champion is carrying is in no cell chain at
all: leave it out and its slot keeps position 0, so the possession comes back naming the
same record in the wrong corner of its cell. `buildObjectIndirectIndex` takes those extra
references as `heldReferences` for exactly that reason, and
`tools/dump-save-file-roundtrip.ts` fails on all fourteen saves when they are withheld.

The order is the one above, and CSBWin's rule is **first writer wins** — a second
reference to an already-converted object reuses the slot without touching it
(`duplicate >= 0`, `:1958-1964`). This port's pre-pass is last-writer-wins in the same
order, which agrees because no object is reachable from two of the five; the one case
CSBWin itself allows a duplicate for is a missile's flying object (`DuplicateOK`, `:1918`).

**This port's reader leaves a timer's object RN unresolved.** Nothing here consumes one,
so `parseTimers` keeps the raw word — which is harmless while a file is only read, and a
defect the moment one is rewritten with a new numbering. `csbgame-flying-sword.dat` is the
save made to order for it: one live timer, function 49, `timerObj6 = 0x79a`. The
translation is done by whoever renumbers, because only that caller holds both indexes.

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
| `convertScrolls` (`:2144-2166`) | `ExtendedFeaturesVersion < 'B'` | `:2768-2772`, last of all | SCROLL 4 bytes → 6, 10-bit index → RN |

The **order** is not cosmetic: `convertScrolls` runs after `ConvertToIndirectText`, so the
TEXT record index a scroll's new RN names is the post-conversion one.

Running one twice does not raise an error, it produces a corrupt world — a second
`ConvertToIndirectText` decodes the index it built last time as if it were text, and DM's
1749 words of text come back as 1436. So the gates are the whole safety argument, and
this port uses the same ones (`src/data/CsbwinDungeonConversions.ts`;
`tools/dump-dungeon-conversions.ts` measures the corruption rather than describing it).
`MakeBigActuators` is likewise destructive twice over — the second pass zeroes the
`word8` the first one lifted out of a DSA actuator's parameters. `convertScrolls` alone
happens to be idempotent, because it rebuilds the RN from a field it never overwrites.

**The evidence is exact, because CSBWin converted this same dungeon fourteen times.**
Every committed save was made from `static/gamefiles/dm-atari/dungeon.dat`, so the
converted form is in the files: converting here and comparing gives 0 differences in the
125-entry indirect text index, 0 in all 1749 words of compressed text, 0 in every TEXT
record's rewritten index word, 0 in every scroll's new text RN and `open` bit, and 0 in
every actuator's `word8`.

## `NumWordsInTextArray` means two different things either side of the conversion

`DUNGEONDATINDEX::word6` sizes the raw text array in a `dungeon.dat` — 1749 words for DM
— and `ConvertToIndirectText` overwrites it with the **length of the indirect index**,
`NumWordsInTextArray((ui16)indirectIndexLen)` (`doc/CSBwin-src/SaveGame.cpp:2274`). All
fourteen committed saves declare 125, which is exactly the number of TEXT records with a
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
`csbgame4.dat`, records 0-5 carry 3585, 530, 5132, 532, 3587 and 536 in bits 1-15, and 28
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
rather than merely unknown. Measured across all fourteen committed saves, the eight that
are always zero are `editingOptions`, `graphicsSignature1/2`, `csbGraphicsSignature1/2`,
`spellFilterLocation`, `hintKey[8]` and `overlayOrdinal` with its four parameters.

`flags` gets four bits unconditionally — `LevelDSAInfoPresent` (`:940`), `IndirectText`,
`ExpandedPortraits` and `BigActuators` (`:961-963`) — which is 0xa9, exactly what
`csbgame.dat`, `csbgame2.dat` and `csbgame3.dat` carry. The five newest saves carry 0xe9,
the same four plus `DMRules` (`DMRulesDesignOption`, a design option). `SimpleEncryption`
and `AutoRecord` are the other two, both conditional and both off everywhere.

`extendedFlags` gets three unconditionally (`:964-966`): `SequencedTimers`,
`ExtendedTimers` — which together select the 16-byte `TIMER` — and `DefaultDirectX`,
which is 0xe0 and exactly what `csbgame3.dat` carries. The newest saves add
`ExtendedWallDecorations` and `DMRulesOption` for 0xf8. `csbgame.dat` and `csbgame2.dat`
carry **0**, an older CSBWin that wrote 10-byte timers, which is the case that proves the
field is read rather than assumed.

`LevelDSAInfoPresent` is not decorative: `ReadExtendedFeatures` reads the DSA level index
back only when that bit is set (`:387-390`), and the index is always written — so a
header without the bit leaves three bytes of terminator for GAMEBLOCK1 to eat.

`gameInfoSize` is 0 for "no game information at all" and `gameInfoSize - 1` when there is
some (`:977-978`), which makes **-1** an allocated-but-empty string; `csbgame3.dat` is
that case. A port with no game information writes 0.

## A live timer keeps its object in three places, and a file has one

CSBWin's `TIMER` has one byte pair at 6-7 and one at 8-9, read either as two bytes or as
one word depending on the timer function (`doc/CSBwin-src/CSB.h:1818-1860`). This port's
live `TimerEntry` carries `uByte6..9`, `timerWord6`, `timerWord8` **and** an `object`
field with no byte at all — so writing one to a file is a collapse, and it was being done
wrong in two ways at once.

`TimerSystem.launchMissile` puts the missile record's RN on `TimerEntry.object` and passes
the launch square as `x, y`, so a saved missile timer went out with its launch square in
bytes 6-7 — where `ConvertTimers` says the object lives — and zeros in bytes 8-9, where
the packed `[x:5][y:5][direction:2][decay:4]` word belongs, because `pos` and `action` are
both 0 for a missile. `csbgame-flying-sword.dat` settles both: function 49, bytes 6-7
`07 9a` (the object's indirect slot) and bytes 8-9 `a9 09` (the packed word,
`timerWord8`). `Game.collapseTimerBytes` is the one place the three representations meet
now, and `restoreTimerQueue` is its inverse.

The other conflict is benign and is guarded rather than assumed: a magic shield or poison
timer keeps a **count** in `timerWord6` while `uByte6`/`uByte7` are zero, because
`Game.queueUtilityTimer` passes `x = y = 0`. The two representations can only disagree
when one of them is zero, since no creator sets both.

**And the reader has to resolve what the writer encoded.** `parseTimers` keeps bytes 6-9
as it finds them, which is right for the timer functions that read them as plain numbers
and wrong for the six that do not: in a save those two bytes are an indirect slot, not an
RN. Nothing consumed one until the engine started restoring a timer's object at all;
`CsbwinSaveGame.resolveTimerObjects` is where the translation happens now, and without it
a restored missile names whatever record our own numbering put at that slot.

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

`ProcessMissileEncounter`'s shared ending (`Code11f52.cpp:2101-2121`) and `CreateCloud`'s
own sound (`Code11f52.cpp:1432-1447`) are the two call sites `TimerSystem` used to read
past — `playMissileImpactSound` and `playCloudSound` called `playSound` with a hand-typed
`SoundIndex` graphics.dat item instead of `queueSound` with CSBWin's literal ordinal, and
along the way substituted ordinal 5's item for ordinal 4's (a plain object's impact) and
ordinal 13's item for ordinal 20's (a small blast) — see PLAN.md for the fix and its
evidence.

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
tick already due runs one VBL later. The key queue is a 3-slot ring that refuses a key
when `next == keyQueueStart` (`CSBUI.cpp:143-145`, `:1131-1139`), so it holds at most two
keys. Evidence: `tools/dump-party-collision.ts` case 6.

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
from the party's facing turns back once 60 ticks pass without one). Evidence:
`tools/dump-last-monster-attack.ts`.

## `TIMER_SEARCH` walks the queue backwards, and `SetTimer` mostly keeps the old timer

`TIMER_SEARCH`'s constructor copies the **queue** (`m_timerQueue`, in firing order) into
`m_searchList` (`CreateSearchList`, `doc/CSBwin-src/Timer.cpp:1209-1215`), and `FindNextTimer`
(`:2924-2933`) starts at its end and counts down: the timer due last is visited first, and
slot numbers play no part. Because it walks a copy, `DeleteTimer` on the current entry is safe.
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
counter is repacked when it reaches 0xffff (`:1135-1188`).
Evidence: `tools/dump-timer-dedupe.ts`.

## Actuator type 8 counts what is in a carried chest, and what is on the cursor

`DoesPartyHave` (`doc/CSBwin-src/Code11f52.cpp:3622-3680`), the test of a type-8 floor sensor,
walks the 30 possessions of every champion whose `HP() != 0`, comparing each one's
`GetBasicObjectType` with the actuator's value; a possession that is `objNI_Chest` (0x90,
`Objects.h:585`) has its `contents()` chain compared as well. After the last champion it sets
`w_4 = 1`, loads `d.objectInHand` and jumps back into the loop body (`goto tag012e14`,
`:3672-3678`), so the object on the cursor — and, if it is a chest, its contents — counts too,
whoever holds the cursor. Evidence: `tools/dump-does-party-have.ts`.
