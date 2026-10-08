/**
 * The Hint Oracle's button (`src/renderer/ui/HintOracleButton.ts`): the inventory's close
 * box, where the data set has `hcsb.hct` and `hcsb.dat`. On CSB's `csbgame2.dat`, whose
 * party of two stands on level 4 (22,18), with the retail Oracle files.
 *
 * 1. **The picture**: the close box, button 11 of `buttons17760` at x 210-218, y 36-44,
 *    is the Oracle's `?` in the box's two colours, white on red, where graphic 17 has its X.
 *    Without the files the X stays.
 * 2. **The click**, queued on the mouse queue as a click on the box is, the port's button
 *    149 (`HINT_ORACLE_BUTTON`) where CSBWin's is 11: the flag, then
 *    `TAG02076e`'s shading and the clock stopped while the Oracle is up; the Oracle, run
 *    on the square it is handed, lists the titles `hintsAtPosition` finds there; closed,
 *    `TAG0207cc`, the inventory open again and the clock running.
 * 3. **The square is the party's**, after a step, a teleporter to level 0 (3,23), which
 *    lists CREATURES, THE MAZE and FULYA PIT, and a pit down to level 1, each list
 *    different from the one before.
 * 4. **Refused** while a champion is only provisionally joined, as the disk icon is.
 * 5. **Closing**: a right click is still button 11 and closes the inventory, and without
 *    the files, as in DM, the close box is button 11 and closes it too.
 *
 * Run: `npx tsx tools/dump-hint-oracle-button.ts`
 */
import { readFileSync } from 'node:fs';

import { Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { hintsAtPosition, MAXHINTINDICES, parseHcsbDat, parseHintOracle, readHintOracle } from '../src/data/HintOracleLoader';
import type { Game } from '../src/engine/Game';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { MovementAction } from '../src/engine/gameTypes';
import type { IntroEvent } from '../src/renderer/intro/IntroHost';
import { HINT_BUTTON, HintOracleScreen, hintButtonRect, type HintOracleHost, type HintSquare } from '../src/renderer/intro/HintOracle';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { closeBoxRect, closeHintOracle, drawHintOracleButton, HINT_ORACLE_BUTTON, openHintOracle, type HintOracleFiles } from '../src/renderer/ui/HintOracleButton';
import { drawInventoryBackground } from '../src/renderer/ui/Inventory';
import { handleMouseButton, handleMouseUnclick, searchMouseButtons, updateButtonLists } from '../src/renderer/ui/Mouse';
import type { UIState } from '../src/renderer/ui/UIState';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { newGame, runVbl, TICK_DUE } from './lib/game';
import { rigTeleporter } from './lib/teleporter';
import { newUIState } from './lib/ui';

const CSB = 'static/gamefiles/csb';
const files: HintOracleFiles = {
  hct: new Uint8Array(readFileSync(`${CSB}/hcsb.hct`)),
  dat: parseHcsbDat(new Uint8Array(readFileSync(`${CSB}/hcsb.dat`))),
};
const plain = parseHintOracle(files.hct);
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(`${CSB}/graphics.dat`)));

/** The CSB game, its interface, and the squares the Oracle was opened on. */
interface Setup {
  game: Game;
  ui: UIState;
  opened: HintSquare[];
}

/**
 * `csbgame2.dat` read over CSB's `dungeon.dat`, with the interface's dispatcher handed to
 * the game as `GameInput.install` hands it, and `GameScreen.handleMouseButton`'s act on
 * the flag after it.
 */
