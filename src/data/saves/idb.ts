/**
 * The smallest IndexedDB wrapper that serves the save store.
 *
 * IndexedDB rather than `localStorage`: a save carries the whole object list, every
 * database and the cell flags, so one is comfortably past a megabyte, and `localStorage`
 * is a synchronous ~5 MB budget for the whole origin.
 */
import { DEFAULT_DATA_SET } from '../DataSets';
import { stampBlock1Rows, stampSaveRecords, upgradeSaveRecords } from './legacyRows';
import type { DrawPlaythrough, StoredSaveRecord } from './SaveStore';

const DB_NAME = 'dmweb-saves';
/**
 * 4: no row's file holds 0 in all four of `GAMEBLOCK1`'s `Byte22598`, `Byte22596`,
 * `Word22594` and `Word22592`. 3: every row names a playthrough, its file's own. 2: a
 * row is a `SaveRecord`, with its data set, its playthrough and its quick flag, and its
 * bytes are a CSBWin file, which may name no playthrough. 1 had neither the three fields nor that rule, and a second
 * store for a directory handle.
 */
const DB_VERSION = 4;

/** The saves, one `SaveRecord` each, keyed by `id`. */
export const SAVES_STORE = 'saves';
/** Version 1's other store. */
const HANDLES_STORE = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * An earlier version's rows made today's, in the upgrade's own transaction: all of them
 * or, if anything fails, none, and the database stays at the version it had.
 *
 * Version 1's rows are made version 2's first: a version-1 row names no data set, and
 * every one becomes the default set's. Then each row that names no playthrough is given
 * one, stamped into its file (`stampSaveRecords`), `draw` giving the new ones. Last, each
 * file that holds none of `GAMEBLOCK1`'s four words of `_ReadEntireGame` is given them
 * (`stampBlock1Rows`).
 */
function upgradeRows(db: IDBDatabase, tx: IDBTransaction, oldVersion: number, draw: DrawPlaythrough): void {
    if (db.objectStoreNames.contains(HANDLES_STORE)) db.deleteObjectStore(HANDLES_STORE);
    const saves = tx.objectStore(SAVES_STORE);
    const all = saves.getAll();
    all.onsuccess = () => {
        const rows: StoredSaveRecord[] = oldVersion < 2 ? upgradeSaveRecords(all.result, DEFAULT_DATA_SET.id) : all.result;
        const stamped = stampBlock1Rows(stampSaveRecords(rows, draw));
        saves.clear();
        for (const record of stamped) saves.put(record);
    };
}

/**
 * The database, opened once and upgraded when it is an earlier version's. `draw` is the
 * upgrade's: the playthrough of a row that names none and joins no other's.
 */
export function openSaveDatabase(draw: DrawPlaythrough): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('NO BROWSER STORAGE'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            if (event.oldVersion < 1) db.createObjectStore(SAVES_STORE, { keyPath: 'id' });
            else if (request.transaction) upgradeRows(db, request.transaction, event.oldVersion, draw);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    // A failed open must not be cached, or the store is dead for the session.
    dbPromise.catch(() => {
        dbPromise = null;
    });
    return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
    return promisify<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
    return promisify<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).put(value));
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
}

export async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).delete(key));
}
