/**
 * RISE, the port's own button on Chaos Strikes Back's entrance: CSBWin's UTILITY →
 * "MAKE NEW ADVENTURE" (`DEBT.md` G17), a saved game's party carried into `mini.dat`
 * and the game started in it (`src/renderer/intro/PrisonDoor.ts`,
 * `GameSaves.makeNewAdventure`, the chooser's `rise` mode).
 *
 * 1. **The carving.** Graphic 4 of CSB's `graphics.dat`: each letter's 7x8 cell holds a
 *    whole letter of its label and nothing else, the columns either side and the rows
 *    above and below bare stone, and the gem's diamond touches the four sides of its
 *    14x14 square, bare stone outside each point. The carved entrance differs from
 *    graphic 4 only where RISE goes; RISE lies on the panel's side of the doors, which
 *    their animation never writes. Its rectangle holds its letters and its gem's centre,
 *    as RESUME's does, and is clear of the other three buttons.
 * 2. **The buttons.** RISE goes before the end of CSB's list and of DM's; a click on it
 *    is its id, and without it nothing.
 * 3. **The store.** A DM save, `csbgame7.dat`, made into an adventure: the `csb` set's
 *    row `csbgame7-csb.dat`, the file's playthrough, no time played, and the bytes
 *    `makeNewAdventure` makes on the same stream; made again, `csbgame7-csb-2.dat` of
 *    the same playthrough. The save with one bit of its dungeon flipped is refused with
 *    CSBWin's "SAVED GAME ERROR", and nothing is stored. `readFailed` keeps a refusal's
 *    message for the entrance, and anything else is a damaged read.
 * 4. **The chooser.** In `rise` mode it lists every data set's saves, and its LOAD makes
 *    the adventure from the chosen save and restores that; a refusal goes to
 *    `onRestoreFailed`, restores nothing, and the chooser closes for the entrance.
 * 5. **The refusal's menu.** A `UtilityDiskMessages` text as the menu's two titles.
 *
 * Run: `npx tsx tools/dump-rise.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { dataSetFor } from '../src/data/DataSets';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { OpenedSave, SaveEntry } from '../src/data/saves';
import { readSaveFileFields } from '../src/data/saves/SaveStore';
import { UtilityDiskMessages, UtilityError, makeNewAdventure } from '../src/engine/Chaos';
import { GameSaves } from '../src/engine/GameSaves';
import { utilityMenuTitles } from '../src/renderer/intro/BootSequence';
import {
  INTERIOR_VISIBLE_WIDTH,
  MISSING_PRISON_DOOR_BUTTONS,
  RISE_AT,
  RISE_BUTTON,
  RISE_BUTTON_ID,
  RISE_GEM_SIZE,
  RISE_GEM_SOURCE,
  RISE_LETTER_HEIGHT,
  RISE_LETTER_SOURCES,
  RISE_LETTER_WIDTH,
  carveRise,
  withRiseButton,
} from '../src/renderer/intro/PrisonDoor';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { searchButtonList } from '../src/renderer/ui/HitTest';
import { menuButtonRect } from '../src/renderer/ui/Menu';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import type { UIButton } from '../src/data/tables/UITables';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';
import { memoryStore, savePath } from './lib/saves';
import { newUIState } from './lib/ui';

const CSB = 'static/gamefiles/csb';
const STONE = 10;
const LEFT = 2;
const SEED = 0x13579bdf;
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const graphics = new GraphicsLoader();
graphics.loadFromArray(read(resolve(CSB, 'graphics.dat')));
const MINI = read(resolve(CSB, 'mini.dat'));
const CSBGAME2 = read(resolve(CSB, 'csbgame2.dat'));
const CSBGAME7 = read(savePath('csbgame7.dat'));
/** `dump-new-adventure.ts`'s damaged source: one bit of its dungeon flipped. */
const DAMAGED = CSBGAME7.slice();
DAMAGED[DAMAGED.length - 100] ^= 1;

