/**
 * Low-level drawing primitives for the DM screen buffer.
 *
 * Everything here writes palette indices into `ui.screenIndexBuffer`; the conversion to
 * RGBA happens once at present time, as in CSBWin.
 */
import { Rect } from '../../data/tables/UITables';
import { IndexedBitmap, createPaletteIndexViewportBuffer, fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import type { ScrollingText } from '../csbwin/ScrollingText';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import type { Champion } from '../../engine/gameTypes';
import type { UIState } from './UIState';

export function drawHorzBar(ui: UIState, x0: number, y0: number, width: number, color: number): void {
  const x1 = VIEWPORT_X + x0;
  const y1 = VIEWPORT_Y + y0;
  const rect = { x1, y1, x2: x1 + width, y2: y1 + 6 };
  fillRectIndex(ui.screenIndexBuffer, rect, color);
}

export function blitBasicGraphicToViewport(ui: UIState, index: number, rect: Rect, srcStride: number, transparentColor: number): void {
  const graphic = ui.getGraphicBitmap(index);
  if (!graphic) return;
  const dst = offsetViewportRect(rect);
  tag0088b2Index(
    graphic,
    ui.screenIndexBuffer,
    {
      x1: dst.x1,
      y1: dst.y1,
      x2: dst.x2,
      y2: dst.y2,
      srcX: 0,
      srcY: 0,
      srcStride,
      srcHeight: graphic.height,
    },
    transparentColor
  );
}

/**
 * `DisplaySleepScreen` (`doc/CSBwin-src/CSBCode.cpp:8542`): the viewport flooded with
 * colour 0 and `TextOut_OneLine(d.pViewportBMP, 112, 93, 65, 4, 0, "WAKE UP", …)` —
 * viewport coordinates, colour 4 on 0. It stands in for `DrawViewport`, which the main
 * loop skips while the party sleeps (`:637`).
 */
export function displaySleepScreen(ui: UIState): void {
  const viewport = ui.context.viewportIndexBuffer;
  if (!viewport) return;
  viewport.pixels.fill(0);
  if (ui.fontData) drawTextLineIndex(viewport, ui.fontData, 93, 65, 4, 0, 'WAKE UP');
}

/**
 * The freeze's screen, button 147 (`doc/CSBwin-src/Mouse.cpp:1737-1746`): the viewport
 * flooded with colour 0 and `TextOut_OneLine(d.pViewportBMP, 112, 81, 69, 4, 0,
 * "GAME FROZEN", …)`. No tick runs while the game is frozen, so nothing draws the
 * viewport again until the thaw.
 */
export function displayFrozenScreen(ui: UIState): void {
  const viewport = ui.context.viewportIndexBuffer;
  if (!viewport) return;
  viewport.pixels.fill(0);
  if (ui.fontData) drawTextLineIndex(viewport, ui.fontData, 81, 69, 4, 0, 'GAME FROZEN');
}

export function offsetViewportRect(rect: Rect): Rect {
  return {
    x1: rect.x1 + VIEWPORT_X,
    x2: rect.x2 + VIEWPORT_X,
    y1: rect.y1 + VIEWPORT_Y,
    y2: rect.y2 + VIEWPORT_Y,
  };
}

export function shadeRectIndex(ui: UIState, rect: Rect, color: number): void {
  const width = ui.screenIndexBuffer.width;
  const height = ui.screenIndexBuffer.height;
  const x1 = Math.max(0, rect.x1 | 0);
  const y1 = Math.max(0, rect.y1 | 0);
  const x2 = Math.min(width - 1, rect.x2 | 0);
  const y2 = Math.min(height - 1, rect.y2 | 0);
  const fill = color & 0x0f;

  for (let y = y1; y <= y2; y++) {
    const row = y * width;
    for (let x = x1; x <= x2; x++) {
      if ((x + y) & 1)
        ui.screenIndexBuffer.pixels[row + x] = fill;
    }
  }
}

/**
 * Where icon `objectNameIndex` is drawn from, found as `DrawItem`
 * (`doc/CSBwin-src/Character.cpp:31`) and `GetIconGraphic` (`Code11f52.cpp:82`) find it:
 * the last group of `d.Word612` that starts at or below it picks graphic `42 + group`, and
 * the offset into the group picks a 16x16 cell, sixteen to a row.
 */
function objectIconSource(
  ui: UIState,
  objectNameIndex: number,
  word612: number[],
): { graphic: IndexedBitmap; srcX: number; srcY: number } | null {
  if (objectNameIndex < 0 || word612.length === 0) return null;
  let group = 0;
  while (group < word612.length && objectNameIndex >= word612[group]) {
    group++;
  }
  group -= 1;
  if (group < 0) return null;
  const graphic = ui.getGraphicBitmap(42 + group);
  if (!graphic) return null;
  const offset = objectNameIndex - word612[group];
  return { graphic, srcX: (offset & 15) << 4, srcY: offset & 0xff0 };
}

export function drawObjectIcon(ui: UIState, rect: { x1: number; y1: number; x2: number; y2: number }, objectNameIndex: number, word612: number[]): void {
  const source = objectIconSource(ui, objectNameIndex, word612);
  if (!source) return;
  const { graphic, srcX, srcY } = source;

  tag0088b2Index(
    graphic,
    ui.screenIndexBuffer,
    {
      x1: rect.x1,
      y1: rect.y1,
      x2: rect.x2,
      y2: rect.y2,
      srcX,
      srcY,
      srcStride: graphic.width,
      srcWidth: graphic.width,
      srcHeight: graphic.height,
    },
    -1
  );
}

/** Icon `objectNameIndex` as a 16x16 bitmap of its own, as `CreateObjectCursor` is handed it. */
export function objectIconBitmap(ui: UIState, objectNameIndex: number, word612: number[]): IndexedBitmap | null {
  const source = objectIconSource(ui, objectNameIndex, word612);
  if (!source) return null;
  const icon = createPaletteIndexViewportBuffer(16, 16, 12);
  tag0088b2Index(source.graphic, icon, { x1: 0, x2: 15, y1: 0, y2: 15, srcX: source.srcX, srcY: source.srcY }, -1);
  return icon;
}

export function drawObjectIconMask(ui: UIState, 
  rect: { x1: number; y1: number; x2: number; y2: number },
  objectNameIndex: number,
  word612: number[],
  colorMap: number[]
): void {
  if (colorMap.length === 0) return;
  const source = objectIconSource(ui, objectNameIndex, word612);
  if (!source) return;
  const { graphic, srcX, srcY } = source;

  const dst = ui.screenIndexBuffer;
  const dstStride = dst.width;
  const srcStride = graphic.width;
  const maxW = Math.min(16, rect.x2 - rect.x1 + 1);
  const maxH = Math.min(16, rect.y2 - rect.y1 + 1);

  for (let y = 0; y < maxH; y++) {
    const sy = srcY + y;
    if (sy < 0 || sy >= graphic.height) continue;
    const dstRow = (rect.y1 + y) * dstStride;
    for (let x = 0; x < maxW; x++) {
      const sx = srcX + x;
      if (sx < 0 || sx >= srcStride) continue;
      const pixel = graphic.pixels[sy * srcStride + sx] & 0x0f;
      const mapped = colorMap[pixel] ?? 0;
      if (mapped !== 0) continue; // leave cyan background for mapped pixels (ex: color 12 -> 40)
      dst.pixels[dstRow + rect.x1 + x] = 0; // black mask for non-mapped pixels
    }
  }
}

export function drawObjectIconAt(ui: UIState, 
  x: number,
  y: number,
  objectNameIndex: number,
  word612: number[],
  transparentColor: number,
  overrideColor?: number
): void {
  const source = objectIconSource(ui, objectNameIndex, word612);
  if (!source) return;
  const { graphic, srcX, srcY } = source;

  const dst = ui.screenIndexBuffer;
  const dstStride = dst.width;
  const srcStride = graphic.width;
  const maxW = Math.min(16, dst.width - x, srcStride - srcX);
  const maxH = Math.min(16, dst.height - y, graphic.height - srcY);
  if (maxW <= 0 || maxH <= 0) return;

  const tc = transparentColor & 0x0f;
  for (let row = 0; row < maxH; row++) {
    const sy = srcY + row;
    const dy = y + row;
    if (dy < 0) continue;
    const dstRow = dy * dstStride;
    const srcRow = sy * srcStride;
    for (let col = 0; col < maxW; col++) {
      const dx = x + col;
      if (dx < 0) continue;
      const pixel = graphic.pixels[srcRow + (srcX + col)] & 0x0f;
      if (pixel === tc) continue;
      dst.pixels[dstRow + dx] = overrideColor !== undefined ? (overrideColor & 0x0f) : pixel;
    }
  }
}

/**
 * Draw the CSBWin scrolling message area. All row/timeout/wrap logic lives in
 * `ScrollingText`; the renderer only paints its current rows.
 */
export function drawMessageLines(ui: UIState, messages: ScrollingText): void {
  messages.draw(ui.screenIndexBuffer, ui.fontData);
}

export function drawFoodWaterBar(ui: UIState, value: number, y: number, color: number): void {
  let barColor = color;
  if (value < 0) barColor = 11;
  if (value < -512) barColor = 8;
  let width = value + 1024;
  if (width >= 3072) width = 3071;
  width = Math.floor(width / 32);
  drawHorzBar(ui, 115, y + 2, width, 0);
  drawHorzBar(ui, 113, y, width, barColor);
}

export function drawMaskedBarRow(ui: UIState, xBase: number, y: number, mask: number, color: number): void {
  if (mask === 0) return;
  const width = ui.screenIndexBuffer.width;
  const height = ui.screenIndexBuffer.height;
  if (y < 0 || y >= height) return;

  const row = y * width;
  const bits = mask & 0xffff;
  for (let bit = 0; bit < 16; bit++) {
    if ((bits & (1 << (15 - bit))) === 0) continue;
    const x = xBase + bit;
    if (x < 0 || x >= width) continue;
    ui.screenIndexBuffer.pixels[row + x] = color & 0x0f;
  }
}

export function computeBarHeight(current: number, max: number, allowOverMax: boolean): number {
  if (current <= 0 || max <= 0) return 0;
  if (allowOverMax && current > max) return 25;
  return Math.min(25, Math.ceil((25 * current) / max));
}

/** The plain box, and the one that marks something wrong. */
export const BOX_GRAPHIC_PLAIN = 33;
export const BOX_GRAPHIC_MARKED = 34;

/**
 * `DrawCharacterPossession`'s `LOCAL_20` (`doc/CSBwin-src/Character.cpp:1150-1204`): the
 * box behind a body part, slots 0 to 5, marked while the part is wounded (`ouches`),
 * with an object in it or not. Every other slot has none, -1.
 */
export function possessionBoxGraphic(champion: Champion, slot: number): number {
  if (slot > 5) return -1;
  return (champion.wounds & (1 << slot)) !== 0 ? BOX_GRAPHIC_MARKED : BOX_GRAPHIC_PLAIN;
}

/**
 * `DrawCharacterPossession`'s box (`doc/CSBwin-src/Character.cpp:1205-1216`): `graphic`
 * (`possessionBoxGraphic`) over the slot's 18x18 frame, `x-1..x+16`, with colour 12
 * transparent, before the icon.
 */
export function drawPossessionBox(ui: UIState, rect: Rect, graphic: number): void {
  const bitmap = ui.getGraphicBitmap(graphic);
  if (!bitmap) return;
  tag0088b2Index(
    bitmap,
    ui.screenIndexBuffer,
    {
      x1: rect.x1 - 1,
      y1: rect.y1 - 1,
      x2: rect.x2 + 1,
      y2: rect.y2 + 1,
      srcX: 0,
      srcY: 0,
      srcStride: bitmap.width,
      srcWidth: bitmap.width,
      srcHeight: bitmap.height,
    },
    12
  );
}

/** The unchanging screen chrome around the viewport (CSBWin `doc/CSBwin-src/CSBUI.cpp`). */
export function drawStaticUIFrame(ui: UIState): void {

  const g232 = ui.uiTables.graphic232;
  fillRectIndex(ui.screenIndexBuffer, g232.wRectPos1780, 0);
  fillRectIndex(ui.screenIndexBuffer, g232.wRectPos1788, 0);
  fillRectIndex(ui.screenIndexBuffer, g232.wRectPos1796, 0);

  const movementGraphic = ui.getGraphicBitmap(13);
  if (!movementGraphic) return;
  const rect = g232.word28;
  tag0088b2Index(
    movementGraphic,
    ui.screenIndexBuffer,
    {
      x1: rect.x1,
      y1: rect.y1,
      x2: rect.x2,
      y2: rect.y2,
      srcX: 0,
      srcY: 0,
      srcStride: movementGraphic.width,
      srcWidth: movementGraphic.width,
      srcHeight: movementGraphic.height,
    },
    -1
  );
}
