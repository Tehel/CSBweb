/**
 * A `graphics.dat`'s items as stored: the count, the two size tables and each item's
 * bytes, read and written whole (`doc/CSBwin-src/Graphics.cpp:1944-2010`, `ReadGraphicsIndex`).
 * An item whose two sizes are equal is stored as is, and one whose sizes differ is
 * compressed (`Graphics.cpp:2648-2651`).
 *
 * Usage:
 *
 *   import { readItems, writeItems, expand } from './lib/graphicsDat';
 *   const items = readItems(bytes);
 *   expand(items, 5)              // item 5, decompressed
 */
import { decompressGraphics } from '../../src/core/compression';

export interface Items { count: number; compressed: number[]; decompressed: number[]; data: Uint8Array[] }

export function readItems(bytes: Uint8Array): Items {
  const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  const count = u16(0);
  const compressed = Array.from({ length: count }, (_, i) => u16(2 + 2 * i));
  const decompressed = Array.from({ length: count }, (_, i) => u16(2 + 2 * count + 2 * i));
  const data: Uint8Array[] = [];
  let at = 2 + 4 * count;
  for (const size of compressed) { data.push(bytes.subarray(at, at + size)); at += size; }
  if (at !== bytes.length) throw new Error(`graphics.dat: items end at ${at}, the file at ${bytes.length}`);
  return { count, compressed, decompressed, data };
}

/** The file of `items`, each item's compressed size its bytes' length. */
export function writeItems(items: Items): Uint8Array {
  const total = 2 + 4 * items.count + items.data.reduce((n, d) => n + d.length, 0);
  const out = new Uint8Array(total);
  const put16 = (o: number, v: number) => { out[o] = v >> 8; out[o + 1] = v & 0xff; };
  put16(0, items.count);
  items.data.forEach((d, i) => { put16(2 + 2 * i, d.length); put16(2 + 2 * items.count + 2 * i, items.decompressed[i]); });
  let at = 2 + 4 * items.count;
  for (const d of items.data) { out.set(d, at); at += d.length; }
  return out;
}

/** Item `i`, decompressed. */
export const expand = (items: Items, i: number): Uint8Array =>
  decompressGraphics(items.data[i], items.compressed[i], items.decompressed[i]);
