/**
 * The browser's points the book's RECORDINGS tab lists (`shownPoints`,
 * `src/engine/RecordingPoints.ts`; `doc/RECORDING.md` → "The browser's points"): those
 * no other passes on its way. A tree of rows and saves, as the store holds them, made
 * up for each case: a Sleepsave the game went on from, a save F9 read, a save its game's
 * end followed are left out; points on diverging branches, and a point past a branch's
 * join, are each listed.
 *
 * And the saves FROM and TO offer on a point's path (`wayPoints`): each save its
 * recordings logged the tail of, whether its row is kept or written over, by what its row
 * or its tail's stamp says, or by its time on the path where neither does; a save whose
 * tail came VBLs after its point, by its row's point; a branch's join; a Sleepsave by its
 * row alone, which only ends a path. Those after a start (`wayEnds`), the path to one
 * (`pathToWay`), and what the part from one to the point says (`wayInfo`).
 *
 * Run: `npm test -- --only=recording-points.ts`
 */
import type { RecordingEntry, SaveEntry } from '../../src/data/saves';
import { NO_EXTRAS } from '../../src/engine/GameContext';
import type { InputChange } from '../../src/engine/InputBoundary';
import type { RecordedChange, Recording, RecordingPoint } from '../../src/engine/Recorder';
import { pathToWay, pointRecordingId, shownPoints, storedPoints, wayEnds, wayInfo, wayPoints } from '../../src/engine/RecordingPoints';
import { check, finish } from '../lib/check';

const SET = 'csb';

/** A recording's row, branched from `parent`, ended by the game's end where `end`. */
function row(id: string, parent: RecordingPoint | null, end = false): RecordingEntry {
    return {
        id, dataSet: SET, build: 'check', parent, playthrough: 1, recordedAt: 0, writtenAt: 0, vbls: 1000, changes: 100,
        ended: end, ...(end ? { end: { word11694: false }, endedAt: 9000, playTime: 0 } : {}), parts: 2,
    };
}

/** A save made at `point`, at `savedAt`. */
function save(id: string, point: RecordingPoint, savedAt: number): SaveEntry {
    return {
        id, name: id, dataSet: SET, playthrough: 1, quick: false, sleep: point.inVbl === true, savedAt, usedAt: savedAt,
        playTime: 0, level: 1, champions: [], unofficial: false, recording: point,
    };
}

const at = (recording: string, vbls: number, inVbl = false): RecordingPoint =>
    ({ recording, changes: Math.floor(vbls / 10), vbls, ...(inVbl ? { inVbl: true as const } : {}) });

/** The ids of the points listed of `saves` and `rows`, sorted. */
function shown(saves: SaveEntry[], rows: RecordingEntry[]): string {
    return shownPoints(storedPoints(saves, rows, SET), rows)
        .map((point) => point.kind === 'save' ? point.save.id : pointRecordingId(point)).sort().join();
}

const cases: Array<[string, SaveEntry[], RecordingEntry[], string]> = [
    ['the Sleepsave the game went on from to a save is left out',
        [save('sleep', at('r', 100, true), 1), save('end', at('r', 200), 2)], [row('r', null)], 'end'],
    ['a save after the Sleepsave\'s VBL, at its counts, passes it',
        [save('sleep', at('r', 100, true), 1), save('after', at('r', 100), 2)], [row('r', null)], 'after'],
    ['the Sleepsave passes a save before its VBL, at its changes',
        [save('before', { recording: 'r', changes: 10, vbls: 99 }, 1), save('sleep', at('r', 100, true), 2)], [row('r', null)], 'sleep'],
    ['a save F9 read is left out for a save in its branch',
        [save('f5', at('r', 150), 1), save('later', at('k', 50), 2)], [row('r', null), row('k', at('r', 150))], 'later'],
    ['and a Sleepsave read, its branch joined inside its VBL',
        [save('sleep', at('r', 100, true), 1), save('later', at('k', 50), 2)], [row('r', null), row('k', at('r', 100, true))], 'later'],
    ['two branches of one save are each listed, the save left out',
        [save('f5', at('r', 150), 1), save('on', at('r', 200), 2), save('branch', at('k', 50), 3)],
        [row('r', null), row('k', at('r', 150))], 'branch,on'],
    ['a save past a branch\'s join is not passed by the branch, nor passes it',
        [save('past', at('r', 160), 1), save('branch', at('k', 50), 2)], [row('r', null), row('k', at('r', 150))], 'branch,past'],
    ['a save its game\'s end followed is left out, the end listed',
        [save('save', at('r', 200), 1)], [row('r', null, true)], 'r'],
    ['a save before a branch the game\'s end ended is left out',
        [save('save', at('r', 200), 1)], [row('r', null), row('k', at('r', 200), true)], 'k'],
    ['through a branch of a branch',
        [save('f5', at('r', 150), 1), save('mid', at('k', 50), 2), save('last', at('l', 30), 3)],
        [row('r', null), row('k', at('r', 150)), row('l', at('k', 50))], 'last'],
    ['of two saves at one place, the latest made',
        [save('first', at('r', 200), 1), save('second', at('r', 200), 2)], [row('r', null)], 'second'],
    ['a branch whose parent the store no longer holds passes nothing',
        [save('save', at('r', 200), 1), save('orphan', at('k', 50), 2)], [row('r', null), row('k', at('gone', 150))], 'orphan,save'],
];
for (const [what, saves, rows, expected] of cases) {
    const listed = shown(saves, rows);
    console.log(`${what}: ${listed}`);
    check(listed === expected, `${what} (${expected})`);
}

