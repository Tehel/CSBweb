/**
 * The dialogs' widget kit: what the port's own dialogs over the screen are drawn from,
 * the save menu first (`SaveMenu.ts`).
 *
 * CSBWin has one dialog, `_DoMenu`'s graphic 0 (`Menu.ts`), and draws no widget of its
 * own. Every widget here is cut from that bitmap and drawn in the colours it uses, so no
 * art is invented: a piece of it drawn at another size keeps its corners and repeats the
 * column and the row just inside them (`drawPiece`).
 *
 * - **The plate**: graphic 0's grey frame, the dialog's ground (`drawPlate`).
 * - **The panel**: its sunken title panel, under a list or lines of text (`drawPanel`).
 * - **The button**: a frame of its bottom pair, at its own height (`BUTTON_HEIGHT`) or a
 *   lower one that fits a title line (`LOW_BUTTON_HEIGHT`), its face's rows repeated or
 *   left out. It is raised, pressed, or inert (`drawButton`). Pressed is the press
 *   animation's last picture held (`drawMenuPressPasses`); inert has no label, as CSBWin
 *   leaves an empty save slot's button unlabelled.
 * - **The list**: rows of text on a panel, the selected one inverted, beside a
 *   scrollbar in the manner of a GEM window's (`drawList`).
 * - **A row of tabs** and **a toggle**: buttons side by side, the chosen one pressed
 *   (`drawTabs`, `drawToggle`).
 * - **The slider**: a sunken track, a panel, and over it a small raised knob, the
 *   button's inner bevel around one column of its face (`drawSlider`).
 * - **The help line**: a panel one row high, at a dialog's foot (`drawHelpLine`).
 * - **A line of text**, in the menu's font and colours (`drawText`).
 *
 * Each widget hit-tests itself: it gives its clickable rectangles as a button list in
 * CSBWin's form, `x2` and `y2` exclusive, for `searchButtonList`, as `_DoMenu`'s table
 * gives its own (`buttonOf`, `choiceButtons`, `listButtons`, `sliderButton`).
 */
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import type { Rect, UIButton } from '../../data/tables/UITables';
import { MENU_GRAPHIC, MENU_OPTION_COLOR, MENU_PANEL_COLOR, drawMenuPressPasses } from './Menu';
import type { UIState } from './UIState';

/* -------------------------------------------------------------------- pieces ---- */

/**
 * A rectangle of graphic 0, and how much of each side is kept as it is when the piece is
 * drawn at another size (`drawPiece`).
 */
export interface DialogPiece extends Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The grey frame: graphic 0 whole, whose edges are plain as far as its panel, at 10. */
export const PLATE_PIECE: DialogPiece = { x1: 0, y1: 0, x2: 223, y2: 135, left: 9, top: 9, right: 9, bottom: 9 };
/** The title panel: two rows and two columns of edge around the panel colour. */
export const PANEL_PIECE: DialogPiece = { x1: 10, y1: 10, x2: 213, y2: 51, left: 2, top: 2, right: 2, bottom: 2 };
/**
 * The left frame of the bottom pair. Its bevels are six columns each; its rows are all
 * kept, so it is drawn at its own height alone.
 */
export const BUTTON_PIECE: DialogPiece = { x1: 10, y1: 99, x2: 107, y2: 125, left: 6, top: 13, right: 6, bottom: 14 };
/**
 * The same frame drawn lower: its six rows of bevel above and below kept, and the first
 * row of its face, which is plain between the bevels, repeated between them.
 */
export const LOW_BUTTON_PIECE: DialogPiece = { ...BUTTON_PIECE, top: 6, bottom: 6 };
/**
 * The knob: the frame's inner bevel, three pixels a side, light at the top and left and
 * dark at the bottom and right, around its face.
 */
export const KNOB_PIECE: DialogPiece = { x1: 13, y1: 102, x2: 104, y2: 122, left: 3, top: 3, right: 3, bottom: 3 };

/**
 * Draw a piece of graphic 0 into `box`, at the box's size. The piece's corners are kept,
 * `left` by `top` and so on; between them every row repeats the column just inside the
 * left corner, and every column the row just inside the top one. `Menu.cpp` makes its
 * layouts out of graphic 0 blitted over itself (`rect18576` to `rect18600`); this makes
 * a larger one out of the same art.
 */
