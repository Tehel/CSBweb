/**
 * A recording shared (`doc/RECORDING.md` → "Shared recordings"): one file,
 * the deliverable the server keeps and serves and another player plays.
 *
 * It holds a recording's path, from its root to the point shared (`doc/RECORDING.md` →
 * "The tree"), each recording cut at the point its child joins it, as far as the path
 * plays, and the metadata a list shows. The point is a save's, which a player knows
 * by name: the path's last recording cut there, and the MD5 of the save's file ending the
 * package, a check of its own (`SavedAtEnd`, `src/engine/RecordingPlayer.ts`). Or the
 * game's end, won or lost, which no save can follow: the path's last recording ended by it
 * (`Recording.end`), which its replay must reach.
 *
 * The file is JSON, gzipped by the browser's own `CompressionStream`, of version 3
 * (`doc/RECORDING.md` → "Shared recordings"): the format's version, the build, the engine's
 * level, the set, the metadata, the path and the point. A package holds what its replay
 * needs and nothing its replay makes again (`packaged`): a branch starts at a join, the
 * MD5 of the file its parent makes there in place of the file, and a change keeps its
 * `d.Time` and `d.RandomNumber` only every `CHECK_INTERVAL` changes and at its recording's
 * last (`checkedChange`). Each change is a row, its VBLs since the change before, its
 * kind and its arguments in a fixed order (`changeRow`). Read, a package is a path of
 * `Recording`s again, each with its set, its parent and its end as the store has them. A
 * package of another version is refused. Where it starts, a new game or the save's level
 * and champions, is read from the path's root, so a package's never disagrees with its
 * path.
 *
 * Reading one checks its form alone, the server's check (`server/recordings.ts`): it parses, each
 * field has its type, the texts their limits, the path its joins. It does not replay it.
 *
 * **Nothing in this file touches the DOM**: `tools/checks/replay.ts` writes, reads and
 * plays packages, and the server reads them, built for Node (`PageReaders.ts`,
 * `server/recordings.ts`).
 */
import { CHARDESC_NAME_SIZE, readCsbwinSaveInfo } from '../data/CsbwinSaveInfo';
import { fileDigest, type FileDigests } from '../data/DataSetFiles';
import { LOCAL_DATA_SET_TEXT_LIMITS, RECORDING_FILES } from '../data/DataSets';
import { NO_EXTRAS, type Extras, type RulesOptions } from './GameContext';
import { CLOCK_HOLDERS, type ClockHolder, type InputChange } from './InputBoundary';
import { createLoopFlags, VIDEO_MODES } from './LoopState';
import { PLAYFILE_LINES } from './PlayfileLine';
import type { CarriedState, RecordedChange, Recording, RecordingEnd, RecordingPoint, RecordingStart } from './Recorder';

/** The format's version: a package of another is refused (`readRecordingPackage`). */
export const RECORDING_PACKAGE_VERSION = 3;

/**
 * Where the page fetches a shared recording's package, relative to the page: its file,
 * `RECORDING_FILES/<id>.gz`, which the server serves `immutable`, asked with the format's
 * version, so that a browser holding a copy of another version under the same id asks
 * anew (`doc/RECORDING.md` → "Shared recordings").
 */
export function recordingPackageUrl(id: string): string {
    return `${RECORDING_FILES}/${id}.gz?v=${RECORDING_PACKAGE_VERSION}`;
}

/** A package keeps the `d.Time` and `d.RandomNumber` of one change in this many (`checkedChange`). */
export const CHECK_INTERVAL = 64;

/**
 * Whether a package keeps the `d.Time` and `d.RandomNumber` of a recording's change
 * `index` of `count`: every `CHECK_INTERVAL`th, and the last, what its replay checks.
 */
export function checkedChange(index: number, count: number): boolean {
    return index % CHECK_INTERVAL === CHECK_INTERVAL - 1 || index === count - 1;
}

/**
 * The longest text the metadata takes in each field, in characters, as a set's: a title as
 * a set's name, an author as its authors, a description as its description.
 */
export const RECORDING_TEXT_LIMITS = {
    title: LOCAL_DATA_SET_TEXT_LIMITS.name,
    author: LOCAL_DATA_SET_TEXT_LIMITS.authors,
    description: LOCAL_DATA_SET_TEXT_LIMITS.description,
} as const;

