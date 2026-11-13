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
 * 7. The champions at each tick's end (`party(where …)`): the sex read where the tool knows
 *    it, Leyla a woman and Halk not; the feet sample counting Stamm's boots of speed from the
 *    tick he puts them on; the first Master and the first load over half the most a champion
 *    carries at the tick the tool reads them itself, `DetermineMastery(chIdx, skill |
 *    0xc000)` and `MaxLoad`; and Low Profile, Archmaster, Jack of All Trades, Featherweight
 *    and Insomniac as the game's ranks, loads and sleeps say, and Girl Power as the sexes
 *    do. The whole CSB game's party reads as no man, Buzzzzz and Lor among it: CSBWin's
 *    utility clears `CHARFLAG_male` (`DEBT.md` H, "A champion carried into a new adventure
 *    keeps their sex"), so `csb.txt` disables Girl Power.
 * 8. The casts: each names its power rune, and a failed one why, exactly as often as the
 *    game prints `SpellErrorMsg`'s message for it (`doc/CSBwin-src/Magic.cpp:1007`); a torch
 *    in a hand counted at the tick the tool sees it there itself; and Blazing Glory Day,
 *    Thick Atmosphere, I Know What I'm Doing and Dark Ages as the casts and hands say.
 * 9. The blows: a hit for each `DamageMonster` call that hurt or killed, its damage the
 *    call's; a kill's group counting up by one from the kill before it in its strike; a
 *    melee kill naming the empty hand exactly where the action hand was empty; each death
 *    the party's exactly where the champion's last hurt was; and Overkill, Strike!, Bare
 *    Knuckles and Friendly Fire Fatality as the hits, kills and deaths say. No recording
 *    lands on a group, so a new game's party is put on one of level 1's (`moveParty`):
 *    each member is a kill by landing, the party's, and Telefrag unlocks; and no champion
 *    dies to the party, so one hurt by its explosion dies after a save kept and read back,
 *    the party's death, and Friendly Fire Fatality unlocks.
 * 10. Where a game ends, and the Oracle: the whole CSB game, which never asks the Oracle,
 *    is Self-Reliant. No recording sees Dungeon Master's bad ending, so a new game's champion
 *    carries the Firestaff from the entrance's pad, map 0 (1,4), north onto (1,3): the party
 *    is sent to the closed cell of map 0 (9,1), dies there, the game is lost, and Gullible
 *    unlocks.
 * 11. The objects swapped, and taken: Some Assembly Required unlocks at the tick the
 *    Firestaff with the Power Gem is first in hand, which only the wall of map 13 (24,3)
 *    gives for the Firestaff; a theft for each object `StealFromCharacter` takes, and a
 *    Giggler killed a thief exactly where its group carries one: DMMovie2823's Gigglers
 *    take seven, and the party kills three of the thieves (Pickpocket's Revenge). A new
 *    game's Giggler that robbed nobody is no thief, and the two whose group takes a torch
 *    from the ready hand are, across a save kept and read back.
 * 12. The locks and switches triggered: a trigger with a GOR COIN at a wall for each coin
 *    the wall took from the hand; Riddle Me This unlocks the tick after the riddle room's
 *    counter at 4 reaches 0, which the Dungeon Master wins do and DMMovie42, three riddles
 *    answered, does not; Chaos Strikes Back's adventure has nine GOR COIN locks, and the
 *    whole game feeds them all (Coin-Operated).
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
import { BLOW_END, type Happening } from '../../src/engine/Happening';
import { MonsterType } from '../../src/engine/monsterTypes';
import type { ActuatorRecord, CreatureRecord } from '../../src/data/dungeonTypes';
import { getActuatorTargetY, getActuatorType, getActuatorValue } from '../../src/data/actuatorHelpers';
import type { DungeonState } from '../../src/engine/DungeonState';
import { readRecordingPackage } from '../../src/engine/RecordingPackage';
import { CHARFLAG_MALE, getChampionPossession } from '../../src/core/charDesc';
import { NameIndex } from '../../src/engine/objectIndex';
import { isAlive } from '../../src/engine/rules';
import { determineMastery } from '../../src/engine/skills';
import { MonsterDamageResult } from '../../src/engine/MonsterDamage';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position } from '../../src/core/types';
import { MovementAction } from '../../src/engine/gameTypes';
import { OBJNI_THE_FIRESTAFF_A, OBJNI_THE_FIRESTAFF_B } from '../../src/core/objectNameIndex';
import { testChampion } from '../lib/champion';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, STOCK_DIR, stockGame, stockGraphics } from '../lib/game';
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

[t-leyla]
name: Leyla
text: Leyla, a woman, in the party.
when: party(where champion = LEYLA and sex = female) >= 1

[t-halk]
name: Halk
text: Halk, a woman, in the party.
when: party(where champion = HALK and sex = female) >= 1

