/**
 * A graphic as the Atari keeps one in memory, and CSBWin with it: each line in groups of
 * 16 pixels, each group four big-endian words, one per bitplane, plane 0 carrying bit 0
 * of the colour, the first pixel the high bit. A read past the end yields 0.
 */

/** The `count` pixels of the group at `at` of `data`, into `out` from `outAt`. */
export function decodePlanarGroup(
  data: ArrayLike<number>, at: number, out: { [i: number]: number }, outAt: number, count = 16,
): void {
  for (let bit = 0; bit < count; bit++) {
    let colour = 0;
    for (let plane = 0; plane < 4; plane++) {
      const word = ((data[at + plane * 2] ?? 0) << 8) | (data[at + plane * 2 + 1] ?? 0);
      colour |= ((word >> (15 - bit)) & 1) << plane;
    }
    out[outAt + bit] = colour;
  }
}

/** The 16 pixels of `pixels` from `pixelAt`, as the group at `at` of `out`. */
export function encodePlanarGroup(pixels: ArrayLike<number>, pixelAt: number, out: Uint8Array, at: number): void {
  for (let plane = 0; plane < 4; plane++) {
    let word = 0;
    for (let bit = 0; bit < 16; bit++) {
      word |= (((pixels[pixelAt + bit] ?? 0) >> plane) & 1) << (15 - bit);
    }
    out[at + plane * 2] = word >> 8;
    out[at + plane * 2 + 1] = word & 0xff;
  }
}

/** A `width` by `height` graphic, a palette index a pixel. */
export function decodePlanar(data: ArrayLike<number>, width: number, height: number): Uint8Array {
  const groups = (width + 15) >> 4;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let group = 0; group < groups; group++) {
      decodePlanarGroup(data, (y * groups + group) * 8, out, y * width + group * 16, Math.min(16, width - group * 16));
    }
  }
  return out;
}
