/**
 * A frame that throws is CSBWin's `die` (`doc/CSBwin-src/CSBCode.cpp:96-122`): the engine
 * throws where CSBWin calls it — the timer table full, a `MissileTimer` placement, a
 * `_FusionSequence` with no monster ahead — and CSBWin shows the message and quits. The
 * loop (`Game.gameLoop`) stops, schedules no further frame, and hands the error to
 * `GameHost.die`, which the page reports. A host that leaves `die` out gets the error
 * thrown again, so nothing swallows it.
 *
 * Run: `npx tsx tools/dump-loop-die.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { createGameHost } from '../src/engine/GameHost';
import { newGame, stockGraphics } from './lib/game';
import { standIn } from './lib/standIn';

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
}

const data = new DungeonLoader().loadFromArray(
  new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))),
);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A game whose `failOn`-th frame throws; how many frames ran, and what `die` received. */
async function run(failOn: number): Promise<{ frames: number; died: unknown[]; thrown: Error }> {
  const died: unknown[] = [];
  const game = newGame(data, stockGraphics(), { die: (error) => died.push(error) });
  const thrown = new Error(`die(45) on frame ${failOn}`);
  let frames = 0;
  standIn(game, 'runFrame', () => {
    if (++frames === failOn) throw thrown;
  });
  game.start();
  // The frames up to the throw, then 150 ms more: a loop that went on would run nine.
  await wait(1000 / 60 * failOn + 150);
  game.stop();
  return { frames, died, thrown };
}

async function main(): Promise<void> {
  for (const failOn of [1, 3]) {
    const { frames, died, thrown } = await run(failOn);
    console.log(`frame ${failOn} throws: ${frames} frames ran, die called ${died.length} time(s)`);
    check(frames === failOn, `frame ${failOn}: no frame runs after the one that threw`);
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

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

void main();
