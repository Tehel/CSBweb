/**
 * `MakeMoreRoomInDB` (`doc/CSBwin-src/Character.cpp:182-358`): a new object in a full
 * database takes the record of one thrown out of the dungeon. A database is full at
 * `db.Max` records (`CSB.h:1646`), so each section pads one to that with records no
 * object names, then asks `findEmptyDBEntry` for one more.
 *
 *  0. Short of `db.Max`, a database with no free record `Enlarge`s instead
 *     (`data.cpp:813-876`): 100 cleared records, link `RNnul` but the first's `RNeof`,
 *     the header's size with them, and the new object at the old size, past record 1023
 *     as well. The next new object takes the next cleared record. At `db.Max`, 8000
 *     records, it grows no more.
 *  1. The sweep starts at `d.LevelCleared[db]`, stepping past the party's level, and takes
 *     the first object of the database that is not `important()`, stopping each square's
 *     chain at an actuator that is not disabled. The item is lifted out of its square,
 *     and the new record is stored over it at the same index. The next sweep starts on
 *     the level the last one took from.
 *  2. The party's level comes last, and there the 11×11 squares around the party are
 *     spared. With nothing left, the record is refused and `LevelCleared` is the party's
 *     level.
 *  3. A monster group is deleted and drops what it carries. `dungeon.dat` plants every
 *     group important, so only a spawned one can go. `DeleteDBEntry` frees the group's
 *     slot with its record, so the new object takes the record under the lowest free
 *     slot (`DEBT.md` H).
 *  4. A missile's timer goes, and its object falls where it flew; its record is taken
 *     as a group's is.
 *  5. The cloud database is never made room in.
 *
 * Run: `npx tsx tools/dump-make-more-room.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, getRoomType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Databases, MiscRecord } from '../src/data/dungeonTypes';
import { dbMax } from '../src/engine/DungeonState';
import type { Game } from '../src/engine/Game';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

function makeGame(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  return newGame(data, stockGraphics());
}

const DB_TYPE: Partial<Record<keyof Databases, DBType>> = {
  misc: DBType.MISC, creatures: DBType.CREATURE, missiles: DBType.MISSILE, clouds: DBType.CLOUD,
};

/**
 * Fill database `db` to `db.Max` records with in-use records no object names: its free
 * records, the cleared ones an `Enlarge` left among them, then new ones to the end.
 */
function fill(game: Game, db: keyof Databases, blank: () => object): void {
  const data = game.ctx.dungeon.getData();
  const records = data.databases[db].records as { nextObject: ObjectID }[];
  const dbType = DB_TYPE[db]!;
  for (let i = 0; i < records.length; i++) {
    if (records[i]!.nextObject === OBJECT_ID_NULL) records[i] = { ...blank(), nextObject: OBJECT_ID_EOF };
  }
  while (records.length < dbMax(dbType)) records.push({ ...blank(), nextObject: OBJECT_ID_EOF });
  data.databases[db].count = records.length;
  data.header.objectCounts[dbType] = records.length;
}

/** The first floor square on `level` with no object, from `from` on. */
function emptyFloor(game: Game, level: number, from = new Position(0, 0, level)): Position {
  const dungeon = game.ctx.dungeon;
  const size = dungeon.getMapDimensions(level)!;
  for (let x = from.x; x < size.width; x++) {
    for (let y = x === from.x ? from.y : 0; y < size.height; y++) {
      const at = new Position(x, y, level);
      if (getRoomType(dungeon.getCellFlag(at)) === RoomType.OPEN && dungeon.findFirstObject(at) === OBJECT_ID_EOF) return at;
    }
  }
  throw new Error(`no empty floor on level ${level}`);
}

const rockRecord = (): MiscRecord => ({ nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType: 10 });

function rockAt(game: Game, at: Position): ObjectID {
  const rn = game.ctx.dungeon.findEmptyDBEntry('misc', rockRecord());
  game.ctx.dungeon.addObjectToCell(at, rn);
  return rn;
}

