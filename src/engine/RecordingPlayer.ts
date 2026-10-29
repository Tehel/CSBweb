/**
 * The port's player (`doc/RECORDING.md` → "The port's player"): a recording's path played
 * into a game through its input boundary (`InputBoundary`), as the page's events played
 * it.
 *
 * A path is a root and the branches down to the one played, each the child of the one
 * before (`Recording.parent`, `doc/RECORDING.md` → "The tree"), or a branch alone, which
 * plays from its own start. Its first recording's start is read,
 * a new game's world and its stream and playthrough set over the read, or a save's file
 * and what its read left beside it (`CarriedState`); then its rules and its extras. Each
 * change is applied once the VBL before the one it was logged at has run, the boundary's
 * feed (`InputBoundary.play`), so nothing of the page comes between. Where a parent
 * reaches the point its child names, the child's file is read and its own changes follow,
 * from its own start, as the recorded read began them.
 *
 * It stops at the first drift: a change whose `d.Time` or `d.RandomNumber` is not the
 * recorded one, or a join where the parent does not make the very file its child read
 * (`doc/RECORDING.md` → "Recordings follow the engine"). A save made inside a VBL, the
 * Sleepsave's (`RecordingPoint.inVbl`), is checked against the file the played VBL made
 * at the same place, which the game tells it (`InputBoundary.savedInVbl`); its child is
 * read once the VBL has run, as the recorded read came after it. A recording the game's
 * end ended (`Recording.end`) is played to the same end: the game ends in the VBL its
 * recording ended in, with the same `d.Word11694`, which the game tells it
 * (`InputBoundary.ended`), and a game that ends anywhere else is a drift. A path shared at
 * a save's point (`RecordingPackage`, `src/engine/RecordingPackage.ts`) ends there, its
 * last recording cut at the point, and the file the game makes there is checked against
 * the save's, as a join's (`SavedAtEnd`). It plays no save: a save the
 * recorded game made is its logged tail (`saveWritten`), and what the game opens in a VBL
 * does its game half alone while it plays (`InputBoundary.playing`).
 *
 * It runs no VBL. Whoever runs the game's VBLs plays it: a tool's loop, or the page's,
 * which runs a span the clock is held through at once (`held`, `Game.runAtOnceWhile`),
 * told each such span as it ends (`onSkipped`), and stops at its end (`onEnd`).
 */
import { VBL_FREQUENCY } from '../core/constants';
import type { Game } from './Game';
import { saveFileOf } from './GameSaves';
import { applyExtras, type ClockHolder } from './InputBoundary';
import { setCarriedState, type Recording, type RecordingPoint } from './Recorder';
import { applySaveBytes } from './SaveGameFile';

/** Where a played recording parted from the recorded game. */
export type Drift =
    /** A change met another `d.Time` or `d.RandomNumber`: the recording's, its index, and what the game had. */
    | { readonly kind: 'change'; readonly recording: string; readonly change: number; readonly time: number; readonly random: number }
    /** The parent, played up to the join, makes another file than its child read: the first byte that differs. */
    | { readonly kind: 'join'; readonly recording: string; readonly byte: number }
    /** The path, played to its end, makes another file than the save shared there (`SavedAtEnd`): the first byte that differs. */
    | { readonly kind: 'save'; readonly recording: string; readonly byte: number }
    /**
     * The game ended where the recording did not, or did not end where it did: the VBLs
     * it had run of the recording, and the `d.Word11694` it ended with, `null` where it
     * did not end.
     */
    | { readonly kind: 'end'; readonly recording: string; readonly vbls: number; readonly word11694: boolean | null };

/**
 * The save a path shared at a save's point ends at: its file, and whether its point was
 * taken inside its last VBL (`RecordingPoint.inVbl`). The path's last recording ends at
 * that point.
 */
export interface SavedAtEnd {
    readonly file: Uint8Array;
    readonly inVbl: boolean;
}

