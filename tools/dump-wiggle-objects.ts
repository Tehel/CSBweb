/**
 * `WiggleEverything` moves each object with the low-level `MoveObject`
 * (`doc/CSBwin-src/Timer.cpp:2428-2512`, `Code11f52.cpp:2796`).
 *
 * When a teleporter switches on or a pit opens, every object standing there is moved
 * with `MoveObject(obj, x, y, x, y)`. `TimerSystem.wiggleObject` hand-rolled it, and
 * differed from `MoveObject` in three ways:
 *
 *  1. It kept a cloud out of pits. `Levitating` (`Code11f52.cpp:2417-2437`) is true for a
 *     missile and a flying monster only, so a cloud falls, and its `TT_25` follows it to
 *     the level below (`Timer.cpp:2491-2510`).
 *  2. It pressed pads for a missile, which is levitating and moves with
 *     `RemoveObjectFromRoom` / `AddObjectToRoom` (`Code11f52.cpp:3272-3274`,
 *     `:3427-3429`). Its timer still follows it: square, direction, ID, level
 *     (`Timer.cpp:2474-2489`).
 *  3. It passed "same square" as `PlaceOrRemoveObjectInRoom`'s `unchangedRoom`, where
 *     `MoveObject` passes "the party stands on this square" (`Code11f52.cpp:3278-3293`,
 *     `:3433-3448`): an item teleported to where the party stands is placed with
 *     `unchangedRoom` true.
 *
 * The teleporter and the pit are real ones from `dungeon.dat`, switched off and then
 * switched on by the `TT_TELEPORTER` / `TT_PIT` timer an actuator would queue.
 *
 * Run: `npx tsx tools/dump-wiggle-objects.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { ActuatorAction } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { RN_POISON_CLOUD, RN_FIREBALL } from '../src/core/spellRn';

// `RN(0xff87)`, the poison cloud, and `RN(0xff80)`, the fireball.

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  return game;
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/** A square satisfying `pred`, scanning level by level. */
function findSquare(game: Game, pred: (p: Position) => boolean): Position | null {
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, z);
        if (pred(p)) return p;
      }
    }
  }
  return null;
}

/** An active teleporter open to objects whose destination is another square. */
function findItemTeleporter(game: Game): { at: Position; dest: Position } {
  const dungeon = game.dungeonState;
  let found: { at: Position; dest: Position } | null = null;
  findSquare(game, (at) => {
    const flag = dungeon.getCellFlag(at);
    if (((flag >> 5) & 7) !== RoomType.TELEPORTER || (flag & 0x08) === 0) return false;
    for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category !== DBType.TELEPORTER) continue;
      const rec = dungeon.getTeleporterRecord(rn);
      if (!rec || (rec.scope & 3) === 1) return false;
      for (let dz = 0; dz < dungeon.getMapCount(); dz++) {
        if (dungeon.getMap(dz)?.descriptor.level !== rec.destMap) continue;
        const dest = new Position(rec.destX, rec.destY, dz);
        if (same(dest, at)) return false;
        if (((dungeon.getCellFlag(dest) >> 5) & 7) === RoomType.TELEPORTER) return false;
        found = { at, dest };
        return true;
      }
    }
    return false;
  });
  if (!found) throw new Error('no active object teleporter');
  return found;
}

function inCell(game: Game, at: Position, category: DBType, index: number): ObjectID | null {
  const dungeon = game.dungeonState;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = decodeObjectID(rn);
    if (decoded.category === category && decoded.index === index) return rn;
  }
  return null;
}

type PadCall = { at: Position; category: number; place: boolean; unchangedRoom: boolean };
function spy(game: Game): PadCall[] {
  const calls: PadCall[] = [];
  const actuators = (game as unknown as { actuators: ActuatorSystem }).actuators;
  const real = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    calls.push({ at: position, category: decodeObjectID(object).category, place, unchangedRoom });
    return real(position, object, place, unchangedRoom, facing);
  };
  return calls;
}

/** Switch `at` off, let `stand` put something on it, then run the timer that switches it on. */
function switchOn(game: Game, at: Position, tt: TimerFunction, stand: () => void): void {
  const map = game.dungeonState.getMap(at.z)!;
  map.cellFlags[at.x]![at.y]! &= ~0x08;
  stand();
  game.timerQueue.createTimer(tt, at.x, at.y, 0, ActuatorAction.SET, 1, at.z);
  game.timerSystem.processTimers(1);
}

