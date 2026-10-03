/**
 * "MAKE NEW ADVENTURE": a saved game's party carried into `mini.dat`, Chaos Strikes
 * Back's dungeon, as CSBWin's UTILITY does it (`src/engine/Chaos.ts`,
 * `doc/CSBwin-src/Chaos.cpp`).
 *
 * 1. The canary. `static/gamefiles/csb/csbgame2.dat` is a file CSBWin's utility wrote:
 *    `Byte22598` 2, which only `_TAG000fc4` writes, and `mini.dat`'s world. Made again
 *    from itself and `mini.dat`, with its own food, water and `RandomGameID` in place
 *    of the three draws and the sum, it is the file byte for byte. That holds every
 *    other byte of the copy and of the writer: the blocks, their offsets, the zeroed
 *    hashes and `totalMoveCount`, the fold, and the dungeon after them.
 * 2. Every field `TAG002724` writes, on `csbgame7.dat`, a party of four from a Dungeon
 *    Master game CSBWin saved, facing north where `mini.dat`'s faces south: the copy
 *    against the saved game and `mini.dat` field by field: the two writes that read a
 *    big-endian field as memory holds it on the little-endian build, and the champion's
 *    sex, which the port keeps where CSBWin clears it (`DEBT.md` H).
 * 3. The new adventure loads into a `Game` on CSB's graphics: `mini.dat`'s eleven
 *    levels, the party where `mini.dat` put its own, the saved game's champions.
 * 4. The refusals, each with CSBWin's message: no party, "ALREADY UTILIZED", a name
 *    missing or twice, `mini.dat` not a new adventure, either file damaged, and the
 *    unported branch (`DEBT.md` G28), a `mini.dat` with an Extended Features block.
 *
 * Run: `npx tsx tools/dump-new-adventure.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE, readU32BE, readU32LE } from '../src/core/bytes';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import {
  CheckChampionNames,
  ReadSavedGame,
  TAG000fc4,
  TAG002724,
  TAG00260e,
  TAG0026c4,
  UtilityDiskMessages,
  UtilityError,
  makeNewAdventure,
  type UtilityGame,
} from '../src/engine/Chaos';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { check, finish } from './lib/check';
import { newGame } from './lib/game';
import { savePath } from './lib/saves';

const CSB = 'static/gamefiles/csb';
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
const MINI = read(resolve(CSB, 'mini.dat'));
const CSBGAME2 = read(resolve(CSB, 'csbgame2.dat'));
const CSBGAME7 = read(savePath('csbgame7.dat'));
const SEED = 0x2468ace0;

const hex = (n: number): string => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const name = (g: UtilityGame, i: number): string => {
  let s = '';
  for (let j = i * 800; g.characters[j] !== 0 && j < i * 800 + 8; j++) s += String.fromCharCode(g.characters[j]!);
  return s;
};

/** The message a refusal shows, or null when nothing was refused. */
function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof UtilityError ? error.message : `not a refusal: ${(error as Error).message}`;
  }
}

function canary(): void {
  console.log('=== 1. the canary: csbgame2.dat made again from itself and mini.dat ===');
  const genuine = ReadSavedGame(CSBGAME2, 0);
  console.log(`  csbgame2.dat: Byte22598 ${genuine.block1[300]}, ${readU16BE(genuine.block2, 10)} champions ` +
    `(${name(genuine, 0)}, ${name(genuine, 1)}), id ${hex(readU32BE(genuine.block1, 308))}`);
  check(genuine.block1[300] === 2, 'csbgame2.dat carries Byte22598 2, which _TAG000fc4 writes and SaveGame never does');

  const source = ReadSavedGame(CSBGAME2, 0);
  TAG00260e(source);
  const mini = ReadSavedGame(MINI, 1);
  TAG0026c4(mini);
  TAG002724(source, mini, new CsbRandom(SEED));
  const drawn = TAG000fc4(source, mini);
  const differ: number[] = [];
  for (let i = 0; i < drawn.length; i++) if (drawn[i] !== CSBGAME2[i]) differ.push(i);
  console.log(`  as drawn: ${drawn.length} bytes against ${CSBGAME2.length}, ${differ.length} differ`);
  for (let i = 0; i < 2; i++) mini.characters.set(genuine.characters.subarray(800 * i + 66, 800 * i + 70), 800 * i + 66);
  mini.block1.set(genuine.block1.subarray(308, 312), 308);
  const made = TAG000fc4(source, mini);
  console.log(`  with its food, water and id: ${same(made, CSBGAME2) ? 'the file, byte for byte' : 'DIFFERENT'}`);
  check(same(made, CSBGAME2), 'with its own food, water and RandomGameID, csbgame2.dat made from itself and mini.dat is the file byte for byte');
  check(differ.length > 0 && drawn.length === CSBGAME2.length, 'and as drawn, with the draws and the sum, it is a file of its length that differs');
}

