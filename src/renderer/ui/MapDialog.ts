/**
 * The map dialog: a level of the dungeon, drawn whole in the game's own screen, and beside
 * it what a square is, holds and does, as the dialog over the game (`Dialog.ts`), from the
 * widget kit (`Widgets.ts`). It is the port's own: CSBWin draws no map.
 *
 * ## The dialog
 *
 * It takes the whole screen, 320x200, as the settings do. From the top:
 *
 * - **The title line**: `<` and `>`, the level before and after, dim at the first and the
 *   last; between them, on a panel, the level's number, LEVEL 1 the dungeon's first, as
 *   the player counts them (the map's descriptor counts from 0), and the square under the
 *   pointer, `(x,y)`; then the marks' toggles, G, M and I, at most one pressed; at the
 *   right, CLOSE.
 * - **The map**, on a panel at the left, as wide as the level needs: a square a cell, at
 *   the largest whole size that fits (`mapLayout`), a column and a row of black between two
 *   cells. A cell's colour is its room type's (`ROOM_COLORS`), in the UI palette: stone,
 *   floor, pit, stairs, door, teleporter and false wall. Above the cells, their columns'
 *   numbers, and at their left their rows', counted from 0 on the level as actuator
 *   targets count them: the first, the last, and every 2nd, 5th or 10th between that has
 *   room. On the party's level its square holds a triangle, lit, its tip the way it faces.
 *   The square under the pointer has a grey outline, the square shown beside the map a
 *   white one, and the squares its info names on this level (links) an orange one. With
 *   a toggle pressed, the squares it marks hold a lit cross (`CellInfo.marked`): G a
 *   monster generator, M a group of monsters, I an item. A click on a toggle presses it
 *   and lets the others go, or lets it go; the mark is kept across levels, and across a
 *   closing for the page's life.
 * - **The info**, on a panel at the right, down to the plate's foot: the square's info
 *   (`src/engine/CellInfo.ts`), a list that scrolls, its lines cut to the panel's width.
 *   A line naming a square is a link, white, lit under the pointer: a click on it shows
 *   that square, on its level.
 *
 * Every square is drawn and described, seen or not: a map of only the cells the party
 * has seen is X10's data, and a later mode of this dialog.
 *
 * ## Opening and closing
 *
 * Only with MAP VIEW on (`SettingsValues.mapView`): the key bound to MAP, which no preset
 * binds, or a long press on the message area (`GameInput`). It opens on the party's level,
 * the party's square shown. Esc, the MAP key again, CLOSE or a right click close it. While
 * it is up the clock is held, as under every dialog, and the game is left as it was. It is
 * shown through the interface's palette whole, as the settings are (`SettingsDialog.ts` →
 * "The palette").
 *
 * A click on a square shows it. With the page opened with `?dev`, a press held there
 * `MESSAGE_LONG_PRESS_MS` moves the party to it (`UIState.onTeleport`), facing as it
 * was; to another level, the dialog closes, as the level is loaded at the next tick.
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import type { MapData } from '../../data/dungeonTypes';
import { RoomType, getRoomType } from '../../core/types';
import { CellInfo, type CellMark, type CellRef } from '../../engine/CellInfo';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { foldToFont } from '../csbwin/TextRenderer';
import { MESSAGE_LONG_PRESS_MS, closeDialog, openDialog, type Dialog, type DialogPoint } from './Dialog';
import { searchButtonList } from './HitTest';
import { keyAction } from './Keyboard';
import { MENU_OPTION_COLOR, MENU_TITLE1_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  CHAR_WIDTH,
  LINE_STEP,
  LIT_COLOR,
  LOW_BUTTON_HEIGHT,
  buttonLabelAt,
  buttonOf,
  clampScrollTop,
  drawButton,
  drawCentredText,
  drawList,
  drawPanel,
  drawPlate,
  drawText,
  framesAcross,
  listButtons,
  listIn,
  listInner,
  listTextX,
  wheelRows,
  type ButtonLook,
  type ListWidget,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

/** All in screen coordinates, the title line where the settings have theirs. */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const CLOSE_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
/** A low button holding one character: its label's cell and seven columns a side. */
const SMALL_WIDTH = 20;
/** The columns between two frames of the title line, and between two of the marks'. */
const TITLE_GAP = 6;
const MARK_GAP = 2;
/** The marks' three toggles, G, M and I, side by side left of CLOSE. */
export const MARK_FRAMES = framesAcross(
  { x1: CLOSE_FRAME.x1 - TITLE_GAP - 3 * SMALL_WIDTH - 2 * MARK_GAP, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - TITLE_GAP - 1, y2: TITLE_Y2 }, 3, MARK_GAP);
