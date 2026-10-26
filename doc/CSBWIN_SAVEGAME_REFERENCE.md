# CSBWin Save/Extended Data Reference (Sourced)

This document captures verified save/extended data behaviors from the CSBWin C++ source under `doc/CSBwin-src/`.

## Extended features block

- `ReadExtendedFeatures` reads the 512-byte `EXTENDEDFEATURESBLOCK`, followed by `dataTypeMap`, `dataIndexMap`, DSA blocks (`ReadDSAs`), optional `ReadDSALevelIndex`, and sets `sequencedTimers`/`extendedTimers` from `extendedFlags` (bits `0x20`/`0x80`) (`doc/CSBwin-src/SaveGame.cpp`).
- `ReadDSALevelIndex` consumes 3-byte triples until `level > 63`, storing `DSALevelIndex[level][selector] = dsaIndex` (`doc/CSBwin-src/SaveGame.cpp`).

## Database read order

- `ReadDatabases` reads the 44-byte `DUNGEONDATINDEX`, map descriptors, object list, and text data before database records; when `indirectText` is set (extended features flag `IndirectText`), it reads `NumWordsInTextArray * 4` bytes of indirect index, then a 32-bit compressed text size and `size * 2` bytes before the database section (`doc/CSBwin-src/SaveGame.cpp`).

## EXPOOL

- `EXPOOL::Locate` hashes keys with `key * 0xbb40e62d`, probes `m[hashi]`/`m[p+1]` for matches, and gets record size from the owning `DB11` block (`size` stored in the block header; record length is `size-2` ui32 words) (`doc/CSBwin-src/data.cpp`).
- The whole structure (the directory block, the free lists, `Write`, `Read` and `enlarge`) is in `doc/PROVEN_FACTS.md` → "`EXPOOL` is a directory block, free lists by record length, and 32 hash chains", and `src/data/CsbwinExpool.ts` is its port. `DungeonData.expool` holds the blocks as the file has them.
- The port writes one kind of record, a champion's bones (`doc/PROVEN_FACTS.md` → "A champion bones record is keyed by the bones' slot in the object indirect index"), and reads the special locations. Every other record a file carries is written back as it was read.

## Byte order: the file is big-endian, the CSB header is not

CSBWin never states the save file's byte order outright. It states it three times over
by construction, all of which assume the Atari's big-endian words:

- `Unscramble` runs its hash arithmetic on `LE16(wordGear(A3))` and XORs with
  `LE16(D7W)` (`doc/CSBwin-src/CSBCode.cpp:9162-9166`).
- `ReadUnscrambleBlock` sums the block-1 header the same way, through `LE16`
  (`doc/CSBwin-src/CSBCode.cpp:9281-9297`).
- `swapBlock1` / `swapBlock2` / `swapCharacter` / `swapITEM16s` then `BO()` every field
  (`doc/CSBwin-src/SaveGame.cpp:463-508`), and `BO` is `LE16`/`LE32`.

`LE16` is a byte swap on a little-endian build and the identity on a big-endian one
(`doc/CSBwin-src/CSBTypes.h:145-157`), so on the PC build CSBWin ships as, all of those
are swaps: **GAMEBLOCK1, GAMEBLOCK2, `ITEM16`, the characters, the timers and the timer
queue are big-endian in the file**, and the scramble keystream is applied to the
big-endian word.

