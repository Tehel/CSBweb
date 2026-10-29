/**
 * The port's recorder (`doc/RECORDING.md` → "The port's recorder"): the running game
 * logged at its input boundary (`InputBoundary`) from where it starts, so that it can be
 * played back.
 *
 * A recording begins at a read, the one place a game starts (`GameSaves`): a new game's
 * once its playthrough is drawn (`GameSaves.newGameRead`), whose start is its stream and
 * its `d.RandomGameID` as that leaves them; a save's once it is read (`GameSaves.read`),
 * whose start is the save's bytes. Beside the start it takes what no read sets: the extras,
 * and the rules as the read left them (`RulesOptions`, which a read only changes where its
 * file has an Extended Features block). Then every change the boundary is told, each with
 * the VBLs the recording has run before it, `d.Time` and `d.RandomNumber`. The boot's
 * DM rules (`Game.forceDMRulesAtBoot`) are such a change. The next read ends it.
 *
 * A recording is played back by the same start: the game read from it, its rules and
 * extras set, the game begun, and each change applied before the VBL it was logged at.
 *
 * Recordings make a tree, through the saves (`doc/RECORDING.md` → "The tree"). A save
 * made in a recording names its point there (`point`, `SaveEntry.recording`), and a read
 * of it begins a branch, which names that point as its parent. Its start is still the
 * save's file, and what the read left of the game that the file does not hold
 * (`CarriedState`), so a branch plays from its own start alone, or from its root through
 * each join.
 *
 * The page writes each recording to its store as it grows (`RecordingWriter`).
 */
import type { Extras, RulesOptions } from './GameContext';
import type { Game } from './Game';
import type { InputChange } from './InputBoundary';
import type { LoopFlags } from './LoopState';

/**
 * What a read leaves of the game that the save's file does not hold, and the game reads
 * on: the clock a dialog holds (`ctx.state.paused`), and the main loop's flags
 * (`ctx.loop`), among them the VBLs into the tick and the video mode the disk menu sets.
 * A read under the disk menu's LOAD leaves them as the menu set them, F9's as the game
 * ran, so a branch's join sets them over its read as the recorded read left them.
 */
export interface CarriedState {
    readonly paused: boolean;
    readonly loop: LoopFlags;
}

/** `game`'s `CarriedState` now. */
export function carriedStateOf(game: Game): CarriedState {
    const { ctx } = game;
    return { paused: ctx.state.paused, loop: structuredClone(ctx.loop) };
}

/** `carried` set over `game`, as a branch's join sets it over its read. */
export function setCarriedState(game: Game, carried: CarriedState): void {
    const { ctx } = game;
    ctx.state.paused = carried.paused;
    Object.assign(ctx.loop, structuredClone(carried.loop));
}

/** Where a recording starts: a new game of its data set, or a save. */
export type RecordingStart =
    /** A new game, its stream and `d.RandomGameID` as its read and its playthrough's draw left them. */
    | { readonly kind: 'new'; readonly random: number; readonly randomGameID: number }
    /**
     * A save's file, as it was read, and what the read left beside it. A recording the
     * store's version 7 wrote before the tree has no `carried`.
     */
    | { readonly kind: 'save'; readonly bytes: Uint8Array; readonly carried?: CarriedState };

/**
 * A point in a recording: its changes recorded before it, and its VBLs run. A save's,
 * where its file was made (`SaveEntry.recording`), and a branch's parent.
 */
export interface RecordingPoint {
    /** The recording's id (`Recording.id`). */
    readonly recording: string;
    readonly changes: number;
    /** Those run, and the one running where it was taken inside a VBL. */
    readonly vbls: number;
    /**
     * Taken inside its last VBL, before the rest of it ran: the Sleepsave's, made at the
     * click (`GameSaves.sleepSave`). Absent from a point taken between two.
     */
    readonly inVbl?: true;
}

