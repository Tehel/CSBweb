/**
 * A `CSBgraphics.dat` written: the inverse of `CSBGraphicsLoader` for the sections a
 * dungeon of the port's own makes, the viewport overlays, the overlay palettes and the
 * wall decorations.
 *
 * The file (`ReadCSBgraphic`, `doc/CSBwin-src/Graphics.cpp:3228-3306`): the sentinel
 * `CSBg`, a version word CSBWin reads and never looks at (1 in Conflux's and Towers of
 * Chaos's files, and here), the number of sections, then one `SECTIONHEADER` each
 * (`CSB.h:254-263`: `type`, `id`, `compressedSize`, `uncompressedSize`, `fileOffset`, a
 * 16-byte name nothing reads, which those files pad with spaces), little-endian. CSBWin
 * takes the first header of the type and id asked, so a file with two is refused here.
 * The sections follow the headers, each the `OVLDECODE` code words of its bytes.
 */
import { CSBGRAPHICS_SENTINEL, CSBGraphicType, type DecorationDesc, type IndexedBitmap } from './CSBGraphicsLoader';

export interface CSBGraphicSection {
  type: CSBGraphicType;
  id: number;
  /** At most 16 characters. */
  name: string;
  /** The section's bytes, uncompressed. */
  data: Uint8Array;
}

/** The version word. */
const CSBGRAPHICS_VERSION = 1;
const SECTION_HEADER_SIZE = 36;
const SECTION_NAME_SIZE = 16;

/**
 * The longest string a code may stand for. `OVLDECODE` stacks a code's string before it
 * gives it out, one byte more for a code not yet in its table, on a stack of 1,024 bytes
 * it cannot enlarge (`EnlargeStack` is `NotImplemented(0xf864)`, `Graphics.cpp:3143-3146`).
 * A string grows a byte a code, so only a run of hundreds of thousands of equal bytes
 * comes near it.
 */
const MAX_STRING = 1000;

/**
 * The code words `OVLDECODE::GetBytes` (`doc/CSBwin-src/Graphics.cpp:3157-3221`) turns back
 * into `data`, as little-endian 32-bit words.
 *
 * Its LZW: codes 0-255 are bytes; each code after the first adds to the table the string
 * of the code before it and the first byte of its own, from entry 256 (the first code
 * adds one at 255, which a code can never name: 255 is a byte); a code one past the
 * table is the string of the code before it and that string's first byte. There is no
 * clear code. Codes are 9 bits wide, and `maxTableLen - 1`, 511 at first, read while it
 * is past the table, widens them by a bit and doubles `maxTableLen`, adding nothing. The
 * table holds `maxTableLen` entries, so the code that would add entry `maxTableLen - 1`
 * must come after a widening. The tool that wrote Conflux's and Towers of Chaos's files
 * widens when the table reaches `maxTableLen - 4`, in every one of their 1,283 sections,
 * and so does this one: they are written again byte for byte
 * (`tools/dump-csbgraphics-writer.ts`). A code
 * is taken from the low bits of the current word up; one that runs past the word's end
 * takes its high bits from what is left of it and its low bits from the low end of the
 * next.
 */
export function encodeOvl(data: Uint8Array): Uint8Array {
  const words: number[] = [];
  let word = 0;
  let used = 0;
  const put = (code: number, size: number): void => {
    const available = 32 - used;
    if (size <= available) {
      word = (word | (code << used)) >>> 0;
      used += size;
    } else {
      const low = size - available;
      word = (word | ((code >>> low) << used)) >>> 0;
      words.push(word);
      word = code & ((1 << low) - 1);
      used = low;
    }
    if (used === 32) {
      words.push(word);
      word = 0;
      used = 0;
    }
  };

  // The decoder's `m_tableLen`, `m_maxTableLen` and `m_codeSize`.
  let tableLen = 255;
  let maxTableLen = 512;
  let codeSize = 9;
  const emit = (code: number): void => {
    if (tableLen === maxTableLen - 4) {
      put(maxTableLen - 1, codeSize);
      maxTableLen *= 2;
      codeSize++;
    }
    put(code, codeSize);
    tableLen++;
  };

  if (data.length > 0) {
    // Entry `nextCode` is what the decoder adds on reading the code after the one emitted.
    const table = new Map<number, number>();
    let nextCode = 256;
    let w = data[0]!;
    let wLength = 1;
    for (let i = 1; i < data.length; i++) {
      const k = data[i]!;
      const key = w * 256 + k;
      const code = table.get(key);
      if (code !== undefined && wLength < MAX_STRING) {
        w = code;
        wLength++;
        continue;
      }
      emit(w);
      if (code === undefined) table.set(key, nextCode);
      nextCode++;
      w = k;
      wLength = 1;
    }
    emit(w);
    // The word the last code is in, or, as the shipped files end when it fills one, a
    // word of nothing.
    words.push(word);
  }

  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((value, i) => view.setUint32(i * 4, value, true));
  return out;
}

