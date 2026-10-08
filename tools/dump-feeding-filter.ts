/**
 * The feeding filter (`doc/CSBwin-src/Character.cpp:4305-4361`), which `_FeedCharacter` runs
 * between working out what the object is worth and doing it, run through
 * `handleMouthPress` with DSAs on its square, against a genuine save (`csbgame7.dat`).
 *
 * 1. **A dungeon with no filter feeds as the object says**: an apple's food value.
 * 2. **Every DSA at the location runs**, each with a count of 27 and the `FEEDPARAMETERS`
 *    block (`:4350-4353`), in the struct's order (`:3953-3983`): `performFeeding`, the
 *    champion, the object's database, name index and RN, the food and water values, …,
 *    `chew`, `gulp`, and the party's square and facing as a `LOCATIONREL` (`:4051-4055`).
 * 3. **A DSA's rewrite is what the next one sees, and what the feeding does**: water
 *    instead of food.
 * 4. **`performFeeding` 0 feeds nothing**, and the apple stays on the cursor (`:4367`).
 * 5. **The DSAs run on the caller's parameters**: `_FeedCharacter` has no
 *    `NEWDSAPARAMETERS`, so the last block is left there.
 * 6. **A negative shield adjustment wraps**: `shieldStrengthAdjust` is a `ui32`, so the sum
 *    is never below 0 (`:3970`, `:4383-4391`), and the shield is its low 16 bits.
 * 7. **An empty waterskin emptied again holds 3**: `value(value() - 1)` sets two bits
 *    (`:4474-4477`, `CSB.h:1277`).
 *
 * Run: `npx tsx tools/dump-feeding-filter.ts`
 */
