/**
 * The achievements of a game the player plays (`doc/ACHIEVEMENTS.md` → "The page"):
 * `PageAchievements` on the stand-in page, which runs the page's own saves
 * (`GameSaves`), over stores in memory. On `csbgame7.dat`, a genuine save of the Atari
 * Dungeon Master, and on a new game of it. The tool's own achievements read the player's
 * time, which any game counts.
 *
 * 1. **A row with no history**: a CSBWin save's starts a history of its own, not the
 *    whole game's.
 * 2. **The snapshot through a save and a read**: F5's row holds the tracker's history as
 *    the file was made; F9 reads it back, its unlocks after the save forgotten, its time
 *    the row's; a fresh page reading the row takes it up; a new game's save keeps a whole
 *    history, and the same file in a row without one does not.
 * 3. **The store's rows**: an unlock is a row of the set, the playthrough and the party,
 *    `unverified`, shown once; unlocked again after F9, the first row stays.
 * 4. **The teleport**: a playthrough a teleport has touched writes and shows nothing.
 *
 * The viewer's page builds no tracker: `tools/probe-frames.ts` asserts it on
 * `?recording=`.
 *
 * Run: `npm test -- --only=achievements-page.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { VBL_FREQUENCY } from '../../src/core/constants';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { memoryAchievementStore, readSaveFileFields, saveEntryOf, type SaveEntry, type StoredSaveEntry } from '../../src/data/saves';
import { setAchievementDefs, type ShownUnlock } from '../../src/engine/achievements/PageAchievements';
import { standInPage, type StandInPage } from '../../src/renderer/StandInPage';
import { check, finish } from '../lib/check';
import { STOCK_DATA_SET, diskFiles } from '../lib/dataSets';
import { memoryStore, savePath } from '../lib/saves';

const VBL_MS = Math.ceil(1000 / VBL_FREQUENCY);
const set = STOCK_DATA_SET;
const files = diskFiles(set);
const common = readFileSync(resolve(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8');
const defs = setAchievementDefs(common, `# CSBweb achievements 1
[t-two]
name: Two Seconds
text: Play for two seconds.
when: playTime >= 2s

[t-four]
name: Four Seconds
text: Play for four seconds.
when: playTime >= 4s
`);

const saves = memoryStore();
const achievementStore = memoryAchievementStore();
const touched = new Set<number>();

/** A page over the stores, its achievements tracked, and what it showed. */
async function page() {
  const built = await standInPage(set, files, saves);
  const achievements = built.track(defs, achievementStore, touched);
  const shown: ShownUnlock[] = [];
  achievements.onShown((s) => shown.push(s));
  return { ...built, achievements, shown };
}

/** The loop run for `ms` of the clock, a VBL at a time. */
function run(p: StandInPage, ms: number): void {
  p.game.start(true);
  for (const until = p.clock.time + ms; p.clock.time < until;) {
    if (!p.clock.advance(VBL_MS)) throw new Error('the loop stopped');
  }
}

/** A row of `bytes`, with no history (`achievements: null`), as an import's or an old row's. */
async function storedRow(id: string, bytes: Uint8Array): Promise<SaveEntry> {
  const entry: SaveEntry = {
    id, name: id, dataSet: set.id, quick: false, sleep: false, savedAt: 1, usedAt: 1, playTime: 0,
    unofficial: false, recording: null, achievements: null, ...readSaveFileFields(bytes)!,
  };
  await saves.write(entry, bytes);
  return entry;
}

const row = async (id: string): Promise<SaveEntry> => (await saves.list(set.id)).find((r) => r.id === id)!;

// 1. A row with no history.
console.log('=== a row with no history ===');
const csbgame7 = new Uint8Array(readFileSync(savePath('csbgame7.dat')));
const imported = await storedRow('csbgame7.dat', csbgame7);
const a = await page();
a.saves.read(await a.saves.open(imported));
check(!a.achievements.tracker.whole, 'a CSBWin save read from a row with no history starts a history that is not the whole game\'s');
check(a.achievements.tracker.unlocked.size === 0 && a.achievements.tracker.playedVbls === 0, 'it starts with nothing unlocked and no time counted');
const old: StoredSaveEntry = { ...imported };
delete (old as { achievements?: unknown }).achievements;
check(saveEntryOf(old).achievements === null, 'a stored row from before rows held a history reads as one with none');