function main(): void {
  /* ------------------------------------------------ 1. a cloud down an opening pit ---- */
  {
    const game = makeGame();
    const dungeon = game.dungeonState;
    const pit = findSquare(game, (p) => {
      const flag = dungeon.getCellFlag(p);
      return ((flag >> 5) & 7) === RoomType.PIT && (flag & 0x08) !== 0 && (flag & 0x01) === 0
        && dungeon.incrementLevel(p, 1) !== null && !same(p, game.party.state.position);
    });
    if (!pit) throw new Error('no open pit');
    const below = dungeon.incrementLevel(pit, 1)!;
    let index = -1;
    switchOn(game, pit, TimerFunction.TT_PIT, () => {
      game.missileEncounter.createDeathCloud(RN_POISON_CLOUD, 255, pit, 0);
      for (let rn = dungeon.findFirstObject(pit); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (decodeObjectID(rn).category === DBType.CLOUD) index = decodeObjectID(rn).index;
      }
    });
    const landed = inCell(game, below, DBType.CLOUD, index);
    const timer = game.timerQueue.getTimers().find((t) => t.function === TimerFunction.TT_25
      && t.object !== undefined && decodeObjectID(t.object).index === index);
    console.log(`1. cloud ${index} on pit (${pit.x},${pit.y}) L${pit.z} as it opens: on the pit ${inCell(game, pit, DBType.CLOUD, index) !== null}, `
      + `below (${below.x},${below.y}) L${below.z} ${landed !== null}; TT_25 at (${timer?.uByte6},${timer?.uByte7}) L${timer?.level}`);
    check(index >= 0, 'the cloud stands on the closed pit');
    check(inCell(game, pit, DBType.CLOUD, index) === null && landed !== null, 'the cloud falls: it is not Levitating');
    check(timer !== undefined && timer.uByte6 === below.x && timer.uByte7 === below.y && timer.level === below.z
      && timer.object === landed, 'its TT_25 follows it to the level below');
  }

  /* ------------------------------------------- 2. a missile through a teleporter ---- */
  {
    const game = makeGame();
    const dungeon = game.dungeonState;
    const { at, dest } = findItemTeleporter(game);
    const calls = spy(game);
    let index = -1;
    switchOn(game, at, TimerFunction.TT_TELEPORTER, () => {
      game.magic.launchThrownMissile(RN_FIREBALL, at, 0, 1, 100, 100, 1, 50);
      for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (decodeObjectID(rn).category === DBType.MISSILE) index = decodeObjectID(rn).index;
      }
    });
    const landed = inCell(game, dest, DBType.MISSILE, index);
    const missile = landed !== null ? dungeon.getMissileRecord(landed) : null;
    const timer = missile ? game.timerQueue.getTimer(missile.timerIndex) : null;
    const word8 = timer?.timerWord8 ?? 0;
    const missileCalls = calls.filter((c) => c.category === DBType.MISSILE);
    console.log(`2. missile ${index} on teleporter (${at.x},${at.y}) L${at.z} -> (${dest.x},${dest.y}) L${dest.z}: `
      + `there ${landed !== null}, pad calls for it ${missileCalls.length}, timer word8 (${word8 & 31},${(word8 >> 5) & 31}) `
      + `L${timer?.level} obj ${timer?.object?.toString(16)}`);
    check(index >= 0 && landed !== null, 'the missile is carried to the destination');
    check(missileCalls.length === 0, 'a levitating missile presses no pad on either square');
    check(timer !== null && (word8 & 31) === dest.x && ((word8 >> 5) & 31) === dest.y && timer.level === dest.z
      && timer.object === landed && (word8 & 0xf000) === (1 << 12), 'its timer follows it, energy decay kept');
  }

  /* ------------------------------ 3. an item teleported to where the party stands ---- */
  {
    const game = makeGame();
    const dungeon = game.dungeonState;
    const { at, dest } = findItemTeleporter(game);
    game.party.state.position = dest;
    const calls = spy(game);
    // Any weapon record, lifted from wherever it lies.
    const weapons = dungeon.getData().databases.weapons.records.length;
    const rn = encodeObjectID(0, DBType.WEAPON, weapons - 1);
    const lying = findSquare(game, (p) => inCell(game, p, DBType.WEAPON, weapons - 1) !== null);
    if (lying) dungeon.removeObjectFromCell(lying, inCell(game, lying, DBType.WEAPON, weapons - 1)!);
    switchOn(game, at, TimerFunction.TT_TELEPORTER, () => {
      dungeon.addObjectToCell(at, rn);
    });
    const placed = calls.filter((c) => c.category === DBType.WEAPON && c.place);
    const lifted = calls.filter((c) => c.category === DBType.WEAPON && !c.place);
    console.log(`3. item on teleporter -> (${dest.x},${dest.y}) L${dest.z}, where the party stands: `
      + `there ${inCell(game, dest, DBType.WEAPON, weapons - 1) !== null}, `
      + `place ${JSON.stringify(placed.map((c) => [c.at.x, c.at.y, c.unchangedRoom]))}, `
      + `remove ${JSON.stringify(lifted.map((c) => [c.at.x, c.at.y, c.unchangedRoom]))}`);
    check(inCell(game, dest, DBType.WEAPON, weapons - 1) !== null, 'the item is carried to the destination');
    check(placed.length === 1 && same(placed[0]!.at, dest) && placed[0]!.unchangedRoom,
      "it is placed with unchangedRoom = the party stands there");
    check(lifted.length === 1 && same(lifted[0]!.at, at) && !lifted[0]!.unchangedRoom,
      'and lifted with unchangedRoom false: the party is not on the teleporter');
  }

  finish();
}

main();
