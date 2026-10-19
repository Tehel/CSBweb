# Atari ST Disk Reference: Dungeon Master's six disks, and Chaos Strikes Back's utility disk

What the original Atari ST game disks hold that CSBWin does not: the boot chain, the FTL
logo animation (`SWOOSH.IMG`) that ran before the title, what each release changes in
`dungeon.dat` and `graphics.dat`, and which release CSBWin's own files (`dm-windows/`)
come from. The English 1.2 disk is the reference for the boot chain and the logo; the
German 1.2 and French 1.3 disks, the same but translated, have their own sections. The
last section is Chaos Strikes Back's utility disk, whose champion portraits CSBWin does
not port.

This is not CSBWin-sourced. The authority is the disk itself. A citation `swoosh.img:$0070`
is a byte offset into that file, and a citation `boot:$003a` is an offset into the boot
sector, both taken from a 68000 disassembly. A citation `chaos:$4518` is an offset into
the code of the utility's program, `CHAOS.FTL`. What is known about TOS (the XBIOS calls,
the `Dosound` byte codes, the YM2149 registers) is the Atari's documented behaviour and
is marked as such. A citation `map 5 (6,18)` is a square of a disk's `DUNGEON.DAT`, as
`tools/peek-dungeon.ts --file <it> cell 5 6 18` shows it.

`doc/dm-versions.html` tells the version history below in a form nicer to read.

## The disks

`archive/Game,Dungeon_Master,Atari_ST,Software/` (gitignored) is a collection of the
Atari ST releases. Its `Floppy Disks STX/` holds six Pasti images of the original disks,
`Dungeon Master for Atati ST <version>.stx` (sic):

| Version | Image md5 | `GRAPHICS.DAT` | `DUNGEON.DAT` |
| --- | --- | --- | --- |
| 1.0 (English) 1987-12-08 | `58286fce…` | 271911, 1987-12-08, `b3cfd84e…` | 33286, 1987-12-08, `ebccb5f9…` |
| 1.0 (English) 1987-12-11 | `3fd743a3…` | 271918, 1987-12-11, `7eee3969…` | 33314, 1987-12-11, `c4a54af4…` |
| 1.1 (English) | `5ee3f902…` | 271917, 1988-01-07, `5095a136…` | 33442, 1988-01-07, `e0333c81…` |
| 1.2 (English) | `279e322b…` | 271918, 1988-02-18, `9ce2eaf7…` | 33442, 1988-03-01, `050fb2cf…` |
| 1.2 (German) | `97cc99bf…` | 272288, 1988-03-01, `2bdc5f43…` | 33792, 1988-03-01, `cea11d6e…` |
| 1.3 (French) | `933955a6…` | 271995, 1988-05-20, `0d7af44d…` | 33774, 1988-05-20, `dfd82fb7…` |

The six are alike as disks. Each is single-sided, 10 sectors of 512 bytes a track, 80
tracks (the five later images keep two more track records). Track 0 carries the copy
protection: sector 7 is stored with fuzzy bits and a CRC error (FDC flags `0x88`), and an
extra sector numbered 247 follows it. Nothing else on the disks is unusual. The
filesystem is plain FAT12 (2 sectors a cluster, 16 root entries), and every root
directory holds the same six files. `SWOOSH.IMG` and `START.PRG` are byte-identical on all
six; `BOOTER` and `START.PAK`, the packed program, differ on each. Each disk's six files,
read through the image's sector records and the FAT, are in the collection's
`extracted/<version>/`.

