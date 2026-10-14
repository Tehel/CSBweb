/**
 * Prove the timer queue is CSBWin's binary heap: the same order, the same array.
 *
 * CSBWin's `m_timerQueue` is a min-heap over `TIMER::operator<`
 * (`doc/CSBwin-src/Timer.cpp:765-810`), kept by `AdjustTimerQueue` (`:831-896`) as
 * `SetTimer`, `DeleteTimer` and `GetNextTimerEntry` change it, and a save carries the
 * array as it stood (`SaveGame.cpp:1819-1825`). What is invisible without this:
 *
 * 1. **CSBWin's own heaps.** Every committed save's queue is checked with `CheckTimers`'
 *    test (`Timer.cpp:932-953`) under the port's `timerLess`. The saves were written by
 *    CSBWin, so an `operator<` ported with a tie-break wrong would find a child "less" than
 *    its parent somewhere. The canaries run the same test under three wrong comparators,
 *    and each fails on some file, so the test can tell. The files' queues are not sorted,
 *    which is what a sorted-list port got wrong.
 * 2. **The firing order.** `csbgame7.dat`'s queue is drained through `shiftNext`: every
 *    timer taken is `timerLess` than or equal to all that remain, the order is the saved
 *    timers sorted by `timerLess`, and the rest is still a heap after every take.
 * 3. **The array, not only the order.** A few timers queued, taken and deleted by hand,
 *    with the array `AdjustTimerQueue` leaves after each step, worked from the C++; then
 *    six thousand seeded random operations, the heap checked after each.
 * 4. **A loaded game runs what is due.** Each save is loaded into a real `Game` and given
 *    one tick. No timer due by then is left, and `csbgame-flying-sword.dat`'s `TT_11`, the end of
 *    IAIDO's action, due at the saved `d.Time`, is gone.
 * 5. **The table's size.** A new game's table is 100 slots, and one per record of the
 *    monster database and of the missile and cloud ones, each the file's count plus
 *    `d.Byte7302`'s extra records (`SaveGame.cpp:2761`, `:2768-2776`, `:2824-2828`). Every
 *    committed save of the stock dungeon was written with that table, so each file's
 *    `gb2.MaxTimers` is the canary for `Byte7302`'s offset in graphics.dat item 0x22f.
 *    Then a table filled by hand: within five of full, `SetTimer` moves the cursor to
 *    `m_maxTimers`, past every hole, and grows the table to `(m_maxTimers+10)*5/4`
 *    (`Timer.cpp:999-1008`); a delete below the cursor lowers it again (`:966-969`).
 *
 * Run: `npm test -- --only=dump-timer-heap.ts`
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { TimerFunction, TimerQueue, timerLess, type TimerEntry } from '../src/engine/TimerQueue';
import { newGame, stockDungeon, stockGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';
import { genuineSaves, savePath } from './lib/saves';

const json = (v: unknown): string => JSON.stringify(v);

type Less = (a: TimerEntry, b: TimerEntry) => boolean;

/** `GameTimers::CheckTimers`' order test (`Timer.cpp:932-953`): no child less than its parent. */
function heapFault(queue: readonly TimerEntry[], less: Less): number {
  for (let i = 0; i < queue.length; i++) {
    for (let n = 2 * i + 1; n <= 2 * i + 2 && n < queue.length; n++) {
      if (less(queue[n], queue[i])) return n;
    }
  }
  return -1;
}

/** The saved queue as the port's entries, in the file's array order. */
function savedEntries(file: string): {
  entries: TimerEntry[]; sequence: number; time: number; maxTimers: number; firstAvailTimer: number;
} {
  const save = loadSaveGameState(new Uint8Array(readFileSync(savePath(file))));
  const entries = (save.timerQueue ?? []).map((index): TimerEntry => {
    const t = save.timers![index];
    return {
      index, time: t.time, level: t.level, function: t.function, uByte5: t.uByte5,
      uByte6: t.uByte6, uByte7: t.uByte7, uByte8: t.uByte8, uByte9: t.uByte9,
      sequence: t.sequence, timerWord8: t.timerWord8, timerWord6: t.timerWord6,
    };
  });
  return {
    entries, sequence: save.timerSequence ?? 0, time: save.block2?.time ?? 0,
    maxTimers: save.maxTimers, firstAvailTimer: save.block2?.firstAvailTimer ?? 0,
  };
}

