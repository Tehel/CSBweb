/**
 * `WiggleEverything` moves a monster group with `MoveObject(objD4, x, y, x, y)`
 * (`doc/CSBwin-src/Timer.cpp:2446-2450`), which is `MonsterSystem.moveMonster`.
 *
 * `TimerSystem.wiggleMonster` hand-rolled it and missed most of it (DEBT.md C23):
 *
 *  1. A group teleported off a square that switched on gets its AI timers started where
 *     it lands, and loses those at the square it left (`Code11f52.cpp:3401-3421`).
 *  2. Teleported to another level, it gives its `ITEM16` back (`DetachItem16`, `:3364-3369`).
 *  3. Teleported to a level its type may not live on, it is deleted (`:3147-3176`).
 *  4. A teleporter that sends it back to its own square leaves it alone — nothing is
 *     lifted, pressed or set down (`:3183-3213`). `wiggleMonster` lifted it and set it
 *     down again through two `PlaceOrRemoveObjectInRoom` calls.
 *
 * The teleporter is a real record from `dungeon.dat`, re-aimed onto a real open square,
 * switched off, and then switched on by the `TT_TELEPORTER` timer an actuator would queue.
 *
 * Run: `npx tsx tools/dump-wiggle-monster.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { ActuatorAction } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables, monsterLevitating } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { rigTeleporter } from './lib/teleporter';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const viewportTables = extractViewportTables(graphics);
const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

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
const walks = (type: number): boolean => !monsterLevitating(objectTables.monsterDesc[type]!);
const typeOn = (game: Game, ...levels: number[]): number => {
  for (let t = 0; t < 27; t++) {
    if (walks(t) && levels.every((z) => game.dungeonState.monsterAllowedOnLevel(t, z))) return t;
  }
  return -1;
};
/** Empty open squares of level `z`, none of them in `not`. */
const opens = (game: Game, z: number, not: Position[] = []): Position[] => {
  const dungeon = game.dungeonState;
  const map = dungeon.getMap(z)!;
  const out: Position[] = [];
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const p = new Position(x, y, z);
      if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF || not.some((q) => same(p, q))) continue;
      out.push(p);
    }
  }
  return out;
};
const aiTimersAt = (game: Game, p: Position): number => game.timerQueue.getTimers().filter((t) =>
  t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
  && t.uByte6 === p.x && t.uByte7 === p.y && t.level === p.z).length;
const groupAt = (game: Game, p: Position): boolean => game.dungeonState.findFirstMonster(p) !== OBJECT_ID_EOF;

/**
 * A game with the party on `z`, a teleporter on an open square of `z` aimed at `to(game)`,
 * switched off; a group of `type` is made on it, and the teleporter switched on.
 */
function wiggle(z: number, type: number, to: (game: Game, at: Position) => Position): {
  game: Game; at: Position; dest: Position; rn: ObjectID; slot: number; calls: number; timersBefore: number;
} {
  const game = makeGame();
  const [at, partyAt] = opens(game, z).filter((p, _, all) => all.some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 4));
  if (!at || !partyAt) throw new Error(`no room on level ${z}`);
  const far = opens(game, z, [at]).find((p) => Math.abs(p.x - at.x) + Math.abs(p.y - at.y) > 4)!;
  game.party.state.position = far;
  game.monsterSystem.loadPartyLevel(z);
  const dest = to(game, at);
  rigTeleporter(game, at, dest);
  const map = game.dungeonState.getMap(z)!;
  map.cellFlags[at.x]![at.y]! &= ~0x08;
  const rn = createMonsterAt(game, {
    value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
    mapX: at.x, mapY: at.y, level: z, invisible: false, drawAsSize4: false,
  });
  if (rn === null) throw new Error(`could not make a type-${type} group on (${at.x},${at.y}) L${z}`);
  const slot = game.dungeonState.getCreatureRecord(rn)!.groupIndex;
  const timersBefore = aiTimersAt(game, at);

  let calls = 0;
  const actuators = (game as unknown as { actuators: ActuatorSystem }).actuators;
  const real = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    calls++;
    return real(position, object, place, unchangedRoom, facing);
  };
  // At tick 0: the group's first AI timer is due at tick 1, and must not move it first.
  game.timerQueue.createTimer(TimerFunction.TT_TELEPORTER, at.x, at.y, 0, ActuatorAction.SET, 0, z);
  game.timerSystem.processTimers(0);
  return { game, at, dest, rn, slot, calls, timersBefore };
}

