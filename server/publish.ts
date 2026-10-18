/**
 * `POST api/data-sets`: a player's own set (`src/data/LocalDataSets.ts`) published to the
 * site, pending a moderator's approval (`moderate.ts`). `app.ts` takes the request, counts
 * it against the address's rate, names its player and reads its form; this module decides.
 *
 * The form's fields are the record's: `id`, `name`, `description`, `authors` once per
 * author, `dmRules`, `thumbnailAsTitle` and `official` (`true` or `false`) and `baseSet`, each once, and its files by the
 * name the game reads them under, `thumbnail` a PNG of 320x200 (`LOCAL_DATA_SET_FILES`,
 * `THUMBNAIL_WIDTH`). Nothing else.
 * The rules, in order, each answered with nothing written:
 *
 *   400  a field missing, twice, of the wrong kind, unknown or longer than the form takes
 *        (`LOCAL_DATA_SET_TEXT_LIMITS`), or an id that is not a folder's name
 *        (`LOCAL_ID_PATTERN`) once its `local:` is dropped
 *   403  `official` true from a player who does not moderate: only a moderator says a set
 *        is one of FTL's own games
 *   413  a file over `MAX_PUBLISHED_FILE_BYTES`
 *   409  an id the table holds, pending or not, or that `GAMEFILES_DIR` holds an entry of
 *        (a folder no row names)
 *   422  the page's own check (`CheckDataSet`) finds a problem, as the form would show it,
 *        or the thumbnail is not a PNG, or one of another size than 320x200
 *
 * Then the folder: written whole as `GAMEFILES_DIR/.<id>.<uuid>.partial/`, which the server
 * never serves (`pathSegments`), and renamed `GAMEFILES_DIR/<id>/`, which fails where another
 * publish of the id renamed first (409). A set without a `graphics.dat` has its base set's
 * copied in, so its folder is a CSBWin directory like any other; the thumbnail is
 * `<id>-thumbnail.png` (`thumbnailPath`). Then the row, pending and owned by the player
 * (`DataSetStore.publish`), its flags following from its files as `localDataSet`'s do,
 * and its dungeon's walls the check's.
 * The folder is never changed after: `backup.ts` copies it once, and a moderator's edit of
 * the set's files writes a new one (`edit.ts`), as does a document added or removed (`documents.ts`).
 *
 * 201 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`, and a 422 the problems too,
 * `[{"about": "<field or file>", "text": "<why>"}]`. No answer, and no log, holds the
 * `playerId`. A set published is notified (`notify.ts`), as added by `publisher`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    EDIT_REMOVE_FIELD, LOCAL_DATA_SET_FILES, LOCAL_DATA_SET_PREFIX, LOCAL_DATA_SET_TEXT_LIMITS, LOCAL_ID_PATTERN, PNG_HEAD_BYTES, pngSize, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH,
} from '../src/data/DataSets.ts';
import type { DataSetStore, DataSetWalls, StoredDataSet } from './dataSets.ts';
import type { Notify } from './notify.ts';

/** The largest file a set may hold: Conflux's `CSBgraphics.dat` is 12 MB. */
export const MAX_PUBLISHED_FILE_BYTES = 16 * 1024 * 1024;

/** The largest request `api/data-sets` reads: a set's files, and its fields. */
export const MAX_PUBLISH_BYTES = 32 * 1024 * 1024;

/** The files of a set's folder, by name, as the page reads them (`DataSetFiles`, `src/data/DataSetFiles.ts`). */
export interface DataSetFolder {
    /** The file `name`'s bytes, or `null` where the set has none, or it cannot be read. */
    read(name: string): Promise<Uint8Array | null>;
    /** The file `name` as an error names it. */
    where(name: string): string;
}

/** A player's set as the page's form gives it (`LocalDataSetDraft`, `src/data/LocalDataSets.ts`). */
export interface DataSetDraft {
    /** The `<id>` of `local:<id>`. */
    id: string;
    name: string;
    description: string;
    authors: string[];
    dmRules: boolean;
    thumbnailAsTitle: boolean;
    official: boolean;
    /** The set whose `graphics.dat` it plays where `files` holds none. */
    baseSet: string;
    /** By the name the game reads them under, and `thumbnail`. */
    files: Partial<Record<string, Blob>>;
}

