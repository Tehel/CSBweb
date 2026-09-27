/**
 * The end of a lost game — `MainLoop` returning, and `_ShowCredits(1)` after it.
 *
 * 1. **The loop ends on the tick of death.** `KillCharacter` sets `d.GameIsLost` when
 *    nobody is left (`doc/CSBwin-src/Character.cpp:2680`); the tick's timers have run, and
 *    everything under `if (d.GameIsLost == 0)` does not (`CSBCode.cpp:658-778`): no
 *    `scrollingText.ClockTick()`, no periodic update, and no tick after it. `_StartCSB`
 *    then calls `ShowCredits(_3_, d.GameIsLost)` (`:11325`). Three deaths: one inside a
 *    timer (poison), one between ticks (as a mouse handler kills), and one that leaves a
 *    champion standing.
 * 2. **The screen.** `showCredits` over a headless `IntroHost` and the real
 *    `graphics.dat`: the dying sound before any wait, the waits CSBWin names, "THE END"
 *    alone at `d.Word108` in the dark-blue palette, and the credits picture in
 *    `d.Palette328` until a button is held or a key waits. The rectangle is a canary for
 *    the parse of item 0x232: `BLT2Screen(…, d.Word108, 40, -1)` blits a 40-byte-wide
 *    source, and graphic 6 fills the 560 bytes `A3` skips (`Code1f9e6.cpp:136`, `:229`).
 *
 * 3. **"RESTART THIS GAME".** With `d.CanRestartFromSavegame` set, the button under "THE
 *    END" for 899 VBLs, drawn from `d.Word116` and `d.Word124` — whose parse the button's
 *    hard-coded rectangle checks — and answering only a left click on it; the credits
 *    going back to "THE END" without the 300 VBLs; and the black screen a restart leaves.
 *
 * Run: `npx tsx tools/dump-show-credits.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import type { MessageSink } from '../src/engine/ActuatorSystem';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { extractUITables, type UITables } from '../src/renderer/csbwin/UITables';
import { PALETTE_11914, type IntroEvent, type IntroHost } from '../src/renderer/intro/IntroHost';
import {
  DYING_SOUND_VBLS,
  PALETTE_LOCAL_46,
  PALETTE_RESTART,
  RESTART_BUTTON_VBLS,
  THE_END_VBLS,
  showCredits,
} from '../src/renderer/intro/ShowCredits';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

/* ------------------------------------------------ 1. the tick of death ---- */

