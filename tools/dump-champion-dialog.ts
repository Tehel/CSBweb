/**
 * The champion dialog (`src/renderer/ui/ChampionDialog.ts`): everything about it the
 * golden frames cannot see.
 *
 * 1. **The layout**: CLOSE inside the plate's interior, clear of the page and its tabs;
 *    the tabs on the page's top edge, left of CLOSE; the table's panel inside the page;
 *    each tab's label inside it; each tab's rows, the names and the blank line under them inside
 *    the panel; every label inside its column, every name of the default dungeon's
 *    champions inside a champion's column, every reading and its bar inside it too.
 * 2. **The readings**, of `csbgame7.dat`'s four champions: a level or a sub-skill the
 *    mastery its experience gives, the bar filled as far as that experience is from the
 *    mastery's start to the next's; stamina a tenth of the stored maximum, as the
 *    inventory shows it. Drawn, a column holds nothing but the panel and its colour: lit
 *    where marked, dim for a dead champion, and nothing for an empty slot. The names, the
 *    maxima and the attributes end on the bars' last column.
 * 3. **The dialog**: shut with CHAMPION VIEW off, and over another dialog; open, the clock
 *    held; Esc, the CHAMPIONS key, CLOSE and a right click close it; a tab shows its rows.
 * 4. **Opening it**, through `GameInput`: the CHAMPIONS key, unbound in every preset; a
 *    left press on a champion's stat bars held `BARS_LONG_PRESS_MS` opens it, that
 *    champion marked, and queues nothing; let go before, it is queued at the release,
 *    where it was pressed, and is the box's inventory button; moved off the bars, queued
 *    then. Queued at once, as with no CHAMPION VIEW: a press on the name and hands, a
 *    right press on the bars, the bars of an empty slot, a press asleep.
 *
 * Run: `npx tsx tools/dump-champion-dialog.ts`
 */
import { readFileSync } from 'node:fs';
import type { Rect } from '../src/data/tables/UITables';
import type { Game } from '../src/engine/Game';
import { applySaveBytes } from '../src/engine/SaveGameFile';
import { determineMastery, ensureSkills } from '../src/engine/skills';
import { BARS_LONG_PRESS_MS, GameInput, type KeyPress } from '../src/renderer/GameInput';
import type { GameScreen } from '../src/renderer/GameScreen';
import {
  BAR_X1, BAR_X2, CLOSE_FRAME, COLUMN_WIDTH, LABEL_CHARS, LABEL_X, PAGE, PARTY_SIZE, TABLE_LINES, TABLE_PANEL, TABS, TAB_FRAMES,
  VALUE_CHARS, barFill, barRect, championBarsAt, columnRight, championDialogClick, championDialogPointer, closeChampionDialog, columnX,
  drawChampionDialog, lineY, openChampionDialog, skillProgress,
} from '../src/renderer/ui/ChampionDialog';
import { isDialogOpen } from '../src/renderer/ui/Dialog';
import { KEY_PRESETS, setKeyBindings, tableKeyButton } from '../src/renderer/ui/Keyboard';
import { MENU_GRAPHIC, MENU_OPTION_COLOR, MENU_PANEL_COLOR } from '../src/renderer/ui/Menu';
import { searchMouseButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import { openSettingsDialog } from '../src/renderer/ui/SettingsDialog';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHAR_WIDTH, DIM_COLOR, LIT_COLOR, buttonRect } from '../src/renderer/ui/Widgets';
import { Settings } from '../src/settings/Settings';
import { check, finish } from './lib/check';
import { presetHeroesOfGame, stockGame, stockGraphics } from './lib/game';
import { savePath } from './lib/saves';
import { newUIState } from './lib/ui';

const graphics = stockGraphics();
const image = graphics.getImage(MENU_GRAPHIC);
const menuBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };

function savedGame(name: string): Game {
  const game = stockGame();
  applySaveBytes(game, new Uint8Array(readFileSync(savePath(name))));
  return game;
}

function freshUI(game: Game, championView: boolean): UIState {
  const settings = new Settings(null);
  settings.update({ championView });
  return newUIState(graphics, game.ctx, { getGraphicBitmap: (n) => (n === MENU_GRAPHIC ? menuBitmap : null), settings });
}