/**
 * The page's check of a player's own set, `checkLocalDataSet` (`src/data/LocalDataSets.ts`),
 * which `npm run build` makes a Node module (`vite.config.mts`) and the server loads at
 * start-up (`loadCheckDataSet`, `app.ts`), so that the server reads a set with the page's
 * own readers. It is typed here by its shape, since the page's sources are not erasable
 * syntax and the server's `tsc` cannot follow them; a tool that hands the API the source's
 * function proves that the two agree.
 */
export type CheckDataSet = (
    draft: DataSetDraft,
    takenIds: ReadonlySet<string>,
    base: (set: string) => DataSetFolder | null,
    createdAt: number,
) => Promise<{
    problems: Problem[];
    /** Its text trimmed, its empty authors dropped; `null` where there is a problem. */
    record: { id: string; name: string; description: string; authors: string[]; dmRules: boolean; thumbnailAsTitle: boolean; official: boolean; dungeonSignature: readonly string[] } | null;
    census: unknown;
    /** Its `dungeon.dat`'s walls, wherever it reads. */
    walls: DataSetWalls | null;
}>;

/**
 * The walls of a `dungeon.dat`, read as the check reads it: `readDungeonWalls`, beside
 * `checkLocalDataSet` in the same module. Throws where it does not read.
 */
export type ReadDungeonWalls = (bytes: Uint8Array) => Promise<DataSetWalls>;

/** What a problem of the check's is about, a field of the form or one of its files, and why. */
interface Problem {
    about: string;
    text: string;
}

/** What `publishDataSet` needs of the server. */
export interface PublishOptions {
    checkDataSet: CheckDataSet;
    dataSets: DataSetStore;
    gamefilesDir: string;
    now: () => number;
    notify: Notify;
    /** Who the notification says published it: the sender's name where they moderate, `a player` otherwise. */
    publisher: string;
    /** Whether the sender moderates, and so may publish an official set. */
    moderates: boolean;
}

/** The status and the JSON body `api/data-sets` answers a publish with. */
export interface PublishAnswer {
    status: number;
    body: { id: string } | { error: string; problems?: Problem[] };
}

/** The text fields of a publish's form; an edit's are the same but `id`, its URL's. */
const TEXT_FIELDS = ['id', 'name', 'description', 'dmRules', 'thumbnailAsTitle', 'official', 'baseSet'] as const;

/** A set's form, read: a draft, the `id` `''` for an edit's, and the files an edit removes. */
export interface SetForm extends DataSetDraft {
    files: Partial<Record<string, File>>;
    remove: string[];
}

/**
 * `form` read as a publish's, or as an edit's (`edit.ts`): its fields, each as `publishDataSet`
 * says, and an edit's `remove`s, each a file of `LOCAL_DATA_SET_FILES` once, and none given
 * too; or the refusal, a 400 or a 413.
 */
