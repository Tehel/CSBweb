/**
 * A recording shared (`doc/RECORDING.md` → "Shared recordings", `DEBT.md` G31): one file,
 * the deliverable the server keeps and serves and another player plays.
 *
 * It holds a recording's path, from its root to the point shared (`doc/RECORDING.md` →
 * "The tree"), each recording cut at the point its child joins it, as far as the path
 * plays, and the metadata a list shows. The point is a save's, which a player knows
 * by name: the path's last recording cut there, and the save's file ending the package, a
 * check of its own (`SavedAtEnd`, `src/engine/RecordingPlayer.ts`). Or the game's end,
 * won or lost, which no save can follow: the path's last recording ended by it
 * (`Recording.end`), which its replay must reach.
 *
 * The file is JSON, gzipped by the browser's own `CompressionStream`: the format's version,
 * the build, the set, the metadata, the path and the point. Each recording is as the store
 * holds it (`Recording`), a save's file in base64. Where it starts, a new game or the
 * save's level and champions, is read from the path's root, so a package's never
 * disagrees with its path.
 *
 * Reading one checks its form alone, the server's check (`DEBT.md` G31): it parses, each
 * field has its type, the texts their limits, the path its joins. It does not replay it.
 *
 * **Nothing in this file touches the DOM**: `tools/checks/replay.ts` writes, reads and
 * plays packages.
 */
import { readCsbwinSaveInfo } from '../data/CsbwinSaveInfo';
import { LOCAL_DATA_SET_TEXT_LIMITS } from '../data/DataSets';
import { NO_EXTRAS, type RulesOptions } from './GameContext';
import type { InputChange } from './InputBoundary';
import { createLoopFlags, VIDEO_MODES } from './LoopState';
import type { CarriedState, RecordedChange, Recording, RecordingEnd, RecordingPoint, RecordingStart } from './Recorder';
import type { SavedAtEnd } from './RecordingPlayer';

/** The format's version: a package of another is refused. */
export const RECORDING_PACKAGE_VERSION = 1;

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
}

/** The point a path is shared at. */
export type RecordingShared =
    /** A save's: its file, which the path's end makes again. */
    | ({ readonly kind: 'save' } & SavedAtEnd)
    /** The game's end, which ends the path's last recording (`Recording.end`). */
    | { readonly kind: 'end' };

export interface RecordingPackage {
    readonly version: typeof RECORDING_PACKAGE_VERSION;
    /** The build that made the shared recording, the path's last. */
    readonly build: string;
    /** The data set every recording of the path was played on (`DataSet.id`). */
    readonly dataSet: string;
    readonly info: RecordingPackageInfo;
    /** The root, then each branch the child of the one before, each ending at its child's point, the last at the point shared. */
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
    times: Pick<RecordingPackageInfo, 'recordedAt' | 'endedAt' | 'playTime'>,
): RecordingPackage {
    const last = path[path.length - 1];
    if (last?.id !== point.recording) throw new RecordingPackageError('the path does not reach the save\'s point');
    return checked(packageOf([...path.slice(0, -1), cutAt(last, point)], { kind: 'save', file, inVbl: point.inVbl === true }, text, times));
}

/** The package of `path`, the store's path to a recording the game's end ended, shared at that end. */
export function packageOfEnd(
    path: readonly Recording[], text: RecordingPackageText,
    times: Pick<RecordingPackageInfo, 'recordedAt' | 'endedAt' | 'playTime'>,
): RecordingPackage {
    if (!path[path.length - 1]?.end) throw new RecordingPackageError('the path does not end at the game\'s end');
    return checked(packageOf(path, { kind: 'end' }, text, times));
}

