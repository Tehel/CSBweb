/**
 * The set a recording plays over, found by its files (`findRecordingSet`,
 * `src/data/RecordingSet.ts`, `doc/RECORDING.md` → "The set a recording plays
 * over"), against the repository's sets' files on disk, as the server's
 * `api/data-set-files` gives them (`diskSetDigests`), over the corpus's packages
 * (`tools/fixtures/recordings/`):
 *
 *   1. each package is found in its own set;
 *   2. one that names a set the site does not have, as a site's package names the site's
 *      set, is found in a set whose files have its digests;
 *   3. one whose set's file changed is found in another that has it, and where none has,
 *      refused, the refusal naming the file and the set;
 *   4. a path whose recordings read one file with two digests is refused;
 *   5. a path that names no file plays over its own set, the site's or not;
 *   6. the server's answer is read by the page's parser, which refuses a malformed one;
 *   7. every file a recording names is one the server digests (`GAME_FILES`).
 *
 *   npm test -- --only=recording-set.ts
 */
import { readFileSync } from 'node:fs';

import { GAME_FILES } from '../../src/data/DataSets';
import type { FileDigests } from '../../src/data/DataSetFiles';
import { findRecordingSet, parseSetDigests, type SetDigests } from '../../src/data/RecordingSet';
import { UTILITY_PORTRAITS_FILE } from '../../src/data/UtilityPortraits';
import { readRecordingPackage, type RecordingPackage } from '../../src/engine/RecordingPackage';
import { check, finish } from '../lib/check';
import { DATA_SETS, diskSetDigests } from '../lib/dataSets';
import { CORPUS_DIR, corpusFiles } from '../lib/recordingCorpus';

const sets = await diskSetDigests();
const packages = new Map<string, RecordingPackage>();
for (const file of corpusFiles()) packages.set(file, await readRecordingPackage(new Uint8Array(readFileSync(`${CORPUS_DIR}/${file}`))));
console.log(`${sets.length} sets, ${packages.size} packages`);

/** Whether `set` has every digest `path` names. */
const holds = (set: SetDigests | undefined, path: readonly { files: FileDigests | null }[]): boolean =>
  set !== undefined && path.every((recording) => Object.entries(recording.files ?? {}).every(([name, digest]) => set.files[name] === digest));
const setOf = (id: string): SetDigests | undefined => sets.find((set) => set.id === id);

console.log('\n1. Each package in its own set:');
for (const [file, pkg] of packages) {
  const found = findRecordingSet(pkg.path, sets);
  console.log(`  ${file}: ${pkg.dataSet} → ${found.kind === 'found' ? found.id : found.why}`);
  check(found.kind === 'found' && found.id === pkg.dataSet, `${file} plays over its own set, ${pkg.dataSet}`);
}

const run = packages.get('DMMovie2615.L0.gz');
if (!run) throw new Error('the corpus has no DMMovie2615.L0.gz');
const atari = setOf('dm-atari')!;
const renamed = run.path.map((recording) => ({ ...recording, dataSet: 'dungeon-master-csbwin' }));

console.log('\n2. A set the site does not have:');
const elsewhere = findRecordingSet(renamed, sets);
console.log(`  DMMovie2615 named dungeon-master-csbwin → ${elsewhere.kind === 'found' ? elsewhere.id : elsewhere.why}`);
check(elsewhere.kind === 'found' && holds(setOf(elsewhere.id), run.path) && elsewhere.id === sets.find((set) => holds(set, run.path))?.id,
  'it plays over the first set, in the manifest\'s order, whose files have its digests');

console.log('\n3. Its set\'s file changed:');
const changed = sets.map((set) => (set === atari ? { ...set, files: { ...set.files, 'dungeon.dat': '0'.repeat(32) } } : set));
const copy: SetDigests = { id: 'dm-copy', name: 'A copy', files: atari.files };
const moved = findRecordingSet(run.path, [...changed, copy]);
console.log(`  dm-atari's dungeon.dat changed, a later set holding the old one → ${moved.kind === 'found' ? moved.id : moved.why}`);
check(moved.kind === 'found' && moved.id === 'dm-copy', 'it plays over another set that has its files, where one has');
const none = changed.filter((set) => !holds(set, run.path));
const refused = findRecordingSet(run.path, none);
console.log(`  and no other has them → ${refused.kind === 'refused' ? refused.why : refused.id}`);
check(refused.kind === 'refused' && refused.mismatched.join() === 'dungeon.dat'
  && refused.why === `${atari.name}'s dungeon.dat no longer matches the recording, and no other set on this site holds its files.`,
  'and where none has, it is refused, the refusal naming the file of its set that no longer matches');
