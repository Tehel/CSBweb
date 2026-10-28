/**
 * `tools/fixtures/gamefiles/dm-atari/graphics.dat` is CSBWin's `graphics.dat` with two items taken
 * from the Atari ST 1.2 disk's, and nothing else changed.
 *
 * CSBWin's DM package ships the first 1.0 disk's file (8 December 1987), with its credits
 * corrupted by a copy (kept pristine in `dm-windows/`). Three of its items are worse than
 * 1.2's (`doc/ATARI_ST_DISK_REFERENCE.md` → "CSBWin's files"):
 *
 * - **item 5, the credits scroll**, where four bytes corrupt four lines of the text;
 * - **item `0x22e`**, whose `Byte4100[55]` puts the pressed Crack Switch at eye level;
 * - **graphic 232**, the pressed Crack Switch's front view, where CSBWin's crack is empty
 *   and 1.2's shows the button pushed in, on the pixels where the released crack (graphic
 *   222) draws its button.
 *
 * (`doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's with three items from the
 * 1.2 disk".) The file is a splice, not an edit: the items' compressed bytes are 1.2's, and
 * the header's size table follows. This tool proves that the splice changes exactly what
 * it should: each donor item decompresses to CSBWin's except in the bytes named here (or,
 * for graphic 232, which 1.2 encodes in 120 bytes to CSBWin's 108, decodes to CSBWin's
 * picture except in the pixels named here), every other item is byte-identical to
 * CSBWin's, and the committed file is the splice.
 *
 * `graphics.dat` has no checksum. CSBWin's graphics signature (an MD5 of the file,
 * `doc/CSBwin-src/data.cpp:1946`) is checked only when a save or a dungeon states an
 * expected one (`doc/CSBwin-src/Graphics.cpp:1808-1829`), and DM's never do.
 *
 * Run: `npm test -- --only=dm-atari-graphics.ts` (checks), `… --write` (rebuilds the file).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ImageFormat, decodeIMG } from '../../src/core/imageDecoder';
import { check, finish } from '../lib/check';
import { type Items, expand, readItems, writeItems } from '../lib/graphicsDat';

const CSBWIN = 'tools/fixtures/gamefiles/dm-windows/graphics.dat';
const ST_1_2 = 'tools/fixtures/gamefiles/dm-atari-1.2/graphics.dat';
const OUTPUT = 'tools/fixtures/gamefiles/dm-atari/graphics.dat';
const CSBWIN_MD5 = '0b5e042f2c7f2752bac78292cc6bb07e';
const ST_1_2_MD5 = '9ce2eaf7a9e78620e3f17594437caffa';

/**
 * The items taken from 1.2, and where each differs from CSBWin's: decompressed bytes, or
 * for a picture re-encoded at another size, decoded pixels (`y * width + x`).
 */
const DONATED: { item: number; name: string; bytes?: number[]; pixels?: number[] }[] = [
  { item: 5, name: 'the credits scroll', bytes: [1398, 2283, 3096, 3983] },
  { item: 232, name: 'Crack Switch (In), front view', pixels: [2 * 32 + 12, 2 * 32 + 13, 3 * 32 + 11, 3 * 32 + 12, 3 * 32 + 13, 3 * 32 + 14, 4 * 32 + 12, 4 * 32 + 13] },
  { item: 0x22e, name: 'Byte4100[55], Crack Switch (In)', bytes: [3201] },
];
/** Crack Switch (Out)'s front view, `121 + 2 * 50 + 1`. */
const CRACK_OUT_FRONT = 222;

const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');

