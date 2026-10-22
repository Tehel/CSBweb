/**
 * RISE, the port's own button on Chaos Strikes Back's entrance: CSBWin's UTILITY →
 * "MAKE NEW ADVENTURE" (`doc/SAVES.md` → "RISE makes a save of its own"), a saved game's party carried into `mini.dat`
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
 * 6. **The prison's shortcut.** CSB's `dungeon.dat` is the prison, its `Word22592` 12,
 *    and the csb set's game in it is the prison, and no other. Four champions recruited
 *    through its mirrors, the fourth reincarnated: only the fourth asks "BEGIN THE
 *    ADVENTURE?", with a quick-save to write first, and the save of that party is one
 *    the utility takes. F5 there asks about its save. In the dialog, NOT YET closes the
 *    one raised for the question; YES writes F5's save, makes the adventure from it and
 *    restores that. The disk menu's SAVE asks in the prison, NOT YET goes back to the
 *    list, and YES makes the adventure from the save just written; outside the prison
 *    SAVE asks nothing.
 * 7. **NEW FACE.** `utility-portraits.dat` holds the utility disk's faces and, as its
 *    item 1, DM's graphic 26. `csbgame7.dat` raised with them: each champion has the
 *    file's cell for the cell of graphic 26 their portrait is, under the same name and
 *    title, and every other byte of the adventure is the one without them, which is
 *    `makeNewAdventure`'s as ever. `csbgame-early-2hero-renamed.dat`'s renamed champion
 *    is known by their portrait, and keeps the new name. The prison's four, CSB's own
 *    faces, keep their portraits either way. A file that does not read, or a read that
 *    fails, gives no portraits, and no toggle, where it would empty RISE's list
 *    (`readUtilityPortraits`).
 *
 * Run: `npm test -- --only=dump-rise.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CsbRandom } from '../src/core/random';
import { Direction, Position } from '../src/core/types';
import { DungeonLoader, emptyDungeonData } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { OpenedSave, SaveEntry } from '../src/data/saves';
import { readSaveFileFields } from '../src/data/saves/SaveStore';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, readCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { UTILITY_PORTRAITS_FILE, UtilityPortraits, readUtilityPortraits } from '../src/data/UtilityPortraits';
import { ReadSavedGame, UtilityDiskMessages, UtilityError, makeNewAdventure, type UtilityGame } from '../src/engine/Chaos';
import type { Game } from '../src/engine/Game';
import type { Champion } from '../src/engine/gameTypes';
import { GameSaves, PRISON_WORD22592 } from '../src/engine/GameSaves';
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
import { menuButtonList, menuButtonRect } from '../src/renderer/ui/Menu';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import type { UIButton } from '../src/data/tables/UITables';
import { dataSetNamed, diskFiles } from './lib/dataSets';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, presetHeroesOf, stockDungeon, stockGraphics } from './lib/game';
import { memoryStore, savePath } from './lib/saves';
import { newUIState } from './lib/ui';

const CSB = 'tools/fixtures/gamefiles/csb';
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
    id, name: id, dataSet, quick: false, sleep: false, savedAt: usedAt, usedAt, playTime: 1234, unofficial: false,
    ...readSaveFileFields(bytes)!,
  };
}

function newSaves(store: ReturnType<typeof memoryStore>, seed = SEED): GameSaves {
  return new GameSaves(newGame(emptyDungeonData(), graphics), dataSetNamed('csb'), diskFiles(dataSetNamed('csb')), store,
    { portraitOf: () => undefined }, () => {}, new CsbRandom(seed));
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
    const { rowFirstY } = SaveMenu.saveMenuList('rise');
    const clickRow = (i: number): void => SaveMenu.saveMenuClick(ui, g.textX, rowFirstY + (i - state.scrollTop) * g.rowStep, LEFT);
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

/* ---------------------------------------------------- 6. the prison's shortcut ---- */