/**
 * A span the clock was held through (`RecordingPlayer.held`): its VBLs, and what held it,
 * as the stop that began it named it (`InputBoundary.holder`), or `null` where it named
 * nothing, as in a recording made before the name.
 */
export interface HeldSpan {
    readonly vbls: number;
    readonly holder: ClockHolder | null;
}

export class RecordingPlayer {
    /** The recording of the path being played. */
    private segment = 0;
    /** Its next change. */
    private next = 0;
    /** The boundary's VBLs as it began. */
    private from = 0;
    private finished = false;
    private parted: Drift | null = null;
    private joined = 0;
    /**
     * The file a VBL saved at the point the next join or the save at the end names, where
     * that point was taken inside the VBL (`RecordingPoint.inVbl`): what the join checks.
     */
    private savedAtJoin: Uint8Array | null = null;
    /** The game's end, with `d.Word11694`, once the game has told it. */
    private gameEnd: boolean | null = null;
    /** The boundary's VBLs as the span the clock is held through began, and what held it. */
    private heldSince: number | null = null;
    private heldBy: ClockHolder | null = null;
    private beginListener: ((recording: Recording) => void) | null = null;
    private skipListener: ((span: HeldSpan) => void) | null = null;
    private endListener: ((drift: Drift | null) => void) | null = null;

    /**
     * `path`, each recording after the first the child of the one before, played into
     * `game` from `start`. `dungeonDat` is the data set's, which a new game reads.
     * `savedAtEnd`, for a path shared at a save's point: the save its end makes.
     */
    constructor(
        private readonly game: Game,
        private readonly path: readonly Recording[],
        private readonly dungeonDat: Uint8Array,
        private readonly savedAtEnd: SavedAtEnd | null = null,
    ) {
        if (path.length === 0) throw new Error('a path holds a recording');
        if (savedAtEnd && path[path.length - 1]!.end) throw new Error('a path ends at a save or at the game\'s end');
        for (let n = 1; n < path.length; n++) {
            const { parent, start } = path[n]!;
            if (parent?.recording !== path[n - 1]!.id || start.kind !== 'save') throw new Error('each recording of a path is a branch of the one before');
        }
    }

    /**
     * Told each recording of the path as its read has begun it, before its first change:
     * a tool's recorder, which records the game played back.
     */
    onBegin(listener: (recording: Recording) => void): void {
        this.beginListener = listener;
    }

    /**
     * Told once as it stops of itself, inside the feed: at the path's end (`null`), or at
     * the drift that stopped it. Not at `stop`, its owner's.
     */
    onEnd(listener: (drift: Drift | null) => void): void {
        this.endListener = listener;
    }

    /**
     * Told each span the clock was held through (`held`) as it ends, at the change that
     * lets the clock run, or at the path's end or a drift inside it: the page's line that
     * says what it ran at once.
     */
    onSkipped(listener: (span: HeldSpan) => void): void {
        this.skipListener = listener;
    }

    /**
     * The path's first start read into the game, its rules and extras set, and its changes
     * logged before its first VBL applied; then the boundary fed after every VBL. The
     * game is started by its owner, as after any read.
     */
    start(): void {
        const root = this.path[0]!;
        const { ctx } = this.game;
        if (root.start.kind === 'new') {
            this.game.readDungeonDat(this.dungeonDat);
            ctx.random.setSeed(root.start.random);
            ctx.state.block1.randomGameID = root.start.randomGameID;
            this.begin(root);
        } else {
            this.read(root);
        }
        this.game.input.play({
            afterVbl: () => this.feedAndWatch(),
            savedInVbl: (file) => this.savedInVbl(file),
            ended: (word11694) => { this.gameEnd = word11694; },
        });
        this.feedAndWatch();
    }

    /** Stop playing: the boundary is fed no more. */
    stop(): void {
        this.finished = true;
        this.game.input.play(null);
    }

