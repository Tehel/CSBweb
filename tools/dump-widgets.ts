/**
 * The dialogs' widget kit (`src/renderer/ui/Widgets.ts`): what the save menu's frames do
 * not show of it.
 *
 * The save menu draws the plate, the panel, the button at graphic 0's height and the list
 * through the kit, and `dump-save-menu.ts` and the golden frames check those. The rest of
 * the kit waits for the settings dialog: the low button, a hovered and a pressed button,
 * the toggle, the tabbed page, the slider and the help line. Their looks are the design
 * canvas's widget kit (`DEBT.md` → "U — The interface in the canvas"). Each is drawn here for real, on a screen
 * filled with a colour graphic 0 does not use, and read back:
 *
 * 1. **The art.** The low button and the knob are pieces of graphic 0 drawn at other
 *    sizes; at their own size each is the art itself, so the rows and columns they
 *    repeat are plain.
 * 2. **The button's looks.** Raised has its label on a clean face; inert is the frame
 *    alone; hovered lights the label; pressed lights it and turns the bevel over, its
 *    light and its shade changing places, and nothing else; dim greys the label.
 * 3. **Staying in the box.** No widget draws a pixel outside its rectangle, and every
 *    pixel it draws is a colour graphic 0 has, or the ink `_DoMenu` writes on it.
 * 4. **The hit tests.** Each widget's button list finds it, and nothing in the gaps.
 */
