/**
 * The DSA operations `&MESSAGE` and `&SOUND` (the message and sound family),
 * each run through `DsaSystem.execute` as a program of a test DSA on a genuine save
 * (`csbgame7.dat`).
 *
 * 1. **`&MESSAGE`** (`doc/CSBwin-src/DSA.cpp:3045-3089`): a `TT_ParameterMessage` timer to
 *    the target, due `delay` ticks on, the message type in `uByte9` and
 *    `parameterMessageSequence` in `uByte5`; the first `numParam` DSA parameters in
 *    `EXPOOL` under `(EDT_MessageParameters << 24) + timerID`. Nothing past 29 parameters.
 * 2. **The timer hands them to the square's DSAs** (`ProcessTT_OPENROOM`,
 *    `doc/CSBwin-src/Timer.cpp:1699-1707`, or `ProcessTT_STONEROOM`, `:2178-2186`, by the
 *    target's room type, `CSBCode.cpp:6445-6458`): the count and the words, which leave
 *    the pool; a count of -1 when the record is gone. The sequence is back to 0 at the
 *    next tick (`Attack.cpp:2210`).
 * 3. **Any other room timer gives a count of 0** (`Timer.cpp:1704-1707`).
 * 4. **`&SOUND`** (`DSA.cpp:4612-4624`, `PlayCustomSound`, `Sound.cpp:1039-1062`): a
 *    negative number plays `d.sound1772`'s entry `-n - 1`, quiet for a volume of 0, none
 *    past the 22nd; a number from 0 up is `CSBgraphics.dat`'s, which, in a game with no
 *    such file, plays nothing and is reported once (the sounds themselves are
 *    `tools/dump-custom-sounds.ts`'s).
 * 5. **An `OVERRIDE` no operation used dies with its run**: `ProcessDSATimer6` clears
 *    `Override_P` before every DSA it runs (`DSA.cpp:5416`), so the next run's `&MESSAGE`
 *    goes to the corner its location names.
 *
 * Run: `npx tsx tools/dump-dsa-message.ts`
 */
import { Position, RoomType, locationRelToInteger } from '../src/core/types';
import { messageParametersKey } from '../src/data/CsbwinExpool';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { TimerFunction, type TimerEntry } from '../src/engine/TimerQueue';
import { globalStore, int, op, run, varFetch, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

const DELAY = 5;

/** The square's own location, corner 0: the corner picks the DSA's column, `3 * p + action`. */
const here = (at: Position): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });

/**
 * Report the count and the first three parameters the run was given into globals 0 to 3,
 * then send the square two messages, of 3 and 2 parameters (11, 22, 33), and a third of
 * 30, which is refused.
 */
const program = (_game: Game, at: Position): number[] => [
  ...int(0), varStore(10), ...int(0), varStore(11), ...int(0), varStore(12),
  op(StkOp.NUM_PARAM), globalStore(0),
  op(StkOp.NUM_PARAM), ...int(10), op(StkOp.PARAM_FETCH),
  varFetch(10), globalStore(1), varFetch(11), globalStore(2), varFetch(12), globalStore(3),
  ...int(11), varStore(0), ...int(22), varStore(1), ...int(33), varStore(2),
  ...int(3), ...int(0), op(StkOp.PARAM_STORE),
  ...int(here(at)), ...int(0), ...int(3), ...int(DELAY), op(StkOp.MESSAGE),
  ...int(here(at)), ...int(0), ...int(2), ...int(DELAY), op(StkOp.MESSAGE),
  ...int(here(at)), ...int(0), ...int(30), ...int(DELAY), op(StkOp.MESSAGE),
];

const messages = (game: Game): TimerEntry[] =>
  game.ctx.timers.searchOrder()
    .filter((t) => t.function === TimerFunction.TT_PARAMETER_MESSAGE)
    .sort((a, b) => a.time - b.time || a.uByte5 - b.uByte5);

const record = (game: Game, timer: TimerEntry): number[] | null =>
  game.ctx.dungeon.locateExpoolRecord(messageParametersKey(timer.index));

/** One tick: `_ProcessTimersViewportAndSound`, the timers and `d.Time++`. */
function tick(game: Game): void {
  const script = game.processTimersViewportAndSound();
  while (!script.next().done) { /* runs to its end */ }
}

