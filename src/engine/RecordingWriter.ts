/**
 * The recordings written to their store as they grow (`RecordingStore`,
 * `doc/RECORDING.md` → "The port's recorder"). Most games end with the page closed, not
 * with a read, so a recording is written while it runs: at each `flush`, which the page
 * calls every few seconds and as it is hidden, the row and the changes recorded since the
 * last. A recording a read has replaced is finished at the next.
 *
 * Nothing is written of a recording before its first change or the game's end: the
 * boot's DM rules are a recording's first, so what this leaves out is a read straight
 * over another.
 *
 * A branch is written as one only where the store holds its parent up to the point it
 * names: a save whose recording was never written, or not that far (a page closed before
 * its write), is read as a root, which plays from its own start alone. The recordings
 * replaced are written before the one running, so a parent this page played is in the
 * store before its branch's first write.
 *
 * What no save, no game's end and no running game reaches is pruned (`doc/RECORDING.md` →
 * "The tree"):
 * at a recording's first write, which follows the read that began it, and at a save
 * deleted or written over (`prune`). A game running in another tab is no game this page
 * plays, so its recording can be cut or removed here; its own page finds it so at its
 * next write (`RecordingPrunedError`) and writes it whole again.
 *
 * The clock is the page's (`RecordingWriterDeps`), and so are the ids (`Recorder`): the
 * engine reads neither.
 */
import {
    RecordingPrunedError, readSaveFileFields,
    type RecordingEntry, type RecordingPart, type RecordingStore, type SaveStore,
} from '../data/saves';
import type { Recorder, Recording, RecordingPoint, RecordingStart } from './Recorder';

export interface RecordingWriterDeps {
    /** Milliseconds since the epoch. */
    now(): number;
    /** The game's play time (`Game.playTime`). */
    playTime(): number;
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
    /** When the game's end ended it, and the game's play time then (`Recorder.onEnd`); `null` before. */
    ending: { readonly endedAt: number; readonly playTime: number } | null;
}

/** How far a recording is reached: its changes and its VBLs, up to a point. */
type Reach = Omit<RecordingPoint, 'recording'>;

/** What a prune does to the store: the recordings it removes, and those it cuts at a point. */
export interface PrunePlan {
    readonly remove: readonly string[];
    readonly cut: readonly { readonly id: string; readonly point: Reach }[];
}

/**
 * What no save, no game's end and no running game reaches, among `rows`. A recording is
 * reached up to the last point a save (`points`) or a branch kept names in it, and one
 * the game's end ended (`RecordingEntry.end`) and the running one, `running`, whole,
 * with their parents. One reached nowhere is removed, and with it what its parent was
 * reached by, up its path; one reached short of what the store holds is cut at its last
 * point.
 */
export function prunePlan(
    rows: readonly RecordingEntry[],
    points: readonly (RecordingPoint | null)[],
    running: Pick<Recording, 'id' | 'parent'> | null,
): PrunePlan {
    let kept = [...rows];
    for (;;) {
        const reach = new Map<string, Reach>();
        const reachTo = (point: RecordingPoint | null | undefined) => {
            if (!point) return;
            const was = reach.get(point.recording);
            reach.set(point.recording, {
                changes: Math.max(was?.changes ?? 0, point.changes),
                vbls: Math.max(was?.vbls ?? 0, point.vbls),
            });
        };
        for (const point of points) reachTo(point);
        reachTo(running?.parent);
        for (const row of kept) {
            reachTo(row.parent);
            if (row.end) reachTo({ recording: row.id, changes: row.changes, vbls: row.vbls });
        }
        const next = kept.filter((row) => row.id === running?.id || reach.has(row.id));
        if (next.length < kept.length) {
            kept = next;
            continue;
        }
        const cut: { id: string; point: Reach }[] = [];
        for (const row of kept) {
            const to = reach.get(row.id);
            if (row.id === running?.id || !to || (to.changes >= row.changes && to.vbls >= row.vbls)) continue;
            cut.push({ id: row.id, point: { changes: Math.min(to.changes, row.changes), vbls: Math.min(to.vbls, row.vbls) } });
        }
        const keptIds = new Set(kept.map((row) => row.id));
        return { remove: rows.filter((row) => !keptIds.has(row.id)).map((row) => row.id), cut };
    }
}

