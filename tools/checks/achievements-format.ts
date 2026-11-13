/**
 * The achievements file (`doc/ACHIEVEMENTS.md` → "The file"): the common file read, its
 * names against the real `graphics.dat`, the reader's errors, which conditions need the
 * whole game, and the evaluator over a game made of events.
 *
 * None of it is CSBWin's, and none of it shows on a frame. What to look for in the output:
 * each common achievement with its tier, whether it needs the whole game (`whole`), and
 * the aggregates it keeps by their keys, and the values it names. Every name the common file gives an item must be
 * one of FTL's objects, which is the canary: a name misspelt there would match nothing,
 * silently, in every set. The counts of the data (`dataCounts`) are Dungeon Master's and
 * Chaos Strikes Back's, each half of them proven by what it adds: DM's worm round only a
 * worm drops, CSB's types only its generators make, DM's Lord Chaos whom no blow kills,
 * CSB's stone map that is no level. Every Dungeon Master set has fourteen levels, so the
 * deepest is 13 in each, as `dm-atari.txt` says.
 *
 * Run: `npm test -- --only=achievements-format.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mergeAchievements, needsWholeGame, parseCondition, readAchievementFile, unknownItems, unusedValues, withCounts,
  type AchievementDef, type AchievementFile, type DataCounts,
} from '../../src/engine/achievements/AchievementFile';
import { dataCounts, readAchievementSetFiles, setDungeons } from '../../src/engine/achievements/DataCounts';
import { dungeonCensus } from '../../src/engine/DungeonCensus';
import { acrossUnlocked, AchievementState, type AchievementEvent, type GameFigures } from '../../src/engine/achievements/AchievementState';
import { achievementFileOf } from '../../src/engine/achievements/PageAchievements';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { check, fail, finish } from '../lib/check';
import { DATA_SETS, dataSetNamed, diskFiles } from '../lib/dataSets';
import { gameTablesOf, graphicsTablesOf, STOCK_DIR, stockGraphics } from '../lib/game';

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
    'vegetarian', 'carnivore', 'untouchable', 'ironman', 'hardcore', 'ace-driver', 'emperors-new-clothes', 'conscientious-objector',
    'low-profile', 'featherweight', 'insomniac', 'girl-power', 'i-know-what-im-doing', 'dark-ages',
  ]);
  for (const d of r.file.defs) {
    check(d.whole === whole.has(d.id), `${d.id} ${whole.has(d.id) ? 'needs' : 'does not need'} the whole game`);
  }
  check(r.file.disabled.length === 0, 'common.txt disables nothing');
  check(r.file.values.size === 0, 'common.txt defines no value: a set without its own file has no valued achievement');
  const valued = r.file.defs.filter((d) => d.values.length > 0).map((d) => `${d.id} {${d.values.join(', ')}}`);
  console.log(`  valued: ${valued.join('; ')}`);
  check(valued.join('; ') === 'speed-runner {speedRunnerMinutes}; blitz {blitzMinutes}; conscientious-objector {objectorKills}; clean-sweep {cleanSweepLevels}',
    'Speed Runner, Blitz, Conscientious Objector and Clean Sweep are the valued ones, each naming its value in its text or its condition');

  const names = new Set(graphicsTablesOf(stockGraphics()).objects.objectNames);
  console.log(`--- common.txt's item names against graphics.dat's ${names.size} names`);
  for (const d of r.file.defs) {
    const unknown = unknownItems(d, names);
    check(unknown.length === 0, `${d.id} names only FTL's objects (not ${unknown.join(', ')})`);
  }
  const leather = r.file.defs.find(d => d.id === 'leather-is-enough');
  check(leather !== undefined && unknownItems(leather, new Set(['HELMET'])).includes('PLATE OF DARC'),
    'unknownItems lists a name the set lacks');
  const speedy = r.file.defs.find(d => d.id === 'speedy-gonzales');
  check(speedy !== undefined && unknownItems(speedy, new Set(['HELMET'])).join() === 'BOOTS OF SPEED',
    'unknownItems lists a name a champion\'s place is compared with, in a party(where …)');
  return r.file;
}

/**
 * A set's own file, `defs/<name>.txt`: read, printed, its names against the set's
 * `graphics.dat`, laid over the common file, and the sets that read it.
 */