const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];
const RESURRECT = 160;
const REINCARNATE = 161;
const PRISON = new DungeonLoader().loadDungeonDat(read(resolve(CSB, 'dungeon.dat')));
/** Its mirrors' heroes, read before any game plays on it: a recruit disables a mirror. */
const PRISON_HEROES = presetHeroesOf(PRISON, graphics);

/** A save's name as printed: its date is the wall clock's, which would make the output vary. */
const undated = (text: string): string => text.replace(/csbweb-\d{8}-\d{6}(-\d+)?/g, 'csbweb-<date>');

/** The prison's game, under `dataSet`, its saves in `store`, and what asked the question. */
function prisonGame(
  store: ReturnType<typeof memoryStore>, dataSet = 'csb', portraitOf: (champion: Champion) => number[] | undefined = () => undefined,
) {
  const asked: Array<string | null> = [];
  let saves: GameSaves | null = null;
  // Its own copy of the prison: a champion recruited empties their mirror in the data.
  const prison = new DungeonLoader().loadDungeonDat(read(resolve(CSB, 'dungeon.dat')));
  const game: Game = newGame(prison, graphics, { championJoined: () => saves?.championJoined() });
  game.setRandomSeed(SEED);
  saves = new GameSaves(game, dataSetNamed(dataSet), diskFiles(dataSetNamed(dataSet)), store, {
    portraitOf,
    askBeginAdventure: (source) => { asked.push(source?.name ?? null); },
  }, () => {}, new CsbRandom(SEED));
  return { game, saves, asked };
}

/** A champion from the prison's mirror of `hero`, the party stood before it: resurrected, or reincarnated as `name`. */
function recruit(game: Game, hero: number, name?: string): void {
  const h = PRISON_HEROES[hero]!;
  const facing = (h.location.wall + 2) & 3;
  const party = game.ctx.party.state;
  party.position = new Position(h.location.x - DELTA_X[facing]!, h.location.y - DELTA_Y[facing]!, h.location.map);
  party.facing = facing as Direction;
  game.systems.mouse.handleWallClick();
  if (!name) {
    game.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);
    return;
  }
  game.systems.hallOfChampions.resurrectReincarnateCancel(REINCARNATE);
  game.systems.hallOfChampions.reincarnateNamed(party.champions.length - 1, name, '');
}

