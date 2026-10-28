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
 * The page writes each recording to its store as it grows (`RecordingWriter`).
 */
import type { Extras, RulesOptions } from './GameContext';
import type { Game } from './Game';
import type { InputChange } from './InputBoundary';

/** Where a recording starts: a new game of its data set, or a save. */
export type RecordingStart =
    /** A new game, its stream and `d.RandomGameID` as its read and its playthrough's draw left them. */
    | { readonly kind: 'new'; readonly random: number; readonly randomGameID: number }
    /** A save's file, as it was read. */
    | { readonly kind: 'save'; readonly bytes: Uint8Array };

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
    /** The build that made it: a later build's engine may play it out otherwise. */
    readonly build: string;
    /** The data set it was played on (`DataSet.id`), whose `dungeon.dat` a new game reads. */
    readonly dataSet: string;
    readonly start: RecordingStart;
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

    /** Records `game`'s boundary, the only listener it has, for `build` playing `dataSet`. */
    constructor(private readonly game: Game, private readonly build: string, private readonly dataSet: string) {
        game.input.listen((change, vbl) => this.told(change, vbl));
    }

    /**
     * Told at each `begin`, before the recording begins, the one it replaces as it stands
     * (`null` at the first): the store's writer (`RecordingWriter`), which finishes it.
     */
    onBegin(listener: (previous: Recording | null) => void): void {
        this.beginListener = listener;
    }

    /** A read has made the game `start`: the recording begins. */
    begin(start: RecordingStart): void {
        this.beginListener?.(this.recording);
        const { ctx } = this.game;
        this.current = {
            recording: { build: this.build, dataSet: this.dataSet, start, rules: { ...ctx.rules }, extras: { ...ctx.extras } },
            changes: [],
            from: this.game.input.vbls,
            to: null,
        };
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
