/**
 * The eye's item properties (`showItemProperties`, `DEBT.md` X): the extra's lines under
 * CSBWin's description (`DescribeObject`, `doc/CSBwin-src/Character.cpp:3424`).
 *
 * 1. **Every object type of the default dungeon**, its CSBWin lines and the extra's, each
 *    of the extra's lines at most 18 characters, so that it never wraps. With the setting
 *    off, the panel holds CSBWin's lines alone: under its last row, the rows are the
 *    blank panel's (graphic 20). With it on, it differs from the panel off only in the
 *    rows `placeItemPropertyLines` gives the extra.
 * 2. **The layout**, on lines this tool supplies: the first at viewport y 122, the next 7
 *    rows up, and under every count of CSBWin's rows from one to five no line of the
 *    extra reaches CSBWin's last row (a line covers rows y-4 to y+1). A line that does
 *    not fit is dropped, and every line after it. Drawn, the extra's lines change no pixel
 *    of CSBWin's rows, and none outside their own rows or the panel's inner edge.
 * 3. **A viewing filter that rewrites the description hides the extra**: a DSA's
 *    `&DESCRIBE` marks the description rewritten, one that runs none does not, and a
 *    dungeon with no filter neither (`processViewingFilter`, `src/engine/DsaSystem.ts`).
 * 4. **Every weapon type**, on a record of its own: `DAMAGE` its `uByte2` first, then what
 *    carrying it gives, which is what `AdjustStatsForItemCarried` applies in each of the
 *    30 slots, then `MISSILE` its `uByte3` unless 0, then the ammunition a launcher
 *    shoots or the launcher an ammunition needs, a pair `matchingAmmunition` accepts,
 *    then a torch's light, `d.Word1074[charges]` at every charge, or the charges of a
 *    weapon one of whose attacks `GetLegalAttackTypes` withdraws once they are spent. A
 *    cursed staff gives -3 Luck and no mana.
 * 5. **Every garment type**: `ARMOUR` its `uByte1` and `SHARP` its `uByte2 & 7` first, then
 *    `SHIELDS ALL PARTS` for the garments whose bit 7 is set, which in a hand change the
 *    armour `armourStrength` gives a part and the others leave as it was, then what
 *    wearing it gives, which is what `AdjustStatsForItemCarried` applies, then the Elven
 *    Boots' sixteenth of the maximum load and the Boots of Speed's tick, what `maxLoad`
 *    and `timeToMove` add with them on the feet and with no other garment.
 * 6. **Every food, the water containers and every potion type**, against the feeding
 *    parameters `computeFeedParameters` works out: `FOOD` its `foodValue`, `WATER` a
 *    waterskin's gulp unless it is empty, and a water flask's to anyone, each `OF 2048`,
 *    which is where `applyFeedParameters` stops a champion's food and water. A potion,
 *    at four powers, to a champion of priest mastery above 1: `POWER` its power, then the
 *    attribute it raises, the poison it cures, the stamina or the health it gives back
 *    as a fraction of the maximum and the wounds it heals, the shield or the mana. To a
 *    champion of priest mastery 1, or with none selected, no potion has a line. The misc
 *    objects that give while carried give what `AdjustStatsForItemCarried` applies.
 * 7. **What an object adds to the masteries, and an Illumulet's light**: every weapon,
 *    garment and misc type, in the weapon hand and round the neck, adds to each of the
 *    20 skills what `determineMastery` counts beyond the champion's own, `ALL SKILLS +n`
 *    what it adds to every one, then each skill it adds more to. An Illumulet's `LIGHT`
 *    is what `addCharacterPossession` round the neck adds to the party's brightness, and
 *    `removeCharacterPossession` takes off.
 *
 * Run: `npm test -- --only=dump-item-properties.ts`
 */
