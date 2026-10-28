/**
 * The party's scents as A22E keeps them, on a set with the Amiga's tables, and as the
 * Atari's program keeps them, on `dm-atari` (`src/engine/PartyFootprints.ts`):
 *
 *  1. `F0317_CHAMPION_AddScentStrength` (ReDMCSB `CHAMPION.C:1472-1525`, `dm`'s hunk 17 at
 *     0x3066) changes a strength only where the print is the square it is given, the
 *     square left and then the square entered (`MOVESENS.C:772`, `:783`). It compares
 *     print `k` and writes strength `N-1-k`, strength 0 included. The Atari's (`START.PAK`
 *     1.2 at `$168e4`, `doc/ATARI_ST_DISK_REFERENCE.md` → "The scents in the program")
 *     ignores the square and writes every strength, 0 included, where CSBWin's
 *     `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4381-4410`) stops before 0. A
 *     party placed on S0 at time 0 walks to S1 at 10, S2 at 30 and S1 at 35; the
 *     strengths, worked by hand from each program, are `[24, 0, 24, 0]` and
 *     `[24, 24, 24, 24]`.
 *  2. The ten-second decay (`CHAMPION.C:2311-2330`, hunk 17 at 0x3c60) spares the print on
 *     the party's square; the Atari's (`$17642`) lowers every print but the newest. Both
 *     go on with the next after dropping the oldest, where CSBWin's
 *     (`doc/CSBwin-src/Code17818.cpp:181-195`) stops.
 *  3. Through `Game`: `dm-amiga`'s trail is A22E's and `dm-atari`'s the Atari's, a move
 *     hands the trail the square it left, and `TenSecondUpdate` the party's square: a walk
 *     P, Q, R, Q, a decay, R, worked by hand.
 *
 * Run: `npm test -- --only=amiga-scents.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { Game } from '../../src/engine/Game';
import { MovementAction } from '../../src/engine/gameTypes';
import { PartyFootprints } from '../../src/engine/PartyFootprints';
import { tenSecondUpdate } from '../../src/engine/PeriodicUpdates';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { newGame, stockGame } from '../lib/game';

const AMIGA = 'tools/fixtures/gamefiles/dm-amiga';
const LEVEL = 1;
const S0 = { x: 3, y: 4 };
const S1 = { x: 3, y: 5 };
const S2 = { x: 4, y: 5 };

const strengths = (trail: PartyFootprints): number[] => Array.from({ length: trail.getCount() }, (_, i) => trail.getAge(i));
const squares = (trail: PartyFootprints): string =>
  Array.from({ length: trail.getCount() }, (_, i) => {
    const print = trail.getPrint(i);
    return `${PartyFootprints.printX(print)},${PartyFootprints.printY(print)}`;
  }).join(' ');

/** The walk of 1: S0 placed at 0, then S1 at 10, S2 at 30 and S1 at 35. */
function walk(byLocation: boolean): PartyFootprints {
  const trail = new PartyFootprints(byLocation);
  trail.recordPartyMove(0, LEVEL, S0.x, S0.y, false);
  trail.recordPartyMove(10, LEVEL, S1.x, S1.y, false, S0.x, S0.y);
  trail.recordPartyMove(30, LEVEL, S2.x, S2.y, false, S1.x, S1.y);
  trail.recordPartyMove(35, LEVEL, S1.x, S1.y, false, S2.x, S2.y);
  return trail;
}

function checkTrails(): void {
  const amiga = walk(true);
  const atari = walk(false);
  console.log(`1. prints ${squares(amiga)}: dm-amiga's strengths ${strengths(amiga).join(' ')}, dm-atari's ${strengths(atari).join(' ')}`);
  check(strengths(amiga).join() === '24,0,24,0', 'the Amiga\'s: only the strengths of the prints on the square, written N-1-k, 0 included');
  check(strengths(atari).join() === '24,24,24,24', 'the Atari\'s: every strength, 0 included, whatever the square');

  // 2. The decay, the party on S1.
  const party = new Position(S1.x, S1.y, LEVEL);
  amiga.ageFootprints(party);
  atari.ageFootprints(party);
  console.log(`2. one decay on S1: dm-amiga's ${strengths(amiga).join(' ')} (${squares(amiga)}), dm-atari's ${strengths(atari).join(' ')} (${squares(atari)})`);
  check(strengths(amiga).join() === '23,0,23,0', 'the Amiga\'s spares the print on the party\'s square');
  check(squares(atari) === '3,4 3,5 4,5 3,5' && strengths(atari).join() === '23,23,23,24', 'the Atari\'s lowers every print but the newest, the party\'s square\'s too');

  // Two prints at 1 then one at 5: both drop both, and lower the next.
  const twice = new PartyFootprints(true);
  for (const [time, x] of [[0, 10], [1, 11], [2, 12], [3, 13]] as const) twice.recordPartyMove(time, LEVEL, x, 1, false, x - 1, 1);
  twice.restore({ ...twice.capture(), ages: [1, 1, 5, 0] });
  const once = new PartyFootprints(false);
  once.restore(twice.capture());
  twice.ageFootprints(party);
  once.ageFootprints(party);
  console.log(`   strengths 1 1 5 0, a decay off the trail: dm-amiga's ${strengths(twice).join(' ')}, dm-atari's ${strengths(once).join(' ')}`);
  check(strengths(twice).join() === '4,0', 'the Amiga\'s goes on after a drop: both prints at 1 go, the next is lowered');
  check(strengths(once).join() === '4,0', 'the Atari\'s goes on after a drop too, where CSBWin\'s stops at the first');
}