The exception is the CSB-era **"Extended Features" block, which is little-endian** —
`SwapExtendedFeaturesBlock` has a body only `#ifdef _bigEndian`
(`doc/CSBwin-src/SaveGame.cpp:184-201`), so on the shipping build it does nothing and
the block keeps native PC order. A swap function also leaves out whatever it does not
name: `swapCharacter` stops at `shieldStrength`, so a `CHARDESC`'s `talents`,
`fingerPrint`, `causeOfDamage` and `monsterCausingDamage` (276-285) are little-endian
too (`doc/PROVEN_FACTS.md` → "`CHARDESC`'s talents, fingerprint and cause of damage are
little-endian in a save"). A save file is therefore mixed-endian, and the port reads it
that way: `readU16LE`/`readU32LE` for that header (`src/data/CsbwinExtendedFeatures.ts`)
and those four fields (`src/data/CsbwinCharacters.ts`), `readU16BE` everywhere else.

## GAMEBLOCK1 (512 bytes)

`doc/CSBwin-src/SaveGame.cpp:61-105` gives every offset; `SaveGame` fills the block at
`:1083-1144` and `LoadGame` reads it at `:1728-1738` and `:2063-2085`. Byte order is
big-endian except the two fields `swapBlock1` leaves alone (`:443-461`).

| Off | Field | Order | Written from | Read into |
| --- | --- | --- | --- | --- |
| 0 | `Byte740[300]` | — | words 0-127 by `ScrambleAndWrite`: zeros, then word 127 balancing the second half's sum (`:714-758`); 256-299 never | — |
| 300 | `Byte22598` | byte | `(i8)d.Word22598` | `d.Word22598` |
| 301 | `Byte22596` | byte | `ub(d.Word22596)` | `d.Word22596`, or 1: an Atari DM save |
| 302 | `FILL438[4]` | — | never | — |
| 306 | `SaveOption` | **LE** | 1 SAVE AND PLAY, 0 SAVE AND QUIT | — |
| 308 | `RandomGameID` | BE | `d.RandomGameID` | `d.RandomGameID` |
| 312 | five hashes | BE | 0 | open blocks 2-6 |
| 322 | `totalMoveCount` | **LE** | the global | the global |
| 326 | `Hash326`…`342` | — | 0 | — |
| 344 | five checksums | BE | `GenChecksum` of blocks 2-6 | checked |
| 354 | `Checksum354`…`374` | — | never | — |
| 376 | `Word22594` | BE | `d.Word22594` | `d.Word22594` |
| 378 | `Word22592` | BE | `d.Word22592` | `d.Word22592`, or from the dungeon for an Atari save |
| 380 | `Byte22808[132]` | bytes | `d.Byte22808` | `d.Byte22808` |

This port reads every field into `SaveFile.block1` and encodes them back (`encodeBlock1`,
`src/data/SaveFile.ts`); the game holds the `d.` side in `GameState.block1`, which
`buildCsbwinRuntimeState` fills as `LoadGame` does and `buildSaveFile` writes with
`SaveOption` 1. The values, the new game's draw and the Atari branch are in
`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what `SaveGame` writes there, and which two fields
are little-endian", and how `totalMoveCount` counts in "`totalMoveCount` counts every
mouse-queue entry `HandleMouseEvents` takes, once".

## GAMEBLOCK2 (128 bytes)

`doc/CSBwin-src/SaveGame.cpp:108-134` gives every offset; `LoadGame` assigns them at
`:1741-1774`. Offsets are byte offsets into the block.

| Off | Field | Restored to |
| --- | --- | --- |
| 0 | `Time` (i32) | `d.Time`, `d.Long11732` |
| 4 | `ranseed` (i32) | `d.RandomNumber` |
| 8 | `ObjectInHand` | `d.objectInHand`, then through `CursorFilter` |
| 10 | `numcharacter` | `d.NumCharacter` |
| 12 | `partyx` | `d.partyX` |
| 14 | `partyy` | `d.partyY` |
| 16 | `partyfacing` | `d.partyFacing` |
| 18 | `partyLevel` | `d.partyLevel` |
| 20 | `handChar` | `d.HandChar` — the cursor owner, a **champion index**, -1 for none |
| 22 | `MagicCaster` | `d.MagicCaster` |
| 24 | `NumTimer` | `gameTimers.NumTimer` |
| 26 | `FirstAvailTimer` | `gameTimers.FirstAvailTimer` |
| 28 | `MaxTimers` | `gameTimers.Allocate` |
| 30 | `ITEM16QueLen` | `d.ITEM16QueLen` |
| 32 | `LastMonsterAttackTime` (i32) | `d.LastMonsterAttackTime` |
| 36 | `LastPartyMoveTime` (i32) | `d.LastPartyMoveTime` |
| 40 | `partyMoveDisableTimer` | `d.partyMoveDisableTimer` |
| 42 | `Word11712` | `d.Word11712` |
| 44 | `Word11714` | `d.Word11714` |
| 46 | `MaxITEM16` | `d.MaxITEM16` |
| 48 | `TimerSequence` | `gameTimers.TimerSequence` |
| 50 | `FILL180[78]` | — |

`handChar` and `MagicCaster` are assigned **directly**, not through
`SetHandOwner`/`SelectMagicCaster`: those validate the champion and rewrite their
facing, which a load must not do to a state that was already valid.

This port parses **every** field in the table into `SaveFile.block2` and writes
every one of them back: `encodeBlock2` in `src/data/SaveFile.ts` is the exact
inverse of `parseBlock2`, and `buildBlock2FromGame` in `src/engine/SaveGameFile.ts`
fills the struct from the live game — the clock and seed, the party position group,
`FirstAvailTimer` from `TimerQueue`'s free cursor, `ITEM16QueLen` from `MonsterSystem`,
and both times, and `partyMoveDisableTimer` (40), `Word11712` (42) and `Word11714` (44)
from `PartyState`. `ObjectInHand` (8)
goes out as an indirect slot number, re-encoded through the index `buildSaveFile`
builds for the dungeon image beside it — the two have to be one numbering.

A load restores every one of them (`buildCsbwinRuntimeState`, `src/engine/CsbwinSaveGame.ts`).
`LastMonsterAttackTime` is read signed: it is -200 until a monster first attacks.

## What a save file contains, in write order

`SaveGame` writes the whole file in one pass (`doc/CSBwin-src/SaveGame.cpp:1152-1323`).
The first six blocks are **scrambled** (`WriteScrambled`, each with its own hash and
checksum recorded in GAMEBLOCK1); everything after them is plain, accumulated into a
single running checksum by `WriteAndChecksum` and closed by one final word.

| # | Block | Size | Written at |
| --- | --- | --- | --- |
| 0 | "Extended Features" block, `dataTypeMap`/`dataIndexMap`, DSA blocks, DSA level index | 512 + variable | prefix, CSB-era only |
| 1 | GAMEBLOCK1 | 512 | `:1153` |
| 2 | GAMEBLOCK2 | 128 | `:1159` |
| 3 | `d.Item16` | 16 × `MaxITEM16` | `:1168` |
| 4 | `d.CH16482` — characters **and party state** | 3328 | `:1177` |
| 5 | `gameTimers.pTimer(0)` | `sizeof(TIMER)` × `MaxTimer` | `:1186` |
| 6 | `gameTimers.TimerQueue()` | 2 × `MaxTimer` | `:1195` |
| 7 | `d.dungeonDatIndex` | 44 | `:1236` |
| 8 | `d.pLevelDescriptors` | 16 × `NumLevel` | `:1242` |
| 9 | `d.objectListIndex` | 2 × `numColumnPointers` | `:1252` |
| 10 | `d.objectList` | 2 × `ObjectListLength()` | `:1262` |
| 11 | `d.indirectTextIndex` | 4 × `NumWordsInTextArray()` | `:1271` |
| 12 | `d.sizeOfCompressedText` + `d.compressedText` | 4 + 2 × size | `:1280`, `:1288` |
| 13 | all 16 databases' records | `DBSize(n)` × `dbEntrySizes[n]` | `:1297-1313` |
| 14 | `d.cellFlagArray` | `cellflagArraySize` | `:1314` |
| 15 | final checksum word | 2 | `:1320` |

Block 11's index and block 12's size longword are **little-endian**, alone with the
Extended Features header in an otherwise big-endian file: both go out through `BE32`
(`:175-182`, `:1279-1284`), which is the identity on the little-endian build CSBWin ships
as. The compressed text words after the size are written with no swap at all (`:1288`) —
they are the Atari-era 5-bit text array, big-endian in memory and big-endian in the file.
`NumWordsInTextArray` (header `word6`) counts block 11's **index entries**, not text
words: `ConvertToIndirectText` overwrites it with the index length (`:2486`), which is why
a save says 125 where `dungeon.dat` says 1749.

Block 15 is the sum of every **byte** of blocks 7-14 modulo 65536 — `WriteAndChecksum`
accumulates each section's bytes into a `ui16` from zero and adds that into a running
total (`:687-706`), which is reset to 0 just before block 7 (`:1234`) — written
big-endian.

Blocks 7-14 are the dungeon image, and they are the bulk of the file.

Two things are written to EXPOOL (block 13's `dbEXPOOL`) just before, rather than to a
block of their own: the DSA **global variables**, sixteen at a time into the records
`(EDT_Database<<24)|(EDBT_GlobalVariables<<16)|i` the dungeon has (`:1205-1213`), whose
number a read takes as theirs (`doc/PROVEN_FACTS.md` → "The DSA global variables are the
`EXPOOL` records a read finds"), and the 24 overlay
**palette** records under `(EDT_Palette<<24)+i` (`:1216-1231`), each `Read` out and
`Write`n back, which a read takes when all 24 are there (`:1931-1959`;
`doc/PROVEN_FACTS.md` → "`EXPOOL` is a directory block, free lists by record length, and
32 hash chains").

### Block 4 is not only the champions

The 3328 bytes starting at `d.CH16482` are `CHARDESC[4]` — 800 bytes each, so 3200 —
followed by **128 bytes of party-wide state** that happens to sit next to them in
`Data.h`. The struct comments mark the span exactly: `// 3328 bytes read into byte16482`
at `doc/CSBwin-src/Data.h:780` opens it and
`///////////// End of Character portion of save file /////////////` at `:798` closes it.
What rides along in those 128 bytes:

`Brightness`, `SeeThruWalls`, `MagicFootprintsActive`, `PartyShield`, `FireShield`,
`SpellShield`, `NumFootprintEnt`, `freezeLifeTimer`, `IndexOfFirstMagicFootprint`,
`IndexOfLastMagicFootprint`, `PartyFootprints[24]`, `Byte13220[24]`, `Invisible`,
`Byte13195[41]`.

So the footprint trail (`src/engine/PartyFootprints.ts`) and the shield/light timers are
part of the *character* block, not a block of their own — worth knowing before going
looking for them elsewhere.

### The last 464 bytes of each `CHARDESC` are the portrait bitmap

`i8 portrait[1]` at 336 plus `FILL337[800-337]` is one field of 464 bytes — `32*29/2`,
a four-bitplane 32x29 picture, unswapped, in Atari order. The champion carries the
picture itself; there is no portrait index in the struct, and for a portrait supplied
from `CSBgraphics.dat` there never was one. `doc/PROVEN_FACTS.md`, "`CHARDESC` carries
the champion's portrait as pixels, not an index", has the citations and the plane
layout; `src/data/CsbwinCharacters.ts` reads it and `tools/checks/portraits.ts` proves it
reaches the status box.

## What the port writes and reads

`writeSaveFile` (`src/data/SaveFile.ts`) writes all sixteen blocks, scrambled
and checksummed as CSBWin's are, and `toSaveFile` (`src/engine/SaveGameFile.ts`) hands
it every block plain: block 0 built from the Extended Features header
(`buildLiveExtendedFeatures`, `src/data/CsbwinExtendedFeatures.ts`) and the world's object
indirect index as it holds it, blocks 1 to 6 encoded from the live game, and the dungeon
image, so the game's own save writes a whole file. `readSaveFile` reads them back, each
block's plain bytes beside what it says, all of them required. `fromSaveFile` (`src/engine/CsbwinSaveGame.ts`)
reads one back: `readCsbwinWorld` (`src/data/CsbwinDungeonImage.ts`) parses the image,
`src/data/CsbwinCharacters.ts` unpacks `CHARDESC[4]` and the party tail, portraits
included, and the world keeps the file's object indirect index, of which every RN in a
save is a slot, not a packed RN ("Every object reference in a save is an indirect
index"). An original dungeon is converted on load as CSBWin converts it
(`src/data/CsbwinDungeonConversions.ts`: `ConvertToIndirectText`, `MakeBigActuators`,
`ConvertListOfObjects` over the cell chains, `convertScrolls`, each behind CSBWin's own
gate), so the world in memory is always save-shaped, never `dungeon.dat`-shaped.
When a layout does not close, save files made to order give the anchors: a fresh game
diffed against `dungeon.dat` is how the image was solved, and the section that seemed
wrong turned out to be three (`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save
file").

Against the write order above, over `dungeon.dat` and the eight saves of
`tools/fixtures/`:

| Block | What it holds | State |
| --- | --- | --- |
| 0 | Extended Features, `dataTypeMap`/`dataIndexMap`, DSA blocks | ✅ byte-identical: header, both maps, the game info and the DSA level index with its 0xff terminator |
| 1 | GAMEBLOCK1 | ✅ every field; byte-identical outside the bytes `SaveGame` never assigns |
| 2 | GAMEBLOCK2 (128 b) | ✅ all 21 fields, byte-identical; `ObjectInHand` an indirect slot, `RNnul` when empty |
| 3 | ITEM16 | ✅ |
| 4 | characters + party tail | ✅ byte-identical, the thirty possession slots written as indirect slots |
| 5 | timers | ✅ the whole `TIMER`, in all three sizes, byte-identical bar `unused13` in a freed slot |
| 6 | timer queue | ✅ byte-identical over the live `NumTimer` entries; the debris past them is not reproduced |
| 7 | image header (`DUNGEONDATINDEX`, 44 b) | ✅ byte-identical |
| 8 | level descriptors (16 b x `NumLevel`) | ✅ byte-identical |
| 9 | column index (`objectListIndex`) | ✅ byte-identical |
| 10 | object list (`d.objectList`) | ✅ byte-identical |
| 11 | indirect text index | ✅ byte-identical. Little-endian longwords |
| 12 | `sizeOfCompressedText` + the text | ✅ byte-identical. Little-endian size word, big-endian text |
| 13 | the sixteen databases | ✅ byte-identical bar a free record's second RN (below) |
| 14 | cell flags (`cellFlagArray`) | ✅ byte-identical; `cellFlagArraySize` computes the 12366 every file declares |
| 15 | final checksum word | ✅ `buildImageChecksum`, proved against each save's own closing word |

**Block 0** carries two things through as they were read rather than writing them again,
the DSA section and the game-info string, and one field as it was read
rather than derived: `gameInfoSize` is signed, and -1 means an empty game info that still
exists, which is not the 0 that means none (`doc/PROVEN_FACTS.md` →
"`EXTENDEDFEATURESBLOCK` offsets, and `gameInfoSize` is signed"). A block whose `flags`
hold `SimpleEncryption` marks the whole file enciphered: it is read deciphered and written
enciphered, every byte by its position, the block included (`readExtendedFeatures`,
`doc/CSBwin-src/SaveGame.cpp:326-340`, `:939-946`, `system.cpp:301-329`).

**Block 5** is the 16-byte `TIMER` in whichever of the three sizes the Extended Features
flags select. **Block 6** is the queue array, which CSBWin keeps as a binary heap and
never reorders on load (`doc/PROVEN_FACTS.md` → "CSBWin's timer queue is a binary heap");
the port keeps the same heap, and writes its array.

**Blocks 7-15** are built by `src/data/CsbwinDungeonImageWriter.ts`, the inverse of the
reader section by section. `cellFlagArraySize` computes the length the Extended Features
block declares, which is also `dungeon.dat`'s own `LegacyCellFlagArraySize`. The image
holds thirteen fields `dungeon.dat`'s parsers had no other use for, none of which can be
derived, and the whole of `EXPOOL` (`doc/PROVEN_FACTS.md` → "Three fields of the dungeon
image header no reader here was keeping" and "Ten more fields the record parsers were
dropping").

**A free record's second RN** — a deleted monster's possessions, a chest's contents, a
missile's flying object, a scroll's text — is read as `RNnul` and written so, where the
file holds whatever slot it named when the record was freed. Every other RN of blocks 10
and 13 is the file's own word, since the port keeps a save's slots and maps as read.
<sub>`doc/PROVEN_FACTS.md` → "An RN in block 10 or block 13 is the file's own word".</sub>

**Reported rather than asserted**, each for a sourced reason: `TIMER.unused13` in a freed
slot and the timer queue past `NumTimer`, both CSBWin allocation debris
(`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is 0xcd in a slot that has been used");
block 1's bytes `SaveGame` never assigns (`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what
`SaveGame` writes there, and which two fields are little-endian"); and a converted
scroll's `m_word4` bits 1-15, which `convertScrolls` leaves as debris in a genuine save
and the port writes as zero.

**What a file of the port's does not carry**, or the port does not read:

- The DSA tracing flags `WriteDSAs` puts beside the DSAs, postponed with CSBWin's other
  debugging features (`DEBT.md` → "Priority").
- `MakeBigActuators`' read of the actuator type before the byte swap (`DEBT.md` H).

### Evidence

`tools/fixtures/` holds eight genuine CSBWin saves, seven made to order for a check and
one of real play (`tools/lib/saves.ts`). They are files this project did not write, so a
bug the port's reader and writer share cannot satisfy them.

- `tools/checks/csbwin-save.ts`: those eight and Chaos Strikes Back's two read. Blocks 0-6
  unscramble with every checksum clean, the party position, clock, seed, timer counters
  and every champion's name and title come out of blocks 2 and 4, and saves of the same
  party read back as the same roster.
- `tools/checks/save-file-roundtrip.ts`: each of the eight parsed, all sixteen blocks
  written again and read back by the port's own reader, field for field.
- `tools/checks/save-blocks-vs-file.ts` (blocks 0-6), `tools/checks/character-block.ts`
  (block 4) and `tools/checks/dungeon-image-blocks.ts` (blocks 7-15): written again from
  what was read, and compared with the file's own bytes.
- `tools/checks/live-save-file.ts`: a game played out of `dungeon.dat` and one played on
  from `csbgame7.dat`, each written and loaded into a fresh engine, with the world, the
  party, a thrown object in flight and the object on the cursor intact. Its scenario 2
  holds the monster state to a fixed point rather than to the played game, because a load
  re-creates every group's movement timers and re-rolls their walk offsets, as CSBWin's
  does.
- `tools/checks/csbwin-world.ts` (every object chain of every save),
  `tools/checks/csbwin-party.ts` (every possession slot names a live record),
  `tools/checks/csbwin-load.ts` (each save restored into a real `Game` and asked where the
  party is, what it carries and what every cell holds), `tools/checks/csbwin-timers.ts`
  (two saves whose door timers differ in one byte: one door opens, the other shuts),
  `tools/checks/dungeon-conversions.ts` (the conversions against the saves' converted
  form) and `tools/checks/save-roundtrip.ts` (the file a save is, saved and loaded:
  five cycles that leave the timer table the same size, and three played games whose
  every difference after a load is on the list of what a file does not hold).


## The dungeon image in a save

The image is plain and uncompressed — `LoadGame` calls `ReadDatabases()`
after the timer queue (`doc/CSBwin-src/SaveGame.cpp:1909`) with
`d.gameState == GAMESTATE_ResumeSavedGame`, which skips that function's own
extended-features/compression preamble (`:2557-2586`); the `ExpandData` path with magic
`33028` belongs to `dungeon.dat`, not to saves.

The full section layout, the two record sizes that differ from `dungeon.dat`
(ACTUATOR 10 with `bigActuators`, SCROLL 6 from version `'B'`) and the little-endian
indirect-text block are written up in `doc/PROVEN_FACTS.md` → "The dungeon image
layout in a save file". `computeDungeonImageLayout` in `src/data/DungeonImageLayout.ts`
implements it, for the reader, a save's read and `Chaos` alike, and `tools/checks/csbwin-save.ts` checks that the section lengths sum
exactly to `EOF - 2` on every save it reads, the eight of `tools/fixtures/` and Chaos
Strikes Back's two.

`loadCsbwinWorld` in `src/data/CsbwinDungeonImage.ts`
reads a genuine save into a real `DungeonData` — header, level descriptors, column
index, object list, indirect text, all sixteen databases and the cell flags. It does
not reimplement the records' codecs: the image *is* `dungeon.dat`'s structure, so it
hands the byte range to `DungeonLoader` with a `DungeonImageOptions` describing the
three differences (big actuators, new scrolls, indirect text) that the Extended
Features block declares.

`tools/checks/csbwin-world.ts` is the evidence. The saves taken at the first moment the
game allows one still hold `dungeon.dat`'s world, and they read back with **zero**
differing cell flags across all 12087 cells of all 14 levels; the played saves differ
by 82 to 733 cells, rising with how far into the game they were taken.


## Every object reference in a save is an indirect index

**An RN in a CSBWin save is not a packed
`[position:2][category:4][index:10]`**. `class RN` holds a single `ui16` and resolves it
through two global arrays, `dataTypeMap` and `dataIndexMap`, which travel in the save's
Extended Features block immediately after the 512-byte header
(`ReadExtendedFeatures`, `doc/CSBwin-src/SaveGame.cpp:357-378`). The full account, with
the byte order, the free-slot marker and the slots that alias, is `doc/PROVEN_FACTS.md`
→ "An RN in a save file is an indirect index". The port's RN is the same slot: the
world keeps the file's maps as its `RnMaps` (`src/core/RnMaps.ts`,
`src/data/CsbwinObjectIndex.ts`, handed to `DungeonLoader` as
`DungeonImageOptions.objectIndex`), and every RN is read as the slot it is.


## The load

`src/engine/CsbwinSaveGame.ts` (`fromSaveFile`, and `applyCsbwinSave` from the bytes)
restores a genuine save into a running `Game`: the image becomes the world, the seven
things the save carries beside it written into it, and `GAMEBLOCK2` and block 4 become
the `RuntimeState` beside it (`buildCsbwinRuntimeState`), both read through `readGame`,
the path every read takes. The
port's own save is such a file and loads the same way: `applySaveBytes` in
`src/engine/SaveGameFile.ts` is what the disk menu's LOAD and F9 call
(`doc/SAVES.md`).

`tools/checks/csbwin-load.ts` is the evidence: all eight saves of `tools/fixtures/` are
restored into a real `Game` and the *live engine* is then asked where the party is, who
it is, what its cell holds, and whether every cell flag in all fourteen maps is the
save's.

What a load does **not** carry is listed in `src/engine/CsbwinSaveGame.ts` → "What is
not restored": what no CSBWin file holds
(`d.Word11694`, `d.PartySleeping`, `d.PendingDamage` and `d.PendingOuches`, the open
inventory).
