/**
 * A teleporter's target map is a map number: `curLevel = DB1A2->destLevel();
 * LoadLevel(curLevel)` (`doc/CSBwin-src/Code11f52.cpp:2989-2990`), not the first map
 * whose depth is that number. Every dungeon the repository ships numbers its maps by
 * depth, so the two readings agree on all of them; a dungeon whose maps share a depth, as
 * one merged from others may, tells them apart.
 *
 * DM's dungeon with one more map, built with `tools/lib/dungeonBuilder.ts`: map 14, one
 * square at depth 0, far from level 0. A teleporter put two squares in front of the
 * party's start, on (1,5), aimed at map 14's square, takes the party there, where the
 * first map of depth 14 would be none at all. One aimed at map 3, as DM's own are, still
 * takes it there; one aimed at a map the dungeon does not have leaves it where it is.
 *
 * Run: `npm test -- --only=teleporter-target.ts`
 */
import { Direction, Position, RoomType } from '../../src/core/types';
import { buildDungeonFile } from '../../src/data/DungeonFileWriter';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { MovementAction } from '../../src/engine/gameTypes';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { compose, decompose, roomFlag, teleporter, TELEPORTER_ACTIVE } from '../lib/dungeonBuilder';
import { newGame, runVbl, stockDungeon, stockGraphics, TICK_DUE } from '../lib/game';

/** DM with map 14 added, and on level 0 at (1,5) a teleporter into `map` at (`x`,`y`). */
function dungeon(map: number, x: number, y: number) {
  const world = decompose(stockDungeon());
  const like = world.levels[0];
  world.levels.push({
    descriptor: { ...structuredClone(like.descriptor), width: 1, height: 1, offsetX: 200, offsetY: 200, level: 0 },
    cellFlags: [[roomFlag(RoomType.OPEN)]],
    cells: [[[]]],
    monsterTypes: [], wallDecorationTOC: [], floorDecorationTOC: [], doorDecorationTOC: [],
  });
  // Level 0's start is (1,3) facing south; (1,5) is two squares on, (1,4) between.
  world.levels[0].cellFlags[1][5] = roomFlag(RoomType.TELEPORTER, TELEPORTER_ACTIVE);
  world.levels[0].cells[1][5] = [teleporter({ map, x, y, rotation: 0, absolute: false, scope: 3, sound: false })];
  return new DungeonLoader().loadDungeonDat(buildDungeonFile(compose(world), { dmRules: true }));
}

function walk(map: number, x: number, y: number): string {
  const data = dungeon(map, x, y);
  const game = newGame(data, stockGraphics());
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const party = game.ctx.party.state;
  party.position = new Position(1, 3, 0);
  party.facing = Direction.SOUTH;
  for (const move of [MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD]) {
    game.enqueueMovement(move);
    for (let n = 0; n < 8; n++) runVbl(game, TICK_DUE);
  }
  const p = party.position;
  return `${p.z}:(${p.x},${p.y})`;
}

function main(): void {
  const data = dungeon(14, 0, 0);
  console.log(['maps', data.maps.length, 'map 14 at depth', data.maps[14].descriptor.level,
    'level 0 (1,4)', RoomType[data.maps[0].cellFlags[1][4] >> 5]].join(' '));
  check(data.maps[14].descriptor.level === 0 && data.maps[0].cellFlags[1][4] >> 5 === RoomType.OPEN,
    'map 14 is at depth 0, and the way from the start to the teleporter is open');

  const toNew = walk(14, 0, 0);
  console.log(`aimed at map 14 (0,0): ${toNew}`);
  check(toNew === '14:(0,0)', 'a teleporter aimed at map 14 takes the party to map 14, though no map is 14 deep');

  const toThree = walk(3, 5, 5);
  console.log(`aimed at map 3 (5,5): ${toThree}`);
  check(toThree === '3:(5,5)', 'one aimed at map 3 takes it to map 3');

  const toNone = walk(40, 0, 0);
  console.log(`aimed at map 40, which the dungeon does not have: ${toNone}`);
  check(toNone === '0:(1,5)', 'one aimed at a map the dungeon does not have leaves it on the teleporter');
  finish();
}

main();
