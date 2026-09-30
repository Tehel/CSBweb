/**
 * `MakeMoreRoomInDB` (`doc/CSBwin-src/Character.cpp:182-358`): a new object in a full
 * database takes the record of one thrown out of the dungeon. The port's databases are
 * full at 1024 records (`DEBT.md` H), so each section pads one to 1024 with records no
 * object names, then asks `findEmptyDBEntry` for one more.
 *
 *  1. The sweep starts at `d.LevelCleared[db]`, stepping past the party's level, and takes
 *     the first object of the database that is not `important()`, stopping each square's
 *     chain at an actuator that is not disabled. The item is lifted out of its square,
 *     and the new record is stored over it at the same index. The next sweep starts on
 *     the level the last one took from.
 *  2. The party's level comes last, and there the 11×11 squares around the party are
 *     spared. With nothing left, the record is refused and `LevelCleared` is the party's
 *     level.
 *  3. A monster group is deleted and drops what it carries. `dungeon.dat` plants every
 *     group important, so only a spawned one can go.
 *  4. A missile's timer goes, and its object falls where it flew.
 *  5. The cloud database is never made room in.
 *
 * Run: `npx tsx tools/dump-make-more-room.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, encodeObjectID, getRoomType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Databases, MiscRecord } from '../src/data/dungeonTypes';
import type { Game } from '../src/engine/Game';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

function makeGame(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  return newGame(data, stockGraphics());
}

/** Pad database `db` to 1024 records with in-use records no object names. */
function fill(game: Game, db: keyof Databases, blank: () => object): void {
  const records = game.ctx.dungeon.getData().databases[db].records as object[];
  while (records.length < 1024) records.push({ ...blank(), nextObject: OBJECT_ID_EOF });
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
  const rn = encodeObjectID(0, DBType.MISC, game.ctx.dungeon.findEmptyDBEntry('misc', rockRecord())!);
  game.ctx.dungeon.addObjectToCell(at, rn);
  return rn;
}

function inCell(game: Game, at: Position, rn: ObjectID): boolean {
  for (let o = game.ctx.dungeon.findFirstObject(at); o !== OBJECT_ID_EOF; o = game.ctx.dungeon.getDBRecordLink(o)) {
    if ((o & 0x3fff) === (rn & 0x3fff)) return true;
  }
  return false;
}

const index = (rn: ObjectID): number => decodeObjectID(rn).index;
const where = (p: Position): string => `${p.z}:${p.x},${p.y}`;

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
      if (first !== OBJECT_ID_EOF && decodeObjectID(first).category === DBType.ACTUATOR
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
  console.log(`1. rocks at ${where(pad!)} (behind a pad), ${where(free1)}, ${where(free3)}: the first new record is misc ${got}`);
  check(got === index(rock1), "level 1 is swept first, and the rock behind the pad's actuator is passed over");
  check(!inCell(game, free1, rock1) && inCell(game, pad!, padRock), 'the rock is lifted out of its square, the other stays');
  const misc = dungeon.getData().databases.misc.records;
  check(misc[got!].miscType === 11 && misc.length === 1024, 'the new record is stored over it; the database stays at 1024');
  check(ctx.levelCleared[DBType.MISC] === 1, 'LevelCleared is 1');
  const next = dungeon.findEmptyDBEntry('misc', rockRecord());
  console.log(`   the next is misc ${next}; LevelCleared ${ctx.levelCleared[DBType.MISC]}`);
  check(next === index(rock3) && !inCell(game, free3, rock3) && ctx.levelCleared[DBType.MISC] === 3,
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
  console.log(`2. party at ${where(party)}; rocks at ${where(near!)} and ${where(far!)}: misc ${got}, LevelCleared ${ctx.levelCleared[DBType.MISC]}`);
  check(got === index(farRock) && inCell(game, near!, nearRock),
    "every other level holds nothing to take, so the party's level: the rock beyond five squares");
  const refused = dungeon.findEmptyDBEntry('misc', rockRecord());
  check(refused === null && inCell(game, near!, nearRock) && ctx.levelCleared[DBType.MISC] === (party.z | 0),
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
          const c = decodeObjectID(o).category;
          if (c === DBType.ACTUATOR) { if (getActuatorType(dungeon.getActuatorRecord(o)!) === 0) continue; break; }
          if (c === DBType.CREATURE) { victim = { rn: o, at }; break; }
        }
      }
    }
  }
  // Give it a rock to carry.
  const carried = encodeObjectID(0, DBType.MISC, dungeon.findEmptyDBEntry('misc', rockRecord())!);
  const monster = dungeon.getCreatureRecord(victim!.rn)!;
  check(monster.important, 'the retail group is important');
  monster.important = false;
  dungeon.setDBRecordLink(carried, monster.possession);
  monster.possession = carried;
  const template = { ...monster, possession: OBJECT_ID_EOF, hp: [...monster.hp], important: true };
  fill(game, 'creatures', () => ({ ...template }));
  const got = dungeon.findEmptyDBEntry('creatures', { ...template, creatureType: 3 });
  console.log(`3. the first group swept, creature ${index(victim!.rn)} at ${where(victim!.at)}: creature ${got}`);
  check(got === index(victim!.rn) && !inCell(game, victim!.at, victim!.rn), 'the group is deleted and its record taken');
  check(inCell(game, victim!.at, carried), 'what it carried lies on its square');
  check(ctx.levelCleared[DBType.CREATURE] === victim!.at.z, "LevelCleared is the group's level");
}

/* ------------------------------------------------------ 4. a missile ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  const dungeon = ctx.dungeon;
  const from = emptyFloor(game, 2);
  const thrown = encodeObjectID(0, DBType.MISC, dungeon.findEmptyDBEntry('misc', rockRecord())!);
  check(game.systems.magic.launchMissile(thrown, from.x, from.y, from.z, 0, 0, 40, 10, 1, game.state.tickCount, true),
    'a rock is thrown on level 2');
  let missile: ObjectID = OBJECT_ID_EOF;
  for (let o = dungeon.findFirstObject(from); o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) {
    if (decodeObjectID(o).category === DBType.MISSILE) missile = o;
  }
  const timerIndex = dungeon.getMissileRecord(missile)!.timerIndex;
  const timersBefore = ctx.timers.getTimers().length;
  const template = { ...dungeon.getMissileRecord(missile)! };
  fill(game, 'missiles', () => ({ ...template }));
  const got = dungeon.findEmptyDBEntry('missiles', { ...template, rangeRemaining: 7 });
  console.log(`4. missile ${index(missile)} flying at ${where(from)}, timer ${timerIndex}: missile ${got}`);
  check(got === index(missile) && !inCell(game, from, missile), 'the missile is ended and its record taken');
  check(ctx.timers.getTimer(timerIndex) === null && ctx.timers.getTimers().length === timersBefore - 1, 'its timer is deleted');
  check(inCell(game, from, thrown), 'the rock falls where it flew');
}

/* ------------------------------------------------------- 5. the clouds ---- */
{
  const game = makeGame();
  const ctx = game.ctx;
  fill(game, 'clouds', () => ({ cloudType: 0, value: 0 }));
  const got = ctx.dungeon.findEmptyDBEntry('clouds', { nextObject: OBJECT_ID_EOF, cloudType: 0, value: 0 } as never);
  check(got === null, 'a full cloud database refuses the record');
}

finish();
