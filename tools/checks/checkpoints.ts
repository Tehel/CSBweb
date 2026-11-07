/**
 * The recording player's checkpoints (`src/engine/Checkpoint.ts`): each corpus package
 * (`tools/lib/recordingCorpus.ts`) played four times.
 *
 * 1. **Without checkpoints**, to its end: the end's file, which the two others must make.
 * 2. **Taking a checkpoint a minute** (3600 VBLs, a quarter of a package shorter than four
 *    minutes, or `--every=`), at the first VBL past each mark where no `LoopScript` holds
 *    the loop, and reading none: taking one changes nothing, the play ends on the same
 *    file with no drift.
 * 3. **In a chain**: the play takes its first checkpoint, which a fresh page reads
 *    (`RecordingPlayer.resume`); the game read there is compared with the game that took
 *    it, by a recursive walk of the whole engine from `Game`, every field equal but the
 *    start's flag (`EXPECTED`), so a field added later that a checkpoint misses fails
 *    here. The game read plays on to the next checkpoint, and so on: each checkpoint read plays on as the game it was taken
 *    from, and the last to the path's end, with no drift and the same file.
 * 4. **Back, in the same page**, as the viewer goes back (`DEBT.md` E46): the play keeps
 *    its checkpoints as the page does (`KeptCheckpoints`, the latest 21), is stopped at
 *    nine tenths of the path, the page rewound (`rewindPage`), and the latest checkpoint
 *    at or before half of it, or twenty minutes back where that is later, read by a new player (`tools/lib/playback.ts`, `SeekBack`):
 *    the game read makes the file the game that took it made, and plays on to the same
 *    end with no drift.
 *
 *   npm test -- --only=checkpoints.ts                        every package
 *   npm test -- --only=checkpoints.ts DMMovie42              one package
 *   npm test -- --only=checkpoints.ts --not=DMMovie42        every other package (`--not=` again for more)
 *   npm test -- --only=checkpoints.ts DMMovie2615 --every=600
 *   npm test -- --only=checkpoints.ts CSBFullRecordingV4 --part=chain   plays 1 and 3 only (`taking`, `seek`: 2, 4)
 *
 * The gate runs the long packages as jobs of their own (`tools/run-checks.ts`).
 */
import { readFileSync } from 'node:fs';

import { RnMaps } from '../../src/core/RnMaps';
import { findRecordingSet } from '../../src/data/RecordingSet';
import { fileDigest } from '../../src/data/DataSetFiles';
import type { DataSet } from '../../src/data/DataSets';
import type { DataSetFiles } from '../../src/data/DataSetFiles';
import { KEPT_CHECKPOINTS, type Checkpoint } from '../../src/engine/Checkpoint';
import type { Game } from '../../src/engine/Game';
import { saveFileOf } from '../../src/engine/GameSaves';
import type { Recording } from '../../src/engine/Recorder';
import { readRecordingPackage } from '../../src/engine/RecordingPackage';
import { RecordingPlayer, type Drift, type SavedAtEnd } from '../../src/engine/RecordingPlayer';
import { standInPage, type StandInPage } from '../../src/renderer/StandInPage';
import { check, finish } from '../lib/check';
import { DATA_SETS, diskFiles, diskSetDigests } from '../lib/dataSets';
import { keptFiles, playPath } from '../lib/playback';
import { CORPUS_DIR, CORPUS_FILE, corpusFiles } from '../lib/recordingCorpus';

const args = process.argv.slice(2);
const named = args.filter((arg) => !arg.startsWith('--'));
/** The packages `--not=` leaves out, one name each. */
const not = args.filter((arg) => arg.startsWith('--not=')).map((arg) => arg.slice('--not='.length));
const part = args.find((arg) => arg.startsWith('--part='))?.slice('--part='.length) ?? null;
if (part !== null && part !== 'taking' && part !== 'chain' && part !== 'seek') throw new Error('--part= is taking, chain or seek');
const every = args.find((arg) => arg.startsWith('--every='))?.slice('--every='.length);
/** A minute of the game, the player's interval; or a quarter of a package shorter than four. */
const MINUTE = 3600;

/** A VBL of the clock, rounded up, as the loop is woken. */
const VBL_MS = 17;

/**
 * What the walk does not enter: the tables, the page's (the host, the screen, the
 * messages, the sounds, the clock, the input boundary, the callbacks), and the loop's
 * timing, none of which a checkpoint is.
 */
const NOT_STATE = /^(tables|host|screen|graphics|ui|presenter|messages|sounds|clock|onTickCallbacks|onFrameCallbacks|onMoveCallbacks|mouseEventHandlers|input|signatures|loopTimer|vblClockStart|vblsPaced|atOnce|forwarding|running)$/;

/**
 * What differs on purpose between the game read and the game that took it: the read's
 * next start resumes at the point (`Game.resumeAtSavePoint`), which the game that took it
 * is past.
 */
const EXPECTED: readonly string[] = ['game.atSavePoint'];

