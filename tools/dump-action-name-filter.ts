/**
 * The action name filter, `ActionNameFilter` (`doc/CSBwin-src/CSBCode.cpp:8739-8818`), which
 * `DrawLegalAttackTypes` calls for each attack option it offers (`:8882`), run through
 * `prepareAttack` with DSAs on its square, against a genuine save (`csbgame7.dat`).
 *
 * 1. **A dungeon with no filter names each option by its attack** (`GetAttackTypeName`).
 * 2. **The first DSA at the location runs, once per option offered, and only it**
 *    (`:8774-8775`), with five parameters (`:8796-8801`): the champion, the option, -1, the
 *    option count and the attack type. It runs on the caller's parameters, which keep the
 *    last option's (the `NEWDSAPARAMETERS` is in the search's block, `:8758`).
 * 3. **Parameter 2 below 0x10000 names the option with that global text** (`:8805-8816`);
 *    one at or above 0x10000, or with no record, leaves the attack's name.
 * 4. **Parameter 4 is the option's attack from then on** (`:8804`), its name still the
 *    attack's it was.
 * 5. **The DSA is found once** (`actionNameDSA`, `:8743`): a filter location moved after
 *    the first menu does not move it.
 * 6. **The panel draws the names the filter chose**, not the attacks' (`:8884-8892`).
 *
 * Run: `npm test -- --only=dump-action-name-filter.ts`
 */
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { EDT_GLOBAL_TEXT } from '../src/data/DecodeText';
import type { DungeonData } from '../src/data/dungeonTypes';
import { drawAttackPanel, prepareAttack } from '../src/renderer/ui/Attack';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import type { UIState } from '../src/renderer/ui/UIState';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';
import { stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

/** `ESL_ACTIONNAMEFILTER` (`doc/CSBwin-src/CSB.h:1548`). */
const ESL_ACTIONNAMEFILTER = 10;
/** `DSACMD_GLOBALFETCH` (`doc/CSBwin-src/Data.h:1730`). */
const globalFetch = (index: number): number => 19 | (index << 6);

/** The parameter count, then the five parameters, into globals `to` on; global 40 counts the runs. */
const report = (to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(5), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: 5 }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
  globalFetch(40), op(StkOp.ONE_PLUS), globalStore(40),
];
/** Parameter `index` set to `value`, the others as fetched into variables 10 on. */
const setParam = (index: number, value: number): number[] => [
  ...int(value), varStore(10 + index), ...int(index + 1), ...int(10), op(StkOp.PARAM_STORE),
];

const graphics = stockGraphics();
const cache = new Map();

/** The interface over `game`, its party the save's. */
function uiOf(game: Game): UIState {
  const ui = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.partyState = game.ctx.party.state;
  return ui;
}

/** The first champion of the save whose menu offers the most options. */
function champion(game: Game): number {
  let best = -1;
  let most = 0;
  game.ctx.party.state.champions.forEach((_, chIdx) => {
    const ui = uiOf(freshGame());
    prepareAttack(ui, chIdx);
    if (ui.attackingCharacterOrdinal !== 0 && ui.attackOptionCount > most) [best, most] = [chIdx, ui.attackOptionCount];
  });
  if (best < 0) throw new Error('no champion of the save can attack');
  return best;
}

/** Global text `index` holding `text`, in memory order with its zero (`SetGlobalText`). */
function setGlobalText(game: Game, index: number, text: string): void {
  const record = new Array<number>(Math.floor((text.length + 4) / 4)).fill(0);
  for (let i = 0; i < text.length; i++) record[i >> 2] = (record[i >> 2]! | (text.charCodeAt(i) << (8 * (i & 3)))) >>> 0;
  game.ctx.dungeon.writeExpoolRecord(((EDT_GLOBAL_TEXT << 24) | index) >>> 0, record);
}

/** The attack panel's pixels as `drawAttackPanel` composes it. */
function panel(ui: UIState): string {
  ui.screenIndexBuffer = createPaletteIndexViewportBuffer(320, 200, 7);
  drawAttackPanel(ui);
  const r = ui.uiTables.graphic232.word20;
  const rows: string[] = [];
  for (let y = r.y1; y <= r.y2; y++) rows.push(ui.screenIndexBuffer.pixels.subarray(y * 320 + r.x1, y * 320 + r.x2 + 1).join(','));
  return rows.join('/');
}

