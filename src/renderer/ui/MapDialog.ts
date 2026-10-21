/**
 * The map dialog: the party's level, drawn whole in the game's own screen, as the dialog
 * over the game (`Dialog.ts`), from the widget kit (`Widgets.ts`). It is the port's own:
 * CSBWin draws no map.
 *
 * ## The dialog
 *
 * It takes the whole screen, 320x200, as the settings do. From the top:
 *
 * - **The title line**: the level's number on a panel, LEVEL 1 the dungeon's first, as
 *   the player counts them (the map's descriptor counts from 0), and at its right CLOSE.
 * - **The map**, on a panel down to the plate's foot: a square a cell, at the largest
 *   whole size that fits, centred, a column and a row of black between two cells. A
 *   cell's colour is its room type's (`ROOM_COLORS`), in the UI palette: stone, floor,
 *   pit, stairs, door, teleporter and false wall. The party's square holds a triangle,
 *   lit, its tip the way the party faces.
 *
 * Every square is drawn, seen or not: a map of only the cells the party has seen is X10's
 * data, and a later mode of this dialog.
 *
 * ## Opening and closing
 *
 * Only with MAP VIEW on (`SettingsValues.mapView`): the key bound to MAP, which no preset
 * binds, or a long press on the message area (`GameInput`). Esc, the MAP key again, CLOSE
 * or a right click close it. While it is up the clock is held, as under every dialog, and
 * the game is left as it was. It is shown through the interface's palette whole, as the
 * settings are (`SettingsDialog.ts` → "The palette").
 *
 * With the page opened with `?dev`, a click on a square moves the party there
 * (`UIState.onTeleport`), on its level, facing as it was.
 */
import type { Rect, UIButton } from '../../data/tables/UITables';
import type { MapData } from '../../data/dungeonTypes';
import { RoomType, getRoomType } from '../../core/types';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { closeDialog, openDialog, type Dialog, type DialogPoint } from './Dialog';
import { searchButtonList } from './HitTest';
import { keyAction } from './Keyboard';
import { MENU_TITLE1_COLOR } from './Menu';
import type { UIState } from './UIState';
import {
  LIT_COLOR,
  LOW_BUTTON_HEIGHT,
  buttonLabelAt,
  buttonOf,
  drawButton,
  drawCentredText,
  drawPanel,
  drawPlate,
  type ButtonLook,
} from './Widgets';

/* ------------------------------------------------------------------ geometry ---- */

/** All in screen coordinates, the title line where the settings have theirs. */
const DIALOG: Rect = { x1: 0, y1: 0, x2: 319, y2: 199 };
const TITLE_Y1 = 10;
const TITLE_Y2 = TITLE_Y1 + LOW_BUTTON_HEIGHT - 1;
export const CLOSE_FRAME: Rect = { x1: 250, y1: TITLE_Y1, x2: 309, y2: TITLE_Y2 };
/** The level's number, on a panel as far as graphic 0's ten pixels short of CLOSE. */
export const TITLE_PANEL: Rect = { x1: 10, y1: TITLE_Y1, x2: CLOSE_FRAME.x1 - 10, y2: TITLE_Y2 };
/** The map's panel: six rows of the plate under the title line, down to the plate's frame. */
export const MAP_PANEL: Rect = { x1: 10, y1: TITLE_Y2 + 7, x2: 309, y2: 189 };
/** Inside the panel's two pixels of edge, black under the cells. */
export const MAP_AREA: Rect = { x1: MAP_PANEL.x1 + 2, y1: MAP_PANEL.y1 + 2, x2: MAP_PANEL.x2 - 2, y2: MAP_PANEL.y2 - 2 };

/** Where a map of `width` by `height` cells is drawn: a cell's size, and its first cell's corner. */
interface MapLayout {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
}

/** The largest whole cell that fits the map in `MAP_AREA`, and the map centred there. */
export function mapLayout(width: number, height: number): MapLayout {
  const areaWidth = MAP_AREA.x2 - MAP_AREA.x1 + 1;
  const areaHeight = MAP_AREA.y2 - MAP_AREA.y1 + 1;
  const cell = Math.max(1, Math.min(Math.floor(areaWidth / width), Math.floor(areaHeight / height)));
  return {
    cell,
    x0: MAP_AREA.x1 + ((areaWidth - width * cell) >> 1),
    y0: MAP_AREA.y1 + ((areaHeight - height * cell) >> 1),
  };
}

