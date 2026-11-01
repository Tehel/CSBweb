/**
 * Whether an instance holds a set of the manifest, by its files, not its id: what
 * `utils/install-official-sets.ts` asks before it offers a set, and the duplicates it names.
 * An instance's sets may have been written by hand before the script, under ids and folders
 * of their own (the reference instance's `dm-atari` is the 1.2 disk's), so an id says
 * nothing of the files. `tools/checks/official-sets.ts` holds it to the reference
 * instance's table.
 */

/** The files a set's game reads that tell two sets apart, in the order they are compared. */
export const GAME_FILES = ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'mini.dat'] as const;
export type GameFile = typeof GAME_FILES[number];

/** A set's game files, by name: the SHA-256 of each its flags name, `null` for one they do not. */
export type GameDigests = Record<GameFile, string | null>;

/** A set's row on the instance, as far as this module asks: its id, its folder, and its game files. */
export interface InstanceSet {
    id: string;
    dir: string;
    files: GameDigests;
}

/** Which of `GAME_FILES` a set's flags name: its dungeon and graphics, and CSBWin's overlay and CSB's `mini.dat` where it has them. */
export function gameFilesOf(set: { csbGraphics: boolean; miniDat: boolean }): GameFile[] {
    return GAME_FILES.filter((name) => name === 'dungeon.dat' || name === 'graphics.dat'
        || (name === 'CSBgraphics.dat' && set.csbGraphics) || (name === 'mini.dat' && set.miniDat));
}

/** Whether two sets' game files are the same bytes: every file named by either, none missing. */
export function sameFiles(a: GameDigests, b: GameDigests): boolean {
    return GAME_FILES.every((name) => a[name] === b[name]) && a['dungeon.dat'] !== null && a['graphics.dat'] !== null;
}

/**
 * What the instance holds of a set of the manifest, `id` and `dir` its, `files` its fetched
 * folder's: its files under some id (its own where that row has them, else the first in
 * `rows`'s order, the instance's oldest); its id, holding other files; its folder, another
 * set's; or nothing, the set to offer.
 */
export type Holding =
    | { kind: 'installed'; as: string }
    | { kind: 'id-taken' }
    | { kind: 'dir-taken'; by: string }
    | { kind: 'missing' };

export function holding(set: { id: string; dir: string; files: GameDigests }, rows: readonly InstanceSet[]): Holding {
    const same = rows.filter((row) => sameFiles(row.files, set.files));
    const own = same.find((row) => row.id === set.id) ?? same[0];
    if (own) return { kind: 'installed', as: own.id };
    if (rows.some((row) => row.id === set.id)) return { kind: 'id-taken' };
    const dir = rows.find((row) => row.dir === set.dir);
    if (dir) return { kind: 'dir-taken', by: dir.id };
    return { kind: 'missing' };
}

/** The instance's sets that hold the same files, each group in `rows`'s order: the duplicates. */
export function duplicates(rows: readonly InstanceSet[]): string[][] {
    const groups: InstanceSet[][] = [];
    for (const row of rows) {
        const group = groups.find((one) => sameFiles(one[0]!.files, row.files));
        if (group) group.push(row);
        else if (row.files['dungeon.dat'] !== null && row.files['graphics.dat'] !== null) groups.push([row]);
    }
    return groups.filter((group) => group.length > 1).map((group) => group.map((row) => row.id));
}