/** Where `x` and `y`, walked from `path`, differ: one line each, at most `limit`. */
function differences(x: unknown, y: unknown, path: string, out: string[], seen: Set<unknown>, limit = 60): void {
  if (out.length >= limit || x === y || EXPECTED.includes(path)) return;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) {
    if (typeof x === 'function' && typeof y === 'function') return;
    if (!(Number.isNaN(x) && Number.isNaN(y))) out.push(`${path}: ${short(x)} != ${short(y)}`);
    return;
  }
  if (seen.has(x)) return;
  seen.add(x);
  // The RN maps compared by what they hold, not by the room reserved past it.
  if (x instanceof RnMaps && y instanceof RnMaps) {
    differences(x.toJSON(), y.toJSON(), path, out, seen, limit);
    return;
  }
  if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) {
    out.push(`${path}: a ${x.constructor?.name} != a ${y.constructor?.name}`);
    return;
  }
  if (ArrayBuffer.isView(x)) {
    const a = x as unknown as ArrayLike<number>;
    const b = y as unknown as ArrayLike<number>;
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    else for (let n = 0; n < a.length && out.length < limit; n++) if (a[n] !== b[n]) out.push(`${path}[${n}]: ${a[n]} != ${b[n]}`);
    return;
  }
  if (x instanceof Map && y instanceof Map) {
    for (const key of new Set([...x.keys(), ...y.keys()])) differences(x.get(key), y.get(key), `${path}<${String(key)}>`, out, seen, limit);
    return;
  }
  if (x instanceof Set && y instanceof Set) {
    differences([...x].sort(), [...y].sort(), path, out, seen, limit);
    return;
  }
  if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) out.push(`${path}: length ${x.length} != ${y.length}`);
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!NOT_STATE.test(key)) differences(a[key], b[key], Array.isArray(x) ? `${path}[${key}]` : `${path}.${key}`, out, seen, limit);
  }
}

function short(value: unknown): string {
  return (typeof value === 'object' && value !== null ? JSON.stringify(value)?.slice(0, 80) : undefined) ?? String(value);
}

/** The file `game` makes now, as the end of a play is compared. */
function endFile(game: Game): string {
  const { ctx } = game;
  return fileDigest(saveFileOf(game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion)));
}

/** A player of `path` in `page`, stopping the loop at its end. */
function playerIn(page: StandInPage, path: readonly Recording[], savedAtEnd: SavedAtEnd | null): RecordingPlayer {
  const player = new RecordingPlayer(page.game, path, page.dungeonDat, savedAtEnd);
  player.onEnd(() => page.game.stop());
  page.game.runAtOnceWhile(() => player.held);
  return player;
}

/** `page`'s loop run while `player` plays. */
function run(page: StandInPage, player: RecordingPlayer): void {
  while (player.playing) if (!page.clock.advance(VBL_MS)) throw new Error('the loop stopped while the player plays');
}

/** Where a play ended: its drift, the file made there, the VBLs played. */
interface Ended {
  readonly drift: Drift | null;
  readonly file: string;
  readonly vbls: number;
}

/** Plays 1 and 2: the end's file and drift, without checkpoints or taking them a minute; and the checkpoints taken. */
async function playWhole(set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, take: number | null) {
  const page = await standInPage(set, files);
  const player = playerIn(page, path, savedAtEnd);
  let taken = 0;
  let mark = take ?? 0;
  if (take) player.onFed(() => {
    if (player.vbls < mark || !player.checkpoint()) return;
    taken++;
    mark += take;
  });
  player.start();
  if (player.playing) page.game.start(true);
  run(page, player);
  return { drift: player.drift, file: endFile(page.game), vbls: player.vbls, taken };
}

/** Play 3: the chain, each checkpoint read in a fresh page and compared with the game that took it. */
async function playChain(set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, take: number) {
  let page = await standInPage(set, files);
  let player = playerIn(page, path, savedAtEnd);
  let mark = take;
  const reads: { vbls: number; ms: number; takeMs: number; differences: string[] }[] = [];
  for (;;) {
    const next = await standInPage(set, files);
    let read: RecordingPlayer | null = null;
    const current = player;
    const game = page.game;
    current.onFed(() => {
      if (current.vbls < mark || read) return;
      let at = performance.now();
      const checkpoint: Checkpoint | null = current.checkpoint();
      if (!checkpoint) return;
      const takeMs = performance.now() - at;
      at = performance.now();
      read = playerIn(next, path, savedAtEnd);
      read.resume(checkpoint);
      const ms = performance.now() - at;
      const out: string[] = [];
      differences(game, next.game, 'game', out, new Set());
      if (read.vbls !== current.vbls || read.point.changes !== current.point.changes || read.point.vbls !== current.point.vbls) {
        out.push(`the player resumes at ${JSON.stringify(read.point)}, ${read.vbls}, not ${JSON.stringify(current.point)}, ${current.vbls}`);
      }
      reads.push({ vbls: current.vbls, ms, takeMs, differences: out });
      mark += take;
      current.stop();
      game.stop();
    });
    if (reads.length === 0) {
      current.start();
      if (current.playing) game.start(true);
    } else {
      game.start(true);
    }
    run(page, current);
    if (!read) return { drift: current.drift, file: endFile(game), vbls: current.vbls, reads };
    page = next;
    player = read;
  }
}

