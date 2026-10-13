/**
 * A player's own data sets: a dungeon from their own files, kept in the browser's store
 * (`BrowserDataSetStore`, `src/data/saves/`) and played as any set of the manifest's is.
 *
 * CSBWin plays whatever its directory holds (`src/data/DataSets.ts`); a local set is such
 * a directory, held as a record of files by name. Its `?dungeon=` is `local:<id>`, the
 * `<id>` the player's, and no manifest set's id has the prefix (`parseManifest`), so a
 * local set never stands for a set of the site's.
 *
 * A record without a `graphics.dat` plays its base set's, DM's or CSB's, read from that
 * set's folder (`recordFiles`). The set has no `mini.dat`, so its entrance has no RISE, and
 * it sends no statistics (`GameEvents`).
 */
import { CSBGraphicsLoader, CSBGRAPHICS_SENTINEL } from './CSBGraphicsLoader';
import { readRuntimeFileSignatures } from './CsbwinExpool';
import { csbGraphicsExpected, noExpectedSignatures, readExpectedSignatures } from './CsbwinExtendedFeatures';
import { LOCAL_DATA_SET_PREFIX, type DataSet } from './DataSets';
import type { DataSetFiles } from './DataSetFiles';
import { DungeonLoader } from './DungeonLoader';
import { dungeonSignature, type DungeonSignature } from './DungeonSignature';
import type { DungeonData } from './dungeonTypes';
import { csbGraphicsSignatureRefused, graphicsSignatureRefused, Signature, type FileSignature } from './FileSignature';
import { GraphicsLoader, MAX_GRAPHICS_ITEMS } from './GraphicsLoader';
import { extractGraphicsTables } from './tables/GraphicsTables';
import { readU16BE } from '../core/bytes';
import { dungeonCensus, type DungeonCensus } from '../engine/DungeonCensus';
import { buildGameTables } from '../engine/GameTables';
import { parseHcsbDat } from './HintOracleLoader';
import { bigEndianDungeonDat } from './LittleEndianDungeon';

/** The files a record may hold, by the name the game reads them under. */
export type LocalDataSetFile = 'dungeon.dat' | 'graphics.dat' | 'CSBgraphics.dat' | 'hcsb.hct' | 'hcsb.dat' | 'thumbnail';

/** A local set, as the store holds it. */
export interface LocalDataSetRecord {
    /** `local:<id>`: the store's key, the page's `?dungeon=`, and the data set its saves are filed under. */
    id: string;
    name: string;
    /** A line or two for the welcome page. */
    description: string;
    authors: string[];
    /** `DataSet.dmRules`: whether a reincarnated champion keeps their attributes. */
    dmRules: boolean;
    /** The set whose `graphics.dat` it plays, `dm-atari` or `csb`, where it has none of its own; `null` where it has. */
    baseSet: string | null;
    /** `dungeon.dat` always; the others where the player gave them. `thumbnail` is an image. */
    files: Partial<Record<LocalDataSetFile, Blob>>;
    /** Its `dungeon.dat`'s signature (`dungeonSignature`), which tells its saves. */
    dungeonSignature: DungeonSignature;
    /** When it was added, in milliseconds since the epoch. */
    createdAt: number;
}

/** Whether `id`, a `?dungeon=` or a save's data set, names a local set. */
export function isLocalDataSetId(id: string | null): boolean {
    return id !== null && id.startsWith(LOCAL_DATA_SET_PREFIX);
}

/**
 * The set `record` plays. Its flags follow from its files: a `CSBgraphics.dat` is an
 * overlay to open, and the two Oracle files are the Hint Oracle. It has no folder: its
 * files are read through `recordFiles`. Its dungeon is its record's, which its saves are
 * checked against (`checkDungeon`).
 */
export function localDataSet(record: LocalDataSetRecord): DataSet {
    const { files } = record;
    return {
        id: record.id,
        name: record.name,
        dir: '',
        csbGraphics: files['CSBgraphics.dat'] !== undefined,
        miniDat: false,
        hintOracle: files['hcsb.hct'] !== undefined && files['hcsb.dat'] !== undefined,
        dmRules: record.dmRules,
        hidden: false,
        pending: false,
        dungeonSignature: record.dungeonSignature,
    };
}

/**
 * The files of `record`, its own Blobs. Without a `graphics.dat` of its own, it reads
 * `base`'s, its base set's folder; `null` where it names none. The thumbnail is not a
 * game file, and is not read here.
 */
export function recordFiles(record: LocalDataSetRecord, base: DataSetFiles | null): DataSetFiles {
    return {
        async read(name) {
            const blob = name === 'thumbnail' ? undefined : record.files[name as LocalDataSetFile];
            if (blob) return new Uint8Array(await blob.arrayBuffer());
            return name === 'graphics.dat' && base ? base.read(name) : null;
        },
        where: (name) => name === 'graphics.dat' && !record.files[name] && base ? base.where(name) : `${record.id}/${name}`,
    };
}