[t-speed]
name: Speed
text: A champion in boots of speed.
when: party(where feet = "BOOTS OF SPEED") >= 1

[t-master]
name: Master
text: A Master in a class.
when: party(where fighter >= 9 or ninja >= 9 or priest >= 9 or wizard >= 9) >= 1

[t-torch]
name: Torch
text: A torch in a champion's hand.
when: party(where ready = TORCH or action = TORCH) >= 1

[t-heavy]
name: Heavy
text: More than half the most a champion carries.
when: party(where load > 50) >= 1
`);
if (!own.ok) throw new Error(`the tool's own achievements do not read: ${JSON.stringify(own.errors)}`);
const ownFile = own.file;

/** `MonsterAttack`'s Giggler's blow, private, which the tool wraps to count what it takes. */
interface StealFromCharacter {
  stealFromCharacter(monster: CreatureRecord, chIdx: number): void;
}

/** The actuators on square `at`. */
function actuatorsAt(dungeon: DungeonState, at: Position): ActuatorRecord[] {
  const found: ActuatorRecord[] = [];
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const rec = dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR ? dungeon.getActuatorRecord(rn) : undefined;
    if (rec) found.push(rec);
  }
  return found;
}

/** The locks of type 4 that take a GOR COIN, by square, `level:x,y`, and how many sides of it hold one. */
function coinLocksOf(dungeon: DungeonState, names: readonly string[]): Map<string, number> {
  const locks = new Map<string, number>();
  for (let z = 0, map = dungeon.getMap(z); map; map = dungeon.getMap(++z)) {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const n = actuatorsAt(dungeon, new Position(x, y, z)).filter((a) => getActuatorType(a) === 4 && names[getActuatorValue(a)] === 'GOR COIN').length;
        if (n > 0) locks.set(`${z}:${x},${y}`, n);
      }
    }
  }
  return locks;
}

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
  /** What the tool reads itself at each tick's end: the first Master's and the first load over half's `d.Time`, the ranks, the sleeps begun. */
  let firstMaster = -1;
  let firstHeavy = -1;
  /** The `d.Time` of the first tick's end after boots of speed are first put on. */
  let bootsWorn = false;
  let bootsTick = -1;
  let wasAsleep = false;
  let asleep = 0;
  let males = 0;
  /** The d.Time of the first tick's end a champion holds a torch at, read by the tool itself. */
  let firstTorch = -1;
  /** The d.Time of the first tick's end the hand holds the Firestaff with the Power Gem, read by the tool itself. */
  let firstGemmed = -1;
  /** The failures `SpellErrorMsg` printed, by its message: meaningless, practice, flask. */
  const failures = { meaningless: 0, practice: 0, flask: 0 };
  /** The objects `StealFromCharacter` took, read by the tool itself. */
  let taken = 0;
  /** The d.Time of the first tick's end the riddle room's counter at 4, map 5 (13,23), has reached 0, read by the tool itself, and its last value. */
  let riddleSolved = -1;
  let riddleCount = -1;
  /** The walls' sides that hold a lock taking a GOR COIN, by square, as the history's first tick finds them, and how many the hand fed. */
  let coinLocks: Map<string, number> | null = null;
  const coinsTaken = new Map<string, number>();
  /** The `DamageMonster` calls that hurt or killed, and their damage, read by the tool itself. */
  let hurtCalls = 0;
  let hurtDamage = 0;
  /** Whether each blow open is a melee blow with an empty action hand, and the kills inside one. */
  const emptyHanded: boolean[] = [];
  let emptyHandKills = 0;
  const ranks = new Map<string, number[]>();
  const miniDat = set.miniDat ? await diskFiles(set).read('mini.dat') : null;
  const start = pkg.path[0]!.start;
  const fromAdventure = start.kind === 'save' && miniDat !== null && isNewAdventure(start.bytes, miniDat);
  const defs = defsOf(set.id);
  const startedAt = Date.now();
  const played = await playPath(set, diskFiles(set), pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null, null, null, (page) => {
    tracker = new AchievementTracker(page.game, defs, page.screen.ui.objectTables.objectNames, { dungeonDat: page.dungeonDat, miniDat });
    tracker.onEvent((event) => {
      events.push(event);
      times.push(page.game.ctx.state.tickCount);
      if (event.kind === 'wear' && event.attrs.item === 'BOOTS OF SPEED') bootsWorn = true;
    });
    tracker.attach();
    carryLocation = Array.from(page.game.ctx.tables.carryLocation);
    const host = page.game.ctx.host;
    const names = page.screen.ui.objectTables.objectNames;
    const print = host.messages.quePrintLines.bind(host.messages);
    host.messages.quePrintLines = (color, text) => {
      if (text === ' MUMBLES A MEANINGLESS SPELL.') failures.meaningless++;
      else if (text === ' NEEDS MORE PRACTICE WITH THIS ') failures.practice++;
      else if (text === ' NEEDS AN EMPTY FLASK IN HAND FOR POTION.') failures.flask++;
      print(color, text);
    };
    const monsterDamage = page.game.ctx.systems.monsterDamage;
    const damageMonster = monsterDamage.damageMonster.bind(monsterDamage);
    monsterDamage.damageMonster = (monster, index, level, x, y, damage, ...rest) => {
      const hp = monster.hp[index];
      const result = damageMonster(monster, index, level, x, y, damage, ...rest);
      if (damage > 0 && (result !== MonsterDamageResult.NO_MONSTER_DIED || monster.hp[index] !== hp)) {
        hurtCalls++;
        hurtDamage += damage;
      }
      return result;
    };
    const attack = page.game.ctx.systems.monsterAttack as unknown as StealFromCharacter;
    const stealFromCharacter = attack.stealFromCharacter.bind(attack);
    attack.stealFromCharacter = (monster, chIdx) => {
      const held = (): number => page.game.ctx.party.state.champions[chIdx]!.possessions.filter((rn) => rn !== OBJECT_ID_NULL).length;
      const before = held();
      stealFromCharacter(monster, chIdx);
      taken += before - held();
    };
    const actuators = page.game.ctx.systems.actuators;
    const touchWall = actuators.touchWall.bind(actuators);
    actuators.touchWall = (position, side) => {
      const { ctx } = page.game;
      const hand = ctx.party.state.objectInHand;
      const coin = hand !== OBJECT_ID_NULL && names[NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, hand)] === 'GOR COIN';
      const fired = touchWall(position, side);
      const key = `${position.z}:${position.x},${position.y}`;
      if (coin && fired && ctx.party.state.objectInHand === OBJECT_ID_NULL) coinsTaken.set(key, (coinsTaken.get(key) ?? 0) + 1);
      return fired;
    };
    const observe = host.observe;
    host.observe = (h: Happening) => {
      if (h.k === 'blow') emptyHanded.push(h.by === 'melee' && h.item === OBJECT_ID_NULL);
      else if (h.k === 'blow-end') emptyHanded.pop();
      else if (h.k === 'monster-died' && emptyHanded[emptyHanded.length - 1]) emptyHandKills++;
      if (h.k === 'tick') {
        const { ctx } = page.game;
        const party = ctx.party.state;
        const time = ctx.state.tickCount;
        if (bootsWorn && bootsTick < 0) bootsTick = time;
        if (firstGemmed < 0 && party.objectInHand !== OBJECT_ID_NULL
          && NameIndex(ctx.dungeon, ctx.tables, party.facing, party.objectInHand) === OBJNI_THE_FIRESTAFF_B) firstGemmed = time;
        if (riddleSolved < 0 && found.id.startsWith('dm-')) {
          const counter = actuatorsAt(ctx.dungeon, new Position(13, 23, 5)).find((a) => getActuatorType(a) === 6 && getActuatorTargetY(a) === 19);
          const value = counter ? getActuatorValue(counter) : -1;
          if (value === 0 && riddleCount > 0) riddleSolved = time;
          riddleCount = value;
        }
        coinLocks ??= coinLocksOf(ctx.dungeon, names);
        let maleNow = 0;
        party.champions.forEach((champ, i) => {
          if (!champ || i === party.potentialChampionIndex) return;
          if ((champ.charFlags & CHARFLAG_MALE) !== 0) maleNow++;
          if (firstTorch < 0 && [0, 1].some((slot) => {
            const rn = getChampionPossession(champ, slot);
            return rn !== 0xffff && names[NameIndex(ctx.dungeon, ctx.tables, party.facing, rn)] === 'TORCH';
          })) firstTorch = time;
          const rank = [0, 1, 2, 3].map((skill) => Math.min(16, determineMastery(champ, skill | 0xc000)) - 1);
          ranks.set(champ.name, rank);
          if (firstMaster < 0 && rank.some((r) => r >= 9)) firstMaster = time;
          const stats = ctx.systems.characterStats;
          if (firstHeavy < 0 && stats.characterLoad(champ) * 2 > stats.maxLoad(champ)) firstHeavy = time;
        });
        males = Math.max(males, maleNow);
        if (party.sleeping && !wasAsleep) asleep++;
        wasAsleep = party.sleeping;
      }
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

  // 7. The champions.
  const at = (id: string): number => tracker.unlocks.find((u) => u.id === id)?.gameTime ?? -1;
  console.log(`  ranks at the end: ${[...ranks].map(([hero, r]) => `${hero} ${r.join('/')}`).join(', ')}; first Master at ${firstMaster}, first load over half at ${firstHeavy}; sleeps ${count(events, 'sleep')} (${asleep} seen asleep at a tick's end)`);
  check(at('t-master') === firstMaster, `${file}: a champion's first Master is counted at d.Time ${firstMaster} (${at('t-master')})`);
  check(at('t-heavy') === firstHeavy, `${file}: the first load over half the most is counted at d.Time ${firstHeavy} (${at('t-heavy')})`);
  check(count(events, 'sleep') >= asleep, `${file}: each sleep the party was seen in at a tick's end is a sleep event`);
  const won = unlocked.has('roll-the-credits');
  const all = [...ranks.values()];
  const expect: [string, boolean][] = [
    ['low-profile', won && tracker.whole && all.every((r) => r.every((x) => x <= 8))],
    ['archmaster', all.some((r) => r.some((x) => x >= 15))],
    ['jack-of-all-trades', all.some((r) => r.every((x) => x >= 9))],
    ['featherweight', won && tracker.whole && firstHeavy < 0],
    ['insomniac', won && tracker.whole && count(events, 'sleep') === 0],
    ['girl-power', defs.some((d) => d.id === 'girl-power') && won && tracker.whole && males === 0],
  ];
  for (const [id, want] of expect) check(unlocked.has(id) === want, `${file}: ${id} ${want ? 'unlocks' : 'stays locked'}, as its ranks, loads, sleeps and sexes say`);

  // 8. The casts: each one's power rune, and its failure as the message the game printed says it.
  const casts = events.filter((e) => e.kind === 'cast');
  const powers = new Map<string, number>();
  for (const e of casts) powers.set(e.attrs.power ?? '-', (powers.get(e.attrs.power ?? '-') ?? 0) + 1);
  const whys = { meaningless: count(events, 'cast', { why: 'meaningless' }), practice: count(events, 'cast', { why: 'practice' }), flask: count(events, 'cast', { why: 'flask' }) };
  console.log(`  casts ${casts.length}: powers ${[...powers].map(([p, n]) => `${p} ${n}`).join(', ')}; failed ${JSON.stringify(whys)}, printed ${JSON.stringify(failures)}; first torch in hand at ${firstTorch}`);
  check(casts.every((e) => e.attrs.power !== undefined), `${file}: every cast names its power rune`);
  check(casts.every((e) => e.attrs.why === undefined || e.attrs.ok === 'no'), `${file}: only a failed cast says why`);
  check(JSON.stringify(whys) === JSON.stringify(failures), `${file}: each cast's failure is the message the game printed for it`);
  const mon = (spell: string): boolean => count(events, 'cast', { spell, power: 'MON', ok: 'yes' }) > 0;
  const light = casts.some((e) => e.attrs.ok === 'yes' && (e.attrs.spell === 'FUL' || e.attrs.spell === 'OH IR RA'));
  for (const [id, want] of [
    ['blazing-glory-day', mon('FUL IR')],
    ['thick-atmosphere', mon('OH VEN')],
    ['i-know-what-im-doing', won && tracker.whole && whys.meaningless === 0],
    ['dark-ages', won && tracker.whole && !light && firstTorch < 0],
  ] as const) check(unlocked.has(id) === want, `${file}: ${id} ${want ? 'unlocks' : 'stays locked'}, as its casts and hands say`);
  if (firstTorch >= 0) check(at('t-torch') === firstTorch, `${file}: a torch in hand is counted at d.Time ${firstTorch} (${at('t-torch')})`);

  // 9. The blows.
  const hits = events.filter((e) => e.kind === 'hit');
  const kills = events.filter((e) => e.kind === 'kill');
  const deaths = events.filter((e) => e.kind === 'death');
  const partyHits = hits.filter((e) => e.attrs.party === 'yes').map((e) => Number(e.attrs.damage));
  const hardest = Math.max(0, ...partyHits);
  const groups = new Map<string, number>();
  for (const e of kills) groups.set(e.attrs.group ?? '-', (groups.get(e.attrs.group ?? '-') ?? 0) + 1);
  const hand = count(events, 'kill', { by: 'melee', item: 'HAND' });
  console.log(`  hits ${hits.length} (${hurtCalls} DamageMonster calls hurt or killed), the party's hardest ${hardest}; kills by group ${[...groups].map(([g, n]) => `${g}: ${n}`).join(', ')}; empty-handed ${hand}; deaths the party's ${count(events, 'death', { party: 'yes' })} of ${deaths.length}`);
  check(hits.length === hurtCalls && hits.reduce((sum, e) => sum + Number(e.attrs.damage), 0) === hurtDamage,
    `${file}: a hit for each DamageMonster call that hurt or killed, ${hurtCalls}, its damage the call's (${hurtDamage})`);
  check(kills.every((e, i) => {
    const group = Number(e.attrs.group);
    if (group === 1) return true;
    const prev = kills[i - 1];
    return group <= 4 && prev !== undefined && Number(prev.attrs.group) === group - 1 && prev.attrs.monster === e.attrs.monster;
  }), `${file}: a kill's group is 1, or one more than the kill before it in the same strike, of the same type, and at most 4`);
  check(count(events, 'kill', { by: 'melee' }) === kills.filter((e) => e.attrs.by === 'melee' && e.attrs.item !== undefined).length,
    `${file}: every melee kill names what struck, an object or the empty hand`);
  check(hand === emptyHandKills, `${file}: a melee kill names the empty hand exactly where the action hand was empty (${emptyHandKills})`);
  const lastHurt = new Map<string, string>();
  let sidesKept = true;
  for (const e of events) {
    if (e.kind === 'hurt') lastHurt.set(e.attrs.champion ?? '', e.attrs.party ?? '');
    if (e.kind === 'death' && e.attrs.party !== (lastHurt.get(e.attrs.champion ?? '') ?? 'no')) sidesKept = false;
  }
  check(sidesKept, `${file}: each death is the party's exactly where the champion's last hurt was`);
  for (const [id, want] of [
    ['overkill', hardest >= 100],
    ['strike', kills.some((e) => e.attrs.party === 'yes' && e.attrs.group === '4' && e.attrs.by !== 'landing')],
    ['bare-knuckles', count(events, 'kill', { party: 'yes', by: 'melee', item: 'HAND' }) >= 100],
    ['telefrag', count(events, 'kill', { by: 'landing' }) > 0],
    ['friendly-fire-fatality', count(events, 'death', { party: 'yes' }) > 0],
  ] as const) check(unlocked.has(id) === want, `${file}: ${id} ${want ? 'unlocks' : 'stays locked'}, as its hits, kills and deaths say`);

  // 11. The objects swapped, and taken.
  const swaps = events.filter((e) => e.kind === 'swap');
  console.log(`  swaps ${swaps.map((e) => `${e.attrs.item} for ${e.attrs.took}`).join(', ') || 'none'}, the gem joined at ${firstGemmed}; thefts ${count(events, 'theft')}, thieves killed ${count(events, 'kill', { thief: 'yes' })}`);
  if (defs.some((d) => d.id === 'some-assembly-required')) {
    check(at('some-assembly-required') === firstGemmed,
      `${file}: Some Assembly Required unlocks at the tick the Firestaff with the Power Gem is first in hand, d.Time ${firstGemmed} (${at('some-assembly-required')})`);
    check(unlocked.has('pickpockets-revenge') === kills.some((e) => e.attrs.party === 'yes' && e.attrs.monster === 'Giggler' && e.attrs.thief === 'yes'),
      `${file}: Pickpocket's Revenge ${unlocked.has('pickpockets-revenge') ? 'unlocks' : 'stays locked'}, as its kills say`);
  }
  check(count(events, 'theft') === taken, `${file}: a theft for each object a Giggler's blow took (${taken})`);
  check(count(events, 'kill', { thief: 'yes' }) === 0 || taken > 0, `${file}: no group is a thief where nothing was stolen`);

  // 12. The locks and switches triggered.
  const coinFed = (key: string): number => count(events, 'trigger', {
    level: key.split(':')[0]!, x: key.split(/[:,]/)[1]!, y: key.split(',')[1]!, item: 'GOR COIN',
  });
  const lockSides = coinLocks ?? new Map<string, number>();
  const allLocks = lockSides.size > 0 && [...lockSides].every(([key, sides]) => (coinsTaken.get(key) ?? 0) >= sides);
  console.log(`  riddle room solved at ${riddleSolved}; GOR COIN locks ${[...lockSides].map(([key, sides]) => `${key}${sides > 1 ? ` x${sides}` : ''}`).join(' ') || 'none'}, fed ${[...coinsTaken].map(([key, n]) => `${key} x${n}`).join(' ') || 'none'}`);
  for (const [key, n] of coinsTaken) check(coinFed(key) === n, `${file}: a trigger with a GOR COIN at ${key} for each coin a wall there took (${n})`);
  if (defs.some((d) => d.id === 'riddle-me-this')) {
    check(at('riddle-me-this') === (riddleSolved < 0 ? -1 : riddleSolved + 1),
      `${file}: Riddle Me This unlocks the tick after the riddle room's counter at 4 reaches 0, d.Time ${riddleSolved}, as its message reaches map 5 (13,19) (${at('riddle-me-this')})`);
  }
  if (defs.some((d) => d.id === 'coin-operated')) {
    check(lockSides.size === 8 && [...lockSides.values()].reduce((a, b) => a + b, 0) === 9, `${file}: Chaos Strikes Back's adventure has nine GOR COIN locks, on eight walls`);
    check(unlocked.has('coin-operated') === allLocks, `${file}: Coin-Operated ${allLocks ? 'unlocks' : 'stays locked'}, as the locks fed say`);
  }

  // 3. What the games hold.
  if (name === 'DMMovie2615') {
    check(riddleSolved >= 0, 'DMMovie2615 answers the riddle room\'s four riddles at once');
    check(swaps.length === 1 && firstGemmed >= 0, 'DMMovie2615 joins the Power Gem to the Firestaff, its one swap');
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
    const boots = events.findIndex((e) => e.kind === 'wear' && e.attrs.item === 'BOOTS OF SPEED');
    check(at('t-speed') === bootsTick && bootsTick >= times[boots]!,
      `DMMovie2615: a champion in boots of speed is counted at the end of the first tick after Stamm puts them on at d.Time ${times[boots]}, d.Time ${bootsTick} (${at('t-speed')})`);
    check(unlocked.has('t-leyla') && !unlocked.has('t-halk'), 'DMMovie2615: Leyla is a woman, Halk is not');
    check(!unlocked.has('speedy-gonzales'), 'DMMovie2615: one pair of boots of speed is no Speedy Gonzales');
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
    // Runes that make no spell, a power and an element (`0x60 + 6 * row + n`), cast by a
    // living champion after the end: no recording mumbles one.
    const { ctx } = played.game;
    const caster = ctx.party.state.champions.findIndex((champ) => isAlive(champ));
    const mumbled = failures.meaningless;
    ctx.party.state.champions[caster]!.incantation = [101, 106];
    ctx.systems.magic.castSpellFromUi(caster);
    const last = events[events.length - 1];
    check(last?.kind === 'cast' && last.attrs.spell === 'DES' && last.attrs.power === 'MON' && last.attrs.ok === 'no'
      && last.attrs.why === 'meaningless' && failures.meaningless === mumbled + 1,
      `DMMovie2615: MON DES, which makes no spell, is a cast of power MON that failed as meaningless, the message printed (${JSON.stringify(last?.attrs)})`);
    const playVbls = Math.round(played.game.playTime() * 60 / 1000);
    check(Math.abs(tracker.playedVbls - playVbls) <= 1, `DMMovie2615: the play time counted is the game's, ${tracker.playedVbls} VBLs (${playVbls})`);
  }
  if (name === 'DMMovie42') check(riddleSolved < 0 && !unlocked.has('riddle-me-this'), 'DMMovie42: three riddles answered, not the fourth: Riddle Me This stays locked');
  if (name === 'CSBFullRecordingV4') check(allLocks && unlocked.has('coin-operated'), 'CSBFullRecordingV4: every GOR COIN lock opened, Coin-Operated');
  if (name === 'DMMovie2823') {
    check(count(events, 'theft', { monster: 'Giggler' }) === 7 && count(events, 'kill', { party: 'yes', monster: 'Giggler', thief: 'yes' }) === 3
      && unlocked.has('pickpockets-revenge'), 'DMMovie2823: Gigglers take seven objects, the party kills three of the thieves: Pickpocket\'s Revenge');
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
    check(males === 0 && ['BUZZZZZ', 'LOR'].every((hero) => ranks.has(hero)),
      'CSBFullRecordingV4: no champion carries CHARFLAG_male, which CSBWin\'s utility cleared, Buzzzzz and Lor among them');
    check(!defs.some((d) => d.id === 'girl-power') && !unlocked.has('girl-power'),
      'CSBFullRecordingV4: Girl Power, which its party of no man would earn, is disabled in csb.txt');
    check(unlocked.has('self-reliant'), 'CSBFullRecordingV4, won without the Oracle asked, is Self-Reliant');
    check(unlocked.has('gourmet') && !unlocked.has('bestiary'), 'CSBFullRecordingV4: the party eats all eight kinds of food (Gourmet), and kills 22 of the 23 types');
    check(unlocked.has('tourist') && count(events, 'leave', { cleared: 'yes' }) > 0 && !unlocked.has('clean-sweep'),
      'CSBFullRecordingV4 sets foot on every level, and leaves some with no monster alive, though CSB lists no level to sweep');
  }
}
// 9. A group landed on: no recording lands on one, so a new Dungeon Master game's party is
// put on level 1's largest group from nowhere (`moveParty(-1, …)`), as an arrival is.
{
  console.log('--- a group landed on');
  const game = stockGame();
  const events: AchievementEvent[] = [];
  const tracker = new AchievementTracker(game, defsOf('dm-atari'), graphicsTablesOf(stockGraphics()).objects.objectNames, {
    dungeonDat: new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/dungeon.dat`))), miniDat: null,
  });
  tracker.onEvent((event) => events.push(event));
  tracker.attach();
  const { ctx } = game;
  const map = ctx.dungeon.getMap(1)!;
  let at: Position | null = null;
  let members = 0;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const rn = ctx.dungeon.findFirstMonster(new Position(x, y, 1));
      const n = rn === OBJECT_ID_EOF ? 0 : (ctx.dungeon.getCreatureRecord(rn)!.numMonM1 & 0x3) + 1;
      if (n > members) [at, members] = [new Position(x, y, 1), n];
    }
  }
  if (!at) throw new Error('level 1 holds no group');
  ctx.party.state.position = new Position(at.x, at.y, 1);
  game.systems.monsters.loadPartyLevelIfChanged();
  game.ctx.systems.worldMove.moveParty(-1, 0, at.x, at.y);
  tracker.observe({ k: 'tick' });
  const landed = events.filter((e) => e.kind === 'kill');
  console.log(`  the party lands on (${at.x},${at.y}) of level 1, a group of ${members}: ${landed.map((e) => JSON.stringify(e.attrs)).join(', ')}`);
  check(ctx.dungeon.findFirstMonster(at) === OBJECT_ID_EOF, 'the group the party lands on is deleted');
  check(landed.length === members && landed.every((e, i) => e.attrs.by === 'landing' && e.attrs.party === 'yes' && e.attrs.group === `${i + 1}`),
    `each of its ${members} members is a kill by landing, the party's, the strike's ${members} of its group`);
  check(tracker.unlocked.has('telefrag') && !tracker.unlocked.has('strike'), 'Telefrag unlocks, and a group landed on is no Strike!');
  // A champion hurt by the party's own explosion, the damage pending across a save kept and
  // read back, dies at the tick outside any blow: the death is the party's.
  tracker.observe({ k: 'blow', by: 'explosion', party: true });
  tracker.observe({ k: 'champion-hurt', chIdx: 2, damage: 50 });
  tracker.observe({ k: 'blow-end' });
  const file = new Uint8Array([7, 3]);
  tracker.keep(fileDigest(file), JSON.parse(JSON.stringify(tracker.snapshot())) as ReturnType<AchievementTracker['snapshot']>);
  tracker.observe({ k: 'read', file });
  tracker.observe({ k: 'champion-died', chIdx: 2 });
  tracker.observe({ k: 'tick' });
  const death = events[events.length - 1];
  check(death?.kind === 'death' && death.attrs.cause === 'explosion' && death.attrs.party === 'yes' && tracker.unlocked.has('friendly-fire-fatality'),
    `a death pending from the party's own explosion, across a save read, is the party's: Friendly Fire Fatality (${JSON.stringify(death?.attrs)})`);
}

// 10. Dungeon Master's bad ending: no recording sees it, so a new game's champion carries
// the Firestaff, taken from its altar on map 6 (14,16), from the entrance's pad north.
{
  console.log('--- the bad ending');
  const game = stockGame();
  game.setRandomSeed(0x12345678);
  const tracker = new AchievementTracker(game, defsOf('dm-atari'), graphicsTablesOf(stockGraphics()).objects.objectNames, {
    dungeonDat: new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/dungeon.dat`))), miniDat: null,
  });
  tracker.attach();
  tracker.observe({ k: 'new-game' });
  const { ctx } = game;
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const altar = new Position(14, 16, 6);
  let staff = OBJECT_ID_NULL;
  for (let rn = ctx.dungeon.findFirstObject(altar); rn !== OBJECT_ID_EOF; rn = ctx.dungeon.getDBRecordLink(rn)) {
    if (NameIndex(ctx.dungeon, ctx.tables, 0, rn) === OBJNI_THE_FIRESTAFF_A) staff = rn;
  }
  if (staff === OBJECT_ID_NULL || !ctx.dungeon.removeObjectFromCell(altar, staff)) throw new Error('no Firestaff on map 6 (14,16)');
  ctx.systems.character.addCharacterPossession(0, staff, 1);
  ctx.party.state.position = new Position(1, 5, 0);
  ctx.party.state.facing = 0;
  game.systems.monsters.loadPartyLevel(0);
  const step = (): void => {
    ctx.systems.movement.moveParty(MovementAction.MOVE_FORWARD);
    for (let t = 0; t < 3; t++) game.gameTick();
  };
  step();
  step();
  for (let t = 0; t < 1000 && !game.mainLoopHasReturned(); t++) game.gameTick();
  const { x, y, z } = ctx.party.state.position;
  console.log(`  the party ends on map ${z} (${x},${y}), d.Time ${ctx.state.tickCount}, the game ${ctx.party.state.gameIsLost ? 'lost' : 'not lost'}`);
  check(game.mainLoopHasReturned() && ctx.party.state.gameIsLost && !ctx.state.gameWon && z === 0 && x === 9 && y === 1,
    'the Firestaff carried from the entrance\'s pad north sends the party to map 0 (9,1), where the game is lost');
  check(tracker.unlocked.has('gullible') && tracker.unlocked.has('t-lost'), 'Gullible unlocks, the game lost');
}

