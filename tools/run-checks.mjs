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
  { tool: 'dump-object-index.ts' },
  { tool: 'dump-monster-tables.ts' },
  { tool: 'dump-monster-activation.ts', args: ['3'] },
  { tool: 'dump-monster-perception.ts' },
  { tool: 'dump-monster-damage.ts' },
  { tool: 'dump-monster-move.ts' },
  { tool: 'dump-monster-pad.ts' },
  { tool: 'dump-monster-move-code.ts' },
  { tool: 'dump-monster-generator.ts' },
  { tool: 'dump-monster-ai.ts' },
  { tool: 'dump-giggler-steal.ts' },
  { tool: 'dump-add-object-to-room.ts' },
  { tool: 'dump-attributes.ts' },
  { tool: 'dump-adjust-skills.ts' },
  { tool: 'dump-hand-owner.ts' },
  { tool: 'dump-marching-order.ts' },
  { tool: 'dump-inventory-routing.ts' },
  { tool: 'dump-key-bindings.ts' },
  { tool: 'dump-attack-panel.ts' },
  { tool: 'dump-magic-panel.ts' },
  { tool: 'dump-champion-state.ts' },
  { tool: 'dump-champion-death.ts' },
  { tool: 'dump-show-credits.ts' },
  { tool: 'dump-loop-script.ts' },
  { tool: 'dump-new-game.ts' },
  { tool: 'dump-item-bonuses.ts' },
  { tool: 'dump-feeding.ts' },
  { tool: 'dump-ten-second-update.ts' },
  { tool: 'dump-sleep.ts' },
  { tool: 'dump-freeze.ts' },
  { tool: 'dump-messages.ts' },
  { tool: 'dump-room-text.ts' },
  { tool: 'dump-ninety-second-update.ts' },
  { tool: 'dump-hall-of-champions.ts' },
  { tool: 'dump-vi-altar.ts' },
  { tool: 'dump-viewport-click.ts' },
  { tool: 'dump-queue-sound.ts' },
  { tool: 'dump-crack-switch.ts' },
  { tool: 'dump-door-ornaments.ts' },
  { tool: 'dump-status-boxes.ts' },
  { tool: 'dump-mastery-panel.ts' },
  { tool: 'dump-reincarnate-entry.ts' },
  { tool: 'dump-pit-fall.ts' },
  { tool: 'dump-teleporter-drop.ts' },
  { tool: 'dump-wiggle-cloud.ts' },
  { tool: 'dump-wiggle-objects.ts' },
  { tool: 'dump-wiggle-monster.ts' },
  { tool: 'dump-missile-drop.ts' },
  { tool: 'dump-drop-move-object.ts' },
  { tool: 'dump-stairs-move.ts' },
  { tool: 'dump-local-action.ts' },
  { tool: 'dump-does-party-have.ts' },
  { tool: 'dump-dsa-move.ts' },
  { tool: 'dump-dsa-delete.ts' },
  { tool: 'dump-db-reuse.ts' },
  { tool: 'watch-smart-discard.ts' },
  { tool: 'dump-make-more-room.ts' },
  { tool: 'dump-missile-monster.ts' },
  { tool: 'dump-missile-door.ts' },
  { tool: 'dump-move-from-missile.ts' },
  { tool: 'dump-missile-teleport.ts' },
  { tool: 'dump-missile-exterior.ts' },
  { tool: 'dump-party-move.ts' },
  { tool: 'dump-last-monster-attack.ts' },
  { tool: 'dump-monster-missile-type.ts' },
  { tool: 'dump-cast-spell.ts' },
  { tool: 'dump-magic-footprints.ts' },
  { tool: 'dump-footprint-decoration.ts' },
  { tool: 'dump-timer-dedupe.ts' },
  { tool: 'dump-timer-sequence.ts' },
  { tool: 'dump-timer-heap.ts' },
  { tool: 'dump-throwing.ts' },
  { tool: 'dump-clouds.ts' },
  { tool: 'dump-player-attacks.ts' },
  { tool: 'dump-fusion.ts' },
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
  // Chaos Strikes Back's Atari-era saves, with no Extended Features block: loaded,
  // walked and run in a Game on CSB's graphics.dat.
  { tool: 'dump-atari-saves.ts' },
  // Block 4 packed and held up against the real thing: every committed save's
  // character block, written again from the champions it yields, byte for byte.
  { tool: 'dump-character-block.ts' },
  // Every block the writer emits, held up against the bytes CSBWin wrote — the same
  // argument as above, widened from block 4 to blocks 2, 3, 5 and 6, which were marked
  // complete and had never been compared with a real file.
  { tool: 'dump-save-blocks-vs-file.ts' },
  // The same for the whole dungeon image — blocks 7 to 15 — against both dungeon.dat and
  // every committed save. Six of the eight sections are byte-identical; blocks 10 and 13
  // are full of RNs, whose slot numbering is ours, so their non-RN bytes are compared and
  // their RNs resolved. It found thirteen fields the loader was dropping and the whole of
  // EXPOOL, which had no parser at all.
  { tool: 'dump-dungeon-image-blocks.ts' },
  // The three conversions `ReadDatabases` runs over an original dungeon, measured
  // against a dungeon CSBWin converted itself: every committed save was made from this
  // same dungeon.dat, so its converted form is sitting in fourteen files. Without them a
  // game started from dungeon.dat holds a world no save file can express.
  { tool: 'dump-dungeon-conversions.ts' },
  // The other half of that argument: a genuine save re-serialised in full — all sixteen
  // blocks, image and closing checksum — and read back by this port's own reader. It is
  // what covers the words the block-by-block comparisons have to hold out, by showing
  // they still name the right objects after a whole trip through the file format.
  { tool: 'dump-save-file-roundtrip.ts' },
  // And the live half of that: a running game — played from dungeon.dat, and played on
  // from a genuine save — writes all sixteen blocks through `buildSavePayload`, and the
  // file loads back into a fresh game with the world, the party, the thrown object in
  // flight and the object on the cursor intact.
  { tool: 'dump-live-save-file.ts' },
  // The portraits of a party read out of a CSBWin save, drawn into a real screen
  // buffer: CHARDESC carries the picture rather than a graphic-26 index, so the frames
  // (which only ever see an injected party) cover the other path entirely.
  { tool: 'dump-portraits.ts' },
  { tool: 'dump-csbwin-timers.ts' },
  // Our *own* save file, the JSON payload F5/F9 and both stores of the disk menu write.
  // Nothing exercised `buildSavePayload`/`applySavePayload` before: `dump-savegame.ts`
  // drives the runtime snapshot directly and the `dump-csbwin-*` tools drive the reader,
  // so the layer in between had no evidence behind it — which is how a timer-table leak
  // of two slots per save/load cycle went unnoticed.
  { tool: 'dump-save-roundtrip.ts' },
  // The save/load screen: the button-table offsets it hangs off, the list panel built
  // out of graphic 0, the row formatting, and the two metadata paths. Nothing here is
  // visible to the golden frames until there are saves to list.
  { tool: 'dump-save-menu.ts' },
  // The title animation and the dungeon entrance. The golden frames can see the entrance
  // once it is up; the nine 0x232 rectangles it hangs off, the hardcoded button list DM's
  // graphics.dat forces, the synthetic 5x5 level behind the doors, the 31-frame slide and
  // ShrinkBLT's fixed point are all invisible to them.
  { tool: 'dump-intro.ts' },
  // `ExpandGraphic`, the codec every picture in the game goes through, against a real
  // CSBWin screen capture plus a hand-built stream per opcode. Three opcodes were wrong
  // and only one image in the data used them, so nothing else could have caught it.
  { tool: 'dump-image-codec.ts' },
  { tool: 'dump-graphic-random.ts' },
  { tool: 'dump-door-lightning.ts' },
  { tool: 'dump-cloud-draw.ts' },
  { tool: 'dump-render-probe.ts' },
  // Level 2 has an Ant Man with a free open neighbour to be bumped into.
  { tool: 'dump-button-flash.ts' },
  { tool: 'dump-mouse-queue.ts' },
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
