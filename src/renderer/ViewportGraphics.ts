/**
 * Viewport Graphics Initialization
 * Port from CSBWin CSBCode.cpp lines 2877-2893
 *
 * This module handles loading and initializing the wall graphics and rectangles
 * needed for viewport rendering.
 */

import { GraphicsLoader } from '../data/GraphicsLoader';
import { ImageFormat } from '../core/imageDecoder';
import { mirrorBitmap, type IndexedBitmap } from './csbwin/CanvasBlitter';

/**
 * Graphic `graphicNum` as palette indices, decoded once and kept in `cache`: the screen's
 * graphics cache, which the viewport's interpreter and the interface share. `null` for a
 * negative number or a graphic that does not decode.
 */
export function getCachedGraphicBitmap(
  graphicsLoader: GraphicsLoader,
  cache: Map<string, IndexedBitmap>,
  graphicNum: number,
  format: ImageFormat = ImageFormat.IMG1,
): IndexedBitmap | null {
  if (graphicNum < 0) return null;
  const key = `${graphicNum}-${format}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const decoded = graphicsLoader.getImage(graphicNum, format);
    const pixels = decoded.pixels instanceof Uint8Array ? decoded.pixels : Uint8Array.from(decoded.pixels as ArrayLike<number>);
    const bmp: IndexedBitmap = { width: decoded.width, height: decoded.height, pixels };
    cache.set(key, bmp);
    return bmp;
  } catch {
    return null;
  }
}

/**
 * Wall bitmap dimensions
 * Standard wall graphics are 32x136 pixels
 */

/**
 * Viewport dimensions (dungeon view area)
 */
export const VIEWPORT_WIDTH = 224;
export const VIEWPORT_HEIGHT = 136;

/**
 * Full screen dimensions (Atari ST low resolution)
 */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Viewport position within full screen
 * Port from CSBWin Menu.cpp line 452-455
 */
export const VIEWPORT_X = 0;
export const VIEWPORT_Y = 33;

/**
 * The wall bitmaps, as palette-index images (CSBWin `CSBCode.cpp:2933-2949`). For wall set 0,
 * graphics 84-89 are `pWallBitmaps[0..5]` (F0R1, F0L1, F1, F2, F3, the F3L2 corner), and
 * `pWallBitmaps[6]` is the corner mirrored. The bytecode interpreter writes indices into a
 * viewport buffer, and the renderer converts to RGBA only at the end.
 */
export function initializeWallBitmapsIndexed(
  graphicsLoader: GraphicsLoader,
  wallSet: number = 0
): IndexedBitmap[] {
  const firstWallGraphic = 77 + 13 * wallSet;
  const wallBitmaps: IndexedBitmap[] = [];

  const toU8 = (pixels: unknown): Uint8Array => {
    if (pixels instanceof Uint8Array) return pixels;
    return Uint8Array.from(pixels as ArrayLike<number>);
  };

  for (let i = 0; i < 6; i++) {
    const graphicIndex = firstWallGraphic + 7 + i; // 84-89 for set 0
    const decodedImage = graphicsLoader.getImage(graphicIndex, ImageFormat.IMG1);
    wallBitmaps.push({
      width: decodedImage.width,
      height: decodedImage.height,
      pixels: toU8(decodedImage.pixels),
    });
  }

  wallBitmaps.push(mirrorBitmap(wallBitmaps[5]));
  return wallBitmaps;
}

/**
 * Initialize door bitmaps as palette-index images (no RGBA conversion).
 *
 * CSBWin `ReadWallBitmaps()` loads door bitmaps from `firstWallGraphic + [0..6]` into `pDoorBitmaps[1..7]`
 * and precomputes `pDoorBitmaps[0]` as a mirror of `pDoorBitmaps[2]` (CSBCode.cpp:2926-2953).
 */
export function initializeDoorBitmapsIndexed(
  graphicsLoader: GraphicsLoader,
  wallSet: number = 0
): IndexedBitmap[] {
  const firstWallGraphic = 77 + 13 * wallSet;
  const toU8 = (pixels: unknown): Uint8Array => {
    if (pixels instanceof Uint8Array) return pixels;
    return Uint8Array.from(pixels as ArrayLike<number>);
  };

  const doorBitmaps: IndexedBitmap[] = new Array(8);

  // Load door bitmaps into slots [1..7] (graphics 77..83 for wallSet 0)
  for (let i = 0; i < 7; i++) {
    const graphicIndex = firstWallGraphic + i;
    const decodedImage = graphicsLoader.getImage(graphicIndex, ImageFormat.IMG1);
    doorBitmaps[i + 1] = {
      width: decodedImage.width,
      height: decodedImage.height,
      pixels: toU8(decodedImage.pixels),
    };
  }

  // Mirror of slot [2] into slot [0] (used as "door facing right frame" in CSBWin)
  doorBitmaps[0] = mirrorBitmap(doorBitmaps[2]);

  return doorBitmaps;
}

/**
 * Initialize floor and ceiling graphics as palette-index images (no RGBA conversion).
 *
 * CSBWin: `ReadAndExpandGraphic(P1*2 + 75, d.pFloorBitmap, ...)` and `... + 76` (CSBCode.cpp:2920-2921)
 */
export function initializeFloorCeilingIndexed(
  graphicsLoader: GraphicsLoader,
  backgroundGraphicSet: number
): { floor: IndexedBitmap; ceiling: IndexedBitmap } {
  const toU8 = (pixels: unknown): Uint8Array => {
    if (pixels instanceof Uint8Array) return pixels;
    return Uint8Array.from(pixels as ArrayLike<number>);
  };

  const floorImage = graphicsLoader.getImage(backgroundGraphicSet * 2 + 75, ImageFormat.IMG1);
  const ceilingImage = graphicsLoader.getImage(backgroundGraphicSet * 2 + 76, ImageFormat.IMG1);

  return {
    floor: { width: floorImage.width, height: floorImage.height, pixels: toU8(floorImage.pixels) },
    ceiling: { width: ceilingImage.width, height: ceilingImage.height, pixels: toU8(ceilingImage.pixels) },
  };
}