export function readSetForm(form: FormData, edit: boolean): SetForm | PublishAnswer {
    const refuse = (status: number, error: string): PublishAnswer => ({ status, body: { error } });

    const fields = edit ? TEXT_FIELDS.filter((field) => field !== 'id') : TEXT_FIELDS;
    const known = new Set<string>([...fields, 'authors', ...LOCAL_DATA_SET_FILES, ...(edit ? [EDIT_REMOVE_FIELD] : [])]);
    const unknown = [...new Set(form.keys())].find((key) => !known.has(key));
    if (unknown !== undefined) return refuse(400, `The form has a field '${unknown}' a set does not.`);
    const text: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = { id: '' };
    for (const field of fields) {
        const values = form.getAll(field);
        if (values.length !== 1 || typeof values[0] !== 'string') return refuse(400, `The form's '${field}' is not one text.`);
        text[field] = values[0];
    }
    const { name, description, dmRules, thumbnailAsTitle, official, baseSet } = text as Record<(typeof TEXT_FIELDS)[number], string>;
    const authors = form.getAll('authors');
    if (!authors.every((author) => typeof author === 'string')) return refuse(400, "The form's 'authors' are not texts.");
    for (const [field, value] of [['dmRules', dmRules], ['thumbnailAsTitle', thumbnailAsTitle], ['official', official]]) {
        if (value !== 'true' && value !== 'false') return refuse(400, `The form's '${field}' is neither 'true' nor 'false'.`);
    }
    const lengths = { name: name.length, description: description.length, authors: authors.join(',').length };
    const said = { name: 'The name is', description: 'The description is', authors: 'The authors are' };
    for (const field of ['name', 'description', 'authors'] as const) {
        if (lengths[field] > LOCAL_DATA_SET_TEXT_LIMITS[field]) return refuse(400, `${said[field]} longer than ${LOCAL_DATA_SET_TEXT_LIMITS[field]} characters.`);
    }
    const id = text.id!.startsWith(LOCAL_DATA_SET_PREFIX) ? text.id!.slice(LOCAL_DATA_SET_PREFIX.length) : text.id!;
    if (!edit && !LOCAL_ID_PATTERN.test(id)) return refuse(400, "An id is lowercase letters, digits, '.', '-' and '_', a letter or a digit first, at most 40.");
    const files: Partial<Record<string, File>> = {};
    for (const file of LOCAL_DATA_SET_FILES) {
        const values = form.getAll(file);
        if (values.length === 0) continue;
        if (values.length !== 1 || typeof values[0] === 'string') return refuse(400, `The form's '${file}' is not one file.`);
        if (values[0].size > MAX_PUBLISHED_FILE_BYTES) return refuse(413, `${file} is larger than ${MAX_PUBLISHED_FILE_BYTES / (1024 * 1024)} MiB.`);
        files[file] = values[0];
    }
    const remove = form.getAll(EDIT_REMOVE_FIELD);
    for (const file of remove) {
        if (typeof file !== 'string' || !(LOCAL_DATA_SET_FILES as readonly string[]).includes(file)) return refuse(400, `The form's '${EDIT_REMOVE_FIELD}' names no file of a set.`);
        if (remove.indexOf(file) !== remove.lastIndexOf(file) || files[file]) return refuse(400, `The form removes ${file} twice, or gives it too.`);
    }
    return { id, name, description, authors: authors as string[], dmRules: dmRules === 'true', thumbnailAsTitle: thumbnailAsTitle === 'true',
        official: official === 'true', baseSet, files, remove: remove as string[] };
}

/** What `checkSet` makes of a set that passes. */
type Checked = { record: NonNullable<Awaited<ReturnType<CheckDataSet>>['record']>; walls: DataSetWalls };

/**
 * `draft` read by the page's check, with `gamefilesDir`'s site's sets its base sets, and its
 * thumbnail, if any, a PNG of 320x200; or the refusal, a 422 with the problems.
 */
export async function checkSet(draft: DataSetDraft, checkDataSet: CheckDataSet, dataSets: DataSetStore, gamefilesDir: string, now: number): Promise<Checked | PublishAnswer> {
    const { problems, record, walls } = await checkDataSet(draft, new Set(), (set) => baseFolder(dataSets, gamefilesDir, set), now);
    const thumbnail = draft.files.thumbnail;
    const size = thumbnail && pngSize(new Uint8Array(await thumbnail.slice(0, PNG_HEAD_BYTES).arrayBuffer()));
    if (thumbnail && !size) problems.push({ about: 'thumbnail', text: 'It is not a PNG.' });
    else if (size && (size.width !== THUMBNAIL_WIDTH || size.height !== THUMBNAIL_HEIGHT)) {
        problems.push({ about: 'thumbnail', text: `It is ${size.width}x${size.height}, not ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}.` });
    }
    if (problems.length > 0 || !record || !walls) return { status: 422, body: { error: 'The set does not pass the check.', problems } };
    return { record, walls };
}

