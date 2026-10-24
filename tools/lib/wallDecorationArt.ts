/**
 * An image made into a wall decoration of `CSBgraphics.dat` (`wallDecorationSection`,
 * `src/data/CSBGraphicsWriter.ts`): a picture that covers a wall, or a plaque in the
 * dungeon's greys, each with the 13 placements it is drawn at.
 *
 * - **A picture** (`wallPicture`) covers the wall seen two squares ahead, the viewport's
 *   `wallRectangles[3]` (`RECT_StdWallRectangleF2`, `doc/CSBwin-src/Viewport.cpp:2310`),
 *   104x71 at (60,20) in DM's `graphics.dat`. It is scaled to cover it, its ratio kept and
 *   what passes it cropped evenly, each pixel the average of the source area it covers;
 *   its levels stretched (the darkest and lightest 2% clipped) and its shadows lifted
 *   (gamma 0.7), for the dungeon's darkest colours are far above a photograph's shadows;
 *   then Floyd-Steinberg dithered into the dungeon's colours but `WALL_TRANSPARENT`, the
 *   nearest by luminance-weighted distance. Its bitmap is 112 wide, a multiple of 16
 *   (`encodePlanar`), the last 8 columns transparent.
 * - **Its placements** (`picturePlacements`) keep that view as the bitmap stands: the
 *   farther views are the front bitmap shrunk to each rectangle by `ShrinkBLT`
 *   (`doc/CSBwin-src/Graphics.cpp:381`), which takes one source pixel per destination
 *   pixel and would turn the dithering to noise; at entry 8, the bitmap's own 112
 *   columns, it copies. Entry 3 is the bitmap shrunk as the wall at three squares
 *   (`wallRectangles[0]`, 76x51) is to the wall at two; 2 and 4 the same beside it, cut
 *   by the screen's edges (2 drawn 2 pixels right, 4 squeezed into what is left of it,
 *   `CSBCode.cpp:3604-3621`); 7 and 9 are 8's width, 7's right edge 8 pixels past the
 *   wall's, so that the cut it is drawn from (`srcOffsetX = finalBitmapWidth - (x2 -
 *   x1)`) puts the transparent columns there. Entry 12, a square ahead, is the bitmap as
 *   it stands, centred on the wall. The side views are given (a plaque's, say), their
 *   bitmap `transparentBitmap`: a picture is made to be seen face on.
 * - **A plaque** (`greyBitmap`, light letters on black, its side view the same) is in the
 *   dungeon's greys, the nearest of each averaged pixel; a pixel less than half opaque is
 *   `WALL_TRANSPARENT`, which the blit leaves (`DrawWallDecoration`,
 *   `CSBCode.cpp:3739-3748`). `magentaTransparent` makes a BMP's magenta that.
 * - **Its placements** (`plaquePlacements`) are DM's own for a wide, low decoration,
 *   `wallDecorationPosition[BASE_SET]` (front 96x12 at eye level), each rectangle grown
 *   about its centre: the front ones by the plaque's size over that set's front, the side
 *   ones by the side bitmap's width over the set's side, and all by the heights' ratio.
 * - **The 13 placements** of a wall decoration of `CSBgraphics.dat` are its own
 *   (`DrawWallDecoration`, `CSBCode.cpp:3240-3266`): entry `relativePosition`, the
 *   viewport's positions (`DrawViewport`), 0-1 the side walls three squares ahead, 2-4
 *   the walls facing the party there, 5-6 and 7-9 two squares ahead, 10-11 and 12 one.
 *   The F1 ones are drawn as the bitmaps stand, the side one mirrored on the right (11);
 *   the farther ones are the side bitmap (entry 10's size on the left, 11's on the
 *   right) or the front one (12's) shrunk to their rectangle, the width of 7 and 9 that
 *   of 8, which the screen's edge cuts (`:3408-3519`, `:3604-3621`).
 *
 * `tools/checks/wall-decoration-art.ts` makes both from a picture and reads them back.
 */
