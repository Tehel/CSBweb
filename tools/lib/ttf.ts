/**
 * A minimal TrueType writer, for a bitmap font made an outline font: each glyph a set of
 * rectangles on a pixel grid, one contour each, so a browser draws it as text.
 *
 * Enough of the format for a browser's font sanitizer: the ten required tables (`OS/2`,
 * `cmap` with one format-4 subtable, `glyf`, `head`, `hhea`, `hmtx`, `loca` in its long
 * form, `maxp`, `name`, `post` version 3), no hinting, no kerning. The file is a function
 * of its input alone: the dates in `head` are zero.
 */

/** A lit rectangle of a glyph, in font units, `x0 < x1` and `y0 < y1`, y up from the baseline. */
export interface TtfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TtfGlyph {
  advance: number;
  rects: readonly TtfRect[];
}

export interface TtfFont {
  /** The `name` table's family, and with the spaces dropped its PostScript name. */
  family: string;
  /** The `name` table's copyright line: where the glyphs come from. */
  source: string;
  unitsPerEm: number;
  ascent: number;
  /** Below the baseline, positive. */
  descent: number;
  /** The height of a capital, for `OS/2`. */
  capHeight: number;
  /** Glyph 0 is `.notdef`. */
  glyphs: readonly TtfGlyph[];
  /** Unicode code point → glyph index. Every code point is in the BMP. */
  cmap: ReadonlyMap<number, number>;
}

