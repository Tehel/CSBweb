// The project's check suite: `npm test`.
//
// There is still no test *framework* (PLAN.md Phase 15) — this is a runner over the
// project's evidence. It runs the three gates CLAUDE.md calls non-negotiable:
//
//   1. `tsc --noEmit`            — the real build gate; `vite build` proves nothing.
//   2. every asserting tools/*.ts — the regression suite for what the frames cannot see.
//   3. `tools/check-frames.sh`   — the golden frames, only with `--frames` (it needs a
//                                  dev server and a headless Chrome, which the script
//                                  starts for itself).
//
// Gates 1 and 2 run in a pool of workers, one per core, and print in the lists' order.
// The frames run after them, alone: a browser beside the pool would time out its waits.
//
// Usage:
//   npm test                     # gates 1 and 2   (~75s on four cores)
//   npm test -- --frames         # all three       (adds ~40s and needs google-chrome)
//   npm test -- --only=ai        # just the tools whose name contains "ai" (and tsc)
//   npm test -- --only=dsa,save  # …or any of several
//   npm test -- --jobs=1         # one at a time; a tool's own time is then its own
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
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
  { tool: 'dump-monster-design-options.ts' },
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
  { tool: 'dump-object-cursor.ts' },
  { tool: 'dump-inventory-routing.ts' },
  { tool: 'dump-key-bindings.ts' },
  { tool: 'dump-settings.ts' },
  { tool: 'dump-attack-panel.ts' },
  { tool: 'dump-magic-panel.ts' },
  { tool: 'dump-champion-state.ts' },
  { tool: 'dump-champion-death.ts' },
  { tool: 'dump-character-damage.ts' },
  { tool: 'dump-show-credits.ts' },
  { tool: 'dump-loop-script.ts' },
  { tool: 'dump-new-game.ts' },
  { tool: 'dump-loop-die.ts' },
  { tool: 'dump-item-bonuses.ts' },
  { tool: 'dump-feeding.ts' },
  { tool: 'dump-ten-second-update.ts' },
  { tool: 'dump-sleep.ts' },
  { tool: 'dump-freeze.ts' },
  { tool: 'dump-messages.ts' },
  { tool: 'dump-vbl-clock.ts' },
  { tool: 'dump-room-text.ts' },
  { tool: 'dump-text-substitution.ts' },
  { tool: 'dump-open-room-text.ts' },
  { tool: 'dump-ninety-second-update.ts' },
  { tool: 'dump-light-level.ts' },
  { tool: 'dump-hall-of-champions.ts' },
  { tool: 'dump-dm-rules.ts' },
  { tool: 'dump-vi-altar.ts' },
  { tool: 'dump-wings.ts' },
  { tool: 'dump-swap-character.ts' },
  // EXPOOL, where a death's bones record is kept: the pools of the genuine saves rebuilt
  // byte for byte, and put through CSBWin's own save loop unchanged.
  { tool: 'dump-expool.ts' },
  { tool: 'dump-viewport-click.ts' },
  { tool: 'dump-fountain.ts' },
  { tool: 'dump-queue-sound.ts' },
  { tool: 'dump-crack-switch.ts' },
  { tool: 'dump-dm-atari-graphics.ts' },
  { tool: 'dump-zokathra-wall.ts' },
  { tool: 'dump-hidden-alcove.ts' },
  { tool: 'dump-door-ornaments.ts' },
  { tool: 'dump-status-boxes.ts' },
  { tool: 'dump-hand-boxes.ts' },
  { tool: 'dump-mastery-panel.ts' },
  { tool: 'watch-thrown-weapons.ts' },
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
  { tool: 'dump-dsa-census.ts' },
  { tool: 'dump-dsa-decoder.ts' },
  { tool: 'dump-dsa-characters.ts' },
  { tool: 'dump-dsa-objects.ts' },
  { tool: 'dump-dsa-parameters.ts' },
  { tool: 'dump-dsa-cell-fetch.ts' },
  { tool: 'dump-viewing-filter.ts' },
  { tool: 'dump-sound-filter.ts' },
  { tool: 'dump-action-name-filter.ts' },
  { tool: 'dump-feeding-filter.ts' },
  { tool: 'dump-char-damage-filter.ts' },
  { tool: 'dump-equip-filter.ts' },
  { tool: 'dump-party-move-filter.ts' },
  { tool: 'dump-monster-attack-filter.ts' },
  { tool: 'dump-delete-monster-filter.ts' },
  { tool: 'dump-monster-move-filter.ts' },
  { tool: 'dump-cursor-filter.ts' },
  { tool: 'dump-dsa-missiles.ts' },
  { tool: 'dump-dsa-monsters.ts' },
  { tool: 'dump-dsa-text.ts' },
  { tool: 'dump-dsa-message.ts' },
  { tool: 'dump-dsa-nofilter.ts' },
  { tool: 'dump-dsa-indirect.ts' },
  { tool: 'dump-dsa-dungeon.ts' },
  { tool: 'dump-dsa-save.ts' },
  { tool: 'dump-skins.ts' },
  { tool: 'dump-background-lib.ts' },
  { tool: 'dump-skin-programs.ts' },
  { tool: 'dump-custom-graphics.ts' },
  { tool: 'dump-extended-decorations.ts' },
  { tool: 'dump-virtual-graphics.ts' },
  { tool: 'watch-conflux-start.ts' },
  { tool: 'dump-dsa-overlay.ts' },
  { tool: 'dump-overlay-screen.ts' },
  { tool: 'dump-video-mode.ts' },
  { tool: 'dump-timer-modifier.ts' },
  { tool: 'dump-flip.ts' },
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
  { tool: 'dump-delete-duplicate-timers.ts' },
  { tool: 'dump-timer-sequence.ts' },
  { tool: 'dump-timer-heap.ts' },
  { tool: 'dump-throwing.ts' },
  { tool: 'dump-clouds.ts' },
  { tool: 'dump-player-attacks.ts' },
  { tool: 'dump-fusion.ts' },
  // Level 1 is the argument the assertions were written for: it has a closed door,
  // a movable object with an open neighbour, and creatures.
  { tool: 'dump-savegame.ts', args: ['1'] },
  // The save file's side of that: the CSBWin-shaped binary blocks. Needs no
  // dungeon and no arguments — it builds its own records.
  { tool: 'dump-savegame-blocks.ts' },
  // Genuine CSBWin save files from tools/fixtures. The only check in the
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
  // "MAKE NEW ADVENTURE": a saved game's party carried into mini.dat, field by field,
  // and csbgame2.dat, which CSBWin's utility wrote, made again byte for byte.
  { tool: 'dump-new-adventure.ts' },
  // RISE on CSB's entrance: the button carved from the entrance, the adventure stored
  // as a csb save, and the chooser over every set's saves that makes it.
  { tool: 'dump-rise.ts' },
  // Chaos Strikes Back's Hint Oracle data, hcsb.hct, decoded and its limits checked.
  { tool: 'dump-hint-oracle.ts' },
  // Its screen, run headlessly: the title list, a hint's pages, the cycle, no clues.
  { tool: 'dump-hint-oracle-screen.ts' },
  // Its button, the inventory's close box: the picture, the click on the party's square
  // after a step, a teleporter and a pit, the clock held, and the close box without it.
  { tool: 'dump-hint-oracle-button.ts' },
  // The hint key and the graphics signatures kept from a read and written back at a
  // save, and hcsb.hct read under the key.
  { tool: 'dump-hint-key.ts' },
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
  // Each level's cells where CSBWin reads them, `cellOffset` unwrapped past 64K: the object
  // list's column index against the flags in every data set, and Conflux's block 14.
  { tool: 'dump-cell-offsets.ts' },
  // The three conversions `ReadDatabases` runs over an original dungeon, measured
  // against a dungeon CSBWin converted itself: every committed save was made from this
  // same dungeon.dat, so its converted form is sitting in eight files. Without them a
  // game started from dungeon.dat holds a world no save file can express.
  { tool: 'dump-dungeon-conversions.ts' },
  // `ExtendPortraits`, run after the read: dungeon.dat's 24 mirrors cleaned and nothing
  // else moved, and every save that carries `ExpandedPortraits` left as written.
  { tool: 'dump-extend-portraits.ts' },
  // `CheckCelltypes` and `CheckMonsters`, the read's other two clean-ups: no change to
  // dungeon.dat, a save's attached size-4 groups given their slot's positions and facing
  // back by the restore, and every arm tripped on built records, through `new Game` too.
  { tool: 'dump-check-monsters.ts' },
  // A compressed dungeon.dat, CSB's prison: `ExpandData` proven byte for byte by the
  // image's own checksum word, and `Word22592` taken from the file for the new game.
  { tool: 'dump-compressed-dungeon.ts' },
  // `ReadDatabases`' checksum word, compared with the image's byte sum: a flipped byte
  // fails the prison, DM's dungeon.dat once a word follows it, and every committed save.
  { tool: 'dump-image-checksum.ts' },
  // And where such a failed read goes: the boot's chooser hands it to `tag01efee`, whose
  // menu after a lost game, and acknowledged line at the boot, only a left click on OK ends.
  { tool: 'dump-bad-saved-game.ts' },
  // The page's data sets: each loads, builds its own tables, and stands a Game up, and
  // CSB's long 0x231 carries CSBWin's four prison-door buttons (the canary).
  { tool: 'dump-data-sets.ts' },
  { tool: 'dump-build.ts' },
  // The deployed server: its start-up check, caching, preconditions, refused paths, the
  // statistics' API, and server.ts itself, run as Node runs it, stopped by SIGTERM.
  { tool: 'dump-server.ts' },
  // The statistics: what api/event accepts and rebuilds, the SQLite store, its aggregates.
  { tool: 'dump-stats.ts' },
  // The statistics' events the page sends: a new game's first tick, the Hall's joins by
  // name and charID, a won game's masteries, a lost game's square, all as the server takes them.
  { tool: 'dump-game-events.ts' },
  // A dungeon.dat behind an Extended Features block, the DM Windows package's: read in the
  // block's shape it is DM's dungeon converted, and a new game takes the block's rules.
  { tool: 'dump-extended-dungeon.ts' },
  // `ReadExtendedFeatures` without a plain sentinel: the "simple" encipherment's stream,
  // RC4.cpp's own, against the compiled C++ and Conflux's enciphered dungeon.dat. And a
  // block it gives up on (checksum, terminator, flag) is no block: the file is read from 0.
  { tool: 'dump-extended-features-read.ts' },
  // The other half of that argument: a genuine save re-serialised in full — all sixteen
  // blocks, image and closing checksum — and read back by this port's own reader. It is
  // what covers the words the block-by-block comparisons have to hold out, by showing
  // they still name the right objects after a whole trip through the file format.
  { tool: 'dump-save-file-roundtrip.ts' },
  // And the live half of that: a running game — played from dungeon.dat, and played on
  // from a genuine save — writes all sixteen blocks through `buildSaveFile`, and the
  // file loads back into a fresh game with the world, the party, the thrown object in
  // flight and the object on the cursor intact.
  { tool: 'dump-live-save-file.ts' },
  // The portraits of a party read out of a CSBWin save, drawn into a real screen
  // buffer: CHARDESC carries the picture rather than a graphic-26 index, so the frames
  // (which only ever see an injected party) cover the other path entirely.
  { tool: 'dump-portraits.ts' },
  // The sounds of CSBgraphics.dat a DSA's &SOUND plays: every section of both files read
  // as `ReadSound` does, each a WAV file once summed, and `Decode`'s volume table.
  { tool: 'dump-custom-sounds.ts' },
  // CSBgraphics.dat's alternate monster graphics: every section of both files read as an
  // ALTMONGRAPH, the dungeon's mapping of them by level and type, and the cache's slots.
  { tool: 'dump-alt-mon-graphics.ts' },
  // A group drawn from its alternate graphic: the section's bitplanes, its places and
  // views, the derived graphics kept for the rows further away, and CSBWin's die for a
  // mirrored front beside the party; and the default dungeon names none.
  { tool: 'dump-alt-mon-draw.ts' },
  // The graphics files' signatures, and CSBWin's checks of them at a read and at
  // CSBgraphics.dat's first section read: a file the game does not name ends the game.
  { tool: 'dump-file-signatures.ts' },
  { tool: 'dump-csbwin-timers.ts' },
  // Our *own* save, the CSBWin file F5, F9 and the disk menu write and read: saved and
  // loaded over genuine saves and over played games, with the whole of what a load
  // changes held to a named list. `dump-savegame.ts` drives the runtime snapshot directly
  // and the `dump-csbwin-*` tools the reader; this is the trip through both.
  { tool: 'dump-save-roundtrip.ts' },
  // The save/load screen: the button-table offsets it hangs off, the dialog built out
  // of graphic 0's pieces, the row formatting, and the two metadata paths. Nothing here is
  // visible to the golden frames until there are saves to list.
  { tool: 'dump-save-menu.ts' },
  { tool: 'dump-widgets.ts' },
  // The Sleepsave: a playthrough's slot apart from F5's, written when the party lies down
  // and when the player wakes it, never when a blow does; silent, and refused where F5 is.
  { tool: 'dump-sleep-save.ts' },
  // A playthrough stamped into a save file that names none: six bytes of GAMEBLOCK1, in a
  // block that is scrambled and folded, over every genuine save.
  { tool: 'dump-save-stamp.ts' },
  // A dungeon's signature, the walls of each level, and the catalogue of the known
  // dungeons' digests, which is committed: held here to every `dungeon.dat` and save.
  { tool: 'dump-dungeon-signature.ts' },
  // The title animation and the dungeon entrance. The golden frames can see the entrance
  // once it is up; the nine 0x232 rectangles it hangs off, the hardcoded button list DM's
  // graphics.dat forces, the synthetic 5x5 level behind the doors, the 31-frame slide and
  // ShrinkBLT's fixed point are all invisible to them.
  { tool: 'dump-intro.ts' },
  // The FTL logo before the title, not CSBWin's: `swoosh.img`'s picture decoded (2306 bytes
  // for 64000 pixels, and a reference picture pixel for pixel) and its palette script run
  // on a headless host, each colour at its VBL.
  { tool: 'dump-swoosh.ts' },
  // `ExpandGraphic`, the codec every picture in the game goes through, against a real
  // CSBWin screen capture plus a hand-built stream per opcode. Three opcodes were wrong
  // and only one image in the data used them, so nothing else could have caught it.
  { tool: 'dump-image-codec.ts' },
  // Every table read from graphics.dat's table items, written back over the item's own
  // bytes at the offsets Data.h's declarations give it, in every data set.
  { tool: 'dump-graphics-tables.ts' },
  { tool: 'dump-graphic-random.ts' },
  { tool: 'dump-teleporter-shimmer.ts' },
  { tool: 'dump-door-lightning.ts' },
  { tool: 'dump-cloud-draw.ts' },
  { tool: 'dump-wall-text.ts' },
  { tool: 'dump-missile-draw.ts' },
  { tool: 'dump-monster-draw.ts' },
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
// Only a crash fails them.
const SMOKE = [
  { tool: 'dump-defined-items.ts' },
  { tool: 'dump-level-items.ts' },
  { tool: 'dump-object-definitions.ts' },
  { tool: 'dump-preset-heroes.ts' },
];

