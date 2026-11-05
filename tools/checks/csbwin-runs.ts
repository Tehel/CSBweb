/**
 * CSBWin's own runs played to their end in the port, and played back as its recordings
 * (`DEBT.md` F24): each run of `tools/fixtures/csbwin-runs/` (`CSBWIN_RUNS`) played
 * through the page's input boundary and recorded (`recordRun`, `tools/lib/csbwinRun.ts`),
 * every entry of its log taken at the `d.Time` and `d.RandomNumber` CSBWin recorded, to
 * its end: the game won, Lord Chaos fused for a race to fusion and Chaos Strikes Back's
 * end for its whole game, the log's last entry for the race to Fulya Pit. Then the recording packaged as the site shares it
 * (`RecordingPackage`), at the game's end or at a save made at the log's end, read back,
 * and played by the port's player (`playPath`) to the same end without a drift.
 *
 * So every change to the engine answers to some 73,000 entries of CSBWin play. A run that
 * needed fixes of the engine is played again at the level before them (`CsbwinRun.before`),
 * where it must drift at the line that engine did: the fixes' flags give that engine back.
 *
 * Then each run under way (`CSBWIN_RUNS_UNDER_WAY`), a run of an older CSBWin version
 * played at its profile (`doc/RECORDING.md` → "A recording's level"), to the line it
 * drifts at and no other, and its recording up to there, packaged at a save made there,
 * played back to the same `d.Time` and `d.RandomNumber`.
 *
 *   npm test -- --only=csbwin-runs.ts [<run id> | --not=<run id>]
 */
import type { Recording } from '../../src/engine/Recorder';
import { readRecordingPackage, writeRecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { CSBWIN_RUNS, CSBWIN_RUNS_UNDER_WAY, recordRun, runPackage } from '../lib/csbwinRun';
import { dataSetNamed, diskFiles } from '../lib/dataSets';
import { playPath } from '../lib/playback';

/** A recording's changes counted by kind, in the order each first comes. */
function changeKinds(recording: Recording): Map<string, number> {
  const kinds = new Map<string, number>();
  for (const { change } of recording.changes) kinds.set(change.kind, (kinds.get(change.kind) ?? 0) + 1);
  return kinds;
}

// A run's id plays that run alone, `--not=<id>` every run but that one.
const arg = process.argv[2];
const not = arg?.startsWith('--not=') ? arg.slice('--not='.length) : undefined;
const picked = (run: { id: string }): boolean => (not !== undefined ? run.id !== not : !arg || run.id === arg);
const runs = CSBWIN_RUNS.filter(picked);
const underWay = CSBWIN_RUNS_UNDER_WAY.filter(picked);
check(runs.length + underWay.length > 0, `a run is named ${not ?? arg}`);

for (const run of runs) {
  console.log(`${run.id} (${run.dataSet}${run.save ? `, from ${run.save}` : ', a new game'}):`);
  const recorded = await recordRun(run, 'csbwin-runs');
  const { recording, page } = recorded;
  const kinds = changeKinds(recording);
  console.log(`  played: ${recorded.entries} entries, ${recording.vbls} VBLs, d.Time ${page.game.ctx.state.tickCount}, ${recording.changes.length} changes`);
  console.log(`  ${[...kinds].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  check(recorded.drift === null, `${run.id} plays to its end, every entry's random CSBWin's${recorded.drift ? `: drifts at ${recorded.drift}` : ''}`);
  if (run.end === 'won') {
    check(recorded.won === true, `${run.id} ends with the game won`);
  } else {
    check(recorded.won === null && recorded.saved !== null, `${run.id} plays to its log's end, where a save is made`);
  }
  check((kinds.get('playfile') ?? 0) > 0, `${run.id} carries CSBWin's recorder's own draws as changes`);

  const pkg = runPackage(run, recorded);
  const bytes = await writeRecordingPackage(pkg);
  const read = await readRecordingPackage(bytes);
  check(JSON.stringify(read.path[0]!.changes) === JSON.stringify(pkg.path[0]!.changes),
    `${run.id}'s package (${Math.round(bytes.length / 1024)} KB) reads back with its changes`);

  const set = dataSetNamed(run.dataSet);
  const played = await playPath(set, diskFiles(set), read.path, read.shared.kind === 'save' ? read.shared : null);
  check(played.drift === null, `the port's player plays ${run.id}'s recording to its end${played.drift ? `: ${JSON.stringify(played.drift)}` : ''}`);
  check(played.game.ctx.state.tickCount === page.game.ctx.state.tickCount && played.game.ctx.random.getSeed() === page.game.ctx.random.getSeed(),
    `and leaves the game at the run's d.Time ${played.game.ctx.state.tickCount} and d.RandomNumber`);
  if (run.end === 'won') check(played.game.ctx.state.gameWon && played.game.mainLoopHasReturned(), '…with the game won and the credits shown');

  if (run.before) {
    const { level, drifts } = run.before;
    const old = await recordRun(run, 'csbwin-runs', run.dataSet, level);
    check(old.drift?.startsWith(`line ${drifts}:`) === true,
      `${run.id} at level ${level}, its fixes' flags on, drifts where that engine did, line ${drifts}${old.drift?.startsWith(`line ${drifts}:`) ? '' : `, not ${old.drift === null ? 'nowhere' : old.drift.split(':')[0]}`}`);
  }
}

for (const run of underWay) {
  console.log(`${run.id} (${run.dataSet}, at ${run.profile}), under way:`);
  const recorded = await recordRun(run, 'csbwin-runs');
  console.log(`  played: ${recorded.entries} entries, d.Time ${recorded.page.game.ctx.state.tickCount}; drifts at ${recorded.drift}`);
  console.log(`  ${[...changeKinds(recorded.recording)].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  check(recorded.drift !== null && recorded.drift.startsWith(`line ${run.drifts}:`),
    `${run.id} plays at ${run.profile} to line ${run.drifts} of its log, where it drifts${recorded.drift?.startsWith(`line ${run.drifts}:`) ? '' : `, not ${recorded.drift === null ? 'at its end' : recorded.drift.split(':')[0]}: move its \`drifts\` on where it plays further`}`);
  const read = await readRecordingPackage(await writeRecordingPackage(runPackage(run, recorded)));
  const set = dataSetNamed(run.dataSet);
  const played = await playPath(set, diskFiles(set), read.path, read.shared.kind === 'save' ? read.shared : null);
  const { page } = recorded;
  check(played.drift === null && played.game.ctx.state.tickCount === page.game.ctx.state.tickCount
    && played.game.ctx.random.getSeed() === page.game.ctx.random.getSeed(),
    `the port's player plays ${run.id}'s recording to there, d.Time ${played.game.ctx.state.tickCount} and the run's d.RandomNumber${played.drift ? `: ${JSON.stringify(played.drift)}` : ''}`);
}
finish();