/** The file of `sections`, in the order given. */
export function buildCSBGraphicsFile(sections: readonly CSBGraphicSection[]): Uint8Array {
  const seen = new Set<string>();
  for (const section of sections) {
    const key = `${section.type}/${section.id}`;
    if (seen.has(key)) throw new Error(`CSBgraphics.dat: two sections of type ${section.type}, id ${section.id}`);
    seen.add(key);
    if (section.name.length > SECTION_NAME_SIZE || !/^[\x20-\x7e]*$/.test(section.name)) {
      throw new Error(`CSBgraphics.dat: section name ${JSON.stringify(section.name)} is not 16 printable characters`);
    }
  }
  const compressed = sections.map((section) => encodeOvl(section.data));
  const headersEnd = 12 + sections.length * SECTION_HEADER_SIZE;
  const size = compressed.reduce((total, words) => total + words.length, headersEnd);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CSBGRAPHICS_SENTINEL.charCodeAt(i);
  view.setUint32(4, CSBGRAPHICS_VERSION, true);
  view.setUint32(8, sections.length, true);
  let fileOffset = headersEnd;
  sections.forEach((section, i) => {
    const at = 12 + i * SECTION_HEADER_SIZE;
    view.setUint32(at, section.type, true);
    view.setUint32(at + 4, section.id, true);
    view.setUint32(at + 8, compressed[i]!.length, true);
    view.setUint32(at + 12, section.data.length, true);
    view.setUint32(at + 16, fileOffset, true);
    const name = section.name.padEnd(SECTION_NAME_SIZE, ' ');
    for (let c = 0; c < SECTION_NAME_SIZE; c++) out[at + 20 + c] = name.charCodeAt(c);
    out.set(compressed[i]!, fileOffset);
    fileOffset += compressed[i]!.length;
  });
  return out;
}

/** `sizeof(CSB_BITMAPFILEHEADER)` and `sizeof(CSB_BITMAPINFOHEADER)` (`CSB.h:299-320`). */
const BITMAP_FILE_HEADER_SIZE = 14;
const BITMAP_INFO_HEADER_SIZE = 40;
/** `m_overlay`'s lines and their width (`doc/CSBwin-src/Graphics.cpp:2977`). */
const OVERLAY_WIDTH = 224;
const OVERLAY_HEIGHT = 136;

/**
 * A `CGT_ViewportOverlay` section: a Windows bitmap of one byte a pixel, as
 * `OVERLAYDATA::ReadOverlay` reads one (`doc/CSBwin-src/Bitmaps.cpp:572-630`). It copies
 * `(biWidth + 1) / 2 * 2 * biHeight` pixel bytes into its 224x136 `m_overlay` without
 * regard to the lines' width, so only a 224x136 bitmap shows as drawn. `pixels` is that,
 * top line first, and the file stores it bottom line first, as Windows bitmaps are and as
 * the screen reads it (`WinScreen.cpp:1249`). `colours` are `0xRRGGBB`, at most 256, and
 * `biClrUsed` says how many. The other fields are as Conflux's overlays have them.
 */
export function overlaySection(pixels: Uint8Array, colours: readonly number[]): Uint8Array {
  if (pixels.length !== OVERLAY_WIDTH * OVERLAY_HEIGHT) {
    throw new Error(`an overlay is ${OVERLAY_WIDTH}x${OVERLAY_HEIGHT} pixels, not ${pixels.length}`);
  }
  if (colours.length < 1 || colours.length > 256) throw new Error(`an overlay has 1 to 256 colours, not ${colours.length}`);
  for (const pixel of pixels) {
    if (pixel >= colours.length) throw new Error(`an overlay pixel is colour ${pixel} of ${colours.length}`);
  }
  const pixelsAt = BITMAP_FILE_HEADER_SIZE + BITMAP_INFO_HEADER_SIZE + 4 * colours.length;
  const out = new Uint8Array(pixelsAt + pixels.length);
  const view = new DataView(out.buffer);
  out[0] = 'B'.charCodeAt(0);
  out[1] = 'M'.charCodeAt(0);
  view.setUint32(2, out.length, true); // bfSize
  view.setUint32(10, pixelsAt, true); // bfOffBits
  const info = BITMAP_FILE_HEADER_SIZE;
  view.setUint32(info, BITMAP_INFO_HEADER_SIZE, true); // biSize
  view.setInt32(info + 4, OVERLAY_WIDTH, true);
  view.setInt32(info + 8, OVERLAY_HEIGHT, true);
  view.setUint16(info + 12, 1, true); // biPlanes
  view.setUint16(info + 14, 8, true); // biBitCount
  view.setUint32(info + 20, pixels.length, true); // biSizeImage
  view.setUint32(info + 32, colours.length, true); // biClrUsed
  colours.forEach((colour, i) => view.setUint32(info + BITMAP_INFO_HEADER_SIZE + 4 * i, colour & 0xffffff, true));
  for (let line = 0; line < OVERLAY_HEIGHT; line++) {
    const from = (OVERLAY_HEIGHT - 1 - line) * OVERLAY_WIDTH;
    out.set(pixels.subarray(from, from + OVERLAY_WIDTH), pixelsAt + line * OVERLAY_WIDTH);
  }
  return out;
}

