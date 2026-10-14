/**
 * The equip filter (`doc/CSBwin-src/Character.cpp:2922-3003`), which `CHARDESC::SetPossession`
 * runs for `RemoveCharacterPossession` and `AddCharacterPossession` (`:1855`, `:1967`), with
 * two DSAs on its square, against a genuine save (`csbgame7.dat`).
 *
 * 1. **A dungeon with no filter moves the object** out of the slot and into another.
 * 2. **An object leaving and one arriving**: only the first DSA runs (`break`, `:2994`),
 *    on parameters of its own (`NEWDSAPARAMETERS`, `:2942`), a count of 4, the champion,
 *    the slot, the object and 0 (`:2973-2976`). It runs with timer function 1 (column 1)
 *    for the object leaving, then 0 (column 0) for the one arriving (`:2980-2991`), on the
 *    same variables, and with the parameters the first call left but the object
 *    (`:2983`, `:2989`). The caller's parameters are as they were after it.
 * 3. **`RemoveCharacterPossession`** runs the leaving half alone, and the slot is empty.
 * 4. **`AddCharacterPossession`** runs the arriving half alone, on variables of its own,
 *    and the object is in the slot.
 *
 * Run: `npm test -- --only=dump-equip-filter.ts`
 */
import { OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';

/** `ESL_EQUIPFILTER` (`doc/CSBwin-src/CSB.h:1550`). */
const ESL_EQUIPFILTER = 12;

/** The filter's parameter count, then its first `n` parameters, into globals `to` on. */
const params = (n: number, to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(n), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: n }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** Variable 50 set to 77, and parameter 1, the slot, to 99. */
const leave = [
  ...int(77), varStore(50),
  ...int(4), ...int(10), op(StkOp.PARAM_FETCH),
  ...int(99), varStore(11), ...int(4), ...int(10), op(StkOp.PARAM_STORE),
];
/** Column 0 reports into globals 0-4 and variable 50 into 5; column 1 into 10-14. */
const first = { columns: [[...params(4, 0), varFetch(50), globalStore(5)], [...params(4, 10), ...leave]] };
const second = { columns: [params(4, 30), params(4, 40)] };

const CHAMPION = 0;

/** Champion `CHAMPION`'s first backpack slot holding an object, and its first empty one. */
function slots(game: Game): { full: number; empty: number; object: ObjectID } {
  const possessions = game.ctx.party.state.champions[CHAMPION]!.possessions;
  const full = possessions.findIndex((rn, i) => i >= 13 && rn !== OBJECT_ID_NULL);
  const empty = possessions.findIndex((rn, i) => i >= 13 && rn === OBJECT_ID_NULL);
  if (full < 0 || empty < 0) throw new Error('no full and empty backpack slots');
  return { full, empty, object: possessions[full]! };
}

/** The object in `full` moved to `empty`, through the pair. */
function move(game: Game, full: number, empty: number): ObjectID {
  const character = game.systems.character;
  const object = character.removeCharacterPossession(CHAMPION, full);
  character.addCharacterPossession(CHAMPION, object, empty);
  return object;
}

/* ------------------------------- 1. no filter ----------------------------------- */
{
  const game = freshGame();
  const { full, empty, object } = slots(game);
  const moved = move(game, full, empty);
  const possessions = game.ctx.party.state.champions[CHAMPION]!.possessions;
  console.log(`1. no filter: object ${object} moved from slot ${full} to ${empty}`);
  check(moved === object && possessions[full] === OBJECT_ID_NULL && possessions[empty] === object, 'the object moves');
}

/* ------------------------------- 2. leaving and arriving ------------------------ */
{
  const game = withFilterDsas(ESL_EQUIPFILTER, [first, second]);
  const dsa = game.systems.dsa;
  const { full, object } = slots(game);
  const arriving = game.ctx.party.state.champions[CHAMPION]!.possessions[full + 1] ?? object;
  dsa.setParameters(2, [111, 222]);
  dsa.equipFilter(CHAMPION, full, object, arriving);
  const g = dsa.getGlobalVariables();
  console.log(`2. leaving (column 1) saw [${g.slice(10, 15).join(', ')}]; arriving (column 0) saw [${g.slice(0, 5).join(', ')}] and variable 50 = ${g[5]}; the second DSA ${g[30] === UNSET && g[40] === UNSET ? 'did not run' : 'ran'}`);
  check(g.slice(10, 15).join() === [4, CHAMPION, full, object, 0].join(),
    'the object leaving: a count of 4, the champion, the slot, the object, 0, on timer function 1');
  check(g.slice(0, 5).join() === [4, CHAMPION, 99, arriving, 0].join(),
    'the object arriving, on timer function 0, after it: the parameters it left, but the object');
  check(g[5] === 77, 'both calls share the DSA\'s variables');
  check(g[30] === UNSET && g[40] === UNSET, 'the second DSA does not run');
  check(dsa.getParameter(0) === 111 && dsa.getParameter(1) === 222, 'the caller\'s parameters are as they were');
}

/* ------------------------------- 3, 4. the pair --------------------------------- */
{
  const game = withFilterDsas(ESL_EQUIPFILTER, [first, second]);
  const dsa = game.systems.dsa;
  const character = game.systems.character;
  const possessions = game.ctx.party.state.champions[CHAMPION]!.possessions;
  const { full, empty, object } = slots(game);

  character.removeCharacterPossession(CHAMPION, full);
  let g = dsa.getGlobalVariables();
  console.log(`3. remove from slot ${full}: column 1 saw [${g.slice(10, 15).join(', ')}]; column 0 ${g[0] === UNSET ? 'did not run' : 'ran'}; the slot holds ${possessions[full]}`);
  check(g.slice(10, 15).join() === [4, CHAMPION, full, object, 0].join(), 'the object leaving');
  check(g[0] === UNSET, 'nothing arrives');
  check(possessions[full] === OBJECT_ID_NULL, 'the slot is empty');

  dsa.setGlobalVariables(new Array<number>(100).fill(UNSET));
  character.addCharacterPossession(CHAMPION, object, empty);
  g = dsa.getGlobalVariables();
  console.log(`4. add to slot ${empty}: column 0 saw [${g.slice(0, 5).join(', ')}] and variable 50 = ${g[5]}; column 1 ${g[10] === UNSET ? 'did not run' : 'ran'}; the slot holds ${possessions[empty]}`);
  check(g.slice(0, 5).join() === [4, CHAMPION, empty, object, 0].join(), 'the object arriving');
  check(g[5] === 0, 'on variables of its own: variable 50 was never set');
  check(g[10] === UNSET, 'nothing leaves');
  check(possessions[empty] === object, 'the object is in the slot');
}

finish();