import { OBJNI_ILLUMULET_A, OBJNI_STAFF, OBJNI_TORCH_A, OBJNI_TORCH_D, OBJNI_WATERSKIN } from '../src/core/objectNameIndex';
import { PotionType } from '../src/core/constants';
import { applyFeedParameters, clearFeedParameters, type FeedParameters } from '../src/engine/Feeding';
import { computeFeedParameters } from '../src/renderer/ui/Feeding';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import { AdjustStatsForItemCarried } from '../src/engine/AdjustStatsForItemCarried';
import { attributeCurrent, attributeMaximum, attributeMinimum } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { determineMastery } from '../src/engine/skills';
import { CLASS_NAMES, SUBSKILL_NAMES } from '../src/renderer/ui/ChampionDialog';
import { getAttackClass } from '../src/renderer/ui/Objects';
import { getLegalAttackTypes } from '../src/renderer/ui/Attack';
import { NO_EXTRAS, nameIndexOf, type GameContext } from '../src/engine/GameContext';
import { OBJDI_COMPASS, OBJDI_EYE_OF_TIME } from '../src/engine/objectIndex';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { describeObject, drawItemPropertyLines, drawObjectInfoPanel } from '../src/renderer/ui/Inventory';
import { blitBasicGraphicToViewport } from '../src/renderer/ui/Draw';
import {
  ITEM_DESCRIPTION_Y, ITEM_LINE_CHARS, ITEM_LINE_STEP, ITEM_PROPERTY_Y,
  drawItemDescriptionLine, getItemPropertyLines, getObjectDisplayName, placeItemPropertyLines,
  resolveObjectNameIndex, wrapItemDescriptionLine, type ItemDescriptionLine,
} from '../src/renderer/ui/Objects';
import type { UIState } from '../src/renderer/ui/UIState';
import { SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y, getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { globalStore, int, op, varFetch, withFilterDsas } from './lib/dsa';
import { stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { testChampion } from './lib/champion';

/** The eye panel, graphic 20 at viewport (80, 52)-(223, 124), its frame's inner edge at y 123. */
const PANEL = { x1: 80, y1: 52, x2: 223, y2: 123 };
const TEXT_X = 108;

function uiFor(game: Game): UIState {
  const graphics = stockGraphics();
  const cache = new Map();
  const ui = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.partyState = game.ctx.party.state;
  return ui;
}

const setExtra = (ctx: GameContext, on: boolean): void => {
  ctx.extras = { ...NO_EXTRAS, showItemProperties: on };
};

/** The panel's pixels, row by row, in viewport rows `y1` to `y2`. */
function panelRows(ui: UIState, y1: number, y2: number): number[][] {
  const pixels = ui.screenIndexBuffer.pixels;
  const rows: number[][] = [];
  for (let y = y1; y <= y2; y++) {
    const row: number[] = [];
    for (let x = PANEL.x1; x <= PANEL.x2; x++) row.push(pixels[(VIEWPORT_Y + y) * SCREEN_WIDTH + VIEWPORT_X + x]!);
    rows.push(row);
  }
  return rows;
}

/** The viewport points where two snapshots of the whole panel differ. */
function differences(before: number[][], after: number[][]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < before.length; r++) {
    for (let c = 0; c < before[r]!.length; c++) {
      if (before[r]![c] !== after[r]![c]) out.push({ x: PANEL.x1 + c, y: PANEL.y1 + r });
    }
  }
  return out;
}

const rowsOf = (lines: ItemDescriptionLine[]): number =>
  lines.reduce((n, line) => n + wrapItemDescriptionLine(line.text).length, 0);
const lastRowY = (lines: ItemDescriptionLine[]): number => ITEM_DESCRIPTION_Y + (rowsOf(lines) - 1) * ITEM_LINE_STEP;

const DATABASES: Array<[DBType, 'weapons' | 'clothing' | 'potions' | 'misc']> = [
  [DBType.WEAPON, 'weapons'], [DBType.CLOTHING, 'clothing'], [DBType.POTION, 'potions'], [DBType.MISC, 'misc'],
];

/** A champion who masters every skill, so that only charges withdraw an attack. */
function masterChampion(): Champion {
  return testChampion(0, { skills: Array.from({ length: 20 }, () => ({ experience: 1 << 22, tempAdjust: 0 })) });
}

/** A weapon record of `type`, on no square. */
function newWeapon(game: Game, type: number, charges: number, cursed = false): ObjectID {
  const db = game.ctx.dungeon.getData().databases.weapons;
  db.records.push({
    nextObject: OBJECT_ID_EOF, important: false, cursed, broken: false, charges, litTorch: false, poisoned: false, weaponType: type,
  });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
}

/** A garment record of `type`, on no square. */
function newGarment(game: Game, type: number): ObjectID {
  const db = game.ctx.dungeon.getData().databases.clothing;
  db.records.push({ nextObject: OBJECT_ID_EOF, important: false, cursed: false, broken: false, charges: 0, clothingType: type });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(DBType.CLOTHING, db.records.length - 1);
}

/** A misc record of `type`, holding `value`, on no square. */
function newMisc(game: Game, type: number, value: number): ObjectID {
  const db = game.ctx.dungeon.getData().databases.misc;
  db.records.push({ nextObject: OBJECT_ID_EOF, important: false, cursed: false, specialState: value, miscType: type });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(DBType.MISC, db.records.length - 1);
}

/** A potion record of `type` and `power`, on no square. */
function newPotion(game: Game, type: number, power: number): ObjectID {
  const db = game.ctx.dungeon.getData().databases.potions;
  db.records.push({ ...db.records[0]!, nextObject: OBJECT_ID_EOF, potionType: type, power });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(DBType.POTION, db.records.length - 1);
}

/**
 * A potion's lines read off the feeding parameters `computeFeedParameters` gave a priest
 * of 1 stamina and health out of 1000, no mana out of 900, and no shield: what each
 * gives is then the whole figure, and a fraction of 1000 names its divisor.
 */
function expectedPotionLines(type: number, power: number, fp: FeedParameters): string[] {
  if (fp.waterValue !== 0) return [`WATER ${fp.waterValue} OF 2048`];
  if (type === PotionType.EMPTY_FLASK) return [];
  const lines = [`POWER ${power}`];
  const add = (name: string, n: number): void => { if (n !== 0) lines.push(`${name} ${signed(n)}`); };
  add('STRENGTH', fp.strengthAdjust);
  add('DEXTERITY', fp.dexterityAdjust);
  add('WISDOM', fp.wisdomAdjust);
  add('VITALITY', fp.vitalityAdjust);
  if (fp.antiVenin) lines.push('CURES POISON');
  const divisor = (gain: number): number => [2, 3, 4, 5, 6, 7].find((d) => Math.trunc(1000 / d) === gain) ?? 0;
  if (fp.staminaAdjust !== 0) lines.push(`STAMINA +MAX/${divisor(fp.staminaAdjust)}`);
  if (fp.hitpointAdjust !== 0) lines.push(`HEALTH +MAX/${divisor(fp.hitpointAdjust)}`);
  if (fp.healCount !== 0) lines.push('HEALS WOUNDS');
  add('SHIELD', fp.shieldStrengthAdjust);
  add('MANA', fp.manaAdjust);
  return lines;
}

/** A garment line's place in the priority order, -1 for a line of no kind. */
function garmentLineRank(line: string): number {
  if (line.startsWith('ARMOUR ')) return 0;
  if (line === 'SHIELDS ALL PARTS') return 1;
  if (isCarriedLine(line)) return 2;
  if (isMasteryLine(line)) return 2.5;
  if (line.startsWith('MAX LOAD ') || line.startsWith('MOVE TIME ')) return 3;
  return -1;
}

/** The attribute names a carried line starts with, in `AttributeIndex` order, then the mana. */
const ATTRIBUTE_NAMES = ['LUCK', 'STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];
const isCarriedLine = (line: string): boolean => /^[A-Z-]+ [+-]\d+$/.test(line)
  && [...ATTRIBUTE_NAMES, 'MANA'].includes(line.split(' ')[0]!);
const isMasteryLine = (line: string): boolean => /^(ALL SKILLS|[A-Z]+ SKILL) \+\d+$/.test(line);
const sameLines = (a: string[], b: string[]): boolean => JSON.stringify(a) === JSON.stringify(b);
const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

/**
 * What `AdjustStatsForItemCarried` does with `rn` in each of a champion's 30 slots, as the
 * extra's lines: the attribute whose maximum, current and minimum all moved, or the
 * maximum mana, by how much, each change once.
 */
function engineCarriedLines(game: Game, rn: ObjectID): string[] {
  const lines: string[] = [];
  const nameIndex = (object: ObjectID): number => nameIndexOf(game.ctx, object);
  for (let slot = 0; slot < 30; slot++) {
    const champion = testChampion(0);
    const before = champion.attributes.stats.map((a) => [attributeMaximum(a), attributeCurrent(a), attributeMinimum(a)]);
    const maxMana = champion.attributes.maxMana;
    AdjustStatsForItemCarried(champion, slot, 1, rn, game.ctx.dungeon, nameIndex);
    const moved: string[] = [];
    champion.attributes.stats.forEach((a, i) => {
      const [max, current, min] = before[i]!;
      const delta = attributeMaximum(a) - max!;
      if (delta !== 0 && attributeCurrent(a) - current! === delta && attributeMinimum(a) - min! === delta) {
        moved.push(`${ATTRIBUTE_NAMES[i]} ${signed(delta)}`);
      }
    });
    if (champion.attributes.maxMana !== maxMana) moved.push(`MANA ${signed(champion.attributes.maxMana - maxMana)}`);
    for (const line of moved) if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

/**
 * What `determineMastery` counts for `rn` in `slot` beyond an empty-handed champion's own
 * mastery, skill by skill, read as the extra's lines: what it adds to every skill, then
 * each skill it adds more to.
 */
function engineMasteryLines(game: Game, rn: ObjectID): string[] {
  const names = [...CLASS_NAMES, ...SUBSKILL_NAMES];
  const options = { getObjectNameIndex: (object: ObjectID) => nameIndexOf(game.ctx, object) };
  const added = names.map((_, skill) => Math.max(...[1, 10].map((slot) => {
    const champion = testChampion(0);
    const own = determineMastery(champion, skill, options);
    champion.possessions[slot] = rn;
    return determineMastery(champion, skill, options) - own;
  })));
  const all = Math.min(...added);
  const lines = all > 0 ? [`ALL SKILLS +${all}`] : [];
  added.forEach((n, skill) => { if (n > all) lines.push(`${names[skill]} SKILL +${n - all}`); });
  return lines;
}

/** Whether `matchingAmmunition` takes ammunition of `ammunitionType` in the off hand for a launcher of `launcherType`. */
function matches(game: Game, champion: Champion, launcherType: number, ammunitionType: number): boolean {
  if (launcherType < 0 || ammunitionType < 0) return false;
  champion.possessions[1] = newWeapon(game, launcherType, 0);
  champion.possessions[0] = newWeapon(game, ammunitionType, 0);
  const ok = game.ctx.systems.character.matchingAmmunition(champion, 0);
  champion.possessions[0] = OBJECT_ID_NULL;
  champion.possessions[1] = OBJECT_ID_NULL;
  return ok;
}

/** The first weapon type named `name`. */
function weaponTypeNamed(ui: UIState, name: string): number {
  const ot = ui.objectTables.objDescObjectType;
  return ui.objectTables.weaponDesc.findIndex((_, type) => ui.objectTables.objectNames[ot[OBJDI_EYE_OF_TIME + type]!] === name);
}

/** How many attacks `GetLegalAttackTypes` offers the party's champion 0 with `rn` in the weapon hand. */
function optionsHeld(ui: UIState, champion: Champion, rn: ObjectID): number {
  champion.possessions[1] = rn;
  getLegalAttackTypes(ui, 0, ui.uiTables.graphic230.legalAttacks[getAttackClass(ui, rn)] ?? []);
  champion.possessions[1] = OBJECT_ID_NULL;
  return ui.word20248;
}

/** A weapon line's place in the priority order, -1 for a line of no kind. */
function weaponLineRank(line: string): number {
  if (line.startsWith('DAMAGE ')) return 0;
  if (isCarriedLine(line)) return 1;
  if (isMasteryLine(line)) return 1.5;
  if (line.startsWith('MISSILE ')) return 2;
  if (line.startsWith('SHOOTS ') || line.startsWith('AMMO FOR ')) return 3;
  if (line.startsWith('LIGHT ') || line.startsWith('CHARGES ')) return 4;
  return -1;
}

console.log('=== 1. every object type of the default dungeon ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const dungeon = game.ctx.dungeon;
  const seen = new Set<number>();
  let types = 0;
  let tooLong = 0;
  let offNotCsbwin = 0;
  let onOutsideRows = 0;
  for (const [db, key] of DATABASES) {
    const records = dungeon.getData().databases[key].records;
    for (let i = 0; i < records.length; i++) {
      if (records[i]!.nextObject === OBJECT_ID_NULL) continue;
      const rn = dungeon.rnMaps.rn(db, i);
      const nameIndex = resolveObjectNameIndex(ui, rn);
      if (nameIndex < 0 || seen.has(nameIndex)) continue;
      seen.add(nameIndex);
      types++;

      ui.describedObject = describeObject(ui, rn);
      const csbwin = ui.describedObject.lines;
      const extra = getItemPropertyLines(ui, rn);
      console.log(`${String(nameIndex).padStart(3)} ${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} `
        + `${csbwin.map((l) => l.text).join(' / ')}${extra.length ? `  ||  ${extra.join(' / ')}` : ''}`);
      for (const line of extra) {
        if (line.length > ITEM_LINE_CHARS) {
          tooLong++;
          console.log(`    over ${ITEM_LINE_CHARS} characters: "${line}"`);
        }
      }

      const under = lastRowY(csbwin) + 2;
      setExtra(game.ctx, false);
      drawObjectInfoPanel(ui, rn);
      const off = panelRows(ui, PANEL.y1, PANEL.y2);
      setExtra(game.ctx, true);
      drawObjectInfoPanel(ui, rn);
      const on = panelRows(ui, PANEL.y1, PANEL.y2);
      blitBasicGraphicToViewport(ui, 20, ui.uiTables.graphic232.wRectPos926, 144, 8);
      const blank = panelRows(ui, PANEL.y1, PANEL.y2);
      if (JSON.stringify(off.slice(under - PANEL.y1)) !== JSON.stringify(blank.slice(under - PANEL.y1))) {
        offNotCsbwin++;
        console.log(`    the setting off draws something under CSBWin's last row`);
      }
      const placed = placeItemPropertyLines(csbwin, extra);
      const stray = differences(off, on).filter((p) => p.x < TEXT_X || !placed.some(({ y }) => p.y >= y - 4 && p.y <= y + 1));
      if (stray.length > 0) {
        onOutsideRows++;
        console.log(`    the setting on changes ${stray.length} pixels outside the extra's rows`);
      }
    }
  }
  setExtra(game.ctx, false);
  console.log(`${types} object types`);
  check(types > 100, 'the default dungeon holds over a hundred object types');
  check(tooLong === 0, `no line of the extra is over ${ITEM_LINE_CHARS} characters`);
  check(offNotCsbwin === 0, "with the setting off, every panel holds CSBWin's lines alone: under them, the blank panel");
  check(onOutsideRows === 0, "with the setting on, a panel differs from the panel off only in the extra's rows");
}

console.log('\n=== 2. the layout, on lines this tool supplies ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const supplied = ['FIRST LINE', 'SECOND LINE', 'THIRD LINE', 'FOURTH LINE', 'FIFTH LINE', 'SIXTH 18 CHARACTER'];
  check(supplied.every((line) => line.length <= ITEM_LINE_CHARS), 'the supplied lines are at most 18 characters');
  const weight: ItemDescriptionLine = { text: 'WEIGHS 1.0 KG.', color: 13 };
  const cases: Array<[string, ItemDescriptionLine[]]> = [1, 2, 3, 4, 5].map((n) =>
    [`${n} CSBWin row${n > 1 ? 's' : ''}`, Array.from({ length: n }, () => weight)]);
  cases.push(['a wrapped phrase line and the weight', [{ text: '(POISONED, BROKEN AND CURSED)', color: 13 }, weight]]);
  let first = true;
  for (const [what, description] of cases) {
    const rows = rowsOf(description);
    const last = lastRowY(description);
    const placed = placeItemPropertyLines(description, supplied);
    console.log(`${what}: CSBWin's last row at y ${last}; the extra at ${placed.map(({ text, y }) => `${y} ${text}`).join(', ')}`);
    if (first) check(placed[0]?.y === ITEM_PROPERTY_Y, `the first line of the extra is at y ${ITEM_PROPERTY_Y}`);
    first = false;
    check(placed.every(({ y }, i) => y === ITEM_PROPERTY_Y - i * ITEM_LINE_STEP && y + 1 <= PANEL.y2),
      `${what}: the extra's lines go up from y ${ITEM_PROPERTY_Y}, 7 rows apart, inside the frame`);
    check(placed.every(({ text }, i) => text === supplied[i]), `${what}: in their priority order, the dropped ones last`);
    check(placed.length === 6 - rows, `${what}: ${6 - rows} of the extra's lines fit, the rest dropped`);
    check(placed.every(({ y }) => y - 4 > last + 1), `${what}: no line of the extra reaches CSBWin's last row`);

    const g232 = ui.uiTables.graphic232;
    blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);
    const state = { x: VIEWPORT_X + TEXT_X, y: VIEWPORT_Y + ITEM_DESCRIPTION_Y };
    for (const line of description) drawItemDescriptionLine(ui, line.text, line.color, state);
    const before = panelRows(ui, PANEL.y1, PANEL.y2);
    drawItemPropertyLines(ui, description, supplied);
    const after = panelRows(ui, PANEL.y1, PANEL.y2);
    const changed = differences(before, after);
    check(changed.every((p) => p.y > last + 1 && p.x >= TEXT_X && p.x <= PANEL.x2 && p.y <= PANEL.y2),
      `${what}: drawn, the extra changes no pixel of CSBWin's rows, nor outside the panel's text`);
    check(placed.every(({ y }) => changed.some((p) => p.y >= y - 4 && p.y <= y + 1)),
      `${what}: each line placed is drawn in its own rows`);
  }
}

console.log('\n=== 3. a viewing filter that rewrites the description ===');
{
  /** `ESL_VIEWINGFILTER` (`doc/CSBwin-src/CSB.h:1541`). */
  const ESL_VIEWINGFILTER = 3;
  /** Parameter 0 into global 0, a DSA that changes nothing. */
  const read = [...int(1), ...int(10), op(StkOp.PARAM_FETCH), varFetch(10), globalStore(0)];
  /** `&DESCRIBE`: phrase `index` enabled (-1) or disabled (-2), in `color`. */
  const describe = (locr: number, index: number, color: number): number[] =>
    [...int(locr), ...int(index), ...int(color), op(StkOp.DESCRIBE)];
  const rewritten = (game: Game): boolean => {
    const ui = uiFor(game);
    game.ctx.party.state.selectedCharacterIndex = 1;
    const weapon = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0);
    return describeObject(ui, weapon).rewritten;
  };
  const results: Array<[string, boolean, boolean]> = [
    ['no viewing filter', rewritten(stockGame()), false],
    ['a filter that runs no &DESCRIBE', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [read])), false],
    ['a filter whose &DESCRIBE disables the weight', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [[...read, ...describe(-2, 6, 13)]])), true],
    ['a filter whose &DESCRIBE only colours phrase 6', rewritten(withFilterDsas(ESL_VIEWINGFILTER, [[...read, ...describe(-1, 6, 5)]])), true],
  ];
  for (const [what, got, want] of results) {
    console.log(`${what}: ${got ? 'rewritten, the extra hidden' : 'let through, the extra shown'}`);
    check(got === want, `${what}: ${want ? 'rewritten' : 'let through'}`);
  }
}

