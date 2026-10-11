/**
 * The dialogs' widget kit (`src/renderer/ui/Widgets.ts`): what the save menu's frames do
 * not show of it.
 *
 * The save menu draws the plate, the panel, the button at graphic 0's height and the list
 * through the kit, and `dump-save-menu.ts` and the golden frames check those. The rest of
 * the kit waits for the settings dialog: the low button, a pressed button, the tabs and
 * the toggle, the slider and the help line. Each is drawn here for real, on a screen
 * filled with a colour graphic 0 does not use, and read back:
 *
 * 1. **The art.** The low button and the knob are pieces of graphic 0 drawn at other
 *    sizes; at their own size each is the art itself, so the rows and columns they
 *    repeat are plain.
 * 2. **The button's looks.** Raised has its label on a clean face; inert is the frame
 *    alone; pressed is the raised button with the press animation's last picture over it.
 * 3. **Staying in the box.** No widget draws a pixel outside its rectangle, and every
 *    pixel it draws is a colour graphic 0 has, or the ink `_DoMenu` writes on it.
 * 4. **The hit tests.** Each widget's button list finds it, and nothing in the gaps.
 */
import type { GraphicsLoader } from '../src/data/GraphicsLoader';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import type { Rect } from '../src/data/tables/UITables';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { searchButtonList } from '../src/renderer/ui/HitTest';
import { MENU_GRAPHIC, MENU_OPTION_COLOR, MENU_PANEL_COLOR, MENU_TITLE1_COLOR, MENU_PRESS_PHASE_MS, drawMenuPress } from '../src/renderer/ui/Menu';
import type { UIState } from '../src/renderer/ui/UIState';
import * as W from '../src/renderer/ui/Widgets';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

/** A colour the menu does not use, so any pixel left in it is one no widget drew. */
let ground = 0;
const LEFT_CLICK = 2;

function makeUI(graphics: GraphicsLoader): UIState {
  const image = graphics.getImage(MENU_GRAPHIC);
  const bitmap: IndexedBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
  return newUIState(graphics, newGame(emptyDungeonData(), graphics).ctx, {
    getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? bitmap : null),
  });
}

function pixels(ui: UIState): Uint8Array {
  return ui.screenIndexBuffer.pixels;
}

function at(ui: UIState, x: number, y: number): number {
  return pixels(ui)[y * SCREEN_WIDTH + x];
}

function clear(ui: UIState): void {
  pixels(ui).fill(ground);
}

/** Pixels outside `boxes` that are not the ground, and pixels inside them in no colour of the menu's. */
function strays(ui: UIState, boxes: Rect | Rect[], colours: Set<number>): { outside: number; foreign: number } {
  const all = Array.isArray(boxes) ? boxes : [boxes];
  let outside = 0;
  let foreign = 0;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const inside = all.some((box) => W.contains(box, { x, y }));
      if (!inside && at(ui, x, y) !== ground) outside++;
      if (inside && !colours.has(at(ui, x, y))) foreign++;
    }
  }
  return { outside, foreign };
}