/** A cell's square of colour: the cell less its column and row of black, but at a size of 1. */
export function cellSquare(layout: MapLayout, x: number, y: number): Rect {
  const size = layout.cell > 1 ? layout.cell - 1 : 1;
  const x1 = layout.x0 + x * layout.cell;
  const y1 = layout.y0 + y * layout.cell;
  return { x1, y1, x2: x1 + size - 1, y2: y1 + size - 1 };
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

export const CLOSE_LABEL = 'CLOSE';

/** The title: the level's number, counted from 1. */
export function mapTitle(map: MapData): string {
  return `LEVEL ${map.descriptor.level + 1}`;
}

/* --------------------------------------------------------------------- state ---- */

export interface MapDialogState {
  /** Where the pointer is, in screen coordinates, or `null` off the canvas. */
  pointer: DialogPoint;
}

const MAP_DIALOG: Dialog = {
  uiPalette: true,
  draw: (ui) => drawMapDialog(ui),
  click: (ui, x, y, buttons) => mapDialogClick(ui, x, y, buttons),
  key: (ui, _key, code) => {
    if (code === 'Escape' || keyAction(code) === 'map') closeMapDialog(ui);
  },
  wheel: () => false,
  pointer: (ui, point) => mapDialogPointer(ui, point),
};

/** Put the dialog up, with MAP VIEW on and no other dialog up. Says whether it did. */
export function openMapDialog(ui: UIState): boolean {
  if (ui.dialog || !ui.settings.values.mapView) return false;
  openDialog(ui, MAP_DIALOG);
  ui.mapDialog = { pointer: ui.hoverPoint };
  return true;
}

export function closeMapDialog(ui: UIState): void {
  if (!ui.mapDialog) return;
  ui.mapDialog = null;
  closeDialog(ui);
}

/** The party's map: the level it stands on. */
function partyMap(ui: UIState): MapData | undefined {
  return ui.ctx.dungeon.getData().maps[ui.ctx.party.state.position.z];
}

/* ---------------------------------------------------------------- the controls ---- */

const BTN_CLOSE = 1;

/** The dialog's button list, in the form of CSBWin's: CLOSE. */
function mapDialogButtons(): UIButton[] {
  return [buttonOf(CLOSE_FRAME, BTN_CLOSE, 'map.close')];
}

function hovered(state: MapDialogState): number {
  const at = state.pointer;
  return at ? searchButtonList(mapDialogButtons(), Math.floor(at.x), Math.floor(at.y), 2) : 0;
}

/** The map's cell under the screen point `(x, y)`, or `null`. */
function cellAt(map: MapData, x: number, y: number): { x: number; y: number } | null {
  const { width, height } = map.descriptor;
  const layout = mapLayout(width, height);
  const cx = Math.floor((x - layout.x0) / layout.cell);
  const cy = Math.floor((y - layout.y0) / layout.cell);
  return x >= layout.x0 && y >= layout.y0 && cx < width && cy < height ? { x: cx, y: cy } : null;
}

/* ------------------------------------------------------------------- drawing ---- */

export function drawMapDialog(ui: UIState): void {
  const state = ui.mapDialog;
  const map = partyMap(ui);
  if (!state || !map) return;
  const look: ButtonLook = hovered(state) === BTN_CLOSE ? 'hover' : 'raised';

  drawPlate(ui, DIALOG);
  drawPanel(ui, TITLE_PANEL);
  const title = buttonLabelAt(TITLE_PANEL);
  drawCentredText(ui, mapTitle(map), title.x, title.y, MENU_TITLE1_COLOR);
  drawButton(ui, CLOSE_FRAME, CLOSE_LABEL, look);

  drawPanel(ui, MAP_PANEL);
  const buf = ui.screenIndexBuffer;
  fillRectIndex(buf, MAP_AREA, 0);
  const { width, height } = map.descriptor;
  const layout = mapLayout(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      fillRectIndex(buf, cellSquare(layout, x, y), ROOM_COLORS[getRoomType(map.cellFlags[x]![y]!)] ?? OTHER_ROOM_COLOR);
    }
  }
  const party = ui.ctx.party.state;
  if (party.position.x < width && party.position.y < height) {
    drawPartyTriangle(ui, cellSquare(layout, party.position.x, party.position.y), party.facing);
  }
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

/* ------------------------------------------------------------------- the input ---- */

/**
 * A click: a right one closes it, a left one on CLOSE too. A left one on a square moves
 * the party there where the page lets it (`UIState.onTeleport`, `?dev`).
 */
export function mapDialogClick(ui: UIState, x: number, y: number, buttons: number): void {
  if (!ui.mapDialog) return;
  if ((buttons & 1) !== 0 || searchButtonList(mapDialogButtons(), Math.floor(x), Math.floor(y), buttons) === BTN_CLOSE) {
    closeMapDialog(ui);
    return;
  }
  const map = partyMap(ui);
  const cell = map && cellAt(map, Math.floor(x), Math.floor(y));
  if (cell && ui.onTeleport) ui.onTeleport(cell.x, cell.y);
}

/** The pointer moved. Nothing is drawn here: says whether CLOSE's look changed. */
export function mapDialogPointer(ui: UIState, point: DialogPoint): boolean {
  const state = ui.mapDialog;
  if (!state) return false;
  const was = hovered(state);
  state.pointer = point;
  return hovered(state) !== was;
}
