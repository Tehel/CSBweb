/**
 * The party's scents (`src/engine/PartyFootprints.ts`) by each of their three rules
 * (`ScentRule`): what FTL meant, which every set plays from level 2 (`DEBT.md` H, "The
 * scents are what FTL meant"); the release's, before it (`releaseScentLoops`); and
 * CSBWin's, which its profiles play (`csbwinScentLoops`).
 *
 *  1. A step. What FTL meant adds the time spent on the square left to the strengths of
 *     its prints, each its own, up to 80, and puts the new print at 24. The release's
 *     `F0317_CHAMPION_AddScentStrength` (ReDMCSB `CHAMPION.C:1472-1525`) is called with
 *     the square left and then the square entered (`MOVESENS.C:772`, `:783`), compares
 *     print `k` and writes strength `N-1-k`, strength 0 included: A22E's (`dm`'s hunk 17 at
 *     0x3066) only where the print is the square, the Atari's (`START.PAK` 1.2 at
 *     `$168e4`, `doc/ATARI_ST_DISK_REFERENCE.md` → "The scents in the program") whatever
 *     the square. CSBWin's `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4383-4410`) is
 *     the Atari's, but stops before strength 0. A party placed on S0 at time 0 walks to S1
 *     at 10, S2 at 30 and S1 at 35; the strengths, worked by hand from each rule.
 *  2. The ten-second decay. What FTL meant and A22E's (`CHAMPION.C:2311-2330`, hunk 17 at
 *     0x3c60) spare the print on the party's square; the Atari's (`$17642`) and CSBWin's
 *     (`doc/CSBwin-src/Code17818.cpp:181-195`) lower every print but the newest. All go on
 *     with the next after dropping the oldest, but CSBWin's, which stops.
 *  3. Through `Game`: the rule the engine's behaviour chooses, at level 2 what FTL meant on
 *     `dm-amiga` and `dm-atari` alike, at level 1 each set's release, and at the
 *     `csbwin-2023` profile CSBWin's; a move hands the trail the square it left, and
 *     `TenSecondUpdate` the party's square: a walk P, Q, R, Q, a decay, R, worked by hand.
 *
 * Run: `npm test -- --only=scents.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { behaviourAt, ENGINE_LEVEL } from '../../src/engine/Behaviour';
import type { Game } from '../../src/engine/Game';
import { MovementAction } from '../../src/engine/gameTypes';
import { PartyFootprints, type ScentRule } from '../../src/engine/PartyFootprints';
import { tenSecondUpdate } from '../../src/engine/PeriodicUpdates';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { newGame, stockGame } from '../lib/game';

const AMIGA = 'tools/fixtures/gamefiles/dm-amiga';
const LEVEL = 1;
const S0 = { x: 3, y: 4 };
const S1 = { x: 3, y: 5 };
const S2 = { x: 4, y: 5 };

const strengths = (trail: PartyFootprints): string => Array.from({ length: trail.getCount() }, (_, i) => trail.getAge(i)).join(' ');
const squares = (trail: PartyFootprints): string =>
  Array.from({ length: trail.getCount() }, (_, i) => {
    const print = trail.getPrint(i);
    return `${PartyFootprints.printX(print)},${PartyFootprints.printY(print)}`;
  }).join(' ');

/** The trails of 1: what FTL meant, A22E's, the Atari's and CSBWin's. */
const TRAILS: readonly { name: string; byLocation: boolean; rule: ScentRule }[] = [
  { name: 'meant', byLocation: false, rule: 'meant' },
  { name: 'amiga', byLocation: true, rule: 'release' },
  { name: 'atari', byLocation: false, rule: 'release' },
  { name: 'csbwin', byLocation: false, rule: 'csbwin' },
];

/** The walk of 1: S0 placed at 0, then S1 at 10, S2 at 30 and S1 at 35. */
function walk(byLocation: boolean, rule: ScentRule): PartyFootprints {
  const trail = new PartyFootprints(byLocation);
  trail.recordPartyMove(0, LEVEL, S0.x, S0.y, false, -1, -1, LEVEL, rule);
  trail.recordPartyMove(10, LEVEL, S1.x, S1.y, false, S0.x, S0.y, LEVEL, rule);
  trail.recordPartyMove(30, LEVEL, S2.x, S2.y, false, S1.x, S1.y, LEVEL, rule);
  trail.recordPartyMove(35, LEVEL, S1.x, S1.y, false, S2.x, S2.y, LEVEL, rule);
  return trail;
}