/** The level before, at the left, and the level after, left of the marks. */
export const PREV_FRAME: Rect = { x1: 10, y1: TITLE_Y1, x2: 10 + SMALL_WIDTH - 1, y2: TITLE_Y2 };
export const NEXT_FRAME: Rect = { x1: MARK_FRAMES[0].x1 - TITLE_GAP - SMALL_WIDTH, y1: TITLE_Y1, x2: MARK_FRAMES[0].x1 - TITLE_GAP - 1, y2: TITLE_Y2 };
/** The level's number and the square under the pointer, on a panel between `<` and `>`. */
export const TITLE_PANEL: Rect = { x1: PREV_FRAME.x2 + TITLE_GAP + 1, y1: TITLE_Y1, x2: NEXT_FRAME.x1 - TITLE_GAP - 1, y2: TITLE_Y2 };
/** The map's panel and the info's: six rows of the plate under the title line, down to the plate's frame. */
const BODY_Y1 = TITLE_Y2 + 7;
const BODY_Y2 = 189;
/** A row's number, two digits and a column of the panel before the cells. */
const LABEL_WIDTH = 2 * CHAR_WIDTH + 1;
/** The columns' numbers, a line of text above the cells. */
const LABEL_HEIGHT = LINE_STEP;
/** The widest the cells are drawn, a level 32 wide at 4 pixels a cell: the info keeps 21 characters. */
export const MAX_GRID_WIDTH = 128;

/** Where a map of `width` by `height` cells is drawn: a cell's size, its first cell's corner, and the two panels. */
export interface MapLayout {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly panel: Rect;
  readonly info: Rect;
}

/**
 * The largest whole cell that fits the map under its columns' numbers and right of its
 * rows', no wider than `MAX_GRID_WIDTH`; the map's panel just wide enough for it and the
 * numbers, and the info's panel the rest of the plate's width.
 */
export function mapLayout(width: number, height: number): MapLayout {
  const x0 = DIALOG.x1 + 10 + 4 + LABEL_WIDTH;
  const y0 = BODY_Y1 + 4 + LABEL_HEIGHT;
  const gridHeight = BODY_Y2 - 4 - y0 + 1;
  const cell = Math.max(1, Math.min(Math.floor(gridHeight / height), Math.floor(MAX_GRID_WIDTH / width)));
  // Past the cells, a column of black, and room for the last column's number centred over it.
  const panel: Rect = { x1: DIALOG.x1 + 10, y1: BODY_Y1, x2: x0 + width * cell + 6, y2: BODY_Y2 };
  return { cell, x0, y0, panel, info: { x1: panel.x2 + 7, y1: BODY_Y1, x2: DIALOG.x2 - 10, y2: BODY_Y2 } };
}

/** A cell's square of colour: the cell less its column and row of black, but at a size of 1. */
export function cellSquare(layout: MapLayout, x: number, y: number): Rect {
  const size = layout.cell > 1 ? layout.cell - 1 : 1;
  const x1 = layout.x0 + x * layout.cell;
  const y1 = layout.y0 + y * layout.cell;
  return { x1, y1, x2: x1 + size - 1, y2: y1 + size - 1 };
}

/**
 * The numbers along an axis of `count` cells of `cell` pixels, each needing `room` pixels:
 * the first, the last, and every `step`th between, the least step of 1, 2, 5 and 10 that
 * gives them room, a number too near the last left out.
 */
export function axisLabels(count: number, cell: number, room: number): number[] {
  const step = [1, 2, 5, 10].find((s) => s * cell >= room) ?? 10;
  const last = count - 1;
  const labels: number[] = [];
  for (let n = 0; n < last; n += step) {
    if (n === 0 || (last - n) * cell >= room) labels.push(n);
  }
  labels.push(last);
  return labels;
}

