/**
 * The achievements' tracker (`src/engine/achievements/AchievementTracker.ts`) on the
 * corpus's recordings (`doc/ACHIEVEMENTS.md` → "Watching the engine"): each package played
 * over its set as `recording-corpus.ts` plays it, the tracker attached before anything
 * plays (`playPath`'s `onPage`), the common file's achievements and a few of this tool's
 * own that read what the common file does not.
 *
 * 1. Every package plays to its point with the tracker attached, as it plays without one
 *    in `recording-corpus.ts`: the happenings change nothing in a tick.
 * 2. Each join's read finds the state its parent kept at the save (`saved`, `read`), and a
 *    path that begins with a new game or a CSB adventure's start, the set's `mini.dat` with
 *    a party put in (`isNewAdventure`), keeps a history from its start through its joins;
 *    one that begins with another CSBWin save has none. The whole CSB game begins at the
 *    adventure CSBWin's utility made, so its needs-the-whole-game conditions unlock: Speed
 *    Runner, won in less than 180 minutes, and not Blitz, in 60.
 * 3. What the tracker sees in the games: DMMovie2615, Dungeon Master won with four
 *    champions resurrected, their kills (melee, throw, explosion, Lord Chaos's fusion,
 *    each the party's with its champion and item), three deaths and their causes
 *    (starvation, a wall, a monster), what was eaten, drunk and worn, and the unlocks
 *    (First Blood, Forgot to Pack Lunch, Roll the Credits, the play time counted);
 *    the lost game's four deaths to monsters and its end; and the whole CSB game, where
 *    the party hurts itself (Own Goal), carries more than ten coins, though Scrooge is
 *    Dungeon Master's alone, and eats every kind of food the set holds (Gourmet). Each game is tracked with its set's achievements as the page
 *    merges them (`achievementFileOf`): DMMovie2615 kills with a Ful bomb (Grenadier),
 *    loses Gothmog to a wall (Stubbed Toe) and wins with one of four alive (Sole Survivor).
 * 4. The worn places (`WORN_SLOTS`) are the slots whose `CarryLocation` in `graphics.dat`
 *    is the head's, neck's, torso's, legs' or feet's mask (`doc/CSBwin-src/CSB.h:1682-1687`).
 * 5. The tracker reads its set's counts of the data (`dataCounts`), and Rune Scholar,
 *    Gourmet and Bestiary unlock exactly where the game's distinct spells cast, foods eaten
 *    and types killed reach them.
 * 6. Where the party is: each history enters its first level once, and a level after it
 *    only by leaving the one before, a join's read taking up the level and the floor its
 *    parent had at the save, so it enters nothing again and walks on from the share
 *    explored. Tourist unlocks exactly where the levels entered reach the set's. DMMovie2615
 *    leaves the Hall of Champions, which holds no monster, cleared, and the Dragon's level,
 *    the Dragon alive, not; it reaches level 13 in less than an hour: Deep Diver and
 *    Express Elevator, at the tick it enters.
 *
 * Usage: npm test -- --only=achievements-tracker.ts [<package name>…] [--not=<name>] [--events]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fileDigest } from '../../src/data/DataSetFiles';
import { findRecordingSet } from '../../src/data/RecordingSet';
import { mergeAchievements, readAchievementFile, type AchievementDef, type AchievementFile, type DataCounts } from '../../src/engine/achievements/AchievementFile';
import type { AchievementEvent } from '../../src/engine/achievements/AchievementState';
import { AchievementTracker, WORN_SLOTS } from '../../src/engine/achievements/AchievementTracker';
import { isNewAdventure } from '../../src/engine/Chaos';
import { achievementFileOf } from '../../src/engine/achievements/PageAchievements';
import type { Happening } from '../../src/engine/Happening';
import { readRecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { DATA_SETS, diskFiles, diskSetDigests } from '../lib/dataSets';
import { playPath } from '../lib/playback';
import { CORPUS_DIR, CORPUS_FILE, corpusFiles } from '../lib/recordingCorpus';

const DEFS = resolve(import.meta.dirname, '../../src/engine/achievements/defs');
const common = readAchievementFile(readFileSync(resolve(DEFS, 'common.txt'), 'utf8'));
if (!common.ok) throw new Error('common.txt does not read');
const commonFile = common.file;
/** This tool's own, beside the common file's: facts no common achievement reads alone. */
const own = readAchievementFile(`# CSBweb achievements 1
[t-lost]
name: Lost
text: The game was lost.
when: lost

[t-fused]
name: Fused
text: Lord Chaos fused.
when: ever(kill where monster = LordChaos and by = fusion and party = yes)

[t-coins]
name: Coins
text: More than ten coins carried.
when: max(coins) > 10
`);
if (!own.ok) throw new Error(`the tool's own achievements do not read: ${JSON.stringify(own.errors)}`);
const ownFile = own.file;

