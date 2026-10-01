/**
 * `ReadExtendedFeatures` (`doc/CSBwin-src/SaveGame.cpp:298-432`) at the front of a file:
 * the "simple" encipherment it looks for when the sentinel is not there, and the blocks
 * it gives up on.
 *
 * 1. **The stream.** `RC4_prepare_key(simple, 1)` with `simple[0] = 1` (`:326-329`) makes
 *    8192 bytes (`doc/CSBwin-src/RC4.cpp:20-48`), and it is not RC4's. The bytes expected
 *    here are CSBWin's own: `RC4.cpp` compiled as it stands, a buffer of 8192 zeroes put
 *    through `RC4_encipher(buf, 8192, 0)`, and printed. `FormChecksum` over the whole
 *    stream covers the bytes not listed.
 * 2. **The canary: Conflux 3.5's `dungeon.dat`**, an enciphered file. It does not open
 *    with the sentinel. Deciphered, its first 512 bytes do, with `SimpleEncryption` in
 *    `flags` and a checksum that matches, all 512 bytes of the stream at work. And
 *    `READ` deciphers by the position in the file (`doc/CSBwin-src/system.cpp:301-313`):
 *    the two object maps behind the block, deciphered from byte 512 on, match the
 *    checksums the block declares, which takes the stream round its 8192 bytes.
 * 3. **The port reads the block and no more** (`DEBT.md` G4): `readExtendedFeatures`
 *    deciphers the 512 bytes, and stops at the maps, which it reads as they stand.
 * 4. **A block it gives up on is no block.** CSBWin seeks back and returns 0 in three
 *    cases, and its caller reads the file from the first byte (`:320-353`):
 *    - the checksum is wrong (`:345-353`): a save with one fill byte of its block changed
 *      is read as GAMEBLOCK1 at byte 0, which `ReadUnscrambleBlock` refuses, and that is
 *      `tag01efee` (`:1599-1601`); a `dungeon.dat` so changed is read as a dungeon from
 *      byte 0 (`:2348-2354`), and fails by those bytes;
 *    - the sentinel is tested with `strcmp` (`:324`, `:333`), so the twentieth byte must
 *      be the terminator;
 *    - the sentinel appears only once deciphered and `flags` has no `SimpleEncryption`
 *      (`:333-343`): Conflux's block with the flag cleared.
 *    The last two are given a checksum that matches, so only the test named refuses them.
 *
 * Run: `npx tsx tools/dump-extended-features-read.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EF_FLAGS,
  EXTENDED_FEATURES_SIZE,
  EXTENDED_SENTINEL,
  rc4Encipher,
  readExtendedFeatures,
  simpleEncipherKey,
} from '../src/data/CsbwinExtendedFeatures';
import { formChecksum } from '../src/data/CsbwinObjectIndex';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { readU32LE, writeU32LE } from '../src/core/bytes';
import { check, finish } from './lib/check';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const SAVE = 'static/gamefiles/saves/csbgame.dat';
const DM_WINDOWS = 'static/gamefiles/dm-windows/dungeon.dat';

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const sentinelOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes.subarray(0, EXTENDED_SENTINEL.length));

/** The block's own checksum: the field at 32 lifted out, zeroed, and `FormChecksum` over all 512. */
function blockChecksumMatches(block: Uint8Array): boolean {
  const checked = block.slice(0, EXTENDED_FEATURES_SIZE);
  const stored = readU32LE(checked, 32);
  checked[32] = checked[33] = checked[34] = checked[35] = 0;
  return formChecksum(checked) === stored >>> 0;
}

/* ------------------------------------------------------------- 1. the stream ---- */