/**
 * What no save of `saves`, no game's end and no running game, `running`, reaches among
 * `store`'s recordings, removed or cut (`prunePlan`): the page's writer's prune, and the
 * welcome page's once a game's end is deleted, where no game runs.
 */
export async function pruneRecordings(
    store: RecordingStore, saves: Pick<SaveStore, 'list'>, running: Pick<Recording, 'id' | 'parent'> | null,
): Promise<void> {
    const points = (await saves.list(null)).map((entry) => entry.recording);
    const plan = prunePlan(await store.list(), points, running);
    for (const id of plan.remove) await store.remove(id);
    for (const { id, point } of plan.cut) await store.cut(id, point);
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
    /** A prune is owed, once what the store has not is written. */
    private pruneDue = false;

    /** `saves` are the page's, whose points reach into the recordings (`SaveEntry.recording`). */
    constructor(
        private readonly recorder: Recorder,
        private readonly store: RecordingStore,
        private readonly saves: SaveStore,
        private readonly deps: RecordingWriterDeps,
    ) {
        recorder.onBegin((previous) => {
            if (this.current && previous) this.finishing.push({ written: this.current, recording: previous });
            this.current = {
                id: recorder.recording!.id, recordedAt: deps.now(), playthrough: null, parent: null,
                changes: 0, parts: 0, vbls: 0, ended: false, ending: null,
            };
        });
        recorder.onEnd(() => {
            if (this.current) this.current.ending = { endedAt: deps.now(), playTime: deps.playTime() };
        });
    }

    /**
     * Writes what the store has not of the recordings replaced and of the one running,
     * once the flush before has ended, then prunes where it is owed. A write that fails is
     * written again at the next, and the prune with it.
     */
    flush(): Promise<void> {
        const run = () => this.writeAll();
        this.writing = this.writing.then(run, run);
        return this.writing;
    }

    /** A save has been deleted or written over: the store pruned, once it is written. */
    prune(): Promise<void> {
        this.pruneDue = true;
        return this.flush();
    }

    private async writeAll(): Promise<void> {
        for (let next = this.finishing[0]; next; next = this.finishing[0]) {
            await this.write(next.written, next.recording);
            this.finishing.shift();
        }
        const recording = this.recorder.recording;
        if (this.current && recording) await this.write(this.current, recording);
        if (this.pruneDue) await this.pruneStore();
    }

    private async write(written: Written, recording: Recording, rewrite = false): Promise<void> {
        const { vbls, ended, end } = recording;
        // The running recording's own list, which grows while the store writes.
        const changes = recording.changes.slice();
        if (changes.length === 0 && !end) return;
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
            vbls, ended, end, ...(end && written.ending), changes: changes.length, parts: seq,
        };
        try {
            await this.store.write(entry, parts, first ? null : { parts: written.parts, changes: written.changes });
        } catch (error) {
            if (first || !(error instanceof RecordingPrunedError)) throw error;
            // Another tab's prune has cut or removed it: written whole again, which owes no prune.
            written.parts = 0;
            written.changes = 0;
            return this.write(written, recording, true);
        }
        written.changes = changes.length;
        written.parts = seq;
        written.vbls = vbls;
        written.ended = ended;
        if (first && !rewrite) this.pruneDue = true;
    }

    /** `parent`, where the store holds its recording up to it; `null` otherwise. */
    private async parentHeld(parent: RecordingPoint | null): Promise<RecordingPoint | null> {
        if (!parent) return null;
        const held = (await this.store.list()).find((entry) => entry.id === parent.recording);
        return held && held.changes >= parent.changes && held.vbls >= parent.vbls ? parent : null;
    }

    private async pruneStore(): Promise<void> {
        await pruneRecordings(this.store, this.saves, this.recorder.recording);
        this.pruneDue = false;
    }
}
