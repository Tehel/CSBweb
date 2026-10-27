/**
 * The map dialog (`src/renderer/ui/MapDialog.ts`): everything about it the golden frame
 * cannot see.
 *
 * 1. **The layout**: CLOSE, `<`, `>`, G, M, I and the title inside the plate's interior, none over
 *    another; for every map size from 1x1 to 32x32, the map's panel and the info's side by
 *    side, the cells inside the map's panel at the largest whole cell that fits, and the
 *    info at least 21 characters wide; the axes' numbers the first and the last, each with
 *    room; a line cut into rows at a space, its next rows one further in.
 * 2. **The drawing**, on every level of the default dungeon: every cell its room type's
 *    colour, a column and a row of black between two; the party's triangle on its square,
 *    its tip the way the party faces, its base the square's width; the square shown
 *    outlined in white, a square its info names in orange. Each mark on exactly the
 *    squares whose info lists what it names, a mirror's champion no item; its cross lit,
 *    the square's colour in its corners.
 * 3. **The dialog**: shut with MAP VIEW off, and over another dialog; open on the party's
 *    square, the clock held; Esc, the MAP key, CLOSE and a right click close it; a click
 *    on a square shows it and moves no one; a click on a link shows its square, on its
 *    level; `<` and `>` change the level, dim at the ends; the wheel and the arrows scroll
 *    the info; G, M and I press one mark at a time, a second click lets it go, and the
 *    mark is kept across levels and a closing. With `?dev`'s hook, a press held on a square asks for it, on its level or
 *    another, which closes the dialog; let go before, or moved off the square, it asks
 *    for nothing.
 * 4. **Opening it**, through `GameInput`: the MAP key, unbound in every preset; a press on
 *    the message area held `MESSAGE_LONG_PRESS_MS`, queued as a click with its release,
 *    but not one let go before, moved off the area, on the freeze's pixel, or with MAP VIEW
 *    off. A double click there still opens the settings.
 *
 * Run: `npm test -- --only=map-dialog.ts`
 */
import { getRoomType } from '../../src/core/types';
import type { Rect } from '../../src/data/tables/UITables';
import type { Game } from '../../src/engine/Game';
import { GameInput, type InputScreen, type KeyPress } from '../../src/renderer/GameInput';
import { MESSAGE_LONG_PRESS_MS, isDialogOpen } from '../../src/renderer/ui/Dialog';
import { KEY_PRESETS, setKeyBindings } from '../../src/renderer/ui/Keyboard';
import {
  CLOSE_FRAME, MARKS, MARK_COLOR, MARK_FRAMES, MARK_LABELS, MAX_GRID_WIDTH, NEXT_FRAME, OTHER_ROOM_COLOR, PARTY_COLOR, PREV_FRAME, RELATED_COLOR, ROOM_COLORS, SELECTED_COLOR,
  TITLE_PANEL, axisLabels, cellSquare, closeMapDialog, drawMapDialog, mapDialogClick, mapDialogPointer, mapDialogWheel,
  mapLayout, mapTitle, openMapDialog, wrap,
} from '../../src/renderer/ui/MapDialog';
import { MENU_GRAPHIC } from '../../src/renderer/ui/Menu';
import { updateButtonLists } from '../../src/renderer/ui/Mouse';
import { openSettingsDialog } from '../../src/renderer/ui/SettingsDialog';
import { UIMode, type UIState } from '../../src/renderer/ui/UIState';
import { CHAR_WIDTH, LINE_STEP, buttonRect, listIn, listInner, listRowRect, listTextX } from '../../src/renderer/ui/Widgets';
import { Settings } from '../../src/settings/Settings';
import { check, finish } from '../lib/check';
import { stockGame, stockGraphics } from '../lib/game';
import { newUIState } from '../lib/ui';

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
const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };

