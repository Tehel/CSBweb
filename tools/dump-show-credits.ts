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
 * 4. **The won screen.** With `d.Word11694`: no dying sound; with switching on, eight
 *    `Darken` steps of both palettes to black, then each champion's frame, portrait, name,
 *    title and masteries over colour 12, 48 lines apart, faded up to the interface's
 *    palette; with it off, the same screen faded up to `LOCAL_78`, a static nothing has
 *    written yet: black. Graphic 208 and `d.Word132` / `d.Word140` are canaries for each
 *    other, as graphic 6 and `d.Word108` are.
 *
 * 5. **The CSB win.** A stone-room timer on an actuator of type 18, at any position, sets
 *    `d.Word11694`, clears `d.CanRestartFromSavegame` and makes `ProcessTimers` return at
 *    once, the timers behind it left queued (`Timer.cpp:2366-2372`, `CSBCode.cpp:6459-6464`).
 *    The tick ends there, and `MainLoop` waits 300 VBLs, their `vblInterrupt` and no pass,
 *    before `ShowCredits(1)` (`CSBCode.cpp:627-633`).
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
import type { MessageSink } from '../src/engine/GameHost';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { type UITables } from '../src/data/tables/UITables';
import { PALETTE_11914, type IntroEvent, type IntroHost } from '../src/renderer/intro/IntroHost';
import {
  darken,
  DYING_SOUND_VBLS,
  GRAPHIC_CHAMPION_FRAME,
  WON_CHAMPION_PITCH,
  type WonChampion,
  PALETTE_LOCAL_46,
  PALETTE_RESTART,
  RESTART_BUTTON_VBLS,
  THE_END_VBLS,
  showCredits,
} from '../src/renderer/intro/ShowCredits';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { DBType, decodeObjectID, OBJECT_ID_EOF, RoomType, type ObjectID } from '../src/core/types';
import { setActuatorType } from '../src/data/actuatorHelpers';
import { WON_GAME_VBLS } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, stockGraphics } from './lib/game';

/** The hooks of a lost game: `_StartCSB` has turned palette switching off. */
const LOST = { word11694: false, champions: [], palette11946: null };

/* ------------------------------------------------ 1. the tick of death ---- */

function champion(i: number, health: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
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
    printLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => { w.clockTicks++; },
    printNextQueued: () => {},
    vblInterrupt: () => { w.vbls++; },
  };
  w.game = newGame(data, stockGraphics(), { messages, showCredits: (word11694) => w.credits.push(word11694) });
  w.game.setRandomSeed(0x12345678);
  healths.forEach((health, i) => w.game.addChampion(champion(i, health)));
  w.game.ctx.party.state.position = new Position(6, 14, 2);
  return w;
}