function setFile(
  common: AchievementFile, name: string, graphicsDir: string, whole: readonly string[], values: string, absent: readonly string[] = [],
  disabled: readonly string[] = [],
): AchievementFile {
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
  const given = [...r.file.values].map(([v, n]) => `${v} = ${n.join(', ')}`).join('; ');
  console.log(`  values: ${given}`);
  check(given === values, `${name}.txt gives ${values}`);
  check(r.file.disabled.join() === disabled.join(), `${name}.txt disables ${disabled.join(', ') || 'nothing'} (${r.file.disabled.join(', ')})`);
  const merged = mergeAchievements(common, r.file);
  const replaced = r.file.defs.filter((d) => common.defs.some((c) => c.id === d.id)).length;
  const missing = common.defs.filter((c) => !merged.some((d) => d.id === c.id)).map((c) => c.id);
  const gone = [...disabled, ...absent];
  check(merged.length === common.defs.length + r.file.defs.length - replaced - gone.length && sameIds(missing, gone),
    `${name}.txt adds ${r.file.defs.length - replaced} to the common file and replaces ${replaced}, every valued one there${absent.length > 0 ? ` but ${absent.join(', ')}, whose value it does not give` : ''}${disabled.length > 0 ? `, and leaves out ${disabled.join(', ')}` : ''}`);
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
    ['a count of the data alone', block('spells'), 5, /yes or a no/],
    ['a count of the data against a duration', block('playTime > spells'), 5, /duration/],
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
    ['a list with a word in it', `${H}value n = 1, two\n`, 2, /list of them/],
    ['a list with an empty place', `${H}value n = 1,, 2\n`, 2, /list of them/],
    ['a level not a number', block('ever(enter where level = top)'), 5, /whole number/],
    ['a pattern on a level', block('ever(enter where level ~ "1*")'), 5, /compares names/],
    ['a list of names', block('ever(eat where item in {n})'), 5, /list of numbers/],
    ['a list in minutes', block('ever(enter where level in {n}m)'), 5, /list of numbers/],
    ['a brace not a value\'s', `${H}[a]\nname: A\ntext: Kill {n monsters.\nwhen: won\n`, 4, /braces/],
    ['a champion\'s unknown attribute', block('party(where colour = red) > 1'), 5, /party has no attribute "colour"/],
    ['a filter on another sample', block('coins(where item = APPLE) > 1'), 5, /only party takes a filter/],
    ['a party filter without where', block('party(sex = male) > 1'), 5, /expected "where"/],
    ['a sex outside its list', block('party(where sex = boy) > 0'), 5, /party\.sex is one of male, female/],
    ['a name ordered', block('party(where champion > HALK) > 0'), 5, /orders numbers; party\.champion/],
    ['an item ordered', block('count(kill where item < SWORD) > 0'), 5, /orders numbers; kill\.item/],
    ['a rank not a number', block('party(where wizard = high) > 0'), 5, /party\.wizard is a whole number/],
    ['a party filtered alone', block('party(where wizard >= 15)'), 5, /yes or a no/],
    ['an attribute of sleep', block('distinct(sleep.champion) > 0'), 5, /sleep has no attributes/],
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
    ['explored >= 90', false],
    ['explored < 10', true],
    ['levels > 0 and distinct(enter.level) >= levels', false],
    ['ever(leave where cleared = yes and level in {n})', false],
    ['ever(enter where level = 13) and playTime < {n}m', true],
    ['party(where feet = "BOOTS OF SPEED") >= 4', false],
    ['won and max(party(where sex = male)) = 0', true],
    ['max(party(where wizard >= 15)) >= 1', false],
    ['min(party(where alive = yes)) >= 1', true],
    ['won and never(sleep)', true],
    ['won and never(oracle)', true],
    ['lost and level = 0 and x = 9 and y = 1', false],
    ['max(level) >= 13', false],
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
function evaluator(common: AchievementFile, dm: AchievementFile, counts: DataCounts): void {
  console.log('--- the evaluator, Dungeon Master\'s achievements');
  const defs = mergeAchievements(common, dm).map((d) => withCounts(d, counts));
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
  // The made-up games tell no champion: no rank, sex, load or hand ever counted, no sleep, no
  // meaningless cast nor light spell, and load no save.
  const clean = ['teetotaller', 'vegetarian', 'untouchable', 'ironman', 'hardcore', 'ace-driver', 'emperors-new-clothes', 'let-sleeping-dragons-lie', 'brute-force',
    'low-profile', 'featherweight', 'insomniac', 'girl-power', 'i-know-what-im-doing', 'dark-ages'];
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
  check(sameIds(fourWon, ['roll-the-credits', 'full-house', 'new-souls', 'carnivore', 'teetotaller', 'ace-driver', 'emperors-new-clothes', 'speed-runner', 'blitz', 'conscientious-objector', 'minimalist-mage', 'leather-is-enough', 'brute-force',
    'low-profile', 'featherweight', 'insomniac', 'girl-power', 'i-know-what-im-doing', 'dark-ages', 'ironman']),
    'won with four alive, reincarnated, eating only meat, every cast failed, at once and with 18 kills: Full House, New Souls, Carnivore, Brute Force, Blitz, Conscientious Objector, Ironman, not Untouchable, Hardcore, Vegetarian nor To Serve Man');
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

  // Where the party is: the levels entered and left, the floor walked on.
  const walker = new AchievementState(defs, true);
  const enter = (level: number): AchievementEvent => ({ kind: 'enter', attrs: { level: `${level}` } });
  const leave = (level: number, cleared: string): AchievementEvent => ({ kind: 'leave', attrs: { level: `${level}`, cleared } });
  walker.addVbls(60 * 60 * 59);
  const walks: [AchievementEvent[], number, string[], string][] = [
    [[enter(0), leave(0, 'yes'), enter(1)], 89, [], 'the Hall of Champions left empty is no Clean Sweep: it is not listed; 89% of the floor is no Cartographer'],
    [[leave(1, 'no'), enter(2)], 90, ['cartographer'], 'a level left with a monster on it is no sweep; 90% of the floor is Cartographer'],
    [[leave(2, 'yes'), enter(3)], 90, ['clean-sweep'], 'level 2 left with no monster on it is a Clean Sweep'],
    [[...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(enter)], 90, [], 'thirteen levels of fourteen are no Tourist'],
    [[enter(13)], 90, ['tourist', 'deep-diver', 'express-elevator'], 'the fourteenth, the deepest, in 59 minutes, is Tourist, Deep Diver and Express Elevator'],
  ];
  for (const [events, explored, unlocks, what] of walks) {
    for (const event of events) walker.record(event);
    walker.setExplored(explored);
    check(sameIds(walker.evaluate(), unlocks), what);
  }
  const slow = new AchievementState(defs, true);
  slow.addVbls(60 * 60 * 60);
  slow.record(enter(13));
  slow.record(leave(13, 'yes'));
  check(sameIds(slow.evaluate(), ['deep-diver']), 'the deepest reached in 60 minutes is Deep Diver, not Express Elevator; the Dragon\'s level swept is no Clean Sweep');
  const resumed = new AchievementState(defs, false);
  resumed.addVbls(60 * 60);
  resumed.record(enter(13));
  check(sameIds(resumed.evaluate(), ['deep-diver']), 'from a save with no history, the deepest reached in a minute is Deep Diver alone: the play time is too small');

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

  champions(defs);
  casts(defs);
  blows(defs);
}

/**
 * Where a game ends, and the Oracle asked: Gullible, a game of Dungeon Master's lost on map 0
 * (9,1) and nowhere else; Self-Reliant, a game of Chaos Strikes Back's won without the
 * Oracle asked.
 */
function endings(common: AchievementFile, dm: AchievementFile, csb: AchievementFile, counts: DataCounts): void {
  console.log('--- where a game ends, and the Oracle');
  const at = (defs: readonly AchievementDef[], level: number, x: number, y: number): AchievementState => {
    const state = new AchievementState(defs, true);
    state.sample('level', level);
    state.sample('x', x);
    state.sample('y', y);
    return state;
  };
  const dmDefs = mergeAchievements(common, dm).map((d) => withCounts(d, counts));
  const cell = at(dmDefs, 0, 9, 1);
  check(!cell.evaluate().includes('gullible'), 'standing on map 0 (9,1) is no Gullible before the game is lost');
  cell.ended(false);
  check(cell.evaluate().includes('gullible'), 'a game lost on map 0 (9,1) is Gullible');
  for (const [level, x, y] of [[0, 1, 4], [1, 9, 1], [0, 9, 2]] as const) {
    const elsewhere = at(dmDefs, level, x, y);
    elsewhere.ended(false);
    check(!elsewhere.evaluate().includes('gullible'), `a game lost on map ${level} (${x},${y}) is not`);
  }
  const csbDefs = mergeAchievements(common, csb).map((d) => withCounts(d, counts));
  const asked = new AchievementState(csbDefs, true);
  asked.record({ kind: 'oracle', attrs: {} });
  asked.ended(true);
  const self = new AchievementState(csbDefs, true);
  self.ended(true);
  check(!asked.evaluate().includes('self-reliant') && self.evaluate().includes('self-reliant'),
    'Chaos Strikes Back won with the Oracle asked once is no Self-Reliant, won without it is');
  const partial = new AchievementState(csbDefs, false);
  partial.ended(true);
  check(!partial.evaluate().includes('self-reliant'), 'nor is a win whose history starts at a save');
  // Ironman: won without a load; Hardcore: without a load nor a death.
  const ruled = (load: boolean, death: boolean): string[] => {
    const game = new AchievementState(dmDefs, true);
    if (death) game.record({ kind: 'death', attrs: { champion: 'HALK', cause: 'monster', party: 'no' } });
    if (load) game.record({ kind: 'load', attrs: {} });
    game.ended(true);
    return game.evaluate().filter((id) => id === 'ironman' || id === 'hardcore');
  };
  check(sameIds(ruled(false, false), ['ironman', 'hardcore']) && sameIds(ruled(false, true), ['ironman'])
    && ruled(true, false).length === 0 && ruled(true, true).length === 0,
    'a win with no load is Ironman, and Hardcore with no death too; a win with a load is neither');
  // Lazarus: the same champion revived a third time, in any history; Fresh Faces: a CSB
  // adventure won with a party raised from the prison alone; Veterans: from DM alone.
  const revived = new AchievementState(dmDefs, false);
  for (const [champion, times] of [['HALK', 1], ['HALK', 2], ['STAMM', 1], ['ELIJA', 1]] as const) {
    revived.record({ kind: 'revive', attrs: { champion, times: `${times}` } });
  }
  const before = revived.evaluate().includes('lazarus');
  revived.record({ kind: 'revive', attrs: { champion: 'HALK', times: '3' } });
  check(!before && revived.evaluate().includes('lazarus'),
    'four revivals of three champions are no Lazarus; a third of the same champion is, in a history that starts at a save too');
  const raised = (froms: readonly string[], id: string, whole = true): boolean => {
    const game = new AchievementState(csbDefs, whole);
    froms.forEach((from, i) => game.record({ kind: 'raise', attrs: { champion: `C${i}`, from } }));
    game.ended(true);
    return game.evaluate().includes(id);
  };
  const prison = ['prison', 'prison', 'prison', 'prison'];
  const fresh = (froms: readonly string[], whole = true): boolean => raised(froms, 'fresh-faces', whole);
  check(fresh(prison) && !fresh([...prison.slice(1), 'imported']) && !fresh([...prison.slice(1), 'dm']) && !fresh([]) && !fresh(prison, false),
    'a CSB adventure won with four prisoners raised is Fresh Faces; one imported or from DM, none raised, or a history from a save is not');
  const fromDm = ['dm', 'dm', 'dm'];
  const veterans = (froms: readonly string[], whole = true): boolean => raised(froms, 'veterans', whole);
  check(veterans(fromDm) && !veterans([...fromDm, 'prison']) && !veterans([...fromDm, 'imported']) && !veterans([]) && !veterans(fromDm, false),
    'a CSB adventure won with three DM champions raised is Veterans; one more from the prison or imported, none raised, or a history from a save is not');
}

/** A champion's attributes as the tracker gives them (`CHAMPION_ATTRIBUTES`), a male Expert by default. */
const champ = (attrs: Record<string, string> = {}): Record<string, string> =>
  ({ champion: 'HALK', sex: 'male', alive: 'yes', fighter: '8', ninja: '3', priest: '2', wizard: '1', load: '20', ...attrs });

/** The champions at each tick's end, `party(where …)`: what each wears and holds, their sex, ranks and load. */
function champions(defs: readonly AchievementDef[]): void {
  console.log('--- the champions');
  const fast = (n: number): Record<string, string>[] => [0, 1, 2, 3].map((i) => champ(i < n ? { feet: 'BOOTS OF SPEED' } : {}));
  const strong = new AchievementState(defs, true);
  strong.champions(fast(3));
  check(strong.evaluate().length === 0, 'three champions of four in boots of speed are no Speedy Gonzales; an Expert is no Master');
  strong.champions(fast(4));
  check(sameIds(strong.evaluate(), ['speedy-gonzales']), 'all four at once are');
  const lyte = { head: 'HELM OF LYTE', torso: 'PLATE OF LYTE', legs: 'POLEYN OF LYTE', feet: 'GREAVE OF LYTE' };
  strong.champions([champ(lyte), champ({ ready: 'SHIELD OF LYTE' })]);
  check(strong.evaluate().length === 0, 'the armour of Lyte worn, its shield in another champion\'s hand, is no Shining Armour');
  strong.champions([champ({ ...lyte, action: 'SHIELD OF LYTE' }), champ({ fighter: '9', ninja: '9', priest: '9', wizard: '8' })]);
  check(sameIds(strong.evaluate(), ['shining-armour']), 'with the shield in its own action hand it is; a Master in three classes is no Jack of All Trades');
  strong.champions([champ({ fighter: '9', ninja: '9', priest: '9', wizard: '9', load: '51' }), champ({ wizard: '15' })]);
  check(sameIds(strong.evaluate(), ['jack-of-all-trades', 'archmaster']), 'a Master in all four is Jack of All Trades, an Archmaster wizard Archmaster');
  const saved = JSON.parse(JSON.stringify(strong.snapshot())) as ReturnType<AchievementState['snapshot']>;
  check(saved.samples['party(where feet="BOOTS OF SPEED")'] === 0 && JSON.stringify(AchievementState.restore(defs, saved).snapshot()) === JSON.stringify(strong.snapshot()),
    'a party(where …) sample is kept by its key, and comes back with the state');
  strong.champions([champ()]);
  strong.record({ kind: 'sleep', attrs: {} });
  strong.ended(true);
  const four = ['low-profile', 'featherweight', 'insomniac', 'girl-power'];
  const strongWon = strong.evaluate();
  console.log(`  won by the strong: ${strongWon.join(', ')}`);
  check(strongWon.includes('roll-the-credits') && !four.some((id) => strongWon.includes(id)),
    'won after a Master, more than half a load carried once, a sleep and men in the party: no Low Profile, Featherweight, Insomniac nor Girl Power');

  const meek = new AchievementState(defs, true);
  meek.champions([champ({ sex: 'female', load: '50' }), champ({ sex: 'female', alive: 'no', load: '0' })]);
  meek.ended(true);
  const meekWon = meek.evaluate();
  console.log(`  won by the meek: ${meekWon.join(', ')}`);
  check(four.every((id) => meekWon.includes(id)),
    'won with none above Expert, half a load at most, never asleep, and two women, one of them dead: Low Profile, Featherweight, Insomniac and Girl Power');
  const late = new AchievementState(defs, true);
  late.champions([champ({ sex: 'female' })]);
  late.champions([champ({ sex: 'female' }), champ()]);
  late.champions([champ({ sex: 'female' })]);
  late.ended(true);
  check(!late.evaluate().includes('girl-power'), 'a man who was in the party once, and is no longer, is no Girl Power');
}

/** The casts' power rune and why one failed, and the hands' torch: the casts' achievements. */
function casts(defs: readonly AchievementDef[]): void {
  console.log('--- the casts');
  const cast = (spell: string, power: string, ok: string, why?: string): AchievementEvent =>
    ({ kind: 'cast', attrs: { champion: 'A', spell, power, ok, ...(why ? { why } : {}) } });
  const mage = new AchievementState(defs, true);
  mage.record(cast('FUL IR', 'PAL', 'yes'));
  mage.record(cast('FUL IR', 'MON', 'no', 'practice'));
  mage.record(cast('OH VEN', 'MON', 'no', 'flask'));
  check(mage.evaluate().length === 0, 'a fireball at PAL, and failed ones at MON, are neither Blazing Glory Day nor Thick Atmosphere');
  mage.record(cast('FUL IR', 'MON', 'yes'));
  check(sameIds(mage.evaluate(), ['blazing-glory-day']), 'a fireball at MON is Blazing Glory Day');
  mage.record(cast('OH VEN', 'MON', 'yes'));
  check(sameIds(mage.evaluate(), ['thick-atmosphere']), 'a poison cloud at MON is Thick Atmosphere');
  mage.record(cast('FUL', 'LO', 'no', 'practice'));
  mage.champions([champ({ neck: 'ILLUMULET' })]);
  mage.ended(true);
  const sure = mage.evaluate();
  console.log(`  won by the sure: ${sure.join(', ')}`);
  check(sure.includes('i-know-what-im-doing') && sure.includes('dark-ages'),
    'won after failing for want of practice and of a flask, a light spell failed and an Illumulet worn: I Know What I\'m Doing and Dark Ages');

  const mumbler = new AchievementState(defs, true);
  mumbler.record(cast('LO', 'MON', 'no', 'meaningless'));
  mumbler.record(cast('OH IR RA', 'LO', 'yes'));
  mumbler.ended(true);
  const lost = mumbler.evaluate();
  check(!lost.includes('i-know-what-im-doing') && !lost.includes('dark-ages'), 'a meaningless cast is no I Know What I\'m Doing, a magic torch cast no Dark Ages');
  const torch = new AchievementState(defs, true);
  torch.champions([champ({ action: 'TORCH' })]);
  torch.champions([champ()]);
  torch.ended(true);
  check(!torch.evaluate().includes('dark-ages'), 'a torch held once is no Dark Ages');
}

/**
 * The blows: a hit's damage, a kill's group struck down by one strike, an empty hand, a group
 * landed on, and a death's side: Overkill, Strike!, Bare Knuckles, Telefrag and Friendly
 * Fire Fatality.
 */
function blows(defs: readonly AchievementDef[]): void {
  console.log('--- the blows');
  const hit = (damage: number, party = 'yes'): AchievementEvent =>
    ({ kind: 'hit', attrs: { monster: 'Mummy', by: 'melee', item: 'SWORD', champion: 'A', party, damage: `${damage}` } });
  const kill = (attrs: Record<string, string>): AchievementEvent =>
    ({ kind: 'kill', attrs: { monster: 'Mummy', by: 'melee', item: 'SWORD', champion: 'A', party: 'yes', group: '1', ...attrs } });
  const fight = new AchievementState(defs, false);
  fight.record(hit(99));
  fight.record(hit(150, 'no'));
  fight.record(kill({ by: 'explosion', item: '', group: '3' }));
  fight.record(kill({ by: 'explosion', party: 'no', group: '4' }));
  fight.record({ kind: 'death', attrs: { champion: 'A', cause: 'missile', party: 'no' } });
  for (let i = 0; i < 99; i++) fight.record(kill({ item: 'HAND' }));
  fight.record(kill({ by: 'throw', item: 'HAND' }));
  const blows = ['overkill', 'strike', 'bare-knuckles', 'telefrag', 'friendly-fire-fatality'];
  check(fight.evaluate().every((id) => !blows.includes(id)),
    `a hit of 99, one of 150 not the party's, three of a group struck down, four by nobody's fireball, a death to a missile not the party's and 99 kills with an empty hand unlock none of the blows' achievements`);
  fight.record(hit(100));
  check(sameIds(fight.evaluate(), ['overkill']), 'a hit of 100 is Overkill');
  fight.record(kill({ by: 'explosion', group: '4' }));
  check(sameIds(fight.evaluate(), ['strike']), `the fourth of a group struck down by the party's one strike is Strike!`);
  fight.record(kill({ item: 'HAND' }));
  check(sameIds(fight.evaluate(), ['bare-knuckles']), 'the hundredth melee kill with an empty hand is Bare Knuckles');
  fight.record(kill({ by: 'landing', item: '', champion: '' }));
  check(sameIds(fight.evaluate(), ['telefrag']), 'a group landed on is Telefrag');
  fight.record({ kind: 'death', attrs: { champion: 'A', cause: 'explosion', party: 'yes' } });
  check(sameIds(fight.evaluate(), ['friendly-fire-fatality']), 'a death to the party\'s own blow is Friendly Fire Fatality');
  check(defs.filter((d) => blows.includes(d.id)).every((d) => !d.whole),
    'none of the blows\' achievements needs the whole game');
}

/** A set's file over the common one. */
function merging(common: AchievementFile, counts: DataCounts): void {
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

  console.log('--- lists');
  const listed = read('# CSBweb achievements 1\nvalue few = 1, 2\nvalue one = 7\n'
    + '[in-few]\nname: A\ntext: T\nwhen: ever(enter where level in {few})\n'
    + '[in-one]\nname: B\ntext: T\nwhen: ever(enter where level not in {one})\n'
    + '[few-as-number]\nname: C\ntext: T\nwhen: count(kill) >= {few}\n'
    + '[few-in-text]\nname: D\ntext: Levels {few}.\nwhen: won\n');
  const lists = mergeAchievements({ defs: [], disabled: [], values: new Map() }, listed);
  console.log(`  ${lists.map((d) => `${d.id}: ${d.aggregates.map((a) => a.key).join()}`).join('; ')}`);
  check(lists.map((d) => d.id).join() === 'in-few,in-one', 'a list stands for an in\'s list; where one number is wanted, in a condition or a text, the achievement is absent');
  check(lists[0]?.aggregates[0]?.key === 'count(enter where level in ("1","2"))', 'the aggregate is keyed by the list it was given, so another list is another aggregate');
  const visits = new AchievementState(lists, true);
  visits.record({ kind: 'enter', attrs: { level: '7' } });
  check(visits.evaluate().length === 0, 'level 7 is neither in {few} nor not in {one}');
  visits.record({ kind: 'enter', attrs: { level: '2' } });
  check(sameIds(visits.evaluate(), ['in-few', 'in-one']), 'level 2 is in {few}, and not in {one}');

  console.log('--- named values');
  const valued = read('# CSBweb achievements 1\nvalue speedRunnerMinutes = 90\nvalue kills = 7\nvalue spare = 1\n'
    + '[seven]\nname: Seven\ntext: Kill {kills}, then {kills} more.\nwhen: count(kill) >= {kills}\n'
    + '[nowhere]\nname: Nowhere\ntext: T\nwhen: count(kill) >= {absent}\n');
  const set = mergeAchievements(common, valued).map((d) => withCounts(d, counts));
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

/** The counts of the data: the FTL sets', and what a condition does with them. */
async function counted(common: AchievementFile): Promise<DataCounts> {
  console.log('--- counted from the data');
  const expected: Record<string, DataCounts> = {
    'dm-atari': { spells: 25, foods: 8, monsterTypes: 24, levels: 14 },
    csb: { spells: 25, foods: 8, monsterTypes: 23, levels: 10 },
  };
  const found: Record<string, DataCounts> = {};
  for (const [id, want] of Object.entries(expected)) {
    const set = dataSetNamed(id);
    const files = await readAchievementSetFiles(set, diskFiles(set));
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(resolve(set.dir, 'graphics.dat'))));
    const tables = gameTablesOf(graphics);
    const dungeons = setDungeons(files);
    const counts = found[id] = dataCounts(tables, dungeons);
    console.log(`  ${id.padEnd(9)} spells ${counts.spells}, foods ${counts.foods}, monsterTypes ${counts.monsterTypes}, levels ${counts.levels}`);
    check(JSON.stringify(counts) === JSON.stringify(want), `${id} counts ${JSON.stringify(want)}`);
    if (id === 'dm-atari') {
      const placed = dataCounts({ ...tables, monsterDroppings: [] }, dungeons).foods;
      console.log(`  ${''.padEnd(9)} foods without the droppings ${placed}`);
      check(placed === 7, 'Dungeon Master places no worm round: only a worm drops one');
      const killable = dataCounts({ ...tables, monsterDesc: Array.from(tables.monsterDesc, (d) => ({ ...d, word2: d.word2 & ~0x2000 })) }, dungeons);
      check(killable.monsterTypes === 25, 'Dungeon Master places 25 types, Lord Chaos the one no blow kills');
    } else {
      check(dungeons.length === 2, 'Chaos Strikes Back\'s counts read its prison and its adventure, mini.dat');
      const groups = dungeonCensus(dungeons[1]!).monsterTypes;
      console.log(`  ${''.padEnd(9)} the adventure's groups are of ${groups} types`);
      check(groups === 21, 'the adventure\'s groups are of 21 types, the Grey Lord, whom no blow kills, among them: its generators make the other three');
      check(dungeons[1]!.maps.length === 11, 'the adventure has eleven maps, the last a square of stone, which is no level');
    }
  }
  for (const set of DATA_SETS.filter((s) => s.id.startsWith('dm-'))) {
    const levels = dataCounts(gameTablesOf(stockGraphics()), setDungeons(await readAchievementSetFiles(set, diskFiles(set)))).levels;
    check(levels === 14, `${set.id} has fourteen levels, the deepest 13 (${levels})`);
  }

  check(!needsWholeGame(parseCondition('distinct(cast.spell where ok = yes) >= spells')), 'every spell cast can be earned in any game');
  check(needsWholeGame(parseCondition('distinct(eat.item) < foods')), 'fewer foods than there are needs the whole game');
  const defs = mergeAchievements(common, null);
  const small = defs.map((d) => withCounts(d, { spells: 2, foods: 2, monsterTypes: 2, levels: 2 }));
  const ids = ['rune-scholar', 'gourmet', 'bestiary'];
  check(ids.every((id) => small.some((d) => d.id === id)), 'Rune Scholar, Gourmet and Bestiary are common: a set without a file of its own has them');
  let threw = false;
  try { new AchievementState(defs, true).evaluate(); } catch { threw = true; }
  check(threw, 'a count of the data the tracker never gave is an error, not a zero');

  const state = new AchievementState(small, true);
  const cast = (spell: string, ok: string): AchievementEvent => ({ kind: 'cast', attrs: { champion: 'A', spell, ok } });
  const slay = (monster: string, by: string, party: string): AchievementEvent => ({ kind: 'kill', attrs: { monster, by, champion: 'A', party } });
  const steps: [AchievementEvent[], string[], string][] = [
    [[cast('FUL', 'yes'), cast('FUL', 'yes'), cast('FUL IR', 'no')], [], 'one spell twice and one failed are one of two'],
    [[cast('FUL IR', 'yes')], ['rune-scholar'], 'the second spell is Rune Scholar'],
    [[eat('APPLE'), eat('APPLE')], [], 'an apple twice is one food of two'],
    [[eat('CORN')], ['gourmet'], 'corn after it is Gourmet'],
    [[slay('Mummy', 'melee', 'yes'), slay('LordChaos', 'fusion', 'yes'), slay('Worm', 'door', 'no')], ['first-blood'],
      'a mummy, Lord Chaos fused and a worm the party did not kill are one type of two'],
    [[slay('Worm', 'spell', 'yes')], ['bestiary'], 'a worm the party kills is Bestiary'],
  ];
  for (const [events, unlocks, what] of steps) {
    for (const event of events) state.record(event);
    check(sameIds(state.evaluate(), unlocks), what);
  }
  const none = new AchievementState(defs.map((d) => withCounts(d, { spells: 0, foods: 0, monsterTypes: 0, levels: 0 })), true);
  for (const [events] of steps) for (const event of events) none.record(event);
  check(!none.evaluate().some((id) => ids.includes(id)), 'a set with no spell, food or monster has no Rune Scholar, Gourmet or Bestiary to earn');
  return found['dm-atari']!;
}