import { DBType, OBJECT_ID_EOF, locationRelToInteger, type ObjectID } from '../src/core/types';
import { OBJNI_APPLE, OBJNI_WATERSKIN } from '../src/core/objectNameIndex';
import type { DungeonData } from '../src/data/dungeonTypes';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { handleMouthPress } from '../src/renderer/ui/Feeding';
import { resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import type { UIState } from '../src/renderer/ui/UIState';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';
import { stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

/** `ESL_FEEDINGFILTER` (`doc/CSBwin-src/CSB.h:1539`). */
const ESL_FEEDINGFILTER = 1;
const WORDS = 27;

/** The parameter count, then the block, into globals `to` on. */
const report = (to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: WORDS }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** The block fetched, word `index` set to `value`, and stored back. */
const setWord = (index: number, value: number): number[] => [
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...int(value), varStore(10 + index), ...int(WORDS), ...int(10), op(StkOp.PARAM_STORE),
];

const graphics = stockGraphics();
const CHAMPION = 0;

/** A misc object of the type whose name index is `nameIndex`, on no square. */
function misc(game: Game, ui: UIState, nameIndex: number, specialState = 0): ObjectID {
  const data: DungeonData = game.ctx.dungeon.getData();
  const records = data.databases.misc.records;
  for (let miscType = 0; miscType < 128; miscType++) {
    records.push({ nextObject: OBJECT_ID_EOF, specialState, important: false, miscType });
    const rn = game.ctx.dungeon.rnMaps.rn(DBType.MISC, records.length - 1);
    if (resolveObjectNameIndex(ui, rn) === nameIndex) return rn;
    records.pop();
  }
  throw new Error(`no misc type has name index ${nameIndex}`);
}

/** Champion `CHAMPION` fed `nameIndex` with the mouth; the interface, the object and the champion. */
function feed(game: Game, nameIndex = OBJNI_APPLE, specialState = 0) {
  const ui = newUIState(graphics, game.ctx);
  const party = game.ctx.party.state;
  ui.partyState = party;
  const rn = misc(game, ui, nameIndex, specialState);
  party.cursorOwner = CHAMPION;
  party.selectedCharacterIndex = CHAMPION;
  party.objectInHand = rn;
  const champ = party.champions[CHAMPION]!;
  const before = { food: champ.food, water: champ.water, shield: champ.shieldStrength };
  handleMouthPress(ui);
  return { ui, rn, champ, before, game };
}

/* ------------------------------- 1. no filter ----------------------------------- */
const plain = feed(freshGame());
const foodValue = plain.champ.food - plain.before.food;
console.log(`1. no filter: an apple, food ${plain.before.food} -> ${plain.champ.food}, water ${plain.before.water} -> ${plain.champ.water}`);
check(foodValue > 0 && plain.champ.water === plain.before.water, 'with no filter the apple is food');
check(plain.game.ctx.party.state.objectInHand !== plain.rn, 'and it is eaten');

/* ------------------------------- 2, 3, 5. two DSAs ------------------------------ */
{
  const fed = feed(withFilterDsas(ESL_FEEDINGFILTER, [
    [...report(0), ...setWord(5, 0), ...setWord(6, 500)],
    report(30),
  ]));
  const g = fed.game.systems.dsa.getGlobalVariables();
  const p = fed.game.ctx.party.state;
  const location = locationRelToInteger({ l: p.position.z, x: p.position.x, y: p.position.y, p: p.facing });
  const block = [
    1, CHAMPION, DBType.MISC, OBJNI_APPLE, fed.rn, foodValue, 0, -1, -1,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 8, location, 0, 0,
  ];
  console.log(`2. the first DSA saw [${g.slice(0, 28).join(', ')}]`);
  console.log(`   the second saw [${g[30] === UNSET ? 'nothing' : g.slice(30, 58).join(', ')}]`);
  check(g.slice(0, 28).join() === [WORDS, ...block].join(), 'the count and the 27 words of the block, in the struct\'s order');
  const rewritten = block.map((w, i) => (i === 5 ? 0 : i === 6 ? 500 : w));
  check(g.slice(30, 58).join() === [WORDS, ...rewritten].join(), '3. the second DSA runs too, on the block the first rewrote');
  console.log(`3. fed: food ${fed.before.food} -> ${fed.champ.food}, water ${fed.before.water} -> ${fed.champ.water}`);
  check(fed.champ.food === fed.before.food && fed.champ.water === Math.min(2048, fed.before.water + 500),
    'the feeding is the rewritten block\'s: water, not food');
  const after = Array.from({ length: WORDS }, (_, i) => fed.game.systems.dsa.getParameter(i));
  check(after.join() === rewritten.join(), '5. the caller\'s parameters keep the last block');
}

/* ------------------------------- 4. performFeeding 0 ----------------------------- */
{
  const fed = feed(withFilterDsas(ESL_FEEDINGFILTER, [setWord(0, 0)]));
  console.log(`4. performFeeding 0: food ${fed.before.food} -> ${fed.champ.food}, the apple ${fed.game.ctx.party.state.objectInHand === fed.rn ? 'still on the cursor' : 'gone'}`);
  check(fed.champ.food === fed.before.food && fed.game.ctx.party.state.objectInHand === fed.rn,
    'nothing is fed, and the apple stays on the cursor');
}

/* ------------------------------- 6. the shield wraps ----------------------------- */
{
  const fed = feed(withFilterDsas(ESL_FEEDINGFILTER, [[...setWord(15, -10), ...setWord(16, 100)]]));
  console.log(`6. shieldStrengthAdjust -10: shield ${fed.before.shield} -> ${fed.champ.shieldStrength}`);
  check(fed.champ.shieldStrength === ((fed.before.shield - 10) & 0xffff), 'the shield is the sum\'s low 16 bits, never clamped to 0');
}

/* ------------------------------- 7. an empty waterskin --------------------------- */
{
  const game = withFilterDsas(ESL_FEEDINGFILTER, [setWord(20, 1)]);
  const fed = feed(game, OBJNI_WATERSKIN, 0);
  const left = game.ctx.dungeon.getMiscRecord(fed.rn)?.specialState;
  console.log(`7. an empty waterskin the filter empties: it holds ${left}`);
  check(left === 3, 'value(value() - 1) of 0 sets its two bits to 3');
}

finish();
