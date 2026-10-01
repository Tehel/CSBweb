# CSBWin Save/Extended Data Reference (Sourced)

This document captures verified save/extended data behaviors from the CSBWin C++ source under `doc/CSBwin-src/`.

## Extended features block

- `ReadExtendedFeatures` reads the 512-byte `EXTENDEDFEATURESBLOCK`, followed by `dataTypeMap`, `dataIndexMap`, DSA blocks (`ReadDSAs`), optional `ReadDSALevelIndex`, and sets `sequencedTimers`/`extendedTimers` from `extendedFlags` (bits `0x20`/`0x80`) (`doc/CSBwin-src/SaveGame.cpp`).
- `ReadDSALevelIndex` consumes 3-byte triples until `level > 63`, storing `DSALevelIndex[level][selector] = dsaIndex` (`doc/CSBwin-src/SaveGame.cpp`).

## Database read order

- `ReadDatabases` reads the 44-byte `DUNGEONDATINDEX`, map descriptors, object list, and text data before database records; when `indirectText` is set (extended features flag `IndirectText`), it reads `NumWordsInTextArray * 4` bytes of indirect index, then a 32-bit compressed text size and `size * 2` bytes before the database section (`doc/CSBwin-src/SaveGame.cpp`).

## EXPOOL hash lookup

- `EXPOOL::Locate` hashes keys with `key * 0xbb40e62d`, probes `m[hashi]`/`m[p+1]` for matches, and gets record size from the owning `DB11` block (`size` stored in the block header; record length is `size-2` ui32 words) (`doc/CSBwin-src/data.cpp`).

## Byte order: the file is big-endian, the CSB header is not

CSBWin never states the save file's byte order outright. It states it three times over
by construction, all of which assume the Atari's big-endian words:

- `Unscramble` runs its hash arithmetic on `LE16(wordGear(A3))` and XORs with
  `LE16(D7W)` (`doc/CSBwin-src/CSBCode.cpp:9057-9061`).
- `ReadUnscrambleBlock` sums the block-1 header the same way, through `LE16`
  (`doc/CSBwin-src/CSBCode.cpp:9083-9098`).
- `swapBlock1` / `swapBlock2` / `swapCharacter` / `swapITEM16s` then `BO()` every field
  (`doc/CSBwin-src/SaveGame.cpp:455-500`), and `BO` is `LE16`/`LE32`.

`LE16` is a byte swap on a little-endian build and the identity on a big-endian one
(`doc/CSBwin-src/CSBTypes.h:140-152`), so on the PC build CSBWin ships as, all of those
are swaps: **GAMEBLOCK1, GAMEBLOCK2, `ITEM16`, the characters, the timers and the timer
queue are big-endian in the file**, and the scramble keystream is applied to the
big-endian word.

The exception is the CSB-era **"Extended Features" block, which is little-endian** —
`SwapExtendedFeaturesBlock` has a body only `#ifdef _bigEndian`
(`doc/CSBwin-src/SaveGame.cpp:183-200`), so on the shipping build it does nothing and
the block keeps native PC order. A save file is therefore mixed-endian, and the port
reads it that way: `readU16LE`/`readU32LE` for that one header
(`src/data/CsbwinExtendedFeatures.ts`), `readU16BE` everywhere else.

## GAMEBLOCK1 (512 bytes)

`doc/CSBwin-src/SaveGame.cpp:60-104` gives every offset; `SaveGame` fills the block at
`:1058-1107` and `LoadGame` reads it at `:1603-1614` and `:1859-1881`. Byte order is
big-endian except the two fields `swapBlock1` leaves alone (`:435-453`).

| Off | Field | Order | Written from | Read into |
| --- | --- | --- | --- | --- |
| 0 | `Byte740[300]` | — | words 0-127 by `ScrambleAndWrite`: zeros, then word 127 balancing the second half's sum (`:706-750`); 256-299 never | — |
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

