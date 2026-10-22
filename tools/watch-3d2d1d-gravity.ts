/**
 * 3D2D1D's gravity, on the real dungeon, through `Game`'s loop:
 * `MoveParty` records the move and starts a slide (`doc/CSBwin-src/CSBCode.cpp:8128-8170`),
 * and while `gravityMove` is set `HandleMouseEvents` throws the queue away and takes
 * `GravityMove`'s step (`Mouse.cpp:1259-1370`, `:1482-1491`), until no axis is left.
 *
 * 1. **The walkthrough's first two legs** (`doc/3D2D1D_WALKTHROUGH.md`, "1.
 *    The champion" and "2. Open the 3D maze"), facing north: each press is one move and
 *    its slide, and comes to rest where the walkthrough says. The second leg has a
 *    champion, as the walkthrough's has AIRWING, and its `S!` bumps the wall and is a
 *    move all the same: the slide that follows goes back the way of the history.
 * 2. **The move history** after each press of the first leg, worked by hand from
 *    `MoveParty`'s table (`:8150-8153`).
 * 3. **The input during a slide** is thrown away: a step queued mid-slide is never taken.
 * 4. **A game read** starts the gravity afresh, `{0,1,2,0}` and at rest (`DEBT.md` H).
 *
 * Run: `npm test -- --only=watch-3d2d1d-gravity.ts`
 */
import { readFileSync } from 'node:fs';

import { emptyDungeonData } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Position } from '../src/core/types';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import type { Game } from '../src/engine/Game';
import { MovementAction } from '../src/engine/gameTypes';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { newGame, runVbl, TICK_DUE } from './lib/game';

const DIR = 'tools/fixtures/gamefiles/3D2D1D';
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(`${DIR}/${name}`));
const graphics = new GraphicsLoader();
graphics.loadFromArray(read('graphics.dat'));

const at = (p: Position): string => `${p.z}:${p.x},${p.y}`;

/** What `press` hears of each move `MoveParty` makes, the player's and gravity's. */
let onEachMove: (() => void) | null = null;

function fresh(): Game {
  const game = newGame(emptyDungeonData(), graphics);
  game.readDungeonDat(read('dungeon.dat'));
  game.setRandomSeed(0x3d2d1d);
  game.onMove(() => onEachMove?.());
  return game;
}

/** Facing north, as the walkthrough says to stay: N steps forward, S back, W and E strafe. */
const COMPASS: Record<string, MovementAction> = {
  N: MovementAction.MOVE_FORWARD,
  S: MovementAction.MOVE_BACKWARD,
  W: MovementAction.STRAFE_LEFT,
  E: MovementAction.STRAFE_RIGHT,
  Dn: MovementAction.MOVE_DOWN,
  Up: MovementAction.MOVE_UP,
};

/** Whether the party is at rest: no slide, nothing queued, no level waiting to load. */
const atRest = (game: Game): boolean =>
  !game.ctx.loop.gravityMove && game.ctx.mouseQueue.count() === 0 && game.ctx.loop.newPartyLevel === -1;

/**
 * One press, then a tick every VBL until the party is at rest. `during`, when given, runs
 * after the slide's first gravity step: what it queues is the player's input mid-slide.
 * The number of gravity steps taken.
 */
function press(game: Game, action: MovementAction, during?: () => void): number {
  game.enqueueMovement(action);
  let steps = 0;
  onEachMove = () => {
    if (steps++ === 1) during?.();
  };
  for (let vbl = 0; vbl < 2000 && (vbl < 2 || !atRest(game)); vbl++) runVbl(game, TICK_DUE);
  onEachMove = null;
  check(atRest(game), 'the slide comes to rest');
  return Math.max(0, steps - 1);
}

/** `press` for each move of a walkthrough line, `E→0:8,0` or `S!→0:8,0`, checking where it rests. */
function leg(game: Game, line: string, histories?: string[]): void {
  const moves = line.trim().split(/\s+/);
  moves.forEach((move, i) => {
    const [, dir, , rest] = /^(N|S|W|E|Dn|Up)(!?)→(\d+:\d+,\d+)$/.exec(move)!;
    const before = at(game.ctx.party.state.position);
    const steps = press(game, COMPASS[dir!]!);
    const after = at(game.ctx.party.state.position);
    const history = game.ctx.loop.moveHistory.join(',');
    console.log(`  ${move.padEnd(12)} from ${before}: ${steps} gravity steps, rests at ${after}, history {${history}}`);
    check(after === rest, `${move}: rests at ${rest}`);
    if (histories) check(history === histories[i], `${move}: history {${histories[i]}}`);
  });
}

/* ---------------------------------- 1, 2. the first two legs -------------------------- */
{
  const game = fresh();
  check(game.ctx.rules.bGravityGame, '3D2D1D sets bGravityGame');
  game.ctx.party.setFacing(0);
  const start = game.ctx.party.state.position;
  console.log(`1. "The champion", no party, from ${at(start)} facing north`);
  check(at(start) === '0:3,2', 'the party starts at map 0 (3,2)');
  // E is axis 0 positive, W negative, S axis 1 positive, N negative (`:8150-8153`).
  leg(game, 'E→0:8,0     W→0:7,0     S→0:3,2     E→0:5,3     N→0:9,2',
    ['0,1,2,1', '0,1,2,0', '1,0,2,2', '0,1,2,3', '1,0,2,1']);

  game.ctx.party.state.champions = [testChampion(0)];
  const hp = game.ctx.party.state.champions[0]!.attributes.health;
  console.log('   "2. Open the 3D maze", with a champion');
  leg(game, 'W→0:7,0     E→0:8,0     S!→0:8,0    W→0:7,3');
  const lost = hp - game.ctx.party.state.champions[0]!.attributes.health;
  console.log(`   the champion lost ${lost} HP`);
  check(lost === 2, 'S! is the one bump of the leg: 2 HP off the champion');
}

/* ---------------------------------- 3. the input during a slide ----------------------- */
{
  const game = fresh();
  game.ctx.party.setFacing(0);
  let queued = false;
  // The first leg's E slides from (3,2) to (8,0). A step forward queued mid-slide would
  // be taken at once if the queue kept it.
  const steps = press(game, MovementAction.STRAFE_RIGHT, () => {
    queued = game.enqueueMovement(MovementAction.TURN_RIGHT);
  });
  console.log(`3. a turn queued mid-slide (queued ${queued}): ${steps} gravity steps, rests at ${at(game.ctx.party.state.position)} facing ${game.ctx.party.state.facing}`);
  check(queued && steps > 1, 'the turn is queued while the party slides');
  check(at(game.ctx.party.state.position) === '0:8,0' && game.ctx.party.state.facing === 0,
    'and thrown away: the party rests where it would have, still facing north');
}

/* ---------------------------------- 4. a game read ------------------------------------ */
{
  const game = fresh();
  const file = buildSaveFile(game);
  game.ctx.loop.moveHistory = [2, 1, 0, 7];
  game.ctx.loop.gravityMove = true;
  game.ctx.loop.nextGravityMoveTime = 1000;
  applyCsbwinSave(game, file);
  const loop = game.ctx.loop;
  console.log(`4. a game read over history {2,1,0,7}, sliding: history {${loop.moveHistory.join(',')}}, gravityMove ${loop.gravityMove}, next ${loop.nextGravityMoveTime}`);
  check(loop.moveHistory.join(',') === '0,1,2,0' && !loop.gravityMove && loop.nextGravityMoveTime === 0,
    'a game read starts from the program\'s start: {0,1,2,0}, at rest');
}

finish();