function champion(i: number, health: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

interface Watched {
  game: Game;
  credits: boolean[];
  clockTicks: number;
  vbls: number;
  /** Frames run so far. */
  frames: number;
}

function watchedGame(healths: number[]): Watched {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const w = { credits: [] as boolean[], clockTicks: 0, vbls: 0, frames: 0 } as Watched;
  const messages: MessageSink = {
    printLinefeed: () => {},
    quePrintLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => { w.clockTicks++; },
    printNextQueued: () => {},
    vblInterrupt: () => { w.vbls++; },
  };
  w.game = newGame(data, stockGraphics(), { messages, showCredits: (lost) => w.credits.push(lost) });
  w.game.setRandomSeed(0x12345678);
  healths.forEach((health, i) => w.game.addChampion(champion(i, health)));
  w.game.party.state.position = new Position(6, 14, 2);
  return w;
}

/** The next `runFrame`, a game tick after the last, and what it did. */
function frame(w: Watched): { tick: number; lost: boolean; credits: number; clockTicks: number } {
  w.frames++;
  w.game.runFrame(1_000_000 + w.frames * 250);
  return {
    tick: w.game.state.tickCount,
    lost: w.game.party.state.gameIsLost,
    credits: w.credits.length,
    clockTicks: w.clockTicks,
  };
}

/** Run until the game is lost, then twenty frames more. Returns the frame it was lost in. */
function runPastDeath(label: string, w: Watched, limit: number): number {
  let lostAt = -1;
  for (let n = 1; n <= limit && lostAt < 0; n++) {
    const before = w.clockTicks;
    const f = frame(w);
    if (!f.lost) continue;
    lostAt = w.frames;
    console.log([label, `frame ${w.frames}`, `tick ${f.tick}`, `credits ${f.credits}`, `clockTick ${f.clockTicks - before}`].join('\t'));
    check(f.credits === 1 && w.credits[0] === true, `${label}: ShowCredits(1) is asked for once, in the frame of the death`);
    check(f.clockTicks === before, `${label}: the tick of death runs no scrollingText.ClockTick()`);
    check(w.game.mainLoopHasReturned(), `${label}: MainLoop has returned`);
  }
  check(lostAt > 0, `${label}: the party died within ${limit} frames`);
  const tick = w.game.state.tickCount;
  const timers = w.game.timerQueue.getTimers().length;
  const { clockTicks, vbls } = w;
  for (let n = 1; n <= 20; n++) frame(w);
  console.log([label, 'twenty frames on', `tick ${w.game.state.tickCount}`, `timers ${w.game.timerQueue.getTimers().length}`, `credits ${w.credits.length}`].join('\t'));
  check(w.game.state.tickCount === tick, `${label}: no tick runs after it`);
  check(w.game.timerQueue.getTimers().length === timers, `${label}: and no timer fires`);
  check(w.clockTicks === clockTicks && w.vbls === vbls, `${label}: and the loop's VBL half is gone too`);
  check(w.credits.length === 1, `${label}: ShowCredits is asked for only once`);
  return lostAt;
}

function checkTickOfDeath(): void {
  console.log('=== MainLoop returns on the tick of death (CSBCode.cpp:658-778) ===');

  // Poison of strength 128: 2 now (`max(1, 128/64)`), then 1 from `TT_75` 36 ticks later,
  // inside `ProcessTimers`.
  {
    const w = watchedGame([3]);
    w.game.monsterAttack.poisonCharacter(0, 128);
    check(w.game.party.state.champions[0]!.attributes.health === 1, 'poison: the first dose leaves 1 health');
    runPastDeath('poison', w, 60);
  }

  // A death between ticks, as a click or a step would cause: the next tick runs its
  // timers, then ends.
  {
    const w = watchedGame([200]);
    for (let n = 1; n <= 3; n++) frame(w);
    const tick = w.game.state.tickCount;
    w.game.monsterAttack.killCharacter(0);
    check(w.credits.length === 0, 'between ticks: nothing ends until the next tick');
    runPastDeath('between ticks', w, 1);
    check(w.game.state.tickCount === tick + 1, 'between ticks: the next tick is the last');
  }

  // One of two dies: the game goes on.
  {
    const w = watchedGame([200, 200]);
    w.game.monsterAttack.killCharacter(1);
    let tick = 0;
    for (let n = 1; n <= 10; n++) tick = frame(w).tick;
    console.log(['one of two dies', `tick ${tick}`, `credits ${w.credits.length}`].join('\t'));
    check(w.credits.length === 0 && !w.game.mainLoopHasReturned(), 'one of two dies: the game is not over');
    check(tick === 10, 'one of two dies: every frame still ticks');
  }
}

/* ---------------------------------------------------------- 2. the screen ---- */

type Step = { kind: 'sound' } | { kind: 'vbl'; count: number };

interface Recorder {
  host: IntroHost;
  steps: Step[];
  /** Screen and palette at the start of the 300-VBL wait: "THE END" is up. */
  theEnd: { pixels: Uint8Array; palette: number[] } | null;
}

function recordingHost(ui: UITables, input: { heldAfterPolls: number; keyAfterPolls: number }): Recorder {
  const graphics = stockGraphics();
  const screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  screen.pixels.fill(9); // The adventure's last frame, as far as this screen cares.
  const r: Recorder = { steps: [], theEnd: null } as unknown as Recorder;
  let polls = 0;
  r.host = {
    screen,
    uiTables: ui,
    font: loadFontData(graphics),
    globalPalette: [...(ui.graphic232.palette552[0] ?? PALETTE_11914)],
    getGraphic(graphicNum: number): IndexedBitmap {
      const image = graphics.getImage(graphicNum);
      return { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
    },
    present: () => {},
    vbl: (count) => {
      if (count === THE_END_VBLS) r.theEnd = { pixels: screen.pixels.slice(), palette: [...r.host.globalPalette] };
      r.steps.push({ kind: 'vbl', count });
      return Promise.resolve();
    },
    startSound: () => {},
    drawPrisonInterior: () => { throw new Error('not on this screen'); },
    nextEvent: () => { throw new Error('the credits poll, they do not wait on the queue'); },
    takeClick: () => { throw new Error('no button without d.CanRestartFromSavegame'); },
    discardAllInput: () => {},
    mouseSwitches: () => (polls++ >= input.heldAfterPolls ? 2 : 0),
    keyWaiting: () => polls >= input.keyAfterPolls,
    setCursorVisible: () => {},
  };
  return r;
}

function sameRegion(pixels: Uint8Array, src: IndexedBitmap, x1: number, y1: number): boolean {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (pixels[(y1 + y) * SCREEN_WIDTH + x1 + x] !== src.pixels[y * src.width + x]) return false;
    }
  }
  return true;
}