The collection's cracked copies agree with the originals where they can be read. The
`GRAPHICS.DAT` and `DUNGEON.DAT` of `Floppy Disks MSA/…v1.1 (English) Cracked.msa` are
1.1's. The `GRAPHICS.DAT` of `Floppy Disks ST/…v1.0 (English) 1987-12-08 Cracked
(42-Crew).st` is CSBWin's, below; its `DUNGEON.DAT` is the 8 December one but for 694
bytes, all in the text (file bytes 5685-7087), which garble the texts of 55 squares.

The English 1.2 disk's six files:

| File | Size | Date | md5 | What it is |
| --- | --- | --- | --- | --- |
| `BOOTER` | 1024 | 1999-12-31 | `e1abcf34…` | Not examined. Contains the string `start.pak`. |
| `SWOOSH.IMG` | 3016 | 1999-12-31 | `57a685a0…` | The FTL logo: 68000 code, a picture, a sound, a palette script. |
| `START.PRG` | 770 | 1999-12-31 | `a9730cd7…` | A GEMDOS program, run by `SWOOSH.IMG`. Not examined. |
| `GRAPHICS.DAT` | 271918 | 1988-02-18 | `9ce2eaf7…` | The 1.2 graphics. |
| `START.PAK` | 95148 | 1988-02-24 | `60df1980…` | Presumably the packed game program. Not examined. |
| `DUNGEON.DAT` | 33442 | 1988-03-01 | `050fb2cf…` | The 1.2 dungeon. |

Three of them are in the repository under lower-case names: `graphics.dat` and
`dungeon.dat` in `static/gamefiles/dm-atari-1.2/`, and `swoosh.img` in `src/assets/`, the
page's own, which every version shares, with the swoosh's sound as PCM (below). The data files load: the graphics through
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
are built at run time (`$00b0`–`$00c6`), at `a4` and at `a5`, 64 bytes on; each long holds
the same mask in both of its words. `lea $0bc8(pc),a6` (`$009e`) points just past the end
of the file, but `movea.w a6,a4` and `movea.w a6,a5` (`$00a2`, `$00a4`) keep only the low
word of that address, sign-extended: with the file loaded at `$40000`, the tables are at
the absolute addresses `$0bc8` and `$0c08`, in low memory, not after the file.

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
"Dungeon Master - Atari ST (1987)" by Wasabim
(`https://www.youtube.com/watch?v=DGLkPY22pkg`). In its audio track (AAC, 44.1 kHz, stereo
with both channels alike) the swoosh's noise starts at 23.270 s and peaks at 23.666 s: a
rise of 0.396 s, the script's 20 ticks. It has decayed to nothing by 24.1 s. Under the
noise the signal's level drifts below zero, as far as −22 dBFS at 23.93 s, and comes back
by 25.5 s, where the track is digital silence.

`src/assets/swoosh.wav` (md5 `05e3dae57e71ac8d7ecbdc5575cba1d0`) is
23.260–25.500 s of that track, the two channels averaged: mono, 16-bit, 44.1 kHz, 2.24 s,
the first 5 ms faded in and the peak scaled to −1 dBFS. Nothing is filtered, so the drift
is in it; what is heard is the first 0.85 s.

The picture's timing is read from another video, "DungeonMaster DMAA MSTE" by MrPetari
(`https://www.youtube.com/watch?v=Iojq4NVtdHU`), an Atari Mega STE booting the game, where
the swoosh starts at 16.845 s. Decoded frame by frame from the start (25 fps; seeking into
it gives times up to a second off), it agrees with the palette script:

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
them is not established, so that video does not give a hold time the port could copy.

### The logo in the port

Not CSBWin's, and not an extra either (`DEBT.md` H): every boot shows the logo before the
title animation. Only `?intro=0` skips it, with the rest of the
intro. There is no setting to turn it off yet.

- `main.ts` imports `swoosh.img` and `swoosh.wav` from `src/assets/` as the page's own
  assets, so every build holds them (`doc/DEPLOYMENT.md` → "The build"), and fetches them at
  the boot. Without the first file there is no logo; without the second it is silent.
- `loadSwoosh` (`src/data/SwooshLoader.ts`) reads the picture, the colour patterns and the
  palette script from the file. Only the decoder is code of the port's, a transcription of
  `$0070`–`$01d4`.
- `showSwoosh` (`src/renderer/intro/Swoosh.ts`) is the script's interpreter, on the intro
  host: black registers, the picture, the sound, then each word a `Setcolor` or a wait, at
  the host's 60 Hz. `runBootSequence` calls it once, before `displayChaosStrikesBack`.
- **The hold is the author's choice**, as nothing above gives one: 60 VBLs
  (`SWOOSH_HOLD_VBLS`), then a `fadeToPalette` to black and a cleared screen, which the
  title's own first fade starts from.
- The sound is `SoundManager.playRecording`. A browser that still holds the page's audio
  until a first click gives a silent logo: the recording is not kept for later.

`tools/dump-swoosh.ts` checks the decode (2306 bytes read, 64000 pixels, the code counts
above, and `tools/fixtures/swoosh-index.png` pixel for pixel) and the script's timing on a
headless host.

## What each version changes

