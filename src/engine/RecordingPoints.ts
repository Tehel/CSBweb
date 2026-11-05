/**
 * The points the page's store keeps that its player plays and shares
 * (`doc/RECORDING.md` → "Shared recordings"): a save whose recording the store holds up to
 * the save's point (`SaveEntry.recording`), and a recording the game's end ended
 * (`RecordingEntry.end`), won or lost. The dialog the book opens lists them, the
 * browser's recordings of a set (`src/ui/welcomePage.ts`), and `?recording=` plays them
 * (`playRecording`, `src/main.ts`).
 *
 * **Nothing in this file touches the DOM.**
 */
import { readRecordingPath, type RecordingEntry, type RecordingStore, type SaveEntry, type SaveStore } from '../data/saves';
import { VBL_FREQUENCY } from '../core/constants';
import { readCsbwinSaveInfo } from '../data/CsbwinSaveInfo';
import { packageStart, pathAtEnd, pathAtSave, playedWithExtras, type RecordingPackageInfo, type RecordingPackageStart } from './RecordingPackage';
import type { RecordingEnding } from '../data/DataSets';
import type { SavedStamp } from './InputBoundary';
import type { Recording, RecordingPoint } from './Recorder';
import { cutPlace } from './RecordingCut';
import type { SavedAtEnd } from './RecordingPlayer';

/** A point the store keeps: a save made in a recording it holds, or a game's end. */
export type StoredPoint =
    | { readonly kind: 'save'; readonly save: SaveEntry & { readonly recording: NonNullable<SaveEntry['recording']> } }
    | { readonly kind: 'end'; readonly recording: RecordingEntry & { readonly end: NonNullable<RecordingEntry['end']> } };

/** A save's point the store keeps. */
export type StoredSave = Extract<StoredPoint, { kind: 'save' }>;

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
 * The points of `points` a list shows, `rows` the store's: each that no other passes on
 * its way, the path to it no beginning of another's. A Sleepsave, a save F5 made and F9
 * read, a save the game went on from to a later one or to its end: the point past it
 * plays it whole. Of two at one place, the latest made.
 */
export function shownPoints(points: readonly StoredPoint[], rows: readonly RecordingEntry[]): StoredPoint[] {
    const held = new Map(rows.map((row) => [row.id, row]));
    return points.filter((point) => !points.some((other) => other !== point && passes(other, point, held)));
}

/** Where `point` is: a save's point, or the game's end at its recording's last VBL. */
function placeOf(point: StoredPoint): RecordingPoint {
    return point.kind === 'save' ? point.save.recording
        : { recording: point.recording.id, changes: point.recording.changes, vbls: point.recording.vbls };
}

/**
 * Whether the path to `later` passes `earlier`: up the joins of its branches
 * (`RecordingEntry.parent`) to `earlier`'s recording, a join there at or past its place;
 * in that recording itself, past it, or at it and made later.
 */
function passes(later: StoredPoint, earlier: StoredPoint, held: ReadonlyMap<string, RecordingEntry>): boolean {
    const to = placeOf(earlier);
    for (let at: RecordingPoint | null | undefined = placeOf(later), branched = false; at; at = held.get(at.recording)?.parent, branched = true) {
        if (at.recording !== to.recording) continue;
        const order = placeOrder(at, to);
        return order > 0 || order === 0 && (branched || pointMadeAt(later) > pointMadeAt(earlier));
    }
    return false;
}

/**
 * The order of two places in one recording: by its VBLs, then a place taken inside its
 * last VBL before one taken after it, then by its changes.
 */