/** `timerLess` with one of its rules broken, for the canaries. */
const CANARIES: Array<{ name: string; less: Less }> = [
  {
    name: 'the lower function first',
    less: (a, b) => a.time !== b.time ? a.time < b.time
      : a.function !== b.function ? a.function < b.function : timerLess(a, b),
  },
  {
    name: 'the lower uByte5 first',
    less: (a, b) => a.time === b.time && a.function === b.function && a.uByte5 !== b.uByte5
      ? a.uByte5 < b.uByte5 : timerLess(a, b),
  },
  {
    name: 'the higher sequence first',
    less: (a, b) => a.time === b.time && a.function === b.function && a.uByte5 === b.uByte5
      && a.sequence !== b.sequence ? a.sequence > b.sequence : timerLess(a, b),
  },
];

function checkSavedHeaps(files: string[]): void {
  console.log('=== 1. CSBWin\'s own heaps ===');
  console.log(['file', 'timers', 'out of time order', 'heap', ...CANARIES.map((c) => c.name)].join('\t'));
  const canaryFailed = CANARIES.map(() => false);
  let unsorted = 0;
  for (const file of files) {
    const { entries } = savedEntries(file);
    let late = 0;
    for (let i = 1; i < entries.length; i++) if (entries[i].time < entries[i - 1].time) late++;
    if (late > 0) unsorted++;
    const fault = heapFault(entries, timerLess);
    const canaries = CANARIES.map((c, i) => {
      const f = heapFault(entries, c.less);
      if (f >= 0) canaryFailed[i] = true;
      return f >= 0 ? `fails at ${f}` : 'holds';
    });
    console.log([file, entries.length, late, fault < 0 ? 'holds' : `fails at ${fault}`, ...canaries].join('\t'));
    check(fault < 0, `${file}: the saved queue is a heap under timerLess`);
  }
  check(unsorted >= 2, `the saved queues are heaps, not sorted lists (${unsorted} files are out of time order)`);
  CANARIES.forEach((c, i) => check(canaryFailed[i], `canary: with ${c.name}, some saved queue is not a heap`));
}

function checkDrain(): void {
  console.log('\n=== 2. csbgame7.dat drained through shiftNext ===');
  const { entries, sequence, maxTimers, firstAvailTimer } = savedEntries('csbgame7.dat');
  const q = new TimerQueue();
  q.restore(entries, sequence, maxTimers, firstAvailTimer);
  const expected = entries.slice().sort((a, b) => (timerLess(a, b) ? -1 : 1)).map((e) => e.index);
  const taken: number[] = [];
  let everyTakeLeast = true;
  let heapAfterEveryTake = true;
  for (let next = q.shiftNext(); next; next = q.shiftNext()) {
    taken.push(next.index);
    if (q.getTimers().some((rest) => !timerLess(next, rest))) everyTakeLeast = false;
    if (heapFault(q.getTimers(), timerLess) >= 0) heapAfterEveryTake = false;
    if (q.getTimer(next.index) !== null) heapAfterEveryTake = false;
  }
  console.log(`  firing order (slots): ${taken.join(' ')}`);
  check(taken.length === entries.length, `every timer is taken once (${taken.length} of ${entries.length})`);
  check(everyTakeLeast, 'each timer taken is timerLess than every timer left');
  check(taken.join(' ') === expected.join(' '), 'the firing order is the saved timers sorted by timerLess');
  check(heapAfterEveryTake, 'the rest is a heap after every take, and the slot taken is freed');
  check(taken.join(' ') !== entries.map((e) => e.index).join(' '), 'and it is not the saved array\'s order');
}

function slots(q: TimerQueue): string {
  return q.getTimers().map((t) => `${t.uByte6}`).join(',');
}

