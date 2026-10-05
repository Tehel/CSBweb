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
 * 3. **The port reads the whole file deciphered.** `readExtendedFeatures` says the file
 *    is enciphered and hands back every byte of it deciphered, and `DungeonLoader` reads
 *    that to its last byte: the word that closes the image is the sum of every byte
 *    before it, and a change to the file's last byte fails the read. Five databases run
 *    past record 1023, and the object index has 19925 slots.
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
 * 5. **A save of an enciphered game is enciphered** (`SaveGame.cpp:914-920`, `:943-946`):
 *    DM's CSBWin `dungeon.dat` enciphered as CSBWin would, `SimpleEncryption` set, reads
 *    as the plain file does and sets `simpleEncipher`. The game's save is the save it
 *    makes with the flag cleared, its flag and checksum aside, enciphered whole; it
 *    loads, and a load of
 *    it sets `simpleEncipher` in a game that had not, which a plain load then keeps
 *    (CSBWin never clears it). A save's `GAMEBLOCK1` stamped again stays enciphered.
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
import { loadSaveGameState, stampRandomGameID } from '../src/data/SaveGameLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import type { DungeonData } from '../src/data/dungeonTypes';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { isDeepStrictEqual } from 'node:util';
import { newGame, stockGraphics } from './lib/game';
import { readU16BE, readU32LE, writeU32LE } from '../src/core/bytes';
import { check, finish } from './lib/check';
import { savePath } from './lib/saves';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const SAVE = 'csbgame7.dat';
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

  const ef = readExtendedFeatures(file);
  console.log(`  readExtendedFeatures: offset ${ef.offset}, simpleEncipher ${ef.simpleEncipher}`);
  check(ef.simpleEncipher, 'the port marks the file enciphered');
  check(ef.data.length === file.length && isDeepStrictEqual(ef.data, plain),
    'and hands back the whole file deciphered, every byte by its position');

  const dungeon = new DungeonLoader().loadDungeonDat(file);
  const image = plain.subarray(ef.offset);
  let sum = 0;
  for (let i = 0; i < image.length - 2; i++) sum = (sum + image[i]!) & 0xffff;
  const closing = readU16BE(image, image.length - 2);
  console.log(`  the image: ${image.length} bytes, closed by 0x${closing.toString(16)}, the sum of the rest 0x${sum.toString(16)}`);
  check(closing === sum, 'the last word of the file is the sum of every byte of the image before it');
  const cut = file.slice();
  cut[cut.length - 1] ^= 0x01;
  const cutRead = outcome(() => `${new DungeonLoader().loadDungeonDat(cut).maps.length} levels`);
  console.log(`  the file\'s last byte changed: ${cutRead}`);
  check(cutRead === 'threw "dungeon image checksum mismatch"', 'DungeonLoader compares that word: the file is read to its end');
  check(dungeon.simpleEncipher === true, 'and the dungeon says it was enciphered');

  const slots = dungeon.rnMaps.length;
  console.log(`  ${dungeon.maps.length} levels, ${slots} slots in the object index`);
  check(slots === 19925, 'the object index has 19925 slots');
  const expected: Array<[keyof DungeonData['databases'], number]> = [
    ['actuators', 10318], ['texts', 2243], ['misc', 1631], ['teleporters', 1613], ['creatures', 1257],
  ];
  for (const [name, count] of expected) {
    const got = dungeon.databases[name].records.length;
    console.log(`  ${name.padEnd(12)} ${got} records`);
    check(got === count, `${name}: ${count} records, past record 1023`);
  }
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
  const save = read(savePath(SAVE));
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

/* ---------------------------------------- 5. a save of an enciphered game ---- */

/** `file` as CSBWin would have it enciphered: `SimpleEncryption` set, resealed, every byte through the stream. */
function encipherAsCsbwin(file: Uint8Array): Uint8Array {
  const out = file.slice();
  out[37] = (out[37] ?? 0) | EF_FLAGS.SimpleEncryption;
  resealBlock(out);
  rc4Encipher(simpleEncipherKey(), out, 0);
  return out;
}

