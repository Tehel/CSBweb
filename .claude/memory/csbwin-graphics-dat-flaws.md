---
name: csbwin-graphics-dat-flaws
description: a graphics.dat derived from CSBWin's DM one inherits three flaws dm-atari fixes from the 1.2 disk (items 5, 232, 0x22e); repair only items still equal to CSBWin's
metadata:
  type: project
---

Custom dungeons' `graphics.dat` files are usually CSBWin's DM file (`dm-windows/`) edited, so
they carry its three differences from the Atari 1.2 disk, which `dm-atari/` replaces. CSBWin's
file is the first 1.0 disk's (8 December 1987) with corrupted credits, so its other
differences from 1.2 are 1.0's genuine tables (stamina costs, dragon range…), not flaws
(`doc/ATARI_ST_DISK_REFERENCE.md` → "CSBWin's files"). The three
(`doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's with three items from the 1.2
disk"):

- item 5, the credits scroll: four `0xA` opcodes, drawn wrong from "Dennis Walker" down;
- item 232, Crack Switch (In)'s front view: an empty crack, no pushed button;
- item `0x22e`, byte 3201 = `Byte4100[55]` 0: the pressed crack switch jumps to eye level.

**Why:** the author sees the crack jump in every such set; Sphenx's Theron's Quest conversion had all three.
**How to apply:** for each of the three, replace the item with `dm-atari`'s only when the
set's is still CSBWin's: compare `0x22e` decompressed (`getRawGraphic`) and 232 by pixels
(`getImage`), since editors re-compress every item; an item the author changed is theirs.
Leave every other item alone (portraits, entrance, object names). See
[[custom-dungeon-archives]].
