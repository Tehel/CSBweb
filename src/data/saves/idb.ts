/**
 * The smallest IndexedDB wrapper that serves the save store.
 *
 * IndexedDB rather than `localStorage`: a save carries the whole object list, every
 * database and the cell flags, so one is comfortably past a megabyte, and `localStorage`
 * is a synchronous ~5 MB budget for the whole origin.
 */
import { ROWS_UPGRADED_VERSION, upgradeStoredRows } from './legacyRows';
import type { DrawPlaythrough, StoredSaveRecord } from './SaveStore';

const DB_NAME = 'csbweb-saves';
/**
 * 5: a second store, `DATA_SETS_STORE`, the player's own data sets. 4: no row's file
 * holds 0 in all four of `GAMEBLOCK1`'s `Byte22598`, `Byte22596`, `Word22594` and
 * `Word22592`. 3: every row names a playthrough, its file's own. 2: a row is a
 * `SaveRecord`, with its data set, its playthrough and its quick flag, and its bytes are
 * a CSBWin file, which may name no playthrough. 1 had neither the three fields nor that
 * rule, and a second store for a directory handle.
 */
const DB_VERSION = 5;

/** The saves, one `SaveRecord` each, keyed by `id`. */
export const SAVES_STORE = 'saves';
/** The player's own data sets, one `LocalDataSetRecord` each, keyed by `id` (`BrowserDataSetStore`). */
export const DATA_SETS_STORE = 'dataSets';
/** The version that added `DATA_SETS_STORE`. */
const DATA_SETS_VERSION = 5;
/** Version 1's other store. */
const HANDLES_STORE = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * The set a version-1 row was saved in: version 1 played only `dm-atari`. A literal, not
 * the manifest's default, which says what a page plays now, not what those rows were.
 */
const VERSION_1_DATA_SET = 'dm-atari';

/**
 * An earlier version's rows made today's, in the upgrade's own transaction: all of them
 * or, if anything fails, none, and the database stays at the version it had. Only the
 * steps of the versions after `oldVersion` run (`upgradeStoredRows`): a version-1 row
 * names no data set, and every one becomes `dm-atari`'s (`VERSION_1_DATA_SET`); a row that
 * names no playthrough is given one, `draw` giving the new ones; and a file that holds
 * none of `GAMEBLOCK1`'s four words of `_ReadEntireGame` is given them. A store at
 * `ROWS_UPGRADED_VERSION` or past it is not read.
 */
function upgradeRows(db: IDBDatabase, tx: IDBTransaction, oldVersion: number, draw: DrawPlaythrough): void {
    if (db.objectStoreNames.contains(HANDLES_STORE)) db.deleteObjectStore(HANDLES_STORE);
    if (oldVersion >= ROWS_UPGRADED_VERSION) return;
    const saves = tx.objectStore(SAVES_STORE);
    const all = saves.getAll();
    all.onsuccess = () => {
        const rows: StoredSaveRecord[] = upgradeStoredRows(all.result, oldVersion, VERSION_1_DATA_SET, draw);
        saves.clear();
        for (const record of rows) saves.put(record);
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
            if (event.oldVersion < DATA_SETS_VERSION && !db.objectStoreNames.contains(DATA_SETS_STORE)) {
                db.createObjectStore(DATA_SETS_STORE, { keyPath: 'id' });
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

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
    return promisify<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
    return promisify<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).put(value));
    await idbDone(tx);
}

/** `tx` committed, or its error. */
export function idbDone(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
}

export async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).delete(key));
}
