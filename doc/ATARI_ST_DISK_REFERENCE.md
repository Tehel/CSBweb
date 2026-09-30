# Atari ST Disk Reference: Dungeon Master 1.2 (English)

What the original Atari ST game disk holds that CSBWin does not: the boot chain, the FTL
logo animation (`SWOOSH.IMG`) that ran before the title, and how the disk's data files
differ from the `graphics.dat` and `dungeon.dat` this port ships in `dm-atari/`.

This is not CSBWin-sourced. The authority is the disk itself. A citation `swoosh.img:$0070`
is a byte offset into that file, and a citation `boot:$003a` is an offset into the boot
sector, both taken from a 68000 disassembly. What is known about TOS (the XBIOS calls,
the `Dosound` byte codes, the YM2149 registers) is the Atari's documented behaviour and
is marked as such.

## The disk and the files taken from it

`static/gamefiles/DungeonMaster1v2E.stx` (md5 `279e322b837e98ea258f0b16a736f9ca`, untracked)
is a Pasti image: 80 tracks, single-sided, 10 sectors of 512 bytes a track (plus two
more track records Pasti keeps). Track 0 carries the copy protection: sector 7 is stored
with fuzzy bits and a CRC error (FDC flags `0x88`), and an extra sector numbered 247
follows it. Nothing else on the disk is unusual. The filesystem is plain FAT12 (2 sectors
a cluster, 16 root entries), and the root directory holds six files:

| File | Size | Date | md5 | What it is |
| --- | --- | --- | --- | --- |
| `BOOTER` | 1024 | 1999-12-31 | `e1abcf34…` | Not examined. Contains the string `start.pak`. |
| `SWOOSH.IMG` | 3016 | 1999-12-31 | `57a685a0…` | The FTL logo: 68000 code, a picture, a sound, a palette script. |
| `START.PRG` | 770 | 1999-12-31 | `a9730cd7…` | A GEMDOS program, run by `SWOOSH.IMG`. Not examined. |
| `GRAPHICS.DAT` | 271918 | 1988-02-18 | `9ce2eaf7…` | The 1.2 graphics. |
| `START.PAK` | 95148 | 1988-02-24 | `60df1980…` | Presumably the packed game program. Not examined. |
| `DUNGEON.DAT` | 33442 | 1988-03-01 | `050fb2cf…` | The 1.2 dungeon. |

Three of them are in `static/gamefiles/dm-atari-1.2/`, under lower-case names:
`graphics.dat`, `dungeon.dat` and `swoosh.img`, with the swoosh's sound as PCM (below).
The data files load: the graphics through
`GraphicsLoader` and `extractGraphicsTables`, the dungeon through `tools/peek-dungeon.ts
--file`.

## The boot chain

1. **The boot sector** is executable (its words sum to `0x1234`), OEM name `Loader`. It is
   TOS's loader boot sector: a load mode at `boot:$0020` (0, meaning by file name), a
   load address at `boot:$0026` (`$00040000`), a FAT buffer at `boot:$002a` (0, meaning
   `_membot`), and the file name at `boot:$002e`, `SWOOSH  IMG`.
   - `boot:$003a` fades palette register 0 from `777` down to `000`, one step of `111` per
     VBL, over eight VBLs. `boot:$0060` then clears all 16 palette registers directly
     (`$ff8240`…). The screen is black from here on.
   - It reads the FAT and the root directory with `Rwabs`, finds the file, follows its
     cluster chain, and loads it at `$40000`. It jumps there with `move.l $26(pc),-(a7) /
     rts` (`boot:$0178`). On any read error it hangs (`boot:$017e`, `bra *`).
2. **`SWOOSH.IMG`** draws the FTL logo, starts its sound and runs its palette script. Then
   it calls `Pexec(0, "START.PRG", "\4AUTO", "")` (`swoosh.img:$0046`). The strings are at
   `$005e`, `$0068` and `$006e`. It never draws again, so the logo stays on screen until
   the program it started replaces the screen.
