/**
 * The games the page can play: a folder of CSBWin data files each, one of them chosen
 * before the boot.
 *
 * CSBWin plays whatever its directory holds: the command line's `directory=` or
 * `config.txt`'s `DIRECTORY` (doc/CSBwin-src/CSBUI.cpp:2057, :819), read before
 * `_AskWhatToDo`, which offers no dungeon (doc/CSBwin-src/CSBCode.cpp:11573-11679). Its
 * code does not branch on the game: the tables, the title and the credits all come from
 * the directory's `graphics.dat`, so everything the page builds comes from the set.
 *
 * The sets are listed by `manifest.json`, in the folder that holds them
 * (`static/gamefiles/` here), which is served with the files it describes, so a server
 * offers the games its folder holds. This module parses it, for the page and the tools:
 *
 *     { "default": "dm-atari", "swoosh": "swoosh",
 *       "dataSets": [{ "id": "dm-atari", "name": "Dungeon Master", "csbGraphics": true },
 *                    { "id": "conflux", "name": "Conflux 3.5", "dir": "conflux-3.5-b8" }, …] }
 *
 * A folder is named relative to the manifest. A set's `dir` may be left out, for its `id`.
 * `swoosh`, the FTL logo's folder, may be `null` or left out. The flags `csbGraphics`,
 * `miniDat`, `hintOracle` and `hidden` may each be left out, for `false`, and the manifest
 * names one only where it is true. A set with `"hidden": true` is left out of the chooser
 * and plays all the same by its `?dungeon=` (`chooserSets`).
 */

export interface DataSet {
    /** The page's `?dungeon=` value. */
    id: string;
    name: string;
    /** The folder that holds the files: the manifest's `dir`, under the manifest's folder. */
    dir: string;
    /**
     * Whether the folder holds a `CSBgraphics.dat`, CSBWin's extensions' overlay, which it
     * opens only on demand (doc/CSBwin-src/Graphics.cpp:1864-1882, :3228-3300). The CSB
     * package ships none, and neither does the DM Windows one.
     */
    csbGraphics: boolean;
    /**
     * Whether the folder holds a `mini.dat`, the dungeon CSBWin's UTILITY makes a new
     * adventure in from a saved game's party (`src/engine/Chaos.ts`). CSB's package ships
     * one, and its entrance offers RISE (`src/renderer/intro/PrisonDoor.ts`).
     */
    miniDat: boolean;
    /**
     * Whether the folder holds `hcsb.hct` and `hcsb.dat`, Chaos Strikes Back's Hint
     * Oracle, a program of its own in CSBWin (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`). Where
     * it does, the inventory's close box is the Oracle's button
     * (`src/renderer/ui/HintOracleButton.ts`).
     */
    hintOracle: boolean;
    /**
     * Whether the chooser leaves it out (`chooserSets`). It is played by its `?dungeon=` all
     * the same, and the server takes its events and serves its files as any other's.
     */
    hidden: boolean;
}

/** What `manifest.json` says, its folders resolved. */
export interface DataSetManifest {
    /** In the manifest's order, which is the chooser's. */
    dataSets: readonly DataSet[];
    /** The set the page plays when `?dungeon=` names none, or an unknown one. */
    defaultSet: DataSet;
    /**
     * The folder of the Atari ST disk's FTL logo and its sound, which every set shares
     * (`src/data/SwooshLoader.ts`), or `null` where the manifest names none.
     */
    swooshDir: string | null;
}

/** The manifest's name, in the folder that holds the sets. */
export const MANIFEST_NAME = 'manifest.json';

const FLAGS = ['csbGraphics', 'miniDat', 'hintOracle', 'hidden'] as const;

/**
 * `text`, the manifest read from the folder `base` (`gamefiles` for the page,
 * `static/gamefiles` for the tools), every folder it names resolved under `base`. A
 * manifest that is not JSON, or does not say what the page needs, throws an error whose
 * message says why: the page cannot choose a game without it.
 */
export function parseManifest(text: string, base: string): DataSetManifest {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw manifestError(`it is not JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!isRecord(json)) throw manifestError('it is not an object');
    const { dataSets: list, default: defaultId, swoosh } = json;
    if (!Array.isArray(list) || list.length === 0) throw manifestError('"dataSets" is not a list of data sets');

    const dataSets = list.map((entry: unknown, i): DataSet => {
        const where = `data set ${i}`;
        if (!isRecord(entry)) throw manifestError(`${where} is not an object`);
        const { id, name } = entry;
        if (!isText(id)) throw manifestError(`${where} has no "id"`);
        if (!isText(name)) throw manifestError(`data set '${id}' has no "name"`);
        const dir = entry.dir === undefined ? id : entry.dir;
        if (!isFolder(dir)) throw manifestError(`data set '${id}' has no "dir", a folder relative to the manifest`);
        const [csbGraphics, miniDat, hintOracle, hidden] = FLAGS.map((flag) => {
            const value = entry[flag] ?? false;
            if (typeof value !== 'boolean') throw manifestError(`data set '${id}' has a "${flag}" that is neither true nor false`);
            return value;
        }) as [boolean, boolean, boolean, boolean];
        return { id, name, dir: under(base, dir), csbGraphics, miniDat, hintOracle, hidden };
    });
    const twice = dataSets.find((set, i) => dataSets.findIndex((other) => other.id === set.id) !== i);
    if (twice) throw manifestError(`two data sets are '${twice.id}'`);

    const defaultSet = dataSets.find((set) => set.id === defaultId);
    if (!defaultSet) throw manifestError(`"default" names none of its data sets`);
    if (swoosh !== undefined && swoosh !== null && !isFolder(swoosh)) {
        throw manifestError('"swoosh" is neither null nor a folder relative to the manifest');
    }
    return { dataSets, defaultSet, swooshDir: isFolder(swoosh) ? under(base, swoosh) : null };
}

/**
 * The sets the chooser lists, in the manifest's order: every set but the hidden ones, and
 * `current` even when hidden, so that the chooser shows the set being played.
 */
export function chooserSets(manifest: DataSetManifest, current: DataSet): DataSet[] {
    return manifest.dataSets.filter((set) => !set.hidden || set === current);
}

/** The set `?dungeon=<id>` names, hidden or not, or the default when it names none or an unknown one. */
export function dataSetFor(manifest: DataSetManifest, id: string | null): DataSet {
    return manifest.dataSets.find((s) => s.id === id) ?? manifest.defaultSet;
}

function manifestError(why: string): Error {
    return new Error(`The data sets' ${MANIFEST_NAME} is not usable: ${why}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

/** A folder below the manifest's: relative, with no `.` or `..` and no empty segment. */
function isFolder(value: unknown): value is string {
    return isText(value) && !value.includes('\\')
        && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function under(base: string, dir: string): string {
    return base === '' ? dir : `${base}/${dir}`;
}
