/**
 * CSBWin's menu system: `_DoMenu` draws, `_WaitForMenuSelect` runs the modal loop.
 *
 * `doc/CSBWIN_MENU_REFERENCE.md` holds the sourced account; this is the port. The two
 * functions are `doc/CSBwin-src/Menu.cpp:245` and `:33`.
 *
 * Neither CSBWin function draws a button frame. The frames are painted into **graphic 0**
 * (224x136, `d.compressedGraphic0` = item 0 of `graphics.dat`, `Graphics.cpp:2002-2005`),
 * which carries a title panel, one full-width frame and a split pair below it. The four
 * layouts differ only in which part of that bitmap is blitted over itself:
 *
 * - one option  — slide rows 14..88 down to 51..125, so the single frame lands on the
 *   bottom row (`rect18576` into a temp buffer, back out through `rect18584`);
 * - two options — paint the gap between the bottom frames over itself, merging them
 *   (`rect18592`);
 * - three       — no patch at all;
 * - four        — copy the gap *up*, splitting the top frame in two (`rect18600`).
 *
 * CSBWin renders into `d.pViewportBMP`, its own 224x136 bitmap, and presents that either
 * in the viewport (screen (0,33)) or centred (screen (47,33)). This port has one screen
 * buffer, so the menu is drawn straight into it at the matching origin and every
 * coordinate out of `Menu.cpp` gets that origin added. The extracted button rectangles
 * are *already* in screen space, which is why the two sets differ by exactly 47.
 *
 * Nothing here can block, so `_WaitForMenuSelect`'s `do { HandleMouseEvents } while` is
 * turned inside out the way `ReIncarnate.ts` turns `_ReIncarnate` inside out: the state
 * lives on the caller, the draw runs from that state every frame, and `menuClick` is one
 * iteration of the loop body. The press animation, which CSBWin runs as two 5-VBL waits
 * with the rest of the game stopped, becomes two timestamped phases.
 */
import { tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import type { UIButton } from '../csbwin/UITables';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { searchButtonList } from './HitTest';
import type { UIState } from './UIState';

/** Item 0 of `graphics.dat` — `d.compressedGraphic0` (`Graphics.cpp:2005`). */
export const MENU_GRAPHIC = 0;
export const MENU_WIDTH = 224;
export const MENU_HEIGHT = 136;

/** `BLT2Screen` puts the centred menu at screen (47,33) (`Menu.cpp:450-458`). */
export const MENU_CENTRED_X = 47;

/** `CenteredText` and the title lines use a fixed six-pixel cell (`Menu.cpp:192`). */
export const MENU_CHAR_WIDTH = 6;

/** `CenteredText`: fg 9 on bg 5 (`Menu.cpp:200-208`). */
export const MENU_OPTION_COLOR = 9;
export const MENU_PANEL_COLOR = 5;
/** `title1` is fg 11, `title2` fg 9, both on bg 5 (`Menu.cpp:352-449`). */
export const MENU_TITLE1_COLOR = 11;
export const MENU_TITLE2_COLOR = 9;

/** Where the titles start, and the step between lines (`Menu.cpp:352`, `:373`). */
const TITLE_Y = 29;
const TITLE_Y_SPLIT = 21;
const TITLE_LINE_STEP = 8;
/** Titles centre on 113, one pixel right of where the option labels centre. */
const TITLE_CENTRE_X = 113;

/** `d.compressedGraphic0`'s title panel, measured: border (10,10)-(213,51), interior 12..212 x 12..50. */
export const MENU_PANEL_X1 = 10;
export const MENU_PANEL_X2 = 213;
export const MENU_PANEL_Y1 = 10;
export const MENU_PANEL_Y2 = 51;
export const MENU_PANEL_INNER_X1 = 12;
export const MENU_PANEL_INNER_X2 = 212;
export const MENU_PANEL_INNER_Y1 = 12;
export const MENU_PANEL_INNER_Y2 = 50;

/** The option label positions, per layout, in menu coordinates (`Menu.cpp:302-346`). */
const OPTION_POSITIONS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[112, 114]],
  [[112, 77], [112, 114]],
  [[112, 77], [59, 114], [166, 114]],
  [[59, 77], [166, 77], [59, 114], [166, 114]],
];

/**
 * The press animation, `Menu.cpp:100-180`. Two passes of five vertical blanks each,
 * which at 60 Hz is 1/12 s a pass.
 */