// 11. A theft: no recording is robbed, so a new game's champion holding a torch stands by
// map 9's Gigglers, whose blow `StealFromCharacter` is called until it takes the torch.
{
  console.log('--- a theft');
  const game = stockGame();
  game.setRandomSeed(0x12345678);
  const events: AchievementEvent[] = [];
  const names = graphicsTablesOf(stockGraphics()).objects.objectNames;
  const tracker = new AchievementTracker(game, defsOf('dm-atari'), names, {
    dungeonDat: new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/dungeon.dat`))), miniDat: null,
  });
  tracker.onEvent((event) => events.push(event));
  tracker.attach();
  tracker.observe({ k: 'new-game' });
  const { ctx } = game;
  game.systems.hallOfChampions.addChampion(testChampion(0));
  ctx.party.state.position = new Position(1, 24, 9);
  game.systems.monsters.loadPartyLevelIfChanged();
  const groupAt = (x: number, y: number): CreatureRecord => {
    const rn = ctx.dungeon.findFirstMonster(new Position(x, y, 9));
    const group = rn === OBJECT_ID_EOF ? undefined : ctx.dungeon.getCreatureRecord(rn);
    if (!group || group.creatureType !== MonsterType.mon_Giggler) throw new Error(`no Giggler on map 9 (${x},${y})`);
    return group;
  };
  const strike = (group: CreatureRecord, x: number, y: number): void => {
    tracker.observe({ k: 'blow', by: 'melee', party: true, champion: 0, item: OBJECT_ID_NULL });
    ctx.systems.monsterDamage.damageMonster(group, group.numMonM1 & 3, 9, x, y, 1000, true, false);
    tracker.observe(BLOW_END);
  };
  // A Giggler that robbed nobody is no thief.
  strike(groupAt(13, 24), 13, 24);
  const thieves = groupAt(0, 24);
  const torchAt = new Position(10, 6, 0);
  let torch = OBJECT_ID_EOF;
  for (let rn = ctx.dungeon.findFirstObject(torchAt); rn !== OBJECT_ID_EOF; rn = ctx.dungeon.getDBRecordLink(rn)) {
    if (names[NameIndex(ctx.dungeon, ctx.tables, 0, rn)] === 'TORCH') torch = rn;
  }
  if (torch === OBJECT_ID_EOF || !ctx.dungeon.removeObjectFromCell(torchAt, torch)) throw new Error('no torch on map 0 (10,6)');
  const steal = ctx.systems.monsterAttack as unknown as StealFromCharacter;
  let tries = 0;
  for (const champ = ctx.party.state.champions[0]!; tries < 100 && thieves.possession === OBJECT_ID_EOF; tries++) {
    if (getChampionPossession(champ, 0) === OBJECT_ID_NULL) ctx.systems.character.addCharacterPossession(0, torch, 0);
    steal.stealFromCharacter(thieves, 0);
  }
  const theft = events.find((e) => e.kind === 'theft');
  console.log(`  taken after ${tries} blow(s): ${JSON.stringify(theft?.attrs)}`);
  check(thieves.possession === torch && theft?.attrs.item === 'TORCH' && theft.attrs.monster === 'Giggler' && events.filter((e) => e.kind === 'theft').length === 1,
    'a Giggler\'s blow takes the torch from the ready hand into its group\'s possessions, one theft');
  // Its state kept at a save and read back: the stolen torch comes back with it.
  const file = new Uint8Array([9, 0, 24]);
  tracker.keep(fileDigest(file), JSON.parse(JSON.stringify(tracker.snapshot())) as ReturnType<AchievementTracker['snapshot']>);
  tracker.observe({ k: 'read', file });
  strike(thieves, 0, 24);
  tracker.observe({ k: 'tick' });
  strike(thieves, 0, 24);
  tracker.observe({ k: 'tick' });
  const kills = events.filter((e) => e.kind === 'kill');
  console.log(`  kills: ${kills.map((e) => JSON.stringify(e.attrs)).join(', ')}`);
  check(kills.length === 3 && kills[0]!.attrs.thief === 'no' && kills[1]!.attrs.thief === 'yes' && kills[2]!.attrs.thief === 'yes',
    'the Giggler that robbed nobody is no thief; each of the two that robbed the party, across a save kept and read back, is');
  check(tracker.unlocked.has('pickpockets-revenge'), 'Pickpocket\'s Revenge unlocks');
  check(ctx.dungeon.findFirstObject(new Position(0, 24, 9)) !== OBJECT_ID_EOF, 'the thieves\' group, its last member dead, drops what it took');
}

if (!wornChecked) check(false, 'a package was played');
finish();