    /** Whether it still plays: neither the path's end reached, nor a drift met, nor stopped. */
    get playing(): boolean {
        return !this.finished;
    }

    /**
     * Whether it plays a span the clock is held through (`ctx.state.paused`), from the
     * change or the VBL that held it to the change that lets it run: a dialog the
     * recorded page showed, or the disk menu. The game moves on in none of its VBLs but
     * what counts VBLs under a held clock (the attack panel's flash, the message strip,
     * the due tick, the mouse queue's pass), so the page plays it at once, and shows
     * nothing of it.
     */
    get held(): boolean {
        return !this.finished && this.game.ctx.state.paused;
    }

    /** The drift that stopped it, or `null`. */
    get drift(): Drift | null {
        return this.parted;
    }

    /** The joins played, each checked. */
    get joins(): number {
        return this.joined;
    }

    /** Where it stands in the recording it plays: its changes applied, and its VBLs run. */
    get point(): RecordingPoint {
        return { recording: this.path[this.segment]!.id, changes: this.next, vbls: this.game.input.vbls - this.from };
    }

    /** The feed (`feed`), then a span under a held clock begun or ended there (`onSkipped`). */
    private feedAndWatch(): void {
        this.feed();
        const held = this.held;
        if (held && this.heldSince === null) {
            this.heldSince = this.game.input.vbls;
            this.heldBy = this.game.input.holder;
        } else if (!held) {
            this.endSpan();
        }
    }

    /** The span under a held clock, if one runs, ended here and told. */
    private endSpan(): void {
        if (this.heldSince === null) return;
        const span = { vbls: this.game.input.vbls - this.heldSince, holder: this.heldBy };
        this.heldSince = null;
        this.skipListener?.(span);
    }

    /**
     * The changes logged before the next VBL applied, and a join read where the parent
     * has reached its child's point, until a VBL is owed. A game that has ended stops it,
     * at its recording's end or at a drift.
     */
    private feed(): void {
        const { ctx } = this.game;
        for (;;) {
            const recording = this.path[this.segment]!;
            const child = this.path[this.segment + 1] ?? null;
            const until = child?.parent ?? { changes: recording.changes.length, vbls: recording.vbls };
            const vbls = this.game.input.vbls - this.from;
            if (this.gameEnd !== null) {
                const atEnd = !child && recording.end?.word11694 === this.gameEnd && vbls === recording.vbls && this.next === recording.changes.length;
                if (!atEnd) this.parted = { kind: 'end', recording: recording.id, vbls, word11694: this.gameEnd };
                this.end();
                return;
            }
            while (this.next < until.changes && recording.changes[this.next]!.vbl <= vbls) {
                const entry = recording.changes[this.next]!;
                const time = ctx.state.tickCount;
                const random = ctx.random.getSeed();
                if (entry.vbl !== vbls || entry.time !== time || entry.random !== random) {
                    this.parted = { kind: 'change', recording: recording.id, change: this.next, time, random };
                    this.end();
                    return;
                }
                this.next++;
                this.game.input.apply(entry.change);
            }
            if (this.next < until.changes || vbls < until.vbls) return;
            if (!child) {
                if (recording.end) this.parted = { kind: 'end', recording: recording.id, vbls, word11694: null };
                else if (this.savedAtEnd) {
                    const byte = firstDifference(this.made(this.savedAtEnd.inVbl), this.savedAtEnd.file);
                    if (byte >= 0) this.parted = { kind: 'save', recording: recording.id, byte };
                }
                this.end();
                return;
            }
            if (!this.join(child)) return;
        }
    }

    /** A file the running VBL saved: kept where the next join's point, or the save at the end's, was taken there. */
    private savedInVbl(file: Uint8Array): void {
        const recording = this.path[this.segment]!;
        const child = this.path[this.segment + 1];
        const ahead = child ? child.parent : this.savedAtEnd
            ? { changes: recording.changes.length, vbls: recording.vbls, inVbl: this.savedAtEnd.inVbl } : null;
        const { changes, vbls } = this.point;
        if (ahead?.inVbl && ahead.changes === changes && ahead.vbls === vbls) this.savedAtJoin = file;
    }