console.log('\n=== 4. every weapon type ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const holder = masterChampion();
  game.ctx.party.addChampion(holder);
  const weapons = ui.objectTables.weaponDesc;
  let wrongDamage = 0;
  let wrongCarried = 0;
  let wrongMissile = 0;
  let wrongShot = 0;
  let wrongCharges = 0;
  let wrongOrder = 0;
  let tooLong = 0;
  let shots = 0;
  let torches = 0;
  let charged = 0;
  for (let type = 0; type < weapons.length; type++) {
    const desc = weapons[type]!;
    const rn = newWeapon(game, type, 9);
    const nameIndex = resolveObjectNameIndex(ui, rn);
    const lines = getItemPropertyLines(ui, rn);
    console.log(`${String(type).padStart(2)} ${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} class ${String(desc.uByte1).padStart(3)}  ${lines.join(' / ')}`);
    tooLong += lines.filter((line) => line.length > ITEM_LINE_CHARS).length;

    if (lines[0] !== `DAMAGE ${desc.uByte2}`) wrongDamage++;
    if (!sameLines(lines.filter(isCarriedLine), engineCarriedLines(game, rn))) {
      wrongCarried++;
      console.log(`    carried: the extra ${lines.filter(isCarriedLine).join(', ')}, the engine ${engineCarriedLines(game, rn).join(', ')}`);
    }
    const missile = lines.filter((line) => line.startsWith('MISSILE '));
    if (missile.join() !== (desc.uByte3 !== 0 ? `MISSILE ${desc.uByte3}` : '')) wrongMissile++;

    // The pair a shot line names, put in the hands, is one `matchingAmmunition` accepts.
    const shot = lines.find((line) => line.startsWith('SHOOTS ') || line.startsWith('AMMO FOR '));
    const fires = weapons.some((other) => matches(game, holder, type, weapons.indexOf(other)));
    const fired = weapons.some((other) => matches(game, holder, weapons.indexOf(other), type));
    if (shot) {
      shots++;
      const other = weaponTypeNamed(ui, shot.replace(/^(SHOOTS|AMMO FOR) /, ''));
      const ok = shot.startsWith('SHOOTS ') ? matches(game, holder, type, other) : matches(game, holder, other, type);
      if (!ok) wrongShot++;
    } else if (fires || fired) {
      wrongShot++;
    }

    // A torch's light at every charge; any other weapon's charges, shown when spending them
    // withdraws an attack.
    if (nameIndex >= OBJNI_TORCH_A && nameIndex <= OBJNI_TORCH_D) {
      torches++;
      for (let charges = 0; charges < 16; charges++) {
        const torch = newWeapon(game, type, charges);
        const light = getItemPropertyLines(ui, torch).at(-1);
        if (light !== `LIGHT ${ui.uiTables.graphic232.word1074[charges]}`) wrongCharges++;
      }
    } else {
      const withdrawn = optionsHeld(ui, holder, newWeapon(game, type, 0)) < optionsHeld(ui, holder, rn);
      const line = lines.find((l) => l.startsWith('CHARGES '));
      if (withdrawn) charged++;
      if ((line ?? '') !== (withdrawn ? 'CHARGES 9' : '')) {
        wrongCharges++;
        console.log(`    charges: the extra "${line ?? ''}", an attack withdrawn at 0: ${withdrawn}`);
      }
    }

    const ranks = lines.map(weaponLineRank);
    if (ranks.some((rank, i) => rank < 0 || (i > 0 && rank < ranks[i - 1]!))) wrongOrder++;
  }
  console.log(`${weapons.length} weapon types: ${shots} launchers and ammunitions, ${torches} torch, ${charged} with charges`);
  check(wrongDamage === 0, 'every weapon type: DAMAGE its uByte2, first');
  check(wrongCarried === 0, 'every weapon type: what carrying it gives is what AdjustStatsForItemCarried applies');
  check(wrongMissile === 0, 'every weapon type: MISSILE its uByte3, unless 0');
  check(shots === 7 && wrongShot === 0, 'the 7 launchers and ammunitions: each names a pair matchingAmmunition accepts, and nothing else shoots');
  check(torches === 1 && charged > 0 && wrongCharges === 0,
    "a torch: LIGHT d.Word1074[charges] at every charge; any other weapon: its CHARGES when spending them withdraws an attack");
  check(wrongOrder === 0, 'every weapon type: damage, carried, missile, shot, then light or charges');
  check(tooLong === 0, `every weapon type: no line over ${ITEM_LINE_CHARS} characters`);

  const staffType = weapons.findIndex((_, type) => resolveObjectNameIndex(ui, newWeapon(game, type, 0)) === OBJNI_STAFF);
  const cursed = newWeapon(game, staffType, 0, true);
  const cursedLines = getItemPropertyLines(ui, cursed);
  console.log(`a cursed staff: ${cursedLines.join(' / ')}`);
  check(cursedLines.includes('LUCK -3') && !cursedLines.some((line) => line.startsWith('MANA')),
    'a cursed staff: LUCK -3, and no mana');
  check(sameLines(cursedLines.filter(isCarriedLine), engineCarriedLines(game, cursed)), 'a cursed staff: what AdjustStatsForItemCarried applies');
}

