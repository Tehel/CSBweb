/**
 * The Sleepsave (`GameSaves.sleepSave`, `doc/SAVES.md` → "The Sleepsave"): the port's
 * own, a playthrough's slot apart from F5's, written when the party lies down and written
 * over when the player wakes it, never when a blow does. On `csbgame7.dat`, a genuine
 * save, over the Atari Dungeon Master's dungeon, against a store in memory.
 *
 * 1. **The row**: `slotOf` finds each slot apart, the row reads "SLEEPSAVE", and a
 *    stored row from before rows held the flag is no Sleepsave.
 * 2. **The slot**: two Sleepsaves are one row, written over; F5's slot and the
 *    Sleepsave never touch each other; the menu's SAVE over the Sleepsave makes it the
 *    menu's, and the next Sleepsave a row of its own; F9 loads it when it is newest.
 * 3. **Silent**: nothing in the message area, written, refused or failed; refused with
 *    no party, a champion being chosen, a script running, saves disabled, and in CSB's
 *    prison, with no row written and the save's tail not run.
 * 4. **Who asks for it**: the sleep icon, button 145, and the wake click, button 146,
 *    raise `UIState.sleepSaveNeeded`; a blow's `WakeUp` and a refused sleep do not.
 *
 * Run: `npm test -- --only=sleep-save.ts`
 */
import { readFileSync } from 'node:fs';

import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { formatSaveRow, saveEntryOf, slotOf, type SaveEntry, type StoredSaveEntry } from '../../src/data/saves/SaveStore';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import type { MessageSink } from '../../src/engine/GameHost';
import { GameSaves, PRISON_WORD22592 } from '../../src/engine/GameSaves';
import type { LoopScript } from '../../src/engine/LoopState';
import { wakeUp } from '../../src/engine/MouseSystem';
import { handleMouseButton } from '../../src/renderer/ui/Mouse';
import { DEFAULT_DATA_SET, dataSetNamed, diskFiles } from '../lib/dataSets';
import { check, finish } from '../lib/check';
import { newGame } from '../lib/game';
import { memoryStore, savePath } from '../lib/saves';
import { newUIState } from '../lib/ui';

const ATARI = 'tools/fixtures/gamefiles/dm-atari';
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(`${ATARI}/graphics.dat`)));
const dungeon = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${ATARI}/dungeon.dat`)));

/** What reached the message area, every line of every game. */
const told: string[] = [];
const messages: MessageSink = {
  printLinefeed: () => { told.push('\n'); },
  quePrintLines: (color, text) => { told.push(`${color}:${text}`); },
  printLines: () => {},
  setNewSpeed: () => {},
  resetTime: () => {},
  clockTick: () => {},
  printNextQueued: () => {},
  vblInterrupt: () => {},
  discardText: () => {},
};

/** `csbgame7.dat` read into a new game, with its saves over `store` and the console's lines. */
function stage(store = memoryStore(), dataSet = DEFAULT_DATA_SET) {
  const game: Game = newGame(dungeon, graphics, { messages });
  applyCsbwinSave(game, new Uint8Array(readFileSync(savePath('csbgame7.dat'))));
  const reports: string[] = [];
  const saves = new GameSaves(game, dataSet, diskFiles(dataSet), store, { portraitOf: () => undefined },
    (message) => { reports.push(message); });
  return { game, store, saves, reports };
}

function entry(over: Partial<SaveEntry>): SaveEntry {
  return {
    id: 'x', name: 'x', dataSet: DEFAULT_DATA_SET.id, playthrough: 7, quick: false, sleep: false,
    savedAt: 0, usedAt: 0, playTime: 0, level: 0, champions: [], unofficial: false, ...over,
  };
}

function checkRow(): void {
  console.log('=== the row ===');
  const rows = [
    entry({ name: 'menu', savedAt: 900 }),
    entry({ name: 'quick', quick: true, savedAt: 100 }),
    entry({ name: 'sleep, older', sleep: true, savedAt: 200 }),
    entry({ name: 'sleep, newer', sleep: true, savedAt: 300 }),
    entry({ name: 'sleep, another playthrough', sleep: true, playthrough: 9, savedAt: 400 }),
    entry({ name: 'sleep, another set', sleep: true, dataSet: 'csb', savedAt: 500 }),
  ];
  const name = (slot: 'quick' | 'sleep', dataSet: string, playthrough: number): string =>
    slotOf(rows, slot, dataSet, playthrough)?.name ?? 'none';
  console.log(`  playthrough 7: F5's "${name('quick', DEFAULT_DATA_SET.id, 7)}", the Sleepsave "${name('sleep', DEFAULT_DATA_SET.id, 7)}"; `
    + `9 "${name('sleep', DEFAULT_DATA_SET.id, 9)}", 7 in csb "${name('sleep', 'csb', 7)}", 8 "${name('sleep', DEFAULT_DATA_SET.id, 8)}"`);
  check(name('quick', DEFAULT_DATA_SET.id, 7) === 'quick' && name('sleep', DEFAULT_DATA_SET.id, 7) === 'sleep, newer',
    'each slot is the playthrough\'s newest row of its own kind, never the other\'s nor the menu\'s');
  check(name('sleep', DEFAULT_DATA_SET.id, 9) === 'sleep, another playthrough' && name('sleep', 'csb', 7) === 'sleep, another set'
    && name('sleep', DEFAULT_DATA_SET.id, 8) === 'none', 'one Sleepsave per playthrough, in its own data set, and none before the first');

  const afternoon = new Date(2026, 8, 13, 14, 5).getTime();
  const row = formatSaveRow(entry({ sleep: true, savedAt: afternoon, level: 14 }));
  console.log(`  "${row}"`);
  check(row === '  2026-09-13 14:05 L14 SLEEPSAVE' && row.length <= 32, 'the Sleepsave\'s row reads SLEEPSAVE, as F5\'s reads QUICKSAVE, and fits');

  const stored: StoredSaveEntry = {
    id: 'old', name: 'old', dataSet: DEFAULT_DATA_SET.id, playthrough: 7, quick: false,
    savedAt: 1, level: 1, champions: [],
  };
  check(saveEntryOf(stored).sleep === false, 'a stored row from before rows held the flag is no Sleepsave');
}