    /**
     * The file the game makes at the point played to, as the recorded save made it, the
     * clock stopped where the disk menu held it; at a point taken inside a VBL, the file
     * that VBL saved, and an empty one where it saved none.
     */
    private made(inVbl: boolean | undefined): Uint8Array {
        const { ctx } = this.game;
        const made = inVbl ? this.savedAtJoin ?? new Uint8Array(0)
            : saveFileOf(this.game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion));
        this.savedAtJoin = null;
        return made;
    }

    /**
     * `child` read where its parent has reached its point: the file the parent makes now
     * (`made`) checked against the one it read. A point taken inside a VBL where the VBL
     * saved none is a drift at the first byte.
     */
    private join(child: Recording): boolean {
        if (child.start.kind !== 'save') throw new Error('a branch starts from a save');
        const byte = firstDifference(this.made(child.parent?.inVbl), child.start.bytes);
        if (byte >= 0) {
            this.parted = { kind: 'join', recording: child.id, byte };
            this.end();
            return false;
        }
        this.joined++;
        this.segment++;
        this.read(child);
        return true;
    }

    /** Stopped of itself, at the path's end or a drift, and its listener told. */
    private end(): void {
        this.stop();
        this.endSpan();
        this.endListener?.(this.parted);
    }

    /** `recording`'s save read, what its read left beside the file set, and it begun. */
    private read(recording: Recording): void {
        const { start } = recording;
        if (start.kind !== 'save') throw new Error('a branch starts from a save');
        applySaveBytes(this.game, start.bytes);
        if (start.carried) setCarriedState(this.game, start.carried);
        this.begin(recording);
    }

    /** `recording`'s rules and extras set, and its changes counted from here. */
    private begin(recording: Recording): void {
        const { ctx } = this.game;
        Object.assign(ctx.rules, recording.rules);
        applyExtras(ctx, recording.extras);
        this.next = 0;
        this.from = this.game.input.vbls;
        this.beginListener?.(recording);
    }
}

/** The first byte two files differ at, or -1. */
function firstDifference(made: Uint8Array, read: Uint8Array): number {
    return made.length !== read.length ? Math.min(made.length, read.length) : made.findIndex((value, n) => value !== read[n]);
}

/** What held the clock, as the page's line names it (`skippedLine`). */
const HOLDER_NAMES: Record<ClockHolder, string> = {
    settings: 'THE SETTINGS',
    map: 'THE MAP',
    champions: 'THE CHAMPIONS',
    saveMenu: 'THE SAVE MENU',
    hintOracle: 'THE HINT ORACLE',
};

/**
 * The page's line in the message area at the end of a span it ran at once (`onSkipped`):
 * its seconds, its VBLs over sixty, rounded, and what held the clock, "A MENU" where its
 * stop named nothing.
 */
export function skippedLine(span: HeldSpan): string {
    return `SKIPPED ${Math.round(span.vbls / VBL_FREQUENCY)}S ON ${span.holder ? HOLDER_NAMES[span.holder] : 'A MENU'}`;
}

/**
 * The page's lines in the message area where the player stops of itself (`onEnd`): at the
 * path's end, or at a drift, which, where the recording that drifted was made by a build
 * other than `build`, the page's, says another version of the site made it.
 */
export function endLines(path: readonly Recording[], drift: Drift | null, build: string): string[] {
    if (!drift) return ['THE RECORDING ENDS HERE.'];
    const made = path.find((recording) => recording.id === drift.recording)?.build;
    return made !== undefined && made !== build
        ? ['THE RECORDING DRIFTED FROM THE GAME HERE.', 'ANOTHER VERSION OF THE SITE MADE IT.']
        : ['THE RECORDING DRIFTED FROM THE GAME HERE.'];
}
