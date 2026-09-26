/**
 * A cloud carried off by a teleporter takes its timer with it.
 *
 * When a teleporter switches on, `WiggleEverything` (`doc/CSBwin-src/Timer.cpp:2428`)
 * moves everything standing on it with `MoveObject`, and for a cloud it then retargets
 * every `TT_25` / `TT_24` naming it to the new square, corner and level
 * (`:2491-2510`). The port moved the cloud and left the timer behind, so the cloud
 * never shrank at its new square and the timer, still pointing at the old one, freed a
 * record that was still linked into the new cell.
 *
 * This takes a real item-capable teleporter from dungeon.dat, switches it off, stands a
 * poison cloud on it, queues the `TT_TELEPORTER` that switches it on, and follows the
 * cloud to the end of its life.
 *
 * Run: `npx tsx tools/dump-wiggle-cloud.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { ActuatorAction } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { RN_POISON_CLOUD } from '../src/core/spellRn';

function champion(i: number, name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** An active teleporter, open to plain items, whose destination is a different cell. */
function findItemTeleporter(game: Game): { at: Position; dest: Position } | null {
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.TELEPORTER) continue;
        if ((flag & 0x08) === 0) continue; // inactive
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (decodeObjectID(rn).category !== DBType.TELEPORTER) continue;
          const rec = dungeon.getTeleporterRecord(rn);
          if (!rec) continue;
          if ((rec.scope & 0x3) === 1) continue; // creatures only
          for (let dz = 0; dz < dungeon.getMapCount(); dz++) {
            const destMap = dungeon.getMap(dz);
            if (!destMap || destMap.descriptor.level !== rec.destMap) continue;
            const dest = new Position(rec.destX, rec.destY, dz);
            if (dest.x === at.x && dest.y === at.y && dest.z === at.z) break; // teleports to itself
            return { at, dest };
          }
        }
      }
    }
  }
  return null;
}


// `RN(0xff87)`, the poison cloud: it lives long enough to follow (dump-clouds.ts).

/** The cloud in a cell with this record index, or null. */
function cloudIn(game: Game, at: Position, index: number): ObjectID | null {
  const dungeon = game.dungeonState;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = decodeObjectID(rn);
    if (decoded.category === DBType.CLOUD && decoded.index === index) return rn;
  }
  return null;
}

function main(): void {
  const game = makeGame();
  const dungeon = game.dungeonState;
  const teleporter = findItemTeleporter(game);
  if (!teleporter) {
    check(false, 'dungeon.dat has an active, item-capable teleporter');
    finish();
    return;
  }
  const { at, dest } = teleporter;
  console.log(`teleporter at level ${at.z} (${at.x},${at.y}) -> level ${dest.z} (${dest.x},${dest.y})`);
  check(!(game.party.state.position.x === at.x && game.party.state.position.y === at.y
    && game.party.state.position.z === at.z), 'the party is not standing on it');

  // Switch it off, stand a poison cloud on it, and queue the timer that switches it on.
  const map = dungeon.getMap(at.z)!;
  map.cellFlags[at.x]![at.y]! &= ~0x08;
  game.missileEncounter.createDeathCloud(RN_POISON_CLOUD, 255, at, 0);
  let born: ObjectID | null = null;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (decodeObjectID(rn).category === DBType.CLOUD) born = rn;
  }
  check(born !== null, 'the cloud stands on the switched-off teleporter');
  if (born === null) { finish(); return; }
  const index = decodeObjectID(born).index;
  game.timerQueue.createTimer(TimerFunction.TT_TELEPORTER, at.x, at.y, 0, ActuatorAction.SET, 1, at.z);

  game.timerSystem.processTimers(1);
  check((map.cellFlags[at.x]![at.y]! & 0x08) !== 0, 'the teleporter switched on');
  check(cloudIn(game, at, index) === null, 'the cloud has left the teleporter');
  const landed = cloudIn(game, dest, index);
  check(landed !== null, 'the cloud stands at the destination');
  if (landed === null) { finish(); return; }

  // Timer.cpp:2491-2510 — its TT_25 follows: square, level, and the placed ID.
  const timers = game.timerQueue.getTimers().filter((t) => t.function === TimerFunction.TT_25
    && t.object !== undefined && decodeObjectID(t.object).category === DBType.CLOUD
    && decodeObjectID(t.object).index === index);
  console.log(`TT_25 timers naming it: ${timers.map((t) =>
    `(${t.uByte6},${t.uByte7}) level ${t.level} obj 0x${(t.object ?? 0).toString(16)}`).join(', ')}`);
  check(timers.length === 1, `one TT_25 names the cloud (${timers.length})`);
  const timer = timers[0];
  check(timer !== undefined && timer.uByte6 === dest.x && timer.uByte7 === dest.y,
    `its timer names the destination square (${timer?.uByte6},${timer?.uByte7})`);
  check(timer?.level === dest.z, `its timer names the destination level (${timer?.level})`);
  check(timer?.object === landed, `its timer holds the placed ID (0x${(timer?.object ?? 0).toString(16)} vs 0x${landed.toString(16)})`);

  // And it lives out its life there: it shrinks, then leaves the cell and its record is
  // freed, with nothing left behind in either cell.
  const value0 = dungeon.getCloudRecord(landed)?.value ?? -1;
  game.timerSystem.processTimers(2);
  const value1 = dungeon.getCloudRecord(landed)?.value ?? -1;
  check(value1 === value0 - 3, `the cloud shrinks at the destination (${value0} -> ${value1})`);
  for (let t = 3; t <= 200; t++) game.timerSystem.processTimers(t);
  check(cloudIn(game, dest, index) === null, 'the cloud has gone from the destination by the end of its life');
  check(game.timerQueue.getTimers().every((t) => t.function !== TimerFunction.TT_25),
    'no TT_25 outlives it');

  finish();
}

main();
