/**
 * The page's proofs of its unlocks (`src/engine/achievements/PageProofs.ts`,
 * `doc/ACHIEVEMENTS.md` → "Proofs"), without the DOM or the server: the page's routes stood in.
 *
 * Asserts:
 *   1. the verdicts a row takes (`judgedRows`): verified once a proof that claims it
 *      verified it, whatever the others say; dropped once every proof that claims it was
 *      replayed and none did; unverified with the reason while one drifted and none
 *      verified it; unchanged while one is queued; a verified or dropped row, and one no
 *      proof claimed, never asked for (`pendingProofs`);
 *   2. what a proof claims (`claimableRows`): the playthrough's rows its history holds,
 *      none verified or dropped, none of another playthrough or set, none of a branch the
 *      history left;
 *   3. when the page sends: a save whose history holds an unlock no proof claimed, sent
 *      with its claims, each row keeping the proof's id; another save within ten minutes,
 *      or one with nothing new, sends nothing; past ten minutes, a new unlock sends again,
 *      claiming every row not judged; the game's end sends whatever it claims; a player
 *      with no public name sends nothing; `refresh` writes the verdicts and reads the
 *      dialog's again, and asks nothing once none awaits one; the figures across games: a
 *      save whose figures grew past the last proof's sends a proof claiming nothing, past
 *      ten minutes and not within them, one whose figures did not grow nothing, and the
 *      game's end whose figures grew sends though it claims nothing;
 *   4. the package of a save the page's stores keep (`storedPackage`): the corpus recording
 *      `replay-saves-written-over` as the store holds it, its save's file made again
 *      (`fileAtEnd`), packed as the book's UPLOAD packs a point, and replayed by the
 *      verifier's `replayProof`: First Blood, and its kill among its figures; and the latest
 *      game's end of the set, packed at its end;
 *   5. a CSB adventure's start, replayed by `replayProof`: the corpus's whole CSB game,
 *      which begins at the adventure CSBWin's utility made, unlocks Speed Runner, which
 *      needs the whole game, with the achievements of `csb.txt`.
 *
 * Usage: npm test -- --only=achievement-proofs.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProofVerdict } from '../../src/data/DataSets';
import { claimableRows, judgedRows, memoryAchievementStore, pendingProofs, type AchievementRow } from '../../src/data/saves/AchievementStore';
import type { RecordingEntry } from '../../src/data/saves/RecordingStore';
import { readSaveFileFields, type SaveEntry } from '../../src/data/saves/SaveStore';
import { setAchievementDefs } from '../../src/engine/achievements/PageAchievements';
import { PageProofs, PROOF_INTERVAL_MS, storedPackage, type ProofsDeps } from '../../src/engine/achievements/PageProofs';
import { replayProof } from '../../src/engine/achievements/ProofReplay';
import type { TrackerSnapshot } from '../../src/engine/achievements/AchievementTracker';
import { AchievementState, type GameFigures } from '../../src/engine/achievements/AchievementState';
import type { Recording } from '../../src/engine/Recorder';
import { fileAtEnd } from '../../src/engine/RecordingCut';
import { readRecordingPackage } from '../../src/engine/RecordingPackage';
import { fileDigest } from '../../src/data/DataSetFiles';
import { cutPageOf, standInPage } from '../../src/renderer/StandInPage';
import { check, finish } from '../lib/check';
import { DATA_SETS, dataSetNamed, diskFiles, diskSetDigests } from '../lib/dataSets';
import { CORPUS_DIR } from '../lib/recordingCorpus';
import { packageOf } from '../lib/recordingPackages';

const COMMON = setAchievementDefs(readFileSync(join(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8'), null);

/** A row of `dm`'s playthrough 7, unverified, of no proof. */
function rowOf(id: string, more: Partial<AchievementRow> = {}): AchievementRow {
    return { dataSet: 'dm', id, playthrough: 7, unlockedAt: 0, playTime: 0, gameTime: 0, champions: [], proof: 'unverified', ...more };
}

const verdict = (id: string, state: ProofVerdict['state'], claims: ProofVerdict['claims'], reason?: string): ProofVerdict =>
    ({ id, state, ...(reason ? { reason } : {}), claims });

