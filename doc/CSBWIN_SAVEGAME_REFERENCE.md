# CSBWin Save/Extended Data Reference (Sourced)

This document captures verified save/extended data behaviors from the CSBWin C++ source under `doc/CSBwin-src/`.

## Extended features block

- `ReadExtendedFeatures` reads the 512-byte `EXTENDEDFEATURESBLOCK`, followed by `dataTypeMap`, `dataIndexMap`, DSA blocks (`ReadDSAs`), optional `ReadDSALevelIndex`, and sets `sequencedTimers`/`extendedTimers` from `extendedFlags` (bits `0x20`/`0x80`) (`doc/CSBwin-src/SaveGame.cpp`).
- `ReadDSALevelIndex` consumes 3-byte triples until `level > 63`, storing `DSALevelIndex[level][selector] = dsaIndex` (`doc/CSBwin-src/SaveGame.cpp`).

## Database read order

- `ReadDatabases` reads the 44-byte `DUNGEONDATINDEX`, map descriptors, object list, and text data before database records; when `indirectText` is set (extended features flag `IndirectText`), it reads `NumWordsInTextArray * 4` bytes of indirect index, then a 32-bit compressed text size and `size * 2` bytes before the database section (`doc/CSBwin-src/SaveGame.cpp`).

## EXPOOL hash lookup

- `EXPOOL::Locate` hashes keys with `key * 0xbb40e62d`, probes `m[hashi]`/`m[p+1]` for matches, and gets record size from the owning `DB11` block (`size` stored in the block header; record length is `size-2` ui32 words) (`doc/CSBwin-src/data.cpp`).