function checkByHand(): void {
  console.log('\n=== 3. the array AdjustTimerQueue leaves ===');
  // Each timer is named by its uByte6, and ordered by time only: all are TT_11 with
  // uByte5 0. The arrays after each step are worked by hand from `SetTimer`'s append and
  // `AdjustTimerQueue`, and from `DeleteTimer`'s move of the last entry into the hole.
  const q = new TimerQueue();
  const add = (name: number, time: number) => q.createTimer(TimerFunction.TT_11, name, 0, 0, 0, time, 0).index;
  const slotOf = new Map<number, number>();
  const steps: Array<[string, () => void, string]> = [
    ['add 50@5', () => { slotOf.set(50, add(50, 5)); }, '50'],
    ['add 30@3', () => { slotOf.set(30, add(30, 3)); }, '30,50'],
    ['add 40@4', () => { slotOf.set(40, add(40, 4)); }, '30,50,40'],
    ['add 10@1', () => { slotOf.set(10, add(10, 1)); }, '10,30,40,50'],
    ['add 60@6', () => { slotOf.set(60, add(60, 6)); }, '10,30,40,50,60'],
    ['add 20@2', () => { slotOf.set(20, add(20, 2)); }, '10,30,20,50,60,40'],
    ['take', () => { q.shiftNext(); }, '20,30,40,50,60'],
    ['delete 30', () => { q.deleteTimer(slotOf.get(30)!); }, '20,50,40,60'],
    ['add 35@3', () => { slotOf.set(35, add(35, 3)); }, '20,35,40,60,50'],
    ['delete 40', () => { q.deleteTimer(slotOf.get(40)!); }, '20,35,50,60'],
    ['take', () => { q.shiftNext(); }, '35,60,50'],
  ];
  for (const [label, run, want] of steps) {
    run();
    console.log(`  ${label.padEnd(10)} -> [${slots(q)}]`);
    check(slots(q) === want, `${label}: the array is [${want}]`);
  }

  // A renumbered AI timer is re-sorted in place, `TIMER_SEARCH::AdjustTimerPriority`:
  // at the same time the higher function comes first.
  const r = new TimerQueue();
  const a = r.createTimer(TimerFunction.TT_MONSTER_A0, 1, 0, 0, 0, 7, 0).index;
  r.createTimer(TimerFunction.TT_MONSTER_A1, 2, 0, 0, 0, 7, 0);
  r.createTimer(TimerFunction.TT_MONSTER_A2, 3, 0, 0, 0, 7, 0);
  check(slots(r) === '3,1,2', `A2 first, then A0, then A1: [${slots(r)}]`);
  r.getTimer(a)!.function = TimerFunction.TT_MONSTER_A3;
  r.reprioritizeTimer(a);
  check(slots(r) === '1,3,2', `A0 renumbered A3 moves up to the head: [${slots(r)}]`);
}

function checkRandom(): void {
  console.log('\n=== 3b. seeded random operations ===');
  let seed = 0x1234567;
  const rand = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const q = new TimerQueue();
  const { entries, sequence, maxTimers, firstAvailTimer } = savedEntries('csbgame7.dat');
  q.restore(entries, sequence, maxTimers, firstAvailTimer);
  const FUNCTIONS = [
    TimerFunction.TT_11, TimerFunction.TT_MISSILE, TimerFunction.TT_PARAMETER_MESSAGE,
    TimerFunction.TT_MONSTER_A0, TimerFunction.TT_MONSTER_A3, TimerFunction.TT_MONSTER_B1,
    TimerFunction.TT_75, TimerFunction.TT_25,
  ];
  const counts = { add: 0, del: 0, take: 0, resort: 0 };
  let faults = 0;
  let takeFaults = 0;
  for (let op = 0; op < 6000; op++) {
    const live = q.getTimers();
    const pick = rand(10);
    if (pick < 5 || live.length === 0) {
      const fn = FUNCTIONS[rand(FUNCTIONS.length)];
      q.createTimerWithUByte5(fn, rand(32), rand(32), 0, 0, 127290 + rand(40), rand(4), rand(4));
      counts.add++;
    } else if (pick < 7) {
      q.deleteTimer(live[rand(live.length)].index);
      counts.del++;
    } else if (pick < 9) {
      const head = q.shiftNext()!;
      if (q.getTimers().some((rest) => !timerLess(head, rest))) takeFaults++;
      counts.take++;
    } else {
      const t = live[rand(live.length)];
      t.time += rand(21) - 10;
      q.reprioritizeTimer(t.index);
      counts.resort++;
    }
    if (heapFault(q.getTimers(), timerLess) >= 0) faults++;
    if (q.getTimers().some((t) => q.getTimer(t.index) !== t)) faults++;
  }
  console.log(`  ${JSON.stringify(counts)}, ${q.getTimers().length} left`);
  check(counts.add > 1000 && counts.del > 500 && counts.take > 500 && counts.resort > 200,
    'every kind of operation ran');
  check(faults === 0, `the queue is a heap, its entries in their slots, after every operation (${faults} faults)`);
  check(takeFaults === 0, `each take is the least timer (${takeFaults} faults)`);
}