console.log('=== 1. the layout ===');
{
  const frames: Array<[string, Rect]> = [['CLOSE', CLOSE_FRAME], ['<', PREV_FRAME], ['>', NEXT_FRAME], ['title', TITLE_PANEL],
    ...MARK_FRAMES.map((f, i): [string, Rect] => [MARK_LABELS[i]!, f])];
  check(frames.every(([, f]) => inside(f, interior)), 'every frame of the title line inside the plate\'s interior');
  const clashes = frames.flatMap(([a, fa], i) => frames.slice(i + 1).filter(([, fb]) => overlap(fa, fb)).map(([b]) => `${a}/${b}`));
  check(clashes.length === 0, `no frame over another${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  check('LEVEL 64  (31,31)'.length * CHAR_WIDTH <= TITLE_PANEL.x2 - TITLE_PANEL.x1 - 8, 'the highest level\'s title and a square fit its panel');

  const bad: string[] = [];
  let narrowest = Infinity;
  for (let w = 1; w <= 32; w++) {
    for (let h = 1; h <= 32; h++) {
      const layout = mapLayout(w, h);
      const { panel, info, cell, x0, y0 } = layout;
      const grid: Rect = { x1: x0 - 1, y1: y0 - 1, x2: x0 + w * cell - 1, y2: y0 + h * cell - 1 };
      const largest = (cell + 1) * h > panel.y2 - 4 - y0 + 1 || (cell + 1) * w > MAX_GRID_WIDTH;
      const list = listIn(info);
      const chars = Math.floor((listInner(list).x2 - listTextX(list) + 1) / CHAR_WIDTH);
      narrowest = Math.min(narrowest, chars);
      const fits = inside(panel, interior) && inside(info, interior) && !overlap(panel, info) && inside(grid, { x1: panel.x1 + 2, y1: panel.y1 + 2, x2: panel.x2 - 2, y2: panel.y2 - 2 });
      if (!fits || !largest || chars < 21) bad.push(`${w}x${h}`);
    }
  }
  check(bad.length === 0, `every map from 1x1 to 32x32 inside its panel, at the largest cell, the info beside it${bad.length ? `: not ${bad.join(', ')}` : ''}`);
  console.log(`  a 32x32 map has cells of ${mapLayout(32, 32).cell} pixels; the info is at least ${narrowest} characters wide`);

  const spaced = (labels: number[], cell: number, room: number) => labels.every((n, i) => i === 0 || (n - labels[i - 1]!) * cell >= room);
  const axes = [[32, 4, 13], [32, 4, 8], [19, 7, 13], [5, 16, 8], [1, 16, 13]] as const;
  check(axes.every(([count, cell, room]) => {
    const labels = axisLabels(count, cell, room);
    return labels[0] === 0 && labels.at(-1) === count - 1 && spaced(labels, cell, room);
  }), `the axes' numbers: the first, the last, each with room (32 cells of 4: ${axisLabels(32, 4, 13).join(',')} across, ${axisLabels(32, 4, LINE_STEP).join(',')} down)`);

  check(wrap('A GOLD KEY, TAKEN', 10, 1).join('|') === ' A GOLD|  KEY,|  TAKEN', 'a line cut at its spaces, its next rows one further in');
  check(wrap('ABCDEFGHIJKL', 5, 0).join('|') === 'ABCDE| FGHI| JKL', 'a word longer than a row cut where the row ends');
}

console.log('\n=== 2. the drawing ===');
{
  const game = stockGame();
  const ui = freshUI(game, true);
  const party = game.ctx.party.state;
  const maps = game.ctx.dungeon.getData().maps;
  const buf = ui.screenIndexBuffer;
  const at = (x: number, y: number) => buf.pixels[y * buf.width + x];
  /** Open on level `z`, nothing shown, so that no outline crosses the black. */
  const plain = (z: number) => {
    check(openMapDialog(ui), `level ${z}: the dialog opens`);
    ui.mapDialog!.selected = null;
    ui.mapDialog!.rows = [];
    drawMapDialog(ui);
  };
  const seen = new Set<number>();
  const wrong: string[] = [];
  for (let z = 0; z < maps.length; z++) {
    const map = maps[z];
    const { width, height } = map.descriptor;
    // The party on the level's last square, facing north, so the triangle is checked apart.
    party.position.x = width - 1; party.position.y = height - 1; party.position.z = z;
    party.facing = 0;
    plain(z);
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
        if (layout.cell > 1) ok &&= at(sq.x2 + 1, sq.y1) === 0 && at(sq.x1, sq.y2 + 1) === 0 && at(sq.x1 - 1, sq.y1) === 0;
        if (!ok) wrong.push(`level ${z} (${x},${y})`);
      }
    }
    closeMapDialog(ui);
  }
  check(wrong.length === 0, `every cell of every level its room type's colour, black between two${wrong.length ? `: not ${wrong.slice(0, 5).join(', ')}` : ''}`);
  check(seen.size === 7, `the default dungeon has every room type of the map's seven (${[...seen].sort().join(', ')})`);

  // The triangle, on level 0, for each facing.
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
    plain(0);
    check(count(tipLine()) === tip && count(baseLine()) === size,
      `facing ${name}, the tip (${tip} pixels) on the ${name} edge of the party's ${size}-pixel square, the base across the other`);
    closeMapDialog(ui);
  });
  check(mapTitle(start) === `LEVEL ${start.descriptor.level + 1}` && mapTitle(start) === 'LEVEL 1', 'the first level is LEVEL 1');

  // The outlines: the lock at (3,4) of level 2 shown, the door at (4,5) it opens named.
  party.position.z = 1;
  openMapDialog(ui);
  const l1 = mapLayout(maps[1].descriptor.width, maps[1].descriptor.height);
  const lock = centre(cellSquare(l1, 3, 4));
  mapDialogClick(ui, lock.x, lock.y, 2);
  drawMapDialog(ui);
  const ring = (x: number, y: number, color: number) => {
    const s = cellSquare(l1, x, y);
    // Mid-side pixels: two squares a corner apart share that corner's pixel.
    return at(s.x1 - 1, s.y1 + 1) === color && at(s.x2 + 1, s.y1 + 1) === color && at(s.x1 + 1, s.y2 + 1) === color;
  };
  check(ring(3, 4, SELECTED_COLOR) && ring(4, 5, RELATED_COLOR), 'the square shown outlined in white, the door its lock opens in orange');
  closeMapDialog(ui);

  // The marks: on every level, a square is marked exactly when its info lists what the mark names.
  const info = (() => { openMapDialog(ui); const i = ui.mapDialog!.info; closeMapDialog(ui); return i; })();
  const listed: Record<(typeof MARKS)[number], (lines: string[], things: string[]) => boolean> = {
    generator: (lines) => lines.some((l) => l.startsWith('Generator:')),
    monster: (_, things) => things.some((t) => /^\d+ x /.test(t)),
    item: (lines, things) => !lines.some((l) => l.includes('Champion mirror')) && things.some((t) => !/^\d+ x /.test(t)),
  };
  const counts = MARKS.map(() => 0);
  const disagree: string[] = [];
  maps.forEach((map, z) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const lines = info.describe({ map: z, x, y });
        const on = lines.findIndex((l) => l.text === 'On it:');
        const things = on < 0 ? [] : lines.slice(on + 1).filter((l) => l.indent === 1 && !l.link).map((l) => l.text);
        MARKS.forEach((mark, i) => {
          const marked = info.marked(z, mark).has(x * 32 + y);
          if (marked) counts[i]++;
          if (marked !== listed[mark](lines.map((l) => l.text), things)) disagree.push(`${mark} level ${z} (${x},${y})`);
        });
      }
    }
  });
  check(disagree.length === 0 && counts.every((n) => n > 0),
    `each mark on exactly the squares whose info lists it (${MARKS.map((m, i) => `${counts[i]} ${m}s`).join(', ')})${disagree.length ? `: not ${disagree.slice(0, 5).join(', ')}` : ''}`);
  const mirrors = maps.flatMap((map, z) => Array.from({ length: map.descriptor.width * map.descriptor.height }, (_, n) => ({ map: z, x: Math.floor(n / map.descriptor.height), y: n % map.descriptor.height })))
    .filter((at) => info.describe(at).some((l) => l.text.includes('Champion mirror')));
  check(mirrors.length > 0 && mirrors.every((at) => !info.marked(at.map, 'item').has(at.x * 32 + at.y)),
    `no mirror marked for the items of the champion it holds (${mirrors.length} mirrors)`);

  // A cross on a square of 3: its five pixels lit, the corners the room's colour.
  party.position.z = 1;
  openMapDialog(ui);
  ui.mapDialog!.mark = 'monster';
  ui.mapDialog!.selected = null; ui.mapDialog!.rows = [];
  drawMapDialog(ui);
  const first = [...info.marked(1, 'monster')][0]!;
  const cs = cellSquare(l1, Math.floor(first / 32), first % 32);
  const room = ROOM_COLORS[getRoomType(maps[1].cellFlags[Math.floor(first / 32)][first % 32])];
  const cross = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]].every(([dx, dy]) => at(cs.x1 + dx, cs.y1 + dy) === MARK_COLOR);
  const corners = [[0, 0], [2, 0], [0, 2], [2, 2]].every(([dx, dy]) => at(cs.x1 + dx, cs.y1 + dy) === room);
  check(cs.x2 - cs.x1 === 2 && cross && corners, 'on a square of 3, the cross\'s five pixels lit, its corners the room\'s colour');
  closeMapDialog(ui);
  ui.mapDialogMark = null;
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

  const party = game.ctx.party.state;
  check(openMapDialog(ui) && isDialogOpen(ui) && ui.ctx.state.paused, 'with MAP VIEW on, it opens, and the clock is held');
  const shown = ui.mapDialog!.selected;
  check(shown?.map === party.position.z && shown.x === party.position.x && shown.y === party.position.y
    && ui.mapDialog!.rows[0]?.text.startsWith(`(${party.position.x},${party.position.y})`), 'it opens on the party\'s square, its info shown');
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

  // A click on a square, then on a link.
  party.position.x = 2; party.position.y = 2; party.position.z = 1;
  const maps = game.ctx.dungeon.getData().maps;
  const layout = mapLayout(maps[1].descriptor.width, maps[1].descriptor.height);
  const square = (x: number, y: number) => centre(cellSquare(layout, x, y));
  openMapDialog(ui);
  const state = ui.mapDialog!;
  check(mapDialogPointer(ui, square(3, 4)) && !mapDialogPointer(ui, { x: square(3, 4).x + 1, y: square(3, 4).y }),
    'the pointer moved onto a square changes what is drawn, and along it does not');
  mapDialogClick(ui, square(3, 4).x, square(3, 4).y, 2);
  check(state.selected?.x === 3 && state.selected.y === 4 && party.position.x === 2 && party.position.y === 2,
    'without `?dev`, a click on a square shows it, and moves no one');
  const list = listIn(layout.info);
  const keyRow = state.rows.findIndex((r) => r.link?.map === 11);
  check(keyRow >= 0, 'the lock\'s info has a link to the topaz key on level 12');
  mapDialogWheel(ui, 1000);
  const top = state.scrollTop;
  mapDialogWheel(ui, -1000);
  check(state.scrollTop === 0 && top === Math.max(0, state.rows.length - list.rows), `the wheel scrolls the info to its last page (${top}) and back`);
  const r = listRowRect(list, keyRow);
  mapDialogClick(ui, r.x1 + 4, r.y1 + 2, 2);
  check(state.map === 11 && state.selected?.map === 11 && state.selected.x === 19 && state.selected.y === 21,
    'a click on the link shows the key\'s square, on level 12');

  // `<` and `>`.
  const prev = centre(buttonRect(PREV_FRAME));
  const next = centre(buttonRect(NEXT_FRAME));
  mapDialogClick(ui, prev.x, prev.y, 2);
  check(state.map === 10 && state.selected === null, '`<` shows the level before, no square shown');
  for (let i = 0; i < 20; i++) mapDialogClick(ui, next.x, next.y, 2);
  check(state.map === maps.length - 1, '`>` stops at the last level');
  for (let i = 0; i < 20; i++) mapDialogClick(ui, prev.x, prev.y, 2);
  check(state.map === 0, '`<` stops at the first');

  // The marks' toggles.
  const toggle = MARK_FRAMES.map((f) => centre(buttonRect(f)));
  check(state.mark === null, 'it first opens marking nothing');
  mapDialogClick(ui, toggle[0]!.x, toggle[0]!.y, 2);
  check(state.mark === 'generator', 'G marks the generators');
  mapDialogClick(ui, toggle[1]!.x, toggle[1]!.y, 2);
  check(state.mark === 'monster', 'M marks the monsters, and lets G go');
  mapDialogClick(ui, toggle[1]!.x, toggle[1]!.y, 2);
  check(state.mark === null, 'M again lets it go');
  mapDialogClick(ui, toggle[2]!.x, toggle[2]!.y, 2);
  mapDialogClick(ui, next.x, next.y, 2);
  check(state.mark === 'item', 'I marks the items, kept on the next level');
  closeMapDialog(ui);
  openMapDialog(ui);
  check(ui.mapDialog!.mark === 'item', 'and kept across a closing');
  ui.mapDialog!.mark = null;
  closeMapDialog(ui);

  // `?dev`'s long press.
  const moves: string[] = [];
  const dev = freshUI(game, true, (map, x, y) => moves.push(`${map}:${x},${y}`));
  openMapDialog(dev);
  dev.dialog!.click(dev, square(5, 7).x, square(5, 7).y, 2);
  check(moves.length === 0, 'with `?dev`, a click on a square asks for nothing at once');
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(moves.join() === '1:5,7' && isDialogOpen(dev), 'held, it asks for (5,7) of map 1, and the dialog stays up on the party\'s level');
  dev.dialog!.release!(dev);
  dev.dialog!.click(dev, square(6, 7).x, square(6, 7).y, 2);
  await sleep(MESSAGE_LONG_PRESS_MS / 2);
  dev.dialog!.release!(dev);
  await sleep(MESSAGE_LONG_PRESS_MS);
  check(moves.length === 1, 'let go before, it asks for nothing');
  dev.dialog!.click(dev, square(6, 7).x, square(6, 7).y, 2);
  dev.dialog!.drag!(dev, square(8, 7).x, square(8, 7).y);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(moves.length === 1, 'moved off the square, it asks for nothing');
  dev.dialog!.release!(dev);
  dev.dialog!.click(dev, square(-1, -1).x - 3, square(0, 0).y, 2);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(moves.length === 1, 'held on the black around the map, it asks for nothing');
  dev.dialog!.release!(dev);
  mapDialogClick(dev, next.x, next.y, 2);
  const l2 = mapLayout(maps[2].descriptor.width, maps[2].descriptor.height);
  const there = centre(cellSquare(l2, 4, 4));
  dev.dialog!.click(dev, there.x, there.y, 2);
  await sleep(MESSAGE_LONG_PRESS_MS + 100);
  check(moves.at(-1) === '2:4,4' && !isDialogOpen(dev), 'held on a square of another level, it asks for it there, and the dialog closes');
}

console.log('\n=== 4. opening it ===');
{
  check(Object.values(KEY_PRESETS).every((table) => table.map[0] === '' && table.map[1] === ''), 'no preset binds MAP');

  const game = stockGame();
  let ui = freshUI(game, true);
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);
  const events: string[] = [];
  // CHAMPION VIEW is off: no press is held back (`tools/checks/champion-dialog.ts`).
  const screen: InputScreen = {
    get ui() { return ui; },
    screenPoint: (x, y) => ({ x, y }),
    setHoverPoint: () => {},
    handleMouseButton: () => {},
    handleDialogWheel: () => {},
  };
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