import { readFileSync } from 'node:fs';

import { atariToRGB } from '../../src/core/types';
import type { DecorationDesc, IndexedBitmap } from '../../src/data/CSBGraphicsLoader';
import { decodePng } from './png';

/** A rectangle of the viewport, its corners included, as `RectPos` holds one. */
export interface ViewportRect { x1: number; y1: number; x2: number; y2: number }

/** The viewport's `wallRectangles` a picture's placements are made from (`Viewport.cpp:2304-2316`). */
const WALL_F3 = 0;
const WALL_F2 = 3;
const WALL_F1 = 6;
/** A picture's preparation: the share of pixels clipped at each end of its levels, and the gamma its shadows are lifted by. */
const LEVELS_CLIP = 0.02;
const LIFT_GAMMA = 0.7;

/** A bitmap's size. */
export interface Size { width: number; height: number }
/** A plaque's two bitmaps, the sizes `plaquePlacements` places them at. */
export interface PlaqueSize { front: Size; side: Size }
/** A plaque two thirds of a 192x48 title, legible at DM's size; its side view 16x32, a multiple of 16 wide. */
export const PLAQUE: PlaqueSize = { front: { width: 128, height: 32 }, side: { width: 16, height: 32 } };
/** DM's wall decoration placement set the plaque's are made from: front 96x12 at eye level. */
export const BASE_SET = 4;
/** The colour a wall decoration's blit leaves (`CSBCode.cpp:3747`). */
export const WALL_TRANSPARENT = 10;
/** The dungeon palette's greys, darkest first: the plaques' colours. */
export const GREYS = [0, 12, 1, 2, 13, 15];

/** An image's pixels, four bytes each. */
export interface Rgba { width: number; height: number; rgba: Uint8Array }

/** The image at `path`, a PNG or a 24-bit uncompressed BMP. */
export function readImage(path: string): Rgba {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    const png = decodePng(bytes);
    return { width: png.width, height: png.height, rgba: png.rgba };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offBits = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  if (view.getUint16(28, true) !== 24 || view.getUint32(30, true) !== 0 || height <= 0) {
    throw new Error(`${path}: only a bottom-up 24-bit uncompressed BMP is read`);
  }
  const stride = Math.ceil((width * 3) / 4) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = offBits + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = bytes[row + x * 3 + 2]!;
      rgba[at + 1] = bytes[row + x * 3 + 1]!;
      rgba[at + 2] = bytes[row + x * 3]!;
      rgba[at + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/**
 * `image` at `width` by `height`, each pixel the average of the source area it covers,
 * its colour weighted by its alpha; an alpha of 0 where nothing opaque is.
 */
function resample(image: Rgba, width: number, height: number): Rgba {
  const sx = image.width / width;
  const sy = image.height / height;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      let area = 0;
      for (let v = Math.floor(y * sy); v < Math.ceil((y + 1) * sy); v++) {
        const h = Math.min(v + 1, (y + 1) * sy) - Math.max(v, y * sy);
        for (let u = Math.floor(x * sx); u < Math.ceil((x + 1) * sx); u++) {
          const w = (Math.min(u + 1, (x + 1) * sx) - Math.max(u, x * sx)) * h;
          const at = (v * image.width + u) * 4;
          const alpha = image.rgba[at + 3]! / 255;
          for (let c = 0; c < 3; c++) sum[c]! += image.rgba[at + c]! * alpha * w;
          sum[3]! += alpha * w;
          area += w;
        }
      }
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out[at + c] = sum[3]! > 0 ? Math.round(sum[c]! / sum[3]!) : 0;
      out[at + 3] = Math.round((255 * sum[3]!) / area);
    }
  }
  return { width, height, rgba: out };
}