/* ------------------------------------------------------------------ contents ---- */

/** A room type's colour, in the UI palette (`palette552[0]`). */
export const ROOM_COLORS: Readonly<Record<number, number>> = {
  [RoomType.STONE]: 12, // 0x222, dark grey
  [RoomType.OPEN]: 2, // 0x444, grey
  [RoomType.PIT]: 0, // black, a hole in the floor
  [RoomType.STAIRS]: 7, // 0x060, green
  [RoomType.DOOR]: 10, // 0x643, tan
  [RoomType.TELEPORTER]: 4, // 0x066, cyan
  [RoomType.FALSEWALL]: 8, // 0x700, red
};
/** A room type no dungeon of DM's has, `EMPTY`: light grey (0x777). */
export const OTHER_ROOM_COLOR = 15;
/** The party's triangle: lit, a hovered button's label's yellow. */
export const PARTY_COLOR = LIT_COLOR;
/** The outline of the square under the pointer: grey, 0x555. */
export const HOVER_COLOR = 13;
/** The outline of the square shown, and a link of the info: white, 0x777. */
export const SELECTED_COLOR = 15;
/** The outline of a square the info names: the option colour, orange. */
export const RELATED_COLOR = MENU_OPTION_COLOR;
/** A link of the info: white, as the square shown is outlined; lit under the pointer. */
export const LINK_COLOR = SELECTED_COLOR;

export const CLOSE_LABEL = 'CLOSE';
/** The marks, in their toggles' order, and their labels. */
export const MARKS = ['generator', 'monster', 'item'] as const satisfies readonly CellMark[];
export const MARK_LABELS = ['G', 'M', 'I'] as const;
/** A marked square's cross: lit, as its toggle's label is pressed. */
export const MARK_COLOR = LIT_COLOR;

/** The title: the level's number, counted from 1. */
export function mapTitle(map: MapData): string {
  return `LEVEL ${map.descriptor.level + 1}`;
}

/** What the info says before a square is shown. */
const NOTHING_SHOWN = 'Click a square to see what it is, holds and does.';

/* --------------------------------------------------------------------- state ---- */

/** A row of the info's list: a line of text, cut to the panel's width, and the square it names. */
export interface InfoRow {
  readonly text: string;
  readonly link?: CellRef;
}

export interface MapDialogState {
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
  /** The map shown, its index. */
  map: number;
  /** The square whose info is shown, or `null`. */
  selected: CellRef | null;
  /** The info of `selected`, a row at a time, and the first row shown. */
  rows: InfoRow[];
  scrollTop: number;
  /** The wheel's travel not yet a row (`wheelRows`). */
  wheelDelta: number;
  /** The dungeon described, made at the opening, while the clock is held. */
  info: CellInfo;
  /** What the map marks, or `null` (`UIState.mapDialogMark`). */
  mark: CellMark | null;
  /** The `?dev` press held on a square, its timer, or `null`. */
  press: { at: CellRef; timer: ReturnType<typeof setTimeout> } | null;
}

const MAP_DIALOG: Dialog = {
  uiPalette: true,
  draw: (ui) => drawMapDialog(ui),
  click: (ui, x, y, buttons) => mapDialogClick(ui, x, y, buttons),
  key: (ui, _key, code) => {
    if (code === 'Escape' || keyAction(code) === 'map') closeMapDialog(ui);
  },
  wheel: (ui, deltaY) => mapDialogWheel(ui, deltaY),
  pointer: (ui, point) => mapDialogPointer(ui, point),
  drag: (ui, x, y) => mapDialogDrag(ui, x, y),
  release: (ui) => releasePress(ui),
};