/** What the form that adds a set gives (`src/ui/addDataSetForm.ts`): a record but what `checkLocalDataSet` adds. */
export interface LocalDataSetDraft {
    /** The `<id>` of `local:<id>`. */
    id: string;
    name: string;
    description: string;
    authors: string[];
    dmRules: boolean;
    /** The set whose `graphics.dat` it plays where `files` holds none: `dm-atari` or `csb`. */
    baseSet: string;
    files: Partial<Record<LocalDataSetFile, Blob>>;
}

/** What a problem is about: a field of the form, or one of its files. */
export type LocalDataSetField = 'id' | 'name' | 'baseSet' | LocalDataSetFile;

export interface LocalDataSetProblem {
    about: LocalDataSetField;
    text: string;
}

/**
 * The `<id>` a player may give: lowercase letters, digits, `.`, `-` and `_`, a letter or a
 * digit first, at most 40. A published set's id is its folder on the server (`DEBT.md`
 * P8), so it is a folder's name everywhere.
 */
export const LOCAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * `draft` checked as the boot will read its files, and the record it makes where nothing
 * is wrong, added at `createdAt`; `null` where something is.
 *
 * - The id is given, a folder's name (`LOCAL_ID_PATTERN`), and none of `takenIds`'.
 * - `dungeon.dat` is given and reads, enciphered or not (`DungeonLoader.loadDungeonDat`):
 *   where it does not, the boot dies (`Game.readDungeonDat`). It has a level, and the
 *   party's start square is on the first (`unstartableDungeon`).
 * - The `graphics.dat` it plays, its own or its base set's (`base`), gives the tables the
 *   boot builds from it (`extractGraphicsTables`, `buildGameTables`), and is the one the
 *   dungeon names, if it names one (`graphicsSignatureRefused`).
 * - Its `CSBgraphics.dat` parses, and is the one the dungeon names
 *   (`csbGraphicsSignatureRefused`); without one, the dungeon's Extended Features block
 *   does not expect one (`csbGraphicsExpected`). Either is the boot's death
 *   (`src/engine/FileSignatures.ts`).
 * - The Hint Oracle is both its files or neither, and `hcsb.dat` parses.
 * - The thumbnail is an image.
 *
 * With them, what the dungeon holds (`dungeonCensus`) wherever its `dungeon.dat` reads,
 * whatever else is wrong; `null` where it does not.
 *
 * Each file is read, parsed and hashed once (`fileReads`), so that a check after a
 * field's change costs only the fields'.
 */
