/**
 * The smallest IndexedDB wrapper that serves the save store.
 *
 * IndexedDB rather than `localStorage`: a save carries the whole object list, every
 * database and the cell flags, so one is comfortably past a megabyte, and `localStorage`
 * is a synchronous ~5 MB budget for the whole origin.
 */
import { DEFAULT_DATA_SET } from '../DataSets';
import { upgradeSaveRecords } from './legacyRows';

const DB_NAME = 'dmweb-saves';
/**
 * 2: a row is a `SaveRecord`, with its data set, its playthrough and its quick flag, and
 * its bytes are a CSBWin file. 1 had neither the three fields nor that rule, and a second
 * store for a directory handle.
 */
const DB_VERSION = 2;

/** The saves, one `SaveRecord` each, keyed by `id`. */
export const SAVES_STORE = 'saves';
/** Version 1's other store. */
const HANDLES_STORE = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Version 1's rows made version 2's, in the upgrade's own transaction: all of them or,
 * if anything fails, none, and the database stays at version 1.
 *
 * A version-1 row names no data set, and every one becomes the default set's.
 */
function upgradeFromVersion1(db: IDBDatabase, tx: IDBTransaction): void {
    if (db.objectStoreNames.contains(HANDLES_STORE)) db.deleteObjectStore(HANDLES_STORE);
    const saves = tx.objectStore(SAVES_STORE);
    const all = saves.getAll();
    all.onsuccess = () => {
        saves.clear();
        for (const record of upgradeSaveRecords(all.result, DEFAULT_DATA_SET.id)) saves.put(record);
    };
}

export function openSaveDatabase(): Promise<IDBDatabase> {
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
            else if (request.transaction) upgradeFromVersion1(db, request.transaction);
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

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await openSaveDatabase();
    return promisify<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
    const db = await openSaveDatabase();
    return promisify<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function idbPut(store: string, value: unknown): Promise<void> {
    const db = await openSaveDatabase();
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).put(value));
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
    const db = await openSaveDatabase();
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).delete(key));
}