const argv = process.argv.slice(2);
const withFrames = argv.includes('--frames');
const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const jobsArg = argv.find((a) => a.startsWith('--jobs='))?.slice('--jobs='.length);
const jobs = jobsArg ? Math.max(1, Number.parseInt(jobsArg, 10) || 1) : availableParallelism();

const results = [];
let failed = 0;

function record(name, r, ms) {
  const ok = r.status === 0 && !r.error;
  console.log(`  ${name.padEnd(34)}${ok ? 'ok  ' : 'FAIL'}  ${String(ms).padStart(6)} ms`);
  results.push({ name, ok, out: (r.error ? `${r.error}\n` : '') + r.out, ms });
  if (!ok) failed++;
}

function runAsync(cmd, args) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: ROOT });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('error', (error) => done({ status: null, error, out: '', ms: Date.now() - started }));
    child.on('close', (status) => done({ status, out: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - started }));
  });
}

if (!existsSync(TSX)) {
  console.error('node_modules/.bin/tsx is missing — run `npm install` first.');
  process.exit(1);
}

const wanted = ({ tool }) => !only || only.some((o) => tool.includes(o));
const tool = ({ tool, args = [] }) => ({ name: tool, cmd: TSX, args: [resolve(ROOT, 'tools', tool), ...args] });
const sections = [
  ['types', [
    { name: 'tsc --noEmit', cmd: TSC, args: ['--noEmit'] },
    // The server as Node strips it: erasable syntax only (server/tsconfig.json).
    { name: 'tsc --noEmit -p server', cmd: TSC, args: ['--noEmit', '-p', 'server'] },
  ]],
  ['checks', CHECKS.filter(wanted).map(tool)],
  ['smoke (crash only)', SMOKE.filter(wanted).map(tool)],
];