/* ------------------------------- 1. no filter ----------------------------------- */
const plain = freshGame();
const chIdx = champion(plain);
const ui0 = uiOf(plain);
prepareAttack(ui0, chIdx);
const types = Array.from(ui0.possibleAttackTypes.subarray(0, 3));
const n = ui0.attackOptionCount;
const names = ui0.uiTables.graphic230.attackNames;
console.log(`1. champion ${chIdx}, no filter: ${n} options, types [${types.join(', ')}], named `
  + `${JSON.stringify(ui0.attackOptionNames)}`);
check(n >= 2, 'the save has a champion with two options or more');
check(ui0.attackOptionNames.join() === types.map((t) => (t === -1 ? '' : names[t])).join(),
  'with no filter each option is its attack\'s name, and the rows past the count blank');
const plainPanel = panel(ui0);

/* ------------------------------- 2. the parameters, the first DSA only ---------- */
{
  const game = withFilterDsas(ESL_ACTIONNAMEFILTER, [report(0), report(20)]);
  const ui = uiOf(game);
  prepareAttack(ui, chIdx);
  const g = game.systems.dsa.getGlobalVariables();
  const want = [5, chIdx, n - 1, -1, n, types[n - 1]];
  console.log(`2. two DSAs at the location: the first ran ${g[40]! - UNSET} times, its last run saw `
    + `[${g.slice(0, 6).join(', ')}]; the second ${g[20] === UNSET ? 'never ran' : `saw [${g.slice(20, 26).join(', ')}]`}`);
  check(g[40]! - UNSET === n, 'the filter runs once per option offered');
  check(g.slice(0, 6).join() === want.join(), 'the count and the five parameters, at the last option');
  check(g[20] === UNSET, 'only the first DSA at the location runs');
  const after = Array.from({ length: 5 }, (_, i) => game.systems.dsa.getParameter(i));
  console.log(`   the caller's parameters after: [${after.join(', ')}]`);
  check(after.join() === want.slice(1).join(), 'the DSA ran on the caller\'s parameters, which keep its last run\'s');
  check(ui.attackOptionNames.join() === ui0.attackOptionNames.join(), 'a DSA that changes nothing leaves the names');
}

/* ------------------------------- 3. a global text names the option -------------- */
for (const [index, text, renames] of [[7, 'FLAME', true], [0x10007, 'FLAME', false], [8, null, false]] as const) {
  const game = withFilterDsas(ESL_ACTIONNAMEFILTER, [[...report(0), ...setParam(2, index)]]);
  if (text !== null) setGlobalText(game, index & 0xffff, text);
  const ui = uiOf(game);
  prepareAttack(ui, chIdx);
  console.log(`3. parameter 2 set to 0x${index.toString(16)}${text === null ? ', no record' : ` (record ${index & 0xffff}: ${text})`}: `
    + `${JSON.stringify(ui.attackOptionNames)}`);
  const want = ui0.attackOptionNames.map((name, i) => (renames && i < n ? text : name));
  check(ui.attackOptionNames.join() === want.join(),
    renames ? 'a global text below 0x10000 names every option offered' : 'otherwise the attack\'s name stands');
  if (renames) check(panel(ui) !== plainPanel, '6. the panel draws the filter\'s names');
}

/* ------------------------------- 4. the attack it is ---------------------------- */
{
  const other = types[0] === 1 ? 2 : 1;
  const game = withFilterDsas(ESL_ACTIONNAMEFILTER, [[...report(0), ...setParam(4, other)]]);
  const ui = uiOf(game);
  prepareAttack(ui, chIdx);
  const now = Array.from(ui.possibleAttackTypes.subarray(0, 3));
  console.log(`4. parameter 4 set to ${other}: types [${now.join(', ')}], named ${JSON.stringify(ui.attackOptionNames)}`);
  check(now.join() === types.map((t, i) => (i < n ? other : t)).join(), 'each option offered is the attack the DSA chose');
  check(ui.attackOptionNames.join() === ui0.attackOptionNames.join(), 'named still by the attack it was');
}

/* ------------------------------- 5. found once ---------------------------------- */
{
  const game = withFilterDsas(ESL_ACTIONNAMEFILTER, [report(0)]);
  const ui = uiOf(game);
  prepareAttack(ui, chIdx);
  const data: DungeonData = game.ctx.dungeon.getData();
  data.specialLocations = {};
  prepareAttack(ui, chIdx);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`5. the filter's location gone after the first menu: the DSA ran ${g[40]! - UNSET} times over two menus`);
  check(g[40]! - UNSET === 2 * n, 'the DSA found at the first call is kept');
}

finish();