function main(): void {
  const probe = makeGame();
  const count = probe.dungeonState.getMapCount();

  /* ------------------------------------ 1. teleported along the party's level ---- */
  {
    let z = 0;
    while (typeOn(probe, z) < 0) z++;
    const { game, at, dest, timersBefore } = wiggle(z, typeOn(probe, z), (g, from) =>
      opens(g, z, [from, g.party.state.position]).find((p) => Math.abs(p.x - from.x) + Math.abs(p.y - from.y) > 2)!);
    console.log(`1. a group on (${at.x},${at.y}) L${z} as the teleporter to (${dest.x},${dest.y}) switches on: `
      + `there ${groupAt(game, dest)}, AI timers ${timersBefore} at the teleporter -> ${aiTimersAt(game, at)}, `
      + `${aiTimersAt(game, dest)} where it landed`);
    check(groupAt(game, dest) && !groupAt(game, at), 'the group is carried to the destination');
    check(timersBefore > 0 && aiTimersAt(game, at) === 0 && aiTimersAt(game, dest) > 0,
      'its timers start where it landed and are gone from the teleporter');
  }

  /* ---------------------------------------- 2. teleported to another level ---- */
  {
    let a = -1;
    let b = -1;
    for (let i = 0; i < count && a < 0; i++) {
      for (let j = 0; j < count && a < 0; j++) if (i !== j && typeOn(probe, i, j) >= 0) { a = i; b = j; }
    }
    const { game, dest, rn, slot } = wiggle(a, typeOn(probe, a, b), (g) => opens(g, b)[0]!);
    const pool = game.dungeonState.getItem16Pool();
    const group = game.dungeonState.getCreatureRecord(rn)!;
    console.log(`2. a group with ITEM16 ${slot} teleported from L${a} to (${dest.x},${dest.y}) L${b}: there ${groupAt(game, dest)}, `
      + `slot ${slot} word0 ${pool[slot]!.word0}, groupIndex now ${group.groupIndex}`);
    check(groupAt(game, dest), 'the group is carried to the other level');
    check(slot < pool.length && pool[slot]!.word0 < 0, 'and its ITEM16 is given back');
  }

  /* --------------------------------- 3. teleported to a level it may not live on ---- */
  {
    let z = -1;
    let bad = -1;
    for (let i = 0; i < count && z < 0; i++) {
      const t = typeOn(probe, i);
      if (t < 0) continue;
      for (let j = 0; j < count; j++) if (!probe.dungeonState.monsterAllowedOnLevel(t, j)) { z = i; bad = j; break; }
    }
    const { game, at, dest, rn } = wiggle(z, typeOn(probe, z), (g) => opens(g, bad)[0]!);
    const record = game.dungeonState.getCreatureRecord(rn)!;
    console.log(`3. a group teleported from L${z} to L${bad}, where its type may not live: on the teleporter `
      + `${groupAt(game, at)}, at the destination ${groupAt(game, dest)}, record freed ${record.nextObject === OBJECT_ID_NULL}`);
    check(!groupAt(game, at) && !groupAt(game, dest), 'the group is nowhere');
    check(record.nextObject === OBJECT_ID_NULL, 'its record is freed');
  }

  /* --------------------------------------- 4. a teleporter onto its own square ---- */
  {
    let z = 0;
    while (typeOn(probe, z) < 0) z++;
    const { game, at, calls, timersBefore } = wiggle(z, typeOn(probe, z), (_g, from) => from);
    console.log(`4. a group on a teleporter aimed at its own square (${at.x},${at.y}) L${z}: there ${groupAt(game, at)}, `
      + `PlaceOrRemoveObjectInRoom calls ${calls}, AI timers ${timersBefore} -> ${aiTimersAt(game, at)}`);
    check(groupAt(game, at), 'the group stays');
    check(calls === 0, 'nothing is lifted or set down');
    check(aiTimersAt(game, at) === timersBefore, 'and its timers are untouched');
  }

  finish();
}

main();