/**
 * From P, an open square on level 1, facing south: to Q south of it at 10, R east of Q at
 * 30 and back to Q at 35, a `TenSecondUpdate` there, and R again at 40. The strengths
 * after each.
 */
function walkThrough(game: Game): string {
  const party = game.ctx.party.state;
  party.champions = [testChampion(0)];
  const level = LEVEL;
  const open = (x: number, y: number): boolean => (game.ctx.dungeon.getCellFlag(new Position(x, y, level)) >> 5) === RoomType.OPEN;
  const monsterAt = (x: number, y: number): boolean => game.ctx.dungeon.findFirstMonster(new Position(x, y, level)) !== OBJECT_ID_EOF;
  const map = game.ctx.dungeon.getMap(level)!;
  let at: { x: number; y: number } | null = null;
  for (let x = 1; x < map.descriptor.width - 1 && !at; x++) {
    for (let y = 1; y < map.descriptor.height - 1 && !at; y++) {
      if ([[x, y], [x, y + 1], [x + 1, y + 1]].every(([sx, sy]) => open(sx!, sy!) && !monsterAt(sx!, sy!))) at = { x, y };
    }
  }
  if (!at) throw new Error('no open squares to walk');
  game.ctx.footprints.restore(new PartyFootprints().capture());
  party.position = new Position(at.x, at.y, level);
  game.loadNewPartyLevel();
  game.ctx.party.setFacing(Direction.SOUTH);
  const trail = game.ctx.footprints;
  const rows = [`P ${at.x},${at.y}`];
  const step = (time: number, action: MovementAction, name: string): void => {
    game.ctx.state.tickCount = time;
    game.move(action);
    rows.push(`${name} ${party.position.x},${party.position.y}: ${strengths(trail).join(' ')}`);
  };
  step(10, MovementAction.MOVE_FORWARD, 'Q');
  step(30, MovementAction.STRAFE_LEFT, 'R');
  step(35, MovementAction.STRAFE_RIGHT, 'Q');
  tenSecondUpdate(game.ctx);
  rows.push(`decay: ${strengths(trail).join(' ')}`);
  step(40, MovementAction.STRAFE_LEFT, 'R');
  return rows.join(' | ');
}

function checkGames(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(AMIGA, 'graphics.dat'))));
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(AMIGA, 'dungeon.dat'))));
  const amiga = walkThrough(newGame(data, graphics)).split(' | ');
  const atari = walkThrough(stockGame()).split(' | ');
  console.log(`3. dm-amiga ${amiga.join(' | ')}`);
  console.log(`   dm-atari ${atari.join(' | ')}`);
  const tail = (rows: string[]): string => rows.slice(1).map((row) => row.replace(/^[QR] \d+,\d+: /, '')).join(' | ');
  // The trail starts empty. R at 30 raises Q's print, the square left, to 44 (24 without
  // the square); back on Q, the merge sets both of Q's prints' strengths, 2 and 0, to 24;
  // the decay spares them; R at 40 raises them, the square left, to 29. On dm-atari every
  // strength takes each value: 44 then 24 at R, 29 then 24 at Q, 23 but the newest at the
  // decay, 28 then 24 at R.
  check(tail(amiga) === '24 | 44 0 | 24 0 24 | decay: 24 0 24 | 29 0 29 0',
    'dm-amiga: the walk\'s strengths are A22E\'s, the square left counts, and the decay spares the party\'s square');
  check(tail(atari) === '24 | 24 24 | 24 24 24 | decay: 23 23 24 | 24 24 24 24',
    'dm-atari: the Atari\'s, one value along the trail, and the decay lowers all but the newest');
}

function main(): void {
  checkTrails();
  checkGames();
  finish();
}

main();