export const MENU_PRESS_PHASE_MS = (5 / 60) * 1000;

export interface MenuPress {
  /** The button id being flashed, 210..213 — or whatever id the caller's list uses. */
  buttonId: number;
  /** The rectangle it was found at, in screen coordinates. */
  rect: { x1: number; y1: number; x2: number; y2: number };
  /** `performance.now()` when the press started. */
  startedMs: number;
}

/** Menu coordinates -> screen coordinates. */
export function menuOriginX(centred: boolean): number {
  return centred ? MENU_CENTRED_X : VIEWPORT_X;
}

export function menuOriginY(): number {
  return VIEWPORT_Y;
}

/**
 * `SplitLongLine` (`Menu.cpp:211`). Under 30 characters the text is left alone;
 * otherwise it scans forward from the midpoint for the first space and breaks there.
 * When there is no space at or after the midpoint the whole string stays on line one
 * and line two comes back empty — CSBWin does not fall back to a hard break, and
 * neither does this.
 */
export function splitLongLine(text: string): [string, string] | null {
  const len = text.length;
  if (len < 30) return null;
  let at = len >> 1;
  while (at < len && text[at] !== ' ') at++;
  return [text.slice(0, at), text.slice(at + 1)];
}

/**
 * `CenteredText` (`Menu.cpp:192`): `x -= 3*strlen`, then fg 9 on bg 5.
 */
export function centeredText(
  ui: UIState,
  text: string,
  x: number,
  y: number,
  centred: boolean,
  color: number = MENU_OPTION_COLOR,
  background: number = MENU_PANEL_COLOR,
): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  const left = x - text.length * 3;
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    left + menuOriginX(centred),
    y + menuOriginY(),
    color,
    background,
    text,
  );
}

/**
 * Copy a region of the screen buffer onto itself, through a temporary so that an
 * overlapping move behaves. CSBWin allocates 8400 bytes for exactly this in the
 * one-option layout (`Menu.cpp:293-305`) and gets away without one elsewhere.
 */
export function copyMenuRegion(
  ui: UIState,
  srcX: number,
  srcY: number,
  width: number,
  height: number,
  dstX: number,
  dstY: number,
): void {
  const buf = ui.screenIndexBuffer;
  if (!buf) return;
  const stride = buf.width;
  const temp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = srcY + y;
    if (sy < 0 || sy >= buf.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = srcX + x;
      if (sx < 0 || sx >= stride) continue;
      temp[y * width + x] = buf.pixels[sy * stride + sx];
    }
  }
  for (let y = 0; y < height; y++) {
    const dy = dstY + y;
    if (dy < 0 || dy >= buf.height) continue;
    for (let x = 0; x < width; x++) {
      const dx = dstX + x;
      if (dx < 0 || dx >= stride) continue;
      buf.pixels[dy * stride + dx] = temp[y * width + x];
    }
  }
}

/**
 * Blit graphic 0 and stamp `"V2.0"` — the first two statements of `_DoMenu`
 * (`Menu.cpp:268-280`). Split out because the save screen wants the bitmap without
 * any of the four option layouts.
 */
export function drawMenuBitmap(ui: UIState, centred: boolean): void {
  if (!ui.screenIndexBuffer) return;
  const graphic = ui.getGraphicBitmap(MENU_GRAPHIC);
  if (!graphic) return;
  const ox = menuOriginX(centred);
  const oy = menuOriginY();
  tag0088b2Index(
    graphic,
    ui.screenIndexBuffer,
    {
      x1: ox,
      y1: oy,
      x2: ox + MENU_WIDTH - 1,
      y2: oy + MENU_HEIGHT - 1,
      srcX: 0,
      srcY: 0,
      srcStride: MENU_WIDTH,
      srcHeight: MENU_HEIGHT,
    },
    -1,
  );
  if (ui.fontData) {
    // `TextOut_OneLine(d.pViewportBMP, 112, 0xc0, 7, 2, 1, "V2.0", …)` (`Menu.cpp:272`).
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 0xc0 + ox, 7 + oy, 2, 1, 'V2.0');
  }
}

/**
 * Apply the layout patch for `count` options (`Menu.cpp:291-346`). The rectangles come
 * out of `graphics.dat` item 0x231; the source origins are the literals in `_DoMenu`.
 */
