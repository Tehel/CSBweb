/**
 * The achievements unlocked (`AchievementStore`), in the saves' IndexedDB database: a
 * row each, keyed by its data set, its id and its playthrough (`ACHIEVEMENTS_STORE`).
 */
import { sortAchievementRows, type AchievementRow, type AchievementStore } from './AchievementStore';
import { ACHIEVEMENTS_STORE, askToPersist, idbDone, idbGetAll, openSaveDatabase } from './idb';
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
}