function countNot(ui: UIState, box: Rect, colour: number): number {
  let n = 0;
  for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) if (at(ui, x, y) !== colour) n++;
  return n;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function main(): void {
  const graphics = stockGraphics();
  const ui = makeUI(graphics);
  const image = graphics.getImage(MENU_GRAPHIC);
  // Graphic 0's own, and the ink `_DoMenu` writes on it (`Menu.cpp:200-208`, `:352-449`).
  const colours = new Set([...image.pixels, MENU_OPTION_COLOR, MENU_TITLE1_COLOR]);
  ground = [...Array(256).keys()].find((c) => !colours.has(c))!;
  console.log(`the menu's colours: ${[...colours].sort((a, b) => a - b).join(' ')}; the ground is ${ground}`);

  /* ---- 1. the art ---- */

  console.log('');
  console.log('=== the pieces, each drawn at its own size ===');
  const ownSize = (piece: W.DialogPiece): number => {
    clear(ui);
    W.drawPiece(ui, piece, piece);
    let wrong = 0;
    for (let y = piece.y1; y <= piece.y2; y++) {
      for (let x = piece.x1; x <= piece.x2; x++) if (at(ui, x, y) !== image.pixels[y * image.width + x]) wrong++;
    }
    return wrong;
  };
  for (const [name, piece] of [['low button', W.LOW_BUTTON_PIECE], ['knob', W.KNOB_PIECE]] as const) {
    const wrong = ownSize(piece);
    console.log(`  ${name}\t(${piece.x1},${piece.y1})-(${piece.x2},${piece.y2})\tkept ${piece.left}/${piece.top}/${piece.right}/${piece.bottom}\t${wrong} differ`);
    check(wrong === 0, `the ${name} at its own size is graphic 0's: what it repeats is plain`);
  }
  check(ownSize({ ...W.KNOB_PIECE, left: 2, top: 2, right: 2, bottom: 2 }) > 0, 'a knob kept two pixels a side would not be: the bevel is three');
  console.log(`  button ${W.BUTTON_HEIGHT} rows, low button ${W.LOW_BUTTON_HEIGHT}, knob ${W.KNOB_WIDTH} columns, help line ${W.HELP_LINE_HEIGHT} rows`);

  /* ---- 2. the button's looks ---- */

  console.log('');
  console.log('=== the button: raised, inert, pressed, at both heights ===');
  for (const height of [W.BUTTON_HEIGHT, W.LOW_BUTTON_HEIGHT]) {
    const frame: Rect = { x1: 40, y1: 60, x2: 103, y2: 60 + height - 1 };
    const label = 'NEW FACE';
    const draw = (look: W.ButtonLook): Uint8Array => {
      clear(ui);
      W.drawButton(ui, frame, label, look);
      return Uint8Array.from(pixels(ui));
    };
    const raised = draw('raised');
    const s = strays(ui, frame, colours);
    check(s.outside === 0 && s.foreign === 0, `a ${height}-row button stays in its frame, in the menu's colours (${s.outside} outside, ${s.foreign} foreign)`);
    const labelAt = W.buttonLabelAt(frame);
    const cell = { x1: labelAt.x - 3 * label.length, y1: labelAt.y - 4, x2: labelAt.x + 3 * label.length - 1, y2: labelAt.y + 1 };
    const face = { x1: frame.x1 + 6, y1: frame.y1 + 6, x2: frame.x2 - 6, y2: frame.y2 - 6 };
    const above = cell.y1 - face.y1;
    const below = face.y2 - cell.y2;
    console.log(`  ${height} rows: face y ${face.y1}..${face.y2}, the label's cell y ${cell.y1}..${cell.y2}, ${above} rows of face above it and ${below} below`);
    check(W.contains(face, { x: cell.x1, y: cell.y1 }) && W.contains(face, { x: cell.x2, y: cell.y2 }) && above - below >= 0 && above - below <= 1,
      `an eight-character label lies on the face, as nearly centred as its rows allow`);
    const inert = draw('inert');
    clear(ui);
    W.drawButtonFrame(ui, frame);
    check(same(inert, pixels(ui)) && countNot(ui, face, MENU_PANEL_COLOR) === 0, 'an inert button is its frame alone, its face blank');
    check(!same(raised, inert), 'and a raised one is labelled');
    const pressed = draw('pressed');
    pixels(ui).set(raised);
    drawMenuPress(ui, { buttonId: 0, rect: W.buttonRect(frame), startedMs: 0 }, MENU_PRESS_PHASE_MS);
    check(same(pressed, pixels(ui)), 'a pressed button is the raised one under the press animation\'s last picture');
  }

  /* ---- 3 and 4. tabs, a toggle, the slider and the help line ---- */

  console.log('');
  console.log('=== a row of tabs and a toggle ===');
  const row: Rect = { x1: 18, y1: 30, x2: 301, y2: 30 + W.LOW_BUTTON_HEIGHT - 1 };
  const tabs = W.framesAcross(row, 4);
  console.log(`  ${tabs.map((f) => `${f.x1}..${f.x2}`).join(', ')}`);
  check(tabs[0].x1 === row.x1 && tabs[3].x2 === row.x2 && tabs.slice(1).every((f, i) => f.x1 - tabs[i].x2 - 1 === W.BUTTON_GAP),
    'four tabs span the row, graphic 0\'s nine columns apart');
  clear(ui);
  W.drawTabs(ui, tabs, ['GAME', 'DISPLAY', 'SOUND', 'KEYS'], 1);
  const drawnTabs = Uint8Array.from(pixels(ui));
  const st = strays(ui, tabs, colours);
  check(st.outside === 0 && st.foreign === 0, `the tabs stay in their frames, the gaps left alone (${st.outside} outside, ${st.foreign} foreign)`);
  clear(ui);
  W.drawButton(ui, tabs[0], 'GAME');
  W.drawButton(ui, tabs[1], 'DISPLAY', 'pressed');
  W.drawButton(ui, tabs[2], 'SOUND');
  W.drawButton(ui, tabs[3], 'KEYS');
  check(same(drawnTabs, pixels(ui)), 'the selected tab is drawn pressed, the others raised');
  const tabList = W.choiceButtons(tabs, 300, 'tab');
  const centre = (f: Rect): [number, number] => [(f.x1 + f.x2) >> 1, (f.y1 + f.y2) >> 1];
  check(tabs.every((f, i) => searchButtonList(tabList, ...centre(f), LEFT_CLICK) === 300 + i)
    && searchButtonList(tabList, tabs[0].x2 + 4, centre(tabs[0])[1], LEFT_CLICK) === 0,
    'a click on a tab finds it, and one between two tabs nothing');

  const pair = W.framesAcross({ x1: 120, y1: 60, x2: 239, y2: 60 + W.LOW_BUTTON_HEIGHT - 1 }, 2) as [Rect, Rect];
  clear(ui);
  W.drawToggle(ui, pair, ['ON', 'OFF'], 1);
  const toggled = Uint8Array.from(pixels(ui));
  clear(ui);
  W.drawTabs(ui, pair, ['ON', 'OFF'], 1);
  check(same(toggled, pixels(ui)), 'a toggle is two tabs, the chosen one pressed');

  console.log('');
  console.log('=== the slider ===');
  const track: Rect = { x1: 100, y1: 100, x2: 199, y2: 108 };
  for (const value of [0, 0.25, 0.8, 1]) {
    clear(ui);
    W.drawSlider(ui, track, value);
    const knob = W.sliderKnob(track, value);
    const ss = strays(ui, track, colours);
    const back = W.sliderValueAt(track, (knob.x1 + knob.x2) >> 1);
    console.log(`  ${value}: knob x ${knob.x1}..${knob.x2}, a click on its middle sets ${back.toFixed(3)}`);
    check(ss.outside === 0 && ss.foreign === 0, `the slider at ${value} stays on its track (${ss.outside} outside, ${ss.foreign} foreign)`);
    check(Math.abs(back - value) <= 1 / (track.x2 - track.x1 + 1 - W.KNOB_WIDTH), `a click on the knob's middle sets ${value} again, to a column`);
  }
  check(W.sliderKnob(track, 0).x1 === track.x1 && W.sliderKnob(track, 1).x2 === track.x2, 'the knob runs from end to end of the track');
  check(W.sliderValueAt(track, track.x1) === 0 && W.sliderValueAt(track, track.x2) === 1, 'a click at either end sets that end');
  clear(ui);
  W.drawSlider(ui, track, 0);
  const knob0 = W.sliderKnob(track, 0);
  check(at(ui, knob0.x1, knob0.y1) !== at(ui, knob0.x2, knob0.y2), 'the knob is lit at its top left and shaded at its bottom right');
  const sliderList = [W.sliderButton(track, 400, 'volume')];
  check(searchButtonList(sliderList, track.x1, track.y1, LEFT_CLICK) === 400 && searchButtonList(sliderList, track.x2, track.y2, LEFT_CLICK) === 400
    && searchButtonList(sliderList, track.x2 + 1, track.y1, LEFT_CLICK) === 0, 'a click anywhere on the track finds the slider, and beside it nothing');

  console.log('');
  console.log('=== the help line ===');
  const help: Rect = { x1: 8, y1: 177, x2: 311, y2: 177 + W.HELP_LINE_HEIGHT - 1 };
  const long = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG, AND THEN OVER THE LAZY DOG AGAIN';
  clear(ui);
  W.drawHelpLine(ui, help, long);
  const sh = strays(ui, help, colours);
  check(sh.outside === 0 && sh.foreign === 0, `the help line stays in its box (${sh.outside} outside, ${sh.foreign} foreign)`);
  const edge = { x1: help.x2 - 1, y1: help.y1 + 2, x2: help.x2 - 1, y2: help.y2 - 1 };
  check(countNot(ui, edge, MENU_PANEL_COLOR) === 0, 'a line too long for it is cut short of its right edge');
  const line = { x1: help.x1 + 2, y1: help.y1 + 4, x2: help.x2 - 1, y2: help.y1 + 11 };
  check(countNot(ui, line, MENU_PANEL_COLOR) > 0 && countNot(ui, { ...line, y1: help.y1 + 2, y2: help.y1 + 3 }, MENU_PANEL_COLOR) === 0
    && countNot(ui, { ...line, y1: help.y1 + 12, y2: help.y2 - 1 }, MENU_PANEL_COLOR) === 0,
    'its text sits on the panel as a list\'s row does, two rows of panel above and below');

  finish();
}

main();
