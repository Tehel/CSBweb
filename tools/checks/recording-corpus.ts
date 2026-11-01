/**
 * The corpus of the port's own recordings, each played at the engine's level it was made
 * at (`DEBT.md` R18, `doc/RECORDING.md` → "The corpus"): what makes a forgotten level, or
 * a change of play without its flag, fail `npm test` rather than break the players'
 * recordings silently.
 *
 * Each package of `tools/fixtures/recordings/` (`tools/lib/recordingCorpus.ts`) is read by
 * the page's reader, its name's level checked against its own and against the levels the
 * engine plays (`knownLevel`), its recordings' files' digests against the sets' files, to
 * find the set it plays over as the page finds it (`findRecordingSet`): its own, or
 * another whose files have them, as a package the site serves names the site's set. It is
 * played from the package alone over that set, as the replay tool plays a shared
 * recording (`playPath`): each recording at its own level, to its point without a drift,
 * a save's file made again there or the game's end reached.
 *
 * And the corpus holds each of CSBWin's runs (`CSBWIN_RUNS`), once, at the level it was
 * kept at. A bump records none again: a run's inputs are its log's at every level, and
 * `csbwin-runs.ts` already records and plays each at `ENGINE_LEVEL` in every `npm test`.
 *
 *   npm test -- --only=recording-corpus.ts            play the corpus
 *   npm test -- --only=recording-corpus.ts --write    first, record each run the corpus has at no level
 *
 * `tools/checks/replay.ts --corpus` keeps its own games' packages the same way.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ENGINE_LEVEL, knownLevel } from '../../src/engine/Behaviour';
import { findRecordingSet } from '../../src/data/RecordingSet';
import { readRecordingPackage, type RecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { CSBWIN_RUNS, recordRun, runPackage } from '../lib/csbwinRun';
import { DATA_SETS, diskFiles, diskSetDigests } from '../lib/dataSets';
import { playPath } from '../lib/playback';
import { CORPUS_DIR, CORPUS_FILE, corpusFiles, keepInCorpus } from '../lib/recordingCorpus';

/** Whether the corpus keeps a package of the run `id`, at any level. */
function keptRun(id: string): boolean {
  return corpusFiles().some((file) => CORPUS_FILE.exec(file)?.[1] === id);
}

if (process.argv.includes('--write')) {
  const build = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'corpus';
  for (const run of CSBWIN_RUNS) {
    if (keptRun(run.id)) continue;
    const recorded = await recordRun(run, build);
    if (recorded.drift || (run.end === 'won' ? recorded.won !== true : recorded.saved === null)) {
      check(false, `${run.id} plays to its end, to be kept${recorded.drift ? `: it drifts at ${recorded.drift}` : ''}`);
      continue;
    }
    console.log(`written: ${await keepInCorpus(run.id, runPackage(run, recorded))}`);
  }
}

/** `check`, saying whether `ok` held. */
function holds(ok: boolean, what: string): boolean {
  check(ok, what);
  return ok;
}

const digests = await diskSetDigests();

const files = corpusFiles();
console.log(`${CORPUS_DIR}: ${files.length} packages, the engine at level ${ENGINE_LEVEL}`);
for (const file of files) {
  const named = CORPUS_FILE.exec(file);
  if (!holds(named !== null, `${file} is named <name>.L<level>.gz`)) continue;
  const bytes = new Uint8Array(readFileSync(`${CORPUS_DIR}/${file}`));
  let pkg: RecordingPackage;
  try {
    pkg = await readRecordingPackage(bytes);
  } catch (error) {
    check(false, `${file} reads: ${(error as Error).message}`);
    continue;
  }
  const vbls = pkg.path.reduce((sum, recording) => sum + recording.vbls, 0);
  const changes = pkg.path.reduce((sum, recording) => sum + recording.changes.length, 0);
  console.log(`${file}: ${pkg.dataSet}, ${pkg.info.start.kind === 'new' ? 'a new game' : 'from a save'} to ${pkg.shared.kind === 'save' ? 'a save' : 'the game\'s end'}, `
    + `${pkg.path.length} recording${pkg.path.length === 1 ? '' : 's'}, ${changes} changes, ${vbls} VBLs, level${pkg.path.length === 1 ? '' : 's'} ${[...new Set(pkg.path.map((recording) => recording.level))].join(', ')}, ${Math.round(bytes.length / 1024)} KB`);
  if (!holds(Number(named![2]) === pkg.level, `${file}'s name says its level, ${pkg.level}`)) continue;
  if (!holds(pkg.path.every((recording) => knownLevel(recording.level)), `${file}'s levels are the engine's, 0 to ${ENGINE_LEVEL}`)) continue;
  const found = findRecordingSet(pkg.path, digests);
  if (found.kind === 'refused') {
    check(false, `${file}'s files are a set's: ${found.why}`);
    continue;
  }
  check(true, `${file}'s files are ${found.id}'s${found.id === pkg.dataSet ? '' : `, not ${pkg.dataSet}'s`}`);
  const set = DATA_SETS.find((candidate) => candidate.id === found.id)!;
  const startedAt = Date.now();
  const played = await playPath(set, diskFiles(set), pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null);
  check(played.drift === null, `${file} plays to its point at its level${played.joins ? `, through ${played.joins} join${played.joins === 1 ? '' : 's'}` : ''}, `
    + `d.Time ${played.game.ctx.state.tickCount} (${((Date.now() - startedAt) / 1000).toFixed(1)} s)${played.drift ? `: drifts, ${JSON.stringify(played.drift)}` : ''}`);
}

for (const run of CSBWIN_RUNS) {
  check(keptRun(run.id), `the corpus holds ${run.id}${keptRun(run.id) ? '' : ': npm test -- --only=recording-corpus.ts --write'}`);
}
finish();
