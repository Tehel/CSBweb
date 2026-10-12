/**
 * The games the page can play: a folder of CSBWin data files each, one of them chosen
 * before the boot: by `?dungeon=`, which the welcome page's PLAY and CONTINUE set
 * (`src/ui/welcomePage.ts`).
 *
 * CSBWin plays whatever its directory holds: the command line's `directory=` or
 * `config.txt`'s `DIRECTORY` (doc/CSBwin-src/CSBUI.cpp:2057, :819), read before
 * `_AskWhatToDo`, which offers no dungeon (doc/CSBwin-src/CSBCode.cpp:11573-11679). Its
 * code does not branch on the game: the tables, the title and the credits all come from
 * the directory's `graphics.dat`, so everything the page builds comes from the set.
 *
 * The sets are listed by a manifest, which the page asks the server for (`DATA_SETS_ROUTE`):
 * the deployed server answers it from the `manifest.json` beside the files it describes
 * (`server/app.ts`), and the dev server from the repository's, `tools/data-sets.json`
 * (`vite.config.mts`), which the tools read too. This module parses it, for the page, the
 * tools and the server:
 *
 *     { "default": "dm-atari", "swoosh": "swoosh",
 *       "dataSets": [{ "id": "dm-atari", "name": "Dungeon Master", "csbGraphics": true },
 *                    { "id": "conflux", "name": "Conflux 3.5", "dir": "conflux-3.5-b8" }, …] }
 *
 * A folder is named relative to the manifest. A set's `dir` may be left out, for its `id`.
 * `swoosh`, the FTL logo's folder, may be `null` or left out. The flags `csbGraphics`,
 * `miniDat`, `hintOracle`, `dmRules` and `hidden` may each be left out, for `false`, and the manifest
 * names one only where it is true. A set with `"hidden": true` is left out of the welcome
 * page's grid (`chooserSets`) and plays all the same by its `?dungeon=`.
 *
 * A set's folder may also hold its thumbnail, `<id>-thumbnail.png` (`thumbnailPath`): the
 * last frame of its title, which the welcome page's tile shows. `tools/gen-thumbnails.ts`
 * writes it from the folder's `graphics.dat`, so the page fetches no game file to draw the
 * grid. A folder without one leaves its tile's picture blank.
 */
export interface DataSet {
    /** The page's `?dungeon=` value. */
    id: string;
    name: string;
    /**
     * The folder that holds the files: the manifest's `dir`, under the manifest's folder.
     * A local set has none, and `''` here (`src/data/LocalDataSets.ts`).
     */
    dir: string;
    /**
     * Whether the folder holds a `CSBgraphics.dat`, CSBWin's extensions' overlay, which it
     * opens only on demand (doc/CSBwin-src/Graphics.cpp:1864-1882, :3228-3300). It is a
     * library of resources for dungeon designers, which varies from release to release, so
     * a dungeon that uses it ships its own: Conflux and The Towers of Chaos do. DM and CSB
     * use none. `tools/fixtures/csbgraphics/CSBgraphics.dat` is one such library, for the tools.
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
     * Whether the game starts with `DMRulesDesignOption` on, which the boot turns into
     * `DM_rules` (`Game.forceDMRulesAtBoot`): a reincarnated champion then keeps their
     * attributes and their HP, stamina and mana (doc/CSBwin-src/CSBCode.cpp:6799, :6820).
     * It is the flags' value at the start, as a launch option's would be (`--dmrules`,
     * doc/CSBwin-src/LinCSBUI.cpp:677): a file with an Extended Features block sets both
     * its own way, and one without leaves them (`readRulesOptions`). DM's Atari files have
     * no block; CSBWin's DM package, converted from them, has `DMRules`
     * (`doc/PROVEN_FACTS.md`, "`DM_rules` and `DMRulesDesignOption`…"), and so does a
     * game of DM saved by the port, which writes the flag back.
     */
    dmRules: boolean;
    /**
     * Whether the chooser leaves it out (`chooserSets`). It is played by its `?dungeon=` all
     * the same, and the server takes its events and serves its files as any other's.
     */
    hidden: boolean;
    /**
     * A local set's `dungeon.dat`'s signature, its record's (`src/data/LocalDataSets.ts`),
     * which a save imported into it is checked against before the known dungeons
     * (`checkDungeon`). A manifest set has none: its dungeon is in `KNOWN_DUNGEONS`. A
     * `DungeonSignature`, spelled out: the server compiles this file, and not that one's.
     */
    dungeonSignature?: readonly string[];
}

