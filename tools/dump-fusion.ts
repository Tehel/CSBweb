/**
 * `atk_FUSE` and `_Fusion` (doc/CSBwin-src/Attack.cpp:1963-1972, `:133-213`): the dispell
 * cloud on the square in front of the party, and Lord Chaos's escape from it.
 *
 * An arena on Lord Chaos's own level (12, where `monsterAllowedOnLevel` lets him stand):
 * seven squares by seven, empty of objects, made open around (6, 13), a Lord Chaos made
 * there, and the party on (6, 14) facing north, so the fusion lands on him. Every case is a fresh game.
 *
 * 1. **No Lord Chaos.** One dispell cloud, and nothing else (`:158-160`).
 * 2. **Off the map.** No cloud at all: the square is checked first (`:150-157`).
 * 3. **Free.** He steps next door, to the first square of the shuffled directions that
 *    is open, unoccupied and neither a Fluxcage nor a wall (`:163-199`). The tool
 *    replays the shuffle from the random seed after the cloud, `STRandom(i + 1)` for i
 *    from 3 down to 1, and his movement timers start where he lands.
 * 4. **Caged on three sides, the party on the fourth.** Nothing next door is free, but
 *    the square behind the party is: he jumps over the party (`:200-212`).
 * 5. **Caged on two sides, a monster on the third.** He jumps over the monster: the
 *    near square may be occupied, only not a Fluxcage or a wall.
 * 6. **Boxed in.** The square behind the party is stone: he stays, "toast" (`:213`).
 *    The sequence that follows is not ported yet (`DEBT.md` G8, step 3).
 * 7. **A wall next door** blocks the square two away in that direction, open as it is.
 *
 * Run: `npx tsx tools/dump-fusion.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { CloudType } from '../src/engine/cloudTypes';
import type { Game } from '../src/engine/Game';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { DELTA_X, DELTA_Y } from '../src/engine/MonsterPerception';
import { AttackType, MonsterType } from '../src/engine/monsterTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { newGame, stockGraphics } from './lib/game';

const LEVEL = 12;
/** The only centres on level 12 with no object within three squares: (5-6, 13-14). */
const CX = 6;
const CY = 13;
const DIRECTION = ['north', 'east', 'south', 'west'];

function champion(): Champion {
  return {
    ...addCharacterDefaults(),
    name: 'FUSER',
    attributes: {
      health: 200, maxHealth: 200, stamina: 200, maxStamina: 200, mana: 200, maxMana: 200,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
}

interface Arena {
  game: Game;
  /** The random seed right after `atk_FUSE`'s dispell cloud: where `_Fusion`'s shuffle starts. */
  seedAfterCloud: number | null;
}

function setRoom(game: Game, x: number, y: number, roomType: RoomType): void {
  const map = game.dungeonState.getMap(LEVEL)!;
  map.cellFlags[x]![y] = (roomType << 5) | (map.cellFlags[x]![y]! & 0x10);
}

function arena(withLordChaos: boolean): Arena {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x12345678);
  game.addChampion(champion());
  for (let x = CX - 3; x <= CX + 3; x++) {
    for (let y = CY - 3; y <= CY + 3; y++) {
      if (game.dungeonState.findFirstMonster(new Position(x, y, LEVEL)) !== OBJECT_ID_EOF) {
        throw new Error(`the arena holds a monster at (${x},${y})`);
      }
      setRoom(game, x, y, RoomType.OPEN);
    }
  }
  game.party.state.position = new Position(CX, CY + 1, LEVEL);
  game.party.state.facing = 0;
  game.loadNewPartyLevel();
  if (withLordChaos) placeMonster(game, MonsterType.mon_LordChaos, CX, CY);
  const a: Arena = { game, seedAfterCloud: null };
  const encounter = game.ctx.systems.missileEncounter;
  const createCloud = encounter.createCloud.bind(encounter);
  encounter.createCloud = (...args: Parameters<typeof createCloud>): void => {
    createCloud(...args);
    a.seedAfterCloud = game.ctx.random.getSeed();
  };
  return a;
}

function placeMonster(game: Game, type: number, x: number, y: number): ObjectID {
  const rn = createMonsterAt(game, {
    value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0, mapX: x, mapY: y, level: LEVEL,
    invisible: false, drawAsSize4: false,
  });
  if (rn === null) throw new Error(`no ${MonsterType[type]} at (${x},${y})`);
  game.timerQueue.deleteMonsterMovementTimers(x, y, LEVEL);
  return rn;
}

function cage(game: Game, x: number, y: number): void {
  if (game.missileEncounter.createFluxcage(new Position(x, y, LEVEL), game.state.tickCount) === null) {
    throw new Error(`no Fluxcage at (${x},${y})`);
  }
}

function dispellClouds(game: Game, x: number, y: number): number {
  const dungeon = game.dungeonState;
  let n = 0;
  for (let rn = dungeon.findFirstObject(new Position(x, y, LEVEL)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (decodeObjectID(rn).category !== DBType.CLOUD) continue;
    if (dungeon.getCloudRecord(rn)?.cloudType === CloudType.CT_DISPELL) n++;
  }
  return n;
}

/** Where Lord Chaos stands in the arena, or null. */
function lordChaosAt(game: Game): { x: number; y: number } | null {
  for (let x = CX - 3; x <= CX + 3; x++) {
    for (let y = CY - 3; y <= CY + 3; y++) {
      const rn = game.dungeonState.findFirstMonster(new Position(x, y, LEVEL));
      if (rn === OBJECT_ID_EOF) continue;
      if (game.dungeonState.getCreatureRecord(rn)?.creatureType === MonsterType.mon_LordChaos) return { x, y };
    }
  }
  return null;
}

function movementTimerAt(game: Game, x: number, y: number): boolean {
  return game.timerQueue.getTimers().some((t) =>
    t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
    && t.level === LEVEL && t.uByte6 === x && t.uByte7 === y);
}

function fuse(a: Arena): { x: number; y: number } | null {
  a.game.attackSystem.attack(0, AttackType.atk_FUSE);
  const at = lordChaosAt(a.game);
  console.log(`  Lord Chaos ${at ? `at (${at.x},${at.y})` : 'nowhere'}; dispell clouds on (${CX},${CY}): ${dispellClouds(a.game, CX, CY)}`);
  return at;
}

function checkNoLordChaos(): void {
  console.log('=== 1. no Lord Chaos in front (Attack.cpp:158-160) ===');
  const a = arena(false);
  fuse(a);
  check(dispellClouds(a.game, CX, CY) === 1, 'one dispell cloud on the square in front');
}

function checkOffTheMap(): void {
  console.log('');
  console.log('=== 2. the square in front is off the map (Attack.cpp:150-157) ===');
  const a = arena(false);
  a.game.party.state.position = new Position(CX, 0, LEVEL);
  a.game.attackSystem.attack(0, AttackType.atk_FUSE);
  console.log(`  createCloud called: ${a.seedAfterCloud !== null}`);
  check(a.seedAfterCloud === null, 'no cloud at all');
}

function checkFree(): void {
  console.log('');
  console.log('=== 3. free: he steps next door (Attack.cpp:163-199), over eight seeds ===');
  const landed = new Set<string>();
  let southFirst = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const a = arena(true);
    a.game.setRandomSeed(seed * 0x1000193);
    const at = fuse(a);
    const random = new CsbRandom();
    random.setSeed(a.seedAfterCloud!);
    const direction = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = random.below(i + 1);
      [direction[i], direction[j]] = [direction[j]!, direction[i]!];
    }
    // South is the party's square, occupied; the other three are open and free.
    if (direction[0] === 2) southFirst++;
    const first = direction.find((d) => d !== 2)!;
    const want = { x: CX + DELTA_X[first]!, y: CY + DELTA_Y[first]! };
    console.log(`    shuffled ${direction.map((d) => DIRECTION[d]).join(', ')}: expected (${want.x},${want.y})`);
    check(at !== null && at.x === want.x && at.y === want.y, `seed ${seed}: he is on the first free square of the shuffled directions`);
    check(at !== null && movementTimerAt(a.game, at.x, at.y), `seed ${seed}: and his movement timers start there`);
    check(dispellClouds(a.game, CX, CY) === 1, `seed ${seed}: the dispell cloud is on the square he left`);
    if (at) landed.add(`${at.x},${at.y}`);
  }
  console.log(`  landed on ${[...landed].join(' ')}; south shuffled first ${southFirst} times`);
  check(landed.size === 3 && southFirst > 0, 'the seeds reach all three free squares, and skip the party\'s at least once');
}

