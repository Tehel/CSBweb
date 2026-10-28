# Amiga Disk Reference: Dungeon Master for the Amiga, 2.2 English

What the Amiga release of Dungeon Master holds that CSBWin does not: its disks, its program's
tables and how its `graphics.dat` differs from the Atari's. It is the ground the `dm-amiga`
set stands on (`DEBT.md` → "A — The Amiga version").

This is not CSBWin-sourced. The authority is the disk itself, and for what its code does,
ReDMCSB (below). A citation `dm:data+3738` is a byte offset into `dm`'s data hunk; a
citation `doc/ReDMCSB-src/SOUND.C:1107` is a line of ReDMCSB's source.

## The reference: ReDMCSB, A22E

CSBWin ports the Atari ST release and has nothing of the Amiga's own. For what only the
Amiga does, the reference is ReDMCSB, Christophe Fontanel's reverse-engineered source of
every DM and CSB release, `ReDMCSB_WIP20210206.7z` from dmweb.free.fr. It is not ours, so
it is git-ignored: `npm run fetch-redmcsb-src` (`tools/fetch-redmcsb-src.ts`) fetches it,
from the site or the Wayback Machine's copy, checks the archive's SHA-256 and writes
`doc/ReDMCSB-src/`: the archive's `Toolchains/Common/Source/` at its top, 289 `.C` and 58
`.H` files, and its `Documentation/`, with the CRs of the code and the pages removed and
nothing else changed. `tools/checks/amiga-disk.ts` reads it.

ReDMCSB builds each release from one source. A `MEDIA*` macro names the releases its code
is built for, in its name: `MEDIA413_A20ED_A20E_A20F_A20G_A21E_A22E_A22G` is compiled for
the Amiga 2.0, 2.1 and 2.2 releases and no other. The Amiga 2.2 English release is
**A22E**; CSB for the Atari ST 2.1 is S21E. A macro naming `A22E` and not `S21E` guards
code only the Amiga has. A table can have one branch per release, one after the other, so
it is read by its guards, never by its first initializer: `G0060_as_Graphic562_Sounds` has
an Apple IIGS branch at `DATA.C:478-529` (`MEDIA349_G14ED`, `MEDIA388_G20E_G21E`) and
A22E's at `DATA.C:1165-1201`.

The rule (`CLAUDE.md`, `DEBT.md` H): whatever CSBWin does, the port does as CSBWin does,
in the Amiga set as in every other; ReDMCSB's A22E is the reference only for what CSBWin
does not have.

## The disks

dmweb.free.fr's `Game,Dungeon_Master,Amiga,Software.7z`, which `npm run fetch-gamefiles`
downloads, is a collection of the Amiga releases. Its `Floppy Disks ADF/` holds ADF images,
`Dungeon Master for Amiga v<version>.adf`, which `tools/lib/adf.ts` reads: 1760 blocks,
the OFS filesystem's root at block 880, each file followed through its data blocks. Its
`Floppy Disks IPF/` holds IPF images, which nothing reads, and its `HardDisk/` a fan's port
of the Atari 1.2 to the Amiga.

| Image | `dm` | `graphics.dat` | `Dungeon.dat` |
| --- | --- | --- | --- |
| v2.0 (English) | 177324, `e751dcc8…` | 411960, `77d7343c…` | 25006, `f89f51bd…` |
| v2.0 (French) Original (Not working) | 177304, `8badcdcc…` | 399305, `029dacae…` | 25414, `5fe6eb9e…` |
| v2.0 (German) Cracked | 177352, `6d585884…` | 399581, `905aa2ae…` | 25380, `eff4f617…` |
| v2.1 (English) Original (Not working) | 177908, `5205c4a4…` | 399020, `e371fc45…` | 25006, `f89f51bd…` |
| v2.2 (English) Original (Not working) | 177908, `a21ae6b9…` | 399020, `e371fc45…` | 25006, `f89f51bd…` |
| v3.6 (English, French, German) | none: `KAOS.FTL` and other modules | `Graphics.DAT`, 458108, `97700349…` | `Dungeon.DAT`, 25006, `f89f51bd…` |