function checkTrails(): void {
  const party = new Position(S1.x, S1.y, LEVEL);
  const walked: Record<string, string> = {};
  const decayed: Record<string, string> = {};
  const dropped: Record<string, string> = {};
  for (const { name, byLocation, rule } of TRAILS) {
    const trail = walk(byLocation, rule);
    walked[name] = strengths(trail);
    trail.ageFootprints(party, rule);
    decayed[name] = `${strengths(trail)} (${squares(trail)})`;
    // Two prints at 1 then one at 5, a decay off the trail.
    const four = new PartyFootprints(byLocation);
    for (const [time, x] of [[0, 10], [1, 11], [2, 12], [3, 13]] as const) four.recordPartyMove(time, LEVEL, x, 1, false, x - 1, 1, LEVEL, rule);
    four.restore({ ...four.capture(), ages: [1, 1, 5, 0] });
    four.ageFootprints(party, rule);
    dropped[name] = strengths(four);
  }
  console.log(`1. prints ${squares(walk(false, 'meant'))}: ${TRAILS.map(({ name }) => `${name} ${walked[name]}`).join(', ')}`);
  // What FTL meant: S0 at 24 gains the 10 spent there, S1 the 20, S2 the 5.
  check(walked.meant === '34 44 29 24', 'what FTL meant: each print on the square left gains the time spent, the new one is at 24');
  check(walked.amiga === '24 0 24 0', 'the Amiga\'s: only the strengths of the prints on the square, written N-1-k, 0 included');
  check(walked.atari === '24 24 24 24', 'the Atari\'s: every strength, 0 included, whatever the square');
  check(walked.csbwin === '0 24 24 24', 'CSBWin\'s: every strength but the oldest, which stays 0');

  console.log(`2. one decay on S1: ${TRAILS.map(({ name }) => `${name} ${decayed[name]}`).join(', ')}`);
  check(decayed.meant === '33 44 28 24 (3,4 3,5 4,5 3,5)', 'what FTL meant spares the newest print and the party\'s square\'s');
  check(decayed.amiga === '23 0 23 0 (3,4 3,5 4,5 3,5)', 'the Amiga\'s spares the print on the party\'s square');
  check(decayed.atari === '23 23 23 24 (3,4 3,5 4,5 3,5)', 'the Atari\'s lowers every print but the newest, the party\'s square\'s too');
  check(decayed.csbwin === '24 24 24 (3,5 4,5 3,5)', 'CSBWin\'s drops the oldest at 0 and stops');

  console.log(`   strengths 1 1 5 0, a decay off the trail: ${TRAILS.map(({ name }) => `${name} ${dropped[name]}`).join(', ')}`);
  check(dropped.meant === '4 0' && dropped.amiga === '4 0' && dropped.atari === '4 0',
    'what FTL meant and the releases go on after a drop: both prints at 1 go, the next is lowered');
  check(dropped.csbwin === '1 5 0', 'CSBWin\'s stops after the first drop');
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
  const rows: string[] = [];
  const step = (time: number, action: MovementAction, name: string): void => {
    game.ctx.state.tickCount = time;
    game.move(action);
    rows.push(`${name}: ${strengths(trail)}`);
  };
  step(10, MovementAction.MOVE_FORWARD, 'Q');
  step(30, MovementAction.STRAFE_LEFT, 'R');
  step(35, MovementAction.STRAFE_RIGHT, 'Q');
  tenSecondUpdate(game.ctx);
  rows.push(`decay: ${strengths(trail)}`);
  step(40, MovementAction.STRAFE_LEFT, 'R');
  return rows.join(' | ');
}

function checkGames(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(AMIGA, 'graphics.dat'))));
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(AMIGA, 'dungeon.dat'))));
  const amigaGame = (): Game => newGame(data, graphics);
  const at = (game: Game, level: number, profile: string | null = null): Game => {
    game.ctx.behaviour = behaviourAt(level, profile);
    return game;
  };
  const amiga = walkThrough(at(amigaGame(), ENGINE_LEVEL));
  const atari = walkThrough(at(stockGame(), ENGINE_LEVEL));
  const amiga1 = walkThrough(at(amigaGame(), 1));
  const atari1 = walkThrough(at(stockGame(), 1));
  const csbwin = walkThrough(at(stockGame(), ENGINE_LEVEL, 'csbwin-2023'));
  console.log(`3. level ${ENGINE_LEVEL}: dm-amiga ${amiga}`);
  console.log(`   level ${ENGINE_LEVEL}: dm-atari ${atari}`);
  console.log(`   level 1: dm-amiga ${amiga1}`);
  console.log(`   level 1: dm-atari ${atari1}`);
  console.log(`   csbwin-2023: dm-atari ${csbwin}`);
  // The trail starts empty, so Q's print is the first. What FTL meant: R at 30 raises Q's
  // print by the 20 spent there; Q at 35, R's by 5; the decay spares Q's, the party's,
  // and the newest; R at 40 raises both of Q's by 5.
  const meant = 'Q: 24 | R: 44 24 | Q: 44 29 24 | decay: 44 28 24 | R: 49 28 29 24';
  check(ENGINE_LEVEL === 2 && amiga === meant && atari === meant,
    `level ${ENGINE_LEVEL}: what FTL meant on dm-amiga and dm-atari alike, the square left on its level, the decay sparing the party's square`);
  // A22E's: R at 30 raises Q's print, the square left, to 44; back on Q, the merge sets
  // both of Q's prints' strengths, 2 and 0, to 24; the decay spares them; R at 40 raises
  // them, the square left, to 29. The Atari's: every strength takes each value: 44 then 24
  // at R, 29 then 24 at Q, 23 but the newest at the decay, 28 then 24 at R.
  check(amiga1 === 'Q: 24 | R: 44 0 | Q: 24 0 24 | decay: 24 0 24 | R: 29 0 29 0',
    'level 1, dm-amiga: A22E\'s, the square left counts, and the decay spares the party\'s square');
  check(atari1 === 'Q: 24 | R: 24 24 | Q: 24 24 24 | decay: 23 23 24 | R: 24 24 24 24',
    'level 1, dm-atari: the Atari\'s, one value along the trail, and the decay lowers all but the newest');
  // CSBWin's: the oldest stays 0 and the first decay drops it.
  check(csbwin === 'Q: 0 | R: 0 24 | Q: 0 24 24 | decay: 24 24 | R: 24 24 24',
    'csbwin-2023: CSBWin\'s loops, strength 0 never written, the decay stopping after its drop');
}

function main(): void {
  checkTrails();
  checkGames();
  finish();
}

main();
