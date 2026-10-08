/**
 * The message area's pace: one print-queue entry a pass of the main loop, and the scroll.
 *
 * - The main loop takes one `printQueue` entry a pass, at `tag0007c8`, whether or not a
 *   tick ran, frozen or not (doc/CSBwin-src/CSBCode.cpp:724-731, `:775`), and `PrintLines`
 *   ends in `ClockTick` (`:1753`). So a message reaches the screen without a tick, stamped
 *   with the `d.Time` it is printed at. The save menu holds the loop in `DisplayDiskMenu`
 *   (`:772`), so it takes none.
 * - A new row at the bottom is `ScrollUp` (`:1593-1606`): `d.PushTextUp = 1`,
 *   `d.TextScanlineScrollCount = 0`. `vblInterrupt`, which runs before the pass its VBL
 *   wakes (`system.cpp:624-630`, `CSBUI.cpp:1274-1293`), moves the strip, scanlines
 *   172-199, up one scanline a VBL and blanks the bottom `count`, until the count reaches 7
 *   and turns to -1; the next VBL clears `d.PushTextUp` (`CSBCode.cpp:981-1014`).
 * - Until then `ClockTick` places nothing (`:1536-1537`) and `RemoveTimedOutText` removes
 *   nothing (`:1515-1518`). A piece printed during the scroll waits for the next
 *   `ClockTick`: the tick's own, after the timers (`:687`), or the next `PrintLines`.
 * - `DiscardText` stops the scroll (`:1451-1474`).
 * - A restart after a lost game empties the strip, and leaves `printQueue`
 *   (`ScrollingText.restart`).
 *
 * Run: `npx tsx tools/dump-messages.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { ScrollingText } from '../src/renderer/csbwin/ScrollingText';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { newGame, runVbl, TICK_DUE } from './lib/game';
import { freeze, thaw } from '../src/engine/LoopState';
import { check, finish } from './lib/check';

const STRIP_TOP = 172;
const STRIP_HEIGHT = 28;
const WIDTH = 320;

function main(): void {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const font = loadFontData(graphics);

  const messages = new ScrollingText();
  const game = newGame(data, graphics, { messages });
  game.setRandomSeed(0x12345678);
  game.ctx.party.state.position = new Position(6, 14, 2);
  game.systems.monsters.loadPartyLevel(2);

  let vbl = 0;

  /** The strip's pixels as `draw` leaves them in a cleared screen. */
  const strip = (): Uint8Array => {
    const screen = createPaletteIndexViewportBuffer(WIDTH, 200, 0);
    messages.draw(screen, font);
    return screen.pixels.slice(STRIP_TOP * WIDTH, (STRIP_TOP + STRIP_HEIGHT) * WIDTH);
  };
  /** A scanline with ink is `#`, a blank one `.`, from 172 down to 199. */
  const ink = (pixels: Uint8Array): string => {
    let line = '';
    for (let y = 0; y < STRIP_HEIGHT; y++) {
      line += pixels.subarray(y * WIDTH, (y + 1) * WIDTH).some((p) => p !== 0) ? '#' : '.';
    }
    return line;
  };
  const state = (): string => {
    const { pushTextUp, textScanlineScrollCount } = messages.scrollState();
    const { printQueue, futureLines } = messages.backlog();
    return `t=${game.ctx.state.tickCount} push=${pushTextUp} count=${String(textScanlineScrollCount).padStart(2)} ` +
      `queue=${printQueue} future=${futureLines} ${ink(strip())} ${JSON.stringify(messages.snapshot())}`;
  };
  /** One VBL, with a tick due or not. */
  const frame = (tick = false): void => {
    runVbl(game, tick ? TICK_DUE : 1);
    vbl++;
    console.log(`vbl ${String(vbl).padStart(2)}${tick ? ' tick' : '     '} ${state()}`);
  };
  const say = (text: string): void => {
    messages.printLinefeed();
    messages.quePrintLines(15, text);
  };
  const rows = (): string[] => messages.snapshot().map((line) => line.trim());

  console.log('=== one entry a pass, no tick (CSBCode.cpp:724-731) ===');
  const t0 = game.ctx.state.tickCount;
  for (const text of ['ONE', 'TWO', 'THREE', 'FOUR']) say(text);
  const placedAt: number[] = [];
  for (let i = 0; i < 8; i++) {
    frame();
    const row = rows().findIndex((line, r) => line !== '' && placedAt[r] === undefined);
    if (row >= 0) placedAt[row] = vbl;
  }
  check(game.ctx.state.tickCount === t0, 'no tick ran');
  check(placedAt.join() === '2,4,6,8', 'a row lands every second VBL: its linefeed, then its text');
  check(messages.timeouts().every((timeout) => timeout === t0 + 70),
    'each row is stamped with the d.Time it was printed at, + 70');

  console.log('');
  console.log('=== a fifth row scrolls the strip, a scanline a VBL (CSBCode.cpp:981-1014) ===');
  const before = strip();
  say('FIVE');
  frame();
  const started = messages.scrollState();
  check(started.pushTextUp === 1 && started.textScanlineScrollCount === 0, 'its linefeed starts the scroll: PushTextUp 1, count 0');
  check(rows().join() === 'TWO,THREE,FOUR,', 'the rows and their timeouts move up at once');
  check(strip().every((p, i) => p === before[i]), 'and no pixel moves before the first VBL');
  let shifted = true;
  for (let k = 1; k <= 7; k++) {
    frame();
    const now = strip();
    for (let y = 0; y < STRIP_HEIGHT && shifted; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const expected = y < STRIP_HEIGHT - k ? before[(y + k) * WIDTH + x]! : 0;
        if (now[y * WIDTH + x] !== expected) { shifted = false; break; }
      }
    }
    if (k === 1) {
      check(messages.backlog().printQueue === 0 && messages.backlog().futureLines === 1,
        'FIVE is printed in the next pass, and waits');
    }
  }
  check(shifted, 'after k VBLs the strip is the old one moved up k scanlines, the bottom k blank');
  check(messages.scrollState().textScanlineScrollCount === -1 && messages.scrollState().pushTextUp === 1,
    'after seven the count turns to -1');
  frame();
  check(messages.scrollState().pushTextUp === 0, 'the next VBL clears PushTextUp');
  for (let i = 0; i < 3; i++) frame();
  check(rows()[3] === '' && messages.backlog().futureLines === 1,
    'with the print queue empty, nothing calls ClockTick: FIVE still waits');
  frame(true);
  check(rows()[3] === 'FIVE' && messages.timeouts()[3] === game.ctx.state.tickCount + 70,
    'the tick\'s own ClockTick places it, stamped with the new d.Time');

  console.log('');
  console.log('=== RemoveTimedOutText waits for the scroll (CSBCode.cpp:1515-1518) ===');
  say('SIX');
  frame();
  const late = game.ctx.state.tickCount + 500;
  messages.clockTick(late);
  check(rows().join() === 'THREE,FOUR,FIVE,', 'every row is due, and the scroll keeps them all');
  for (let i = 0; i < 9; i++) frame();
  messages.clockTick(late);
  check(rows().join() === ',,,SIX', 'after it, they go, and SIX is placed');

  console.log('');
  console.log('=== frozen, the loop still prints; under the save menu it does not ===');
  freeze(game.ctx);
  say('FROZEN');
  const frozenAt = game.ctx.state.tickCount;
  frame(true);
  frame(true);
  check(game.ctx.state.tickCount === frozenAt && messages.backlog().printQueue === 0,
    'frozen, no tick runs, and the loop still takes both entries (CSBCode.cpp:775)');
  thaw(game.ctx);
  for (let i = 0; i < 7; i++) frame();
  frame(true);
  check(rows()[3] === 'FROZEN', 'thawed, once the scroll its linefeed started is over, a tick places it');
  say('SAVED');
  frame();
  check(messages.scrollState().textScanlineScrollCount === 0, 'a linefeed starts a scroll');
  game.ctx.state.paused = true;
  for (let i = 0; i < 3; i++) frame();
  check(messages.scrollState().textScanlineScrollCount === 3 && messages.backlog().printQueue === 1,
    'paused, the scroll goes on and the entry waits (CSBCode.cpp:772)');
  game.ctx.state.paused = false;
  frame();
  check(messages.backlog().printQueue === 0, 'unpaused, the next pass takes it');

  console.log('');
  console.log('=== DiscardText stops the scroll (CSBCode.cpp:1451-1474) ===');
  say('GONE');
  frame();
  check(messages.scrollState().textScanlineScrollCount >= 0, 'a scroll is under way');
  const timeoutsBefore = messages.timeouts().join();
  messages.discardText();
  console.log(`after discard: ${state()}`);
  const stopped = messages.scrollState();
  check(stopped.pushTextUp === 0 && stopped.textScanlineScrollCount === -1, 'the scroll stops');
  check(rows().every((line) => line === '') && ink(strip()) === '.'.repeat(STRIP_HEIGHT), 'and the strip is blank');
  check(messages.backlog().printQueue === 1 && messages.timeouts().join() === timeoutsBefore,
    'the print queue and the timeouts are left as they are');

  console.log('');
  console.log('=== a restart empties the strip (Code1f9e6.cpp:302-316) ===');
  messages.setPartySleeping(true);
  for (const text of ['A', 'B', 'C', 'D', 'E', 'KEPT']) say(text);
  while (messages.backlog().printQueue > 1) frame();
  check(messages.hasText() && messages.backlog().futureLines > 0,
    'the lost game leaves lines in the strip, and a piece waiting');
  messages.restart();
  console.log(`after restart: ${state()}`);
  const restarted = messages.scrollState();
  check(rows().every((line) => line === '') && ink(strip()) === '.'.repeat(STRIP_HEIGHT) &&
    messages.backlog().futureLines === 0, 'Cleanup and TAG021028: nothing waits, and the strip is blank');
  check(restarted.pushTextUp === 0 && restarted.textScanlineScrollCount === -1 &&
    messages.timeouts().every((timeout) => timeout === -1), 'd.Initialize and TAG001c6e: no scroll, no timeout');
  check(messages.backlog().printQueue === 1, 'printQueue is left as it is');
  frame();
  check(rows()[0] === 'KEPT' && messages.timeouts()[0] === game.ctx.state.tickCount + 70,
    'the next pass prints it at (0, 0), awake: SetPrintPosition(0, 0), d.PartySleeping 0');

  finish();
}

main();
