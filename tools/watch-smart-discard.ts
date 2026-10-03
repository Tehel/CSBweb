/**
 * `SmartDiscard` (`doc/CSBwin-src/SmartDiscard.cpp`): a database of loose objects three
 * quarters full has its least useful objects thrown away, one per tick.
 *
 *  1. Every game read and the tail of a save start the cycle over on the misc database
 *     (`:747-757`), and each tick of the loop does one step (`CSBCode.cpp:678`). The
 *     retail dungeon's databases are nowhere near 6000 records (`db.Max` 8000 × 3/4,
 *     `CSB.h:1646`, `SmartDiscard.cpp:14`), so the cycle only counts: weapons, clothing,
 *     misc, weapons, fifty records a step (`:762-850`).
 *  2. `ScanOneCell`'s priority (`:454-603`): 20 plus the level difference off the
 *     party's level, the square distance on it; the Nth object of a type on a corner
 *     adds N, and past twenty adds N-20 more (ten times that for clothing). An important
 *     object is never listed; behind an object-triggered actuator, neither is the first
 *     of each type on each corner.
 *  3. `dungeon.dat` sets `important()` on every object it places but three floor weapons,
 *     so what gets discarded is what play creates. Six rocks made on four levels, and
 *     the misc database padded to 6003 records in use — the port's databases stop at
 *     1024, so the padding is records no object names: the scan lists the six, then four
 *     discards bring the count under 6000, highest priority first, each lifted out of
 *     its cell and its record freed.
 *
 * Run: `npx tsx tools/watch-smart-discard.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { MiscRecord } from '../src/data/dungeonTypes';
import type { Game } from '../src/engine/Game';
import { SDObjList, scanOneCell, smartDiscard, SmartDiscardMode, type SDObj } from '../src/engine/SmartDiscard';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

const MODE_NAMES = ['NotActive', 'NewDB', 'Count', 'Scan', 'Discard'];
const DB_NAMES: Record<number, string> = { [DBType.WEAPON]: 'weapons', [DBType.CLOTHING]: 'clothing', [DBType.MISC]: 'misc' };

function makeGame(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  return newGame(data, stockGraphics());
}

/** Every candidate `ScanOneCell` lists across the dungeon, for the current database. */
function allCandidates(game: Game): { object: ObjectID; priority: number }[] {
  const ctx = game.ctx;
  const s = ctx.smartDiscard;
  const saved = { l: s.currentLevel, x: s.currentX, y: s.currentY };
  const found: { object: ObjectID; priority: number }[] = [];
  for (let l = 0; l < ctx.dungeon.getMapCount(); l++) {
    const size = ctx.dungeon.getMapDimensions(l)!;
    for (let x = 0; x < size.width; x++) {
      for (let y = 0; y < size.height; y++) {
        const list = new SDObjList();
        s.currentLevel = l; s.currentX = x; s.currentY = y;
        scanOneCell(ctx, s, list);
        for (let i = 0; i < list.numEntry; i++) found.push({ object: list.sdobj[i].object, priority: list.sdobj[i].priority });
      }
    }
  }
  s.currentLevel = saved.l; s.currentX = saved.x; s.currentY = saved.y;
  return found;
}

function chainHas(game: Game, at: Position, rn: ObjectID): boolean {
  for (let o = game.ctx.dungeon.findFirstObject(at); o !== OBJECT_ID_EOF; o = game.ctx.dungeon.getDBRecordLink(o)) {
    if ((o & 0x3fff) === (rn & 0x3fff)) return true;
  }
  return false;
}

