/**
 * The DSA parameter arrays, run through `DsaSystem.execute` as programs of a test DSA on
 * a genuine save (`csbgame7.dat`).
 *
 * 1. **A filter runs on a parameter array of its own** (`NEWDSAPARAMETERS`,
 *    `doc/CSBwin-src/CSB.h:4286-4301`, in `AdjustSkills`, `doc/CSBwin-src/Magic.cpp:199`):
 *    the adjust-skills filter sees its nine parameters, and a DSA a timer runs after it
 *    still finds a count of 0, the array the filter wrote being gone.
 * 2. **The party attack's parameters are the current array's** (`SetupDSAParam`,
 *    `doc/CSBwin-src/Attack.cpp:1346-1360`): after an attack, with no party attack filter,
 *    a DSA a timer runs finds the count 124, `sizeof(ATTACKPARAMETERS)`, and the attack's
 *    words, its champion and its type first.
 * 3. **`&PARAM@` compares the count unsigned** (`doc/CSBwin-src/DSA.cpp:2957-2986`): a
 *    count of -1, a parameter message whose `EXPOOL` record is gone, copies the words as
 *    they stand. A count short of `n` copies what there is, and the variables past it
 *    read 0.
 * 4. **Past 100, `&PARAM@` and `&PARAM!` do nothing** (`:2966-2969`, `:3010-3013`).
 * 5. **A short `&PARAM@` reads each missing parameter's number** (`Var(j)`,
 *    `doc/CSBwin-src/DSA.cpp:2978`): on a count of 3, `&PARAM@ 5` reads variables
 *    3 and 4, and `NoValue` names them; variable 0 is not read.
 *
 * 6. **The adjust-skills filter's answer** (`doc/CSBwin-src/Magic.cpp:255-327`): it may
 *    give up to 0xfffff, of which the skill takes `(UI16)`, the low word; and it runs for a
 *    gain of 0, as a failed cast's `w4 >> diff` may be.
 *
 * Run: `npm test -- --only=dsa-parameters.ts`
 */
import { messageParametersKey } from '../../src/data/CsbwinExpool';
import { StkOp } from '../../src/engine/dsa/DsaTypes';
import type { Game } from '../../src/engine/Game';
import { AttackType } from '../../src/engine/monsterTypes';
import { TimerFunction, type TimerEntry } from '../../src/engine/TimerQueue';
import { AdjustSkillsWhy, adjustSkills } from '../../src/engine/skills';
import { globalStore, int, op, report, run, varFetch, varStore } from '../lib/dsa';
import { check, finish } from '../lib/check';
import { standInOf } from '../lib/standIn';

/** `(EDT_SpecialLocations << 24) | ESL_ADJUSTSKILLSFILTER` (`doc/CSBwin-src/Magic.cpp:262`). */
const ADJUST_SKILLS_FILTER_KEY = (3 << 24) | 6;

/* ------------------------------- 1. a filter's own parameter array ------------- */
{
  const { game, g: before, again } = run([op(StkOp.NUM_PARAM), globalStore(0)], undefined, undefined, {
    program: [
      op(StkOp.NUM_PARAM), globalStore(1),
      ...int(4444), varStore(0), ...int(1), ...int(0), op(StkOp.PARAM_STORE),
    ],
    place: (game, locr) => {
      const data = game.ctx.dungeon.getData();
      data.specialLocations = { [ADJUST_SKILLS_FILTER_KEY]: locr };
    },
  });
  adjustSkills(game.ctx, 0, 0, 1, AdjustSkillsWhy.Unknown, 0);
  const g = again();
  console.log(`1. a timer's DSA finds a count of ${before[0]}; the adjust-skills filter then runs on ${g[1]}, `
    + `and the timer's DSA after it finds ${g[0]}`);
  check(before[0] === 0 && g[1] === 9, 'the adjust-skills filter ran, on its nine parameters');
  check(g[0] === 0, 'a DSA a timer runs after it finds the count it had, 0');
}