function packageOf(
    path: readonly Recording[], shared: RecordingShared, text: RecordingPackageText,
    times: Pick<RecordingPackageInfo, 'recordedAt' | 'endedAt' | 'playTime'>,
): RecordingPackage {
    const last = path[path.length - 1]!;
    const { title, author, description } = text;
    const info = { title, author, description, ...times, start: startOf(path[0]!) };
    const cut = path.map((recording, n) => {
        const point = path[n + 1]?.parent;
        return point ? cutAt(recording, point) : recording;
    });
    return { version: RECORDING_PACKAGE_VERSION, build: last.build, dataSet: last.dataSet, info, path: cut, shared };
}

/** `recording` cut at `point`: its changes before it, its VBLs up to it, ended there by no game's end. */
function cutAt(recording: Recording, point: Omit<RecordingPoint, 'recording'>): Recording {
    if (point.changes > recording.changes.length || point.vbls > recording.vbls) throw new RecordingPackageError('the path does not reach its point');
    return { ...recording, changes: recording.changes.slice(0, point.changes), vbls: point.vbls, ended: true, end: null };
}

/** Where `root` starts, as a list shows it. */
function startOf(root: Recording): RecordingPackageStart {
    if (root.start.kind === 'new') return { kind: 'new' };
    const save = readCsbwinSaveInfo(root.start.bytes);
    if (!save) throw new RecordingPackageError('the path\'s root is no save the port reads');
    return { kind: 'save', level: save.level, champions: save.champions };
}

/** `pkg` as the file the server keeps: its JSON, gzipped. */
export async function writeRecordingPackage(pkg: RecordingPackage): Promise<Uint8Array> {
    checked(pkg);
    const json = {
        ...pkg,
        path: pkg.path.map((recording) => ({ ...recording, start: startToJson(recording.start) })),
        shared: pkg.shared.kind === 'save' ? { ...pkg.shared, file: toBase64(pkg.shared.file) } : pkg.shared,
    };
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

/** `pkg`, its form checked beyond its fields': the texts, the path's joins and its end. */
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
    const last = path[path.length - 1];
    if (!last) throw new RecordingPackageError('the path is empty');
    if (pkg.build !== last.build) throw new RecordingPackageError('the build is not the last recording\'s');
    path.forEach((recording, n) => {
        if (recording.dataSet !== pkg.dataSet) throw new RecordingPackageError(`recording ${n} is of another set`);
        const parent = n === 0 ? null : path[n - 1]!;
        if (parent && (recording.parent?.recording !== parent.id || recording.start.kind !== 'save'
            || recording.parent.changes !== parent.changes.length || recording.parent.vbls !== parent.vbls)) {
            throw new RecordingPackageError(`recording ${n} is no branch of the one before, joining it at its end`);
        }
        if (n < path.length - 1 && recording.end) throw new RecordingPackageError(`recording ${n} ends the game before the path's end`);
        let vbl = 0;
        for (const change of recording.changes) {
            if (change.vbl < vbl || change.vbl > recording.vbls) throw new RecordingPackageError(`recording ${n}'s changes are out of order`);
            vbl = change.vbl;
        }
    });
    if ((shared.kind === 'end') !== (last.end !== null)) throw new RecordingPackageError('its point is not where its path ends');
    if (JSON.stringify(info.start) !== JSON.stringify(startOf(path[0]!))) throw new RecordingPackageError('where it starts is not its root\'s start');
    return pkg;
}

/** The fields' types: what a JSON object must be to be a package. */
function packageFromJson(json: unknown): RecordingPackage {
    const pkg = record(json, 'the package');
    if (pkg['version'] !== RECORDING_PACKAGE_VERSION) throw new RecordingPackageError(`not a package of version ${RECORDING_PACKAGE_VERSION}`);
    const info = record(pkg['info'], 'the metadata');
    const start = record(info['start'], 'the metadata\'s start');
    const shared = record(pkg['shared'], 'the point');
    return {
        version: RECORDING_PACKAGE_VERSION,
        build: word(pkg['build'], 'the build'),
        dataSet: word(pkg['dataSet'], 'the set'),
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
        },
        path: array(pkg['path'], 'the path').map((recording, n) => recordingFromJson(recording, `recording ${n}`)),
        shared: shared['kind'] === 'end' ? { kind: 'end' }
            : shared['kind'] === 'save' ? { kind: 'save', file: bytes(shared['file'], 'the save\'s file'), inVbl: boolean(shared['inVbl'], 'the save\'s inVbl') }
                : fail('the point'),
    };
}

