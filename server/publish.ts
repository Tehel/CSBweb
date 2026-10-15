/**
 * `POST api/data-sets`: a player's own set (`src/data/LocalDataSets.ts`) published to the
 * site, pending a moderator's approval (`moderate.ts`). `app.ts` takes the request, counts
 * it against the address's rate, names its player and reads its form; this module decides.
 *
 * The form's fields are the record's: `id`, `name`, `description`, `authors` once per
 * author, `dmRules` (`true` or `false`) and `baseSet`, each once, and its files by the
 * name the game reads them under, `thumbnail` a PNG of 320x200 (`LOCAL_DATA_SET_FILES`,
 * `THUMBNAIL_WIDTH`). Nothing else.
 * The rules, in order, each answered with nothing written:
 *
 *   400  a field missing, twice, of the wrong kind, unknown or longer than the form takes
 *        (`LOCAL_DATA_SET_TEXT_LIMITS`), or an id that is not a folder's name
 *        (`LOCAL_ID_PATTERN`) once its `local:` is dropped
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
 * The folder is never changed after: `backup.ts` copies it once.
 *
 * 201 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`, and a 422 the problems too,
 * `[{"about": "<field or file>", "text": "<why>"}]`. No answer, and no log, holds the
 * `playerId`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    LOCAL_DATA_SET_FILES, LOCAL_DATA_SET_PREFIX, LOCAL_DATA_SET_TEXT_LIMITS, LOCAL_ID_PATTERN, PNG_HEAD_BYTES, pngSize, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH,
} from '../src/data/DataSets.ts';
import type { DataSetStore, DataSetWalls } from './dataSets.ts';

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
    record: { id: string; name: string; description: string; authors: string[]; dmRules: boolean; dungeonSignature: readonly string[] } | null;
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
}

/** The status and the JSON body `api/data-sets` answers a publish with. */
export interface PublishAnswer {
    status: number;
    body: { id: string } | { error: string; problems?: Problem[] };
}

const TEXT_FIELDS = ['id', 'name', 'description', 'dmRules', 'baseSet'] as const;

/** `form`, sent by `owner`, a `playerId`, checked and, where it passes, published. */
export async function publishDataSet(form: FormData, owner: string, { checkDataSet, dataSets, gamefilesDir, now }: PublishOptions): Promise<PublishAnswer> {
    const refuse = (status: number, error: string, problems?: Problem[]): PublishAnswer => ({ status, body: problems ? { error, problems } : { error } });

    const known = new Set<string>([...TEXT_FIELDS, 'authors', ...LOCAL_DATA_SET_FILES]);
    const unknown = [...new Set(form.keys())].find((key) => !known.has(key));
    if (unknown !== undefined) return refuse(400, `The form has a field '${unknown}' a set does not.`);
    const text: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = {};
    for (const field of TEXT_FIELDS) {
        const values = form.getAll(field);
        if (values.length !== 1 || typeof values[0] !== 'string') return refuse(400, `The form's '${field}' is not one text.`);
        text[field] = values[0];
    }
    const { name, description, dmRules, baseSet } = text as Record<(typeof TEXT_FIELDS)[number], string>;
    const authors = form.getAll('authors');
    if (!authors.every((author) => typeof author === 'string')) return refuse(400, "The form's 'authors' are not texts.");
    if (dmRules !== 'true' && dmRules !== 'false') return refuse(400, "The form's 'dmRules' is neither 'true' nor 'false'.");
    const lengths = { name: name.length, description: description.length, authors: authors.join(',').length };
    const said = { name: 'The name is', description: 'The description is', authors: 'The authors are' };
    for (const field of ['name', 'description', 'authors'] as const) {
        if (lengths[field] > LOCAL_DATA_SET_TEXT_LIMITS[field]) return refuse(400, `${said[field]} longer than ${LOCAL_DATA_SET_TEXT_LIMITS[field]} characters.`);
    }
    const id = text.id!.startsWith(LOCAL_DATA_SET_PREFIX) ? text.id!.slice(LOCAL_DATA_SET_PREFIX.length) : text.id!;
    if (!LOCAL_ID_PATTERN.test(id)) return refuse(400, "An id is lowercase letters, digits, '.', '-' and '_', a letter or a digit first, at most 40.");
    const files: Partial<Record<string, File>> = {};
    for (const file of LOCAL_DATA_SET_FILES) {
        const values = form.getAll(file);
        if (values.length === 0) continue;
        if (values.length !== 1 || typeof values[0] === 'string') return refuse(400, `The form's '${file}' is not one file.`);
        if (values[0].size > MAX_PUBLISHED_FILE_BYTES) return refuse(413, `${file} is larger than ${MAX_PUBLISHED_FILE_BYTES / (1024 * 1024)} MiB.`);
        files[file] = values[0];
    }

    if (dataSets.hasSet(id)) return refuse(409, 'The site already has a set of this id.');
    const folder = join(gamefilesDir, id);
    if (existsSync(folder)) return refuse(409, 'The site already has a folder of this name.');

    const siteSet = (set: string) => dataSets.read().dataSets.find((stored) => stored.id === set && stored.owner === null) ?? null;
    const base = (set: string): DataSetFolder | null => {
        const stored = siteSet(set);
        return stored && diskFolder(join(gamefilesDir, stored.dir), stored.id);
    };
    const draft: DataSetDraft = { id, name, description, authors: authors as string[], dmRules: dmRules === 'true', baseSet, files };
    const { problems, record, walls } = await checkDataSet(draft, new Set(), base, now());
    const thumbnail = files.thumbnail;
    const size = thumbnail && pngSize(new Uint8Array(await thumbnail.slice(0, PNG_HEAD_BYTES).arrayBuffer()));
    if (thumbnail && !size) problems.push({ about: 'thumbnail', text: 'It is not a PNG.' });
    else if (size && (size.width !== THUMBNAIL_WIDTH || size.height !== THUMBNAIL_HEIGHT)) {
        problems.push({ about: 'thumbnail', text: `It is ${size.width}x${size.height}, not ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}.` });
    }
    if (problems.length > 0 || !record || !walls) return refuse(422, 'The set does not pass the check.', problems);

    const partial = join(gamefilesDir, `.${id}.${randomUUID()}.partial`);
    try {
        await mkdir(partial);
        for (const [file, blob] of Object.entries(files)) {
            // `thumbnailPath`'s name, which needs a whole `DataSet`.
            const written = join(partial, file === 'thumbnail' ? `${id}-thumbnail.png` : file);
            await writeFile(written, new Uint8Array(await blob!.arrayBuffer()));
        }
        if (!files['graphics.dat']) {
            const stored = siteSet(baseSet)!;
            await copyFile(join(gamefilesDir, stored.dir, 'graphics.dat'), join(partial, 'graphics.dat'));
        }
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
            walls,
        }, owner);
    } catch (error) {
        await rm(folder, { recursive: true, force: true });
        throw error;
    }
    console.log(`Published '${id}', pending`);
    return { status: 201, body: { id } };
}

/** The files of `dir` on disk, `set`'s folder. */
function diskFolder(dir: string, set: string): DataSetFolder {
    return {
        read: (name) => readFile(join(dir, name)).then((bytes) => new Uint8Array(bytes), () => null),
        where: (name) => `${set}/${name}`,
    };
}
