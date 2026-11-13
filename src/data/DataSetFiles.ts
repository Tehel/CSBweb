/**
 * Where a data set's files are read from: its folder on the server (`folderFiles`), or a
 * local set's record in the browser's store (`recordFiles`, `src/data/LocalDataSets.ts`).
 * CSBWin opens them by name in its directory; the page reads them by name through one of
 * these, so nothing past the choice of the set knows which it is.
 *
 * `loadGameFiles` reads what the boot needs before anything is built, for the page and
 * the tools alike. `dungeon.dat`, `mini.dat` and the utility's portraits are read later,
 * by name, as CSBWin reads them.
 */
import { md5 } from '../core/md5';
import { CSBGraphicsLoader } from './CSBGraphicsLoader';
import { ACHIEVEMENTS_FILE, type DataSet } from './DataSets';
import { GraphicsLoader } from './GraphicsLoader';
import { parseHcsbDat } from './HintOracleLoader';
import type { HintOracleFiles } from '../renderer/ui/HintOracleButton';

export interface DataSetFiles {
    /** The file `name`'s bytes, or `null` where the set has none, or it cannot be read. */
    read(name: string): Promise<Uint8Array | null>;
    /** The file `name` as an error names it: `gamefiles/dm-atari/graphics.dat`. */
    where(name: string): string;
}

/** The files of the folder `dir`, over HTTP: a file that is not served is `null`. */
export function folderFiles(dir: string): DataSetFiles {
    return {
        async read(name) {
            const response = await fetch(`${dir}/${name}`).catch(() => null);
            return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        },
        where: (name) => `${dir}/${name}`,
    };
}

/**
 * The MD5 of each file a set's game has read, by name, in lower-case hex: what a recording
 * carries of the files it was played over (`Recording.files`).
 */
export type FileDigests = Readonly<Record<string, string>>;

/** A set's files that keep the digest of each file read through them (`digestedFiles`). */
export interface DigestedFiles extends DataSetFiles {
    /** The digest of every file read so far, the last read's where one was read twice. */
    digests(): FileDigests;
}

/** `files`, keeping the MD5 of each file read through them. */
export function digestedFiles(files: DataSetFiles): DigestedFiles {
    const digests = new Map<string, string>();
    return {
        async read(name) {
            const bytes = await files.read(name);
            if (bytes) digests.set(name, fileDigest(bytes));
            return bytes;
        },
        where: (name) => files.where(name),
        digests: () => Object.fromEntries([...digests].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
}

/** `bytes`' MD5, in lower-case hex (`FileDigests`). */
export function fileDigest(bytes: Uint8Array): string {
    return [...md5(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The text of `files`' `ACHIEVEMENTS_FILE`, `null` where the set has none. The page reads it
 * through the set's files, never through `digestedFiles`, so that no recording names it.
 */
export async function readAchievementsText(files: DataSetFiles): Promise<string | null> {
    const bytes = await files.read(ACHIEVEMENTS_FILE);
    return bytes && new TextDecoder().decode(bytes);
}

/** What the boot reads of a set before anything is built. */
export interface GameFiles {
    graphicsLoader: GraphicsLoader;
    /** `CSBgraphics.dat`, CSBWin's extensions' overlay, or its absence (`CSBGraphicsLoader`). */
    csbGraphicsLoader: CSBGraphicsLoader;
    /** The Hint Oracle's `hcsb.hct` and `hcsb.dat`, where the data set has them. */
    hintOracle: HintOracleFiles | null;
}

/**
 * `set`'s `graphics.dat`, its `CSBgraphics.dat` where it has one (`DataSet.csbGraphics`),
 * and its Hint Oracle. A `graphics.dat` or a `CSBgraphics.dat` that does not read or parse
 * throws, and the page refuses the set.
 */
export async function loadGameFiles(set: DataSet, files: DataSetFiles): Promise<GameFiles> {
    const graphicsLoader = new GraphicsLoader();
    graphicsLoader.loadFromArray(await required(files, 'graphics.dat'));
    const csbGraphicsLoader = new CSBGraphicsLoader();
    if (set.csbGraphics) csbGraphicsLoader.loadFromArray(await required(files, 'CSBgraphics.dat'));
    return { graphicsLoader, csbGraphicsLoader, hintOracle: set.hintOracle ? await loadHintOracle(files) : null };
}

async function required(files: DataSetFiles, name: string): Promise<Uint8Array> {
    const bytes = await files.read(name);
    if (!bytes) throw new Error(`Failed to load ${files.where(name)}`);
    return bytes;
}

/**
 * The Hint Oracle's two files, or `null` where either is missing or `hcsb.dat` does not
 * read: then the inventory's close box is CSBWin's (`src/renderer/ui/HintOracleButton.ts`).
 * `hcsb.hct` is read when the Oracle opens, under the running world's key.
 */
async function loadHintOracle(files: DataSetFiles): Promise<HintOracleFiles | null> {
    const [hct, dat] = await Promise.all([files.read('hcsb.hct'), files.read('hcsb.dat')]);
    if (!hct || !dat) return null;
    try {
        return { hct, dat: parseHcsbDat(dat) };
    } catch {
        return null;
    }
}
