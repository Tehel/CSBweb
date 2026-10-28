// The project's check suite: `npm test`.
//
// There is still no test *framework* (PLAN.md Phase 15) — this is a runner over the
// project's evidence. It runs the three gates CLAUDE.md calls non-negotiable:
//
//   1. `tsc --noEmit`            — the real build gate; `vite build` proves nothing.
//                                  Four projects: the page's, the tools', utils/'
//                                  and the server's (tsconfig.json, and each folder's),
//                                  vite.config.mts in the server's.
//   2. every asserting tools/checks/*.ts — the regression suite for what the frames
//                                  cannot see.
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
//   npm test -- --only=room-text.ts  # a whole name picks that tool alone, not open-room-text.ts
//   npm test -- --only=dsa,save  # …or any of several
//   npm test -- --jobs=1         # one at a time; a tool's own time is then its own
//
// One tool on its own, its types checked: `npm test -- --only=savegame.ts 3`. When
// `--only` picks out a single tool, its whole output prints, pass or fail, and every
// argument the runner does not know is the tool's, in place of the args pinned below.
// `npx tsx tools/checks/<name>.ts` strips the types without checking them, as `vite build` does.
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');
const TSC = resolve(ROOT, 'node_modules/.bin/tsc');

// Tools that assert, in tools/checks/ unless `dir` says otherwise. `args` pins the scenario
// the assertions were written for — several tools take a level, and the wrong level
// activates no monsters and checks nothing.
/** A tool to run: its file, its folder if not tools/checks/, and the arguments it is run with. */
interface Tool {
  tool: string;
  dir?: string;
  args?: string[];
}
const CHECKS: Tool[] = [
  { tool: 'object-name-index.ts' },
  { tool: 'object-index.ts' },
  { tool: 'monster-tables.ts' },
  { tool: 'monster-activation.ts', args: ['3'] },
  { tool: 'monster-perception.ts' },
  { tool: 'monster-damage.ts' },
  { tool: 'monster-design-options.ts' },
  { tool: 'monster-move.ts' },
  { tool: 'monster-pad.ts' },
  { tool: 'monster-move-code.ts' },
  { tool: 'monster-generator.ts' },
  { tool: 'monster-ai.ts' },
  { tool: 'giggler-steal.ts' },
  { tool: 'add-object-to-room.ts' },
  { tool: 'attributes.ts' },
  { tool: 'adjust-skills.ts' },
  { tool: 'hand-owner.ts' },
  { tool: 'marching-order.ts' },
  { tool: 'object-cursor.ts' },
  { tool: 'inventory-routing.ts' },
  { tool: 'key-bindings.ts' },
  { tool: 'settings.ts' },
  { tool: 'settings-dialog.ts' },
  { tool: 'left-handed.ts' },
  { tool: 'map-dialog.ts' },
  { tool: 'champion-dialog.ts' },
  { tool: 'attack-panel.ts' },
  { tool: 'magic-panel.ts' },
  { tool: 'champion-state.ts' },
  { tool: 'champion-death.ts' },
  { tool: 'character-damage.ts' },
  { tool: 'show-credits.ts' },
  { tool: 'loop-script.ts' },
  { tool: 'new-game.ts' },
  { tool: 'enter-dungeon.ts' },
  { tool: 'loop-die.ts' },
  { tool: 'item-bonuses.ts' },
  { tool: 'feeding.ts' },
  { tool: 'ten-second-update.ts' },
  { tool: 'sleep.ts' },
  { tool: 'freeze.ts' },
  { tool: 'messages.ts' },
  { tool: 'vbl-clock.ts' },
  { tool: 'room-text.ts' },
  { tool: 'text-substitution.ts' },
  { tool: 'open-room-text.ts' },
  { tool: 'ninety-second-update.ts' },
  { tool: 'light-level.ts' },
  { tool: 'hall-of-champions.ts' },
  { tool: 'dm-rules.ts' },
  { tool: 'vi-altar.ts' },
  { tool: 'wings.ts' },
  { tool: 'swap-character.ts' },
  // EXPOOL, where a death's bones record is kept: the pools of the genuine saves rebuilt
  // byte for byte, and put through CSBWin's own save loop unchanged.
  { tool: 'expool.ts' },
  { tool: 'viewport-click.ts' },
  { tool: 'fountain.ts' },
  { tool: 'item-properties.ts' },
  { tool: 'queue-sound.ts' },
  { tool: 'crack-switch.ts' },
  { tool: 'dm-atari-graphics.ts' },
  { tool: 'amiga-disk.ts' },
  { tool: 'amiga-graphics.ts' },
  { tool: 'amiga-sounds.ts' },
  { tool: 'amiga-sound-path.ts' },
  { tool: 'zokathra-wall.ts' },
  { tool: 'hidden-alcove.ts' },
  { tool: 'door-ornaments.ts' },
  { tool: 'derived-graphics.ts' },
  { tool: 'status-boxes.ts' },
  { tool: 'hand-boxes.ts' },
  { tool: 'mastery-panel.ts' },
  { tool: 'watch-thrown-weapons.ts' },
  { tool: 'reincarnate-entry.ts' },
  { tool: 'pit-fall.ts' },
  { tool: 'teleporter-drop.ts' },
  { tool: 'teleporter-target.ts' },
  { tool: 'dev-level.ts' },
  { tool: 'wiggle-cloud.ts' },
  { tool: 'wiggle-objects.ts' },
  { tool: 'wiggle-monster.ts' },
  { tool: 'missile-drop.ts' },
  { tool: 'drop-move-object.ts' },
  { tool: 'stairs-move.ts' },
  { tool: 'local-action.ts' },
  { tool: 'does-party-have.ts' },
  { tool: 'dsa-move.ts' },
  { tool: 'dsa-add-delete.ts' },
  { tool: 'dsa-delete.ts' },
  { tool: 'dsa-census.ts' },
  { tool: 'map-cell-info.ts' },
  { tool: 'dsa-decoder.ts' },
  { tool: 'dsa-characters.ts' },
  { tool: 'dsa-objects.ts' },
  { tool: 'dsa-widths.ts' },
  { tool: 'dsa-limits.ts' },
  { tool: 'dsa-parameters.ts' },
  { tool: 'dsa-cell-fetch.ts' },
  { tool: 'viewing-filter.ts' },
  { tool: 'open-chest.ts' },
  { tool: 'sound-filter.ts' },
  { tool: 'action-name-filter.ts' },
  { tool: 'feeding-filter.ts' },
  { tool: 'char-damage-filter.ts' },
  { tool: 'equip-filter.ts' },
  { tool: 'party-move-filter.ts' },
  { tool: 'monster-attack-filter.ts' },
  { tool: 'delete-monster-filter.ts' },
  { tool: 'monster-move-filter.ts' },
  { tool: 'cursor-filter.ts' },
  { tool: 'dsa-missiles.ts' },
  { tool: 'dsa-monsters.ts' },
  { tool: 'dsa-text.ts' },
  { tool: 'dsa-message.ts' },
  { tool: 'dsa-nofilter.ts' },
  { tool: 'dsa-indirect.ts' },
  { tool: 'dsa-dungeon.ts' },
  { tool: 'dsa-save.ts' },
  { tool: 'skins.ts' },
  { tool: 'background-lib.ts' },
  { tool: 'skin-programs.ts' },
  { tool: 'custom-graphics.ts' },
  { tool: 'extended-decorations.ts' },
  { tool: 'csbgraphics-writer.ts' },
  { tool: 'wall-decoration-art.ts' },
  { tool: 'virtual-graphics.ts' },
  { tool: 'watch-conflux-start.ts' },
  { tool: 'watch-3d2d1d-vertical.ts' },
  { tool: 'watch-3d2d1d-gravity.ts' },
  { tool: 'dsa-overlay.ts' },
  { tool: 'overlay-screen.ts' },
  { tool: 'video-mode.ts' },
  { tool: 'timer-modifier.ts' },
  { tool: 'flip.ts' },
  { tool: 'db-reuse.ts' },
  { tool: 'watch-smart-discard.ts' },
  { tool: 'make-more-room.ts' },
  { tool: 'missile-monster.ts' },
  { tool: 'missile-crossing.ts' },
  { tool: 'missile-door.ts' },
  { tool: 'move-from-missile.ts' },
  { tool: 'missile-teleport.ts' },
  { tool: 'missile-exterior.ts' },
  { tool: 'party-move.ts' },
  { tool: 'last-monster-attack.ts' },
  { tool: 'monster-blow-mastery.ts' },
  { tool: 'character-to-damage.ts' },
  { tool: 'monster-missile-type.ts' },
  { tool: 'cast-spell.ts' },
  { tool: 'magic-footprints.ts' },
  { tool: 'footprint-decoration.ts' },
  { tool: 'timer-dedupe.ts' },
  { tool: 'delete-duplicate-timers.ts' },
  { tool: 'timer-sequence.ts' },
  { tool: 'timer-heap.ts' },
  { tool: 'timer-bytes.ts' },
  { tool: 'throwing.ts' },
  { tool: 'clouds.ts' },
  { tool: 'player-attacks.ts' },
  { tool: 'fusion.ts' },
  // Level 1 is the argument the assertions were written for: it has a closed door,
  // a movable object with an open neighbour, and creatures.
  { tool: 'savegame.ts', args: ['1'] },
  // The save file's side of that: the CSBWin-shaped binary blocks. Needs no
  // dungeon and no arguments — it builds its own records.
  { tool: 'savegame-blocks.ts' },
  // Genuine CSBWin save files from tools/fixtures. The only check in the
  // suite that reads bytes this project did not write, so the only one a bug
  // symmetrical between our reader and our writer cannot satisfy.
  { tool: 'csbwin-save.ts' },
  // The world inside those saves: the dungeon image parsed into a real DungeonData and
  // held up against dungeon.dat. The early saves must still *be* dungeon.dat's world.
  { tool: 'csbwin-world.ts' },
  // The champions inside those saves: the whole CHARDESC, not just the name.
  { tool: 'csbwin-party.ts' },
  { tool: 'csbwin-load.ts' },
  // Chaos Strikes Back's Atari-era saves, with no Extended Features block: loaded,
  // walked and run in a Game on CSB's graphics.dat.
  { tool: 'atari-saves.ts' },
  // "MAKE NEW ADVENTURE": a saved game's party carried into mini.dat, field by field,
  // and csbgame2.dat, which CSBWin's utility wrote, made again byte for byte.
  { tool: 'new-adventure.ts' },
  // RISE on CSB's entrance: the button carved from the entrance, the adventure stored
  // as a csb save, and the chooser over every set's saves that makes it.
  { tool: 'rise.ts' },
  // Chaos Strikes Back's Hint Oracle data, hcsb.hct, decoded and its limits checked.
  { tool: 'hint-oracle.ts' },
  // Its screen, run headlessly: the title list, a hint's pages, the cycle, no clues.
  { tool: 'hint-oracle-screen.ts' },
  // Its button, the inventory's close box: the picture, the click on the party's square
  // after a step, a teleporter and a pit, the clock held, and the close box without it.
  { tool: 'hint-oracle-button.ts' },
  // The hint key and the graphics signatures kept from a read and written back at a
  // save, and hcsb.hct read under the key.
  { tool: 'hint-key.ts' },
  // Block 4 packed and held up against the real thing: every committed save's
  // character block, written again from the champions it yields, byte for byte.
  { tool: 'character-block.ts' },
  // Every block the writer emits, held up against the bytes CSBWin wrote — the same
  // argument as above, widened from block 4 to blocks 2, 3, 5 and 6, which were marked
  // complete and had never been compared with a real file.
  { tool: 'save-blocks-vs-file.ts' },
  // The same for the whole dungeon image — blocks 7 to 15 — against both dungeon.dat and
  // every committed save. Six of the eight sections are byte-identical; blocks 10 and 13
  // are full of RNs, whose slot numbering is ours, so their non-RN bytes are compared and
  // their RNs resolved. It found thirteen fields the loader was dropping and the whole of
  // EXPOOL, which had no parser at all.
  { tool: 'dungeon-image-blocks.ts' },
  // Each level's cells where CSBWin reads them, `cellOffset` unwrapped past 64K: the object
  // list's column index against the flags in every data set, and Conflux's block 14.
  { tool: 'cell-offsets.ts' },
  // The three conversions `ReadDatabases` runs over an original dungeon, measured
  // against a dungeon CSBWin converted itself: every committed save was made from this
  // same dungeon.dat, so its converted form is sitting in eight files. Without them a
  // game started from dungeon.dat holds a world no save file can express.
  { tool: 'dungeon-conversions.ts' },
  // `ExtendPortraits`, run after the read: dungeon.dat's 24 mirrors cleaned and nothing
  // else moved, and every save that carries `ExpandedPortraits` left as written.
  { tool: 'extend-portraits.ts' },
  // `CheckCelltypes` and `CheckMonsters`, the read's other two clean-ups: no change to
  // dungeon.dat, a save's attached size-4 groups given their slot's positions and facing
  // back by the restore, and every arm tripped on built records, through `new Game` too.
  { tool: 'check-monsters.ts' },
  // A compressed dungeon.dat, CSB's prison: `ExpandData` proven byte for byte by the
  // image's own checksum word, and `Word22592` taken from the file for the new game.
  { tool: 'compressed-dungeon.ts' },
  // `ReadDatabases`' checksum word, compared with the image's byte sum: a flipped byte
  // fails the prison, DM's dungeon.dat once a word follows it, and every committed save.
  { tool: 'image-checksum.ts' },
  // And where such a failed read goes: the boot's chooser hands it to `tag01efee`, whose
  // menu after a lost game, and acknowledged line at the boot, only a left click on OK ends.
  { tool: 'bad-saved-game.ts' },
  { tool: 'damaged-read.ts' },
  // The page's data sets: each loads, builds its own tables, and stands a Game up, and
  // CSB's long 0x231 carries CSBWin's four prison-door buttons (the canary).
  { tool: 'data-sets.ts' },
  // A player's own set, built from a manifest set's files and read through its record:
  // the same files, the same game, tick for tick; its flags from its files; its prefix.
  { tool: 'local-data-set.ts' },
  // A published set's archive, which the welcome page's book makes: the page's zip read
  // back by the tool's own reader and by unzip, every set's files in it, byte for byte.
  { tool: 'data-set-archive.ts' },
  { tool: 'build.ts' },
  // No value-import cycle in src/: which module of a cycle loads first depends on the
  // entry point, so a value read at load time breaks some entries and not others.
  { tool: 'import-cycles.ts' },
  // The deployed server: its start-up check, caching, preconditions, refused paths, the
  // statistics' API, and server.ts itself, run as Node runs it, stopped by SIGTERM.
  { tool: 'server.ts' },
  // The statistics: what api/event accepts and rebuilds, the SQLite store, its aggregates.
  { tool: 'stats.ts' },
  // The statistics' events the page sends: a new game's first tick, the Hall's joins by
  // name and charID, a won game's masteries, a lost game's square, all as the server takes
  // them; none for a player's own set.
  { tool: 'game-events.ts' },
  // A dungeon.dat behind an Extended Features block, the DM Windows package's: read in the
  // block's shape it is DM's dungeon converted, and a new game takes the block's rules.
  { tool: 'extended-dungeon.ts' },
  // The dungeon's game information, ReadGameInfo's: kept from a block, written into every
  // save, and "No game information was provided" for a size of 0.
  { tool: 'game-info.ts' },
  { tool: 'dungeon-file.ts' },
  { tool: 'dungeon-builder.ts' },
  // `ReadExtendedFeatures` without a plain sentinel: the "simple" encipherment's stream,
  // RC4.cpp's own, against the compiled C++ and Conflux's enciphered dungeon.dat. And a
  // block it gives up on (checksum, terminator, flag) is no block: the file is read from 0.
  { tool: 'extended-features-read.ts' },
  // The other half of that argument: a genuine save re-serialised in full — all sixteen
  // blocks, image and closing checksum — and read back by this port's own reader. It is
  // what covers the words the block-by-block comparisons have to hold out, by showing
  // they still name the right objects after a whole trip through the file format.
  { tool: 'save-file-roundtrip.ts' },
  // And the live half of that: a running game — played from dungeon.dat, and played on
  // from a genuine save — writes all sixteen blocks through `buildSaveFile`, and the
  // file loads back into a fresh game with the world, the party, the thrown object in
  // flight and the object on the cursor intact.
  { tool: 'live-save-file.ts' },
  // The portraits of a party read out of a CSBWin save, drawn into a real screen
  // buffer: CHARDESC carries the picture rather than a graphic-26 index, so the frames
  // (which only ever see an injected party) cover the other path entirely.
  { tool: 'portraits.ts' },
  // The sounds of CSBgraphics.dat a DSA's &SOUND plays: every section of both files read
  // as `ReadSound` does, each a WAV file once summed, and `Decode`'s volume table.
  { tool: 'custom-sounds.ts' },
  // CSBgraphics.dat's alternate monster graphics: every section of both files read as an
  // ALTMONGRAPH, the dungeon's mapping of them by level and type, and the cache's slots.
  { tool: 'alt-mon-graphics.ts' },
  // A group drawn from its alternate graphic: the section's bitplanes, its places and
  // views, the derived graphics kept for the rows further away, and CSBWin's die for a
  // mirrored front beside the party; and the default dungeon names none.
  { tool: 'alt-mon-draw.ts' },
  // The graphics files' signatures, and CSBWin's checks of them at a read and at
  // CSBgraphics.dat's first section read: a file the game does not name ends the game.
  { tool: 'file-signatures.ts' },
  { tool: 'csbwin-timers.ts' },
  // Our *own* save, the CSBWin file F5, F9 and the disk menu write and read: saved and
  // loaded over genuine saves and over played games, with the whole of what a load
  // changes held to a named list. `checks/savegame.ts` drives the runtime snapshot directly
  // and the `checks/csbwin-*` tools the reader; this is the trip through both.
  { tool: 'save-roundtrip.ts' },
  // The save/load screen: the button-table offsets it hangs off, the dialog built out
  // of graphic 0's pieces, the row formatting, and the two metadata paths. Nothing here is
  // visible to the golden frames until there are saves to list.
  { tool: 'save-menu.ts' },
  { tool: 'widgets.ts' },
  // The Sleepsave: a playthrough's slot apart from F5's, written when the party lies down
  // and when the player wakes it, never when a blow does; silent, and refused where F5 is.
  { tool: 'sleep-save.ts' },
  // A game an error has ended: the loop stops for good, and no key, click or save path
  // touches the world it left half-updated.
  { tool: 'fatal-error.ts' },
  // A playthrough stamped into a save file that names none: six bytes of GAMEBLOCK1, in a
  // block that is scrambled and folded, over every genuine save.
  { tool: 'save-stamp.ts' },
  // A dungeon's signature, the walls of each level, and the catalogue of the known
  // dungeons' digests, which is committed: held here to every `dungeon.dat` and save.
  { tool: 'dungeon-signature.ts' },
  // The title animation and the dungeon entrance. The golden frames can see the entrance
  // once it is up; the nine 0x232 rectangles it hangs off, the hardcoded button list DM's
  // graphics.dat forces, the synthetic 5x5 level behind the doors, the 31-frame slide and
  // ShrinkBLT's fixed point are all invisible to them.
  { tool: 'intro.ts' },
  // The welcome page's thumbnails, each set's `<id>-thumbnail.png`: the title's last frame,
  // played from the set's graphics.dat, pixel for pixel and colour for colour.
  { tool: 'gen-thumbnails.ts', dir: 'tools', args: ['--check'] },
  // A thumbnail in the title's place: reduced to sixteen Atari shades by median cut, the
  // Theron cover pinned, a picture already of sixteen shades given back exactly.
  { tool: 'title-picture.ts' },
  // The welcome page's font, `src/assets/dm-screen.ttf`: dm-atari's graphics.dat font as a
  // TrueType font, byte for byte what the tool writes. That the browser draws it as the
  // game does is the frames' check.
  { tool: 'gen-font.ts', dir: 'tools', args: ['--check'] },
  // The FTL logo before the title, not CSBWin's: `swoosh.img`'s picture decoded (2306 bytes
  // for 64000 pixels, and a reference picture pixel for pixel) and its palette script run
  // on a headless host, each colour at its VBL.
  { tool: 'swoosh.ts' },
  // `ExpandGraphic`, the codec every picture in the game goes through, against a real
  // CSBWin screen capture plus a hand-built stream per opcode. Three opcodes were wrong
  // and only one image in the data used them, so nothing else could have caught it.
  { tool: 'image-codec.ts' },
  // A damaged file's counts set absurdly, one per reader that sizes or loops by one: a DSA's
  // states, the expanded sizes, the LZW chains, a portrait's size, a viewport program's
  // steps. Each throws at once, where it would exhaust the memory or never return.
  { tool: 'damaged-counts.ts' },
  { tool: 'hostile-indices.ts' },
  // Every table read from graphics.dat's table items, written back over the item's own
  // bytes at the offsets Data.h's declarations give it, in every data set.
  { tool: 'graphics-tables.ts' },
  { tool: 'graphic-random.ts' },
  { tool: 'teleporter-shimmer.ts' },
  { tool: 'door-lightning.ts' },
  { tool: 'cloud-draw.ts' },
  { tool: 'wall-text.ts' },
  { tool: 'missile-draw.ts' },
  { tool: 'monster-draw.ts' },
  { tool: 'render-probe.ts' },
  // Level 2 has an Ant Man with a free open neighbour to be bumped into.
  { tool: 'button-flash.ts' },
  // The page's animation clock, and the chew on it.
  { tool: 'presenter.ts' },
  { tool: 'mouse-queue.ts' },
  { tool: 'party-collision.ts', args: ['2'] },
  // Level 2's door at (0,25) is up-down, which is the mode that exercises VerticalSize.
  { tool: 'door-crush.ts', args: ['2'] },
  { tool: 'watch-monsters.ts' },
  { tool: 'watch-monster-attacks.ts' },
];

