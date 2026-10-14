---
name: custom-dungeon-archives
description: A custom dungeon's archive rarely holds a file called dungeon.dat — tell files by content; PC twins, several versions, and saves that read as 0-level dungeons
metadata:
  type: project
---

The archives of the community's CSBWin dungeons ([[forum-dungeon-sources]]) are not
CSBWin directories:

- The dungeon is rarely named `dungeon.dat`: `ST-TQ1-aktuba-dungeon.dat`,
  `Imprisoned Again V15a-csbwin.dat`, `The Prison Of Dragoth.dat`. Tell every file by what
  it holds, `identifyLocalDataSetFile` (`src/data/LocalDataSets.ts`), after
  `bigEndianDungeonDat`.
- Many pair a PC (little-endian) twin with the Atari file, and hold several versions in
  sibling folders (Imprisoned Again: v1.1 to v1.5a). Theron's Quest Conversion holds seven
  dungeons sharing one `graphics.dat`.
- A CSBWin save, `csbgame.dat` (Mazarbul, Dungeon Master for CSBwin), reads as a dungeon
  of no level and cannot be a set.
- The `.exe` files are CSBWin builds under the dungeon's name (`Maze.exe`,
  `ShadowShepherd.exe`), never needed.

**How to apply:** pair a dungeon with the `graphics.dat`/`CSBgraphics.dat` beside or above
it, drop 0-level reads, and let the author choose among versions, as
`utils/submit-forum-dungeons.ts` does.
