/**
 * A path cut at a save on its way (`doc/RECORDING.md` → "A path cut at a save",
 * `src/engine/RecordingCut.ts`): each corpus package (`tools/lib/recordingCorpus.ts`) cut at
 * each of its saves by the page's own code, then played to its end with no drift.
 *
 * Each save the path passes is a start: a save made in a recording, whose tail
 * (`saveWritten`) is its next change, F5's and the disk menu's under a held clock; and each
 * join, a branch that read a save (`tools/checks/replay.ts`, point 8, cuts at a branch that
 * read a Sleepsave).
 * For each, `cutAtSave` replays the path headless to the save in a page without the DOM
 * (`standInPage`, `src/renderer/StandInPage.ts`), takes the state there (`CutState`), and
 * cuts the path; the cut is packaged at the package's own point (`packageOfPath`), written,
 * read back with its state equal, and played from the package alone to the point: a save's
 * file made again there, or the game's end reached.
 *
 * And what is carried is needed: the attack menu (`interface`) and the champion selected
 * (`selected`), each set as the read leaves them, drift (DMMovie42's first save, where the
 * party dies without its attack menu); so does a game from `dungeon.dat` given the game
 * information a read gives it (`noGameInfo`), its next save another file; and a save
 * whose next change is not its tail, or taken inside a VBL away from a join, the
 * Sleepsave's, is no start. A disk menu's save taken VBLs before its tail, as the page's is,
 * the clock held between, is one, the file made at the tail still the save's.
 *
 *   npm test -- --only=recording-cut.ts                         every package, every save
 *   npm test -- --only=recording-cut.ts DMMovie42 --saves=0-4    one package's saves 0 to 4
 *   npm test -- --only=recording-cut.ts --not=DMMovie42          every other package
 *
 * DMMovie42's nine saves each replay its whole game, about ten seconds: the gate runs them
 * as jobs of their own (`tools/run-checks.ts`).
 */
import { readFileSync } from 'node:fs';

import { findRecordingSet } from '../../src/data/RecordingSet';
import { saveFileOf } from '../../src/engine/GameSaves';
import { applySaveBytes } from '../../src/engine/SaveGameFile';
import type { Recording, RecordingPoint } from '../../src/engine/Recorder';
import { cutStateOf, type CutState } from '../../src/engine/CutState';
import { cutAtSave, cutPlace } from '../../src/engine/RecordingCut';
import { packageOfPath, readRecordingPackage, writeRecordingPackage, type RecordingPackage } from '../../src/engine/RecordingPackage';
import type { SavedAtEnd } from '../../src/engine/RecordingPlayer';
import { cutPageOf, standInPage } from '../../src/renderer/StandInPage';
import { check, finish } from '../lib/check';
import { DATA_SETS, diskFiles, diskSetDigests } from '../lib/dataSets';
import { playPath } from '../lib/playback';
import { CORPUS_DIR, CORPUS_FILE, corpusFiles } from '../lib/recordingCorpus';

const args = process.argv.slice(2);
const named = args.filter((arg) => !arg.startsWith('--'));
const not = args.find((arg) => arg.startsWith('--not='))?.slice('--not='.length) ?? null;
const range = /^--saves=(\d+)-(\d+)$/.exec(args.find((arg) => arg.startsWith('--saves=')) ?? '');
const [first, last] = range ? [Number(range[1]), Number(range[2])] : [0, Infinity];

/** `value` as JSON, each object's keys in order: two equal values the same text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => typeof field === 'object' && field !== null && !Array.isArray(field)
    ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b))) : field);
}

/** A variant of a cut whose root carries less: `field` as a fresh read of its file leaves it. */
type Less = keyof Pick<CutState, 'interface' | 'selected' | 'noGameInfo'>;

/**
 * The variants each package's save `index` is played with besides the cut itself, each to
 * drift: what is carried is needed.
 */
const LESS: Record<string, Record<number, Less[]>> = {
  'DMMovie42': { 0: ['interface', 'selected'] },
  'CSBFullRecordingV4': { 0: ['selected'] },
  'replay-new-game-branch': { 0: ['noGameInfo'] },
};

