/**
 * Build `static/gamefiles/csb/utility-portraits.dat` from the Chaos Strikes Back utility
 * disk's champion portraits, `A:\PORTRAIT\*.CMP`.
 *
 * The utility disk carries a redrawn portrait of each of DM's 24 champions
 * (`doc/ATARI_ST_DISK_REFERENCE.md` → "The Chaos Strikes Back utility disk"). The utility's
 * champion editor puts one on a champion by hand. CSBWin does not port that editor, so
 * these portraits are not in any of its files.
 *
 * The file is a `graphics.dat` of two items, so `GraphicsLoader` reads it as it reads any
 * other. Item 0, stored uncompressed, is a 256x87 IMG1 picture laid out like DM's graphic
 * 26. Cell `charID` holds the redrawn face of the champion whose DM portrait is cell
 * `charID` of graphic 26, at `(charID & 7) << 5`, `(charID >> 3) * 29`. Item 1 is DM's
 * graphic 26 itself, copied as `dm-atari/graphics.dat` stores it: the reference RISE
 * matches a champion's portrait against (`src/data/UtilityPortraits.ts`), so that the
 * `csb` set needs no DM `graphics.dat`.
 *
 * A `.CMP` file finds its cell by name. Bytes 16-23 of the file are the champion's name,
 * and each DM mirror's hero text gives a name and a portrait (`extractPresetHeroes` over
 * `dm-atari/dungeon.dat`).
 *
 * The disk image is not in the repository, so this tool is not in `npm test`. Run:
 *
 *   npx tsx tools/gen-utility-portraits.ts <CSB_UTIL.ST> [--png <preview.png>]
 *   npx tsx tools/gen-utility-portraits.ts --sheet <utility-portraits.dat> [--png <preview.png>]
 *
 * The second form takes item 0's pixels from a file this tool wrote, for a rebuild
 * without the disk; the encoding is the same, so item 0's bytes are too.
 *
 * The tool reads back what it wrote. From the disk, every cell must decode to its
 * `.CMP`'s pixels, and `writePortrait` must turn every cell back into the `.CMP`'s 464
 * bytes, which are the bytes a save stores at `CHARDESC`'s portrait. Item 1 must decode
 * to graphic 26's pixels.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, writePortrait } from '../src/data/CsbwinCharacters';
import { check, finish } from './lib/check';
import { STOCK_DIR, graphicsTablesOf, presetHeroesOf, stockDungeon, stockGraphics } from './lib/game';
import { writeIndexedPng } from './lib/png';

const OUTPUT = 'static/gamefiles/csb/utility-portraits.dat';
const COLUMNS = 8;
const ROWS = 3;
const SHEET_WIDTH = COLUMNS * PORTRAIT_WIDTH;
const SHEET_HEIGHT = ROWS * PORTRAIT_HEIGHT;
/** A `.CMP`: a 16-byte header, the name (8 bytes), the title (20), then the portrait. */
const CMP_NAME = 16;
const CMP_PORTRAIT = 44;
const PORTRAIT_BYTES = (PORTRAIT_WIDTH * PORTRAIT_HEIGHT) / 2;
const CMP_SIZE = CMP_PORTRAIT + PORTRAIT_BYTES;
/** Where `writePortrait` puts the portrait in a `CHARDESC`. */
const CHARDESC_PORTRAIT = 336;
/** DM's champion portraits. */
const GRAPHIC_PORTRAITS = 26;

interface DiskFile {
  name: string;
  isDirectory: boolean;
  bytes: Uint8Array;
}