// A new game's root `r`: a save written over (its tail stamped), one older than the stamp
// (no stamp, no row), a menu save kept whose tail came two VBLs after its point, then a
// branch `k` F9 began at a save written over since, holding a Sleepsave and the point.
const RULES = {
    dmRules: false, dmRulesDesignOption: false, invisibleMonsters: false, drawAsSize4Monsters: false,
    simpleEncipher: false, supressDSAWarningOption: false, bGravityGame: false, bThreeDMovements: false,
};
const changesOf = (rows: [number, InputChange][]): RecordedChange[] => rows.map(([vbl, change]) => ({ change, vbl }));
const key: InputChange = { kind: 'key', num: 3 };
const root: Recording = {
    id: 'r', build: 'check', level: 0, profile: null, files: null, dataSet: SET, start: { kind: 'new', random: 1, randomGameID: 2 }, parent: null,
    rules: RULES, extras: NO_EXTRAS, ended: true, end: null, vbls: 400,
    changes: changesOf([[10, key], [100, { kind: 'saveWritten', saved: { savedAt: 5000, playTime: 60_000, level: 1 } }], [150, key],
        [200, { kind: 'saveWritten' }], [250, key], [300, { kind: 'saveWritten', saved: { savedAt: 7000, playTime: 120_000, level: 2 } }], [350, key]]),
};
const joinPoint: RecordingPoint = { recording: 'r', changes: 7, vbls: 400 };
const branch: Recording = {
    ...root, id: 'k', start: { kind: 'save', bytes: new Uint8Array(0), carried: { paused: false, loop: {} as never } }, parent: joinPoint, vbls: 600,
    changes: changesOf([[50, key], [100, key], [500, key]]),
};
const path = [root, branch];
const menu = save('menu', { recording: 'r', changes: 5, vbls: 298 }, 7000);
const sleeping = save('sleep', { recording: 'k', changes: 2, vbls: 300, inVbl: true }, 8000);
const last = { ...save('last', { recording: 'k', changes: 3, vbls: 600 }, 9000), playTime: 300_000 };
const tree = [{ ...row('r', null), changes: 7, vbls: 400 }, { ...row('k', joinPoint), changes: 3, vbls: 600 }];
const points = storedPoints([menu, sleeping, last], tree, SET);
const point = points.find((one) => one.kind === 'save' && one.save.id === 'last')!;
const ways = wayPoints(point, path, points, tree);
const listed = ways.map((way) => `${way.id}${way.start ? '' : '(end)'}@${way.vbls}`).join();
console.log(`ways: ${listed}`);
check(listed === 'r:1@100,r:3@200,r:5@300,k:join@400,save:sleep(end)@700',
    'FROM and TO offer each save the path logged the tail of, kept or written over, its join, and the Sleepsave by its row, only to end at');
const [written, older, kept, joined] = ways;
check(written?.row === null && written.said.savedAt === 5000 && written.said.playTime === 60_000 && written.said.level === 1,
    'a save written over is said by its tail\'s stamp');
check(older?.row === null && older.said.savedAt === null && older.said.playTime === null && older.said.level === null,
    'one older than the stamp says nothing but its time on the path');
check(kept?.row?.save.id === 'menu' && kept.point.vbls === 298 && kept.said.level === 1 && kept.start,
    'a save kept, its tail two VBLs after its point, is its row, at the row\'s point, and a start');
check(joined?.start === true && joined.point === joinPoint && joined.row === null, 'a branch\'s join is a start');
check(wayEnds(ways, older!).map((way) => way.id).join() === 'save:sleep,k:join,r:5', 'past a start, the saves after it, the latest first');
check(wayEnds(ways, null).length === ways.length, 'from the path\'s own start, every save');
const toOlder = pathToWay(path, older!);
check(toOlder.length === 1 && toOlder[0]!.changes.length === 3 && toOlder[0]!.vbls === 200, 'the path to a save is cut before its tail');
const toJoin = pathToWay(path, joined!);
check(toJoin.length === 1 && toJoin[0]!.changes.length === 7 && toJoin[0]!.vbls === 400, 'the path to a join is its parent\'s, to the join');
const from = wayInfo(point, null, written!, path, path, tree);
check(from.playTime === 240_000 && from.recordedAt === 5000 && from.start.kind === 'save' && from.start.level === 1,
    'from a save written over, the time played since its stamp\'s, begun when it was made, from its level');
const fromOlder = wayInfo(point, null, older!, path, path, tree);
check(fromOlder.playTime === Math.round(800 * 1000 / 60) && fromOlder.start.kind === 'save' && fromOlder.start.level === null,
    'from a save that says nothing, the time on the path since it, its level unknown');

finish();