/* ------------------------------------ 1. the retail dungeon only counts ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const s = ctx.smartDiscard;
  check(s.currentMode === SmartDiscardMode.NotActive, 'a Game that no read has gone through: not active');
  game.applyRuntimeSaveState(game.getRuntimeSaveState());
  check(s.currentMode === SmartDiscardMode.NewDB && s.currentDBNum === DBType.MISC,
    'a game read starts the cycle over: NewDB, current database misc');
  (game as unknown as { gameTick(): void }).gameTick();
  check(s.currentMode === SmartDiscardMode.Count && s.currentDBNum === DBType.WEAPON,
    'one game tick: the next database, weapons, is being counted');

  const visits: string[] = [];
  let steps = 1;
  let scanned = false;
  let prev = `${s.currentMode}/${s.currentDBNum}`;
  while (visits.length < 4 && steps < 1000) {
    smartDiscard(ctx, false);
    steps++;
    if (s.currentMode === SmartDiscardMode.Scan || s.currentMode === SmartDiscardMode.Discard) scanned = true;
    const now = `${s.currentMode}/${s.currentDBNum}`;
    if (now !== prev && s.currentMode === SmartDiscardMode.NewDB) {
      visits.push(`${DB_NAMES[s.currentDBNum]} ${s.totalCount}`);
    }
    prev = now;
  }
  console.log(`1. counted, one per NewDB: ${visits.join(', ')} (${steps} steps)`);
  const live = (records: { nextObject: ObjectID }[]): number => records.filter((r) => r.nextObject !== OBJECT_ID_NULL).length;
  const dbs = ctx.dungeon.getData().databases;
  check(visits.join() === [`weapons ${live(dbs.weapons.records)}`, `clothing ${live(dbs.clothing.records)}`,
    `misc ${live(dbs.misc.records)}`, `weapons ${live(dbs.weapons.records)}`].join(),
  'weapons, clothing, misc, weapons: each counts its records in use, links not RNnul');
  check(!scanned, 'no database reaches 6000, so nothing is scanned');
  smartDiscard(ctx, false);
  const beforeSave = s.currentMode;
  game.saveWritten();
  check(beforeSave !== SmartDiscardMode.NewDB && s.currentMode === SmartDiscardMode.NewDB && s.currentDBNum === DBType.MISC,
    "the save's tail starts the cycle over");
}

/* --------------------------------------------- 2. ScanOneCell's priority ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const s = ctx.smartDiscard;
  const party = ctx.party.state.position;
  const newMisc = (type: number, important = false): ObjectID => {
    const rec: MiscRecord = { nextObject: OBJECT_ID_EOF, specialState: 0, important, miscType: type };
    return dungeon.rnMaps.rn(DBType.MISC, dungeon.findEmptyDBEntry('misc', rec)!);
  };
  const scan = (at: Position): { index: number; priority: number }[] => {
    const list = new SDObjList();
    s.currentDBNum = DBType.MISC;
    s.currentLevel = at.z; s.currentX = at.x; s.currentY = at.y;
    scanOneCell(ctx, s, list);
    const out: { index: number; priority: number }[] = [];
    while (list.numEntry > 0) {
      const o: { sd?: SDObj } = {};
      list.deleteObjectIncr(o);
      out.push({ index: game.ctx.dungeon.rnMaps.idx(o.sd!.object), priority: o.sd!.priority });
    }
    return out;
  };

  // An empty cell two levels below the party's.
  const level = (party.z | 0) + 2;
  let empty: Position | null = null;
  const size = dungeon.getMapDimensions(level)!;
  for (let x = 0; x < size.width && !empty; x++) {
    for (let y = 0; y < size.height && !empty; y++) {
      const at = new Position(x, y, level);
      if (dungeon.findFirstObject(at) === OBJECT_ID_EOF) empty = at;
    }
  }
  const pile: ObjectID[] = [];
  for (let i = 0; i < 22; i++) pile.push(newMisc(10));
  const important = newMisc(10, true);
  for (const o of pile.slice(0, 11)) dungeon.addObjectToCell(empty!, o);
  dungeon.addObjectToCell(empty!, important);
  for (const o of pile.slice(11)) dungeon.addObjectToCell(empty!, o);
  const got = scan(empty!);
  // The Nth of the type, the important one included, adds N, and past 20, N-20 more.
  const expected = pile.map((o, i) => {
    const n = i < 11 ? i + 1 : i + 2;
    return { index: game.ctx.dungeon.rnMaps.idx(o), priority: 22 + n + Math.max(0, n - 20) };
  });
  console.log(`2. 22 of a type and an important one, 2 levels off: ${got.map((g) => g.priority).join(' ')}`);
  check(JSON.stringify(got) === JSON.stringify(expected),
    '22 + N, and N-20 more past twenty; the important one counts in the pile but is not listed');

  // An object-triggered actuator ahead of the objects: the first of each type per corner stays.
  let pad: Position | null = null;
  for (let l = 0; l < dungeon.getMapCount() && !pad; l++) {
    if (l === (party.z | 0)) continue;
    const dim = dungeon.getMapDimensions(l)!;
    for (let x = 0; x < dim.width && !pad; x++) {
      for (let y = 0; y < dim.height && !pad; y++) {
        const at = new Position(x, y, l);
        const first = dungeon.findFirstObject(at);
        if (first === OBJECT_ID_EOF || game.ctx.dungeon.rnMaps.dbType(first) !== DBType.ACTUATOR) continue;
        const t = getActuatorType(dungeon.getActuatorRecord(first)!);
        if (t >= 1 && t <= 9 && scan(at).length === 0) pad = at;
      }
    }
  }
  const a1 = newMisc(10); const a2 = newMisc(10); const b1 = newMisc(11);
  const b1Corner = game.ctx.dungeon.rnMaps.setPos(game.ctx.dungeon.rnMaps.rn(DBType.MISC, game.ctx.dungeon.rnMaps.idx(b1)), 1);
  const a3Corner = game.ctx.dungeon.rnMaps.setPos(game.ctx.dungeon.rnMaps.rn(DBType.MISC, game.ctx.dungeon.rnMaps.idx(newMisc(10))), 1);
  for (const o of [a1, a2, b1Corner, a3Corner]) dungeon.addObjectToCell(pad!, o);
  const onPad = scan(pad!).map((g) => g.index);
  console.log(`   on an actuator at ${pad!.z}:${pad!.x},${pad!.y}: listed ${onPad.join(', ')} of ${[a1, a2, b1Corner, a3Corner].map((o) => game.ctx.dungeon.rnMaps.idx(o)).join(', ')}`);
  check(onPad.length === 1 && onPad[0] === game.ctx.dungeon.rnMaps.idx(a2),
    'behind a pressure pad only the second of a type on a corner is listed');
}

/* ------------------------------------------ 3. a full database is thinned ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const s = ctx.smartDiscard;
  const misc = dungeon.getData().databases.misc;
  const party = ctx.party.state.position;
  const emptyCell = (level: number): Position => {
    const size = dungeon.getMapDimensions(level)!;
    for (let x = 0; x < size.width; x++) {
      for (let y = 0; y < size.height; y++) {
        const at = new Position(x, y, level);
        if (dungeon.findFirstObject(at) === OBJECT_ID_EOF) return at;
      }
    }
    throw new Error(`no empty cell on level ${level}`);
  };
  const rocks = (at: Position, n: number): ObjectID[] => Array.from({ length: n }, () => {
    const rec: MiscRecord = { nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType: 10 };
    const rn = dungeon.rnMaps.rn(DBType.MISC, dungeon.findEmptyDBEntry('misc', rec)!);
    dungeon.addObjectToCell(at, rn);
    return rn;
  });
  const z = party.z | 0;
  const [far1, far2] = rocks(emptyCell(z + 5), 2); // 25 + 1, 25 + 2
  const [mid] = rocks(emptyCell(z + 3), 1); //         23 + 1
  const [near1, near2] = rocks(emptyCell(z + 1), 2); // 21 + 1, 21 + 2
  rocks(emptyCell(z), 1); //                            the square distance + 1
  const expected = [far2, far1, mid, near2];

  const inUse = misc.records.filter((r) => r.nextObject !== OBJECT_ID_NULL).length;
  for (let i = inUse; i < 6003; i++) misc.records.push({ nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType: 0 });

  const lifted: { object: ObjectID; at: Position }[] = [];
  const moveObject = ctx.systems.worldMove.moveObject.bind(ctx.systems.worldMove);
  ctx.systems.worldMove.moveObject = (object, oldX, oldY, newX, newY, level) => {
    if (newX < 0) lifted.push({ object, at: new Position(oldX, oldY, level) });
    return moveObject(object, oldX, oldY, newX, newY, level);
  };

  smartDiscard(ctx, true);
  // Weapons and clothing are counted and left; misc reaches Scan.
  let steps = 0;
  while (s.currentMode !== SmartDiscardMode.Scan && steps < 1000) { smartDiscard(ctx, false); steps++; }
  check(s.currentMode === SmartDiscardMode.Scan && s.currentDBNum === DBType.MISC && s.totalCount === 6003,
    `misc counts 6003 in use and switches to Scan (${MODE_NAMES[s.currentMode]}, ${s.totalCount})`);
  const before = allCandidates(game);
  let scanSteps = 0;
  while (s.currentMode === SmartDiscardMode.Scan && scanSteps < 100000) { smartDiscard(ctx, false); scanSteps++; }
  console.log(`3. the scan lists ${s.objlist.numEntry} in ${scanSteps} steps: priorities ${before.map((c) => c.priority).sort((a, b) => b - a).join(' ')}`);
  check(s.currentMode === SmartDiscardMode.Discard && s.objlist.numEntry === 6 && before.length === 6,
    'the scan ends in Discard, listing the six rocks and nothing dungeon.dat placed');
  let discardSteps = 0;
  while (s.currentMode === SmartDiscardMode.Discard && discardSteps < 100) { smartDiscard(ctx, false); discardSteps++; }
  const index = (rn: ObjectID): number => game.ctx.dungeon.rnMaps.idx(rn);
  console.log(`   discarded ${lifted.map((l) => `misc ${index(l.object)} at ${l.at.z}:${l.at.x},${l.at.y}`).join(', ')}`);
  check(lifted.length === 4 && s.totalCount === 5999 && s.currentMode === SmartDiscardMode.NewDB,
    'four discards bring the count to 5999, and the cycle moves on');
  check(lifted.map((l) => index(l.object)).join() === expected.map(index).join(),
    'highest priority first: the two five levels off (the second of the pile first), then three off, then the second one level off');
  check(lifted.every((l) => !chainHas(game, l.at, l.object) && misc.records[index(l.object)].nextObject === OBJECT_ID_NULL),
    'each is out of its cell, its record freed');
  check(misc.records[index(near1)].nextObject !== OBJECT_ID_NULL, 'the first one level off is kept');
}

finish();
