# CSBWin Hint Oracle Reference (Sourced)

Chaos Strikes Back's Hint Oracle, as CSBWin ports it in `doc/CSBwin-src/Hint.cpp`. The
port reads its data with `readHintOracle` and `parseHcsbDat`
(`src/data/HintOracleLoader.ts`), and `tools/dump-hint-oracle.ts` checks the retail files
against everything below. `HintOracleScreen` (`src/renderer/intro/HintOracle.ts`) is the
screen, and `tools/dump-hint-oracle-screen.ts` runs it headlessly. The game opens it
from the inventory, on the party's square ("In the port: the inventory's button").

## What it is

A separate screen, reached from CSBWin's HINT choice (`_StartHint`,
`doc/CSBwin-src/Hint.cpp:7231`). It reads a saved game and offers hints about where the
party stands. It reads more of the save than it uses here (the monster groups and the
characters too, `Hint.cpp:5821-5841`), but the hints offered depend only on the party's
position: `_TAG00799a_9` takes the words at bytes 12, 14 and 18 of the second block
(`Hint.cpp:6858-6863`), which are `partyX`, `partyY` and `partyLevel`
(`src/data/SaveGameLoader.ts`, `readI16BE(buf, 12/14/18)`).

The screen lists the titles of the hints that apply, at most `MAXHINTINDICES` = 9 of
them (`Hint.cpp:11`, the loop in `_TAG00799a_6`, `:6756`), though the button table
`s20_16208` has only eight title lines, ids 10 to 17, x 40-280, y 30-42 down to
142-154 (`Hint.cpp:546-568`). A title chosen shows its pages, one at a time
(`f.CurPage10484`, `Hint.cpp:469`), in the rectangle x 34-285, y 31-164
(`Hint.cpp:7120-7123`); NEXT is offered while pages remain and LAST past the first
(`:7157-7166`). The bottom row's buttons share three rectangles, x 33-100, 127-194 and
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
  (`Hint.cpp:4737-4776`), and `TAG005ae8_1` item 3 into `f.Palette16608` (`:5150`). It
  has four items, all stored uncompressed (each item's two sizes in the index are
  equal, and the 18-byte index plus the items is the file's 30793 bytes):

  | Item | Bytes | What |
  | --- | --- | --- |
  | 0 | 100 | Fifty words of the screen's parameters, `f.Segment1_16872`: palette slots, inks, fade timings and the colour cycle. See "Item 0" below. |
  | 1 | 29146 | The backdrop, a 320x200 IMG1 picture (`decodeIMG` reads it): a stone frame round a red field and the three bottom buttons. `TAG0088b8` copies it to the whole screen (`:4814`). |
  | 2 | 1497 | The font, a 256x27 IMG1 picture, which is 3456 bytes at four bits a pixel. `TAG004962` draws character `c` from x `8 * ((c - 32) & 31)`, y `9 * ((c - 32) / 32)`, 8 wide, 9 apart, with colour 12 transparent (`:4138-4169`). |
  | 3 | 32 | The palette, sixteen `0RGB` words. |

`TAG005ae8_1` byte-swaps the palette's words (`:5143-5160`); item 0's are swapped where
they are read, each through `LE16`, so every word of both is big-endian. The font's
glyphs are all colour 9 on the transparent 12, and that 9 is item 0's word 8.

Both come in CSBWin's Chaos Strikes Back package
(`static/gamefiles/CSB_Windows_x86-32_20151213.zip`) and sit in `static/gamefiles/csb/`.
CSBWin opens them by the names `"0hcsb.hct"` and `"0hcsb.dat"` (`Hint.cpp:702-703`).

### Item 0

Three things read its words.

- **The palette fades.** `PaletteFade` (`:5221-5239`) is `FadePalette` (`:5304-5388`) with
  the packet's target palette, a start palette (NULL: the screen's), the mask 273 and
  two words, a delay and a step count. Each step moves every colour's three components
  (273 is 0x111: all three) one unit toward the target, sets the palette and waits the
  delay in VBLs.
- **The ink.** `TAG004a22_26(colour, …)` (`:4397-4438`) recolours the font in place
  (`ShrinkBLT` through `byte16544`, a sixteen-slot map holding 10 × a colour): the slot
  of the current ink (`word15708`) gets the new one, which becomes current. Its first
  call, at load, finds no current ink (`word15708` is -1, `:651`): it gives slot word 10
  the colour word 8, and makes word 8 current. That is the colour the font is drawn
  in, and the font has no pixel of colour 1, so the slot it sets changes nothing.
- **Palette slots** set directly in `f.Palette16608`.