function main(): void {
  const csbwinBytes = new Uint8Array(readFileSync(resolve(CSBWIN)));
  const stBytes = new Uint8Array(readFileSync(resolve(ST_1_2)));
  check(md5(csbwinBytes) === CSBWIN_MD5, `${CSBWIN} is CSBWin's DM graphics.dat (md5 ${CSBWIN_MD5})`);
  check(md5(stBytes) === ST_1_2_MD5, `${ST_1_2} is the 1.2 disk's (md5 ${ST_1_2_MD5})`);
  const csbwin = readItems(csbwinBytes);
  const st = readItems(stBytes);
  check(csbwin.count === 563 && st.count === 563, 'both files hold 563 items');

  const spliced: Items = { ...csbwin, decompressed: [...csbwin.decompressed], data: [...csbwin.data] };
  for (const { item, name, bytes, pixels } of DONATED) {
    if (bytes) {
      check(csbwin.decompressed[item] === st.decompressed[item], `item ${item} (${name}) has the same decompressed size in both`);
      const a = expand(csbwin, item);
      const b = expand(st, item);
      const differ = [...a.keys()].filter((k) => a[k] !== b[k]);
      console.log(`item ${item} (${name}): compressed ${csbwin.compressed[item]} -> ${st.compressed[item]} bytes; `
        + `differs at ${differ.map((k) => `${k} (${a[k]} -> ${b[k]})`).join(', ')}`);
      check(differ.join() === bytes.join(), `item ${item} decompresses to CSBWin's except at bytes ${bytes.join(', ')}`);
    } else if (pixels) {
      const a = decodeIMG(expand(csbwin, item), ImageFormat.IMG1);
      const b = decodeIMG(expand(st, item), ImageFormat.IMG1);
      check(a.width === b.width && a.height === b.height, `graphic ${item} (${name}) is ${a.width}x${a.height} in both`);
      const differ = [...a.pixels.keys()].filter((k) => a.pixels[k] !== b.pixels[k]);
      console.log(`graphic ${item} (${name}): compressed ${csbwin.compressed[item]} -> ${st.compressed[item]} bytes; differs at `
        + differ.map((k) => `(${k % a.width},${Math.floor(k / a.width)}) ${a.pixels[k]} -> ${b.pixels[k]}`).join(', '));
      check(differ.join() === pixels.join(), `graphic ${item} decodes to CSBWin's picture except at ${pixels.length} pixels`);
    }
    spliced.data[item] = st.data[item];
    spliced.decompressed[item] = st.decompressed[item];
  }
  // The pressed crack's new pixels are the released crack's button: where graphic 222 and
  // CSBWin's 232 differ, and nowhere else.
  {
    const out = decodeIMG(expand(csbwin, CRACK_OUT_FRONT), ImageFormat.IMG1);
    const inCsbwin = decodeIMG(expand(csbwin, 232), ImageFormat.IMG1);
    const button = [...out.pixels.keys()].filter((k) => out.pixels[k] !== inCsbwin.pixels[k]);
    check(button.join() === DONATED.find((d) => d.item === 232)!.pixels!.join(),
      'the 8 pixels are where Crack Switch (Out) draws its button: 1.2 draws the button pushed in, CSBWin\'s draws none');
  }
  check(expand(spliced, 0x22e)[3201] === 2, 'the spliced Byte4100[55] is 2, Crack Switch (Out)\'s set');

  const built = writeItems(spliced);
  const reread = readItems(built);
  const others = [...Array(csbwin.count).keys()].filter((i) => !DONATED.some((d) => d.item === i));
  check(others.every((i) => reread.data[i].length === csbwin.data[i].length && reread.data[i].every((v, k) => v === csbwin.data[i][k])
    && reread.decompressed[i] === csbwin.decompressed[i]), `the other ${others.length} items are CSBWin's, byte for byte`);
  for (const { item } of DONATED) {
    const a = expand(reread, item);
    const b = expand(st, item);
    check(reread.compressed[item] === st.compressed[item] && reread.decompressed[item] === st.decompressed[item]
      && a.length === b.length && a.every((v, k) => v === b[k]), `the spliced file's item ${item} reads back as 1.2's, sizes and all`);
  }
  console.log(`spliced file: ${built.length} bytes, md5 ${md5(built)}`);

  if (process.argv.includes('--write')) {
    writeFileSync(resolve(OUTPUT), built);
    console.log(`wrote ${OUTPUT}`);
  }
  const committed = new Uint8Array(readFileSync(resolve(OUTPUT)));
  check(committed.length === built.length && committed.every((v, k) => v === built[k]), `${OUTPUT} is the splice`);
  finish();
}

main();