import type { GraphicsLoader } from '../src/data/GraphicsLoader';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import type { Rect } from '../src/data/tables/UITables';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { searchButtonList } from '../src/renderer/ui/HitTest';
import { MENU_GRAPHIC, MENU_OPTION_COLOR, MENU_PANEL_COLOR, MENU_TITLE1_COLOR } from '../src/renderer/ui/Menu';
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
  console.log(`  button ${W.BUTTON_HEIGHT} rows, low button ${W.LOW_BUTTON_HEIGHT}, knob ${W.KNOB_SIZE} square, help line ${W.HELP_LINE_HEIGHT} rows`);

  /* ---- 2. the button's looks ---- */

  console.log('');
  console.log('=== the button: raised, inert, hovered, pressed, dim, at both heights ===');
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
    // Each look against the raised button, pixel by pixel: the label's ink, the bevel's
    // ring three pixels inside the frame, and everything else.
    const ring = (x: number, y: number): boolean => W.contains({ x1: frame.x1 + 3, y1: frame.y1 + 3, x2: frame.x2 - 3, y2: frame.y2 - 3 }, { x, y })
      && !W.contains(face, { x, y });
    const turned: Record<number, number> = { 10: 3, 3: 10, 15: 12, 12: 15 };
    const compare = (look: Uint8Array, bevelTurned: boolean, ink = W.LIT_COLOR): { ink: number; bevel: number; rest: number } => {
      const wrong = { ink: 0, bevel: 0, rest: 0 };
      for (let y = frame.y1; y <= frame.y2; y++) {
        for (let x = frame.x1; x <= frame.x2; x++) {
          const i = y * SCREEN_WIDTH + x;
          if (W.contains(cell, { x, y }) && raised[i] === MENU_OPTION_COLOR) {
            if (look[i] !== ink) wrong.ink++;
          } else if (ring(x, y) && bevelTurned) {
            if (look[i] !== (turned[raised[i]] ?? raised[i])) wrong.bevel++;
          } else if (look[i] !== raised[i]) {
            wrong.rest++;
          }
        }
      }
      return wrong;
    };
    const hover = compare(draw('hover'), false);
    check(hover.ink + hover.bevel + hover.rest === 0, `a hovered button is the raised one, its label lit (${JSON.stringify(hover)} differ)`);
    const pressed = draw('pressed');
    const press = compare(pressed, true);
    check(press.ink + press.bevel + press.rest === 0, `a pressed button is the raised one, its label lit and its bevel turned over (${JSON.stringify(press)} differ)`);
    const topLeft = pixels(ui)[(frame.y1 + 4) * SCREEN_WIDTH + frame.x1 + 20];
    const bottomRight = pixels(ui)[(frame.y2 - 4) * SCREEN_WIDTH + frame.x1 + 20];
    console.log(`  pressed: its bevel's top in ${topLeft}, its bottom in ${bottomRight}; raised: ${raised[(frame.y1 + 4) * SCREEN_WIDTH + frame.x1 + 20]} and ${raised[(frame.y2 - 4) * SCREEN_WIDTH + frame.x1 + 20]}`);
    check(topLeft === 3 && bottomRight === 10, 'pressed, the shade is at the top and the light at the bottom');
    const dim = compare(draw('dim'), false, W.DIM_COLOR);
    check(dim.ink + dim.bevel + dim.rest === 0, `a dim button is the raised one, its label grey (${JSON.stringify(dim)} differ)`);
  }

  /* ---- 3 and 4. a toggle, a tabbed page, the slider and the help line ---- */

  console.log('');
  console.log('=== a toggle ===');
  const centre = (f: Rect): [number, number] => [(f.x1 + f.x2) >> 1, (f.y1 + f.y2) >> 1];
  const pair = W.framesAcross({ x1: 120, y1: 60, x2: 239, y2: 60 + W.LOW_BUTTON_HEIGHT - 1 }, 2);
  check(pair[1].x1 - pair[0].x2 - 1 === W.BUTTON_GAP && pair[1].x2 === 239, 'its two frames span the row, graphic 0\'s nine columns apart');
  clear(ui);
  W.drawToggle(ui, pair, ['ON', 'OFF'], 1);
  const toggled = Uint8Array.from(pixels(ui));
  const pt = strays(ui, pair, colours);
  check(pt.outside === 0 && pt.foreign === 0, `the toggle stays in its frames, the gap left alone (${pt.outside} outside, ${pt.foreign} foreign)`);
  clear(ui);
  W.drawButton(ui, pair[0], 'ON');
  W.drawButton(ui, pair[1], 'OFF', 'pressed');
  check(same(toggled, pixels(ui)), 'a toggle is two buttons, the chosen one pressed');
  const pairList = W.choiceButtons(pair, 300, 'toggle');
  check(pair.every((f, i) => searchButtonList(pairList, ...centre(f), LEFT_CLICK) === 300 + i)
    && searchButtonList(pairList, pair[0].x2 + 4, centre(pair[0])[1], LEFT_CLICK) === 0,
    'a click on a side finds it, and one between the two nothing');

  console.log('');
  console.log('=== a tabbed page ===');
  const page: Rect = { x1: 5, y1: 60, x2: 314, y2: 150 };
  const tabs = W.tabsOver(page, 4, 64);
  console.log(`  ${tabs.map((f) => `${f.x1}..${f.x2}`).join(', ')}, y ${tabs[0].y1}..${tabs[0].y2}`);
  check(tabs.every((t) => t.y2 === page.y1 + 1 && t.y2 - t.y1 + 1 === W.TAB_HEIGHT) && tabs[0].x1 === page.x1 + 4
    && tabs.slice(1).every((t, i) => t.x1 - tabs[i].x2 - 1 === 2),
    'the tabs stand on the page\'s top edge, from four columns into it, two apart');
  clear(ui);
  W.drawTabbedPage(ui, page, tabs, ['GAME', 'DISPLAY', 'SOUND', 'KEYS'], 1, 2);
  const tp = strays(ui, [page, ...tabs.map((t, i) => (i === 1 ? t : { ...t, y1: t.y1 + 2 }))], colours);
  check(tp.outside === 0 && tp.foreign === 0, `the page and its tabs stay in their rectangles (${tp.outside} outside, ${tp.foreign} foreign)`);
  const [mid0] = centre(tabs[0]);
  const [mid1] = centre(tabs[1]);
  check(at(ui, mid1, page.y1) === W.PLATE_COLOR && at(ui, mid1, page.y1 + 1) === W.PLATE_COLOR && at(ui, mid1, tabs[1].y1) !== ground,
    'the selected tab is open into the page, and full height');
  check(at(ui, mid0, page.y1) !== W.PLATE_COLOR && at(ui, mid0, page.y1 + 1) !== W.PLATE_COLOR,
    'another is closed by the page\'s edge');
  check(at(ui, mid0, tabs[0].y1) === ground && at(ui, mid0, tabs[0].y1 + 1) === ground && at(ui, mid0, tabs[0].y1 + 2) !== ground,
    'and stands two rows lower');
  check(countNot(ui, { x1: page.x1 + 2, y1: page.y1 + 2, x2: page.x2 - 2, y2: page.y2 - 2 }, W.PLATE_COLOR) === 0, 'the page is the plate\'s grey');
  const lit = (t: Rect) => countNot(ui, t, W.LIT_COLOR) < (t.x2 - t.x1 + 1) * (t.y2 - t.y1 + 1);
  check(lit(tabs[1]) && lit(tabs[2]) && !lit(tabs[0]) && !lit(tabs[3]), 'the selected and the hovered tab are lit, the others not');
  const tabList = W.tabButtons(tabs, 400, 'tab');
  check(tabs.every((t, i) => searchButtonList(tabList, ...centre(t), LEFT_CLICK) === 400 + i)
    && searchButtonList(tabList, tabs[0].x2 + 1, centre(tabs[0])[1], LEFT_CLICK) === 0
    && searchButtonList(tabList, mid0, page.y1 + 4, LEFT_CLICK) === 0,
    'a click on a tab finds it, and one between two tabs or on the page nothing');

  console.log('');
  console.log('=== the slider ===');
  const slider: Rect = { x1: 100, y1: 100, x2: 199, y2: 100 + W.SLIDER_HEIGHT - 1 };
  const track = W.sliderTrack(slider);
  console.log(`  slider (${slider.x1},${slider.y1})-(${slider.x2},${slider.y2}), its track y ${track.y1}..${track.y2}`);
  for (const value of [0, 0.25, 0.8, 1]) {
    clear(ui);
    W.drawSlider(ui, slider, value);
    const knob = W.sliderKnob(slider, value);
    const ss = strays(ui, slider, colours);
    const back = W.sliderValueAt(slider, (knob.x1 + knob.x2) >> 1);
    console.log(`  ${value}: knob x ${knob.x1}..${knob.x2}, a click on its middle sets ${back.toFixed(3)}`);
    check(ss.outside === 0, `the slider at ${value} stays in its rectangle (${ss.outside} outside)`);
    check(Math.abs(back - value) <= 1 / (slider.x2 - slider.x1 + 1 - W.KNOB_SIZE), `a click on the knob's middle sets ${value} again, to a column`);
  }
  check(W.sliderKnob(slider, 0).x1 === slider.x1 && W.sliderKnob(slider, 1).x2 === slider.x2, 'the knob runs from end to end of the track');
  check(W.sliderValueAt(slider, slider.x1) === 0 && W.sliderValueAt(slider, slider.x2) === 1, 'a click at either end sets that end');
  clear(ui);
  W.drawSlider(ui, slider, 1);
  const knob1 = W.sliderKnob(slider, 1);
  const bare = { x1: track.x1 + 1, y1: track.y1 + 1, x2: knob1.x1 - 1, y2: track.y2 - 1 };
  check(countNot(ui, bare, 0) === 0 && countNot(ui, { ...bare, y1: track.y1, y2: track.y1 }, 12) === 0
    && countNot(ui, { ...bare, y1: track.y2, y2: track.y2 }, 2) === 0 && at(ui, track.x1, track.y1 + 2) === 12,
    'the track is black, under an edge dark at the top and left and lit at the bottom');
  check(countNot(ui, { x1: slider.x1, y1: slider.y1, x2: knob1.x1 - 1, y2: track.y1 - 1 }, ground) === 0
    && countNot(ui, { x1: slider.x1, y1: track.y2 + 1, x2: knob1.x1 - 1, y2: slider.y2 }, ground) === 0,
    'beside the knob, the rows above and below the track are left alone');
  check(at(ui, knob1.x1, knob1.y1) === 0 && at(ui, knob1.x1 + 1, knob1.y1 + 1) === 15 && at(ui, knob1.x1 + 2, knob1.y1 + 1) === 10
    && at(ui, knob1.x2 - 1, knob1.y2 - 2) === 3,
    'the knob is ringed in black, lit at its top left and shaded at its bottom right');
  const sliderList = [W.sliderButton(slider, 400, 'volume')];
  check(searchButtonList(sliderList, slider.x1, slider.y1, LEFT_CLICK) === 400 && searchButtonList(sliderList, slider.x2, slider.y2, LEFT_CLICK) === 400
    && searchButtonList(sliderList, slider.x2 + 1, slider.y1, LEFT_CLICK) === 0, 'a click anywhere on the slider finds it, and beside it nothing');

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