async function checkScreen(): Promise<void> {
  console.log('');
  console.log('=== _ShowCredits(1), a lost game (Code1f9e6.cpp:66) ===');
  const graphics = stockGraphics();
  const ui = extractUITables(graphics);
  const g = ui.graphic232;
  const theEnd = graphics.getImage(6);
  const credits = graphics.getImage(5);
  const r108 = g.word108;
  console.log(`Word108 ${r108.x2 - r108.x1 + 1}x${r108.y2 - r108.y1 + 1} at (${r108.x1},${r108.y1}); graphic 6 ${theEnd.width}x${theEnd.height}`);
  check(theEnd.width === 80 && theEnd.height === 14, 'graphic 6 is 80x14: 40 bytes a line, 560 in all');
  check(r108.x2 - r108.x1 + 1 === 80 && r108.y2 - r108.y1 + 1 === 14, 'Word108 is the 80x14 BLT2Screen fills');
  check(credits.width === SCREEN_WIDTH && credits.height === SCREEN_HEIGHT, 'graphic 5 is the whole screen');

  // A key comes on the third poll: three VBLs of waiting.
  const r = recordingHost(ui, { heldAfterPolls: Infinity, keyAfterPolls: 3 });
  const log: string[] = [];
  const hooks = { queueDyingSound: () => { r.steps.push({ kind: 'sound' }); }, canRestartFromSavegame: false };
  const ending = await showCredits(r.host, hooks);
  check(ending === 'terminate', `without d.CanRestartFromSavegame the credits are the end (${ending})`);
  for (const s of r.steps) log.push(s.kind === 'sound' ? 'sound 6' : `vbl ${s.count}`);
  const compact = log.join(', ').replace(/(vbl 1, ){7}vbl 1/g, 'fade');
  console.log(compact);
  check(
    compact === `sound 6, vbl ${DYING_SOUND_VBLS}, fade, fade, vbl ${THE_END_VBLS}, fade, fade, vbl 1, vbl 1, vbl 1`,
    'the dying sound, 240, black, THE END, 300, dark blue, the credits, and a VBL a poll',
  );

  const end = r.theEnd;
  check(end !== null, 'the 300-VBL wait happens');
  if (end) {
    console.log(`THE END palette: ${end.palette.map((c) => c.toString(16).padStart(3, '0')).join(' ')}`);
    check(end.palette.every((c, i) => c === PALETTE_LOCAL_46[i]), 'THE END is shown in 0x002 with colour 15 at 0x777');
    const bitmap = { width: theEnd.width, height: theEnd.height, pixels: Uint8Array.from(theEnd.pixels) };
    check(sameRegion(end.pixels, bitmap, r108.x1, r108.y1), 'graphic 6 sits at Word108');
    let outside = 0;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const inside = x >= r108.x1 && x <= r108.x2 && y >= r108.y1 && y <= r108.y2;
        if (!inside && end.pixels[y * SCREEN_WIDTH + x] !== 0) outside++;
      }
    }
    check(outside === 0, `and the rest of the screen is cleared (${outside} pixels are not)`);
  }

  const creditsBitmap = { width: credits.width, height: credits.height, pixels: Uint8Array.from(credits.pixels) };
  check(sameRegion(r.host.screen.pixels, creditsBitmap, 0, 0), 'the screen ends on the credits picture');
  check(r.host.globalPalette.every((c, i) => c === g.palette328[i]), 'in Palette328');

  // A button already held: no VBL of waiting at all.
  const held = recordingHost(ui, { heldAfterPolls: 0, keyAfterPolls: Infinity });
  await showCredits(held.host, { queueDyingSound: () => {}, canRestartFromSavegame: false });
  const last = held.steps[held.steps.length - 1];
  console.log(`a held button: the last wait is ${last?.kind === 'vbl' ? `vbl ${last.count}` : last?.kind}`);
  check(held.steps.filter((s) => s.kind === 'vbl' && s.count === 1).length === 32, 'a held button ends the wait before its first VBL');
}

/* -------------------------------------------------- 3. RESTART THIS GAME ---- */