export async function checkLocalDataSet(
    draft: LocalDataSetDraft,
    takenIds: ReadonlySet<string>,
    base: (set: string) => DataSetFiles | null,
    createdAt: number,
): Promise<{ problems: LocalDataSetProblem[]; record: LocalDataSetRecord | null; census: DungeonCensus | null }> {
    const problems: LocalDataSetProblem[] = [];
    const problem = (about: LocalDataSetField, text: string): void => {
        problems.push({ about, text });
    };
    const { files } = draft;

    const id = `${LOCAL_DATA_SET_PREFIX}${draft.id}`;
    if (draft.id === '') problem('id', 'Give it an id.');
    else if (!LOCAL_ID_PATTERN.test(draft.id)) problem('id', "An id is lowercase letters, digits, '.', '-' and '_', a letter or a digit first, at most 40.");
    else if (takenIds.has(id)) problem('id', 'One of your dungeons already has this id.');
    if (draft.name.trim() === '') problem('name', 'Give it a name.');

    const dungeonDat = files['dungeon.dat'];
    const read = dungeonDat ? await readDungeon(dungeonDat) : null;
    if (!dungeonDat) problem('dungeon.dat', 'A dungeon.dat is needed.');
    else if (read!.error !== null) problem('dungeon.dat', `It does not read: ${read!.error}`);
    const dungeon = read?.dungeon ?? null;
    const unstartable = dungeon && unstartableDungeon(dungeon);
    if (unstartable) problem('dungeon.dat', unstartable);
    const runtime = dungeon && readRuntimeFileSignatures(dungeon);

    const ownGraphics = files['graphics.dat'];
    const graphicsAbout: LocalDataSetField = ownGraphics ? 'graphics.dat' : 'baseSet';
    const graphicsSource = ownGraphics ?? await base(draft.baseSet)?.read('graphics.dat') ?? null;
    if (!graphicsSource) problem('baseSet', `The graphics.dat of '${draft.baseSet}' cannot be read.`);
    else {
        const graphics = await readGraphics(graphicsSource);
        if (graphics.error !== null) problem(graphicsAbout, `It is not a graphics.dat: ${graphics.error}`);
        else {
            const refused = runtime && graphicsSignatureRefused(runtime, graphics.signature!);
            if (refused !== null) problem(graphicsAbout, `The dungeon was made for another graphics.dat (signature ${runtime!.graphicsSignature}, this one's ${refused}).`);
        }
    }

    const csbGraphicsFile = files['CSBgraphics.dat'];
    if (csbGraphicsFile) {
        const csbGraphics = await readCsbGraphics(csbGraphicsFile);
        if (csbGraphics.error !== null) problem('CSBgraphics.dat', `It is not a CSBgraphics.dat: ${csbGraphics.error}`);
        else {
            const refused = runtime && csbGraphicsSignatureRefused(runtime, csbGraphics.signature!);
            if (refused !== null) problem('CSBgraphics.dat', `The dungeon was made for another CSBgraphics.dat (signature ${runtime!.csbGraphicsSignature}, this one's ${refused}).`);
        }
    } else if (dungeon) {
        const expected = noExpectedSignatures();
        readExpectedSignatures(expected, dungeon.extendedFeatures);
        if (csbGraphicsExpected(expected)) problem('CSBgraphics.dat', 'The dungeon needs its CSBgraphics.dat.');
    }

    const hct = files['hcsb.hct'], dat = files['hcsb.dat'];
    if (hct && !dat) problem('hcsb.dat', 'The Hint Oracle needs hcsb.dat beside hcsb.hct.');
    if (dat && !hct) problem('hcsb.hct', 'The Hint Oracle needs hcsb.hct beside hcsb.dat.');
    if (dat) {
        const error = await readHcsbDat(dat);
        if (error !== null) problem('hcsb.dat', `It is not the Hint Oracle's hcsb.dat: ${error}`);
    }
    const thumbnail = files.thumbnail;
    if (thumbnail && !thumbnail.type.startsWith('image/')) problem('thumbnail', 'It is not an image.');

    const census = read?.census ?? null;
    if (problems.length > 0 || !dungeon) return { problems, record: null, census };
    return {
        problems,
        census,
        record: {
            id,
            name: draft.name.trim(),
            description: draft.description.trim(),
            authors: draft.authors.map((author) => author.trim()).filter((author) => author !== ''),
            dmRules: draft.dmRules,
            baseSet: ownGraphics ? null : draft.baseSet,
            files: { ...files },
            dungeonSignature: read!.signature!,
            createdAt,
        },
    };
}

/**
 * Why the party cannot start in `dungeon`, or `null` where it can. A new game puts the
 * party on the header's square of level 0 (`ReadDatabases`,
 * `doc/CSBwin-src/SaveGame.cpp:2613-2622`), and nothing in CSBWin checks either: a
 * header of zeros reads as a dungeon of no level (`numLevel` 0 fetches no descriptor,
 * `:2623-2639`), and a square past level 0's last column or row has no cell among the
 * column pointers built for it (`:2881-2916`). The port's boot puts the party in a wall.
 */
function unstartableDungeon(dungeon: DungeonData): string | null {
    const first = dungeon.maps[0]?.descriptor;
    if (!first) return 'It has no level.';
    const { x, y } = dungeon.header.startPosition;
    if (x >= first.width || y >= first.height) {
        return `The party starts at (${x}, ${y}), off the first level, which is ${first.width} by ${first.height}.`;
    }
    return null;
}

/**
 * Which of a record's game files `file` is, told by what it holds, or `null` where it
 * reads as none of them:
 *
 * - `CSBgraphics.dat` opens with `CSBg` (`CSBGraphicsLoader`), and a plain `hcsb.hct`
 *   with the words 2 and 13 (`parseHintOracle`).
 * - `graphics.dat` and `hcsb.dat` share `GraphicsLoader`'s format: a first word counting
 *   the items, then their sizes, packed and unpacked, and the packed items, which the
 *   file holds. In that shape it is `hcsb.dat` where `parseHcsbDat` reads it, and
 *   `graphics.dat` where the boot's tables build from it.
 * - `dungeon.dat` has no mark of its own: it opens with an Extended Features block, the
 *   compressed image's 33028, or a header whose first word is a random seed, each of
 *   them enciphered or not. It is one where `loadDungeonDat` reads it.
 *
 * An `hcsb.hct` enciphered with its dungeon's key is not told. Each reading is the
 * check's own (`once`), so telling a file costs the check nothing.
 */