export function drawPiece(ui: UIState, piece: DialogPiece, box: Rect): void {
  const graphic = ui.getGraphicBitmap(MENU_GRAPHIC);
  if (!graphic) return;
  const buf = ui.screenIndexBuffer;
  const width = box.x2 - box.x1 + 1;
  const height = box.y2 - box.y1 + 1;
  const pieceWidth = piece.x2 - piece.x1 + 1;
  const pieceHeight = piece.y2 - piece.y1 + 1;
  const along = (at: number, size: number, pieceSize: number, lead: number, trail: number): number =>
    at < lead ? at : at >= size - trail ? pieceSize - (size - at) : lead;
  for (let y = 0; y < height; y++) {
    const srcRow = (piece.y1 + along(y, height, pieceHeight, piece.top, piece.bottom)) * graphic.width;
    const dstRow = (box.y1 + y) * buf.width + box.x1;
    for (let x = 0; x < width; x++) {
      buf.pixels[dstRow + x] = graphic.pixels[srcRow + piece.x1 + along(x, width, pieceWidth, piece.left, piece.right)];
    }
  }
}

/** The plate a dialog stands on: graphic 0's grey frame, ten pixels of it around what it holds. */
export function drawPlate(ui: UIState, box: Rect): void {
  drawPiece(ui, PLATE_PIECE, box);
}

/** A sunken panel: graphic 0's title panel, two pixels of edge around the panel colour. */
export function drawPanel(ui: UIState, box: Rect): void {
  drawPiece(ui, PANEL_PIECE, box);
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

/* ---------------------------------------------------------------------- text ---- */

/** The step between two lines of text, a list's rows included. */
export const LINE_STEP = 8;
/** A character's cell is six pixels wide. */
export const CHAR_WIDTH = 6;

/** A line of text in the menu's font, `y` its baseline: option colour on the panel's by default. */
export function drawText(
  ui: UIState, s: string, x: number, y: number, color = MENU_OPTION_COLOR, background = MENU_PANEL_COLOR,
): void {
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x, y, color, background, s);
}

/** A line centred on `x` as `CenteredText` centres one (`doc/CSBwin-src/Menu.cpp:192`). */
export function drawCentredText(
  ui: UIState, s: string, x: number, y: number, color = MENU_OPTION_COLOR, background = MENU_PANEL_COLOR,
): void {
  drawText(ui, s, x - (CHAR_WIDTH / 2) * s.length, y, color, background);
}

/* -------------------------------------------------------------------- button ---- */

/** A button at the save menu's height, graphic 0's own frame's. */
export const BUTTON_HEIGHT = BUTTON_PIECE.y2 - BUTTON_PIECE.y1 + 1;
/** The low button: its bevels around a face one row of text and a row above and below it high. */
export const LOW_BUTTON_HEIGHT = LOW_BUTTON_PIECE.top + 1 + 6 + 1 + LOW_BUTTON_PIECE.bottom;

/** Raised, ready for a click; pressed, the chosen tab or choice; inert, unlabelled. */
export type ButtonLook = 'raised' | 'pressed' | 'inert';

/**
 * The rectangle a click on a button frame takes, and its press animation grows from, as
 * the table holds one: the frame less six pixels a side, `x2` and `y2` exclusive, which
 * is what `d.pButn18970` gives graphic 0's own frames.
 */
export function buttonRect(frame: Rect): Rect {
  return { x1: frame.x1 + 6, y1: frame.y1 + 6, x2: frame.x2 - 6, y2: frame.y2 - 6 };
}

/**
 * Where a label is centred in a button frame: where `_DoMenu` centres one in graphic 0's
 * own, (59,114) and (166,114) in its bottom pair (`doc/CSBwin-src/Menu.cpp:339-346`).
 * There the label's cell has five rows of the face above it and four below; on a face
 * of another height it is as nearly centred, the odd row above.
 */
export function buttonLabelAt(frame: Rect): { x: number; y: number } {
  const face = frame.y2 - frame.y1 + 1 - 12;
  return { x: ((frame.x1 + frame.x2) >> 1) + 1, y: frame.y1 + 6 + ((face - 6 + 1) >> 1) + 4 };
}

/**
 * An empty button frame, its face blank: at graphic 0's own height, or else the low
 * button's rows.
 */