function placeOrder(a: RecordingPoint, b: RecordingPoint): number {
    return a.vbls - b.vbls || Number(!a.inVbl) - Number(!b.inVbl) || a.changes - b.changes;
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

/**
 * What a list shows of a point: what its package would say of it, its build, whether an
 * extra was on, and where its path ends, `null` where that is not known (a site's
 * recording the server has not read it of yet).
 */
export interface PointInfo extends Omit<RecordingPackageInfo, 'title' | 'author' | 'description' | 'start'> {
    /** Where its path starts; a save's level `null` where it is not known before the cut is made (`wayInfo`). */
    readonly start: RecordingPackageStart | { readonly kind: 'save'; readonly level: null };
    readonly build: string;
    readonly extras: boolean;
    readonly ending: RecordingEnding | null;
}

/**
 * What a list shows of `point`, whose path is `path` (`pointPath`), `rows` the store's:
 * when its path's root began, when it was made, the game's play time then, where its
 * path starts, the build that made it, whether an extra was on, its party, and where it
 * ends. A game's end the store wrote before it kept its play time has 0, and before it
 * kept its party none.
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
        ending: point.kind === 'save' ? 'save' : point.recording.end.word11694 ? 'won' : 'lost',
        ...(point.kind === 'save' ? { champions: point.save.champions }
            : point.recording.champions ? { champions: point.recording.champions } : {}),
    };
}

/**
 * The saves of `points` the path to `point` passes on its way (`passes`), `rows` the
 * store's: those `shownPoints` leaves out for it, F5's, a save F9 read, a Sleepsave the
 * game went on from; the earliest first.
 */
export function savesOnTheWay(point: StoredPoint, points: readonly StoredPoint[], rows: readonly RecordingEntry[]): StoredSave[] {
    const held = new Map(rows.map((row) => [row.id, row]));
    return points.filter((other): other is StoredSave => other !== point && other.kind === 'save' && passes(point, other, held))
        .sort((a, b) => pointMadeAt(a) - pointMadeAt(b));
}

/**
 * A save the path to a point passes, which FROM and TO offer (`wayPoints`): one whose tail
 * its recording logged (`saveWritten`), F5's and the disk menu's, or one a branch on the
 * path read, at its join, whether or not the store still keeps its row; or one the store
 * keeps a row of alone, the Sleepsave's, whose tail no change logs.
 */
export interface WayPoint {
    /**
     * What `?from=`, `&to=` and the dialog's note name it by: `<recording>:<change>` for a
     * tail, its recording's id and the tail's index; `<branch>:join` for a join; `save:<row>`
     * for a row alone.
     */
    readonly id: string;
    /** It can start a path (`cutPlace`): a tail or a join, not a row alone. */
    readonly start: boolean;
    /**
     * Where it is, which a path is cut at (`cutAtSave`, `pathToWay`): its row's point, or
     * its tail's VBL, the file made there the save's (`cutPlace`).
     */
    readonly point: RecordingPoint;
    /** Its place on the path: its recording's index, and its change's, -1 for a join. */
    readonly order: readonly [number, number];
    /** The VBLs from the path's start to it. */
    readonly vbls: number;
    /** The save's row, where the store still keeps it there. */
    readonly row: StoredSave | null;
    /** What is known of it: its row's, its tail's (`SavedStamp`), or a join's file's level alone. */
    readonly said: { readonly savedAt: number | null; readonly playTime: number | null; readonly level: number | null };
}

/**
 * The saves the path to `point`, `path` (`pointPath`), passes (`WayPoint`), of `points`,
 * `rows` the store's, in the path's order: each tail its recordings logged, each join of a
 * branch on it, and each save of `points` it passes that is neither (`savesOnTheWay`).
 */
export function wayPoints(point: StoredPoint, path: readonly Recording[], points: readonly StoredPoint[], rows: readonly RecordingEntry[]): WayPoint[] {
    const saves = savesOnTheWay(point, points, rows);
    const used = new Set<StoredSave>();
    const rowAt = (at: RecordingPoint, exact: boolean) => {
        const found = saves.find((save) => !used.has(save) && save.save.recording.recording === at.recording && save.save.recording.changes === at.changes
            && (exact ? save.save.recording.vbls === at.vbls && (save.save.recording.inVbl === true) === (at.inVbl === true) : save.save.recording.inVbl !== true)) ?? null;
        if (found) used.add(found);
        return found;
    };
    const said = (row: StoredSave | null, stamp: SavedStamp | undefined, level: number | null = null): WayPoint['said'] => row
        ? { savedAt: row.save.savedAt, playTime: row.save.playTime, level: row.save.level }
        : { savedAt: stamp?.savedAt ?? null, playTime: stamp?.playTime ?? null, level: stamp?.level ?? level };
    const ways: WayPoint[] = [];
    let before = 0;
    path.forEach((recording, n) => {
        const join = recording.parent;
        if (n > 0 && join) {
            const row = rowAt(join, true);
            const level = recording.start.kind === 'save' ? readCsbwinSaveInfo(recording.start.bytes)?.level ?? null : null;
            ways.push({ id: `${recording.id}:join`, start: true, point: join, order: [n, -1], vbls: before, row, said: said(row, undefined, level) });
        }
        recording.changes.forEach((entry, change) => {
            if (entry.change.kind !== 'saveWritten') return;
            const row = rowAt({ recording: recording.id, changes: change, vbls: entry.vbl }, false);
            const at = row?.save.recording ?? { recording: recording.id, changes: change, vbls: entry.vbl };
            ways.push({
                id: `${recording.id}:${change}`, start: cutPlace(path, at) !== null, point: at, order: [n, change],
                vbls: before + entry.vbl, row, said: said(row, entry.change.saved),
            });
        });
        before += recording.vbls;
    });
    for (const save of saves) {
        if (used.has(save)) continue;
        const at = save.save.recording;
        const n = path.findIndex((recording) => recording.id === at.recording);
        if (n < 0) continue;
        const into = path.slice(0, n).reduce((sum, recording) => sum + recording.vbls, 0) + at.vbls;
        ways.push({ id: `${SAVE_POINT_PREFIX}${save.save.id}`, start: false, point: at, order: [n, at.changes], vbls: into, row: save, said: said(save, undefined) });
    }
    return ways.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.vbls - b.vbls);
}

