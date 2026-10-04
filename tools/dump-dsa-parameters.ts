/**
 * The DSA parameter arrays, run through `DsaSystem.execute` as programs of a test DSA on
 * a genuine save (`csbgame7.dat`).
 *
 * 1. **A filter runs on a parameter array of its own** (`NEWDSAPARAMETERS`,
 *    `doc/CSBwin-src/CSB.h:4220-4235`, in `AdjustSkills`, `doc/CSBwin-src/Magic.cpp:196`):
 *    the adjust-skills filter sees its nine parameters, and a DSA a timer runs after it
 *    still finds a count of 0, the array the filter wrote being gone.
 *
 * Run: `npx tsx tools/dump-dsa-parameters.ts`
 */
import type { DungeonData } from '../src/data/dungeonTypes';
import { StkOp } from '../src/engine/DsaSystem';
import { AdjustSkillsWhy, adjustSkills } from '../src/engine/skills';
import { globalStore, int, op, run, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

/** `(EDT_SpecialLocations << 24) | ESL_ADJUSTSKILLSFILTER` (`doc/CSBwin-src/Magic.cpp:259`). */
const ADJUST_SKILLS_FILTER_KEY = (3 << 24) | 6;

/* ------------------------------- 1. a filter's own parameter array ------------- */
{
  const { game, g: before, again } = run([op(StkOp.NUM_PARAM), globalStore(0)], undefined, undefined, {
    program: [
      op(StkOp.NUM_PARAM), globalStore(1),
      ...int(4444), varStore(0), ...int(1), ...int(0), op(StkOp.PARAM_STORE),
    ],
    place: (game, locr) => {
      const data: DungeonData = game.ctx.dungeon.getData();
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

finish();