export function drawButtonFrame(ui: UIState, frame: Rect): void {
  drawPiece(ui, frame.y2 - frame.y1 + 1 === BUTTON_HEIGHT ? BUTTON_PIECE : LOW_BUTTON_PIECE, frame);
}

/** A button's label, on its face. */
export function drawButtonLabel(ui: UIState, frame: Rect, label: string): void {
  const at = buttonLabelAt(frame);
  drawCentredText(ui, label, at.x, at.y);
}

/** A button: its frame, pressed or not, and its label, which an inert one has none of. */
export function drawButton(ui: UIState, frame: Rect, label: string, look: ButtonLook = 'raised'): void {
  drawButtonFrame(ui, frame);
  if (look === 'pressed') drawMenuPressPasses(ui, buttonRect(frame), 2);
  if (look !== 'inert') drawButtonLabel(ui, frame, label);
}

/** A button's entry in a button list: its `buttonRect`, for a left click. */
export function buttonOf(frame: Rect, id: number, name: string): UIButton {
  return { word0: id, ...buttonRect(frame), button: 2, name };
}

/* -------------------------------------------------------- tabs and a toggle ---- */

/** Graphic 0's nine columns between the two frames of its bottom pair. */
export const BUTTON_GAP = 9;

/**
 * `count` button frames side by side across `row`, graphic 0's nine columns apart, as
 * wide as each other; the last takes the columns the division leaves.
 */
export function framesAcross(row: Rect, count: number, gap = BUTTON_GAP): Rect[] {
  const width = Math.floor((row.x2 - row.x1 + 1 - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, i) => {
    const x1 = row.x1 + i * (width + gap);
    return { x1, y1: row.y1, x2: i === count - 1 ? row.x2 : x1 + width - 1, y2: row.y2 };
  });
}

/** A row of tabs: a button each, the selected one pressed. */
export function drawTabs(ui: UIState, frames: Rect[], labels: readonly string[], selected: number): void {
  frames.forEach((frame, i) => drawButton(ui, frame, labels[i], i === selected ? 'pressed' : 'raised'));
}

/** A toggle: two buttons, the chosen one pressed. */
export function drawToggle(ui: UIState, frames: readonly [Rect, Rect], labels: readonly [string, string], chosen: 0 | 1): void {
  drawTabs(ui, [...frames], labels, chosen);
}

/** The tabs' or the toggle's button list: `firstId` for the first, and on. */
export function choiceButtons(frames: Rect[], firstId: number, name: string): UIButton[] {
  return frames.map((frame, i) => buttonOf(frame, firstId + i, `${name}${i}`));
}

/* -------------------------------------------------------------------- slider ---- */

/** The knob's width: its two bevels and one column of face between them. */
export const KNOB_WIDTH = KNOB_PIECE.left + 1 + KNOB_PIECE.right;

/** The knob over a track at `value`, 0 at the track's left end and 1 at its right. */
export function sliderKnob(track: Rect, value: number): Rect {
  const travel = track.x2 - track.x1 + 1 - KNOB_WIDTH;
  const x1 = track.x1 + Math.round(travel * Math.max(0, Math.min(1, value)));
  return { x1, y1: track.y1, x2: x1 + KNOB_WIDTH - 1, y2: track.y2 };
}

/** A slider: a sunken track, and the knob at `value` over it. */
export function drawSlider(ui: UIState, track: Rect, value: number): void {
  drawPanel(ui, track);
  drawPiece(ui, KNOB_PIECE, sliderKnob(track, value));
}

/** The value a click at `x` sets: the knob centred under it, as far as the track's ends. */
export function sliderValueAt(track: Rect, x: number): number {
  const travel = track.x2 - track.x1 + 1 - KNOB_WIDTH;
  if (travel <= 0) return 0;
  return Math.max(0, Math.min(1, (x - track.x1 - (KNOB_WIDTH >> 1)) / travel));
}

/** The slider's entry in a button list: the whole track. */
export function sliderButton(track: Rect, id: number, name: string): UIButton {
  return { word0: id, x1: track.x1, y1: track.y1, x2: track.x2 + 1, y2: track.y2 + 1, button: 2, name };
}

/* ----------------------------------------------------------------- help line ---- */

