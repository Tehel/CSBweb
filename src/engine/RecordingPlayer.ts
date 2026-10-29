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
 * read once the VBL has run, as the recorded read came after it. It plays no save: a save the
 * recorded game made is its logged tail (`saveWritten`), and what the game opens in a VBL
 * does its game half alone while it plays (`InputBoundary.playing`).
 *
 * It runs no VBL. Whoever runs the game's VBLs plays it: a tool's loop, or the page's,
 * which runs a span the clock is held through at once (`held`, `Game.runAtOnceWhile`) and
 * stops at its end (`onEnd`).
 */
import type { Game } from './Game';
import { saveFileOf } from './GameSaves';
import { applyExtras } from './InputBoundary';
import { setCarriedState, type Recording, type RecordingPoint } from './Recorder';
import { applySaveBytes } from './SaveGameFile';

/** Where a played recording parted from the recorded game. */
export type Drift =
    /** A change met another `d.Time` or `d.RandomNumber`: the recording's, its index, and what the game had. */
    | { readonly kind: 'change'; readonly recording: string; readonly change: number; readonly time: number; readonly random: number }
    /** The parent, played up to the join, makes another file than its child read: the first byte that differs. */
    | { readonly kind: 'join'; readonly recording: string; readonly byte: number };

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
     * The file a VBL saved at the point the next join names, where that point was taken
     * inside the VBL (`RecordingPoint.inVbl`): what the join checks.
     */
    private savedAtJoin: Uint8Array | null = null;
    private beginListener: ((recording: Recording) => void) | null = null;
    private endListener: ((drift: Drift | null) => void) | null = null;

    /**
     * `path`, each recording after the first the child of the one before, played into
     * `game` from `start`. `dungeonDat` is the data set's, which a new game reads.
     */
    constructor(
        private readonly game: Game,
        private readonly path: readonly Recording[],
        private readonly dungeonDat: Uint8Array,
    ) {
        if (path.length === 0) throw new Error('a path holds a recording');
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
        this.game.input.play({ afterVbl: () => this.feed(), savedInVbl: (file) => this.savedInVbl(file) });
        this.feed();
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

    /**
     * The changes logged before the next VBL applied, and a join read where the parent
     * has reached its child's point, until a VBL is owed.
     */
    private feed(): void {
        const { ctx } = this.game;
        for (;;) {
            const recording = this.path[this.segment]!;
            const child = this.path[this.segment + 1] ?? null;
            const until = child?.parent ?? { changes: recording.changes.length, vbls: recording.vbls };
            const vbls = this.game.input.vbls - this.from;
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
                this.end();
                return;
            }
            if (!this.join(child)) return;
        }
    }

    /** A file the running VBL saved: kept where the next join's point was taken there. */
    private savedInVbl(file: Uint8Array): void {
        const parent = this.path[this.segment + 1]?.parent;
        const { changes, vbls } = this.point;
        if (parent?.inVbl && parent.changes === changes && parent.vbls === vbls) this.savedAtJoin = file;
    }

    /**
     * `child` read where its parent has reached its point: the file the parent makes now
     * checked against the one it read, made as the recorded save made it, the clock
     * stopped where the disk menu held it. A point taken inside a VBL is checked against
     * the file that VBL saved, and none saved is a drift at the first byte.
     */
    private join(child: Recording): boolean {
        if (child.start.kind !== 'save') throw new Error('a branch starts from a save');
        const { ctx } = this.game;
        const made = child.parent?.inVbl ? this.savedAtJoin ?? new Uint8Array(0)
            : saveFileOf(this.game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion));
        this.savedAtJoin = null;
        const read = child.start.bytes;
        const byte = made.length !== read.length ? Math.min(made.length, read.length) : made.findIndex((value, n) => value !== read[n]);
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
