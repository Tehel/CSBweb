/**
 * A monster's alternate graphics, the record `DrawMonster` draws a group from
 * (`src/data/AltMonGraphics.ts`, `doc/CSBwin-src/Code51a4.cpp:963-1112`).
 *
 * 1. **Every `CGT_AlternateMonsterGraphic` section reads as an `ALTMONGRAPH`**: 188 bytes
 *    of tables, then the graphics. The canary is the offsets: the graphics `DrawMonster`
 *    reaches (`:1377-1489`), front, then side, back and attack as `word4` has them, each
 *    `ITEM12`'s size of its view, lie end to end from offset 0 and inside the section.
 *    A table read a byte off, or big-endian, breaks that at once. Three sections hold a
 *    picture more, past the views `word4` names.
 * 2. **`AltGraphicMapping`** (`:1060-1069`) reads Conflux's `EDBT_AltMonGraphics`
 *    records, keyed by level and type; -1 without one, or with a record of other than
 *    four longwords; and a graphic of 4 to 7 reads on past the record into the pool.
 * 3. **`GetAlternateGraphicsRecord`** (`:1071-1110`): graphic 0 is the type's own unless
 *    the level maps it, `3 * mt + n - 1` unless the level maps one, -2 is none, and the
 *    cache reads a section once. A slot that found nothing keeps answering `NULL`, for
 *    another section too, until `CleanupAltMonCache`. Graphics 4 to 7 share the next
 *    type's slots.
 * 4. **Every group of Conflux's dungeon** with an alternate graphic finds it on its level.
 *
 * Run: `npx tsx tools/dump-alt-mon-graphics.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { ALTMONGRAPH_GRAPHIC, AltGraphicMapping, AltMonCache, NUM_DERIVED_GRAPHIC, readAltMonGraph, type AltMonGraph } from '../src/data/AltMonGraphics';
import { CSBGraphicType, CSBGraphicsLoader } from '../src/data/CSBGraphicsLoader';
import { altMonGraphicsKey, Expool, type ExpoolDatabase } from '../src/data/CsbwinExpool';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import { monsterHasAttackGraphic, monsterHasBackGraphic, monsterHasSideGraphic } from '../src/data/tables/MonsterDesc';
import { DungeonState } from '../src/engine/DungeonState';
import { check, finish } from './lib/check';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8';
/** The two `CSBgraphics.dat` here, with how many alternate monster graphics each holds. */
const FILES: [string, number][] = [
  [`${CONFLUX}/CSBgraphics.dat`, 123],
  ['static/gamefiles/dm-atari/CSBgraphics.dat', 123],
];

function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

function loadCsbGraphics(path: string): CSBGraphicsLoader {
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve(path))));
  return loader;
}

/** A `CSBgraphics.dat` that remembers each section it is asked for. */
function spy(loader: CSBGraphicsLoader): { reads: number[]; readSection: CSBGraphicsLoader['readSection'] } {
  const reads: number[] = [];
  return {
    reads,
    readSection: (type, id, minimumSize) => {
      if (type === CSBGraphicType.AlternateMonsterGraphic) reads.push(id);
      return loader.readSection(type, id, minimumSize);
    },
  };
}

/**
 * The graphics `DrawMonster` reaches, in `graphicNum0`'s order, with the bytes of each: a
 * line of `width = 2 * byteWidth` pixels is `(width + 15) / 16 * 8` bytes, as CSBWin's
 * own bitmaps (`AllocateAlternateDerivedGraphic`, `Code51a4.cpp:1055`).
 */
function reachedGraphics(g: AltMonGraph): { view: string; bytes: number }[] {
  const bytes = (byteWidth: number, height: number): number => Math.floor((2 * byteWidth + 15) / 16) * 8 * height;
  const { item12: i12, monsterDesc: md } = g;
  const out = [{ view: 'front', bytes: bytes(i12.frontRearByteWidth, i12.frontRearHeight) }];
  if (monsterHasSideGraphic(md)) out.push({ view: 'side', bytes: bytes(i12.sideByteWidth, i12.sideHeight) });
  if (monsterHasBackGraphic(md)) out.push({ view: 'back', bytes: bytes(i12.frontRearByteWidth, i12.frontRearHeight) });
  if (monsterHasAttackGraphic(md)) out.push({ view: 'attack', bytes: bytes(i12.attackByteWidth, i12.attackHeight) });
  return out;
}

