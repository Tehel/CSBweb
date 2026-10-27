/**
 * `SetTimer`'s sequence stamp across the 16-bit wrap, and across a save.
 *
 * `SetTimer` stamps each timer it queues with `m_timerSequence++`
 * (`doc/CSBwin-src/Timer.cpp:1189`), a `ui16` (`Data.h:1557`) that breaks ties between
 * timers due on the same tick (`TIMER::operator<`, `Timer.cpp:787`, `:804`). The timer that finds
 * the counter at 0xffff first repacks the stamps in use (`:1136-1188`): stamps are cut
 * into pages of 32, the pages in use are renumbered 0, 1, 2… in their order, and each
 * stamp keeps its offset in its page. The counter is not reset, so that timer takes
 * 0xffff and the next one 0, which sorts before every repacked stamp.
 *
 * Five timers are left queued at stamps 5, 40, 1000, 1023 and 65534 (pages 0, 1, 31, 31
 * and 2047), all due on the same tick with the same function, so only the stamp orders
 * them. The repack must give 5, 40, 72, 95 and 126, the timer queued at 0xffff must keep
 * it, and the two after it must take 0 and 1 and go to the front. Then the same queue is
 * restored, as the runtime state and from a save file, into a fresh game: the stamps,
 * the order and the counter must come back, so the next timer lands where it would have.
 *
 * Run: `npm test -- --only=timer-sequence.ts`
 */
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { TimerFunction, TimerQueue, timerLess } from '../../src/engine/TimerQueue';
import { stockGame } from '../lib/game';
import { check, finish } from '../lib/check';

/** The tick every labelled timer is due on, and the level they are on. */
const DUE = 1000;
const LEVEL = 0;

/** Queue and delete throwaway timers until the counter reads `sequence`. */
function advanceTo(q: TimerQueue, sequence: number): void {
  while (q.getNextSequence() !== sequence) {
    const filler = q.createTimer({ function: TimerFunction.TT_LIGHT, time: 1, level: LEVEL });
    q.deleteTimer(filler.index);
  }
}

/** A timer due on `DUE`, told apart from its peers by `uByte6`. */
function label(q: TimerQueue, name: number): number {
  return q.createTimer({ function: TimerFunction.TT_LIGHT, uByte6: name, time: DUE, level: LEVEL }).sequence;
}

/** The labelled timers in their firing order, `timerLess`'s, with their stamps. */
function labelled(q: TimerQueue): string {
  return q.getTimers().filter((t) => t.time === DUE).sort((a, b) => (timerLess(a, b) ? -1 : 1))
    .map((t) => `${t.uByte6}@${t.sequence}`).join(' ');
}

/**
 * Leave five timers queued at stamps 5, 40, 1000, 1023 and 65534 (named by their old
 * stamp's page and offset: 1-5), then queue three more across the wrap (6-8).
 */
function wrap(q: TimerQueue): number[] {
  const stamps: number[] = [];
  for (const [name, at] of [[1, 5], [2, 40], [3, 1000], [4, 1023], [5, 65534]] as const) {
    advanceTo(q, at);
    stamps.push(label(q, name));
  }
  for (const name of [6, 7, 8]) stamps.push(label(q, name));
  return stamps;
}

// 1. The repack, on a bare queue.
{
  const q = new TimerQueue();
  const stamps = wrap(q);
  console.log(`1. stamped ${stamps.join(', ')}; queue ${labelled(q)}; next ${q.getNextSequence()}`);
  const byName = new Map(q.getTimers().map((t) => [t.uByte6, t.sequence]));
  const repacked = [1, 2, 3, 4, 5].map((name) => byName.get(name));
  check(stamps.slice(0, 5).join() === '5,40,1000,1023,65534', `1: the five are stamped as set up (${stamps.slice(0, 5)})`);
  check(repacked.join() === '5,40,72,95,126',
    `1: the repack moves pages 0, 1, 31, 2047 to 0, 1, 2, 3 (${repacked.join()}; expected 5,40,72,95,126)`);
  check(stamps[5] === 0xffff, `1: the timer that repacks takes 0xffff (${stamps[5]})`);
  check(stamps[6] === 0 && stamps[7] === 1, `1: the counter wraps to 0 (${stamps[6]}, ${stamps[7]})`);
  check(q.getNextSequence() === 2, `1: and reads 2 after them (${q.getNextSequence()})`);
  check(labelled(q) === '7@0 8@1 1@5 2@40 3@72 4@95 5@126 6@65535',
    `1: the wrapped two go first and 0xffff last (${labelled(q)})`);
}

// 2. A duplicate that SetTimer drops returns before the repack (Timer.cpp:1011-1125).
{
  const q = new TimerQueue();
  q.createTimer({
    function: TimerFunction.TT_DOOR_STEP, uByte6: 3, uByte7: 3, time: DUE, level: LEVEL,
  }); // stamp 0
  advanceTo(q, 1000);
  label(q, 1);
  advanceTo(q, 0xffff);
  q.createTimer({
    function: TimerFunction.TT_DOOR_STEP, uByte6: 3, uByte7: 3, uByte9: 1, time: DUE, level: LEVEL,
  }); // clashes, dropped
  check(q.getNextSequence() === 0xffff && labelled(q).includes('1@1000'),
    `2: a dropped duplicate neither repacks nor consumes 0xffff (next ${q.getNextSequence()}; ${labelled(q)})`);
}

// 3. Across a save.
function loadWorld(): Game {
  return stockGame();
}

function queueOf(game: Game): string {
  return game.ctx.timers.getTimers().map((t) => `${t.index}:${t.function}/${t.uByte6}@${t.sequence}`).join(' ');
}

const source = loadWorld();
wrap(source.ctx.timers);
const before = queueOf(source);
const nextBefore = source.ctx.timers.getNextSequence();
console.log(`3. before the save: next ${nextBefore}; queue ${labelled(source.ctx.timers)}`);

const quick = loadWorld();
quick.applyRuntimeSaveState(JSON.parse(JSON.stringify(source.getRuntimeSaveState())));
const file = loadWorld();
applyCsbwinSave(file, buildSaveFile(source));

label(source.ctx.timers, 9);
const expected = labelled(source.ctx.timers);
for (const [name, game] of [['runtime state', quick], ['save file', file]] as const) {
  check(queueOf(game) === before, `3/${name}: every timer's slot, stamp and place come back (${labelled(game.ctx.timers)})`);
  check(game.ctx.timers.getNextSequence() === nextBefore,
    `3/${name}: so does the counter (${game.ctx.timers.getNextSequence()}; expected ${nextBefore})`);
  label(game.ctx.timers, 9);
  check(labelled(game.ctx.timers) === expected,
    `3/${name}: the next timer lands where it does without the save (${labelled(game.ctx.timers)})`);
}
console.log(`   after one more timer: ${expected}`);

finish();
