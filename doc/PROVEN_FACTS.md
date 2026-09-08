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