const inside = (r: Rect, outer: Rect) => r.x1 >= outer.x1 && r.x2 <= outer.x2 && r.y1 >= outer.y1 && r.y2 <= outer.y2;
const overlap = (a: Rect, b: Rect) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
const centre = (r: Rect) => ({ x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A point on box `chIdx`'s stat bars: right of the name and hands, which end at x 42 of the box. */
const bars = (chIdx: number) => ({ x: chIdx * 69 + 55, y: 14 });

console.log('=== 1. the layout ===');
{
  const interior: Rect = { x1: 10, y1: 10, x2: 309, y2: 189 };
  const pageInterior: Rect = { x1: PAGE.x1 + 2, y1: PAGE.y1 + 2, x2: PAGE.x2 - 2, y2: PAGE.y2 - 2 };
  check(inside(CLOSE_FRAME, interior) && !overlap(CLOSE_FRAME, PAGE) && TAB_FRAMES.every((t) => !overlap(CLOSE_FRAME, t)),
    'CLOSE inside the plate\'s interior, clear of the page and its tabs');
  check(TAB_FRAMES.every((t) => t.y2 === PAGE.y1 + 1 && t.x1 > PAGE.x1 && t.x2 < CLOSE_FRAME.x1) && PAGE.x1 > 0 && PAGE.x2 < 319 && PAGE.y2 < 199,
    'the tabs stand on the page\'s top edge, left of CLOSE, the page inside the plate');
  check(inside(TABLE_PANEL, pageInterior), 'the table\'s panel inside the page');
  check(TABS.every((t, i) => t.label.length * CHAR_WIDTH <= TAB_FRAMES[i].x2 - TAB_FRAMES[i].x1 - 4), 'every tab\'s label fits inside its edge');

  const lines = TABS.map((t) => 2 + t.rows.length);
  check(lines.every((n) => n <= TABLE_LINES) && lineY(TABLE_LINES - 1) + 1 <= TABLE_PANEL.y2 - 2,
    `each tab's lines (${lines.join(', ')}) inside the panel's ${TABLE_LINES}`);
  const labels = TABS.flatMap((t) => t.rows.flatMap((r) => (r ? [r.label] : [])));
  check(labels.every((l) => l.length <= LABEL_CHARS) && LABEL_X + LABEL_CHARS * CHAR_WIDTH <= columnX(0),
    'every label inside the labels\' column, short of the first champion\'s');
  check(columnX(PARTY_SIZE - 1) + COLUMN_WIDTH - 1 <= TABLE_PANEL.x2 - 2, 'the last column inside the panel\'s edge');
  check(BAR_X1 > VALUE_CHARS * CHAR_WIDTH && BAR_X2 < COLUMN_WIDTH && BAR_X2 - BAR_X1 > 2, 'a bar right of its reading, inside its column');
  const names = presetHeroesOfGame(stockGame()).map((h) => h.name);
  const longest = Math.max(...names.map((n) => n.length));
  check(names.length === 24 && longest * CHAR_WIDTH <= COLUMN_WIDTH, `every name of the default dungeon's 24 champions (up to ${longest} characters) fits a column`);
}

console.log('\n=== 2. the readings ===');
{
  const game = savedGame('csbgame7.dat');
  const champions = game.ctx.party.state.champions;
  check(champions.length === 4, `csbgame7.dat has four champions (${champions.map((c) => c.name).join(', ')})`);
  const wrong: string[] = [];
  for (const champion of champions) {
    const skills = ensureSkills(champion.skills ?? []);
    for (let skill = 0; skill < 20; skill++) {
      const own = skills[skill].experience;
      const counted = skill < 4 ? own : Math.floor((own + skills[(skill - 4) >> 2].experience) / 2);
      // The mastery from the counted experience: 1 below 500, and one more at each doubling.
      let mastery = 1;
      for (let e = counted; e >= 500; e = Math.floor(e / 2)) mastery++;
      const start = mastery === 1 ? 0 : 500 * 2 ** (mastery - 2);
      const reading = skillProgress(champion, skill);
      const progress = (counted - start) / (500 * 2 ** (mastery - 1) - start);
      if (reading.value !== mastery || reading.value !== determineMastery(champion, skill | 0xc000)
        || Math.abs(reading.progress - progress) > 1e-9 || progress < 0 || progress >= 1) {
        wrong.push(`${champion.name} skill ${skill}`);
      }
    }
  }
  check(wrong.length === 0, `every level and sub-skill its mastery, the bar its progress${wrong.length ? `: not ${wrong.join(', ')}` : ''}`);
  const stamina = TABS[0].rows.find((r) => r?.label === 'STAMINA')!;
  check(champions.every((c) => stamina.read(c).value === Math.floor(c.attributes.maxStamina / 10)),
    `stamina a tenth of the stored maximum (${champions.map((c) => `${c.attributes.maxStamina} as ${stamina.read(c).value}`).join(', ')})`);
  const luck = TABS[0].rows.find((r) => r?.label === 'LUCK')!;
  check(champions.every((c) => luck.read(c).value === c.attributes.stats[0].maximum), 'LUCK is attribute 0\'s maximum');

  // Drawn: a column holds the panel and one colour.
  const colours = (ui: UIState, chIdx: number, rows: number) => {
    const buf = ui.screenIndexBuffer;
    const seen = new Set<number>();
    for (let y = lineY(0) - 4; y <= lineY(rows - 1) + 1; y++) {
      for (let x = columnX(chIdx); x < columnX(chIdx) + COLUMN_WIDTH; x++) seen.add(buf.pixels[y * buf.width + x]);
    }
    return [...seen].sort((a, b) => a - b).join();
  };
  const ui = freshUI(game, true);
  const rows = 2 + TABS[0].rows.length;
  champions[2].attributes.health = 0;
  openChampionDialog(ui, 1);
  drawChampionDialog(ui);
  const panel = String(MENU_PANEL_COLOR);
  const want = (c: number) => [MENU_PANEL_COLOR, c].sort((a, b) => a - b).join();
  check(colours(ui, 0, rows) === want(MENU_OPTION_COLOR) && colours(ui, 3, rows) === want(MENU_OPTION_COLOR),
    'a living champion\'s column in the option colour on the panel');
  check(colours(ui, 1, rows) === want(LIT_COLOR), 'the marked champion\'s, lit');
  check(colours(ui, 2, rows) === want(DIM_COLOR), 'a dead champion\'s, dim');

  // The bars: on the middle row, the outline's two columns and as many inside as the progress fills.
  const buf = ui.screenIndexBuffer;
  const badBars: string[] = [];
  TABS[0].rows.forEach((row, i) => {
    const reading = row?.read(champions[0]);
    if (reading?.progress === undefined) return;
    const bar = barRect(0, lineY(2 + i));
    const middle = (bar.y1 + bar.y2) >> 1;
    let lit = 0;
    for (let x = bar.x1; x <= bar.x2; x++) if (buf.pixels[middle * buf.width + x] === MENU_OPTION_COLOR) lit++;
    if (lit !== 2 + barFill(bar, reading.progress)) badBars.push(row!.label);
  });
  check(badBars.length === 0, `each level's bar filled as far as its progress${badBars.length ? `: not ${badBars.join(', ')}` : ''}`);

  // The right edge: on each line, the column's last inked pixel.
  const lastInk = (chIdx: number, y: number) => {
    let last = -1;
    for (let py = y - 4; py <= y; py++) {
      for (let x = columnX(chIdx); x < columnX(chIdx) + COLUMN_WIDTH; x++) if (buf.pixels[py * buf.width + x] !== MENU_PANEL_COLOR) last = Math.max(last, x);
    }
    return last;
  };
  const ragged: string[] = [];
  champions.forEach((champion, chIdx) => {
    if (lastInk(chIdx, lineY(0)) !== columnRight(chIdx)) ragged.push(`${champion.name}'s name`);
    TABS[0].rows.forEach((row, i) => {
      if (row && lastInk(chIdx, lineY(2 + i)) !== columnRight(chIdx)) ragged.push(`${champion.name}'s ${row.label}`);
    });
  });
  check(ragged.length === 0, `every name, level, maximum and attribute ends on the bars' last column${ragged.length ? `: not ${ragged.join(', ')}` : ''}`);
  closeChampionDialog(ui);

  const three = savedGame('csbgame-early-3hero-nospace.dat');
  const ui3 = freshUI(three, true);
  openChampionDialog(ui3);
  drawChampionDialog(ui3);
  check(colours(ui3, 3, rows) === panel, 'with three champions, the fourth column is blank');
}

console.log('\n=== 3. the dialog ===');
{
  const game = savedGame('csbgame7.dat');
  const off = freshUI(game, false);
  check(!openChampionDialog(off) && !isDialogOpen(off), 'with CHAMPION VIEW off, it does not open');

  const ui = freshUI(game, true);
  openSettingsDialog(ui);
  check(!openChampionDialog(ui) && ui.settingsDialog !== null, 'over the settings, it does not open');
  ui.settingsDialog = null; ui.dialog = null; ui.ctx.state.paused = false;

  check(openChampionDialog(ui) && isDialogOpen(ui) && ui.ctx.state.paused && ui.championDialog?.marked === null
    && ui.championDialog.tab === 'attributes', 'with CHAMPION VIEW on, it opens on ATTRIBUTES, nothing marked, and the clock is held');
  ui.dialog!.key(ui, 'Escape', 'Escape');
  check(!isDialogOpen(ui) && !ui.ctx.state.paused, 'Esc closes it, and the clock runs');

  setKeyBindings({ ...KEY_PRESETS.csbwin, champions: ['KeyN', ''] });
  openChampionDialog(ui);
  ui.dialog!.key(ui, 'k', 'KeyK');
  check(isDialogOpen(ui), 'a key bound to something else leaves it up');
  ui.dialog!.key(ui, 'n', 'KeyN');
  check(!isDialogOpen(ui), 'the CHAMPIONS key closes it');
  setKeyBindings(KEY_PRESETS.csbwin);

  openChampionDialog(ui);
  const skills = centre(buttonRect(TAB_FRAMES[1]));
  check(championDialogPointer(ui, skills), 'the pointer moved onto SKILLS changes what is drawn');
  check(!championDialogPointer(ui, { x: skills.x + 1, y: skills.y }), 'and moved along it, does not');
  championDialogClick(ui, skills.x, skills.y, 2);
  check(ui.championDialog?.tab === 'skills', 'a click on SKILLS shows the sub-skills');
  const attributes = centre(buttonRect(TAB_FRAMES[0]));
  championDialogClick(ui, attributes.x, attributes.y, 2);
  check(ui.championDialog?.tab === 'attributes', 'and on ATTRIBUTES, the attributes');
  championDialogClick(ui, 160, 100, 2);
  check(isDialogOpen(ui), 'a left click on the table leaves it up');
  const close = centre(buttonRect(CLOSE_FRAME));
  championDialogClick(ui, close.x, close.y, 2);
  check(!isDialogOpen(ui), 'CLOSE closes it');
  openChampionDialog(ui);
  championDialogClick(ui, 160, 100, 1);
  check(!isDialogOpen(ui), 'a right click closes it');
}

console.log('\n=== 4. opening it ===');
{
  check(Object.values(KEY_PRESETS).every((table) => table.champions[0] === '' && table.champions[1] === ''), 'no preset binds CHAMPIONS');

  const game = savedGame('csbgame7.dat');
  let ui = freshUI(game, true);
  const events: string[] = [];
  const input = new GameInput({
    game: {
      mainLoopHasReturned: () => false,
      onMouseClick: (x: number, y: number, b: number) => events.push(`click ${searchMouseButtons(ui, x, y, b)} at ${x},${y}`),
      onMouseUnClick: () => events.push('unclick'),
      enqueueKeyButton: () => {},
      isPartySleeping: () => false,
      isFrozen: () => false,
    } as unknown as Game,
    screen: {
      isDialogOpen: () => isDialogOpen(ui),
      screenPoint: (x: number, y: number) => ({ x, y }),
      openSettings: () => openSettingsDialog(ui),
      openMap: () => false,
      openChampions: (marked: number | null = null) => openChampionDialog(ui, marked),
      championBarsAt: (x: number, y: number) => championBarsAt(ui, x, y),
      handleDialogClick: (x: number, y: number, b: number) => ui.dialog?.click(ui, x, y, b),
      handleDialogKey: (key: string, code: string) => ui.dialog?.key(ui, key, code),
      handleDialogRelease: () => {},
      isReincarnateScreenOpen: () => false,
      searchMouseButtons: (x: number, y: number, b: number) => searchMouseButtons(ui, x, y, b),
      translateKey: (code: string) => tableKeyButton(ui, code),
      handleUIKey: () => false,
      isHintOracleUp: () => false,
      setHoverPoint: () => {},
    } as unknown as GameScreen,
    refreshScreen: () => {},
    onQuickSave: () => {},
    onQuickLoad: () => {},
  });
  const adventure = (championView: boolean) => {
    ui = freshUI(game, championView);
    ui.uiMode = UIMode.Adventure;
    updateButtonLists(ui);
  };
  const press = (code: string): KeyPress => ({ key: code, code, ctrlKey: false, metaKey: false, altKey: false });
  adventure(true);

  check(!input.keyDown(press('KeyN')), 'unbound, N is nobody\'s');
  setKeyBindings({ ...KEY_PRESETS.csbwin, champions: ['KeyN', ''] });
  check(input.keyDown(press('KeyN')) && ui.championDialog?.marked === null, 'bound to CHAMPIONS, it opens the champions, nothing marked');
  input.keyDown(press('KeyN'));
  check(!isDialogOpen(ui), 'and again, closes them');
  setKeyBindings(KEY_PRESETS.csbwin);

  const at = bars(1);
  check(searchMouseButtons(ui, at.x, at.y, 2) === 8, 'a left click on champion 2\'s bars is the box\'s inventory button, 8');
  input.mouseDown(at.x, at.y, 0);
  await sleep(BARS_LONG_PRESS_MS + 100);
  check(ui.championDialog?.marked === 1 && events.length === 0, 'a press held on the bars opens the champions, champion 2 marked, and queues nothing');
  input.mouseUp();
  check(isDialogOpen(ui) && events.length === 0, 'the release is the dialog\'s, and queues nothing');
  closeChampionDialog(ui);

  input.mouseDown(at.x, at.y, 0);
  await sleep(BARS_LONG_PRESS_MS / 2);
  check(events.length === 0, 'a press on the bars is held back');
  input.mouseUp();
  check(events.join('; ') === `click 8 at ${at.x},${at.y}; unclick`, 'let go before, it is queued at the release, as the inventory button, where it was pressed');
  await sleep(BARS_LONG_PRESS_MS);
  check(!isDialogOpen(ui), 'and opens nothing');

  events.length = 0;
  input.mouseDown(at.x, at.y, 0);
  input.mouseMove(at.x + 2, at.y + 3);
  check(events.length === 0, 'moved along the bars, it is still held');
  input.mouseMove(100, 100);
  check(events.join('; ') === `click 8 at ${at.x},${at.y}`, 'moved off them, it is queued then, where it was pressed');
  await sleep(BARS_LONG_PRESS_MS + 100);
  input.mouseUp();
  check(!isDialogOpen(ui) && events.length === 2, 'and opens nothing; its release is queued');

  events.length = 0;
  input.mouseDown(at.x, at.y, 0);
  input.mouseLeave();
  check(events.length === 1, 'the pointer gone from the canvas, it is queued');
  input.mouseUp();

  const atOnce = async (what: string, x: number, y: number, button: number) => {
    events.length = 0;
    input.mouseDown(x, y, button);
    const queued = events.length === 1;
    await sleep(BARS_LONG_PRESS_MS + 100);
    input.mouseUp();
    check(queued && !isDialogOpen(ui), `${what}: queued at once, and nothing opens`);
  };
  await atOnce('a press on champion 2\'s name and hands', 75, 14, 0);
  await atOnce('a right press on the bars', at.x, at.y, 2);
  adventure(false);
  await atOnce('with CHAMPION VIEW off, a press on the bars', at.x, at.y, 0);

  const three = savedGame('csbgame-early-3hero-nospace.dat');
  ui = freshUI(three, true);
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);
  await atOnce('with three champions, a press on the fourth box\'s bars', bars(3).x, bars(3).y, 0);
  check(championBarsAt(ui, bars(2).x, bars(2).y) === 2, 'while the third\'s are held back');
  ui.uiMode = UIMode.Sleeping;
  updateButtonLists(ui);
  await atOnce('asleep, a press on the bars', bars(0).x, bars(0).y, 0);
}

finish();
