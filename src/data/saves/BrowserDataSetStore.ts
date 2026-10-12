/**
 * The player's own data sets (`src/data/LocalDataSets.ts`), in the saves' IndexedDB
 * database: one record each, its files as Blobs, keyed by its `local:<id>`.
 */
import type { LocalDataSetRecord } from '../LocalDataSets';
import { DATA_SETS_STORE, idbDelete, idbGet, idbGetAll, idbPut, openSaveDatabase } from './idb';
import type { DrawPlaythrough } from './SaveStore';

export class BrowserDataSetStore {
    /** `drawPlaythrough` is the database's upgrade's, as `BrowserSaveStore`'s is: whichever store opens it first. */
    constructor(private readonly drawPlaythrough: DrawPlaythrough) {}

    private db(): Promise<IDBDatabase> {
        return openSaveDatabase(this.drawPlaythrough);
    }

    /** Every local set, oldest first. */
    async list(): Promise<LocalDataSetRecord[]> {
        const records = await idbGetAll<LocalDataSetRecord>(await this.db(), DATA_SETS_STORE);
        return records.sort((a, b) => a.createdAt - b.createdAt);
    }

    /** The set `id` names, or `undefined` for none. */
    async get(id: string): Promise<LocalDataSetRecord | undefined> {
        return idbGet<LocalDataSetRecord>(await this.db(), DATA_SETS_STORE, id);
    }

    /** `record`, added or written over the one of its id. */
    async put(record: LocalDataSetRecord): Promise<void> {
        await idbPut(await this.db(), DATA_SETS_STORE, record);
    }

    async remove(id: string): Promise<void> {
        await idbDelete(await this.db(), DATA_SETS_STORE, id);
    }
}