console.log('\n=== 5. every garment type ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const stats = game.ctx.systems.characterStats;
  const clothingTypes = ui.objectTables.clothingArmour.length;
  let wrongArmour = 0;
  let wrongShield = 0;
  let wrongCarried = 0;
  let wrongFeet = 0;
  let wrongOrder = 0;
  let tooLong = 0;
  let shields = 0;
  let carried = 0;
  let feet = 0;
  for (let type = 0; type < clothingTypes; type++) {
    const rn = newGarment(game, type);
    const lines = getItemPropertyLines(ui, rn);
    const flags = ui.objectTables.clothingFlags[type]!;
    console.log(`${String(type).padStart(2)} ${getObjectDisplayName(ui, rn, resolveObjectNameIndex(ui, rn)).padEnd(16)} ${lines.join(' / ')}`);
    tooLong += lines.filter((line) => line.length > ITEM_LINE_CHARS).length;
    if (lines[0] !== `ARMOUR ${ui.objectTables.clothingArmour[type]} SHARP ${flags & 7}`) wrongArmour++;

    // In the off hand, a shield changes the armour of the head, and nothing else does.
    const armourWith = (inHand: ObjectID): number => {
      const champion = testChampion(0);
      champion.possessions[0] = inHand;
      game.setRandomSeed(0x2468ace);
      return game.ctx.systems.monsterAttack.armourStrength(champion, 2, false);
    };
    const shield = armourWith(rn) !== armourWith(OBJECT_ID_NULL);
    if (shield) shields++;
    if (lines.includes('SHIELDS ALL PARTS') !== shield || ((flags & 0x80) !== 0) !== shield) wrongShield++;

    const engine = engineCarriedLines(game, rn);
    if (engine.length > 0) carried++;
    if (!sameLines(lines.filter(isCarriedLine), engine)) {
      wrongCarried++;
      console.log(`    carried: the extra ${lines.filter(isCarriedLine).join(', ')}, the engine ${engine.join(', ')}`);
    }

    // On the feet of a champion who wears nothing else.
    const onFeet = testChampion(0);
    const bare = testChampion(0);
    onFeet.possessions[5] = rn;
    const load = lines.find((line) => line.startsWith('MAX LOAD '));
    const move = lines.find((line) => line.startsWith('MOVE TIME '));
    const loadGain = stats.maxLoad(onFeet) - stats.maxLoad(bare);
    const moveGain = stats.timeToMove(bare) - stats.timeToMove(onFeet);
    if (load || move) feet++;
    const share = load ? Number(load.split('/')[1]) : 0;
    if (load ? Math.abs(loadGain - stats.maxLoad(bare) / share) >= 10 : loadGain !== 0) wrongFeet++;
    if ((move ?? '') !== (moveGain !== 0 ? `MOVE TIME -${moveGain}` : '')) wrongFeet++;

    const ranks = lines.map(garmentLineRank);
    if (ranks.some((rank, i) => rank < 0 || (i > 0 && rank < ranks[i - 1]!))) wrongOrder++;
  }
  console.log(`${clothingTypes} garment types: ${shields} shields, ${carried} that give while worn, ${feet} boots that give on the feet`);
  check(wrongArmour === 0, 'every garment type: ARMOUR its uByte1 and SHARP its uByte2 & 7, first');
  check(shields === 7 && wrongShield === 0, "the 7 shields: SHIELDS ALL PARTS, bit 7, and in a hand they change a part's armour; no other garment does");
  check(carried > 0 && wrongCarried === 0, 'every garment type: what wearing it gives is what AdjustStatsForItemCarried applies');
  check(feet === 2 && wrongFeet === 0, 'the Elven Boots and the Boots of Speed: what maxLoad and timeToMove give with them on the feet');
  check(wrongOrder === 0, 'every garment type: armour, shield, carried, then the feet');
  check(tooLong === 0, `every garment type: no line over ${ITEM_LINE_CHARS} characters`);
}