/** Put the dialog up, with MAP VIEW on and no other dialog up, on the party's square. Says whether it did. */
export function openMapDialog(ui: UIState): boolean {
  if (ui.dialog || !ui.settings.values.mapView) return false;
  openDialog(ui, MAP_DIALOG);
  const party = ui.ctx.party.state;
  ui.mapDialog = {
    pointer: ui.hoverPoint,
    map: party.position.z,
    selected: null,
    rows: [],
    scrollTop: 0,
    wheelDelta: 0,
    info: new CellInfo({ dungeon: ui.ctx.dungeon, tables: ui.ctx.tables, objectNames: ui.objectTables.objectNames, party }),
    mark: ui.mapDialogMark,
    press: null,
  };
  selectSquare(ui, { map: party.position.z, x: party.position.x, y: party.position.y });
  return true;
}

export function closeMapDialog(ui: UIState): void {
  if (!ui.mapDialog) return;
  releasePress(ui);
  ui.mapDialogMark = ui.mapDialog.mark;
  ui.mapDialog = null;
  closeDialog(ui);
}

/** The map shown. */
function shownMap(ui: UIState, state: MapDialogState): MapData | undefined {
  return ui.ctx.dungeon.getData().maps[state.map];
}

/** The layout of the map shown. */
function layoutOf(map: MapData): MapLayout {
  return mapLayout(map.descriptor.width, map.descriptor.height);
}

/** The info's list, over its panel. */
function infoList(map: MapData): ListWidget {
  return listIn(layoutOf(map).info);
}

/** How many characters a row of the info's list holds. */
function rowChars(list: ListWidget): number {
  return Math.floor((listInner(list).x2 - listTextX(list) + 1) / CHAR_WIDTH);
}

/**
 * Show `at`, on its level: its info cut into rows, each line `indent` characters in and
 * its next rows one further, broken at a space where one is.
 */
function selectSquare(ui: UIState, at: CellRef | null): void {
  const state = ui.mapDialog;
  if (!state) return;
  if (at) state.map = at.map;
  const map = shownMap(ui, state);
  if (!map) return;
  state.selected = at;
  state.scrollTop = 0;
  const width = rowChars(infoList(map));
  const lines = at ? state.info.describe(at) : [{ text: NOTHING_SHOWN, indent: 0 }];
  state.rows = lines.flatMap((line) => wrap(foldToFont(line.text), width, line.indent)
    .map((text) => (line.link ? { text, link: line.link } : { text })));
}

