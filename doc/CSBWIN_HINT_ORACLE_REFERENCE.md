# CSBWin Hint Oracle Reference (Sourced)

Chaos Strikes Back's Hint Oracle, as CSBWin ports it in `doc/CSBwin-src/Hint.cpp`. The
port reads its data with `parseHintOracle` and `parseHcsbDat`
(`src/data/HintOracleLoader.ts`), and `tools/dump-hint-oracle.ts` checks the retail files
against everything below. Nothing in
the game uses it yet (`DEBT.md` G20).

## What it is

A separate screen, reached from CSBWin's HINT choice (`_StartHint`,
`doc/CSBwin-src/Hint.cpp:6454`). It reads a saved game and offers hints about where the
party stands. It reads more of the save than it uses here (the monster groups and the
characters too, `Hint.cpp:5093-5113`), but the hints offered depend only on the party's
position: `_TAG00799a_9` takes the words at bytes 12, 14 and 18 of the second block
(`Hint.cpp:6100-6105`), which are `partyX`, `partyY` and `partyLevel`
(`src/data/SaveGameLoader.ts`, `readI16BE(buf, 12/14/18)`).

The screen lists the titles of the hints that apply, at most `MAXHINTINDICES` = 9 of
them (`Hint.cpp:11`, the loop in `_TAG00799a_6`, `:5998`), though the button table
`s20_16208` has only eight title lines, ids 10 to 17, x 40-280, y 30-42 down to
142-154 (`Hint.cpp:417-439`). A title chosen shows its pages, one at a time
(`f.CurPage10484`, `Hint.cpp:341`), in the rectangle x 34-285, y 31-164
(`Hint.cpp:6343-6346`); NEXT is offered while pages remain and LAST past the first
(`:6380-6389`). The bottom row's buttons share three rectangles, x 33-100, 127-194 and
221-289 by y 179-192: LAST or Dump, LOAD, NEXT or OK, and DONE, EXIT or CANCEL
(`s20_16208`).

CSBWin's original is `HINT.FTL` on the utility disk (`doc/ATARI_ST_DISK_REFERENCE.md`).
`Hint.cpp`'s function names are offsets in its code segment, as `Chaos.cpp`'s are in
`CHAOS.FTL`'s.

## Files

- **`hcsb.hct`** holds the hints: where they apply, their titles and their text. The
  format is below.
- **`hcsb.dat`** is the Oracle's own item file, indexed as `graphics.dat` is: `TAG002c5e`
  reads its index, `ReadDatSeg` its 100-byte item 0 into `f.Segment1_16872`, and
  `TAG003006` item 1 into a 0x8000-byte buffer and item 2 into a 3456-byte one
  (`Hint.cpp:4017-4056`), and `TAG005ae8_1` item 3 into `f.Palette16608` (`:4422`). It
  has four items, all stored uncompressed (each item's two sizes in the index are
  equal, and the 18-byte index plus the items is the file's 30793 bytes):

  | Item | Bytes | What |
  | --- | --- | --- |
  | 0 | 100 | Fifty words of the screen's parameters, `f.Segment1_16872`: palette slots, inks, fade timings and the colour cycle. See "Item 0" below. |
  | 1 | 29146 | The backdrop, a 320x200 IMG1 picture (`decodeIMG` reads it): a stone frame round a red field and the three bottom buttons. `TAG0088b8` copies it to the whole screen (`:4086`). |
  | 2 | 1497 | The font, a 256x27 IMG1 picture, which is 3456 bytes at four bits a pixel. `TAG004962` draws character `c` from x `8 * ((c - 32) & 31)`, y `9 * ((c - 32) / 32)`, 8 wide, 9 apart, with colour 12 transparent (`:3446-3477`). |
  | 3 | 32 | The palette, sixteen `0RGB` words. |

`TAG005ae8_1` byte-swaps the palette's words (`:4415-4432`); item 0's are swapped where
they are read, each through `LE16`, so every word of both is big-endian. The font's
glyphs are all colour 9 on the transparent 12, and that 9 is item 0's word 8.

Both come in CSBWin's Chaos Strikes Back package
(`static/gamefiles/CSB_Windows_x86-32_20151213.zip`) and sit in `static/gamefiles/csb/`.
CSBWin opens them by the names `"0hcsb.hct"` and `"0hcsb.dat"` (`Hint.cpp:554-555`).

### Item 0

Three things read its words.

- **The palette fades.** `PaletteFade` (`:4493-4511`) is `FadePalette` (`:4576-4660`) with
  the packet's target palette, a start palette (NULL: the screen's), the mask 273 and
  two words, a delay and a step count. Each step moves every colour's three components
  (273 is 0x111: all three) one unit toward the target, sets the palette and waits the
  delay in VBLs.
