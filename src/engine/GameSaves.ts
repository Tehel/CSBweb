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
 * the game's are its data set's: what the menu and the chooser list. Among them, those of
 * the game's playthrough (`d.RandomGameID`) are what F5 and F9 work on.
 *
 * F5 and F9 do not exist in CSBWin, which has only the disk menu. F5 writes the
 * playthrough's quick-save, one slot written over at each press, and never a save the
 * menu made or wrote over; F9 loads the playthrough's newest save, the slot or the menu's. Neither
 * raises a dialog, so what either did, or why it did nothing, is a line in the message
 * area, and one for the console with the save's name.
 */
import { CsbRandom } from '../core/random';
import type { DataSet } from '../data/DataSets';
import {
    SAVE_FILE_EXTENSION, joinedPlaythrough, quickSlot, readSaveFileFields,
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

/**
 * Where a save is written: a row of its own, F5's slot, or over a listed save, the one
 * selected in the disk menu.
 */
export type SaveTarget = 'new' | 'quick' | SaveEntry;

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
 * A playthrough that is no save's among `rows`: drawn as a new game draws its own
 * (`drawRandomGameID`, never 0), and again while a row holds the id. Two games draw the
 * same id about once in 16 million pairs, and two playthroughs of one data set that
 * shared it would share F5's slot, F9's choice and the menu's question (`PLAN.md` →
 * Phase 10, "A playthrough").
 */
export function drawPlaythrough(random: CsbRandom, rows: SaveEntry[]): number {
    for (;;) {
        const id = drawRandomGameID(random);
        if (!rows.some((row) => row.playthrough === id)) return id;
    }
}

export class GameSaves {
    /** Set by `read` and `readFailed`, read and cleared by `consumeSavedGameRead`. */
    private lastRead: SavedGameRead = 'cancelled';
    /**
     * The write behind the last `read`, which marks its save as used. `read` cannot
     * await it, so the next listing and the next save do: a save written over the row
     * meanwhile would be lost to it in a store that reads the row to write it back.
     */
    private marked: Promise<void> = Promise.resolve();