function setup(withOracle: boolean): Setup {
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${CSB}/dungeon.dat`))), graphics);
  applyCsbwinSave(game, new Uint8Array(readFileSync(`${CSB}/csbgame2.dat`)));
  const opened: HintSquare[] = [];
  const cache = new Map<string, IndexedBitmap>();
  const ui = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n) => getCachedGraphicBitmap(graphics, cache, n),
    onOpenHintOracle: (square) => opened.push(square),
  });
  if (withOracle) ui.hintOracle = files;
  updateButtonLists(ui);
  game.setMouseEventHandlers({
    translate: (x, y, buttons) => searchMouseButtons(ui, x, y, buttons),
    button: (num, x, y) => {
      handleMouseButton(ui, num, x, y);
      if (ui.hintOracleNeeded) {
        ui.hintOracleNeeded = false;
        ui.onOpenHintOracle(openHintOracle(ui));
      }
    },
    unclick: () => handleMouseUnclick(ui),
  });
  return { game, ui, opened };
}

/** A left click at (x, y), searched in the interface's lists and queued, then a VBL to take it. */
function click(s: Setup, x: number, y: number, buttons = 2): number {
  const id = searchMouseButtons(s.ui, x, y, buttons);
  s.game.onMouseClick(x, y, buttons);
  runVbl(s.game);
  s.game.onMouseUnClick();
  runVbl(s.game);
  return id;
}

/** A move queued as its key queues it, and ticks enough for it and for the level it reaches. */
function move(s: Setup, action: MovementAction): void {
  s.game.enqueueMovement(action);
  for (let i = 0; i < 8; i++) runVbl(s.game, TICK_DUE);
}

/** The Oracle on `square`, run headlessly to its title list, whose titles are read, then DONE. */
async function oracleTitles(ui: UIState, square: HintSquare): Promise<string[]> {
  let titles: string[] | null = null;
  const queue: IntroEvent[] = [];
  const done = hintButtonRect(HINT_BUTTON.DONE)!;
  const host: HintOracleHost = {
    screen: ui.screenIndexBuffer,
    globalPalette: ui.uiTables.graphic232.palette552[0]!.slice(),
    present: () => {},
    vbl: async () => {
      if (titles === null && oracle.waiting && oracle.w_4 === 2) {
        titles = oracle.titles();
        queue.push({ kind: 'click', x: done.x1 + 2, y: done.y1 + 2, buttons: 2 });
      }
    },
    takeClick: () => queue.shift() ?? null,
    discardAllInput: () => { queue.length = 0; },
  };
  // As the page opens it, under the running world's key (`runHintOracle`).
  const oracle = new HintOracleScreen(host, readHintOracle(files.hct, ui.ctx.state.dungeon.hintKey), files.dat, square);
  await oracle.run();
  return titles ?? [];
}

const titlesAt = (sq: HintSquare): string[] =>
  hintsAtPosition(plain, sq.level, sq.x, sq.y).slice(0, MAXHINTINDICES).map((i) => plain.hints[i]!.title);
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const where = (sq: HintSquare): string => `level ${sq.level} (${sq.x},${sq.y})`;

/** Champion 0's inventory, opened by a right click on their party block, as a player opens it. */
function openInventory(s: Setup): void {
  click(s, 15, 15, 1);
  check(s.ui.partyState.selectedCharacterIndex === 0, 'a right click on the first party block opens its inventory');
}

/**
 * The button clicked, the Oracle run on the square it was opened on, and closed.
 * Returns the titles it listed.
 */
async function askOracle(s: Setup, when: string): Promise<string[]> {
  const box = closeBoxRect(s.ui)!;
  const before = s.opened.length;
  const id = click(s, box.x1 + 4, box.y1 + 4);
  check(id === HINT_ORACLE_BUTTON && s.opened.length === before + 1, `${when}: a click on the close box is the Oracle's button, and opens the Oracle`);
  const square = s.opened[s.opened.length - 1]!;
  const { x, y, z } = s.ui.partyState.position;
  check(square.level === z && square.x === x && square.y === y && s.game.ctx.loop.newPartyLevel === -1,
    `${when}: on the party's square, ${where(square)}`);
  check(s.ui.hintOracleUp && s.game.ctx.state.paused && s.ui.shadedByTag02076e,
    `${when}: TAG02076e has shaded the interface, the clock is stopped, and the Oracle has the screen`);
  const time = s.game.ctx.state.tickCount;
  for (let i = 0; i < 3; i++) runVbl(s.game, TICK_DUE);
  check(s.game.ctx.state.tickCount === time, `${when}: no tick runs while the Oracle is up`);
  const titles = await oracleTitles(s.ui, square);
  check(same(titles, titlesAt(square)), `${when}: the Oracle lists ${titlesAt(square).join(', ')} (got ${titles.join(', ')})`);
  closeHintOracle(s.ui);
  check(!s.ui.hintOracleUp && !s.game.ctx.state.paused && !s.ui.shadedByTag02076e && s.ui.partyState.selectedCharacterIndex === 0,
    `${when}: closed, TAG0207cc has the inventory open again, and the clock runs`);
  runVbl(s.game, TICK_DUE);
  check(s.game.ctx.state.tickCount === time + 1, `${when}: then the tick runs`);
  return titles;
}