/** The set's achievements, as the page merges them (`achievementFileOf`), and this tool's own. */
function defsOf(setId: string): AchievementDef[] {
  const path = resolve(DEFS, `${achievementFileOf(setId)}.txt`);
  let file: AchievementFile | null = null;
  if (existsSync(path)) {
    const read = readAchievementFile(readFileSync(path, 'utf8'));
    if (!read.ok) throw new Error(`${path} does not read`);
    file = read.file;
  }
  return [...mergeAchievements(commonFile, file), ...ownFile.defs];
}

/** The counts of the data (`dataCounts`) the FTL sets' games read, as `achievements-format.ts` proves them. */
const COUNTS: Readonly<Record<string, DataCounts>> = {
  'dm-atari': { spells: 25, foods: 8, monsterTypes: 24, levels: 14 },
  csb: { spells: 25, foods: 8, monsterTypes: 23, levels: 10 },
};

const args = process.argv.slice(2);
const showEvents = args.includes('--events');
const only = args.filter((arg) => !arg.startsWith('--'));
const not = args.filter((arg) => arg.startsWith('--not=')).map((arg) => arg.slice('--not='.length));

/** How many events of `kind` have each of `attrs`. */
function count(events: readonly AchievementEvent[], kind: string, attrs: Readonly<Record<string, string>> = {}): number {
  return events.filter((e) => e.kind === kind && Object.entries(attrs).every(([k, v]) => e.attrs[k] === v)).length;
}