// 1. The verdicts.
console.log('The verdicts:');
const rows = [
    rowOf('a', { proofs: ['P1', 'P2'] }), rowOf('b', { proofs: ['P1', 'P2'] }), rowOf('c', { proofs: ['P1'] }),
    rowOf('d', { proofs: ['P3'] }), rowOf('e', { proofs: ['P4'] }), rowOf('f'), rowOf('g', { proof: 'verified', proofs: ['P5'] }),
];
check(JSON.stringify(pendingProofs(rows)) === '["P1","P2","P3","P4"]', 'the proofs awaited: those of the unverified rows, each once, none of a verified row\'s');
const judged = judgedRows(rows, [
    verdict('P1', 'checked', { a: 'dropped', b: 'dropped', c: 'dropped' }),
    verdict('P2', 'checked', { a: 'verified', b: 'dropped' }),
    verdict('P3', 'drifted', { d: 'unverified' }, 'the game drifts from the recording'),
    verdict('P4', 'queued', { e: 'unverified' }),
]);
console.log(`  ${JSON.stringify(judged.map((row) => [row.id, row.proof, row.drift ?? null]))}`);
check(JSON.stringify(judged.map((row) => [row.id, row.proof, row.drift ?? null]))
    === '[["a","verified",null],["b","dropped",null],["c","dropped",null],["d","unverified","the game drifts from the recording"]]',
    'verified by one proof of two; dropped by both; dropped by its one; unverified with the drift\'s reason; a queued one unchanged');
check(judgedRows(rows, [verdict('P2', 'checked', { b: 'dropped' })]).every((row) => row.id !== 'b'), 'dropped only once every proof that claims it was replayed');

// 2. What a proof claims.
const held = [rowOf('a'), rowOf('b', { proof: 'verified' }), rowOf('c', { playthrough: 8 }), rowOf('d', { dataSet: 'csb' }), rowOf('e'), rowOf('f', { proof: 'dropped' })];
check(JSON.stringify(claimableRows(held, 'dm', 7, new Set(['a', 'b', 'c', 'd', 'f'])).map((row) => row.id)) === '["a"]',
    'a proof claims the playthrough\'s rows its history holds, none verified or dropped, none of another playthrough or set, none its history left');

// 3. When the page sends.
console.log('\nWhen the page sends:');
const store = memoryAchievementStore();
let clock = 1_000_000;
let named = true;
const sent: { claims: readonly string[]; point: string }[] = [];
let asked: (readonly string[])[] = [];
let answers: ProofVerdict[] = [];
let reads = 0;
let lastPoint = '';
const deps: ProofsDeps = {
    named: async () => named,
    send: async (_bytes, claims) => {
        sent.push({ claims, point: lastPoint });
        return `P${String(sent.length).padStart(15, '0')}`;
    },
    ask: async (ids) => {
        asked.push(ids);
        return answers.filter((answer) => ids.includes(answer.id));
    },
    packageOf: async (point) => {
        lastPoint = point === 'end' ? 'end' : point.id;
        return new Uint8Array([1]);
    },
    now: () => clock,
    log: (message, error) => console.log(`  log: ${message} ${error}`),
};
const unlocked = new Set<string>();
/** The common file's kills across games, a `total(…)`'s count, by its key. */
const KILLS = COMMON.find((def) => def.id === 'dungeon-janitor')!.aggregates[0]!.key;
/** The live game's figures, the game's end's. */
let liveFigures: GameFigures = {};
const proofs = new PageProofs({
    playthrough: 7, settled: async () => {}, readProofs: async () => { reads++; }, tracker: { unlocked },
    figuresOf: (_playthrough, snapshot) => (snapshot === null ? liveFigures : AchievementState.restore(COMMON, snapshot).figures()),
}, 'dm', store, deps);
/** A save of playthrough 7 whose history holds `ids`, and `kills` kills. */
function saveOf(name: string, ids: readonly string[], kills = 0): SaveEntry {
    const state = { v: 1, whole: true, unlocked: ids, vbls: 0, samples: {}, aggregates: { [KILLS]: kills }, unknown: [] } as const;
    const snapshot = { v: 1, state, missiles: [], clouds: [], causes: [] } satisfies TrackerSnapshot;
    return {
        id: name, name, dataSet: 'dm', playthrough: 7, quick: false, sleep: false, savedAt: clock, usedAt: clock, playTime: 0, level: 0,
        champions: [], unofficial: false, recording: null, achievements: snapshot,
    };
}
const proofsOf = async (id: string) => (await store.list('dm')).find((row) => row.id === id)?.proofs ?? [];

