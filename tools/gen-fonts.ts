/**
 * Write each data set's font, `<id>-font.ttf` in its folder (`fontPath`,
 * `src/data/DataSets.ts`): the game's font as a TrueType font, which the welcome page
 * draws its labels in (`src/ui/welcomePage.ts`), the default set's.
 *
 * The glyphs are graphics.dat's font, item 0x22d (`loadFontData`,
 * `src/renderer/csbwin/TextRenderer.ts`), as the game draws it: six rows of five pixels a
 * character, bits 4..0 of `bytes[code + row * 128]`, and an advance of six. An em is eight
 * pixels, 128 units each: the glyph's six rows sit in the middle of the eight, so a line
 * of the font's own height, `line-height: 1`, holds the game's six-pixel line with one
 * blank row above and one below. The fifth row stands on the baseline, and the sixth, the
 * tails of Q and the comma, under it.
 *
 * Each run of lit pixels in a row is a rectangle, and a run the row above has in the same
 * columns extends that row's rectangle down.
 *
 * Codes 0x20 to 0x5F are ASCII's space, punctuation, digits and capitals. The lower case
 * letters are their capitals', as the game upper-cases what it prints
 * (`drawTextLineIndex`), and a no-break space is the space. A code whose glyph is blank,
the at sign in DM's and CSB's fonts, is left out, so the browser draws it in its own. The page's one character the
 * game's font lacks, the middle dot that separates its preview's fields, is the page's
 * own glyph: the colon's upper dot one row down, at the hyphen's height. The other codes,
 * the game's runes and symbols, are not text, and are left out.
 *
 * Run:
 *
 *   npx tsx tools/gen-fonts.ts [<id>…]            # write them
 *   npx tsx tools/gen-fonts.ts --check [<id>…]    # check them (npm test)
 *   npx tsx tools/gen-fonts.ts --rows [<id>]      # the default set's characters, as JSON
 *
 * `--check` writes nothing: it asserts that every set's file holds the bytes this tool
 * would write, and that the default set has one. That the browser draws the file as the
 * game's font, pixel for pixel, is `tools/probe-frames.mjs`'s check, which reads the
 * characters to expect from `--rows`: `[[codePoint, [six row bytes]], …]`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { fontPath, type DataSet } from '../src/data/DataSets';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { check, finish } from './lib/check';
import { DATA_SETS, DEFAULT_DATA_SET } from './lib/dataSets';
import { writeTtf, type TtfGlyph, type TtfRect } from './lib/ttf';

const ROWS = 6;
const ROW_STRIDE = 128;
const GLYPH_WIDTH = 5;
const ADVANCE = 6;
const PIXEL = 128;
const UNITS_PER_EM = 8 * PIXEL;
/** The rows above the baseline: the sixth is under it. */
const ROWS_ABOVE = 5;

/** A glyph of six row bytes, bit 4 its leftmost pixel. */
function glyphOf(rows: readonly number[]): TtfGlyph {
  const rects: TtfRect[] = [];
  let above: { x0: number; x1: number; rect: TtfRect }[] = [];
  rows.forEach((byte, row) => {
    const runs: { x0: number; x1: number; rect: TtfRect }[] = [];
    for (let col = 0; col < GLYPH_WIDTH; col++) {
      if (((byte >> (GLYPH_WIDTH - 1 - col)) & 1) === 0) continue;
      let end = col;
      while (end + 1 < GLYPH_WIDTH && ((byte >> (GLYPH_WIDTH - 2 - end)) & 1) === 1) end++;
      const x0 = col * PIXEL, x1 = (end + 1) * PIXEL;
      const y0 = (ROWS_ABOVE - 1 - row) * PIXEL;
      const same = above.find((run) => run.x0 === x0 && run.x1 === x1);
      if (same) {
        same.rect.y0 = y0;
        runs.push(same);
      } else {
        const rect = { x0, y0, x1, y1: y0 + PIXEL };
        rects.push(rect);
        runs.push({ x0, x1, rect });
      }
      col = end;
    }
    above = runs;
  });
  return { advance: ADVANCE * PIXEL, rects };
}

