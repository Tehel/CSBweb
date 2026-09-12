/**
 * Saves kept in a real directory on the player's disk, through the File System Access
 * API.
 *
 * What the browser actually allows, measured rather than assumed:
 *
 * - **Only Chromium has it.** `showDirectoryPicker` is absent in Firefox and Safari;
 *   `isSupported()` is the whole of the feature test, and the menu says so plainly
 *   rather than failing silently.
 * - **There is no path access.** A page cannot open `~/dm-saves` by name, and it cannot
 *   create it either: `getDirectoryHandle(name, {create:true})` only makes directories
 *   *inside* a handle that was already granted. So the player picks the folder once, in
 *   the operating system's own dialog.
 * - **The handle is remembered, the permission is not.** A `FileSystemDirectoryHandle`
 *   is structured-cloneable, so it goes into IndexedDB and the pick never has to happen
 *   again; but Chrome drops the grant when the page reloads, and asks again with one
 *   click (`queryPermission` -> `requestPermission`).
 * - **Both calls need transient user activation**, which is why `connect()` is
 *   documented as gesture-only and why `SaveMenu` routes the click that needs it
 *   straight out of the DOM event instead of through the game's mouse queue.
 *
 * The directory is listed, not just written to: our own `*.dmweb.json` saves and any
 * genuine CSBWin `csbgame*.dat` sitting beside them both become rows.
 */
import { readCsbwinSaveInfo } from '../CsbwinSaveInfo';
import { SAVE_FILE_EXTENSION, type SaveHeader } from '../../engine/SaveGamePayload';
import { HANDLES_STORE, idbDelete, idbGet, idbPut } from './idb';
import {
    extractHeaderFromPrefix,
    sortSaveEntries,
    type SaveEntry,
    type SaveEntryMeta,
    type SaveStore,
} from './SaveStore';

const DIRECTORY_KEY = 'saveDirectory';

/** How much of one of our saves has to be read to find its header. */
const HEADER_PREFIX_BYTES = 8192;

interface FsPermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

interface FsHandleLike {
    kind: 'file' | 'directory';
    name: string;
    queryPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
}

interface FsWritableLike {
    write(data: Uint8Array | Blob | string): Promise<void>;
    close(): Promise<void>;
}

interface FsFileHandleLike extends FsHandleLike {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(): Promise<FsWritableLike>;
}

interface FsDirectoryHandleLike extends FsHandleLike {
    kind: 'directory';
    values(): AsyncIterableIterator<FsHandleLike>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandleLike>;
}

type DirectoryPicker = (options?: {
    mode?: 'read' | 'readwrite';
    id?: string;
    startIn?: string;
}) => Promise<FsDirectoryHandleLike>;

function directoryPicker(): DirectoryPicker | null {
    if (typeof window === 'undefined') return null;
    const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    return typeof picker === 'function' ? picker.bind(window) : null;
}

/** The `:Zone.Identifier` files are Windows alternate-data-stream droppings, not saves. */
function isCsbwinSave(name: string): boolean {
    return name.toLowerCase().endsWith('.dat') && !name.includes(':');
}

function isDmwebSave(name: string): boolean {
    return name.toLowerCase().endsWith(SAVE_FILE_EXTENSION);
}

export class FileSaveStore implements SaveStore {
    readonly kind = 'file' as const;

    private handle: FsDirectoryHandleLike | null = null;
    private granted = false;
    private status = '';

    isSupported(): boolean {
        return directoryPicker() !== null;
    }

    isReady(): boolean {
        return this.handle !== null && this.granted;
    }

    describe(): string {
        if (!this.isSupported()) return 'NEEDS A CHROMIUM BROWSER';
        if (this.status) return this.status;
        if (this.isReady()) return `FOLDER: ${this.handle?.name ?? '?'}`;
        return 'NO FOLDER CHOSEN YET';
    }

