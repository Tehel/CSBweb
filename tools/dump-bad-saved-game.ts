/**
 * `tag01efee`: where every failed read of `_ReadEntireGame` ends
 * (`doc/CSBwin-src/SaveGame.cpp:1911-1912`, `:2098-2119`).
 *
 * 1. **The chooser hands the failure over.** The boot's load-only chooser is
 *    `_ReadEntireGame`'s, so a save that fails its read closes it and reaches
 *    `onRestoreFailed`, rather than the status line the full menu keeps
 *    (`restoreChosenSave`, `src/renderer/ui/SaveMenu.ts`). The save is a committed CSBWin
 *    file with its last cell flag flipped, which only the image's checksum word can catch,
 *    and the running game is left as it was.
 * 2. **After a lost game** (`d.PartyHasDied` 1): a fade to `d.Palette11978`, the centred
 *    one-button menu "SAVED GAME DAMAGED!" / "PUT THE CHAOS STRIKES BACK DISK IN ~" / "OK",
 *    and a wait that only a left click on OK ends; a key, a right click and a miss do not.
 *    Then `tag01ec56`'s -1, which puts the entrance up again.
 * 3. **At the boot** (0): CSBWin's `die(0xbad)`. The author's divergence (`DEBT.md` H): the
 *    same menu with the one line and OK, and the click throws `BadSavedGame`, which
 *    `runBootSequence` catches to start again from the title.
 * 4. **A new game's read** ends there too in CSBWin (`SaveGame.cpp:1910-1912`); in the
 *    port it ends the game, the author's decision for a game file (`DEBT.md` H). The page
 *    builds its `Game` over an empty world and reads `dungeon.dat` once the entrance's doors
 *    have opened (`Game.readDungeonDat`). CSB's prison with a byte of its compressed image
 *    flipped fails the checksum, and a file cut short of its first eight bytes fails
 *    `ReadDatabases`' first `READ`; either is `die(0xbad)` with the reason, and leaves the
 *    empty world as it was.
 * 5. **A save that read** goes on to `_TAG021028`'s hand-off
 *    (`doc/CSBwin-src/CSBCode.cpp:10617-10661`), where CSBWin puts up "GAME LOADED, READY
 *    TO PLAY." and the port, deliberately, nothing: the chooser's picture fades to black,
 *    the screen is cleared, and no click is waited for. A new game's hand-off draws
 *    nothing there.
 *
 * Run: `npm test -- --only=dump-bad-saved-game.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { emptyDungeonData } from '../src/data/DungeonLoader';
import { Die } from '../src/engine/Die';
import type { Game } from '../src/engine/Game';
import { applySaveBytes } from '../src/engine/SaveGameFile';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { PALETTE_11914, type IntroEvent, type IntroHost } from '../src/renderer/intro/IntroHost';
import { MENU_TITLE1_COLOR, MENU_TITLE2_COLOR, doMenu, drawMenuPress, menuButtonList } from '../src/renderer/ui/Menu';
import type { UIHooks, UIState } from '../src/renderer/ui/UIState';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { savePath } from './lib/saves';
import * as SaveMenu from '../src/renderer/ui/SaveMenu';
import * as Boot from '../src/renderer/intro/BootSequence';
import { standInOf } from './lib/standIn';

const SAVE = savePath('csbgame7.dat');
const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const PRISON = 'static/gamefiles/csb/dungeon.dat';


const graphics = stockGraphics();

function freshGame(): Game {
  return stockGame();
}

/* ------------------------------------------------ 1. the chooser's hand-off ---- */

