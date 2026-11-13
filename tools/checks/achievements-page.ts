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
 *    history, and the same file in a row without one does not. In Chaos Strikes Back, the
 *    adventure RISE makes from `csbgame7.dat`'s party is a game from its start, and its
 *    history the whole game's, though its row holds none; a CSB save made later is not.
 * 3. **The store's rows**: an unlock is a row of the set, the playthrough and the party,
 *    `unverified`, shown once; unlocked again after F9, the first row stays.
 * 4. **The teleport**: a playthrough a teleport has touched writes and shows nothing.
 * 5. **The banner** (`AchievementBanner.ts`): two unlocks at once show one after the
 *    other, each from its first drawing, none under a dialog, and none with ACHIEVEMENT
 *    NOTICES off. `tools/probe-frames.ts` takes its frame.
 * 6. **The dialog** (`AchievementsDialog.ts`): GAME's ACHIEVEMENTS opens it in the
 *    settings' place, the clock held; its rows are the set's, in the file's order, those
 *    unlocked in their tier's colour; a click selects a row and the detail says it, and
 *    one needing the whole game says so in a game from a save; the wheel and the arrows
 *    scroll; Esc closes it. `tools/probe-frames.ts` takes its frame.
 * 7. **Across games**: each playthrough's figures merged into its row of the store, each
 *    key at the larger; an achievement across games unlocked as the live game's figures
 *    and another playthrough's stored ones make it yes, a row of the playthrough playing
 *    and shown, but never the tracker's; a teleported playthrough's figures not written.
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
import { BANNER_RECT, TIER_COLORS, drawAchievementBanner, showAchievementNotice, takeBannerChanged } from '../../src/renderer/ui/AchievementBanner';
import {
  DETAIL_CHARS, LIST, achievementsDialogClick, achievementsDialogKey, achievementsDialogWheel, detailLines, rowText, wrapText,
} from '../../src/renderer/ui/AchievementsDialog';
import { listRowRect } from '../../src/renderer/ui/Widgets';
import { openSettingsDialog, settingButtonFrame, settingsDialogClick } from '../../src/renderer/ui/SettingsDialog';
import { check, finish } from '../lib/check';
import { STOCK_DATA_SET, dataSetNamed, diskFiles } from '../lib/dataSets';
import { memoryStore, savePath } from '../lib/saves';

