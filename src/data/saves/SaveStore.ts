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
    /**
     * Milliseconds the player had spent in the game when it was saved (`Game.playTime`):
     * the row's own, since a CSBWin file holds `d.Time`, which sleep runs fast, and
     * nothing of the player's clock. A load gives the game this count back.
     */
    playTime: number;
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
 * none, and counts as last used when it was saved; one written before they held
 * `playTime` counts no time played.
 */
export function saveEntryOf(
    record: Omit<SaveRecord, 'usedAt' | 'playTime'> & { usedAt?: number; playTime?: number },
): SaveEntry {
    return {
        id: record.id,
        name: record.name,
        dataSet: record.dataSet,
        playthrough: record.playthrough,
        quick: record.quick,
        savedAt: record.savedAt,
        usedAt: record.usedAt ?? record.savedAt,
        playTime: record.playTime ?? 0,
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

/** The order of use: the latest `usedAt` first, and of two used at once the one saved last. */
function byLastUse(a: SaveEntry, b: SaveEntry): number {
    return b.usedAt - a.usedAt || b.savedAt - a.savedAt || a.name.localeCompare(b.name);
}

/**
 * The last save used among `rows`, written or loaded: the one of the latest `usedAt`,
 * and of two used at once the one saved last. `undefined` for no row.
 */
export function lastUsedSave(rows: SaveEntry[]): SaveEntry | undefined {
    return [...rows].sort(byLastUse)[0];
}

/**
 * A playthrough as the list shows one, under a heading: the saves of one data set that
 * share a `d.RandomGameID`. The files that name none (0) are one such group, whatever
 * games they are of.
 */
export interface Playthrough {
    /** The `RandomGameID` its saves share (`SaveEntry.playthrough`). */
    id: number;
    /** Its saves, newest first. */
    saves: SaveEntry[];
    /** The last of them used (`lastUsedSave`): what LOAD reads from the heading. */
    lastUsed: SaveEntry;
}

/**
 * The playthroughs of `rows`, the last one used first: each is as recent as the last
 * use of one of its saves, so the first holds the last save used of them all.
 */
export function playthroughsOf(rows: SaveEntry[]): Playthrough[] {
    const saves = new Map<number, SaveEntry[]>();
    for (const row of sortSaveEntries(rows)) {
        const held = saves.get(row.playthrough);
        if (held) held.push(row);
        else saves.set(row.playthrough, [row]);
    }
    return [...saves]
        .map(([id, own]): Playthrough => ({ id, saves: own, lastUsed: lastUsedSave(own)! }))
        .sort((a, b) => byLastUse(a.lastUsed, b.lastUsed));
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

/** `HH:MM`, in the player's own timezone, as the date is. */
export function formatSaveTime(savedAt: number): string {
    const d = new Date(savedAt);
    if (Number.isNaN(d.getTime())) return '??:??';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A party's names as a row shows them: `DAROO SONJA LEYLA ESMARDA`. */
function formatChampions(champions: string[]): string {
    return champions
        .map((n) => n.trim().toUpperCase())
        .filter((n) => n.length > 0)
        .join(' ');
}

/**
 * A playthrough's heading: `- DAROO SONJA LEYLA ESMARDA`, the champions of its newest
 * save after `+` when its saves are folded away and `-` when they are listed. Four
 * names of seven characters, the longest a champion has, are the panel's 33 characters.
 */
export function formatPlaythroughRow(playthrough: Playthrough, folded: boolean, maxChars = 33): string {
    const row = `${folded ? '+' : '-'} ${formatChampions(playthrough.saves[0].champions)}`;
    return row.length > maxChars ? row.slice(0, maxChars) : row;
}

/**
 * A save's row under its playthrough's heading: `  2026-09-13 14:05 L14 QUICKSAVE`, the
 * day and the time it was saved, the level, and `QUICKSAVE` on F5's. The party is the
 * heading's.
 */
export function formatSaveRow(entry: SaveEntry, maxChars = 33): string {
    const level = `L${Math.max(0, entry.level | 0)}`;
    const row = `  ${formatSaveDate(entry.savedAt)} ${formatSaveTime(entry.savedAt)} ${level}${entry.quick ? ' QUICKSAVE' : ''}`;
    return row.length > maxChars ? row.slice(0, maxChars) : row;
}

/** A play time as `H:MM:SS`, the hours as long as they are: `0:00:10`, `123:04:05`. */
export function formatPlayTime(playTime: number): string {
    const seconds = Number.isFinite(playTime) ? Math.max(0, Math.floor(playTime / 1000)) : 0;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(seconds / 3600)}:${p(Math.floor(seconds / 60) % 60)}:${p(seconds % 60)}`;
}

/** How many champions a party holds, and so how many lines a preview keeps for them. */
const PARTY_SIZE = 4;

/**
 * A save's preview, a line of the panel each: the champions' names, one a line; the
 * level; the play time; the day and the time it was saved. A party of fewer than four
 * leaves its other lines empty, so that every save shows the rest in the same place.
 * A day is ten characters and a name seven at most, so every line fits the panel's
 * eleven.
 */
export function formatSavePreview(entry: SaveEntry, maxChars = 11): string[] {
    const names = entry.champions.map((n) => n.trim().toUpperCase()).filter((n) => n.length > 0).slice(0, PARTY_SIZE);
    while (names.length < PARTY_SIZE) names.push('');
    return [
        ...names,
        '',
        `LEVEL ${Math.max(0, entry.level | 0)}`,
        '',
        'PLAYED',
        formatPlayTime(entry.playTime),
        '',
        'SAVED',
        formatSaveDate(entry.savedAt),
        formatSaveTime(entry.savedAt),
    ].map((line) => line.slice(0, maxChars));
}

/** The suffix of a save's name: a CSBWin file, which CSBWin opens. */
export const SAVE_FILE_EXTENSION = '.dat';
