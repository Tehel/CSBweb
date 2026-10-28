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

## The sounds, played

`F0503_SOUND_LoadAll` (`doc/ReDMCSB-src/SOUND.C:1423-1447`) loads each of the 34 sounds
once: its `ByteCount` is the item's length less 2, its first sample the item's third byte;
the word the item begins with, which the comment calls the sample count, is never read. In
all 34 it is 2 to 4 less than the item's length. `F0060_SOUND_Play_CPSX`'s A22E branch
(`SOUND.C:1050-1114`) plays `ByteCount` bytes from there on two of Paula's channels at the
period `72800 / Period`, C's integer division (`:1107-1108`). The bytes are Paula's samples,
8-bit signed: every sound's run from about -85 to 95. On a PAL machine, whose clock Paula
counts its period in, 3546895 Hz, a sound plays at `3546895 / trunc(72800 / Period)` Hz:

| `Period` | Paula's | Hz | Sounds |
| --- | --- | --- | --- |
| 112 | 650 | 5456.8 | 0-17, 19-21, 31 |
| 138 | 527 | 6730.4 | 18, the wall bump; 22-30, 32 |
| 145 | 502 | 7065.5 | the entrance's door rattle, sound 2 (`ENTRANCE.C:160`) |
| 150 | 485 | 7313.2 | 33 |

A larger `Period` plays faster on the Amiga, where on the Atari, a timer's count, it plays
slower: the entrance's rattle is the Atari's 4237 Hz and the Amiga's 7065.5. The entrance
plays its switch, sound 1, at 112 (`ENTRANCE.C:919`).

The Atari's 22 ordinals are the Amiga's first 22, each naming the item that holds the
Amiga's recording of the Atari's sound, at the Atari's `Period` but for 18's. So the port
plays, for each Atari SND item, the Amiga sound its ordinals name
(`amigaSoundsByAtariItem`, `src/data/tables/AmigaSoundTables.ts`), and for the entrance's
second rate the rattle at 145 (`src/audio/SoundManager.ts`). `tools/checks/amiga-sounds.ts`
decodes the 34 and plays them through `SoundManager`.

## The sounds, heard

A22E's `F0064_SOUND_RequestPlay_CPSD` (`doc/ReDMCSB-src/SOUND.C:1476-1754`) reads neither
`LoudDistance` nor `SoftDistance`. Its mode is CSBWin's `deltaTime`: any but 0 returns off
the party's map (`:1523-1529`), and above 1 it adds a `C20_EVENT_PLAY_SOUND` event, which
requests the sound again in mode 1 when it falls due (`TIMELINE.C:1903-1905`). Otherwise:

- **The volume.** `F0505_SOUND_GetVolume` (`SOUND.C:1871-1919`) turns the source's offset
  from the party to its facing: a line, negative ahead, and a column, positive to the
  right. A sound more than 12 squares away along either is not heard (`:1907-1912`). Else
  the right channel's volume is `G1028_aauc_DistanceToSoundVolume[line + 12][column + 12]`
  and the left channel's `[line + 12][12 - column]` (`:1913-1917`), Paula's 0 to 64. So:
  64 on the party's square, 58, 29 and 20 one, two and three squares ahead, 41 one
  behind, and one to the right 58 on the right and 6 on the left.
- **Mode 0** plays at once (`F0060_SOUND_Play_CPSX`, `:1608-1642`).
- **Mode 1**, `C01_MODE_PLAY_IF_PRIORITIZED`, waits as one of two pending sounds
  (`:1657-1714`). A free one takes it, the first first. With both taken, a sound louder
  than either (`F0502_SOUND_CompareVolumes`, `:227-268`: the two channels' sum in three
  classes, below 15, 15 to 25, above 25) replaces the second if the first is the louder of
  the two, else the first. Failing that, it replaces one it is as loud as with a lower
  `Priority`, the first before the second. Otherwise it is dropped.
  `F0065_SOUND_PlayPendingSound_CPSD` (`:1812-1821`) plays the first, then the second, at
  the volumes they were requested at. The main loop calls it after the dungeon view is drawn and before the
  pending damage (`GAMELOOP.C:115-116`), where CSBWin calls its `StartQueuedSound`
  (`doc/CSBwin-src/CSBCode.cpp:666`).
- **Two voices.** `F0060_SOUND_Play_CPSX` (`SOUND.C:1057-1114`) plays on `Sound1`, a
  left and a right channel, if it is free (`CheckIO`), else on `Sound2` if it is. With
  both busy, it takes `Sound2` if `Sound1`'s sound is the louder, else `Sound1`
  (`:1071-1087`), and remembers the volume it was given (`G1024_as_SoundVolume`). The voice's
  sound stops at once: `ADCMD_FINISH`, its control request without `ADIOF_SYNCCYCLE`
  (`EXEC.C:481`). The left channel plays at the left volume, the right at the right
  (`:1109-1110`). A direct call plays both at 64, `0x4040` (`ENTRANCE.C:160`, `:919`).

