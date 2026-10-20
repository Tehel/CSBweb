/**
 * The Hint Oracle's button: the inventory's close box, where the data set has the
 * Oracle's files.
 *
 * CSBWin reaches the Oracle from its launcher's HINT choice, which the port does not have
 * (`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`), and the Oracle reads the party's square from
 * a saved game. The port opens it in the game, on the square the party stands on, from
 * the close box, `buttons17760`'s button 11 (`doc/CSBWIN_MENU_REFERENCE.md` → "The disk
 * icon"), which then no longer closes the inventory (`DEBT.md` H): its entry is searched
 * as `HINT_ORACLE_BUTTON`. The inventory still closes the way it opens, with a right
 * click or the champion's name.
 *
 * The click is the disk icon's (`doc/CSBwin-src/Mouse.cpp:1847-1866`): refused with an
 * empty party or a champion only provisionally joined, it raises a flag, and whoever
 * drained the mouse queue opens the screen (`GameScreen.handleMouseButton`). `TAG02076e`
 * runs before it and `TAG0207cc` after it, as around the disk menu
 * (`doc/CSBwin-src/SaveGame.cpp:877`, `:1375`), and the clock stands still while it is up,
 * as under the disk menu (`ctx.state.paused`).
 *
 * The screen itself is `HintOracleScreen` (`src/renderer/intro/HintOracle.ts`), which the
 * page runs over an `IntroHost` (`runHintOracle`, `src/renderer/intro/BootSequence.ts`).
 */
import type { HcsbDat } from '../../data/HintOracleLoader';
import type { Rect, UIButton } from '../../data/tables/UITables';
import type { HintSquare } from '../intro/HintOracle';
import { tag02076e, tag0207cc } from './Mouse';
import type { UIState } from './UIState';

/**
 * The Oracle's two files: `hcsb.hct` as fetched, which `readHintOracle` reads under the
 * running world's `hintKey` when the Oracle opens, and `hcsb.dat` as read.
 */
export interface HintOracleFiles {
  hct: Uint8Array;
  dat: HcsbDat;
}

/** The close box's id in `buttons17760`, `ShowHideInventory(4)` in CSBWin. */
const CLOSE_BOX_BUTTON = 11;

/**
 * The Oracle's button, the port's own number: CSBWin has no button 149. `buttons17760`
 * holds button 11 twice, the close box for the left button and the whole screen for the
 * right (its first entry), and the mouse queue carries the button's number alone. So
 * with the Oracle the close box's entry is searched as this number, and a right click
 * still closes the inventory.
 */
export const HINT_ORACLE_BUTTON = 149;

/** The close box's entry of `buttons17760`: button 11, for the left button (mask 2). */
function isCloseBox(b: UIButton): boolean {
  return b.word0 === CLOSE_BOX_BUTTON && b.button === 2;
}

const withOracleButton = new WeakMap<UIButton[], UIButton[]>();

/**
 * The inventory's secondary list, `buttons17760`, as `ShowHideInventory` installs it
 * (`doc/CSBwin-src/CSBCode.cpp:7577`): with the Oracle, its close box is `HINT_ORACLE_BUTTON`.
 */
export function inventoryButtonList(ui: UIState): UIButton[] {
  const list = ui.uiTables.graphic231.buttons.buttons17760;
  if (!ui.hintOracle) return list;
  let renumbered = withOracleButton.get(list);
  if (!renumbered) {
    renumbered = list.map((b) => (isCloseBox(b) ? { ...b, word0: HINT_ORACLE_BUTTON } : b));
    withOracleButton.set(list, renumbered);
  }
  return renumbered;
}

/** The font's width and its transparent colour (`TAG004962`, `doc/CSBwin-src/Hint.cpp:4158-4165`). */
const FONT_WIDTH = 256;
const FONT_TRANSPARENT = 12;
/** `TAG004962`'s glyph: 8 wide, 9 high. */
const GLYPH_WIDTH = 8;
const GLYPH_HEIGHT = 9;

/** The close box's rectangle, as `buttons17760` gives it, in screen coordinates. */
export function closeBoxRect(ui: UIState): Rect | null {
  return ui.uiTables.graphic231.buttons.buttons17760.find(isCloseBox) ?? null;
}

/**
 * The button's picture, over the close box that graphic 17 has just drawn: the Oracle's
 * own `?`, the glyph `TAG004962` draws for it from `hcsb.dat` item 2 (`Hint.cpp:4158-4165`),
 * in the close box's two colours, read from graphic 17 where they stand: its paper the
 * middle of the box's top line, its ink the middle of the box, where the X crosses. The
 * glyph's cell starts a pixel in from the box's top left corner, which puts the stem on
 * the box's middle column and leaves a line above and below.
 */
export function drawHintOracleButton(ui: UIState): void {
  if (!ui.hintOracle) return;
  const box = closeBoxRect(ui);
  if (!box) return;
  const screen = ui.screenIndexBuffer;
  const at = (x: number, y: number): number => screen.pixels[y * screen.width + x]!;
  const midX = (box.x1 + box.x2) >> 1;
  const paper = at(midX, box.y1);
  const ink = at(midX, (box.y1 + box.y2) >> 1);
  const font = ui.hintOracle.dat.font.pixels;
  const b9 = '?'.charCodeAt(0) - 32;
  const srcX = 8 * (b9 & 0x1f);
  const srcY = 9 * Math.trunc(b9 / 32);
  for (let y = box.y1; y <= box.y2; y++) {
    for (let x = box.x1; x <= box.x2; x++) {
      const row = y - box.y1 - 1;
      const col = x - box.x1 - 1;
      const inGlyph = row >= 0 && row < GLYPH_HEIGHT && col >= 0 && col < GLYPH_WIDTH;
      const glyph = inGlyph && font[(srcY + row) * FONT_WIDTH + srcX + col] !== FONT_TRANSPARENT;
      screen.pixels[y * screen.width + x] = glyph ? ink : paper;
    }
  }
}

/** The square the Oracle answers for: the party's, which a save writes as `partyLevel`, `partyX` and `partyY`. */
function hintSquareOf(ui: UIState): HintSquare {
  const { x, y, z } = ui.partyState.position;
  return { level: z, x, y };
}

/**
 * The flag acted on: `TAG02076e`, the clock stopped, and the screen's paint held for the
 * Oracle's (`hintOracleUp`). Returns the square to open the Oracle on.
 */
export function openHintOracle(ui: UIState): HintSquare {
  tag02076e(ui);
  ui.ctx.state.paused = true;
  ui.hintOracleUp = true;
  return hintSquareOf(ui);
}

/** The Oracle closed: the clock runs again, and `TAG0207cc` shows the inventory again. */
export function closeHintOracle(ui: UIState): void {
  if (!ui.hintOracleUp) return;
  ui.hintOracleUp = false;
  ui.ctx.state.paused = false;
  tag0207cc(ui);
}
