/**
 * The F5/F9 quick-save keys.
 *
 * None of this exists in CSBWin: the original has only the save/load screen behind the
 * disk icon, which we do have (`src/renderer/ui/`, `src/data/saves/`). F5 and F9 are a
 * shortcut onto that screen's stores, kept for their convenience — see PLAN.md Phase 14,
 * where they are recorded as staying. They are *not* debug scaffolding and are not gated
 * on `isDebugFeaturesEnabled()`; the one thing here that still is, is the boot-time
 * restore in `main.ts`.
 */
import { browserSaveStore, findLatestSave, writableSaveStore } from './data/saves';
import {
    SavePayloadError,
    applySaveBytes,
    buildSavePayload,
    decodeSavePayload,
    encodeSavePayload,
    makeSaveFileName,
} from './engine/SaveGamePayload';
import type { Game } from './engine';
import { scrollingText } from './renderer/csbwin/ScrollingText';
import { updateDebug } from './ui';

/** Live handles into `main.ts`; read through getters so reassignment is visible here. */
export interface DevHost {
    readonly game: Game | null;
    renderView(): void;
}

/** Where the quick-save used to live, before F5/F9 joined the save list. */
const LEGACY_QUICK_SAVE_KEY = 'dmweb_savegame_raw_v1';

export interface DevTools {
    /**
     * F5 and F9. Both act on the same saves the disk-icon menu lists: one more save to
     * the current source, and the most recent save from wherever it lives. Async because
     * both stores are, and awaited by nobody — the outcome reaches the player through
     * `updateDebug`.
     */
    quickSave(): void;
    quickLoad(): void;
}

export function createDevTools(host: DevHost): DevTools {
    /**
     * The quick-save used to live under one `localStorage` key of its own. Anything
     * still in it is moved into the browser store once, so a playtest saved before this
     * change is not stranded, and the key is dropped either way — a payload too old to
     * decode was never loadable anyway.
     */
    let legacyMigrated = false;
    async function migrateLegacyQuickSave(): Promise<void> {
        if (legacyMigrated) return;
        legacyMigrated = true;
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(LEGACY_QUICK_SAVE_KEY);
        } catch {
            return;
        }
        if (!raw) return;
        try {
            const payload = decodeSavePayload(new TextEncoder().encode(raw));
            const header = payload.header;
            await browserSaveStore().write(
                {
                    name: makeSaveFileName(header.savedAt),
                    savedAt: header.savedAt,
                    level: header.level,
                    champions: header.champions,
                },
                // Re-encoded rather than stored verbatim: a payload written before the
                // header existed would otherwise be unlistable if it were ever copied to
                // a directory, where the listing reads only the front of the file.
                encodeSavePayload(payload),
            );
            updateDebug('Moved the old quick-save into the save list');
        } catch {
            updateDebug('Discarded an old quick-save this build cannot read');
        }
        try {
            localStorage.removeItem(LEGACY_QUICK_SAVE_KEY);
        } catch {
            /* nothing to clean up */
        }
    }

    // F5 and F9 act on the saves the disk-icon menu lists, not on a slot of their own:
    // quick-save writes one more save to the current source, and quick-load takes the
    // most recent one wherever it lives. The two used to disagree about what "the most
    // recent save" meant.
    async function quickSave(): Promise<void> {
        if (!host.game) return;
        await migrateLegacyQuickSave();
        try {
            const payload = buildSavePayload(host.game);
            // `writableSaveStore` falls back to the browser when the file source is
            // chosen but not connected: F5 must never raise a folder picker over the game.
            const store = writableSaveStore();
            const taken = new Set((await store.list().catch(() => [])).map((e) => e.name));
            await store.write(
                {
                    name: makeSaveFileName(payload.header.savedAt, taken),
                    savedAt: payload.header.savedAt,
                    level: payload.header.level,
                    champions: payload.header.champions,
                },
                encodeSavePayload(payload),
            );
            updateDebug(`Quick-saved (${store.kind === 'file' ? 'disk' : 'browser'})`);
        } catch (error) {
            console.warn('Quick-save failed:', error);
            updateDebug('Quick-save failed (see console)');
        }
    }

    async function quickLoad(): Promise<void> {
        if (!host.game) return;
        await migrateLegacyQuickSave();
        try {
            const latest = await findLatestSave();
            if (!latest) {
                updateDebug('No saved game found');
                return;
            }
            // Older formats are refused, not upgraded. A v1 save has no world state in it
            // at all, so restoring one would put the party back into a dungeon reset to
            // `dungeon.dat`; a v2 save has champions whose attributes are flat numbers
            // with no maximum or minimum to restore.
            applySaveBytes(host.game, await latest.store.read(latest.entry.id));
            // Message timeouts are game-tick based, so a load that moves the clock would
            // leave rows that expire at the wrong time (or never). CSBWin serializes the
            // text area (doc/CSBwin-src/Data.h:1666); until we do, discard it. See
            // PLAN.md Phase 11.
            scrollingText.discardText();
            host.renderView();
            updateDebug(`Quick-loaded ${latest.entry.name}`);
        } catch (error) {
            if (error instanceof SavePayloadError) {
                updateDebug(error.message);
                return;
            }
            console.warn('Failed to quick-load:', error);
            updateDebug('Quick-load failed (see console)');
        }
    }

    return {
        quickSave,
        quickLoad,
    };
}
