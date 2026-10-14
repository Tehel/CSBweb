/**
 * The DSA command words at the edges of CSBWin's decoder (`doc/CSBwin-src/DSA.cpp`
 * `EX_*`), each run through `DsaSystem.execute` as one program of a test DSA.
 *
 * 1. **`IsMaxState`** is `nextState == -MAXSTATE` in every command
 *    (`doc/CSBwin-src/Data.h:1904-2399`). An `&` whose 3-bit field holds -4 reads no
 *    extra word, and the command after it runs. `QUESTION`'s field of -2 does read it,
 *    unsigned (`DSA.cpp:859-867`: `m_PC` is a `ui16 *`, `:251`), so a word of 0xffff
 *    takes the state to 65535.
 * 2. **`LOAD_INTEGER` (26)** pushes its word unsigned (`:1100-1107`); `LOAD` 29
 *    (`LOAD_ABS32`) pushes nothing (`:1139-1144`).
 * 3. **`STORE` above 25** pops nothing, and leaves the next state (`:1329-1333`), as does
 *    an `OVERRIDE` whose `what` is not 1 (`:1046-1059`).
 * 4. **`GLOBALFETCH` past the last variable** pushes 0xcdcdcdcd (`:1303-1307`).
 * 5. **An explicit message delay** is the word unsigned (`:663`): 0x8000 ticks from now.
 *
 * No dungeon this project plays defines a DSA, so the tool builds one, `localState` 1,
 * whose state is the DSA's own `state`. Global variable 0 is what each program reports.
 *
 * Run: `npm test -- --only=dump-dsa-decoder.ts`
 */
import { DBType, locationRelToInteger, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import type { DsaDefinition, DungeonData } from '../src/data/dungeonTypes';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { TimerFunction, type TimerEntry } from '../src/engine/TimerQueue';
import { stockGame } from './lib/game';
import { check, finish } from './lib/check';
import { standInOf } from './lib/standIn';

const OVERRIDE = 2;
const NOOP = 3;
const LOAD = 6;
const QUESTION = 9;
const AMPERSAND = 11;
const STORE = 13;
const GLOBALFETCH = 19;
const GLOBALSTORE = 20;
const DESSAGE32 = 22;

const LOAD_INTEGER = 26;
const LOAD_ABS32 = 29;

/** `value` in a command word's `bits`-wide field at `shift`. */
const rel = (value: number, shift: number, bits: number): number => (value & ((1 << bits) - 1)) << shift;
const loadInteger = (value: number): number[] => [LOAD | (LOAD_INTEGER << 6), value & 0xffff];
const globalStore = (index: number): number => GLOBALSTORE | (index << 6);
const globalFetch = (index: number): number => GLOBALFETCH | (index << 6);

interface Run {
  game: Game;
  dsa: DsaDefinition;
  global0: number;
  at: Position;
}

/** Run `program` as column 0 of a one-state DSA whose state starts at `state`. */
function run(program: number[], state = 0): Run {
  const game = stockGame();
  const dungeon = game.ctx.dungeon;
  const start = dungeon.getStartPosition();
  const map = dungeon.getMap(start.z)!;
  let at: Position | null = null;
  for (let x = 0; x < map.descriptor.width && !at; x++) {
    for (let y = 0; y < map.descriptor.height && !at; y++) {
      const p = new Position(x, y, start.z);
      if (x === start.x && y === start.y) continue;
      if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      at = p;
    }
  }
  if (!at) throw new Error('no empty open square');

  const dungeonData: DungeonData = dungeon.getData();
  dungeonData.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: 47, word4: 0, word6: 0 });
  const rn: ObjectID = dungeon.rnMaps.rn(DBType.ACTUATOR, dungeonData.databases.actuators.records.length - 1);
  dungeon.addObjectToCell(at, rn);
  const dsa: DsaDefinition = {
    description: 'test', state, localState: 1, groupId: 0, numStates: 1, firstDisplayedState: 0,
    states: [{ actions: [{ column: 0, program: Uint16Array.from(program) }] }],
  };
  dungeonData.dsaIndex = { entries: [dsa] };
  dungeonData.dsaLevelIndex = [];
  dungeonData.dsaLevelIndex[at.z] = [0];
  // Every state answers the program, so the run is the same whatever the start state.
  for (let s = 1; s <= state; s++) dsa.states[s] = dsa.states[0]!;

  game.systems.dsa.setGlobalVariables([0x5a5a]);
  const timer = standInOf<TimerEntry>({ uByte5: 0, uByte6: at.x, uByte7: at.y, uByte8: 0, uByte9: 0, level: at.z, time: 0 });
  game.systems.dsa.processTimer5(rn, timer, at);
  return { game, dsa, global0: game.systems.dsa.getGlobalVariables()[0]!, at };
}