async function main(): Promise<void> {
  /* ------------------------------------------------------------ 1. the picture ---- */

  const s = setup(true);
  const box = closeBoxRect(s.ui)!;
  check(box.x1 === 210 && box.x2 === 218 && box.y1 === 36 && box.y2 === 44, `the close box is x 210-218, y 36-44 (got x ${box.x1}-${box.x2}, y ${box.y1}-${box.y2})`);
  const boxPixels = (ui: UIState = s.ui): number[] => {
    const screen = ui.screenIndexBuffer;
    const out: number[] = [];
    for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) out.push(screen.pixels[y * screen.width + x]!);
    return out;
  };
  drawInventoryBackground(s.ui);
  const cross = boxPixels();
  check(cross.every((p) => p === 8 || p === 15) && cross[4] === 8 && cross[40] === 15,
    'graphic 17 draws the close box as a white X (15) on red (8)');
  drawHintOracleButton(s.ui);
  const font = files.dat.font;
  const want: number[] = [];
  for (let row = -1; row < 8; row++) {
    for (let col = -1; col < 8; col++) {
      const glyph = row >= 0 && col >= 0 && font.pixels[row * font.width + 248 + col] !== 12;
      want.push(glyph ? 15 : 8);
    }
  }
  const question = boxPixels();
  check(same(question.map(String), want.map(String)), 'with the Oracle, the box is its ? (font glyph 31), white on red, a pixel in from the top left');
  check(question.filter((p) => p === 15).length === 13, 'the ? has thirteen pixels');
  const dm = setup(false);
  drawInventoryBackground(dm.ui);
  drawHintOracleButton(dm.ui);
  check(same(boxPixels(dm.ui).map(String), cross.map(String)), 'without the files the X stays');

  /* ------------------------------------------- 2-3. the click, and the square ---- */

  openInventory(s);
  const start = await askOracle(s, 'at the start');

  move(s, MovementAction.MOVE_BACKWARD);
  const p1 = s.ui.partyState.position;
  check(p1.x === 22 && p1.y === 17 && p1.z === 4, `a step back takes the party to level 4 (22,17) (got ${where({ level: p1.z, x: p1.x, y: p1.y })})`);
  const stepped = await askOracle(s, 'after a step');
  check(!same(stepped, start), 'the step changes the list');

  rigTeleporter(s.game, new Position(22, 16, 4), new Position(3, 23, 0));
  move(s, MovementAction.MOVE_BACKWARD);
  const p2 = s.ui.partyState.position;
  check(p2.x === 3 && p2.y === 23 && p2.z === 0, `a teleporter takes the party to level 0 (3,23) (got ${where({ level: p2.z, x: p2.x, y: p2.y })})`);
  const teleported = await askOracle(s, 'after a teleporter');
  check(same(teleported, ['CREATURES', 'THE MAZE', 'FULYA PIT']), 'there: CREATURES, THE MAZE, FULYA PIT');

  // The square east of the party, an open pit. Facing south, east is the left strafe.
  const map0 = s.game.ctx.dungeon.getMap(0)!;
  map0.cellFlags[4]![23] = (RoomType.PIT << 5) | 0x08;
  move(s, MovementAction.STRAFE_LEFT);
  const p3 = s.ui.partyState.position;
  check(p3.z === 1, `the pit at level 0 (4,23) drops the party to level 1 (got ${where({ level: p3.z, x: p3.x, y: p3.y })})`);
  const fallen = await askOracle(s, 'after a pit');
  check(!same(fallen, teleported), 'the fall changes the list');

  /* -------------------------------------------------------------- 4. refused ---- */

  s.ui.partyState.potentialChampionIndex = 1;
  const opened = s.opened.length;
  click(s, box.x1 + 4, box.y1 + 4);
  check(s.opened.length === opened && !s.ui.hintOracleNeeded && s.ui.partyState.selectedCharacterIndex === 0,
    'with a champion only provisionally joined, the button does nothing');
  s.ui.partyState.potentialChampionIndex = -1;

  /* ---------------------------------------------------- 5. closing, and without ---- */

  // `buttons17760`'s first entry, button 11 for the right button over the whole screen.
  // A tick first: the refused click was the queue's one entry since the last
  // (`doc/CSBwin-src/Mouse.cpp:1591-1604`).
  runVbl(s.game, TICK_DUE);
  const rightId = click(s, box.x1 + 4, box.y1 + 4, 1);
  check(rightId === 11 && s.ui.partyState.selectedCharacterIndex === -1 && s.opened.length === opened,
    'with the Oracle, a right click, on the box or anywhere, is button 11 and closes the inventory');
  openInventory(dm);
  check(click(dm, box.x1 + 4, box.y1 + 4) === 11 && dm.ui.partyState.selectedCharacterIndex === -1 && dm.opened.length === 0,
    'without the files, the close box is button 11 and closes the inventory');

  finish();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
