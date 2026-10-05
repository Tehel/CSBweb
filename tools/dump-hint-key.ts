/**
 * The hint key and the four graphics signatures an Extended Features block carries
 * (`hintKey`, `expectedGraphicSignature1/2`, `expectedCSBgraphicSignature1/2`).
 *
 * 1. **A read keeps them**: `csbgame7.dat` given a key and four canary signatures, its
 *    block's checksum made again, is read (`ReadExtendedFeatures`,
 *    `doc/CSBwin-src/SaveGame.cpp:378-382`): the key is the world's, and the signatures
 *    the game's.
 * 2. **A save writes them back** (`SaveGame.cpp:936-941`), and the file it writes reads
 *    back into another game with all five.
 * 3. **A file without a block**: a new game from `dm-atari/dungeon.dat`, which has none,
 *    leaves the key zero, as `ReadExtendedFeatures` zeroes it before it looks for a block
 *    (`:314`), and the signatures as they were, which it never clears. Its save writes
 *    zeros for the key and the canaries for the signatures.
 * 4. **The Oracle reads `hcsb.hct` under the key** (`SETENCIPHERED`,
 *    `doc/CSBwin-src/Hint.cpp:5401-5405`, `system.cpp:274-286`): the retail file,
 *    enciphered under the key, reads under the world's key as the plain file reads; with
 *    no key it fails the first header check, and a key whose first byte is 0 reads the
 *    plain file plain.
 *
 * Run: `npx tsx tools/dump-hint-key.ts`
 */
import { readFileSync } from 'node:fs';

import { readExtendedFeatures } from '../src/data/CsbwinExtendedFeatures';
import { formChecksum } from '../src/data/CsbwinObjectIndex';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { encipherHintFile, parseHintOracle, readHintOracle } from '../src/data/HintOracleLoader';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import type { Game } from '../src/engine/Game';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { savePath } from './lib/saves';

const KEY = Uint8Array.of(0x5a, 0x01, 0xff, 0x80, 0x00, 0x13, 0x37, 0xc4);
const SIGNATURES = [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff01] as const;

const hex = (bytes: Uint8Array | undefined): string =>
  bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ') : '—';
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array): boolean =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
const signaturesOf = (game: Game): number[] => {
  const s = game.ctx.signatures;
  return [s.expectedGraphicSignature1, s.expectedGraphicSignature2, s.expectedCSBgraphicSignature1, s.expectedCSBgraphicSignature2];
};
const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const hexWords = (words: readonly number[]): string => words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join(' ');

/** A file's key and signatures, from its block, as `ReadExtendedFeatures` takes them. */
function blockOf(file: Uint8Array): { hintKey: Uint8Array; signatures: number[] } {
  const header = readExtendedFeatures(file).header!;
  return {
    hintKey: header.hintKey,
    signatures: [header.graphicsSignature1, header.graphicsSignature2, header.csbGraphicsSignature1, header.csbGraphicsSignature2],
  };
}

/** `file` with the key and the signatures in its block, and the block's checksum made again. */
function withKeyAndSignatures(file: Uint8Array): Uint8Array {
  const out = file.slice();
  const view = new DataView(out.buffer);
  view.setUint32(52, SIGNATURES[0], true);
  view.setUint32(56, SIGNATURES[1], true);
  view.setUint32(88, SIGNATURES[2], true);
  view.setUint32(92, SIGNATURES[3], true);
  out.set(KEY, 96);
  view.setUint32(32, 0, true);
  view.setUint32(32, formChecksum(out.subarray(0, 512)) >>> 0, true);
  return out;
}

const graphics = stockGraphics();
const dungeonDat = new Uint8Array(readFileSync('static/gamefiles/dm-atari/dungeon.dat'));
const freshGame = (): Game => newGame(new DungeonLoader().loadDungeonDat(dungeonDat), graphics);

const original = new Uint8Array(readFileSync(savePath('csbgame7.dat')));
const keyed = withKeyAndSignatures(original);
check(sameBytes(blockOf(keyed).hintKey, KEY), "the keyed file's block holds the key, its checksum good");

console.log('1. A read keeps them');
const game = freshGame();
applyCsbwinSave(game, keyed);
console.log(`  world's key ${hex(game.ctx.state.dungeon.hintKey)}, signatures ${hexWords(signaturesOf(game))}`);
check(sameBytes(game.ctx.state.dungeon.hintKey, KEY), "the world's hintKey is the file's");
check(sameNumbers(signaturesOf(game), SIGNATURES), "the game's signatures are the file's");

console.log('2. A save writes them back');
const saved = buildSaveFile(game);
const written = blockOf(saved);
console.log(`  written: key ${hex(written.hintKey)}, signatures ${hexWords(written.signatures)}`);
check(sameBytes(written.hintKey, KEY), 'the save writes the key back');
check(sameNumbers(written.signatures, SIGNATURES), 'the save writes the four signatures back');
const other = freshGame();
applyCsbwinSave(other, saved);
check(sameBytes(other.ctx.state.dungeon.hintKey, KEY) && sameNumbers(signaturesOf(other), SIGNATURES),
  'the file the save wrote reads back with all five');

console.log('3. A file without a block');
check(readExtendedFeatures(dungeonDat).header === undefined, '`dm-atari/dungeon.dat` has no block');
game.readNewGame(new DungeonLoader().loadDungeonDat(dungeonDat));
console.log(`  world's key ${hex(game.ctx.state.dungeon.hintKey)}, signatures ${hexWords(signaturesOf(game))}`);
check(game.ctx.state.dungeon.hintKey === undefined, 'a new game from it has no key');
check(sameNumbers(signaturesOf(game), SIGNATURES), 'and keeps the signatures the last block gave');
const newGameSaved = blockOf(buildSaveFile(game));
check(sameBytes(newGameSaved.hintKey, new Uint8Array(8)), "its save's key is eight zeros");
check(sameNumbers(newGameSaved.signatures, SIGNATURES), "its save's signatures are the canaries");
check(sameBytes(blockOf(buildSaveFile(freshGame())).hintKey, new Uint8Array(8))
  && sameNumbers(blockOf(buildSaveFile(freshGame())).signatures, [0, 0, 0, 0]),
  "a game that never read a block saves zeros for all five, as every committed save holds");

console.log('4. The Oracle reads hcsb.hct under the key');
const hct = new Uint8Array(readFileSync('static/gamefiles/csb/hcsb.hct'));
const plain = parseHintOracle(hct);
const enciphered = encipherHintFile(hct, KEY);
const differs = enciphered.reduce((n, b, i) => n + (b !== hct[i] ? 1 : 0), 0);
console.log(`  ${hct.length} bytes, ${differs} changed by the key; first words ${hex(enciphered.subarray(0, 4))}`);
check(differs > hct.length * 0.9, 'the key changes almost every byte');
const read = readHintOracle(enciphered, other.ctx.state.dungeon.hintKey);
check(JSON.stringify(read) === JSON.stringify(plain), "the enciphered file, read under the loaded world's key, is the plain file's hints");
let refused = '';
try {
  readHintOracle(enciphered, undefined);
} catch (error) {
  refused = String(error);
}
console.log(`  with no key: ${refused || 'read'}`);
check(refused.includes('first word is not 2'), 'without the key it fails the first header check (error 55)');
const zeroFirst = KEY.slice();
zeroFirst[0] = 0;
check(JSON.stringify(readHintOracle(hct, zeroFirst)) === JSON.stringify(plain),
  'a key whose first byte is 0 reads the plain file plain (`hintKey[0] != 0`)');

finish();
