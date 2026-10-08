/**
 * `EXPOOL`, database 11: `Setup`, `Write`, `Read`, `Locate` and `enlarge`
 * (`src/data/CsbwinExpool.ts`) against the pools CSBWin itself wrote.
 *
 * Nothing shows a pool on screen, and a wrong one fails quietly: a record is simply not
 * found. The genuine saves give the port something exact to be compared with, because
 * `SaveGame` leaves 24 palette records in every file, each `Read` out and `Write`n back
 * (`doc/CSBwin-src/SaveGame.cpp:1218-1231`):
 *
 *   - **Built from nothing.** A save of a game started on `dungeon.dat`, where nothing
 *     else wrote a record, holds a pool that is those 24 `Write`s and no more. The same
 *     24 into an empty pool must give CSBWin's bytes, all 2304 of them: the directory
 *     block, the eight blocks `enlarge` cuts into three records each, every link and
 *     every hash chain.
 *   - **Saved again.** CSBWin's loop run over a pool it has already been run over is a
 *     fixed point, so every save's pool must come out of it unchanged, whatever else the
 *     pool holds. That is `Read` handing the record's longwords back to the free list
 *     `Write` takes them from.
 *
 * Then the champion bones records, which are the ones play writes: one longword under
 * the bones' RN, and two records under one key.
 *
 * Run: `npx tsx tools/dump-expool.ts`
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { readU32BE } from '../src/core/bytes';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { EXPOOL_RECORD_SIZE, Expool, type ExpoolDatabase } from '../src/data/CsbwinExpool';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';
import { stockDungeon } from './lib/game';

/** `EDT_Palette` (`doc/CSBwin-src/CSB.h:1567`). */
const EDT_PALETTE = 7;

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function emptyPool(): ExpoolDatabase {
  return { header: { objectCounts: new Array<number>(16).fill(0) } };
}

function copyOf(bytes: Uint8Array): ExpoolDatabase {
  const db = emptyPool();
  db.expool = bytes.slice();
  db.header.objectCounts[11] = bytes.length / EXPOOL_RECORD_SIZE;
  return db;
}

/** Each block's `size`, the directory's 0 first. */
function blockSizes(bytes: Uint8Array): number[] {
  const sizes: number[] = [];
  for (let at = 0; at < bytes.length; at += EXPOOL_RECORD_SIZE) sizes.push(readU32BE(bytes, at) & 0xffff);
  return sizes;
}

