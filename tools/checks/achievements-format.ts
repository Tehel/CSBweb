/**
 * The achievements file (`doc/ACHIEVEMENTS.md` → "The file"): the common file read, its
 * names against the real `graphics.dat`, the reader's errors, which conditions need the
 * whole game, and the evaluator over a game made of events.
 *
 * None of it is CSBWin's, and none of it shows on a frame. What to look for in the output:
 * each common achievement with its tier, whether it needs the whole game (`whole`), and
 * the aggregates it keeps by their keys, and the values it names. Every name the common file gives an item must be
 * one of FTL's objects, which is the canary: a name misspelt there would match nothing,
 * silently, in every set.
 *
 * Run: `npm test -- --only=achievements-format.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mergeAchievements, needsWholeGame, parseCondition, readAchievementFile, unknownItems, unusedValues,
  type AchievementDef, type AchievementFile,
} from '../../src/engine/achievements/AchievementFile';
import { AchievementState, type AchievementEvent } from '../../src/engine/achievements/AchievementState';
import { achievementFileOf } from '../../src/engine/achievements/PageAchievements';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { check, fail, finish } from '../lib/check';
import { DATA_SETS } from '../lib/dataSets';
import { graphicsTablesOf, STOCK_DIR, stockGraphics } from '../lib/game';

const DEFS = resolve(import.meta.dirname, '../../src/engine/achievements/defs');
const COMMON = resolve(DEFS, 'common.txt');

function read(text: string): AchievementFile {
  const r = readAchievementFile(text);
  if (!r.ok) {
    for (const e of r.errors) console.log(`  line ${e.line}: ${e.message}`);
    throw new Error('the file did not read');
  }
  return r.file;
}

/** The common file: read, printed, its whole-game flags and its names. */
function commonFile(): AchievementFile {
  console.log('--- common.txt');
  const r = readAchievementFile(readFileSync(COMMON, 'utf8'));
  check(r.ok, 'common.txt reads');
  if (!r.ok) {
    for (const e of r.errors) console.log(`  line ${e.line}: ${e.message}`);
    throw new Error('common.txt did not read');
  }
  for (const d of r.file.defs) {
    console.log(`  ${d.id.padEnd(20)} ${d.tier.padEnd(5)} ${d.whole ? 'whole' : '     '}  ${d.name}`);
    for (const a of d.aggregates) console.log(`      ${a.key}`);
    for (const v of d.values) console.log(`      {${v}}`);
  }
  const whole = new Set([
    'five-a-day', 'leather-is-enough', 'minimalist-mage', 'lone-wolf', 'buddy-cop', 'speed-runner', 'blitz', 'teetotaller',
    'vegetarian', 'carnivore', 'untouchable', 'ace-driver', 'emperors-new-clothes', 'conscientious-objector',
  ]);
  for (const d of r.file.defs) {
    check(d.whole === whole.has(d.id), `${d.id} ${whole.has(d.id) ? 'needs' : 'does not need'} the whole game`);
  }
  check(r.file.disabled.length === 0, 'common.txt disables nothing');
  check(r.file.values.size === 0, 'common.txt defines no value: a set without its own file has no valued achievement');
  const valued = r.file.defs.filter((d) => d.values.length > 0).map((d) => `${d.id} {${d.values.join(', ')}}`);
  console.log(`  valued: ${valued.join('; ')}`);
  check(valued.join('; ') === 'speed-runner {speedRunnerMinutes}; blitz {blitzMinutes}; conscientious-objector {objectorKills}',
    'Speed Runner, Blitz and Conscientious Objector are the valued ones, each naming its value in its text and its condition');

  const names = new Set(graphicsTablesOf(stockGraphics()).objects.objectNames);
  console.log(`--- common.txt's item names against graphics.dat's ${names.size} names`);
  for (const d of r.file.defs) {
    const unknown = unknownItems(d, names);
    check(unknown.length === 0, `${d.id} names only FTL's objects (not ${unknown.join(', ')})`);
  }
  const leather = r.file.defs.find(d => d.id === 'leather-is-enough');
  check(leather !== undefined && unknownItems(leather, new Set(['HELMET'])).includes('PLATE OF DARC'),
    'unknownItems lists a name the set lacks');
  return r.file;
}

