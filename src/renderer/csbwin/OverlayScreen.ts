/**
 * The viewport as CSBWin's `display` draws it: through `OVERLAYDATA::CreateOverlayTable`
 * (`doc/CSBwin-src/Graphics.cpp:2978-3090`) and `UpdateScreenArea`
 * (`doc/CSBwin-src/WinScreen.cpp:1008-1344`), which `display` calls for the viewport with
 * `useOverlay` in `VM_ADVENTURE` only (`:1515-1527`). The table, indexed by an overlay
 * byte and an Atari colour, gives a 16-bit RGB555 pixel: the colour through the overlay
 * palette (`src/engine/OverlayPalette.ts`), blended with the overlay's (`src/engine/Overlay.ts`).
 *
 * CSBWin hands Windows RGB555 pixels, which the port widens to eight bits a channel as
 * `(v << 3) | (v >> 2)`. The rest of the screen is the straight path's
 * (`updateImageDataFromIndex`), each intensity times 36 (`DEBT.md` H).
 */
import type { Overlay } from '../../engine/Overlay';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH } from '../../engine/Overlay';
import { identityOverlayPalette } from '../../engine/OverlayPalette';

/** `m_table`: 8192 bytes, 256 overlay bytes by 16 Atari colours (`Graphics.cpp:2951-2952`). */
export const OVERLAY_TABLE_SIZE = 256 * 16;

/** The viewport's area of the screen, `display`'s `0, 0x21, 0xe0, 0xa9-0x21` (`WinScreen.cpp:1517-1520`). */
const X0 = 0;
const Y0 = 0x21;
const WIDTH = 0xe0;
const HEIGHT = 0xa9 - 0x21;

const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;

/** A 5-bit channel widened to eight bits, as Windows shows an RGB555 pixel. */
export function widen5(v: number): number {
  return (v << 3) | (v >> 2);
}

/**
 * `OVERLAYDATA::CreateOverlayTable(atariPalette, useOverlay)`, RGB555. With an overlay up,
 * entry `(I << 4) + i` is Atari colour `i` through the overlay palette, `m_p2` percent of
 * it, plus overlay colour `I`, the rest; colour `m_p4` is the palette's alone when bit 0
 * of `m_p1` is set. Without one, only the first 16 entries, the colours through the
 * overlay palette. Without `useOverlay`, the straight Atari palette.
 *
 * CSBWin's sums are `ui32`, so a `m_p2` outside 0 to 100 wraps them as it does here.
 */
export function CreateOverlayTable(
  table: Uint16Array,
  atariPalette: readonly number[],
  useOverlay: boolean,
  overlay: Overlay,
  overlayPalette: Uint8Array,
): void {
  const current = overlay.current;
  const transparency = useOverlay ? current.p2 : 100;
  const opaqueness = (100 - transparency) | 0;
  const entry = (colour: number): number =>
    ((colour & 0x700) >> 2) | ((colour & 0x070) >> 1) | (colour & 0x007); // One of 512 entries
  const red = (n: number): number => overlayPalette[n]!;
  const green = (n: number): number => overlayPalette[512 + n]!;
  const blue = (n: number): number => overlayPalette[1024 + n]!;
  const div800 = (v: number): number => Math.floor((v >>> 0) / 800);
  if (useOverlay) {
    if (overlay.active) {
      const r = new Array<number>(16), g = new Array<number>(16), b = new Array<number>(16);
      const r100 = new Array<number>(16), g100 = new Array<number>(16), b100 = new Array<number>(16);
      for (let i = 0; i < 16; i++) {
        const n = entry(atariPalette[i] ?? 0);
        r[i] = Math.imul(red(n), transparency) >>> 0;
        g[i] = Math.imul(green(n), transparency) >>> 0;
        b[i] = Math.imul(blue(n), transparency) >>> 0;
        r100[i] = red(n) * 100;
        g100[i] = green(n) * 100;
        b100[i] = blue(n) * 100;
      }
      const colours = current.overlayPalette!;
      let p = 0;
      for (let I = 0; I < 256; I++) {
        if ((current.p1 & 0x0001) !== 0 && I === current.p4) {
          // This is a transparent color.
          for (let i = 0; i < 16; i++, p++) {
            table[p] = (div800(r100[i]!) << 10) | (div800(g100[i]!) << 5) | div800(b100[i]!);
          }
        } else {
          const RED = Math.imul((colours[I]! >> 16) & 0xff, opaqueness);
          const GREEN = Math.imul((colours[I]! >> 8) & 0xff, opaqueness);
          const BLUE = Math.imul(colours[I]! & 0xff, opaqueness);
          for (let i = 0; i < 16; i++, p++) {
            table[p] = (div800(r[i]! + RED) << 10) | (div800(g[i]! + GREEN) << 5) | div800(b[i]! + BLUE);
          }
        }
      }
    } else {
      // The overlay byte will always be zero, so only 16 entries.
      for (let i = 0; i < 16; i++) {
        const n = entry(atariPalette[i] ?? 0);
        table[i] = ((red(n) & 0xf8) << 7) | ((green(n) & 0xf8) << 2) | ((blue(n) & 0xf8) >> 3);
      }
    }
  } else {
    // use straight atari palette
    for (let i = 0; i < 16; i++) {
      const colour = atariPalette[i] ?? 0;
      let pixel = (((colour >> 8) & 0x7) << 12) | (((colour >> 4) & 0x7) << 7) | ((colour & 0x7) << 2);
      pixel |= (pixel & 0x6318) >> 3;
      table[i] = pixel;
    }
  }
}