const both = findRecordingSet(run.path, none.map((set) => (set.id === 'dm-atari' ? { ...set, files: { ...set.files, 'graphics.dat': '1'.repeat(32) } } : set)));
check(both.kind === 'refused' && both.mismatched.join() === 'dungeon.dat,graphics.dat' && both.why.startsWith(`${atari.name}'s dungeon.dat, graphics.dat no longer match `),
  'two files that changed are both named');
const gone = findRecordingSet(renamed, none);
console.log(`  named dungeon-master-csbwin, and no set has its files → ${gone.kind === 'refused' ? gone.why : gone.id}`);
check(gone.kind === 'refused' && gone.why.includes('dungeon-master-csbwin, is not on this site'), 'a set the site does not have is said to be absent');

console.log('\n4. One file, two digests:');
const branch = packages.get('replay-new-game-branch.L0.gz')!;
const split = [branch.path[0]!, { ...branch.path[1]!, files: { ...branch.path[1]!.files, 'dungeon.dat': '2'.repeat(32) } }];
const conflict = findRecordingSet(split, sets);
console.log(`  a branch that read another dungeon.dat → ${conflict.kind === 'refused' ? conflict.why : conflict.id}`);
check(conflict.kind === 'refused' && conflict.mismatched.join() === 'dungeon.dat', 'no set has both, so it is refused');

console.log('\n5. A path that names no file:');
const unnamed = run.path.map((recording) => ({ ...recording, files: null }));
const plain = findRecordingSet(unnamed, []);
const plainElsewhere = findRecordingSet(unnamed.map((recording) => ({ ...recording, dataSet: 'dungeon-master-csbwin' })), sets);
check(plain.kind === 'found' && plain.id === 'dm-atari' && plainElsewhere.kind === 'found' && plainElsewhere.id === 'dungeon-master-csbwin',
  'it plays over its own set, whether the site has it or not');

console.log('\n6. The server\'s answer:');
const answer = JSON.stringify({ dataSets: sets.map((set) => ({ id: set.id, files: set.files })) });
const names = new Map(DATA_SETS.map((set) => [set.id, set.name]));
const parsed = parseSetDigests(answer, names);
check(JSON.stringify(parsed) === JSON.stringify(sets), `it reads back as the sets' digests (${Math.round(answer.length / 1024)} KB for ${sets.length} sets)`);
check(parseSetDigests(JSON.stringify({ dataSets: [{ id: 'x', files: {} }] }), names)[0]?.name === 'x', 'a set the manifest does not name is named by its id');
const refusal = (text: string): string => {
  try {
    parseSetDigests(text, names);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};
for (const [label, text] of [['not JSON', '{'], ['no list', '{}'], ['no id', '{"dataSets":[{"files":{}}]}'],
  ['a digest that is not MD5', `{"dataSets":[{"id":"a","files":{"dungeon.dat":"${'0'.repeat(64)}"}}]}`]] as const) {
  const why = refusal(text);
  console.log(`  ${label}: ${why}`);
  check(why.startsWith('The sets\' files\' digests are not usable: '), `${label} is refused, and the error says why`);
}

console.log('\n7. The files a recording names:');
const named = new Set([...packages.values()].flatMap((pkg) => pkg.path.flatMap((recording) => Object.keys(recording.files ?? {}))));
console.log(`  the corpus names ${[...named].sort().join(', ')}; the server digests ${GAME_FILES.join(', ')}`);
check([...named].every((name) => (GAME_FILES as readonly string[]).includes(name)) && (GAME_FILES as readonly string[]).includes(UTILITY_PORTRAITS_FILE),
  'every one is a file the server digests, RISE\'s portraits among them');
finish();