3. **`START.PRG`** runs the game, presumably by unpacking `START.PAK`. It was not
   examined. The title animation (`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`) is the game's
   own, and CSBWin's `_DisplayChaosStrikesBack` ports it.

**How long the logo stays up is not established.** The palette script ends 30 VBLs after
it starts. Whatever follows is `START.PRG` loading and unpacking the game, which the disk
does not time. On the one recording available the logo is up about 3.5 s before the title
("The sound as PCM, and a recording of the logo").

## `SWOOSH.IMG`

Position-independent 68000 code with its data, 3016 (`$0bc8`) bytes:

| Offset | Size | Content |
| --- | --- | --- |
| `$0000` | 2 | `bra.b $0070` |
| `$0002` | `$44` | After the picture: `Dosound`, the palette script interpreter, the `Pexec` |
| `$005e` | 18 | The `Pexec` strings |
| `$0070` | `$0168` | Set-up and the picture decoder |
| `$01d8` | 128 | 16 solid-colour patterns, 8 bytes each |
| `$0258` | 2306 | The compressed picture, to `$0b59` |
| `$0b5a` | 56 | The `Dosound` data |
| `$0b92` | 54 | The palette script, to `$0bc7` |
| `$0bc8` | 128 | Past the end of the file: two mask tables the code builds at run time |

### The picture

A 320x200, 16-colour image in ST low resolution: 20 groups of 16 pixels a line, each group
four 16-bit plane words (8 bytes), 160 bytes a line, 32000 bytes in all. The code decodes
it straight into screen memory (`Physbase`, XBIOS 2, `swoosh.img:$0070`), while the palette
is still black.

**Set-up** (`$0070`–`$00cb`). `a1` is the screen, and `a3` and `d6` are both the screen
plus 32000. The routine has a line stride in `d7` (160) and logic to step `a3` a line at a
time (`$0164`–`$016e`), but with `a3` at the end of the screen that branch is never taken:
the whole screen is one stream of groups. The first group is cleared. `d0`, the bit
position in the current group, starts at 15 (the leftmost pixel). Two tables of 16 longs
are built at `$0bc8` (`a4`) and `$0c08` (`a5`); each long holds the same mask in both of
its words:

- `a4[i]` = `(1 << (i+1)) - 1`, bits `i`..0: from bit `i` to the group's right edge.
- `a5[i]` = `(0xffff << (i+1)) & 0xffff`, bits 15..`i+1`: everything left of bit `i`.

**The colour patterns** at `$01d8`: entry `c` is four plane words, plane `p` `$ffff` if bit
`p` of `c` is set, else 0.

**The codes** (`$00d0`–`$011e`), one byte `b` and its colour `c = b & 15`:

| `b` | Bytes | Meaning |
| --- | --- | --- |
| `0nnn cccc` | 1 | A run of `nnn + 1` pixels (1–8) of colour `c`. |
| `1L?0 cccc` | 2 or 3 | A run of `N + 1` pixels of colour `c`. `N` is the next byte, or with `L` (bit 6) the next two bytes, big-endian. |
| `1L?1 cccc` | 2 or 3 | Copy `N + 1` pixels from the line above (the group 160 bytes back, at the same bit positions), then one pixel of colour `c`. `N` as above. |

Bit 5 (`?`) is never tested. It is set in 87 of the picture's codes and means nothing.

**Drawing a run** (`$0120`–`$017a`). The run covers the current group from bit `d0`. If
`d0 >= count`, the mask is `a4[d0] & a5[d0 - count]` and `d0 -= count`; otherwise it is
`a4[d0]`, `count -= d0 + 1`, and `d0 = -1`. Each plane word of the source (a colour
pattern, or the group above) is ANDed with the mask and ORed into the screen group. When
`d0` goes negative the next group is entered: `a1 += 8`, the new group is cleared, and
`d0 = 15`. The caller loops until the count is spent. A copy's source pointer moves on by
8 after every call, so it stays one line above the destination.

**The single pixel** after a copy (`$017c`–`$01d4`) sets bit `d0 & 7` in the high byte of
each plane word (`d0` 8–15) or the low byte (`d0` 0–7), in the planes whose bit is set in
`c`. Then `d0 -= 1`, with the same group change.

