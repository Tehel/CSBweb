/**
 * The two places a DMweb save can live, behind one interface.
 *
 * CSBWin has one filesystem and four fixed slots (`doc/CSBWIN_MENU_REFERENCE.md` → "The
 * four slots"). A browser has two stores and neither is the other's fallback: what the
 * page writes into IndexedDB nobody can copy or back up, and what it writes to disk it
 * can only reach through a directory the player picked by hand. So the menu offers both
 * and this is what they have in common.
 *
 * **Nothing in this file touches the DOM** — the row formatting and ordering are pure so
 * that `tools/dump-save-menu.ts` can assert them headlessly. The two implementations
 * live next door.
 */

export type SaveStoreKind = 'browser' | 'file';

/** One row of the list. */
export interface SaveEntry {
    /** Store-specific key: an IndexedDB id, or a file name. */
    id: string;
    /** What the player sees if they ever look at the store from outside. */
    name: string;
    /** Milliseconds since the epoch. A file's `lastModified`, or the save's own header. */
    savedAt: number;
    /** The dungeon level the party stood on. */
    level: number;
    /** Champion names in party order. */
    champions: string[];
    /**
     * Whether LOAD will act on this row. Genuine CSBWin `.dat` saves were listed with
     * this false while their object references were undecodable; they load now
     * (`src/engine/CsbwinSaveGame.ts`). What still sets it false is a save this build
     * cannot restore — a `SavePayload` from an older format version, say — and the row
     * is then marked with a `*` and carries a `note` saying why.
     */
    loadable: boolean;
    /** Why not, when `loadable` is false. Shown on the detail line. */
    note?: string;
}

/** What a store needs to know to write a row it can list back. */
export interface SaveEntryMeta {
    name: string;
    savedAt: number;
    level: number;
    champions: string[];
}

export interface SaveStore {
    readonly kind: SaveStoreKind;
    /** Whether this browser has the APIs at all. */
    isSupported(): boolean;
    /** Whether `list`/`read`/`write` can run right now without asking for anything. */
    isReady(): boolean;
    /**
     * Acquire whatever access is missing. **Must be called from a real user gesture** —
     * `showDirectoryPicker` and `requestPermission` both demand transient activation,
     * and the click that opened this menu is the only activation there is.
     */
    connect(): Promise<boolean>;
    list(): Promise<SaveEntry[]>;
    read(id: string): Promise<Uint8Array>;
    write(meta: SaveEntryMeta, bytes: Uint8Array): Promise<void>;
    /** One short line for the menu: where this store points, or why it cannot. */
    describe(): string;
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

/**
 * The newest loadable entry across several listings, and which listing it came from.
 *
 * This is what the quick-load acts on: "the most recent save" has to mean the most
 * recent one *anywhere*, or F9 would answer differently depending on which source the
 * menu happened to be showing. Entries that cannot be loaded are skipped rather than
 * picked and refused.
 *
 * Pure, and the ordering rule is `sortSaveEntries`'s, so the two cannot drift apart.
 */
export function pickLatestLoadable<T>(
    listings: ReadonlyArray<{ source: T; entries: SaveEntry[] }>,
): { source: T; entry: SaveEntry } | null {
    const all: Array<{ source: T; entry: SaveEntry }> = [];
    for (const listing of listings) {
        for (const entry of listing.entries) {
            if (entry.loadable) all.push({ source: listing.source, entry });
        }
    }
    if (all.length === 0) return null;
    all.sort((a, b) => b.entry.savedAt - a.entry.savedAt || a.entry.name.localeCompare(b.entry.name));
    return all[0];
}

/** Champion names cut to three characters, which is what fits four of them on a row. */
export function abbreviateChampions(champions: string[], width = 3): string {
    return champions
        .slice(0, 4)
        .map((n) => n.trim().toUpperCase().slice(0, width))
        .filter((n) => n.length > 0)
        .join(' ');
}

/**
 * One list row: `2026-09-13 L14 DAR SON LEY ESM`, clipped to the panel's 33 characters.
 * A `.dat` that cannot be loaded is marked with a leading `*`.
 */
export function formatSaveRow(entry: SaveEntry, maxChars = 33): string {
    const mark = entry.loadable ? '' : '*';
    const level = `L${Math.max(0, entry.level | 0)}`;
    const row = `${mark}${formatSaveDate(entry.savedAt)} ${level} ${abbreviateChampions(entry.champions)}`;
    return row.length > maxChars ? row.slice(0, maxChars) : row;
}

/** The detail line above the list: the selected save's full roster. */
export function formatSaveDetail(entry: SaveEntry | null, maxChars = 33): string {
    if (!entry) return '';
    const text = entry.note ?? entry.champions.map((n) => n.trim().toUpperCase()).join(' ');
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** Marks the file as ours, so a stray `.json` in the folder is rejected rather than parsed. */
export const SAVE_PAYLOAD_FORMAT = 'dmweb-save';

/** The suffix a DMweb save carries on disk. */
export const SAVE_FILE_EXTENSION = '.dmweb.json';

/** What a DMweb save says of itself at the front of its file (`SavePayload.header`). */
export interface SaveHeader {
    format: typeof SAVE_PAYLOAD_FORMAT;
    version: number;
    /** `Date.now()` at the moment of the save. */
    savedAt: number;
    /** The dungeon level the party stood on — `position.z`. */
    level: number;
    /** Champion names, in party order. */
    champions: string[];
}

/**
 * Pull the `header` object out of the first few kilobytes of one of our save files.
 *
 * `JSON.stringify` emits keys in insertion order and `SavePayload` declares `header`
 * first, so it is always at the front of the file. Listing a directory therefore reads a
 * 4 KB prefix per save instead of the whole megabyte-plus of `runtime`. The scan is
 * brace-balanced and string-aware so that a champion name full of punctuation could not
 * end the object early.
 */
export function extractHeaderFromPrefix(text: string): unknown | null {
    const key = '"header"';
    const at = text.indexOf(key);
    if (at < 0) return null;
    let i = text.indexOf('{', at + key.length);
    if (i < 0) return null;
    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}
