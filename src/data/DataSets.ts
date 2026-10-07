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
}

export const DATA_SETS: readonly DataSet[] = [
    { id: 'dm-atari', name: 'Dungeon Master', dir: '/gamefiles/dm-atari', csbGraphics: true, miniDat: false, hintOracle: false },
    // The DM Windows package's: the same dungeon re-saved by CSBWin, behind an Extended
    // Features block (doc/PROVEN_FACTS.md → "DM's two `dungeon.dat` files"), and the same
    // `graphics.dat`. The package ships no `CSBgraphics.dat`.
    { id: 'dm-windows', name: 'Dungeon Master (CSBWin)', dir: '/gamefiles/dm-windows', csbGraphics: false, miniDat: false, hintOracle: false },
    { id: 'dm-atari-1.2', name: 'Dungeon Master ST 1.2', dir: '/gamefiles/dm-atari-1.2', csbGraphics: false, miniDat: false, hintOracle: false },
    { id: 'dm-atari-1.3-fr', name: 'Dungeon Master ST 1.3 French', dir: '/gamefiles/dm-atari-1.3-fr', csbGraphics: false, miniDat: false, hintOracle: false },
    { id: 'kids-dungeon', name: 'Kids dungeon 24', dir: '/gamefiles/kids-dungeon-24', csbGraphics: false, miniDat: false, hintOracle: false },
    { id: 'csb', name: 'Chaos Strikes Back', dir: '/gamefiles/csb', csbGraphics: false, miniDat: true, hintOracle: true },
    { id: '3d2d1d', name: '3D2D1D', dir: '/gamefiles/3D2D1D', csbGraphics: false, miniDat: false, hintOracle: false },
    // Its `dungeon.dat` is enciphered (doc/PROVEN_FACTS.md → "The "simple" encipherment is
    // `RC4.cpp`'s own cipher"), and nearly every view of it runs a skin's program.
    { id: 'conflux', name: 'Conflux 3.5', dir: '/gamefiles/conflux-3.5-b8', csbGraphics: true, miniDat: false, hintOracle: false },
    { id: 'towers-of-chaos', name: 'The Towers of Chaos 3.3', dir: '/gamefiles/towers-of-chaos-3.3', csbGraphics: true, miniDat: false, hintOracle: false },
];

export const DEFAULT_DATA_SET = DATA_SETS[0]!;

/** The set `?dungeon=<id>` names, or the default when it names none or an unknown one. */
export function dataSetFor(id: string | null): DataSet {
    return DATA_SETS.find((s) => s.id === id) ?? DEFAULT_DATA_SET;
}
