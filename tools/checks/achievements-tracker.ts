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
 *    path that begins with a new game keeps a history from its start through its joins;
 *    one that begins with a CSBWin save has none, and the needs-the-whole-game conditions
 *    stay locked there (Speed Runner in the whole CSB game).
 * 3. What the tracker sees in the games: DMMovie2615, Dungeon Master won with four
 *    champions resurrected, their kills (melee, throw, explosion, Lord Chaos's fusion,
 *    each the party's with its champion and item), three deaths and their causes
 *    (starvation, a wall, a monster), what was eaten, drunk and worn, and the unlocks
 *    (First Blood, Forgot to Pack Lunch, Roll the Credits, the play time counted);
 *    the lost game's four deaths to monsters and its end; and the whole CSB game, where
 *    the party hurts itself (Own Goal) and carries more than ten coins (Scrooge).
 * 4. The worn places (`WORN_SLOTS`) are the slots whose `CarryLocation` in `graphics.dat`
 *    is the head's, neck's, torso's, legs' or feet's mask (`doc/CSBwin-src/CSB.h:1682-1687`).
 *
 * Usage: npm test -- --only=achievements-tracker.ts [<package name>…] [--not=<name>] [--events]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fileDigest } from '../../src/data/DataSetFiles';
import { findRecordingSet } from '../../src/data/RecordingSet';
import { mergeAchievements, readAchievementFile } from '../../src/engine/achievements/AchievementFile';
import type { AchievementEvent } from '../../src/engine/achievements/AchievementState';
import { AchievementTracker, WORN_SLOTS } from '../../src/engine/achievements/AchievementTracker';
import type { Happening } from '../../src/engine/Happening';
import { readRecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { DATA_SETS, diskFiles, diskSetDigests } from '../lib/dataSets';
import { playPath } from '../lib/playback';
import { CORPUS_DIR, CORPUS_FILE, corpusFiles } from '../lib/recordingCorpus';

const COMMON = resolve(import.meta.dirname, '../../src/engine/achievements/defs/common.txt');
const common = readAchievementFile(readFileSync(COMMON, 'utf8'));
if (!common.ok) throw new Error('common.txt does not read');
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
`);
if (!own.ok) throw new Error(`the tool's own achievements do not read: ${JSON.stringify(own.errors)}`);
const defs = mergeAchievements(common.file, own.file);

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
  let tracker!: AchievementTracker;
  let restored = 0;
  let carryLocation: readonly number[] = [];
  const startedAt = Date.now();
  const played = await playPath(set, diskFiles(set), pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null, null, null, (page) => {
    tracker = new AchievementTracker(page.game, defs, page.screen.ui.objectTables.objectNames);
    tracker.onEvent((event) => events.push(event));
    tracker.attach();
    carryLocation = Array.from(page.game.ctx.tables.carryLocation);
    const host = page.game.ctx.host;
    const observe = host.observe;
    host.observe = (h: Happening) => {
      if (h.k === 'read' && tracker.snapshotOf(fileDigest(h.file))) restored++;
      observe(h);
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
  const fromNewGame = pkg.path[0]!.start.kind === 'new';
  check(tracker.whole === fromNewGame, `${file}: its history goes back to the game's start exactly where its path begins with a new game (${fromNewGame})`);

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
    for (const id of ['first-blood', 'pest-control', 'forgot-lunch', 'roll-the-credits', 't-fused']) {
      check(unlocked.has(id), `DMMovie2615 unlocks ${id}`);
    }
    for (const id of ['lone-wolf', 'buddy-cop', 'exterminator', 't-lost']) check(!unlocked.has(id), `DMMovie2615 does not unlock ${id}`);
    const playVbls = Math.round(played.game.playTime() * 60 / 1000);
    check(Math.abs(tracker.playedVbls - playVbls) <= 1, `DMMovie2615: the play time counted is the game's, ${tracker.playedVbls} VBLs (${playVbls})`);
  }
  if (name === 'replay-lost-game') {
    check(count(events, 'death', { cause: 'monster' }) === 4 && count(events, 'death') === 4, 'replay-lost-game: four champions die, each to a monster');
    check(unlocked.has('t-lost') && !unlocked.has('roll-the-credits'), 'replay-lost-game: the game is lost, not won');
  }
  if (name === 'CSBFullRecordingV4') {
    for (const id of ['first-blood', 'exterminator', 'own-goal', 'scrooge', 'roll-the-credits']) check(unlocked.has(id), `CSBFullRecordingV4 unlocks ${id}`);
    check(!unlocked.has('speed-runner'), 'CSBFullRecordingV4: Speed Runner, which needs the whole game, stays locked in a game from a CSBWin save');
    check(count(events, 'hurt', { party: 'yes' }) > 0, 'CSBFullRecordingV4: the party hurts itself');
  }
}
if (!wornChecked) check(false, 'a package was played');
finish();
