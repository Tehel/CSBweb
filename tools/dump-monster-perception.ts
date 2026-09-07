/**
 * Exercise the monster perception layer against the real dungeon.
 *
 * Sight, smell and the "can I step there" probe have no visible effect until the AI
 * state machine consumes them, so this drives them directly: for each active monster
 * group on a level it reports whether it can see a party standing at a given square,
 * how far, which way it would prefer to face, and which of the four directions it
 * could actually move in.
 *
 * The useful check is not any single number but that the answers are *consistent*
 * with the map: a monster three cells down an open corridor sees the party, one
 * behind a stone wall does not, and no monster claims a move into a wall.
 *
 * Run: `npx tsx tools/dump-monster-perception.ts [level] [partyX] [partyY]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { MonsterSystem } from '../src/engine/MonsterSystem';
import {
  MonsterPerception,
  distanceBetweenPoints,
  getPrimaryAndSecondaryDirection,
  makeMoveProbeState,
} from '../src/engine/MonsterPerception';
import { PartyFootprints } from '../src/engine/PartyFootprints';
import { TimerQueue } from '../src/engine/TimerQueue';
import { MonsterType } from '../src/engine/monsterTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import type { PartyState } from '../src/engine/gameTypes';

const DIRS = ['N', 'E', 'S', 'W'];

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

  const dungeon = new DungeonState(data);
  const level = Number(process.argv[2] ?? 2);
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`no level ${level}`);

  const party = { position: { x: 0, y: 0, z: level } } as PartyState;
  const random = new CsbRandom(0x12345678);
  const timers = new TimerQueue();
  let time = 0;
  const monsters = new MonsterSystem(
    dungeon, () => party, timers, () => time, random,
    { monsterDesc: objectTables.monsterDesc }, { trace: () => {} },
  );
  monsters.loadPartyLevel(level);

  const footprints = new PartyFootprints();
  const perception = new MonsterPerception(
    dungeon,
    () => party.position.z,
    random,
    footprints,
    () => objectTables.monsterDesc,
    () => objectTables.doorCharacteristics,
  );

  const pool = dungeon.getItem16Pool();
  const active = pool.map((slot, index) => ({ slot, index })).filter((e) => e.slot.word0 >= 0);

  // Put the party next to the first group, so at least one monster should see it.
  const first = active[0];
  if (!first) { console.log(`level ${level} has no monsters`); return; }
  const px = Number(process.argv[3] ?? first.slot.uByte10);
  const py = Number(process.argv[4] ?? first.slot.uByte11 + 1);
  party.position = { x: px, y: py, z: level } as Position;

  console.log(`level ${level}, party at (${px},${py}), ${active.length} group(s)`);
  console.log('');
  console.log(['type', 'at', 'dist', 'sees', 'smell->', 'moves', 'walls'].join('\t'));

  let inconsistent = 0;
  for (const { slot, index } of active) {
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) continue;
    const desc = objectTables.monsterDesc[rec.creatureType];
    if (!desc) continue;
    const mx = slot.uByte10;
    const my = slot.uByte11;
    const dist = distanceBetweenPoints(mx, my, px, py);
    const dirs = getPrimaryAndSecondaryDirection(random, mx, my, px, py);

    const sees = perception.blocked(rec, -1, level, mx, my, {
      partyX: px, partyY: py, partyInvisible: false, currentPalette: 0,
      orthogonalDistanceToParty: dist,
    });

    const smell = perception.getBestMonsterFacing(desc, level, mx, my, {
      partyX: px, partyY: py, orthogonalDistanceToParty: dist,
      primaryDirectionToParty: dirs.primary, secondaryDirectionToParty: dirs.secondary,
    });

    const state = makeMoveProbeState(px, py);
    const moves: string[] = [];
    const walls: string[] = [];
    for (let d = 0; d < 4; d++) {
      state.directionHasBeenTested.fill(0);
      const probe = perception.possibleMove(
        slot.word0 as never, desc, level, mx, my, d, false, state,
      );
      const nx = mx + [0, 1, 0, -1][d]!;
      const ny = my + [-1, 0, 1, 0][d]!;
      const inBounds = nx >= 0 && ny >= 0 && nx < map.descriptor.width && ny < map.descriptor.height;
      const rt = inBounds ? (dungeon.getCellFlag(new Position(nx, ny, level)) >> 5) & 7 : RoomType.STONE;
      if (probe.possible) moves.push(DIRS[d]!);
      if (rt === RoomType.STONE) walls.push(DIRS[d]!);
      // The invariant worth checking: never a legal move into solid stone.
      if (probe.possible && rt === RoomType.STONE) {
        console.log(`  !! group at (${mx},${my}) claims a move ${DIRS[d]} into STONE`);
        inconsistent++;
      }
    }

    console.log([
      `${MonsterType[rec.creatureType] ?? rec.creatureType}`,
      `(${mx},${my})`,
      dist,
      sees === 0 ? '-' : `yes@${sees}`,
      smell.direction === 0 ? '-' : DIRS[smell.direction - 1],
      moves.join('') || '-',
      walls.join('') || '-',
    ].join('\t'));
    void index;
  }

  console.log('');
  console.log(inconsistent === 0
    ? 'CONSISTENT: no monster claimed a move into stone'
    : `PROBLEMS: ${inconsistent} illegal move(s) reported`);
}

main();
