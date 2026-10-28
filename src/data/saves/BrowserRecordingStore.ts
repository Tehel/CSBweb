/**
 * The page's recordings, in the saves' IndexedDB database: a row each
 * (`RECORDINGS_STORE`) and its parts (`RECORDING_PARTS_STORE`), written and deleted
 * together (`RecordingStore`).
 */
import { RECORDINGS_STORE, RECORDING_PARTS_STORE, idbDone, idbGetAll, openSaveDatabase, recordingPartsOf } from './idb';
import { assembleRecording, sortRecordingEntries, type RecordingEntry, type RecordingPart, type RecordingStore } from './RecordingStore';
import type { DrawPlaythrough } from './SaveStore';
import type { Recording } from '../../engine/Recorder';

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

    /** The row and its new parts in one transaction: all of them, or none. */
    async write(entry: RecordingEntry, parts: readonly RecordingPart[]): Promise<void> {
        const tx = (await this.db()).transaction([RECORDINGS_STORE, RECORDING_PARTS_STORE], 'readwrite');
        const done = idbDone(tx);
        tx.objectStore(RECORDINGS_STORE).put(entry);
        const store = tx.objectStore(RECORDING_PARTS_STORE);
        for (const part of parts) store.put(part);
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