function checkOverTheParty(): void {
  console.log('');
  console.log('=== 4. caged on three sides: he jumps over the party (Attack.cpp:200-212) ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  cage(a.game, CX - 1, CY);
  const at = fuse(a);
  check(at !== null && at.x === CX && at.y === CY + 2, 'he lands behind the party, two squares south');
  check(movementTimerAt(a.game, CX, CY + 2), 'and his movement timers start there');
}

function checkOverAMonster(): void {
  console.log('');
  console.log('=== 5. caged on two sides, a monster on the third: he jumps over it ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  const other = [...Array(27).keys()].find((t) => t !== MonsterType.mon_LordChaos && a.game.dungeonState.monsterAllowedOnLevel(t, LEVEL))!;
  placeMonster(a.game, other, CX - 1, CY);
  console.log(`  a ${MonsterType[other] ?? other} on (${CX - 1},${CY})`);
  setRoom(a.game, CX, CY + 2, RoomType.STONE);
  const at = fuse(a);
  check(at !== null && at.x === CX - 2 && at.y === CY, 'he lands two squares west, past the monster');
}

function checkBoxedIn(): void {
  console.log('');
  console.log('=== 6. boxed in: toast (Attack.cpp:213) ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  cage(a.game, CX - 1, CY);
  setRoom(a.game, CX, CY + 2, RoomType.STONE);
  const at = fuse(a);
  check(at !== null && at.x === CX && at.y === CY, 'he stays where he is');
  check(!movementTimerAt(a.game, CX, CY), 'and no movement timer starts for him');
  check(dispellClouds(a.game, CX, CY) === 1, 'under the dispell cloud');
}

function checkWall(): void {
  console.log('');
  console.log('=== 7. a wall next door blocks the square beyond it ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  setRoom(a.game, CX - 1, CY, RoomType.STONE);
  setRoom(a.game, CX, CY + 2, RoomType.STONE);
  const at = fuse(a);
  check(at !== null && at.x === CX && at.y === CY, 'he stays: the square two west is open, but the one next to him is a wall');
  setRoom(a.game, CX - 1, CY, RoomType.FALSEWALL);
  const b = fuse(a);
  check(b !== null && b.x === CX && b.y === CY, 'and so is a false wall');
}

function main(): void {
  checkNoLordChaos();
  checkOffTheMap();
  checkFree();
  checkOverTheParty();
  checkOverAMonster();
  checkBoxedIn();
  checkWall();
  finish();
}

main();