await store.unlock(rowOf('first-blood'));
await proofs.saved(saveOf('s1', ['first-blood']));
check(sent.length === 1 && JSON.stringify(sent[0]) === '{"claims":["first-blood"],"point":"s1"}' && JSON.stringify(await proofsOf('first-blood')) === '["P000000000000001"]',
    'a save after a new unlock: its package sent claiming it, the row keeping the proof\'s id');
await store.unlock(rowOf('own-goal'));
clock += PROOF_INTERVAL_MS - 1;
await proofs.saved(saveOf('s2', ['first-blood', 'own-goal']));
check(sent.length === 1, 'a save with a new unlock within ten minutes: nothing sent');
clock += 1;
await proofs.saved(saveOf('s3', ['first-blood']));
check(sent.length === 1, 'a save whose history holds no unlock unclaimed: nothing sent');
await proofs.saved(saveOf('s4', ['first-blood', 'own-goal']));
check(sent.length === 2 && JSON.stringify(sent[1]) === '{"claims":["first-blood","own-goal"],"point":"s4"}'
    && JSON.stringify(await proofsOf('first-blood')) === '["P000000000000001","P000000000000002"]',
    'past ten minutes, a new unlock: sent, claiming every row not judged');
named = false;
await store.unlock(rowOf('scrooge'));
clock += PROOF_INTERVAL_MS;
await proofs.saved(saveOf('s5', ['first-blood', 'own-goal', 'scrooge']));
check(sent.length === 2, 'a player with no public name: nothing sent');
named = true;
unlocked.add('first-blood').add('own-goal').add('scrooge');
await proofs.ended();
check(sent.length === 3 && JSON.stringify(sent[2]) === '{"claims":["first-blood","own-goal","scrooge"],"point":"end"}',
    'the game\'s end sends at once whatever its history claims');

answers = [
    verdict('P000000000000001', 'checked', { 'first-blood': 'verified' }),
    verdict('P000000000000002', 'checked', { 'first-blood': 'verified', 'own-goal': 'dropped' }),
    verdict('P000000000000003', 'checked', { 'first-blood': 'verified', 'own-goal': 'dropped', scrooge: 'dropped' }),
];
const changed = await proofs.refresh();
const after = Object.fromEntries((await store.list('dm')).map((row) => [row.id, row.proof]));
console.log(`  asked ${JSON.stringify(asked)}; the rows then ${JSON.stringify(after)}`);
check(changed === 3 && JSON.stringify(after) === '{"first-blood":"verified","own-goal":"dropped","scrooge":"dropped"}' && reads === 1,
    'refresh writes the verdicts, and the dialog\'s are read again');
asked = [];
check(await proofs.refresh() === 0 && asked.length === 0, 'and asks nothing once no row awaits one');
await proofs.ended();
check(sent.length === 3, 'a game\'s end whose unlocks are all verified or dropped sends nothing');

const unlockedNow = ['first-blood', 'own-goal', 'scrooge'];
clock += PROOF_INTERVAL_MS;
await proofs.saved(saveOf('k1', unlockedNow, 120));
check(sent.length === 4 && JSON.stringify(sent[3]) === '{"claims":[],"point":"k1"}', 'a save whose figures grew, 120 kills: sent, claiming nothing');
clock += PROOF_INTERVAL_MS - 1;
await proofs.saved(saveOf('k2', unlockedNow, 130));
check(sent.length === 4, 'within ten minutes, its figures grown: nothing sent');
clock += 1;
await proofs.saved(saveOf('k3', unlockedNow, 120));
check(sent.length === 4, 'past them, its figures no larger than the last proof\'s: nothing sent');
await proofs.saved(saveOf('k4', unlockedNow, 130));
check(sent.length === 5 && JSON.stringify(sent[4]) === '{"claims":[],"point":"k4"}', 'past them, its figures grown: sent');
liveFigures = { [`total(${KILLS})`]: 130 };
await proofs.ended();
check(sent.length === 5, 'the game\'s end, its figures the last proof\'s: nothing sent');
liveFigures = { [`total(${KILLS})`]: 131 };
await proofs.ended();
check(sent.length === 6 && JSON.stringify(sent[5]) === '{"claims":[],"point":"end"}', 'the game\'s end, a kill more: sent at once, claiming nothing');