/** `text` cut into rows of `width` characters, the first `indent` in and the rest one further. */
export function wrap(text: string, width: number, indent: number): string[] {
  const rows: string[] = [];
  let rest = text;
  let pad = Math.min(indent, width - 1);
  while (rest.length > 0) {
    const room = Math.max(1, width - pad);
    let cut = rest.length <= room ? rest.length : rest.lastIndexOf(' ', room);
    if (cut <= 0) cut = room;
    rows.push(' '.repeat(pad) + rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    pad = Math.min(indent + 1, width - 1);
  }
  return rows;
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;
const BTN_PREV = 2;
const BTN_NEXT = 3;
const BTN_UP = 4;
const BTN_DOWN = 5;
/** The marks' toggles, in `MARKS`' order. */
const BTN_MARK0 = 6;
const BTN_ROW0 = 16;

/** The dialog's button list, in the form of CSBWin's: CLOSE, `<`, `>`, the marks, then the info's arrows and rows. */
function mapDialogButtons(ui: UIState, state: MapDialogState): UIButton[] {
  const buttons = [
    buttonOf(CLOSE_FRAME, BTN_CLOSE, 'map.close'),
    buttonOf(PREV_FRAME, BTN_PREV, 'map.prev'),
    buttonOf(NEXT_FRAME, BTN_NEXT, 'map.next'),
    ...MARK_FRAMES.map((frame, i) => buttonOf(frame, BTN_MARK0 + i, `map.${MARKS[i]}`)),
  ];
  const map = shownMap(ui, state);
  if (map) buttons.push(...listButtons(infoList(map), state.rows.length, state.scrollTop, { up: BTN_UP, down: BTN_DOWN, row0: BTN_ROW0 }, 'map.info'));
  return buttons;
}

function buttonAt(ui: UIState, state: MapDialogState, point: DialogPoint): number {
  return point ? searchButtonList(mapDialogButtons(ui, state), Math.floor(point.x), Math.floor(point.y), 2) : 0;
}

/** The info's row a button names, or -1. */
function rowOfButton(state: MapDialogState, button: number): number {
  return button >= BTN_ROW0 ? state.scrollTop + button - BTN_ROW0 : -1;
}

/** The map's cell under the screen point `(x, y)`, or `null`. */
function cellAt(map: MapData, x: number, y: number): { x: number; y: number } | null {
  const { width, height } = map.descriptor;
  const layout = layoutOf(map);
  const cx = Math.floor((x - layout.x0) / layout.cell);
  const cy = Math.floor((y - layout.y0) / layout.cell);
  return x >= layout.x0 && y >= layout.y0 && cx < width && cy < height ? { x: cx, y: cy } : null;
}

function hoveredCell(ui: UIState, state: MapDialogState): { x: number; y: number } | null {
  const map = shownMap(ui, state);
  const at = state.pointer;
  return map && at ? cellAt(map, Math.floor(at.x), Math.floor(at.y)) : null;
}

/** Whether there is a map `delta` from the one shown. */
function hasMap(ui: UIState, state: MapDialogState, delta: number): boolean {
  return ui.ctx.dungeon.getData().maps[state.map + delta] !== undefined;
}

/* ------------------------------------------------------------------- drawing ---- */

export function drawMapDialog(ui: UIState): void {
  const state = ui.mapDialog;
  const map = state && shownMap(ui, state);
  if (!state || !map) return;
  const hovered = buttonAt(ui, state, state.pointer);
  const look = (id: number, enabled = true): ButtonLook => (!enabled ? 'dim' : hovered === id ? 'hover' : 'raised');

  drawPlate(ui, DIALOG);
  drawButton(ui, PREV_FRAME, '<', look(BTN_PREV, hasMap(ui, state, -1)));
  drawButton(ui, NEXT_FRAME, '>', look(BTN_NEXT, hasMap(ui, state, 1)));
  drawPanel(ui, TITLE_PANEL);
  const cell = hoveredCell(ui, state);
  const title = buttonLabelAt(TITLE_PANEL);
  drawCentredText(ui, `${mapTitle(map)}${cell ? `  (${cell.x},${cell.y})` : ''}`, title.x, title.y, MENU_TITLE1_COLOR);
  MARK_FRAMES.forEach((frame, i) => drawButton(ui, frame, MARK_LABELS[i]!, state.mark === MARKS[i] ? 'pressed' : look(BTN_MARK0 + i)));
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look(BTN_CLOSE));

  const layout = layoutOf(map);
  drawPanel(ui, layout.panel);
  drawLabels(ui, map, layout);
  drawCells(ui, state, map, layout, cell);

  const list = infoList(map);
  drawPanel(ui, layout.info);
  const hoveredRow = state.rows[rowOfButton(state, hovered)];
  drawList(ui, list, state.rows.length, state.scrollTop, -1, (i) => state.rows[i]!.text, (i) => {
    const row = state.rows[i]!;
    if (!row.link) return MENU_OPTION_COLOR;
    return hoveredRow?.link && sameCell(hoveredRow.link, row.link) ? LIT_COLOR : LINK_COLOR;
  });
}

/** The columns' numbers above the cells, and the rows' at their left, right-aligned. */
function drawLabels(ui: UIState, map: MapData, layout: MapLayout): void {
  const { width, height } = map.descriptor;
  const { cell, x0, y0 } = layout;
  for (const x of axisLabels(width, cell, LABEL_WIDTH)) {
    drawCentredText(ui, String(x), x0 + x * cell + ((cell - 1) >> 1) + 1, y0 - 3);
  }
  for (const y of axisLabels(height, cell, LABEL_HEIGHT)) {
    const s = String(y);
    drawText(ui, s, x0 - 2 - s.length * CHAR_WIDTH, y0 + y * cell + ((cell - 1) >> 1) + 3);
  }
}

function drawCells(ui: UIState, state: MapDialogState, map: MapData, layout: MapLayout, hovered: { x: number; y: number } | null): void {
  const buf = ui.screenIndexBuffer;
  const { width, height } = map.descriptor;
  fillRectIndex(buf, { x1: layout.x0 - 1, y1: layout.y0 - 1, x2: layout.x0 + width * layout.cell - 1, y2: layout.y0 + height * layout.cell - 1 }, 0);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      fillRectIndex(buf, cellSquare(layout, x, y), ROOM_COLORS[getRoomType(map.cellFlags[x]![y]!)] ?? OTHER_ROOM_COLOR);
    }
  }
  if (state.mark) {
    const marked = state.info.marked(state.map, state.mark);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (marked.has(x * 32 + y)) drawMark(ui, cellSquare(layout, x, y));
      }
    }
  }
  const party = ui.ctx.party.state;
  if (party.position.z === state.map && party.position.x < width && party.position.y < height) {
    drawPartyTriangle(ui, cellSquare(layout, party.position.x, party.position.y), party.facing);
  }
  if (layout.cell < 3) return;
  for (const row of state.rows) {
    if (row.link && row.link.map === state.map) drawOutline(ui, layout, row.link, RELATED_COLOR);
  }
  if (hovered) drawOutline(ui, layout, hovered, HOVER_COLOR);
  if (state.selected && state.selected.map === state.map) drawOutline(ui, layout, state.selected, SELECTED_COLOR);
}