function copy(): Uint8Array {
  console.log('\n=== 2. TAG002724, field by field: csbgame7.dat into mini.dat ===');
  const source = ReadSavedGame(CSBGAME7, 0);
  const mini = ReadSavedGame(MINI, 1);
  const made = makeNewAdventure(CSBGAME7, MINI, new CsbRandom(SEED));
  const out = ReadSavedGame(made, 1);
  const draws = new CsbRandom(SEED);

  const count = readU16BE(source.block2, 10);
  const turn = (readU16BE(mini.block2, 16) - readU16BE(source.block2, 16) + 4) & 3;
  console.log(`  ${count} champions, the party facing ${readU16BE(source.block2, 16)} in the saved game and ` +
    `${readU16BE(mini.block2, 16)} in mini.dat: each champion turned ${turn}`);
  check(count === 4 && turn === 2, 'csbgame7.dat brings four champions, turned through two quarters');

  // GAMEBLOCK1: mini.dat's, but for what the copy and the writer set.
  const b1 = out.block1;
  const expectedId = (readU32LE(source.block1, 308) + 1) >>> 0;
  console.log(`  RandomGameID ${hex(readU32BE(source.block1, 308))} -> ${hex(readU32BE(b1, 308))}`);
  check(readU32LE(b1, 308) === expectedId && readU32BE(b1, 308) === (readU32BE(source.block1, 308) + 0x01000000) >>> 0,
    'RandomGameID is LoadLong(+308) + 1: the 1 is added to the file\'s first byte, the field\'s highest');
  check(same(b1.subarray(256, 296), source.block1.subarray(256, 296)), 'GAMEBLOCK1 bytes 256-295 are the saved game\'s');
  check(b1[300] === 2 && b1[301] === mini.block1[301], 'Byte22598 is 2, Byte22596 mini.dat\'s');
  check(same(b1.subarray(296, 300), mini.block1.subarray(296, 300)) && same(b1.subarray(302, 308), mini.block1.subarray(302, 308)),
    'the bytes about them, SaveOption among them, are mini.dat\'s');
  check(b1.subarray(312, 344).every((x) => x === 0), 'the sixteen words from 312 are zero: the five hashes and totalMoveCount among them');
  check(readU16BE(b1, 376) === readU16BE(source.block1, 376) && readU16BE(b1, 378) === 13,
    'Word22594 is the saved game\'s, Word22592 mini.dat\'s 13');
  check(same(b1.subarray(380), mini.block1.subarray(380)), 'Byte22808 is mini.dat\'s');

  // GAMEBLOCK2 and the rest: mini.dat's.
  const b2 = out.block2.slice();
  check(readU16BE(b2, 10) === count, 'gb2.numcharacter is the saved game\'s');
  b2.set(mini.block2.subarray(10, 12), 10);
  check(same(b2, mini.block2), 'the rest of GAMEBLOCK2 is mini.dat\'s: the party stands where mini.dat\'s did');
  check(same(out.item16, mini.item16) && same(out.timers, mini.timers) && same(out.timerQueue, mini.timerQueue)
    && same(out.image, mini.image), 'the groups, the timers, their queue and the dungeon are mini.dat\'s');
  check(same(out.characters.subarray(3200), mini.characters.subarray(3200)), 'the party state after the four CHARDESCs is mini.dat\'s');

  // Each CHARDESC.
  for (let i = 0; i < count; i++) {
    const s = source.characters.subarray(800 * i, 800 * (i + 1));
    const c = out.characters.subarray(800 * i, 800 * (i + 1));
    const who = name(source, i);
    const food = (draws.next() & 255) + 1500;
    const water = (draws.next() & 255) + 1500;
    console.log(`  ${who.padEnd(8)} facing ${s[28]} -> ${c[28]}, corner ${s[29]} -> ${c[29]}, ` +
      `HP ${readU16BE(s, 52)}/${readU16BE(s, 54)} -> ${readU16BE(c, 52)}, ` +
      `food ${readU16BE(s, 66)} -> ${readU16BE(c, 66)}, water ${readU16BE(s, 68)} -> ${readU16BE(c, 68)}, ` +
      `charFlags 0x${readU16BE(s, 48).toString(16)} -> 0x${readU16BE(c, 48).toString(16)}`);
    check(same(c.subarray(0, 28), s.subarray(0, 28)), `${who}: name and title`);
    check(c[28] === ((s[28]! + turn) & 3) && c[29] === ((s[29]! + turn) & 3), `${who}: facing and corner turned with the party`);
    check(c[30] === 1 && c[31] === 2 && c[32] === 0xff && c[33] === 0 && c[34] === 0 && same(c.subarray(35, 40), s.subarray(35, 40)),
      `${who}: bytes 30-34 are 1, 2, -1, 0, 0`);
    check(c[40] === 0 && c[41] === 0 && c[42] === 0 && c[43] === s[43], `${who}: damage, recent damage and poison cleared`);
    check(readU16BE(c, 44) === 0xffff && readU16BE(c, 46) === 0xffff, `${who}: no timer`);
    check(readU16BE(c, 48) === (readU16BE(s, 48) & 0x10), `${who}: charFlags keeps CHARFLAG_male alone, where CSBWin's double LE16 keeps 0x1000 (DEBT.md H)`);
    check(readU16BE(c, 50) === 0, `${who}: no wounds`);
    check(readU16BE(c, 52) === readU16BE(s, 54) && readU16BE(c, 56) === readU16BE(s, 58) && readU16BE(c, 60) === readU16BE(s, 62)
      && same(c.subarray(54, 56), s.subarray(54, 56)) && same(c.subarray(58, 60), s.subarray(58, 60)) && same(c.subarray(62, 64), s.subarray(62, 64)),
      `${who}: health, stamina and mana at their maxima`);
    check(readU16BE(c, 64) === 0, `${who}: word 64 cleared`);
    check(readU16BE(c, 66) === food && readU16BE(c, 68) === water, `${who}: food and water 1500 + (STRandom() & 255), food first`);
    let attributes = true;
    for (let a = 0; a < 7; a++) {
      const at = 70 + 3 * a;
      attributes &&= c[at] === s[at] && c[at + 1] === s[at] && c[at + 2] === (a === 0 ? 10 : 30);
    }
    check(attributes, `${who}: every attribute at its maximum, its minimum 30, Luck's 10`);
    let skills = true;
    for (let k = 0; k < 20; k++) skills &&= readU16BE(c, 92 + 6 * k) === 0 && same(c.subarray(94 + 6 * k, 98 + 6 * k), s.subarray(94 + 6 * k, 98 + 6 * k));
    check(skills, `${who}: every skill's temporary adjustment 0, its experience kept`);
    check(c.subarray(212, 272).every((x) => x === 0xff), `${who}: every possession slot empty`);
    check(readU16BE(c, 272) === 0 && readU16BE(c, 274) === 0, `${who}: load and shield 0`);
    check(same(c.subarray(276), s.subarray(276)), `${who}: the rest, the portrait among it, is the saved game's`);
  }
  for (let i = count; i < 4; i++) {
    check(same(out.characters.subarray(800 * i, 800 * (i + 1)), source.characters.subarray(800 * i, 800 * (i + 1))),
      `slot ${i}: the saved game's, untouched`);
  }

  // The three writes that read a big-endian field as memory holds it.
  const atari = ReadSavedGame(CSBGAME7, 0);
  atari.block1[301] = 1;
  atari.block1.set([0xff, 0x12, 0x34, 0x56], 308);
  const atariMini = ReadSavedGame(MINI, 1);
  TAG00260e(atari);
  TAG002724(atari, atariMini, new CsbRandom(SEED));
  console.log(`  an Atari save (Byte22596 1) with id 0xff123456: Word22594 ${readU16BE(atariMini.block1, 376)}, ` +
    `id ${hex(readU32BE(atariMini.block1, 308))}`);
  check(readU16BE(atariMini.block1, 376) === 256, 'an Atari save\'s Word22594 is set by wordGear(+376) = 1: the bytes 01 00, 256');
  check(readU32BE(atariMini.block1, 308) === 0x00133456, 'an id whose first byte is 0xff carries into its second');
  return made;
}