/* ------------------------------- 6. the adjust-skills filter's answer ---------- */
{
  const filter = (program: number[]) => ({
    program,
    place: (game: Game, locr: number) => {
      const data = game.ctx.dungeon.getData();
      data.specialLocations = { [ADJUST_SKILLS_FILTER_KEY]: locr };
    },
  });
  const big = run([...int(0), globalStore(2)], undefined, undefined,
    filter([...int(0), varStore(0), ...int(0), varStore(1), ...int(0x12345), varStore(2), ...int(3), ...int(0), op(StkOp.PARAM_STORE)]));
  const skill = big.game.ctx.party.state.champions[0]!.skills[0]!;
  const before = skill.experience;
  adjustSkills(big.game.ctx, 0, 0, 1, AdjustSkillsWhy.Unknown, 0);
  console.log(`6. the filter answers 0x12345: the skill gains 0x${(skill.experience - before).toString(16)}`);
  check(skill.experience - before === 0x2345, 'the skill takes the low word of the filter\'s answer');

  const zero = run([...int(0), globalStore(2)], undefined, undefined, filter([op(StkOp.NUM_PARAM), globalStore(3)]));
  zero.game.systems.magic.applySpellSkillGain(0, 0, 0, AdjustSkillsWhy.CastSpell1);
  const ran = zero.game.systems.dsa.getGlobalVariables()[3];
  console.log(`   a gain of 0: the filter ${ran === 9 ? 'runs' : 'does not run'}`);
  check(ran === 9, 'a gain of 0 runs the filter');
}

/* ------------------------------- 2. the party attack's parameters -------------- */
{
  const { game, g: before, again } = run([
    op(StkOp.NUM_PARAM), globalStore(0),
    ...int(2), ...int(10), op(StkOp.PARAM_FETCH), varFetch(10), globalStore(1), varFetch(11), globalStore(2),
  ]);
  game.systems.attack.attack(1, AttackType.atk_WARCRY);
  const g = again();
  console.log(`2. a timer's DSA finds a count of ${before[0]}; after champion 1's war cry, ${g[0]}, `
    + `and the words ${g[1]} ${g[2]}`);
  check(before[0] === 0 && g[0] === 124, 'the attack leaves its count, sizeof(ATTACKPARAMETERS), in the array');
  check(g[1] === 1 && g[2] === AttackType.atk_WARCRY, 'and its words, the champion and the attack type first');
}

/**
 * The parameters a parameter message brings (`readRoomTimerParameters`): `words`, or,
 * for null, a count of -1 and the words left as they are.
 */
function message(game: Game, words: number[] | null): void {
  const timer = standInOf<TimerEntry>({ function: TimerFunction.TT_PARAMETER_MESSAGE, index: 999 });
  if (words) game.ctx.dungeon.writeExpoolRecord(messageParametersKey(timer.index), words);
  game.systems.dsa.readRoomTimerParameters(timer);
}

/* ------------------------------- 3. the count, unsigned ------------------------ */
{
  const { game, again } = run([
    ...int(77), varStore(13), ...int(77), varStore(14),
    ...int(5), ...int(10), op(StkOp.PARAM_FETCH), ...report(10, 5),
    op(StkOp.NUM_PARAM), globalStore(5),
  ]);
  message(game, [11, 22, 33]);
  const short = again();
  message(game, null);
  const gone = again();
  console.log(`3. &PARAM@ 5 on a count of ${short[5]}: ${short.slice(0, 5).join(' ')}; `
    + `on a count of ${gone[5]}: ${gone.slice(0, 5).join(' ')}`);
  check(short.slice(0, 5).join() === '11,22,33,0,0', 'a count of 3 copies three words, and the two past it read 0');
  check(gone[5] === -1 && gone.slice(0, 5).join() === '11,22,33,0,0',
    'a count of -1 is never short: the five words are copied as they stand');
}

/* ------------------------------- 4. nothing past 100 --------------------------- */
{
  const { game, again } = run([
    ...int(77), varStore(20), ...int(101), ...int(20), op(StkOp.PARAM_FETCH), varFetch(20), globalStore(0),
    ...int(4444), varStore(0), ...int(101), ...int(0), op(StkOp.PARAM_STORE),
    ...int(1), ...int(30), op(StkOp.PARAM_FETCH), varFetch(30), globalStore(1),
  ]);
  message(game, [11, 22, 33]);
  const g = again();
  console.log(`4. &PARAM@ 101 leaves a variable of 77 at ${g[0]}; after &PARAM! 101, word 1 is ${g[1]}`);
  check(g[0] === 77, '&PARAM@ 101 copies nothing and marks nothing');
  check(g[1] === 11, '&PARAM! 101 stores nothing');
}

/* ------------------------------- 5. the variables a short fetch reads -------- */
{
  const { game, again } = run([...int(5), ...int(10), op(StkOp.PARAM_FETCH)]);
  message(game, [11, 22, 33]);
  const traced: string[] = [];
  game.ctx.host.trace = (line) => { traced.push(line); };
  again();
  const read = traced.flatMap((line) => /^DSA variable\[(\d+)\]/.exec(line)?.[1] ?? []);
  console.log(`5. &PARAM@ 5 on a count of 3 reads the variables ${read.join(' ')}`);
  check(read.join() === '3,4', 'each missing parameter reads the variable of its number, never variable 0');
}

finish();