/**
 * A set's own file, `defs/<name>.txt`: read, printed, its names against the set's
 * `graphics.dat`, laid over the common file, and the sets that read it.
 */
function setFile(common: AchievementFile, name: string, graphicsDir: string, whole: readonly string[], values: string): AchievementFile {
  console.log(`--- ${name}.txt`);
  const r = readAchievementFile(readFileSync(resolve(DEFS, `${name}.txt`), 'utf8'));
  check(r.ok, `${name}.txt reads`);
  if (!r.ok) {
    for (const e of r.errors) console.log(`  line ${e.line}: ${e.message}`);
    throw new Error(`${name}.txt did not read`);
  }
  for (const d of r.file.defs) console.log(`  ${d.id.padEnd(24)} ${d.tier.padEnd(5)} ${d.whole ? 'whole' : '     '}  ${d.name}`);
  for (const d of r.file.defs) check(d.whole === whole.includes(d.id), `${d.id} ${whole.includes(d.id) ? 'needs' : 'does not need'} the whole game`);
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(graphicsDir, 'graphics.dat'))));
  const names = new Set(graphicsTablesOf(graphics).objects.objectNames);
  for (const d of r.file.defs) {
    const unknown = unknownItems(d, names);
    check(unknown.length === 0, `${d.id} names only ${graphicsDir}'s objects (not ${unknown.join(', ')})`);
  }
  const given = [...r.file.values].map(([v, n]) => `${v} = ${n}`).join(', ');
  console.log(`  values: ${given}`);
  check(given === values, `${name}.txt gives ${values}`);
  const merged = mergeAchievements(common, r.file);
  const replaced = r.file.defs.filter((d) => common.defs.some((c) => c.id === d.id)).length;
  check(merged.length === common.defs.length + r.file.defs.length - replaced, `${name}.txt adds ${r.file.defs.length - replaced} to the common file and replaces ${replaced}, every valued one there`);
  const unused = unusedValues(r.file, merged);
  check(unused.length === 0, `every value ${name}.txt gives is named (not ${unused.join(', ')})`);
  for (const d of merged.filter((m) => m.values.length > 0)) console.log(`  ${d.id.padEnd(24)} ${d.text}`);
  const readers = DATA_SETS.filter((set) => achievementFileOf(set.id) === name).map((set) => set.id);
  console.log(`  read by ${readers.join(', ')}`);
  check(readers.length > 0, `${name}.txt is read by a set`);
  return r.file;
}