function load(made: Uint8Array): void {
  console.log('\n=== 3. the new adventure, loaded ===');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(read(resolve(CSB, 'graphics.dat')));
  const game = newGame(new DungeonLoader().loadDungeonDat(read('static/gamefiles/dm-atari/dungeon.dat')), graphics);
  try {
    applyCsbwinSave(game, made);
  } catch (error) {
    check(false, `the new adventure loads — ${(error as Error).message}`);
    return;
  }
  const party = game.ctx.party.state;
  const source = ReadSavedGame(CSBGAME7, 0);
  const names = party.champions.map((c) => c.name);
  console.log(`  ${game.ctx.dungeon.getMapCount()} maps, the party at (${party.position.x},${party.position.y}) ` +
    `level ${party.position.z}: ${names.join(', ')}`);
  check(game.ctx.dungeon.getMapCount() === 11, 'the world is mini.dat\'s eleven levels');
  check(party.position.x === 22 && party.position.y === 18 && party.position.z === 4, 'the party stands at (22,18) on level 4, where mini.dat\'s did');
  check(names.join() === [0, 1, 2, 3].map((i) => name(source, i)).join(), 'the champions are csbgame7.dat\'s');
  check(party.champions.every((c) => c.possessions.every((p) => p === 0xffff) && c.attributes.health === c.attributes.maxHealth),
    'empty-handed, at full health');
}

