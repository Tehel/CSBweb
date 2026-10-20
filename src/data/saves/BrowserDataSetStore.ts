/**
 * The player's own data sets (`src/data/LocalDataSets.ts`), in the saves' IndexedDB
 * database: one record each, its files as Blobs, keyed by its `local:<id>`.
 */
import type { LocalDataSetRecord } from '../LocalDataSets';
import { DATA_SETS_STORE, SAVES_STORE, SAVE_FILES_STORE, askToPersist, idbDone, idbGet, idbGetAll, idbPut, openSaveDatabase } from './idb';
import type { DrawPlaythrough, StoredSaveEntry } from './SaveStore';

/** A record as the store may hold it: one stored before `thumbnailAsTitle` or `official` has none, for `false`. */
type StoredDataSetRecord = Omit<LocalDataSetRecord, 'thumbnailAsTitle' | 'official'> & { thumbnailAsTitle?: boolean; official?: boolean };

function asRecord(stored: StoredDataSetRecord): LocalDataSetRecord {
    return { ...stored, thumbnailAsTitle: stored.thumbnailAsTitle ?? false, official: stored.official ?? false };
}

export class BrowserDataSetStore {
    /** `drawPlaythrough` is the database's upgrade's, as `BrowserSaveStore`'s is: whichever store opens it first. */
    constructor(private readonly drawPlaythrough: DrawPlaythrough) {}

    private db(): Promise<IDBDatabase> {
        return openSaveDatabase(this.drawPlaythrough);
    }

    /** Every local set, oldest first. */
    async list(): Promise<LocalDataSetRecord[]> {
        const records = await idbGetAll<StoredDataSetRecord>(await this.db(), DATA_SETS_STORE);
        return records.map(asRecord).sort((a, b) => a.createdAt - b.createdAt);
    }

    /** The set `id` names, or `undefined` for none. */
    async get(id: string): Promise<LocalDataSetRecord | undefined> {
        const stored = await idbGet<StoredDataSetRecord>(await this.db(), DATA_SETS_STORE, id);
        return stored && asRecord(stored);
    }

    /** `record`, added or written over the one of its id. */
    async put(record: LocalDataSetRecord): Promise<void> {
        await idbPut(await this.db(), DATA_SETS_STORE, record);
        askToPersist();
    }

    /**
     * The set `id` names and every save filed under it, its row and its file, in one
     * transaction: all of them, or none.
     */
    async remove(id: string): Promise<void> {
        const tx = (await this.db()).transaction([DATA_SETS_STORE, SAVES_STORE, SAVE_FILES_STORE], 'readwrite');
        const done = idbDone(tx);
        tx.objectStore(DATA_SETS_STORE).delete(id);
        const files = tx.objectStore(SAVE_FILES_STORE);
        const rows = tx.objectStore(SAVES_STORE).openCursor();
        rows.onsuccess = () => {
            const row = rows.result;
            if (!row) return;
            const entry = row.value as StoredSaveEntry;
            if (entry.dataSet === id) {
                row.delete();
                files.delete(entry.id);
            }
            row.continue();
        };
        await done;
    }
}