This port reads every field into `SaveGameState.block1` and writes them back
(`src/data/SaveGameLoader.ts`); the game holds the `d.` side in `GameState.block1`, which
`buildCsbwinRuntimeState` fills as `LoadGame` does and `buildSavePayload` writes with
`SaveOption` 1. The values, the new game's draw and the Atari branch are in
`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what `SaveGame` writes there, and which two fields
are little-endian", and how `totalMoveCount` counts in "`totalMoveCount` counts every
mouse-queue entry `HandleMouseEvents` takes, once".

## GAMEBLOCK2 (128 bytes)

`doc/CSBwin-src/SaveGame.cpp:107-133` gives every offset; `LoadGame` assigns them at
`:1617-1650`. Offsets are byte offsets into the block.

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

This port parses **every** field in the table into `SaveGameState.block2` and now writes
every one of them back: `buildBlock2` in `src/data/SaveGameLoader.ts` is the exact
inverse of `parseBlock2`, and `buildBlock2FromGame` in `src/engine/SaveGamePayload.ts`
fills the struct from the live game — the clock and seed, the party position group,
`FirstAvailTimer` from `TimerQueue`'s free cursor, `ITEM16QueLen` from `MonsterSystem`,
and both times, and `partyMoveDisableTimer` (40), `Word11712` (42) and `Word11714` (44)
from `PartyState`. `ObjectInHand` (8)
goes out as an indirect slot number, re-encoded through the index `buildSavePayload`
builds for the dungeon image beside it — the two have to be one numbering.

The four the *loader* acts on are still 20, 22, 28 and 46; the rest are read so a genuine
save can be inspected (`tools/dump-csbwin-save.ts` prints the party position, clock, seed
and timer counters from them) but nothing is restored from them yet — the runtime half of
a quick-save still carries those values.

## What a save file contains, in write order

`SaveGame` writes the whole file in one pass (`doc/CSBwin-src/SaveGame.cpp:1110-1225`).
The first six blocks are **scrambled** (`WriteScrambled`, each with its own hash and
checksum recorded in GAMEBLOCK1); everything after them is plain, accumulated into a
single running checksum by `WriteAndChecksum` and closed by one final word.

| # | Block | Size | Written at |
| --- | --- | --- | --- |
| 0 | "Extended Features" block, `dataTypeMap`/`dataIndexMap`, DSA blocks, DSA level index | 512 + variable | prefix, CSB-era only |
| 1 | GAMEBLOCK1 | 512 | `:1111` |
| 2 | GAMEBLOCK2 | 128 | `:1116` |
| 3 | `d.Item16` | 16 × `MaxITEM16` | `:1121` |
| 4 | `d.CH16482` — characters **and party state** | 3328 | `:1126` |
| 5 | `gameTimers.pTimer(0)` | `sizeof(TIMER)` × `MaxTimer` | `:1131` |
| 6 | `gameTimers.TimerQueue()` | 2 × `MaxTimer` | `:1136` |
| 7 | `d.dungeonDatIndex` | 44 | `:1168` |
| 8 | `d.pLevelDescriptors` | 16 × `NumLevel` | `:1173` |
| 9 | `d.objectListIndex` | 2 × `numColumnPointers` | `:1178` |
| 10 | `d.objectList` | 2 × `ObjectListLength()` | `:1183` |
| 11 | `d.indirectTextIndex` | 4 × `NumWordsInTextArray()` | `:1188` |
| 12 | `d.sizeOfCompressedText` + `d.compressedText` | 4 + 2 × size | `:1193`, `:1197` |
| 13 | all 16 databases' records | `DBSize(n)` × `dbEntrySizes[n]` | `:1203-1215` |
| 14 | `d.cellFlagArray` | `cellflagArraySize` | `:1216` |
| 15 | final checksum word | 2 | `:1222` |

Block 11's index and block 12's size longword are **little-endian**, alone with the
Extended Features header in an otherwise big-endian file: both go out through `BE32`
(`:174-181`, `:1192-1194`), which is the identity on the little-endian build CSBWin ships
as. The compressed text words after the size are written with no swap at all (`:1197`) —
they are the Atari-era 5-bit text array, big-endian in memory and big-endian in the file.
`NumWordsInTextArray` (header `word6`) counts block 11's **index entries**, not text
words: `ConvertToIndirectText` overwrites it with the index length (`:2274`), which is why
a save says 125 where `dungeon.dat` says 1749.

Block 15 is the sum of every **byte** of blocks 7-14 modulo 65536 — `WriteAndChecksum`
accumulates each section's bytes into a `ui16` from zero and adds that into a running
total (`:679-698`), which is reset to 0 just before block 7 (`:1166`) — written
big-endian.

Blocks 7-14 are the dungeon image, and they are the bulk of the file.

Two things are written to EXPOOL (block 13's `dbEXPOOL`) just before, rather than to a
block of their own: the 100 DSA **global variables**, sixteen at a time under
`(EDT_Database<<24)|(EDBT_GlobalVariables<<16)|i` (`:1141-1148`), and the 24 overlay
**palette** records under `(EDT_Palette<<24)+i` (`:1151-1162`).

### Block 4 is not only the champions

The 3328 bytes starting at `d.CH16482` are `CHARDESC[4]` — 800 bytes each, so 3200 —
followed by **128 bytes of party-wide state** that happens to sit next to them in
`Data.h`. The struct comments mark the span exactly: `// 3328 bytes read into byte16482`
at `doc/CSBwin-src/Data.h:765` opens it and
`///////////// End of Character portion of save file /////////////` at `:783` closes it.
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
layout; `src/data/CsbwinCharacters.ts` reads it and `tools/dump-portraits.ts` proves it
reaches the status box.