/** Each bad file is refused, its error on the right line. */
function errors(): void {
  console.log('--- errors');
  const H = '# CSBweb achievements 1\n';
  const block = (when: string): string => `${H}[a]\nname: A\ntext: T\nwhen: ${when}\n`;
  const cases: [string, string, number, RegExp][] = [
    ['no header', '[a]\nname: A\n', 1, /first line/],
    ['a bad id', `${H}[Bad_Id]\nname: A\ntext: T\nwhen: won\n`, 2, /no id/],
    ['an id used twice', `${H}[a]\nname: A\ntext: T\nwhen: won\n[a]\nname: B\ntext: T\nwhen: won\n`, 6, /twice/],
    ['no name', `${H}[a]\ntext: T\nwhen: won\n`, 2, /needs a name/],
    ['no condition', `${H}[a]\nname: A\ntext: T\n`, 2, /needs a condition/],
    ['an unknown field', `${H}[a]\ncolour: red\n`, 3, /no field/],
    ['a field before any id', `${H}name: A\n`, 2, /must follow an \[id\]/],
    ['a continuation with nothing before', `${H}[a]\n  won\n`, 3, /continued line/],
    ['a bad tier', `${H}[a]\nname: A\ntext: T\ntier: epic\nwhen: won\n`, 5, /tier/],
    ['a name too long', `${H}[a]\nname: ${'X'.repeat(33)}\ntext: T\nwhen: won\n`, 3, /over 32/],
    ['non-ASCII', `${H}[a]\nname: Café\ntext: T\nwhen: won\n`, 3, /ASCII/],
    ['disabled with fields', `${H}[a]\ndisabled\nname: A\n`, 2, /nothing else/],
    ['an unknown event', block('count(hug) > 1'), 5, /expected an event/],
    ['an unknown attribute', block('count(kill where colour = red) > 1'), 5, /no attribute "colour"/],
    ['a value outside its list', block('ever(kill where by = karate)'), 5, /one of melee/],
    ['yes or no', block('ever(kill where party = maybe)'), 5, /yes or no/],
    ['a number for a condition', block('count(kill)'), 5, /yes or a no/],
    ['a number joined by and', block('won and count(kill)'), 5, /joins/],
    ['a duration against a count', block('count(kill) > 3h'), 5, /duration/],
    ['play time against a number', block('playTime < 3'), 5, /duration/],
    ['a yes compared', block('won > 1'), 5, /compares numbers/],
    ['a quote not closed', block('ever(eat where item = "APPLE)'), 5, /not closed/],
    ['a pattern on an enum', block('ever(kill where by ~ "m*")'), 5, /compares names/],
    ['max of an event', block('max(kill) > 1'), 5, /takes a sample/],
    ['something left over', block('won won'), 5, /unexpected/],
    ['an unknown word', block('victory'), 5, /no fact/],
    ['a value after a block', `${H}[a]\nname: A\ntext: T\nwhen: won\nvalue n = 3\n`, 6, /before the first/],
    ['a value defined twice', `${H}value n = 3\nvalue n = 4\n`, 3, /twice/],
    ['a value\'s bad name', `${H}value 2n = 3\n`, 2, /no value's name/],
    ['a value not a whole number', `${H}value n = 1.5\n`, 2, /whole number/],
    ['a value line without its number', `${H}value n\n`, 2, /value name = number/],
    ['a brace not a value\'s', `${H}[a]\nname: A\ntext: Kill {n monsters.\nwhen: won\n`, 4, /braces/],
    ['a value\'s braces not closed', block('count(kill) >= {n'), 5, /braces/],
    ['a value in minutes against a count', block('count(kill) >= {n}m'), 5, /duration/],
    ['play time against a bare value', block('playTime < {n}'), 5, /duration/],
  ];
  for (const [what, text, line, message] of cases) {
    const r = readAchievementFile(text);
    if (r.ok) { fail(`${what}: refused`); continue; }
    const e = r.errors[0];
    console.log(`  ${what.padEnd(36)} line ${e?.line}: ${e?.message}`);
    check(e !== undefined && e.line === line && message.test(e.message), `${what}: refused on line ${line} saying ${message}`);
  }
  const continued = readAchievementFile(`${H}[a]\nname: A # a comment\ntext: "#" is kept in quotes\nwhen: won and\n  ever(eat where item = "A#B")\n`);
  check(continued.ok && continued.file.defs[0]?.name === 'A', 'a comment ends a field');
  check(continued.ok && continued.file.defs[0]?.aggregates[0]?.key === 'count(eat where item="A#B")',
    'a continued condition reads, a # inside quotes kept');
}

/** Which conditions need the whole game. */
function wholeGame(): void {
  console.log('--- needsWholeGame');
  const cases: [string, boolean][] = [
    ['count(kill) >= 100', false],
    ['count(kill) > 0', false],
    ['100 <= count(kill)', false],
    ['count(kill) = 0', true],
    ['count(kill) < 5', true],
    ['5 > count(kill)', true],
    ['not count(kill) >= 5', true],
    ['not count(kill) < 5', false],
    ['ever(kill)', false],
    ['never(kill)', true],
    ['not ever(kill)', true],
    ['not never(kill)', false],
    ['max(coins) > 10', false],
    ['max(party) = 1', true],
    ['min(alive) < 2', false],
    ['min(alive) > 2', true],
    ['party = 1', false],
    ['won', false],
    ['won and playTime < 3h', true],
    ['playTime >= 10h', false],
    ['gameTime < 1000', false],
    ['distinct(cast.spell) <= 3', true],
    ['distinct(cast.spell) >= 10', false],
    ['count(kill) > count(eat)', true],
    ['won or never(eat)', true],
    ['count(kill) >= {n}', false],
    ['won and count(kill) <= {n}', true],
    ['won and playTime < {n}m', true],
  ];
  for (const [text, expected] of cases) {
    const got = needsWholeGame(parseCondition(text));
    console.log(`  ${got ? 'whole' : '     '}  ${text}`);
    check(got === expected, `${text} ${expected ? 'needs' : 'does not need'} the whole game`);
  }
}

const kill = (item = 'SWORD', party = 'yes'): AchievementEvent => ({ kind: 'kill', attrs: { monster: 'MUMMY', by: 'melee', item, champion: 'HALK', party } });
const eat = (item: string): AchievementEvent => ({ kind: 'eat', attrs: { champion: 'HALK', item } });

/** A game played out of events: what unlocks, when. */
function evaluator(common: AchievementFile, dm: AchievementFile): void {
  console.log('--- the evaluator, Dungeon Master\'s achievements');
  const defs = mergeAchievements(common, dm);
  const state = new AchievementState(defs, true);
  state.sample('party', 1);
  state.sample('alive', 1);
  state.sample('coins', 0);
  check(state.evaluate().length === 0, 'nothing unlocks before anything happens');

  state.record(kill('SWORD', 'no'));
  check(state.evaluate().length === 0, 'a kill not the party\'s unlocks nothing');
  state.record(kill());
  check(sameIds(state.evaluate(), ['first-blood']), 'the first kill unlocks first-blood');
  check(state.evaluate().length === 0, 'nothing changed, nothing tested');
  for (let i = 0; i < 9; i++) state.record(kill());
  check(sameIds(state.evaluate(), ['pest-control']), 'the tenth kill unlocks pest-control');
  state.record(kill('DRUMSTICK'));
  check(sameIds(state.evaluate(), ['death-by-drumstick']), 'a kill with a drumstick unlocks death-by-drumstick');

  state.sample('coins', 11);
  state.sample('coins', 3);
  check(sameIds(state.evaluate(), ['scrooge']), 'eleven coins carried once unlock scrooge, though fewer now');

  state.record(eat('apple'));
  state.record(eat('CORN'));
  state.addVbls(60 * 60 * 60 * 2);
  state.setGameTime(1234);
  check(state.evaluate().length === 0, 'meals and time unlock nothing before the end');

  // A save, and a branch: the state goes on in both the same.
  const saved = JSON.parse(JSON.stringify(state.snapshot())) as ReturnType<AchievementState['snapshot']>;
  const restored = AchievementState.restore(defs, saved);
  check(JSON.stringify(restored.snapshot()) === JSON.stringify(state.snapshot()), 'a state saved and restored is the same');

  state.ended(true);
  const won = state.evaluate();
  console.log(`  won, all apples and corn, two hours, one champion: ${won.join(', ')}`);
  const clean = ['teetotaller', 'vegetarian', 'untouchable', 'ace-driver', 'emperors-new-clothes', 'let-sleeping-dragons-lie', 'brute-force'];
  check(sameIds(won, ['five-a-day', 'leather-is-enough', 'minimalist-mage', 'roll-the-credits', 'lone-wolf', 'speed-runner', 'conscientious-objector', ...clean]),
    'the win unlocks the diet, the leather, the spells, the credits, the lone wolf, the speed in two hours of 180 minutes but not the blitz of 60, eleven kills of 40, and every win without something');

  restored.record(eat('BREAD'));
  restored.sample('party', 3);
  restored.addVbls(60 * 60 * 60 * 2);
  restored.ended(true);
  const branch = restored.evaluate();
  console.log(`  the branch, bread, three champions, four hours: ${branch.join(', ')}`);
  check(sameIds(branch, ['leather-is-enough', 'minimalist-mage', 'roll-the-credits', 'conscientious-objector', ...clean]),
    'the branch that ate bread with three champions in four hours wins none of the diet, the lone wolf and the speed');

  // A party of four, reincarnated, carnivorous, that kills the Dragon and every knight.
  const four = new AchievementState(defs, true);
  four.sample('party', 4);
  four.sample('alive', 4);
  four.sample('coins', 30);
  for (const champion of ['A', 'B', 'C', 'D']) four.record({ kind: 'join', attrs: { champion, how: 'reincarnate' } });
  const killOf = (monster: string, by = 'melee', item = 'SWORD'): AchievementEvent => ({ kind: 'kill', attrs: { monster, by, item, champion: 'A', party: 'yes' } });
  for (let i = 0; i < 7; i++) four.record(killOf('DethKnight'));
  for (let i = 0; i < 9; i++) four.record(killOf('Rive'));
  four.record(killOf('Zytaz', 'throw', 'GOLD COIN'));
  four.record(killOf('Dragon', 'explosion', 'FUL BOMB'));
  four.record(eat('DRAGON STEAK'));
  for (let i = 0; i < 50; i++) four.record({ kind: 'cast', attrs: { champion: 'A', spell: 'FUL', ok: 'no' } });
  const fours = four.evaluate();
  console.log(`  a party of four, before the end: ${fours.join(', ')}`);
  check(sameIds(fours, ['first-blood', 'pest-control', 'pocket-change', 'grenadier', 'butterfingers', 'scrooge', 'midas', 'farm-to-table',
    'ghostbuster', 'dragonslayer', 'knight-rider']), 'the kills by item, monster and count, the coins and the failed casts unlock as they happen');
  four.record({ kind: 'death', attrs: { champion: 'B', cause: 'door' } });
  check(sameIds(four.evaluate(), ['squashed']), 'a death by a door is Squashed');
  four.ended(true);
  const fourWon = four.evaluate();
  console.log(`  …won: ${fourWon.join(', ')}`);
  check(sameIds(fourWon, ['roll-the-credits', 'full-house', 'new-souls', 'carnivore', 'teetotaller', 'ace-driver', 'emperors-new-clothes', 'speed-runner', 'blitz', 'conscientious-objector', 'minimalist-mage', 'leather-is-enough', 'brute-force']),
    'won with four alive, reincarnated, eating only meat, every cast failed, at once and with 18 kills: Full House, New Souls, Carnivore, Brute Force, Blitz, Conscientious Objector, not Untouchable, Vegetarian nor To Serve Man');
  const butcher = new AchievementState(defs, true);
  for (let i = 0; i < 41; i++) butcher.record(kill());
  butcher.ended(true);
  check(!butcher.evaluate().includes('conscientious-objector'), 'a win with 41 kills is no Conscientious Objector');
  const survivor = new AchievementState(defs, false);
  survivor.sample('party', 4);
  survivor.sample('alive', 1);
  for (const champion of ['HISSSSA', 'WUUF', 'DAROOU', 'GOTHMOG']) survivor.record({ kind: 'join', attrs: { champion, how: 'resurrect' } });
  survivor.ended(true);
  check(sameIds(survivor.evaluate(), ['roll-the-credits', 'sole-survivor', 'true-to-themselves', 'to-serve-man']),
    'won from a save, one of four alive, the four non-humans resurrected: Sole Survivor, True to Themselves, To Serve Man');

  // A game whose history starts at a save that held none.
  const partial = new AchievementState(defs, false);
  partial.sample('party', 1);
  partial.record(kill());
  partial.record(eat('APPLE'));
  partial.ended(true);
  const fromSave = partial.evaluate();
  console.log(`  a win from a save with no history: ${fromSave.join(', ')}`);
  check(sameIds(fromSave, ['first-blood', 'roll-the-credits']), 'a history from a save earns only what needs no whole game');

  // The conditions change between a save and its read: the new aggregate is unknown.
  const before = read('# CSBweb achievements 1\n[a]\nname: A\ntext: T\nwhen: count(kill) >= 1\n');
  const after = read('# CSBweb achievements 1\n[a]\nname: A\ntext: T\nwhen: count(kill) >= 1\n[b]\nname: B\ntext: T\nwhen: won and never(eat)\n[c]\nname: C\ntext: T\nwhen: count(eat) >= 1\n');
  const old = new AchievementState(before.defs, true);
  const next = AchievementState.restore(after.defs, old.snapshot());
  next.record(eat('APPLE'));
  next.ended(true);
  check(sameIds(next.evaluate(), ['c']),
    'an aggregate a condition added after the save is unknown: never(eat) is not trusted, count(eat) >= 1 is');

  // Patterns and case.
  const like = read('# CSBweb achievements 1\n[l]\nname: L\ntext: T\nwhen: ever(wear where item ~ "leather*" and slot = torso)\n');
  const worn = new AchievementState(like.defs, true);
  worn.record({ kind: 'wear', attrs: { champion: 'HALK', slot: 'legs', item: 'LEATHER PANTS' } });
  check(worn.evaluate().length === 0, 'a pattern with another slot does not match');
  worn.record({ kind: 'wear', attrs: { champion: 'HALK', slot: 'torso', item: 'LEATHER JERKIN' } });
  check(sameIds(worn.evaluate(), ['l']), 'a pattern matches regardless of case');
}

/** A set's file over the common one. */
function merging(common: AchievementFile): void {
  console.log('--- merging');
  const own = read('# CSBweb achievements 1\n[lone-wolf]\ndisabled\n[no-such]\ndisabled\n[first-blood]\nname: Blooded\ntext: Kill.\nwhen: count(kill) >= 1\n[mine]\nname: Mine\ntext: T\nwhen: won\n');
  const merged = mergeAchievements(common, own);
  const ids = merged.map((d: AchievementDef) => d.id);
  check(!ids.includes('lone-wolf'), 'a disabled common achievement is left out');
  check(merged.find(d => d.id === 'first-blood')?.name === 'Blooded', 'a set\'s block replaces the common one of its id');
  check(ids.indexOf('first-blood') === 0, 'the replaced one keeps its place');
  check(ids[ids.length - 1] === 'mine', 'the set\'s own come after the common ones');
  const fixed = common.defs.filter((d) => d.values.length === 0).length;
  check(merged.length === fixed, 'disabling an id the common file lacks does nothing, and a valued one whose value the set lacks is absent');
  check(mergeAchievements(common, null).length === fixed, 'a set with no file has the common ones, less the valued');
  check(!mergeAchievements(common, null).some((d) => d.id === 'speed-runner'), 'a set with no file has no Speed Runner');

  console.log('--- named values');
  const valued = read('# CSBweb achievements 1\nvalue speedRunnerMinutes = 90\nvalue kills = 7\nvalue spare = 1\n'
    + '[seven]\nname: Seven\ntext: Kill {kills}, then {kills} more.\nwhen: count(kill) >= {kills}\n'
    + '[nowhere]\nname: Nowhere\ntext: T\nwhen: count(kill) >= {absent}\n');
  const set = mergeAchievements(common, valued);
  const seven = set.find((d) => d.id === 'seven');
  const speed = set.find((d) => d.id === 'speed-runner');
  console.log(`  ${seven?.text} / ${speed?.text}`);
  check(seven?.text === 'Kill 7, then 7 more.', 'a value is put in every place its text names it');
  check(speed?.text === 'Win in less than 90 minutes of play.' && !set.some((d) => d.id === 'blitz'),
    'the set\'s value reaches a common achievement, and one whose value it does not give is absent');
  check(!set.some((d) => d.id === 'nowhere'), 'the set\'s own achievement naming a value nobody gives is absent');
  check(unusedValues(valued, set).join() === 'spare', 'unusedValues names the value no achievement names');
  const counting = new AchievementState(set, true);
  for (let i = 0; i < 6; i++) counting.record(kill());
  check(!counting.evaluate().includes('seven'), 'six kills are not {kills}');
  counting.record(kill());
  check(counting.evaluate().includes('seven'), 'the seventh is');
  const timed = new AchievementState(set, true);
  timed.addVbls(60 * 60 * 89);
  timed.ended(true);
  check(timed.evaluate().includes('speed-runner'), 'a win in 89 minutes is less than {speedRunnerMinutes}m, 90');
  const late = new AchievementState(set, true);
  late.addVbls(60 * 60 * 90);
  late.ended(true);
  check(!late.evaluate().includes('speed-runner'), 'one in 90 is not');
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function main(): void {
  const common = commonFile();
  const values = 'speedRunnerMinutes = 180, blitzMinutes = 60, objectorKills = 40';
  const dm = setFile(common, 'dm-atari', STOCK_DIR, ['let-sleeping-dragons-lie', 'brute-force'], values);
  setFile(common, 'csb', 'tools/fixtures/gamefiles/csb', [], values);
  for (const set of DATA_SETS) {
    if (set.id.startsWith('dm-')) check(achievementFileOf(set.id) === 'dm-atari', `${set.id}, a Dungeon Master set, reads dm-atari.txt`);
  }
  errors();
  wholeGame();
  evaluator(common, dm);
  merging(common);
  finish();
}

main();