function checkStream(): void {
  console.log('=== the stream of RC4_prepare_key(simple, 1) ===');
  const stream = simpleEncipherKey();
  const expected: Array<[number, string]> = [
    [0, '3a f8 a2 99 62 e0 a8 00 5e bb 4d 0e 14 8e 1b e5 0b b2 75 cd cc c2 a6 51 00 7d 41 1f 7c 71 7b 00'],
    [248, '1d 24 43 65 fb 6a 87 f1 06 09 0c 0d 1c 25 2f 2e 31 3a 43 5c 6a 7b 89 8c b1 a4 d8 f3 e3 73 07 6b'],
    [8160, 'd7 88 6b df da 73 ba c0 cf c4 40 1c 77 a6 e7 1c dd 60 db ab ba 86 45 b0 0b ae 75 d7 d6 08 cc 06'],
  ];
  check(stream.length === 8192, 'the stream is SIZE bytes, 8192');
  for (const [at, bytes] of expected) {
    const got = hex(stream.subarray(at, at + 32));
    console.log(`  ${String(at).padStart(4)}: ${got}`);
    check(got === bytes, `bytes ${at}-${at + 31} are RC4.cpp's`);
  }
  const sum = formChecksum(stream);
  console.log(`  FormChecksum of the 8192 bytes: 0x${sum.toString(16)}`);
  check(sum === 0x663baa0e, 'and so is every other byte: FormChecksum 0x663baa0e');

  const zeroes = new Uint8Array(40);
  rc4Encipher(stream, zeroes, 8180);
  check(hex(zeroes.subarray(0, 12)) === hex(stream.subarray(8180)) && hex(zeroes.subarray(12)) === hex(stream.subarray(0, 28)),
    'RC4_encipher takes the stream from its position, modulo 8192');
}

/* ------------------------------------------------- 2 and 3. the enciphered file ---- */

function checkConflux(): void {
  console.log('');
  console.log('=== Conflux 3.5\'s dungeon.dat, an enciphered file ===');
  const file = read(CONFLUX);
  console.log(`  as it stands : ${hex(file.subarray(0, 20))}`);
  check(sentinelOf(file) !== EXTENDED_SENTINEL, 'the file does not open with the sentinel');

  const plain = file.slice();
  rc4Encipher(simpleEncipherKey(), plain, 0);
  const flags = plain[37] ?? 0;
  console.log(`  deciphered   : ${hex(plain.subarray(0, 20))}  ${JSON.stringify(sentinelOf(plain))}, flags 0x${flags.toString(16)}`);
  check(sentinelOf(plain) === EXTENDED_SENTINEL && plain[19] === 0, 'deciphered, it does, terminator and all');
  check((flags & EF_FLAGS.SimpleEncryption) !== 0, 'with SimpleEncryption in flags');
  check(blockChecksumMatches(plain), 'and the block\'s checksum matches: 512 bytes of the stream are right');

  const dataMapLength = readU32LE(plain, 20);
  const typeMap = plain.subarray(EXTENDED_FEATURES_SIZE, EXTENDED_FEATURES_SIZE + dataMapLength);
  const indexMap = plain.subarray(EXTENDED_FEATURES_SIZE + dataMapLength, EXTENDED_FEATURES_SIZE + 3 * dataMapLength);
  console.log(`  dataMapLength ${dataMapLength}: the maps end at byte ${EXTENDED_FEATURES_SIZE + 3 * dataMapLength}`);
  check(EXTENDED_FEATURES_SIZE + 3 * dataMapLength > 8192, 'the maps run past the stream\'s 8192 bytes');
  check(formChecksum(typeMap) === readU32LE(plain, 24), 'dataTypeMap, deciphered by its position in the file, matches its checksum');
  check(formChecksum(indexMap) === readU32LE(plain, 28), 'and so does dataIndexMap, round the end of the stream');

  let thrown: string | null = null;
  try {
    readExtendedFeatures(file);
  } catch (error) {
    thrown = (error as Error).message;
  }
  console.log(`  readExtendedFeatures: ${thrown ?? 'read'}`);
  check(thrown === 'dataTypeMap checksum mismatch',
    'the port takes the deciphered block, and stops at the maps it reads as they stand (DEBT.md G4)');
}

