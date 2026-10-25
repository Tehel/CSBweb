/**
 * A game an error has ended (`Game.die`, CSBWin's `die`, `doc/CSBwin-src/CSBCode.cpp:96-122`)
 * is dead: the page puts the message up and nothing else may touch the world the error
 * left half-updated. On `csbgame7.dat`, a genuine save, over the Atari Dungeon Master's
 * dungeon, against a store in memory.
 *
 * 1. **The loop**: a VBL that throws tells the host once, and the game is dead; `start`
 *    does not run it again.
 * 2. **The saves**: F5, the Sleepsave and the menu's SAVE write no row of a dead game;
 *    F5 says it could not save. The same F5 of a living game writes its row.
 * 3. **The input**: `GameInput` hands a dead game's keys back to the browser (F5 and F9
 *    reload the page) and touches neither the screen nor the save paths, for a key, a
 *    click, a move or the wheel.
 *
 * Run: `npm test -- --only=fatal-error.ts`
 */
import { readFileSync } from 'node:fs';

import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import type { MessageSink } from '../../src/engine/GameHost';
import { GameSaves } from '../../src/engine/GameSaves';
import { GameInput, type KeyPress } from '../../src/renderer/GameInput';
import type { GameScreen } from '../../src/renderer/GameScreen';
import { STOCK_DATA_SET, diskFiles } from '../lib/dataSets';
import { check, finish } from '../lib/check';
import { newGame } from '../lib/game';
import { memoryStore, savePath } from '../lib/saves';

const ATARI = 'tools/fixtures/gamefiles/dm-atari';
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(`${ATARI}/graphics.dat`)));
const dungeon = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${ATARI}/dungeon.dat`)));

/** What reached the message area. */
const told: string[] = [];
const messages: MessageSink = {
  printLinefeed: () => {},
  quePrintLines: (_color, text) => { told.push(text); },
  printLines: () => {},
  setNewSpeed: () => {},
  resetTime: () => {},
  clockTick: () => {},
  printNextQueued: () => {},
  vblInterrupt: () => {},
  discardText: () => {},
};

/** `csbgame7.dat` read into a new game, its saves over a store in memory, and what its host was told of a death. */
function stage() {
  const died: unknown[] = [];
  const game: Game = newGame(dungeon, graphics, { messages, die: (error) => { died.push(error); } });
  applyCsbwinSave(game, new Uint8Array(readFileSync(savePath('csbgame7.dat'))));
  const store = memoryStore();
  const saves = new GameSaves(game, STOCK_DATA_SET, diskFiles(STOCK_DATA_SET), store,
    { portraitOf: () => undefined }, () => {});
  return { game, store, saves, died };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkLoop(): Promise<void> {
  console.log('=== the loop ===');
  const { game, died } = stage();
  let frames = 0;
  (game as unknown as { runFrame: () => void }).runFrame = () => {
    frames++;
    throw new Error('a frame that throws');
  };
  game.start();
  await wait(200);
  console.log(`  a frame that throws: ${frames} frame run, the host told ${died.length} time, dead ${game.isDead()}`);
  check(frames === 1 && died.length === 1 && game.isDead(), 'a VBL that throws tells the host once, and the game is dead');
  game.start();
  await wait(200);
  check(frames === 1 && died.length === 1, 'start does not run a dead game again');
}

async function checkSaves(): Promise<void> {
  console.log('');
  console.log('=== the saves ===');
  const living = stage();
  await living.saves.quickSave();
  const livingRows = (await living.saves.list()).length;
  console.log(`  F5 of a living game: ${livingRows} row`);
  check(livingRows === 1, 'F5 of a living game writes its row');

  const { game, saves, store } = stage();
  game.die();
  const toldBefore = told.length;
  await saves.quickSave();
  const toldF5 = told.slice(toldBefore);
  await saves.sleepSave();
  const menu = await saves.save('stopped', 'new').then(() => 'written', (error: unknown) => `refused: ${(error as Error).message}`);
  const rows = (await saves.list()).length;
  console.log(`  a dead game: F5 told ${JSON.stringify(toldF5)}, the menu's SAVE ${menu}, ${rows} rows, ${store.files.size} files`);
  check(toldF5.length === 1 && toldF5[0] === 'UNABLE TO SAVE GAME!', 'F5 of a dead game says it could not save');
  check(menu.startsWith('refused'), 'the menu\'s SAVE of a dead game is refused');
  check(rows === 0 && store.files.size === 0, 'F5, the Sleepsave and the menu\'s SAVE write nothing of a dead game');
}

function checkInput(): void {
  console.log('');
  console.log('=== the input ===');
  const { game } = stage();
  /** A screen nothing may touch: any read of it throws. */
  const screen = new Proxy({}, { get: (_target, name) => { throw new Error(`the screen's ${String(name)} touched`); } }) as GameScreen;
  const asked: string[] = [];
  const input = new GameInput({
    game, screen, refreshScreen: () => { asked.push('refresh'); },
    onQuickSave: () => { asked.push('F5'); }, onQuickLoad: () => { asked.push('F9'); },
  });
  const press = (code: string): KeyPress => ({ key: code, code, ctrlKey: false, metaKey: false, altKey: false });

  let living = 'took it';
  try { input.keyDown(press('F5')); } catch (error) { living = (error as Error).message; }
  console.log(`  F5 to a living game: ${living}`);
  check(living !== 'took it', 'a living game\'s key reaches the screen (the control: the guard below is what stops it)');

  game.die();
  const keys = ['F5', 'F9', 'KeyS', 'Escape'].map((code) => input.keyDown(press(code)));
  input.mouseMove(10, 10);
  input.mouseDown(10, 10, 0);
  input.mouseUp();
  input.mouseLeave();
  const wheel = input.wheel(1);
  console.log(`  a dead game: the keys taken ${JSON.stringify(keys)}, the wheel taken ${wheel}, asked ${JSON.stringify(asked)}`);
  check(keys.every((taken) => !taken) && !wheel, 'a dead game takes no key, F5 and F9 included, nor the wheel: they are the browser\'s');
  check(asked.length === 0, 'nor asks for a save, a load or a redraw, and the screen is never touched');
}

await checkLoop();
await checkSaves();
checkInput();
finish();
