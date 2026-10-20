/**
 * The DSA `I_` operations (the indirect family), each run through
 * `DsaSystem.execute` as a program of a test DSA on a genuine save (`csbgame7.dat`).
 *
 * 1. **No `ESL_INDIRECTACTIONS`, no action** (`Indirect`, `doc/CSBwin-src/DSA.cpp:2110-2121`):
 *    in a dungeon with no such location an `I_` operation does nothing, not even pop.
 * 2. **The record and its timer** (`:2132-2192`, the counts at `:4958-4972`): the operands
 *    popped into `[type, numVar, the values, array, its variables, numParam, the
 *    parameters]`, in `EXPOOL` under a `TT_ParameterMessage` timer to the location,
 *    corner 0, message type 0, due now, `parameterMessageSequence` in `uByte5`. An array
 *    of more than 20 sends nothing, once popped.
 * 3. **`&%DELAY`** (`:4973-4979`, `:2176-2180`): a delay above 0 puts off the next record
 *    only, and lasts no longer than its run (`:5356`).
 * 4. **`&%INDIRECT`** (`:2346-2392`): a record back on the stack, in the variables from
 *    the index it names, and in the first parameters, whose count stays the record's; then
 *    its operation runs. A record that names no `I_` operation does nothing.
 * 5. **End to end**: the test square is the location, so its DSA receives what it sent.
 *    `&%TELEPORTPARTY` moves the party only when the message arrives, and `&%CELL!` stores
 *    the variables it had when it was sent. Each is sent a tick on: a DSA that sends to
 *    itself with no delay runs again in the same tick, and for ever.
 *
 * `I_FilteredCast` has no case of its own (`tools/dump-dsa-census.ts`), and `I_Indirect`
 * would run its record as `FilteredCast`; no operation writes one.
 *
 * Run: `npm test -- --only=dump-dsa-indirect.ts`
 */
import { Position, RoomType, locationRelToInteger } from '../src/core/types';
import { messageParametersKey } from '../src/data/CsbwinExpool';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { TimerFunction, type TimerEntry } from '../src/engine/TimerQueue';
import { globalStore, int, op, run, varFetch, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

/** `(EDT_SpecialLocations << 24) | ESL_INDIRECTACTIONS` (`doc/CSBwin-src/CSB.h:1537`, `:1543`). */
const INDIRECT_ACTIONS_KEY = (3 << 24) | 5;

const here = (at: Position): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });

/** The test square as the dungeon's `ESL_INDIRECTACTIONS`. */
const located = (game: Game, at: Position): void => {
  const data = game.ctx.dungeon.getData() as { specialLocations?: Record<number, number> };
  data.specialLocations = { ...data.specialLocations, [INDIRECT_ACTIONS_KEY]: here(at) };
};

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

/** Variables `from` on into `values`, one by one. */
const setVars = (from: number, values: number[]): number[] =>
  values.flatMap((v, i) => [...int(v), varStore(from + i)]);

/* ----------------------------- 1. no location -------------------------------------- */
{
  const { game, g } = run([...int(99), ...int(1), ...int(2), op(StkOp.I_DEL), globalStore(0)]);
  console.log(`1. with no ESL_INDIRECTACTIONS: ${messages(game).length} messages, the stack's top ${g[0]}`);
  check(messages(game).length === 0 && g[0] === 2, 'no location: no message, and the operands stay on the stack');
}

/* ----------------------------- 2. the records -------------------------------------- */
{
  const { game, g, at } = run([
    ...int(99),
    ...int(11), ...int(12), op(StkOp.I_DEL),
    ...int(21), op(StkOp.I_TELEPORT_PARTY),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap(int), op(StkOp.I_MOVE),
    ...setVars(40, [401, 402, 403]), ...int(31), ...int(40), ...int(3), op(StkOp.I_CELL_STORE),
    ...setVars(0, Array.from({ length: 13 }, (_, i) => 500 + i)), ...int(13), ...int(0), op(StkOp.PARAM_STORE),
    op(StkOp.I_CAST),
    ...int(31), ...int(40), ...int(21), op(StkOp.I_MONSTER_STORE),
    globalStore(0),
  ], located);
  const t0 = game.ctx.state.tickCount;
  const sent = messages(game);
  console.log(`2. ${sent.length} messages:`);
  for (const t of sent) {
    console.log(`   L${t.level} (${t.uByte6},${t.uByte7}) p${t.uByte8} type ${t.uByte9} seq ${t.uByte5} at t0+${t.time - t0}`
      + ` [${record(game, t)?.join(' ') ?? '-'}]`);
  }
  check(sent.length === 5, 'five records: an array of 21 sends none');
  check(sent.every((t) => t.level === at.z && t.uByte6 === at.x && t.uByte7 === at.y && t.uByte8 === 0 && t.uByte9 === 0),
    'each to the location, corner 0, message type 0');
  check(sent.every((t) => t.time === t0), 'each due now');
  check(sent.map((t) => t.uByte5).join() === '0,1,2,3,4', 'parameterMessageSequence in uByte5');
  const want = [
    [StkOp.I_DEL, 2, 12, 11, 0, 0],
    [StkOp.I_TELEPORT_PARTY, 1, 21, 0, 0],
    [StkOp.I_MOVE, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0],
    [StkOp.I_CELL_STORE, 3, 3, 40, 31, 1, 401, 402, 403, 0],
    [StkOp.I_CAST, 0, 0, 13, ...Array.from({ length: 13 }, (_, i) => 500 + i)],
  ];
  check(JSON.stringify(sent.map((t) => record(game, t))) === JSON.stringify(want),
    'the records: the values as popped, the array\'s variables, the parameters');
  check(g[0] === 99, 'every operation popped its operands, the refused array\'s too');
}

