/**
 * CSBWin's own runs played to their end in the port, and played back as its recordings
 * (`DEBT.md` F24): each run of `tools/fixtures/csbwin-runs/` (`CSBWIN_RUNS`) played
 * through the page's input boundary and recorded (`recordRun`, `tools/lib/csbwinRun.ts`),
 * every entry of its log taken at the `d.Time` and `d.RandomNumber` CSBWin recorded, to
 * its end: Lord Chaos fused and the game won for a race to fusion, the log's last entry
 * for the race to Fulya Pit. Then the recording packaged as the site shares it
 * (`RecordingPackage`), at the game's end or at a save made at the log's end, read back,
 * and played by the port's player (`playPath`) to the same end without a drift.
 *
 * So every change to the engine answers to some 25,000 entries of CSBWin play.
 *
 *   npm test -- --only=csbwin-runs.ts [<run id>]
 */
import { readRecordingPackage, writeRecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { CSBWIN_RUNS, recordRun, runPackage } from '../lib/csbwinRun';
import { dataSetNamed, diskFiles } from '../lib/dataSets';
import { playPath } from '../lib/playback';

const only = process.argv[2];
const runs = CSBWIN_RUNS.filter((run) => !only || run.id === only);
check(runs.length > 0, `a run is named ${only}`);

for (const run of runs) {
  console.log(`${run.id} (${run.dataSet}${run.save ? `, from ${run.save}` : ', a new game'}):`);
  const recorded = await recordRun(run, 'csbwin-runs');
  const { recording, page } = recorded;
  const kinds = new Map<string, number>();
  for (const { change } of recording.changes) kinds.set(change.kind, (kinds.get(change.kind) ?? 0) + 1);
  console.log(`  played: ${recorded.entries} entries, ${recording.vbls} VBLs, d.Time ${page.game.ctx.state.tickCount}, ${recording.changes.length} changes`);
  console.log(`  ${[...kinds].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  check(recorded.drift === null, `${run.id} plays to its end, every entry's random CSBWin's${recorded.drift ? `: drifts at ${recorded.drift}` : ''}`);
  if (run.end === 'won') {
    check(recorded.won === true, `${run.id} fuses Lord Chaos: the game ends won`);
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
}
finish();