/** `save` with its block's checksum and flags put back to `plain`'s, the bytes those two may differ in. */
function blockAside(save: Uint8Array, plain: Uint8Array): Uint8Array {
  const out = save.slice();
  for (const at of [32, 33, 34, 35, 37]) out[at] = plain[at]!;
  return out;
}

function checkEnciphering(): void {
  console.log('');
  console.log('=== a save of an enciphered game is enciphered ===');
  const plainFile = read(DM_WINDOWS);
  const enciphered = encipherAsCsbwin(plainFile);
  check(sentinelOf(enciphered) !== EXTENDED_SENTINEL, `${DM_WINDOWS}, enciphered, does not open with the sentinel`);
  const plainData = new DungeonLoader().loadDungeonDat(plainFile);
  const encData = new DungeonLoader().loadDungeonDat(enciphered);
  check(plainData.simpleEncipher === undefined && encData.simpleEncipher === true, 'it reads, and says it was enciphered');
  check(isDeepStrictEqual(blockAside(readExtendedFeatures(enciphered).data, plainFile), plainFile),
    'from the bytes of the plain file, its flag and checksum aside');

  // Both games through `readDungeonDat`, the path a new game takes, which reads the rules.
  const graphics = stockGraphics();
  const game = newGame(plainData, graphics);
  game.readDungeonDat(enciphered);
  check(game.ctx.rules.simpleEncipher, 'a new game reads it, and has simpleEncipher');
  const save = buildSaveFile(game);
  const saved = readExtendedFeatures(save);
  console.log(`  its save: ${save.length} bytes, opens ${hex(save.subarray(0, 8))}; simpleEncipher ${saved.simpleEncipher}`);
  check(sentinelOf(save) !== EXTENDED_SENTINEL && saved.simpleEncipher, 'its save is enciphered');
  check(((saved.header?.flags ?? 0) & EF_FLAGS.SimpleEncryption) !== 0, 'and declares SimpleEncryption');
  const plainGame = newGame(new DungeonLoader().loadDungeonDat(plainFile), graphics);
  plainGame.readDungeonDat(plainFile);
  check(!plainGame.ctx.rules.simpleEncipher, 'a new game on the plain file has no simpleEncipher');
  check(readExtendedFeatures(buildSaveFile(plainGame)).simpleEncipher === false, 'and saves a plain file');
  game.ctx.rules.simpleEncipher = false;
  const plainSave = buildSaveFile(game);
  game.ctx.rules.simpleEncipher = true;
  check(readExtendedFeatures(plainSave).simpleEncipher === false, 'so does the enciphered game, the flag cleared');
  check(isDeepStrictEqual(blockAside(saved.data, plainSave), plainSave),
    'and its enciphered save, deciphered, is that file, its flag and checksum aside');
  const world = outcome(() => `${loadCsbwinWorld(save).dungeon.maps.length} levels`);
  console.log(`  loadCsbwinWorld: ${world}`);
  check(world === `${plainData.maps.length} levels`, 'the enciphered save reads, its image closing at the file\'s end');

  const other = plainGame;
  applySaveBytes(other, save);
  check(other.ctx.rules.simpleEncipher, 'a load of the enciphered save sets it');
  applySaveBytes(other, plainSave);
  check(other.ctx.rules.simpleEncipher, 'and a load of a plain save keeps it');
  check(readExtendedFeatures(buildSaveFile(other)).simpleEncipher, 'so the game\'s next save is enciphered');

  const stamped = stampRandomGameID(save, 0x12345678);
  check(sentinelOf(stamped) !== EXTENDED_SENTINEL && loadSaveGameState(stamped).block1?.randomGameID === 0x12345678,
    'a save stamped with a new game id stays enciphered, and reads with the id');
}

function main(): void {
  checkStream();
  checkConflux();
  checkGivenUp();
  checkEnciphering();
  finish();
}

main();