export async function identifyLocalDataSetFile(file: Blob): Promise<Exclude<LocalDataSetFile, 'thumbnail'> | null> {
    const head = new Uint8Array(await file.slice(0, 2 + 2 * MAX_GRAPHICS_ITEMS).arrayBuffer());
    const word = (at: number): number => at + 2 <= head.length ? readU16BE(head, at) : -1;
    if (String.fromCharCode(...head.subarray(0, 4)) === CSBGRAPHICS_SENTINEL) return 'CSBgraphics.dat';
    if (word(0) === 2 && word(2) === 13) return 'hcsb.hct';
    const items = word(0);
    if (items > 0 && items <= MAX_GRAPHICS_ITEMS && file.size >= 2 + 4 * items) {
        let packed = 0;
        for (let i = 0; i < items; i++) packed += word(2 + 2 * i);
        if (2 + 4 * items + packed <= file.size) {
            if (await readHcsbDat(file) === null) return 'hcsb.dat';
            if ((await readGraphics(file)).error === null) return 'graphics.dat';
        }
    }
    return (await readDungeon(file)).error === null ? 'dungeon.dat' : null;
}

/**
 * `file` as a record keeps it: a PC `dungeon.dat` as the Atari file it is the twin of
 * (`bigEndianDungeonDat`), under its own name, and any other file as it is. A record
 * holds only what CSBWin reads, so nothing that reads a record meets the PC's byte order.
 */
export async function recordFile(file: File): Promise<File> {
    if (file.type.startsWith('image/')) return file;
    const atari = bigEndianDungeonDat(new Uint8Array(await file.arrayBuffer()));
    return atari ? new File([atari], file.name, { lastModified: file.lastModified }) : file;
}

/**
 * What the check reads of a file, worked out once for each Blob, or each `graphics.dat`
 * a base set's folder gave, and each reading of it: the form checks at every key the
 * player types, and a 10 MB `CSBgraphics.dat` is not read, parsed and hashed again for
 * each. A Blob never changes, and nothing writes to the bytes a folder gave.
 */
const fileReads = new WeakMap<Blob | Uint8Array, Map<string, Promise<unknown>>>();

function once<T>(file: Blob | Uint8Array, reading: string, work: () => Promise<T>): Promise<T> {
    let reads = fileReads.get(file);
    if (!reads) fileReads.set(file, reads = new Map());
    if (!reads.has(reading)) reads.set(reading, work());
    return reads.get(reading) as Promise<T>;
}

const why = (error: unknown): string => error instanceof Error ? error.message : String(error);

const bytesOf = async (file: Blob | Uint8Array): Promise<Uint8Array> =>
    file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());

/**
 * `file` read as a `dungeon.dat`, enciphered or not (`DungeonLoader.loadDungeonDat`): the
 * dungeon, what it holds (`dungeonCensus`) and its signature (`dungeonSignature`); or why
 * it does not read.
 */
function readDungeon(file: Blob): Promise<{ dungeon: DungeonData | null; error: string | null; census: DungeonCensus | null; signature: DungeonSignature | null }> {
    return once(file, 'dungeon.dat', async () => {
        let dungeon: DungeonData;
        try {
            dungeon = new DungeonLoader().loadDungeonDat(await bytesOf(file));
        } catch (error) {
            return { dungeon: null, error: why(error), census: null, signature: null };
        }
        const census = dungeonCensus(dungeon);
        return { dungeon, error: null, census, signature: await dungeonSignature(dungeon) };
    });
}

/** `file` read as a `graphics.dat`, its tables built as the boot builds them, and its signature; or why it does not read. */
function readGraphics(file: Blob | Uint8Array): Promise<{ signature: FileSignature | null; error: string | null }> {
    return once(file, 'graphics.dat', async () => {
        try {
            const bytes = await bytesOf(file);
            const loader = new GraphicsLoader();
            loader.loadFromArray(bytes);
            buildGameTables(extractGraphicsTables(loader));
            return { signature: Signature(bytes), error: null };
        } catch (error) {
            return { signature: null, error: why(error) };
        }
    });
}

/** `file` parsed as a `CSBgraphics.dat`, and its signature; or why it does not parse. */
function readCsbGraphics(file: Blob): Promise<{ signature: FileSignature | null; error: string | null }> {
    return once(file, 'CSBgraphics.dat', async () => {
        try {
            const bytes = await bytesOf(file);
            new CSBGraphicsLoader().loadFromArray(bytes);
            return { signature: Signature(bytes), error: null };
        } catch (error) {
            return { signature: null, error: why(error) };
        }
    });
}

/** Why `file` does not parse as the Hint Oracle's `hcsb.dat`, or `null` where it does. */
function readHcsbDat(file: Blob): Promise<string | null> {
    return once(file, 'hcsb.dat', async () => {
        try {
            parseHcsbDat(await bytesOf(file));
            return null;
        } catch (error) {
            return why(error);
        }
    });
}