/** The middle of `image` with the ratio `width` to `height`, whole pixels. */
function cropToRatio(image: Rgba, width: number, height: number): Rgba {
  const w = Math.min(image.width, Math.round((image.height * width) / height));
  const h = Math.min(image.height, Math.round((image.width * height) / width));
  const left = Math.floor((image.width - w) / 2);
  const top = Math.floor((image.height - h) / 2);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(image.rgba.subarray(((top + y) * image.width + left) * 4, ((top + y) * image.width + left + w) * 4), y * w * 4);
  return { width: w, height: h, rgba };
}

/** `image`'s luminance stretched from its `LEVELS_CLIP` quantiles to the full range, then raised to `LIFT_GAMMA`, each pixel's hue kept. */
function lift(image: Rgba): Rgba {
  const count = image.width * image.height;
  const luminance = (p: number): number => 0.3 * image.rgba[p * 4]! + 0.59 * image.rgba[p * 4 + 1]! + 0.11 * image.rgba[p * 4 + 2]!;
  const sorted = Array.from({ length: count }, (_, p) => luminance(p)).sort((a, b) => a - b);
  const lo = sorted[Math.floor(count * LEVELS_CLIP)]!;
  const hi = sorted[Math.floor(count * (1 - LEVELS_CLIP))]!;
  const rgba = new Uint8Array(image.rgba);
  for (let p = 0; p < count; p++) {
    const l = luminance(p);
    const target = 255 * Math.max(0, Math.min(1, (l - lo) / Math.max(1, hi - lo))) ** LIFT_GAMMA;
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.min(255, l > 0.5 ? (image.rgba[p * 4 + c]! * target) / l : target);
  }
  return { width: image.width, height: image.height, rgba };
}

/** `image` Floyd-Steinberg dithered into `palette`'s (16 Atari words) colours but `WALL_TRANSPARENT`, the nearest by luminance-weighted distance. */
function dithered(image: Rgba, palette: readonly number[]): IndexedBitmap {
  const colours = palette.map((word, i) => {
    const { r, g, b } = atariToRGB(word);
    return { i, rgb: [r, g, b] };
  }).filter((colour) => colour.i !== WALL_TRANSPARENT);
  const { width, height } = image;
  const wanted = Float64Array.from({ length: width * height * 3 }, (_, k) => image.rgba[Math.floor(k / 3) * 4 + (k % 3)]!);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const want = [0, 1, 2].map((c) => Math.max(0, Math.min(255, wanted[p * 3 + c]!)));
      let best = colours[0]!;
      let distance = Infinity;
      for (const colour of colours) {
        const d = 0.3 * (want[0]! - colour.rgb[0]!) ** 2 + 0.59 * (want[1]! - colour.rgb[1]!) ** 2 + 0.11 * (want[2]! - colour.rgb[2]!) ** 2;
        if (d < distance) { distance = d; best = colour; }
      }
      pixels[p] = best.i;
      for (let c = 0; c < 3; c++) {
        const error = want[c]! - best.rgb[c]!;
        const spread = (dx: number, dy: number, share: number): void => {
          if (x + dx >= 0 && x + dx < width && y + dy < height) wanted[((y + dy) * width + x + dx) * 3 + c]! += error * share;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
    }
  }
  return { width, height, pixels };
}

/** A width in pixels rounded up to a multiple of 16, a bitplane bitmap's. */
const wholeGroups = (width: number): number => Math.ceil(width / 16) * 16;

/**
 * `image` as a picture, the front view of its wall decoration: the wall two squares ahead
 * (`walls[WALL_F2]`) covered, in `palette`'s colours (16 Atari words), its bitmap's
 * columns past the wall's width `WALL_TRANSPARENT`.
 */
export function wallPicture(image: Rgba, walls: readonly ViewportRect[], palette: readonly number[]): IndexedBitmap {
  const wall = walls[WALL_F2]!;
  const width = wall.x2 - wall.x1 + 1;
  const height = wall.y2 - wall.y1 + 1;
  const picture = dithered(lift(resample(cropToRatio(image, width, height), width, height)), palette);
  const stride = wholeGroups(width);
  const pixels = new Uint8Array(stride * height).fill(WALL_TRANSPARENT);
  for (let y = 0; y < height; y++) pixels.set(picture.pixels.subarray(y * width, (y + 1) * width), y * stride);
  return { width: stride, height, pixels };
}