/** The help line's height: one row of text in a panel, as a list's row sits in its own. */
export const HELP_LINE_HEIGHT = 2 + 2 + LINE_STEP + 2 + 1;

/** The help line: `text` on a panel one row high, cut at the panel's width. */
export function drawHelpLine(ui: UIState, box: Rect, text: string): void {
  drawPanel(ui, box);
  const maxChars = Math.floor((box.x2 - 1 - (box.x1 + 4) + 1) / CHAR_WIDTH);
  drawText(ui, text.slice(0, maxChars), box.x1 + 4, box.y1 + 9);
}

/* ---------------------------------------------------------------------- list ---- */

/** A list's panel, its scrollbar, and its rows: where the first is, and how many fit. */
export interface ListWidget {
  panel: Rect;
  scrollbar: Rect;
  rowFirstY: number;
  rows: number;
}

/**
 * The scrollbar: eleven columns against the list panel's right edge, from the top of its
 * clean interior, past its two rows of edge, to the bottom, short of its one.
 */
function scrollbarOf(panel: Rect): Rect {
  return { x1: panel.x2 - 11, y1: panel.y1 + 2, x2: panel.x2 - 1, y2: panel.y2 - 1 };
}

/**
 * The list a panel holds: its rows fill the panel, two pixels of it above the first and
 * two below the last.
 */
export function listIn(panel: Rect): ListWidget {
  return {
    panel,
    scrollbar: scrollbarOf(panel),
    rowFirstY: panel.y1 + 9,
    rows: Math.floor((panel.y2 - panel.y1 - 6) / LINE_STEP),
  };
}

/** Where a row's text starts, past the panel's edge. */
export function listTextX(list: ListWidget): number {
  return list.panel.x1 + 4;
}

/** The rows' clean interior: past the panel's two columns of edge, as far as the scrollbar. */
export function listInner(list: ListWidget): { x1: number; x2: number } {
  return { x1: list.panel.x1 + 2, x2: list.scrollbar.x1 - 1 };
}

/** An arrow's box is as tall as the bar is wide, its outline included. */
export function arrowBox(list: ListWidget): number {
  return list.scrollbar.x2 - list.scrollbar.x1 + 1;
}

/**
 * The up arrow, hollow and on a stem as a GEM window's is, in the nine columns and rows
 * inside its box; the down arrow is the same rows from the last to the first.
 */
const ARROW_UP = [
  '.........',
  '....#....',
  '...#.#...',
  '..#...#..',
  '.###.###.',
  '...#.#...',
  '...#.#...',
  '...###...',
  '.........',
];
/** The least a slider is tall, its two outlines included. */
export const SCROLL_SLIDER_MIN = 7;

/** The rectangle of the list's row `row`, counted from the first one shown. */
export function listRowRect(list: ListWidget, row: number): Rect {
  const y = list.rowFirstY + row * LINE_STEP;
  const inner = listInner(list);
  return { x1: inner.x1, y1: y - 5, x2: inner.x2, y2: y + 2 };
}

/** The first row shown, kept on the list's rows: no further down than its last page. */
export function clampScrollTop(list: ListWidget, count: number, scrollTop: number): number {
  const maxTop = Math.max(0, count - list.rows);
  return Math.max(0, Math.min(scrollTop, maxTop));
}

/** The first row shown once the list is scrolled to `selected`, by as little as shows it. */
export function scrollToRow(list: ListWidget, count: number, scrollTop: number, selected: number): number {
  let top = clampScrollTop(list, count, scrollTop);
  if (selected >= 0) {
    if (selected < top) top = selected;
    else if (selected >= top + list.rows) top = selected - list.rows + 1;
  }
  return top;
}

/**
 * The scrollbar's slider, its first and last rows on screen, which are its outlines. It
 * moves in the track between the arrows' boxes, whose inner outlines its own lie on at
 * either end. Its height is to the track's as the rows shown are to the list's, and its
 * place as the first row shown is to the last it can be; a list that fits its panel
 * has the whole track for a slider.
 */