function inCell(game: Game, at: Position, rn: ObjectID): boolean {
  for (let o = game.ctx.dungeon.findFirstObject(at); o !== OBJECT_ID_EOF; o = game.ctx.dungeon.getDBRecordLink(o)) {
    if (o === rn) return true;
  }
  return false;
}

const index = (game: Game, rn: ObjectID): number => game.ctx.dungeon.rnMaps.idx(rn);
const where = (p: Position): string => `${p.z}:${p.x},${p.y}`;

/* --------------------------------------------------------- 0. Enlarge ---- */
{
  const game = makeGame();
  const dungeon = game.ctx.dungeon;
  const data = dungeon.getData();
  const misc = data.databases.misc.records;
  // Every free record taken first, then the database is full at its file's size.
  const taken: ObjectID[] = [];
  for (const r of [...misc]) if (r.nextObject === OBJECT_ID_NULL) taken.push(dungeon.findEmptyDBEntry('misc', rockRecord()));
  const size = misc.length;
  check(misc.every((r) => r.nextObject !== OBJECT_ID_NULL) && data.header.objectCounts[DBType.MISC] === size,
    `the free misc records taken (${taken.length}), the database full at its ${size}`);
  const got = dungeon.findEmptyDBEntry('misc', { ...rockRecord(), miscType: 11 });
  console.log(`0. misc full at ${size}: the next is misc ${index(game, got)}, the database ${misc.length}, the header ${data.header.objectCounts[DBType.MISC]}`);
  check(index(game, got) === size && misc[size]!.miscType === 11 && misc[size]!.nextObject === OBJECT_ID_EOF,
    'Enlarge: the new object is the first new record, at the old size');
  check(misc.length === size + 100 && data.header.objectCounts[DBType.MISC] === size + 100 && data.databases.misc.count === size + 100,
    '100 records more, and the header declares them');
  const cleared = misc.slice(size + 1);
  check(cleared.every((r) => r.nextObject === OBJECT_ID_NULL && r.miscType === 0 && !r.important && r.specialState === 0),
    'the other 99 are cleared: every field 0, link RNnul');
  const next = dungeon.findEmptyDBEntry('misc', rockRecord());
  check(index(game, next) === size + 1 && misc.length === size + 100, 'the next new object takes the next cleared record');
  // Up to record 1023 and past it.
  let last: ObjectID = next;
  while (index(game, last) < 1100) last = dungeon.findEmptyDBEntry('misc', rockRecord());
  console.log(`   on to misc ${index(game, last)}, slot ${last}: the database ${misc.length}`);
  check(index(game, last) === 1100 && dungeon.rnMaps.dbType(last) === DBType.MISC && misc.length === 1180,
    'a record past 1023 is named by its slot like any other');
  // A cleared creature: its possession is RNnul, as a save gives a free record's back.
  const creatures = data.databases.creatures.records;
  for (const r of creatures) if (r.nextObject === OBJECT_ID_NULL) r.nextObject = OBJECT_ID_EOF;
  const groups = creatures.length;
  dungeon.findEmptyDBEntry('creatures', { ...creatures[0]!, hp: [...creatures[0]!.hp] });
  check(creatures.length === groups + 100 && creatures.slice(groups + 1).every((r) => r.nextObject === OBJECT_ID_NULL
    && r.possession === OBJECT_ID_NULL && r.creatureType === 0 && r.hp.every((h) => h === 0)),
  "a cleared group's possession is RNnul and the rest 0");
  // At db.Max it grows no more.
  fill(game, 'misc', rockRecord);
  check(dungeon.enlarge(DBType.MISC) === -1 && misc.length === 8000, 'at db.Max, 8000 records, Enlarge gives -1');
  check(dbMax(DBType.ACTUATOR) === 16000 && dbMax(DBType.CLOUD) === 768 && dbMax(DBType.WEAPON) === 8000,
    'db.Max is 16000 for the actuators, 768 for the clouds, 8000 for the rest');
}