/**
 * Across games (`doc/ACHIEVEMENTS.md` → "Across games"): `games(…)` and `total(…)` read,
 * the reader's refusals, each game's figures, and the achievements across games over the
 * figures of several playthroughs.
 */
function acrossGames(common: AchievementFile, dm: AchievementFile, counts: DataCounts): void {
  console.log('--- across games');
  const H = '# CSBweb achievements 1\n';
  const refused: [string, string, RegExp][] = [
    ['a game\'s fact beside games(…)', 'games(won) >= 1 and won', /not won/],
    ['games(…) inside games(…)', 'games(games(won) >= 1) >= 1', /no games\(…\) or total\(…\)/],
    ['total(…) inside games(…)', 'games(total(count(kill)) >= 1) >= 1', /no games\(…\) or total\(…\)/],
    ['a total of what is no count', 'total(max(party)) >= 1', /takes a count/],
    ['games(…) of a number', 'games(count(kill)) >= 1', /yes-or-no/],
    ['a total asked to be small', 'total(count(kill)) < 10', /asks for at least/],
    ['no game asked', 'games(won) = 0', /asks for at least/],
  ];
  for (const [what, when, message] of refused) {
    const r = readAchievementFile(`${H}[a]\nname: A\ntext: T\nwhen: ${when}\n`);
    const said = r.ok ? '(read)' : r.errors.map((e) => e.message).join('; ');
    console.log(`  ${what}: ${said}`);
    check(!r.ok && message.test(said), `${what} is refused`);
  }
  const defs = mergeAchievements(common, dm).map((d) => withCounts(d, counts));
  const across = defs.filter((d) => d.across);
  for (const d of across) console.log(`  ${d.id}: ${[...d.aggregates.map((a) => `total(${a.key})`), ...d.games.map((g) => g.key)].join(', ')}`);
  check(sameIds(across.map((d) => d.id), ['dungeon-janitor', 'hr-problem', 'encore', 'every-ending']),
    'Dungeon Janitor, HR Problem, Encore and Dungeon Master\'s Every Ending are across games');
  check(across.every((d) => !d.whole), 'no achievement across games needs a game\'s whole history');
  const keyOf = (id: string, i: number): string => defs.find((d) => d.id === id)!.games[i]!.key;
  const won = keyOf('encore', 0);
  const [, badEnding, elsewhere] = [0, 1, 2].map((i) => keyOf('every-ending', i));
  const kills = `total(${defs.find((d) => d.id === 'dungeon-janitor')!.aggregates[0]!.key})`;
  check(keyOf('every-ending', 0) === won, 'Encore and Every Ending share games(won)');

  // A game: its figures as it goes, and nothing across games among its unlocks.
  const game = (end: 'won' | 'lost' | null, at: readonly [number, number, number], killed: number): { figures: GameFigures; unlocks: string[] } => {
    const state = new AchievementState(defs, true);
    const unlocks: string[] = [];
    for (let i = 0; i < killed; i++) state.record(kill());
    state.sample('level', at[0]);
    state.sample('x', at[1]);
    state.sample('y', at[2]);
    unlocks.push(...state.evaluate());
    if (end !== null) state.ended(end === 'won');
    unlocks.push(...state.evaluate());
    const restored = AchievementState.restore(defs, state.snapshot());
    check(JSON.stringify(restored.figures()) === JSON.stringify(state.figures()), 'a game\'s figures are kept by its snapshot');
    return { figures: state.figures(), unlocks };
  };
  const a = game('won', [13, 5, 5], 300);
  const b = game('lost', [0, 9, 1], 120);
  const c = game('lost', [2, 3, 4], 90);
  const d = game(null, [1, 1, 1], 600);
  for (const [name, g] of [['won', a], ['the bad ending', b], ['lost elsewhere', c], ['under way', d]] as const) {
    console.log(`  ${name}: ${JSON.stringify(g.figures)}`);
  }
  check(![a, b, c, d].some((g) => g.unlocks.some((id) => across.some((x) => x.id === id) || id.startsWith('games('))),
    'a game unlocks no achievement across games, nor a games(…) condition, as its own');
  check(a.figures[won] === 1 && a.figures[badEnding] === undefined && a.figures[elsewhere] === undefined, 'a win meets games(won) alone');
  check(b.figures[badEnding] === 1 && b.figures[elsewhere] === undefined && b.figures[won] === undefined, 'a loss in map 0 (9,1) is the bad ending');
  check(c.figures[elsewhere] === 1 && c.figures[badEnding] === undefined, 'a loss anywhere else is the other loss');
  check(d.figures[kills] === 600 && Object.keys(d.figures).length === 1, 'a game under way has its kills and no ending');
  check(sameIds(d.unlocks, ['first-blood', 'pest-control', 'exterminator']), 'its 600 kills are no Dungeon Janitor in one game');

  const cases: [string, GameFigures[], string[]][] = [
    ['one win', [a.figures], []],
    ['a win, the bad ending and another loss', [a.figures, b.figures, c.figures], ['dungeon-janitor', 'every-ending']],
    ['three wins', [a.figures, a.figures, a.figures], ['dungeon-janitor', 'encore']],
    ['a game of 600 kills and one of 300, won twice', [d.figures, a.figures, a.figures], ['dungeon-janitor', 'hr-problem']],
    ['the bad ending twice and a win, 540 kills', [b.figures, b.figures, a.figures], ['dungeon-janitor']],
  ];
  for (const [what, figures, unlocked] of cases) {
    const got = acrossUnlocked(defs, figures);
    console.log(`  ${what}: ${got.join(', ') || '(none)'}`);
    check(sameIds(got, unlocked), `${what}: ${unlocked.join(', ') || 'nothing'}`);
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

async function main(): Promise<void> {
  const common = commonFile();
  const values = 'speedRunnerMinutes = 180; blitzMinutes = 60; objectorKills = 40';
  const dm = setFile(common, 'dm-atari', STOCK_DIR, ['let-sleeping-dragons-lie', 'brute-force', 'express-elevator'],
    `${values}; cleanSweepLevels = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12; expressElevatorMinutes = 60`);
  const csb = setFile(common, 'csb', 'tools/fixtures/gamefiles/csb', ['self-reliant', 'fresh-faces', 'veterans'], values, ['clean-sweep'], ['girl-power']);
  for (const set of DATA_SETS) {
    if (set.id.startsWith('dm-')) check(achievementFileOf(set.id) === 'dm-atari', `${set.id}, a Dungeon Master set, reads dm-atari.txt`);
  }
  errors();
  wholeGame();
  const counts = await counted(common);
  evaluator(common, dm, counts);
  endings(common, dm, csb, counts);
  merging(common, counts);
  acrossGames(common, dm, counts);
  finish();
}

await main();
