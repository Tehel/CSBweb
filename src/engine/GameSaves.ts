/**
 * The running game's saves: where a save is built from the game and written to a store,
 * and where a store's bytes are read back into it.
 *
 * The file itself is `SaveGamePayload.ts`'s, and a genuine CSBWin one `CsbwinSaveGame.ts`'s.
 * This is what calls them for the page: the disk menu's SAVE and LOAD
 * (`src/renderer/ui/SaveMenu.ts`), the boot's chooser (`src/renderer/intro/BootSequence.ts`),
 * and the F5 and F9 keys.
 *
 * F5 and F9 do not exist in CSBWin, which has only the disk menu. They are a shortcut onto
 * that menu's stores (`src/data/saves/`): one more save to the current source, and the
 * most recent save from wherever it lives, so both mean the same "most recent save".
 */
import type { DataSet } from '../data/DataSets';
import {
    SAVE_FILE_EXTENSION,
    findLatestSave,
    writableSaveStore,
    type SaveEntryMeta,
    type SaveStore,
} from '../data/saves';
import type { Game } from './Game';
import { SavePayloadError, applySaveBytes, buildSavePayload, encodeSavePayload } from './SaveGamePayload';
import type { Champion } from './gameTypes';

/**
 * How `_ReadEntireGame` came out on the chooser's path: 1 once a save is in, -1 when the
 * chooser was cancelled (`tag01ec56`, `doc/CSBwin-src/SaveGame.cpp:1556-1559`), or a
 * failed read, which ends at `tag01efee` (`:1895`).
 */
export type SavedGameRead = 'loaded' | 'cancelled' | 'damaged';

/** The two things a save needs that only the screen has. */
export interface GameSavesScreen {
    /**
     * The portrait pixels of a champion carrying only `portraitGraphic`, for the save
     * writer: the screen's, since only it holds graphic 26 (`SavePayloadOptions`).
     */
    portraitOf(champion: Champion): number[] | undefined;
    /** `RepackChest` (`doc/CSBwin-src/Character.cpp:3108`), the screen's open chest. */
    repackOpenChest(): void;
}

/**
 * Whether the game runs on while a save is written. The disk menu has stopped the clock
 * and repacked an open chest (`TAG02076e`, `doc/CSBwin-src/Character.cpp:5116-5125`); F5
 * has done neither.
 */
export type SaveClock = 'running' | 'stopped';

/**
 * The name a new save gets. CSBWin has four fixed filenames and rotates a `.BAK`
 * (`doc/CSBwin-src/CSBCode.cpp:9744-9761`); this port saves as often as asked, so the
 * name has to be unique instead, among `taken`. Sortable, and readable in a file manager.
 */
export function makeSaveFileName(savedAt: number, taken: ReadonlySet<string> = new Set()): string {
    const d = new Date(savedAt);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const stem =
        `dmweb-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let name = `${stem}${SAVE_FILE_EXTENSION}`;
    let n = 2;
    while (taken.has(name)) name = `${stem}-${n++}${SAVE_FILE_EXTENSION}`;
    return name;
}

export class GameSaves {
    /** Set by `read` and `readFailed`, read and cleared by `consumeSavedGameRead`. */
    private lastRead: SavedGameRead = 'cancelled';

    constructor(
        private readonly game: Game,
        /** The game the page plays, whose files the running game was read from. */
        readonly dataSet: DataSet,
        private readonly screen: GameSavesScreen,
        /**
         * A line for the player on what F5 or F9 did, with the error when one failed.
         * Both keys are awaited by nobody, so this is the only place their outcome goes.
         */
        private readonly report: (message: string, error?: unknown) => void,
    ) {}

    /**
     * Build a save and write it to `store`, under a name no save there has. `taken` is
     * the names the store holds, for a caller that has listed it; without it the store
     * is listed here.
     *
     * With the clock stopped, the save's tail (`Game.saveWritten`) runs once the file is
     * written, and a write that fails skips it, as CSBWin's `SaveError` jumps past it
     * (`doc/CSBwin-src/SaveGame.cpp:1264`).
     *
     * With the clock running, an open chest's objects are out of its chain
     * (`doc/PROVEN_FACTS.md` → "The disk menu saves an open chest packed"), so it is
     * repacked first, as the disk menu's `TAG02076e` repacks it, and the inventory's next
     * draw opens it again, as after the menu's `TAG0207cc`. The rest of the pair, the
     * shading and the cursor, would last no frame here. And the tail runs before the
     * write, on the world the payload holds, not once the write comes back: a failed
     * write keeps the re-attached monsters.
     *
     * The file's bytes are made at once, before anything is awaited: the payload's
     * `runtime.party` is the live party (`getRuntimeSaveState`), which a game running on
     * through the listing would move on from the dungeon saved beside it.
     */
    async save(store: SaveStore, clock: SaveClock, taken?: ReadonlySet<string>): Promise<SaveEntryMeta> {
        if (clock === 'running') this.screen.repackOpenChest();
        const payload = buildSavePayload(this.game, {
            portraitOf: (champion) => this.screen.portraitOf(champion),
        });
        const bytes = encodeSavePayload(payload);
        if (clock === 'running') this.game.saveWritten();
        const names = taken ?? new Set((await store.list().catch(() => [])).map((entry) => entry.name));
        const { savedAt, level, champions } = payload.header;
        const meta: SaveEntryMeta = { name: makeSaveFileName(savedAt, names), savedAt, level, champions };
        await store.write(meta, bytes);
        if (clock === 'stopped') this.game.saveWritten();
        return meta;
    }

    /**
     * Restore a store's bytes into the running game, one of the port's saves or a genuine
     * CSBWin one (`applySaveBytes`). Throws `SavePayloadError`, whose message is a line
     * for the menu's status.
     *
     * The entrance's Resume needs to know whether a save came back: CSBWin loops on
     * `ReadEntireGame`'s result and shows the door again when it did not
     * (`doc/CSBwin-src/CSBCode.cpp:10634-10641`).
     */
    read(bytes: Uint8Array): void {
        applySaveBytes(this.game, bytes);
        this.lastRead = 'loaded';
    }

    /** The boot's chooser only: its `read` threw, and `tag01efee` follows. */
    readFailed(): void {
        this.lastRead = 'damaged';
    }

    /** How the chooser's last read came out, and forget it. */
    consumeSavedGameRead(): SavedGameRead {
        const read = this.lastRead;
        this.lastRead = 'cancelled';
        return read;
    }

    /** F5: one more save to the current source. */
    async quickSave(): Promise<void> {
        try {
            // `writableSaveStore` falls back to the browser when the file source is
            // chosen but not connected: F5 must never raise a folder picker over the game.
            const store = writableSaveStore();
            await this.save(store, 'running');
            this.report(`Quick-saved (${store.kind === 'file' ? 'disk' : 'browser'})`);
        } catch (error) {
            this.report('Quick-save failed', error);
        }
    }

    /** F9: the most recent save, from wherever it lives. */
    async quickLoad(): Promise<void> {
        try {
            const latest = await findLatestSave();
            if (!latest) {
                this.report('No saved game found');
                return;
            }
            this.read(await latest.store.read(latest.entry.id));
            this.report(`Quick-loaded ${latest.entry.name}`);
        } catch (error) {
            if (error instanceof SavePayloadError) this.report(error.message);
            else this.report('Quick-load failed', error);
        }
    }
}
