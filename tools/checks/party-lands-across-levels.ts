/**
 * The party falling onto a group of the level below kills it while `d.partyLevel` is
 * still the level it left (`doc/CSBwin-src/Code11f52.cpp:3333-3359`): `MoveObject`
 * kills it under `LoadLevel(curLevel)`, and only sets `d.newPartyLevel`, which
 * `LoadPartyLevel` takes at the top of the next tick (`CSBCode.cpp:625-633`, `:806`).
 * So the group is not attached, and every reader of `level == d.partyLevel` takes it
 * as a detached one, whose `groupIndex` is its packed positions:
 *
 * 1. **`DeleteMonster` frees no slot** (`Code11f52.cpp:1076-1081`). The slot its
 *    `groupIndex` happens to name belongs to a group of the level the party left, and
 *    stays attached, and `d.ITEM16QueLen` holds.
 * 2. **`DropMonsterRemains` reads the dying group's own positions**, through
 *    `MonsterPositionByte` (`:211-231`, `:902-915`), not that slot's.
 *
 * The group is a lone Screamer, which leaves slices, whose positions byte is 0 (corner
 * 0), and whose `groupIndex` is therefore slot 0, held on the level above by a group
 * whose positions are not 0.
 *
 * Run: `npm test -- --only=party-lands-across-levels.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import type { Game } from '../../src/engine/Game';
import { MonsterType } from '../../src/engine/monsterTypes';
import { stockGame } from '../lib/game';
import { testChampion } from '../lib/champion';
import { wrapMember } from '../lib/standIn';
import { check, finish } from '../lib/check';

function makeGame(): Game {
  const game = stockGame();
  game.setRandomSeed(0x12345678);
  game.systems.hallOfChampions.addChampion(testChampion(0, { name: 'HERO' }));
  return game;
}

const roomType = (game: Game, at: Position): number => (game.ctx.dungeon.getCellFlag(at) >> 5) & 0x7;

/** The first group on `z`, by square. */
function firstGroup(game: Game, z: number): Position | null {
  const map = game.ctx.dungeon.getMap(z);
  if (!map) return null;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const at = new Position(x, y, z);
      if (game.ctx.dungeon.findFirstMonster(at) !== OBJECT_ID_EOF) return at;
    }
  }
  return null;
}

/**
 * An open pit whose level has groups, and which drops onto an open square of a level
 * with a group to put there: the pit, the square, and that group's square.
 */
function findScene(game: Game): { pit: Position; below: Position; group: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map || !firstGroup(game, z)) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined || ((flag >> 5) & 0x7) !== RoomType.PIT) continue;
        if ((flag & 0x08) === 0 || (flag & 0x01) !== 0) continue; // closed, or imaginary
        const pit = new Position(x, y, z);
        const below = dungeon.incrementLevel(pit, 1);
        if (!below || roomType(game, below) !== RoomType.OPEN) continue;
        if (dungeon.findFirstObject(below) !== OBJECT_ID_EOF) continue;
        const group = firstGroup(game, below.z);
        if (group) return { pit, below, group };
      }
    }
  }
  return null;
}

const game = makeGame();
const scene = findScene(game);
check(scene !== null, 'an open pit above an open square, both levels with groups');
if (scene) {
  const { pit, below, group } = scene;
  const dungeon = game.ctx.dungeon;
  const party = game.ctx.party.state;
  party.position = new Position(pit.x, pit.y, pit.z);
  game.systems.monsters.loadPartyLevelIfChanged();
  const pool = dungeon.getItem16Pool();
  const slot0 = pool[0]!;
  const queLen = game.systems.monsters.getItem16QueLen();
  console.log(`the pit at level ${pit.z} (${pit.x},${pit.y}) drops to level ${below.z} (${below.x},${below.y}); `
    + `${queLen} group(s) attached, slot 0 positions ${slot0.positions}`);
  check(slot0.word0 >= 0 && slot0.positions !== 0, 'slot 0 holds a group of the pit\'s level, its positions not 0');

  // The group below, made a lone Screamer carrying nothing in corner 0, and moved to the
  // square the party lands on.
  const rn = dungeon.findFirstMonster(group);
  const rec = dungeon.getCreatureRecord(rn)!;
  rec.creatureType = MonsterType.mon_Screamer;
  rec.numMonM1 = 0;
  rec.hp = [50, 0, 0, 0];
  rec.possession = OBJECT_ID_EOF;
  rec.groupIndex = 0;
  dungeon.removeObjectFromCell(group, rn);
  dungeon.addObjectToCell(below, rn);

  const corners: number[] = [];
  const restore = wrapMember(game.systems.monsterDamage, 'createAndDropObject', (real) =>
    (type, level, x, y, position, delay) => { corners.push(position); real(type, level, x, y, position, delay); });
  party.position = new Position(pit.x, pit.y, pit.z);
  game.systems.worldMove.moveParty(-1, 0, pit.x, pit.y);
  restore();

  const landed = party.position;
  console.log(`landed at level ${game.ctx.loop.newPartyLevel} (${landed.x},${landed.y}); `
    + `slot 0 word0 ${slot0.word0}, ${game.systems.monsters.getItem16QueLen()} attached; drops at corners [${corners.join(', ')}]`);
  check(game.ctx.loop.newPartyLevel === below.z && landed.x === below.x && landed.y === below.y,
    'the party lands on the group\'s square, on the level below, still to be loaded');
  check(dungeon.findFirstMonster(below) === OBJECT_ID_EOF, 'and the group is gone');
  check(slot0.word0 >= 0, '1. slot 0 is still attached to its group of the pit\'s level');
  check(game.systems.monsters.getItem16QueLen() === queLen, '1. and d.ITEM16QueLen holds');
  check(corners.length === 1 && corners[0] === 0, '2. the Screamer drops its slices at its own corner 0');
  let slices = 0;
  for (let o = dungeon.findFirstObject(below); o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) {
    if (dungeon.rnMaps.dbType(o) === DBType.MISC) slices++;
  }
  check(slices > 0, '2. and they are on the square');
}

finish();
