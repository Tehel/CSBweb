/**
 * The page's recordings, in the saves' IndexedDB database: a row each
 * (`RECORDINGS_STORE`) and its parts (`RECORDING_PARTS_STORE`), written and deleted
 * together (`RecordingStore`).
 */
import { RECORDINGS_STORE, RECORDING_PARTS_STORE, idbDone, idbGetAll, openSaveDatabase, recordingPartsOf } from './idb';
import {
    RecordingPrunedError, assembleRecording, cutRecording, sortRecordingEntries,
    type RecordingEntry, type RecordingHeld, type RecordingPart, type RecordingStore,
} from './RecordingStore';
import type { DrawPlaythrough } from './SaveStore';
import type { Recording, RecordingPoint } from '../../engine/Recorder';

export class BrowserRecordingStore implements RecordingStore {
    /** `drawPlaythrough` is the database's upgrade's, as `BrowserSaveStore`'s is: whichever store opens it first. */
    constructor(private readonly drawPlaythrough: DrawPlaythrough) {}

    private db(): Promise<IDBDatabase> {
        return openSaveDatabase(this.drawPlaythrough);
    }

    async list(): Promise<RecordingEntry[]> {
        return sortRecordingEntries(await idbGetAll<RecordingEntry>(await this.db(), RECORDINGS_STORE));
    }

    /** The row and its parts in one transaction, so a write between the two is not half read. */
    async read(id: string): Promise<Recording> {
        const tx = (await this.db()).transaction([RECORDINGS_STORE, RECORDING_PARTS_STORE], 'readonly');
        const done = idbDone(tx);
        const row = tx.objectStore(RECORDINGS_STORE).get(id);
        const parts = tx.objectStore(RECORDING_PARTS_STORE).getAll(recordingPartsOf(id));
        await done;
        const read = row.result as RecordingEntry | undefined;
        if (!read) throw new Error('RECORDING NOT FOUND');
        return assembleRecording(read, parts.result as RecordingPart[]);
    }

    /**
     * The row and its new parts in one transaction: all of them, or none. A first write
     * clears what parts the id has; a later one is aborted where the row is not as `held`
     * says, the requests of a transaction running in order.
     */
    async write(entry: RecordingEntry, parts: readonly RecordingPart[], held: RecordingHeld | null): Promise<void> {
        const tx = (await this.db()).transaction([RECORDINGS_STORE, RECORDING_PARTS_STORE], 'readwrite');
        const done = idbDone(tx);
        const rows = tx.objectStore(RECORDINGS_STORE);
        const store = tx.objectStore(RECORDING_PARTS_STORE);
        const put = () => {
            rows.put(entry);
            for (const part of parts) store.put(part);
        };
        let pruned = false;
        if (held === null) {
            store.delete(recordingPartsOf(entry.id));
            put();
        } else {
            const row = rows.get(entry.id);
            row.onsuccess = () => {
                const read = row.result as RecordingEntry | undefined;
                if (read && read.parts === held.parts && read.changes === held.changes) {
                    put();
                } else {
                    pruned = true;
                    tx.abort();
                }
            };
        }
        try {
            await done;
        } catch (error) {
            throw pruned ? new RecordingPrunedError(entry.id) : error;
        }
    }

    async cut(id: string, point: Omit<RecordingPoint, 'recording'>): Promise<void> {
        const tx = (await this.db()).transaction([RECORDINGS_STORE, RECORDING_PARTS_STORE], 'readwrite');
        const done = idbDone(tx);
        const rows = tx.objectStore(RECORDINGS_STORE);
        const store = tx.objectStore(RECORDING_PARTS_STORE);
        const row = rows.get(id);
        const parts = store.getAll(recordingPartsOf(id));
        // The row's request is answered before the parts'.
        parts.onsuccess = () => {
            const read = row.result as RecordingEntry | undefined;
            if (!read) return;
            const cut = cutRecording(read, parts.result as RecordingPart[], point);
            rows.put(cut.entry);
            store.delete(IDBKeyRange.bound([id, cut.removeFrom], [id, Infinity]));
            if (cut.last) store.put(cut.last);
        };
        await done;
    }

    async remove(id: string): Promise<void> {
        const tx = (await this.db()).transaction([RECORDINGS_STORE, RECORDING_PARTS_STORE], 'readwrite');
        const done = idbDone(tx);
        tx.objectStore(RECORDINGS_STORE).delete(id);
        tx.objectStore(RECORDING_PARTS_STORE).delete(recordingPartsOf(id));
        await done;
    }
}