- **The ink.** `TAG004a22_26(colour, …)` (`:3694-3734`) recolours the font in place
  (`ShrinkBLT` through `byte16544`, a sixteen-slot map holding 10 × a colour): the slot
  of the current ink (`word15708`) gets the new one, which becomes current. Its first
  call, at load, finds no current ink (`word15708` is -1, `:507`): it gives slot word 10
  the colour word 8, and makes word 8 current. That is the colour the font is drawn
  in, and the font has no pixel of colour 1, so the slot it sets changes nothing.
- **Palette slots** set directly in `f.Palette16608`.

| Word | Retail | Read at | What |
| --- | --- | --- | --- |
| 0 | 2 | `:4198`, `:4213`, `:4235` | In `_TAG0051c2_31`, which builds a screen: the palette slot that is set to word 1 before its fades and to word 3 after its texts, and the ink of the texts it draws from list 9 (`:4213-4232`) |
| 1 | 0x620 | `:4199` | The colour slot word 0 fades in with |
| 2 | 1 | `:4192`, `:4210` | The ink before the screen's buttons are drawn and before their labels are (`TAG008c40_6`, "Text appears on buttons") |
| 3 | 0x770 | `:4235-4236` | The colour slot word 0 takes once the texts are drawn, before the last two fades |
| 4 | 1 | `:4249` | The ink `_TAG0051c2_31` leaves set |
| 5 | 9 | — | Not read |
| 6 | 9 | `:4224` | The colour of the frame round a text of list 9 whose `i12` is 8: `TAG005f9a_1` draws it one pixel wide, outside the text's rectangle (`TAG005f9a_xxx`, `:4666-4732`) |
| 7 | 10 | `:6985` | The ink a pressed button's label flashes in (`_TAG008c40_8`), for 20 VBLs before it is drawn again in the button's own (`:6986-6990`) |
| 8 | 9 | `:4058-4060`, `:6017`, `:6870`, `:6886` | The font's ink as stored (the load's first `TAG004a22_26`), and the palette slot the title list cycles: word 36 when a title is drawn and when a click ends the wait, the cycle's colours between |
| 9 | 3 | `:4240`, `:6995-6999` | The VBLs `_TAG0051c2_31` waits at least, from just after its first two fades, before its last two; and the ink after a button's flash, set unless it is the button's own. CSBWin reads words 8-9 there as a long (`LoadLong(f.Segment1_16872+8)`) and keeps the low word, which is word 9, though its own comment puts that long, `Long16864`, at byte 8: words 4-5 (`:247`) |
| 10, 11 | 1, 1 | `:4204-4205`, `:4243-4244` | The second and third fades: delay, steps. Word 10 is also the slot the first ink call sets (`:4058`) |
| 12, 13 | 2, 6 | `:4201-4202`, `:4246-4247` | The first and last fades: delay, steps |
| 14-19 | 0xffff | — | Not read |
| 20-31 | 0 | — | Not read |
| 32 | 10 | `:6889` | How many colours the title list cycles through, from word 36 on |
| 33 | 2 | — | Not read: the cycle waits 20 VBLs a colour, where the commented-out read of word 33 was (`word16806 = 20; //LE16(f.Segment1_16872[33])`, `:6882`) |
| 34, 35 | 0 | — | Not read |
| 36-45 | 0x310 0x300 0x410 0x400 0x510 0x500 0x510 0x400 0x410 0x300 | `:6018`, `:6869`, `:6887` | The cycle's ten colours, shades of red |
| 46-49 | 0 | — | Not read |

The load's two fades, to `f.Palette16640` and then to item 3, take neither delay nor steps
from item 0: 2 and 7 are constants (`:4065-4066`).

## Enciphering

When the save's `hintKey` is not zero, CSBWin reads `hcsb.hct` through `RC4.cpp`'s cipher under
that eight-byte key (`SETENCIPHERED`, `Hint.cpp:5401-5405`, `:5625-5629`). The key comes from
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
