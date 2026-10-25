---
name: atari-disk-collection
description: the six original DM Atari ST disks (1.0 x2, 1.1, 1.2 EN/DE, 1.3 FR) are Pasti images in dmweb.free.fr's Game,Dungeon_Master,Atari_ST,Software.7z, which fetch-gamefiles downloads and tools/lib/stx.ts reads
metadata:
  type: reference
---

dmweb.free.fr's `Game,Dungeon_Master,Atari_ST,Software.7z` holds every Atari ST release
of DM: `Floppy Disks STX/` the six original disks as Pasti images (file names spell
"Atati"), `Floppy Disks MSA/` and `Floppy Disks ST/` cracked copies, `HardDisk/` two
hard-disk installs. CSB's is `Game,Chaos_Strikes_Back,Atari_ST,Software.7z`.
`npm run fetch-gamefiles` downloads both into a scratch folder it removes, and
`tools/lib/stx.ts` reads a Pasti image's files (`stxFiles`) through the sector records and
FAT12: a file holding a sector the image lacks is left out (`BOOTER`: the protection puts
sector 247 where track 0's sector 8 is). Each disk's two data files are a manifest set as
the disk holds them: `dm-atari-1.0a`, `-1.0b`, `-1.1`, `-1.2` (the welcome page's
default), `-1.2-de`, `-1.3-fr`; `dm-atari`, CSBWin's mix, is hidden and is what the tools
play (`STOCK_DATA_SET`).

What each version changes, and that CSBWin's `graphics.dat` is the first 1.0's and its
`dungeon.dat` 1.1's: `doc/ATARI_ST_DISK_REFERENCE.md`, told to read in
`doc/dm-versions.html`. Compare dungeons square by square with `tools/peek-dungeon.ts
--file <DUNGEON.DAT> cell <m> <x> <y>`. See [[csbwin-graphics-dat-flaws]].