// 4. The package of a save the store keeps.
console.log('\nA save the store keeps, packed:');
const corpus = await readRecordingPackage(new Uint8Array(readFileSync(join(CORPUS_DIR, 'replay-saves-written-over.L5.gz'))));
if (corpus.shared.kind !== 'save' || corpus.path.length !== 1) throw new Error('replay-saves-written-over is no longer one recording shared at a save');
const root: Recording = corpus.path[0]!;
const set = dataSetNamed(corpus.dataSet);
const file = await fileAtEnd(corpus.path, async () => cutPageOf(await standInPage(set, diskFiles(set))));
check(fileDigest(file) === corpus.shared.md5, 'the save\'s file made again by playing the recording to its point');
const entryOf = (recording: Recording, more: Partial<RecordingEntry> = {}): RecordingEntry => ({
    id: recording.id, dataSet: recording.dataSet, build: recording.build, level: recording.level, profile: recording.profile, parent: recording.parent,
    playthrough: 1, recordedAt: 1000, writtenAt: 2000, vbls: recording.vbls, ended: recording.ended, end: recording.end,
    changes: recording.changes.length, parts: 1, ...more,
});
const fields = readSaveFileFields(file);
if (!fields) throw new Error('the save\'s file does not read');
const save: SaveEntry = {
    id: 'kept', name: 'KEPT', dataSet: corpus.dataSet, quick: true, sleep: false, savedAt: 3000, usedAt: 3000, playTime: 4000,
    unofficial: false, recording: { recording: root.id, changes: root.changes.length, vbls: root.vbls, ...(corpus.shared.inVbl ? { inVbl: true } as const : {}) },
    achievements: null, ...fields,
};
const sources = {
    flush: async () => {},
    recordings: { list: async () => [entryOf(root)], read: async (id: string) => { if (id !== root.id) throw new Error(`no recording ${id}`); return root; } },
    saves: { list: async () => [save], read: async () => file },
};
const packed = await storedPackage(save, corpus.dataSet, sources);
const read = packed && await readRecordingPackage(packed);
check(read !== null && read.shared.kind === 'save' && read.shared.md5 === corpus.shared.md5 && read.info.title === 'Proof' && read.info.playTime === 4000,
    'the save packed as UPLOAD packs it: its file\'s MD5, titled Proof, its play time the row\'s');
const sets = (await diskSetDigests()).map((digests) => {
    const one = DATA_SETS.find((candidate) => candidate.id === digests.id)!;
    return { set: one, files: diskFiles(one), digests };
});
const replayed = packed && await replayProof(packed, Infinity, sets, () => COMMON);
console.log(`  replayed: ${JSON.stringify(replayed)}`);
check(replayed?.kind === 'checked' && replayed.unlocked.includes('first-blood') && replayed.figures[`total(${KILLS})`] === 2,
    'and the verifier\'s replay of it unlocks First Blood, its two kills among its figures');
check(await storedPackage({ ...save, recording: { ...save.recording!, changes: root.changes.length + 1 } }, corpus.dataSet, sources) === null,
    'a save whose recording the store holds not that far: no package');

const won = (await readRecordingPackage(await packageOf('dm-atari', 'Won'))).path[0]!;
const ends = {
    ...sources,
    recordings: {
        list: async () => [entryOf(won, { id: 'older', endedAt: 5000 }), entryOf(won, { endedAt: 6000 }), entryOf(root)],
        read: async (id: string) => ({ ...won, id }),
    },
};
const ended = await storedPackage('end', 'dm-atari', ends);
const endRead = ended && await readRecordingPackage(ended);
check(endRead?.shared.kind === 'end' && endRead.path.length === 1 && endRead.path[0]!.id === won.id && endRead.info.endedAt === 6000,
    'the game\'s end: the latest the store keeps of the set, packed at its end');
check(await storedPackage('end', 'csb', ends) === null, 'and none of a set with no game\'s end: no package');

// 5. A CSB adventure's start, replayed.
console.log('\nA CSB adventure\'s start, replayed:');
const csbDefs = setAchievementDefs(readFileSync(join(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8'),
    readFileSync(join(import.meta.dirname, '../../src/engine/achievements/defs/csb.txt'), 'utf8'));
const csbGame = new Uint8Array(readFileSync(join(CORPUS_DIR, 'CSBFullRecordingV4.L5.gz')));
const csbReplayed = await replayProof(csbGame, Infinity, sets, (setId) => (setId === 'csb' ? csbDefs : null));
console.log(`  replayed: ${JSON.stringify(csbReplayed)}`);
check(csbReplayed.kind === 'checked' && csbReplayed.unlocked.includes('speed-runner'),
    'the whole CSB game, from the adventure\'s start, unlocks Speed Runner, which needs the whole game');

finish();