/** Where a shared path starts, read from its root: a new game, or the save's level and champions. */
export type RecordingPackageStart =
    | { readonly kind: 'new' }
    | { readonly kind: 'save'; readonly level: number; readonly champions: readonly string[] };

/** What its player says of a recording shared: plain text, the title needed, the rest empty for none. */
export interface RecordingPackageText {
    readonly title: string;
    /** A name the player gives, never their `playerId`. */
    readonly author: string;
    readonly description: string;
}

/** What a list shows of a recording shared. */
export interface RecordingPackageInfo extends RecordingPackageText {
    /** Milliseconds since the epoch: when its root began (`RecordingEntry.recordedAt`). */
    readonly recordedAt: number;
    /** Milliseconds since the epoch: when its point was made, the save or the game's end. */
    readonly endedAt: number;
    /** Milliseconds: the game's play time at its point (`Game.playTime`), as a save's row has it. */
    readonly playTime: number;
    readonly start: RecordingPackageStart;
    /**
     * The party's champions' names at its point, in its order, none empty: the save's
     * (`SaveEntry.champions`), or the game's end's (`RecordingEntry.champions`). Absent from
     * a package written before packages said it, and from one of a game's end the store
     * wrote before it kept them.
     */
    readonly champions?: readonly string[];
}

/** What a package says of its times and its party (`RecordingPackageInfo`), beside its text. */
export type RecordingPackageTimes = Pick<RecordingPackageInfo, 'recordedAt' | 'endedAt' | 'playTime' | 'champions'>;

/** The most champions a party holds, and the longest name one has, as `CHARDESC`'s field (`CHARDESC_NAME_SIZE`). */
const PARTY_LIMITS = { champions: 4, name: CHARDESC_NAME_SIZE } as const;

/** The point a path is shared at. */
export type RecordingShared =
    /**
     * A save's: the MD5 of its file, which the path's end makes again, and whether its
     * point was taken inside its last VBL (`RecordingPoint.inVbl`).
     */
    | { readonly kind: 'save'; readonly md5: string; readonly inVbl: boolean }
    /** The game's end, which ends the path's last recording (`Recording.end`). */
    | { readonly kind: 'end' };

export interface RecordingPackage {
    readonly version: typeof RECORDING_PACKAGE_VERSION;
    /** The build that made the shared recording, the path's last. */
    readonly build: string;
    /** The engine's level the shared recording was played at, the path's last's (`Recording.level`). */
    readonly level: number;
    /** The data set every recording of the path was played on (`DataSet.id`). */
    readonly dataSet: string;
    readonly info: RecordingPackageInfo;
    /**
     * The root, then each branch the child of the one before, each ending at its child's
     * point, the last at the point shared; as a package holds them (`packaged`): each
     * branch starting at a join, each change's clock and stream kept where it is checked.
     */
    readonly path: readonly Recording[];
    readonly shared: RecordingShared;
}

/** A package's form is wrong: what is wrong. */
export class RecordingPackageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RecordingPackageError';
    }
}

/**
 * The package of `path`, the store's path to a save's recording (`readRecordingPath`),
 * shared at the save's `point` (`SaveEntry.recording`), its file `file`: the last
 * recording cut at the point as each before it is at its child's.
 */
export function packageOfSave(
    path: readonly Recording[], point: RecordingPoint, file: Uint8Array, text: RecordingPackageText,
    times: RecordingPackageTimes,
): RecordingPackage {
    return checked(packageOf(pathAtSave(path, point), { kind: 'save', md5: fileDigest(file), inVbl: point.inVbl === true }, text, times));
}

/** The package of `path`, the store's path to a recording the game's end ended, shared at that end. */
export function packageOfEnd(
    path: readonly Recording[], text: RecordingPackageText,
    times: RecordingPackageTimes,
): RecordingPackage {
    return checked(packageOf(pathAtEnd(path), { kind: 'end' }, text, times));
}

/**
 * The path a package holds of `path`, the store's path to a save's recording, shared at
 * the save's `point`: the last recording cut at the point, each before it at its child's
 * join.
 */
export function pathAtSave(path: readonly Recording[], point: RecordingPoint): Recording[] {
    const last = path[path.length - 1];
    if (last?.id !== point.recording) throw new RecordingPackageError('the path does not reach the save\'s point');
    return cutAtJoins([...path.slice(0, -1), cutAt(last, point)]);
}

