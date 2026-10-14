/**
 * Write each data set's thumbnail, `<id>-thumbnail.png` in its folder (`thumbnailPath`,
 * `src/data/DataSets.ts`), which the welcome page's tile shows (`src/ui/welcomePage.ts`).
 *
 * A thumbnail is the last frame of the set's title, drawn from its own `graphics.dat` by
 * `src/renderer/intro/TitleThumbnail.ts`, the same drawing and the same PNG the form that
 * adds a player's own set makes with "Generate from data". The page could draw the site's
 * sets' in the same way, but only by fetching every listed set's `graphics.dat` (270 to
 * 460 KB each) to show one picture.
 *
 * Every set the manifest lists gets one, hidden or not, so a deployed manifest that shows
 * a hidden set finds its thumbnail. The files are uploaded with the sets
 * (`doc/DEPLOYMENT.md`).
 *
 * Run:
 *
 *   npx tsx tools/gen-thumbnails.ts [<id>…]            # write them
 *   npm test -- --only=gen-thumbnails.ts --check [<id>…]  # check them
 *
 * `--check` writes nothing: it asserts that every set's file holds the frame this tool
 * would write, pixel for pixel and colour for colour, that the PNG it would write decodes
 * to the same, and that every set the welcome page lists has one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { chooserSets, thumbnailPath, type DataSet } from '../src/data/DataSets';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { lastTitleFrame, thumbnailPalette, thumbnailPng, type TitleFrame } from '../src/renderer/intro/TitleThumbnail';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { DATA_SETS, MANIFEST } from './lib/dataSets';
import { decodePng, readPng, type PngImage } from './lib/png';

/** The title's last frame, played from `set`'s `graphics.dat`. */
async function frameOf(set: DataSet): Promise<TitleFrame> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(`${set.dir}/graphics.dat`)));
  try {
    return await lastTitleFrame(graphics);
  } catch (error) {
    throw new Error(`${set.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Whether `png` is `frame`, a paletted 320x200 PNG; each failure checked as `what`'s. */
function checkPng(what: string, png: PngImage, frame: TitleFrame, plte: number[][]): void {
  check(png.width === SCREEN_WIDTH && png.height === SCREEN_HEIGHT && png.ctype === 3,
    `${what} is a paletted ${SCREEN_WIDTH}x${SCREEN_HEIGHT} PNG (got ${png.width}x${png.height}, type ${png.ctype})`);
  check(png.indices.length === frame.pixels.length && png.indices.every((v, i) => v === frame.pixels[i]),
    `${what}'s pixels are the title's last frame`);
  check(JSON.stringify(png.palette) === JSON.stringify(plte),
    `${what}'s colours are the registers the title leaves`);
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
    const frame = await frameOf(set);
    const plte = thumbnailPalette(frame.registers);
    const used = new Set(frame.pixels).size;
    console.log(`${set.id}: ${path}, registers ${frame.registers.map((r) => r.toString(16).padStart(3, '0')).join(' ')}, ${used} used`);
    check(used > 1, `${set.id}: the title's last frame is not one flat colour`);
    const made = await thumbnailPng(frame);
    if (!checking) {
      writeFileSync(path, made);
      continue;
    }
    checkPng(`${set.id}: the PNG the page makes`, decodePng(made), frame, plte);
    if (!existsSync(path)) {
      check(!chooserSets(MANIFEST).includes(set), `${set.id}: a set the welcome page lists has its thumbnail`);
      continue;
    }
    checkPng(`${set.id}: the thumbnail`, readPng(path), frame, plte);
  }
  finish();
}

await main();
