/**
 * The points the page's store keeps that its player plays and shares (`DEBT.md` G31,
 * `doc/RECORDING.md` → "Shared recordings"): a save whose recording the store holds up to
 * the save's point (`SaveEntry.recording`), and a recording the game's end ended
 * (`RecordingEntry.end`), won or lost. The dialog the book opens lists them, the
 * browser's recordings of a set (`src/ui/welcomePage.ts`), and `?recording=` plays them
 * (`playRecording`, `src/main.ts`).
 *
 * **Nothing in this file touches the DOM.**
 */
import { readRecordingPath, type RecordingEntry, type RecordingStore, type SaveEntry } from '../data/saves';
import { packageStart, pathAtEnd, pathAtSave, playedWithExtras, type RecordingPackageInfo } from './RecordingPackage';
import type { Recording } from './Recorder';

/** A point the store keeps: a save made in a recording it holds, or a game's end. */
export type StoredPoint =
    | { readonly kind: 'save'; readonly save: SaveEntry & { readonly recording: NonNullable<SaveEntry['recording']> } }
    | { readonly kind: 'end'; readonly recording: RecordingEntry & { readonly end: NonNullable<RecordingEntry['end']> } };

/**
 * What `?recording=` names a save's point by: its row's id after this. No recording's id
 * takes the form, the store's being two base-36 numbers and the site's hexadecimal
 * (`SHARED_RECORDING_ID`).
 */
export const SAVE_POINT_PREFIX = 'save:';

/**
 * The points of `dataSet` among `saves` and `rows`, the store's, the latest made first:
 * each save whose recording the store holds up to its point, and each recording the
 * game's end ended.
 */
export function storedPoints(saves: readonly SaveEntry[], rows: readonly RecordingEntry[], dataSet: string): StoredPoint[] {
    const held = new Map(rows.map((row) => [row.id, row]));
    const points: StoredPoint[] = [];
    for (const save of saves) {
        const point = save.recording;
        const row = point && held.get(point.recording);
        if (save.dataSet === dataSet && point && row && row.changes >= point.changes && row.vbls >= point.vbls) {
            points.push({ kind: 'save', save: { ...save, recording: point } });
        }
    }
    for (const row of rows) {
        if (row.dataSet === dataSet && row.end) points.push({ kind: 'end', recording: { ...row, end: row.end } });
    }
    return points.sort((a, b) => pointMadeAt(b) - pointMadeAt(a));
}

/**
 * Milliseconds since the epoch: when `point` was made, the save or the game's end; a row
 * written before the store kept when its game ended says when it was last written.
 */
export function pointMadeAt(point: StoredPoint): number {
    return point.kind === 'save' ? point.save.savedAt : point.recording.endedAt ?? point.recording.writtenAt;
}

/** What `?recording=` names `point` by: a save's row after `SAVE_POINT_PREFIX`, a game's end its recording's id. */
export function pointRecordingId(point: StoredPoint): string {
    return point.kind === 'save' ? `${SAVE_POINT_PREFIX}${point.save.id}` : point.recording.id;
}

/**
 * The path `store` holds to `point` (`readRecordingPath`), as its package would hold it:
 * a save's cut at its point (`pathAtSave`), each recording before the last at its child's
 * join.
 */
export async function pointPath(store: Pick<RecordingStore, 'list' | 'read'>, point: StoredPoint): Promise<Recording[]> {
    return point.kind === 'save'
        ? pathAtSave(await readRecordingPath(store, point.save.recording.recording), point.save.recording)
        : pathAtEnd(await readRecordingPath(store, point.recording.id));
}

/** What a list shows of a point: what its package would say of it, its build, and whether an extra was on. */
export interface PointInfo extends Omit<RecordingPackageInfo, 'title' | 'author' | 'description'> {
    readonly build: string;
    readonly extras: boolean;
}

/**
 * What a list shows of `point`, whose path is `path` (`pointPath`), `rows` the store's:
 * when its path's root began, when it was made, the game's play time then, where its
 * path starts, the build that made it and whether an extra was on. A game's end the store
 * wrote before it kept its play time has 0.
 */
export function pointInfo(point: StoredPoint, path: readonly Recording[], rows: readonly RecordingEntry[]): PointInfo {
    const root = path[0]!;
    const last = path[path.length - 1]!;
    const endedAt = pointMadeAt(point);
    return {
        recordedAt: Math.min(rows.find((row) => row.id === root.id)?.recordedAt ?? endedAt, endedAt),
        endedAt,
        playTime: point.kind === 'save' ? point.save.playTime : point.recording.playTime ?? 0,
        start: packageStart(root),
        build: last.build,
        extras: playedWithExtras(path),
    };
}