/** The path a package holds of `path`, the store's path to a recording the game's end ended: each recording before the last cut at its child's join. */
export function pathAtEnd(path: readonly Recording[]): Recording[] {
    if (!path[path.length - 1]?.end) throw new RecordingPackageError('the path does not end at the game\'s end');
    return cutAtJoins(path);
}

/**
 * `path` as a package holds it: each branch's start a join, the MD5 of the file its read
 * read in place of the file, which its parent makes there again; and each change's
 * `d.Time` and `d.RandomNumber` kept only where its replay checks them (`checkedChange`).
 */
export function packaged(path: readonly Recording[]): Recording[] {
    return path.map((recording, n) => ({
        ...recording,
        start: n === 0 ? recording.start : joinOf(recording.start),
        changes: recording.changes.map((entry, index, all): RecordedChange => (
            checkedChange(index, all.length) ? entry : { change: entry.change, vbl: entry.vbl })),
    }));
}

/** A branch's `start` as a package holds it: the MD5 of its save's file, and what its read left beside it. */
function joinOf(start: RecordingStart): RecordingStart {
    if (start.kind === 'join') return start;
    if (start.kind !== 'save' || !start.carried) throw new RecordingPackageError('a branch starts from a save, with what its read left');
    return { kind: 'join', md5: fileDigest(start.bytes), carried: start.carried };
}

/**
 * Whether a recording of `path` was played with an extra on: at its start, or turned on
 * by a change. The server's twin is `playedWithExtras` (`server/recordings.ts`), which
 * cannot import the page's sources.
 */
export function playedWithExtras(path: readonly Recording[]): boolean {
    const on = (extras: Extras) => Object.values(extras).some((flag) => flag === true);
    return path.some((recording) => on(recording.extras) || recording.changes.some(({ change }) => change.kind === 'extras' && on(change.extras)));
}

/**
 * Whether a recording of `path` holds a move of the page's `?dev` (`devLevel`, `devMove`),
 * which no game of CSBWin's holds, so the server refuses its package. The server's twin is
 * `DEV_CHANGES` (`server/recordings.ts`).
 */
export function playedWithDevMoves(path: readonly Recording[]): boolean {
    return path.some((recording) => recording.changes.some(({ change }) => change.kind === 'devLevel' || change.kind === 'devMove'));
}

function packageOf(
    path: readonly Recording[], shared: RecordingShared, text: RecordingPackageText,
    times: RecordingPackageTimes,
): RecordingPackage {
    const last = path[path.length - 1]!;
    const { title, author, description } = text;
    const { champions, ...rest } = times;
    const info = { title, author, description, ...rest, start: packageStart(path[0]!), ...(champions ? { champions } : {}) };
    return { version: RECORDING_PACKAGE_VERSION, build: last.build, level: last.level, dataSet: last.dataSet, info, path: packaged(path), shared };
}

/** `path` with each recording before the last cut at the point its child joins it. */
function cutAtJoins(path: readonly Recording[]): Recording[] {
    return path.map((recording, n) => {
        const point = path[n + 1]?.parent;
        return point ? cutAt(recording, point) : recording;
    });
}

/** `recording` cut at `point`: its changes before it, its VBLs up to it, ended there by no game's end. */
function cutAt(recording: Recording, point: Omit<RecordingPoint, 'recording'>): Recording {
    if (point.changes > recording.changes.length || point.vbls > recording.vbls) throw new RecordingPackageError('the path does not reach its point');
    return { ...recording, changes: recording.changes.slice(0, point.changes), vbls: point.vbls, ended: true, end: null };
}

/** Where `root` starts, as a list shows it. */
export function packageStart(root: Recording): RecordingPackageStart {
    if (root.start.kind === 'new') return { kind: 'new' };
    const save = root.start.kind === 'save' ? readCsbwinSaveInfo(root.start.bytes) : null;
    if (!save) throw new RecordingPackageError('the path\'s root is no save the port reads');
    return { kind: 'save', level: save.level, champions: save.champions };
}