export function patchMenuLayout(ui: UIState, count: number, centred: boolean): void {
  if (!ui.uiTables) return;
  const g231 = ui.uiTables.graphic231;
  const ox = menuOriginX(centred);
  const oy = menuOriginY();
  const span = (r: { x1: number; x2: number; y1: number; y2: number }) => ({
    w: r.x2 - r.x1 + 1,
    h: r.y2 - r.y1 + 1,
  });

  if (count === 1) {
    // Dest `rect18576` = (0,0)-(223,74) filled from source (0,14), then blitted back at
    // `rect18584` = (0,51)-(223,125). Net: rows 51..125 <- rows 14..88.
    const dst = g231.rect18584;
    const size = span(g231.rect18576);
    copyMenuRegion(ui, ox + 0, oy + 14, size.w, size.h, ox + dst.x1, oy + dst.y1);
  } else if (count === 2) {
    const dst = g231.rect18592;
    const size = span(dst);
    copyMenuRegion(ui, ox + 102, oy + 52, size.w, size.h, ox + dst.x1, oy + dst.y1);
  } else if (count === 4) {
    const dst = g231.rect18600;
    const size = span(dst);
    copyMenuRegion(ui, ox + 102, oy + 99, size.w, size.h, ox + dst.x1, oy + dst.y1);
  }
  // count === 3 patches nothing (`Menu.cpp:322-327`).
}

/** The option labels for a layout (`Menu.cpp:302-346`). */
export function drawMenuOptions(ui: UIState, options: string[], centred: boolean): void {
  const positions = OPTION_POSITIONS[options.length - 1];
  if (!positions) return;
  for (let i = 0; i < options.length; i++) {
    const [x, y] = positions[i];
    centeredText(ui, options[i], x, y, centred);
  }
}

/**
 * The title block (`Menu.cpp:348-449`). Returns the y the next line would have used,
 * which is what `D5W` carries in the C++.
 */
export function drawMenuTitles(
  ui: UIState,
  title1: string | null,
  title2: string | null,
  centred: boolean,
): number {
  if (!ui.screenIndexBuffer || !ui.fontData) return TITLE_Y;
  const ox = menuOriginX(centred);
  const oy = menuOriginY();
  const line = (text: string, y: number, color: number): void => {
    const x = TITLE_CENTRE_X - 3 * text.length;
    drawTextLineIndex(
      ui.screenIndexBuffer!,
      ui.fontData!,
      x + ox,
      y + oy,
      color,
      MENU_PANEL_COLOR,
      text,
    );
  };

  let y = TITLE_Y;
  if (title1 !== null) {
    const split = splitLongLine(title1);
    if (split) {
      y = TITLE_Y_SPLIT;
      line(split[0], y, MENU_TITLE1_COLOR);
      y += TITLE_LINE_STEP;
      line(split[1], y, MENU_TITLE1_COLOR);
      y += TITLE_LINE_STEP;
    } else {
      line(title1, y, MENU_TITLE1_COLOR);
      y += TITLE_LINE_STEP;
    }
  }
  if (title2 !== null) {
    const split = splitLongLine(title2);
    if (split) {
      line(split[0], y, MENU_TITLE2_COLOR);
      y += TITLE_LINE_STEP;
      line(split[1], y, MENU_TITLE2_COLOR);
    } else {
      line(title2, y, MENU_TITLE2_COLOR);
    }
  }
  return y;
}

/**
 * `_DoMenu`'s drawing: bitmap, layout patch, option labels, titles. `ClearOldScreen` and
 * `FadeOldScreen` are the caller's, since only a pre-game screen owns the colour
 * registers: the boot's "GAME LOADED, READY TO PLAY." does both around this
 * (`doMenuCentred`, `src/renderer/intro/BootSequence.ts`), and the disk menu passes 0 for
 * all three (`SaveGame.cpp:870-877`).
 */
export function doMenu(
  ui: UIState,
  title1: string | null,
  title2: string | null,
  options: string[],
  centred: boolean,
): void {
  drawMenuBitmap(ui, centred);
  if (options.length >= 1 && options.length <= 4) {
    patchMenuLayout(ui, options.length, centred);
    drawMenuOptions(ui, options, centred);
  }
  drawMenuTitles(ui, title1, title2, centred);
}

/**
 * `d.pButn18970[set][count-1]` (`CSBCode.cpp:304-311`, picked at `Menu.cpp:64`). Set 0
 * is the in-viewport menu, set 1 the centred one; the ids are 210..213 and every entry
 * is left-click only.
 */
