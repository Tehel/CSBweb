/**
 * The rows of the store's earlier versions, turned into today's (`SaveRecord`).
 *
 * **Version 1** (`upgradeSaveRecords`). A version-1 row is `{ id, name, savedAt, level, champions, bytes }`, and its bytes are
 * a CSBWin file or a `.dmweb.json`: JSON around such a file, carried in base64 as `raw`.
 * The upgrade keeps the file alone, names it a `.dat`, and reads the row's level,
 * champions and playthrough from it, as a row written today has them. The data set is the
 * caller's to give: a version-1 row names none.
 *
 * A row that holds no CSBWin file is dropped: no build could load it, and it has no row
 * here (`readSaveFileFields`). The later steps keep a row they cannot read as it is: the
 * store is the only copy of a save, and a reader made stricter must not delete it.
 *
 * **Version 2** (`stampSaveRecords`). A version-2 row is today's, but its file may name
 * no playthrough: an earlier build wrote `RandomGameID` 0. The upgrade gives each such
 * row a playthrough and stamps it into the file, so that no stored save holds 0
 * (`doc/SAVES.md` → "A playthrough").
 *
 * **Version 3** (`stampBlock1Rows`). A version-3 row is today's, but its file may hold 0
 * in `GAMEBLOCK1`'s `Byte22598`, `Byte22596`, `Word22594` and `Word22592`, which CSBWin
 * never writes and an earlier build did. The upgrade stamps `_ReadEntireGame`'s 1, 2, 1
 * and 13 into each such file, the author's decision, so that the utility can make a new
 * adventure of it (`doc/SAVES.md` → "What a save is"). A file imported later is
 * left as it is.
 *
 * Each step runs on a store of a version before its own alone (`upgradeStoredRows`), so a
 * file imported since is left as it is.
 *
 * **Version 5** (`splitSaveRecord`). A row held its file, and a list read every file. The
 * upgrade puts each file in a store of its own, under its row's `id`, and keeps the row
 * without it. It runs on the rows of every earlier version, once the steps above have
 * made them today's.
 *
 * All four are pure, so the tools run them (`tools/checks/save-menu.ts`,
 * `tools/checks/save-stamp.ts`); `idb.ts` calls them once, in the upgrade.
 */
import { holdsNoBlock1Words, stampBlock1Words, stampRandomGameID } from '../SaveGameLoader';
import {
    SAVE_FILE_EXTENSION, joinedPlaythrough, readSaveFileFields, saveEntryOf,
    type DrawPlaythrough, type SaveFileRecord, type SaveRecord, type StoredSaveEntry, type StoredSaveRecord,
} from './SaveStore';

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
        sleep: false,
        savedAt,
        usedAt: savedAt,
        playTime: 0,
        unofficial: false,
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

/**
 * Every version-2 row as today's: each names a playthrough, its file's own.
 *
 * A row that names none takes the playthrough of the newest row of its data set and its
 * party that names one (`joinedPlaythrough`), and with none a new one, which `draw`
 * gives against its data set's rows. The id is stamped into the row's file, `GAMEBLOCK1`'s
 * `RandomGameID` and nothing else of the game (`stampRandomGameID`), so the row and its
 * file agree. One row at a time, each seeing the ones stamped before it: the rows of one
 * party and data set that named none end up in one playthrough, in whatever order they
 * come.
 *
 * A row that names a playthrough is returned as it is, and so is one whose file does not
 * take the stamp.
 */
export function stampSaveRecords(rows: readonly StoredSaveRecord[], draw: DrawPlaythrough): StoredSaveRecord[] {
    const kept: StoredSaveRecord[] = [...rows];
    for (let i = 0; i < kept.length; i++) {
        const row = kept[i]!;
        if (row.playthrough !== 0) continue;
        const others = kept.map(saveEntryOf);
        const playthrough = joinedPlaythrough(saveEntryOf(row), others)
            || draw(others.filter((other) => other.dataSet === row.dataSet));
        try {
            kept[i] = { ...row, playthrough, bytes: stampRandomGameID(new Uint8Array(row.bytes), playthrough).buffer };
        } catch {
            // Not read: kept as it is.
        }
    }
    return kept;
}

/**
 * Every version-3 row as today's: no file holds 0 in all four of `GAMEBLOCK1`'s
 * `Byte22598`, `Byte22596`, `Word22594` and `Word22592` (`holdsNoBlock1Words`). Each
 * that does takes `_ReadEntireGame`'s 1, 2, 1 and 13 (`stampBlock1Words`), and the rest
 * of the row is kept: the four are none of what the row reads from its file.
 *
 * A row whose file holds a word of the four is returned as it is, and so is one whose
 * file does not read.
 */
export function stampBlock1Rows(rows: readonly StoredSaveRecord[]): StoredSaveRecord[] {
    return rows.map((row) => {
        try {
            const bytes = new Uint8Array(row.bytes);
            return holdsNoBlock1Words(bytes) ? { ...row, bytes: stampBlock1Words(bytes).buffer } : row;
        } catch {
            return row;
        }
    });
}

/** The version the last step of the rows' makes a store: one at it or past it has no row to change. */
export const ROWS_UPGRADED_VERSION = 4;

/**
 * A store's rows at `oldVersion` as today's: each step for a version after `oldVersion`,
 * in turn, and none of the others. Version 1's rows are made `dataSet`'s, the one set
 * there was; `draw` gives the new playthroughs (`stampSaveRecords`).
 */
export function upgradeStoredRows(rows: readonly unknown[], oldVersion: number, dataSet: string, draw: DrawPlaythrough): StoredSaveRecord[] {
    let upgraded = oldVersion < 2 ? upgradeSaveRecords(rows, dataSet) : rows as readonly StoredSaveRecord[];
    if (oldVersion < 3) upgraded = stampSaveRecords(upgraded, draw);
    if (oldVersion < 4) upgraded = stampBlock1Rows(upgraded);
    return [...upgraded];
}

/** The version that put the files in a store of their own: a store before it holds each file in its row. */
export const FILES_APART_VERSION = 6;

/** A row of a store before `FILES_APART_VERSION` as today's row and its file, under the row's `id`. */
export function splitSaveRecord({ bytes, ...entry }: StoredSaveRecord): { entry: StoredSaveEntry; file: SaveFileRecord } {
    return { entry, file: { id: entry.id, bytes } };
}