/** The site's set `set`, one with no owner, whose `graphics.dat` a set without one plays. */
function siteSet(dataSets: DataSetStore, set: string): StoredDataSet | null {
    return dataSets.read().dataSets.find((stored) => stored.id === set && stored.owner === null) ?? null;
}

function baseFolder(dataSets: DataSetStore, gamefilesDir: string, set: string): DataSetFolder | null {
    const stored = siteSet(dataSets, set);
    return stored && diskFolder(join(gamefilesDir, stored.dir), stored.id);
}

/**
 * The folder `partial` given `set`'s `files`, each by the name the game reads it under,
 * the thumbnail `<id>-thumbnail.png` (`thumbnailPath`, which needs a whole `DataSet`),
 * and, where it has no `graphics.dat` once they are written, its base set's.
 */
export async function writeSetFiles(partial: string, id: string, files: Partial<Record<string, Blob>>, baseSet: string, dataSets: DataSetStore, gamefilesDir: string): Promise<void> {
    for (const [file, blob] of Object.entries(files)) {
        await writeFile(join(partial, file === 'thumbnail' ? thumbnailFile(id) : file), new Uint8Array(await blob!.arrayBuffer()));
    }
    if (!existsSync(join(partial, 'graphics.dat'))) {
        await copyFile(join(gamefilesDir, siteSet(dataSets, baseSet)!.dir, 'graphics.dat'), join(partial, 'graphics.dat'));
    }
}

/** The name of the thumbnail of the set `id` in its folder (`thumbnailPath`). */
export function thumbnailFile(id: string): string {
    return `${id}-thumbnail.png`;
}

/** `form`, sent by `owner`, a `playerId`, checked and, where it passes, published. */
export async function publishDataSet(form: FormData, owner: string, { checkDataSet, dataSets, gamefilesDir, now, notify, publisher, moderates }: PublishOptions): Promise<PublishAnswer> {
    const refuse = (status: number, error: string): PublishAnswer => ({ status, body: { error } });

    const draft = readSetForm(form, false);
    if ('status' in draft) return draft;
    const { id, files, baseSet } = draft;
    if (draft.official && !moderates) return refuse(403, 'Only a moderator may publish an official game.');

    if (dataSets.hasSet(id)) return refuse(409, 'The site already has a set of this id.');
    const folder = join(gamefilesDir, id);
    if (existsSync(folder)) return refuse(409, 'The site already has a folder of this name.');

    const checked = await checkSet(draft, checkDataSet, dataSets, gamefilesDir, now());
    if ('status' in checked) return checked;
    const { record, walls } = checked;

    const partial = join(gamefilesDir, `.${id}.${randomUUID()}.partial`);
    try {
        await mkdir(partial);
        await writeSetFiles(partial, id, files, baseSet, dataSets, gamefilesDir);
        try {
            await rename(partial, folder);
        } catch {
            return refuse(409, 'The site already has a folder of this name.');
        }
    } finally {
        await rm(partial, { recursive: true, force: true });
    }

    try {
        dataSets.publish({
            id, name: record.name, description: record.description, authors: record.authors,
            csbGraphics: files['CSBgraphics.dat'] !== undefined,
            hintOracle: files['hcsb.hct'] !== undefined && files['hcsb.dat'] !== undefined,
            dmRules: record.dmRules,
            thumbnailAsTitle: record.thumbnailAsTitle,
            official: record.official,
            walls,
        }, owner);
    } catch (error) {
        await rm(folder, { recursive: true, force: true });
        throw error;
    }
    console.log(`Published '${id}', pending`);
    notify({ name: record.name, activity: 'added', by: publisher, at: now() });
    return { status: 201, body: { id } };
}

/** The files of `dir` on disk, `set`'s folder. */
export function diskFolder(dir: string, set: string): DataSetFolder {
    return {
        read: (name) => readFile(join(dir, name)).then((bytes) => new Uint8Array(bytes), () => null),
        where: (name) => `${set}/${name}`,
    };
}