Sizes in bytes, then the SHA-256's start. The English `Dungeon.dat` is one file on the
2.0, 2.1, 2.2 and 3.6 disks; 3.6's `DungeonF.DAT` and `DungeonG.DAT` are the French and
German 2.0 disks'. The 2.1 and 2.2 English disks share their `graphics.dat` and differ in
`dm`. The French cracked disk's files are the original's but for `dm`. The collection
names some images "Not working"; their files read whole, the copy protection
notwithstanding. `v2.2 (German) Original (Not working).adf` is a `UAE-1ADF` image (910058 bytes),
not a plain ADF, and is not read. 3.6 is another engine, in modules, with another
`graphics.dat` format; it is not the base.

**The 2.2 English disk** is the base. `npm run fetch-gamefiles` writes three of its files
to `tools/fixtures/gamefiles/amiga-2.2/`, a folder that is not a set, each pinned by its
SHA-256: `dm`, `graphics.dat` and `Dungeon.dat`. The disk's other files are
`s/Startup-Sequence` (`exec`, then `bye`), `exec` (6008 bytes, which names
`DungeonMaster:swoosh` and `DungeonMaster:dm`), `swoosh` (78584, the FTL logo), `bye`,
`ReadMe` and its icon, `devs/System-Configuration`, `Disk.info`, `.info` and
`DungeonB.dat` (4806), the Kids dungeon. `dm` holds its version, `V2.2`, at file byte
86552.

## `dm`, the program

`dm` is an AmigaDOS load file (`tools/lib/amigaDm.ts`): 142 hunks, all code but hunk 1, its
one data hunk, 18920 bytes stored at file byte 1756 and 27688 in memory (the rest zero),
and hunk 2, 4 bytes of BSS. Its data hunk holds the tables the Amiga's sound needs, each
the initializer of ReDMCSB's A22E branch, byte for byte (`tools/checks/amiga-disk.ts`):

| Table | `dm:data+` | File byte | Bytes | ReDMCSB |
| --- | --- | --- | --- | --- |
| `G0021_aaui_Graphic562_Palette_DungeonView[6][16]` | 2848 | 4604 | 192 | `DATA.C:833-845` |
| `G0060_as_Graphic562_Sounds[34]`, `SOUND_DATA` | 3738 | 5494 | 272 | `DATA.C:1165-1201` |
| `G0243_as_Graphic559_CreatureInfo[27]`, `CREATURE_INFO` | 5818 | 7574 | 702 | `DUNGEON.C:439-499` |
| `G0244_auc_Graphic559_CreatureAttackSounds[11]` | 6520 | 8276 | 11 | `DUNGEON.C:503-517` |
| `G1028_aauc_DistanceToSoundVolume[25][25]` | 11974 | 13730 | 625 | `SOUND.C:55-81` |

- **The palettes** are words `0x0RGB` at 4 bits a channel, where the Atari's have 3
  (each A22E row has the Atari's in a comment). In the five darker ones, slots 9 and 10
  are black.
- **`SOUND_DATA`** (`DEFS.H:36-47`) is `GraphicIndex`, a word, then the bytes
  `aUnreferenced`, `Period`, `Priority`, `bUnreferenced`, `LoudDistance` and
  `SoftDistance`; A22E has 34 (`M513_SOUND_COUNT`, `DEFS.H:55-57`), their ordinals at
  `DEFS.H:63-98`. Entries 0-21 are the Atari's sounds, items 533-555 (20 reuses 537);
  22-33 name items 563-574, the Amiga's own: the movement sounds 22, 23, 24, 26, 27, 32
  and 33, the horn 25, the war cry 28 and the attacks of the rock, the water elemental and
  the couatl, 29-31. A22E plays an entry at Paula period `72800 / Period`
  (`SOUND.C:1107`).
- **`CREATURE_INFO`** (`DEFS.H:1574-1594`) is 26 bytes, its last, `bUnreferenced`, zero.
  Its `AttackSoundOrdinal`, the second byte, is 1-based into the attack sounds:
  `4 0 6 0 1 0 3 7 2 10 2 0 11 9 0 5 10 0 11 0 8 3 0 0 1 0 0` for the 27 creatures, of which
  creatures 7, 9, 12, 13, 16, 18 and 20 differ from the Atari's (the "Atari ST:" comments
  at `DUNGEON.C:449-488`).