class Out {
  private bytes: number[] = [];
  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { return this.u8(v >> 8).u8(v); }
  i16(v: number): this { return this.u16(v & 0xffff); }
  u32(v: number): this { return this.u16(v >>> 16).u16(v & 0xffff); }
  zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
  tag(s: string): this { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  append(b: Uint8Array): this { for (const v of b) this.u8(v); return this; }
  pad4(): this { while (this.bytes.length % 4 !== 0) this.u8(0); return this; }
  get length(): number { return this.bytes.length; }
  done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) {
    sum = (sum + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  }
  return sum;
}

interface Box { xMin: number; yMin: number; xMax: number; yMax: number }

function boxOf(rects: readonly TtfRect[]): Box {
  return {
    xMin: Math.min(...rects.map((r) => r.x0)), yMin: Math.min(...rects.map((r) => r.y0)),
    xMax: Math.max(...rects.map((r) => r.x1)), yMax: Math.max(...rects.map((r) => r.y1)),
  };
}

/** A glyph's `glyf` record: a clockwise contour of four on-curve points per rectangle. */
function glyfRecord(glyph: TtfGlyph): Uint8Array {
  if (glyph.rects.length === 0) return new Uint8Array(0);
  const box = boxOf(glyph.rects);
  const out = new Out().i16(glyph.rects.length).i16(box.xMin).i16(box.yMin).i16(box.xMax).i16(box.yMax);
  glyph.rects.forEach((_, i) => out.u16(i * 4 + 3));
  out.u16(0);
  const points = glyph.rects.flatMap((r) => [[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0]] as const);
  for (let i = 0; i < points.length; i++) out.u8(0x01);
  let x = 0, y = 0;
  for (const [px] of points) { out.i16(px - x); x = px; }
  for (const [, py] of points) { out.i16(py - y); y = py; }
  return out.pad4().done();
}

/** A format-4 subtable: a segment for each run of code points whose glyphs run alongside them. */
function cmapTable(cmap: ReadonlyMap<number, number>): Uint8Array {
  const codes = [...cmap.keys()].sort((a, b) => a - b);
  const segments: { start: number; end: number; delta: number }[] = [];
  for (const code of codes) {
    if (code > 0xfffe) throw new Error(`code point ${code.toString(16)} is beyond a format-4 cmap`);
    const delta = cmap.get(code)! - code;
    const last = segments[segments.length - 1];
    if (last && last.end === code - 1 && last.delta === delta) last.end = code;
    else segments.push({ start: code, end: code, delta });
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segments.length;
  let power = 1, log = 0;
  while (power * 2 <= n) { power *= 2; log++; }
  const sub = new Out().u16(4).u16(16 + n * 8).u16(0)
    .u16(n * 2).u16(power * 2).u16(log).u16(n * 2 - power * 2);
  for (const s of segments) sub.u16(s.end);
  sub.u16(0);
  for (const s of segments) sub.u16(s.start);
  for (const s of segments) sub.i16(s.delta);
  for (let i = 0; i < n; i++) sub.u16(0);
  return new Out().u16(0).u16(1).u16(3).u16(1).u32(12).append(sub.done()).done();
}

function nameTable(font: TtfFont): Uint8Array {
  const postScript = font.family.replace(/ /g, '');
  const names: [number, string][] = [
    [0, font.source], [1, font.family], [2, 'Regular'], [3, postScript],
    [4, font.family], [5, 'Version 1.0'], [6, postScript],
  ];
  const strings = names.map(([, text]) => {
    const s = new Out();
    for (const c of text) s.u16(c.charCodeAt(0));
    return s.done();
  });
  const out = new Out().u16(0).u16(names.length).u16(6 + names.length * 12);
  let offset = 0;
  names.forEach(([id], i) => {
    out.u16(3).u16(1).u16(0x409).u16(id).u16(strings[i]!.length).u16(offset);
    offset += strings[i]!.length;
  });
  for (const s of strings) out.append(s);
  return out.done();
}

/** `font` as a TrueType file. */
export function writeTtf(font: TtfFont): Uint8Array {
  const glyphs = font.glyphs;
  const drawn = glyphs.filter((g) => g.rects.length > 0);
  const all = boxOf(drawn.flatMap((g) => g.rects));
  const advanceMax = Math.max(...glyphs.map((g) => g.advance));
  const lsbs = drawn.map((g) => boxOf(g.rects).xMin);
  const rsbs = drawn.map((g) => g.advance - boxOf(g.rects).xMax);
  const codes = [...font.cmap.keys()];

  const glyf = new Out();
  const loca = new Out();
  for (const glyph of glyphs) {
    loca.u32(glyf.length);
    glyf.append(glyfRecord(glyph));
  }
  loca.u32(glyf.length);

  const head = new Out().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
    .u16(0x0003).u16(font.unitsPerEm).zeros(16)
    .i16(all.xMin).i16(all.yMin).i16(all.xMax).i16(all.yMax)
    .u16(0).u16(8).i16(2).i16(1).i16(0);

  const hhea = new Out().u32(0x00010000).i16(font.ascent).i16(-font.descent).i16(0)
    .u16(advanceMax).i16(Math.min(...lsbs)).i16(Math.min(...rsbs)).i16(all.xMax)
    .i16(1).i16(0).i16(0).zeros(8).i16(0).u16(glyphs.length);

  const hmtx = new Out();
  for (const glyph of glyphs) hmtx.u16(glyph.advance).i16(glyph.rects.length > 0 ? boxOf(glyph.rects).xMin : 0);

  const maxp = new Out().u32(0x00010000).u16(glyphs.length)
    .u16(Math.max(...glyphs.map((g) => g.rects.length * 4))).u16(Math.max(...glyphs.map((g) => g.rects.length)))
    .u16(0).u16(0).u16(2).zeros(16);

  const em = font.unitsPerEm;
  const os2 = new Out().u16(4).i16(advanceMax).u16(400).u16(5).u16(0)
    .i16(em / 2).i16(em / 2).i16(0).i16(em / 8)
    .i16(em / 2).i16(em / 2).i16(0).i16(em * 3 / 8)
    .i16(em / 8).i16(em / 4).i16(0)
    .zeros(10)
    .u32(0x3).u32(0).u32(0).u32(0)
    .tag('NONE').u16(0x00c0)
    .u16(Math.min(...codes)).u16(Math.max(...codes))
    .i16(font.ascent).i16(-font.descent).i16(0)
    .u16(font.ascent).u16(font.descent)
    .u32(1).u32(0)
    .i16(font.capHeight).i16(font.capHeight).u16(0).u16(0x20).u16(0);

  const post = new Out().u32(0x00030000).u32(0).i16(-em / 8).i16(em / 8).u32(1).zeros(16);

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.done()], ['cmap', cmapTable(font.cmap)], ['glyf', glyf.done()], ['head', head.done()],
    ['hhea', hhea.done()], ['hmtx', hmtx.done()], ['loca', loca.done()], ['maxp', maxp.done()],
    ['name', nameTable(font)], ['post', post.done()],
  ];
  const n = tables.length;
  let power = 1, log = 0;
  while (power * 2 <= n) { power *= 2; log++; }
  const file = new Out().u32(0x00010000).u16(n).u16(power * 16).u16(log).u16(n * 16 - power * 16);
  let offset = 12 + n * 16;
  for (const [tag, data] of tables) {
    file.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of tables) file.append(data).pad4();
  const bytes = file.done();

  // `head`'s checkSumAdjustment, at its offset 8: whatever makes the whole file sum to 0xB1B0AFBA.
  const headOffset = 12 + n * 16 + tables.slice(0, 3).reduce((sum, [, data]) => sum + Math.ceil(data.length / 4) * 4, 0);
  const adjustment = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adjustment);
  return bytes;
}
