/**
 * The recordings players share (`DEBT.md` G31, `doc/RECORDING.md` → "Shared recordings"):
 * the store's `recordings` table (`store.ts`), a row each, and each package, the file the
 * page uploaded, kept whole in `RECORDINGS_DIR` as `<id>.gz` and served from there as
 * `RECORDING_FILES/<id>.gz` (`app.ts`). `app.ts` takes each request, names its asker
 * (`dataSetViewer`) and reads its body; this module decides.
 *
 *   GET  RECORDINGS_ROUTE?dataSet=<id>  the set's recordings `viewer` may see (`recordingsText`)
 *   POST RECORDINGS_ROUTE               a package shared, pending (`shareRecording`)
 *   POST RECORDINGS_ROUTE/<id>          one moderated, broken or withdrawn (`moderateRecording`)
 *
 * The server reads a package with the page's own reader, `readRecordingPackage`
 * (`src/engine/RecordingPackage.ts`), built for Node into its module (`READERS_MODULE`,
 * `app.ts`): it checks the package's form alone, and never replays it. Whether a
 * recording still plays on the site's build is the replay tool's to say, which marks one
 * that drifts as broken (`DEBT.md` G31).
 *
 * A recording is pending until a moderator approves it, as a set is: its title and
 * description are free text nobody else sees unread. An approved one is listed to
 * everyone, unless a moderator hid it or the replay tool broke it. Its uploader sees every
 * one of theirs, in whatever state, and deletes it whenever they like, a withdrawal; a
 * moderator sees every one. Ownership rests on the `playerId` alone, as a set's does
 * (`dataSets.ts`), so no answer holds one, and the package names its author by the name
 * the player gave, or by nobody.
 *
 * A package is never changed after: `backup.ts` copies each file once. Its id is drawn by
 * the server, sixteen uppercase hexadecimal digits (`SHARED_RECORDING_ID`), so whoever
 * holds a pending recording's file holds its id, which only its uploader and the
 * moderators are listed.
 */