/** The next `runFrame`, a game tick after the last, and what it did. */
function frame(w: Watched): { tick: number; lost: boolean; credits: number; clockTicks: number } {
  w.frames++;
  w.game.runFrame(1_000_000 + w.frames * 250);
  return {
    tick: w.game.ctx.state.tickCount,
    lost: w.game.ctx.party.state.gameIsLost,
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
    check(f.credits === 1 && w.credits[0] === false, `${label}: ShowCredits(1) is asked for once, in the frame of the death, d.Word11694 clear`);
    check(f.clockTicks === before, `${label}: the tick of death runs no scrollingText.ClockTick()`);
    check(w.game.mainLoopHasReturned(), `${label}: MainLoop has returned`);
  }
  check(lostAt > 0, `${label}: the party died within ${limit} frames`);
  const tick = w.game.ctx.state.tickCount;
  const timers = w.game.ctx.timers.getTimers().length;
  const { clockTicks, vbls } = w;
  for (let n = 1; n <= 20; n++) frame(w);
  console.log([label, 'twenty frames on', `tick ${w.game.ctx.state.tickCount}`, `timers ${w.game.ctx.timers.getTimers().length}`, `credits ${w.credits.length}`].join('\t'));
  check(w.game.ctx.state.tickCount === tick, `${label}: no tick runs after it`);
  check(w.game.ctx.timers.getTimers().length === timers, `${label}: and no timer fires`);
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
    w.game.systems.monsterAttack.poisonCharacter(0, 128);
    w.game.systems.monsterAttack.displayCharacterDamage();
    check(w.game.ctx.party.state.champions[0]!.attributes.health === 1, 'poison: the first dose leaves 1 health');
    runPastDeath('poison', w, 60);
  }

  // A death between ticks, as a click or a step would cause: the next tick runs its
  // timers, then ends before its `d.Time++` (CSBCode.cpp:658-660).
  {
    const w = watchedGame([200]);
    for (let n = 1; n <= 3; n++) frame(w);
    const tick = w.game.ctx.state.tickCount;
    w.game.systems.monsterAttack.killCharacter(0);
    check(w.credits.length === 0, 'between ticks: nothing ends until the next tick');
    runPastDeath('between ticks', w, 1);
    check(w.game.ctx.state.tickCount === tick, 'between ticks: the next tick is the last, and leaves d.Time where it was');
  }

  // One of two dies: the game goes on.
  {
    const w = watchedGame([200, 200]);
    w.game.systems.monsterAttack.killCharacter(1);
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
  const ui = graphicsTablesOf(graphics).ui;
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
  const hooks = { queueDyingSound: () => { r.steps.push({ kind: 'sound' }); }, canRestartFromSavegame: false, ...LOST };
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
  await showCredits(held.host, { queueDyingSound: () => {}, canRestartFromSavegame: false, ...LOST });
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
  const ui = graphicsTablesOf(graphics).ui;
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
  const end = await showCredits(b.host, { queueDyingSound: () => { b.log.push('sound'); }, canRestartFromSavegame: true, ...LOST });
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
  const end2 = await showCredits(m.host, { queueDyingSound: () => { m.log.push('sound'); }, canRestartFromSavegame: true, ...LOST });
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

/* ------------------------------------------------------ 4. the won game ---- */

/** Pixels of `color` in the text box whose baseline is `y`, `length` glyphs from `x`. */
function inkIn(pixels: Uint8Array, x: number, y: number, length: number, color: number, width = 6 * length): number {
  let n = 0;
  for (let py = y - 4; py < y + 2; py++) {
    for (let px = x; px < x + width; px++) if (pixels[py * SCREEN_WIDTH + px] === color) n++;
  }
  return n;
}

async function checkWon(): Promise<void> {
  console.log('');
  console.log('=== _ShowCredits(1), a won game (Code1f9e6.cpp:122-225) ===');
  const graphics = stockGraphics();
  const ui = graphicsTablesOf(graphics).ui;
  const g = ui.graphic232;
  const frame = graphics.getImage(GRAPHIC_CHAMPION_FRAME);
  const size = (r: { x1: number; x2: number; y1: number; y2: number }): string => `${r.x2 - r.x1 + 1}x${r.y2 - r.y1 + 1}`;
  console.log(`graphic 208 ${frame.width}x${frame.height}; Word132 ${size(g.word132)} at (${g.word132.x1},${g.word132.y1}); Word140 ${size(g.word140)} at (${g.word140.x1},${g.word140.y1})`);
  check(frame.width === 64 && frame.height === 43, 'graphic 208 is 64x43: 32 bytes a line, 1376 in all');
  check(size(g.word132) === '64x43', 'Word132 is the 64x43 BLT2Screen(…, 32, 10) fills');
  check(size(g.word140) === '32x29', 'Word140 is the 32x29 portrait BLT2Screen(…, 16, 1) fills');
  check(g.word140.x1 >= g.word132.x1 && g.word140.x2 <= g.word132.x2 && g.word140.y1 >= g.word132.y1 && g.word140.y2 <= g.word132.y2,
    'and the portrait sits inside the frame');

  // A portrait of colour 5, with colour 1, the transparent one, down its left column.
  const portrait: IndexedBitmap = { width: 32, height: 29, pixels: new Uint8Array(32 * 29).map((_, i) => (i % 32 === 0 ? 1 : 5)) };
  const champions: WonChampion[] = [
    { name: 'ALEX', title: 'THE BOLD', titleByte1: 'H'.charCodeAt(0), portrait, masteries: [1, 3, 10, 20] },
    { name: 'BO', title: 'X, THE KIND', titleByte1: ','.charCodeAt(0), portrait, masteries: [2, 1, 1, 1] },
  ];
  const interface552 = g.palette552[0] ?? PALETTE_11914;
  const viewport552 = g.palette552[3] ?? PALETTE_11914;

  const run = async (palette11946: readonly number[] | null) => {
    const r = recordingHost(ui, { heldAfterPolls: Infinity, keyAfterPolls: Infinity });
    const shown: { global: number[]; viewport: number[] | null }[] = [];
    r.host.present = () => { shown.push({ global: [...r.host.globalPalette], viewport: r.host.palette11946 ? [...r.host.palette11946] : null }); };
    let sounds = 0;
    const end = await showCredits(r.host, {
      queueDyingSound: () => { sounds++; }, canRestartFromSavegame: true, word11694: true, champions, palette11946,
    });
    const vbls = r.steps.map((step) => (step.kind === 'vbl' ? step.count : -1));
    return { r, shown, end, sounds, vbls };
  };

  // Switching off first: `LOCAL_78` is still what the program started with.
  const off = await run(null);
  console.log(`switching off: ${off.vbls.length} VBLs, palette ${off.r.host.globalPalette.map((c) => c.toString(16)).join(' ')}`);
  check(off.sounds === 0 && off.vbls.every((count) => count === 1) && off.vbls.length === 16,
    'switching off: no dying sound, the fade to black and a fade, a VBL a step');
  check(off.r.host.globalPalette.every((c) => c === 0), 'and LOCAL_78, never written, is black');
  check(off.end === 'terminate', 'the won screen is where the game ends, restartable or not');

  const on = await run(viewport552);
  console.log(`switching on: ${on.vbls.length} VBLs, palette ${on.r.host.globalPalette.map((c) => c.toString(16)).join(' ')}`);
  check(on.sounds === 0 && on.vbls.every((count) => count === 1) && on.vbls.length === 9 + 8,
    'switching on: eight Darken steps a VBL each, one more, and the fade');
  const first = on.shown[1];
  check(first !== undefined && first.global.every((c, i) => c === darken(interface552[i] ?? 0)) &&
    first.viewport !== null && first.viewport.every((c, i) => c === darken(viewport552[i] ?? 0)),
    'the first step darkens both palettes');
  const black = on.shown[8];
  check(black !== undefined && black.global.every((c) => c === 0) && (black.viewport ?? [1]).every((c) => c === 0),
    'the eighth leaves both black');
  check(on.shown.slice(9).every((shot) => shot.viewport === null), 'the champions are shown with switching off');
  check(on.r.host.globalPalette.every((c, i) => c === interface552[i]), 'and faded up to LOCAL_78, the interface palette');

  const pixels = on.r.host.screen.pixels;
  const at = (x: number, y: number): number => pixels[y * SCREEN_WIDTH + x]!;
  let frameOk = true;
  let portraitOk = true;
  champions.forEach((_, k) => {
    const down = WON_CHAMPION_PITCH * k;
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const px = g.word132.x1 + x;
        const py = g.word132.y1 + down + y;
        const inPortrait = px >= g.word140.x1 && px <= g.word140.x2 && py >= g.word140.y1 + down && py <= g.word140.y2 + down;
        const want = frame.pixels[y * frame.width + x]!;
        if (!inPortrait && want !== 10 && at(px, py) !== want) frameOk = false;
      }
    }
    for (let y = 0; y < 29; y++) {
      for (let x = 0; x < 32; x++) {
        const want = x === 0 ? null : 5;
        if (want !== null && at(g.word140.x1 + x, g.word140.y1 + down + y) !== want) portraitOk = false;
      }
    }
  });
  check(frameOk, 'each frame is graphic 208 at Word132, 48 lines further down each, colour 10 left out');
  check(portraitOk, 'each portrait at Word140, colour 1 left out');
  check(at(0, 0) === 12 && at(SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1) === 12, 'the rest is colour 12');

  // ALEX: the title 5 pixels after the name, then NOVICE NINJA, ` MASTER PRIEST and
  // ARCHMASTER WIZARD, 8 lines apart from the title's line + 1. BO: ", THE KIND" straight
  // after the name, and NEOPHYTE FIGHTER.
  const lines: [string, number, number, number, number][] = [
    ['ALEX', 87, 14, 4, 9], ['THE BOLD', 87 + 24 + 5, 14, 8, 9],
    ['NOVICE NINJA', 105, 23, 12, 13], ['` MASTER PRIEST', 105, 31, 15, 13], ['ARCHMASTER WIZARD', 105, 39, 17, 13],
    ['BO', 87, 62, 2, 9], ['X, THE KIND', 87 + 12, 62, 11, 9], ['NEOPHYTE FIGHTER', 105, 71, 16, 13],
  ];
  for (const [text, x, y, length, color] of lines) {
    const n = inkIn(pixels, x, y, length, color);
    console.log(`  ${text.padEnd(18)} at (${x},${y}) colour ${color}: ${n} pixels`);
    check(n > 0, `${text} is printed at (${x},${y}) in colour ${color}`);
  }
  check(inkIn(pixels, 105, 47, 17, 13) === 0 && inkIn(pixels, 105, 79, 17, 13) === 0, 'and no fourth mastery line: mastery 1 is left out');
  check(inkIn(pixels, 87 + 24, 14, 1, 9, 5) === 0, 'nor anything in the 5 pixels after ALEX');
}

