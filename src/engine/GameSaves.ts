/**
 * The running game's saves: where a save is built from the game and written to the store,
 * and where a save's bytes are read back into it.
 *
 * The file itself is `SaveGameFile.ts`'s to write and `CsbwinSaveGame.ts`'s to read: a
 * save is a CSBWin file. This is what calls them for the page: the disk menu's SAVE and LOAD
 * (`src/renderer/ui/SaveMenu.ts`), the boot's chooser (`src/renderer/intro/BootSequence.ts`),
 * the F5 and F9 keys, and the Sleepsave.
 *
 * The store (`src/data/saves/`) holds every data set's saves, each row naming its own, and
 * the game's are its data set's: what the menu and the chooser list. Among them, those of
 * the game's playthrough (`d.RandomGameID`) are what F5, F9 and the Sleepsave work on.
 *
 * F5 and F9 do not exist in CSBWin, which has only the disk menu. F5 writes the
 * playthrough's quick-save, one slot written over at each press, and never a save the
 * menu made or wrote over; F9 loads the playthrough's newest save, the slot or the menu's. Neither
 * raises a dialog, so what either did, or why it did nothing, is a line in the message
 * area, and one for the console with the save's name.
 *
 * The Sleepsave does not exist in CSBWin either: the playthrough's slot of its own,
 * written when the party lies down and written over when the player wakes it, never
 * when a blow does (`sleepSave`). It is silent: what it did is a line for the console
 * alone.
 *
 * A file from outside, CSBWin's or another browser's export, comes into the store through
 * `importSave`, once its dungeon has been held against the data set's
 * (`src/data/DungeonSignature.ts`). CSBWin has no such thing: a file put in the game's
 * directory under one of its four names is a save of that game.
 */
import { CsbRandom } from '../core/random';
import { loadCsbwinWorld } from '../data/CsbwinDungeonImage';
import type { DataSet } from '../data/DataSets';
import { checkDungeon, dungeonSignature, type DungeonCheck } from '../data/DungeonSignature';
import { stampRandomGameID } from '../data/SaveGameLoader';
import {
    SAVE_FILE_EXTENSION, joinedPlaythrough, readSaveFileFields, slotOf,
    type OpenedSave, type SaveEntry, type SaveSlot, type SaveStore,
} from '../data/saves';
import { UtilityDiskMessages, UtilityError, makeNewAdventure } from './Chaos';
import type { Game } from './Game';
import { drawRandomGameID } from './GameContext';
import { SaveFileError, applySaveBytes, buildSaveFile } from './SaveGameFile';
import type { Champion } from './gameTypes';

/**
 * How `_ReadEntireGame` came out on the chooser's path: 1 once a save is in, -1 when the
 * chooser was cancelled (`tag01ec56`, `doc/CSBwin-src/SaveGame.cpp:1681-1684`), or a
 * failed read, which ends at `tag01efee` (`:2098`). On RISE's, a new adventure that
 * `makeNewAdventure` refused, with the `UtilityDiskMessages` text it threw.
 */
export type SavedGameRead = 'loaded' | 'cancelled' | 'damaged' | { refused: string };

/** What a new adventure's row has after its source's name (`GameSaves.makeNewAdventure`). */
export const ADVENTURE_SUFFIX = '-csb';

/**
 * `d.Word22592` of a game CSB's prison began, the compressed `dungeon.dat`'s word 6; a
 * new adventure's is 13 (`doc/PROVEN_FACTS.md` → "A compressed `dungeon.dat`: CSB's
 * prison").
 */
export const PRISON_WORD22592 = 12;