function checkChooser(): void {
  console.log('=== the load-only chooser hands a failed read to tag01efee ===');
  const intact = new Uint8Array(readFileSync(resolve(SAVE)));
  const damaged = intact.slice();
  damaged[damaged.length - 3] ^= 0x01;     // the last cell flag: only the checksum word sees it

  const run = (mode: 'full' | 'loadOnly', bytes: Uint8Array) => {
    const game = freshGame();
    const failures: unknown[] = [];
    const ui = newUIState(graphics, game.ctx, {
      onRestoreSave: (save) => applySaveBytes(game, save.bytes),
      onRestoreFailed: (error) => { failures.push(error); },
    });
    SaveMenu.openSaveMenu(ui, mode);
    let thrown: string | null = null;
    try {
      // The row is the hooks' business, and these read none of it.
      const entry = { id: 'x', name: 'x', dataSet: 'dm-atari', playthrough: 0, quick: false, sleep: false, savedAt: 0, usedAt: 0, playTime: 0, level: 0, champions: [], unofficial: false };
      SaveMenu.restoreChosenSave(ui, { entry, bytes });
    } catch (error) {
      thrown = (error as Error).message;
    }
    return { game, open: SaveMenu.isSaveMenuOpen(ui), failures, thrown };
  };

  const bad = run('loadOnly', damaged);
  const message = bad.failures.length === 1 ? (bad.failures[0] as Error).message : null;
  console.log(`  load-only, damaged: failures ${bad.failures.length} (${message}), thrown ${bad.thrown}, open ${bad.open}, champions ${bad.game.ctx.party.state.champions.length}`);
  check(bad.failures.length === 1 && /CHECKSUM MISMATCH/.test(message ?? ''), 'onRestoreFailed hears of the checksum');
  check(bad.thrown === null, 'and nothing reaches the status line');
  check(!bad.open, 'the chooser closes, for tag01efee to take the screen');
  check(bad.game.ctx.party.state.champions.length === 0, 'and the running game is untouched: the read fails before it applies');

  const good = run('loadOnly', intact);
  console.log(`  load-only, intact: failures ${good.failures.length}, open ${good.open}, champions ${good.game.ctx.party.state.champions.length}`);
  check(good.failures.length === 0 && !good.open && good.game.ctx.party.state.champions.length > 0,
    'an intact save loads, and the chooser closes as before');

  const full = run('full', damaged);
  console.log(`  full menu, damaged: failures ${full.failures.length}, thrown ${full.thrown}, open ${full.open}`);
  check(full.failures.length === 0 && full.thrown !== null && full.open,
    'the full menu, which CSBWin does not have, keeps its status line and stays up');
}

/* ------------------------------------------------------------ 2 and 3. tag01efee ---- */

interface Scripted {
  host: IntroHost;
  log: string[];
  /** The screen as it stood when the cursor came up for the wait. */
  shown: Uint8Array | null;
  queue: IntroEvent[];
}

function scriptedHost(events: IntroEvent[]): Scripted {
  const uiTables = graphicsTablesOf(graphics).ui;
  const screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  screen.pixels.fill(3);
  const r = standInOf<Scripted>({ log: [], shown: null, queue: [...events] });
  r.host = {
    screen,
    uiTables,
    font: loadFontData(graphics),
    // The chooser's palette, `d.Palette11978`, with one register off so the fade shows.
    globalPalette: [...(uiTables.graphic232.palette552[0] ?? PALETTE_11914)].map((c, i) => (i === 1 ? 0x777 : c)),
    getGraphic(graphicNum: number): IndexedBitmap {
      const image = graphics.getImage(graphicNum);
      return { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
    },
    present: () => {},
    vbl: (count) => {
      r.log.push(`vbl ${count}`);
      return Promise.resolve();
    },
    startSound: () => {},
    drawPrisonInterior: () => { throw new Error('not on this screen'); },
    nextEvent: () => {
      const event = r.queue.shift();
      if (!event) throw new Error('waited for input that never came');
      r.log.push(event.kind === 'key' ? 'key' : `click ${event.x},${event.y},${event.buttons}`);
      return Promise.resolve(event);
    },
    takeClick: () => null,
    discardAllInput: () => { r.log.push('discard'); },
    mouseSwitches: () => 0,
    keyWaiting: () => r.queue.some((event) => event.kind === 'key'),
    setCursorVisible: (visible) => {
      r.log.push(visible ? 'on' : 'off');
      if (visible && !r.shown) r.shown = screen.pixels.slice();
    },
  };
  return r;
}

/** The interface over a game with no dungeon: the menus read only its tables, screen and font. */
function blankUI(hooks: Partial<UIHooks> = {}): UIState {
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, hooks);
}