async function checkPrison(): Promise<void> {
  console.log('');
  console.log('=== the prison\'s shortcut ===');
  const store = memoryStore();
  const { game, saves, asked } = prisonGame(store);
  console.log(`  CSB's dungeon.dat: Word22592 ${PRISON.word22592}, ${PRISON_HEROES.length} mirrors`);
  check(PRISON.word22592 === PRISON_WORD22592 && game.ctx.state.block1.word22592 === PRISON_WORD22592,
    'the prison\'s game has the compressed dungeon.dat\'s Word22592, 12');
  check(saves.inPrison(), 'and is the prison, in the csb set');
  check(!prisonGame(memoryStore(), 'dm-atari').saves.inPrison(), 'not in a set with no mini.dat');
  check(!newSaves(memoryStore()).inPrison(), 'and a game whose Word22592 is 13 is not');

  const joined: number[] = [];
  for (let i = 0; i < 3; i++) {
    recruit(game, i);
    joined.push(asked.length);
  }
  recruit(game, 3, 'RISEN');
  const party = game.ctx.party.state;
  console.log(`  joined: ${party.champions.map((c) => c.name).join('/')}; asked after each: ${[...joined, asked.length].join(' ')}, with ${JSON.stringify(asked)}`);
  check(party.champions.length === 4 && party.potentialChampionIndex < 0, 'four champions joined through the mirrors');
  check(joined.every((n) => n === 0), 'the first three ask nothing');
  check(asked.length === 1 && asked[0] === null, 'the fourth, reincarnated, asks, with a quick-save to write first');

  const prisonSave = await saves.save('running', 'quick');
  const adventure = await saves.makeNewAdventure(prisonSave, MINI);
  const fields = readSaveFileFields(adventure.bytes)!;
  console.log(undated(`  ${prisonSave.name} (${prisonSave.champions.join('/')}) -> ${adventure.entry.name}, level ${fields.level}, ${fields.champions.join('/')}`));
  check(adventure.entry.name === prisonSave.name.replace(/\.dat$/, '-csb.dat'), 'the prison\'s save makes an adventure: the utility takes it');
  check(fields.champions.join('/') === prisonSave.champions.join('/'), 'with the prison\'s party');

  asked.length = 0;
  await saves.quickSave();
  console.log(undated(`  F5 in the prison asks with ${JSON.stringify(asked)}`));
  check(asked.length === 1 && asked[0] === prisonSave.name, 'F5 in the prison asks about the save it wrote');

  // The dialog, over the same game.
  const log: string[] = [];
  const ui = newUIState(graphics, game.ctx, {
    onListSaves: async () => saves.list(),
    onSaveGame: async (over) => { const e = await saves.save('stopped', over ?? 'new'); log.push(`save ${e.name}`); return e; },
    isPrison: () => saves.inPrison(),
    onMakeNewAdventure: async (source) => { log.push(`make ${source.name}`); return saves.makeNewAdventure(source, MINI); },
    onRestoreSave: (save: OpenedSave) => { log.push(`restore ${save.entry.name}`); },
  });
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 300 && ui.saveMenu && (ui.saveMenu.busy || ui.saveMenu.press); i++) {
      await new Promise((done) => setTimeout(done, 10));
    }
  };
  const answer = async (choice: 1 | 2): Promise<void> => {
    const rect = menuButtonRect(menuButtonList(ui, 2, true), 209 + choice)!;
    SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
    await settled();
  };
  const pressSave = async (): Promise<void> => {
    const state = ui.saveMenu!;
    state.selected = state.rows.findIndex((r) => r.kind === 'heading' && r.playthrough.id === game.ctx.state.block1.randomGameID);
    const rect = menuButtonRect(SaveMenu.saveMenuButtons(state), SaveMenu.SAVE_MENU_GEOMETRY.saveButtonId)!;
    SaveMenu.saveMenuClick(ui, rect.x1 + 1, rect.y1 + 1, LEFT);
    await settled();
  };

  SaveMenu.askBeginAdventure(ui, null);
  await settled();
  const up = ui.saveMenu?.adventure;
  SaveMenu.drawSaveMenu(ui);
  await answer(2);
  console.log(`  alone, NOT YET: the dialog ${SaveMenu.isSaveMenuOpen(ui) ? 'OPEN' : 'closed'}, ${log.length} actions`);
  check(up?.source === null && up.alone, 'the question raised alone, with a quick-save to write first');
  check(!SaveMenu.isSaveMenuOpen(ui) && log.length === 0 && !game.ctx.state.paused, 'NOT YET closes it, having done nothing, and the clock runs');

  SaveMenu.askBeginAdventure(ui, null);
  await settled();
  await answer(1);
  console.log(undated(`  alone, YES: ${log.join(', ')}; the dialog ${SaveMenu.isSaveMenuOpen(ui) ? 'OPEN' : 'closed'}`));
  check(log.join(', ') === `save ${prisonSave.name}, make ${prisonSave.name}, restore ${prisonSave.name.replace(/\.dat$/, '-csb-2.dat')}`
    && !SaveMenu.isSaveMenuOpen(ui), 'YES writes F5\'s save, makes the adventure from it and restores it');

  log.length = 0;
  SaveMenu.openSaveMenu(ui);
  await settled();
  await pressSave();
  const saved = log[0]?.slice('save '.length);
  const asks = ui.saveMenu?.adventure;
  await answer(2);
  console.log(undated(`  SAVE: ${log.join(', ')}; NOT YET: the dialog ${SaveMenu.isSaveMenuOpen(ui) ? `open, ${JSON.stringify(ui.saveMenu!.message)}` : 'CLOSED'}`));
  check(asks?.source?.name === saved && !asks.alone, 'the disk menu\'s SAVE in the prison asks about the save it wrote');
  check(SaveMenu.isSaveMenuOpen(ui) && !ui.saveMenu!.adventure && ui.saveMenu!.message === 'GAME SAVED', 'NOT YET goes back to the list');
  log.length = 0;
  await pressSave();
  await answer(1);
  console.log(undated(`  SAVE, YES: ${log.join(', ')}`));
  const second = log[0]?.slice('save '.length) ?? '';
  check(log.length === 3 && log[1] === `make ${second}` && log[2] === `restore ${second.replace(/\.dat$/, '-csb.dat')}`
    && !SaveMenu.isSaveMenuOpen(ui), 'YES makes the adventure from that save and restores it');

  const dm = prisonGame(memoryStore(), 'dm-atari');
  const dmUi = newUIState(graphics, dm.game.ctx, {
    onListSaves: async () => dm.saves.list(),
    onSaveGame: async (over) => dm.saves.save('stopped', over ?? 'new'),
    isPrison: () => dm.saves.inPrison(),
  });
  SaveMenu.openSaveMenu(dmUi);
  for (let i = 0; i < 300 && dmUi.saveMenu!.busy; i++) await new Promise((done) => setTimeout(done, 10));
  const newRow = dmUi.saveMenu!.rows.findIndex((r) => r.kind === 'new');
  dmUi.saveMenu!.selected = newRow;
  dm.game.ctx.party.state.champions.push(...party.champions.slice(0, 1));
  const rect = menuButtonRect(SaveMenu.saveMenuButtons(dmUi.saveMenu!), SaveMenu.SAVE_MENU_GEOMETRY.saveButtonId)!;
  SaveMenu.saveMenuClick(dmUi, rect.x1 + 1, rect.y1 + 1, LEFT);
  for (let i = 0; i < 300 && (dmUi.saveMenu!.busy || dmUi.saveMenu!.press); i++) await new Promise((done) => setTimeout(done, 10));
  console.log(`  outside the prison, SAVE: ${JSON.stringify(dmUi.saveMenu!.message)}, ${dmUi.saveMenu!.adventure ? 'ASKS' : 'asks nothing'}`);
  check(dmUi.saveMenu!.message === 'GAME SAVED' && !dmUi.saveMenu!.adventure, 'outside the prison SAVE asks nothing');
}