/** A bitmap of `size` that draws nothing: a picture's side view, which it is not made to show. */
export function transparentBitmap(size: Size): IndexedBitmap {
  return { ...size, pixels: new Uint8Array(size.width * size.height).fill(WALL_TRANSPARENT) };
}

/**
 * A picture's 13 placements (above): the front ones from the viewport's walls `walls`,
 * the side ones `sides`' (a plaque's, `plaquePlacements`).
 */
export function picturePlacements(walls: readonly ViewportRect[], sides: readonly DecorationDesc[]): DecorationDesc[] {
  const f2 = walls[WALL_F2]!;
  const f3 = walls[WALL_F3]!;
  const f1 = walls[WALL_F1]!;
  const wallWidth = f2.x2 - f2.x1 + 1;
  const height = f2.y2 - f2.y1 + 1;
  const stride = wholeGroups(wallWidth);
  /** A rectangle cut at the screen's edges, its width in bytes the cut one's (the bitmap shrunk to it) unless given. */
  const place = (x1: number, x2: number, y1: number, y2: number, widthBytes?: number): DecorationDesc => {
    const [left, right] = [Math.max(0, x1), Math.min(223, x2)];
    return { x1: left, x2: right, y1, y2, widthBytes: widthBytes ?? wholeGroups(right - left + 1) / 2, height: y2 - y1 + 1 };
  };
  // Three squares ahead: the bitmap shrunk as that wall is to the one two squares ahead.
  const far = Math.round((stride * (f3.x2 - f3.x1 + 1)) / wallWidth);
  const out = [...sides];
  out[2] = place(0, far - 1, f3.y1, f3.y2);
  out[3] = place(f3.x1, f3.x1 + far - 1, f3.y1, f3.y2);
  out[4] = place(f3.x2 + 1, f3.x2 + far, f3.y1, f3.y2);
  // Two squares ahead: 8 the bitmap itself; 7 and 9 its width, cut at the screen's edges.
  out[8] = place(f2.x1, f2.x1 + stride - 1, f2.y1, f2.y2, stride / 2);
  out[7] = place(0, f2.x1 - 1 + (stride - wallWidth), f2.y1, f2.y2, stride / 2);
  out[9] = place(f2.x2 + 1, f2.x2 + stride, f2.y1, f2.y2, stride / 2);
  // A square ahead: the bitmap as it stands, centred on the wall.
  const x1 = f1.x1 + Math.floor((f1.x2 - f1.x1 + 1 - wallWidth) / 2);
  const y1 = f1.y1 + Math.floor((f1.y2 - f1.y1 + 1 - height) / 2);
  out[12] = place(x1, x1 + stride - 1, y1, y1 + height - 1, stride / 2);
  // 7 is drawn from column `finalBitmapWidth - (x2 - x1)` of the bitmap (8's width): the
  // wall's last column must land on the screen's column before the wall two squares ahead.
  const from = (out[8]!.x2 - out[8]!.x1) - (out[7]!.x2 - out[7]!.x1);
  if (wallWidth - 1 - from !== f2.x1 - 1) throw new Error(`picture placement 7 is drawn from column ${from}`);
  for (const d of out) if (d.y1 < 0 || d.y2 > 135) throw new Error('a picture placement leaves the viewport');
  return out;
}