for (const room of ['open', 'stone'] as const) {
  console.log(`--- the test DSA on ${room === 'open' ? 'an open square' : 'a wall'}`);
  const stone = (game: Game, at: Position): void => {
    if (room !== 'stone') return;
    const map = game.ctx.dungeon.getMap(at.z)!;
    map.cellFlags[at.x]![at.y] = (map.cellFlags[at.x]![at.y]! & 0x1f) | (RoomType.STONE << 5);
  };
  const { game, g, at } = run(program, stone);
  const t0 = game.ctx.state.tickCount;

  /* ----------------------------- 1. the timers and their records --------------------- */
  const sent = messages(game);
  console.log(`1. ${sent.length} messages: ` + sent.map((t) =>
    `L${t.level} (${t.uByte6},${t.uByte7}) p${t.uByte8} type ${t.uByte9} seq ${t.uByte5} at t0+${t.time - t0}`
    + ` [${record(game, t)?.join(' ') ?? '-'}]`).join('; '));
  check(g[0] === 0, 'the first run, straight from the tool, has a count of 0');
  check(sent.length === 2, 'two timers: 30 parameters is past the 29 a record holds, and sets none');
  check(sent.every((t) => t.level === at.z && t.uByte6 === at.x && t.uByte7 === at.y && t.uByte8 === 0),
    'each to the target: its level, square and corner');
  check(sent.every((t) => t.uByte9 === 0 && t.time === t0 + DELAY), 'the message type in uByte9, due delay ticks on');
  check(sent[0]?.uByte5 === 0 && sent[1]?.uByte5 === 1, 'parameterMessageSequence in uByte5, 0 then 1');
  check(JSON.stringify(sent.map((t) => record(game, t))) === '[[11,22,33],[11,22]]',
    'the first numParam parameters in EXPOOL, under the timer\'s index');

  /* ----------------------------- 2. the parameters reach the DSA ---------------------- */
  for (let i = 0; i < DELAY; i++) tick(game);
  check(game.ctx.state.tickCount === t0 + DELAY, 'the messages are due at this tick');
  tick(game);
  const after = game.systems.dsa.getGlobalVariables();
  const next = messages(game);
  console.log(`2. the DSA last saw a count of ${after[0]}, parameters ${after[1]} ${after[2]} ${after[3]}; `
    + `the records are ${sent.map((t) => (record(game, t) ? 'kept' : 'gone')).join(' and ')}; `
    + `the DSA sent ${next.length} more, seq ${next.map((t) => t.uByte5).join(' ')}`);
  check(after[0] === 2 && after[1] === 11 && after[2] === 22 && after[3] === 0,
    'the second message runs last, on its own two parameters');
  check(sent.every((t) => record(game, t) === null), 'both records left the pool as their timers ran');
  check(next.map((t) => t.uByte5).join() === '0,1,2,3',
    'the sequence was back to 0 at the tick: the two runs then sent four messages, 0 to 3');

  /* ----------------------------- 3. any other room timer ------------------------------ */
  const now = game.ctx.state.tickCount;
  const fn = room === 'stone' ? TimerFunction.TT_STONEROOM : TimerFunction.TT_OPENROOM;
  game.ctx.timers.createTimer(fn, at.x, at.y, 0, 0, now, at.z);
  tick(game);
  const other = game.systems.dsa.getGlobalVariables();
  console.log(`3. after a ${room === 'stone' ? 'TT_STONEROOM' : 'TT_OPENROOM'} timer, the DSA saw a count of ${other[0]}`);
  check(other[0] === 0, 'a timer that is no message gives a count of 0, whatever the last one left');
}

/* ----------------------------- the count of a record that is gone ------------------ */
{
  const { game, at } = run(program);
  const sent = messages(game);
  // Only the second's record goes: the first runs, then the second finds nothing.
  game.ctx.dungeon.readExpoolRecord(messageParametersKey(sent[1]!.index));
  for (let i = 0; i <= DELAY; i++) tick(game);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`2. a message whose record is gone gives a count of ${g[0]} (at ${at.x},${at.y})`);
  check(g[0] === -1, 'EXPOOL::Read\'s -1, a message whose record is gone');
}

/* ----------------------------- 4. &SOUND ------------------------------------------- */
{
  const played: string[] = [];
  const traced: string[] = [];
  const { game } = run([
    ...int(-1), ...int(0), ...int(0), op(StkOp.SOUND),
    ...int(-22), ...int(5), ...int(9), op(StkOp.SOUND),
    ...int(-23), ...int(5), ...int(0), op(StkOp.SOUND),
    ...int(0), ...int(5), ...int(0), op(StkOp.SOUND),
    ...int(7), ...int(5), ...int(0), op(StkOp.SOUND),
  ], (game) => {
    game.ctx.host.playSound = (id, rate, volume) => { played.push(`${id}/${rate}/${volume}`); };
    game.ctx.host.trace = (line) => { traced.push(line); };
  });
  const table = game.ctx.tables.sound1772;
  console.log(`4. played ${played.join(' ')}; traced ${JSON.stringify(traced)}`);
  check(JSON.stringify(played) === JSON.stringify([`${table[0]!.word0}/0/0`, `${table[21]!.word0}/0/1`]),
    'entries 0 (quiet: volume 0) and 21 (loud), and nothing past the 22nd');
  check(JSON.stringify(traced) === '["Cannot find Sound"]', 'without CSBgraphics.dat, its sounds play nothing, said once');
}

/* ----------------------------- 5. an OVERRIDE left unused ------------------------- */
{
  /** `EX_OVERRIDE` (`DSA.cpp:1037-1072`): `what` 1, corner 3, the same state. */
  const override3 = 2 | (1 << 6) | (3 << 9);
  const { game, again, at } = run((_game, at) => [
    ...int(here(at)), ...int(0), ...int(0), ...int(DELAY), op(StkOp.MESSAGE),
    override3,
  ]);
  again();
  const corners = messages(game).map((t) => t.uByte8);
  console.log(`5. a run that ends on an OVERRIDE, run twice: the messages go to corners ${corners.join(' ')} of (${at.x},${at.y})`);
  check(corners.join() === '0,0', 'the second run\'s message keeps its corner: the first run\'s OVERRIDE died with it');
}

finish();