/* ------------------------------------------------------------- 7. NEW FACE ---- */

const PORTRAIT_OFFSET = 336;
const PORTRAIT_END = 800;

/** Cell `charID` of a sheet laid out like graphic 26. */
function cellOf(sheet: { width: number; pixels: Uint8Array }, charID: number): number[] {
  const cell: number[] = [];
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let x = 0; x < PORTRAIT_WIDTH; x++) {
      cell.push(sheet.pixels[((charID >> 3) * PORTRAIT_HEIGHT + y) * sheet.width + ((charID & 7) << 5) + x]!);
    }
  }
  return cell;
}

/** A save's champions: name, title, and their portrait's pixels. */
function championsOf(game: UtilityGame): { name: string; title: string; portrait: string }[] {
  const out = [];
  for (let i = 0; i < readU16(game.block2, 10); i++) {
    const { champion } = readCsbwinCharacter(game.characters, i);
    out.push({ name: champion.name, title: champion.title, portrait: (champion.portrait ?? []).join() });
  }
  return out;
}

function readU16(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

/**
 * Where two adventures' records differ, as `block:offset` ranges: a portrait's 464 bytes
 * are `characters:<champion>.portrait`.
 */
function differences(a: UtilityGame, b: UtilityGame): string[] {
  const out = new Set<string>();
  for (const block of ['block1', 'block2', 'item16', 'characters', 'timers', 'timerQueue', 'image'] as const) {
    const x = a[block];
    const y = b[block];
    if (x.length !== y.length) out.add(`${block}:length`);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      const champion = Math.floor(i / CHARDESC_SIZE);
      const inPortrait = block === 'characters' && champion < 4 && i % CHARDESC_SIZE >= PORTRAIT_OFFSET && i % CHARDESC_SIZE < PORTRAIT_END;
      out.add(inPortrait ? `characters:${champion}.portrait` : `${block}:${i}`);
    }
  }
  return [...out];
}