/** `pkg` as the file the server keeps: its JSON, gzipped. */
export async function writeRecordingPackage(pkg: RecordingPackage): Promise<Uint8Array> {
    checked(pkg);
    const { version, build, level, dataSet, info, path, shared } = pkg;
    const json = { version, build, level, dataSet, info, path: path.map(recordingToJson), shared };
    return gzip(new TextEncoder().encode(JSON.stringify(json)));
}

/**
 * The package `bytes` hold, its form checked: refused with a `RecordingPackageError`, or
 * where it unzips to more than `limit` bytes.
 */
export async function readRecordingPackage(bytes: Uint8Array, limit = Infinity): Promise<RecordingPackage> {
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await gunzip(bytes, limit));
    } catch (error) {
        if (error instanceof RecordingPackageError) throw error;
        throw new RecordingPackageError('not a gzipped text');
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        throw new RecordingPackageError('not JSON');
    }
    return checked(packageFromJson(json));
}

/* ------------------------------------------------------------ the form ---- */

/**
 * `pkg`, its form checked beyond its fields': the texts, the path's roots and joins, each
 * change's clock and stream kept with each other, and its end.
 */
function checked(pkg: RecordingPackage): RecordingPackage {
    const { info, path, shared } = pkg;
    for (const field of ['title', 'author', 'description'] as const) {
        const value = info[field];
        if (value.length > RECORDING_TEXT_LIMITS[field]) throw new RecordingPackageError(`the ${field} is longer than ${RECORDING_TEXT_LIMITS[field]} characters`);
        if ((field === 'description' ? /[\x00-\x09\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) {
            throw new RecordingPackageError(`the ${field} holds a control character`);
        }
    }
    if (info.title.trim() === '') throw new RecordingPackageError('the title is empty');
    if (info.endedAt < info.recordedAt) throw new RecordingPackageError('it ends before it begins');
    if (info.champions && (info.champions.length > PARTY_LIMITS.champions
        || info.champions.some((name) => name === '' || name.length > PARTY_LIMITS.name || /[\x00-\x1f\x7f]/.test(name)))) {
        throw new RecordingPackageError('its party is no party of champions');
    }
    const last = path[path.length - 1];
    if (!last) throw new RecordingPackageError('the path is empty');
    if (pkg.build !== last.build) throw new RecordingPackageError('the build is not the last recording\'s');
    if (pkg.level !== last.level) throw new RecordingPackageError('the level is not the last recording\'s');
    path.forEach((recording, n) => {
        if (recording.dataSet !== pkg.dataSet) throw new RecordingPackageError(`recording ${n} is of another set`);
        if (!recording.ended) throw new RecordingPackageError(`recording ${n} is not ended`);
        const parent = n === 0 ? null : path[n - 1]!;
        if (!parent && (recording.parent !== null || recording.start.kind === 'join')) throw new RecordingPackageError('the path\'s root is a branch');
        if (parent && (recording.parent?.recording !== parent.id || recording.start.kind !== 'join'
            || recording.parent.changes !== parent.changes.length || recording.parent.vbls !== parent.vbls)) {
            throw new RecordingPackageError(`recording ${n} is no branch of the one before, joining it at its end`);
        }
        if (n < path.length - 1 && recording.end) throw new RecordingPackageError(`recording ${n} ends the game before the path's end`);
        let vbl = 0;
        for (const change of recording.changes) {
            if (change.vbl < vbl || change.vbl > recording.vbls) throw new RecordingPackageError(`recording ${n}'s changes are out of order`);
            if ((change.time === undefined) !== (change.random === undefined)) throw new RecordingPackageError(`recording ${n} checks a change's clock without its stream`);
            vbl = change.vbl;
        }
    });
    if ((shared.kind === 'end') !== (last.end !== null)) throw new RecordingPackageError('its point is not where its path ends');
    if (JSON.stringify(info.start) !== JSON.stringify(packageStart(path[0]!))) throw new RecordingPackageError('where it starts is not its root\'s start');
    return pkg;
}

/** The fields' types: what a JSON object must be to be a package. */
function packageFromJson(json: unknown): RecordingPackage {
    const pkg = record(json, 'the package');
    if (pkg['version'] !== RECORDING_PACKAGE_VERSION) throw new RecordingPackageError(`not a package of version ${RECORDING_PACKAGE_VERSION}`);
    const info = record(pkg['info'], 'the metadata');
    const start = record(info['start'], 'the metadata\'s start');
    const shared = record(pkg['shared'], 'the point');
    const dataSet = word(pkg['dataSet'], 'the set');
    const path: Recording[] = [];
    array(pkg['path'], 'the path').forEach((recording, n) => path.push(recordingFromJson(recording, `recording ${n}`, dataSet, path[n - 1] ?? null)));
    return {
        version: RECORDING_PACKAGE_VERSION,
        build: word(pkg['build'], 'the build'),
        level: count(pkg['level'], 'the level'),
        dataSet,
        info: {
            title: string(info['title'], 'the title'),
            author: string(info['author'], 'the author'),
            description: string(info['description'], 'the description'),
            recordedAt: count(info['recordedAt'], 'when it began'),
            endedAt: count(info['endedAt'], 'when it ended'),
            playTime: count(info['playTime'], 'its play time'),
            start: start['kind'] === 'new' ? { kind: 'new' }
                : start['kind'] === 'save' ? {
                    kind: 'save', level: count(start['level'], 'the start\'s level'),
                    champions: array(start['champions'], 'the start\'s champions').map((name) => string(name, 'a champion')),
                }
                    : fail('where it starts'),
            ...(info['champions'] === undefined ? {} : { champions: array(info['champions'], 'its party').map((name) => string(name, 'a champion')) }),
        },
        path,
        shared: shared['kind'] === 'end' ? { kind: 'end' }
            : shared['kind'] === 'save' ? { kind: 'save', md5: digest(shared['md5'], 'the save\'s MD5'), inVbl: boolean(shared['inVbl'], 'the save\'s inVbl') }
                : fail('the point'),
    };
}

/**
 * A recording of a package of `dataSet`, the child of `parent`, `null` for the root: a
 * root starts from a new game or a save, a branch at a join, its parent's end.
 */
function recordingFromJson(json: unknown, what: string, dataSet: string, parent: Recording | null): Recording {
    const recording = record(json, what);
    const start = record(recording['start'], `${what}'s start`);
    let inVbl = false;
    const begins = (): RecordingStart => {
        const kind = start['kind'];
        if ((kind === 'join') !== (parent !== null)) fail(`${what}'s start`);
        switch (kind) {
            case 'new': return { kind: 'new', random: uint32(start['random'], `${what}'s seed`), randomGameID: uint32(start['randomGameID'], `${what}'s playthrough`) };
            case 'save': return {
                kind: 'save', bytes: bytes(start['bytes'], `${what}'s save`),
                ...(start['carried'] === undefined ? {} : { carried: carriedFromJson(start['carried'], `${what}'s carried state`) }),
            };
            case 'join': {
                if (start['inVbl'] !== undefined && start['inVbl'] !== true) fail(`${what}'s join`);
                inVbl = start['inVbl'] === true;
                return { kind: 'join', md5: digest(start['md5'], `${what}'s join`), carried: carriedFromJson(start['carried'], `${what}'s carried state`) };
            }
            default: return fail(`${what}'s start`);
        }
    };
    const begun = begins();
    const changes = changesFromJson(recording['changes'], recording['checks'], what);
    return {
        id: word(recording['id'], `${what}'s id`),
        build: word(recording['build'], `${what}'s build`),
        level: count(recording['level'], `${what}'s level`),
        profile: recording['profile'] === null ? null : word(recording['profile'], `${what}'s profile`),
        files: recording['files'] === null ? null : digestsFromJson(recording['files'], `${what}'s files`),
        dataSet,
        start: begun,
        parent: parent ? { recording: parent.id, changes: parent.changes.length, vbls: parent.vbls, ...(inVbl ? { inVbl: true } : {}) } : null,
        rules: shaped(recording['rules'], RULES, `${what}'s rules`),
        extras: shaped(recording['extras'], NO_EXTRAS, `${what}'s extras`),
        changes,
        vbls: count(recording['vbls'], `${what}'s VBLs`),
        ended: true,
        end: recording['end'] === null ? null : endFromJson(recording['end'], `${what}'s end`),
    };
}

/** A file's name, and its MD5 in lower-case hex, each (`FileDigests`). */
function digestsFromJson(json: unknown, what: string): FileDigests {
    const files = record(json, what);
    for (const [name, value] of Object.entries(files)) {
        if (word(name, what) !== name) fail(what);
        digest(value, what);
    }
    return files as FileDigests;
}

function endFromJson(json: unknown, what: string): RecordingEnd {
    return { word11694: boolean(record(json, what)['word11694'], what) };
}

function carriedFromJson(json: unknown, what: string): CarriedState {
    const carried = record(json, what);
    const loop = shaped(carried['loop'], LOOP_FLAGS, what);
    if (!(VIDEO_MODES as readonly string[]).includes(loop.videoMode)) fail(what);
    return { paused: boolean(carried['paused'], what), loop };
}

/**
 * A recording's changes, from its rows (`changeRow`), and its checks, `[change, d.Time,
 * d.RandomNumber]` each, the changes' indices increasing, each of a change.
 */
function changesFromJson(rows: unknown, checks: unknown, what: string): RecordedChange[] {
    let vbl = 0;
    const changes: RecordedChange[] = array(rows, `${what}'s changes`).map((json, n) => {
        const row = array(json, `${what}'s change ${n}`);
        vbl += count(row[0], `${what}'s change ${n}`);
        return { change: changeFromRow(row.slice(1), `${what}'s change ${n}`), vbl };
    });
    let after = -1;
    for (const json of array(checks, `${what}'s checks`)) {
        const check = array(json, `${what}'s checks`);
        const index = count(check[0], `${what}'s checks`);
        if (check.length !== 3 || index <= after || index >= changes.length) fail(`${what}'s checks`);
        changes[index] = { ...changes[index]!, time: count(check[1], `${what}'s checks`), random: uint32(check[2], `${what}'s checks`) };
        after = index;
    }
    return changes;
}

/** A change as a package's row holds it, after its VBLs: its kind, then its arguments in a fixed order. */
function changeRow(change: InputChange): unknown[] {
    switch (change.kind) {
        case 'click': return [change.kind, change.x, change.y, change.buttons];
        case 'unclick': case 'tag0207cc': case 'saveWritten': case 'forceDMRules': return [change.kind];
        case 'key': return [change.kind, change.num];
        case 'panelKey': return [change.kind, change.action];
        case 'reincarnateKey': return [change.kind, change.key];
        case 'reincarnateClick': return [change.kind, change.x, change.y];
        case 'pause': return change.dialog === undefined ? [change.kind, change.paused] : [change.kind, change.paused, change.dialog];
        case 'extras': return [change.kind, change.extras];
        case 'devLevel': return [change.kind, change.delta];
        case 'devMove': return [change.kind, change.map, change.x, change.y];
        case 'playfile': return [change.kind, change.num, change.y];
        // A read ends its recording, which records nothing of it (`Recorder`).
        case 'read': throw new RecordingPackageError('a recording holds no read');
    }
}

/** The change a row holds after its VBLs (`changeRow`). */
function changeFromRow(row: unknown[], what: string): InputChange {
    const [kind, a, b, c] = row;
    const args = (n: number) => {
        if (row.length !== n + 1) fail(what);
    };
    const int = (value: unknown) => integer(value, what);
    switch (kind) {
        case 'click': args(3); return { kind, x: int(a), y: int(b), buttons: int(c) };
        case 'unclick': case 'tag0207cc': case 'saveWritten': case 'forceDMRules': args(0); return { kind };
        case 'key': args(1); return { kind, num: int(a) };
        case 'panelKey': args(1); return { kind, action: word(a, what) };
        case 'reincarnateKey': args(1); return { kind, key: word(a, what) };
        case 'reincarnateClick': args(2); return { kind, x: int(a), y: int(b) };
        case 'pause': {
            const paused = boolean(a, what);
            if (row.length === 2) return { kind, paused };
            args(2);
            return CLOCK_HOLDERS.includes(b as ClockHolder) ? { kind, paused, dialog: b as ClockHolder } : fail(what);
        }
        case 'extras': args(1); return { kind, extras: shaped(a, NO_EXTRAS, what) };
        case 'devLevel': args(1); return a === 1 || a === -1 ? { kind, delta: a } : fail(what);
        case 'devMove': args(3); return { kind, map: int(a), x: int(b), y: int(c) };
        case 'playfile': {
            args(2);
            const num = int(a);
            const y = int(b);
            return PLAYFILE_LINES.has(num) && y >= 0 && y <= 0xffff ? { kind, num, y } : fail(what);
        }
        default: return fail(what);
    }
}

/** Every rule, each a flag: the keys a recording's rules must have. */
const RULES: Record<keyof RulesOptions, boolean> = {
    dmRules: false, dmRulesDesignOption: false, invisibleMonsters: false, drawAsSize4Monsters: false,
    simpleEncipher: false, supressDSAWarningOption: false, bGravityGame: false, bThreeDMovements: false,
};

/** The main loop's flags, the keys and the types a carried state's must have. */
const LOOP_FLAGS = createLoopFlags();

/**
 * `json`, shaped as `model`: an object with its keys, an array of its length, each value
 * as its own, a number an integer.
 */
function shaped<T>(json: unknown, model: T, what: string): T {
    if (Array.isArray(model)) {
        const value = array(json, what);
        if (value.length !== model.length) fail(what);
        value.forEach((field, n) => shaped(field, model[n], what));
        return value as T;
    }
    if (typeof model === 'object' && model !== null) {
        const value = record(json, what);
        const keys = Object.keys(model);
        if (Object.keys(value).length !== keys.length) fail(what);
        for (const key of keys) shaped(value[key], (model as Record<string, unknown>)[key], what);
        return value as T;
    }
    if (typeof json !== typeof model || (typeof model === 'number' && !Number.isSafeInteger(json))) fail(what);
    return json as T;
}

function record(json: unknown, what: string): Record<string, unknown> {
    return typeof json === 'object' && json !== null && !Array.isArray(json) ? json as Record<string, unknown> : fail(what);
}

function array(json: unknown, what: string): unknown[] {
    return Array.isArray(json) ? json : fail(what);
}

function string(json: unknown, what: string): string {
    return typeof json === 'string' ? json : fail(what);
}

/** A non-empty string of at most 100 characters: an id, a build, a set, a key's name. */
function word(json: unknown, what: string): string {
    return typeof json === 'string' && json !== '' && json.length <= 100 ? json : fail(what);
}

/** An MD5 in lower-case hex. */
function digest(json: unknown, what: string): string {
    return typeof json === 'string' && /^[0-9a-f]{32}$/.test(json) ? json : fail(what);
}

function boolean(json: unknown, what: string): boolean {
    return typeof json === 'boolean' ? json : fail(what);
}

function integer(json: unknown, what: string): number {
    return Number.isSafeInteger(json) ? json as number : fail(what);
}

function count(json: unknown, what: string): number {
    const value = integer(json, what);
    return value >= 0 ? value : fail(what);
}

function uint32(json: unknown, what: string): number {
    const value = count(json, what);
    return value <= 0xffffffff ? value : fail(what);
}

function bytes(json: unknown, what: string): Uint8Array {
    if (typeof json !== 'string') fail(what);
    try {
        return fromBase64(json as string);
    } catch {
        return fail(what);
    }
}

function fail(what: string): never {
    throw new RecordingPackageError(`${what} is not as a package holds it`);
}

/* ------------------------------------------------------------ encoding ---- */

/**
 * `recording` as a package's JSON holds it: no set, the package's; no parent, the
 * recording before; no `ended`, each being; its changes as rows of the VBLs since the one
 * before, and its checks, `[change, d.Time, d.RandomNumber]`, where a change keeps them.
 */
function recordingToJson(recording: Recording): unknown {
    const { id, build, level, profile, files, rules, extras, vbls, end } = recording;
    let vbl = 0;
    const changes = recording.changes.map((entry) => {
        const row = [entry.vbl - vbl, ...changeRow(entry.change)];
        vbl = entry.vbl;
        return row;
    });
    const checks: [number, number, number][] = [];
    recording.changes.forEach((entry, n) => {
        if (entry.time !== undefined && entry.random !== undefined) checks.push([n, entry.time, entry.random]);
    });
    return { id, build, level, profile, files, start: startToJson(recording), rules, extras, vbls, end, changes, checks };
}

function startToJson({ start, parent }: Recording): unknown {
    switch (start.kind) {
        case 'new': return start;
        case 'save': return { ...start, bytes: toBase64(start.bytes) };
        case 'join': return parent?.inVbl ? { ...start, inVbl: true } : start;
    }
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
    const binary = atob(encoded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `bytes` unzipped, refused once they pass `limit`. */
async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
    const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw new RecordingPackageError(`it unzips to more than ${limit} bytes`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