    /** The remembered handle, if the player has ever picked one. Never prompts. */
    async restore(): Promise<boolean> {
        if (!this.isSupported()) return false;
        if (this.handle) return this.isReady();
        try {
            const stored = await idbGet<FsDirectoryHandleLike>(HANDLES_STORE, DIRECTORY_KEY);
            if (!stored) return false;
            this.handle = stored;
            const state = (await stored.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
            this.granted = state === 'granted';
            if (!this.granted) this.status = `ALLOW ACCESS TO ${stored.name.toUpperCase()}`;
            return this.granted;
        } catch {
            return false;
        }
    }

    /**
     * Get to a usable directory, asking the player for as little as possible: first the
     * remembered handle, then a permission prompt on it, and only then the folder
     * picker. **Call this from a real user gesture** — both prompts need transient
     * activation and neither will appear without it.
     */
    async connect(): Promise<boolean> {
        const picker = directoryPicker();
        if (!picker) {
            this.status = 'NEEDS A CHROMIUM BROWSER';
            return false;
        }
        if (await this.restore()) return true;

        if (this.handle && this.handle.requestPermission) {
            try {
                const state = await this.handle.requestPermission({ mode: 'readwrite' });
                if (state === 'granted') {
                    this.granted = true;
                    this.status = '';
                    return true;
                }
            } catch {
                /* fall through to the picker */
            }
        }

        try {
            const handle = await picker({ mode: 'readwrite', id: 'dmweb-saves', startIn: 'documents' });
            this.handle = handle;
            this.granted = true;
            this.status = '';
            await idbPut(HANDLES_STORE, handle, DIRECTORY_KEY);
            return true;
        } catch {
            // An abort is the player closing the dialog, not an error worth shouting about.
            this.status = 'NO FOLDER CHOSEN';
            return false;
        }
    }

    /** Forget the remembered folder, so the next connect asks again. */
    async forget(): Promise<void> {
        this.handle = null;
        this.granted = false;
        this.status = '';
        try {
            await idbDelete(HANDLES_STORE, DIRECTORY_KEY);
        } catch {
            /* nothing to forget */
        }
    }

    async list(): Promise<SaveEntry[]> {
        const dir = this.requireDirectory();
        const entries: SaveEntry[] = [];
        for await (const child of dir.values()) {
            if (child.kind !== 'file') continue;
            const name = child.name;
            if (!isDmwebSave(name) && !isCsbwinSave(name)) continue;
            try {
                const file = await (child as FsFileHandleLike).getFile();
                const entry = isDmwebSave(name)
                    ? await readDmwebEntry(file, name)
                    : await readCsbwinEntry(file, name);
                if (entry) entries.push(entry);
            } catch {
                // One unreadable file must not blank the whole list.
            }
        }
        return sortSaveEntries(entries);
    }

    async read(id: string): Promise<Uint8Array> {
        const dir = this.requireDirectory();
        const handle = await dir.getFileHandle(id);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }

    async write(meta: SaveEntryMeta, bytes: Uint8Array): Promise<void> {
        const dir = this.requireDirectory();
        const handle = await dir.getFileHandle(meta.name, { create: true });
        const writable = await handle.createWritable();
        try {
            await writable.write(bytes);
        } finally {
            await writable.close();
        }
    }

    private requireDirectory(): FsDirectoryHandleLike {
        if (!this.handle || !this.granted) throw new Error('NO FOLDER CHOSEN');
        return this.handle;
    }
}

/**
 * One of our own saves. Only the first 8 KB is read: `SavePayload` declares `header`
 * first and `JSON.stringify` keeps insertion order, so the listing never has to pull a
 * megabyte of `runtime` off disk.
 */
async function readDmwebEntry(file: File, name: string): Promise<SaveEntry | null> {
    const prefix = await file.slice(0, HEADER_PREFIX_BYTES).text();
    const header = extractHeaderFromPrefix(prefix) as SaveHeader | null;
    return {
        id: name,
        name,
        // The header is what the game meant; `lastModified` is what the filesystem saw.
        // Prefer the header, because copying a file changes the second and not the first.
        savedAt: typeof header?.savedAt === 'number' ? header.savedAt : file.lastModified,
        level: typeof header?.level === 'number' ? header.level : 0,
        champions: Array.isArray(header?.champions) ? header.champions : [],
        loadable: true,
    };
}

/**
 * A genuine CSBWin save. The level and roster come out of blocks 2 and 4, which read
 * fine; the date has to come from the filesystem, because a CSBWin save carries no
 * wall-clock time at all — only `gb2.Time`, the virtual clock.
 */
async function readCsbwinEntry(file: File, name: string): Promise<SaveEntry | null> {
    const info = readCsbwinSaveInfo(new Uint8Array(await file.arrayBuffer()));
    if (!info) return null;
    return {
        id: name,
        name,
        savedAt: file.lastModified,
        level: info.level,
        champions: info.champions,
        loadable: false,
        note: 'CSBWIN SAVE — NOT READABLE YET',
    };
}
