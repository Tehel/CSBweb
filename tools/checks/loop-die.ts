/**
 * A frame that throws is CSBWin's `die` (`doc/CSBwin-src/CSBCode.cpp:96-122`): the engine
 * throws where CSBWin calls it — the timer table full, a `MissileTimer` placement, a
 * `_FusionSequence` with no monster ahead — and CSBWin shows the message and quits. The
 * loop (`Game.gameLoop`) stops, schedules no further frame, and hands the error to
 * `GameHost.die`, which the page reports. A host that leaves `die` out gets the error
 * thrown again, so nothing swallows it.
 *
 * Run: `npm test -- --only=loop-die.ts`
 */

import { createGameHost } from '../../src/engine/GameHost';
import { check, finish } from '../lib/check';
import { ManualClock } from '../lib/clock';
import { newGame, stockGraphics, stockDungeon } from '../lib/game';
import { standIn } from '../lib/standIn';

const data = stockDungeon();

/** A game whose `failOn`-th frame throws; how many frames ran, and what `die` received. */
function run(failOn: number): { frames: number; died: unknown[]; thrown: Error; called: boolean } {
  const died: unknown[] = [];
  const clock = new ManualClock();
  const game = newGame(data, stockGraphics(), { die: (error) => died.push(error), clock });
  const thrown = new Error(`die(45) on frame ${failOn}`);
  let frames = 0;
  standIn(game, 'runFrame', () => {
    if (++frames === failOn) throw thrown;
  });
  game.start();
  // A VBL's time per call, up to the throw, then nine more: a loop that went on would run them.
  for (let n = 0; n < failOn + 9; n++) clock.advance(17);
  const called = clock.pending !== null;
  game.stop();
  return { frames, died, thrown, called };
}

function main(): void {
  for (const failOn of [1, 3]) {
    const { frames, died, thrown, called } = run(failOn);
    console.log(`frame ${failOn} throws: ${frames} frames ran, die called ${died.length} time(s)`);
    check(frames === failOn && !called, `frame ${failOn}: no frame runs after the one that threw, and no call is asked for`);
    check(died.length === 1 && died[0] === thrown, `frame ${failOn}: the host's die receives the error, once`);
  }

  let rethrown = false;
  const error = new Error('no host');
  try {
    createGameHost().die(error);
  } catch (e) {
    rethrown = e === error;
  }
  check(rethrown, 'a host without die throws the error again');

  finish();
}

main();