import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { RECORDING_ACTIONS as ACTIONS, SHARED_RECORDING_ID, type RecordingAction } from '../src/data/DataSets.ts';
import { samePlayerId, type DataSetStore, type DataSetViewer } from './dataSets.ts';
import type { DataSetActivity, Notify } from './notify.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recordings (
    id           TEXT    PRIMARY KEY,  -- its file's name in RECORDINGS_DIR, without .gz
    data_set     TEXT    NOT NULL,     -- the set it plays (DataSet.id)
    build        TEXT    NOT NULL,     -- the build that made it
    title        TEXT    NOT NULL,
    author       TEXT    NOT NULL,     -- a name its player gave, '' for none
    description  TEXT    NOT NULL,
    recorded_at  INTEGER NOT NULL,     -- milliseconds since the epoch: when its root began
    ended_at     INTEGER NOT NULL,     -- and when its point was made
    play_time    INTEGER NOT NULL,     -- milliseconds: the game's play time at its point
    start        TEXT    NOT NULL,     -- a JSON RecordingPackageStart
    extras       INTEGER NOT NULL,     -- 1 where it was played with an extra on
    size         INTEGER NOT NULL,     -- its file's, in bytes
    uploader     TEXT    NOT NULL,     -- its uploader's playerId
    uploaded_at  INTEGER NOT NULL,
    status       TEXT    NOT NULL CHECK (status IN ('approved', 'pending')),
    hidden       INTEGER NOT NULL DEFAULT 0,
    broken       INTEGER NOT NULL DEFAULT 0  -- 1 once it drifts on the site's build
);
CREATE INDEX IF NOT EXISTS recordings_by_set ON recordings (data_set, uploaded_at);
`;

/** The largest package a recording is shared as, gzipped: an hour of a new game is 340 KB (`doc/RECORDING.md` → "What a package costs"). */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

/** The most a package may unzip to: an hour's is 930 KB. */
export const MAX_RECORDING_UNZIPPED_BYTES = 32 * 1024 * 1024;

/** The largest request `POST RECORDINGS_ROUTE` reads: a package, and the form around it. */
export const MAX_SHARE_BYTES = MAX_RECORDING_BYTES + 64 * 1024;

/** The largest body `POST RECORDINGS_ROUTE/<id>` reads. */
export const MAX_RECORDING_MODERATION_BYTES = 1024;

/** The form's one field: the package's file. */
export const PACKAGE_FIELD = 'package';

/**
 * What the server uses of a package, as `readRecordingPackage` (`src/engine/RecordingPackage.ts`)
 * reads it: typed here by its shape, since the page's sources are not erasable syntax and
 * the server's `tsc` cannot follow them, as `CheckDataSet` is (`publish.ts`); a tool that
 * hands the API the source's function proves that the two agree.
 */
export interface SharedPackage {
    readonly build: string;
    readonly dataSet: string;
    readonly info: {
        readonly title: string;
        readonly author: string;
        readonly description: string;
        readonly recordedAt: number;
        readonly endedAt: number;
        readonly playTime: number;
        readonly start: { readonly kind: string };
    };
    readonly path: readonly {
        /** Its extras at its start, each a flag (`Extras`). */
        readonly extras: object;
        readonly changes: readonly { readonly change: { readonly kind: string; readonly extras?: object } }[];
    }[];
}

/**
 * The page's reader of a package, `readRecordingPackage`: the package `bytes` hold, its
 * form checked, or an error that says what is wrong; refused where it unzips to more than
 * `limit` bytes.
 */
export type ReadRecordingPackage = (bytes: Uint8Array, limit: number) => Promise<SharedPackage>;

/** A row: what a list shows of a recording, and who may see it. */
export interface StoredRecording {
    id: string;
    dataSet: string;
    build: string;
    title: string;
    author: string;
    description: string;
    recordedAt: number;
    endedAt: number;
    playTime: number;
    /** Where it starts, as its package says (`RecordingPackageStart`). */
    start: unknown;
    extras: boolean;
    size: number;
    uploader: string;
    uploadedAt: number;
    pending: boolean;
    hidden: boolean;
    broken: boolean;
}

/** A recording's row, as `share` adds it: pending, shown and whole. */
export type SharedRecording = Omit<StoredRecording, 'pending' | 'hidden' | 'broken'>;

export class RecordingStore {
    /** The most the packages may take on the disk together, in bytes. */
    readonly diskBytes: number;
    private readonly rowsOf: StatementSync;
    private readonly row: StatementSync;
    private readonly total: StatementSync;
    private readonly insert: StatementSync;
    private readonly updateApproved: StatementSync;
    private readonly updateHidden: StatementSync;
    private readonly updateBroken: StatementSync;
    private readonly deleteRow: StatementSync;

    constructor(db: DatabaseSync, diskBytes: number) {
        this.diskBytes = diskBytes;
        db.exec(SCHEMA);
        const columns = 'id, data_set, build, title, author, description, recorded_at, ended_at, play_time, start, extras, size, uploader, uploaded_at, status, hidden, broken';
        this.rowsOf = db.prepare(`SELECT ${columns} FROM recordings WHERE data_set = ? ORDER BY uploaded_at DESC, id`);
        this.row = db.prepare(`SELECT ${columns} FROM recordings WHERE id = ?`);
        this.total = db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM recordings');
        this.insert = db.prepare(`INSERT INTO recordings (${columns}) VALUES (${columns.split(', ').map(() => '?').join(', ')})`);
        this.updateApproved = db.prepare("UPDATE recordings SET status = 'approved' WHERE id = ?");
        this.updateHidden = db.prepare('UPDATE recordings SET hidden = ? WHERE id = ?');
        this.updateBroken = db.prepare('UPDATE recordings SET broken = 1 WHERE id = ?');
        this.deleteRow = db.prepare('DELETE FROM recordings WHERE id = ?');
    }

    /** The recordings of the set `dataSet`, the latest shared first. */
    of(dataSet: string): StoredRecording[] {
        return (this.rowsOf.all(dataSet) as Record<string, string | number>[]).map(recordingOf);
    }

    get(id: string): StoredRecording | null {
        const row = this.row.get(id) as Record<string, string | number> | undefined;
        return row ? recordingOf(row) : null;
    }

    /** What the packages take together, in bytes. */
    bytes(): number {
        return (this.total.get() as { bytes: number }).bytes;
    }

    /** `recording` added, pending. */
    share(recording: SharedRecording): void {
        const { id, dataSet, build, title, author, description, recordedAt, endedAt, playTime, start, extras, size, uploader, uploadedAt } = recording;
        this.insert.run(id, dataSet, build, title, author, description, recordedAt, endedAt, playTime, JSON.stringify(start), extras ? 1 : 0, size,
            uploader, uploadedAt, 'pending', 0, 0);
    }

    approve(id: string): void {
        this.updateApproved.run(id);
    }

    setHidden(id: string, hidden: boolean): void {
        this.updateHidden.run(hidden ? 1 : 0, id);
    }

    /** `id` marked as drifting on the site's build: the list leaves it out but for its uploader and the moderators. */
    setBroken(id: string): void {
        this.updateBroken.run(id);
    }

    remove(id: string): void {
        this.deleteRow.run(id);
    }
}

function recordingOf(row: Record<string, string | number>): StoredRecording {
    return {
        id: row.id as string, dataSet: row.data_set as string, build: row.build as string, title: row.title as string,
        author: row.author as string, description: row.description as string, recordedAt: row.recorded_at as number,
        endedAt: row.ended_at as number, playTime: row.play_time as number, start: JSON.parse(row.start as string) as unknown,
        extras: row.extras === 1, size: row.size as number, uploader: row.uploader as string, uploadedAt: row.uploaded_at as number,
        pending: row.status === 'pending', hidden: row.hidden === 1, broken: row.broken === 1,
    };
}

/** Whether `viewer` shared `recording`. */
function sharedBy(recording: StoredRecording, viewer: DataSetViewer): boolean {
    return viewer.playerId !== null && samePlayerId(recording.uploader, viewer.playerId);
}

/**
 * The answer to `GET RECORDINGS_ROUTE?dataSet=<id>` for `viewer`: `{"recordings": […]}`, the
 * set's recordings they may see, the latest shared first. Everyone sees the approved ones
 * neither hidden nor broken, their uploader every one of theirs, and a moderator every
 * one. Each says its id, its build, its text, its times, where it starts, its package's
 * size and when it was shared; `"extras": true` where an extra was on, its state where it
 * is pending, hidden or broken, and `"mine": true` to its uploader, who may withdraw it.
 * None says its uploader.
 */
export function recordingsText(recordings: readonly StoredRecording[], viewer: DataSetViewer): string {
    const visible = recordings.filter((recording) => viewer.moderator !== null || sharedBy(recording, viewer)
        || (!recording.pending && !recording.hidden && !recording.broken));
    return JSON.stringify({
        recordings: visible.map((recording) => {
            const { id, build, title, author, description, recordedAt, endedAt, playTime, start, size, uploadedAt } = recording;
            return {
                id, build, title, author, description, recordedAt, endedAt, playTime, start, size, uploadedAt,
                ...(recording.extras ? { extras: true } : {}),
                ...(recording.pending ? { status: 'pending' } : {}),
                ...(recording.hidden ? { hidden: true } : {}),
                ...(recording.broken ? { broken: true } : {}),
                ...(sharedBy(recording, viewer) ? { mine: true } : {}),
            };
        }),
    });
}

/** The status and the JSON body a recording's route answers with. */
export interface RecordingAnswer {
    status: number;
    body: { id: string } | { error: string };
}

/** What `shareRecording` and `moderateRecording` need of the server. */
export interface RecordingOptions {
    recordings: RecordingStore;
    /** `RECORDINGS_DIR`: where the packages are kept. */
    dir: string;
    dataSets: DataSetStore;
    readPackage: ReadRecordingPackage;
    notify: Notify;
    /** The clock a recording is dated and a notification sent by. */
    now: () => number;
}

/** Whether a recording of `pkg`'s was played with an extra on: at a start, or turned on by a change. */
function playedWithExtras(pkg: SharedPackage): boolean {
    const on = (extras: object | undefined) => extras !== undefined && Object.values(extras).some((flag) => flag === true);
    return pkg.path.some((recording) => on(recording.extras) || recording.changes.some(({ change }) => change.kind === 'extras' && on(change.extras)));
}

/** The moves of the page's `?dev` (`devLevel`, `devMove`), which no game of CSBWin's holds. */
const DEV_CHANGES: ReadonlySet<string> = new Set(['devLevel', 'devMove']);

/**
 * `POST RECORDINGS_ROUTE`: `form`, sent by `playerId`, who does not moderate unless `sharer`
 * names them, checked and, where it passes, its package kept and its row added, pending.
 * `app.ts` has counted it against its address's rate, named its player and read the form,
 * a body of at most `MAX_SHARE_BYTES`. The rules, in order, each answered with nothing
 * written:
 *
 *   400  a form that is not the one file `PACKAGE_FIELD` alone
 *   413  a package over `MAX_RECORDING_BYTES`
 *   422  a package `readPackage` refuses, saying why, one that unzips past
 *        `MAX_RECORDING_UNZIPPED_BYTES` included; one of a set the site does not publish,
 *        pending or not in the table; one that holds a move of the page's `?dev`
 *   507  one that would take the packages past the disk they may take (`RecordingStore.diskBytes`)
 *
 * Then its file, written as `.<id>.partial`, which the server never serves (`pathSegments`),
 * and renamed `<id>.gz`, then its row. 201 answers `{"id": "<id>"}`; a refusal
 * `{"error": "<why>"}`. A recording shared is notified, as added by `sharer`.
 */
export async function shareRecording(form: FormData, playerId: string, sharer: string, options: RecordingOptions): Promise<RecordingAnswer> {
    const refuse = (status: number, error: string): RecordingAnswer => ({ status, body: { error } });
    const fields = [...form.keys()];
    const file = form.get(PACKAGE_FIELD);
    if (fields.length !== 1 || !(file instanceof File)) return refuse(400, `The form is not one file, ${PACKAGE_FIELD}.`);
    if (file.size > MAX_RECORDING_BYTES) return refuse(413, `The package is larger than ${MAX_RECORDING_BYTES / (1024 * 1024)} MiB.`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let pkg: SharedPackage;
    try {
        pkg = await options.readPackage(bytes, MAX_RECORDING_UNZIPPED_BYTES);
    } catch (error) {
        return refuse(422, `The package is refused: ${error instanceof Error ? error.message : String(error)}.`);
    }
    const set = options.dataSets.read().dataSets.find((row) => row.id === pkg.dataSet);
    if (!set || set.pending) return refuse(422, 'The site does not publish the set it plays.');
    if (pkg.path.some((recording) => recording.changes.some(({ change }) => DEV_CHANGES.has(change.kind)))) {
        return refuse(422, 'It holds a move of ?dev, which no game holds.');
    }
    if (options.recordings.bytes() + bytes.length > options.recordings.diskBytes) return refuse(507, 'The site keeps no more recordings.');

    const id = randomBytes(8).toString('hex').toUpperCase();
    const partial = join(options.dir, `.${id}.partial`);
    try {
        await writeFile(partial, bytes, { flag: 'wx' });
        await rename(partial, join(options.dir, `${id}.gz`));
    } catch (error) {
        await rm(partial, { force: true });
        throw error;
    }
    const { title, author, description, recordedAt, endedAt, playTime, start } = pkg.info;
    options.recordings.share({
        id, dataSet: pkg.dataSet, build: pkg.build, title, author, description, recordedAt, endedAt, playTime, start,
        extras: playedWithExtras(pkg), size: bytes.length, uploader: playerId, uploadedAt: options.now(),
    });
    console.log(`recording ${id} of '${pkg.dataSet}' added`);
    options.notify({ name: set.name, activity: 'recording added', recording: title, by: sharer, at: options.now() });
    return { status: 201, body: { id } };
}

/** The state of a recording each action takes; `delete` takes any. */
const TAKES: Record<Exclude<RecordingAction, 'delete'>, (recording: StoredRecording) => boolean> = {
    approve: (recording) => recording.pending,
    hide: (recording) => !recording.pending && !recording.hidden,
    show: (recording) => recording.hidden,
    break: (recording) => !recording.broken,
};

/** Each action, done, as a notification says it. */
const DONE: Record<RecordingAction, DataSetActivity> = {
    approve: 'recording approved', hide: 'recording hidden', show: 'recording shown', break: 'recording broken', delete: 'recording deleted',
};

/** The action `body` names, or `null` where it is not `{"action": <one of ACTIONS>}` alone. */
function recordingAction(body: string): RecordingAction | null {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    const action = (json as { action?: unknown }).action;
    return Object.keys(json).length === 1 && ACTIONS.includes(action as RecordingAction) ? action as RecordingAction : null;
}

/**
 * `POST RECORDINGS_ROUTE/<id>`: `body`, sent by `viewer` about the recording `id`, checked
 * and, where it passes, done. The body is JSON, `{"action": "approve" | "hide" | "show" |
 * "break" | "delete"}`, and nothing else:
 *
 *   approve  pending → approved, listed
 *   hide     approved → hidden: listed to its uploader and the moderators only
 *   show     hidden → approved
 *   break    → broken, in any state: it drifts on the site's build, and is listed to its
 *            uploader and the moderators only; the replay tool sends it, as a moderator
 *   delete   → gone: the row deleted, then its file. Its uploader may send it too, in any
 *            state, a withdrawal
 *
 * The rules, in order, each answered with nothing changed:
 *
 *   413  a body over `MAX_RECORDING_MODERATION_BYTES` (`app.ts`)
 *   400  a body that is not that JSON, or names another action
 *   404  an id the table does not hold
 *   403  an asker who is not a moderator, unless they shared it and delete it; a malformed
 *        `playerId`, or none, is nobody's
 *   409  an action its state does not take: approve one that is not pending, hide one
 *        pending or hidden, show one that is not hidden, break a broken one
 *
 * A delete deletes the row first, so it is listed to nobody before its file goes; a file
 * that will not go is logged and left, which no row names. 200 answers `{"id": "<id>"}`; a
 * refusal `{"error": "<why>"}`. Each change is notified, by the moderator's name, or as
 * withdrawn by its owner.
 */
export async function moderateRecording(id: string, body: string, viewer: DataSetViewer, options: RecordingOptions): Promise<RecordingAnswer> {
    const refuse = (status: number, error: string): RecordingAnswer => ({ status, body: { error } });
    const action = recordingAction(body);
    if (action === null) return refuse(400, `The body is not {"action": ${ACTIONS.map((name) => `"${name}"`).join(' | ')}}.`);
    const recording = SHARED_RECORDING_ID.test(id) ? options.recordings.get(id) : null;
    if (!recording) return refuse(404, 'The site has no recording of this id.');
    if (!viewer.moderator && !(action === 'delete' && sharedBy(recording, viewer))) {
        return refuse(403, 'Only a moderator may do this, or its uploader withdraw their own recording.');
    }
    if (action !== 'delete' && !TAKES[action](recording)) {
        const state = `${recording.pending ? 'pending' : recording.hidden ? 'hidden' : 'approved'}${recording.broken ? ' and broken' : ''}`;
        return refuse(409, `The recording is ${state}, which ${action} does not take.`);
    }

    const activity: DataSetActivity = action === 'delete' && !viewer.moderator ? 'recording withdrawn' : DONE[action];
    const name = options.dataSets.read().dataSets.find((set) => set.id === recording.dataSet)?.name ?? recording.dataSet;
    if (action === 'approve') options.recordings.approve(id);
    else if (action === 'hide' || action === 'show') options.recordings.setHidden(id, action === 'hide');
    else if (action === 'break') options.recordings.setBroken(id);
    else {
        options.recordings.remove(id);
        try {
            await rm(join(options.dir, `${id}.gz`), { force: true });
        } catch (error) {
            console.error(`recording ${id} ${activity.slice('recording '.length)}, its file left (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    console.log(`recording ${id} ${activity.slice('recording '.length)}`);
    options.notify({ name, activity, recording: recording.title, by: viewer.moderator?.name ?? 'its owner', at: options.now() });
    return { status: 200, body: { id } };
}