/**
 * `UpdateScreenArea` for the viewport, from `CreateOverlayTable` on: the screen's
 * 224x136 at (0, 33), each pixel `table[(overlay << 4) + colour]`, written into `out`
 * (the canvas's RGBA) widened. The overlay's line `line` is its bitmap's `135 - line`.
 *
 * With `useOverlay`, the graphic moves by `xGraphicJitter` and `yGraphicJitter`, colour 0
 * where it has left, and the overlay stays; a line moved in from below the viewport is
 * the screen's own, down to line 136 of it, and colour 0 after. `xOverlayJitter` moves
 * nothing but one of CSBWin's three cases: with it 0 and either graphic jitter, the
 * picture is CSBWin's, and with it anything else CSBWin stops in `NotImplemented`, which
 * `notImplemented` stands for. `yOverlayJitter` is read nowhere. A screen line past the
 * screen, which CSBWin would read on into memory, is colour 0, and a pixel past the
 * viewport, which it would write on into its bitmap, is not written.
 */
export function UpdateViewportArea(
  out: Uint8ClampedArray,
  screen: Uint8Array,
  table: Uint16Array,
  overlay: Overlay,
  useOverlay: boolean,
  notImplemented: (n: number) => never,
): void {
  const firstNibble = [0, 0, 0, 0, 0, 0, 0];
  const firstOverlay = [0, 0, 0, 0, 0, 0, 0];
  const segWidth = [0, 0, 0, 0, 0, 0, 0];
  const width = WIDTH;
  const height = HEIGHT;
  const xgj = useOverlay ? overlay.xGraphicJitter : 0;
  const xoj = useOverlay ? overlay.xOverlayJitter : 0;
  const ygj = useOverlay ? overlay.yGraphicJitter : 0;
  let currentGraphicLine = -ygj;
  const lastGraphicLine = ygj >= 0 ? height - ygj - 1 : height;

  if (xgj < 0) {
    if (xoj < 0) notImplemented(0x777107);
    else if (xoj === 0) {
      firstNibble[3] = -xgj;
      firstOverlay[3] = 0;
      segWidth[3] = width + xgj;
      segWidth[6] = -xgj;
      firstNibble[6] = -1;
      firstOverlay[6] = width + xgj;
    } else notImplemented(0x777109);
  } else if (xgj === 0) {
    if (xoj < 0) notImplemented(0x777101);
    else if (xoj === 0) {
      segWidth[2] = xgj;
      firstNibble[2] = -1;
      firstOverlay[2] = 0;
      firstNibble[3] = 0;
      firstOverlay[3] = firstOverlay[2] + xgj;
      segWidth[3] = width - xgj;
    } else notImplemented(0x777104);
  } else {
    if (xoj === 0) {
      segWidth[2] = xgj;
      firstOverlay[2] = 0;
      firstNibble[2] = -1;
      firstNibble[3] = 0;
      firstOverlay[3] = xgj;
      segWidth[3] = width - xgj;
    } else if (xoj < 0) notImplemented(0x777111);
    else notImplemented(0x777112);
  }

  const bitmap = overlay.current.overlay;
  const drawOverlay = useOverlay && overlay.active && bitmap !== null;
  for (let line = 0; line < height; line++, currentGraphicLine++) {
    const black = currentGraphicLine < 0 || currentGraphicLine > lastGraphicLine;
    const screenY = Y0 + currentGraphicLine;
    const pixels = black || screenY >= SCREEN_HEIGHT ? -1 : SCREEN_WIDTH * screenY + X0;
    const outRow = SCREEN_WIDTH * (Y0 + line) + X0;
    let currentPixel = 0;
    for (let segment = 0; segment < 7; segment++) {
      const num = segWidth[segment]!;
      if (num === 0) continue;
      const nibbles = firstNibble[segment]! < 0 || pixels < 0 ? -1 : pixels + firstNibble[segment]!;
      const overlayAt = OVERLAY_WIDTH * (OVERLAY_HEIGHT - 1 - line) + firstOverlay[segment]!;
      for (let k = 0; k < num; k++) {
        const x = currentPixel + k;
        if (x < 0 || x >= width) continue;
        const nibble = nibbles < 0 ? 0 : (screen[nibbles + k] ?? 0) & 0x0f;
        const overlayByte = drawOverlay ? (bitmap[overlayAt + k] ?? 0) : 0;
        const pixel = table[(overlayByte << 4) + nibble]!;
        const o = 4 * (outRow + x);
        out[o] = widen5((pixel >> 10) & 0x1f);
        out[o + 1] = widen5((pixel >> 5) & 0x1f);
        out[o + 2] = widen5(pixel & 0x1f);
        out[o + 3] = 255;
      }
      currentPixel += num;
    }
  }
}

const IDENTITY = identityOverlayPalette();

/**
 * Whether the viewport in `VM_ADVENTURE` is the straight path's picture: no overlay up,
 * no graphic jitter, and the overlay palette the identity, so that `CreateOverlayTable`'s
 * 16 entries are the straight colours. A jitter of the overlay alone is one of
 * `NotImplemented`'s cases, so it is not.
 */
export function overlayDrawsNothing(overlay: Overlay, overlayPalette: Uint8Array): boolean {
  if (overlay.active) return false;
  if (overlay.xGraphicJitter !== 0 || overlay.yGraphicJitter !== 0 || overlay.xOverlayJitter !== 0) return false;
  for (let i = 0; i < IDENTITY.length; i++) if (overlayPalette[i] !== IDENTITY[i]) return false;
  return true;
}