The port does all of this for a set with the table item: `SoundQueue.queueSound`
(`src/engine/SoundQueue.ts`) after CSBWin's sound filter, `StartQueuedSound` at both of
CSBWin's places, the two voices in `SoundManager.playAmigaSound`, each channel a gain of
its volume over 64 into a channel merger. A Web Audio sound plays to its end. A voice is
free from its source's `ended`. `tools/checks/amiga-sound-path.ts` proves it. Nothing more: no
filtering for a sound behind, nor for walls between.

## The Amiga's own sounds

Ordinals 22-33 have no entry in the Atari's `d.sound1772`. For a set with the table item,
`QueueSound` reads an ordinal's entry from `G0060_as_Graphic562_Sounds`, as A22E does
(`SOUND.C:1536-1544`): the sound plays only if it has one, and a delayed one's `TT_20`
takes its `Priority`. For the Atari's 22 ordinals, `Priority`, `LoudDistance` and
`SoftDistance` are the Atari's `byte4`, `byte6` and `byte7`, so the Atari's sounds are
filtered as before. `tools/checks/watch-amiga-footsteps.ts` proves this section.

- **Footsteps.** `F0514_MOVE_GetSound`'s A22E branch (`MOVESENS.C:911-1000`,
  `moveGetSound` in `src/engine/SoundQueue.ts`) gives a creature type's movement sound:
  22 the Deth Knight; 23 the couatl and the muncher; 24 the giggler, the stone golem, the
  mummy, the vexirk, the ant man and the demon; 26 the scorpion, the hellhound, the
  ruster, the screamer, the rock pile, the worm and the oitu; 27 the slime devil and the
  water elemental; 32 the dragon; 33 the skeleton. The eye, the ghost, the black flame,
  the zytaz and the three lords make none, and no creature makes one while the party
  rests. A group asks for it with mode 1 on the square it arrives on, once neither the
  party nor another group stands there (`MOVESENS.C:846-850`), wherever it came from,
  a generator included.
- **The couatl** that is not attacking asks for its sound, mode 1, on the coin toss that
  flips its picture (`GROUP.C:265-279`). A22E toggles the picture on that toss; the port
  keeps CSBWin's aspect, the picture mirrored on heads and not on tails, so the couatl
  is heard as often and looks as it does in CSBWin.
- **The attack sounds** are A22E's eleven, through its `AttackSoundOrdinal`
  (`GROUP.C:1802-1804`), mode 1: the rock pile 29, the water elemental 30 and the couatl
  31; the skeleton and the Deth Knight 16, and the stone golem and the ant man 4, the
  sounds the Atari gives them under other ordinals.

### The war cry and the horn

ReDMCSB's A22E branch has no action code: `F0407_MENUS_IsActionPerformed` is only named
(`GAMELOOP.C:124`). It is `dm`'s hunk 19 from 0x13b6, its arguments the champion's index
and the action's. The game calls every function through a table at negative offsets of
`a4`, `F0064_SOUND_RequestPlay_CPSD` at `-$7dc4(a4)`, its arguments pushed last first:
sound, x, y, mode. The function puts in two locals the party's square plus
`DeltaX`/`DeltaY` of the champion's direction (`CHAMPION`'s byte 0x1c, after its name
and title), the square ahead of the champion, and switches on the action through a
table at 0x1aa2. Actions 4, 8, 37 and 41 (BLOW HORN, WAR CRY, CALM, BRANDISH) go to
0x15fa, and action 22 (CONFUSE) to 0x15f2, which spends a charge and falls into it. There:

```
015fa  cmpi.w #8, $a(a5)      ; WAR CRY
       bne    1616
       clr.w  -(a7)           ; C00_MODE_PLAY_IMMEDIATELY
       move.w -8(a5), -(a7)   ; y ahead
       move.w -6(a5), -(a7)   ; x ahead
       move.w #28, -(a7)      ; M619_SOUND_WAR_CRY
       jsr    -$7dc4(a4)      ; F0064_SOUND_RequestPlay_CPSD
01616  cmpi.w #4, $a(a5)      ; BLOW HORN
       ...                    ; the same with #25, M620_SOUND_BLOW_HORN
01632  ...                    ; F0401_MENUS_IsGroupFrightenedByAction
```

So 2.2 plays the war cry and the horn at once, on the square ahead, before the action
frightens anything. The port asks for them at the start of `WarCryEtc`, on its
`attackX`, `attackY`, with `deltaTime` 0.

## `Dungeon.dat`

The Amiga's English `Dungeon.dat` is the Atari 1.2 dungeon, compressed, with one
actuator changed and a checksum (`doc/PROVEN_FACTS.md` → "A PC `dungeon.dat` is the Atari
image, little-endian").