async function checkSlot(): Promise<void> {
  console.log('');
  console.log('=== the slot ===');
  const realNow = Date.now;
  let now = Date.UTC(2026, 8, 13, 14, 5, 6);
  Date.now = () => now;
  try {
    const s = stage();
    const toldBefore = told.length;
    await s.saves.sleepSave();
    now += 60_000;
    await s.saves.sleepSave();
    const rows = await s.saves.list();
    console.log(`  two Sleepsaves: ${rows.length} row, sleep ${rows[0]?.sleep}, quick ${rows[0]?.quick}, saved at ${rows[0]?.savedAt === now ? 'the second' : 'THE FIRST'}`);
    check(rows.length === 1 && rows[0]!.sleep && !rows[0]!.quick && rows[0]!.savedAt === now,
      'the second Sleepsave writes over the first, under its key and its name');
    const sleepRow = rows[0]!;
    check(s.game.canRestartFromSavegame(), 'the save\'s tail runs, as F5\'s does');

    now += 60_000;
    await s.saves.quickSave();
    now += 60_000;
    await s.saves.sleepSave();
    now += 60_000;
    await s.saves.quickSave();
    const both = await s.saves.list();
    const quick = both.filter((row) => row.quick);
    const sleep = both.filter((row) => row.sleep);
    console.log(`  F5, Sleepsave, F5: ${both.length} rows, ${quick.length} quick-save, ${sleep.length} Sleepsave, the Sleepsave ${sleep[0]?.id === sleepRow.id ? 'the same row' : 'ANOTHER ROW'}`);
    check(both.length === 2 && quick.length === 1 && sleep.length === 1 && sleep[0]!.id === sleepRow.id
      && sleep[0]!.savedAt === now - 60_000, 'F5\'s slot and the Sleepsave are written over apart, neither touching the other');

    const f9 = stage(s.store);
    now += 60_000;
    await s.saves.sleepSave();
    const f9Before = told.length;
    await f9.saves.quickLoad();
    const loaded = f9.reports[f9.reports.length - 1] ?? '';
    console.log(`  F9 with the Sleepsave newest: ${loaded}`);
    check(loaded === `Quick-loaded ${sleepRow.name}` && told.slice(f9Before).join('') === '\n15:GAME LOADED',
      'F9 loads the playthrough\'s newest save, the Sleepsave when it is newest');
    told.splice(f9Before);

    now += 60_000;
    const overSleep = await s.saves.save('stopped', (await s.saves.list()).find((row) => row.sleep)!);
    now += 60_000;
    await s.saves.sleepSave();
    const after = await s.saves.list();
    const nextSleep = after.find((row) => row.sleep)!;
    console.log(`  SAVE over the Sleepsave: ${overSleep.id === sleepRow.id ? 'the same row' : 'ANOTHER ROW'}, sleep ${overSleep.sleep}; the next Sleepsave ${nextSleep.id === sleepRow.id ? 'THE SAME ROW' : 'a row of its own'}, ${after.length} rows`);
    check(overSleep.id === sleepRow.id && !overSleep.sleep && nextSleep.id !== sleepRow.id && after.length === 3,
      'a Sleepsave the menu\'s SAVE writes over is the menu\'s, and the next Sleepsave makes another');

    console.log(`  for the console: ${s.reports.filter((r) => r.startsWith('Sleep')).join(' | ')}`);
    check(s.reports.filter((r) => r.startsWith('Sleepsaved ')).length === 5, 'each Sleepsave is a line for the console');
    const sleepLines = told.slice(toldBefore).join('').split('\n').filter((line) => line !== '');
    check(sleepLines.every((line) => line === '15:GAME SAVED') && sleepLines.length === 2,
      'and the message area has F5\'s two lines alone: the Sleepsave says nothing there');
  } finally {
    Date.now = realNow;
  }
}