function checkNewFaces(): UtilityPortraits {
  console.log('');
  console.log('=== NEW FACE ===');
  const file = new GraphicsLoader();
  file.loadFromArray(read(resolve(CSB, UTILITY_PORTRAITS_FILE)));
  const portraits = new UtilityPortraits(file);
  const newFaces = file.getImage(0);
  const dm26 = stockGraphics().getImage(26);
  const reference = file.getImage(1);
  console.log(`  ${UTILITY_PORTRAITS_FILE}: ${file.getItemCount()} items, ${newFaces.width}x${newFaces.height} and ${reference.width}x${reference.height}`);
  check(file.getItemCount() === 2 && reference.width === dm26.width && reference.height === dm26.height
    && reference.pixels.every((p, i) => p === dm26.pixels[i]), 'its item 1 is DM\'s graphic 26');
  const dmCells = [...Array(24).keys()].map((charID) => cellOf(dm26, charID).join());

  /** The adventure from `source`, without the faces and with them, and the source's champions. */
  const raise = (source: Uint8Array) => {
    const off = makeNewAdventure(source, MINI, new CsbRandom(SEED));
    const offNull = makeNewAdventure(source, MINI, new CsbRandom(SEED), null);
    const on = makeNewAdventure(source, MINI, new CsbRandom(SEED), portraits);
    return {
      before: championsOf(ReadSavedGame(source, 0)),
      off: ReadSavedGame(off, 0),
      on: ReadSavedGame(on, 0),
      offSame: same(off, offNull),
    };
  };
  /** What a champion's portrait should be raised as: the file's cell for their DM cell, or theirs. */
  const expected = (portrait: string): { cell: number; portrait: string } => {
    const cell = dmCells.indexOf(portrait);
    return { cell, portrait: cell < 0 ? portrait : cellOf(newFaces, cell).join() };
  };
  const report = (label: string, r: ReturnType<typeof raise>) => {
    const on = championsOf(r.on);
    const off = championsOf(r.off);
    const diff = differences(r.off, r.on);
    const rows = r.before.map((c, i) => {
      const want = expected(c.portrait);
      return {
        cell: want.cell,
        upgraded: on[i]!.portrait === want.portrait,
        changed: on[i]!.portrait !== c.portrait,
        offKept: off[i]!.portrait === c.portrait,
        named: on[i]!.name === c.name && on[i]!.title === c.title,
      };
    });
    console.log(`  ${label}: ${r.before.map((c, i) => `${c.name}${c.title ? ` ${c.title}` : ''} (DM cell ${rows[i]!.cell}${rows[i]!.changed ? ', NEW FACE' : ''})`).join(', ')}`);
    console.log(`    on against off: ${diff.length ? diff.join(', ') : 'identical'}`);
    return { rows, diff };
  };

  const seven = raise(CSBGAME7);
  const s7 = report('csbgame7.dat', seven);
  check(seven.offSame, 'off, the adventure is makeNewAdventure\'s with no portraits, CSBWin\'s');
  check(s7.rows.every((r) => r.offKept), 'and every champion keeps their portrait in it');
  check(s7.rows.length === 4 && s7.rows.every((r) => r.cell >= 0 && r.upgraded && r.changed),
    'on, each DM champion has the file\'s cell for their cell of graphic 26');
  check(s7.rows.every((r) => r.named), 'under the same name and title');
  // `GAMEBLOCK1`'s word 174 is the characters' checksum, and word 127 the fold over
  // the block's second half, which holds it (`scrambleAndWrite`).
  const sums = ['block1:254', 'block1:255', 'block1:348', 'block1:349'];
  const portraitsOnly = (diff: string[]): boolean => diff.every((d) => sums.includes(d) || d.endsWith('.portrait'));
  check(s7.diff.length === sums.length + 4 && portraitsOnly(s7.diff),
    'and every other byte is the same, but for the characters\' checksum and the fold that holds it');

  const renamedSave = read(savePath('csbgame-early-2hero-renamed.dat'));
  const renamed = raise(renamedSave);
  const rn = report('csbgame-early-2hero-renamed.dat', renamed);
  const dmNames = new Set(presetHeroesOf(stockDungeon(), stockGraphics()).map((h) => h.name));
  const renamedIndex = renamed.before.findIndex((c) => !dmNames.has(c.name));
  check(renamedIndex >= 0 && rn.rows[renamedIndex]!.cell >= 0, 'a champion there is renamed, and has a DM portrait');
  check(rn.rows.every((r) => r.upgraded && r.changed && r.named), 'each is upgraded by portrait, and keeps their name and title');
  check(portraitsOnly(rn.diff), 'and nothing else changes');
  return portraits;
}