/**
 * A `CGT_OverlayPalette` section, as `SetOverlayPalette` reads one
 * (`doc/CSBwin-src/Bitmaps.cpp:651-685`): 512 little-endian RGB555 words, red in bits
 * 10-14, one for each Atari colour `rrrgggbbb`, red in its bits 6-8.
 */
export function overlayPaletteSection(rgb555: readonly number[]): Uint8Array {
  if (rgb555.length !== 512) throw new Error(`an overlay palette has 512 colours, not ${rgb555.length}`);
  const out = new Uint8Array(1024);
  const view = new DataView(out.buffer);
  rgb555.forEach((colour, i) => {
    if (colour < 0 || colour > 0x7fff) throw new Error(`overlay palette colour ${i} is not RGB555: ${colour}`);
    view.setUint16(2 * i, colour, true);
  });
  return out;
}

/** `ReadWallDecoration`'s smallest section (`doc/CSBwin-src/CSBCode.cpp:3129-3143`). */
const WALL_DECORATION_MIN_SIZE = 92;

/**
 * A `CGT_WallDecoration` section, as `DrawWallDecoration` reads one
 * (`doc/CSBwin-src/CSBCode.cpp:3204-3270`): the 13 `DECORATION_DESC`s, one for each
 * place the cell programs draw a wall decoration at (`x1`, `x2`, `y1`, `y2`, the width in
 * bytes, the height, `Data.h:217-222`), two bytes it steps over (0 in Conflux's), the
 * side view then the front view. Entries 11 and 12 also give the sizes of the side
 * and the front bitmaps: positions whose `% 5` is 0 or 1 draw the side one, the others
 * the front one.
 *
 * The bitmaps are Atari bitplanes, as `decodePlanar` reads them: a width a multiple of
 * 16, as all of Conflux's are, and colours 0-15. CSBWin returns no decoration for a
 * section under 92 bytes, so one is refused here.
 */
export function wallDecorationSection(desc: readonly DecorationDesc[], side: IndexedBitmap, front: IndexedBitmap): Uint8Array {
  if (desc.length !== 13) throw new Error(`a wall decoration has 13 placements, not ${desc.length}`);
  for (const [i, bitmap] of [[11, side], [12, front]] as const) {
    if (desc[i]!.widthBytes * 2 !== bitmap.width || desc[i]!.height !== bitmap.height) {
      throw new Error(`wall decoration placement ${i} is ${desc[i]!.widthBytes * 2}x${desc[i]!.height}, its bitmap ${bitmap.width}x${bitmap.height}`);
    }
  }
  const sideBytes = encodePlanar(side);
  const frontBytes = encodePlanar(front);
  const bitmapsAt = 13 * 6 + 2;
  const out = new Uint8Array(bitmapsAt + sideBytes.length + frontBytes.length);
  desc.forEach((d, i) => {
    const fields = [d.x1, d.x2, d.y1, d.y2, d.widthBytes, d.height];
    fields.forEach((value, f) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`wall decoration placement ${i} has a field of ${value}`);
      out[i * 6 + f] = value;
    });
  });
  out.set(sideBytes, bitmapsAt);
  out.set(frontBytes, bitmapsAt + sideBytes.length);
  if (out.length < WALL_DECORATION_MIN_SIZE) {
    throw new Error(`a wall decoration section is at least ${WALL_DECORATION_MIN_SIZE} bytes, this one ${out.length}`);
  }
  return out;
}

/** `decodePlanar`'s inverse, for a bitmap a multiple of 16 wide. */
export function encodePlanar(bitmap: IndexedBitmap): Uint8Array {
  const { width, height, pixels } = bitmap;
  if (width % 16 !== 0) throw new Error(`a bitplane bitmap is a multiple of 16 wide, not ${width}`);
  const groups = width / 16;
  const out = new Uint8Array(groups * 8 * height);
  for (let y = 0; y < height; y++) {
    for (let group = 0; group < groups; group++) {
      const at = (y * groups + group) * 8;
      for (let plane = 0; plane < 4; plane++) {
        let word = 0;
        for (let bit = 0; bit < 16; bit++) {
          const colour = pixels[y * width + group * 16 + bit]!;
          if (colour > 15) throw new Error(`a bitplane bitmap has colours 0-15, not ${colour}`);
          word |= ((colour >> plane) & 1) << (15 - bit);
        }
        out[at + plane * 2] = word >> 8;
        out[at + plane * 2 + 1] = word & 0xff;
      }
    }
  }
  return out;
}
