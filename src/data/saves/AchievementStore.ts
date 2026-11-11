/**
 * The achievements a player has unlocked, as the page keeps them (`doc/ACHIEVEMENTS.md` →
 * "The page"): a row per data set, achievement and playthrough, written as the tracker
 * unlocks one (`PageAchievements`).
 *
 * **Nothing in this file touches the DOM**: the rows and their order are pure, so the
 * tools assert them headlessly over `memoryAchievementStore`.
 */

/**
 * How far an unlock's proof has got (`doc/ACHIEVEMENTS.md` → "Proofs and the Hall of
 * Fame"): only `unverified` until the proofs are sent (phase 18.5).
 */
export type AchievementProof = 'unverified';

/** One achievement unlocked in one playthrough of one data set. */
export interface AchievementRow {
    /** The data set, its `DataSet.id`. */
    dataSet: string;
    /** The achievement's id in the set's file (`[id]`). */
    id: string;
    /** The playthrough that unlocked it, `d.RandomGameID` (`SaveEntry.playthrough`). */
    playthrough: number;
    /** Milliseconds since the epoch: when it was unlocked. */
    unlockedAt: number;
    /** Milliseconds the player had spent in the game then: the tracker's VBLs counted (`Unlock.vbls`). */
    playTime: number;
    /** The game's clock then, `d.Time`. */
    gameTime: number;
    /** The party then, champion names in order, which names the playthrough in a list. */
    champions: string[];
    proof: AchievementProof;
}

export interface AchievementStore {
    /** One data set's rows, or every set's for `null`, the earliest unlocked first. */
    list(dataSet: string | null): Promise<AchievementRow[]>;
    /**
     * `row` kept, unless the store holds one of its set, id and playthrough already: the
     * first unlock stays, and a branch that unlocks it again changes nothing. Says whether
     * it was kept.
     */
    unlock(row: AchievementRow): Promise<boolean>;
}

/** The earliest unlocked first, and of two at once the one of the lower id. */
export function sortAchievementRows(rows: AchievementRow[]): AchievementRow[] {
    return [...rows].sort((a, b) => a.unlockedAt - b.unlockedAt || a.id.localeCompare(b.id) || a.playthrough - b.playthrough);
}

/** A store in memory, which keeps a clone of what it is given, as IndexedDB does. */
export function memoryAchievementStore(): AchievementStore & { rows: AchievementRow[] } {
    const rows: AchievementRow[] = [];
    return {
        rows,
        list: async (dataSet) => sortAchievementRows(rows.filter((row) => dataSet === null || row.dataSet === dataSet))
            .map((row) => structuredClone(row)),
        unlock: async (row) => {
            if (rows.some((held) => held.dataSet === row.dataSet && held.id === row.id && held.playthrough === row.playthrough)) return false;
            rows.push(structuredClone(row));
            return true;
        },
    };
}
