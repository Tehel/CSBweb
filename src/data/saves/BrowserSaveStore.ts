/**
 * The page's saves, in IndexedDB: the one store, which needs no permission and no
 * picker. The player cannot see, copy or back up what is in it from outside the page:
 * the save menu's EXPORT is the way out, a save's file downloaded (`downloadSaveFile`).
 */
import { SAVES_STORE, askToPersist, idbDelete, idbDone, idbGet, idbGetAll, idbPut, openSaveDatabase } from './idb';
import {
    saveEntryOf, sortSaveEntries,
    type DrawPlaythrough, type SaveEntry, type SaveRecord, type SaveStore, type StoredSaveRecord,
} from './SaveStore';

export class BrowserSaveStore implements SaveStore {
    /**
     * `drawPlaythrough` is for the store's upgrade, which gives a playthrough to each row
     * of an earlier version that names none (`stampSaveRecords`, `legacyRows.ts`).
     */
    constructor(private readonly drawPlaythrough: DrawPlaythrough) {}

    private db(): Promise<IDBDatabase> {
        return openSaveDatabase(this.drawPlaythrough);
    }

    async list(dataSet: string | null): Promise<SaveEntry[]> {
        const records = await idbGetAll<StoredSaveRecord>(await this.db(), SAVES_STORE);
        return sortSaveEntries(
            records.filter((record) => dataSet === null || record.dataSet === dataSet).map(saveEntryOf),
        );
    }

    async read(id: string): Promise<Uint8Array> {
        const record = await idbGet<StoredSaveRecord>(await this.db(), SAVES_STORE, id);
        if (!record) throw new Error('SAVE NOT FOUND');
        return new Uint8Array(record.bytes);
    }

    async write(entry: SaveEntry, bytes: Uint8Array): Promise<void> {
        const record: SaveRecord = {
            ...entry,
            // Copy out of the caller's buffer: a `Uint8Array` view onto a larger buffer
            // would otherwise be cloned whole.
            bytes: bytes.slice().buffer,
        };
        await idbPut(await this.db(), SAVES_STORE, record);
        askToPersist();
    }

    /** One transaction, so another tab's write between the read and the write is not lost. */
    async markUsed(id: string, usedAt: number): Promise<void> {
        const tx = (await this.db()).transaction(SAVES_STORE, 'readwrite');
        const done = idbDone(tx);
        const saves = tx.objectStore(SAVES_STORE);
        const row = saves.get(id);
        row.onsuccess = () => {
            const record = row.result as StoredSaveRecord | undefined;
            if (record) saves.put({ ...record, usedAt });
        };
        await done;
    }

    async remove(id: string): Promise<void> {
        await idbDelete(await this.db(), SAVES_STORE, id);
    }
}