/** How many records each `EXPOOL_DATA_TYPE` has, as `type:count`. */
function countByType(keys: number[]): string {
  const counts = new Map<number, number>();
  for (const key of keys) counts.set(key >>> 24, (counts.get(key >>> 24) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([type, n]) => `${type}:${n}`).join(' ') || '-';
}

/** The directory's free lists that are not empty, as `length:head`. */
function freeLists(bytes: Uint8Array): string {
  const heads: string[] = [];
  for (let size = 2; size < 32 && bytes.length > 0; size++) {
    const head = readU32BE(bytes, size * 4);
    if (head !== 0) heads.push(`${size}:${head}`);
  }
  return heads.join(' ') || '-';
}

function main(): void {
  /* ------------------------------------------ 1. CSBWin's own pools -------------- */

  console.log('=== the pools of the genuine saves ===');
  console.log(['save', 'blocks', 'block sizes', 'records by type', 'free lists', 'rebuilt', 'saved again'].join('\t'));
  let rebuilt = 0;
  let resaved = 0;
  for (const path of genuineSaves()) {
    const file = basename(path);
    const { dungeon } = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
    const bytes = dungeon.expool ?? new Uint8Array(0);
    const keys = new Expool(copyOf(bytes)).keys();
    const sizes = blockSizes(bytes);

    // Every record is found from its key, and is as long as its block says.
    const pool = new Expool(copyOf(bytes));
    const lengths = new Set(sizes.slice(1).map((size) => size - 2));
    check(keys.every((key) => { const r = pool.locate(key); return r !== null && lengths.has(r.length); }),
      `${file}: every key of the pool locates a record of one of its blocks' lengths`);

    const palette = keys.filter((key) => key >>> 24 === EDT_PALETTE);
    let rebuiltVerdict = '-';
    let resavedVerdict = '-';
    if (palette.length === 24) {
      const records = Array.from({ length: 24 }, (_, i) => pool.locate(((EDT_PALETTE << 24) + i) >>> 0));
      check(records.every((r) => r !== null && r.length === 16), `${file}: 24 palette records of 16 longwords`);

      // CSBWin's loop, over CSBWin's pool.
      const again = copyOf(bytes);
      const againPool = new Expool(again);
      records.forEach((record, i) => {
        const key = ((EDT_PALETTE << 24) + i) >>> 0;
        againPool.read(key);
        againPool.write(key, record ?? []);
      });
      const fixed = same(again.expool ?? new Uint8Array(0), bytes);
      check(fixed, `${file}: the save's palette loop leaves the pool as CSBWin left it`);
      resavedVerdict = fixed ? 'same bytes' : 'DIFFERS';
      resaved++;

      // And over nothing, where the 24 records are all the pool holds.
      if (keys.length === 24) {
        const fresh = emptyPool();
        const freshPool = new Expool(fresh);
        records.forEach((record, i) => freshPool.write(((EDT_PALETTE << 24) + i) >>> 0, record ?? []));
        const identical = same(fresh.expool ?? new Uint8Array(0), bytes);
        check(identical, `${file}: 24 writes into an empty pool give CSBWin's ${bytes.length} bytes`);
        check(fresh.header.objectCounts[11] === sizes.length, `${file}: and its ${sizes.length} blocks in the header`);
        rebuiltVerdict = identical ? 'same bytes' : 'DIFFERS';
        rebuilt++;
      }
    }
    console.log([file, sizes.length, sizes.join(','), countByType(keys), freeLists(bytes), rebuiltVerdict, resavedVerdict].join('\t'));
  }
  check(rebuilt >= 5, `at least five pools are the palette records alone (${rebuilt})`);
  check(resaved >= 8, `and at least eight carry them (${resaved})`);

  /* ------------------------------------------ 2. the bones records --------------- */

  console.log('');
  console.log('=== champion bones records, in a world dungeon.dat made ===');
  {
    const data = stockDungeon();
    check(data.expool === undefined && data.header.objectCounts[11] === 0, 'dungeon.dat has no EXPOOL block');

    const pool = new Expool(data);
    const row = (what: string): void => {
      const bytes = data.expool ?? new Uint8Array(0);
      console.log([what, data.header.objectCounts[11], blockSizes(bytes).join(','), countByType(pool.keys()), freeLists(bytes)].join('\t'));
    };
    console.log(['after', 'blocks', 'block sizes', 'records by type', 'free lists'].join('\t'));
    row('nothing');
    check(pool.copyChampionBonesRecord(0x2805) === null, 'a pool with no block has no record');
    check(pool.getChampionBonesRecord(0x2805) === null, 'to copy or to take');
    check(data.expool === undefined, 'and looking makes no block');

    pool.addChampionBonesRecord(0x2805, 0x1234);
    row('one record');
    check(blockSizes(data.expool ?? new Uint8Array(0)).join(',') === '0,3',
      'the first record makes the directory and a block of three-longword records');
    check(data.header.objectCounts[11] === 2, 'which the header counts');
    check(pool.copyChampionBonesRecord(0x2805) === 0x1234, 'the record is found under the bones');
    check(pool.copyChampionBonesRecord(0x2806) === null, 'and under no other object');
    check(pool.copyChampionBonesRecord(0x2805) === 0x1234, 'a copy leaves it there');

    // Two records under one key: the bones' record number given to a second death
    // while the first's record was never taken.
    pool.addChampionBonesRecord(0x2805, 0x5678);
    pool.addChampionBonesRecord(0x2806, 0x9abc);
    row('three records');
    check(pool.copyChampionBonesRecord(0x2805) === 0x5678, 'a second record under the key is the one found');
    check(pool.getChampionBonesRecord(0x2805) === 0x5678, 'and the one taken');
    check(pool.getChampionBonesRecord(0x2805) === 0x1234, 'which leaves the first');
    check(pool.getChampionBonesRecord(0x2805) === null, 'and then none');
    check(pool.copyChampionBonesRecord(0x2806) === 0x9abc, "the other object's is untouched");
    row('one record');

    // 21 records to a block of 64 longwords: the 22nd makes another.
    for (let i = 0; i < 21; i++) pool.addChampionBonesRecord(0x2900 + i, i);
    row('22 records');
    check(data.header.objectCounts[11] === 3, 'the 22nd record makes a second block of them');
    check(Array.from({ length: 21 }, (_, i) => pool.copyChampionBonesRecord(0x2900 + i)).every((v, i) => v === i),
      'and all of them are found');
  }

  finish();
}

main();
