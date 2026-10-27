/**
 * The last screen presented, as CSBWin draws it rather than as the canvas shows it: the
 * palette-index buffer, and what each pixel went through to reach the canvas. The golden
 * frames are this (`tools/probe-frames.mjs`), so they test the drawing and the palettes
 * it is shown through, and not the conversion of an Atari colour to the canvas's
 * (`atariIntensity`, `CanvasBlitter.ts`; `DEBT.md` H).
 *
 * A pixel is shown one of three ways: a slot of the interface palette, a slot of the
 * viewport's (`d.Palette11946`, over the viewport only), or, with the viewport drawn
 * through an overlay, the RGB555 pixel `UpdateScreenArea` wrote there (`OverlayScreen.ts`),
 * CSBWin's own colour.
 */
import { forEachFootprintPixel, type IndexedBitmap } from './CanvasBlitter';

/** A frame as the golden frames store it. */
export interface PresentedFrameCapture {
  width: number;
  height: number;
  /**
   * A code per pixel: 0-15 a slot of `uiPalette`, 16-31 a slot of `viewportPalette`, and
   * 32 on the RGB555 colour `overlayColours[code - 32]`.
   */
  codes: number[];
  /** The interface palette, Atari `0RGB` words. */
  uiPalette: number[];
  /** The viewport's palette, or `null` where the whole screen went through the interface's. */
  viewportPalette: number[] | null;
  /** The overlay's colours, RGB555, in the order the screen first shows them. */
  overlayColours: number[];
}

/** A rectangle of the screen, both ends inclusive. */
interface Span {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Where an object in hand is shown through the interface palette. */
interface Footprint {
  x: number;
  y: number;
  bitmap: IndexedBitmap;
}

const OVERLAY_CODES = 256 - 32;

export class PresentedFrame {
  private readonly pixels: Uint8Array;
  private uiPalette: number[] = [];
  private viewportPalette: number[] | null = null;
  private viewportSpan: Span | null = null;
  private overlaySpan: Span | null = null;
  private footprint: Footprint | null = null;
  private footprintClear = 0;

  constructor(private readonly width: number, private readonly height: number) {
    this.pixels = new Uint8Array(width * height);
  }

  /**
   * Called as the screen is presented, with what the conversion did: `viewportPalette`
   * over `viewportSpan`, the overlay's pixels over `overlaySpan`, and the object in hand
   * through the interface palette where `footprint` is not colour `footprintClear`.
   */
  record(
    screen: Uint8Array,
    uiPalette: number[],
    viewport: { palette: number[]; span: Span } | null,
    overlaySpan: Span | null,
    footprint: Footprint | null,
    footprintClear: number,
  ): void {
    this.pixels.set(screen);
    this.uiPalette = uiPalette.slice();
    this.viewportPalette = viewport ? viewport.palette.slice() : null;
    this.viewportSpan = viewport ? { ...viewport.span } : null;
    this.overlaySpan = overlaySpan ? { ...overlaySpan } : null;
    this.footprint = footprint;
    this.footprintClear = footprintClear;
  }

  /**
   * The frame, its overlay pixels read back from `rgba`, the canvas's pixels as
   * presented: `UpdateScreenArea`'s RGB555 widened to eight bits a channel, which the top
   * five bits give back.
   */
  capture(rgba: Uint8ClampedArray): PresentedFrameCapture {
    const { width, height, pixels } = this;
    const codes = new Array<number>(width * height);
    const overlayColours: number[] = [];
    const overlayCode = new Map<number, number>();
    const inside = (s: Span | null, x: number, y: number): boolean =>
      s !== null && x >= s.x1 && x <= s.x2 && y >= s.y1 && y <= s.y2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const slot = pixels[i]! & 0x0f;
        if (inside(this.overlaySpan, x, y)) {
          const o = i * 4;
          const rgb555 = ((rgba[o]! >> 3) << 10) | ((rgba[o + 1]! >> 3) << 5) | (rgba[o + 2]! >> 3);
          let code = overlayCode.get(rgb555);
          if (code === undefined) {
            if (overlayColours.length === OVERLAY_CODES)
              throw new Error(`the overlay shows more than ${OVERLAY_CODES} colours`);
            code = 32 + overlayColours.length;
            overlayCode.set(rgb555, code);
            overlayColours.push(rgb555);
          }
          codes[i] = code;
        } else {
          codes[i] = inside(this.viewportSpan, x, y) ? 16 + slot : slot;
        }
      }
    }
    if (this.footprint) {
      forEachFootprintPixel(this.footprint, this.footprintClear, width, height, (i) => {
        codes[i] = pixels[i]! & 0x0f;
      });
    }
    return {
      width,
      height,
      codes,
      uiPalette: this.uiPalette.slice(),
      viewportPalette: this.viewportPalette?.slice() ?? null,
      overlayColours,
    };
  }
}
