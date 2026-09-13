// The project's check suite: `npm test`.
//
// There is still no test *framework* (PLAN.md Phase 15) — this is a runner over the
// evidence the project already had, which until now could only be produced by
// remembering nine filenames and running them one at a time. It runs the three gates
// CLAUDE.md calls non-negotiable:
//
//   1. `tsc --noEmit`            — the real build gate; `vite build` proves nothing.
//   2. every asserting tools/*.ts — the regression suite for what the frames cannot see.
//   3. `tools/check-frames.sh`   — the golden frames, only with `--frames` (it needs a
//                                  dev server and a headless Chrome, which the script
//                                  now starts for itself).
//
// Usage:
//   npm test                # gates 1 and 2   (~10s)
//   npm test -- --frames    # all three       (adds ~20s and needs google-chrome)
//   npm test -- --only=ai   # just the tools whose name contains "ai"
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');
const TSC = resolve(ROOT, 'node_modules/.bin/tsc');

// Tools that assert. `args` pins the scenario the assertions were written for — several
// tools take a level, and the wrong level activates no monsters and checks nothing.
const CHECKS = [
  { tool: 'dump-object-name-index.ts' },
  { tool: 'dump-monster-tables.ts' },
  { tool: 'dump-monster-activation.ts', args: ['3'] },
  { tool: 'dump-monster-perception.ts' },
  { tool: 'dump-monster-damage.ts' },
  { tool: 'dump-monster-move.ts' },
  { tool: 'dump-monster-ai.ts' },
  { tool: 'dump-attributes.ts' },
  { tool: 'dump-hand-owner.ts' },
  { tool: 'dump-inventory-routing.ts' },
  { tool: 'dump-key-bindings.ts' },
  { tool: 'dump-champion-state.ts' },
  { tool: 'dump-champion-death.ts' },
  { tool: 'dump-feeding.ts' },
  { tool: 'dump-hall-of-champions.ts' },
  { tool: 'dump-vi-altar.ts' },
  { tool: 'dump-status-boxes.ts' },
  { tool: 'dump-mastery-panel.ts' },
  { tool: 'dump-reincarnate-entry.ts' },
  { tool: 'dump-pit-fall.ts' },
  { tool: 'dump-throwing.ts' },
  { tool: 'dump-clouds.ts' },
  { tool: 'dump-player-attacks.ts' },
  // Level 1 is the argument the assertions were written for: it has a closed door,
  // a movable object with an open neighbour, and creatures.
  { tool: 'dump-savegame.ts', args: ['1'] },
  // The other half of a quick-save: the CSBWin-shaped binary blocks. Needs no
  // dungeon and no arguments — it builds its own records.
  { tool: 'dump-savegame-blocks.ts' },
  // Genuine CSBWin save files from static/gamefiles/saves. The only check in the
  // suite that reads bytes this project did not write, so the only one a bug
  // symmetrical between our reader and our writer cannot satisfy.
  { tool: 'dump-csbwin-save.ts' },
  // The world inside those saves: the dungeon image parsed into a real DungeonData and
  // held up against dungeon.dat. The early saves must still *be* dungeon.dat's world.
  { tool: 'dump-csbwin-world.ts' },
  // The champions inside those saves: the whole CHARDESC, not just the name.
  { tool: 'dump-csbwin-party.ts' },
  { tool: 'dump-csbwin-load.ts' },
  // Block 4 packed and held up against the real thing: every committed save's
  // character block, written again from the champions it yields, byte for byte.
  { tool: 'dump-character-block.ts' },
  // The portraits of a party read out of a CSBWin save, drawn into a real screen
  // buffer: CHARDESC carries the picture rather than a graphic-26 index, so the frames
  // (which only ever see an injected party) cover the other path entirely.
  { tool: 'dump-portraits.ts' },
  { tool: 'dump-csbwin-timers.ts' },
  // The save/load screen: the button-table offsets it hangs off, the list panel built
  // out of graphic 0, the row formatting, and the two metadata paths. Nothing here is
  // visible to the golden frames until there are saves to list.
  { tool: 'dump-save-menu.ts' },
  // Level 2 has an Ant Man with a free open neighbour to be bumped into.
  { tool: 'dump-party-collision.ts', args: ['2'] },
  // Level 2's door at (0,25) is up-down, which is the mode that exercises VerticalSize.
  { tool: 'dump-door-crush.ts', args: ['2'] },
  { tool: 'watch-monsters.ts' },
  { tool: 'watch-monster-attacks.ts' },
];

// Tools with no assertions: they exist to be read, not to pass. They are still run,
// because a loader or table change that throws should not wait to be noticed by hand.
// Only a crash fails them. `extract-graphics.ts` is left out — it writes to static/.
const SMOKE = [
  { tool: 'dump-defined-items.ts' },
  { tool: 'dump-level-items.ts' },
  { tool: 'dump-object-definitions.ts' },
  { tool: 'dump-preset-heroes.ts' },
];

const argv = process.argv.slice(2);
const withFrames = argv.includes('--frames');
const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const results = [];
let failed = 0;

function run(name, cmd, args, opts = {}) {
  process.stdout.write(`  ${name.padEnd(34)}`);
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  const ms = Date.now() - started;
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const ok = r.status === 0 && !r.error;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(ms).padStart(6)} ms`);
  results.push({ name, ok, out, ms });
  if (!ok) failed++;
  return ok;
}

if (!existsSync(TSX)) {
  console.error('node_modules/.bin/tsx is missing — run `npm install` first.');
  process.exit(1);
}

console.log('\ntypes');
run('tsc --noEmit', TSC, ['--noEmit']);

console.log('\nchecks');
for (const { tool, args = [] } of CHECKS) {
  if (only && !tool.includes(only)) continue;
  run(tool, TSX, [resolve(ROOT, 'tools', tool), ...args]);
}

console.log('\nsmoke (crash only)');
for (const { tool, args = [] } of SMOKE) {
  if (only && !tool.includes(only)) continue;
  run(tool, TSX, [resolve(ROOT, 'tools', tool), ...args]);
}

if (withFrames) {
  console.log('\nframes');
  run('check-frames.sh', 'bash', [resolve(ROOT, 'tools/check-frames.sh')]);
} else {
  console.log('\nframes                                skipped (pass --frames)');
}

// Failures print their whole output: these tools are meant to be read, and the table
// above the failed assertion is usually what tells you which way the port went wrong.
for (const r of results.filter((x) => !x.ok)) {
  console.log(`\n${'='.repeat(72)}\nFAILED: ${r.name}\n${'='.repeat(72)}`);
  console.log(r.out.trimEnd());
}

const total = results.reduce((a, r) => a + r.ms, 0);
console.log(`\n${results.length - failed}/${results.length} passed in ${(total / 1000).toFixed(1)}s`);
process.exit(failed === 0 ? 0 : 1);