const VBL_MS = Math.ceil(1000 / VBL_FREQUENCY);
const set = STOCK_DATA_SET;
const files = diskFiles(set);
const common = readFileSync(resolve(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8');
// csbgame7's four champions wear Dungeon Master's four pairs of boots of speed, which
// would unlock Speedy Gonzales at its first tick: the tool's own are the ones it watches.
const defs = setAchievementDefs(common, `# CSBweb achievements 1
[speedy-gonzales]
disabled

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

// A CSB adventure's history, whole from RISE's save.
console.log('=== a CSB adventure ===');
const csb = dataSetNamed('csb');
const csbFiles = diskFiles(csb);
const mini = await csbFiles.read('mini.dat');
if (!mini) throw new Error('the csb set has no mini.dat');
const csbPage = async () => {
  const built = await standInPage(csb, csbFiles, saves);
  return { ...built, achievements: built.track(defs, achievementStore, touched, mini) };
};
const f = await csbPage();
const adventure = await f.saves.makeNewAdventure(imported, mini);
check(adventure.entry.achievements === null, `RISE's row ${adventure.entry.name} holds no history`);
f.saves.read(adventure);
check(f.achievements.tracker.whole, 'read, the adventure\'s history is the whole game\'s: the adventure begins there');
run(f, 500);
const adventureSaved = await f.saves.save('running', 'new');
check(adventureSaved.achievements?.state.whole === true, 'its save\'s row holds a whole history');
const g = await csbPage();
g.saves.read(await g.saves.open(await storedRow('csbgame-early-1hero.dat', new Uint8Array(readFileSync(savePath('csbgame-early-1hero.dat'))))));
check(!g.achievements.tracker.whole, 'a CSB save made later in a row with no history starts a history of its own');
const h = await page();
h.saves.read(await h.saves.open(await storedRow('adventure-in-dm.dat', adventure.bytes)));
check(!h.achievements.tracker.whole, 'the adventure\'s file read where the set has no mini.dat starts one of its own');

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

// 5. The banner.
console.log('=== the banner ===');
const { ui } = a.screen;
showAchievementNotice(ui, { name: 'One', tier: 'easy' });
showAchievementNotice(ui, { name: 'Two', tier: 'hard' });
check(takeBannerChanged(ui) && !takeBannerChanged(ui), 'an unlock shown is a change a frame draws, once');
check(ui.banner.shown?.notice.name === 'One' && ui.banner.shown.until === null && ui.banner.waiting.length === 1,
  'the first shows, its time not begun, the second waits');
ui.dialog = { name: 'settings' } as typeof ui.dialog;
check(drawAchievementBanner(ui) === null && ui.banner.shown?.until === null, 'under a dialog it is not drawn, and its time does not begin');
ui.dialog = null;
check(drawAchievementBanner(ui) === BANNER_RECT && ui.banner.shown?.until !== null, 'drawn, over the view, its three seconds begin');
check(!takeBannerChanged(ui), 'and it stays for them');
ui.banner.shown!.until = 0;
check(takeBannerChanged(ui) && ui.banner.shown?.notice.name === 'Two', 'at their end, the next takes its place');
ui.banner.shown!.until = 0;
check(takeBannerChanged(ui) && ui.banner.shown === null && drawAchievementBanner(ui) === null, 'and then the banner is gone');
ui.settings.update({ achievementNotices: false });
showAchievementNotice(ui, { name: 'Three', tier: 'easy' });
check(ui.banner.shown === null && !takeBannerChanged(ui), 'with ACHIEVEMENT NOTICES off, an unlock shows nothing');

// 6. The dialog.
console.log('=== the dialog ===');
openSettingsDialog(ui);
const achievementsButton = settingButtonFrame(9);
settingsDialogClick(ui, (achievementsButton.x1 + achievementsButton.x2) >> 1, (achievementsButton.y1 + achievementsButton.y2) >> 1, 2);
const state = ui.achievementsDialog;
const dialogName = (): string | undefined => (ui as { dialog: { name: string } | null }).dialog?.name;
check(dialogName() === 'achievements' && ui.settingsDialog === null && state !== null && a.game.ctx.state.paused,
  'GAME\'s ACHIEVEMENTS opens the achievements in the settings\' place, the clock held');
const view = ui.achievements()!;
check(view.defs.map((def) => def.id).join() === defs.map((def) => def.id).join(), 'its rows are the set\'s achievements, in the file\'s order');
check(view.unlocked.has('t-two') && view.unlocked.has('t-four') && !view.whole, 'what the game\'s history unlocked, not the whole game\'s');
const firstRow = rowText(defs.find((def) => def.id === 'first-blood')!);
console.log(`  "${firstRow}"`);
check(firstRow.startsWith('FIRST BLOOD ') && firstRow.endsWith(' EASY'), 'a row: the name, and the tier at its end');
const wholeOne = defs.findIndex((def) => def.whole);
console.log(`  ${defs[wholeOne]!.id}: ${JSON.stringify(detailLines(view, defs[wholeOne]!))}`);
check(detailLines(view, defs[wholeOne]!)[0] === 'LOCKED: NEEDS A GAME PLAYED FROM ITS START',
  'one that needs the whole game says it cannot be unlocked in a game from a save');
const two = defs.findIndex((def) => def.id === 't-two');
check(detailLines(view, defs[two]!)[0] === 'UNLOCKED' && TIER_COLORS.easy !== TIER_COLORS.hard, 'one unlocked says so');
check(JSON.stringify(wrapText('Kill your first monster with a very long word', 12)) === JSON.stringify(['Kill your', 'first', 'monster with', 'a very long', 'word'])
  && wrapText('x'.repeat(25), 10).length === 3 && DETAIL_CHARS >= 48, 'the text is cut at its words, a line of the panel\'s width');
const rowRect = listRowRect(LIST, 3);
achievementsDialogClick(ui, rowRect.x1 + 10, rowRect.y1 + 3, 2);
check(state?.selected === 3, 'a click on a row selects it');
check(achievementsDialogWheel(ui, 100) && state?.scrollTop === 3, 'a notch of the wheel scrolls three rows');
achievementsDialogKey(ui, 'ArrowUp');
check(state?.selected === 2 && state.scrollTop === 2, 'the up arrow selects the row above, the list scrolled to it');
achievementsDialogKey(ui, 'Escape');
check(dialogName() === undefined && ui.achievementsDialog === null && !a.game.ctx.state.paused, 'Esc closes it, and lets the clock run');

// 7. Across games.
console.log('=== across games ===');
const acrossDefs = setAchievementDefs(common, `# CSBweb achievements 1
[speedy-gonzales]
disabled

[t-two-games]
name: Two Games
text: Play two games for two seconds each.
when: games(playTime >= 2s) >= 2
`);
const acrossStore = memoryAchievementStore();
const twoSeconds = acrossDefs.find((def) => def.id === 't-two-games')!.games[0]!.key;
await acrossStore.raiseFigures({ dataSet: set.id, playthrough: 1, figures: { [twoSeconds]: 1, x: 3 } });
await acrossStore.raiseFigures({ dataSet: set.id, playthrough: 1, figures: { x: 2, y: 5 } });
const merged = (await acrossStore.figures(set.id))[0]?.figures;
check(JSON.stringify(merged) === JSON.stringify({ [twoSeconds]: 1, x: 3, y: 5 }), 'a playthrough\'s figures merge into one row, each key at the larger');
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
// A new game of the stand-in page draws the same id in a store of its own: each is given its own.
const across = async (playthrough: number, teleported: boolean) => {
  const built = await standInPage(set, files, memoryStore());
  const achievements = built.track(acrossDefs, acrossStore, touched);
  const shown: ShownUnlock[] = [];
  achievements.onShown((one) => shown.push(one));
  await settle();
  await built.saves.newGameRead();
  built.game.ctx.state.block1.randomGameID = playthrough;
  if (teleported) touched.add(playthrough);
  return { ...built, achievements, shown };
};
const played = await across(501, false);
run(played, 1000);
await played.achievements.settled();
const eRows = async () => (await acrossStore.list(set.id)).filter((r) => r.id === 't-two-games');
const eFigures = async () => (await acrossStore.figures(set.id)).find((r) => r.playthrough === played.achievements.playthrough)?.figures;
console.log(`  a second played: ${JSON.stringify(await eFigures())}`);
check((await eRows()).length === 0 && (await eFigures())?.[twoSeconds] === undefined, 'a game a second long meets nothing, and Two Games stays locked');
run(played, 1500);
await played.achievements.settled();
const unlockedRows = await eRows();
console.log(`  two and a half: ${JSON.stringify(await eFigures())}, rows ${unlockedRows.map((r) => r.playthrough).join()}`);
check((await eFigures())?.[twoSeconds] === 1, 'two seconds played meet the game\'s condition, in its figures');
check(unlockedRows.length === 1 && unlockedRows[0]!.playthrough === played.achievements.playthrough,
  'with the stored playthrough\'s, Two Games unlocks, a row of the playthrough playing');
check(played.shown.some((one) => one.def.id === 't-two-games') && played.achievements.view().unlocked.has('t-two-games'), 'it is shown, and the dialog has it unlocked');
check(!played.achievements.tracker.unlocked.has('t-two-games') && !played.achievements.tracker.unlocked.has(twoSeconds),
  'the game\'s history unlocks neither it nor the condition of one game');
const jumped = await across(502, true);
run(jumped, 2500);
await jumped.achievements.settled();
check(!(await acrossStore.figures(set.id)).some((r) => r.playthrough === jumped.achievements.playthrough), 'a teleported playthrough writes no figures');

finish();
