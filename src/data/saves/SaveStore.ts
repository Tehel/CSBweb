/**
 * A save as the page keeps it: a row, the CSBWin file's bytes beside what a list needs.
 *
 * CSBWin has one directory and four fixed slots (`doc/CSBWIN_MENU_REFERENCE.md` → "The
 * four slots"), and keeps a game's saves in that game's directory
 * (`doc/CSBwin-src/CSBCode.cpp:9747-9756`). The page has one store, IndexedDB
 * (`BrowserSaveStore`), for every data set, so a row names its own.
 *
 * **Nothing in this file touches the DOM**: the rows, their order and their formatting
 * are pure, so that `tools/dump-save-menu.ts` can assert them headlessly.
 */
import { readCsbwinSaveInfo } from '../CsbwinSaveInfo';

/** One row of the list: what a save is listed by, without its bytes. */
export interface SaveEntry {
    /** The row's key in the store. */
    id: string;
    /** The file's name, a `.dat`. */
    name: string;
    /** The data set the game ran on, its `DataSet.id`. A list is asked for one set's rows. */
    dataSet: string;
    /**
     * The playthrough: the file's `d.RandomGameID`, drawn when a new game is read
     * (`doc/CSBwin-src/SaveGame.cpp:1523-1532`) and kept in `GAMEBLOCK1` (`:1060`).
     */
    playthrough: number;
    /** Whether F5 wrote it, rather than the menu's SAVE. */
    quick: boolean;
    /** Milliseconds since the epoch: the row's own, since a CSBWin file holds no date. */
    savedAt: number;
    /**
     * Milliseconds since the epoch: when the save was last used, written or read into a
     * game. The last save used in a data set is the row with the latest (`lastUsedSave`),
     * so using one save writes nothing to another's row.
     */
    usedAt: number;
    /** The dungeon level the party stood on, from the file's `GAMEBLOCK2`. */
    level: number;
    /** Champion names in party order, from the file's block 4. */
    champions: string[];
}

/** A row as the store holds it: the entry, and the CSBWin file. */
export interface SaveRecord extends SaveEntry {
    bytes: ArrayBuffer;
}

/**
 * A stored row's entry, without its bytes. A row written before rows held `usedAt` has
 * none, and counts as last used when it was saved.
 */
export function saveEntryOf(record: Omit<SaveRecord, 'usedAt'> & { usedAt?: number }): SaveEntry {
    return {
        id: record.id,
        name: record.name,
        dataSet: record.dataSet,
        playthrough: record.playthrough,
        quick: record.quick,
        savedAt: record.savedAt,
        usedAt: record.usedAt ?? record.savedAt,
        level: record.level,
        champions: record.champions,
    };
}

/** What a row reads from its file. */
export type SaveFileFields = Pick<SaveEntry, 'playthrough' | 'level' | 'champions'>;

/**
 * A file's part of its row, read from the file's own blocks (`readCsbwinSaveInfo`), as
 * any `.dat` is listed. `null` for a file that is not a CSBWin save, which has no row.
 */
export function readSaveFileFields(bytes: Uint8Array): SaveFileFields | null {
    const info = readCsbwinSaveInfo(bytes);
    if (!info) return null;
    return { playthrough: info.randomGameID, level: info.level, champions: info.champions };
}

/**
 * A listed save out of the store, to be read into the game: its row, which a read marks
 * as used, its file, and the playthrough its game takes when the file names none
 * (`GameSaves.open`), 0 for a file that names its own.
 */
export interface OpenedSave {
    entry: SaveEntry;
    bytes: Uint8Array;
    joins: number;
}

/**
 * The playthrough a save that names none belongs to: that of the newest of `rows` that
 * names one and is of the same data set and the same party, the same champions' names
 * in the same order. 0 when no row is.
 *
 * A file holds `RandomGameID` 0 when an earlier build of the port wrote it, and a game
 * loaded from it is given this playthrough, or a new one (`GameSaves.open`).
 */