function sections(): void {
  console.log('=== every section reads as an ALTMONGRAPH ===');
  for (const [path, count] of FILES) {
    const loader = loadCsbGraphics(path);
    const ids: number[] = [];
    for (let id = 0; id < 256; id++) if (loader.readSection(CSBGraphicType.AlternateMonsterGraphic, id, 0)) ids.push(id);
    check(ids.length === count, `${path}: ${count} sections (${ids.length})`);
    let exact = 0;
    const spare: string[] = [];
    for (const id of ids) {
      const read = readAltMonGraph(loader, id);
      if (!read) { check(false, `${path}: section ${id} reads`); continue; }
      const g = read.graphic;
      check(read.size === ALTMONGRAPH_GRAPHIC + g.graphic.length && g.graphicOffsets.length === NUM_DERIVED_GRAPHIC, `section ${id}: 188 bytes of tables`);
      const reached = reachedGraphics(g);
      let at = 0;
      reached.forEach(({ view, bytes }, i) => {
        check(g.graphicOffsets[i] === at, `${path} section ${id}: the ${view} view at ${at} (${g.graphicOffsets[i]})`);
        at += bytes;
      });
      check(at <= g.graphic.length, `${path} section ${id}: its graphics fit (${at} of ${g.graphic.length})`);
      if (at === g.graphic.length) {
        exact++;
      } else {
        // What follows is a picture of its own, which `word4` does not name.
        check(g.graphicOffsets[reached.length] === at, `${path} section ${id}: a graphic past its views, at ${at}`);
        spare.push(`${id} (${g.graphic.length - at} bytes)`);
      }
    }
    console.log(`  ${path}: ${ids.length} sections, ${exact} ending at their last view; past it: ${spare.join(', ')}`);
    // With `word4` read big-endian, no view but the front would be named, and only the
    // three statues, which have no other, would end there.
    check(exact === count - 3, `${path}: all but three sections end at their last view`);
  }
}

function confluxDungeon(): DungeonData {
  return quiet(() => new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(`${CONFLUX}/dungeon.dat`)))));
}

/** A pool of one record of `record`'s longwords for type `mt` on `level`. */
function poolWith(level: number, mt: number, record: number[]): ExpoolDatabase {
  const db: ExpoolDatabase = { header: { objectCounts: new Array(16).fill(0) } };
  new Expool(db).write(altMonGraphicsKey(level, mt), record);
  return db;
}

function mapping(conflux: DungeonData): void {
  console.log('=== AltGraphicMapping ===');
  const m = (level: number, mt: number): number[] => [0, 1, 2, 3].map((n) => AltGraphicMapping(conflux, level, mt, n));
  console.log(`  Conflux: level 21 type 9 ${m(21, 9).join(',')}; level 14 type 2 ${m(14, 2).join(',')}; level 1 type 9 ${m(1, 9).join(',')}`);
  check(m(21, 9).join() === '100,101,102,103', 'level 21 maps all four of type 9, graphic 0 included');
  check(m(14, 2).join() === '-1,-1,118,119', 'level 14 maps graphics 2 and 3 of type 2');
  check(m(1, 9).join() === '-1,-1,-1,-1', 'a level without a record maps none');
  check(AltGraphicMapping(poolWith(0, 4, [7, 8, 9]), 0, 4, 0) === -1, 'a record of three longwords maps none');
  check(AltGraphicMapping(poolWith(0, 4, [7, 8, 9, -2 >>> 0]), 0, 4, 3) === -2, 'a longword of 0xfffffffe is -2');
  // `Write` takes the block's first record, at 65, and leaves the next, at 71, at the
  // head of the free list: its link to 77 is the fourth longword past the record's data.
  check(AltGraphicMapping(poolWith(0, 4, [7, 8, 9, 10]), 0, 4, 4) === 77, 'graphic 4 reads past the record, into the pool');
}

