// `tsc --noEmit --noUncheckedIndexedAccess`, held to the modules listed below: `npm test`
// runs it beside the plain `tsc`.
//
// With the flag, an index reads as possibly `undefined`, so each `x[i]!` that is left is
// an index the code has proved and says so; without it, a `!` asserts nothing. The whole
// tree raises too many errors to turn it on at once, so the modules where data comes from
// files are held to it one by one (DEBT.md E36). tsc checks every file the listed ones
// import as well, so its errors elsewhere are left out here, not fixed.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = resolve(ROOT, 'node_modules/.bin/tsc');

/** The paths held to the flag: a folder ends in `/`. */
const MODULES = [
  'src/lib/',
  'src/renderer/',
  'src/settings/',
  'src/stats/',
];

const r = spawnSync(TSC, ['--noEmit', '--noUncheckedIndexedAccess', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8' });
const out = (r.stdout ?? '') + (r.stderr ?? '');
// An error's first line names its file; the lines indented under it belong to it.
const errors = [];
for (const line of out.split('\n')) {
  if (/^\S.*\(\d+,\d+\): error TS\d+/.test(line)) errors.push([line]);
  else if (line.startsWith(' ') && errors.length) errors.at(-1).push(line);
}
if (r.status !== 0 && errors.length === 0) {
  console.log(out || `tsc exited with ${r.status ?? r.error}`);
  process.exit(1);
}
const held = errors.filter(([first]) => MODULES.some((m) => (m.endsWith('/') ? first.startsWith(m) : first.startsWith(`${m}(`))));
for (const lines of held) console.log(lines.join('\n'));
console.log(`${held.length} errors in ${MODULES.join(', ')} under noUncheckedIndexedAccess (${errors.length - held.length} elsewhere, not held)`);
process.exit(held.length === 0 ? 0 : 1);