console.log('\n=== 6. every food, the water containers and every potion type ===');
{
  const game = stockGame();
  const ui = uiFor(game);
  const drinker = masterChampion();
  game.ctx.party.addChampion(drinker);
  const party = game.ctx.party.state;
  party.selectedCharacterIndex = 0;
  const feed = (rn: ObjectID): FeedParameters => computeFeedParameters(ui, 0, rn)!;

  // The food and the waterskins, and the misc objects that give while carried.
  const ot = ui.objectTables.objDescObjectType;
  const miscTypes = ot.length - OBJDI_COMPASS;
  let foods = 0;
  let wrongFood = 0;
  let wrongCarried = 0;
  let carried = 0;
  for (let type = 0; type < miscTypes; type++) {
    const rn = newMisc(game, type, 0);
    const nameIndex = resolveObjectNameIndex(ui, rn);
    if (nameIndex < 0) continue;
    const lines = getItemPropertyLines(ui, rn);
    const engine = engineCarriedLines(game, rn);
    if (engine.length > 0) carried++;
    if (!sameLines(lines.filter(isCarriedLine), engine)) wrongCarried++;
    const fp = feed(rn);
    if (fp.foodValue === 0) continue;
    foods++;
    console.log(`${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} ${lines.join(' / ')}`);
    if (lines.join() !== `FOOD ${fp.foodValue} OF 2048`) wrongFood++;
  }
  const skins: string[] = [];
  let wrongWater = 0;
  const skinType = Array.from({ length: miscTypes }, (_, t) => t)
    .find((t) => resolveObjectNameIndex(ui, newMisc(game, t, 0)) === OBJNI_WATERSKIN)!;
  for (let gulps = 0; gulps <= 3; gulps++) {
    const rn = newMisc(game, skinType, gulps);
    const lines = getItemPropertyLines(ui, rn);
    skins.push(`${gulps}: ${lines.join(' / ') || '-'}`);
    if (lines.join() !== (feed(rn).waterValue !== 0 ? `WATER ${feed(rn).waterValue} OF 2048` : '')) wrongWater++;
  }
  console.log(`a waterskin with 0 to 3 gulps: ${skins.join(', ')}`);

  // 2048: where a champion's food and water stop.
  drinker.food = 2040; drinker.water = 2040;
  const capped = clearFeedParameters();
  capped.performFeeding = true; capped.foodValue = 500; capped.waterValue = 800;
  applyFeedParameters(game.ctx, 0, capped);
  const cap = [drinker.food, drinker.water];

  // Every potion type, at four powers.
  const potionLines = (type: number, power: number): string[] => getItemPropertyLines(ui, newPotion(game, type, power));
  let potions = 0;
  let wrongPotion = 0;
  let flaskTo = '';
  for (let type = 0; type <= PotionType.EMPTY_FLASK; type++) {
    for (const power of [0, 40, 150, 255]) {
      const rn = newPotion(game, type, power);
      const nameIndex = resolveObjectNameIndex(ui, rn);
      Object.assign(drinker.attributes, { stamina: 1, maxStamina: 1000, health: 1, maxHealth: 1000, mana: 0, maxMana: 900 });
      drinker.shieldStrength = 0;
      const fp = feed(rn);
      const lines = getItemPropertyLines(ui, rn);
      if (power === 150) console.log(`${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} ${lines.join(' / ') || '-'}`);
      potions++;
      if (!sameLines(lines, expectedPotionLines(type, power, fp))) {
        wrongPotion++;
        console.log(`    the extra ${lines.join(' / ')}, the feeding ${expectedPotionLines(type, power, fp).join(' / ')}`);
      }
    }
  }
  // The gate: a priest of mastery 1, then no champion selected.
  const novice = testChampion(1);
  game.ctx.party.addChampion(novice);
  const shown = (): string[] => [PotionType.KU_POTION, PotionType.VI_POTION, PotionType.WATER_FLASK, PotionType.EMPTY_FLASK]
    .map((type) => potionLines(type, 150).join(' / ') || '-');
  party.selectedCharacterIndex = 1;
  const toNovice = shown();
  party.selectedCharacterIndex = -1;
  const toNobody = shown();
  flaskTo = `${toNovice.join(', ')}; ${toNobody.join(', ')}`;
  console.log(`Ku, Vi, a water flask and an empty one, to a priest of mastery 1 then to no one: ${flaskTo}`);

  console.log(`${foods} foods, ${carried} misc objects that give while carried, ${potions} potions`);
  check(foods === 8 && wrongFood === 0, 'the 8 foods: FOOD what the feeding gives, OF 2048');
  check(wrongWater === 0 && skins[0] === '0: -', 'a waterskin: WATER what a gulp gives, OF 2048, and nothing when it is empty');
  check(cap.join() === '2048,2048', 'applyFeedParameters stops food and water at 2048');
  check(wrongPotion === 0, 'every potion type, at four powers, to a priest: POWER, then what the feeding gives');
  check(carried > 0 && wrongCarried === 0, 'every misc type: what carrying it gives is what AdjustStatsForItemCarried applies');
  const gated = ['-', '-', 'WATER 1600 OF 2048', '-'].join();
  check(toNovice.join() === gated && toNobody.join() === gated,
    'to a priest of mastery 1, or no one, a potion has no line, but a water flask its water');
}