const digests = await diskSetDigests();
for (const file of corpusFiles()) {
  const name = CORPUS_FILE.exec(file)![1]!;
  if (named.length && !named.includes(name)) continue;
  if (not.includes(name)) continue;
  const pkg = await readRecordingPackage(new Uint8Array(readFileSync(`${CORPUS_DIR}/${file}`)));
  const found = findRecordingSet(pkg.path, digests);
  const set = DATA_SETS.find((one) => one.id === (found.kind === 'refused' ? pkg.dataSet : found.id));
  if (!set) throw new Error(`${file}: no set`);
  const files = keptFiles(diskFiles(set));
  const savedAtEnd: SavedAtEnd | null = pkg.shared.kind === 'save' ? pkg.shared : null;
  const started = Date.now();
  const plain = await playWhole(set, files, pkg.path, savedAtEnd, null);
  console.log(`${file}: ${set.id}, ${plain.vbls} VBLs, ends ${plain.drift ? `in a drift ${JSON.stringify(plain.drift)}` : 'with no drift'}`);
  check(plain.drift === null, `${name} plays to its end`);
  const take = every ? Number(every) : Math.min(MINUTE, Math.floor(plain.vbls / 4));
  if (part === null || part === 'taking') await checkTaking(name, set, files, pkg.path, savedAtEnd, take, plain);
  if (part === null || part === 'chain') await checkChain(name, set, files, pkg.path, savedAtEnd, take, plain);
  if (part === null || part === 'seek') await checkSeek(name, set, files, pkg.path, savedAtEnd, take, plain);
  console.log(`  in ${Date.now() - started} ms in all`);
}
finish();

/** Play 2 checked against play 1. */
async function checkTaking(name: string, set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, take: number, plain: Ended): Promise<void> {
  const taking = await playWhole(set, files, path, savedAtEnd, take);
  console.log(`  taking ${taking.taken} checkpoints, one each ${take} VBLs: ${taking.drift ? `drift ${JSON.stringify(taking.drift)}` : 'no drift'}, ${taking.file === plain.file ? 'the same' : 'ANOTHER'} file at the end`);
  check(taking.drift === null && taking.file === plain.file && taking.vbls === plain.vbls, `${name}: taking checkpoints changes nothing`);
  check(taking.taken > 0, `${name}: the play takes checkpoints`);
}

/** Play 3 checked against play 1. */
async function checkChain(name: string, set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, take: number, plain: Ended): Promise<void> {
  const chain = await playChain(set, files, path, savedAtEnd, take);
  for (const one of chain.reads) {
    console.log(`  read at ${one.vbls} (taken in ${one.takeMs.toFixed(1)} ms, read in ${one.ms.toFixed(1)} ms): ${one.differences.length ? `${one.differences.length} differences` : 'the same engine'}`);
    for (const line of one.differences) console.log(`    ${line}`);
    check(one.differences.length === 0, `${name}: the checkpoint at ${one.vbls} reads the game that took it`);
  }
  console.log(`  the chain of ${chain.reads.length} reads ends ${chain.drift ? `in a drift ${JSON.stringify(chain.drift)}` : 'with no drift'}, ${chain.file === plain.file ? 'the same' : 'ANOTHER'} file`);
  check(chain.reads.length > 0, `${name}: the chain reads checkpoints`);
  check(chain.drift === null && chain.file === plain.file && chain.vbls === plain.vbls, `${name}: the chain plays to the same end`);
}

/** Play 4 checked against play 1. */
async function checkSeek(name: string, set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, take: number, plain: Ended): Promise<void> {
  const at = Math.floor(plain.vbls * 0.9);
  // Half the path, or as far back as the checkpoints kept reach, twenty marks.
  const to = Math.max(Math.floor(plain.vbls / 2), at - (KEPT_CHECKPOINTS - 1) * take);
  const back = await playPath(set, files, path, savedAtEnd, { at, to }, { every: take, most: KEPT_CHECKPOINTS });
  const { before, read, landed } = back.seek!;
  const file = endFile(back.game);
  console.log(`  back from ${at} to ${to}, ${before.length} kept: ${read ? `read ${read.cursor.played}` : 'the start'}, ends ${back.drift ? `in a drift ${JSON.stringify(back.drift)}` : 'with no drift'}, ${file === plain.file ? 'the same' : 'ANOTHER'} file`);
  check(read !== null && before.length === Math.min(KEPT_CHECKPOINTS, Math.floor(at / take)), `${name}: the play keeps its checkpoints, the latest ${KEPT_CHECKPOINTS}, and back to ${to} reads one`);
  check(read !== null && landed !== null && fileDigest(landed.file) === fileDigest(read.file), `${name}: the game read in the same page makes the file the game that took it made`);
  check(back.drift === null && file === plain.file && back.vbls === plain.vbls, `${name}: back in the same page plays to the same end`);
}