/**
 * Where a path to a point that starts at `start`, `null` for its own start, can end, of
 * `ways` (`wayPoints`): each after `start`, not at its place, the latest first; the point
 * itself, which is not among them, is the first choice.
 */
export function wayEnds(ways: readonly WayPoint[], start: WayPoint | null): WayPoint[] {
    return ways.filter((way) => start === null || way.order[0] > start.order[0]
        || way.order[0] === start.order[0] && way.order[1] > start.order[1] && way.vbls > start.vbls).reverse();
}

/**
 * The path a package holds to `way` on `path` (`pointPath`'s to a later point): cut at its
 * point (`pathAtSave`), or, a join, its parent's to the join.
 */
export function pathToWay(path: readonly Recording[], way: WayPoint): Recording[] {
    const n = way.order[0];
    if (way.order[1] < 0) return path.slice(0, n);
    return pathAtSave(path.slice(0, n + 1), way.point);
}

/**
 * The save a path to `way` ends at (`SavedAtEnd`), where its file is known: its row's,
 * read from `saves`, or the file the branch at a join read, or its MD5 a package's names;
 * `null` where only a play to it makes it (`fileAtEnd`).
 */
export async function savedAtWay(way: WayPoint, path: readonly Recording[], saves: Pick<SaveStore, 'read'>): Promise<SavedAtEnd | null> {
    const inVbl = way.point.inVbl === true;
    if (way.row) return { file: await saves.read(way.row.save.id), inVbl };
    const start = way.order[1] < 0 ? path[way.order[0]]?.start : undefined;
    if (start?.kind === 'save') return { file: start.bytes, inVbl };
    if (start?.kind === 'join') return { md5: start.md5, inVbl };
    return null;
}

/**
 * What a list shows of the path to `end`, `point` itself or one of its ways, from
 * `start`, `null` for its own start, `path` the path to `point` (`pointPath`), `endPath`
 * the path to `end`, `rows` the store's: as `pointInfo` says `point`; a way's when it was
 * made and its play time where they are known, else as far as the VBLs tell; a path
 * started at a save, begun when it was made, the time played since it, from its level
 * where it is known.
 */
export function wayInfo(
    point: StoredPoint, end: WayPoint | null, start: WayPoint | null, path: readonly Recording[], endPath: readonly Recording[], rows: readonly RecordingEntry[],
): PointInfo {
    const whole = pointInfo(point, endPath, rows);
    const vblMs = (vbls: number) => Math.round(vbls * 1000 / VBL_FREQUENCY);
    const madeAt = (way: WayPoint) => way.said.savedAt ?? rows.find((row) => row.id === way.point.recording)?.recordedAt ?? whole.recordedAt;
    const { champions: _, ...known } = whole;
    const endInfo: PointInfo = end === null ? whole : {
        ...known,
        endedAt: Math.max(madeAt(end), whole.recordedAt),
        playTime: end.said.playTime ?? vblMs(end.vbls),
        ending: 'save',
        ...(end.row ? { champions: end.row.save.champions } : {}),
    };
    if (!start) return endInfo;
    const endVbls = end?.vbls ?? path.reduce((sum, recording) => sum + recording.vbls, 0);
    const endPlay = end ? end.said.playTime : whole.playTime;
    return {
        ...endInfo,
        recordedAt: Math.min(madeAt(start), endInfo.endedAt),
        playTime: start.said.playTime !== null && endPlay !== null ? Math.max(0, endPlay - start.said.playTime) : vblMs(endVbls - start.vbls),
        start: start.said.level === null ? { kind: 'save', level: null } : { kind: 'save', level: start.said.level, champions: start.row?.save.champions ?? [] },
    };
}