## How much of this the port writes today

`saveSaveGameState` (`src/data/SaveGameLoader.ts`) produces a real, correctly scrambled
and checksummed **whole file** — all sixteen blocks — and the game's own save button
writes one. Of what it emits:

- blocks 1, 3 — complete.
- block 2 — **complete**, and byte-identical to all fourteen committed saves. It used to
  be offsets 20, 22, 24, 28, 46 and 48 only, with the other fifteen fields at zero, so a
  file this port wrote put the party at (0,0) facing north on level 0 with the clock
  stopped. Three fields it writes as zero are zero because nothing here models them —
  see the `GAMEBLOCK2` table above. `ObjectInHand` is an indirect slot number, encoded
  through the same index as the image beside it.
- block 4 — **complete**, and byte-identical to the real thing:
  `buildCsbwinCharacterBlock` packs `CHARDESC[4]` and the 128-byte party tail, portrait
  bitplanes included, and `tools/dump-character-block.ts` writes the block again for each
  of the fourteen committed saves and compares it with the file's own bytes. The thirty
  possession slots go out as indirect slot numbers through `encodeRN` (see "Every object
  reference in a save is an indirect index"), in the same index the dungeon image beside
  them uses — `buildSavePayload` builds the two together for exactly that reason.
  Everything else is CSBWin's layout exactly.
- block 5 — **complete**. The whole 16-byte `TIMER`, in whichever of the three sizes the
  Extended Features flags select. It used to write `timerWord8` (offset 8) and nothing
  else, so a file this project wrote said when nothing was due.
- block 6 — **complete**: the queue array, which CSBWin keeps as a binary heap and never
  reorders on load (`doc/PROVEN_FACTS.md` → "CSBWin's timer queue is a binary heap"). The
  port keeps the same heap, and writes its array.
- block 0 — **complete**, and byte-identical to all fourteen committed saves. The
  512-byte header, `dataTypeMap`, `dataIndexMap`, the game info and the DSA level index
  with its three-byte 0xff terminator; `src/data/CsbwinExtendedFeatures.ts` has the whole
  layout and the write order. Two things ride through verbatim rather than being
  re-serialized — the DSA section and the game-info string — and one field had to be
  carried rather than derived: `gameInfoSize` is signed and **-1** means "an empty game
  info that still exists", which is not the same as the 0 that means "none"
  (`csbgame3.dat` is the case).

  `buildObjectIndirectIndex` is the other half: it builds the two maps for a world this
  port holds in memory, which is what blocks 10-13 will express their RNs through. Its
  numbering is its own — CSBWin's cannot be reproduced, and does not need to be, since
  nothing outside the file refers to a slot number. It gives every record of every
  database a slot in `DBType` then index order, leaves slot 0 free as
  `ConvertListOfObjects` does, and carries each object's position in `dataTypeMap` rather
  than in the slot, because `RN::pos(p)` writes that byte in place
  (`doc/CSBwin-src/CSBTypes.h:336-342`).
- blocks 7-15 — **the whole dungeon image is built**, by
  `src/data/CsbwinDungeonImageWriter.ts`, which is the inverse of the reader section by
  section: the 44-byte `DUNGEONDATINDEX`, the 16-byte `LEVELDESC`s, the column index, the
  object list, the little-endian indirect text index and the compressed text, all sixteen
  databases, the cell flag array with its per-level monster-type and decoration tables,
  and `WriteAndChecksum`'s closing word. `cellFlagArraySize` computes the length the
  Extended Features block declares — 12366 on every file this project holds, which is also
  `dungeon.dat`'s own `LegacyCellFlagArraySize`.

  **Six of the eight sections are byte-identical**, to `dungeon.dat` as well as to all
  fourteen saves. Blocks 10 and 13 cannot be: every word of the object list and the link
  word of every database record is an RN, and an RN in a save is a slot number in an index
  whose numbering is ours rather than CSBWin's (see "Every object reference in a save is
  an indirect index"). For those words the check is different in kind — the maps are
  written, read back through `readObjectIndirectIndex`, and each word resolved through
  them must name the object the reader got out of CSBWin's word. Every byte that is not an
  RN is still compared with the file, and `dungeon.dat`, which stores packed RNs and needs
  no index at all, has those words byte-compared too.

  Block 15 gets the sharpest check of the lot, and needs no caveat: the checksum is
  computed over each save's **own** image bytes and compared with the word that save ends
  with.

  Writing all this found thirteen fields the loader had been discarding, none of them
  reconstructible, plus the whole of `EXPOOL`, which had no parser at all. The list and
  the citations are in `doc/PROVEN_FACTS.md` → "Three fields of the dungeon image header
  no reader here was keeping" and "Ten more fields the record parsers were dropping".

  `saveSaveGameState` takes the image as `SaveGameState.dungeonImage` and closes the file
  with block 15, so **a whole file can be written** — and
  `tools/dump-save-file-roundtrip.ts` writes all sixteen blocks of each committed save and
  loads the result back with this port's own reader, world and party intact (605 checks).
  Two things had to join it: `buildObjectIndirectIndex` takes the references CSBWin's
  `ConvertTimers` / `ConvertCharacters` / `objectInHand` passes convert, so a carried
  object's *position* lands in `dataTypeMap`, and `buildCsbwinCharacterBlock` takes an
  `encodeRN` so the thirty possession slots go out as slot numbers.

  **The live path is wired** (September 14th). `buildSavePayload` builds the object
  indirect index, the image, the Extended Features header and the character block
  together — they are one numbering — and `tools/dump-live-save-file.ts` writes a file
  from a game played out of `dungeon.dat` and one from a game played on from a genuine
  save, then loads both back into a running engine. What unblocked it was CSBWin's three
  load-time conversions: `ConvertToIndirectText`, `MakeBigActuators` and `convertScrolls`
  are ported (`src/data/CsbwinDungeonConversions.ts`) and run behind CSBWin's own gates,
  so a world in memory is always save-shaped rather than `dungeon.dat`-shaped.
  `PLAN.md` Phase 10 has the detail.

`readExtendedFeatures` (`src/data/CsbwinExtendedFeatures.ts`) reads block 0 in full, and blocks 7-14 are now fully **read** —
`src/data/CsbwinDungeonImage.ts` parses the image into a real `DungeonData`. An earlier
revision of this file claimed the two functions that reach into
the image, `parseSpecialLocationsFromSaveData` and `parseMissileRecordsFromSaveData`,
"already navigate the whole dungeon image correctly". **That was wrong**, and reading
genuine saves is what showed it: both return `null` on all three files, so the `0`
they used to report for missiles and special locations meant "parse failed", not
"none present". See "Where the dungeon image parse stands" below.

**The reader is now proven against genuine files.** `static/gamefiles/saves/` holds
fourteen real CSBWin saves and `tools/dump-csbwin-save.ts` reads them: blocks 0-6
unscramble with every checksum clean, and the party position, clock, seed, timer
counters and all four champions' names and titles come out of blocks 2 and 4. Two of
the saves are the same party on different levels and read back as the same roster.

That exercise found three reader bugs no self-round-trip could have — `spellFilterLocation`
and `extendedFlags` read one field too far, and `gameInfoSize` read unsigned when
CSBWin writes -1 for "none" — both written up in `doc/PROVEN_FACTS.md`. It is the
argument for keeping a real file in the repository: the two older saves happen to be
zero in the misread words, so it took the third to expose it.

Everything blocks 7-14 would carry is held at runtime and captured by
`src/engine/DungeonSnapshot.ts`, so what is left of Phase 10 is a serialization job rather
than a state-modelling one. The caveat that used to sit here — that nothing had ever been
validated against a genuine CSBWin file, and a format that only round-trips through itself
proves nothing — is answered for the reader *and* for every block the writer emits.
`tools/dump-save-blocks-vs-file.ts` parses each of the fourteen committed saves, writes
blocks 1-6 again from what came out, and compares them with the file's own bytes: **all
six are identical in all fourteen**. Three exemptions are named and sourced rather than
compared away: block 1's bytes `SaveGame` never assigns, and `TIMER.unused13` in a freed
slot and the timer queue past `NumTimer`, both allocation debris CSBWin never reads back
(`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is 0xcd in a slot that has been used"), with
block 1's checksums of that debris.

Writing that harness immediately found two defects in blocks marked complete: block 5 wrote
zeros into `unused13` where a real file holds 0xcd, and block 6's tail was never looked at
at all. Block 1 is compared the same way: every field it carries is asserted, and the
bytes `SaveGame` never assigns are reported, since two of the saves carry 0xba there
(`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what `SaveGame` writes there, and which two fields
are little-endian").


## Where the dungeon image parse stands

**Solved.** The image is plain and uncompressed — `LoadGame` calls `ReadDatabases()`
after the timer queue (`doc/CSBwin-src/SaveGame.cpp:1739`) with
`d.gameState == GAMESTATE_ResumeSavedGame`, which skips that function's own
extended-features/compression preamble (`:2345-2374`); the `ExpandData` path with magic
`33028` belongs to `dungeon.dat`, not to saves.

The full section layout, the two record sizes that differ from `dungeon.dat`
(ACTUATOR 10 with `bigActuators`, SCROLL 6 from version `'B'`) and the little-endian
indirect-text block are written up in `doc/PROVEN_FACTS.md` → "The dungeon image
layout in a save file". `computeDungeonImageLayout` in `src/data/SaveGameLoader.ts`
implements it, and `tools/dump-csbwin-save.ts` checks that the section lengths sum
exactly to `EOF - 2` on every committed save — twelve of them, DM only so far.

**The whole image now parses.** `loadCsbwinWorld` in `src/data/CsbwinDungeonImage.ts`
reads a genuine save into a real `DungeonData` — header, level descriptors, column
index, object list, indirect text, all sixteen databases and the cell flags. It does
not reimplement the record parsers: the image *is* `dungeon.dat`'s structure, so it
hands the byte range to `DungeonLoader` with a `DungeonImageOptions` describing the
three differences (big actuators, new scrolls, indirect text) that the Extended
Features block declares.

`tools/dump-csbwin-world.ts` is the evidence. The saves taken at the first moment the
game allows one still hold `dungeon.dat`'s world, and they read back with **zero**
differing cell flags across all 12087 cells of all 14 levels; the played saves differ
by 82 to 733 cells, rising with how far into the game they were taken.


## Every object reference in a save is an indirect index

The last thing standing between "the image parses" and "the save loads", and the one
that looked like a reader bug for longest: **an RN in a CSBWin save is not a packed
`[position:2][category:4][index:10]`**. `class RN` holds a single `ui16` and resolves it
through two global arrays, `dataTypeMap` and `dataIndexMap`, which travel in the save's
Extended Features block immediately after the 512-byte header
(`ReadExtendedFeatures`, `doc/CSBwin-src/SaveGame.cpp:355-376`). The full account, with
the byte order, the free-slot marker and the two ways it can legitimately fail, is
`doc/PROVEN_FACTS.md` → "An RN in a save file is an indirect index"; the implementation
is `src/data/CsbwinObjectIndex.ts`, threaded into `DungeonLoader` through
`DungeonImageOptions.resolveRN` so that every RN is translated as it is read.


## Where the load stands

**Done.** `src/data/CsbwinSaveGame.ts` (`applyCsbwinSave`) restores a genuine save into
a running `Game`: it builds a `RuntimeSaveState` from `GAMEBLOCK2`, block 4 and the
image, and hands it to `Game.applyRuntimeSaveState` — the same path the quick-save has
used since format v2 — rather than swapping `Game.state.dungeon`, which half the engine
holds by reference. `applySaveBytes` in `src/engine/SaveGamePayload.ts` decides between
the two formats, so the disk menu's LOAD and F9 both act on a `.dat`.

`tools/dump-csbwin-load.ts` is the evidence: all twelve committed saves are restored
into a real `Game` and the *live engine* is then asked where the party is, who it is,
what its cell holds, and whether every cell flag in all fourteen maps is the save's.

What a load still does **not** carry is listed in `PLAN.md` → Phase 10 → "Deferred": the
DSA global variables in `EXPOOL`, `d.Word11694` and `d.PartySleeping`.
