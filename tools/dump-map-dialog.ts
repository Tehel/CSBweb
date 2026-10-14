/**
 * The map dialog (`src/renderer/ui/MapDialog.ts`): everything about it the golden frame
 * cannot see.
 *
 * 1. **The layout**: CLOSE, the title and the map's panel inside the plate's interior, none
 *    over another; every map size from 1x1 to 32x32 inside the panel at the largest whole
 *    cell that fits, and centred.
 * 2. **The drawing**, on every level of the default dungeon: every cell its room type's
 *    colour, a column and a row of black between two; the party's triangle on its square,
 *    its tip the way the party faces, its base the square's width.
 * 3. **The dialog**: shut with MAP VIEW off, and over another dialog; open, the clock held;
 *    Esc, the MAP key, CLOSE and a right click close it; a click on a square moves no one
 *    without `?dev`'s hook, and with it names the square.
 * 4. **Opening it**, through `GameInput`: the MAP key, unbound in every preset; a press on
 *    the message area held `MESSAGE_LONG_PRESS_MS`, queued as a click with its release,
 *    but not one let go before, moved off the area, on the freeze's pixel, or with MAP VIEW
 *    off. A double click there still opens the settings.
 *
 * Run: `npm test -- --only=dump-map-dialog.ts`
 */
import { getRoomType } from '../src/core/types';
import type { Rect } from '../src/data/tables/UITables';
import type { Game } from '../src/engine/Game';
import { GameInput, MESSAGE_LONG_PRESS_MS, type KeyPress } from '../src/renderer/GameInput';
import type { GameScreen } from '../src/renderer/GameScreen';
import { isDialogOpen } from '../src/renderer/ui/Dialog';
import { KEY_PRESETS, setKeyBindings, tableKeyButton } from '../src/renderer/ui/Keyboard';
import {
  CLOSE_FRAME, MAP_AREA, MAP_PANEL, OTHER_ROOM_COLOR, PARTY_COLOR, ROOM_COLORS, TITLE_PANEL, cellSquare, closeMapDialog,
  drawMapDialog, mapDialogClick, mapDialogPointer, mapLayout, mapTitle, openMapDialog,
} from '../src/renderer/ui/MapDialog';
import { MENU_GRAPHIC } from '../src/renderer/ui/Menu';
import { searchMouseButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import { openSettingsDialog } from '../src/renderer/ui/SettingsDialog';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHAR_WIDTH, buttonRect } from '../src/renderer/ui/Widgets';
import { Settings } from '../src/settings/Settings';
import { check, finish } from './lib/check';
import { stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const graphics = stockGraphics();
const image = graphics.getImage(MENU_GRAPHIC);
const menuBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };

function freshUI(game: Game, mapView: boolean, onTeleport: UIState['onTeleport'] = null): UIState {
  const settings = new Settings(null);
  settings.update({ mapView });
  return newUIState(graphics, game.ctx, { getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? menuBitmap : null), settings, onTeleport });
}