export function scrollSlider(list: ListWidget, count: number, scrollTop: number): { y1: number; y2: number } {
  const { scrollbar, rows } = list;
  const box = arrowBox(list);
  const top = scrollbar.y1 + box - 1;
  const track = scrollbar.y2 - box + 1 - top + 1;
  const maxTop = count - rows;
  if (maxTop <= 0) return { y1: top, y2: top + track - 1 };
  const height = Math.max(SCROLL_SLIDER_MIN, Math.round((track * rows) / count));
  const y1 = top + Math.round(((track - height) * Math.min(scrollTop, maxTop)) / maxTop);
  return { y1, y2: y1 + height - 1 };
}

/**
 * The list's scrollbar: an outline, the two arrows in their boxes, and between them the
 * slider (`scrollSlider`), plain between its two outlines, in a track dithered of the
 * outline's colour and the panel's.
 */
function drawScrollbar(ui: UIState, list: ListWidget, count: number, scrollTop: number): void {
  const buf = ui.screenIndexBuffer;
  const { scrollbar } = list;
  const box = arrowBox(list);
  const { x1, y1, x2, y2 } = scrollbar;
  const line = (y: number): void => fillRectIndex(buf, { x1, y1: y, x2, y2: y }, MENU_OPTION_COLOR);
  fillRectIndex(buf, scrollbar, MENU_PANEL_COLOR);
  fillRectIndex(buf, { x1, y1, x2: x1, y2 }, MENU_OPTION_COLOR);
  fillRectIndex(buf, { x1: x2, y1, x2, y2 }, MENU_OPTION_COLOR);
  for (const y of [y1, y1 + box - 1, y2 - box + 1, y2]) line(y);

  const arrow = (top: number, rows: string[]): void => {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        if (row[dx] === '#') buf.pixels[(top + dy) * buf.width + x1 + 1 + dx] = MENU_OPTION_COLOR;
      }
    });
  };
  arrow(y1 + 1, ARROW_UP);
  arrow(y2 - box + 2, [...ARROW_UP].reverse());

  const slider = scrollSlider(list, count, scrollTop);
  for (let y = y1 + box; y <= y2 - box; y++) {
    if (y >= slider.y1 && y <= slider.y2) continue;
    for (let x = x1 + 1; x < x2; x++) {
      if (((x + y) & 1) === 0) buf.pixels[y * buf.width + x] = MENU_OPTION_COLOR;
    }
  }
  line(slider.y1);
  line(slider.y2);
}

/**
 * A list over its panel, which is drawn already: the scrollbar, then the rows shown from
 * `scrollTop`, the selected one inverted on a bar across the panel's interior.
 */
export function drawList(
  ui: UIState, list: ListWidget, count: number, scrollTop: number, selected: number, rowText: (index: number) => string,
): void {
  drawScrollbar(ui, list, count, scrollTop);
  for (let row = 0; row < list.rows; row++) {
    const index = scrollTop + row;
    if (index >= count) break;
    const highlighted = index === selected;
    if (highlighted) fillRectIndex(ui.screenIndexBuffer, listRowRect(list, row), MENU_OPTION_COLOR);
    drawText(ui, rowText(index), listTextX(list), list.rowFirstY + row * LINE_STEP,
      highlighted ? MENU_PANEL_COLOR : MENU_OPTION_COLOR, highlighted ? MENU_OPTION_COLOR : MENU_PANEL_COLOR);
  }
}

/**
 * The list's button list: the scrollbar's two arrows, `up` and `down`, then the rows
 * shown, `row0` for the first. The slider and the track take no click.
 */
export function listButtons(
  list: ListWidget, count: number, scrollTop: number, ids: { up: number; down: number; row0: number }, name: string,
): UIButton[] {
  const { scrollbar } = list;
  const box = arrowBox(list);
  const arrow = (id: number, y1: number, arrowName: string): UIButton => (
    { word0: id, x1: scrollbar.x1, x2: scrollbar.x2 + 1, y1, y2: y1 + box, button: 2, name: `${name}.${arrowName}` }
  );
  const buttons = [arrow(ids.up, scrollbar.y1, 'scrollUp'), arrow(ids.down, scrollbar.y2 - box + 1, 'scrollDown')];
  const visible = Math.min(list.rows, Math.max(0, count - scrollTop));
  for (let row = 0; row < visible; row++) {
    const r = listRowRect(list, row);
    buttons.push({ word0: ids.row0 + row, x1: r.x1, x2: r.x2 + 1, y1: r.y1, y2: r.y2 + 1, button: 2, name: `${name}.row${row}` });
  }
  return buttons;
}