/* ---------------------------------------------- 1. IsMaxState ------------------- */
{
  const r = run([...loadInteger(5), AMPERSAND | (StkOp.ONE_PLUS << 6) | rel(-4, 13, 3), globalStore(0)]);
  console.log(`1a. LOAD 5, &1+ with field -4, GV0!: GV0 = ${r.global0}`);
  check(r.global0 === 6, 'an & whose field is -4 reads no state word, so the GLOBALSTORE after it runs');

  const q = run([QUESTION | rel(-2, 6, 4), 0xffff]);
  console.log(`1b. QUESTION with field -2, state word 0xffff: state ${q.dsa.state}`);
  check(q.dsa.state === 65535, 'QUESTION reads its state word unsigned');
}

/* ---------------------------------------------- 2. LOAD ------------------------- */
{
  const r = run([...loadInteger(0xffff), globalStore(0)]);
  console.log(`2a. LOAD_INTEGER 0xffff, GV0!: GV0 = ${r.global0}`);
  check(r.global0 === 0xffff, 'LOAD_INTEGER pushes its word unsigned');

  const a = run([...loadInteger(7), LOAD | (LOAD_ABS32 << 6), globalStore(0)]);
  console.log(`2b. LOAD 7, LOAD 29, GV0!: GV0 = ${a.global0}`);
  check(a.global0 === 7, 'LOAD 29 pushes nothing');
}

/* ---------------------------------------------- 3. illegal STORE and OVERRIDE --- */
{
  const r = run([...loadInteger(7), STORE | (26 << 6), globalStore(0)]);
  console.log(`3a. LOAD 7, STORE 26, GV0!: GV0 = ${r.global0}`);
  check(r.global0 === 7, 'a STORE above 25 pops nothing');

  // From state 5, a NOOP of -6 makes the next state -1, which sets no final state; an
  // illegal command after it must leave it so, and the DSA stays in state 5.
  const s = run([NOOP | rel(-6, 6, 10), STORE | (26 << 6) | rel(2, 11, 5)], 5);
  console.log(`3b. from 5, NOOP -6, STORE 26 +2: state ${s.dsa.state}`);
  check(s.dsa.state === 5, 'a STORE above 25 leaves the next state');

  const o = run([NOOP | rel(-6, 6, 10), OVERRIDE | (2 << 6) | rel(2, 12, 4)], 5);
  console.log(`3c. from 5, NOOP -6, OVERRIDE what 2 +2: state ${o.dsa.state}`);
  check(o.dsa.state === 5, 'an OVERRIDE whose what is not 1 leaves the next state');
}

/* ---------------------------------------------- 4. GLOBALFETCH ------------------ */
{
  const r = run([globalFetch(100), globalStore(0)]);
  console.log(`4. GV100@, GV0!: GV0 = 0x${(r.global0 >>> 0).toString(16)}`);
  check((r.global0 >>> 0) === 0xcdcdcdcd, 'GLOBALFETCH past the last variable pushes 0xcdcdcdcd');
}

/* ---------------------------------------------- 5. the explicit delay ----------- */
{
  const target = (at: Position): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });
  // Find the square first, then run the message at it.
  const probe = run([]);
  const loc = target(probe.at);
  const word = DESSAGE32 | (1 << 6) | (3 << 8) | (2 << 10);
  const r = run([word, 0x8000, loc & 0xffff, (loc >>> 16) & 0xffff]);
  const now = r.game.ctx.state.tickCount;
  const queued = r.game.ctx.timers.getTimers().filter((t) => t.function === TimerFunction.TT_DESSAGE);
  console.log(`5. DESSAGE32 SET, delay 0x8000, at tick ${now}: timers at ${queued.map((t) => t.time).join(', ')}`);
  check(queued.length === 1 && queued[0]!.time === ((now + 0x8000) >>> 0), 'an explicit delay is its word unsigned');
}

finish();
