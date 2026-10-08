/**
 * The wings (`CHARDESC::SaveToWings`, `GetFromWings`, `LocateInWings`,
 * `doc/CSBwin-src/Character.cpp:5174-5261`): a champion who has left the party, kept as
 * eight 25-longword `EXPOOL` records, and what reads them. The bones and the Altar of Vi
 * are `dump-vi-altar.ts`'s.
 *
 * 1. **The record.** Champion 1 of `csbgame7.dat`, written as a `CHARDESC` and saved to
 *    the wings, is eight records of 25 longwords under `(8 << 24) | (i << 16) | fp`, as
 *    the little-endian build holds them: the name's first letter in longword 0's low
 *    byte, HP in longword 13's low word and the maximum in its high word (so
 *    `swapCharacter` ran), the talents as longword 69, which it leaves alone.
 * 2. **The reads.** `GetFromWings`, testing only, gives the 800 bytes back and leaves the
 *    records; reading takes them out. A record missing fails it, the ones before it
 *    gone; a `fingerPrint` (record 2's) that is not the key's fails it too. `LocateInWings`
 *    is record 0 alone. A second `SaveToWings` replaces the first, one record a key.
 * 3. **`FingerprintExists`** (`Character.cpp:438-451`): `AddCharacter`'s fingerprint
 *    steps over one in the wings.
 * 4. **A save carries them**, in the pool: the file read back holds the same 800 bytes.
 * 5. **The DSA readers** (`doc/CSBwin-src/DSA.cpp`): `&CHAR@` with bit 16 is the
 *    champion in the wings, its own `load`, no pending damage; `&TALENTS@` reads their
 *    talents and `&TALENTS!` saves a change back; `&CHARNAME@` names them; `&WHEREISCHAR`
 *    is 5.
 *
 * Run: `npx tsx tools/dump-wings.ts`
 */