console.log("\n=== 7. what an object adds to the masteries, and an Illumulet's light ===");
{
  const game = stockGame();
  const ui = uiFor(game);
  const ot = ui.objectTables.objDescObjectType;
  const makers: Array<[string, number, (type: number) => ObjectID]> = [
    ['weapon', ui.objectTables.weaponDesc.length, (type) => newWeapon(game, type, 0)],
    ['garment', ui.objectTables.clothingArmour.length, (type) => newGarment(game, type)],
    ['misc', ot.length - OBJDI_COMPASS, (type) => newMisc(game, type, 0)],
  ];
  let givers = 0;
  let wrongMastery = 0;
  let tooLong = 0;
  for (const [kind, count, make] of makers) {
    for (let type = 0; type < count; type++) {
      const rn = make(type);
      const nameIndex = resolveObjectNameIndex(ui, rn);
      if (nameIndex < 0) continue;
      const lines = getItemPropertyLines(ui, rn).filter(isMasteryLine);
      const engine = engineMasteryLines(game, rn);
      tooLong += lines.filter((line) => line.length > ITEM_LINE_CHARS).length;
      if (engine.length === 0 && lines.length === 0) continue;
      givers++;
      console.log(`${kind.padEnd(7)} ${getObjectDisplayName(ui, rn, nameIndex).padEnd(16)} ${lines.join(' / ')}`);
      if (!sameLines(lines, engine)) {
        wrongMastery++;
        console.log(`    the engine ${engine.join(' / ')}`);
      }
    }
  }
  check(givers === 7 && wrongMastery === 0,
    "the 7 objects that add to a mastery: what determineMastery counts in the weapon hand or round the neck");
  check(tooLong === 0, `every mastery line: no more than ${ITEM_LINE_CHARS} characters`);

  // The Illumulet, put on and taken off round the neck.
  const wearer = testChampion(0);
  game.ctx.party.addChampion(wearer);
  const party = game.ctx.party.state;
  const illumuletType = Array.from({ length: ot.length - OBJDI_COMPASS }, (_, t) => t)
    .find((t) => resolveObjectNameIndex(ui, newMisc(game, t, 0)) === OBJNI_ILLUMULET_A)!;
  const illumulet = newMisc(game, illumuletType, 0);
  const light = getItemPropertyLines(ui, illumulet).find((line) => line.startsWith('LIGHT '));
  const before = party.brightness;
  game.ctx.systems.character.addCharacterPossession(0, illumulet, 10);
  const worn = party.brightness - before;
  const wornLight = getItemPropertyLines(ui, illumulet).find((line) => line.startsWith('LIGHT '));
  game.ctx.systems.character.removeCharacterPossession(0, 10);
  const off = party.brightness - before;
  console.log(`an Illumulet: ${light}, worn ${wornLight}; round the neck the brightness +${worn}, taken off ${off}`);
  check(worn > 0 && light === `LIGHT ${worn}` && wornLight === light && off === 0,
    "an Illumulet, worn or not: LIGHT what addCharacterPossession round the neck adds, and removeCharacterPossession takes off");
}

finish();