| Word | Retail | Read at | What |
| --- | --- | --- | --- |
| 0 | 2 | `:4926`, `:4941`, `:4963` | In `_TAG0051c2_31`, which builds a screen: the palette slot that is set to word 1 before its fades and to word 3 after its texts, and the ink of the texts it draws from list 9 (`:4941-4960`) |
| 1 | 0x620 | `:4927` | The colour slot word 0 fades in with |
| 2 | 1 | `:4920`, `:4938` | The ink before the screen's buttons are drawn and before their labels are (`TAG008c40_6`, "Text appears on buttons") |
| 3 | 0x770 | `:4963-4964` | The colour slot word 0 takes once the texts are drawn, before the last two fades |
| 4 | 1 | `:4977` | The ink `_TAG0051c2_31` leaves set |
| 5 | 9 | — | Not read by CSBWin; the ink after a button's flash in the original (word 9) |
| 6 | 9 | `:4952` | The colour of the frame round a text of list 9 whose `i12` is 8: `TAG005f9a_1` draws it one pixel wide, outside the text's rectangle (`TAG005f9a_xxx`, `:5394-5460`) |
| 7 | 10 | `:7776` | The ink a pressed button's label flashes in (`_TAG008c40_8`), for 20 VBLs before it is drawn again in the button's own (`:7777-7781`) |
| 8 | 9 | `:4778-4780`, `:6775`, `:7661`, `:7677` | The font's ink as stored (the load's first `TAG004a22_26`), and the palette slot the title list cycles: word 36 when a title is drawn and when a click ends the wait, the cycle's colours between |
| 9 | 3 | `:4968`, `:7786-7790` | The VBLs `_TAG0051c2_31` waits at least, from just after its first two fades, before its last two; and the ink after a button's flash, set unless it is the button's own. CSBWin reads words 8-9 there as a long (`LoadLong(f.Segment1_16872+8)`) and keeps the low word, which is word 9, though its own comment puts that long, `Long16864`, at byte 8: words 4-5 (`:375`), whose low word is word 5. No text is drawn in that ink: each draw sets its own first |
| 10, 11 | 1, 1 | `:4932-4933`, `:4971-4972` | The second and third fades: delay, steps. Word 10 is also the slot the first ink call sets (`:4778`) |
| 12, 13 | 2, 6 | `:4929-4930`, `:4974-4975` | The first and last fades: delay, steps |
| 14-19 | 0xffff | — | Not read |
| 20-31 | 0 | — | Not read |
| 32 | 10 | `:7680` | How many colours the title list cycles through, from word 36 on |
| 33 | 2 | — | Not read: the cycle waits 20 VBLs a colour, where the commented-out read of word 33 was (`word16806 = 20; //LE16(f.Segment1_16872[33])`, `:7673`) |
| 34, 35 | 0 | — | Not read |
| 36-45 | 0x310 0x300 0x410 0x400 0x510 0x500 0x510 0x400 0x410 0x300 | `:6776`, `:7660`, `:7678` | The cycle's ten colours, shades of red |
| 46-49 | 0 | — | Not read |

The load's two fades, to `f.Palette16640` and then to item 3, take neither delay nor steps
from item 0: 2 and 7 are constants (`:4785-4786`).

## Enciphering