// Tools with no assertions: they exist to be read, not to pass. They are still run,
// because a loader or table change that throws should not wait to be noticed by hand.
// Only a crash fails them.
const SMOKE: Tool[] = [
  { tool: 'defined-items.ts' },
  { tool: 'level-items.ts' },
  { tool: 'object-definitions.ts' },
  { tool: 'preset-heroes.ts' },
];

const argv = process.argv.slice(2);
const withFrames = argv.includes('--frames');
const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const jobsArg = argv.find((a) => a.startsWith('--jobs='))?.slice('--jobs='.length);
const jobs = jobsArg ? Math.max(1, Number.parseInt(jobsArg, 10) || 1) : availableParallelism();
const toolArgs = argv.filter((a) => a !== '--frames' && !a.startsWith('--only=') && !a.startsWith('--jobs='));

/** A finished job: its exit status, the error that kept it from one, and its output. */
interface JobResult {
  status: number | null;
  error?: Error;
  out: string;
  ms: number;
}
/** A job: a command, and when its output prints (`record`). */
interface Job {
  name: string;
  cmd: string;
  args: string[];
  show?: 'always' | 'failure';
}

const results: { name: string; ok: boolean; out: string; ms: number; shown: boolean }[] = [];
let failed = 0;

// `show` prints a job's output under its line rather than after the run: 'always', or
// 'failure' (a type error is learnt before the tools' results, not ~150 s later).
function record(name: string, r: Omit<JobResult, 'ms'>, ms: number, show?: Job['show']) {
  const ok = r.status === 0 && !r.error;
  console.log(`  ${name.padEnd(34)}${ok ? 'ok  ' : 'FAIL'}  ${String(ms).padStart(6)} ms`);
  const out = (r.error ? `${r.error}\n` : '') + r.out;
  const shown = show === 'always' || (show === 'failure' && !ok);
  if (shown && out.trim()) console.log(`\n${out.trimEnd()}\n`);
  results.push({ name, ok, out, ms, shown });
  if (!ok) failed++;
}

