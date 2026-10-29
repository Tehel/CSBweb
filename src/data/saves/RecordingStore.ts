/**
 * The recordings as the page keeps them (`doc/RECORDING.md` → "The port's recorder"),
 * beside the saves: a row each, what a list needs, and its parts, written as the
 * recording grows (`RecordingWriter`, `src/engine/RecordingWriter.ts`).
 *
 * A recording is written in parts so that a write adds only what is new: its head, the
 * first part, holds its start, its rules and its extras, and each part after it the
 * changes recorded since the one before. The row says how many parts there are, and is
 * written with each, in one transaction, so a row never names a part the store has not.
 * What no save reaches is cut or removed (`RecordingWriter`'s prune), so a write after
 * the first holds the row against what its page last wrote of it, another tab's prune
 * being able to cut it in between.
 *
 * **Nothing in this file touches the DOM**: `tools/checks/replay.ts` runs it over a
 * store in memory.
 */
import type { Extras, RulesOptions } from '../../engine/GameContext';
import type { RecordedChange, Recording, RecordingEnd, RecordingPoint, RecordingStart } from '../../engine/Recorder';

/** One row: a recording as a list shows it, without its start or its changes. */
export interface RecordingEntry {
    /** The row's key in the store, which its parts carry. */
    readonly id: string;
    /** The data set it was played on (`DataSet.id`). */
    readonly dataSet: string;
    /** The build that made it (`Recording.build`). */
    readonly build: string;
    /**
     * The point it branches from (`Recording.parent`), `null` for a root, and for one the
     * store's version 7 wrote before the tree, which has none.
     */
    readonly parent?: RecordingPoint | null;
    /** The playthrough it plays (`SaveEntry.playthrough`): its start's `d.RandomGameID`. */
    readonly playthrough: number;
    /** Milliseconds since the epoch: when it began. */
    readonly recordedAt: number;
    /** Milliseconds since the epoch: when it was last written. */
    readonly writtenAt: number;
    /** The VBLs it had run when it was last written (`Recording.vbls`). */
    readonly vbls: number;
    /** A read or the game's end has ended it (`Recording.ended`): nothing more will be written to it. */
    readonly ended: boolean;
    /**
     * The game's end, where it ended it (`Recording.end`), which the prune keeps whole,
     * whether a save reaches it or not. Absent from a row without one, as the store's
     * earlier rows.
     */
    readonly end?: RecordingEnd | null;
    /**
     * Milliseconds since the epoch: when the game's end ended it, for a row with an `end`;
     * absent otherwise, and from a row written before the store kept it.
     */
    readonly endedAt?: number;
    /**
     * The game's play time as its end ended it (`Game.playTime`), which a game's end
     * shared says (`RecordingPackageInfo.playTime`), as a save's row has its own; as
     * `endedAt`, for a row with an `end`.
     */
    readonly playTime?: number;
    /** Its changes, every part's. */
    readonly changes: number;
    /** Its parts: the head and the changes' parts. */
    readonly parts: number;
}

/** The first part: what the recording starts from. */
export interface RecordingHead {
    readonly id: string;
    readonly seq: 0;
    readonly start: RecordingStart;
    /** As the row's (`RecordingEntry.parent`). */
    readonly parent?: RecordingPoint | null;
    readonly rules: RulesOptions;
    readonly extras: Extras;
}

/** A part after the head: the changes recorded since the part before. */
export interface RecordingChanges {
    readonly id: string;
    /** From 1, in the order the changes were recorded. */
    readonly seq: number;
    readonly changes: readonly RecordedChange[];
}

export type RecordingPart = RecordingHead | RecordingChanges;

/**
 * What a page last wrote of a recording, which a write after it needs the store to hold
 * still (`RecordingStore.write`).
 */
export interface RecordingHeld {
    readonly parts: number;
    readonly changes: number;
}

/**
 * A write after the first found the row otherwise than its page last wrote it: another
 * page's prune has cut or removed it (`RecordingWriter`), a game running in another tab
 * being no game this page plays. Nothing was written.
 */
export class RecordingPrunedError extends Error {
    constructor(id: string) {
        super(`recording ${id} was pruned elsewhere`);
        this.name = 'RecordingPrunedError';
    }
}