/**
 * The characters of `set`'s font: each code point the font draws with its six row bytes,
 * and the codes 0x20 to 0x5F left out for a blank glyph.
 */
function characters(set: DataSet): { drawn: Map<number, number[]>; missing: number[] } {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(`${set.dir}/graphics.dat`)));
  const font = loadFontData(graphics).bytes;
  const rowsOf = (code: number): number[] => Array.from({ length: ROWS }, (_, row) => font[code + row * ROW_STRIDE]!);

  const drawn = new Map<number, number[]>();
  const missing: number[] = [];
  for (let code = 0x20; code <= 0x5f; code++) {
    const rows = rowsOf(code);
    if (code !== 0x20 && rows.every((row) => (row & 0x1f) === 0)) missing.push(code);
    else drawn.set(code, rows);
  }
  for (let code = 0x61; code <= 0x7a; code++) {
    const capital = drawn.get(code - 0x20);
    if (capital) drawn.set(code, capital);
  }
  drawn.set(0xa0, drawn.get(0x20)!);
  drawn.set(0xb7, [0, 0, rowsOf(0x3a)[1]!, 0, 0, 0]);
  return { drawn, missing };
}

/** `set`'s font file, from its `graphics.dat`: a glyph for each distinct set of rows. */
function fontFile(set: DataSet): { bytes: Uint8Array; glyphs: number; missing: number[] } {
  const { drawn, missing } = characters(set);
  const glyphs: TtfGlyph[] = [{ advance: ADVANCE * PIXEL, rects: [] }];
  const glyphOfRows = new Map<string, number>();
  const cmap = new Map<number, number>();
  for (const [code, rows] of drawn) {
    const key = rows.join();
    if (!glyphOfRows.has(key)) {
      glyphOfRows.set(key, glyphs.length);
      glyphs.push(glyphOf(rows));
    }
    cmap.set(code, glyphOfRows.get(key)!);
  }

  const bytes = writeTtf({
    family: 'DM Screen',
    source: `The font of ${set.name}'s graphics.dat, item 0x22d`,
    unitsPerEm: UNITS_PER_EM,
    ascent: (ROWS_ABOVE + 1) * PIXEL,
    descent: (UNITS_PER_EM / PIXEL - ROWS_ABOVE - 1) * PIXEL,
    capHeight: ROWS_ABOVE * PIXEL,
    glyphs,
    cmap,
  });
  return { bytes, glyphs: glyphs.length, missing };
}

function main(): void {
  const args = process.argv.slice(2);
  const checking = args.includes('--check');
  const ids = args.filter((arg) => !arg.startsWith('--'));
  if (args.includes('--rows')) {
    const set = ids.length === 0 ? DEFAULT_DATA_SET : DATA_SETS.find((s) => s.id === ids[0]);
    if (!set) throw new Error(`the manifest has no data set ${ids[0]}`);
    console.log(JSON.stringify([...characters(set).drawn]));
    return;
  }
  const unknown = ids.filter((id) => !DATA_SETS.some((set) => set.id === id));
  if (unknown.length > 0) throw new Error(`the manifest has no data set ${unknown.join(', ')}`);
  const sets = ids.length === 0 ? DATA_SETS : DATA_SETS.filter((set) => ids.includes(set.id));

  for (const set of sets) {
    const path = fontPath(set);
    const font = fontFile(set);
    const left = font.missing.map((code) => String.fromCharCode(code)).join('');
    console.log(`${set.id}: ${path}, ${font.glyphs} glyphs, ${font.bytes.length} bytes, blank and left out: ${left || 'none'}`);
    check(!/[0-9A-Z]/.test(left), `${set.id}: every digit and capital is drawn`);
    if (!checking) {
      writeFileSync(path, font.bytes);
      continue;
    }
    if (!existsSync(path)) {
      check(set !== DEFAULT_DATA_SET, `${set.id}: the default set, whose font the welcome page draws in, has its font`);
      continue;
    }
    const committed = new Uint8Array(readFileSync(path));
    check(committed.length === font.bytes.length && committed.every((v, i) => v === font.bytes[i]),
      `${set.id}: the font file holds the font read from graphics.dat`);
  }
  finish();
}

main();
