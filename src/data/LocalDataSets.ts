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
import { LOCAL_DATA_SET_PREFIX, type DataSet } from './DataSets';
import type { DataSetFiles } from './DataSetFiles';
import type { DungeonSignature } from './DungeonSignature';

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