/** `image` in the dungeon's greys under `palette` (16 Atari words); a pixel less than half opaque `WALL_TRANSPARENT`. */
function inGreys(image: Rgba, palette: readonly number[]): IndexedBitmap {
  const greys = GREYS.map((i) => {
    const { r, g, b } = atariToRGB(palette[i]!);
    return { i, rgb: [r, g, b] };
  });
  const pixels = new Uint8Array(image.width * image.height);
  for (let p = 0; p < pixels.length; p++) {
    if (image.rgba[p * 4 + 3]! < 128) { pixels[p] = WALL_TRANSPARENT; continue; }
    let best = greys[0]!;
    let distance = Infinity;
    for (const grey of greys) {
      const d = [0, 1, 2].reduce((sum, c) => sum + (image.rgba[p * 4 + c]! - grey.rgb[c]!) ** 2, 0);
      if (d < distance) { distance = d; best = grey; }
    }
    pixels[p] = best.i;
  }
  return { width: image.width, height: image.height, pixels };
}

/** `image` with its magenta (255, 0, 255) transparent, as a BMP marks it. */
export function magentaTransparent(image: Rgba): Rgba {
  const rgba = new Uint8Array(image.rgba);
  for (let p = 0; p < image.width * image.height; p++) {
    const at = p * 4;
    if (rgba[at] === 255 && rgba[at + 1] === 0 && rgba[at + 2] === 255) rgba[at + 3] = 0;
  }
  return { width: image.width, height: image.height, rgba };
}

/** `image` at `size`, in `palette`'s greys: a plaque's front or side view. */
export function greyBitmap(image: Rgba, size: Size, palette: readonly number[]): IndexedBitmap {
  return inGreys(resample(image, size.width, size.height), palette);
}

/**
 * A plaque's 13 placements for its bitmaps of `plaque`'s sizes, from `base`, DM's
 * `wallDecorationPosition[BASE_SET]`: each
 * rectangle grown about its centre (7's and 9's whole, the width of 8, before the
 * screen's edge cuts them again), and each width in bytes the rectangle's rounded up to 16
 * pixels, but 7's and 9's, 8's.
 */
export function plaquePlacements(base: readonly DecorationDesc[], plaque: PlaqueSize = PLAQUE): DecorationDesc[] {
  const widthOf = (d: DecorationDesc): number => d.x2 - d.x1 + 1;
  const fx = plaque.front.width / widthOf(base[12]!);
  const sx = plaque.side.width / widthOf(base[10]!);
  const fy = plaque.front.height / base[12]!.height;
  const SIDES = [0, 1, 5, 6, 10, 11];
  const grow = (lo: number, hi: number, factor: number): [number, number] => {
    const size = Math.round((hi - lo + 1) * factor);
    const start = Math.round((lo + hi) / 2 - (size - 1) / 2);
    return [start, start + size - 1];
  };
  const out = base.map((d, p): DecorationDesc => {
    const factor = SIDES.includes(p) ? sx : fx;
    // 7 and 9 are 8's width, cut by the screen's left and right edges.
    let [lo, hi] = [d.x1, d.x2];
    if (p === 7) lo = d.x2 - (widthOf(base[8]!) - 1);
    if (p === 9) hi = d.x1 + widthOf(base[8]!) - 1;
    const [x1, x2] = grow(lo, hi, factor);
    const [y1, y2] = grow(d.y1, d.y1 + d.height - 1, fy);
    return { x1: Math.max(0, x1), x2: Math.min(223, x2), y1, y2, widthBytes: Math.ceil((x2 - x1 + 1) / 16) * 8, height: y2 - y1 + 1 };
  });
  out[7]!.widthBytes = out[8]!.widthBytes;
  out[9]!.widthBytes = out[8]!.widthBytes;
  for (const [p, bitmap] of [[10, plaque.side], [11, plaque.side], [12, plaque.front]] as const) {
    const d = out[p]!;
    if (d.x2 - d.x1 + 1 !== bitmap.width || d.height !== bitmap.height || d.widthBytes * 2 !== bitmap.width) {
      throw new Error(`plaque placement ${p} is ${d.x2 - d.x1 + 1}x${d.height}, its bitmap ${bitmap.width}x${bitmap.height}`);
    }
  }
  for (const d of out) if (d.y1 < 0 || d.y2 > 135) throw new Error('a plaque placement leaves the viewport');
  return out;
}