/**
 * A marked square's mark: a cross of `MARK_COLOR`, its bars a fifth of the square thick, at
 * least a pixel, and as many pixels short of each edge as there are fifths beyond the
 * first. The square's own colour shows in its corners: on a square of 3, a cross of five
 * pixels.
 */
function drawMark(ui: UIState, square: Rect): void {
  const size = square.x2 - square.x1 + 1;
  let bar = Math.max(1, Math.round(size / 5));
  if ((size - bar) & 1) bar++;
  const inset = (size - bar) >> 1;
  const margin = Math.max(0, Math.round(size / 5) - 1);
  const buf = ui.screenIndexBuffer;
  fillRectIndex(buf, { x1: square.x1 + margin, y1: square.y1 + inset, x2: square.x2 - margin, y2: square.y2 - inset }, MARK_COLOR);
  fillRectIndex(buf, { x1: square.x1 + inset, y1: square.y1 + margin, x2: square.x2 - inset, y2: square.y2 - margin }, MARK_COLOR);
}

/** A square's outline, a pixel around its colour, in the black between the cells. */
function drawOutline(ui: UIState, layout: MapLayout, at: { x: number; y: number }, color: number): void {
  const buf = ui.screenIndexBuffer;
  const sq = cellSquare(layout, at.x, at.y);
  const x1 = sq.x1 - 1, y1 = sq.y1 - 1, x2 = sq.x2 + 1, y2 = sq.y2 + 1;
  fillRectIndex(buf, { x1, y1, x2, y2: y1 }, color);
  fillRectIndex(buf, { x1, y1: y2, x2, y2 }, color);
  fillRectIndex(buf, { x1, y1, x2: x1, y2 }, color);
  fillRectIndex(buf, { x1: x2, y1, x2, y2 }, color);
}

/**
 * The party's triangle over its square, its tip the way it faces (0 north, 1 east, 2 south,
 * 3 west): a row a pixel from the tip, each two pixels wider than the one before, the last
 * the square's width. On a square of an even width the tip is two pixels.
 */
function drawPartyTriangle(ui: UIState, square: Rect, facing: number): void {
  const buf = ui.screenIndexBuffer;
  const size = square.x2 - square.x1 + 1;
  const even = 1 - (size & 1);
  for (let along = 0; along < size; along++) {
    for (let across = 0; across < size; across++) {
      if (Math.abs(2 * across - (size - 1)) > along + even) continue;
      const [dx, dy] = ([
        [across, along],
        [size - 1 - along, across],
        [size - 1 - across, size - 1 - along],
        [along, size - 1 - across],
      ] as const)[facing & 3]!;
      buf.pixels[(square.y1 + dy) * buf.width + square.x1 + dx] = PARTY_COLOR;
    }
  }
}

const sameCell = (a: CellRef, b: CellRef): boolean => a.map === b.map && a.x === b.x && a.y === b.y;

/* ------------------------------------------------------------------- the input ---- */