export interface RecordingStore {
    /** Every row, the latest begun first. */
    list(): Promise<RecordingEntry[]>;
    /** The recording `id` names, its parts put back together. */
    read(id: string): Promise<Recording>;
    /**
     * `entry`, and the parts it has gained since it was last written, in one transaction.
     * `held` is what the page last wrote of it, which the row must still say, or nothing
     * is written and the write throws `RecordingPrunedError`; `null` at a first write,
     * which is written whole over whatever parts the id has.
     */
    write(entry: RecordingEntry, parts: readonly RecordingPart[], held: RecordingHeld | null): Promise<void>;
    /** The row and its parts, in one transaction. */
    remove(id: string): Promise<void>;
    /**
     * The recording `id` names cut at `point` (`cutRecording`), in one transaction:
     * nothing for a row that is gone.
     */
    cut(id: string, point: Omit<RecordingPoint, 'recording'>): Promise<void>;
}

/** Rows, the latest begun first. */
export function sortRecordingEntries(entries: RecordingEntry[]): RecordingEntry[] {
    return entries.sort((a, b) => b.recordedAt - a.recordedAt);
}

/** `entry`'s recording out of its parts, which must be all of them, in any order. */
export function assembleRecording(entry: RecordingEntry, parts: readonly RecordingPart[]): Recording {
    const sorted = [...parts].sort((a, b) => a.seq - b.seq);
    const head = sorted[0];
    if (!head || !('start' in head) || sorted.length !== entry.parts || sorted.some((part, n) => part.seq !== n)) {
        throw new Error('RECORDING DAMAGED');
    }
    const changes = sorted.slice(1).flatMap((part) => (part as RecordingChanges).changes);
    if (changes.length !== entry.changes) throw new Error('RECORDING DAMAGED');
    return {
        id: entry.id,
        build: entry.build,
        dataSet: entry.dataSet,
        start: head.start,
        parent: head.parent ?? null,
        rules: head.rules,
        extras: head.extras,
        changes,
        vbls: entry.vbls,
        ended: entry.ended,
        end: entry.end ?? null,
    };
}

/** What `cutRecording` leaves of a recording. */
export interface RecordingCut {
    /** The row, ended at the point. */
    readonly entry: RecordingEntry;
    /** The last part kept, cut at the point; `null` where the point falls between two parts. */
    readonly last: RecordingChanges | null;
    /** The first `seq` removed: every part from it on. */
    readonly removeFrom: number;
}

/**
 * `entry`'s recording cut at `point`, given its parts: the changes recorded before it
 * kept, the last part that holds some of them cut after them and the parts after it
 * removed, and the row ended there, at the point's VBLs, by no game's end.
 */
export function cutRecording(
    entry: RecordingEntry, parts: readonly RecordingPart[], point: Omit<RecordingPoint, 'recording'>,
): RecordingCut {
    const changesParts = parts.filter((part): part is RecordingChanges => part.seq > 0).sort((a, b) => a.seq - b.seq);
    let changes = 0;
    let kept = 1;
    let last: RecordingChanges | null = null;
    for (const part of changesParts) {
        if (changes >= point.changes) break;
        kept++;
        if (changes + part.changes.length <= point.changes) {
            changes += part.changes.length;
            continue;
        }
        last = { ...part, changes: part.changes.slice(0, point.changes - changes) };
        changes = point.changes;
    }
    const { endedAt: _endedAt, playTime: _playTime, ...row } = entry;
    return {
        entry: { ...row, changes, vbls: Math.min(entry.vbls, point.vbls), ended: true, end: null, parts: kept },
        last,
        removeFrom: kept,
    };
}

/**
 * The path `store` holds to the recording `id` names (`RecordingPlayer`): its root and the
 * branches down to it, each the child of the one before (`Recording.parent`), as far up
 * as the store holds the parents. Where it holds no parent, the path begins at the
 * branch, which plays from its own start.
 */
export async function readRecordingPath(store: Pick<RecordingStore, 'list' | 'read'>, id: string): Promise<Recording[]> {
    const held = new Set((await store.list()).map((entry) => entry.id));
    const path: Recording[] = [];
    for (let next: string | null = id; next !== null;) {
        const recording: Recording = await store.read(next);
        path.unshift(recording);
        const parent = recording.parent?.recording ?? null;
        next = parent !== null && held.has(parent) ? parent : null;
    }
    return path;
}
