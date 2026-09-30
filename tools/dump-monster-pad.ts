/**
 * A monster's own move presses pads, and leaves its other AI timers behind
 * (`MoveObject`'s monster branch, `doc/CSBwin-src/Code11f52.cpp:3258-3424`).
 *
 *  1. A group that does not levitate leaves its square through
 *     `PlaceOrRemoveObjectInRoom(oldX, oldY, obj, partyThere, remove)` (`:3287`) and
 *     arrives through `PlaceOrRemoveObjectInRoom(newX, newY, obj, false, place)`
 *     (`:3392`), so walking onto a floor pad fires it. The port spliced the chains
 *     and called no actuator.
 *  2. Walking off it releases it.
 *  3. A group that goes into abeyance has already left its square (the removal at
 *     `:3257-3296` comes before the occupancy test at `:3335-3358`), so its pad is
 *     released too.
 *  4. A levitating group uses `RemoveObjectFromRoom` / `AddObjectToRoom`
 *     (`:3274`, `:3386`) and presses nothing.
 *  5. An ordinary step leaves the group's other AI timers where they were:
 *     `MoveObject` never re-aims them, and the AI caller re-aims only the timer it is
 *     processing (`Monster.cpp:1711`, `:2105`, `:2440`, `:2908`). Only a DSA's cell move
 *     re-aims the rest (`MoveObject.cpp:539-571`; `tools/dump-dsa-move.ts` section 6).
 *  6. A group deleted on a pad releases it: `DeleteMonster` takes it off its square with
 *     `MoveObject(obj, x, y, -1, 0)` (`Code11f52.cpp:1038`), which lifts it through
 *     `PlaceOrRemoveObjectInRoom` and returns before the monster branch (`:3257-3297`).
 *     The port spliced the chain and released nothing. A levitating group is lifted with
 *     `RemoveObjectFromRoom` and releases nothing (`:3274`).
 *
 * The pad is a real one from `dungeon.dat`: the first actuator of type 1 (party,
 * monster or object) on an open square with an open neighbour.
 *
 * Run: `npx tsx tools/dump-monster-pad.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables, monsterLevitating } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';

const DELTAS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

async function main(): Promise<void> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    const game = newGame(data, graphics);
    game.setRandomSeed(0x12345678);
    return game;
  };

  const roomType = (game: Game, p: Position): number => (game.ctx.dungeon.getCellFlag(p) >> 5) & 7;
  const inBounds = (game: Game, p: Position): boolean => {
    const map = game.ctx.dungeon.getMap(p.z);
    return !!map && p.x >= 0 && p.y >= 0 && p.x < map.descriptor.width && p.y < map.descriptor.height;
  };
  const emptyOpen = (game: Game, p: Position): boolean =>
    inBounds(game, p) && roomType(game, p) === RoomType.OPEN && game.ctx.dungeon.findFirstObject(p) === OBJECT_ID_EOF;
  /** A type-1 floor pad alone in its cell, with two empty open squares in a line beside it. */
  const findPad = (game: Game): { pad: Position; beside: Position; beyond: Position } => {
    const dungeon = game.ctx.dungeon;
    for (let z = 0; z < dungeon.getMapCount(); z++) {
      if (![...Array(27).keys()].some((t) => dungeon.monsterAllowedOnLevel(t, z))) continue;
      const map = dungeon.getMap(z)!;
      for (let x = 0; x < map.descriptor.width; x++) {
        for (let y = 0; y < map.descriptor.height; y++) {
          const pad = new Position(x, y, z);
          if (roomType(game, pad) !== RoomType.OPEN) continue;
          let pads = 0;
          let other = 0;
          for (let rn = dungeon.findFirstObject(pad); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
            if (decodeObjectID(rn).category !== DBType.ACTUATOR) { other++; continue; }
            if (getActuatorType(dungeon.getActuatorRecord(rn)!) === 1) pads++; else other++;
          }
          if (pads !== 1 || other !== 0) continue;
          for (const [dx, dy] of DELTAS) {
            const beside = new Position(x + dx, y + dy, z);
            const beyond = new Position(x + 2 * dx, y + 2 * dy, z);
            if (emptyOpen(game, beside) && emptyOpen(game, beyond)) return { pad, beside, beyond };
          }
        }
      }
    }
    throw new Error('no lone type-1 floor pad with open squares beside it');
  };

  type PadCall = { at: Position; place: boolean; unchangedRoom: boolean };
  /** Record every `PlaceOrRemoveObjectInRoom` (`ActuatorSystem.triggerObjectMove`) call. */
  const spy = (game: Game): PadCall[] => {
    const calls: PadCall[] = [];
    const actuators = game.systems.actuators;
    const real = actuators.triggerObjectMove.bind(actuators);
    actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
      calls.push({ at: position, place, unchangedRoom });
      return real(position, object, place, unchangedRoom, facing);
    };
    return calls;
  };
  const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  const called = (calls: PadCall[], at: Position, place: boolean): boolean =>
    calls.some((c) => same(c.at, at) && c.place === place && !c.unchangedRoom);
  const actionTimers = (game: Game): number => game.ctx.timers.getTimers().filter((t) =>
    t.function < TimerFunction.TT_FIRST_MONSTER_AI || t.function > TimerFunction.TT_LAST_MONSTER_AI).length;
  const aiTimersAt = (game: Game, p: Position): number => game.ctx.timers.getTimers().filter((t) =>
    t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
    && t.uByte6 === p.x && t.uByte7 === p.y && t.level === p.z).length;

  /** A game with the party on the pad's level, far from it, and a group at `at`. */
  const setUp = async (at: (s: { pad: Position; beside: Position; beyond: Position }) => Position) => {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    const squares = findPad(game);
    const { pad } = squares;
    const map = dungeon.getMap(pad.z)!;
    let partyAt: Position | null = null;
    for (let x = 0; x < map.descriptor.width && !partyAt; x++) {
      for (let y = 0; y < map.descriptor.height && !partyAt; y++) {
        const p = new Position(x, y, pad.z);
        if (emptyOpen(game, p) && Math.abs(x - pad.x) + Math.abs(y - pad.y) > 4) partyAt = p;
      }
    }
    if (!partyAt) throw new Error('nowhere to stand the party');
    game.ctx.party.state.position = partyAt;
    game.systems.monsters.loadPartyLevel(pad.z);
    let type = 0;
    while (!dungeon.monsterAllowedOnLevel(type, pad.z)) type++;
    const where = at(squares);
    const rn = createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: where.x, mapY: where.y, level: where.z, invisible: false, drawAsSize4: false,
    });
    if (rn === null) throw new Error('createMonster failed');
    return { game, ...squares, rn: rn as ObjectID, calls: spy(game) };
  };

  /* ---------------------------------------------------- 1-2. onto and off the pad ---- */
  {
    const { game, pad, beside, rn, calls } = await setUp((s) => s.beside);
    const levitating = monsterLevitating(objectTables.monsterDesc[game.ctx.dungeon.getCreatureRecord(rn)!.creatureType]!);
    const before = actionTimers(game);
    const onto = game.systems.monsters.moveMonster(rn, beside.x, beside.y, pad.x, pad.y, pad.z);
    const after = actionTimers(game);
    console.log(`1. group (${beside.x},${beside.y}) -> pad (${pad.x},${pad.y}) L${pad.z}: removed ${onto.code !== 0}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}, action timers ${before} -> ${after}`);
    check(!levitating, 'the test group walks');
    check(onto.code === 0 && game.ctx.dungeon.findFirstMonster(pad) !== OBJECT_ID_EOF, 'the group stands on the pad');
    check(called(calls, beside, false), 'it leaves its square through PlaceOrRemoveObjectInRoom (remove, room changed)');
    check(called(calls, pad, true), 'it arrives through PlaceOrRemoveObjectInRoom (place, room changed)');
    check(after > before, "the pad's action is queued");

    calls.length = 0;
    game.systems.monsters.moveMonster(rn, pad.x, pad.y, beside.x, beside.y, pad.z);
    console.log(`2. group back off the pad: pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place]))}`);
    check(called(calls, pad, false), 'walking off releases the pad');
  }

  /* ------------------------------------------------- 3. into abeyance off the pad ---- */
  {
    const { game, pad, beside, rn, calls } = await setUp((s) => s.pad);
    let type = 0;
    while (!game.ctx.dungeon.monsterAllowedOnLevel(type, pad.z)) type++;
    createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: beside.x, mapY: beside.y, level: beside.z, invisible: false, drawAsSize4: false,
    });
    calls.length = 0;
    const result = game.systems.monsters.moveMonster(rn, pad.x, pad.y, beside.x, beside.y, pad.z);
    console.log(`3. group on the pad -> occupied (${beside.x},${beside.y}): removed ${result.code !== 0}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place]))}`);
    check(result.code !== 0, 'the group goes into abeyance');
    check(called(calls, pad, false), 'having left the pad, which it released');
  }

  /* --------------------------------------------------- 4. a levitating group ---- */
  {
    const { game, pad, beside, rn, calls } = await setUp((s) => s.beside);
    const flyer = objectTables.monsterDesc.findIndex((d) => monsterLevitating(d));
    game.ctx.dungeon.getCreatureRecord(rn)!.creatureType = flyer;
    const before = actionTimers(game);
    game.systems.monsters.moveMonster(rn, beside.x, beside.y, pad.x, pad.y, pad.z);
    console.log(`4. levitating type ${flyer} -> pad: pad calls ${calls.length}, action timers ${before} -> ${actionTimers(game)}`);
    check(flyer >= 0 && calls.length === 0, 'a levitating group neither presses nor releases a pad');
    check(actionTimers(game) === before, 'and queues nothing');
  }

  /* ------------------------------------------ 5. the other AI timers stay behind ---- */
  {
    const { game, beside, beyond, rn } = await setUp((s) => s.beside);
    const before = aiTimersAt(game, beside);
    const result = game.systems.monsters.moveMonster(rn, beside.x, beside.y, beyond.x, beyond.y, beside.z);
    console.log(`5. group (${beside.x},${beside.y}) -> (${beyond.x},${beyond.y}): code ${result.code}, AI timers `
      + `${before} at the old square -> ${aiTimersAt(game, beside)}, ${aiTimersAt(game, beyond)} at the new`);
    check(result.code === 0, 'an ordinary step changes no ITEM16');
    check(before > 0 && aiTimersAt(game, beside) === before && aiTimersAt(game, beyond) === 0,
      'MoveObject leaves the AI timers at the square the group left');
  }

  /* ------------------------------------------------- 6. a group deleted on the pad ---- */
  {
    const { game, pad, rn, calls } = await setUp((s) => s.pad);
    const groupIndex = game.ctx.dungeon.getCreatureRecord(rn)!.groupIndex;
    game.systems.monsterDamage.deleteMonster(pad.z, pad.x, pad.y);
    const slot = game.ctx.dungeon.getItem16Record(groupIndex);
    console.log(`6. group deleted on the pad (${pad.x},${pad.y}) L${pad.z}: still there `
      + `${game.ctx.dungeon.findFirstMonster(pad) !== OBJECT_ID_EOF}, ITEM16 ${groupIndex} word0 ${slot?.word0}, `
      + `AI timers ${aiTimersAt(game, pad)}, pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(game.ctx.dungeon.findFirstMonster(pad) === OBJECT_ID_EOF && aiTimersAt(game, pad) === 0,
      'the group is gone, and so are its AI timers');
    check(slot?.word0 === -1, 'its ITEM16 is given back');
    check(calls.length === 1 && called(calls, pad, false),
      'it leaves the pad through PlaceOrRemoveObjectInRoom (remove, the party is not there)');

    const flying = await setUp((s) => s.pad);
    const flyer = objectTables.monsterDesc.findIndex((d) => monsterLevitating(d));
    flying.game.ctx.dungeon.getCreatureRecord(flying.rn)!.creatureType = flyer;
    flying.game.systems.monsterDamage.deleteMonster(pad.z, pad.x, pad.y);
    console.log(`   levitating type ${flyer} deleted on the pad: pad calls ${flying.calls.length}`);
    check(flying.game.ctx.dungeon.findFirstMonster(pad) === OBJECT_ID_EOF && flying.calls.length === 0,
      'a levitating group is lifted with RemoveObjectFromRoom: no pad sees it go');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
