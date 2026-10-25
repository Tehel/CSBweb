// `tsc --noEmit --noUncheckedIndexedAccess`, held to `src/`: `npm test` runs it beside the
// plain `tsc`, which checks the tools and the server too, without the flag.
//
// With the flag, an index reads as possibly `undefined`, so each `x[i]!` in `src/` is an
// index the code has proved, and says so. Where a damaged or short file can send a read
// past its end, the read says what it gets instead, 0, as `src/core/bytes.ts`'s do; a
// table of a fixed length is a `Tuple` (`src/core/types.ts`) once its reader has checked
// the length, and a constant index into it needs no `!`.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = resolve(ROOT, 'node_modules/.bin/tsc');

/** The paths held to the flag: a folder ends in `/`. */
const MODULES = ['src/'];

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
