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
import { CSBGraphicsLoader } from './CSBGraphicsLoader';
import { readRuntimeFileSignatures } from './CsbwinExpool';
import { csbGraphicsExpected, noExpectedSignatures, readExpectedSignatures } from './CsbwinExtendedFeatures';
import { LOCAL_DATA_SET_PREFIX, type DataSet } from './DataSets';
import type { DataSetFiles } from './DataSetFiles';
import { DungeonLoader } from './DungeonLoader';
import { dungeonSignature, type DungeonSignature } from './DungeonSignature';
import type { DungeonData } from './dungeonTypes';
import { csbGraphicsSignatureRefused, graphicsSignatureRefused, Signature } from './FileSignature';
import { GraphicsLoader } from './GraphicsLoader';
import { extractGraphicsTables } from './tables/GraphicsTables';
import { dungeonCensus, type DungeonCensus } from '../engine/DungeonCensus';
import { buildGameTables } from '../engine/GameTables';
import { parseHcsbDat } from './HintOracleLoader';

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
 * files are read through `recordFiles`.
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
 *   where it does not, the boot dies (`Game.readDungeonDat`).
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
    const bytes = async (name: LocalDataSetFile): Promise<Uint8Array | null> => {
        const blob = files[name];
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    };
    const why = (error: unknown): string => error instanceof Error ? error.message : String(error);

    const id = `${LOCAL_DATA_SET_PREFIX}${draft.id}`;
    if (draft.id === '') problem('id', 'Give it an id.');
    else if (!LOCAL_ID_PATTERN.test(draft.id)) problem('id', "An id is lowercase letters, digits, '.', '-' and '_', a letter or a digit first, at most 40.");
    else if (takenIds.has(id)) problem('id', 'One of your dungeons already has this id.');
    if (draft.name.trim() === '') problem('name', 'Give it a name.');

    let dungeon: DungeonData | null = null;
    const dungeonDat = await bytes('dungeon.dat');
    if (!dungeonDat) problem('dungeon.dat', 'A dungeon.dat is needed.');
    else {
        try {
            dungeon = new DungeonLoader().loadDungeonDat(dungeonDat);
        } catch (error) {
            problem('dungeon.dat', `It does not read: ${why(error)}`);
        }
    }
    const runtime = dungeon && readRuntimeFileSignatures(dungeon);

    const ownGraphics = await bytes('graphics.dat');
    const graphicsAbout: LocalDataSetField = ownGraphics ? 'graphics.dat' : 'baseSet';
    const graphics = ownGraphics ?? await base(draft.baseSet)?.read('graphics.dat') ?? null;
    if (!graphics) problem('baseSet', `The graphics.dat of '${draft.baseSet}' cannot be read.`);
    else {
        try {
            const loader = new GraphicsLoader();
            loader.loadFromArray(graphics);
            buildGameTables(extractGraphicsTables(loader));
            const refused = runtime && graphicsSignatureRefused(runtime, Signature(graphics));
            if (refused !== null) problem(graphicsAbout, `The dungeon was made for another graphics.dat (signature ${runtime!.graphicsSignature}, this one's ${refused}).`);
        } catch (error) {
            problem(graphicsAbout, `It is not a graphics.dat: ${why(error)}`);
        }
    }

    const csbGraphics = await bytes('CSBgraphics.dat');
    if (csbGraphics) {
        try {
            new CSBGraphicsLoader().loadFromArray(csbGraphics);
            const refused = runtime && csbGraphicsSignatureRefused(runtime, Signature(csbGraphics));
            if (refused !== null) problem('CSBgraphics.dat', `The dungeon was made for another CSBgraphics.dat (signature ${runtime!.csbGraphicsSignature}, this one's ${refused}).`);
        } catch (error) {
            problem('CSBgraphics.dat', `It is not a CSBgraphics.dat: ${why(error)}`);
        }
    } else if (dungeon) {
        const expected = noExpectedSignatures();
        readExpectedSignatures(expected, dungeon.extendedFeatures);
        if (csbGraphicsExpected(expected)) problem('CSBgraphics.dat', 'The dungeon needs its CSBgraphics.dat.');
    }

    const hct = files['hcsb.hct'], dat = await bytes('hcsb.dat');
    if (hct && !dat) problem('hcsb.dat', 'The Hint Oracle needs hcsb.dat beside hcsb.hct.');
    if (dat && !hct) problem('hcsb.hct', 'The Hint Oracle needs hcsb.hct beside hcsb.dat.');
    if (dat) {
        try {
            parseHcsbDat(dat);
        } catch (error) {
            problem('hcsb.dat', `It is not the Hint Oracle's hcsb.dat: ${why(error)}`);
        }
    }
    const thumbnail = files.thumbnail;
    if (thumbnail && !thumbnail.type.startsWith('image/')) problem('thumbnail', 'It is not an image.');

    const census = dungeon && dungeonCensus(dungeon);
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
            dungeonSignature: await dungeonSignature(dungeon),
            createdAt,
        },
    };
}
