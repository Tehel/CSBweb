/**
 * The recordings as the page keeps them (`doc/RECORDING.md` → "The port's recorder"),
 * beside the saves: a row each, what a list needs, and its parts, written as the
 * recording grows (`RecordingWriter`, `src/engine/RecordingWriter.ts`).
 *
 * A recording is written in parts so that a write adds only what is new: its head, the
 * first part, holds its start, its rules and its extras, and each part after it the
 * changes recorded since the one before. The row says how many parts there are, and is
 * written with each, in one transaction, so a row never names a part the store has not.
 *
 * **Nothing in this file touches the DOM**: `tools/checks/replay.ts` runs it over a
 * store in memory.
 */
import type { Extras, RulesOptions } from '../../engine/GameContext';
import type { RecordedChange, Recording, RecordingPoint, RecordingStart } from '../../engine/Recorder';

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
    /** A read has ended it (`Recording.ended`): nothing more will be written to it. */
    readonly ended: boolean;
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

export interface RecordingStore {
    /** Every row, the latest begun first. */
    list(): Promise<RecordingEntry[]>;
    /** The recording `id` names, its parts put back together. */
    read(id: string): Promise<Recording>;
    /** `entry`, and the parts it has gained since it was last written, in one transaction. */
    write(entry: RecordingEntry, parts: readonly RecordingPart[]): Promise<void>;
    /** The row and its parts, in one transaction. */
    remove(id: string): Promise<void>;
}

/** The recordings a store keeps: past them, the earliest begun are removed (`RecordingWriter`). */
export const RECORDINGS_KEPT = 20;

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
    };
}