export function menuButtonList(ui: UIState, count: number, centred: boolean): UIButton[] {
  if (!ui.uiTables) return [];
  const b = ui.uiTables.graphic231.buttons;
  const sets = centred
    ? [b.buttons18792, b.buttons18828, b.buttons18876, b.buttons18936]
    : [b.buttons18624, b.buttons18660, b.buttons18708, b.buttons18768];
  return sets[Math.max(1, Math.min(4, count)) - 1] ?? [];
}

/**
 * One iteration of `_WaitForMenuSelect`'s loop body: hit-test the menu's own button
 * list and nothing else. CSBWin gets that exclusivity by nulling `SecondaryButtonList`
 * and both `pKeyXlate`s and replacing `PrimaryButtonList`; here the caller simply does
 * not consult any other list while its menu is up.
 *
 * Returns the 1-based choice `d.Word11764` would hold (`Mouse.cpp:1792-1796`), or 0.
 */
export function menuHitTest(buttons: UIButton[], x: number, y: number, mouseButtons: number): number {
  const id = searchButtonList(buttons, x, y, mouseButtons);
  if (id >= 210 && id <= 213) return id - 209;
  return 0;
}

/** The rectangle of a menu button id, for the press animation. */
export function menuButtonRect(buttons: UIButton[], id: number): MenuPress['rect'] | null {
  for (const entry of buttons) {
    if (entry.word0 === id) return { x1: entry.x1, y1: entry.y1, x2: entry.x2, y2: entry.y2 };
  }
  return null;
}

/**
 * Draw the press animation over a button (`Menu.cpp:106-172`).
 *
 * CSBWin grows the rectangle by 3 on three sides and 4 at the bottom, then draws two
 * passes of single-pixel edges five vertical blanks apart. It paints them straight into
 * the screen and restores the saved pixels afterwards; this port redraws the whole
 * screen every frame, so it just paints the current phase's edges and stops painting
 * when the animation is over.
 */
export function drawMenuPress(ui: UIState, press: MenuPress, nowMs: number): void {
  const buf = ui.screenIndexBuffer;
  if (!buf) return;
  const elapsed = nowMs - press.startedMs;
  if (elapsed < 0 || elapsed >= MENU_PRESS_PHASE_MS * 2) return;

  const x1 = press.rect.x1 - 3;
  const x2 = press.rect.x2 + 3;
  const y1 = press.rect.y1 - 3;
  const y2 = press.rect.y2 + 4;

  const fill = (rx1: number, ry1: number, rx2: number, ry2: number, color: number): void => {
    const c = color & 0x0f;
    const lx1 = Math.max(0, Math.min(rx1, rx2));
    const lx2 = Math.min(buf.width - 1, Math.max(rx1, rx2));
    const ly1 = Math.max(0, Math.min(ry1, ry2));
    const ly2 = Math.min(buf.height - 1, Math.max(ry1, ry2));
    for (let y = ly1; y <= ly2; y++) {
      const row = y * buf.width;
      for (let x = lx1; x <= lx2; x++) buf.pixels[row + x] = c;
    }
  };

  if (elapsed < MENU_PRESS_PHASE_MS) {
    // Pass A (`Menu.cpp:121-136`): top and left in 5, bottom and right in 0.
    fill(x1, y1, x2, y1, 5);
    fill(x1, y1, x1, y2 - 1, 5);
    fill(x1 - 2, y2 - 1, x2, y2 - 1, 0);
    fill(x2, y1, x2, y2, 0);
  } else {
    // Pass B (`Menu.cpp:138-166`): the inner edges, plus an outer highlight in 13.
    fill(x1, y1 + 1, x2 - 2, y1 + 1, 5);
    fill(x1 + 1, y1, x1 + 1, y2 - 1, 5);
    fill(x2 - 1, y1, x2 - 1, y2, 0);
    fill(x1 + 1, y2 - 2, x2, y2 - 2, 0);
    fill(x1 - 1, y2 + 2, x2 + 2, y2 + 2, 13);
    fill(x2 + 3, y1, x2 + 3, y2 + 2, 13);
  }
}

/** Whether the animation has run its two passes out. */
export function menuPressFinished(press: MenuPress, nowMs: number): boolean {
  return nowMs - press.startedMs >= MENU_PRESS_PHASE_MS * 2;
}