**The end.** When entering a new group would pass the end of the screen (`$015e`), the
code jumps to `$0002`. The picture takes exactly 2306 bytes, `$0258`–`$0b59`, and ends on
the last of the 64000 pixels: 1089 short runs, 495 long runs (53 with a two-byte count),
87 copies. The first copy is on row 53, so the line above is always on screen.

The picture uses all 16 colours. Each index is one stage of the logo, and the palette
script shows them in turn: a curved trail of stripes, the letters "FTL" on a bar that
ends in an arrow, a starburst behind the letters, and a star-shaped glint at the end of
the "L".

### The palette script

`$0002` calls `Dosound($0b5a)` (XBIOS 32), then reads words from `$0b92` (`$0010`–`$0044`):

- `0`: the end, go to the `Pexec`.
- `1`–`7`: wait `w + 1` VBLs (`Vsync`, XBIOS 37, in a `dbra` loop at `$0038`).
- Anything else: `Setcolor(w >> 12, w & 0x777)` (XBIOS 7).

The script, with the VBL at which each colour is set:

| VBL | Colours set |
| --- | --- |
| 0 | 1 = `777` |
| 2 | 2 = `777` |
| 4 | 3 = `777` |
| 7 | 4 = `777` |
| 10 | 5 = `777` |
| 14 | 6 = `777` |
| 18 | 7 = `777` |
| 22 | 8 = `777`, 9 = `777`, 10 = `555`, 15 = `777` |
| 26 | 8 = `000`, 11 = `777`, 12 = `555`, 13 = `222` |
| 30 | 15 = `770`, 14 = `770`, then the `Pexec` |

The palette after the script: `000 777 777 777 777 777 777 777 000 777 555 777 555 222 770 770`.
Colours 1–7 draw the trail. At VBL 22 the letters and the starburst (colour 8) appear, and
at 26 the starburst goes and the bar's shading comes in. At 30 the glint turns yellow.
That is 30 VBLs: 0.6 s at 50 Hz, 0.5 s at 60 Hz. Which rate the logo ran at is set by
TOS's video mode, not by the disk.

### The sound

`$0b5a`, 56 bytes of `Dosound` data. In TOS's documented format a byte 0–15 is a YM2149
register followed by its value, and a byte from `$82` up is a wait of the next byte's
count of 50 Hz ticks, 0 ending the sound. The data:

| Bytes | Effect |
| --- | --- |
| `08 10`, `09 10` | Channels A and B take their volume from the envelope |
| `0c 0d` | Envelope period, coarse = `$0d` |
| `0d 0d` | Envelope shape `$0d`: rise, then hold at full |
| `06 1f` | Noise period `$1f` |
| `07 27` | Mixer: all three tones off, noise on A and B, off on C |
| `ff 02` then `06 xx`, nine times | Every 2 ticks the noise period steps down: `1c 19 16 13 10 0c 08 04 00` |
| `ff 02` | 2 ticks |
| `0c 0a`, `0d 09` | Envelope period, coarse = `$0a`; shape `$09`: fall, then hold at silence |
| `ff 00` | End |

That is noise rising in pitch for 20 ticks (0.4 s), then decaying: the swoosh. Register 11,
the envelope period's fine byte, is never written, so its value is whatever the ST held.

### The sound as PCM, and a recording of the logo

The port plays sampled sound only (`SoundManager` builds an `AudioBuffer` per sample), so
the swoosh ships as a recording, not as a chip. The source is the YouTube video
"DungeonMaster DMAA MSTE" by MrPetari (`https://www.youtube.com/watch?v=Iojq4NVtdHU`), an
Atari Mega STE booting the game. Its audio track (Opus, 48 kHz) is silent from 12.75 s
until the swoosh starts at 16.845 s.

`static/gamefiles/dm-atari-1.2/swoosh.wav` (md5 `53ca1660791d0d9e1f6cf15b818d7932`) is
16.835–17.845 s of that track: mono, 16-bit, 48 kHz, 1.01 s, the last 150 ms faded out and
the peak scaled to −1 dBFS. It swells for about 0.4 s, rising in pitch as the noise period
falls, and decays to near silence by 0.8 s.