/**
 * A click: a right one closes it, a left one on CLOSE too. A left one on `<` or `>` shows
 * the level before or after, nothing shown on it; on an arrow of the info, scrolls it a
 * row; on a link, shows its square; on a square, shows it, and where the page lets the
 * party be moved (`UIState.onTeleport`, `?dev`), holds the press (`MESSAGE_LONG_PRESS_MS`).
 */
export function mapDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  const state = ui.mapDialog;
  if (!state) return;
  const button = (buttons & 1) !== 0 ? BTN_CLOSE : buttonAt(ui, state, { x, y });
  const map = shownMap(ui, state);
  if (button === BTN_CLOSE) {
    closeMapDialog(ui);
  } else if (button === BTN_PREV || button === BTN_NEXT) {
    const delta = button === BTN_PREV ? -1 : 1;
    if (hasMap(ui, state, delta)) {
      state.map += delta;
      selectSquare(ui, null);
    }
  } else if (button >= BTN_MARK0 && button < BTN_MARK0 + MARKS.length) {
    const mark = MARKS[button - BTN_MARK0]!;
    state.mark = state.mark === mark ? null : mark;
  } else if ((button === BTN_UP || button === BTN_DOWN) && map) {
    state.scrollTop = clampScrollTop(infoList(map), state.rows.length, state.scrollTop + (button === BTN_UP ? -1 : 1));
  } else if (button >= BTN_ROW0) {
    const link = state.rows[rowOfButton(state, button)]?.link;
    if (link) selectSquare(ui, link);
  } else if (map) {
    const cell = cellAt(map, Math.floor(x), Math.floor(y));
    if (!cell) return;
    const at = { map: state.map, ...cell };
    selectSquare(ui, at);
    if (ui.onTeleport) holdPress(ui, at);
  }
}

/** The `?dev` press on a square: held `MESSAGE_LONG_PRESS_MS`, the party is moved there. */
function holdPress(ui: UIState, at: CellRef): void {
  releasePress(ui);
  const state = ui.mapDialog!;
  state.press = {
    at,
    timer: setTimeout(() => {
      state.press = null;
      if (ui.mapDialog !== state || !ui.onTeleport) return;
      // Another level is loaded at the next tick, which the dialog holds back.
      if (at.map !== ui.ctx.party.state.position.z) closeMapDialog(ui);
      ui.onTeleport(at.map, at.x, at.y);
    }, MESSAGE_LONG_PRESS_MS),
  };
}

/** The press let go, or moved off its square: it was a click. */
function releasePress(ui: UIState): void {
  const state = ui.mapDialog;
  if (!state?.press) return;
  clearTimeout(state.press.timer);
  state.press = null;
}

function mapDialogDrag(ui: UIState, x: number, y: number): void {
  const state = ui.mapDialog;
  const map = state && shownMap(ui, state);
  if (!state?.press || !map) return;
  const cell = cellAt(map, Math.floor(x), Math.floor(y));
  if (!cell || cell.x !== state.press.at.x || cell.y !== state.press.at.y) releasePress(ui);
}

/** The wheel scrolls the info. Says whether it moved. */
export function mapDialogWheel(ui: UIState, deltaY: number): boolean {
  const state = ui.mapDialog;
  const map = state && shownMap(ui, state);
  if (!state || !map) return false;
  const was = state.scrollTop;
  const travel = { wheelDelta: state.wheelDelta };
  const rows = wheelRows(travel, deltaY);
  state.wheelDelta = travel.wheelDelta;
  state.scrollTop = clampScrollTop(infoList(map), state.rows.length, state.scrollTop + rows);
  return state.scrollTop !== was;
}

/** The pointer moved. Nothing is drawn here: says whether a button's look, the square under it or a link's look changed. */
export function mapDialogPointer(ui: UIState, point: DialogPoint): boolean {
  const state = ui.mapDialog;
  if (!state) return false;
  const before = { button: buttonAt(ui, state, state.pointer), cell: hoveredCell(ui, state) };
  state.pointer = point;
  const after = { button: buttonAt(ui, state, state.pointer), cell: hoveredCell(ui, state) };
  return before.button !== after.button || before.cell?.x !== after.cell?.x || before.cell?.y !== after.cell?.y;
}