// A job that has not finished in five minutes, ten times the slowest tool's time, fails
// with its output so far: one left with a handle open would otherwise hang the whole run.
// Each job leads a process group of its own, so the kill takes tsx's node child with it,
// and so does an interrupted run.
const JOB_TIMEOUT_MS = 300_000;
const groups = new Set<number>();
const killGroup = (pid: number) => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};
process.on('SIGINT', () => {
  for (const pid of groups) killGroup(pid);
  process.exit(130);
});

function runAsync(cmd: string, args: string[]) {
  return new Promise<JobResult>((done) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: ROOT, detached: true });
    const pid = child.pid!;
    groups.add(pid);
    const chunks: Buffer[] = [];
    const finish = (result: Omit<JobResult, 'out' | 'ms'>) => {
      clearTimeout(timer);
      groups.delete(pid);
      done({ ...result, out: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - started });
    };
    const timer = setTimeout(() => {
      killGroup(pid);
      finish({ status: null, error: new Error(`timed out after ${JOB_TIMEOUT_MS / 1000} s, its output so far below`) });
    }, JOB_TIMEOUT_MS);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('error', (error) => finish({ status: null, error }));
    child.on('close', (status) => finish({ status }));
  });
}

if (!existsSync(TSX)) {
  console.error('node_modules/.bin/tsx is missing — run `npm install` first.');
  process.exit(1);
}

