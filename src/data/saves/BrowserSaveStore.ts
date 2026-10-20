/**
 * The page's saves, in IndexedDB: the one store, which needs no permission and no
 * picker. A save is two records, its row (`SAVES_STORE`) and its file
 * (`SAVE_FILES_STORE`), written and deleted together: a list reads the rows alone. The player cannot see, copy or back up what is in it from outside the page:
 * the save menu's EXPORT is the way out, a save's file downloaded (`downloadSaveFile`).
 */
import { SAVES_STORE, SAVE_FILES_STORE, askToPersist, idbDone, idbGet, idbGetAll, openSaveDatabase } from './idb';
import {
    saveEntryOf, sortSaveEntries,
    type DrawPlaythrough, type SaveEntry, type SaveFileRecord, type SaveStore, type StoredSaveEntry,
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
        const records = await idbGetAll<StoredSaveEntry>(await this.db(), SAVES_STORE);
        return sortSaveEntries(
            records.filter((record) => dataSet === null || record.dataSet === dataSet).map(saveEntryOf),
        );
    }

    async read(id: string): Promise<Uint8Array> {
        const file = await idbGet<SaveFileRecord>(await this.db(), SAVE_FILES_STORE, id);
        if (!file) throw new Error('SAVE NOT FOUND');
        return new Uint8Array(file.bytes);
    }

    /** The row and its file in one transaction: both of them, or neither. */
    async write(entry: SaveEntry, bytes: Uint8Array): Promise<void> {
        const file: SaveFileRecord = {
            id: entry.id,
            // Copy out of the caller's buffer: a `Uint8Array` view onto a larger buffer
            // would otherwise be cloned whole.
            bytes: bytes.slice().buffer,
        };
        const tx = (await this.db()).transaction([SAVES_STORE, SAVE_FILES_STORE], 'readwrite');
        const done = idbDone(tx);
        tx.objectStore(SAVES_STORE).put(entry);
        tx.objectStore(SAVE_FILES_STORE).put(file);
        await done;
        askToPersist();
    }

    /** One transaction, so another tab's write between the read and the write is not lost. */
    async markUsed(id: string, usedAt: number): Promise<void> {
        const tx = (await this.db()).transaction(SAVES_STORE, 'readwrite');
        const done = idbDone(tx);
        const saves = tx.objectStore(SAVES_STORE);
        const row = saves.get(id);
        row.onsuccess = () => {
            const record = row.result as StoredSaveEntry | undefined;
            if (record) saves.put({ ...record, usedAt });
        };
        await done;
    }

    /** The row and its file in one transaction, as `write`. */
    async remove(id: string): Promise<void> {
        const tx = (await this.db()).transaction([SAVES_STORE, SAVE_FILES_STORE], 'readwrite');
        const done = idbDone(tx);
        tx.objectStore(SAVES_STORE).delete(id);
        tx.objectStore(SAVE_FILES_STORE).delete(id);
        await done;
    }
}