/** A raw `.ST` image's FAT12 filesystem, as its boot sector describes it. */
function fat12(image: Uint8Array): { root: () => DiskFile[]; list: (dir: DiskFile) => DiskFile[] } {
  const u16 = (at: number): number => image[at]! | (image[at + 1]! << 8);
  const bytesPerSector = u16(11);
  const sectorsPerCluster = image[13]!;
  const reserved = u16(14);
  const fats = image[16]!;
  const rootEntries = u16(17);
  const sectorsPerFat = u16(22);
  const fatAt = reserved * bytesPerSector;
  const rootAt = (reserved + fats * sectorsPerFat) * bytesPerSector;
  const dataAt = rootAt + rootEntries * 32;
  const clusterSize = sectorsPerCluster * bytesPerSector;
  const next = (cluster: number): number => {
    const v = u16(fatAt + Math.floor((cluster * 3) / 2));
    return cluster & 1 ? v >> 4 : v & 0xfff;
  };
  const chain = (first: number, size: number | null): Uint8Array => {
    const parts: Uint8Array[] = [];
    for (let c = first; c >= 2 && c < 0xff0 && parts.length < 4096; c = next(c)) {
      parts.push(image.subarray(dataAt + (c - 2) * clusterSize, dataAt + (c - 1) * clusterSize));
    }
    const all = Buffer.concat(parts);
    return new Uint8Array(size === null ? all : all.subarray(0, size));
  };
  const entries = (table: Uint8Array): DiskFile[] => {
    const out: DiskFile[] = [];
    for (let at = 0; at + 32 <= table.length && table[at] !== 0; at += 32) {
      const attributes = table[at + 11]!;
      if (table[at] === 0xe5 || attributes & 0x08) continue;
      const base = Buffer.from(table.subarray(at, at + 8)).toString('latin1').trimEnd();
      const ext = Buffer.from(table.subarray(at + 8, at + 11)).toString('latin1').trimEnd();
      if (base === '.' || base === '..') continue;
      const isDirectory = (attributes & 0x10) !== 0;
      const cluster = table[at + 26]! | (table[at + 27]! << 8);
      const size = (table[at + 28]! | (table[at + 29]! << 8) | (table[at + 30]! << 16) | (table[at + 31]! << 24)) >>> 0;
      out.push({ name: ext ? `${base}.${ext}` : base, isDirectory, bytes: chain(cluster, isDirectory ? null : size) });
    }
    return out;
  };
  return {
    root: () => entries(image.subarray(rootAt, dataAt)),
    list: (dir) => entries(dir.bytes),
  };
}

/** Atari planar, four big-endian plane words per 16 pixels, plane 0 the low bit. */
function planarToPixels(bytes: Uint8Array): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let x = 0; x < PORTRAIT_WIDTH; x++) {
      const word = y * 16 + (x >> 4) * 8;
      const bit = 15 - (x & 15);
      let colour = 0;
      for (let plane = 0; plane < 4; plane++) {
        colour |= ((((bytes[word + 2 * plane]! << 8) | bytes[word + 2 * plane + 1]!) >> bit) & 1) << plane;
      }
      pixels.push(colour);
    }
  }
  return pixels;
}

/**
 * IMG1 with solid runs only (`decodeIMG`'s table, `src/core/imageDecoder.ts`): up to 8
 * pixels in one byte, up to 256 with a count byte, and longer ones with a 16-bit count.
 */
function encodeIMG1(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const out = [width >> 8, width & 0xff, height >> 8, height & 0xff];
  for (let p = 0; p < pixels.length;) {
    const colour = pixels[p]!;
    let run = 1;
    while (p + run < pixels.length && pixels[p + run] === colour && run < 0x10000) run++;
    if (run <= 8) out.push(((run - 1) << 4) | colour);
    else if (run <= 0x100) out.push(0x80 | colour, run - 1);
    else out.push(0xc0 | colour, (run - 1) >> 8, (run - 1) & 0xff);
    p += run;
  }
  return new Uint8Array(out);
}

/** One item of a `graphics.dat`: its bytes as stored, and its size once decompressed. */
interface StoredItem {
  stored: Uint8Array;
  size: number;
}