import { readU32LE } from '../src/core/bytes';
import { readCsbwinCharacter, writeCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { EDT_GLOBAL_TEXT } from '../src/data/DecodeText';
import { computeChampionFingerprint } from '../src/engine/AddCharacter';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import type { Champion } from '../src/engine/gameTypes';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { getFromWings, locateInWings, saveToWings } from '../src/engine/Wings';
import { attributeCurrent, attributeMaximum, attributeMinimum } from '../src/engine/attributes';
import { freshGame, globalStore, int, op, report, run } from './lib/dsa';
import { check, finish } from './lib/check';

/** `EDT_Character` (`doc/CSBwin-src/CSB.h:1571`). */
const EDT_CHARACTER = 8;
const key = (i: number, fp: number): number => ((EDT_CHARACTER << 24) | (i << 16) | fp) >>> 0;
/** A fingerprint nobody in `csbgame7.dat`'s party has. */
const FP = 0x0c45;

/** Champion `chIdx` of `game` as a `CHARDESC` in the file's form, with the fingerprint `fp`. */
function chardesc(game: Game, chIdx: number, fp: number): { bytes: Uint8Array; champion: Champion } {
  const champion: Champion = { ...game.ctx.party.state.champions[chIdx]!, fingerprint: fp };
  const bytes = new Uint8Array(CHARDESC_SIZE);
  writeCsbwinCharacter(bytes, 0, champion, { load: (c) => game.systems.characterStats.characterLoad(c) });
  return { bytes, champion };
}

const same = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.length === b.length && a.every((v, i) => v === b[i]);
const records = (game: Game, fp: number): string =>
  Array.from({ length: 8 }, (_, i) => game.ctx.dungeon.locateExpoolRecord(key(i, fp))?.length ?? '-').join(' ');

const base = freshGame();
console.log(`csbgame7.dat: ${base.ctx.party.state.champions.map((c) => `${c.name} ${c.fingerprint.toString(16)}`).join(', ')}`);
check(base.ctx.party.state.champions.every((c) => c.fingerprint !== FP), `nobody in the party has fingerprint ${FP.toString(16)}`);

/* ---------------------------------------------- 1. the record -------------------- */
{
  const game = freshGame();
  game.ctx.party.state.champions[1]!.talents = 0x12345678;
  game.ctx.party.state.champions[1]!.attributes.health = 300;
  const { bytes, champion } = chardesc(game, 1, FP);
  saveToWings(game.ctx.dungeon, bytes);
  const r = Array.from({ length: 8 }, (_, i) => game.ctx.dungeon.locateExpoolRecord(key(i, FP)) ?? []);
  console.log(`1. ${champion.name} saved to the wings: record lengths ${records(game, FP)}`);
  console.log(`   longword 0 ${r[0][0]?.toString(16)}, 13 ${r[0][13]?.toString(16)}, 69 ${r[2][19]?.toString(16)}`
    + ` (HP ${champion.attributes.health}, max ${champion.attributes.maxHealth}, talents ${champion.talents.toString(16)})`);
  check(r.every((rec) => rec.length === 25), 'eight records of 25 longwords');
  check((r[0][0]! & 0xff) === champion.name.charCodeAt(0) && ((r[0][0]! >>> 8) & 0xff) === champion.name.charCodeAt(1),
    "longword 0 is the name's first four letters, the first in the low byte");
  check(r[0][13] === ((champion.attributes.maxHealth << 16) | champion.attributes.health) >>> 0,
    'longword 13 is HP in the low word and the maximum in the high: swapCharacter ran');
  check(r[2][19] === champion.talents >>> 0, 'longword 69 is the talents, which swapCharacter leaves alone');
}

/* ---------------------------------------------- 2. the reads --------------------- */
{
  const game = freshGame();
  const pool = game.ctx.dungeon;
  const { bytes, champion } = chardesc(game, 1, FP);
  saveToWings(pool, bytes);
  check(same(getFromWings(pool, FP, true), bytes), 'GetFromWings, testing only, is the 800 bytes saved');
  check(records(game, FP) === '25 25 25 25 25 25 25 25', 'and the records stay');
  check(readCsbwinCharacter(getFromWings(pool, FP, true)!, 0).champion.name === champion.name, 'which read as the champion');
  check(getFromWings(pool, FP | 0x10000, true) !== null, "only the fingerprint's low word keys them");
  const name = locateInWings(pool, FP);
  check(name !== null && String.fromCharCode(...name.subarray(0, champion.name.length)) === champion.name,
    'LocateInWings is record 0, the name');

  saveToWings(pool, bytes);
  let count = 0;
  for (let i = 0; i < 8; i++) {
    while (pool.readExpoolRecord(key(i, FP)) !== null) count++;
  }
  check(count === 8, `a second SaveToWings replaces the first: ${count} records, one a key`);

  saveToWings(pool, bytes);
  check(same(getFromWings(pool, FP, false), bytes), 'GetFromWings, reading, is the 800 bytes');
  check(records(game, FP) === '- - - - - - - -', 'and takes the records out');

  saveToWings(pool, bytes);
  pool.readExpoolRecord(key(3, FP));
  check(getFromWings(pool, FP, true) === null, 'a record missing: nobody');
  check(records(game, FP) === '25 25 25 - 25 25 25 25', 'testing only leaves the others');
  check(getFromWings(pool, FP, false) === null && records(game, FP) === '- - - - 25 25 25 25',
    'reading takes out the records before the missing one');
  check(locateInWings(pool, FP) === null, 'LocateInWings without record 0: nobody');

  // Record 2, which holds `fingerPrint` at 280, of `FP + 1` under `FP`'s key.
  saveToWings(pool, chardesc(game, 2, FP + 1).bytes);
  saveToWings(pool, bytes);
  pool.readExpoolRecord(key(2, FP));
  pool.writeExpoolRecord(key(2, FP), pool.locateExpoolRecord(key(2, FP + 1))!);
  check(getFromWings(pool, FP, true) === null, "a record whose fingerPrint is not the key's: nobody");
}

/* ---------------------------------------------- 3. FingerprintExists ------------- */
{
  const game = freshGame();
  const party = game.ctx.party.state;
  const [level, x, y] = [FP >> 10, (FP >> 5) & 31, FP & 31];
  const before = computeChampionFingerprint(party.champions, game.ctx.dungeon, level, x, y);
  saveToWings(game.ctx.dungeon, chardesc(game, 1, FP).bytes);
  const after = computeChampionFingerprint(party.champions, game.ctx.dungeon, level, x, y);
  console.log(`3. AddCharacter's fingerprint at level ${level} (${x},${y}): ${before.toString(16)}, `
    + `then ${after.toString(16)} with ${FP.toString(16)} in the wings`);
  check(before === FP && after === FP + 1, "AddCharacter's fingerprint steps over one in the wings");
}

/* ---------------------------------------------- 4. a save carries them ----------- */
{
  const game = freshGame();
  const { bytes } = chardesc(game, 1, FP);
  saveToWings(game.ctx.dungeon, bytes);
  const next = freshGame();
  applyCsbwinSave(next, buildSaveFile(game));
  console.log(`4. saved and read back: record lengths ${records(next, FP)}`);
  check(same(getFromWings(next.ctx.dungeon, FP, true), bytes), 'the file read back holds the same 800 bytes');
}

/* ---------------------------------------------- 5. the DSA readers --------------- */
{
  let gone: Champion | null = null;
  let bytes: Uint8Array | null = null;
  const prepare = (game: Game): void => {
    const made = chardesc(game, 1, FP);
    // `d.PendingDamage` is not the wings', and the record's `load` is its own.
    game.ctx.party.state.pendingDamage[1] = 5;
    made.champion.load = 77;
    made.champion.talents = 0x8000000c;
    writeCsbwinCharacter(made.bytes, 0, made.champion);
    saveToWings(game.ctx.dungeon, made.bytes);
    gone = made.champion;
    bytes = made.bytes;
  };
  const wings = 0x10000 | FP;
  const { g, game } = run([
    ...int(wings), ...int(0), ...int(59), op(StkOp.CHAR_FETCH), ...report(0, 59),
    ...int(wings), op(StkOp.TALENTS_FETCH), globalStore(59),
    ...int(FP), op(StkOp.WHERE_IS_CHAR), globalStore(60),
    ...int(0x1234), ...int(wings), op(StkOp.TALENTS_STORE),
    ...int(wings), op(StkOp.TALENTS_FETCH), globalStore(61),
    ...int(0x1234), ...int(0x10000 | (FP + 1)), op(StkOp.TALENTS_STORE),
    ...int(0x10000 | (FP + 1)), op(StkOp.TALENTS_FETCH), globalStore(62),
  ], prepare);
  const pc = gone!;
  const expected = [
    pc.facing, pc.food, pc.attributes.health, 77, pc.attributes.mana, pc.wounds, pc.partyPosition,
    pc.shieldStrength, pc.attributes.stamina, pc.water,
    ...pc.attributes.stats.map((a) => (attributeMinimum(a) << 16) | (attributeMaximum(a) << 8) | attributeCurrent(a)),
    ...pc.skills.flatMap((s) => [s.tempAdjust, s.experience]),
    FP, pc.talents,
  ].map((v) => v | 0);
  console.log(`5. &CHAR@ 0x${wings.toString(16)}: ${g.slice(0, 10).join(' ')} … ${g.slice(57, 59).map((v) => (v >>> 0).toString(16)).join(' ')}`);
  console.log(`   &TALENTS@ ${(g[59]! >>> 0).toString(16)}, &WHEREISCHAR ${g[60]}, after &TALENTS! ${(g[61]! >>> 0).toString(16)}`);
  check(g.slice(0, 59).join() === expected.join(), "&CHAR@ with bit 16 is the champion in the wings, the record's load, no pending damage");
  check(g[59] === (0x8000000c | 0), '&TALENTS@ reads their talents');
  check(g[60] === 5, '&WHEREISCHAR is 5');
  check(g[61] === 0x1234 && readU32LE(getFromWings(game.ctx.dungeon, FP, true)!, 276) === 0x1234,
    '&TALENTS! saves the change back to the wings');
  const after = getFromWings(game.ctx.dungeon, FP, true)!;
  check(after.every((v, i) => (i >= 276 && i < 280) || v === bytes![i]), 'and nothing else of the record');
  check(g[62] === 0, '&TALENTS! and &TALENTS@ of nobody in the wings do nothing, and read 0');

  const named = run([
    ...int(FP), ...int(0), op(StkOp.CHAR_NAME_FETCH),
    ...int(0), ...int(0x10070), op(StkOp.GLOBAL_TEXT_STORE),
  ], prepare);
  const rec = named.game.ctx.dungeon.locateExpoolRecord(((EDT_GLOBAL_TEXT << 24) | 0x70) >>> 0);
  const text = rec ? String.fromCharCode(...rec.flatMap((w) => [0, 1, 2, 3].map((k) => (w >>> (8 * k)) & 0xff))).replace(/\0.*$/s, '') : '';
  console.log(`   &CHARNAME@ ${FP.toString(16)}: "${text}"`);
  check(text === pc.name, '&CHARNAME@ names the champion in the wings');
}

finish();
