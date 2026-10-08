/**
 * `_DisplayChaosStrikesBack` — the title animation, `doc/CSBwin-src/CSBCode.cpp:9308`.
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
 * `_AskWhatToDo` calls this at startup (`doc/CSBwin-src/CSBCode.cpp:11596`); the copy
 * inside `_GameSetup` (`:10728`) is commented out, so it plays once per program run and
 * not again between games. Full spec: `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`.
 */
import { shrinkBlt, tag0088b2Index, type IndexedBitmap } from '../csbwin/CanvasBlitter';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import {
  createIndexedBitmap,
  fadeToPalette,
  type IntroHost,
} from './IntroHost';

/** `for (D7W=0, width=48, height=12; D7W<18; D7W++, width+=16, height+=4)` (`:9383`). */
export const ZOOM_FRAMES = 18;
export const ZOOM_FIRST_WIDTH = 48;
export const ZOOM_FIRST_HEIGHT = 12;
export const ZOOM_WIDTH_STEP = 16;
export const ZOOM_HEIGHT_STEP = 4;
/** The logo band the zoom samples: `ShrinkBLT(A3, …, 320, 80, …)` (`:9393`). */
const LOGO_WIDTH = 320;
const LOGO_HEIGHT = 80;
/** `top = (160 - height)/2` (`:9411`) — centred in the top 160 scanlines, not in 200. */
export const ZOOM_CENTRE_HEIGHT = 160;
/** `SrcOffsetY` for the "Presents" band and for the "Master" band (`:9358`, `:9372`). */
const PRESENTS_SRC_Y = 137;
const MASTER_SRC_Y = 80;

/**
 * Play the title animation. Resolves when the last hold is over.
 *
 * The one thing not ported is the guard at `doc/CSBwin-src/CSBCode.cpp:9327` —
 * `if (d.iAvailableMemory < 138060) RETURN;` — which silently skips the whole sequence on
 * a machine that cannot spare 133 KB for the pre-shrunk frames. There is no such budget
 * here.
 */
export async function displayChaosStrikesBack(host: IntroHost): Promise<void> {
  const rects = host.uiTables.graphic232;
  const graphic1 = host.getGraphic(1);

  // `fillMemory(&LOCAL_340, 16, 2, 2)` (`:9350`) — all sixteen registers to 0x002.
  const palette = new Array<number>(16).fill(0x002);
  await fadeToPalette(host, palette);              // "darken screen" (`:9351`)
  host.screen.pixels.fill(0);                      // `ClearMemory(A2, 32000)` (`:9352`)

  // "Presents" into video memory (`:9354`), then raise colour 15 to show it (`:9363`).
  tag0088b2Index(graphic1, host.screen, { ...rects.word52, srcX: 0, srcY: PRESENTS_SRC_Y, srcStride: graphic1.width }, -1);
  palette[15] = 0x777;
  await fadeToPalette(host, palette);

  // Stash the "Master" band while item 1 is still whole (`:9367`). `Word44` is a
  // destination rectangle in a 320-wide scratch buffer, so the stash is 320x57.
  const masterBand = createIndexedBitmap(SCREEN_WIDTH, rects.word44.y2 - rects.word44.y1 + 1);
  tag0088b2Index(graphic1, masterBand, { ...rects.word44, srcX: 0, srcY: MASTER_SRC_Y, srcStride: graphic1.width }, -1);

  // The eighteen pre-shrunk logos and where each one lands (`:9382-9428`).
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

  // Two video buffers, alternated (`:9433-9437`). Both are cleared here and never again,
  // which is safe only because each zoom frame strictly covers the one two steps back.
  const buffers = [
    createIndexedBitmap(SCREEN_WIDTH, SCREEN_HEIGHT),
    createIndexedBitmap(SCREEN_WIDTH, SCREEN_HEIGHT),
  ];
  host.screen.pixels.fill(0);
  host.present();

  // The logo's own colours (`:9439-9446`). 10 and 12 are "Master", held at the background
  // colour so it stays invisible until the very last fade.
  palette[3] = 0x541;
  palette[4] = 0x421;
  palette[5] = 0x651;
  palette[6] = 0x531;
  palette[8] = 0x772;
  palette[15] = 0x700;
  palette[10] = 0x002;
  palette[12] = 0x002;
  await fadeToPalette(host, palette);              // "Just delay." (`:9448`)

  for (let i = 0; i < ZOOM_FRAMES; i++) {
    await host.vbl(2);
    const buffer = buffers[i & 1];
    tag0088b2Index(frames[i], buffer, { ...frameRects[i], srcX: 0, srcY: 0, srcStride: frames[i].width }, -1);
    host.screen.pixels.set(buffer.pixels);         // `setscreen(…)` — swap video buffers
    host.present();
  }
  await host.vbl(10);

  // "Master", transparent on colour 0, onto whichever buffer is showing — frame 17 is odd,
  // so that is `screenBuffers[1]`, which is `d.LogicalScreenBase` (`:9465`).
  tag0088b2Index(masterBand, host.screen, { ...rects.word36, srcX: 0, srcY: 0, srcStride: masterBand.width }, 0);
  buffers[1].pixels.set(host.screen.pixels);
  palette[10] = 0;                                 // Black print
  palette[12] = 0x700;                             // Red background
  await fadeToPalette(host, palette);
  await host.vbl(20);
}
