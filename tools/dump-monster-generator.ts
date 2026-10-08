/**
 * A monster generator (actuator type 6) fired by its timer.
 *
 * `ProcessTimers` loads the timer's level before it runs the timer
 * (`doc/CSBwin-src/CSBCode.cpp:6475-6476`), so the generator works on its own level
 * whatever the party's: the hit-point multiplier is the actuator's, or that level's
 * `experienceMultiplier()` when the actuator's is 0 (`Timer.cpp:1782-1786`), and
 * `CreateMonster`'s `MoveObject` puts the group on `d.LoadedLevel` (`Code11f52.cpp:2892`),
 * at the generator's x and y. Each member's hit points are
 * `baseHealth * multiplier + STRandom() % (baseHealth / 4 + 1)` (`Monster.cpp:207`).
 *
 * Two real generators of `dm-atari/dungeon.dat`, each fired by a `TT_OPENROOM` on its
 * square, as its pad would:
 *
 *  a. level 9 (5, 12), multiplier 3, with the party on level 3;
 *  b. level 3 (7, 23), multiplier 0 on a level of multiplier 2, with the party on its level.
 *
 * Run: `npx tsx tools/dump-monster-generator.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../src/core/types';
import { ActuatorAction, getActuatorHitPointMultiplier, getActuatorType, getActuatorValue } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

function scene(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  return game;
}

function objectsAt(game: Game, p: Position, category: number): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) === category) out.push(rn);
  }
  return out;
}

/** Fire the generator at `gen` with the party at `party`, and check where its group went. */
function fire(label: string, gen: Position, party: Position, multiplier: number): void {
  const game = scene();
  const dungeon = game.ctx.dungeon;
  const actuator = objectsAt(game, gen, DBType.ACTUATOR)
    .map((rn) => dungeon.getActuatorRecord(rn)!)
    .find((rec) => getActuatorType(rec) === 6);
  if (!actuator) throw new Error(`no generator at L${gen.z} (${gen.x},${gen.y})`);
  const desc = game.ctx.tables.monsterDesc[getActuatorValue(actuator) & 0x1f]!;
  const own = getActuatorHitPointMultiplier(actuator);
  const levelMultiplier = dungeon.getMap(gen.z)!.descriptor.difficulty;
  check((own || levelMultiplier) === multiplier,
    `${label}: the multiplier is ${multiplier} (the actuator's ${own}, the level's ${levelMultiplier})`);

  game.ctx.party.state.position = party;
  game.systems.monsters.loadPartyLevel(party.z);
  const onPartyLevel = new Position(gen.x, gen.y, party.z);
  const beforeHere = objectsAt(game, gen, DBType.CREATURE).length;
  const beforeThere = party.z === gen.z ? 0 : objectsAt(game, onPartyLevel, DBType.CREATURE).length;
  game.ctx.timers.addTimer({
    index: 0, function: TimerFunction.TT_OPENROOM, time: game.ctx.state.tickCount, level: gen.z,
    uByte5: 0, uByte6: gen.x, uByte7: gen.y, uByte8: 0, uByte9: ActuatorAction.SET, sequence: 0,
    timerWord8: 0, timerWord6: 0,
  });
  game.systems.timer.processTimers();

  const groups = objectsAt(game, gen, DBType.CREATURE);
  const group = groups.length > beforeHere ? dungeon.getCreatureRecord(groups[groups.length - 1]!)! : null;
  const members = group ? group.hp.slice(0, group.numMonM1 + 1) : [];
  console.log(`${label}: generator L${gen.z} (${gen.x},${gen.y}), party L${party.z}; ` +
    `groups there ${beforeHere} -> ${groups.length}; hit points ${members.join(', ') || '-'} ` +
    `(base ${desc.baseHealth09} x ${multiplier} + 0..${Math.trunc(desc.baseHealth09 / 4)})`);
  check(groups.length === beforeHere + 1, `${label}: the group is made on the generator's level, at its x and y`);
  if (party.z !== gen.z) {
    check(objectsAt(game, onPartyLevel, DBType.CREATURE).length === beforeThere,
      `${label}: and nothing on the party's level at that x and y`);
  }
  const low = desc.baseHealth09 * multiplier;
  const high = low + Math.trunc(desc.baseHealth09 / 4);
  check(members.length > 0 && members.every((h) => h >= low && h <= high),
    `${label}: every member has baseHealth x ${multiplier} plus the spread, ${low}..${high} (Monster.cpp:207)`);
}

fire('a', new Position(5, 12, 9), new Position(1, 3, 3), 3);
fire('b', new Position(7, 23, 3), new Position(1, 3, 3), 2);

finish();