- **The attack sounds** are sounds 3, 7, 14, 15, 19, 21, 29, 30, 31, 4 and 16: the
  Atari's eight with the three new attacks before its last two.
- **The volume grid** is indexed by a square's place relative to the party and its facing,
  row then column, 12 the party's: 64 on the party's square, 58 a square ahead, 41 a
  square behind, and a square to one side 58 in that side's channel and 6 in the other's
  (`F0505_SOUND_GetVolume`, `SOUND.C:1871-1919`).

## `graphics.dat`

The Amiga 2.2 `graphics.dat` is a source, not a file the port plays: the `dm-amiga`
set's is `dm-atari`'s with what it needs of the Amiga's taken in (below). It has
575 items, each stored as is (compressed size = decompressed size). Against `dm-atari`'s
563, decompressed, 529 are the same, and these differ:

- **5, the credits**, 7638 bytes to the Atari's 6144, whose last two lines read "Wayne
  Holder ~ producer" on the Atari and "Phil Mercurio ~ Amiga director" on the Amiga.
- **21**, whose header reads 16x23 where the Atari's reads 16x12. It is not a picture
  either reads as one; what it is has not been identified.
- **120**, a 288x8 picture, encoded otherwise (711 bytes to 901) to the same pixels.
- **396**, a 64x7 picture, redrawn.
- **533-555, the sounds**, recorded again in 8 bits. Each begins with a word 2 to 4
  less than the item's length (533: 0x0372, 882, in an item of 886 bytes), but 538 and
  548, 78 bytes each, which begin with 16.
- **556, the objects' names** (1847 bytes to 1852): the same 199 names in the same slots
  but two, slot 158's "ANTIVEN POTION", the Amiga's "BRO POTION", and slot 159's "MON
  POTION", the Amiga's "MA POTION".
- **557, the font** (768 bytes in both), 16 bytes changed: characters 12, 16, 20 and 29
  retouched, and 120, empty on the Atari, drawn.
- **558-562** (`0x22e`-`0x232`: the viewport's rectangles, the creatures' table, the sound
  table, …) are empty: the Amiga's tables are in `dm`.

Items 563-574 are the twelve sounds the Atari does not have, named by sounds 22-33. No
sound names 538 or 548.

## The `dm-amiga` set's `graphics.dat`

The `dm-amiga` set (`tools/data-sets.json`) plays the Amiga's `Dungeon.dat` as it is, and
a `graphics.dat` of the port's making, which `npm run fetch-gamefiles` builds by running
`tools/checks/amiga-graphics.ts --write`. The tool proves every line of this section, and
plays a new game on the set. The file holds 599 items:

| Items | What |
| --- | --- |
| 0-562 | `dm-atari`'s, stored as there, but for 5, 396, 556 and 557, the Amiga's in their place, stored as is |
| 563-585 | the Amiga's 533-555, its 8-bit recordings of the Atari's sounds, in that order |
| 586-597 | the Amiga's 563-574, its own sounds |
| 598 | the table item, below |

Items 0-562 keep the Atari's sounds, 4-bit, and its tables, so the folder is one CSBWin
plays: CSBWin reads as many items as the file's first word counts
(`doc/CSBwin-src/Graphics.cpp:1944-2010`) and only those its tables name, and it reads an
item whose two sizes are equal as stored (`Graphics.cpp:2648-2651`).

The table item, 935 bytes, is the port's layout, four of `dm`'s tables end to end:

| Offset | Bytes | Table |
| --- | --- | --- |
| 0 | 272 | `G0060_as_Graphic562_Sounds[34]`, each `GraphicIndex` moved to the item above that holds the sound |
| 272 | 625 | `G1028_aauc_DistanceToSoundVolume[25][25]` |
| 897 | 11 | `G0244_auc_Graphic559_CreatureAttackSounds[11]` |
| 908 | 27 | the 27 creatures' `AttackSoundOrdinal`, `CREATURE_INFO`'s second byte |

## `Dungeon.dat`

The Amiga's English `Dungeon.dat` is the Atari 1.2 dungeon, compressed, with one
actuator changed and a checksum (`doc/PROVEN_FACTS.md` → "A PC `dungeon.dat` is the Atari
image, little-endian").