/* ------------------------------------------------ 4. the blocks it gives up on ---- */

/** Give the block at the front of `file` the checksum its bytes now have. */
function resealBlock(file: Uint8Array): void {
  file[32] = file[33] = file[34] = file[35] = 0;
  writeU32LE(file, 32, formChecksum(file.subarray(0, EXTENDED_FEATURES_SIZE)));
}

/** What a reader makes of a file: its result, or the message it threw. */
function outcome(read: () => string): string {
  try {
    return read();
  } catch (error) {
    return `threw "${(error as Error).message}"`;
  }
}

const blockOf = (file: Uint8Array): string => outcome(() => {
  const ef = readExtendedFeatures(file);
  return `offset ${ef.offset}, ${ef.header ? 'a block' : 'no block'}`;
});

function checkGivenUp(): void {
  console.log('');
  console.log('=== a block ReadExtendedFeatures gives up on is no block ===');
  const save = read(SAVE);
  const intact = readExtendedFeatures(save);
  console.log(`  ${SAVE}, intact: offset ${intact.offset}`);
  check(intact.header !== undefined && intact.offset > EXTENDED_FEATURES_SIZE, 'the intact save opens with a block');

  const damaged = save.slice();
  damaged[300] ^= 0x01;                    // one of the block's fill bytes
  const loadDamaged = outcome(() => { loadSaveGameState(damaged); return 'loaded'; });
  console.log(`  byte 300 changed: ${blockOf(damaged)}; LoadGame: ${loadDamaged}`);
  check(blockOf(damaged) === 'offset 0, no block', 'a wrong checksum: the file is one with no block');
  check(loadDamaged === 'threw "savegame block1 checksum mismatch"',
    'so GAMEBLOCK1 is read at byte 0, and ReadUnscrambleBlock refuses it: tag01efee');

  const unterminated = save.slice();
  unterminated[19] = 0x20;
  resealBlock(unterminated);
  console.log(`  byte 19 a space, checksum redone: ${blockOf(unterminated)}`);
  check(blockChecksumMatches(unterminated), 'its checksum matches');
  check(blockOf(unterminated) === 'offset 0, no block', 'strcmp wants the terminator: no block');

  const dungeon = read(DM_WINDOWS);
  check(readExtendedFeatures(dungeon).header !== undefined, 'dm-windows/dungeon.dat opens with a block');
  dungeon[300] ^= 0x01;
  const loadDungeon = outcome(() => `${new DungeonLoader().loadDungeonDat(dungeon).maps.length} levels`);
  console.log(`  ${DM_WINDOWS}, byte 300 changed: ${blockOf(dungeon)}; ReadDatabases: ${loadDungeon}`);
  check(blockOf(dungeon) === 'offset 0, no block', 'a dungeon.dat\'s block with a wrong checksum is no block either');
  check(loadDungeon.startsWith('threw '), 'and the block\'s bytes read as a dungeon\'s header fail the read');

  const stream = simpleEncipherKey();
  const unflagged = read(CONFLUX);
  rc4Encipher(stream, unflagged.subarray(0, EXTENDED_FEATURES_SIZE), 0);
  unflagged[37] = (unflagged[37] ?? 0) & ~EF_FLAGS.SimpleEncryption;
  resealBlock(unflagged);
  const sealed = blockChecksumMatches(unflagged);
  rc4Encipher(stream, unflagged.subarray(0, EXTENDED_FEATURES_SIZE), 0);
  console.log(`  Conflux's block without SimpleEncryption, checksum redone: ${blockOf(unflagged)}`);
  check(sealed, 'its checksum matches');
  check(blockOf(unflagged) === 'offset 0, no block', 'a sentinel found by deciphering needs the flag: no block');
}

function main(): void {
  checkStream();
  checkConflux();
  checkGivenUp();
  finish();
}

main();
