import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { PaletteIndexViewportBuffer } from './CanvasBlitter';

const FONT_GRAPHIC_INDEX = 0x22d;
const FONT_ROW_COUNT = 6;
const FONT_ROW_STRIDE = 128;
const FONT_CHAR_ADVANCE = 6;

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
        for (let col = 0; col < FONT_CHAR_ADVANCE; col++) {
          const px = cursorX + col;
          if (px < 0 || px >= width) continue;
          dst.pixels[rowOff + px] = bg;
        }
      }
    }

    for (let row = 0; row < FONT_ROW_COUNT; row++) {
      const rowByte = bytes[code + row * FONT_ROW_STRIDE];
      const py = startY + row;
      if (py < 0 || py >= height) continue;
      const rowOff = py * width;
      for (let col = 0; col < FONT_CHAR_ADVANCE; col++) {
        const bitIndex = FONT_CHAR_ADVANCE - 1 - col;
        if (((rowByte >> bitIndex) & 0x1) === 0) continue;
        const px = cursorX + col;
        if (px < 0 || px >= width) continue;
        dst.pixels[rowOff + px] = fg;
      }
    }

    cursorX += FONT_CHAR_ADVANCE;
  }
}