The video, decoded frame by frame from the start (25 fps; seeking into it gives times up
to a second off), agrees with the palette script:

| Video | Screen | Script |
| --- | --- | --- |
| 16.56 s | Black: the picture is drawn, the palette is not | |
| 16.72 s | The first of the trail | VBL 0 |
| 17.12 s | The letters and the starburst | VBL 22 |
| 17.20 s | The starburst gone | VBL 26 |
| 17.28 s | The yellow glint | VBL 30 |

The reveal takes 0.56 s, and the sound starts with it, as `$0002` calls `Dosound` just
before the script. After the glint the logo stays up until the title's dark blue comes in
at 20.80 s, with two grey screens in between (17.60–18.28 s and 19.56–20.52 s). What causes
them is not established, so the recording does not give a hold time the port could copy.

## The 1.2 data files against `dm-atari/`

`static/gamefiles/dm-atari/graphics.dat` (md5 `0b5e042f…`) is byte-identical to
`dm-windows/graphics.dat`, the file CSBWin's DM distribution
(`DM_Windows_x86-32_20171117.zip`) ships. It is not the 1.2 disk's. Which version it comes
from is not established. Both have 563 items, and they differ in seven:

| Item | What it is | 1.2 disk | `dm-atari/` |
| --- | --- | --- | --- |
| 5 | The credits scroll | The same text. From "Dennis Walker" down, the lines sit a few pixels apart horizontally. | |
| `0xe8` (232) | Crack Switch (In), front view (`121 + 2*55 + 1`) | 8 pixels differ, x 11–14, y 2–4 | |
| `0x18c` (396) | A 64x7 graphic, not identified | 261 pixels differ | |
| `0x22c` | Object names | `BRO POTION`, `MA POTION` | `ANTIVEN POTION`, `MON POTION` |
| `0x22e` | `Byte4100[55]`, Crack Switch (In)'s coordinate set (raw byte 3201) | **2** | **0** |
| `0x22f` | `MonsterDescriptor[24]`, byte 14 (the high byte of `word14`) | `$36` | `$26` |
| `0x22f` | `ObjDesc[62]` (`OBJNI_STAFF_OF_IRRA`), byte 2, `graphicClass` | 11 | 35 |
| `0x230` | `experienceForAttacking[32]` (SHOOT) | 20 | 9 |
| `0x230` | `skillNumber[8]` (WAR CRY) | 7 | 14 |
| `0x230` | `Byte20046[2, 15, 19, 25]` (CHOP, THRUST, BERZERK, MELEE) | 10, 17, 40, 25 | 8, 13, 26, 17 |
| `0x230` | `Spells[4].byte5` | 18 | 15 |

The raw offsets: `Byte4100` starts at byte 3146 of `0x22e` in both files (read through
`readWallDecorationRectSetIndex`). `MonsterDescriptor` starts at byte 676 of `0x22f`
(`10340 - 9664`, 26 bytes an entry) and `ObjDesc` at 1958 (`10340 - 8382`, 6 bytes an
entry). `0x230`'s attack tables start at byte 64 (7 tables of 44 bytes, in `UITables`'
order) and `Spells` at 1026 (8 bytes an entry).

**The Crack Switch.** The 1.2 `graphics.dat` puts Crack Switch (In) in coordinate set 2,
low on the wall, where Crack Switch (Out) is. That is the value `correctCrackSwitchInPlacement`
writes (`doc/PROVEN_FACTS.md` → "Crack Switch (In) placement"). The misplaced crack is a
property of the `graphics.dat` CSBWin ships, not of the original game.

`dungeon.dat` is the same size in both (33442 bytes, uncompressed) and differs in four
bytes: bit 7 of `word2`, which CSBWin calls `important` (`doc/CSBwin-src/CSB.h:1148`), is
set in the 1.2 file and clear in ours for four weapons: a sling (weapon #54, map 0 (16,7))
and three rocks (weapons #104, #105, #106, map 1).
