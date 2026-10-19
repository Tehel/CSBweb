---
name: atari-disk-collection
description: the six original DM Atari ST disks (1.0 x2, 1.1, 1.2 EN/DE, 1.3 FR) are Pasti images in archive/Game,Dungeon_Master,Atari_ST,Software/, their files extracted beside them
metadata:
  type: reference
---

`archive/Game,Dungeon_Master,Atari_ST,Software/` (gitignored) holds every Atari ST release
of DM: `Floppy Disks STX/` the six original disks as Pasti images (file names spell
"Atati"), `Floppy Disks MSA/` and `Floppy Disks ST/` cracked copies, `HardDisk/` two
hard-disk installs. `extracted/<version>/` holds each STX disk's six files
(`GRAPHICS.DAT`, `DUNGEON.DAT`, `START.PAK`, …), read through the sector records and FAT12.
The former `archive/DungeonMaster1v2E.stx` and `DungeonMaster1v3Fr.stx` are two of the six
and were removed.

What each version changes, and that CSBWin's `graphics.dat` is the first 1.0's and its
`dungeon.dat` 1.1's: `doc/ATARI_ST_DISK_REFERENCE.md`, told to read in
`doc/dm-versions.html`. Compare dungeons square by square with `tools/peek-dungeon.ts
--file <DUNGEON.DAT> cell <m> <x> <y>`. See [[csbwin-graphics-dat-flaws]].
