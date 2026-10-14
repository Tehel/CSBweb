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
 * Run: `npm test -- --only=dump-monster-perception.ts [level] [partyX] [partyY]`
 */
import { CsbRandom } from '../src/core/random';
import { Position, RoomType } from '../src/core/types';
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
import { monsterSightDistance } from '../src/data/tables/MonsterDesc';
import { graphicsTablesOf, newContext, stockDungeon, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';
import type { PartyState } from '../src/engine/gameTypes';
import { standInOf } from './lib/standIn';

const DIRS = ['N', 'E', 'S', 'W'];

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;

  const dungeon = new DungeonState(data);
  const level = Number(process.argv[2] ?? 2);
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`no level ${level}`);

  const party = standInOf<PartyState>({ position: new Position(0, 0, level), champions: [], brightness: 0 });
  const random = new CsbRandom(0x12345678);
  const timers = new TimerQueue();
  const footprints = new PartyFootprints();
  const ctx = newContext(data, graphics, { dungeon, timers, random, footprints });
  ctx.party.state = party;
  const monsters = new MonsterSystem(ctx);
  monsters.loadPartyLevel(level);

  const perception = new MonsterPerception(ctx);

  const pool = dungeon.getItem16Pool();
  const active = pool.map((slot, index) => ({ slot, index })).filter((e) => e.slot.word0 >= 0);

  // Put the party next to the first group, so at least one monster should see it.
  const first = active[0];
  if (!first) { console.log(`level ${level} has no monsters`); return; }
  const px = Number(process.argv[3] ?? first.slot.uByte10);
  const py = Number(process.argv[4] ?? first.slot.uByte11 + 1);
  party.position = standInOf<Position>({ x: px, y: py, z: level });

  console.log(`level ${level}, party at (${px},${py}), ${active.length} group(s)`);
  console.log('');
  console.log(['type', 'at', 'dist', 'sees', 'smell->', 'moves', 'walls'].join('\t'));

  let inconsistent = 0;
  let examined = 0;
  let sawParty = 0;
  let sightViolations = 0;
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

    // Sight is range-limited: a monster that reports seeing the party from beyond its
    // own `sightDistance` means the range gate is not being applied.
    examined++;
    if (sees !== 0) {
      sawParty++;
      if (dist > monsterSightDistance(desc)) {
        console.log(`  !! ${MonsterType[rec.creatureType] ?? rec.creatureType} at (${mx},${my}) ` +
          `sees the party at ${dist}, beyond its sightDistance ${monsterSightDistance(desc)}`);
        sightViolations++;
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
  check(examined > 0, `at least one group was probed (got ${examined})`);
  check(inconsistent === 0, `no monster claimed a move into stone (${inconsistent} did)`);
  check(sightViolations === 0, `no monster saw the party from beyond its sightDistance (${sightViolations} did)`);
  check(sawParty > 0, `at least one monster saw the party (${sawParty} of ${examined})`);
  finish();
}

main();
