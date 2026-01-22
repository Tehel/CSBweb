/**
 * Viewport Graphics Initialization
 * Port from CSBWin CSBCode.cpp lines 2877-2893
 *
 * This module handles loading and initializing the wall graphics and rectangles
 * needed for viewport rendering.
 */

import { GraphicsLoader, createImageData } from '../data/GraphicsLoader';
import { ImageFormat } from '../core/imageDecoder';
import type { Palette } from '../core/types';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';

/**
 * Wall bitmap dimensions
 * Standard wall graphics are 32x136 pixels
 */
export const WALL_BITMAP_WIDTH = 32;
export const WALL_BITMAP_HEIGHT = 136;

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
 * Initialize wall bitmaps from graphics.dat
 * Port from CSBWin CSBCode.cpp lines 2877-2893
 *
 * Wall graphics mapping (for wall set 0):
 * - pWallBitmaps[0] = graphic 84 (F0R1 - closest right wall)
 * - pWallBitmaps[1] = graphic 85 (F0L1 - closest left wall)
 * - pWallBitmaps[2] = graphic 86 (F1 walls)
 * - pWallBitmaps[3] = graphic 87 (F2 walls)
 * - pWallBitmaps[4] = graphic 88 (F3 walls)
 * - pWallBitmaps[5] = graphic 89 (F3L2 corner)
 * - pWallBitmaps[6] = mirrored copy of pWallBitmaps[5]
 *
 * @param graphicsLoader - Graphics loader instance
 * @param palette - Color palette for rendering
 * @param wallSet - Wall graphic set (default 0)
 * @returns Array of 7 wall bitmap ImageData objects
 */
export async function initializeWallBitmaps(
  graphicsLoader: GraphicsLoader,
  palette: Palette,
  wallSet: number = 0
): Promise<ImageData[]> {
  // Calculate first wall graphic index
  // CSBWin: firstWallGraphic = 77 + 13 * newWallGraphicSet
  const firstWallGraphic = 77 + 13 * wallSet;

  const wallBitmaps: ImageData[] = [];

  // Load wall graphics 84-89 (indices 0-5)
  for (let i = 0; i < 6; i++) {
    const graphicIndex = firstWallGraphic + 7 + i; // 84-89 for set 0
    const decodedImage = graphicsLoader.getImage(graphicIndex, ImageFormat.IMG1);
    const imageData = createImageData(decodedImage, palette);

    wallBitmaps.push(imageData);
  }

  // Create mirrored version of graphic 89 for index 6
  const mirroredBitmap = mirrorBitmap(wallBitmaps[5]);
  wallBitmaps.push(mirroredBitmap);

  return wallBitmaps;
}

/**
 * Initialize wall bitmaps as palette-index images (no RGBA conversion).
 *
 * This is the Phase 2 rendering path: the bytecode interpreter writes indices into a viewport buffer,
 * and the renderer converts to RGBA only at final present.
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

  wallBitmaps.push(mirrorIndexedBitmap(wallBitmaps[5]));
  return wallBitmaps;
}

/**
 * Initialize door bitmaps as palette-index images (no RGBA conversion).
 *
 * CSBWin `ReadWallBitmaps()` loads door bitmaps from `firstWallGraphic + [0..6]` into `pDoorBitmaps[1..7]`
 * and precomputes `pDoorBitmaps[0]` as a mirror of `pDoorBitmaps[2]` (CSBCode.cpp:2870-2897).
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
  doorBitmaps[0] = mirrorIndexedBitmap(doorBitmaps[2]);

  return doorBitmaps;
}

/**
 * Mirror a bitmap horizontally
 * Port from CSBWin MakeMirror function
 *
 * @param source - Source ImageData to mirror
 * @returns Mirrored ImageData
 */
function mirrorBitmap(source: ImageData): ImageData {
  const width = source.width;
  const height = source.height;
  const mirrored = new ImageData(width, height);

  // Copy and flip horizontally
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIndex = (y * width + x) * 4;
      const dstIndex = (y * width + (width - 1 - x)) * 4;

      // Copy RGBA values
      mirrored.data[dstIndex + 0] = source.data[srcIndex + 0]; // R
      mirrored.data[dstIndex + 1] = source.data[srcIndex + 1]; // G
      mirrored.data[dstIndex + 2] = source.data[srcIndex + 2]; // B
      mirrored.data[dstIndex + 3] = source.data[srcIndex + 3]; // A
    }
  }

  return mirrored;
}

function mirrorIndexedBitmap(source: IndexedBitmap): IndexedBitmap {
  const width = source.width;
  const height = source.height;
  const out = new Uint8Array(width * height);
  const src = source.pixels;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      out[row + (width - 1 - x)] = src[row + x];
    }
  }

  return { width, height, pixels: out };
}

/**
 * Blit a shape (bitmap) to the viewport canvas
 * Port from CSBWin CSBCode.cpp line 2930 BltShapeToViewport
 *
 * @param ctx - Canvas 2D rendering context
 * @param bitmap - Source ImageData to draw
 * @param rect - Destination rectangle on viewport
 */
export function bltShapeToViewport(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageData,
  rect: { x1: number; y1: number; x2: number; y2: number }
): void {
  // Calculate destination dimensions
  const dstWidth = rect.x2 - rect.x1 + 1;
  const dstHeight = rect.y2 - rect.y1 + 1;

  // Create temporary canvas for the bitmap
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bitmap.width;
  tempCanvas.height = bitmap.height;
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    console.error('Failed to create temporary canvas context');
    return;
  }

  // Draw the bitmap to temp canvas
  tempCtx.putImageData(bitmap, 0, 0);

  // Draw (scaled if necessary) to viewport at destination rectangle
  ctx.drawImage(
    tempCanvas,
    0, 0, bitmap.width, bitmap.height,  // Source rect
    rect.x1, rect.y1, dstWidth, dstHeight  // Dest rect
  );
}

/**
 * Initialize floor and ceiling graphics
 * Port from CSBWin floor/ceiling initialization
 *
 * @param graphicsLoader - Graphics loader instance
 * @returns Object containing floor and ceiling ImageData
 */
export async function initializeFloorCeiling(
  graphicsLoader: GraphicsLoader,
  palette: Palette
): Promise<{ floor: ImageData; ceiling: ImageData }> {

  // CSBWin: ReadAndExpandGraphic(P1*2 + 75, d.pFloorBitmap, ...)
  const floorImage = graphicsLoader.getImage(75, ImageFormat.IMG1);
  console.log(`Floor graphic 75: ${floorImage.width}x${floorImage.height}`);
  const floorGraphic = createImageData(floorImage, palette);

  // CSBWin: ReadAndExpandGraphic(P1*2 + 76, d.pCeilingBitmap, ...)
  const ceilingImage = graphicsLoader.getImage(76, ImageFormat.IMG1);
  console.log(`Ceiling graphic 76: ${ceilingImage.width}x${ceilingImage.height}`);
  const ceilingGraphic = createImageData(ceilingImage, palette);

  return {
    floor: floorGraphic,
    ceiling: ceilingGraphic,
  };
}

/**
 * Initialize floor and ceiling graphics as palette-index images (no RGBA conversion).
 *
 * CSBWin: `ReadAndExpandGraphic(P1*2 + 75, d.pFloorBitmap, ...)` and `... + 76` (CSBCode.cpp:2864-2865)
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
