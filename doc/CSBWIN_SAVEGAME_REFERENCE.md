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

This port reads offsets 20, 22, 28 and 46. The rest of the block is listed because the
layout is known, not because it is parsed — the runtime half of a quick-save carries
those values today, and Phase 10 is where they move here.
