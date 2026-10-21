import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { PaletteIndexViewportBuffer } from './CanvasBlitter';

const FONT_GRAPHIC_INDEX = 0x22d;
const FONT_ROW_COUNT = 6;
const FONT_ROW_STRIDE = 128;
const FONT_CHAR_ADVANCE = 6;
/**
 * A glyph is five pixels wide, font bits 4..0, and starts at the pen: `BltOneChar` shifts
 * the byte by `11-D3W` so bit 4 lands on pixel `x` (`doc/CSBwin-src/Graphics.cpp:219`),
 * and `TextOut_OneLine`'s mask `0x07ff07ff >> D3W` (`Graphics.cpp:342`) clears those five
 * pixels only, leaving the sixth, the gap to the next character, as it was.
 */
const FONT_GLYPH_WIDTH = 5;

export interface FontData {
  bytes: Uint8Array;
}

export function loadFontData(graphicsLoader: GraphicsLoader): FontData {
  const raw = graphicsLoader.getRawGraphic(FONT_GRAPHIC_INDEX);
  if (raw.length < FONT_ROW_COUNT * FONT_ROW_STRIDE) {
    throw new Error(`Font graphic 0x22d size unexpected: ${raw.length}`);
  }
  return { bytes: raw };
}

/**
 * A character of a text in capitals the font has no glyph for: it draws a space, `!` to
 * `?`, A to Z and `[ \ ] ^ _`, ASCII from 0x20 to 0x5f without `@`.
 */
const NOT_IN_FONT = /[^\x20-\x3f\x41-\x5f]/u;

/** Whether the font draws every character of `s`, a text in capitals. */
export function fontDraws(s: string): boolean {
  return !NOT_IN_FONT.test(s);
}

/**
 * A text from outside the game, a player's or the browser's, as the font can draw it. The
 * font holds ASCII alone, and a character is drawn by its code's low seven bits, so
 * `É` (0xC9) would draw as `I`. Its accents are dropped, a compatibility form taken
 * (`ﬁ` as `FI`, `…` as `...`), and every character with no glyph becomes `?`. The text
 * comes out in capitals, as `drawTextLineIndex` draws it.
 */
export function foldToFont(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(new RegExp(NOT_IN_FONT, 'gu'), '?');
}

export function drawTextLineIndex(
  dst: PaletteIndexViewportBuffer,
  font: FontData,
  x: number,
  y: number,
  color: number,
  backgroundColor: number | null,
  text: string
): void {
  const normalizedText = text.toUpperCase();
  drawTextLineIndexInternal(dst, font, x, y, color, backgroundColor, normalizedText);
}

/**
 * `TextOutToScreen_Centered` (`doc/CSBwin-src/CSBCode.cpp:1785-1794`): the text centred on
 * `x` as five pixels a character, `x - (5 * length) / 2`, whatever the font's advance of
 * six. So a text of `n` characters sits about `n / 2` pixels right of its centre.
 */
export function textOutToScreenCentered(
  dst: PaletteIndexViewportBuffer,
  font: FontData,
  x: number,
  y: number,
  color: number,
  backgroundColor: number | null,
  text: string
): void {
  const left = x - Math.trunc((5 * text.length) / 2);
  drawTextLineIndex(dst, font, left, y, color, backgroundColor, text);
}

export function drawTextLineIndexRaw(
  dst: PaletteIndexViewportBuffer,
  font: FontData,
  x: number,
  y: number,
  color: number,
  backgroundColor: number | null,
  text: string
): void {
  drawTextLineIndexInternal(dst, font, x, y, color, backgroundColor, text);
}

function drawTextLineIndexInternal(
  dst: PaletteIndexViewportBuffer,
  font: FontData,
  x: number,
  y: number,
  color: number,
  backgroundColor: number | null,
  text: string
): void {
  const startY = y - 4;
  const width = dst.width;
  const height = dst.height;
  const fg = color & 0x0f;
  const bg = backgroundColor === null ? -1 : backgroundColor & 0x0f;

  let cursorX = x | 0;
  const bytes = font.bytes;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) & 0x7f;
    if (bg >= 0) {
      for (let row = 0; row < FONT_ROW_COUNT; row++) {
        const py = startY + row;
        if (py < 0 || py >= height) continue;
        const rowOff = py * width;
        for (let col = 0; col < FONT_GLYPH_WIDTH; col++) {
          const px = cursorX + col;
          if (px < 0 || px >= width) continue;
          dst.pixels[rowOff + px] = bg;
        }
      }
    }

    for (let row = 0; row < FONT_ROW_COUNT; row++) {
      const rowByte = bytes[code + row * FONT_ROW_STRIDE]!;
      const py = startY + row;
      if (py < 0 || py >= height) continue;
      const rowOff = py * width;
      for (let col = 0; col < FONT_GLYPH_WIDTH; col++) {
        const bitIndex = FONT_GLYPH_WIDTH - 1 - col;
        if (((rowByte >> bitIndex) & 0x1) === 0) continue;
        const px = cursorX + col;
        if (px < 0 || px >= width) continue;
        dst.pixels[rowOff + px] = fg;
      }
    }

    cursorX += FONT_CHAR_ADVANCE;
  }
}