/** What a save needs that only the screen has, and the prison's question, which is the screen's. */
export interface GameSavesScreen {
    /**
     * The portrait pixels of a champion carrying only `portraitGraphic`, for the save
     * writer: the screen's, since only it holds graphic 26 (`SaveFileOptions`).
     */
    portraitOf(champion: Champion): number[] | undefined;
    /** `RepackChest` (`doc/CSBwin-src/Character.cpp:3113`), the screen's open chest. */
    repackOpenChest(): void;
    /**
     * Ask "BEGIN THE ADVENTURE?" in the prison (`GameSaves.inPrison`), YES making the new
     * adventure from `source`, or from a quick-save made first when it is `null`
     * (`askBeginAdventure`, `src/renderer/ui/SaveMenu.ts`). Left out, nothing is asked.
     */
    askBeginAdventure?(source: SaveEntry | null): void;
}

/**
 * Whether the game runs on while a save is written. The disk menu has stopped the clock
 * and repacked an open chest (`TAG02076e`, `doc/CSBwin-src/Character.cpp:5141-5150`); F5
 * and the Sleepsave have done neither.
 */
export type SaveClock = 'running' | 'stopped';

/**
 * Where a save is written: a row of its own, a slot of the playthrough (F5's or the
 * Sleepsave), or over a listed save, the one selected in the disk menu.
 */
export type SaveTarget = 'new' | SaveSlot | SaveEntry;

/** A file on its way into the store (`GameSaves.importSave`). */
export interface ImportedFile {
    /** The file's name, which its row keeps (`importedFileName`). */
    name: string;
    bytes: Uint8Array;
    /**
     * Milliseconds since the epoch: when the file was last written, where the page knows
     * it. It is the row's date, as CSBWin ranks its slots by their files' `MODIFIEDTIME`
     * (`doc/CSBwin-src/CSBCode.cpp:9890-9924`).
     */
    modifiedAt?: number;
}

/**
 * How an import came out: the row the file was stored as, or what its dungeon is to the
 * data set's, and nothing stored.
 */
export type ImportResult =
    | { kind: 'stored'; entry: SaveEntry }
    | Exclude<DungeonCheck, { kind: 'own' }>;

/**
 * The line for a file that does not read as a save: CSBWin's own for a failed read
 * (`doc/CSBwin-src/SaveGame.cpp:2118`).
 */
export const SAVED_GAME_DAMAGED = 'SAVED GAME DAMAGED!';

/** What CSBWin's disk menu says while a DSA has disabled saves (`doc/CSBwin-src/SaveGame.cpp:858`). */
export const SAVES_ARE_DISABLED = 'SAVES ARE DISABLED';

/** The colour of F5's and F9's lines in the message area: white, as a wall's text is. */
const SAVE_MESSAGE_COLOR = 15;

/**
 * The name a new save gets. CSBWin has four fixed filenames and rotates a `.BAK`
 * (`doc/CSBwin-src/CSBCode.cpp:9868-9885`); this port saves as often as asked, so the
 * name has to be unique instead, among `taken`. Sortable, and readable as a file's name.
 */
