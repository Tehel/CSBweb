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
import { CSBGraphicsLoader } from './CSBGraphicsLoader';
import type { DataSet } from './DataSets';
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
