/**
 * An image made into wall decorations of `CSBgraphics.dat` (`tools/lib/wallDecorationArt.ts`):
 * `tools/fixtures/theron-cover.png` (320x200, tens of thousands of colours) as a picture
 * and as a plaque, over DM's `graphics.dat`, in its palette at full light.
 *
 * What this asserts:
 *
 * 1. **The picture**: its bitmap 112x71, the wall two squares ahead's 104 columns then 8
 *    `WALL_TRANSPARENT`; the wall's columns never transparent, each a colour of the palette,
 *    and many of them (dithered, not flat).
 * 2. **The plaque**: its front 128x32 and its side 16x32, every pixel one of the greys or
 *    transparent; a magenta pixel transparent.
 * 3. **The placements**: thirteen each, in the viewport (224x136); the plaque's 10, 11 and
 *    12 its bitmaps' sizes; the picture's 8 and 12 its bitmap's width, its 8 on the wall.
 * 4. **The round trip**: both written by `wallDecorationSection` into a `CSBgraphics.dat`,
 *    which `CSBGraphicsLoader` reads back as they were made.
 *
 * Run: `npm test -- --only=wall-decoration-art.ts`
 */
import { CSBGraphicsLoader, CSBGraphicType, type DecorationDesc } from '../../src/data/CSBGraphicsLoader';
import { buildCSBGraphicsFile, wallDecorationSection } from '../../src/data/CSBGraphicsWriter';
import type { IndexedBitmap } from '../../src/renderer/csbwin/CanvasBlitter';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, stockGraphics } from '../lib/game';
import { SAVE_DIR } from '../lib/saves';
import {
  BASE_SET, GREYS, PLAQUE, WALL_TRANSPARENT, greyBitmap, magentaTransparent, picturePlacements, plaquePlacements,
  readImage, transparentBitmap, wallPicture,
} from '../lib/wallDecorationArt';

const COVER = `${SAVE_DIR}/theron-cover.png`;
const VIEWPORT = { width: 224, height: 136 };

const tables = graphicsTablesOf(stockGraphics());
const palette = tables.ui.graphic232.palette552[0]!;
const walls = tables.viewport.wallRectangles;
const cover = readImage(COVER);
console.log(`cover ${cover.width}x${cover.height}`);

const inViewport = (d: DecorationDesc): boolean =>
  d.x1 >= 0 && d.x1 <= d.x2 && d.x2 < VIEWPORT.width && d.y1 >= 0 && d.y1 <= d.y2 && d.y2 < VIEWPORT.height && d.height === d.y2 - d.y1 + 1;

console.log('1. The picture');
const picture = wallPicture(cover, walls, palette);
{
  const wall = walls[3]!;
  const wallWidth = wall.x2 - wall.x1 + 1;
  const height = wall.y2 - wall.y1 + 1;
  console.log(`  wall ${wallWidth}x${height} at (${wall.x1},${wall.y1}), bitmap ${picture.width}x${picture.height}`);
  check(wallWidth === 104 && height === 71 && picture.width === 112 && picture.height === 71, 'the bitmap is 112x71, the wall 104x71');
  let opaque = true;
  let padding = true;
  const used = new Set<number>();
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const pixel = picture.pixels[y * picture.width + x]!;
      if (x < wallWidth) {
        opaque &&= pixel !== WALL_TRANSPARENT && pixel < 16;
        used.add(pixel);
      } else padding &&= pixel === WALL_TRANSPARENT;
    }
  }
  console.log(`  ${used.size} colours`);
  check(opaque, "the wall's columns are each a palette colour, none transparent");
  check(padding, 'the 8 columns past it are transparent');
  check(used.size >= 12, 'dithered into most of the palette');
}

console.log('2. The plaque');
const front = greyBitmap(cover, PLAQUE.front, palette);
const side = greyBitmap(magentaTransparent({ width: 1, height: 1, rgba: new Uint8Array([255, 0, 255, 255]) }), PLAQUE.side, palette);
{
  const greys = new Set([...GREYS, WALL_TRANSPARENT]);
  check(front.width === 128 && front.height === 32, 'the front is 128x32');
  check(front.pixels.every((p) => greys.has(p)) && front.pixels.some((p) => p !== WALL_TRANSPARENT), 'in greys');
  check(side.width === 16 && side.height === 32 && side.pixels.every((p) => p === WALL_TRANSPARENT), 'a magenta side is transparent');
}

console.log('3. The placements');
const plaques = plaquePlacements(tables.objects.wallDecorationRectSets[BASE_SET]!);
const pictures = picturePlacements(walls, plaques);
{
  const size = (d: DecorationDesc): string => `${d.x2 - d.x1 + 1}x${d.height}`;
  console.log(`  plaque: ${plaques.map(size).join(' ')}`);
  console.log(`  picture: ${pictures.map(size).join(' ')}`);
  check(plaques.length === 13 && pictures.length === 13, 'thirteen each');
  check(plaques.every(inViewport) && pictures.every(inViewport), 'each in the viewport');
  check(size(plaques[10]!) === '16x32' && size(plaques[11]!) === '16x32' && size(plaques[12]!) === '128x32', "the plaque's 10, 11 and 12 its bitmaps' sizes");
  check(pictures[8]!.widthBytes * 2 === picture.width && pictures[12]!.widthBytes * 2 === picture.width, "the picture's 8 and 12 its bitmap's width");
  check(pictures[8]!.x1 === walls[3]!.x1 && pictures[8]!.y1 === walls[3]!.y1, "the picture's 8 on the wall two squares ahead");
}

console.log('4. The round trip');
{
  const pictureSide = transparentBitmap(PLAQUE.side);
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(buildCSBGraphicsFile([
    { type: CSBGraphicType.WallDecoration, id: 1, name: 'PLAQUE', data: wallDecorationSection(plaques, side, front) },
    { type: CSBGraphicType.WallDecoration, id: 2, name: 'PICTURE', data: wallDecorationSection(pictures, pictureSide, picture) },
  ]));
  const same = (id: number, desc: DecorationDesc[], sideBitmap: IndexedBitmap, frontBitmap: IndexedBitmap): boolean => {
    const back = loader.getWallDecoration(id);
    const equal = (a: IndexedBitmap, b: IndexedBitmap): boolean =>
      a.width === b.width && a.height === b.height && a.pixels.every((p, i) => p === b.pixels[i]);
    return back !== null && JSON.stringify(back.desc) === JSON.stringify(desc) && equal(back.sideBitmap, sideBitmap) && equal(back.frontBitmap, frontBitmap);
  };
  check(same(1, plaques, side, front), 'the plaque reads back as made');
  check(same(2, pictures, pictureSide, picture), 'the picture reads back as made');
}

finish();
