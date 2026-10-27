// Compare a freshly captured set of golden frames against the committed baseline.
//
//   node tools/compare-frames.ts tools/frames /tmp/now
//
// It decodes both sides and compares what each pixel showed, never bytes: the palette and
// the slot it was drawn in and the Atari word there, or the overlay's colour
// (`tools/lib/frames.ts`). A byte compare of two PNGs would be a test of the encoder that
// wrote them, and a compare of colours would let a slot pass for another of the same colour.
//
// When a frame does differ it prints the damage in a form you can act on: how many pixels,
// how many of them only by the word their palette holds, the bounding box, and the first
// offending pixel both ways. The bounding box is usually enough to name the culprit, since
// the screen is a fixed CSBWin layout — the viewport is x 0-223 y 33-168, the party panel
// is the top 28 rows, the message area sits below y 169.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFrame, type DecodedFrame } from './lib/frames.ts';

const [baseDir, curDir] = process.argv.slice(2);
if (!baseDir || !curDir) {
  console.error('usage: node tools/compare-frames.ts <baseline-dir> <current-dir>');
  process.exit(2);
}

const names = readdirSync(baseDir).filter(n => n.endsWith('.png')).sort();
if (names.length === 0) {
  console.error(`no .png baseline frames in ${baseDir}`);
  process.exit(2);
}

let failed = 0;

for (const name of names) {
  const basePath = join(baseDir, name);
  const curPath = join(curDir, name);
  if (!existsSync(curPath)) {
    console.log(`  MISSING  ${name}  (the probe wrote no such frame)`);
    failed++;
    continue;
  }

  let a: DecodedFrame, b: DecodedFrame;
  try {
    a = decodeFrame(basePath);
    b = decodeFrame(curPath);
  } catch (e) {
    console.log(`  UNREADABLE  ${name}  ${(e as Error).message}`);
    failed++;
    continue;
  }

  if (a.width !== b.width || a.height !== b.height) {
    console.log(`  DIFF  ${name}  baseline is ${a.width}x${a.height}, capture is ${b.width}x${b.height}`);
    console.log(`        a size change is not a rendering difference — regenerate with --update`);
    failed++;
    continue;
  }

  let differing = 0, wordOnly = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  let first: { x: number; y: number; base: string; cur: string } | null = null;
  for (let n = 0; n < a.width * a.height; n++) {
    const va = a.values[n], vb = b.values[n];
    if (va === vb) continue;
    differing++;
    // The same palette and slot, another word in it: the palette moved, not the drawing.
    if (Math.floor(va / 2 ** 16) === Math.floor(vb / 2 ** 16)) wordOnly++;
    const x = n % a.width, y = (n / a.width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (!first) first = { x, y, base: a.describe(n), cur: b.describe(n) };
  }

  if (differing === 0) {
    console.log(`  same  ${name}`);
    continue;
  }
  failed++;
  const total = a.width * a.height;
  console.log(`  DIFF  ${name}  ${differing}/${total} px (${(100 * differing / total).toFixed(2)}%)  ${curPath}`);
  console.log(`        drawn in another slot ${differing - wordOnly}, the same slot holding another word ${wordOnly}`);
  console.log(`        bounding box x ${minX}-${maxX}  y ${minY}-${maxY}`);
  const { x, y, base, cur } = first!;
  console.log(`        first at x=${x} y=${y}: baseline ${base} -> capture ${cur}`);
}

console.log(failed === 0
  ? `all ${names.length} frames match`
  : `${failed} of ${names.length} frames differ`);

// Two identical frames mean one of them is dead weight: it captures a state the other
// already captured, so no change to the app can ever make it fail on its own. That is how
// `04-inventory-sel` sat for months — it clicked the party block instead of an inventory
// slot, and was byte-identical to `03-inventory` the whole time. Checked against the
// baseline, not the capture, because it is a property of what we committed.
const loaded = new Map<string, DecodedFrame>();
for (const name of names) {
  try { loaded.set(name, decodeFrame(join(baseDir, name))); } catch { /* already reported */ }
}
let twins = 0;
const entries = [...loaded.entries()];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const [na, a] = entries[i], [nb, b] = entries[j];
    if (a.width !== b.width || a.height !== b.height) continue;
    if (!a.values.every((v, k) => v === b.values[k])) continue;
    console.log(`  IDENTICAL  ${na} and ${nb} are the same frame — one of them tests nothing`);
    twins++;
  }
}

process.exit(failed === 0 && twins === 0 ? 0 : 1);