    constructor(
        private readonly game: Game,
        /** The game the page plays, whose files the running game was read from. */
        readonly dataSet: DataSet,
        /** Where the saves are kept, every data set's. */
        private readonly store: SaveStore,
        private readonly screen: GameSavesScreen,
        /**
         * A line for the console on what F5 or F9 did, with the error when one failed:
         * the message area says only that it did. And on a store that could not be
         * listed for a new game, or written to mark a loaded save as used.
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
    async list(): Promise<SaveEntry[]> {
        await this.marked;
        return this.store.list(this.dataSet.id);
    }

    /**
     * A new game has been read (`Game.readNewGame`), which drew its `d.RandomGameID`
     * with no store at hand: it is drawn again, from the game's stream, while a save of
     * the data set holds it (`drawPlaythrough`). The page awaits this before the game
     * runs, so the stream is the new game's, two draws on for each id refused.
     *
     * A store that cannot be listed leaves the id as drawn: the game is no less new.
     */
    async newGameRead(): Promise<void> {
        const { block1 } = this.game.ctx.state;
        try {
            const rows = await this.list();
            if (rows.some((row) => row.playthrough === block1.randomGameID)) {
                block1.randomGameID = drawPlaythrough(this.game.ctx.random, rows);
            }
        } catch (error) {
            this.log('New game: the saves could not be listed', error);
        }
    }

    /**
     * A listed save out of the store, to be read into the game (`read`). A row that
     * names no playthrough is given one here, while the store can still be awaited: the
     * one it joins among its data set's saves (`joinedPlaythrough`), or one that none of
     * them holds (`drawPlaythrough`), from a stream of this draw's own. The game's is
     * the file's once it is read (`gb2.ranseed`), so it would give every load of one
     * file the same id, and a load would leave it two draws further on than CSBWin's
     * does.
     */
    async open(entry: SaveEntry): Promise<OpenedSave> {
        const bytes = await this.store.read(entry.id);
        if (entry.playthrough !== 0) return { entry, bytes, joins: 0 };
        const rows = await this.store.list(entry.dataSet);
        return { entry, bytes, joins: joinedPlaythrough(entry, rows) || drawPlaythrough(new CsbRandom(), rows) };
    }

    /**
     * Build a save and write it to the store, as a row of the game's data set. A `'new'`
     * one is a row of its own, under a name no save has in any set: a row's name is its
     * key. F5's (`'quick'`) is written over the playthrough's slot (`quickSlot`), which
     * keeps its key and its name and takes the new file and its date; the first press
     * makes the slot, as a new row. The menu's SAVE over a listed save does the same to
     * that row, whatever game it held: it is the game's playthrough's from then on, and
     * the menu's, so a quick-save written over is F5's slot no longer and the next press
     * makes another.
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
     * block 4 (`readSaveFileFields`); the date is the row's, since a CSBWin file has none,
     * and is when the save was last used too (`SaveEntry.usedAt`).
     */
    async save(clock: SaveClock, target: SaveTarget): Promise<SaveEntry> {
        if (clock === 'running') this.screen.repackOpenChest();
        const bytes = buildSaveFile(this.game, {
            portraitOf: (champion) => this.screen.portraitOf(champion),
        });
        const savedAt = Date.now();
        const fields = readSaveFileFields(bytes);
        if (!fields) throw new Error('the save file does not read back');
        if (clock === 'running') this.game.saveWritten();
        await this.marked;
        const quick = target === 'quick';
        const rows = typeof target === 'string' ? await this.store.list(null) : [];
        const over = typeof target !== 'string' ? target
            : quick ? quickSlot(rows, this.dataSet.id, fields.playthrough) : undefined;
        const name = over ? over.name : makeSaveFileName(savedAt, new Set(rows.map((row) => row.name)));
        const id = over ? over.id : name;
        const entry: SaveEntry = { id, name, dataSet: this.dataSet.id, quick, savedAt, usedAt: savedAt, ...fields };
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
     * here, which its saves then carry: the one `open` found for it
     * (`OpenedSave.joins`). CSBWin takes the file's id as it is
     * (`doc/CSBwin-src/SaveGame.cpp:1610`), and so does this for any other id.
     *
     * The entrance's Resume needs to know whether a save came back: CSBWin loops on
     * `ReadEntireGame`'s result and shows the door again when it did not
     * (`doc/CSBwin-src/CSBCode.cpp:10634-10641`).
     *
     * A save that read is the last one used from then on: its row takes the time
     * (`SaveEntry.usedAt`) and keeps the rest. One that did not read is left as it was.
     */
    read(save: OpenedSave): void {
        applySaveBytes(this.game, save.bytes);
        const { block1 } = this.game.ctx.state;
        if (block1.randomGameID === 0) block1.randomGameID = save.joins;
        this.lastRead = 'loaded';
        this.marked = this.store.markUsed(save.entry.id, Date.now())
            .catch((error) => this.log(`${save.entry.name} could not be marked as the last save used`, error));
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
     * F5: the playthrough's quick-save, written over the last. Not with an empty party,
     * nor while a champion is still being chosen: the disk icon does nothing then
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
            const { name } = await this.save('running', 'quick');
            this.tell('GAME SAVED');
            this.log(`Quick-saved ${name}`);
        } catch (error) {
            this.tell('UNABLE TO SAVE GAME!');
            this.log('Quick-save failed', error);
        }
    }

    /**
     * F9: the newest save of the game's playthrough, F5's or the menu's. Not while a
     * script holds the loop: it would run on in the loaded world.
     *
     * A playthrough with no save is `_ReadEntireGame`'s "CAN'T FIND SAVED GAME!"
     * (`doc/CSBwin-src/SaveGame.cpp:1585`), whatever the data set's other playthroughs
     * hold: a new game not saved yet, or a game loaded from a file that names no
     * playthrough, which is no save of the one the load gave it. A file that does not
     * read is its `SaveFileError`'s line, the one the disk menu shows.
     */
    async quickLoad(): Promise<void> {
        if (this.game.isRunningScript()) {
            this.tell('CANNOT LOAD NOW');
            this.log('Quick-load refused: a script running');
            return;
        }
        try {
            const playthrough = this.game.ctx.state.block1.randomGameID;
            const latest = (await this.list()).find((entry) => entry.playthrough === playthrough);
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