export function makeSaveFileName(savedAt: number, taken: ReadonlySet<string> = new Set()): string {
    const d = new Date(savedAt);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const stem =
        `csbweb-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let name = `${stem}${SAVE_FILE_EXTENSION}`;
    let n = 2;
    while (taken.has(name)) name = `${stem}-${n++}${SAVE_FILE_EXTENSION}`;
    return name;
}

/**
 * The name an imported file is stored under: its own, a `.dat`, with a number after it
 * while a save among `taken` has it, since a row's name is its key.
 */
export function importedFileName(name: string, taken: ReadonlySet<string>): string {
    const dot = name.toLowerCase().endsWith(SAVE_FILE_EXTENSION) ? name.length - SAVE_FILE_EXTENSION.length : name.length;
    const stem = name.slice(0, dot);
    const extension = name.slice(dot) || SAVE_FILE_EXTENSION;
    let unique = `${stem}${extension}`;
    for (let n = 2; taken.has(unique); n++) unique = `${stem}-${n}${extension}`;
    return unique;
}

/**
 * A playthrough that is no save's among `rows`, for a new game or for a file that names
 * none: drawn as a new game draws its own (`drawRandomGameID`, never 0), and again
 * while a row holds the id. Two games draw the
 * same id about once in 16 million pairs, and two playthroughs of one data set that
 * shared it would share F5's slot, F9's choice and the menu's question (`doc/SAVES.md`
 * → "A playthrough").
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
    /**
     * Whether the running game's world is a modified version of the data set's dungeon:
     * the row's of the save it was read from (`SaveEntry.unofficial`), which its own
     * saves then carry. A new game's is the data set's own.
     */
    private unofficial = false;

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
        /**
         * The stream a playthrough is drawn from for an imported file that names none:
         * not the game's, whose draws are the game's. The page gives the store's
         * (`src/main.ts`).
         */
        private readonly fileRandom: CsbRandom = new CsbRandom(),
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
        this.unofficial = false;
        try {
            const rows = await this.list();
            if (rows.some((row) => row.playthrough === block1.randomGameID)) {
                block1.randomGameID = drawPlaythrough(this.game.ctx.random, rows);
            }
        } catch (error) {
            this.log('New game: the saves could not be listed', error);
        }
    }

    /** A listed save out of the store, to be read into the game (`read`). */
    async open(entry: SaveEntry): Promise<OpenedSave> {
        return { entry, bytes: await this.store.read(entry.id) };
    }

    /**
     * Build a save and write it to the store, as a row of the game's data set. A `'new'`
     * one is a row of its own, under a name no save has in any set: a row's name is its
     * key. F5's (`'quick'`) is written over the playthrough's quick-save (`slotOf`),
     * which keeps its key and its name and takes the new file and its date; the first
     * press makes the slot, as a new row. The Sleepsave (`'sleep'`) is its own slot, the
     * same way. The menu's SAVE over a listed save does the same to that row, whatever
     * game it held: it is the game's playthrough's from then on, and the menu's, so a
     * slot written over is its slot no longer and the next save to it makes another.
     *
     * With the clock stopped, the save's tail (`Game.saveWritten`) runs once the file is
     * written, and a write that fails skips it, as CSBWin's `SaveError` jumps past it
     * (`doc/CSBwin-src/SaveGame.cpp:1361`).
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
     * and is when the save was last used too (`SaveEntry.usedAt`). The play time is the
     * row's as well, the game's count as the file is made (`Game.playTime`), and so is
     * whether the world is a modified dungeon's (`SaveEntry.unofficial`), which the game
     * has from the save it was read from.
     */
    async save(clock: SaveClock, target: SaveTarget): Promise<SaveEntry> {
        if (clock === 'running') this.screen.repackOpenChest();
        const bytes = buildSaveFile(this.game, {
            portraitOf: (champion) => this.screen.portraitOf(champion),
        });
        const savedAt = Date.now();
        const playTime = this.game.playTime();
        const fields = readSaveFileFields(bytes);
        if (!fields) throw new Error('the save file does not read back');
        if (clock === 'running') this.game.saveWritten();
        await this.marked;
        const rows = typeof target === 'string' ? await this.store.list(null) : [];
        const over = typeof target !== 'string' ? target
            : target === 'new' ? undefined : slotOf(rows, target, this.dataSet.id, fields.playthrough);
        const name = over ? over.name : makeSaveFileName(savedAt, new Set(rows.map((row) => row.name)));
        const id = over ? over.id : name;
        const entry: SaveEntry = {
            id, name, dataSet: this.dataSet.id, quick: target === 'quick', sleep: target === 'sleep',
            savedAt, usedAt: savedAt, playTime,
            unofficial: this.unofficial, ...fields,
        };
        await this.store.write(entry, bytes);
        if (clock === 'stopped') this.game.saveWritten();
        return entry;
    }

    /**
     * Restore an opened save into the running game, one of the port's saves or a genuine
     * CSBWin one (`applySaveBytes`). Throws `SaveFileError`, whose message is a line
     * for the menu's status.
     *
     * The game's playthrough is the file's `RandomGameID` as it is, as in CSBWin
     * (`doc/CSBwin-src/SaveGame.cpp:1734`).
     *
     * The entrance's Resume needs to know whether a save came back: CSBWin loops on
     * `ReadEntireGame`'s result and shows the door again when it did not
     * (`doc/CSBwin-src/CSBCode.cpp:10758-10765`).
     *
     * The game's play time is the row's (`SaveEntry.playTime`), which no file holds: the
     * player's count goes on from where the save left it.
     *
     * A save that read is the last one used from then on: its row takes the time
     * (`SaveEntry.usedAt`) and keeps the rest. One that did not read is left as it was,
     * and so is the play time of the game it did not replace.
     *
     * The game's world is the file's, a modified dungeon's when the row says so
     * (`SaveEntry.unofficial`).
     */
    read(save: OpenedSave): void {
        applySaveBytes(this.game, save.bytes);
        this.game.setPlayTime(save.entry.playTime);
        this.unofficial = save.entry.unofficial;
        this.lastRead = 'loaded';
        this.marked = this.store.markUsed(save.entry.id, Date.now())
            .catch((error) => this.log(`${save.entry.name} could not be marked as the last save used`, error));
    }

    /**
     * Take a file from outside into the store, as a row of the game's data set: a CSBWin
     * save, which the list then shows and LOAD reads as any other. The game is left alone.
     *
     * The file names no dungeon but holds one, and its walls are held against the known
     * dungeons' (`checkDungeon` over the signature of the file's world, `doc/SAVES.md`
     * → "An import is checked against the dungeon"):
     *
     * - the data set's own dungeon, whole: stored;
     * - most of the data set's own and not the whole, a modified version of it: stored
     *   only once the player has `confirmed` it, and then marked `unofficial`;
     * - another dungeon's, or an unknown one's: never stored.
     *
     * What is not stored comes back as the check, for the dialog to say. A file whose
     * blocks or dungeon image do not read has no signature, and throws a `SaveFileError`
     * with CSBWin's line for a failed read.
     *
     * The row keeps the file's name, made unique in the store, and its date where the
     * page has one (`ImportedFile.modifiedAt`), today's otherwise; it counts no time
     * played, which no file holds, and is the last save used, being the last written.
     * Its level, champions and playthrough are the file's (`readSaveFileFields`). A file
     * that names no playthrough, an earlier build's, takes one as it enters the store:
     * that of the newest save of the same data set and party (`joinedPlaythrough`), or a
     * new one that no save of the data set holds (`drawPlaythrough`), stamped into the
     * file so that the row and its file agree (`stampRandomGameID`). A file that names
     * one keeps it, a local playthrough's or not: nothing tells a save of this game from
     * a save of another that drew the same id.
     */
    async importSave(file: ImportedFile, confirmed = false): Promise<ImportResult> {
        let signature: string[];
        try {
            signature = await dungeonSignature(loadCsbwinWorld(file.bytes).dungeon);
        } catch (error) {
            this.log(`${file.name} does not read as a saved game`, error);
            throw new SaveFileError(SAVED_GAME_DAMAGED);
        }
        const fields = readSaveFileFields(file.bytes);
        if (!fields) throw new SaveFileError(SAVED_GAME_DAMAGED);
        const check = checkDungeon(signature, this.dataSet.id);
        if (check.kind === 'other' || check.kind === 'unknown') return check;
        if (check.kind === 'modified' && !confirmed) return check;

        await this.marked;
        const rows = await this.store.list(null);
        const name = importedFileName(file.name, new Set(rows.flatMap((row) => [row.id, row.name])));
        const now = Date.now();
        const entry: SaveEntry = {
            id: name, name, dataSet: this.dataSet.id, quick: false, sleep: false,
            savedAt: file.modifiedAt ?? now, usedAt: now, playTime: 0,
            unofficial: check.kind === 'modified', ...fields,
        };
        let { bytes } = file;
        if (entry.playthrough === 0) {
            entry.playthrough = joinedPlaythrough(entry, rows)
                || drawPlaythrough(this.fileRandom, rows.filter((row) => row.dataSet === entry.dataSet));
            bytes = stampRandomGameID(bytes, entry.playthrough);
        }
        await this.store.write(entry, bytes);
        return { kind: 'stored', entry };
    }

    /**
     * Every data set's saves, newest first: the entrance's RISE lists them all, since
     * a new adventure's party comes from any game's save (`doc/SAVES.md` → "A save knows
     * its dungeon").
     */
    async listEverySet(): Promise<SaveEntry[]> {
        await this.marked;
        return this.store.list(null);
    }

    /**
     * "MAKE NEW ADVENTURE" (`makeNewAdventure`, `src/engine/Chaos.ts`): the listed save
     * `source`, of any data set, and `mini.dat`, the game's data set's, make a new save
     * with the source's party in `mini.dat`'s dungeon, stored as a row of the data set
     * and opened, to be read into the game as any listed save is. A refusal throws the
     * `UtilityError` CSBWin's utility shows, and nothing is stored.
     *
     * The row is named after the source's, `-csb` before its `.dat` and a number after
     * that while a save has the name (`importedFileName`), where CSBWin's player picks
     * one of its four slots (`_TAG000ede`, `doc/CSBwin-src/Chaos.cpp:1817-1891`). Its
     * playthrough is the file's, the source's `RandomGameID` with its first byte one
     * higher (`TAG002724`), so a source made into an adventure twice makes two saves of
     * one playthrough, as CSBWin writes the same id twice. It counts no time played: the
     * adventure is a new game, whose own clock starts. Its food and water are drawn from
     * the store's stream, as an import's playthrough is: the game's is the game's.
     */
    async makeNewAdventure(source: SaveEntry, mini: Uint8Array): Promise<OpenedSave> {
        const bytes = makeNewAdventure(await this.store.read(source.id), mini, this.fileRandom);
        const fields = readSaveFileFields(bytes);
        if (!fields) throw new UtilityError(UtilityDiskMessages[25]);
        await this.marked;
        const rows = await this.store.list(null);
        const stem = source.name.toLowerCase().endsWith(SAVE_FILE_EXTENSION)
            ? source.name.slice(0, -SAVE_FILE_EXTENSION.length) : source.name;
        const name = importedFileName(`${stem}${ADVENTURE_SUFFIX}${SAVE_FILE_EXTENSION}`,
            new Set(rows.flatMap((row) => [row.id, row.name])));
        const now = Date.now();
        const entry: SaveEntry = {
            id: name, name, dataSet: this.dataSet.id, quick: false, sleep: false,
            savedAt: now, usedAt: now, playTime: 0, unofficial: false, ...fields,
        };
        await this.store.write(entry, bytes);
        return { entry, bytes };
    }

    /**
     * The boot's chooser only: its `read` threw, and `tag01efee` follows; or RISE's
     * `makeNewAdventure` was refused, and the entrance shows why.
     */
    readFailed(error?: unknown): void {
        this.lastRead = error instanceof UtilityError ? { refused: error.message } : 'damaged';
    }

    /** How the chooser's last read came out, and forget it. */
    consumeSavedGameRead(): SavedGameRead {
        const read = this.lastRead;
        this.lastRead = 'cancelled';
        return read;
    }

    /**
     * Whether the running game is CSB's prison, where a party is chosen to be saved and
     * carried into the adventure: a game begun from a compressed `dungeon.dat` whose
     * `Word22592` is the prison's (`PRISON_WORD22592`), in a data set with a `mini.dat`
     * to make the adventure from. The prison has no way out: its text at (9,2) of level 0
     * says "FIRST CHOOSE YOUR CHAMPIONS...THEN SAVE THE GAME... THEN RESTART WITH THE
     * UTILITY DISK.", so the port asks "BEGIN THE ADVENTURE?" after a save there, and once
     * the fourth champion has joined (`championJoined`).
     */
    inPrison(): boolean {
        return this.dataSet.miniDat && this.game.ctx.state.block1.word22592 === PRISON_WORD22592;
    }

    /**
     * A champion has joined (`GameHost.championJoined`). In the prison, the fourth asks
     * "BEGIN THE ADVENTURE?": the party can grow no more, and YES saves it first, under
     * F5's name, so the prison's save stays to be raised again from the entrance.
     */
    championJoined(): void {
        if (this.inPrison() && this.game.ctx.party.state.champions.length === 4) {
            this.screen.askBeginAdventure?.(null);
        }
    }

    /**
     * F5: the playthrough's quick-save, written over the last. Not with an empty party,
     * nor while a champion is still being chosen: the disk icon does nothing then
     * (`doc/CSBwin-src/Mouse.cpp:1855-1857`), and a file has no place for
     * `d.PotentialCharacterOrdinal`, so the candidate would load as a member. Nor while a
     * script holds the loop, which a save could not resume. The icon is silent then; a
     * key that saved nothing says so. Nor while a DSA has disabled saves
     * (`DsaSystem.disableSaves`), when the key says what CSBWin's disk menu says
     * (`doc/CSBwin-src/SaveGame.cpp:856-873`).
     *
     * A write that fails is `SaveError`'s "UNABLE TO SAVE GAME!"
     * (`doc/CSBwin-src/SaveGame.cpp:1363`). One that is written in the prison asks
     * "BEGIN THE ADVENTURE?" (`inPrison`), of any party.
     */
    async quickSave(): Promise<void> {
        const { champions, potentialChampionIndex } = this.game.ctx.party.state;
        if (champions.length === 0 || potentialChampionIndex >= 0 || this.game.isRunningScript()) {
            this.tell('CANNOT SAVE NOW');
            this.log('Quick-save refused: no party, a champion being chosen, or a script running');
            return;
        }
        if (this.game.ctx.systems.dsa.disableSaves) {
            this.tell(SAVES_ARE_DISABLED);
            this.log('Quick-save refused: a DSA has disabled saves');
            return;
        }
        try {
            const entry = await this.save('running', 'quick');
            this.tell('GAME SAVED');
            this.log(`Quick-saved ${entry.name}`);
            if (this.inPrison()) this.screen.askBeginAdventure?.(entry);
        } catch (error) {
            this.tell('UNABLE TO SAVE GAME!');
            this.log('Quick-save failed', error);
        }
    }

    /**
     * The Sleepsave: the playthrough's slot of its own (`'sleep'`), apart from F5's,
     * written when the party lies down, button 145, and written over when the player
     * wakes it, button 146. A blow that wakes the party (`WakeUp` from
     * `doc/CSBwin-src/Monster.cpp:4544` and `Character.cpp:2816`) writes nothing, so the
     * slot keeps the moment the party lay down. Both are player's clicks, after which the
     * screen calls this (`UIState.sleepSaveNeeded`); neither does anything in CSBWin.
     *
     * Not where F5 is refused (`quickSave`), nor in the prison, where a save would ask
     * "BEGIN THE ADVENTURE?". It says nothing in the message area, refused, written or
     * failed: what it did is a line for the console alone.
     */
    async sleepSave(): Promise<void> {
        const { champions, potentialChampionIndex } = this.game.ctx.party.state;
        if (champions.length === 0 || potentialChampionIndex >= 0 || this.game.isRunningScript()
            || this.game.ctx.systems.dsa.disableSaves || this.inPrison()) {
            this.log('Sleepsave skipped: no party, a champion being chosen, a script running, saves disabled, or the prison');
            return;
        }
        try {
            const entry = await this.save('running', 'sleep');
            this.log(`Sleepsaved ${entry.name}`);
        } catch (error) {
            this.log('Sleepsave failed', error);
        }
    }

    /**
     * F9: the newest save of the game's playthrough, F5's, the Sleepsave or the menu's. Not while a
     * script holds the loop: it would run on in the loaded world.
     *
     * A playthrough with no save is `_ReadEntireGame`'s "CAN'T FIND SAVED GAME!"
     * (`doc/CSBwin-src/SaveGame.cpp:1710`), whatever the data set's other playthroughs
     * hold: a new game not saved yet. A file that does not read is its `SaveFileError`'s
     * line, the one the disk menu shows.
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
