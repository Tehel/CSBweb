/**
 * The stamp: a playthrough written into a save file (`stampRandomGameID`).
 *
 * A file an earlier build of the port wrote holds `RandomGameID` 0, which names no
 * playthrough, and the store gives such a file an id and writes it into the file
 * (`doc/SAVES.md` → "A playthrough"). The id is in `GAMEBLOCK1`, whose second half
 * is scrambled and whose first half folds to the sum of the second. A stamp that got
 * either wrong gives a file that no longer reads, or one that reads with something else
 * of the game changed, and neither shows until the save is loaded.
 *
 * So the stamp is run over real files: the eight genuine CSBWin saves, and the two of
 * `tools/fixtures/gamefiles/csb`, which have no Extended Features block before `GAMEBLOCK1`.
 * One of those, `mini.dat`, has 127 words that are not zero in the block's first half,
 * where CSBWin writes zeroes (`doc/CSBwin-src/SaveGame.cpp:733-746`, the `STRandom()` it
 * comments out). For each:
 *
 * 1. The stamped file differs from the original in six bytes at most, all in
 *    `GAMEBLOCK1`: the id's four, and the block's word 127, the one its fold ends on.
 * 2. It reads back with the id, and with the level and the party it had: the fold and
 *    the five blocks' checksums all pass.
 * 3. The file's own id stamped back gives the original, byte for byte.
 * 4. A file made to name no playthrough, then stamped, is the file stamped at once.
 * 5. The canary: where the first half is CSBWin's, all zeroes, the stamped block is what
 *    `ScrambleAndWrite` writes for the block with that id. Where it is not, its words
 *    are kept.
 *
 * 6. `_ReadEntireGame`'s four words (`stampBlock1Words`): no genuine save holds 0 in all
 *    four (`holdsNoBlock1Words`), and one that holds CSBWin's 1, 2, 1 and 13 stamped is
 *    the file byte for byte, its block's fold and scramble included.
 *
 * The store's upgrades, which stamp the rows it holds, are in `tools/checks/save-menu.ts`,
 * "the store's upgrade".
 *
 * Run: `npm test -- --only=save-stamp.ts`
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { readU16BE, writeU32BE } from '../../src/core/bytes';
import { readExtendedFeatures } from '../../src/data/CsbwinExtendedFeatures';
import { readCsbwinSaveInfo } from '../../src/data/CsbwinSaveInfo';
import { BLOCK1_SIZE, readUnscrambleBlock, scrambleAndWrite } from '../../src/data/CsbwinSaveStream';
import { holdsNoBlock1Words, stampBlock1Words, stampRandomGameID } from '../../src/data/SaveFile';
import { check, finish } from '../lib/check';
import { genuineSaves } from '../lib/saves';

/** The saves with no Extended Features block: `GAMEBLOCK1` opens the file. */
const BARE_SAVES = ['tools/fixtures/gamefiles/csb/mini.dat', 'tools/fixtures/gamefiles/csb/csbgame2.dat'];

/** `RandomGameID` in `GAMEBLOCK1` (`doc/CSBwin-src/SaveGame.cpp:1085`), and the fold's last word. */
const ID_OFFSET = 308;
const FOLD_END_OFFSET = 254;

/** An id whose four bytes differ, so a byte written out of order shows. */
const ID = 0x12345678;

const hex = (id: number): string => `0x${(id >>> 0).toString(16).padStart(8, '0')}`;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Where two files of one length differ. */
function differing(a: Uint8Array, b: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  return at;
}

