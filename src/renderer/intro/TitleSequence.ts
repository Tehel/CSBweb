/**
 * `_DisplayChaosStrikesBack` — the title animation, `doc/CSBwin-src/CSBCode.cpp:9203`.
 *
 * CSBWin's name is Chaos Strikes Back's, because that is the game it was disassembled
 * from; the routine is the shared engine's and it is driven entirely by `graphics.dat`
 * item 1, so with Dungeon Master's data it plays Dungeon Master's title. Item 1 is one
 * 320x200 image in three horizontal bands, and the rectangles that cut them out are read
 * out of item 0x232, not hardcoded here:
 *
 * | rows | band | rectangle |
 * | --- | --- | --- |
 * | 0..79 | the big "Dungeon" logo | shrink source for the zoom |
 * | 80..136 | the "Master" script | `Word44` stashes it, `Word36` places it |
 * | 137..152 | the word "Presents" | `Word52` |
 *
 * So: "Presents" fades up on a near-black screen and fades out again, then the logo zooms
 * from 48x12 to 320x80 over eighteen double-buffered frames, then "Master" is laid under
 * it and the palette turns it red. About 116 vertical blanks, near enough two seconds.
 *
 * `_AskWhatToDo` calls this at startup (`doc/CSBwin-src/CSBCode.cpp:11361`); the copy
 * inside `_GameSetup` (`:10604`) is commented out, so it plays once per program run and
 * not again between games. Full spec: `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`.
 */
import { tag0088b2Index, type IndexedBitmap } from '../csbwin/CanvasBlitter';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import {
  createIndexedBitmap,
  fadeToPalette,
  type IntroHost,
} from './IntroHost';

/** `for (D7W=0, width=48, height=12; D7W<18; D7W++, width+=16, height+=4)` (`:9277`). */
export const ZOOM_FRAMES = 18;
export const ZOOM_FIRST_WIDTH = 48;
export const ZOOM_FIRST_HEIGHT = 12;
export const ZOOM_WIDTH_STEP = 16;
export const ZOOM_HEIGHT_STEP = 4;
/** The logo band the zoom samples: `ShrinkBLT(A3, …, 320, 80, …)` (`:9287`). */
const LOGO_WIDTH = 320;
const LOGO_HEIGHT = 80;
/** `top = (160 - height)/2` (`:9305`) — centred in the top 160 scanlines, not in 200. */
export const ZOOM_CENTRE_HEIGHT = 160;
/** `SrcOffsetY` for the "Presents" band and for the "Master" band (`:9252`, `:9266`). */
const PRESENTS_SRC_Y = 137;
const MASTER_SRC_Y = 80;

/**
 * `ShrinkBLT` (`doc/CSBwin-src/Graphics.cpp:380`) for chunky pixels.
 *
 * The 68000 version walks the source with a 16.16 fixed-point accumulator and picks the
 * nearest source pixel — it is a nearest-neighbour minifier, with the colour map applied
 * per pixel (`d.IdentityColorMap` here, so a no-op). The step and the starting value are
 * transcribed exactly, including the truncation to sixteen bits before the shift, because
 * which source column each destination column lands on is visible on a 48-pixel frame:
 *
 * ```c
 *   D1L = srcWidth<<10;  D1L = (D1UL/D3UW) & 0xffff;  D1L <<= 6;  A2 = D1L;  // the step
 *   D1UL >>= 1;  D1L += 0x7fff;  LOCAL_8 = D1L;                              // the start
 * ```
 */
export function shrinkBlt(
  src: IndexedBitmap,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): IndexedBitmap {
  const dst = createIndexedBitmap(dstWidth, dstHeight);
  const stepX = (Math.trunc((srcWidth * 1024) / dstWidth) & 0xffff) * 64;
  const stepY = (Math.trunc((srcHeight * 1024) / dstHeight) & 0xffff) * 64;
  const startX = (stepX >>> 1) + 0x7fff;
  const startY = (stepY >>> 1) + 0x7fff;

  for (let dy = 0; dy < dstHeight; dy++) {
    const sy = Math.min(((startY + dy * stepY) / 0x10000) | 0, srcHeight - 1);
    const srcRow = sy * src.width;
    const dstRow = dy * dstWidth;
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = Math.min(((startX + dx * stepX) / 0x10000) | 0, srcWidth - 1);
      dst.pixels[dstRow + dx] = src.pixels[srcRow + sx];
    }
  }
  return dst;
}