function entranceOf(): IndexedBitmap {
  const image = graphics.getImage(4);
  return { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
}

/* ------------------------------------------------------------ 1. the carving ---- */

function checkCarving(): void {
  console.log('=== the carving, from graphic 4 of CSB ===');
  const entrance = entranceOf();
  const at = (x: number, y: number): number => entrance.pixels[y * entrance.width + x]!;
  check(entrance.width === 320 && entrance.height === 200, 'graphic 4 is the 320x200 entrance');

  RISE_LETTER_SOURCES.forEach((cell, i) => {
    let inked = 0;
    let bare = true;
    for (let y = -1; y <= RISE_LETTER_HEIGHT; y++) {
      for (let x = -1; x <= RISE_LETTER_WIDTH; x++) {
        const edge = x < 0 || y < 0 || x === RISE_LETTER_WIDTH || y === RISE_LETTER_HEIGHT;
        const pixel = at(cell.x + x, cell.y + y);
        if (edge && pixel !== STONE) bare = false;
        if (!edge && pixel !== STONE) inked++;
      }
    }
    console.log(`  ${'RISE'[i]} at (${cell.x},${cell.y}): ${inked} carved pixels, ${bare ? 'bare stone around' : 'NOT ALONE'}`);
    check(bare && inked > 0, `${'RISE'[i]}'s cell holds a whole letter and nothing else`);
  });

  const g = RISE_GEM_SOURCE;
  const last = RISE_GEM_SIZE - 1;
  const mid = [last >> 1, (last >> 1) + 1];
  const points = [
    ...mid.map((m) => ({ inside: [m, 0], outside: [m, -1] })),
    ...mid.map((m) => ({ inside: [m, last], outside: [m, last + 1] })),
    ...mid.map((m) => ({ inside: [0, m], outside: [-1, m] })),
    ...mid.map((m) => ({ inside: [last, m], outside: [last + 1, m] })),
  ];
  const touching = points.every(({ inside: [x, y], outside: [ox, oy] }) =>
    at(g.x + x!, g.y + y!) !== STONE && at(g.x + ox!, g.y + oy!) === STONE);
  console.log(`  the gem at (${g.x},${g.y}): its points ${touching ? 'on the square\'s sides, bare stone beyond' : 'NOT WHERE THEY SHOULD BE'}`);
  check(touching, 'RESUME\'s gem fills its 14x14 square, point to point');

  const carved = carveRise(entrance);
  const box = {
    x1: RISE_AT.x,
    x2: RISE_AT.x + 18 + 3 * 8 + RISE_LETTER_WIDTH - 1,
    y1: RISE_AT.y,
    y2: RISE_AT.y + RISE_GEM_SIZE - 1,
  };
  let changed = 0;
  let outside = 0;
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 320; x++) {
      if (carved.pixels[y * 320 + x] === at(x, y)) continue;
      changed++;
      if (x < box.x1 || x > box.x2 || y < box.y1 || y > box.y2) outside++;
    }
  }
  console.log(`  carved: ${changed} pixels changed, ${outside} outside (${box.x1},${box.y1})-(${box.x2},${box.y2})`);
  check(changed > 0 && outside === 0, 'the carving changes the entrance only where RISE goes');
  check(same(entranceOf().pixels, entrance.pixels), 'and leaves graphic 4 itself alone');
  check(box.x1 >= INTERIOR_VISIBLE_WIDTH, 'RISE is on the panel, which the doors\' animation never writes');

  // RESUME's rectangle starts a column right of its gem's left point
  // (`MISSING_PRISON_DOOR_BUTTONS[1]`), and RISE's stands to its gem as RESUME's does.
  const r = RISE_BUTTON;
  const inside = (x: number, y: number): boolean => x >= r.x1 && x < r.x2 && y >= r.y1 && y < r.y2;
  const letters = { x1: RISE_AT.x + 18, y1: RISE_AT.y + 3, y2: RISE_AT.y + 3 + RISE_LETTER_HEIGHT - 1 };
  const inRect = inside(letters.x1, letters.y1) && inside(box.x2, letters.y2)
    && inside(RISE_AT.x + (RISE_GEM_SIZE >> 1), RISE_AT.y + (RISE_GEM_SIZE >> 1));
  console.log(`  its rectangle (${r.x1},${r.y1})-(${r.x2},${r.y2}), exclusive: ${inRect ? 'around the letters and the gem\'s centre' : 'NOT AROUND THEM'}`);
  check(inRect, 'RISE\'s rectangle holds its letters and its gem\'s centre');
  const others = MISSING_PRISON_DOOR_BUTTONS.filter((b) => b.word0 !== 0);
  const clear = others.every((b) => r.x2 <= b.x1 || b.x2 <= r.x1 || r.y2 <= b.y1 || b.y2 <= r.y1);
  check(clear, 'and is clear of PRISON\'s, RESUME\'s and the scroll\'s');
}

/* ------------------------------------------------------------ 2. the buttons ---- */