function cache(conflux: DungeonData, loader: CSBGraphicsLoader): void {
  console.log('=== GetAlternateGraphicsRecord ===');
  const file = spy(loader);
  const altMonCache = new AltMonCache();
  const get = (level: number, creatureType: number, alternateGraphics: number, db: ExpoolDatabase = conflux): AltMonGraph | null =>
    altMonCache.GetAlternateGraphicsRecord(file, db, level, { creatureType, alternateGraphics });
  const reads = (): string => file.reads.splice(0).join(',');

  check(get(1, 9, 0) === null && reads() === '', 'graphic 0, unmapped: the type\'s own, nothing read');
  const g27 = get(1, 9, 1);
  check(g27 !== null && reads() === '27', 'graphic 1 of type 9, unmapped: section 3 * 9 + 0');
  check(get(1, 9, 1) === g27 && reads() === '', 'a second time from the cache');
  check(get(21, 9, 0) !== null && reads() === '100', 'graphic 0 of type 9 on level 21, mapped: section 100');
  check(get(18, 17, 3) !== null && reads() === '88', 'graphic 3 of type 17 on level 18, mapped: section 88');
  check(get(1, 17, 3) !== null && reads() === '53', 'the same graphic on level 1: the slot is cleared, section 53 read');
  check(get(0, 4, 3, poolWith(0, 4, [-1, -1, -1, -2].map((v) => v >>> 0))) === null && reads() === '', '-2: none, nothing read');

  // Section 65 is not in the file: type 21's graphic 3, unmapped.
  check(get(1, 21, 3) === null && reads() === '65', 'graphic 3 of type 21, unmapped: section 65, missing');
  check(get(19, 21, 3) === null && reads() === '', 'on level 19, which maps it to 93: the slot still says none, nothing read');
  altMonCache.CleanupAltMonCache();
  check(get(19, 21, 3) !== null && reads() === '93', 'after CleanupAltMonCache: section 93');

  // Graphic 5 of type 5 is slot 25, graphic 1 of type 6's.
  get(1, 5, 5);
  get(1, 6, 1);
  get(1, 5, 5);
  const shared = reads();
  console.log(`  graphic 5 of type 5, graphic 1 of type 6, graphic 5 of type 5: sections ${shared}`);
  check(shared === '19,18,19', 'graphics 4 to 7 share the next type\'s slots');
}

function census(conflux: DungeonData, loader: CSBGraphicsLoader): void {
  console.log('=== Conflux\'s groups ===');
  const dungeon = new DungeonState(conflux);
  let groups = 0;
  let alternate = 0;
  let found = 0;
  const missing: string[] = [];
  for (let level = 0; level < conflux.maps.length; level++) {
    const { width, height } = conflux.maps[level]!.descriptor;
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const seen = new Set<number>();
      for (let rn: ObjectID = dungeon.findFirstObject(new Position(x, y, level)); rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && !seen.has(rn); rn = dungeon.getDBRecordLink(rn)) {
        seen.add(rn);
        if (dungeon.rnMaps.dbType(rn) !== DBType.CREATURE) continue;
        const group = dungeon.getCreatureRecord(rn)!;
        groups++;
        // A fresh cache for each, so that no slot's earlier search answers for it.
        const graphic = new AltMonCache().GetAlternateGraphicsRecord(loader, conflux, level, group);
        const mapped = AltGraphicMapping(conflux, level, group.creatureType, group.alternateGraphics) >= 0;
        if (group.alternateGraphics === 0 && !mapped) {
          check(graphic === null, `level ${level} (${x},${y}): graphic 0, unmapped, is the type's own`);
          continue;
        }
        alternate++;
        if (graphic) found++;
        else missing.push(`level ${level} (${x},${y}) type ${group.creatureType} graphic ${group.alternateGraphics}`);
      }
    }
  }
  console.log(`  ${groups} groups, ${alternate} with an alternate graphic, ${found} found; missing: ${missing.join('; ') || 'none'}`);
  check(alternate > 0 && found === alternate, 'every alternate graphic Conflux\'s groups name is in its CSBgraphics.dat');
}

function main(): void {
  sections();
  const conflux = confluxDungeon();
  const loader = loadCsbGraphics(`${CONFLUX}/CSBgraphics.dat`);
  mapping(conflux);
  cache(conflux, loader);
  census(conflux, loader);
  finish();
}

main();