/** A change as the boundary told it, with the game's clock and stream as they stood. */
export interface RecordedChange {
    readonly change: InputChange;
    /** The VBLs the recording had run before it. */
    readonly vbl: number;
    /** `d.Time`. */
    readonly time: number;
    /** `d.RandomNumber`. */
    readonly random: number;
}

export interface Recording {
    /** Its key in the store, and what a save made in it names (`RecordingPoint.recording`). */
    readonly id: string;
    /** The build that made it: a later build's engine may play it out otherwise. */
    readonly build: string;
    /** The data set it was played on (`DataSet.id`), whose `dungeon.dat` a new game reads. */
    readonly dataSet: string;
    readonly start: RecordingStart;
    /** The point of the save its read read, for a branch; `null` for a root. */
    readonly parent: RecordingPoint | null;
    /** The rules as its read left them. */
    readonly rules: RulesOptions;
    /** The extras as it began. */
    readonly extras: Extras;
    readonly changes: readonly RecordedChange[];
    /** The VBLs it has run: up to the read that ended it, or so far. */
    readonly vbls: number;
    /** A read has ended it. */
    readonly ended: boolean;
}

interface Running {
    readonly recording: Omit<Recording, 'changes' | 'vbls' | 'ended'>;
    readonly changes: RecordedChange[];
    /** The boundary's VBLs as it began. */
    readonly from: number;
    /** The boundary's VBLs as a read ended it, or `null` while it runs. */
    to: number | null;
}

export class Recorder {
    private current: Running | null = null;
    private beginListener: ((previous: Recording | null) => void) | null = null;

    /**
     * Records `game`'s boundary, the only listener it has, for `build` playing `dataSet`.
     * `newId` is the page's: an id no other recording of its store has.
     */
    constructor(
        private readonly game: Game,
        private readonly build: string,
        private readonly dataSet: string,
        private readonly newId: () => string,
    ) {
        game.input.listen((change, vbl) => this.told(change, vbl));
    }

    /**
     * Told at each `begin`, once the recording has begun, the one it replaced as it
     * ended (`null` at the first): the store's writer (`RecordingWriter`), which
     * finishes it.
     */
    onBegin(listener: (previous: Recording | null) => void): void {
        this.beginListener = listener;
    }

    /** A read has made the game `start`, a branch of `parent` where it read a save made in a recording. */
    begin(start: RecordingStart, parent: RecordingPoint | null = null): void {
        const previous = this.recording;
        const { ctx } = this.game;
        this.current = {
            recording: {
                id: this.newId(), build: this.build, dataSet: this.dataSet, start, parent,
                rules: { ...ctx.rules }, extras: { ...ctx.extras },
            },
            changes: [],
            from: this.game.input.vbls,
            to: null,
        };
        this.beginListener?.(previous);
    }

    /**
     * Where the running recording stands: what a save made now names (`SaveEntry.recording`).
     * `null` before the first read.
     */
    point(): RecordingPoint | null {
        const current = this.current;
        if (!current || current.to !== null) return null;
        const point = { recording: current.recording.id, changes: current.changes.length, vbls: this.game.input.vbls - current.from };
        return this.game.input.inVbl ? { ...point, inVbl: true } : point;
    }

    /** The recording begun last, ended or not, or `null` before any read. */
    get recording(): Recording | null {
        const current = this.current;
        if (!current) return null;
        const to = current.to ?? this.game.input.vbls;
        return { ...current.recording, changes: current.changes, vbls: to - current.from, ended: current.to !== null };
    }

    private told(change: InputChange, vbl: number): void {
        const current = this.current;
        if (!current || current.to !== null) return;
        if (change.kind === 'read') {
            current.to = vbl;
            return;
        }
        const { ctx } = this.game;
        current.changes.push({ change, vbl: vbl - current.from, time: ctx.state.tickCount, random: ctx.random.getSeed() });
    }
}
