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
(`doc/CSBwin-src/SaveGame.cpp:275-293`), so on the shipping build it does nothing and
the block keeps native PC order. A save file is therefore mixed-endian, and
`SaveGameLoader` reads it that way: `readU16LE`/`readU32LE` for that one header,
`readU16BE` everywhere else.

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

This port now parses **every** field in the table into `SaveGameState.block2`; the four
it acts on are 20, 22, 28 and 46. The rest are read so a genuine save can be inspected
(`tools/dump-csbwin-save.ts` prints the party position, clock, seed and timer counters
from them) but nothing is restored from them yet — the runtime half of a quick-save
still carries those values, and Phase 10 is where they move here.

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
and checksummed file **prefix** and stops at the end of block 6. Of what it emits:

- blocks 1, 3 — complete.
- block 2 — offsets 20, 22, 28 and 46 only; the other eighteen fields are zero.
- block 4 — **complete**, and byte-identical to the real thing:
  `buildCsbwinCharacterBlock` packs `CHARDESC[4]` and the 128-byte party tail, portrait
  bitplanes included, and `tools/dump-character-block.ts` writes the block again for each
  of the fourteen committed saves and compares it with the file's own bytes. The one
  reservation is the thirty possession slots: in a file they are indirect slot numbers
  (see "Every object reference in a save is an indirect index"), and re-encoding them
  needs the `dataTypeMap`/`dataIndexMap` that travel with the dungeon image, which the
  writer does not produce yet — so a block packed from a *live* game holds this port's
  packed `[pos][db][idx]` ids. Everything else is CSBWin's layout exactly.
- block 5 — `timerWord8` (offset 8) of each record only; the rest of each `TIMER` is zero.
- block 6 — zeros.
- blocks 0 and 7-15 — not written at all.

`readExtendedFeatures` reads block 0 in full, and blocks 7-14 are **located** but not
yet parsed. An earlier revision of this file claimed the two functions that reach into
the image, `parseSpecialLocationsFromSaveData` and `parseMissileRecordsFromSaveData`,
"already navigate the whole dungeon image correctly". **That was wrong**, and reading
genuine saves is what showed it: both return `null` on all three files, so the `0`
they used to report for missiles and special locations meant "parse failed", not
"none present". See "Where the dungeon image parse stands" below.

**The reader is now proven against genuine files.** `static/gamefiles/saves/` holds
three real CSBWin saves and `tools/dump-csbwin-save.ts` reads all three: blocks 0-6
unscramble with every checksum clean, and the party position, clock, seed, timer
counters and all four champions' names and titles come out of blocks 2 and 4. Two of
the saves are the same party on different levels and read back as the same roster.

That exercise found three reader bugs no self-round-trip could have — `spellFilterLocation`
and `extendedFlags` read one field too far, and `gameInfoSize` read unsigned when
CSBWin writes -1 for "none" — both written up in `doc/PROVEN_FACTS.md`. It is the
argument for keeping a real file in the repository: the two older saves happen to be
zero in the misread words, so it took the third to expose it.

Everything blocks 7-14 would carry is held at runtime and captured by
`src/engine/DungeonSnapshot.ts`, so Phase 10 is a serialization job rather than a
state-modelling one. The one caveat is that nothing has ever been validated against a
genuine CSBWin save file — there is none in `static/gamefiles/` — and a format that only
round-trips through itself proves nothing, which is the trap `tools/dump-savegame-blocks.ts`
was written to document.


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

What a load still does **not** carry is listed under Phase 10 step 12 in `PLAN.md`: the
timer queue (a gap the port's own quick-save shares), the DSA global variables in
`EXPOOL`, and `d.Word11694`.
