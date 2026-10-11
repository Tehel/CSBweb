/**
 * Write each data set's thumbnail, `<id>-thumbnail.png` in its folder (`thumbnailPath`,
 * `src/data/DataSets.ts`), which the welcome page's tile shows (`src/ui/welcomePage.ts`).
 *
 * A thumbnail is the last frame of the set's title: `displayChaosStrikesBack`
 * (`src/renderer/intro/TitleSequence.ts`) played to its end on a host whose blanks take no
 * time, from the set's own `graphics.dat`, and the screen it leaves seen through the colour
 * registers it leaves. So it is the boot's title as the player sees it at its last hold:
 * the logo and "Master" on red, for DM's data, or whatever another set's item 1 holds,
 * through the same registers. The page could draw it in the same way, but only by
 * fetching every listed set's `graphics.dat` (270 to 460 KB each) to show one picture.
 *
 * The PNG is the whole 320x200 screen, paletted, its sixteen entries the sixteen registers
 * as the canvas shows them (an Atari intensity times 36, `atariToRGB`), so pixel `n` is
 * register `n`. The page shows it at half size, 160x100, where a screen of two device
 * pixels to the CSS pixel shows every one of its pixels.
 *
 * Every set the manifest lists gets one, hidden or not, so a deployed manifest that shows
 * a hidden set finds its thumbnail. The files are uploaded with the sets
 * (`doc/DEPLOYMENT.md`).
 *
 * Run:
 *
 *   npx tsx tools/gen-thumbnails.ts [<id>…]            # write them
 *   npx tsx tools/gen-thumbnails.ts --check [<id>…]    # check them (npm test)
 *
 * `--check` writes nothing: it asserts that every set's file holds the frame this tool
 * would write, pixel for pixel and colour for colour, and that every set the welcome page
 * lists has one.
 */
import { existsSync, readFileSync } from 'node:fs';

import { chooserSets, thumbnailPath, type DataSet } from '../src/data/DataSets';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { atariToRGB } from '../src/core/types';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { PALETTE_11914, type IntroHost } from '../src/renderer/intro/IntroHost';
import { displayChaosStrikesBack } from '../src/renderer/intro/TitleSequence';
import { SCREEN_HEIGHT, SCREEN_WIDTH, getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { DATA_SETS, MANIFEST } from './lib/dataSets';
import { graphicsTablesOf } from './lib/game';
import { readPng, writeIndexedPng } from './lib/png';

interface Frame {
  pixels: Uint8Array;
  /** The sixteen colour registers, Atari `0RGB`. */
  registers: number[];
}

/** The title's last frame, played from `set`'s `graphics.dat`. */
async function lastTitleFrame(set: DataSet): Promise<Frame> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(`${set.dir}/graphics.dat`)));
  const uiTables = graphicsTablesOf(graphics).ui;
  const cache = new Map<string, IndexedBitmap>();
  const unused = (): never => { throw new Error('the title asked for what only the entrance uses'); };
  const host: IntroHost = {
    screen: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
    uiTables,
    font: loadFontData(graphics),
    // The boot's first registers (`createIntroHost`, `BootSequence.ts`). The title's first
    // fade sets all sixteen, so the last frame does not depend on them.
    globalPalette: [...(uiTables.graphic232.palette552[0] ?? PALETTE_11914)],
    getGraphic(graphicNum: number): IndexedBitmap {
      const bitmap = getCachedGraphicBitmap(graphics, cache, graphicNum);
      if (!bitmap) throw new Error(`${set.id}: graphics.dat item ${graphicNum} did not decode`);
      return bitmap;
    },
    present: () => {},
    vbl: () => Promise.resolve(),
    startSound: () => {},
    drawPrisonInterior: unused,
    nextEvent: unused,
    takeClick: unused,
    discardAllInput: unused,
    mouseSwitches: unused,
    keyWaiting: unused,
    setCursorVisible: unused,
  };
  await displayChaosStrikesBack(host);
  return { pixels: host.screen.pixels, registers: host.globalPalette.slice(0, 16) };
}

function plteOf(registers: readonly number[]): number[][] {
  return registers.map((register) => {
    const { r, g, b } = atariToRGB(register);
    return [r, g, b];
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checking = args.includes('--check');
  const ids = args.filter((arg) => arg !== '--check');
  const unknown = ids.filter((id) => !DATA_SETS.some((set) => set.id === id));
  if (unknown.length > 0) throw new Error(`the manifest has no data set ${unknown.join(', ')}`);
  const sets = ids.length === 0 ? DATA_SETS : DATA_SETS.filter((set) => ids.includes(set.id));

  for (const set of sets) {
    const path = thumbnailPath(set);
    const frame = await lastTitleFrame(set);
    const plte = plteOf(frame.registers);
    const used = new Set(frame.pixels).size;
    console.log(`${set.id}: ${path}, registers ${frame.registers.map((r) => r.toString(16).padStart(3, '0')).join(' ')}, ${used} used`);
    check(used > 1, `${set.id}: the title's last frame is not one flat colour`);
    if (!checking) {
      writeIndexedPng(path, SCREEN_WIDTH, SCREEN_HEIGHT, frame.pixels, plte);
      continue;
    }
    if (!existsSync(path)) {
      check(!chooserSets(MANIFEST).includes(set), `${set.id}: a set the welcome page lists has its thumbnail`);
      continue;
    }
    const png = readPng(path);
    check(png.width === SCREEN_WIDTH && png.height === SCREEN_HEIGHT && png.ctype === 3,
      `${set.id}: the thumbnail is a paletted ${SCREEN_WIDTH}x${SCREEN_HEIGHT} PNG (got ${png.width}x${png.height}, type ${png.ctype})`);
    check(png.indices.length === frame.pixels.length && png.indices.every((v, i) => v === frame.pixels[i]),
      `${set.id}: the thumbnail's pixels are the title's last frame`);
    check(JSON.stringify(png.palette) === JSON.stringify(plte),
      `${set.id}: the thumbnail's colours are the registers the title leaves`);
  }
  finish();
}

await main();
