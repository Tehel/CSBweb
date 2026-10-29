/**
 * The browser's points the book's RECORDINGS tab lists (`shownPoints`,
 * `src/engine/RecordingPoints.ts`; `doc/RECORDING.md` → "The browser's points"): those
 * no other passes on its way. A tree of rows and saves, as the store holds them, made
 * up for each case: a Sleepsave the game went on from, a save F9 read, a save its game's
 * end followed are left out; points on diverging branches, and a point past a branch's
 * join, are each listed.
 *
 * Run: `npm test -- --only=recording-points.ts`
 */
import type { RecordingEntry, SaveEntry } from '../../src/data/saves';
import type { RecordingPoint } from '../../src/engine/Recorder';
import { pointRecordingId, shownPoints, storedPoints } from '../../src/engine/RecordingPoints';
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

finish();
