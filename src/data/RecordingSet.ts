/**
 * The set a recording plays over, found by its files (`DEBT.md` R18, `doc/RECORDING.md` →
 * "The set a recording plays over"). A recording carries the MD5 of each file its set had
 * read as it began (`Recording.files`, `FileDigests`), and names its set by id. A set's
 * files may change after it (a corrected `graphics.dat` item, a moderator's new
 * `dungeon.dat`), and the site may name a set's files by another id than the manifest's
 * (`dungeon-master-csbwin` for `dm-atari`'s), so the set played is the first, its own
 * first, whose files have every digest the path's recordings name; where none has, the
 * recording is refused, and the refusal says which file of its set no longer matches.
 */
import type { FileDigests } from './DataSetFiles';

/** A set's game files' digests, as the server gives them (`parseSetDigests`) or the tools read them. */
export interface SetDigests {
    readonly id: string;
    /** What a refusal calls it. */
    readonly name: string;
    readonly files: FileDigests;
}

/** What `findRecordingSet` decides. */
export type RecordingSet =
    /** The set to play over: the recording's own, or another whose files have its digests. */
    | { readonly kind: 'found'; readonly id: string }
    /** No set has them: why, as the page says it, and its own set's files that differ. */
    | { readonly kind: 'refused'; readonly why: string; readonly mismatched: readonly string[] };

/** What `findRecordingSet` reads of a recording. */
interface Digested {
    readonly dataSet: string;
    readonly files: FileDigests | null;
}

/**
 * The digests the recordings of `path` name, each file's in a set of its own: two
 * recordings that read one file with different bytes name both, and no set matches them.
 */
function namedDigests(path: readonly Digested[]): Map<string, Set<string>> {
    const named = new Map<string, Set<string>>();
    for (const recording of path) {
        for (const [name, digest] of Object.entries(recording.files ?? {})) {
            const digests = named.get(name) ?? new Set<string>();
            digests.add(digest);
            named.set(name, digests);
        }
    }
    return named;
}

/** The files of `named` whose digests `set` does not have, by name. */
function mismatchedFiles(named: ReadonlyMap<string, ReadonlySet<string>>, set: SetDigests): string[] {
    return [...named].filter(([name, digests]) => digests.size !== 1 || !digests.has(set.files[name] ?? '')).map(([name]) => name).sort();
}

/**
 * The set `path` plays over, among `sets`: the root's own set where its files have every
 * digest the path's recordings name, or else the first of the others that has them all. A
 * path that names no file (recorded before the digests) plays over its own set, whether
 * `sets` has it or not, as it always did.
 */
export function findRecordingSet(path: readonly Digested[], sets: readonly SetDigests[]): RecordingSet {
    const ownId = path[0]?.dataSet ?? '';
    const named = namedDigests(path);
    if (named.size === 0) return { kind: 'found', id: ownId };
    const own = sets.find((set) => set.id === ownId);
    const ordered = own ? [own, ...sets.filter((set) => set !== own)] : sets;
    const found = ordered.find((set) => mismatchedFiles(named, set).length === 0);
    if (found) return { kind: 'found', id: found.id };
    const files = [...named.keys()].sort().join(', ');
    if (!own) return { kind: 'refused', why: `The recording's set, ${ownId}, is not on this site, and no set it has holds its files (${files}).`, mismatched: [] };
    const mismatched = mismatchedFiles(named, own);
    const these = mismatched.length === 1 ? `${mismatched[0]} no longer matches` : `${mismatched.join(', ')} no longer match`;
    return { kind: 'refused', why: `${own.name}'s ${these} the recording, and no other set on this site holds its files.`, mismatched };
}

/**
 * The server's answer to `DATA_SET_FILES_ROUTE`, `{"dataSets": [{"id", "files": {<name>:
 * <md5>}}]}`, the sets named by `names` (the manifest's names, by id; an id it lacks is
 * named by its id). One that does not read throws, and the error says why.
 */
export function parseSetDigests(text: string, names: ReadonlyMap<string, string>): SetDigests[] {
    const fail = (why: string): never => {
        throw new Error(`The sets' files' digests are not usable: ${why}.`);
    };
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return fail(`they are not JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    const list = (json as { dataSets?: unknown } | null)?.dataSets;
    if (!Array.isArray(list)) return fail('"dataSets" is not a list');
    return list.map((entry: unknown, i): SetDigests => {
        const { id, files } = (entry ?? {}) as Record<string, unknown>;
        if (typeof id !== 'string') return fail(`set ${i} has no "id"`);
        if (typeof files !== 'object' || files === null || Array.isArray(files)
            || !Object.values(files).every((digest) => typeof digest === 'string' && /^[0-9a-f]{32}$/.test(digest))) {
            return fail(`set '${id}' has "files" that are not an MD5 digest by name`);
        }
        return { id, name: names.get(id) ?? id, files: files as FileDigests };
    });
}