function checkLoadedGames(files: string[]): void {
  console.log('\n=== 4. one tick after the load ===');
  const data = stockDungeon();
  const graphics = stockGraphics();
  let firedSome = 0;
  for (const file of files) {
    const game = newGame(data, graphics);
    applyCsbwinSave(game, new Uint8Array(readFileSync(savePath(file))));
    const saved = game.ctx.state.tickCount;
    const before = game.ctx.timers.getTimers().slice();
    const iaido = file === 'csbgame-flying-sword.dat'
      ? before.find((t) => t.function === TimerFunction.TT_11 && t.time === saved)
      : undefined;
    // The first tick runs its timers on the saved `d.Time`, then turns the clock
    // (`LoadGame`, SaveGame.cpp:1748; CSBCode.cpp:636, :670).
    const now = game.ctx.state.tickCount;
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
    const due = before.filter((t) => t.time <= now).length;
    const left = game.ctx.timers.getTimers().filter((t) => t.time <= now);
    if (due > 0) firedSome++;
    console.log(`  ${file}: ${before.length} timers, ${due} due by tick ${now}, ${left.length} of them left`);
    check(left.length === 0, `${file}: no timer due by the first tick is left after it`);
    if (file === 'csbgame-flying-sword.dat') {
      check(iaido !== undefined, 'csbgame-flying-sword.dat: a TT_11 is due at the saved d.Time');
      check(iaido !== undefined && !game.ctx.timers.getTimers().includes(iaido),
        'csbgame-flying-sword.dat: and the first tick runs it');
    }
  }
  check(firedSome >= 2, `timers were due in ${firedSome} of the loads`);
}

function checkTableSize(files: string[]): void {
  console.log('\n=== 5. the table\'s size ===');
  const size = stockGame().ctx.timers.getMaxTimers();
  const saved = files.map((file) => loadSaveGameState(new Uint8Array(readFileSync(savePath(file)))).maxTimers);
  console.log(`  a new game: ${size} slots; the saves: ${[...new Set(saved)].join(', ')}`);
  check(size === 467, `a new game's table is 100 + (182 + 75) + (0 + 60) + (0 + 50) = 467 slots, not ${size}`);
  check(saved.every((n) => n === size), 'and every committed save carries that gb2.MaxTimers');

  const q = new TimerQueue();
  q.allocate(20);
  const add = (t: number): number => q.createTimer(TimerFunction.TT_11, 0, 0, 0, 0, 1000 + t, 0).index;
  const slots: number[] = [];
  for (let t = 0; t < 15; t++) slots.push(add(t));
  q.deleteTimer(3);
  const refill = add(15);
  const beforeJump = q.getMaxTimers();
  q.deleteTimer(7);
  const refill7 = add(16);
  const jumped = add(17);
  const after = add(18);
  const grown = q.getMaxTimers();
  q.deleteTimer(2);
  const lowered = add(19);
  console.log(`  20 slots: filled ${slots.join(',')}; refilled ${refill}, ${refill7}; then ${jumped}, ${after}; ` +
    `size ${beforeJump} -> ${grown}; after a delete, ${lowered}`);
  check(json(slots) === json([...Array(15).keys()]) && refill === 3 && refill7 === 7,
    'short of full, a timer takes the lowest free slot');
  check(beforeJump === 20 && jumped === 20 && after === 21 && grown === 37,
    'with 15 of 20 slots live, the next timer takes slot 20, past 15-19, and the table grows to (20+10)*5/4 = 37');
  check(q.getTimer(15) === null && lowered === 2, 'the slots it passed stay empty until a delete below the cursor lowers it');
}

function main(): void {
  const files = genuineSaves().map((path) => basename(path));
  checkSavedHeaps(files);
  checkDrain();
  checkByHand();
  checkRandom();
  checkLoadedGames(files);
  checkTableSize(files);
  finish();
}

main();