// An `--only` that is a tool's whole name picks that tool alone: `room-text.ts` is also the
// end of `open-room-text.ts`.
const names = new Set([...CHECKS, ...SMOKE].map(({ tool }) => tool));
const wanted = ({ tool }: Tool) => !only || only.some((o) => (names.has(o) ? tool === o : tool.includes(o)));
const checks = CHECKS.filter(wanted);
const smoke = SMOKE.filter(wanted);
const single = only && checks.length + smoke.length === 1;
if (toolArgs.length && !single) {
  console.error(`${toolArgs.join(' ')}: a tool's arguments need --only to pick out one tool.`);
  process.exit(1);
}
const tool = ({ tool, dir = 'tools/checks', args = [] }: Tool): Job => ({
  name: tool,
  cmd: TSX,
  args: [resolve(ROOT, dir, tool), ...(toolArgs.length ? toolArgs : args)],
  show: single ? 'always' : undefined,
});
const sections: [string, Job[]][] = [
  ['types', [
    // The page as the browser runs it, held to noUncheckedIndexedAccess.
    { name: 'tsc --noEmit', cmd: TSC, args: ['--noEmit'], show: 'failure' },
    // The tools and utils/ on Node's types.
    { name: 'tsc --noEmit -p tools', cmd: TSC, args: ['--noEmit', '-p', 'tools'], show: 'failure' },
    { name: 'tsc --noEmit -p utils', cmd: TSC, args: ['--noEmit', '-p', 'utils'], show: 'failure' },
    // The server as Node runs it, and vite.config.mts, the dev server's: Node's resolution, erasable syntax only.
    { name: 'tsc --noEmit -p server', cmd: TSC, args: ['--noEmit', '-p', 'server'], show: 'failure' },
  ]],
  ['checks', checks.map(tool)],
  ['smoke (crash only)', smoke.map(tool)],
];

// Every job starts as soon as a worker is free; each result prints once the jobs listed
// before it have printed, so the output reads in the lists' order whatever finished first.
const started = Date.now();
const pending: { job: Job; result: JobResult | null }[] = sections.flatMap(([, list]) => list).map((job) => ({ job, result: null }));
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
    record(job.name, result!, result!.ms, job.show);
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
for (const r of results.filter((x) => !x.ok && !x.shown)) {
  console.log(`\n${'='.repeat(72)}\nFAILED: ${r.name}\n${'='.repeat(72)}`);
  console.log(r.out.trimEnd());
}

const wall = (Date.now() - started) / 1000;
const total = results.reduce((a, r) => a + r.ms, 0) / 1000;
console.log(`\n${results.length - failed}/${results.length} passed in ${wall.toFixed(1)}s (${total.toFixed(1)}s of work, ${jobs} at a time)`);
process.exit(failed === 0 ? 0 : 1);