/** The prison's four, saved with CSB's faces, raised with the utility's portraits and without. */
async function checkPrisonFaces(portraits: UtilityPortraits): Promise<void> {
  const csb26 = graphics.getImage(26);
  const store = memoryStore();
  const { game, saves } = prisonGame(store, 'csb', (champion) => cellOf(csb26, champion.portraitGraphic!));
  for (let i = 0; i < 4; i++) recruit(game, i);
  const save = await saves.save('running', 'quick');
  const bytes = await store.read(save.id);
  const before = championsOf(ReadSavedGame(bytes, 0));
  const [off, on] = [null, portraits].map((p) => championsOf(ReadSavedGame(makeNewAdventure(bytes, MINI, new CsbRandom(SEED), p), 0)));
  const dmCells = [...Array(24).keys()].map((charID) => cellOf(stockGraphics().getImage(26), charID).join());
  console.log(`  the prison's four: ${before.map((c) => `${c.name} (DM cell ${dmCells.indexOf(c.portrait)})`).join(', ')}`);
  check(before.length === 4 && before.every((c, i) => c.portrait === cellOf(csb26, game.ctx.party.state.champions[i]!.portraitGraphic!).join()),
    'they are saved with their cells of CSB\'s graphic 26');
  check(before.every((c) => dmCells.indexOf(c.portrait) < 0), 'which are no DM champion\'s');
  check([off!, on!].every((raised) => raised.every((c, i) => c.portrait === before[i]!.portrait)),
    'and keep their portraits, the faces on or off');
}

/** `readUtilityPortraits` of a file that does not read, and of a read that fails. */
async function checkDamagedFaces(): Promise<void> {
  const failures: string[] = [];
  const failed = (error: unknown): void => { failures.push(String(error)); };
  const damaged = read(resolve(CSB, UTILITY_PORTRAITS_FILE)).slice(0, 40);
  const settled = (p: Promise<UtilityPortraits | null>) => p.then((v) => v, (error: unknown) => `rejected ${String(error)}`);
  const truncated = await settled(readUtilityPortraits(async () => damaged, failed));
  const unread = await settled(readUtilityPortraits(async () => { throw new Error('no network'); }, failed));
  const missing = await settled(readUtilityPortraits(async () => null, failed));
  const whole = await settled(readUtilityPortraits(async () => read(resolve(CSB, UTILITY_PORTRAITS_FILE)), failed));
  console.log(`  its first 40 bytes: ${String(truncated)}; a read that fails: ${String(unread)}; none: ${String(missing)}; `
    + `the errors: ${JSON.stringify(failures)}`);
  check(truncated === null && unread === null && missing === null, 'a damaged file, a failed read and no file give no portraits');
  check(failures.length === 2, 'the two failures are handed on, and no file is none');
  check(whole instanceof UtilityPortraits, 'the whole file gives them');
}

async function main(): Promise<void> {
  checkCarving();
  checkButtons();
  await checkStore();
  await checkChooser();
  checkTitles();
  await checkPrison();
  await checkPrisonFaces(checkNewFaces());
  await checkDamagedFaces();
  finish();
}

void main();