/** What `manifest.json` says, its folders resolved. */
export interface DataSetManifest {
    /** In the manifest's order. */
    dataSets: readonly DataSet[];
    /**
     * The set the tools play where they name none (`tools/lib/dataSets.ts`). The page
     * plays none until one is chosen: without a known `?dungeon=` it is the welcome page,
     * which selects this one while the store holds no save.
     */
    defaultSet: DataSet;
    /**
     * The folder of the Atari ST disk's FTL logo and its sound, which every set shares
     * (`src/data/SwooshLoader.ts`), or `null` where the manifest names none.
     */
    swooshDir: string | null;
}

/**
 * The prefix of a player's own set's id (`src/data/LocalDataSets.ts`), which no manifest
 * set's may have. Here and not there: the server parses manifests, and reads nothing else
 * of the page's.
 */
export const LOCAL_DATA_SET_PREFIX = 'local:';

/**
 * Where the page asks for the manifest, relative to the page: the server's API, not a file
 * under `gamefiles/`, since a server chooses what each player is offered.
 */
export const DATA_SETS_ROUTE = 'api/data-sets';

const FLAGS = ['csbGraphics', 'miniDat', 'hintOracle', 'dmRules', 'hidden'] as const;

/**
 * `text`, a manifest whose folders are relative to `base` (`gamefiles` for the page,
 * `static/gamefiles` for the tools, `''` for the server), every one resolved under it. A
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
        if (id.startsWith(LOCAL_DATA_SET_PREFIX)) throw manifestError(`data set '${id}' has an id of a player's own set`);
        if (!isText(name)) throw manifestError(`data set '${id}' has no "name"`);
        const dir = entry.dir === undefined ? id : entry.dir;
        if (!isFolder(dir)) throw manifestError(`data set '${id}' has no "dir", a folder relative to the manifest`);
        const [csbGraphics, miniDat, hintOracle, dmRules, hidden] = FLAGS.map((flag) => {
            const value = entry[flag] ?? false;
            if (typeof value !== 'boolean') throw manifestError(`data set '${id}' has a "${flag}" that is neither true nor false`);
            return value;
        }) as [boolean, boolean, boolean, boolean, boolean];
        return { id, name, dir: under(base, dir), csbGraphics, miniDat, hintOracle, dmRules, hidden };
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
 * The sets the welcome page lists, in the manifest's order: every set but the hidden ones.
 * The page orders them itself (`src/ui/welcomePage.ts`).
 */
export function chooserSets(manifest: DataSetManifest): DataSet[] {
    return manifest.dataSets.filter((set) => !set.hidden);
}

/** The file of `set`'s thumbnail, in its folder: `dm-atari/dm-atari-thumbnail.png`. */
export function thumbnailPath(set: DataSet): string {
    return `${set.dir}/${set.id}-thumbnail.png`;
}

/**
 * The set `?dungeon=<id>` names, hidden or not, or `null` when it names none or an
 * unknown one: the welcome page then, where the player chooses one.
 */
export function dataSetNamed(manifest: DataSetManifest, id: string | null): DataSet | null {
    return manifest.dataSets.find((s) => s.id === id) ?? null;
}

function manifestError(why: string): Error {
    return new Error(`The data sets' manifest is not usable: ${why}.`);
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
