/**
 * Watch monsters move.
 *
 * Runs the real dungeon's AI for a while and prints where each group started and
 * ended up, how far it travelled, and how its fear state changed — plus a small ASCII
 * map of one group's path.
 *
 * This is the payoff check for the whole AI port. The things worth looking for: a
 * monster near the party should end up *closer* to it, one far away should wander,
 * and none should end up inside a wall.
 *
 * Run: `npx tsx tools/watch-monsters.ts [level] [partyX] [partyY] [ticks]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { MonsterType, StateOfFear } from '../src/engine/monsterTypes';
import { newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const level = Number(process.argv[2] ?? 2);
  const px = Number(process.argv[3] ?? 6);
  const py = Number(process.argv[4] ?? 14);
  const ticks = Number(process.argv[5] ?? 600);

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.ctx.party.state.position = new Position(px, py, level);
  game.systems.monsters.loadPartyLevel(level);

  const dungeon = game.ctx.dungeon;
  const pool = dungeon.getItem16Pool();
  // Where a group stands. Not its ITEM16's uByte10/11: only AttachItem16ToMonster sets
  // those (doc/CSBwin-src/CSBCode.cpp:6147-6149), and MoveObject leaves them behind.
  const map = dungeon.getMap(level)!;
  const where = (db4: number): { x: number; y: number } => {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        for (let rn = dungeon.findFirstObject(new Position(x, y, level)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          const d = game.ctx.dungeon.rnMaps.decode(rn);
          if (d.category === DBType.CREATURE && d.index === db4) return { x, y };
        }
      }
    }
    return { x: -1, y: -1 };
  };
  const start = pool.map((s) => (s.word0 >= 0 ? { db4: s.word0, ...where(s.word0) } : null));
  const startFear = pool.map((s) => {
    if (s.word0 < 0) return -1;
    return dungeon.getCreatureRecordByIndex(s.word0)?.fear ?? -1;
  });

  // Follow one group's path: the closest to the party.
  let followed = -1;
  let bestDist = 1e9;
  pool.forEach((s, i) => {
    if (s.word0 < 0) return;
    const d = Math.abs(start[i]!.x - px) + Math.abs(start[i]!.y - py);
    if (d < bestDist) { bestDist = d; followed = i; }
  });
  const path: string[] = [];

  for (let t = 0; t < ticks; t++) {
    game.ctx.state.tickCount = t;
    processTimersAt(game, t);
    if (followed >= 0) {
      const s = pool[followed]!;
      const at = where(s.word0);
      const here = `${at.x},${at.y}`;
      if (path[path.length - 1] !== here) path.push(here);
    }
  }

  console.log(`level ${level}, party at (${px},${py}), ${ticks} ticks\n`);
  console.log(['monster', 'from', 'to', 'moved', 'dist0', 'dist1', 'fear'].join('\t'));
  let moversTotal = 0;
  let closedIn = 0;
  let inWall = 0;
  let groupsTotal = 0;
  let inFear6 = 0;
  let nearestFinalDist = 1e9;
  pool.forEach((s, i) => {
    const s0 = start[i];
    if (!s0 || s.word0 < 0) return;
    const rec = dungeon.getCreatureRecordByIndex(s.word0);
    if (!rec) return;
    const now = where(s.word0);
    const moved = Math.abs(now.x - s0.x) + Math.abs(now.y - s0.y);
    const d0 = Math.abs(s0.x - px) + Math.abs(s0.y - py);
    const d1 = Math.abs(now.x - px) + Math.abs(now.y - py);
    groupsTotal++;
    if (moved > 0) moversTotal++;
    if (d1 < d0) closedIn++;
    if (rec.fear === StateOfFear.StateOfFear6) inFear6++;
    if (d1 < nearestFinalDist) nearestFinalDist = d1;
    const rt = (dungeon.getCellFlag(new Position(now.x, now.y, level)) >> 5) & 7;
    if (rt === RoomType.STONE) { inWall++; }
    console.log([
      MonsterType[rec.creatureType] ?? rec.creatureType,
      `(${s0.x},${s0.y})`,
      `(${now.x},${now.y})`,
      moved,
      d0,
      d1,
      `${StateOfFear[startFear[i]!] ?? startFear[i]}->${StateOfFear[rec.fear] ?? rec.fear}`,
    ].join('\t'));
  });

  console.log('');
  console.log(`groups that moved: ${moversTotal}, closed in on the party: ${closedIn}, standing in stone: ${inWall}`);
  if (followed >= 0) {
    console.log(`\nnearest group's path (${path.length} squares):`);
    console.log('  ' + path.join(' -> '));
  }
  console.log('');
  console.log(`groups in fear state 6 (break formation and attack): ${inFear6}, nearest group ended ${nearestFinalDist} away`);
  console.log('');

  // The scenario these thresholds describe is the default one in the header: level 2,
  // party at (6,14), 600 ticks. They are floors, not the exact numbers, so a faithful
  // change to the AI that shifts a few paths does not fail the run — but a port that
  // stops moving monsters, stops them noticing the party, or walks them into stone does.
  check(inWall === 0, 'no monster is standing inside a wall');
  check(groupsTotal > 0, 'the level activated at least one monster group');
  check(moversTotal >= groupsTotal / 2, `at least half the groups moved (${moversTotal}/${groupsTotal})`);
  check(closedIn > 0, 'at least one group closed in on the party');
  check(inFear6 > 0, 'at least one group reached fear state 6 — it saw the party');
  check(nearestFinalDist <= 1, `a group reached melee range of the party (nearest ${nearestFinalDist})`);
  finish();
}

main();