function recordingFromJson(json: unknown, what: string): Recording {
    const recording = record(json, what);
    const start = record(recording['start'], `${what}'s start`);
    return {
        id: word(recording['id'], `${what}'s id`),
        build: word(recording['build'], `${what}'s build`),
        dataSet: word(recording['dataSet'], `${what}'s set`),
        start: start['kind'] === 'new'
            ? { kind: 'new', random: uint32(start['random'], `${what}'s seed`), randomGameID: uint32(start['randomGameID'], `${what}'s playthrough`) }
            : start['kind'] === 'save'
                ? {
                    kind: 'save', bytes: bytes(start['bytes'], `${what}'s save`),
                    ...(start['carried'] === undefined ? {} : { carried: carriedFromJson(start['carried'], `${what}'s carried state`) }),
                }
                : fail(`${what}'s start`),
        parent: recording['parent'] === null ? null : pointFromJson(recording['parent'], `${what}'s parent`),
        rules: shaped(recording['rules'], RULES, `${what}'s rules`),
        extras: shaped(recording['extras'], NO_EXTRAS, `${what}'s extras`),
        changes: array(recording['changes'], `${what}'s changes`).map((change, n) => changeFromJson(change, `${what}'s change ${n}`)),
        vbls: count(recording['vbls'], `${what}'s VBLs`),
        ended: boolean(recording['ended'], `${what}'s ended`),
        end: recording['end'] === null ? null : endFromJson(recording['end'], `${what}'s end`),
    };
}

function pointFromJson(json: unknown, what: string): RecordingPoint {
    const point = record(json, what);
    const inVbl = point['inVbl'];
    if (inVbl !== undefined && inVbl !== true) fail(what);
    return {
        recording: word(point['recording'], what),
        changes: count(point['changes'], what),
        vbls: count(point['vbls'], what),
        ...(inVbl ? { inVbl } : {}),
    };
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

function changeFromJson(json: unknown, what: string): RecordedChange {
    const entry = record(json, what);
    const change = record(entry['change'], what);
    const kind = change['kind'];
    const int = (key: string) => integer(change[key], what);
    const read = (): InputChange => {
        switch (kind) {
            case 'click': return { kind, x: int('x'), y: int('y'), buttons: int('buttons') };
            case 'unclick': case 'tag0207cc': case 'saveWritten': case 'forceDMRules': return { kind };
            case 'key': return { kind, num: int('num') };
            case 'panelKey': return { kind, action: word(change['action'], what) };
            case 'reincarnateKey': return { kind, key: word(change['key'], what) };
            case 'reincarnateClick': return { kind, x: int('x'), y: int('y') };
            case 'pause': return { kind, paused: boolean(change['paused'], what) };
            case 'extras': return { kind, extras: shaped(change['extras'], NO_EXTRAS, what) };
            case 'devLevel': {
                const delta = change['delta'];
                return delta === 1 || delta === -1 ? { kind, delta } : fail(what);
            }
            case 'devMove': return { kind, map: int('map'), x: int('x'), y: int('y') };
            // A read ends its recording, which records nothing of it (`Recorder`).
            default: return fail(what);
        }
    };
    return { change: read(), vbl: count(entry['vbl'], what), time: count(entry['time'], what), random: uint32(entry['random'], what) };
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

function startToJson(start: RecordingStart): unknown {
    return start.kind === 'save' ? { ...start, bytes: toBase64(start.bytes) } : start;
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
