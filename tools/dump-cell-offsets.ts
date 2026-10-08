/**
 * Where each level's cells start in the cell flag array, read as CSBWin reads it.
 *
 * `LEVELDESC.cellOffset` is a 16-bit word. CSBWin takes level 0's as it stands and adds
 * each next level's difference from the one before, `& 0xffff`
 * (doc/CSBwin-src/SaveGame.cpp:2889-2898), so a dungeon whose cell flags pass 64K still
 * reads in order. Conflux 3.5's does: its map 63 starts at 66155, stored as 619. Read as
 * stored, map 63's cells would be map 0's, and a cell there whose flag says it has
 * objects would take its first object from another column's list.
 *
 * The canary is the object list's column index, which the file stores apart from the
 * cell flags: each column's entry must step past exactly the cells of that column whose
 * flag has `0x10` (`GetObjectListIndex`, doc/CSBwin-src/CSBCode.cpp:5168-5192), and every
 * such cell's first object is a real one. A level read at the wrong offset breaks both.
 * Then the writer: block 14 built from the read levels (`buildCellFlagArray`) is the
 * file's own cell flag array byte for byte, at the size the file declares.
 *
 * Run: `npx tsx tools/dump-cell-offsets.ts`
 */
import { readFileSync } from 'node:fs';

import { OBJECT_ID_EOF, OBJECT_ID_NULL } from '../src/core/types';
import { buildCellFlagArray, cellFlagArraySize } from '../src/data/CsbwinDungeonImageWriter';
import { readExtendedFeatures } from '../src/data/CsbwinExtendedFeatures';
import { DungeonLoader, levelCellOffsets } from '../src/data/DungeonLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';

const SETS = ['dm-atari', 'csb', '3D2D1D', 'kids-dungeon-24', 'towers-of-chaos-3.3', 'conflux-3.5-b8'];

/** The columns whose index step is not their flagged cells, and the flagged cells whose first object is none. */
function objectListAgainstFlags(data: DungeonData): { columns: string[]; empty: string[] } {
  const columns: string[] = [];
  const empty: string[] = [];
  const total = data.levelIndex[data.maps.length - 1] + data.maps[data.maps.length - 1].descriptor.width;
  data.maps.forEach((map, z) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      const column = data.levelIndex[z] + x;
      let index = data.columnIndex[column];
      for (let y = 0; y < map.descriptor.height; y++) {
        if ((map.cellFlags[x][y] & 0x10) === 0) continue;
        const first = data.objectList[index++];
        if (first === undefined || first === OBJECT_ID_NULL || first === OBJECT_ID_EOF) empty.push(`map ${z} (${x},${y})`);
      }
      // The list's spare entries follow the last column (`objectListSize` counts them).
      const ok = column + 1 < total ? index === data.columnIndex[column + 1] : index <= data.header.objectListSize;
      if (!ok) columns.push(`map ${z} column ${x}`);
    }
  });
  return { columns, empty };
}

function main(): void {
  for (const set of SETS) {
    const file = new Uint8Array(readFileSync(`static/gamefiles/${set}/dungeon.dat`));
    const data = new DungeonLoader().loadDungeonDat(file);
    const stored = data.maps.map((map) => map.descriptor.dataOffset);
    const offsets = levelCellOffsets(data.maps.map((map) => map.descriptor));
    const wrapped = offsets.filter((offset, level) => offset !== stored[level]).length;
    console.log(`== ${set}: ${data.maps.length} levels, the last at ${offsets[offsets.length - 1]}` +
      ` (stored ${stored[stored.length - 1]}), ${wrapped} wrapped ==`);

    const { columns, empty } = objectListAgainstFlags(data);
    check(columns.length === 0, `every column's object list index steps past its flagged cells` +
      (columns.length ? ` (not ${columns.slice(0, 3).join(', ')}, ${columns.length} in all)` : ''));
    check(empty.length === 0, `every flagged cell has a first object` +
      (empty.length ? ` (not ${empty.slice(0, 3).join(', ')}, ${empty.length} in all)` : ''));

    // An image behind an Extended Features block declares its cell flag array's size and
    // ends with it, then the checksum word (`ReadDatabases`, SaveGame.cpp:2863-2870).
    const ef = readExtendedFeatures(file);
    if (!ef.header || ef.cellFlagArraySize === 0) continue;
    const image = ef.data.subarray(ef.offset);
    const size = ef.cellFlagArraySize;
    check(cellFlagArraySize(data.maps) === size, `the levels end at the declared ${size} bytes`);
    const own = image.subarray(image.length - 2 - size, image.length - 2);
    const built = buildCellFlagArray(data.maps, size);
    check(built.every((b, i) => b === own[i]), 'block 14 built from the levels is the file\'s own array');
  }
  // Conflux is the one data set past 64K: without the unwrapping its map 63 is read at 619.
  const conflux = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync('static/gamefiles/conflux-3.5-b8/dungeon.dat')));
  const offsets = levelCellOffsets(conflux.maps.map((map) => map.descriptor));
  check(conflux.maps[63].descriptor.dataOffset === 619 && offsets[63] === 66155,
    'Conflux\'s map 63 is stored at 619 and read at 66155');
  finish();
}

main();