/* ------------------------------------------- 1. the sweep and the pad ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const partyLevel = ctx.party.state.position.z | 0;
  check(partyLevel === 0 && ctx.levelCleared[DBType.MISC] === 0, 'a new game: the party on level 0, LevelCleared 0');
  // A rock behind a pressure pad on level 1, and one on its own further on.
  let pad: Position | null = null;
  const size = dungeon.getMapDimensions(1)!;
  for (let x = 0; x < size.width && !pad; x++) {
    for (let y = 0; y < size.height && !pad; y++) {
      const at = new Position(x, y, 1);
      const first = dungeon.findFirstObject(at);
      if (first !== OBJECT_ID_EOF && game.ctx.dungeon.rnMaps.dbType(first) === DBType.ACTUATOR
        && getActuatorType(dungeon.getActuatorRecord(first)!) !== 0) pad = at;
    }
  }
  const padRock = rockAt(game, pad!);
  const free1 = emptyFloor(game, 1, new Position(pad!.x, pad!.y + 1, 1));
  const rock1 = rockAt(game, free1);
  const free3 = emptyFloor(game, 3);
  const rock3 = rockAt(game, free3);
  fill(game, 'misc', rockRecord);

  const got = dungeon.findEmptyDBEntry('misc', { ...rockRecord(), miscType: 11 });
  console.log(`1. rocks at ${where(pad!)} (behind a pad), ${where(free1)}, ${where(free3)}: the first new record is misc ${index(game, got)}`);
  check(got === rock1, "level 1 is swept first, and the rock behind the pad's actuator is passed over");
  check(!inCell(game, free1, rock1) && inCell(game, pad!, padRock), 'the rock is lifted out of its square, the other stays');
  const misc = dungeon.getData().databases.misc.records;
  check(misc[index(game, got)].miscType === 11 && misc.length === 8000, 'the new record is stored over it; the database stays at 8000');
  check(ctx.levelCleared[DBType.MISC] === 1, 'LevelCleared is 1');
  const next = dungeon.findEmptyDBEntry('misc', rockRecord());
  console.log(`   the next is misc ${index(game, next)}; LevelCleared ${ctx.levelCleared[DBType.MISC]}`);
  check(next === rock3 && !inCell(game, free3, rock3) && ctx.levelCleared[DBType.MISC] === 3,
    'the next sweep goes on from level 1 and takes the rock on level 3');
}

/* ------------------------------------------------ 2. the party's level ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const party = ctx.party.state.position;
  // One rock within five squares of the party, one further.
  let near: Position | null = null;
  let far: Position | null = null;
  const size = dungeon.getMapDimensions(party.z)!;
  for (let x = 0; x < size.width; x++) {
    for (let y = 0; y < size.height; y++) {
      const at = new Position(x, y, party.z);
      if (getRoomType(dungeon.getCellFlag(at)) !== RoomType.OPEN || dungeon.findFirstObject(at) !== OBJECT_ID_EOF) continue;
      const within = Math.abs(x - party.x) <= 5 && Math.abs(y - party.y) <= 5;
      if (within && !near && (x !== party.x || y !== party.y)) near = at;
      if (!within && !far) far = at;
    }
  }
  const nearRock = rockAt(game, near!);
  const farRock = rockAt(game, far!);
  fill(game, 'misc', rockRecord);
  const got = dungeon.findEmptyDBEntry('misc', rockRecord());
  console.log(`2. party at ${where(party)}; rocks at ${where(near!)} and ${where(far!)}: misc ${index(game, got)}, LevelCleared ${ctx.levelCleared[DBType.MISC]}`);
  check(got === farRock && inCell(game, near!, nearRock),
    "every other level holds nothing to take, so the party's level: the rock beyond five squares");
  const refused = dungeon.findEmptyDBEntry('misc', rockRecord());
  check(refused === OBJECT_ID_NULL && inCell(game, near!, nearRock) && ctx.levelCleared[DBType.MISC] === (party.z | 0),
    "then nothing: the rock within five squares is spared, the record refused, LevelCleared the party's level");
}

/* ----------------------------------------------------- 3. a monster ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  // `dungeon.dat` plants every group `important()`, so one is made a spawned group: the
  // first the sweep meets from level 1, a creature ahead of any live actuator in its chain.
  let victim: { rn: ObjectID; at: Position } | null = null;
  for (let l = 1; l < dungeon.getMapCount() && !victim; l++) {
    const size = dungeon.getMapDimensions(l)!;
    for (let x = 0; x < size.width && !victim; x++) {
      for (let y = 0; y < size.height && !victim; y++) {
        const at = new Position(x, y, l);
        for (let o = dungeon.findFirstObject(at); o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) {
          const c = game.ctx.dungeon.rnMaps.dbType(o);
          if (c === DBType.ACTUATOR) { if (getActuatorType(dungeon.getActuatorRecord(o)!) === 0) continue; break; }
          if (c === DBType.CREATURE) { victim = { rn: o, at }; break; }
        }
      }
    }
  }
  // Give it a rock to carry.
  const carried = dungeon.findEmptyDBEntry('misc', rockRecord());
  const monster = dungeon.getCreatureRecord(victim!.rn)!;
  check(monster.important, 'the retail group is important');
  monster.important = false;
  dungeon.setDBRecordLink(carried, monster.possession);
  monster.possession = carried;
  const template = { ...monster, possession: OBJECT_ID_EOF, hp: [...monster.hp], important: true };
  fill(game, 'creatures', () => ({ ...template }));
  const victimIndex = index(game, victim!.rn);
  const got = dungeon.findEmptyDBEntry('creatures', { ...template, creatureType: 3 });
  console.log(`3. the first group swept, creature ${victimIndex} at ${where(victim!.at)}: creature ${index(game, got)}`);
  check(index(game, got) === victimIndex && !inCell(game, victim!.at, victim!.rn), 'the group is deleted and its record taken');
  check(dungeon.getCreatureRecord(got)!.creatureType === 3, 'the new group is stored there');
  check(inCell(game, victim!.at, carried), 'what it carried lies on its square');
  check(ctx.levelCleared[DBType.CREATURE] === victim!.at.z, "LevelCleared is the group's level");
}

/* ------------------------------------------------------ 4. a missile ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const from = emptyFloor(game, 2);
  const thrown = dungeon.findEmptyDBEntry('misc', rockRecord());
  check(game.systems.magic.launchMissile(thrown, from.x, from.y, from.z, 0, 0, 40, 10, 1, game.ctx.state.tickCount, true),
    'a rock is thrown on level 2');
  let missile: ObjectID = OBJECT_ID_EOF;
  for (let o = dungeon.findFirstObject(from); o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) {
    if (game.ctx.dungeon.rnMaps.dbType(o) === DBType.MISSILE) missile = o;
  }
  const timerIndex = dungeon.getMissileRecord(missile)!.timerIndex;
  const timersBefore = ctx.timers.getTimers().length;
  const template = { ...dungeon.getMissileRecord(missile)! };
  fill(game, 'missiles', () => ({ ...template }));
  const missileIndex = index(game, missile);
  const got = dungeon.findEmptyDBEntry('missiles', { ...template, rangeRemaining: 7 });
  console.log(`4. missile ${missileIndex} flying at ${where(from)}, timer ${timerIndex}: missile ${index(game, got)}`);
  check(index(game, got) === missileIndex && dungeon.getMissileRecord(got)!.rangeRemaining === 7 && !inCell(game, from, missile), 'the missile is ended and its record taken');
  check(ctx.timers.getTimer(timerIndex) === null && ctx.timers.getTimers().length === timersBefore - 1, 'its timer is deleted');
  check(inCell(game, from, thrown), 'the rock falls where it flew');
}

/* ------------------------------------------------------- 5. the clouds ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  fill(game, 'clouds', () => ({ cloudType: 0, value: 0 }));
  const got = ctx.dungeon.findEmptyDBEntry('clouds', { nextObject: OBJECT_ID_EOF, cloudType: 0, value: 0 } as never);
  check(got === OBJECT_ID_NULL, 'a full cloud database refuses the record');
}

finish();