/** A `graphics.dat`: the count, the stored sizes, the decompressed sizes, then the items. */
function graphicsDat(items: StoredItem[]): Uint8Array {
  const header = 2 + 4 * items.length;
  const out = new Uint8Array(header + items.reduce((n, item) => n + item.stored.length, 0));
  const word = (at: number, value: number): void => {
    if (value > 0xffff) throw new Error(`${value} does not fit a graphics.dat's word`);
    out[at] = value >> 8;
    out[at + 1] = value & 0xff;
  };
  word(0, items.length);
  let at = header;
  items.forEach((item, i) => {
    word(2 + 2 * i, item.stored.length);
    word(2 + 2 * (items.length + i), item.size);
    out.set(item.stored, at);
    at += item.stored.length;
  });
  return out;
}

/** Item `index` of a `graphics.dat` as the file stores it. */
function storedItem(file: Uint8Array, index: number): StoredItem {
  const word = (at: number): number => (file[at]! << 8) | file[at + 1]!;
  const count = word(0);
  let at = 2 + 4 * count;
  for (let i = 0; i < index; i++) at += word(2 + 2 * i);
  return { stored: file.slice(at, at + word(2 + 2 * index)), size: word(2 + 2 * (count + index)) };
}

const args = process.argv.slice(2);
const pngAt = args.indexOf('--png');
const pngPath = pngAt >= 0 ? args.splice(pngAt, 2)[1] : undefined;
const sheetAt = args.indexOf('--sheet');
const sheetPath = sheetAt >= 0 ? args.splice(sheetAt, 2)[1] : undefined;
const imagePath = args[0];
if (!imagePath === !sheetPath) {
  console.log('usage: npx tsx tools/gen-utility-portraits.ts <CSB_UTIL.ST> | --sheet <utility-portraits.dat> [--png <preview.png>]');
  process.exit(2);
}

const sheet = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT);
const cmpByCell = new Map<number, Uint8Array>();
if (imagePath) readDisk(imagePath);
else readSheet(sheetPath!);

/** The 24 `.CMP`s of the disk's `PORTRAIT` folder, each in its cell. */
function readDisk(path: string): void {
  const image = new Uint8Array(readFileSync(resolve(path)));
  console.log(`${path}: ${image.length} bytes, md5 ${createHash('md5').update(image).digest('hex')}`);
  const disk = fat12(image);
  const folder = disk.root().find((f) => f.name === 'PORTRAIT' && f.isDirectory);
  if (!folder) throw new Error('no PORTRAIT folder on the disk');
  const files = disk.list(folder).filter((f) => !f.isDirectory && f.name.endsWith('.CMP'));
  check(files.length === 24, `PORTRAIT holds 24 .CMP files (${files.length})`);

  const heroes = presetHeroesOf(stockDungeon(), stockGraphics());
  for (const file of files) {
    check(file.bytes.length === CMP_SIZE, `${file.name} is ${CMP_SIZE} bytes (${file.bytes.length})`);
    const name = Buffer.from(file.bytes.subarray(CMP_NAME, CMP_NAME + 8)).toString('latin1').replace(/\0.*$/s, '');
    const title = Buffer.from(file.bytes.subarray(CMP_NAME + 8, CMP_PORTRAIT)).toString('latin1').replace(/\0.*$/s, '');
    const matches = heroes.filter((h) => h.name === name);
    check(matches.length === 1, `${file.name}: one DM hero is named "${name}" (${matches.length})`);
    const charID = matches[0]?.portraitIndex;
    if (charID === undefined) continue;
    check(charID < COLUMNS * ROWS && !cmpByCell.has(charID), `${file.name}: cell ${charID} is free`);
    const portrait = file.bytes.subarray(CMP_PORTRAIT, CMP_SIZE);
    cmpByCell.set(charID, portrait);
    const pixels = planarToPixels(portrait);
    const ox = (charID & 7) << 5;
    const oy = (charID >> 3) * PORTRAIT_HEIGHT;
    for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
      for (let x = 0; x < PORTRAIT_WIDTH; x++) sheet[(oy + y) * SHEET_WIDTH + ox + x] = pixels[y * PORTRAIT_WIDTH + x]!;
    }
    const header = Buffer.from(file.bytes.subarray(0, CMP_NAME)).toString('hex').replace(/(.{4})(?!$)/g, '$1 ');
    console.log(`  cell ${String(charID).padStart(2)}  ${file.name.padEnd(12)} ${name.padEnd(8)} ${title.padEnd(20)} header ${header}`);
  }
  check(cmpByCell.size === COLUMNS * ROWS, `every cell has a portrait (${cmpByCell.size})`);
}

