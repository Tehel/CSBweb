/**
 * The timer-type modifier, `timerTypeModifier` (`doc/CSBwin-src/CSBCode.cpp:21`): the
 * action each of SET, CLEAR and TOGGLE stands for, which a DSA's `&MODIFYMESSAGE`
 * (`doc/CSBwin-src/DSA.cpp:4932-4948`) changes. Each case runs a test DSA through
 * `tools/lib/dsa.ts` on `csbgame7.dat`, then a timer to its square at the next tick.
 *
 * 1. **It is reset before every timer** (`CSBCode.cpp:6471-6473`): a modifier the DSA set
 *    on its last run does not pick its column at the next timer.
 * 2. **A room timer reads it afresh at each object** (`ProcessTT_OPENROOM`,
 *    `doc/CSBwin-src/Timer.cpp:1712`, `OperateCounterActuator`, `:1609`, `:1624`): a counter
 *    after the DSA on the square counts the way the DSA made the message mean, and a 3
 *    ends the square. `&MODIFYMESSAGE` caps an action at 3, unsigned (`DSA.cpp:4936-4944`).
 * 3. **A pit reads it after the square's DSAs** (`ProcessTT_PITROOM`, `:2527-2551`): a SET
 *    the DSA makes a TOGGLE closes an open pit.
 * 4. **So does a teleporter, twice** (`ProcessTT_TELEPORTER`, `:2390-2414`): its TOGGLE
 *    writes SET into `uByte9`, which is read through the modifier again, so a SET the DSA
 *    made a TOGGLE leaves a closed teleporter closed.
 * 5. **So does a door** (`ProcessTT_DOOR`, `:1556-1586`): a SET the DSA makes a TOGGLE
 *    closes an open door, where a SET leaves it alone.
 * 6. **A door timer runs the square's DSAs before it looks at the square** (`:1563-1569`):
 *    on a bashed door, and on a square that is no door.
 *
 * Run: `npx tsx tools/dump-timer-modifier.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { getActuatorValue, setActuatorValue } from '../src/data/actuatorHelpers';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { globalStore, int, op, run } from './lib/dsa';
import { check, finish } from './lib/check';

/** `&MODIFYMESSAGE`, which pops SET's action, then CLEAR's, then TOGGLE's. */
const modify = (set: number, clear: number, toggle: number): number[] =>
  [...int(toggle), ...int(clear), ...int(set), op(StkOp.MODIFY_MESSAGE)];

/** One tick: `_ProcessTimersViewportAndSound`, the timers and `d.Time++`. */
function tick(game: Game): void {
  const script = game.processTimersViewportAndSound();
  while (!script.next().done) { /* runs to its end */ }
}

/** A timer to the test square, due now, run at the next tick. */
function send(game: Game, at: Position, fn: TimerFunction, action: number): void {
  game.ctx.timers.createTimer(fn, at.x, at.y, 0, action, game.ctx.state.tickCount, at.z);
  tick(game);
}

/** The square's room type, and the attribute bits under it. */
const room = (type: RoomType, attributes: number) => (game: Game, at: Position): void => {
  const map = game.ctx.dungeon.getMap(at.z)!;
  map.cellFlags[at.x]![at.y] = (type << 5) | attributes;
};

const flags = (game: Game, at: Position): number => game.ctx.dungeon.getMap(at.z)!.cellFlags[at.x]![at.y]!;

/* ----------------------------- 1. reset before every timer ------------------------- */
{
  const { game, g, at } = run([...int(7), globalStore(0), ...modify(1, 0, 2)]);
  check(g[0] === 7, 'the DSA ran once, straight from the tool, and swapped SET and CLEAR');
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(0x5a5a));
  send(game, at, TimerFunction.TT_OPENROOM, 0);
  const after = game.systems.dsa.getGlobalVariables()[0];
  console.log(`1. a SET after the DSA swapped SET and CLEAR: global 0 is 0x${after?.toString(16)}`);
  check(after === 7, 'the modifier was reset: the SET ran the DSA\'s column 0 again');
}

/* ----------------------------- 2. a counter after the DSA -------------------------- */
for (const [set, expected, what] of [
  [1, 4, 'CLEAR: counted down'],
  [3, 5, '3: the square ends at it'],
  [5, 5, '5, capped at 3: the square ends at it'],
  [-1, 5, '-1, unsigned and capped at 3: the square ends at it'],
] as const) {
  const { game, at } = run(modify(set, 1, 2));
  const data = game.ctx.dungeon.getData();
  const counter = { nextObject: OBJECT_ID_EOF, word2: 48, word4: 0, word6: 0 };
  setActuatorValue(counter, 5);
  data.databases.actuators.records.push(counter);
  const rn: ObjectID = game.ctx.dungeon.rnMaps.rn(DBType.ACTUATOR, data.databases.actuators.records.length - 1);
  game.ctx.dungeon.addObjectToCell(at, rn);
  send(game, at, TimerFunction.TT_OPENROOM, 0);
  console.log(`2. a SET the DSA makes a ${set}, to a counter of 5 after it: ${getActuatorValue(counter)}`);
  check(getActuatorValue(counter) === expected, `a SET the DSA makes ${what}`);
}

/* ----------------------------- 3. a pit -------------------------------------------- */
{
  const { game, at } = run(modify(2, 1, 2), room(RoomType.PIT, 0x08));
  send(game, at, TimerFunction.TT_PIT, 0);
  console.log(`3. a SET the DSA makes a TOGGLE, to an open pit: flags 0x${flags(game, at).toString(16)}`);
  check((flags(game, at) & 0x08) === 0, 'the pit is closed');
}

/* ----------------------------- 4. a teleporter ------------------------------------- */
{
  const { game, at } = run(modify(2, 1, 2), room(RoomType.TELEPORTER, 0));
  send(game, at, TimerFunction.TT_TELEPORTER, 0);
  console.log(`4. a SET the DSA makes a TOGGLE, to a closed teleporter: flags 0x${flags(game, at).toString(16)}`);
  check((flags(game, at) & 0x08) === 0, 'the TOGGLE\'s SET is a TOGGLE again: the teleporter stays closed');
}

/* ----------------------------- 5. a door ------------------------------------------- */
for (const [program, expected, what] of [
  [modify(2, 1, 2), 1, 'a SET the DSA makes a TOGGLE starts closing it'],
  [modify(0, 1, 2), 0, 'a SET leaves it open'],
] as const) {
  const { game, at } = run([...program], room(RoomType.DOOR, 0));
  send(game, at, TimerFunction.TT_DOOR, 0);
  console.log(`5. ${what}: an open door's state is ${flags(game, at) & 7}`);
  check((flags(game, at) & 7) === expected, `${what}`);
}

/* ----------------------------- 6. a door's DSAs run first -------------------------- */
for (const [type, state, what] of [
  [RoomType.DOOR, 5, 'a bashed door'],
  [RoomType.OPEN, 0, 'a square that is no door'],
] as const) {
  const { game, at } = run([...int(7), globalStore(0)], room(type, state));
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(0x5a5a));
  send(game, at, TimerFunction.TT_DOOR, 0);
  const g = game.systems.dsa.getGlobalVariables()[0];
  console.log(`6. a door timer to ${what}: global 0 is 0x${g?.toString(16)}, flags 0x${flags(game, at).toString(16)}`);
  check(g === 7 && (flags(game, at) & 7) === state, `the DSA on ${what} ran, and the square is as it was`);
}

finish();
