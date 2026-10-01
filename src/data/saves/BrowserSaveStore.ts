/**
 * The page's saves, in IndexedDB: the one store, which needs no permission and no
 * picker. The player cannot see, copy or back up what is in it from outside the page.
 */
import { SAVES_STORE, idbDelete, idbGet, idbGetAll, idbPut } from './idb';
import { sortSaveEntries, type SaveEntry, type SaveRecord, type SaveStore } from './SaveStore';

/** A record's row, without its bytes. */
function entryOf(record: SaveRecord): SaveEntry {
    return {
        id: record.id,
        name: record.name,
        dataSet: record.dataSet,
        playthrough: record.playthrough,
        quick: record.quick,
        savedAt: record.savedAt,
        level: record.level,
        champions: record.champions,
    };
}

export class BrowserSaveStore implements SaveStore {
    async list(dataSet: string | null): Promise<SaveEntry[]> {
        const records = await idbGetAll<SaveRecord>(SAVES_STORE);
        return sortSaveEntries(
            records.filter((record) => dataSet === null || record.dataSet === dataSet).map(entryOf),
        );
    }

    async read(id: string): Promise<Uint8Array> {
        const record = await idbGet<SaveRecord>(SAVES_STORE, id);
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
        await idbPut(SAVES_STORE, record);
    }

    async remove(id: string): Promise<void> {
        await idbDelete(SAVES_STORE, id);
    }
}