Every disk's `DUNGEON.DAT` has the same header (seed 99, the party at map 0 (1,3) facing
south, 14 maps), the same level descriptors and the same 12366 bytes of maps but for the
squares named below. Every `GRAPHICS.DAT` has 563 items. Compared square by square
(each square's flag byte and its objects, chests' and monsters' contents included) and
item by item (decompressed), the English releases differ only as follows. Maps are
numbered from 0, as the files do: map 5 is the game's level 6.

### 1.0, 8 December 1987, to 1.0, 11 December 1987

`graphics.dat`, three items:

- **Graphic 232**, Crack Switch (In)'s front view (`121 + 2*55 + 1`): 8 December's crack
  is empty; 11 December draws the button pushed in, on the 8 pixels (x 11-14, y 2-4)
  where Crack Switch (Out)'s front view, graphic 222, draws its button.
- **`0x22e` byte 3201**, `Byte4100[55]`, Crack Switch (In)'s coordinate set: 0 (eye level)
  becomes 2, low on the wall, where Crack Switch (Out) is.
- **Graphic 396** (64x7), the floor picture of graphic class 35 (`s5604[35]`, whose
  `objectGraphicIndex` is 36, drawn as graphic `360 + 36`), which the Torch
  (`ObjDesc[25]`, weapon 2) and, until 1.1, the Snake Staff use: the torch is redrawn,
  261 pixels differ. 8 December's has a small dark tip; 11 December's a larger black
  head.

`dungeon.dat`:

- **Nabi's mirror**, map 0 (17,10), is empty on 8 December. 11 December puts a Staff, a
  Tunic, Blue Pants and Sandals behind it, all `important`, in records that were free.
- **Map 1's doors**, nine of them (`DB0.word2`: bit 0 the type, bits 1-4 the ornament,
  bit 5 opens up, bit 7 fireball, bit 8 axe; `doc/CSBwin-src/CSB.h:825-847`):

  | Square | 8 December | 11 December |
  | --- | --- | --- |
  | (1,0) | `0x0067` | `0x0061`: ornament 3 removed |
  | (3,13) | `0x0027` | `0x0023`: ornament 3 becomes 1 |
  | (6,1) | `0x0060` | `0x01e0`: breakable by fireball and axe |
  | (6,5) | `0x0022` | `0x0020`: ornament 1 removed |
  | (7,22) | `0x01e2` | `0x0060`: ornament 1 removed, no longer breakable |
  | (11,0) | `0x0007` | `0x01a1`: ornament 3 removed, opens up, breakable |
  | (17,26) | `0x0000` | `0x0020`: opens up |
  | (18,20), (25,11) | `0x0024` | `0x0004`: opens sideways |

- **Map 1's wall decoration list** is reordered (`[33,4,35,1,49,51,15,…]` becomes
  `[33,4,35,51,15,1,49,…]`), and the four actuators at (6,4) and (20,18) that name one
  are renumbered with it, so every wall shows what it showed.
- **Map 2's spinners**, the teleporters at (3,8) and (5,0) that send everything back to
  their own square turned, are inactive on 8 December (flag `0xb0`) and active on 11
  December (`0xb8`).
- **Map 2's blue button** at (21,11), whose actuators set the teleporter at (20,14),
  clear it, and open the door at (22,12), becomes a one-shot button that stays pressed: a
  once-only actuator with local action 1 (`RotateActuatorList`) is put first, and two of
  the actuators show ornament 52, the button pushed in, where they showed 16, the button
  out. The walls at (19,12), (20,11) and (21,13) are given random decorations.
- **Map 3 (11,26)**, a floor square closed on three sides behind the teleporter at
  (12,26), becomes an invisible teleporter that takes items, and only items, to map 2
  (7,15), beside where that teleporter lands the party.

### 1.0, 11 December 1987, to 1.1

`graphics.dat`, three items:

