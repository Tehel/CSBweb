/**
 * The running game's saves: where a save is built from the game and written to the store,
 * and where a save's bytes are read back into it.
 *
 * The file itself is `SaveGameFile.ts`'s to write and `CsbwinSaveGame.ts`'s to read: a
 * save is a CSBWin file. This is what calls them for the page: the disk menu's SAVE and LOAD
 * (`src/renderer/ui/SaveMenu.ts`), the boot's chooser (`src/renderer/intro/BootSequence.ts`),
 * and the F5 and F9 keys.
 *
 * The store (`src/data/saves/`) holds every data set's saves, each row naming its own, and
 * the game's are its data set's: what the menu and the chooser list, and what F9 picks
 * from.
 *
 * F5 and F9 do not exist in CSBWin, which has only the disk menu. They are a shortcut onto
 * that menu's list: one more save, marked as the key's, and the most recent save of the
 * list. Neither raises a dialog, so what either did, or why it did nothing, is a line in
 * the message area, and one for the console with the save's name.
 */
import { CsbRandom } from '../core/random';
import type { DataSet } from '../data/DataSets';
import {
    SAVE_FILE_EXTENSION, joinedPlaythrough, readSaveFileFields,
    type OpenedSave, type SaveEntry, type SaveStore,
} from '../data/saves';
import type { Game } from './Game';
import { drawRandomGameID } from './GameContext';
import { SaveFileError, applySaveBytes, buildSaveFile } from './SaveGameFile';
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
     * writer: the screen's, since only it holds graphic 26 (`SaveFileOptions`).
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

/** The colour of F5's and F9's lines in the message area: white, as a wall's text is. */
const SAVE_MESSAGE_COLOR = 15;

/**
 * The name a new save gets. CSBWin has four fixed filenames and rotates a `.BAK`
 * (`doc/CSBwin-src/CSBCode.cpp:9744-9761`); this port saves as often as asked, so the
 * name has to be unique instead, among `taken`. Sortable, and readable as a file's name.
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

/**
 * A playthrough for a game loaded from a file that names none: drawn as a new game
 * draws its own (`drawRandomGameID`), and never 0, which names none. The stream is
 * this draw's own. The game's is the file's by then (`gb2.ranseed`), so it would give
 * every load of one file the same id, and a load would leave it two draws further on
 * than CSBWin's does.
 */
function drawPlaythrough(): number {
    const random = new CsbRandom();
    for (;;) {
        const id = drawRandomGameID(random);
        if (id !== 0) return id;
    }
}

export class GameSaves {
    /** Set by `read` and `readFailed`, read and cleared by `consumeSavedGameRead`. */
    private lastRead: SavedGameRead = 'cancelled';

    constructor(
        private readonly game: Game,
        /** The game the page plays, whose files the running game was read from. */
        readonly dataSet: DataSet,
        /** Where the saves are kept, every data set's. */
        private readonly store: SaveStore,
        private readonly screen: GameSavesScreen,
        /**
         * A line for the console on what F5 or F9 did, with the error when one failed:
         * the message area says only that it did.
         */
        private readonly log: (message: string, error?: unknown) => void,
    ) {}

    /**
     * A line in the message area on what F5 or F9 did. Both keys are awaited by nobody,
     * so this is where their outcome goes.
     */
    private tell(text: string): void {
        const { messages } = this.game.ctx.host;
        messages.printLinefeed();
        messages.quePrintLines(SAVE_MESSAGE_COLOR, text);
    }

    /** The data set's saves, newest first: the disk menu's list, and the boot's chooser's. */
    list(): Promise<SaveEntry[]> {
        return this.store.list(this.dataSet.id);
    }

    /**
     * A listed save out of the store, to be read into the game (`read`). A row that
     * names no playthrough is looked up among its data set's saves here, while the
     * store can still be awaited (`joinedPlaythrough`).
     */
    async open(entry: SaveEntry): Promise<OpenedSave> {
        const bytes = await this.store.read(entry.id);
        const joins = entry.playthrough === 0
            ? joinedPlaythrough(entry, await this.store.list(entry.dataSet))
            : 0;
        return { bytes, joins };
    }