function thrown(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkFile(path: string): void {
  const name = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  const untouched = bytes.slice();
  const { offset } = readExtendedFeatures(bytes);
  const before = readCsbwinSaveInfo(bytes);
  if (!before) {
    check(false, `${name}: reads as a save`);
    return;
  }
  const plain = readUnscrambleBlock(bytes, offset).buf;
  let foldWords = 0;
  for (let at = 0; at < FOLD_END_OFFSET; at += 2) if (readU16BE(plain, at) !== 0) foldWords++;

  const stamped = stampRandomGameID(bytes, ID);
  const inBlock = differing(bytes, stamped).map((at) => at - offset);
  const after = readCsbwinSaveInfo(stamped);
  console.log([
    name, bytes.length, offset, hex(before.randomGameID), foldWords,
    inBlock.join(' '), after ? hex(after.randomGameID) : 'DOES NOT READ',
  ].join('\t'));

  // 1. Six bytes at most, all in GAMEBLOCK1.
  check(stamped.length === bytes.length && sameBytes(bytes, untouched), `${name}: the stamp is a copy of the file's length, and the file is left as it was`);
  const idBytes = inBlock.filter((at) => at >= ID_OFFSET && at < ID_OFFSET + 4);
  const foldBytes = inBlock.filter((at) => at >= FOLD_END_OFFSET && at < FOLD_END_OFFSET + 2);
  check(inBlock.length > 0 && idBytes.length + foldBytes.length === inBlock.length,
    `${name}: the stamped file differs in GAMEBLOCK1's id and the fold's last word alone (got ${inBlock.join(' ')})`);
  check(idBytes.length > 0, `${name}: and the id's bytes are among them`);
  const stampedPlain = readUnscrambleBlock(stamped, offset).buf;
  const plainDiffers = differing(plain, stampedPlain);
  check(plainDiffers.every((at) => (at >= ID_OFFSET && at < ID_OFFSET + 4) || (at >= FOLD_END_OFFSET && at < FOLD_END_OFFSET + 2)),
    `${name}: unscrambled, the block holds the same fields but the id`);

  // 2. It reads back with the id, and with what it had.
  check(after?.randomGameID === ID, `${name}: the stamped file reads back with the id (got ${after ? hex(after.randomGameID) : 'none'})`);
  check(after?.level === before.level && after.time === before.time && after.champions.join('/') === before.champions.join('/'),
    `${name}: and with the level, the clock and the party it had`);

  // 3. The file's own id stamped back gives the original.
  check(sameBytes(stampRandomGameID(stamped, before.randomGameID), bytes), `${name}: its own id stamped back gives the file byte for byte`);

  // 4. A file that names no playthrough, stamped.
  const nameless = stampRandomGameID(bytes, 0);
  check(readCsbwinSaveInfo(nameless)?.randomGameID === 0, `${name}: stamped with 0, it reads as a file that names no playthrough`);
  check(sameBytes(stampRandomGameID(nameless, ID), stamped), `${name}: and that file stamped is the file stamped at once`);

  // 5. Where the first half is CSBWin's, the block is ScrambleAndWrite's.
  if (foldWords === 0) {
    const written = plain.slice();
    writeU32BE(written, ID_OFFSET, ID);
    scrambleAndWrite(written);
    check(sameBytes(written, stamped.subarray(offset, offset + BLOCK1_SIZE)),
      `${name}: the stamped block is what ScrambleAndWrite (SaveGame.cpp:714-759) writes for the block with that id`);
  } else {
    check(inBlock.every((at) => at >= FOLD_END_OFFSET), `${name}: the ${foldWords} words of its first half that are not zero are kept`);
  }

  // 6. `_ReadEntireGame`'s four words.
  check(!holdsNoBlock1Words(bytes), `${name}: holds a word of GAMEBLOCK1's four that an early build of the port left 0`);
  const words = [plain[300], plain[301], readU16BE(plain, 376), readU16BE(plain, 378)].join(' ');
  if (words === '1 2 1 13') {
    check(sameBytes(stampBlock1Words(bytes), bytes), `${name}: holds CSBWin's 1 2 1 13, and stamped with them is the file byte for byte`);
  } else {
    const differs = differing(bytes, stampBlock1Words(bytes)).map((at) => at - offset);
    check(differs.length > 0 && differs.every((at) => at >= FOLD_END_OFFSET && at < BLOCK1_SIZE),
      `${name}: holds ${words}, and stamped differs in GAMEBLOCK1's scrambled half and the fold's last word alone`);
  }
}

function main(): void {
  console.log('=== a playthrough stamped into a save file (`stampRandomGameID`) ===');
  console.log(`  the id stamped: ${hex(ID)}; a differing byte is given by its place in GAMEBLOCK1`);
  console.log(['file', 'bytes', 'GAMEBLOCK1 at', 'its id', 'fold words not 0', 'differing bytes', 'reads back'].join('\t'));
  const files = [...genuineSaves(), ...BARE_SAVES.map((path) => resolve(path))];
  for (const path of files) checkFile(path);
  check(files.length === 10, `ten files are stamped (got ${files.length})`);
  check(files.some((path) => readExtendedFeatures(new Uint8Array(readFileSync(path))).offset > 0)
    && files.some((path) => readExtendedFeatures(new Uint8Array(readFileSync(path))).offset === 0),
    'some behind an Extended Features block, and some with GAMEBLOCK1 at the head of the file');

  // An id above 0x7fffffff is the same four bytes, read back unsigned.
  const bytes = new Uint8Array(readFileSync(files[0]!));
  const high = readCsbwinSaveInfo(stampRandomGameID(bytes, 0xfedcba98))?.randomGameID;
  const signed = readCsbwinSaveInfo(stampRandomGameID(bytes, 0xfedcba98 | 0))?.randomGameID;
  console.log('');
  console.log(`  an id of 0xfedcba98 reads back as ${high === undefined ? 'none' : hex(high)}; given as a signed word, ${signed === undefined ? 'none' : hex(signed)}`);
  check(high === 0xfedcba98 && signed === 0xfedcba98, 'an id with its top bit set is stamped and read back unsigned');

  // What is not a save takes no stamp.
  const { offset } = readExtendedFeatures(bytes);
  const damaged = bytes.slice();
  damaged[offset + ID_OFFSET] ^= 0x01;
  const notASave = thrown(() => stampRandomGameID(new Uint8Array(64), ID));
  const badBlock = thrown(() => stampRandomGameID(damaged, ID));
  console.log(`  64 bytes of nothing: ${notASave}; a file with one bit of GAMEBLOCK1 flipped: ${badBlock}`);
  check(notASave !== null, 'a file that is no save takes no stamp: it throws');
  check(badBlock !== null && /checksum/.test(badBlock), 'nor does one whose GAMEBLOCK1 does not fold to its sum: a stamp would make a damaged block read');

  finish();
}

main();