When the save's `hintKey[0]` is not zero, CSBWin reads `hcsb.hct` through `RC4.cpp`'s
cipher under a stream made from that eight-byte key (`SETENCIPHERED`, `Hint.cpp:6145-6149`,
`:6375-6379`; `doc/PROVEN_FACTS.md` → "The "simple" encipherment is `RC4.cpp`'s own
cipher"). The key comes from the save's Extended Features block
(`memcpy(hintKey, efb.hintKey, 8)`, `doc/CSBwin-src/SaveGame.cpp:384`). `readHintOracle`
deciphers the file under the key when its first byte is not 0, then parses it with
`parseHintOracle`. Every save this project has carries a zero key, and the shipped
`hcsb.hct` is plain; `tools/dump-hint-key.ts` reads it enciphered.

## `hcsb.hct`

Read by `_TAG006c7e_xxx`, case 2 (`Hint.cpp:6139-6249`). Every word is big-endian (read
through `LE16`). The error codes are CSBWin's, from the same lines.

| Offset | Content |
| --- | --- |
| 0 | word `2`, else error 55 |
| 2 | word `13`, else error 81 |
| 4 | word `n`: the reader seeks to byte `2 * n` (`SetBufferLength`, `FileSeek`). The retail file has `n` = 3. |
| `2n` | word `count1`, word `size1`: the **location table**, `count1` records of `size1` bytes (`f.Seg1Addr10550`, `f.Seg1Len10538`) |
| … | word `count2`, word `size2`: the **hint records**, `count2` records of `size2` bytes (`f.Seg2Addr10546`) |
| … | word `count3`, then `count3` words: the **chunk lengths** (`f.Seg3Addr10542`) |
| … | the **chunks**, end to end. Where they start is the file position after the lengths, `TAG00181e` (`:6249`), kept in `f.Seg3Len10534` |

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
(`Hint.cpp:6872-6873`).

Fifteen retail records are all zero: records 4647-4655 and 4657-4662 (4656 is a real
record of level 1). Nothing skips them, so they would match (0,0) of level 0, a stone
square in the CSB dungeon (`static/gamefiles/csb/csbgame2.dat`).

### A hint record (26 bytes)

| Byte | Content |
| --- | --- |
| 0-21 | the title, NUL-terminated (it is copied with `StrLen`/`StrCpyTo`, `Hint.cpp:6760-6765`) |
| 22-23 | word: the index of its first chunk |
| 24-25 | word: its page count |

### The chunks

A hint's text is one chunk, the one its record names. Expanded, it is the hint's pages
end to end, each closed by a NUL. `_TAG00799a_12` (`Hint.cpp:6908-6972`) finds the chunk's
offset by adding up the lengths of the chunks before it, expands it into `f.Byte12792`
(2240 bytes, `Hint.cpp:461`), and returns page N as the string after the (N-1)th NUL. It
reaches the chunk with `w_14 < first + pageNum - 1` at `pageNum` = 1, so only the first
chunk is ever read. In the retail file each hint's chunk is followed by page count - 1
chunks of length 0, so there are as many chunks as pages (492).

A chunk is compressed as `graphics.dat` items are: LZW with 9- to 12-bit codes, code 256
resetting the dictionary (`LZWRawChar`, `TAG003210`, `Hint.cpp:2873-3106`), and each
output byte passed through `TAG003194`. There, 0x90 followed by n repeats the previous
byte n - 1 more times, and 0x90 followed by 0 is a literal 0x90. `LZWexpand` then
`RLEexpand` (`src/core/compression.ts`) are the same pair. The text is plain ASCII.

In the retail file the longest expanded hint is 622 bytes.

## Which hints apply

`_TAG00799a_9` (`Hint.cpp:6866-6878`) walks the whole location table in file order and
keeps a record's hint when the record's level is the party's and either its (x, y) is
the party's square or it is (0xff, 0xff). The result is `f.HintIndices10530` in that
order, which is the menu's order. `hintsAtPosition` is this loop.

The loop does not stop at `MAXHINTINDICES` (a `>= 7` cut is commented out, `:6876`),
though `f.HintIndices10530` holds only nine entries (`Hint.cpp:466`). In the retail file
no square matches more than seven, so the array is never overrun.

Every level from 0 to 9 has one or two level-wide records (a "CREATURES" hint on each,
and a hint about the level as a whole such as "THE MAZE" on level 0). 3891 squares have
a record of their own.

## The screen

All of it is `Hint.cpp`, a `RESTARTABLE` coroutine that yields on `wvbl()`.

### Two screens

`f.Pointer16506` holds two 320x200 screens. `f.Word16498` names the one drawn on; the
other is shown. `TAG0051c2_35` (`:4984`) swaps them: the one drawn on is shown, and the
other gets the backdrop (`TAG0088b8(&rectPos14516, f.Pointer16900, 1)`).
`TAG0051c2_36` (`:5044`) sends the drawing to the screen shown, and `TAG0051c2_37`
(`:5066`) sends it back.

### The window

`_TAG0051c2_1` (`:4709-4828`), once `hcsb.dat` is read: the font's first ink
(`TAG004a22_26(word 10, word 8)`), a fade to `f.Palette16640` (zero: black) with delay 2
and 7 steps, the backdrop on both screens, and a fade to item 3, 2 and 7 again.

`_FadePalette` (`:5304-5388`) starts from the screen's palette. Each step moves every
component of every colour one unit toward the target, sets the palette when the delay
is not zero, and waits the delay in VBLs.

### A screen built

`_TAG0051c2_31` (`:4899-4979`):

1. Ink word 2, and the label of every enabled button drawn (`TAG008c40_6`).
2. `TAG005ae8_9` (`:5179`) copies the screen's palette **into** `f.Palette16608`. Then
   slot word 0 is set to word 1 there, and two fades go to it: words 12-13, then 10-11.
   On the old screen, that dims the old texts, which are in ink word 0.
3. `ClearKeyboard`: the keys are read, and the click queue is emptied.
4. A swap. The VBL count is noted (`f.Long16876`).
5. Ink word 2, a VBL, and the labels again. Then ink word 0, and list 9's texts, last
   added first. A text whose page has `i12` 8 gets a frame in word 6's colour, one pixel
   wide just outside its rectangle (`TAG005f9a_1`, `:5394-5465`).
6. Slot word 0 is set to word 3 in `f.Palette16608`. Then a VBL at least, until word 9's
   VBLs have passed since the swap.
7. A swap, two fades to `f.Palette16608` (words 10-11, then 12-13), and ink word 4.

Every `_DisplayText` ends with a VBL, so the labels and the texts take one each. With
retail item 0, the title list of three titles is first waiting 67 VBLs after the
Oracle opens: 28 for the window, 17 before the swap, 9 after it, and 13 for the last
fades.

### Texts

`_DisplayText` (`:4189-4300`):

- A line starts 11 pixels below the rectangle's top (`:4216`), and each next line 11
  lower (`:4291`). A line whose baseline is past the rectangle's bottom is not drawn.
- A word that would pass the rectangle's width goes to the next line. A word wider than
  the line is cut where it fills it.
- `/` breaks a line. The width is measured only at a space, so a word just before a `/`
  can overrun the rectangle.
- With `w14 & 1`, which every text here has, a line is centred.
- A byte below 32 or above 127 is drawn as `_` (95).

`TAG004962` (`:4138-4169`) draws a glyph 8 wide and 9 high, 9 apart, with its baseline
at the line's y. Colour 12 is transparent. A space draws nothing.

The ink is `TAG004a22_26` (`:4397-4438`). The current ink's slot of `byte16544` gets the
new colour, and the font is passed through that map in place (`ShrinkBLT` at full
size). Glyph pixels are always the current ink, and the transparent 12 is never one.

### The title list

`_TAG00799a_6` (`:6737-6811`). For each title, up to `MAXHINTINDICES`:

- its line, button 10 on, is enabled;
- slot word 8 is set to word 36, and the palette is set;
- its rectangle goes in list 19;
- a text of the title goes in list 9, with frame code 8;
- its button takes the title as its label (`TAG008c40_12(…, 5, title)`). So the build
  draws each title twice, in ink word 2 as a label, then in ink word 0.

Once the screen is up, each title line on the screen shown goes through `TAG0062a2`
(`:5513-5530`) with `byte16528`, which sends colour 12 to 9. On retail item 3 both are
`0x310` at that point (slot 9 was just set from word 36), so nothing changes until
the cycle.

`TAG0062a2` copies the rectangle into a buffer with `TAG0088b8`'s lines, which are
`(w + 16) / 16` sixteen-pixel groups for a rectangle `w + 1` pixels wide. It then remaps
the buffer with `ShrinkBLT(…, w, h, w, h, map)`, whose lines are `(w + 15) / 16` groups,
and copies the whole `w + 1` by `h + 1` back. On a title line (x 40-280, y 13 lines), the
remap covers 240 by 12 pixels laid end to end over lines of 256. That is the first
eleven lines whole and 64 pixels of the twelfth; the rest of the twelfth and the
thirteenth keep their colour 12. While the cycle runs, the bottom of each title's box
stays `0x310`. The port draws it so, since the C++ is consistent and the strip barely
shows: colour 12 is a third of the box's dithered pixels, and the cycle (`310 300 410 400
510 500 510 400 410 300`) is more than a step from `0x310` only around `0x510`, where
the strip is no darker than the box's own darkest rows.

### Waiting for a button

`_TAG008c40_5` (`:7628-7694`) reads one click a VBL. On the title list, while no
button comes, slot word 8 takes the next of word 32's colours from word 36 on. That
happens when `f.Long14110 + 20 < VBLCount`, so every 21 VBLs. Its first step sets word
36, the colour the list was built with. A button resets the slot to word 36.

Clicks: `TAG001afe` (`:2241-2296`) queues a click as the first enabled button under it,
in `t12_14106`'s order, with rectangles inclusive (`TAG001a32`). CSBWin passes it mask 1
for either mouse button (`doc/CSBwin-src/CSBUI.cpp:1215-1241`), and every button takes
mask 1. The queue has five slots, and its full test (`word14202 + 2 == word14202`, mod 5)
never holds. `_TAG001dde` (`:2439-2499`) waits a VBL, then takes the oldest click.

No key does anything: every button's key word (`w12`) is 0, so `TAG008c40_3` registers
none.

### A button pressed

`_TAG008c40_8` (`:7742-7794`), on the screen shown:

1. The button's label is drawn in ink word 7, and the screen waits.
   `TAG005a1e_5(20)` is `do { wvbl } while (w_2-- != 0)` (`:5093-5124`), so the wait is
   21 VBLs.
2. The label is drawn again in the button's own ink (`w18`: 1, 2 for a title line).
3. The ink is reset (see "Item 0", word 9), and every button is disabled
   (`TAG008c40_2`).

A button with no label dies ("Sorry about that", `TAG0093a0_18`). Every button enabled
here has one.

### A hint's pages

`_TAG007fdc_36` (`:7132-7169`) shows page 1 of the line chosen, or the page one before or
after. It takes the page from `f.Word10482`'s hint and the page count from `f.Word10516`'s,
and both are the line chosen. DONE is enabled, then NEXT while pages remain, then LAST past
the first. The page's text is in x 34-285, y 31-164 (`_TAG007fdc_7`, `:7053-7130`).
`_TAG007fdc_7` also makes a text of the hint's title in y 5-30, and draws it nowhere.

### No clues

A square with no hints shows `text15024[4]`, "There are no clues for this location.", in
x 31-290, y 70-150 (`:602-613`), with DONE alone (`:7337-7341`).

### Leaving

EXIT's `_TAG0051c2_2` (`:4831-4894`) makes sure the program's own screen, `Pointer16506[0]`,
is the one shown, and frees what was loaded. It does no fade.

The cursor calls, `TAG002af4` and `TAG002b0c`, end in `TAG00ae58`, which is empty
(`:8711`). CSBWin's Oracle shows the system's pointer throughout.

## In the port: the inventory's button

CSBWin has no way into the Oracle from a game. The port's is the inventory's close box,
in a data set that has `hcsb.hct` and `hcsb.dat` (`DataSet.hintOracle`, `csb` alone;
`src/renderer/ui/HintOracleButton.ts`). It diverges from CSBWin twice, in `DEBT.md` H:
the close box replaced, and DONE on the title list closing the Oracle.

- **The button.** `buttons17760` holds button 11 twice: entry 0, the whole screen for the
  right button, and entry 3, the close box, x 210-218, y 36-44, for the left. With the
  Oracle, entry 3 is searched as the port's button 149 (`HINT_ORACLE_BUTTON`,
  `inventoryButtonList`), a number CSBWin does not use, so a right click still closes the
  inventory. Graphic 17 draws the box as a white X (15) on red (8). The button's picture
  is the Oracle's `?` in those two colours: font glyph 31, as `TAG004962` reads it
  (`Hint.cpp:4158-4165`), its cell a pixel in from the box's top left corner, which puts
  its stem on the box's middle column (`drawHintOracleButton`).
- **The click** is the disk icon's (`doc/CSBwin-src/Mouse.cpp:1847-1866`). It is refused
  with an empty party or a champion only provisionally joined, and otherwise raises
  `hintOracleNeeded`, which `GameScreen.handleMouseButton` acts on once the button is
  dispatched. `TAG02076e` runs, as before the disk menu (`SaveGame.cpp:877`), and the clock
  stops (`ctx.state.paused`). The screen is composed once more without the cursor, and
  the Oracle runs over an `IntroHost` (`runHintOracle`,
  `src/renderer/intro/BootSequence.ts`), on the party's `position`: x, y and the level,
  which a save writes as `partyX`, `partyY` and `partyLevel`. The colour registers it
  finds are the interface's, through which the open inventory is shown, so its first
  fade starts from the screen as it was. The canvas hides the system's pointer, so the
  arrow stands in for it. While it is up, the adventure's input is ignored, and the game
  screen draws nothing.
- **Leaving.** DONE on the title list closes the Oracle, where CSBWin's goes back to the
  load screen (`w_4 = 1`, `:7375-7388`). `TAG0207cc` then shows the inventory again, as
  after the disk menu (`SaveGame.cpp:1375`), and the clock runs.
- **The key.** `hcsb.hct` is fetched with the page and read when the Oracle opens, under
  the running world's `hintKey`, the one its last read took from a block
  (`runHintOracle`). A file that does not read under it opens no Oracle: the inventory
  comes back, the clock runs, and the message area says `UNABLE TO READ THE HINTS!`
  (`openHintOracle`), the port's words, as CSBWin's error routine, `TAG0093a0_17`, draws
  nothing (`Hint.cpp:7903-7908`). An error while the Oracle runs closes it the same way.

`tools/dump-hint-oracle-button.ts` checks the picture, and the click on the party's square
after a step, a teleporter and a pit. Golden frames 15 and 16 are a CSB inventory with
the button and a hint's page opened through it. The title list is no frame: its palette
cycle would make it differ from one run to the next.