/**
 * The package's save cut again from a point `LATE_VBLS` before its tail, as the page's disk
 * menu takes it, its tail run once the store has written the file (`GameSaves.save`).
 */
const LATE_TAIL: Record<string, number> = { 'DMMovie42': 0 };
const LATE_VBLS = 3;

const digests = await diskSetDigests();
const files = corpusFiles().filter((file) => {
  const name = CORPUS_FILE.exec(file)?.[1] ?? '';
  return (named.length === 0 || named.includes(name)) && name !== not;
});
check(files.length > 0, `the corpus holds a package to cut${named.length ? ` named ${named.join(', ')}` : ''}`);

for (const file of files) {
  const name = CORPUS_FILE.exec(file)![1]!;
  const pkg = await readRecordingPackage(new Uint8Array(readFileSync(`${CORPUS_DIR}/${file}`)));
  const found = findRecordingSet(pkg.path, digests);
  const set = DATA_SETS.find((one) => one.id === (found.kind === 'refused' ? pkg.dataSet : found.id));
  if (!set) {
    check(false, `${file}'s set is one of the disk's`);
    continue;
  }
  const setFiles = diskFiles(set);
  const stand = async () => cutPageOf(await standInPage(set, setFiles));
  const savedAtEnd: SavedAtEnd | null = pkg.shared.kind === 'save' ? pkg.shared : null;

  // Every save the path passes: each join, and each save whose tail is its next change.
  const saves: { point: RecordingPoint; kind: 'join' | 'tail' }[] = [];
  pkg.path.forEach((recording) => {
    if (recording.parent) saves.push({ point: recording.parent, kind: 'join' });
    recording.changes.forEach((entry, change) => {
      if (entry.change.kind === 'saveWritten') saves.push({ point: { recording: recording.id, changes: change, vbls: entry.vbl }, kind: 'tail' });
    });
  });
  saves.sort((a, b) => pkg.path.findIndex((one) => one.id === a.point.recording) - pkg.path.findIndex((one) => one.id === b.point.recording)
    || a.point.vbls - b.point.vbls);
  console.log(`${file}: ${set.id}, ${saves.length} save${saves.length === 1 ? '' : 's'} on its path, to ${pkg.shared.kind === 'save' ? 'a save' : 'the game\'s end'}`);

  for (const [index, { point, kind }] of saves.entries()) {
    if (index < first || index > last) continue;
    const what = `${name}'s save ${index} (${kind === 'join' ? `a join${point.inVbl ? ', inside a VBL' : ''}` : 'its tail next'}, ${point.recording} at change ${point.changes}, VBL ${point.vbls})`;
    const place = cutPlace(pkg.path, point);
    check(place?.kind === kind, `${what} is a start, ${kind === 'join' ? 'its branch\'s own' : 'after its tail'}`);
    if (place?.kind !== kind) continue;
    const started = Date.now();
    let cut: Recording[];
    try {
      cut = await cutAtSave(pkg.path, point, null, stand);
    } catch (error) {
      check(false, `${what} cuts: ${(error as Error).message}`);
      continue;
    }
    const root = cut[0]!;
    if (root.start.kind !== 'save' || !root.start.carried) {
      check(false, `${what}'s cut starts from a save, with what its read left`);
      continue;
    }
    check(kind === 'join' ? root.start.carried.cut === undefined : root.start.carried.cut !== undefined,
      `${what}'s cut carries ${kind === 'join' ? 'what its branch\'s read left alone' : 'what its read loses'}`);
    const cutAt = Date.now();

    // Through the package's form: written, read back, and played from it alone.
    const written = await writeRecordingPackage(packageOfPath(cut, pkg.shared, pkg.info, { recordedAt: 0, endedAt: 0, playTime: 0 }));
    let read: RecordingPackage;
    try {
      read = await readRecordingPackage(written);
    } catch (error) {
      check(false, `${what}'s package reads back: ${(error as Error).message}`);
      continue;
    }
    const readRoot = read.path[0]!;
    check(readRoot.start.kind === 'save' && canonical(readRoot.start.carried) === canonical(root.start.carried)
      && read.path.length === cut.length && readRoot.changes.length === root.changes.length,
    `${what}'s package reads back as written, ${read.path.length} recording${read.path.length === 1 ? '' : 's'}`);
    const played = await playPath(set, setFiles, read.path, savedAtEnd);
    check(played.drift === null, `${what}'s cut plays to the package's ${pkg.shared.kind === 'save' ? 'save' : 'end'}${played.drift ? `: it drifts, ${JSON.stringify(played.drift)}` : ''}`);
    console.log(`  ${what}: ${root.changes.length} changes and ${root.vbls} VBLs from it, ${Math.round(written.length / 1024)} KB, `
      + `cut in ${((cutAt - started) / 1000).toFixed(1)} s, played in ${((Date.now() - cutAt) / 1000).toFixed(1)} s${played.drift ? ', DRIFTS' : ''}`);

    // The browser's disk menu: its point taken VBLs before its tail, the clock held between.
    if (kind === 'tail' && LATE_TAIL[name] === index) {
      const tail = point.vbls;
      const early: RecordingPoint = { ...point, vbls: tail - LATE_VBLS };
      const at = pkg.path.find((one) => one.id === point.recording)!;
      const { game } = await playPath(set, setFiles, [...pkg.path.slice(0, pkg.path.indexOf(at)),
        { ...at, changes: at.changes.slice(0, point.changes), vbls: early.vbls, ended: true, end: null }]);
      const held = game.ctx.state.paused;
      const file = saveFileOf(game, 'stopped', (champion) => game.ctx.host.portraitOf(champion));
      let lateCut: Recording[] | null = null;
      try {
        lateCut = await cutAtSave(pkg.path, early, file, stand);
      } catch (error) {
        check(false, `${what}, its point ${LATE_VBLS} VBLs before its tail, cuts: ${(error as Error).message}`);
      }
      const lateRoot = lateCut?.[0];
      const latePlayed = lateCut && await playPath(set, setFiles, lateCut, savedAtEnd);
      check(held && cutPlace(pkg.path, early)?.kind === 'tail' && lateRoot?.changes.length === root.changes.length && lateRoot.vbls === root.vbls
        && latePlayed?.drift === null,
      `${what}, its point taken ${LATE_VBLS} VBLs before its tail under the menu's held clock, as a browser's disk menu takes it, is a start: the file made at the tail still the save's, the cut the same, played to its end`);
    }

    for (const less of LESS[name]?.[index] ?? []) {
      const carried = root.start.carried;
      if (!carried.cut) continue;
      // The field as a fresh read of the save's file leaves it.
      const fresh = await standInPage(set, setFiles);
      applySaveBytes(fresh.game, root.start.bytes);
      const lessCut: CutState = { ...carried.cut, [less]: cutStateOf(fresh.game)[less] };
      const variant: Recording[] = [{ ...root, start: { ...root.start, carried: { ...carried, cut: lessCut } } }, ...cut.slice(1)];
      const drifted = await playPath(set, setFiles, variant, savedAtEnd);
      check(drifted.drift !== null, `${what}'s cut drifts without ${less} carried`);
      console.log(`    without ${less}: ${drifted.drift ? `drifts, ${JSON.stringify(drifted.drift)}` : 'plays to its end'}`);
    }
  }
}

// What is no start: a save whose next change is not its tail, and a point taken inside a
// VBL away from a join, the Sleepsave's, whose tail no change logs.
const sleep = await readRecordingPackage(new Uint8Array(readFileSync(`${CORPUS_DIR}/replay-csbgame7-sleepsave.L0.gz`)));
const [root, branch] = sleep.path;
if (root && branch) {
  check(root.changes[0]?.change.kind !== 'saveWritten' && cutPlace(sleep.path, { recording: root.id, changes: 0, vbls: root.changes[0]!.vbl }) === null,
    'a point whose next change is not a save\'s tail is no start');
  check(branch.changes[1]?.change.kind === 'saveWritten' && cutPlace(sleep.path, { recording: branch.id, changes: 1, vbls: branch.changes[1].vbl, inVbl: true }) === null,
    'a point taken inside a VBL is no start but at a join');
} else {
  check(false, 'replay-csbgame7-sleepsave is a root and a branch');
}

finish();