function refusals(): void {
  console.log('\n=== 4. the refusals ===');
  const fresh = (): UtilityGame => ReadSavedGame(CSBGAME7, 0);
  const cases: Array<[string, () => unknown, string]> = [];
  const noParty = fresh();
  noParty.block2.set([0, 0], 10);
  cases.push(['a saved game with no party', () => TAG00260e(noParty), UtilityDiskMessages[29]]);
  const utilized = fresh();
  utilized.block1.set([0, 2], 376);
  cases.push(['Byte22596 2 and Word22594 2', () => TAG00260e(utilized), UtilityDiskMessages[30]]);
  const past = fresh();
  past.block1.set([0, 14], 378);
  cases.push(['Word22592 14', () => TAG00260e(past), UtilityDiskMessages[30]]);
  const unnamed = fresh();
  unnamed.characters[800 * 2] = 0;
  cases.push(['the third champion with no name', () => TAG00260e(unnamed), UtilityDiskMessages[20]]);
  const twice = fresh();
  twice.characters.copyWithin(800 * 3, 800, 808);
  cases.push(['the fourth champion named as the second', () => TAG00260e(twice), UtilityDiskMessages[20]]);
  const long = fresh();
  for (const i of [0, 1]) {
    long.characters.set([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48], 800 * i);
    long.characters.set([0x58 + i, 0], 800 * i + 8);
  }
  cases.push(['two eight-letter names alike, their titles not', () => CheckChampionNames(long), '']);
  const notNew = ReadSavedGame(MINI, 1);
  notNew.block1.set([0, 12], 378);
  cases.push(['a mini.dat whose Word22592 is 12', () => TAG0026c4(notNew), UtilityDiskMessages[30]]);
  const atariMini = ReadSavedGame(MINI, 1);
  atariMini.block1[301] = 1;
  cases.push(['a mini.dat whose Byte22596 is 1', () => TAG0026c4(atariMini), UtilityDiskMessages[30]]);
  const damaged = CSBGAME7.slice();
  damaged[damaged.length - 100] ^= 1;
  cases.push(['a saved game with one bit of its dungeon flipped', () => makeNewAdventure(damaged, MINI, new CsbRandom(SEED)), UtilityDiskMessages[14]]);
  const damagedMini = MINI.slice();
  damagedMini[600] ^= 1;
  cases.push(['a mini.dat with one bit of GAMEBLOCK2 flipped', () => makeNewAdventure(CSBGAME7, damagedMini, new CsbRandom(SEED)), UtilityDiskMessages[25]]);
  cases.push(['a mini.dat cut short', () => makeNewAdventure(CSBGAME7, MINI.subarray(0, MINI.length - 3000), new CsbRandom(SEED)), UtilityDiskMessages[25]]);
  for (const [what, run, expected] of cases) {
    const got = refusal(run);
    console.log(`  ${what}: ${got === null ? 'made' : JSON.stringify(got)}`);
    check(expected === '' ? got === null : got === expected, `${what}: ${expected === '' ? 'made, as strcmp reads on into the titles' : JSON.stringify(expected)}`);
  }

  // A file whose dungeon ends where the file does: ReadGameFile's failure at the last word is taken.
  const unsummed = makeNewAdventure(CSBGAME7, MINI.subarray(0, MINI.length - 2), new CsbRandom(SEED));
  check(same(unsummed, makeNewAdventure(CSBGAME7, MINI, new CsbRandom(SEED))), 'a mini.dat without the word after its dungeon is taken, and makes the same adventure');

  // The unported branch: a mini.dat behind an Extended Features block.
  let unported: string | null = null;
  try {
    makeNewAdventure(CSBGAME7, CSBGAME7, new CsbRandom(SEED));
  } catch (error) {
    unported = (error as Error).message;
  }
  console.log(`  csbgame7.dat as mini.dat: ${unported}`);
  check(unported !== null && /G28/.test(unported), 'a mini.dat with an Extended Features block passes TAG0026c4 and is refused at the write, which is not ported');
}

canary();
const made = copy();
load(made);
refusals();
finish();