function checkButtons(): void {
  console.log('');
  console.log('=== the buttons ===');
  const csb = graphicsTablesOf(graphics).ui.graphic231.buttons.buttons16932;
  const centre = { x: (RISE_BUTTON.x1 + RISE_BUTTON.x2) >> 1, y: (RISE_BUTTON.y1 + RISE_BUTTON.y2) >> 1 };
  for (const [name, list] of [['CSB\'s', csb], ['DM\'s', MISSING_PRISON_DOOR_BUTTONS]] as [string, UIButton[]][]) {
    const risen = withRiseButton(list);
    const ids = risen.map((b) => b.word0.toString(16)).join(' ');
    console.log(`  ${name}: ${ids}`);
    check(risen.length === list.length + 1 && risen[risen.length - 1]!.word0 === 0
      && risen[risen.length - 2]!.word0 === RISE_BUTTON_ID, `${name} list has RISE before its end`);
    check(searchButtonList(risen, centre.x, centre.y, LEFT) === RISE_BUTTON_ID, `a click on RISE is ${RISE_BUTTON_ID}`);
    check(searchButtonList(list, centre.x, centre.y, LEFT) === 0, 'and nothing on the list without it');
  }
  check(csb.length === 4, 'CSB\'s graphics.dat carries the entrance\'s list');
}

/* -------------------------------------------------------------- 3. the store ---- */

function row(id: string, dataSet: string, bytes: Uint8Array, usedAt: number): SaveEntry {
  return {
    id, name: id, dataSet, quick: false, savedAt: usedAt, usedAt, playTime: 1234, unofficial: false,
    ...readSaveFileFields(bytes)!,
  };
}

function newSaves(store: ReturnType<typeof memoryStore>, seed = SEED): GameSaves {
  return new GameSaves(newGame(emptyDungeonData(), graphics), dataSetFor('csb'), store,
    { portraitOf: () => undefined, repackOpenChest: () => {} }, () => {}, new CsbRandom(seed));
}

async function seeded(): Promise<ReturnType<typeof memoryStore>> {
  const store = memoryStore();
  await store.write(row('csbgame7.dat', 'dm-atari', CSBGAME7, 1000), CSBGAME7);
  await store.write(row('csbgame2.dat', 'csb', CSBGAME2, 2000), CSBGAME2);
  await store.write(row('damaged.dat', 'dm-atari', DAMAGED, 500), DAMAGED);
  return store;
}

async function checkStore(): Promise<void> {
  console.log('');
  console.log('=== the store ===');
  const store = await seeded();
  const saves = newSaves(store);
  const source = (await store.list(null)).find((e) => e.id === 'csbgame7.dat')!;

  const first = await saves.makeNewAdventure(source, MINI);
  const expected = makeNewAdventure(CSBGAME7, MINI, new CsbRandom(SEED));
  const e = first.entry;
  console.log(`  ${e.name}: set ${e.dataSet}, playthrough 0x${e.playthrough.toString(16)} (source 0x${source.playthrough.toString(16)}), level ${e.level}, ${e.champions.join('/')}, played ${e.playTime}`);
  check(e.name === 'csbgame7-csb.dat' && e.id === e.name, 'the row is named after its source, -csb before the .dat');
  check(e.dataSet === 'csb', 'and is a save of the csb set, whatever the source\'s');
  check(same(first.bytes, expected), 'its file is makeNewAdventure\'s, on the same stream');
  check(same(await store.read(e.id), expected), 'and is the one stored');
  check(e.playthrough === readSaveFileFields(expected)!.playthrough && e.playthrough !== source.playthrough,
    'its playthrough is the file\'s, the source\'s no longer');
  check(e.playTime === 0 && !e.unofficial && !e.quick, 'it counts no time played, and is no quick-save or modified dungeon');
  check(e.champions.join('/') === source.champions.join('/'), 'and has the source\'s party');

  const again = await newSaves(store).makeNewAdventure(source, MINI);
  console.log(`  again: ${again.entry.name}, playthrough 0x${again.entry.playthrough.toString(16)}`);
  check(again.entry.name === 'csbgame7-csb-2.dat', 'made again, the name takes a number');
  check(again.entry.playthrough === e.playthrough, 'and the same playthrough, as CSBWin writes the same id twice');

  const before = (await store.list(null)).length;
  const damaged = (await store.list(null)).find((x) => x.id === 'damaged.dat')!;
  let refusal: unknown = null;
  try {
    await saves.makeNewAdventure(damaged, MINI);
  } catch (error) {
    refusal = error;
  }
  const message = refusal instanceof Error ? refusal.message : String(refusal);
  console.log(`  damaged.dat: ${JSON.stringify(message)}`);
  check(refusal instanceof UtilityError && message === UtilityDiskMessages[14], 'a damaged source is refused: SAVED GAME ERROR');
  check((await store.list(null)).length === before, 'and nothing is stored');

  saves.readFailed(refusal);
  const kept = saves.consumeSavedGameRead();
  check(typeof kept === 'object' && kept.refused === UtilityDiskMessages[14], 'readFailed keeps a refusal\'s message for the entrance');
  saves.readFailed(new Error('checksum'));
  check(saves.consumeSavedGameRead() === 'damaged', 'and anything else is a damaged read');
}

/* ------------------------------------------------------------ 4. the chooser ---- */

