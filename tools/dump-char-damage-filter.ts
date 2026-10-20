/**
 * The character death filter (`doc/CSBwin-src/Character.cpp:2540-2594`) and the damage
 * filter (`:2834-2898`), which `KillCharacter` and `DamageCharacter` run, each through
 * `MonsterAttack` with two DSAs on its square, against a genuine save (`csbgame7.dat`).
 *
 * 1. **A dungeon with no filter deals the damage worked out.**
 * 2. **Only the first DSA at the damage filter's location runs** (`break`, `:2893`), on
 *    parameters of its own (`NEWDSAPARAMETERS`, `:2850`): a count of 7, then the champion,
 *    their fingerprint, the damage asked for, the damage worked out, the wound mask, the
 *    kind and 0 (`:2881-2888`). The caller's parameters are as they were after it.
 * 3. **Its word 3 is what is dealt** (`:2891`, `:2905`): the pending damage and the result.
 * 4. **Anything a word holds**: -5 heals the pending damage, and 0x10003 deals 3.
 * 5. **Only the first DSA at the death filter's location runs** (`:2591`), before the
 *    champion is touched (`:2601`): a count of 1 and the champion's index, with their HP
 *    still read through `&CHAR@`. The champion dies after it.
 *
 * Run: `npm test -- --only=dump-char-damage-filter.ts`
 */
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';

/** `ESL_CHARDEATHFILTER` and `ESL_DAMAGECHARFILTER` (`doc/CSBwin-src/CSB.h:1549`, `:1553`). */
const ESL_CHARDEATHFILTER = 11;
const ESL_DAMAGECHARFILTER = 15;

/** The filter's parameter count, then its first `n` parameters, into globals `to` on. */
const params = (n: number, to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(n), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: n }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** Parameter 3, the damage worked out, set to `value`. */
const setDealt = (value: number): number[] => [
  ...int(7), ...int(10), op(StkOp.PARAM_FETCH),
  ...int(value), varStore(13), ...int(7), ...int(10), op(StkOp.PARAM_STORE),
];
/** `&CHAR@` of champion `chIdx`'s first three words, the third the HP, into global `to`. */
const hp = (chIdx: number, to: number): number[] => [
  ...int(chIdx), ...int(40), ...int(3), op(StkOp.CHAR_FETCH), varFetch(42), globalStore(to),
];

const CHAMPION = 0;
const DAMAGE = 10;
const MASK = 1;
const KIND = 3;

/** Champion `CHAMPION` dealt `DAMAGE` against full armour; the result and the pending damage. */
function hit(game: Game): { dealt: number; pending: number } {
  const party = game.ctx.party.state;
  const before = party.pendingDamage[CHAMPION]!;
  const dealt = game.systems.monsterAttack.damageCharacter(CHAMPION, DAMAGE, MASK, KIND);
  return { dealt, pending: party.pendingDamage[CHAMPION]! - before };
}

/* ------------------------------- 1. no filter ----------------------------------- */
const plain = hit(freshGame());
console.log(`1. no filter: ${DAMAGE} against full armour deals ${plain.dealt}, pending +${plain.pending}`);
check(plain.dealt > 0 && plain.pending === plain.dealt, 'the damage worked out is dealt');

/* ------------------------------- 2, 3. two DSAs on the damage filter ------------- */
{
  const game = withFilterDsas(ESL_DAMAGECHARFILTER, [[...params(7, 0), ...setDealt(25)], params(7, 30)]);
  const dsa = game.systems.dsa;
  dsa.setParameters(2, [111, 222]);
  const { dealt, pending } = hit(game);
  const g = dsa.getGlobalVariables();
  const fingerprint = game.ctx.party.state.champions[CHAMPION]!.fingerprint;
  console.log(`2. the first DSA saw [${g.slice(0, 8).join(', ')}]; the second ${g[30] === UNSET ? 'did not run' : `saw [${g.slice(30, 38).join(', ')}]`}`);
  check(g.slice(0, 8).join() === [7, CHAMPION, fingerprint, DAMAGE, plain.dealt, MASK, KIND, 0].join(),
    'a count of 7: champion, fingerprint, damage asked, damage worked out, mask, kind, 0');
  check(g[30] === UNSET, 'the second DSA does not run');
  check(dsa.getParameter(0) === 111 && dsa.getParameter(1) === 222, 'the caller\'s parameters are as they were');
  console.log(`3. the DSA set 25: deals ${dealt}, pending +${pending}`);
  check(dealt === 25 && pending === 25, 'its word 3 is what is dealt');
}

/* ------------------------------- 4. anything a word holds ----------------------- */
for (const [value, expected] of [[-5, -5], [0x10003, 3]] as const) {
  const { dealt, pending } = hit(withFilterDsas(ESL_DAMAGECHARFILTER, [setDealt(value)]));
  console.log(`4. the DSA set ${value}: deals ${dealt}, pending ${pending >= 0 ? '+' : ''}${pending}`);
  check(dealt === expected && pending === expected, `${value} deals the word's ${expected}`);
}

/* ------------------------------- 5. the death filter ---------------------------- */
{
  const VICTIM = 1;
  const game = withFilterDsas(ESL_CHARDEATHFILTER, [[...params(1, 0), ...hp(VICTIM, 2)], params(1, 30)]);
  const dsa = game.systems.dsa;
  dsa.setParameters(1, [333]);
  const champ = game.ctx.party.state.champions[VICTIM]!;
  const health = champ.attributes.health;
  game.systems.monsterAttack.killCharacter(VICTIM);
  const g = dsa.getGlobalVariables();
  console.log(`5. the first DSA saw [${g.slice(0, 2).join(', ')}] and HP ${g[2]} (of ${health}); the second ${g[30] === UNSET ? 'did not run' : `saw [${g.slice(30, 32).join(', ')}]`}; HP after ${champ.attributes.health}`);
  check(health > 0 && g.slice(0, 3).join() === [1, VICTIM, health].join(), 'a count of 1, the champion, whose HP are not yet 0');
  check(g[30] === UNSET, 'the second DSA does not run');
  check(dsa.getParameter(0) === 333, 'the caller\'s parameters are as they were');
  check(champ.attributes.health === 0, 'the champion dies after it');
}

finish();