/* ------------------------------------------------------- 5. the CSB win ---- */

function checkCsbWin(): void {
  console.log('');
  console.log('=== the CSB win: actuator type 18 (Timer.cpp:2366-2372, CSBCode.cpp:627-633) ===');
  const w = watchedGame([200]);
  const game = w.game;
  const dungeon = game.ctx.dungeon;
  // The first actuator on a wall of the real dungeon, made type 18.
  let found: { rn: ObjectID; x: number; y: number; z: number } | null = null;
  for (let z = 0; z < dungeon.getMapCount() && !found; z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.cellFlags.length && !found; x++) {
      for (let y = 0; y < map.cellFlags[x]!.length && !found; y++) {
        if (((map.cellFlags[x]![y]! >> 5) & 7) !== RoomType.STONE) continue;
        for (let rn = dungeon.findFirstObject(new Position(x, y, z)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (decodeObjectID(rn).category === DBType.ACTUATOR) { found = { rn, x, y, z }; break; }
        }
      }
    }
  }
  if (!found) throw new Error('no wall actuator in dungeon.dat');
  const { rn, x, y, z } = found;
  setActuatorType(dungeon.getActuatorRecord(rn)!, 18);
  // A position other than the actuator's: type 18 ignores it. And a timer due with it,
  // behind it in the queue, both due in the next tick, which runs its timers on the
  // `d.Time` of now (CSBCode.cpp:626, :660).
  const due = game.ctx.state.tickCount;
  const otherPos = (decodeObjectID(rn).position + 1) & 3;
  game.ctx.timers.createTimer(TimerFunction.TT_STONEROOM, x, y, otherPos, 0, due, z);
  game.ctx.timers.createTimer(TimerFunction.TT_OPENROOM, 0, 0, 0, 0, due, z);
  game.savedGameRead();
  console.log(`actuator ${rn.toString(16)} at (${x},${y}) level ${z}, position ${decodeObjectID(rn).position}; the timer's ${otherPos}`);

  const clockTicks = w.clockTicks;
  const f = frame(w);
  const queued = game.ctx.timers.getTimers().length;
  console.log(`the tick of the win: tick ${f.tick}, timers ${queued}, credits ${f.credits}`);
  check(f.tick === due && f.credits === 0 && !game.mainLoopHasReturned(), 'the tick of the win asks for nothing yet');
  check(game.ctx.timers.getTimers().some((t) => t.function === TimerFunction.TT_OPENROOM && t.time === due),
    'ProcessTimers returned at once: the timer behind it is still queued');
  check(w.clockTicks === clockTicks, 'and the rest of the tick did not run: no scrollingText.ClockTick()');
  check(!game.canRestartFromSavegame(), 'd.CanRestartFromSavegame is cleared');

  let creditsAt = 0;
  const vbls = w.vbls;
  for (let n = 1; n <= WON_GAME_VBLS + 20; n++) {
    const g = frame(w);
    if (g.credits > 0 && creditsAt === 0) creditsAt = n;
  }
  console.log(`credits ${creditsAt} VBLs after the tick; tick ${game.ctx.state.tickCount}; vblInterrupts ${w.vbls - vbls}; asked ${JSON.stringify(w.credits)}`);
  check(creditsAt === WON_GAME_VBLS, 'ShowCredits(1) is asked for 300 VBLs after the tick of the win');
  check(w.credits.length === 1 && w.credits[0] === true, 'once, with d.Word11694 set');
  check(game.ctx.state.tickCount === due, 'no tick runs meanwhile, nor after');
  check(w.vbls - vbls === WON_GAME_VBLS, 'and the 300 VBLs run their vblInterrupt, and no more after');
  check(game.mainLoopHasReturned(), 'MainLoop is over');
}

async function main(): Promise<void> {
  checkTickOfDeath();
  checkCsbWin();
  await checkScreen();
  await checkRestart();
  await checkWon();
  finish();
}

void main();