async function checkChooser(): Promise<void> {
  console.log('');
  console.log('=== the chooser in rise mode ===');
  const run = async (sourceId: string) => {
    const store = await seeded();
    const saves = newSaves(store);
    const game = newGame(emptyDungeonData(), graphics);
    const log: string[] = [];
    const ui = newUIState(graphics, game.ctx, {
      onListSaves: async () => { log.push('list'); return saves.list(); },
      onListEverySave: async () => { log.push('list every'); return saves.listEverySet(); },
      onMakeNewAdventure: async (source) => { log.push(`make ${source.name}`); return saves.makeNewAdventure(source, MINI); },
      onRestoreSave: (save: OpenedSave) => { log.push(`restore ${save.entry.name}`); },
      onRestoreFailed: (error) => { log.push(`failed ${JSON.stringify((error as Error).message)}`); },
    });
    ui.partyState = game.ctx.party.state;
    const settled = async (): Promise<void> => {
      for (let i = 0; i < 300 && ui.saveMenu && (ui.saveMenu.busy || ui.saveMenu.press); i++) {
        await new Promise((done) => setTimeout(done, 10));
      }
    };
    SaveMenu.openSaveMenu(ui, 'rise');
    await settled();
    const state = ui.saveMenu!;
    const listed = state.entries.map((x) => `${x.name} (${x.dataSet})`).join(', ');
    // The save's own row, its heading clicked first when its playthrough is folded.
    const g = SaveMenu.SAVE_MENU_GEOMETRY;
    const clickRow = (i: number): void => SaveMenu.saveMenuClick(ui, g.textX, g.rowFirstY + (i - state.scrollTop) * g.rowStep, LEFT);
    const rowOf = (): number => state.rows.findIndex((r) => r.kind === 'save' && r.entry.id === sourceId);
    const playthrough = state.entries.find((x) => x.id === sourceId)!.playthrough;
    if (rowOf() < 0) clickRow(state.rows.findIndex((r) => r.kind === 'heading' && r.playthrough.id === playthrough));
    clickRow(rowOf());
    const rect = menuButtonRect(SaveMenu.saveMenuButtons(state), SaveMenu.SAVE_MENU_GEOMETRY.loadButtonId)!;
    SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
    await settled();
    return { listed, log, open: SaveMenu.isSaveMenuOpen(ui), stored: (await store.list(null)).map((x) => x.name) };
  };

  const good = await run('csbgame7.dat');
  console.log(`  listed: ${good.listed}`);
  console.log(`  csbgame7.dat: ${good.log.join(', ')}; the chooser ${good.open ? 'OPEN' : 'closed'}`);
  check(good.listed.includes('dm-atari') && good.listed.includes('(csb)'), 'it lists every data set\'s saves');
  check(good.log[0] === 'list every' && !good.log.includes('list'), 'through onListEverySave, not onListSaves');
  check(good.log.slice(1).join(', ') === 'make csbgame7.dat, restore csbgame7-csb.dat' && !good.open,
    'LOAD makes the adventure and restores it, and the chooser closes');
  check(good.stored.includes('csbgame7-csb.dat'), 'the adventure is stored');

  const refused = await run('damaged.dat');
  console.log(`  damaged.dat: ${refused.log.join(', ')}; the chooser ${refused.open ? 'OPEN' : 'closed'}`);
  check(refused.log.slice(1).join(', ') === `make damaged.dat, failed ${JSON.stringify(UtilityDiskMessages[14])}` && !refused.open,
    'a refusal goes to onRestoreFailed, nothing is restored, and the chooser closes');
}

/* ------------------------------------------------------- 5. the refusal's menu ---- */

function checkTitles(): void {
  console.log('');
  console.log('=== the refusal\'s titles ===');
  const want: Record<number, [string, string | null]> = {
    14: ['SAVED GAME ERROR', null],
    20: ['EACH CHAMPION MUST', 'HAVE A UNIQUE FIRST NAME!'],
    24: ['CAN\'T FIND', 'NEW ADVENTURE MINI.DAT'],
    30: ['CAN\'T MAKE NEW ADVENTURE', 'FROM THIS SAVED GAME. ALREADY UTILIZED.'],
  };
  for (const [n, titles] of Object.entries(want)) {
    const got = utilityMenuTitles(UtilityDiskMessages[Number(n) as keyof typeof UtilityDiskMessages]);
    console.log(`  ${n}: ${JSON.stringify(got)}`);
    check(got[0] === titles[0] && got[1] === titles[1], `message ${n}: its first line, then the rest`);
  }
}

async function main(): Promise<void> {
  checkCarving();
  checkButtons();
  await checkStore();
  await checkChooser();
  checkTitles();
  finish();
}

void main();
