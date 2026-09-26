/**
 * `CheckMoveFromMissile` (`doc/CSBwin-src/Code11f52.cpp:2530-2776`) and the missile
 * filter's globals.
 *
 * `MissileTimer` copies the timer it runs into `missileFilterTimer` and points
 * `missileFilterObject` at its missile (`doc/CSBwin-src/Timer.cpp:176-177`, `:222-223`).
 * Each of its exits puts the object back to `RNnul` and none touches the copy. Nothing
 * else writes either, `CheckMoveFromMissile` included. So:
 *
 *  1. A party move made while a missile timer runs meets the missiles it leaves, as any
 *     other does. Here the move is made by `MissileEncounterFilter` (`Code11f52.cpp:1626`)
 *     as a missile strikes a wall, which is where a dungeon's filter DSA can teleport the
 *     party from.
 *  2. The filter's parameter 6, `BITS10_11(missileFilterTimer.timerWord8())` (`:1681`),
 *     is the direction of the last missile `MissileTimer` ran, also once that timer is
 *     over, and not that of the missile the party walks away from.
 *
 * The filter is stood in for at the DSA boundary, `DsaSystem.processMissileEncounterFilter`,
 * which records its parameters and answers 0, the default action.
 *
 * Run: `npx tsx tools/dump-move-from-missile.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, decodeObjectID, type ObjectID } from '../src/core/types';
import { RN_FIREBALL } from '../src/core/spellRn';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 500, maxHealth: 500, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
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
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i));
  return game;
}

/** An empty floor cell on the party's level, away from the party, with stone to its east. */
function findCellBeforeEastWall(game: Game): Position {
  const dungeon = game.dungeonState;
  const party = game.party.state.position;
  const map = dungeon.getMap(party.z)!;
  for (let x = 0; x + 1 < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      if (Math.abs(x - party.x) + Math.abs(y - party.y) < 3) continue;
      if (((map.cellFlags[x][y] >> 5) & 7) !== RoomType.OPEN) continue;
      if (((map.cellFlags[x + 1][y] >> 5) & 7) !== RoomType.STONE) continue;
      const at = new Position(x, y, party.z);
      if (dungeon.findFirstObject(at) !== OBJECT_ID_EOF) continue;
      return at;
    }
  }
  throw new Error('no floor cell before an east wall on the party level');
}

/**
 * Put a fireball in flight (`TT_MISSILE`, past the thrower's square), its timer due
 * `delay` ticks from now, and return its RN. Range 40: its blow grows with the range,
 * and at 255 two of them kill a 500-HP party.
 */
function launch(game: Game, at: Position, corner: number, direction: Direction, delay: number): ObjectID {
  const before = new Set<ObjectID>();
  for (let rn = game.dungeonState.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) before.add(rn);
  if (!game.magic.launchMissile(RN_FIREBALL, at.x, at.y, at.z, corner, direction, 40, 10, 1, game.timerSystem.now + delay - 1, true)) {
    throw new Error('missile not launched');
  }
  for (let rn = game.dungeonState.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    if (!before.has(rn) && decodeObjectID(rn).category === DBType.MISSILE) return rn;
  }
  throw new Error('missile not placed');
}

function inCell(game: Game, at: Position, rn: ObjectID): boolean {
  for (let r = game.dungeonState.findFirstObject(at); r !== OBJECT_ID_EOF; r = game.dungeonState.getDBRecordLink(r)) {
    if (r === rn) return true;
  }
  return false;
}

interface FilterCall { type: number; missile: number; direction: number; filterObjectSet: boolean }

const game = makeGame();
const ts = game.timerSystem;
const party = game.party.state.position;
const north = new Position(party.x, party.y - 1, party.z);
const wallSide = findCellBeforeEastWall(game);
console.log(`party at (${party.x},${party.y}) L${party.z}; the eastbound missile flies from (${wallSide.x},${wallSide.y})`);

const calls: FilterCall[] = [];
let onWall: (() => void) | null = null;
(game as any).dsaSystem.processMissileEncounterFilter = (o: { type: number; missile: number; direction: number }): number => {
  calls.push({ type: o.type, missile: o.missile, direction: o.direction, filterObjectSet: ts.missileFilterObject !== OBJECT_ID_NULL });
  if (o.type === 4 && onWall) {
    const move = onWall;
    onWall = null;
    move();
  }
  return 0;
};
const show = (label: string, c: FilterCall | undefined): void =>
  console.log(`${label}: ${c ? `type ${c.type}, missile 0x${c.missile.toString(16)}, direction ${c.direction}, inside MissileTimer ${c.filterObjectSet}` : 'no filter call'}`);

/* ------------------------------------------- 1. a move inside a missile timer ------ */
{
  // The fireball the party walks away from: in its cell, corner 2 (a champion's), flying
  // west. Its own timer is not due in this pass, or it would strike the party first.
  const struck = launch(game, party, 2, Direction.WEST, 10);
  // The fireball whose timer runs: eastbound, in corner 1, so it leaves the cell into stone.
  const flying = launch(game, wallSide, 1, Direction.EAST, 1);
  onWall = () => game.missileEncounter.checkPartyMoveFromMissile(party, north);

  ts.processTimers(ts.now + 1);

  const wall = calls.find((c) => c.type === 4 && c.missile === flying);
  const met = calls.find((c) => c.type === 7 && c.missile === struck);
  show('1a. the eastbound fireball at the wall', wall);
  show('1b. the party\'s move, made by that filter', met);
  check(wall !== undefined && wall.filterObjectSet, 'the wall filter runs inside MissileTimer, missileFilterObject set');
  check(met !== undefined, 'the move meets the fireball in the corner it leaves, although a missile timer runs');
  check(met?.direction === Direction.EAST, 'its filter reads the running timer\'s direction, east');
  check(!inCell(game, party, struck), 'and the fireball is spent');
  check(ts.missileFilterObject === OBJECT_ID_NULL, 'MissileTimer\'s exit puts missileFilterObject back to RNnul');
}

/* ----------------------------------------------- 2. a move after it -------------- */
{
  const struck = launch(game, party, 2, Direction.WEST, 10);
  calls.length = 0;
  game.missileEncounter.checkPartyMoveFromMissile(party, north);
  const met = calls.find((c) => c.type === 7 && c.missile === struck);
  show('2. a move after the timer, from a westbound fireball', met);
  check(met !== undefined && !met.filterObjectSet, 'the move meets it, outside any missile timer');
  check(met?.direction === Direction.EAST,
    'parameter 6 is the last missile timer\'s direction (east), not the struck fireball\'s (west)');
  check(((ts.missileFilterTimer?.timerWord8 ?? 0) >> 10 & 3) === Direction.EAST && ts.missileFilterObject === OBJECT_ID_NULL,
    'CheckMoveFromMissile leaves both globals as MissileTimer left them');
}

console.log(`health after both blows: ${game.party.state.champions.map((c) => c.attributes.health).join(', ')}`);
check(game.party.state.champions.every((c) => c.alive), 'the party outlives both fireballs, so each case finds its champion in corner 2');

finish();