async function checkSilentRefusals(): Promise<void> {
  console.log('');
  console.log('=== refused, silently ===');
  const before = told.length;
  const refused = async (what: string, set: (s: ReturnType<typeof stage>) => void, dataSet = DEFAULT_DATA_SET): Promise<void> => {
    const s = stage(memoryStore(), dataSet);
    set(s);
    await s.saves.sleepSave();
    const rows = s.store.files.size;
    console.log(`  ${what}: ${rows} row, tail run ${s.game.canRestartFromSavegame()}, console "${s.reports.join(' | ')}"`);
    check(rows === 0 && !s.game.canRestartFromSavegame() && s.reports.length === 1 && s.reports[0]!.startsWith('Sleepsave skipped'),
      `no Sleepsave ${what}, and a line for the console alone`);
  };
  await refused('with no party', (s) => { s.game.ctx.party.state.champions = []; });
  await refused('with a champion being chosen', (s) => { s.game.ctx.party.state.potentialChampionIndex = 0; });
  await refused('while a script holds the loop', (s) => {
    function* hold(): LoopScript {
      for (;;) yield 1;
    }
    s.game.runScript(hold());
  });
  await refused('while a DSA has disabled saves', (s) => { s.game.systems.dsa.disableSaves = true; });
  await refused('in CSB\'s prison', (s) => { s.game.ctx.state.block1.word22592 = PRISON_WORD22592; }, dataSetNamed('csb'));

  const failing = stage(memoryStore(() => {}, true));
  await failing.saves.sleepSave();
  console.log(`  where the store cannot be written: console "${failing.reports.join(' | ')}"`);
  check(failing.reports.length === 1 && failing.reports[0] === 'Sleepsave failed', 'a write that fails is a line for the console');
  check(told.length === before, 'none of them says anything in the message area');
}

function checkWhoAsks(): void {
  console.log('');
  console.log('=== who asks for it ===');
  const s = stage();
  const ui = newUIState(graphics, s.game.ctx);
  const party = s.game.ctx.party.state;

  handleMouseButton(ui, 145, 0, 0);
  const lieDown = ui.sleepSaveNeeded;
  console.log(`  button 145: sleeping ${party.sleeping}, Sleepsave asked ${lieDown}`);
  check(party.sleeping && lieDown, 'the sleep icon puts the party to sleep and asks for the Sleepsave');

  ui.sleepSaveNeeded = false;
  handleMouseButton(ui, 146, 0, 0);
  const wake = ui.sleepSaveNeeded;
  console.log(`  button 146: sleeping ${party.sleeping}, Sleepsave asked ${wake}`);
  check(!party.sleeping && wake, 'the player\'s wake click wakes it and asks for the Sleepsave');

  handleMouseButton(ui, 145, 0, 0);
  ui.sleepSaveNeeded = false;
  // What a blow on a sleeping party calls (`MonsterAttack`, `Monster.cpp:4544`,
  // `Character.cpp:2816`), outside the interface.
  wakeUp(s.game.ctx);
  console.log(`  a blow's WakeUp: sleeping ${party.sleeping}, Sleepsave asked ${ui.sleepSaveNeeded}`);
  check(!party.sleeping && !ui.sleepSaveNeeded, 'a blow wakes the party and asks for nothing');

  party.potentialChampionIndex = 0;
  handleMouseButton(ui, 145, 0, 0);
  console.log(`  button 145 with a champion being chosen: sleeping ${party.sleeping}, Sleepsave asked ${ui.sleepSaveNeeded}`);
  check(!party.sleeping && !ui.sleepSaveNeeded, 'a sleep refused asks for nothing');
}

async function main(): Promise<void> {
  checkRow();
  await checkSlot();
  await checkSilentRefusals();
  checkWhoAsks();
  finish();
}

void main();