/** A `MenuScreen` over `ui/Menu.ts` and the host's screen, logging what `_DoMenu` was given. */
function menuScreen(host: IntroHost, menus: string[]): import('../src/renderer/intro/BootSequence').MenuScreen {
  const ui = blankUI({ getGraphicBitmap: (graphicNum) => host.getGraphic(graphicNum) });
  ui.screenIndexBuffer = host.screen;
  return {
    doMenu: (title1, title2, options, centred) => {
      menus.push(`${JSON.stringify(title1)} / ${JSON.stringify(title2)} / ${JSON.stringify(options)} / ${centred}`);
      doMenu(ui, title1, title2, options, centred);
    },
    menuButtonList: (count, centred) => menuButtonList(ui, count, centred),
    drawMenuPress: (press, nowMs) => drawMenuPress(ui, press, nowMs),
  };
}

/** The log with each run of `vbl 1` counted: `1x8` is one fade. */
function compact(log: string[]): string {
  const out: string[] = [];
  let run = 0;
  for (const entry of log) {
    if (entry === 'vbl 1') { run++; continue; }
    if (run) { out.push(`1x${run}`); run = 0; }
    out.push(entry.startsWith('vbl ') ? entry.slice(4) : entry);
  }
  if (run) out.push(`1x${run}`);
  return out.join(', ');
}

function ink(pixels: Uint8Array, color: number): number {
  return pixels.reduce((n, p) => n + (p === color ? 1 : 0), 0);
}

async function checkTag01efee(): Promise<void> {
  const ui = graphicsTablesOf(graphics).ui;
  const ok = menuButtonList(blankUI(), 1, true)[0];
  check(ok !== undefined && ok.word0 === 210, 'the centred one-button set has its button, 210');
  if (!ok) return;
  const at = { x: (ok.x1 + ok.x2) >> 1, y: (ok.y1 + ok.y2) >> 1 };
  const click = (x: number, y: number, buttons: number): IntroEvent => ({ kind: 'click', x, y, buttons });
  const script: IntroEvent[] = [
    { kind: 'key', x: 0, y: 0, buttons: 0 },
    click(at.x, at.y, 1),                  // the right button: the list is left-click only
    click(5, 5, 2),                        // off the button
    click(at.x, at.y, 2),
  ];
  const expectedLog =
    `1x24, on, key, click ${at.x},${at.y},1, click 5,5,2, click ${at.x},${at.y},2, off, 1x1, 5, 5, on, discard, off`;
  const palette11978 = ui.graphic232.palette552[0] ?? PALETTE_11914;

  console.log('');
  console.log('=== after a lost game: the menu, then back to tag01ec56 ===');
  const lost = scriptedHost(script);
  const lostMenus: string[] = [];
  await Boot.tag01efee(lost.host, menuScreen(lost.host, lostMenus), true);
  console.log(`  ${lostMenus.join('\n  ')}`);
  console.log(`  ${compact(lost.log)}`);
  check(lostMenus.length === 1 &&
    lostMenus[0] === '"SAVED GAME DAMAGED!" / "PUT THE CHAOS STRIKES BACK DISK IN ~" / ["OK"] / true',
    'DoMenu(_14_, "SAVED GAME DAMAGED!", "PUT THE CHAOS STRIKES BACK DISK IN ~", "OK", …, 1, 1, 1), centred');
  check(compact(lost.log) === expectedLog,
    'three fades (to Palette11978, down, up), then only the left click on OK ends the wait');
  check(lost.queue.length === 0, 'every event was taken');
  check(lost.host.globalPalette.every((c, i) => c === palette11978[i]), 'the colour registers are left at Palette11978');
  const lostTitles = lost.shown ? [ink(lost.shown, MENU_TITLE1_COLOR), ink(lost.shown, MENU_TITLE2_COLOR)] : [0, 0];
  console.log(`  title ink: ${lostTitles[0]} pixels of colour ${MENU_TITLE1_COLOR}, ${lostTitles[1]} of ${MENU_TITLE2_COLOR}`);
  check(lostTitles[0] > 0 && lostTitles[1] > 0, 'both titles are drawn on the menu');
  const corners = lost.shown ? [lost.shown[0], lost.shown[SCREEN_WIDTH * SCREEN_HEIGHT - 1]] : [];
  check(corners.length === 2 && corners.every((p) => p === 0), 'over a cleared screen, the chooser gone');

  console.log('');
  console.log('=== at the boot: the line, acknowledged, then BadSavedGame ===');
  const boot = scriptedHost(script);
  const bootMenus: string[] = [];
  let caught: unknown = null;
  try {
    await Boot.tag01efee(boot.host, menuScreen(boot.host, bootMenus), false);
  } catch (error) {
    caught = error;
  }
  console.log(`  ${bootMenus.join('\n  ')}`);
  console.log(`  ${compact(boot.log)}; threw ${caught instanceof Error ? caught.constructor.name : caught}`);
  check(bootMenus.length === 1 && bootMenus[0] === '"SAVED GAME DAMAGED!" / null / ["OK"] / true',
    'PRINTLINE("SAVED GAME DAMAGED!") as a centred menu of its own, with OK to acknowledge it');
  check(compact(boot.log) === expectedLog, 'the same fades and the same wait');
  check(caught instanceof Boot.BadSavedGame, 'and the click throws BadSavedGame, die(0xbad)\'s stand-in, back to the title');
}

