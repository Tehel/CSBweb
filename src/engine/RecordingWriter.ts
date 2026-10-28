/**
 * The recordings written to their store as they grow (`RecordingStore`,
 * `doc/RECORDING.md` → "The port's recorder"). Most games end with the page closed, not
 * with a read, so a recording is written while it runs: at each `flush`, which the page
 * calls every few seconds and as it is hidden, the row and the changes recorded since the
 * last. A recording a read has replaced is finished at the next.
 *
 * Nothing is written of a recording before its first change: the boot's DM rules are a
 * recording's first, so what this leaves out is a read straight over another. Its first
 * write removes, past `RECORDINGS_KEPT`, the recordings begun earliest.
 *
 * A branch is written as one only where the store holds its parent up to the point it
 * names: a save whose recording was never written, or not that far (a page closed before
 * its write), is read as a root, which plays from its own start alone. The recordings
 * replaced are written before the one running, so a parent this page played is in the
 * store before its branch's first write.
 *
 * The clock is the page's (`RecordingWriterDeps`), and so are the ids (`Recorder`): the
 * engine reads neither.
 */
import {
    RECORDINGS_KEPT, readSaveFileFields,
    type RecordingEntry, type RecordingPart, type RecordingStore,
} from '../data/saves';
import type { Recorder, Recording, RecordingPoint, RecordingStart } from './Recorder';

export interface RecordingWriterDeps {
    /** Milliseconds since the epoch. */
    now(): number;
}

/** What the store has of a recording. */
interface Written {
    readonly id: string;
    readonly recordedAt: number;
    /** Read from its start at its first write. */
    playthrough: number | null;
    /** Its parent as written at its first write (`parentHeld`). */
    parent: RecordingPoint | null;
    /** Its changes written. */
    changes: number;
    /** Its parts written: 0 before its first write. */
    parts: number;
    vbls: number;
    ended: boolean;
}

/** `start`'s playthrough: a new game's `d.RandomGameID`, or the one its save's file holds. */
function playthroughOf(start: RecordingStart): number {
    return start.kind === 'new' ? start.randomGameID : readSaveFileFields(start.bytes)?.playthrough ?? 0;
}

export class RecordingWriter {
    /** What the store has of the recording running, or `null` before the first read. */
    private current: Written | null = null;
    /** The recordings a read has replaced, as they ended, with what the store has of them. */
    private readonly finishing: { written: Written; recording: Recording }[] = [];
    /** The flushes, one after the other. */
    private writing: Promise<void> = Promise.resolve();

    constructor(private readonly recorder: Recorder, private readonly store: RecordingStore, private readonly deps: RecordingWriterDeps) {
        recorder.onBegin((previous) => {
            if (this.current && previous) this.finishing.push({ written: this.current, recording: previous });
            this.current = {
                id: recorder.recording!.id, recordedAt: deps.now(), playthrough: null, parent: null,
                changes: 0, parts: 0, vbls: 0, ended: false,
            };
        });
    }

    /**
     * Writes what the store has not of the recordings replaced and of the one running,
     * once the flush before has ended. A write that fails is written again at the next.
     */
    flush(): Promise<void> {
        const run = () => this.writeAll();
        this.writing = this.writing.then(run, run);
        return this.writing;
    }

    private async writeAll(): Promise<void> {
        for (let next = this.finishing[0]; next; next = this.finishing[0]) {
            await this.write(next.written, next.recording);
            this.finishing.shift();
        }
        const recording = this.recorder.recording;
        if (this.current && recording) await this.write(this.current, recording);
    }

    private async write(written: Written, recording: Recording): Promise<void> {
        const { vbls, ended } = recording;
        // The running recording's own list, which grows while the store writes.
        const changes = recording.changes.slice();
        if (changes.length === 0) return;
        const first = written.parts === 0;
        if (!first && changes.length === written.changes && vbls === written.vbls && ended === written.ended) return;
        const { id } = written;
        const parts: RecordingPart[] = [];
        if (first) {
            // A view onto a larger buffer would be cloned whole.
            const start = recording.start.kind === 'save' ? { ...recording.start, bytes: recording.start.bytes.slice() } : recording.start;
            written.parent = await this.parentHeld(recording.parent);
            parts.push({ id, seq: 0, start, parent: written.parent, rules: recording.rules, extras: recording.extras });
        }
        let seq = Math.max(written.parts, 1);
        if (changes.length > written.changes) parts.push({ id, seq: seq++, changes: changes.slice(written.changes) });
        const playthrough = written.playthrough ??= playthroughOf(recording.start);
        const entry: RecordingEntry = {
            id, dataSet: recording.dataSet, build: recording.build, parent: written.parent, playthrough,
            recordedAt: written.recordedAt, writtenAt: this.deps.now(),
            vbls, ended, changes: changes.length, parts: seq,
        };
        await this.store.write(entry, parts);
        written.changes = changes.length;
        written.parts = seq;
        written.vbls = vbls;
        written.ended = ended;
        if (first) await this.prune();
    }

    /** `parent`, where the store holds its recording up to it; `null` otherwise. */
    private async parentHeld(parent: RecordingPoint | null): Promise<RecordingPoint | null> {
        if (!parent) return null;
        const held = (await this.store.list()).find((entry) => entry.id === parent.recording);
        return held && held.changes >= parent.changes && held.vbls >= parent.vbls ? parent : null;
    }

    /** The recordings past `RECORDINGS_KEPT`, the earliest begun, removed. */
    private async prune(): Promise<void> {
        const entries = await this.store.list();
        for (const entry of entries.slice(RECORDINGS_KEPT)) await this.store.remove(entry.id);
    }
}
