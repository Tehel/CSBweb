/**
 * A player's own set checked as the boot will read its files (`checkLocalDataSet`), and a
 * dropped file told by what it holds (`identifyLocalDataSetFile`): the form's
 * (`src/ui/addDataSetForm.ts`), and the server's, which `vite build --ssr` bundles from
 * `PageReaders.ts` (`server/app.ts` → `READERS_MODULE`). The check plays the boot's
 * readers and builds its tables (`buildGameTables`), and counts what the dungeon holds
 * (`dungeonCensus`); the record it makes is `src/data/LocalDataSets.ts`'s.
 */
import { CSBGraphicsLoader, CSBGRAPHICS_SENTINEL } from '../data/CSBGraphicsLoader';
import { readRuntimeFileSignatures } from '../data/CsbwinExpool';
import { csbGraphicsExpected, noExpectedSignatures, readExpectedSignatures } from '../data/CsbwinExtendedFeatures';
import { LOCAL_DATA_SET_PREFIX, LOCAL_ID_PATTERN } from '../data/DataSets';
import type { DataSetFiles } from '../data/DataSetFiles';
import { DungeonLoader } from '../data/DungeonLoader';
import { dungeonWalls, type DungeonWalls } from '../data/DungeonSignature';
import type { DungeonData } from '../data/dungeonTypes';
import { csbGraphicsSignatureRefused, graphicsSignatureRefused, Signature, type FileSignature } from '../data/FileSignature';
import { GraphicsLoader, MAX_GRAPHICS_ITEMS } from '../data/GraphicsLoader';
import { parseHcsbDat } from '../data/HintOracleLoader';
import type { LocalDataSetFile, LocalDataSetRecord } from '../data/LocalDataSets';
import { extractGraphicsTables } from '../data/tables/GraphicsTables';
import { readU16BE } from '../core/bytes';
import { dungeonCensus, type DungeonCensus } from './DungeonCensus';
import { buildGameTables } from './GameTables';

/** What the form that adds a set gives (`src/ui/addDataSetForm.ts`): a record but what `checkLocalDataSet` adds. */
export interface LocalDataSetDraft {
    /** The `<id>` of `local:<id>`. */
    id: string;
    name: string;
    description: string;
    authors: string[];
    dmRules: boolean;
    /** The form's checkbox on the thumbnail's row, whether or not it holds a thumbnail. */
    thumbnailAsTitle: boolean;
    /** The form's checkbox, a moderator's alone: `DataSet.official`. */
    official: boolean;
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
 * - The thumbnail is an image. The record shows it as the title only where it has one.
 *
 * With them, what the dungeon holds (`dungeonCensus`) and its walls (`dungeonWalls`),
 * which the server keeps of a published set, wherever its `dungeon.dat` reads, whatever
 * else is wrong; `null` where it does not.
 *
 * Each file is read, parsed and hashed once (`fileReads`), so that a check after a
 * field's change costs only the fields'.
 */
export async function checkLocalDataSet(
    draft: LocalDataSetDraft,
    takenIds: ReadonlySet<string>,
    base: (set: string) => DataSetFiles | null,
    createdAt: number,
): Promise<{ problems: LocalDataSetProblem[]; record: LocalDataSetRecord | null; census: DungeonCensus | null; walls: DungeonWalls | null }> {
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
    const baseFiles = ownGraphics ? null : base(draft.baseSet);
    const graphicsSource = ownGraphics ?? await baseFiles?.read('graphics.dat') ?? null;
    if (!graphicsSource) {
        problem('baseSet', baseFiles ? `The graphics.dat of '${draft.baseSet}' cannot be read.`
            : `The site has no '${draft.baseSet}' to lend its graphics.dat: give the set its own.`);
    }
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
    const walls = read?.walls ?? null;
    if (problems.length > 0 || !dungeon) return { problems, record: null, census, walls };
    return {
        problems,
        census,
        walls,
        record: {
            id,
            name: draft.name.trim(),
            description: draft.description.trim(),
            authors: draft.authors.map((author) => author.trim()).filter((author) => author !== ''),
            dmRules: draft.dmRules,
            thumbnailAsTitle: draft.thumbnailAsTitle && thumbnail !== undefined,
            official: draft.official,
            baseSet: ownGraphics ? null : draft.baseSet,
            files: { ...files },
            dungeonSignature: walls!.signature,
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
 * dungeon, what it holds (`dungeonCensus`) and its walls (`dungeonWalls`); or why it does
 * not read.
 */
function readDungeon(file: Blob): Promise<{ dungeon: DungeonData | null; error: string | null; census: DungeonCensus | null; walls: DungeonWalls | null }> {
    return once(file, 'dungeon.dat', async () => {
        let dungeon: DungeonData;
        try {
            dungeon = new DungeonLoader().loadDungeonDat(await bytesOf(file));
        } catch (error) {
            return { dungeon: null, error: why(error), census: null, walls: null };
        }
        const census = dungeonCensus(dungeon);
        return { dungeon, error: null, census, walls: await dungeonWalls(dungeon) };
    });
}

/**
 * The walls of a published set's `dungeon.dat`, `bytes`, read as the check reads it: what
 * the server keeps of a set published before it kept them (`fillWalls`, `server/app.ts`).
 * Throws where it does not read.
 */
export async function readDungeonWalls(bytes: Uint8Array): Promise<DungeonWalls> {
    return dungeonWalls(new DungeonLoader().loadDungeonDat(bytes));
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
