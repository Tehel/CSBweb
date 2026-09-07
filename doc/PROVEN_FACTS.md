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
