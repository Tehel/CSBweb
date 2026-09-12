/**
 * The one browser store and the one file store, and which of them is "current".
 *
 * There is exactly one game in a page, so the stores are singletons. They live here
 * rather than inside the menu because two callers need them: the save/load screen, and
 * the quick-save keys. Those two used to be different features writing to different
 * places — F5 had a `localStorage` slot of its own — which meant "the most recent save"
 * meant one thing in the menu and another to F9. They are now the same saves.
 */
import { BrowserSaveStore } from './BrowserSaveStore';
import { FileSaveStore } from './FileSaveStore';
import { pickLatestLoadable, type SaveEntry, type SaveStore, type SaveStoreKind } from './SaveStore';

const browser = new BrowserSaveStore();
const file = new FileSaveStore();

/**
 * Which store the player last chose. Remembered for the session so that reopening the
 * menu, or pressing F5, lands where they left off. Not persisted: the file store's
 * permission is not persisted either, so a reload would start on a source that needs a
 * click before it can do anything.
 */
let currentSource: SaveStoreKind = 'browser';

export function saveStore(kind: SaveStoreKind): SaveStore {
    return kind === 'file' ? file : browser;
}

export function fileSaveStore(): FileSaveStore {
    return file;
}

export function browserSaveStore(): BrowserSaveStore {
    return browser;
}

export function getSaveSource(): SaveStoreKind {
    return currentSource;
}

export function setSaveSource(kind: SaveStoreKind): void {
    currentSource = kind;
}

/**
 * The store a save should be written to right now: the current one if it can actually
 * take a write, otherwise the browser, which always can.
 *
 * The fallback is what keeps the quick-save key usable. Choosing the file source and
 * then pressing F5 must not raise a folder picker over the game — `connect()` needs a
 * user gesture and the player did not ask for a dialog, they asked for a save.
 */
export function writableSaveStore(): SaveStore {
    const current = saveStore(currentSource);
    return current.isReady() ? current : browser;
}

/**
 * The newest loadable save across every store that can be listed without prompting.
 *
 * The file store is given a chance to come back from the handle it remembered —
 * `restore()` never raises a dialog — so a folder chosen earlier in the session still
 * takes part. One that needs a click is simply not consulted.
 */
export async function findLatestSave(): Promise<{ store: SaveStore; entry: SaveEntry } | null> {
    if (file.isSupported() && !file.isReady()) {
        try {
            await file.restore();
        } catch {
            /* a store that cannot come back is simply not consulted */
        }
    }

    const listings: Array<{ source: SaveStore; entries: SaveEntry[] }> = [];
    for (const store of [browser, file]) {
        if (!store.isSupported() || !store.isReady()) continue;
        try {
            listings.push({ source: store, entries: await store.list() });
        } catch {
            /* one unreadable store must not hide the other */
        }
    }

    const best = pickLatestLoadable(listings);
    return best ? { store: best.source, entry: best.entry } : null;
}