export function joinedPlaythrough(entry: SaveEntry, rows: SaveEntry[]): number {
    const sameParty = (row: SaveEntry): boolean =>
        row.champions.length === entry.champions.length
        && row.champions.every((name, i) => name === entry.champions[i]);
    const found = sortSaveEntries(rows).find(
        (row) => row.playthrough !== 0 && row.dataSet === entry.dataSet && sameParty(row),
    );
    return found ? found.playthrough : 0;
}

/**
 * F5's slot: the quick-save of a playthrough in a data set, which the key writes over.
 * The newest, where a store holds several: an earlier build made a row at each press,
 * and the older ones stay as they are.
 *
 * Playthrough 0 has no slot. No game with a party runs under it: a new game never draws
 * 0 (`drawRandomGameID`) and `GameSaves.open` gives a loaded one another. The rows that
 * hold 0 are files of an earlier build, of any game, which no F5 may write over.
 */
export function quickSlot(rows: SaveEntry[], dataSet: string, playthrough: number): SaveEntry | undefined {
    if (playthrough === 0) return undefined;
    return sortSaveEntries(rows).find(
        (row) => row.quick && row.dataSet === dataSet && row.playthrough === playthrough,
    );
}

/**
 * The last save used among `rows`, written or loaded: the one of the latest `usedAt`,
 * and of two used at once the one saved last. `undefined` for no row.
 */
export function lastUsedSave(rows: SaveEntry[]): SaveEntry | undefined {
    return sortSaveEntries(rows).reduce<SaveEntry | undefined>(
        (last, row) => (!last || row.usedAt > last.usedAt ? row : last),
        undefined,
    );
}

export interface SaveStore {
    /** One data set's rows, or every set's for `null`, newest first. */
    list(dataSet: string | null): Promise<SaveEntry[]>;
    /** A row's CSBWin file. */
    read(id: string): Promise<Uint8Array>;
    /** Write a row, over the one of the same `id` if there is one. */
    write(entry: SaveEntry, bytes: Uint8Array): Promise<void>;
    /** Set a row's `usedAt`, and nothing else of it. Nothing for a row that is gone. */
    markUsed(id: string, usedAt: number): Promise<void>;
}

/** `YYYY-MM-DD`, in the player's own timezone — the date they would call it. */
export function formatSaveDate(savedAt: number): string {
    const d = new Date(savedAt);
    if (Number.isNaN(d.getTime())) return '????-??-??';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Newest first. CSBWin ranks its four slots by `MODIFIEDTIME` and letters them oldest
 * to newest (`doc/CSBwin-src/CSBCode.cpp:9766-9800`); this is the same ordering shown
 * directly and the other way up, because the save you want is nearly always the last
 * one you made. Ties break on name so the order is stable.
 */
export function sortSaveEntries(entries: SaveEntry[]): SaveEntry[] {
    return [...entries].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/** Champion names cut to three characters, which is what fits four of them on a row. */
export function abbreviateChampions(champions: string[], width = 3): string {
    return champions
        .slice(0, 4)
        .map((n) => n.trim().toUpperCase().slice(0, width))
        .filter((n) => n.length > 0)
        .join(' ');
}

/** One list row: `2026-09-13 L14 DAR SON LEY ESM`, clipped to the panel's 33 characters. */
export function formatSaveRow(entry: SaveEntry, maxChars = 33): string {
    const level = `L${Math.max(0, entry.level | 0)}`;
    const row = `${formatSaveDate(entry.savedAt)} ${level} ${abbreviateChampions(entry.champions)}`;
    return row.length > maxChars ? row.slice(0, maxChars) : row;
}

/** The detail line above the list: the selected save's full roster. */
export function formatSaveDetail(entry: SaveEntry | null, maxChars = 33): string {
    if (!entry) return '';
    const text = entry.champions.map((n) => n.trim().toUpperCase()).join(' ');
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** The suffix of a save's name: a CSBWin file, which CSBWin opens. */
export const SAVE_FILE_EXTENSION = '.dat';
