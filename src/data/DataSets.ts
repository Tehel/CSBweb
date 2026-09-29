/**
 * The games the page can play: a folder of CSBWin data files each, one of them chosen
 * before the boot.
 *
 * CSBWin plays whatever its directory holds: the command line's `directory=` or
 * `config.txt`'s `DIRECTORY` (doc/CSBwin-src/CSBUI.cpp:2032, :799), read before
 * `_AskWhatToDo`, which offers no dungeon (doc/CSBwin-src/CSBCode.cpp:11338-11444). Its
 * code does not branch on the game: the tables, the title and the credits all come from
 * the directory's `graphics.dat`, so everything the page builds comes from the set.
 */

export interface DataSet {
    /** The page's `?dungeon=` value. */
    id: string;
    name: string;
    /** The folder under the page's root that holds the files. */
    dir: string;
    /**
     * Whether the folder holds a `CSBgraphics.dat`, CSBWin's extensions' overlay, which it
     * opens only on demand (doc/CSBwin-src/Graphics.cpp:1840-1858, :3201-3273). The CSB
     * package ships none.
     */
    csbGraphics: boolean;
}

export const DATA_SETS: readonly DataSet[] = [
    { id: 'dm-atari', name: 'Dungeon Master', dir: '/gamefiles/dm-atari', csbGraphics: true },
    // The DM Windows package's: the same dungeon re-saved by CSBWin, behind an Extended
    // Features block (doc/PROVEN_FACTS.md → "DM's two `dungeon.dat` files"), and the same
    // `graphics.dat`. The package ships no `CSBgraphics.dat`.
    { id: 'dm-windows', name: 'Dungeon Master (CSBWin)', dir: '/gamefiles/dm-windows', csbGraphics: false },
    { id: 'csb', name: 'Chaos Strikes Back', dir: '/gamefiles/csb', csbGraphics: false },
    // Conflux (`static/gamefiles/conflux-3.5-b8/`) is not a set: its 620 KB `dungeon.dat`
    // does not open with 33028 and does not parse, and nothing has examined its format.
];

export const DEFAULT_DATA_SET = DATA_SETS[0]!;

/** The set `?dungeon=<id>` names, or the default when it names none. */
export function dataSetFor(id: string | null): DataSet {
    if (id === null) return DEFAULT_DATA_SET;
    const set = DATA_SETS.find((s) => s.id === id);
    if (!set) console.warn(`Unknown data set '${id}'; playing ${DEFAULT_DATA_SET.id}`);
    return set ?? DEFAULT_DATA_SET;
}
