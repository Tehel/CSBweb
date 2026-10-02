/**
 * The rows of the store's first version, turned into today's (`SaveRecord`).
 *
 * A version-1 row is `{ id, name, savedAt, level, champions, bytes }`, and its bytes are
 * a CSBWin file or a `.dmweb.json`: JSON around such a file, carried in base64 as `raw`.
 * The upgrade keeps the file alone, names it a `.dat`, and reads the row's level,
 * champions and playthrough from it, as a row written today has them. The data set is the
 * caller's to give: a version-1 row names none.
 *
 * A row that holds no CSBWin file is dropped: no build could load it, and it has no row
 * here (`readSaveFileFields`).
 *
 * Pure, so `tools/dump-save-menu.ts` runs it; `idb.ts` calls it once, in the upgrade.
 */
import { SAVE_FILE_EXTENSION, readSaveFileFields, type SaveRecord } from './SaveStore';

/** The suffix of a JSON save's name. */
const JSON_SAVE_FILE_EXTENSION = '.dmweb.json';

export function decodeBase64ToBytes(data: string): Uint8Array {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
}

/**
 * Is this a `.dmweb.json`, or a CSBWin file?
 *
 * A `.dmweb.json` is `JSON.stringify` output, so its first non-whitespace byte is `{`.
 * A CSBWin save opens with the Extended Features block, and may open with an enciphered
 * one, which is why this asks the cheap, certain question about the wrapper rather than
 * trying to recognise the file.
 */
function looksLikeJson(bytes: Uint8Array): boolean {
    for (let i = 0; i < Math.min(bytes.length, 64); i++) {
        const byte = bytes[i];
        if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
        return byte === 0x7b; // '{'
    }
    return false;
}

/** The CSBWin file a `.dmweb.json` carries as `raw`, or `null` when it carries none. */
function rawFileOf(bytes: Uint8Array): Uint8Array | null {
    try {
        const raw = (JSON.parse(new TextDecoder().decode(bytes)) as { raw?: unknown } | null)?.raw;
        return typeof raw === 'string' ? decodeBase64ToBytes(raw) : null;
    } catch {
        return null;
    }
}

/** One version-1 row as today's, or `null` for a row that holds no CSBWin file. */
function upgradeSaveRecord(old: unknown, dataSet: string): SaveRecord | null {
    const row = old as { id?: unknown; name?: unknown; savedAt?: unknown; bytes?: unknown } | null;
    if (!row || typeof row.name !== 'string') return null;
    const stored = row.bytes instanceof ArrayBuffer
        ? new Uint8Array(row.bytes)
        : ArrayBuffer.isView(row.bytes)
            ? new Uint8Array(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength)
            : null;
    if (!stored) return null;
    const file = looksLikeJson(stored) ? rawFileOf(stored) : stored;
    const fields = file && readSaveFileFields(file);
    if (!file || !fields) return null;
    const name = row.name.toLowerCase().endsWith(JSON_SAVE_FILE_EXTENSION)
        ? row.name.slice(0, -JSON_SAVE_FILE_EXTENSION.length) + SAVE_FILE_EXTENSION
        : row.name;
    const savedAt = typeof row.savedAt === 'number' ? row.savedAt : 0;
    return {
        id: name,
        name,
        dataSet,
        quick: false,
        savedAt,
        usedAt: savedAt,
        playTime: 0,
        ...fields,
        // A copy of the file alone, not a view of the JSON's buffer.
        bytes: file.slice().buffer,
    };
}

/**
 * Every version-1 row as today's, all of them rows of `dataSet`. Two rows that come to
 * the same name keep the newer.
 */
export function upgradeSaveRecords(old: readonly unknown[], dataSet: string): SaveRecord[] {
    const byId = new Map<string, SaveRecord>();
    for (const row of old) {
        const record = upgradeSaveRecord(row, dataSet);
        if (!record) continue;
        const held = byId.get(record.id);
        if (!held || held.savedAt < record.savedAt) byId.set(record.id, record);
    }
    return [...byId.values()];
}
