/**
 * `ReadDatabases`' checksum word: the byte sum of every section from the header to the end
 * of the cell flags, compared with the big-endian word after them, and the read failed
 * when they differ (`doc/CSBwin-src/SaveGame.cpp:2654-2658`, `FetchDataBytes` at
 * `CSBCode.cpp:9081-9106`). A file with fewer than two bytes after the cell flags skips the
 * comparison, since `StreamInput` cannot read the word (`CSBCode.cpp:9027-9043`).
 *
 * One byte flipped in the last cell flag changes nothing the parsers or the closure check
 * of a save look at, so only the comparison can catch it: in the prison's expanded image,
 * in DM's `dungeon.dat` once a word follows its cell flags, and in every committed save.
 *
 * Run: `npx tsx tools/dump-image-checksum.ts`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE, readU32BE } from '../src/core/bytes';
import { ExpandData } from '../src/core/compression';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { buildImageChecksum } from '../src/data/CsbwinDungeonImageWriter';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { check, finish } from './lib/check';

/** Whether `read` throws, and with what. */
function failure(read: () => unknown): string | null {
  try {
    read();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
  const out = bytes.slice();
  out[at] ^= 0x01;
  return out;
}

function byteSum(bytes: Uint8Array, end: number): number {
  let sum = 0;
  for (let i = 0; i < end; i++) sum = (sum + bytes[i]) & 0xffff;
  return sum;
}

const MISMATCH = 'dungeon image checksum mismatch';

function main(): void {
  console.log('== csb/dungeon.dat, expanded ==');
  const csb = new Uint8Array(readFileSync(resolve('static/gamefiles/csb/dungeon.dat')));
  const image = ExpandData(csb.subarray(8), readU32BE(csb, 2));
  const lastFlag = image.length - 3;
  const plain = failure(() => new DungeonLoader().loadFromArray(image));
  const cell = failure(() => new DungeonLoader().loadFromArray(flipped(image, lastFlag)));
  const word = failure(() => new DungeonLoader().loadFromArray(flipped(image, image.length - 1)));
  const text = failure(() => new DungeonLoader().loadFromArray(flipped(image, 200)));
  console.log(`  as it stands: ${plain ?? 'reads'}; last cell flag flipped: ${cell}; ` +
    `checksum word flipped: ${word}; byte 200 flipped: ${text}`);
  check(plain === null, 'the prison reads, its word matching its sum');
  check(cell === MISMATCH, 'a flipped cell flag fails the read on the checksum');
  check(word === MISMATCH, 'a flipped checksum word fails it too');
  check(text === MISMATCH, 'so does a byte flipped mid-image, before any parser meets it');
  check(failure(() => new DungeonLoader().loadDungeonDat(csb)) === null, 'the compressed file reads through its entry');

  console.log('== dm-atari/dungeon.dat ==');
  const dm = new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat')));
  const reference = new DungeonLoader().loadDungeonDat(dm);
  const end = dm.length;
  check(failure(() => new DungeonLoader().loadDungeonDat(flipped(dm, end - 1))) === null,
    'with no word after its cell flags, a flipped cell flag goes unnoticed, as in CSBWin');
  const withWord = new Uint8Array(end + 2);
  withWord.set(dm);
  // The writer's word, so the reader is held to what a save is written with.
  withWord.set(buildImageChecksum(dm), end);
  console.log(`  ${end} bytes, byte sum 0x${byteSum(dm, end).toString(16)}`);
  const good = failure(() => new DungeonLoader().loadDungeonDat(withWord));
  check(good === null, 'the same file with its sum appended reads');
  check(JSON.stringify(new DungeonLoader().loadDungeonDat(withWord)) === JSON.stringify(reference),
    'and reads into the same world');
  check(failure(() => new DungeonLoader().loadDungeonDat(flipped(withWord, end - 1))) === MISMATCH,
    'with the word, a flipped cell flag fails the read');
  const oneByte = new Uint8Array(end + 1);
  oneByte.set(dm);
  oneByte[end] = 0xff;
  check(failure(() => new DungeonLoader().loadDungeonDat(oneByte)) === null,
    'one stray byte is not a word: StreamInput fails and nothing is compared');

  console.log('== saves ==');
  const dir = resolve('static/gamefiles/saves');
  const saves = readdirSync(dir).filter(f => f.endsWith('.dat')).sort();
  check(saves.length > 0, 'there are committed saves');
  for (const name of saves) {
    const bytes = new Uint8Array(readFileSync(resolve(dir, name)));
    const stored = readU16BE(bytes, bytes.length - 2);
    const intact = failure(() => loadCsbwinWorld(bytes));
    const damaged = failure(() => loadCsbwinWorld(flipped(bytes, bytes.length - 3)));
    console.log(`  ${name}: word 0x${stored.toString(16)}, ${intact ?? 'reads'}; last cell flag flipped: ${damaged}`);
    check(intact === null, `${name} reads, its image's sum matching its last word`);
    check(damaged === MISMATCH, `${name} with a flipped cell flag fails the read on the checksum`);
  }

  finish();
}

main();