const inside = (r: Rect, outer: Rect) => r.x1 >= outer.x1 && r.x2 <= outer.x2 && r.y1 >= outer.y1 && r.y2 <= outer.y2;
const overlap = (a: Rect, b: Rect) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
const centre = (r: Rect) => ({ x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('=== 1. the layout ===');
{
  const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };
  const frames: Array<[string, Rect]> = [['CLOSE', CLOSE_FRAME], ['title', TITLE_PANEL], ['map', MAP_PANEL]];
  check(frames.every(([, f]) => inside(f, interior)), 'every frame inside the plate\'s interior');
  const clashes = frames.flatMap(([a, fa], i) => frames.slice(i + 1).filter(([, fb]) => overlap(fa, fb)).map(([b]) => `${a}/${b}`));
  check(clashes.length === 0, `no frame over another${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  check('LEVEL 64'.length * CHAR_WIDTH <= TITLE_PANEL.x2 - TITLE_PANEL.x1 - 8, 'the highest level\'s title fits its panel');

  const areaWidth = MAP_AREA.x2 - MAP_AREA.x1 + 1;
  const areaHeight = MAP_AREA.y2 - MAP_AREA.y1 + 1;
  const bad: string[] = [];
  for (let w = 1; w <= 32; w++) {
    for (let h = 1; h <= 32; h++) {
      const layout = mapLayout(w, h);
      const grid: Rect = { x1: layout.x0, y1: layout.y0, x2: layout.x0 + w * layout.cell - 1, y2: layout.y0 + h * layout.cell - 1 };
      const largest = (layout.cell + 1) * w > areaWidth || (layout.cell + 1) * h > areaHeight;
      const centred = Math.abs((grid.x1 - MAP_AREA.x1) - (MAP_AREA.x2 - grid.x2)) <= 1
        && Math.abs((grid.y1 - MAP_AREA.y1) - (MAP_AREA.y2 - grid.y2)) <= 1;
      if (!inside(grid, MAP_AREA) || !largest || !centred) bad.push(`${w}x${h}`);
    }
  }
  check(bad.length === 0, `every map from 1x1 to 32x32 inside the panel, at the largest cell, centred${bad.length ? `: not ${bad.join(', ')}` : ''}`);
  console.log(`  a 32x32 map has cells of ${mapLayout(32, 32).cell} pixels; the map area is ${areaWidth}x${areaHeight}`);
}

console.log('\n=== 2. the drawing ===');
{
  const game = stockGame();
  const ui = freshUI(game, true);
  const party = game.ctx.party.state;
  const maps = game.ctx.state.dungeon.maps;
  const buf = ui.screenIndexBuffer;
  const at = (x: number, y: number) => buf.pixels[y * buf.width + x];
  const seen = new Set<number>();
  const wrong: string[] = [];
  for (let z = 0; z < maps.length; z++) {
    const map = maps[z];
    const { width, height } = map.descriptor;
    // The party on the level's last square, facing north, so the triangle is checked apart.
    party.position.x = width - 1; party.position.y = height - 1; party.position.z = z;
    party.facing = 0;
    check(openMapDialog(ui), `level ${z}: the dialog opens`);
    drawMapDialog(ui);
    const layout = mapLayout(width, height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (x === width - 1 && y === height - 1) continue;
        const room = getRoomType(map.cellFlags[x][y]);
        seen.add(room);
        const want = ROOM_COLORS[room] ?? OTHER_ROOM_COLOR;
        const sq = cellSquare(layout, x, y);
        let ok = true;
        for (let py = sq.y1; py <= sq.y2; py++) for (let px = sq.x1; px <= sq.x2; px++) ok &&= at(px, py) === want;
        if (layout.cell > 1) ok &&= at(sq.x2 + 1, sq.y1) === 0 && at(sq.x1, sq.y2 + 1) === 0;
        if (!ok) wrong.push(`level ${z} (${x},${y})`);
      }
    }
    closeMapDialog(ui);
  }
  check(wrong.length === 0, `every cell of every level its room type's colour, black between two${wrong.length ? `: not ${wrong.slice(0, 5).join(', ')}` : ''}`);
  check(seen.size === 7, `the default dungeon has every room type of the map's seven (${[...seen].sort().join(', ')})`);

  // The triangle, on level 0 at the party's start, for each facing.
  const start = maps[0];
  const layout = mapLayout(start.descriptor.width, start.descriptor.height);
  party.position.x = 3; party.position.y = 3; party.position.z = 0;
  const sq = cellSquare(layout, 3, 3);
  const size = sq.x2 - sq.x1 + 1;
  const row = (y: number) => Array.from({ length: size }, (_, i) => at(sq.x1 + i, y) === PARTY_COLOR);
  const column = (x: number) => Array.from({ length: size }, (_, i) => at(x, sq.y1 + i) === PARTY_COLOR);
  const count = (lit: boolean[]) => lit.filter(Boolean).length;
  const tip = 2 - (size & 1);
  const faces: Array<[string, () => boolean[], () => boolean[]]> = [
    ['north', () => row(sq.y1), () => row(sq.y2)],
    ['east', () => column(sq.x2), () => column(sq.x1)],
    ['south', () => row(sq.y2), () => row(sq.y1)],
    ['west', () => column(sq.x1), () => column(sq.x2)],
  ];
  faces.forEach(([name, tipLine, baseLine], facing) => {
    party.facing = facing;
    openMapDialog(ui);
    drawMapDialog(ui);
    check(count(tipLine()) === tip && count(baseLine()) === size,
      `facing ${name}, the tip (${tip} pixels) on the ${name} edge of the party's ${size}-pixel square, the base across the other`);
    closeMapDialog(ui);
  });
  check(mapTitle(start) === `LEVEL ${start.descriptor.level + 1}` && mapTitle(start) === 'LEVEL 1', 'the first level is LEVEL 1');
}

console.log('\n=== 3. the dialog ===');
{
  const game = stockGame();
  const off = freshUI(game, false);
  check(!openMapDialog(off) && !isDialogOpen(off), 'with MAP VIEW off, it does not open');

  const ui = freshUI(game, true);
  openSettingsDialog(ui);
  check(!openMapDialog(ui) && ui.settingsDialog !== null, 'over the settings, it does not open');
  ui.settingsDialog = null; ui.dialog = null; ui.ctx.state.paused = false;

  check(openMapDialog(ui) && isDialogOpen(ui) && ui.ctx.state.paused, 'with MAP VIEW on, it opens, and the clock is held');
  ui.dialog!.key(ui, 'Escape', 'Escape');
  check(!isDialogOpen(ui) && !ui.ctx.state.paused, 'Esc closes it, and the clock runs');

  setKeyBindings({ ...KEY_PRESETS.csbwin, map: ['KeyN', ''] });
  openMapDialog(ui);
  ui.dialog!.key(ui, 'k', 'KeyK');
  check(isDialogOpen(ui), 'a key bound to something else leaves it up');
  ui.dialog!.key(ui, 'n', 'KeyN');
  check(!isDialogOpen(ui), 'the MAP key closes it');
  setKeyBindings(KEY_PRESETS.csbwin);

  openMapDialog(ui);
  const close = centre(buttonRect(CLOSE_FRAME));
  check(mapDialogPointer(ui, close), 'the pointer moved onto CLOSE changes what is drawn');
  check(!mapDialogPointer(ui, { x: close.x + 1, y: close.y }), 'and moved along it, does not');
  mapDialogClick(ui, close.x, close.y, 2);
  check(!isDialogOpen(ui), 'CLOSE closes it');
  openMapDialog(ui);
  mapDialogClick(ui, 160, 100, 1);
  check(!isDialogOpen(ui), 'a right click closes it');

  const party = game.ctx.party.state;
  party.position.x = 2; party.position.y = 2; party.position.z = 0;
  const layout = mapLayout(game.ctx.state.dungeon.maps[0].descriptor.width, game.ctx.state.dungeon.maps[0].descriptor.height);
  const target = centre(cellSquare(layout, 5, 7));
  openMapDialog(ui);
  mapDialogClick(ui, target.x, target.y, 2);
  check(isDialogOpen(ui) && party.position.x === 2 && party.position.y === 2, 'without `?dev`, a click on a square moves no one, and leaves it up');
  closeMapDialog(ui);

  const moves: Array<[number, number]> = [];
  const dev = freshUI(game, true, (x, y) => moves.push([x, y]));
  openMapDialog(dev);
  mapDialogClick(dev, target.x, target.y, 2);
  mapDialogClick(dev, MAP_AREA.x1, MAP_AREA.y1, 2);
  check(moves.length === 1 && moves[0][0] === 5 && moves[0][1] === 7 && isDialogOpen(dev),
    'with it, a click on (5,7) asks for (5,7), one on the black around the map for nothing, and it stays up');
}

console.log('\n=== 4. opening it ===');
{
  check(Object.values(KEY_PRESETS).every((table) => table.map[0] === '' && table.map[1] === ''), 'no preset binds MAP');

  const game = stockGame();
  let ui = freshUI(game, true);
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);
  const events: string[] = [];
  const screen = {
    isDialogOpen: () => isDialogOpen(ui),
    screenPoint: (x: number, y: number) => ({ x, y }),
    openSettings: () => openSettingsDialog(ui),
    openMap: () => openMapDialog(ui),
    // CHAMPION VIEW is off: no press is held back (`tools/dump-champion-dialog.ts`).
    championBarsAt: () => -1,
    handleDialogClick: (x: number, y: number, b: number) => ui.dialog?.click(ui, x, y, b),
    handleDialogKey: (key: string, code: string) => ui.dialog?.key(ui, key, code),
    handleDialogRelease: () => {},
    isReincarnateScreenOpen: () => false,
    searchMouseButtons: (x: number, y: number, b: number) => searchMouseButtons(ui, x, y, b),
    translateKey: (code: string) => tableKeyButton(ui, code),
    handleUIKey: () => false,
    isHintOracleUp: () => false,
    setHoverPoint: () => {},
  } as unknown as GameScreen;
  const fakeGame = {
    mainLoopHasReturned: () => false,
    isDead: () => false,
    onMouseClick: () => events.push('click'),
    onMouseUnClick: () => events.push('unclick'),
    enqueueKeyButton: () => {},
    isPartySleeping: () => false,
    isFrozen: () => false,
  } as unknown as Game;
  const input = new GameInput({ game: fakeGame, screen, refreshScreen: () => {}, onQuickSave: () => {}, onQuickLoad: () => {} });
  const press = (code: string): KeyPress => ({ key: code, code, ctrlKey: false, metaKey: false, altKey: false });

  check(!input.keyDown(press('KeyN')), 'unbound, N is nobody\'s');
  setKeyBindings({ ...KEY_PRESETS.csbwin, map: ['KeyN', ''] });
  check(input.keyDown(press('KeyN')) && ui.mapDialog !== null, 'bound to MAP, it opens the map');
  input.keyDown(press('KeyN'));
  check(!isDialogOpen(ui), 'and again, closes it');
  setKeyBindings(KEY_PRESETS.csbwin);

  input.mouseDown(100, 185, 0);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(ui.mapDialog !== null && events.join() === 'click,unclick',
    'a press held on the message area opens the map, the press queued as a click and its release with it');
  input.mouseUp();
  check(ui.mapDialog !== null && events.join() === 'click,unclick', 'the real release is the dialog\'s, and queues nothing');
  closeMapDialog(ui);

  events.length = 0;
  input.mouseDown(100, 185, 0);
  await sleep(MESSAGE_LONG_PRESS_MS / 2);
  input.mouseUp();
  await sleep(MESSAGE_LONG_PRESS_MS);
  check(!isDialogOpen(ui) && events.join() === 'click,unclick', 'let go before, it was a click, and opens nothing');

  input.mouseDown(100, 185, 0);
  input.mouseMove(100, 150);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(!isDialogOpen(ui), 'moved off the message area, nothing opens');
  input.mouseUp();

  input.mouseDown(100, 185, 0);
  input.mouseLeave();
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(!isDialogOpen(ui), 'nor once the pointer leaves the canvas');
  input.mouseUp();

  input.mouseDown(0, 198, 0);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(!isDialogOpen(ui), 'held on the freeze\'s pixel, which the game takes, nothing opens');
  input.mouseUp();

  input.mouseDown(100, 185, 0); input.mouseUp();
  input.mouseDown(150, 190, 0);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(ui.settingsDialog !== null && ui.mapDialog === null, 'a double click there, its second press held, opens the settings, not the map');
  input.mouseUp();

  ui = freshUI(game, false);
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);
  input.mouseDown(100, 185, 0);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(!isDialogOpen(ui), 'with MAP VIEW off, the long press opens nothing');
  input.mouseUp();
}

finish();