interface Scripted {
  host: IntroHost;
  /** `sound`, `vbl n`, and `on` / `off` as the cursor is shown and hidden. */
  log: string[];
  /** The screen and palette as each wait for the button begins. */
  buttons: { pixels: Uint8Array; palette: number[] }[];
}

/**
 * A host whose input arrives on cue. The cursor is up only while the button is: `arrive`
 * is asked after each VBL of that, with which time the button is up (from 0) and how many
 * VBLs it has been, the eight of the fade to `PALETTE_RESTART` first.
 */
function scriptedHost(ui: UITables, arrive: (time: number, vbls: number) => IntroEvent[]): Scripted {
  const graphics = stockGraphics();
  const screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  screen.pixels.fill(9);
  const r = { log: [], buttons: [] } as unknown as Scripted;
  let queue: IntroEvent[] = [];
  let cursor = false;
  let time = -1;
  let vbls = 0;
  r.host = {
    screen,
    uiTables: ui,
    font: loadFontData(graphics),
    globalPalette: [...(ui.graphic232.palette552[0] ?? PALETTE_11914)],
    getGraphic(graphicNum: number): IndexedBitmap {
      const image = graphics.getImage(graphicNum);
      return { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
    },
    present: () => {},
    vbl: (count) => {
      r.log.push(`vbl ${count}`);
      if (cursor) {
        vbls += count;
        if (vbls === 9) r.buttons.push({ pixels: screen.pixels.slice(), palette: [...r.host.globalPalette] });
        queue.push(...arrive(time, vbls));
      }
      return Promise.resolve();
    },
    startSound: () => {},
    drawPrisonInterior: () => { throw new Error('not on this screen'); },
    nextEvent: () => { throw new Error('the end screen polls, it does not wait on the queue'); },
    takeClick: () => {
      const at = queue.findIndex((event) => event.kind === 'click');
      return at < 0 ? null : queue.splice(at, 1)[0];
    },
    discardAllInput: () => { queue = []; },
    mouseSwitches: () => 0,
    keyWaiting: () => queue.some((event) => event.kind === 'key'),
    setCursorVisible: (visible) => {
      if (visible === cursor) return;
      cursor = visible;
      r.log.push(visible ? 'on' : 'off');
      if (visible) {
        time++;
        vbls = 0;
      }
    },
  };
  return r;
}

/** The log with each run of `vbl 1` counted: `1x16` is two fades. */
function compact(log: string[]): string {
  const out: string[] = [];
  let run = 0;
  for (const entry of log) {
    if (entry === 'vbl 1') {
      run++;
      continue;
    }
    if (run) out.push(`1x${run}`);
    run = 0;
    out.push(entry.startsWith('vbl ') ? entry.slice(4) : entry);
  }
  if (run) out.push(`1x${run}`);
  return out.join(', ');
}

const click = (x: number, y: number, buttons: number): IntroEvent => ({ kind: 'click', x, y, buttons });
const KEY: IntroEvent = { kind: 'key', x: 0, y: 0, buttons: 0 };

async function checkRestart(): Promise<void> {
  console.log('');
  console.log('=== RESTART THIS GAME, with d.CanRestartFromSavegame (Code1f9e6.cpp:240-348) ===');
  const graphics = stockGraphics();
  const ui = extractUITables(graphics);
  const g = ui.graphic232;
  const r116 = g.word116;
  const r124 = g.word124;
  const theEnd = graphics.getImage(6);
  const theEndBitmap = { width: theEnd.width, height: theEnd.height, pixels: Uint8Array.from(theEnd.pixels) };
  const mask = ui.graphic231.buttons.buttons16956[0]?.button;
  console.log(`Word116 (${r116.x1},${r116.y1})-(${r116.x2},${r116.y2}); Word124 (${r124.x1},${r124.y1})-(${r124.x2},${r124.y2}); Buttons16956[0] mask ${mask}`);
  // The canary for the parse: `Word116` is the button's frame, and the button's own
  // rectangle is hard-coded (`:252-255`), so the two must agree.
  check(r116.x1 === 0x67 && r116.x2 === 0xd9 && r116.y1 === 0x91 && r116.y2 === 0x9f, 'Word116 is the rectangle the button answers in');
  check(r124.x1 === r116.x1 + 2 && r124.x2 === r116.x2 - 2 && r124.y1 === r116.y1 + 2 && r124.y2 === r116.y2 - 2, 'Word124 is its face, two pixels in');
  check(mask === 2, 'and the entry the button takes over answers the left button only');

  // The button, clicked in the tenth VBL of the wait.
  const b = scriptedHost(ui, (time, vbls) => (time === 0 && vbls === 18 ? [click(160, 152, 2)] : []));
  const end = await showCredits(b.host, { queueDyingSound: () => { b.log.push('sound'); }, canRestartFromSavegame: true });
  console.log(`clicked: ${end}; ${compact(b.log)}`);
  check(end === 'restart', 'a click on the button restarts the game');
  check(
    compact(b.log) === `sound, ${DYING_SOUND_VBLS}, 1x16, ${THE_END_VBLS}, 1x1, on, 1x19, off, 1x16`,
    'THE END, a VBL, the button faded up, the click taken in the next VBL, and two fades',
  );
  check(b.host.screen.pixels.every((p) => p === 0), 'the screen is left black');
  check(b.host.globalPalette.every((c, i) => c === g.palette552[0][i]), 'in d.Palette552[0], the interface\'s palette');

  const button = b.buttons[0];
  check(button !== undefined, 'the button is up');
  if (button) {
    check(button.palette.every((c, i) => c === PALETTE_RESTART[i]), 'in LOCAL_46 with colour 1 at 0x437 and 4 at 0x777');
    let frame = 0;
    let face = 0;
    let text = 0;
    let [tx1, tx2, ty1, ty2] = [SCREEN_WIDTH, -1, SCREEN_HEIGHT, -1];
    let outside = 0;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const p = button.pixels[y * SCREEN_WIDTH + x];
        const in116 = x >= r116.x1 && x <= r116.x2 && y >= r116.y1 && y <= r116.y2;
        const in124 = x >= r124.x1 && x <= r124.x2 && y >= r124.y1 && y <= r124.y2;
        const in108 = x >= g.word108.x1 && x <= g.word108.x2 && y >= g.word108.y1 && y <= g.word108.y2;
        if (in124) {
          if (p === 4) {
            text++;
            [tx1, tx2, ty1, ty2] = [Math.min(tx1, x), Math.max(tx2, x), Math.min(ty1, y), Math.max(ty2, y)];
          } else if (p !== 0) face++;
        } else if (in116) {
          if (p !== 1) frame++;
        } else if (!in108 && p !== 0) outside++;
      }
    }
    console.log(`text in colour 4: ${text} pixels, (${tx1},${ty1})-(${tx2},${ty2})`);
    check(frame === 0, `the frame is colour 1 (${frame} pixels are not)`);
    check(face === 0, `the face is colour 0 under colour-4 text (${face} pixels are neither)`);
    check(text > 0 && tx1 >= 110 && tx2 <= 110 + 17 * 6 - 1 && ty1 >= 0x9a - 4 && ty2 <= 0x9a + 1,
      'the text is seventeen characters from x 110, on the line of y 0x9a');
    check(sameRegion(button.pixels, theEndBitmap, g.word108.x1, g.word108.y1) && outside === 0,
      `THE END is still up above it, alone (${outside} stray pixels)`);
  }

  // Clicks that miss, a key, and no click on the button: the wait runs out, the key ends
  // the credits a VBL later, and "THE END" comes back without its 300 VBLs.
  const m = scriptedHost(ui, (time, vbls) => {
    if (time === 0 && vbls === 9) return [click(50, 50, 2), click(160, 152, 1), KEY];
    if (time === 1 && vbls === 8) return [click(160, 152, 2)];
    return [];
  });
  const end2 = await showCredits(m.host, { queueDyingSound: () => { m.log.push('sound'); }, canRestartFromSavegame: true });
  console.log(`missed: ${end2}; ${compact(m.log)}`);
  check(
    compact(m.log) ===
      `sound, ${DYING_SOUND_VBLS}, 1x16, ${THE_END_VBLS}, 1x1, on, 1x${8 + RESTART_BUTTON_VBLS}, off, 1x34, on, 1x9, off, 1x16`,
    'no hit for 899 VBLs; the credits for one VBL; THE END again with no wait; the button again',
  );
  check(end2 === 'restart', 'and the second button restarts the game');
  check(m.buttons.length === 2 && m.buttons[0].pixels.every((p, i) => p === m.buttons[1]?.pixels[i]),
    'the second button is the first, drawn again');
}

async function main(): Promise<void> {
  checkTickOfDeath();
  await checkScreen();
  await checkRestart();
  finish();
}

void main();