/* ----------------------------- 3. &%DELAY ------------------------------------------ */
{
  const tp = (n: number): number[] => [...int(n), op(StkOp.I_TELEPORT_PARTY)];
  const delay = (n: number): number[] => [...int(n), op(StkOp.I_DELAY)];
  const due = (game: Game): number[] =>
    messages(game).sort((a, b) => a.uByte5 - b.uByte5).map((t) => t.time - game.ctx.state.tickCount);
  const a = run([
    ...delay(5), ...tp(1), ...tp(2), ...delay(0), ...tp(3), ...delay(-3), ...tp(4), ...delay(7), ...tp(5),
  ], located);
  const b = run([...tp(1), ...delay(9)], located);
  b.again();
  console.log(`3. due at t0+ ${due(a.game).join(' ')}; a run that ends on a delay of 9, twice: ${due(b.game).join(' ')}`);
  check(due(a.game).join() === '5,0,0,0,7', 'a delay above 0 puts off the next record only; 0 and below none');
  check(due(b.game).join() === '0,0', 'a delay left at the end of a run does not reach the next one');
}

/* ----------------------------- 4. &%INDIRECT --------------------------------------- */
{
  const program = [
    ...int(99), op(StkOp.I_INDIRECT),
    varFetch(40), globalStore(0), varFetch(41), globalStore(1),
    op(StkOp.NUM_PARAM), globalStore(2),
    ...int(2), ...int(50), op(StkOp.PARAM_FETCH), varFetch(50), globalStore(3), varFetch(51), globalStore(4),
    globalStore(5),
  ];
  const flag = (game: Game, at: Position): number => game.ctx.dungeon.getCellFlag(at);
  const give = (words: (at: Position) => number[]) => (game: Game, at: Position): void => {
    const map = game.ctx.dungeon.getMap(at.z)!;
    map.cellFlags[at.x]![at.y] = map.cellFlags[at.x]![at.y]! & ~0x08;
    const w = words(at);
    game.systems.dsa.setParameters(w.length, w);
  };
  const cellStore = (at: Position): number[] =>
    [StkOp.I_CELL_STORE, 3, 2, 40, here(at), 1, RoomType.OPEN, 1, 2, 77, 88];
  const a = run(program, give(cellStore));
  console.log(`4. an I_CELL_STORE record: variables ${a.g[0]} ${a.g[1]}, a count of ${a.g[2]},`
    + ` parameters ${a.g[3]} ${a.g[4]}, the stack's top ${a.g[5]}; the square's flag 0x${flag(a.game, a.at).toString(16)}`);
  check(a.g[0] === RoomType.OPEN && a.g[1] === 1, 'the array back in variables 40 and 41');
  check(a.g[2] === 11 && a.g[3] === 77 && a.g[4] === 88, 'the parameters back at the front, the count the record\'s');
  check(a.g[5] === 99, '&CELL! took its three values off the stack');
  check((flag(a.game, a.at) & 0x08) !== 0, '&CELL! ran: the open square\'s bit 3 is set');

  const b = run(program, give(() => [StkOp.CELL_STORE, 3, 2, 40, 0, 1, RoomType.OPEN, 1, 2, 77, 88]));
  console.log(`   a record that names CELL_STORE itself: the stack's top ${b.g[5]}, the flag 0x${flag(b.game, b.at).toString(16)}`);
  check(b.g[5] === 99 && b.g[0] === 0 && b.g[3] === StkOp.CELL_STORE && (flag(b.game, b.at) & 0x08) === 0,
    'a record whose first word is no I_ operation does nothing');
}

/* ----------------------------- 5. end to end --------------------------------------- */
{
  const { game, at } = run((_game, at) => [
    op(StkOp.I_INDIRECT),
    ...setVars(40, [RoomType.OPEN, 1]),
    ...int(1), op(StkOp.I_DELAY), ...int(here(at)), ...int(40), ...int(2), op(StkOp.I_CELL_STORE),
    ...setVars(40, [0, 0]),
    ...int(1), op(StkOp.I_DELAY), ...int(here(at)), op(StkOp.I_TELEPORT_PARTY),
  ], (game, at) => {
    located(game, at);
    const map = game.ctx.dungeon.getMap(at.z)!;
    map.cellFlags[at.x]![at.y] = map.cellFlags[at.x]![at.y]! & ~0x08;
  });
  const party = (): Position => game.ctx.party.state.position;
  const where = (): string => `(${party().x},${party().y}) L${party().z}`;
  const before = where();
  const flagBefore = game.ctx.dungeon.getCellFlag(at);
  check(party().x !== at.x || party().y !== at.y, 'the party starts off the test square');
  check(messages(game).length === 2 && (flagBefore & 0x08) === 0, 'the first run only sends');
  tick(game);
  check(where() === before, 'nothing arrives before its tick');
  tick(game);
  console.log(`5. the party at ${before}, then ${where()} (the square is (${at.x},${at.y}) L${at.z});`
    + ` the square's flag 0x${flagBefore.toString(16)}, then 0x${game.ctx.dungeon.getCellFlag(at).toString(16)}`);
  check(where() === `(${at.x},${at.y}) L${at.z}`, '&%TELEPORTPARTY moved the party when its message arrived');
  check((game.ctx.dungeon.getCellFlag(at) & 0x08) !== 0, '&%CELL! stored the variables it was sent with');
}

finish();