    /**
     * Build a save and write it to the store, as a row of the game's data set under a
     * name no save there has, in any set: a row's name is its key. `quick` marks F5's.
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
     * write, on the world the file holds, not once the write comes back: a failed
     * write keeps the re-attached monsters.
     *
     * The file's bytes are made at once, before anything is awaited: the game runs on
     * through the listing. The row beside them is read back from the file's own blocks,
     * the playthrough from `GAMEBLOCK1`, the level from `GAMEBLOCK2` and the names from
     * block 4 (`readSaveFileFields`); the date is the row's, since a CSBWin file has none.
     */
    async save(clock: SaveClock, quick: boolean): Promise<SaveEntry> {
        if (clock === 'running') this.screen.repackOpenChest();
        const bytes = buildSaveFile(this.game, {
            portraitOf: (champion) => this.screen.portraitOf(champion),
        });
        const savedAt = Date.now();
        const fields = readSaveFileFields(bytes);
        if (!fields) throw new Error('the save file does not read back');
        if (clock === 'running') this.game.saveWritten();
        const taken = new Set((await this.store.list(null)).map((entry) => entry.name));
        const name = makeSaveFileName(savedAt, taken);
        const entry: SaveEntry = { id: name, name, dataSet: this.dataSet.id, quick, savedAt, ...fields };
        await this.store.write(entry, bytes);
        if (clock === 'stopped') this.game.saveWritten();
        return entry;
    }

    /**
     * Restore an opened save into the running game, one of the port's saves or a genuine
     * CSBWin one (`applySaveBytes`). Throws `SaveFileError`, whose message is a line
     * for the menu's status.
     *
     * A file whose `RandomGameID` is 0 names no playthrough, so its game is given one
     * here, which its saves then carry: the one the save joins (`OpenedSave.joins`), or
     * a new one (`drawPlaythrough`). CSBWin takes the file's id as it is
     * (`doc/CSBwin-src/SaveGame.cpp:1610`), and so does this for any other id.
     *
     * The entrance's Resume needs to know whether a save came back: CSBWin loops on
     * `ReadEntireGame`'s result and shows the door again when it did not
     * (`doc/CSBwin-src/CSBCode.cpp:10634-10641`).
     */
    read(save: OpenedSave): void {
        applySaveBytes(this.game, save.bytes);
        const { block1 } = this.game.ctx.state;
        if (block1.randomGameID === 0) block1.randomGameID = save.joins || drawPlaythrough();
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

    /**
     * F5: one more save, marked as the key's. Not with an empty party, nor while a
     * champion is still being chosen: the disk icon does nothing then
     * (`doc/CSBwin-src/Mouse.cpp:1716-1718`), and a file has no place for
     * `d.PotentialCharacterOrdinal`, so the candidate would load as a member. Nor while a
     * script holds the loop, which a save could not resume. The icon is silent then; a
     * key that saved nothing says so.
     *
     * A write that fails is `SaveError`'s "UNABLE TO SAVE GAME!"
     * (`doc/CSBwin-src/SaveGame.cpp:1266`).
     */
    async quickSave(): Promise<void> {
        const { champions, potentialChampionIndex } = this.game.ctx.party.state;
        if (champions.length === 0 || potentialChampionIndex >= 0 || this.game.isRunningScript()) {
            this.tell('CANNOT SAVE NOW');
            this.log('Quick-save refused: no party, a champion being chosen, or a script running');
            return;
        }
        try {
            const { name } = await this.save('running', true);
            this.tell('GAME SAVED');
            this.log(`Quick-saved ${name}`);
        } catch (error) {
            this.tell('UNABLE TO SAVE GAME!');
            this.log('Quick-save failed', error);
        }
    }

    /**
     * F9: the most recent save of the data set, F5's or the menu's. Not while a script
     * holds the loop: it would run on in the loaded world.
     *
     * No save at all is `_ReadEntireGame`'s "CAN'T FIND SAVED GAME!"
     * (`doc/CSBwin-src/SaveGame.cpp:1585`), and a file that does not read is its
     * `SaveFileError`'s line, the one the disk menu shows.
     */
    async quickLoad(): Promise<void> {
        if (this.game.isRunningScript()) {
            this.tell('CANNOT LOAD NOW');
            this.log('Quick-load refused: a script running');
            return;
        }
        try {
            const [latest] = await this.list();
            if (!latest) {
                this.tell('CAN\'T FIND SAVED GAME!');
                this.log('Quick-load: no saved game found');
                return;
            }
            this.read(await this.open(latest));
            this.tell('GAME LOADED');
            this.log(`Quick-loaded ${latest.name}`);
        } catch (error) {
            this.tell(error instanceof SaveFileError ? error.message : 'UNABLE TO LOAD GAME!');
            this.log('Quick-load failed', error);
        }
    }
}
