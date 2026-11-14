/**
 * The achievements unlocked (`AchievementStore`), in the saves' IndexedDB database: a
 * row each, keyed by its data set, its id and its playthrough (`ACHIEVEMENTS_STORE`), and
 * the playthroughs' figures, a row each (`ACHIEVEMENT_FIGURES_STORE`).
 */
import { mergeFiguresRows, sortAchievementRows, type AchievementFiguresRow, type AchievementRow, type AchievementStore } from './AchievementStore';
import { ACHIEVEMENT_FIGURES_STORE, ACHIEVEMENTS_STORE, askToPersist, idbDone, idbGetAll, openSaveDatabase } from './idb';
import type { DrawPlaythrough } from './SaveStore';

export class BrowserAchievementStore implements AchievementStore {
    /** `drawPlaythrough` is the database's upgrade's, as `BrowserSaveStore`'s is: whichever store opens it first. */
    constructor(private readonly drawPlaythrough: DrawPlaythrough) {}

    private db(): Promise<IDBDatabase> {
        return openSaveDatabase(this.drawPlaythrough);
    }

    async list(dataSet: string | null): Promise<AchievementRow[]> {
        const rows = await idbGetAll<AchievementRow>(await this.db(), ACHIEVEMENTS_STORE);
        return sortAchievementRows(rows.filter((row) => dataSet === null || row.dataSet === dataSet));
    }

    /** One transaction, so another tab's unlock between the read and the write is kept, not written over. */
    async unlock(row: AchievementRow): Promise<boolean> {
        const tx = (await this.db()).transaction(ACHIEVEMENTS_STORE, 'readwrite');
        const done = idbDone(tx);
        const store = tx.objectStore(ACHIEVEMENTS_STORE);
        let kept = false;
        const held = store.getKey([row.dataSet, row.id, row.playthrough]);
        held.onsuccess = () => {
            if (held.result !== undefined) return;
            kept = true;
            store.put(row);
        };
        await done;
        if (kept) askToPersist();
        return kept;
    }

    /** One transaction; a row another tab deleted meanwhile is not written back. */
    async update(rows: readonly AchievementRow[]): Promise<void> {
        if (rows.length === 0) return;
        const tx = (await this.db()).transaction(ACHIEVEMENTS_STORE, 'readwrite');
        const done = idbDone(tx);
        const store = tx.objectStore(ACHIEVEMENTS_STORE);
        for (const row of rows) {
            const held = store.getKey([row.dataSet, row.id, row.playthrough]);
            held.onsuccess = () => { if (held.result !== undefined) store.put(row); };
        }
        await done;
    }

    async figures(dataSet: string | null): Promise<AchievementFiguresRow[]> {
        const rows = await idbGetAll<AchievementFiguresRow>(await this.db(), ACHIEVEMENT_FIGURES_STORE);
        return rows.filter((row) => dataSet === null || row.dataSet === dataSet);
    }

    /** One transaction, so another tab's figures and proofs of the same playthrough are merged, not written over. */
    async raiseFigures(row: AchievementFiguresRow): Promise<void> {
        const tx = (await this.db()).transaction(ACHIEVEMENT_FIGURES_STORE, 'readwrite');
        const done = idbDone(tx);
        const store = tx.objectStore(ACHIEVEMENT_FIGURES_STORE);
        const held = store.get([row.dataSet, row.playthrough]);
        held.onsuccess = () => {
            store.put(mergeFiguresRows(held.result as AchievementFiguresRow | undefined, row));
        };
        await done;
    }
}
