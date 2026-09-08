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

import { Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { MonsterType, StateOfFear } from '../src/engine/monsterTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const level = Number(process.argv[2] ?? 2);
  const px = Number(process.argv[3] ?? 6);
  const py = Number(process.argv[4] ?? 14);
  const ticks = Number(process.argv[5] ?? 600);

  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
  game.party.state.position = new Position(px, py, level);
  game.monsterSystem.loadPartyLevel(level);

  const dungeon = game.dungeonState;
  const pool = dungeon.getItem16Pool();
  const start = pool.map((s) => (s.word0 >= 0 ? { db4: s.word0, x: s.uByte10, y: s.uByte11 } : null));
  const startFear = pool.map((s) => {
    if (s.word0 < 0) return -1;
    return dungeon.getCreatureRecordByIndex(s.word0)?.fear ?? -1;
  });

  // Follow one group's path: the closest to the party.
  let followed = -1;
  let bestDist = 1e9;
  pool.forEach((s, i) => {
    if (s.word0 < 0) return;
    const d = Math.abs(s.uByte10 - px) + Math.abs(s.uByte11 - py);
    if (d < bestDist) { bestDist = d; followed = i; }
  });
  const path: string[] = [];

  for (let t = 0; t < ticks; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    game.timerSystem.processTimers(t);
    if (followed >= 0) {
      const s = pool[followed]!;
      const here = `${s.uByte10},${s.uByte11}`;
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
    const moved = Math.abs(s.uByte10 - s0.x) + Math.abs(s.uByte11 - s0.y);
    const d0 = Math.abs(s0.x - px) + Math.abs(s0.y - py);
    const d1 = Math.abs(s.uByte10 - px) + Math.abs(s.uByte11 - py);
    groupsTotal++;
    if (moved > 0) moversTotal++;
    if (d1 < d0) closedIn++;
    if (rec.fear === StateOfFear.StateOfFear6) inFear6++;
    if (d1 < nearestFinalDist) nearestFinalDist = d1;
    const rt = (dungeon.getCellFlag(new Position(s.uByte10, s.uByte11, level)) >> 5) & 7;
    if (rt === RoomType.STONE) { inWall++; }
    console.log([
      MonsterType[rec.creatureType] ?? rec.creatureType,
      `(${s0.x},${s0.y})`,
      `(${s.uByte10},${s.uByte11})`,
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
