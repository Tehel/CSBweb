/**
 * The smallest IndexedDB wrapper that serves the two save stores.
 *
 * IndexedDB rather than `localStorage`, which is where the quick-save lives: a v5
 * runtime snapshot carries the whole object list, every database and the cell flags, so
 * one save is comfortably past a megabyte and `localStorage` is a synchronous ~5 MB
 * budget for the whole origin. The same database also holds the directory handle the
 * file store remembers, because a `FileSystemDirectoryHandle` is structured-cloneable
 * and so can be stored but not stringified.
 */

const DB_NAME = 'dmweb-saves';
const DB_VERSION = 1;

/** Our own saves: `{ id, name, savedAt, level, champions, bytes }`. */
export const SAVES_STORE = 'saves';
/** Single-key odds and ends — currently just the picked directory handle. */
export const HANDLES_STORE = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openSaveDatabase(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SAVES_STORE)) {
                db.createObjectStore(SAVES_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(HANDLES_STORE)) {
                db.createObjectStore(HANDLES_STORE);
            }
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

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    const db = await openSaveDatabase();
    const tx = db.transaction(store, 'readwrite');
    const request = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    await promisify(request);
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
