// Compare a freshly captured set of golden frames against the committed baseline.
//
//   node tools/compare-frames.mjs tools/frames /tmp/now
//
// It decodes both PNGs and compares pixels, never bytes. That distinction is the whole
// point: a byte compare of two PNGs is a test of the encoder that wrote them, so the same
// rendering from a different Chrome — or a different Node — used to come out "DIFF" on
// every frame. Pixels are pixels anywhere.
//
// When a frame does differ it prints the damage in a form you can act on: how many pixels,
// whether the colour or only the alpha moved, the bounding box, and the first offending
// pixel with both values. The bounding box is usually enough to name the culprit, since the
// screen is a fixed CSBWin layout — the viewport is x 0-223 y 33-169, the party panel is the
// top 28 rows, the message area sits below y 169.
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { decodePng } from './lib/png.mjs';

const [baseDir, curDir] = process.argv.slice(2);
if (!baseDir || !curDir) {
  console.error('usage: node tools/compare-frames.mjs <baseline-dir> <current-dir>');
  process.exit(2);
}

const names = readdirSync(baseDir).filter(n => n.endsWith('.png')).sort();
if (names.length === 0) {
  console.error(`no .png baseline frames in ${baseDir}`);
  process.exit(2);
}

const hex = (v) => v.toString(16).padStart(2, '0');
let failed = 0;

for (const name of names) {
  const basePath = join(baseDir, name);
  const curPath = join(curDir, name);
  if (!existsSync(curPath)) {
    console.log(`  MISSING  ${name}  (the probe wrote no such frame)`);
    failed++;
    continue;
  }

  let a, b;
  try {
    a = decodePng(basePath);
    b = decodePng(curPath);
  } catch (e) {
    console.log(`  UNREADABLE  ${name}  ${e.message}`);
    failed++;
    continue;
  }

  if (a.width !== b.width || a.height !== b.height) {
    console.log(`  DIFF  ${name}  baseline is ${a.width}x${a.height}, capture is ${b.width}x${b.height}`);
    console.log(`        a size change is not a rendering difference — regenerate with --update`);
    failed++;
    continue;
  }

  let differing = 0, colourMoved = 0, alphaMoved = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  let first = null;
  for (let n = 0; n < a.width * a.height; n++) {
    const o = n * 4;
    const colour = a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2];
    const alpha = a.rgba[o + 3] !== b.rgba[o + 3];
    if (!colour && !alpha) continue;
    differing++;
    if (colour) colourMoved++;
    if (alpha) alphaMoved++;
    const x = n % a.width, y = (n / a.width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (!first) first = { x, y,
      base: [...a.rgba.subarray(o, o + 4)].map(hex).join(''),
      cur: [...b.rgba.subarray(o, o + 4)].map(hex).join('') };
  }

  if (differing === 0) {
    console.log(`  same  ${name}`);
    continue;
  }
  failed++;
  const total = a.width * a.height;
  console.log(`  DIFF  ${name}  ${differing}/${total} px (${(100 * differing / total).toFixed(2)}%)  ${curPath}`);
  console.log(`        colour ${colourMoved}, alpha ${alphaMoved}` +
              (colourMoved === 0 ? '  — ALPHA ONLY, the rendered colours are identical' : ''));
  console.log(`        bounding box x ${minX}-${maxX}  y ${minY}-${maxY}`);
  console.log(`        first at x=${first.x} y=${first.y}: baseline ${first.base} -> capture ${first.cur}  (rgba hex)`);
}

console.log(failed === 0
  ? `all ${names.length} frames match`
  : `${failed} of ${names.length} frames differ`);

// Two identical frames mean one of them is dead weight: it captures a state the other
// already captured, so no change to the app can ever make it fail on its own. That is how
// `04-inventory-sel` sat for months — it clicked the party block instead of an inventory
// slot, and was byte-identical to `03-inventory` the whole time. Checked against the
// baseline, not the capture, because it is a property of what we committed.
const loaded = new Map();
for (const name of names) {
  try { loaded.set(name, decodePng(join(baseDir, name))); } catch { /* already reported */ }
}
let twins = 0;
const entries = [...loaded.entries()];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const [na, a] = entries[i], [nb, b] = entries[j];
    if (a.width !== b.width || a.height !== b.height) continue;
    if (!a.rgba.every((v, k) => v === b.rgba[k])) continue;
    console.log(`  IDENTICAL  ${na} and ${nb} are the same image — one of them tests nothing`);
    twins++;
  }
}

process.exit(failed === 0 && twins === 0 ? 0 : 1);