// Every job starts as soon as a worker is free; each result prints once the jobs listed
// before it have printed, so the output reads in the lists' order whatever finished first.
const started = Date.now();
const pending = sections.flatMap(([, list]) => list).map((job) => ({ job, result: null }));
let next = 0;
let printed = 0;
let section = 0;
let sectionEnd = 0;
function flush() {
  while (printed < pending.length && pending[printed].result) {
    while (printed === sectionEnd) {
      const [title, list] = sections[section++];
      console.log(`\n${title}`);
      sectionEnd += list.length;
    }
    const { job, result } = pending[printed++];
    record(job.name, result, result.ms);
  }
}
async function worker() {
  while (next < pending.length) {
    const slot = pending[next++];
    slot.result = await runAsync(slot.job.cmd, slot.job.args);
    flush();
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, pending.length) }, worker));
for (; section < sections.length; section++) console.log(`\n${sections[section][0]}`);

if (withFrames) {
  console.log('\nframes');
  const t = Date.now();
  const r = spawnSync('bash', [resolve(ROOT, 'tools/check-frames.sh')], { cwd: ROOT, encoding: 'utf8' });
  record('check-frames.sh', { status: r.status, error: r.error, out: (r.stdout ?? '') + (r.stderr ?? '') }, Date.now() - t);
} else {
  console.log('\nframes                                skipped (pass --frames)');
}

// Failures print their whole output: these tools are meant to be read, and the table
// above the failed assertion is usually what tells you which way the port went wrong.
for (const r of results.filter((x) => !x.ok)) {
  console.log(`\n${'='.repeat(72)}\nFAILED: ${r.name}\n${'='.repeat(72)}`);
  console.log(r.out.trimEnd());
}

const wall = (Date.now() - started) / 1000;
const total = results.reduce((a, r) => a + r.ms, 0) / 1000;
console.log(`\n${results.length - failed}/${results.length} passed in ${wall.toFixed(1)}s (${total.toFixed(1)}s of work, ${jobs} at a time)`);
process.exit(failed === 0 ? 0 : 1);