const digests = await diskSetDigests();
let wornChecked = false;
for (const file of corpusFiles()) {
  const name = CORPUS_FILE.exec(file)?.[1] ?? file;
  if (only.length > 0 && !only.includes(name)) continue;
  if (not.includes(name)) continue;
  const pkg = await readRecordingPackage(new Uint8Array(readFileSync(`${CORPUS_DIR}/${file}`)));
  const found = findRecordingSet(pkg.path, digests);
  if (found.kind === 'refused') {
    check(false, `${file}'s files are a set's: ${found.why}`);
    continue;
  }
  const set = DATA_SETS.find((candidate) => candidate.id === found.id)!;
  const events: AchievementEvent[] = [];
  /** `d.Time` at each event. */
  const times: number[] = [];
  /** The share explored before each join's read, and after it. */
  const joinsExplored: [number, number][] = [];
  let tracker!: AchievementTracker;
  let restored = 0;
  let carryLocation: readonly number[] = [];
  const miniDat = set.miniDat ? await diskFiles(set).read('mini.dat') : null;
  const start = pkg.path[0]!.start;
  const fromAdventure = start.kind === 'save' && miniDat !== null && isNewAdventure(start.bytes, miniDat);
  const startedAt = Date.now();
  const played = await playPath(set, diskFiles(set), pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null, null, null, (page) => {
    tracker = new AchievementTracker(page.game, defsOf(set.id), page.screen.ui.objectTables.objectNames, { dungeonDat: page.dungeonDat, miniDat });
    tracker.onEvent((event) => { events.push(event); times.push(page.game.ctx.state.tickCount); });
    tracker.attach();
    carryLocation = Array.from(page.game.ctx.tables.carryLocation);
    const host = page.game.ctx.host;
    const observe = host.observe;
    host.observe = (h: Happening) => {
      const before = tracker.explored;
      if (h.k === 'read' && tracker.snapshotOf(fileDigest(h.file))) restored++;
      observe(h);
      if (h.k === 'read' && tracker.snapshotOf(fileDigest(h.file))) joinsExplored.push([before, tracker.explored]);
    };
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const unlocked = new Set(tracker.unlocks.map((u) => u.id));
  console.log(`${file}: ${found.id}, ${played.joins} join(s), ${seconds} s; events ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  unlocked: ${tracker.unlocks.map((u) => `${u.id} (d.Time ${u.gameTime})`).join(', ') || 'nothing'}`);
  if (showEvents) for (const e of events) if (e.kind !== 'hurt') console.log(`    ${e.kind} ${JSON.stringify(e.attrs)}`);

  // 1. The happenings change nothing.
  check(played.drift === null, `${file} plays to its point with the tracker attached${played.drift ? `: drifts, ${JSON.stringify(played.drift)}` : ''}`);

  // 2. The joins, restored.
  check(restored === played.joins, `${file}: each of its ${played.joins} join(s) reads the state its parent kept at the save (${restored})`);
  const fromStart = start.kind === 'new' || fromAdventure;
  check(tracker.whole === fromStart,
    `${file}: its history goes back to the game's start exactly where its path begins with a new game or a CSB adventure's start (${start.kind}${fromAdventure ? ', an adventure' : ''})`);

  // 5. The counts of the data: the set's, and the three achievements that read them unlocked
  // exactly where the game's distinct spells, foods and types reach them.
  const distinct = (kind: string, attr: string, keep: (e: AchievementEvent) => boolean = () => true): number =>
    new Set(events.filter((e) => e.kind === kind && keep(e)).map((e) => e.attrs[attr])).size;
  const reached = {
    spells: distinct('cast', 'spell', (e) => e.attrs.ok === 'yes'),
    foods: distinct('eat', 'item'),
    monsterTypes: distinct('kill', 'monster', (e) => e.attrs.party === 'yes' && e.attrs.by !== 'fusion'),
  };
  const { counts } = tracker;
  console.log(`  of the data: spells ${reached.spells}/${counts.spells}, foods ${reached.foods}/${counts.foods}, monsterTypes ${reached.monsterTypes}/${counts.monsterTypes}`);
  const want = COUNTS[found.id];
  if (want) check(JSON.stringify(counts) === JSON.stringify(want), `${file}: the tracker counts ${found.id}'s ${JSON.stringify(want)}`);
  for (const [id, name] of [['rune-scholar', 'spells'], ['gourmet', 'foods'], ['bestiary', 'monsterTypes']] as const) {
    check(unlocked.has(id) === (reached[name] >= counts[name]), `${file}: ${id} ${unlocked.has(id) ? 'unlocks' : 'stays locked'}, ${reached[name]} of ${counts[name]}`);
  }

  // 6. Where the party is.
  const levels = events.filter((e) => e.kind === 'enter' || e.kind === 'leave');
  const entered = new Set(events.filter((e) => e.kind === 'enter').map((e) => e.attrs.level));
  console.log(`  levels entered ${[...entered].join(' ')} of ${counts.levels}, explored ${tracker.explored}%`);
  let alternates = levels.length > 0 && levels[0]!.kind === 'enter';
  for (let i = 1; i < levels.length; i++) {
    const [prev, e] = [levels[i - 1]!, levels[i]!];
    if (e.kind === prev.kind || (e.kind === 'leave' && e.attrs.level !== prev.attrs.level)) alternates = false;
  }
  check(alternates, `${file}: its history enters a level, then leaves that one before it enters the next`);
  check(joinsExplored.length === played.joins && joinsExplored.every(([before, after]) => after <= before),
    `${file}: each join's read takes up the share its parent explored (${joinsExplored.map(([b, a]) => `${b}% then ${a}%`).join(', ')})`);
  check(unlocked.has('tourist') === (entered.size >= counts.levels), `${file}: tourist ${unlocked.has('tourist') ? 'unlocks' : 'stays locked'}, ${entered.size} of ${counts.levels} levels`);
  if (played.joins > 0) check(count(events, 'enter') === 1, `${file}: its joins enter no level again: their reads take up the level the party was on`);

  // 4. The worn places, once.
  if (!wornChecked) {
    wornChecked = true;
    const masks: Record<string, number> = { head: 0x0002, neck: 0x0004, torso: 0x0008, legs: 0x0010, feet: 0x0020 };
    for (const [slot, place] of Object.entries(WORN_SLOTS)) {
      const mask = carryLocation[Number(slot)];
      check(mask === masks[place], `possession slot ${slot} is the ${place}: its CarryLocation is ${mask?.toString(16)}, the ${place}'s mask ${masks[place]!.toString(16)}`);
    }
  }

  // 3. What the games hold.
  if (name === 'DMMovie2615') {
    for (const hero of ['HALK', 'STAMM', 'LEYLA', 'GOTHMOG']) {
      check(count(events, 'join', { champion: hero, how: 'resurrect' }) === 1, `DMMovie2615: ${hero} joins, resurrected`);
    }
    const kills = count(events, 'kill', { party: 'yes' });
    check(kills >= 30, `DMMovie2615: the party kills ${kills} monsters`);
    check(count(events, 'kill', { party: 'yes', by: 'melee', champion: 'HALK', item: 'FALCHION' }) > 0, 'DMMovie2615: Halk kills with his falchion');
    check(count(events, 'kill', { party: 'yes', by: 'throw', champion: 'STAMM', item: 'AXE' }) > 0, 'DMMovie2615: Stamm kills with a thrown axe');
    check(count(events, 'kill', { party: 'yes', by: 'explosion', champion: 'GOTHMOG' }) > 0, 'DMMovie2615: Gothmog\'s fireballs kill');
    check(count(events, 'kill', { party: 'no', by: 'explosion' }) > 0, 'DMMovie2615: a fireball nobody of the party launched kills too, and is not the party\'s');
    check(count(events, 'kill', { monster: 'LordChaos', by: 'fusion', party: 'yes' }) === 1, 'DMMovie2615: Lord Chaos is fused, once');
    check(count(events, 'death', { champion: 'LEYLA', cause: 'starvation' }) === 1, 'DMMovie2615: Leyla starves');
    check(count(events, 'death', { champion: 'GOTHMOG', cause: 'wall' }) === 1, 'DMMovie2615: Gothmog dies against a wall');
    check(count(events, 'death', { champion: 'HALK', cause: 'monster' }) === 1, 'DMMovie2615: a monster kills Halk');
    check(count(events, 'eat', { champion: 'HALK', item: 'WORM ROUND' }) > 0, 'DMMovie2615: Halk eats a worm round');
    check(count(events, 'drink', { champion: 'STAMM', item: 'VI POTION' }) > 0, 'DMMovie2615: Stamm drinks a Vi potion');
    check(count(events, 'wear', { champion: 'STAMM', slot: 'feet', item: 'BOOTS OF SPEED' }) === 1, 'DMMovie2615: Stamm puts on the boots of speed');
    check(count(events, 'cast', { ok: 'yes', spell: 'FUL IR' }) > 0, 'DMMovie2615: a fireball, FUL IR, is cast');
    check(count(events, 'kill', { party: 'yes', by: 'explosion', champion: 'STAMM', item: 'FUL BOMB' }) > 0, 'DMMovie2615: Stamm\'s thrown Ful bombs kill, the bomb named on the explosion\'s kill');
    for (const id of [
      'first-blood', 'pest-control', 'forgot-lunch', 'roll-the-credits', 't-fused', 'stubbed-toe', 'grenadier', 'sole-survivor',
      'true-to-themselves', 'let-sleeping-dragons-lie',
    ]) {
      check(unlocked.has(id), `DMMovie2615 unlocks ${id}`);
    }
    for (const id of ['lone-wolf', 'buddy-cop', 'exterminator', 't-lost', 'untouchable', 'full-house', 'new-souls', 'dragonslayer', 'brute-force']) {
      check(!unlocked.has(id), `DMMovie2615 does not unlock ${id}`);
    }
    check(entered.size === 14, 'DMMovie2615 enters every level, 0 to 13');
    check(count(events, 'leave', { level: '0', cleared: 'yes' }) === 1, 'DMMovie2615 leaves the Hall of Champions, which holds no monster, cleared');
    check(count(events, 'leave', { level: '13', cleared: 'no' }) === 1, 'DMMovie2615 leaves the Dragon\'s level with the Dragon alive');
    const deepest = events.findIndex((e) => e.kind === 'enter' && e.attrs.level === '13');
    const at = (id: string): number | undefined => tracker.unlocks.find((u) => u.id === id)?.gameTime;
    check(['tourist', 'deep-diver', 'express-elevator'].every((id) => at(id) === times[deepest]),
      `DMMovie2615: Tourist, Deep Diver and Express Elevator unlock at d.Time ${times[deepest]}, as the party enters level 13`);
    check(!unlocked.has('clean-sweep') && !unlocked.has('cartographer'), 'DMMovie2615 sweeps no listed level and walks on less than 90% of the floor');
    // Its state kept at a save and read back: the floor walked and the level come back with it.
    const file = new Uint8Array([2, 6, 1, 5]);
    const explored = tracker.explored;
    const before = events.length;
    tracker.keep(fileDigest(file), JSON.parse(JSON.stringify(tracker.snapshot())) as ReturnType<AchievementTracker['snapshot']>);
    tracker.observe({ k: 'read', file });
    tracker.observe({ k: 'tick' });
    check(explored > 0 && tracker.explored === explored && events.length === before,
      `DMMovie2615: a state kept and read back keeps the ${explored}% of the floor walked on, and the level, entered again by nothing`);
    const playVbls = Math.round(played.game.playTime() * 60 / 1000);
    check(Math.abs(tracker.playedVbls - playVbls) <= 1, `DMMovie2615: the play time counted is the game's, ${tracker.playedVbls} VBLs (${playVbls})`);
  }
  if (name === 'replay-lost-game') {
    check(count(events, 'death', { cause: 'monster' }) === 4 && count(events, 'death') === 4, 'replay-lost-game: four champions die, each to a monster');
    check(unlocked.has('t-lost') && !unlocked.has('roll-the-credits'), 'replay-lost-game: the game is lost, not won');
  }
  if (name === 'CSBFullRecordingV4') {
    for (const id of ['first-blood', 'exterminator', 'own-goal', 't-coins', 'roll-the-credits']) check(unlocked.has(id), `CSBFullRecordingV4 unlocks ${id}`);
    check(!unlocked.has('scrooge'), 'CSBFullRecordingV4: Scrooge is Dungeon Master\'s, not CSB\'s');
    check(fromAdventure, 'CSBFullRecordingV4 begins at a new adventure CSBWin\'s utility made, mini.dat with its party put in');
    check(unlocked.has('speed-runner') && !unlocked.has('blitz'),
      `CSBFullRecordingV4: Speed Runner, which needs the whole game, unlocks in a game from the adventure's start, and Blitz does not (${Math.round(tracker.playedVbls / 3600)} minutes)`);
    check(count(events, 'hurt', { party: 'yes' }) > 0, 'CSBFullRecordingV4: the party hurts itself');
    check(unlocked.has('gourmet') && !unlocked.has('bestiary'), 'CSBFullRecordingV4: the party eats all eight kinds of food (Gourmet), and kills 22 of the 23 types');
    check(unlocked.has('tourist') && count(events, 'leave', { cleared: 'yes' }) > 0 && !unlocked.has('clean-sweep'),
      'CSBFullRecordingV4 sets foot on every level, and leaves some with no monster alive, though CSB lists no level to sweep');
  }
}
if (!wornChecked) check(false, 'a package was played');
finish();