- **`0x22c`**, the object names: `ANTIVEN POTION` becomes `UNVEN POTION`.
- **`0x22f`**: `MonsterDescriptor[24]` (the dragon), the high byte of `word14`, `$26`
  becomes `$36`: `word14_12_15`, the distance a monster attacks from
  (`doc/CSBwin-src/Monster.cpp:4190`), 2 becomes 3. `ObjDesc[62]` (`ObjDesc` is indexed
  by `DescIndex`, weapons from 23: weapon 39, the Snake Staff, CSB's Cross of Neta), byte
  2, `graphicClass`, 35 becomes 11: the staff on the floor was drawn as the
  Torch, and is drawn as the plain staff (graphic 372) the Staff of Claws, the Sling, the
  Staff, the Yew Staff and the Staff of Manar share.
- **`0x230`**: `Byte20046`, the stamina an attack costs (`doc/CSBwin-src/Attack.cpp:1721`),
  CHOP 8 → 10, THRUST 13 → 17, BERZERK 26 → 40, MELEE 17 → 25;
  `experienceForAttacking[32]`, SHOOT, 9 → 20; `Spells[4].byte5`, the skill OH EW RA
  uses (`doc/CSBwin-src/Magic.cpp:1215-1218`), 15 (Defend) → 18 (Earth).

`dungeon.dat`:

- **The Lock Picks go.** Alexander's mirror, map 0 (16,7), holds a Sling where it held
  Lock Picks, and the alcove at map 6 (5,0) loses its Lock Picks. Both misc records (#8,
  #116) are left free.
- **The Eye of Time on map 7 (6,17) goes**; its record, weapon #54, is the Sling.
- **Rocks**: new weapons #104 and #106 lie at map 1 (4,16) and (29,11). #105, also a
  rock, is free (its next word `0xffff`) and placed nowhere.
- **Map 5, a skeleton ambush.** Floor actuators at (4,15) and (6,15) open the new false
  walls at (5,18) and (5,22), onto two new closets, (6,18) and (6,22), holding 2 and 4
  skeletons. Two more groups, 4 at (6,16) and 1 at (7,14), make 11 new skeletons, all
  `important`. A new switch at (8,15) toggles the door at (5,15), which only the switch at
  (4,14), on its other side, did before.
- **Map 3's doors**: eight that fireball and axe could break no longer can (`0x01e3` →
  `0x0063` at (2,17), (5,24), (7,15), (11,18), (13,5), (16,9), (24,21), (27,22)); (21,25)
  and (23,3) become breakable.
- **Map 7's big switch** at (16,25), a toggle whose rotating actuator showed ornament 51
  (the green button, pushed in) once pressed, shows 54 (the big switch, pushed in).
- **Map 7 (30,21)**: the two FUL bombs' power, 0, becomes 120.
- **Map 11 (23,11)**: the false wall the floor actuator at (24,11) sets becomes a door with
  a switch.
- **Map 8 (7,30)**: the wall text `WHEN IS A ROCK / NOT A ROCK` becomes `WHEN IS ROCK /
  NOT ROCK`, one word shorter.

### 1.1 to 1.2 (English)

`dungeon.dat` differs in four bytes: bit 7 of `word2`, which CSBWin calls `important`
(`doc/CSBwin-src/CSB.h:1151`), is set on the Sling and the three rocks. `graphics.dat`
differs in two items: `0x22c` renames `UNVEN POTION` and `MON POTION` to `BRO POTION` and
`MA POTION`, and in `0x230`, `skillNumber[8]`, WAR CRY's skill, 14 (Influence) becomes 7
(Parry).

The raw offsets: `Byte4100` starts at byte 3146 of `0x22e` (read through
`readWallDecorationRectSetIndex`), and `s5604` follows the port's `computeOffsetFromWall`.
`MonsterDescriptor` starts at byte 676 of `0x22f` (`10340 - 9664`, 26 bytes an entry) and
`ObjDesc` at 1958 (`10340 - 8382`, 6 bytes an entry). `0x230`'s attack tables start at
byte 64 (7 tables of 44 bytes, in `UITables`' order) and `Spells` at 1026 (8 bytes an
entry). Skill numbers are `CHARDESC.skills92`'s, four subskills a class from 4.

## CSBWin's files

`static/gamefiles/dm-windows/graphics.dat` (md5 `0b5e042f…`), the file CSBWin's DM
distribution (`DM_Windows_x86-32_20171117.zip`) ships, is **the 8 December 1987 disk's
`GRAPHICS.DAT` with its credits scroll corrupted**. The two differ in item 5 alone, four
bytes that draw four lines of the text wrong from "Dennis Walker" down ("Jaros" reads
"Jeros"). It is byte-identical to the 42-Crew cracked copy's (above). Every original
disk's credits are intact: the corruption came with a copy.

Its `dungeon.dat` is 1.1's: `dm-atari/dungeon.dat` is byte-identical to the 1.1 disk's
`DUNGEON.DAT`, and `dm-windows/dungeon.dat` is the same dungeon re-saved by CSBWin
(`doc/PROVEN_FACTS.md` → "DM's two `dungeon.dat` files"). CSBWin's DM is therefore 1.1's
dungeon over the first 1.0's tables, and against the 1.2 disk it differs in everything
the sections above list for `graphics.dat`, and in the four `important` bits:

| Item | What it is | 1.2 disk | CSBWin's | Changed in |
| --- | --- | --- | --- | --- |
| 5 | The credits scroll | The text as drawn | Corrupted | (the copy) |
| `0xe8` (232) | Crack Switch (In), front view | The button pushed into the crack | The crack empty | 1.0, 11 December |
| `0x18c` (396) | Graphic class 35's floor picture (the Torch) | 11 December's | 8 December's | 1.0, 11 December |
| `0x22e` | `Byte4100[55]` (raw byte 3201) | **2** | **0** | 1.0, 11 December |
| `0x22c` | Object names | `BRO POTION`, `MA POTION` | `ANTIVEN POTION`, `MON POTION` | 1.1, 1.2 |
| `0x22f` | `MonsterDescriptor[24]`, byte 14 | `$36` | `$26` | 1.1 |
| `0x22f` | `ObjDesc[62]`, `graphicClass` | 11 | 35 | 1.1 |
| `0x230` | `experienceForAttacking[32]` (SHOOT) | 20 | 9 | 1.1 |
| `0x230` | `Byte20046[2, 15, 19, 25]` | 10, 17, 40, 25 | 8, 13, 26, 17 | 1.1 |
| `0x230` | `Spells[4].byte5` | 18 | 15 | 1.1 |
| `0x230` | `skillNumber[8]` (WAR CRY) | 7 | 14 | 1.2 |

**`dm-atari/graphics.dat` is CSBWin's file with 1.2's items 5, 232 and `0x22e`**: the
credits, the pressed crack's button and the crack's placement, and no other change
(`doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's with three items from the
1.2 disk"). The other rows of the table are 1.0's in `dm-atari` as in CSBWin.

## The German 1.2 disk

The 1.2 (German) image (md5 `97cc99bf5b594b8260f42d9d81320308`) is the English 1.2 disk
translated: its `START.PAK` (95202 bytes, 1988-02-24) and both data files (1988-03-01)
differ, and nothing in them but the language. Its files are not in the repository.

`dungeon.dat` differs from the English 1.2's only in its text, 1924 words against 1749,
and the text records that point into it; every other database, the maps and the object
list are identical. The champions' stats, in their texts, are the same, and so are their
names and titles but one: WU TSE has no title, where the English disk's is SON OF HEAVEN.

`graphics.dat` differs from the English 1.2's in items 1, 4, 6, 10, 27, 30, 31, 32, 40,
`0x22c`, `0x230` and `0x232`, the items the French disk translates but for the fonts
(`0x22d`, graphic 120) and `DecodeText`'s strings (`0x22f`), which the German texts need
no more of than the English: they spell an umlaut as two letters (`ZURUECK`). Graphic 27
is 144x78, as in 1.3; graphics 30 and 31 are 64 pixels wide. `0x230` is 1356 bytes, as in
1.3, its tables the English disk's and its attack names German (`BLOCKIEREN`,
`SPALTEN`, …). In `0x232`, bytes 875 and 883 (EAU's and NOURRITURE's `x2` in 1.3) are 175
for both, and bytes 1707, 1709, 1715 and 1717 are 84, 236, 82 and 238.

The two translations keep potion names the English disk renamed in 1.2: the German
`0x22c` has `GEGENGIFT` and `MON TRANK`, the French `POTION UNVEN` and `POTION MAN`, where
1.2 has `BRO POTION` and `MA POTION`.

## The French 1.3 disk

The 1.3 (French) image (md5 `933955a6a596081b4bc62655efeafde5`) has the 1.2 disk's
geometry, copy protection, boot sector and six files. `SWOOSH.IMG` and `START.PRG` are
byte-identical to 1.2's; `BOOTER` (`e9db80a6…`), `START.PAK` (95208 bytes, `6131be44…`),
`GRAPHICS.DAT` and `DUNGEON.DAT` are not. The two data files are
in `static/gamefiles/dm-atari-1.3-fr/`, and both load:

| File | Size | Date | md5 |
| --- | --- | --- | --- |
| `graphics.dat` | 271995 | 1988-05-20 | `0d7af44dd14f383464288abdcec76afc` |
| `dungeon.dat` | 33774 | 1988-05-20 | `dfd82fb7d44e4b5cc81add257655c966` |

**Nothing but the language changes.** Every difference from 1.2 is text, in words or in
pixels. What 1.2 changed against CSBWin's files stays as 1.2 has it: `Byte4100[55]` is 2, and
the credits scroll, graphic 232, graphic 396, the monster and object bytes, the attack
values and the four `important` weapons are 1.2's.

`dungeon.dat` differs from 1.2's only in its text: 1915 words against 1749, and the text
records (database 2) that point into it. The header's other fields, the maps, the column
index, the object list, every other database and the cell flags are identical. The texts
are French ("JE SUIS DUR JE SUIS AZUR ET JE FULGURE" is `TEXT #70` on map 5).

`graphics.dat` differs from 1.2's in:

| Item | What changes |
| --- | --- |
| 1 | The title: "Presents" becomes "Présente" |
| 4 | The entrance: ENTER / RESUME become ENTRER / RECOMMENCER |
| 6 | "The End" becomes "Fin" |
| 10, 27, 30, 31, 32, 40 | Interface pictures with words in them: the save panel's PASS, CORRECTION for BACKSPACE, NOURRITURE (graphic 30, 96 pixels wide where FOOD is 48), EAU, VENENEUX, RESSUSCITER / RÉINCARNER / ANNULER. Graphic 27 is 144x78, where 1.2's is 144x73 |
| 120 (`0x78`) | The wall-text font, 288x8 |
| `0x22c` | The object names, in French (`BOUSSOLE`, `TORCHE`, …) |
| `0x22d` | The font |
| `0x22f` | `Byte10336` and `Byte10016`, `DecodeText`'s strings after code 30 (below) |
| `0x230` | The attack names, in French (`FENDRE`, `ENTAILLER`, …), 400 bytes where 1.2's are 300: the item is 1356 bytes, not the 1256 CSBWin asserts (`doc/PROVEN_FACTS.md` → "The French 1.3 `graphics.dat`: longer words") |
| `0x232` | Six x coordinates. Bytes 875 and 883 are the low bytes of `wRectPos958.x2` (159 → 143, EAU) and `wRectPos950.x2` (159 → 207, NOURRITURE). 1707, 1709, 1715 and 1717, not identified individually, are in the last 136 bytes, where the entrance's rectangles are. |

`DecodeText` looks up code 30's next code in `d.Byte10336` for wall text and in
`d.Byte10016` for any other text (`doc/CSBwin-src/CSBCode.cpp:5624-5639`; the port's
`DungeonState.ts`, reading `textDecode`), 8 bytes a string. In 1.2, `Byte10336` holds
strings 2 and 3 (THE, YOU, in wall glyphs) and `Byte10016` strings 0–3 (`?`, `!`, `THE `,
`YOU `). 1.3 makes strings 0, 1 and 4–9 single glyphs past the 1.2 character sets: 28, 29
and 30–35 in wall text, 120, 121 and 122–127 in the rest, replacing `Byte10016`'s `?` and
`!`. The glyphs they draw:

- **The main font (`0x22d`)**: 120 is `?` and 125 an apostrophe. 121–124, 126 and 127 are
  blank, so the French `!` (string 1) prints as a space. The font changes glyphs 4, 12, 15,
  20, 29, 120 and 125 against 1.2's.
- **The wall font (graphic 120)**: 33 is an apostrophe. 28–32, 34 and 35 are blank, where
  1.2's 28 and 29 are `?` and `!`.

The texts use string 7 (the apostrophe, 31 texts) and string 1 (`!`, in `TEXT #118`). Two
texts are wrong in the file. `TEXT #44` ("… LE JOYAU·ET SEUL …") and `TEXT #118` ("… JE
L'AI·JE N'AI …") put escape 29/26 where a comma is meant: `Byte10080[26]`, which every
text type shares, is 50, a `2` in the main font and past the wall font's 36 glyphs.
Neither is drawn in the wall font: `TEXT #44` is a scroll's (`SCROLL #31`, map 13
(23,4)), and `TEXT #118` is on the teleporter square at map 0 (9,1), where the party is
sent when the Firestaff comes back unfused, and is printed in the message area. Both
show the `2`. No text on a wall, in either file, has a code past the wall font, a line
over 18 glyphs or more than four lines (`tools/dump-wall-text.ts`).

## The Chaos Strikes Back utility disk

`archive/CSB4S/CSB_UTIL.ST` (md5 `15ca0047d178997133837818576063da`, gitignored) is a raw
sector image from a 2021 repack, `CSB4S.ZIP`, whose README says the utility disk is
unchanged but for its copy protection. The filesystem is FAT12: single-sided, 10 sectors
of 512 bytes a track, 2 sectors a cluster, 16 root entries. Every file is dated
1989-12-01 except `BOOTER` and `SWOOSH.IMG` (1985-11-20). The root holds thirteen files
and a folder:

| File | Size | md5 | What it is |
| --- | --- | --- | --- |
| `BOOTER` | 1024 | `fdb97f2e…` | Not examined. |
| `SWOOSH.IMG` | 3016 | `57a685a0…` | The FTL logo, byte-identical to DM 1.2's (`src/assets/swoosh.img`). |
| `START.PRG` | 8102 | `f7fbb342…` | A GEMDOS program. It holds the string `A:\FTLCODE`. Not examined. |
| `FTLCODE` | 15080 | `4b21e2d5…` | An FTL module (below). It holds the string `A:\SWITCH.DAT`. Not examined. |
| `SWITCH.DAT` | 7405 | `b1fc60f2…` | Not examined. |
| `CHAOS.FTL` | 42090 | `2de4a565…` | The utility, `doc/CSBwin-src/Chaos.cpp`'s original (below). |
| `HINT.FTL` | 49436 | `8dfea415…` | The hint oracle, `doc/CSBwin-src/Hint.cpp`'s original (below). |
| `HCSB.DAT` | 30793 | `708e113c…` | The hint oracle's, byte-identical to `static/gamefiles/csb/hcsb.dat`. |
| `HCSB.HTC` | 66172 | `8ce69b54…` | Byte-identical to `static/gamefiles/csb/hcsb.hct`. |
| `ANIMATE.FTL` | 21128 | `e882f1a6…` | An FTL module. Not examined. |
| `ANIMATE.DAT` | 58683 | `9f8feb26…` | Not examined. |
| `ANIMATE.SCR` | 1802 | `4174d6de…` | Not examined. |
| `MINI.DAT` | 42815 | `531ea104…` | The new adventure, byte-identical to `static/gamefiles/csb/mini.dat`. |
| `PORTRAIT\` | — | — | 24 champion portraits (below). |

### The portraits

`PORTRAIT\` holds one `<NAME>.CMP` file for each of DM's 24 champions, from `ALEX.CMP`
to `ZED.CMP` (`WUTSE.CMP` for WU TSE). Each is 508 bytes:

| Bytes | What |
| --- | --- |
| 0-15 | A header. Word 0 is `0x91a7` in all 24. The rest is `000a 0001 0001 0001 0000 0000 0000` in 15 files and `0000 0000 0001 0001 0000 0000 0000` in 9 (CHANI, IAIDO, LEIF, LEYLA, LINFLAS, MOPHUS, NABI, STAMM, WUUF). What the words mean is not established. |
| 16-23 | The champion's name, NUL-padded. |
| 24-43 | The title, NUL-padded. AZIZI, DAROOU, GOTHMOG and LINFLAS have none. |
| 44-507 | The portrait, 464 bytes in a `CHARDESC`'s layout (`src/data/CsbwinCharacters.ts`): 32x29, four bitplanes, 16 bytes a line. |

Each name is the name of exactly one hero behind DM's mirrors (`dm-atari/dungeon.dat`),
and so names one cell of DM's portraits, graphic 26. Each portrait is a new drawing of
that champion: none is any cell of graphic 26, and the nearest cell differs in 130 to
745 of 928 pixels. Many are armed or armoured: Halk, for one, wears a horned helmet and
carries a shield.

`static/gamefiles/csb/utility-portraits.dat` holds them for the port, RISE's NEW FACE
(`doc/SAVES.md`). It is a `graphics.dat` of two items, which `GraphicsLoader` reads.
Item 0, stored uncompressed, is a 256x87 IMG1 picture laid out like graphic 26, so cell
`charID` is the drawing of the champion whose DM portrait is cell `charID`. Item 1 is
graphic 26 itself, copied as `dm-atari/graphics.dat` stores it, which the champions'
portraits are matched against. `tools/gen-utility-portraits.ts` builds the file from the
disk image, and checks that every cell decodes to its `.CMP`'s pixels and goes back,
through `writePortrait`, to its 464 bytes, and that item 1 decodes to graphic 26. Graphic 26 is byte-identical in the
`graphics.dat` of `dm-atari`, `dm-atari-1.2`, `dm-atari-1.3-fr`, `dm-windows` and
`kids-dungeon-24`. It is not in `3D2D1D`'s or Conflux's.

### The utility, `CHAOS.FTL`

`CHAOS.FTL` is an FTL module, as `FTLCODE`, `HINT.FTL` and `ANIMATE.FTL` are: all four
open with the word `0x6160`. The header's third segment entry is offset `0x19d0` and
length `0x8a9a`, which end at the file's end, and that segment is the code. The program
is neither packed nor enciphered.

**CSBWin's names are addresses in it.** `Chaos.cpp` names its functions after their
offsets in that code: `_TAG000ede`, `_TAG000fc4`, `_TAG00179c`, `_TAG00260e`,
`_TAG0026c4`, `TAG002724`, `_StartChaos` (`TAG002a38`), `_TAG004430` and `_TAG004518`
each begin with `LINK A6` (`4e56`) at their offset. `TAG00439e`, which has no frame,
begins `move.l d7,-(sp); moveq #0,d7`. `_ReadSavedGame` is `TAG001868`
(`doc/CSBwin-src/Chaos.cpp:2788`).

**`HINT.FTL` is laid out the same way.** Its header's third segment entry is offset
`0x0ec6` and length `0xb256`, which end at the file's end. Of the 179 `TAG` offsets
`Hint.cpp` names, 150 begin with `LINK A6` at their offset in that segment; the 29
others are not examined.

**"MAKE NEW ADVENTURE" reads no portrait.** Button 13 of `_TAG004518`
(`doc/CSBwin-src/Chaos.cpp:4806-4833`) makes the same calls as the original, in the same
order: `chaos:$491a`-`$4972` calls `$352c` (`InvertButton`), `$260e`, `$1868`, `$26c4`,
`$439e`, `$2724`, `$439e`, `$0fc4`, `$352c`. A new adventure's portraits are the editor's
copies, which `TAG00439e` swaps into the champions around `TAG002724`.

**The portraits are the champion editor's, by hand.** Of the buttons CSBWin leaves to
`DontDoThis`, button 11 (`chaos:$476a`) calls `$2478`, which calls `$20da`, which calls
`$1fea`. The program's file calls push a GEMDOS number and `jsr $9a(a5)`, and `$1fea` is
the only function that does so with `0x1a`, `0x4e` and `0x4f` (`Fsetdta`, `Fsfirst`,
`Fsnext`): it lists a folder. Button 12 (`chaos:$4872`) calls `$1de6`, which calls
`_TAG000ede` (the slot and "REPLACE …?" prompt) and `_TAG000fc4` (the game's write), and
calls `0x3c` (`Fcreate`) through `$9a(a5)` as `_TAG000fc4` does. The data holds the paths
`A:\PORTRAIT\` and `.CMP`, the buttons GAME, PORTRAIT and CANCEL, and these messages,
which `UtilityDiskMessages` (`doc/CSBwin-src/Chaos.cpp:518-561`) keeps as empty strings.
Taken in the order they are stored, CSBWin's own messages fall at their own indices, and
these fall at the empty ones:

| Index | Message |
| --- | --- |
| 3 | YOU MAY LOAD EITHER / A SAVED GAME OR / A CHAMPION PORTRAIT |
| 4 | YOU MAY SAVE EITHER / THE WHOLE GAME OR / $'S PORTRAIT |
| 5 | SELECT A / CHAMPION / PORTRAIT |
| 7 | THIS WILL DESTROY ALL / INFORMATION ON THE DISK / IN @ |
| 11 | PLEASE WAIT . . . / FORMATTING DISK |
| 13 | THERE ARE NO PORTRAITS / ON THIS DISK! |
| 16 | ERROR WHILE / FORMATTING DISK |
| 17 | ERROR WHILE / SAVING CHAMPION |
| 18 | THIS CHAMPION / IS DAMAGED! |
| 19 | THIS CHAMPION / CANNOT BE USED WITH / THIS ADVENTURE |

The bodies of `$1de6`, `$1fea`, `$20da` and `$2478` are not disassembled, so it is not
established what loading a `.CMP` does to a champion's name and title, what the header
words select, or when message 19 is shown.