/** Item 0 of a file this tool wrote, its pixels to encode again. */
function readSheet(path: string): void {
  const bytes = new Uint8Array(readFileSync(resolve(path)));
  console.log(`${path}: ${bytes.length} bytes, md5 ${createHash('md5').update(bytes).digest('hex')}`);
  const loader = new GraphicsLoader();
  loader.loadFromArray(bytes);
  const image = loader.getImage(0);
  check(image.width === SHEET_WIDTH && image.height === SHEET_HEIGHT, `its item 0 is ${SHEET_WIDTH}x${SHEET_HEIGHT}`);
  sheet.set(image.pixels);
  const encoded = encodeIMG1(SHEET_WIDTH, SHEET_HEIGHT, sheet);
  check(Buffer.from(encoded).equals(Buffer.from(storedItem(bytes, 0).stored)),
    'its item 0 is what this tool encodes from its pixels');
}

const item = encodeIMG1(SHEET_WIDTH, SHEET_HEIGHT, sheet);
const dmGraphics = new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/graphics.dat`)));
const file = graphicsDat([{ stored: item, size: item.length }, storedItem(dmGraphics, GRAPHIC_PORTRAITS)]);
writeFileSync(resolve(OUTPUT), file);
console.log(`${OUTPUT}: ${file.length} bytes, md5 ${createHash('md5').update(file).digest('hex')}`);

// Read it back as the port will.
const loader = new GraphicsLoader();
loader.loadFromArray(new Uint8Array(readFileSync(resolve(OUTPUT))));
const decoded = loader.getImage(0);
check(loader.getItemCount() === 2, 'the file holds two items');
check(decoded.width === SHEET_WIDTH && decoded.height === SHEET_HEIGHT, `item 0 is ${SHEET_WIDTH}x${SHEET_HEIGHT}`);
const reference = loader.getImage(1);
const graphic26 = stockGraphics().getImage(GRAPHIC_PORTRAITS);
check(reference.width === graphic26.width && reference.height === graphic26.height
  && reference.pixels.every((p, i) => p === graphic26.pixels[i]), `item 1 is DM's graphic ${GRAPHIC_PORTRAITS}`);
for (const [charID, portrait] of cmpByCell) {
  const cell: number[] = [];
  const ox = (charID & 7) << 5;
  const oy = (charID >> 3) * PORTRAIT_HEIGHT;
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let x = 0; x < PORTRAIT_WIDTH; x++) cell.push(decoded.pixels[(oy + y) * SHEET_WIDTH + ox + x]!);
  }
  const block = new Uint8Array(CHARDESC_PORTRAIT + PORTRAIT_BYTES);
  writePortrait(block, 0, cell);
  check(Buffer.from(block.subarray(CHARDESC_PORTRAIT)).equals(Buffer.from(portrait)),
    `cell ${charID} goes back to its .CMP's 464 bytes through writePortrait`);
}

if (pngPath) {
  const palette = graphicsTablesOf(stockGraphics()).ui.graphic232.palette552[0]!;
  const rgb = palette.map((c) => [((c >> 8) & 7) * 36, ((c >> 4) & 7) * 36, (c & 7) * 36]);
  writeIndexedPng(resolve(pngPath), SHEET_WIDTH, SHEET_HEIGHT, decoded.pixels, rgb);
  console.log(`preview: ${pngPath}`);
}
finish();
