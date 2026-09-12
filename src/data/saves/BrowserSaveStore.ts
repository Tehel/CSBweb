/**
 * Saves kept inside the browser, in IndexedDB.
 *
 * The default source, and the only one that needs no permission, no picker and no
 * Chromium: it is always ready. The cost is that the player cannot see, copy or back up
 * what is in it from outside the page, which is exactly why the file store exists
 * beside it.
 */
import { SAVES_STORE, idbDelete, idbGetAll, idbPut } from './idb';
import { sortSaveEntries, type SaveEntry, type SaveEntryMeta, type SaveStore } from './SaveStore';

interface BrowserSaveRecord {
    id: string;
    name: string;
    savedAt: number;
    level: number;
    champions: string[];
    bytes: ArrayBuffer;
}

export class BrowserSaveStore implements SaveStore {
    readonly kind = 'browser' as const;

    isSupported(): boolean {
        return typeof indexedDB !== 'undefined';
    }

    isReady(): boolean {
        return this.isSupported();
    }

    async connect(): Promise<boolean> {
        return this.isSupported();
    }

    describe(): string {
        return this.isSupported() ? 'IN THIS BROWSER' : 'NO BROWSER STORAGE';
    }

    async list(): Promise<SaveEntry[]> {
        const records = await idbGetAll<BrowserSaveRecord>(SAVES_STORE);
        return sortSaveEntries(
            records.map((r) => ({
                id: r.id,
                name: r.name,
                savedAt: r.savedAt,
                level: r.level,
                champions: r.champions ?? [],
                loadable: true,
            })),
        );
    }

    async read(id: string): Promise<Uint8Array> {
        const records = await idbGetAll<BrowserSaveRecord>(SAVES_STORE);
        const record = records.find((r) => r.id === id);
        if (!record) throw new Error('SAVE NOT FOUND');
        return new Uint8Array(record.bytes);
    }

    async write(meta: SaveEntryMeta, bytes: Uint8Array): Promise<void> {
        const record: BrowserSaveRecord = {
            id: meta.name,
            name: meta.name,
            savedAt: meta.savedAt,
            level: meta.level,
            champions: meta.champions,
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
