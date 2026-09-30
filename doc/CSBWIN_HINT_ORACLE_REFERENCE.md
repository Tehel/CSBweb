# CSBWin Hint Oracle Reference (Sourced)

Chaos Strikes Back's Hint Oracle, as CSBWin ports it in `doc/CSBwin-src/Hint.cpp`. The
port reads its data with `parseHintOracle` (`src/data/HintOracleLoader.ts`), and
`tools/dump-hint-oracle.ts` checks the retail file against everything below. Nothing in
the game uses it yet (`DEBT.md` G20, X6).

## What it is

A separate screen, reached from CSBWin's HINT choice (`_StartHint`,
`doc/CSBwin-src/Hint.cpp:6454`). It reads a saved game and offers hints about where the
party stands. It reads more of the save than it uses here (the monster groups and the
characters too, `Hint.cpp:5093-5113`), but the hints offered depend only on the party's
position: `_TAG00799a_9` takes the words at bytes 12, 14 and 18 of the second block
(`Hint.cpp:6100-6105`), which are `partyX`, `partyY` and `partyLevel`
(`src/data/SaveGameLoader.ts`, `readI16BE(buf, 12/14/18)`).

The screen lists the titles of the hints that apply, at most `MAXHINTINDICES` = 9 of
them (`Hint.cpp:11`, the loop in `_TAG00799a_6`, `:5998`). A title chosen shows its
pages, one at a time (`f.CurPage10484`, `Hint.cpp:341`).

## Files

- **`hcsb.hct`** holds the hints: where they apply, their titles and their text. The
  format is below.
- **`hcsb.dat`** is the Oracle's own item file, indexed as `graphics.dat` is: `TAG002c5e`
  reads its index, `ReadDatSeg` its 100-byte item 0 into `f.Segment1_16872`, and
  `TAG003006` item 1 into a 0x8000-byte buffer and item 2 into a 3456-byte one
  (`Hint.cpp:4017-4056`). Its contents are not decoded here.

Both come in CSBWin's Chaos Strikes Back package
(`static/gamefiles/CSB_Windows_x86-32_20151213.zip`) and sit in `static/gamefiles/csb/`.
CSBWin opens them by the names `"0hcsb.hct"` and `"0hcsb.dat"` (`Hint.cpp:554-555`).

## Enciphering

When the save's `hintKey` is not zero, CSBWin reads `hcsb.hct` through RC4 under that
eight-byte key (`SETENCIPHERED`, `Hint.cpp:5401-5405`, `:5625-5629`). The key comes from
the save's Extended Features block (`memcpy(hintKey, efb.hintKey, 8)`,
`doc/CSBwin-src/SaveGame.cpp:382`). Every save this project has carries a zero key
(`doc/PROVEN_FACTS.md` → "The Extended Features header a live game writes"), and the
shipped `hcsb.hct` is plain. `parseHintOracle` reads a plain file only; an enciphered
one fails its first header check.

## `hcsb.hct`

Read by `_TAG006c7e_xxx`, case 2 (`Hint.cpp:5395-5505`). Every word is big-endian (read
through `LE16`). The error codes are CSBWin's, from the same lines.

| Offset | Content |
| --- | --- |
| 0 | word `2`, else error 55 |
| 2 | word `13`, else error 81 |
| 4 | word `n`: the reader seeks to byte `2 * n` (`SetBufferLength`, `FileSeek`). The retail file has `n` = 3. |
| `2n` | word `count1`, word `size1`: the **location table**, `count1` records of `size1` bytes (`f.Seg1Addr10550`, `f.Seg1Len10538`) |
| … | word `count2`, word `size2`: the **hint records**, `count2` records of `size2` bytes (`f.Seg2Addr10546`) |
| … | word `count3`, then `count3` words: the **chunk lengths** (`f.Seg3Addr10542`) |
| … | the **chunks**, end to end. Where they start is the file position after the lengths, `TAG00181e` (`:5505`), kept in `f.Seg3Len10534` |

The retail file's figures: 4663 location records of 6 bytes, 210 hint records of 26
bytes, 492 chunks starting at byte 34438, and the last chunk ends on the file's last
byte (66172).

### A location record (6 bytes)

| Byte | Content |
| --- | --- |
| 0 | x |
| 1 | y |
| 2 | level (the map index, as `partyLevel`) |
| 3 | 0 in every retail record; not read |
| 4-5 | word: the hint record's index |

x and y both 0xff mean "anywhere on this level". `_TAG00799a_9` reads the bytes through
`pnt`, a signed `i8 *` (`doc/CSBwin-src/CSBTypes.h:51`), so the test is `A4[0] != -1`
(`Hint.cpp:6114-6115`).

Fifteen retail records are all zero: records 4647-4655 and 4657-4662 (4656 is a real
record of level 1). Nothing skips them, so they would match (0,0) of level 0, a stone
square in the CSB dungeon (`static/gamefiles/csb/csbgame2.dat`).

### A hint record (26 bytes)

| Byte | Content |
| --- | --- |
| 0-21 | the title, NUL-terminated (it is copied with `StrLen`/`StrCpyTo`, `Hint.cpp:6002-6007`) |
| 22-23 | word: the index of its first chunk |
| 24-25 | word: its page count |

### The chunks

A hint's text is one chunk, the one its record names. Expanded, it is the hint's pages
end to end, each closed by a NUL. `_TAG00799a_12` (`Hint.cpp:6146-6200`) finds the chunk's
offset by adding up the lengths of the chunks before it, expands it into `f.Byte12792`
(2240 bytes, `Hint.cpp:333`), and returns page N as the string after the (N-1)th NUL. It
reaches the chunk with `w_14 < first + pageNum - 1` at `pageNum` = 1, so only the first
chunk is ever read. In the retail file each hint's chunk is followed by page count - 1
chunks of length 0, so there are as many chunks as pages (492).

A chunk is compressed as `graphics.dat` items are: LZW with 9- to 12-bit codes, code 256
resetting the dictionary (`LZWRawChar`, `TAG003210`, `Hint.cpp:2553-2786`), and each
output byte passed through `TAG003194`. There, 0x90 followed by n repeats the previous
byte n - 1 more times, and 0x90 followed by 0 is a literal 0x90. `LZWexpand` then
`RLEexpand` (`src/core/compression.ts`) are the same pair. The text is plain ASCII.

In the retail file the longest expanded hint is 622 bytes.

## Which hints apply

`_TAG00799a_9` (`Hint.cpp:6108-6120`) walks the whole location table in file order and
keeps a record's hint when the record's level is the party's and either its (x, y) is
the party's square or it is (0xff, 0xff). The result is `f.HintIndices10530` in that
order, which is the menu's order. `hintsAtPosition` is this loop.

The loop does not stop at `MAXHINTINDICES` (a `>= 7` cut is commented out, `:6118`),
though `f.HintIndices10530` holds only nine entries (`Hint.cpp:338`). In the retail file
no square matches more than seven, so the array is never overrun.

Every level from 0 to 9 has one or two level-wide records (a "CREATURES" hint on each,
and a hint about the level as a whole such as "THE MAZE" on level 0). 3891 squares have
a record of their own.