/**
 * Play the title animation. Resolves when the last hold is over.
 *
 * The one thing not ported is the guard at `doc/CSBwin-src/CSBCode.cpp:9222` —
 * `if (d.iAvailableMemory < 138060) RETURN;` — which silently skips the whole sequence on
 * a machine that cannot spare 133 KB for the pre-shrunk frames. There is no such budget
 * here.
 */
export async function displayChaosStrikesBack(host: IntroHost): Promise<void> {
  const rects = host.uiTables.graphic232;
  const graphic1 = host.getGraphic(1);

  // `fillMemory(&LOCAL_340, 16, 2, 2)` (`:9244`) — all sixteen registers to 0x002.
  const palette = new Array<number>(16).fill(0x002);
  await fadeToPalette(host, palette);              // "darken screen" (`:9245`)
  host.screen.pixels.fill(0);                      // `ClearMemory(A2, 32000)` (`:9246`)

  // "Presents" into video memory (`:9248`), then raise colour 15 to show it (`:9257`).
  tag0088b2Index(graphic1, host.screen, { ...rects.word52, srcX: 0, srcY: PRESENTS_SRC_Y, srcStride: graphic1.width }, -1);
  palette[15] = 0x777;
  await fadeToPalette(host, palette);

  // Stash the "Master" band while item 1 is still whole (`:9261`). `Word44` is a
  // destination rectangle in a 320-wide scratch buffer, so the stash is 320x57.
  const masterBand = createIndexedBitmap(SCREEN_WIDTH, rects.word44.y2 - rects.word44.y1 + 1);
  tag0088b2Index(graphic1, masterBand, { ...rects.word44, srcX: 0, srcY: MASTER_SRC_Y, srcStride: graphic1.width }, -1);

  // The eighteen pre-shrunk logos and where each one lands (`:9276-9322`).
  const frames: IndexedBitmap[] = [];
  const frameRects: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (let i = 0, width = ZOOM_FIRST_WIDTH, height = ZOOM_FIRST_HEIGHT;
       i < ZOOM_FRAMES;
       i++, width += ZOOM_WIDTH_STEP, height += ZOOM_HEIGHT_STEP) {
    frames.push(shrinkBlt(graphic1, LOGO_WIDTH, LOGO_HEIGHT, width, height));
    const left = Math.trunc((SCREEN_WIDTH - width) / 2);
    const top = Math.trunc((ZOOM_CENTRE_HEIGHT - height) / 2);
    frameRects.push({ x1: left, x2: left + width - 1, y1: top, y2: top + height - 1 });
  }

  palette[15] = 2;                                 // "Presents" back to the background
  await fadeToPalette(host, palette);

  // Two video buffers, alternated (`:9327-9331`). Both are cleared here and never again,
  // which is safe only because each zoom frame strictly covers the one two steps back.
  const buffers = [
    createIndexedBitmap(SCREEN_WIDTH, SCREEN_HEIGHT),
    createIndexedBitmap(SCREEN_WIDTH, SCREEN_HEIGHT),
  ];
  host.screen.pixels.fill(0);
  host.present();

  // The logo's own colours (`:9333-9340`). 10 and 12 are "Master", held at the background
  // colour so it stays invisible until the very last fade.
  palette[3] = 0x541;
  palette[4] = 0x421;
  palette[5] = 0x651;
  palette[6] = 0x531;
  palette[8] = 0x772;
  palette[15] = 0x700;
  palette[10] = 0x002;
  palette[12] = 0x002;
  await fadeToPalette(host, palette);              // "Just delay." (`:9342`)

  for (let i = 0; i < ZOOM_FRAMES; i++) {
    await host.vbl(2);
    const buffer = buffers[i & 1];
    tag0088b2Index(frames[i], buffer, { ...frameRects[i], srcX: 0, srcY: 0, srcStride: frames[i].width }, -1);
    host.screen.pixels.set(buffer.pixels);         // `setscreen(…)` — swap video buffers
    host.present();
  }
  await host.vbl(10);

  // "Master", transparent on colour 0, onto whichever buffer is showing — frame 17 is odd,
  // so that is `screenBuffers[1]`, which is `d.LogicalScreenBase` (`:9359`).
  tag0088b2Index(masterBand, host.screen, { ...rects.word36, srcX: 0, srcY: 0, srcStride: masterBand.width }, 0);
  buffers[1].pixels.set(host.screen.pixels);
  palette[10] = 0;                                 // Black print
  palette[12] = 0x700;                             // Red background
  await fadeToPalette(host, palette);
  await host.vbl(20);
}