/* ------------------------------------------------------- 4. a new game's read ---- */

async function checkNewGameRead(): Promise<void> {
  console.log('');
  console.log('=== a new game: dungeon.dat read after ENTER ===');
  const prison = new Uint8Array(readFileSync(resolve(PRISON)));
  const damaged = prison.slice();
  damaged[damaged.length - 3] ^= 0x01;     // inside the compressed image: the checksum word sees it
  const short = new Uint8Array(readFileSync(resolve(DUNGEON))).subarray(0, 4);

  const game = newGame(emptyDungeonData(), graphics);
  const levels = () => game.ctx.dungeon.getData().maps.length;
  const read = (bytes: Uint8Array): unknown => {
    try {
      game.readDungeonDat(bytes);
      return 'read';
    } catch (error) {
      return error;
    }
  };
  const readDamaged = read(damaged);
  const readShort = read(short);
  const describe = (result: unknown) => (result instanceof Die ? `Die 0x${result.errorNum.toString(16)}: ${result.message.split('\n').slice(1).join(' / ')}` : String(result));
  console.log(`  damaged prison: ${describe(readDamaged)}`);
  console.log(`  4-byte file: ${describe(readShort)}`);
  console.log(`  levels after both: ${levels()}`);
  check([readDamaged, readShort].every((r) => r instanceof Die && r.errorNum === 0xbad && r.message.includes('SAVED GAME DAMAGED!\ndungeon.dat: ')),
    'a checksum mismatch and a short file both end the game, die(0xbad), with the reason');
  check(levels() === 0, 'and the empty world the page boots over is left as it was');
  const readIntact = read(prison);
  console.log(`  intact prison: ${describe(readIntact)}, levels ${levels()}, start ${JSON.stringify(game.ctx.party.state.position)}`);
  check(readIntact === 'read' && levels() === 2, 'the intact prison reads, its two levels installed');
}

/* ------------------------------------------- 5. the hand-off after a load ---- */

async function checkHandOff(): Promise<void> {
  console.log('');
  console.log('=== a save read: the hand-off to the adventure, with no menu ===');
  // No event is scripted: a wait for input would throw.
  const loaded = scriptedHost([]);
  await Boot.tag021028(loaded.host, 'resume');
  const black = loaded.host.globalPalette.every((c) => c === PALETTE_11914[0]);
  const cleared = loaded.host.screen.pixels.every((p) => p === 0);
  console.log(`  resume: ${compact(loaded.log)}; colour registers ${black ? 'black' : 'NOT BLACK'}, screen ${cleared ? 'cleared' : 'NOT CLEARED'}`);
  check(compact(loaded.log) === '1x8, 4',
    'one fade and wvbl(4) (CSBCode.cpp:10659): no cursor, and no wait for a click on a menu');
  check(black && cleared, 'the chooser\'s picture is faded to black, Palette11914, and the screen cleared (:10660)');

  const entered = scriptedHost([]);
  await Boot.tag021028(entered.host, 'enter');
  console.log(`  enter: ${entered.log.length} host calls, the screen ${entered.host.screen.pixels.every((p) => p === 3) ? 'as it was' : 'CHANGED'}`);
  check(entered.log.length === 0 && entered.host.screen.pixels.every((p) => p === 3),
    'a new game\'s hand-off leaves the opened doors\' picture to the page');
}

async function main(): Promise<void> {
  checkChooser();
  await checkTag01efee();
  await checkNewGameRead();
  await checkHandOff();
  finish();
}

void main();