// 2. The snapshot through F5 and F9.
console.log('=== F5 and F9 ===');
run(a, 1000);
await a.saves.quickSave();
const quick = (await saves.list(set.id)).find((r) => r.quick)!;
const kept = quick?.achievements;
console.log(`  F5's row ${quick?.name}: ${kept ? `${kept.state.vbls} VBLs, whole ${kept.state.whole}, unlocked [${kept.state.unlocked.join(', ')}]` : 'no history'}`);
check(kept !== null && kept !== undefined, 'F5\'s row holds the tracker\'s history');
check(kept?.state.vbls === a.achievements.tracker.playedVbls && Math.abs((kept?.state.vbls ?? 0) - 60) <= 2,
  `its time is the tracker's as the file was made, a second's VBLs (${kept?.state.vbls})`);
check(kept?.state.unlocked.length === 0 && kept?.state.whole === false, 'nothing unlocked yet, and the history is still not the whole game\'s');

// 3. The store's rows.
console.log('=== the store ===');
run(a, 1500);
await a.achievements.settled();
const party = a.game.ctx.party.state.champions.map((c) => c.name);
const rows = await achievementStore.list(set.id);
console.log(`  rows: ${rows.map((r) => `${r.id} ${r.playthrough} ${r.playTime} ms d.Time ${r.gameTime} [${r.champions.join(' ')}] ${r.proof}`).join('; ')}`);
check(rows.length === 1 && rows[0]!.id === 't-two', 'Two Seconds unlocks and is one row');
const first = rows[0]!;
check(first.dataSet === set.id && first.playthrough === quick.playthrough, 'the row is of the set and of the playthrough being played');
check(Math.abs(first.playTime - 2000) <= 2 * VBL_MS, `its play time is the tracker's, two seconds (${first.playTime} ms)`);
check(JSON.stringify(first.champions) === JSON.stringify(party), 'it names the party');
check(first.proof === 'unverified', 'its proof is unverified');
check(a.shown.length === 1 && a.shown[0]!.def.name === 'Two Seconds', 'the unlock is shown once');

await a.saves.quickLoad();
check(!a.achievements.tracker.unlocked.has('t-two'), 'F9 reads F5\'s row: what was unlocked after the save is forgotten');
check(a.achievements.tracker.playedVbls === kept?.state.vbls, `its time is the row's (${a.achievements.tracker.playedVbls})`);
run(a, 1500);
await a.achievements.settled();
const again = await achievementStore.list(set.id);
check(a.achievements.tracker.unlocked.has('t-two') && a.shown.length === 2, 'Two Seconds unlocks again after F9, and is shown again');
check(again.length === 1 && again[0]!.unlockedAt === first.unlockedAt, 'the store keeps the first unlock\'s row');

// The row read by a fresh page.
const b = await page();
b.saves.read(await b.saves.open(await row(quick.id)));
check(b.achievements.tracker.playedVbls === kept?.state.vbls && !b.achievements.tracker.whole,
  'a fresh page reading F5\'s row takes up its history: its time, not the whole game\'s');

// A new game's history, whole.
console.log('=== a new game ===');
const c = await page();
c.game.readNewGame(new DungeonLoader().loadDungeonDat(c.dungeonDat));
await c.saves.newGameRead();
check(c.achievements.tracker.whole, 'a new game\'s history is the whole game\'s');
run(c, 500);
const saved = await c.saves.save('running', 'new');
check(saved.achievements?.state.whole === true, 'its save\'s row holds a whole history');
const d = await page();
d.saves.read(await d.saves.open(await row(saved.id)));
check(d.achievements.tracker.whole, 'a fresh page reading that row goes on with the whole game\'s history');
const e = await page();
const bare = await storedRow('exported.dat', await saves.read(saved.id));
e.saves.read(await e.saves.open(bare));
check(!e.achievements.tracker.whole, 'the same file in a row without a history, as an export imported, starts one of its own');

// 4. The teleport.
console.log('=== the teleport ===');
const before = a.shown.length;
touched.add(a.achievements.playthrough);
check(a.achievements.teleported, 'the playthrough is touched');
run(a, 2500);
await a.achievements.settled();
check(a.achievements.tracker.unlocked.has('t-four'), 'the tracker unlocks Four Seconds in the touched playthrough');
check(!(await achievementStore.list(set.id)).some((r) => r.id === 't-four'), 'no row is written for it');
check(a.shown.length === before, 'nor is it shown');

finish();
