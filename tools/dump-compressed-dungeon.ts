/**
 * A compressed `dungeon.dat`: `ReadDatabases`' new-game preamble and `ExpandData`
 * (`doc/CSBwin-src/SaveGame.cpp:2558-2586`, `CSBCode.cpp:9970-10053`).
 *
 * Chaos Strikes Back's `dungeon.dat`, the prison, is the one compressed file there is:
 * 2098 bytes opening with 33028, which expand to 2622. The expansion is proven byte for
 * byte by the image's own checksum. `ReadDatabases` adds up every byte it fetches and
 * compares the sum with the word that follows the cell flags (`SaveGame.cpp:2866-2870`,
 * `FetchDataBytes`, `CSBCode.cpp:9186-9211`), and that word is the last of the expanded
 * image, so one wrong byte anywhere in it fails the sum. Then the image has to parse
 * with its sections ending exactly at that word, and the new game has to take
 * `d.Word22592` from the file's word 6 (12), where a plain `dungeon.dat`'s keeps the 13
 * `_ReadEntireGame` sets (`SaveGame.cpp:1571`).
 *
 * DM's `dungeon.dat` is plain: through the same entry it must read exactly as before.
 *
 * Run: `npm test -- --only=dump-compressed-dungeon.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE, readU32BE } from '../src/core/bytes';
import { ExpandData } from '../src/core/compression';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { check, finish } from './lib/check';
import { newContext, stockGraphics } from './lib/game';

const CSB = new Uint8Array(readFileSync(resolve('static/gamefiles/csb/dungeon.dat')));
const DM = new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat')));

function main(): void {
  console.log('== csb/dungeon.dat ==');
  const size = readU32BE(CSB, 2);
  console.log(`  ${CSB.length} bytes, first word ${readU16BE(CSB, 0)}, expanded size ${size}, word 6 ${readU16BE(CSB, 6)}`);
  check(readU16BE(CSB, 0) === 33028, 'the prison opens with 33028, so it is compressed');
  check(size === 2622, 'it expands to 2622 bytes');

  const image = ExpandData(CSB.subarray(8), size);
  let sum = 0;
  for (let i = 0; i < image.length - 2; i++) sum = (sum + image[i]) & 0xffff;
  const stored = readU16BE(image, image.length - 2);
  console.log(`  byte sum of the image 0x${sum.toString(16)}, its last word 0x${stored.toString(16)}`);
  check(image.length === 2622, 'ExpandData writes the whole expanded size');
  check(sum === stored, "the expanded image's byte sum is the checksum word ReadDatabases compares it with");

  const data = new DungeonLoader().loadDungeonDat(CSB);
  const h = data.header;
  const levels = data.maps.map(m => `${m.descriptor.width}x${m.descriptor.height}`);
  console.log(`  ${h.numMaps} levels (${levels.join(', ')}), sentinel ${h.randomSeed}, ` +
    `start (${h.startPosition.x},${h.startPosition.y}) facing ${h.facing}, Word22592 ${data.word22592}`);
  console.log(`  records: ${h.objectCounts.join(' ')}`);
  check(h.numMaps === 2 && h.randomSeed === 8, 'the prison: two levels, sentinel 8');
  check(levels.join() === '20x16,21x16', 'its levels are 20x16 and 21x16');
  check(h.objectCounts.slice(0, 5).join() === '4,0,26,30,12' && h.objectCounts.slice(5).every(n => n === 0),
    '4 doors, 26 texts, 30 actuators, 12 groups and nothing else');
  // The sections, in `calculateOffsets`' order, end at the checksum word: the header,
  // the level descriptors, the column index, the object list, the raw text, the four
  // databases, and 660 bytes of cell flags.
  const columns = data.maps.reduce((n, m) => n + m.descriptor.width, 0);
  const end = 44 + 16 * h.numMaps + 2 * columns + 2 * h.objectListSize + 2 * readU16BE(image, 6)
    + 4 * 4 + 26 * 4 + 30 * 8 + 12 * 16 + h.mapDataSize;
  check(end === image.length - 2, `the sections end at the checksum word (${end})`);
  check(data.word22592 === 12, "Word22592 is the file's word 6, 12");
  const csbGame = newContext(data, stockGraphics());
  check(csbGame.state.block1.word22592 === 12, "a new game on the prison takes the file's Word22592");

  console.log('== dm-atari/dungeon.dat ==');
  check(readU16BE(DM, 0) !== 33028, "DM's dungeon.dat is plain");
  const viaEntry = new DungeonLoader().loadDungeonDat(DM);
  const direct = new DungeonLoader().loadFromArray(DM);
  check(viaEntry.word22592 === undefined, 'a plain dungeon.dat carries no Word22592');
  check(JSON.stringify(viaEntry) === JSON.stringify(direct), 'a plain dungeon.dat reads as it stands');
  const dmGame = newContext(viaEntry, stockGraphics());
  console.log(`  Word22592 ${dmGame.state.block1.word22592}`);
  check(dmGame.state.block1.word22592 === 13, "a new game on it keeps _ReadEntireGame's 13");

  finish();
}

main();
