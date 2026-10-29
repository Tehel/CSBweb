/**
 * The one door through which the page changes the game, and the count of VBLs it is
 * stamped with (`doc/RECORDING.md` → "The port's recorder").
 *
 * The game runs one VBL at a time (`Game.runFrame`); between two, the page brings what
 * its events bring: a click, a key, the clock stopped by a dialog, a setting, a save's
 * tail, a read, the boot's DM rules. Each goes through `apply`, which applies it at once
 * and hands it first to the listener with the VBLs run so far. So the game is a function
 * of its start, its VBLs and the changes told, each before the same VBL. Its listener is
 * the recorder (`Recorder`).
 *
 * What the game does inside a VBL is its own, whatever door it takes: the save menu its
 * disk icon opens holds the clock from a button's handler, and the Sleepsave's tail runs
 * there. Such a change is applied and told to nobody, since playing the VBL again makes it.
 *
 * Most changes are the engine's to apply (`Game`'s applier). Three are the interface's,
 * which the engine does not import: a panel key, and the Reincarnate screen's key and
 * click (`ScreenInput`, which the page's input path gives).
 *
 * A recording played back feeds it (`RecordingPlayer`): after each VBL, the changes
 * logged before the next are applied, as the page's events applied them. The player is
 * told the file a VBL saves as well, the Sleepsave's, which its join is checked against.
 *
 * The game's end, `ShowCredits` once `MainLoop` has returned, is the game's own as well,
 * made inside the VBL that ended it, but a point of its recording: the recorder ends the
 * recording there, and the player checks it was played to the same end (`ended`).
 */
import type { Extras, GameContext } from './GameContext';
import { LONG_MOUSEQLEN, MOUSEQLEN } from './MouseQueue';

/** A change the page makes to the game, as the boundary logs and applies it. */
export type InputChange =
    /** A click queued, untranslated (`Game.onMouseClick`). */
    | { readonly kind: 'click'; readonly x: number; readonly y: number; readonly buttons: number }
    /** The button-up queued (`Game.onMouseUnClick`). */
    | { readonly kind: 'unclick' }
    /** A key table's button queued (`Game.enqueueKeyButton`). */
    | { readonly kind: 'key'; readonly num: number }
    /** A panel key's action (`src/renderer/ui/Keyboard.ts`), by its name: the key it was bound to is the page's. */
    | { readonly kind: 'panelKey'; readonly action: string }
    /** A key on the Reincarnate screen, as `KeyboardEvent.key` has it (`reincarnateKey`). */
    | { readonly kind: 'reincarnateKey'; readonly key: string }
    /** A click on the Reincarnate screen, in CSBWin's screen's coordinates (`reincarnateClick`). */
    | { readonly kind: 'reincarnateClick'; readonly x: number; readonly y: number }
    /**
     * The clock stopped or let run, by a dialog (`ctx.state.paused`). A stop names what
     * holds it, which a recording made before the name lacks.
     */
    | { readonly kind: 'pause'; readonly paused: boolean; readonly dialog?: ClockHolder }
    /**
     * `TAG0207cc`, the interface put back, as the disk menu and the Hint Oracle close
     * (`closeSaveMenu`, `closeHintOracle`).
     */
    | { readonly kind: 'tag0207cc' }
    /** The settings' extras, and the mouse queue's length they choose (`applyExtras`). */
    | { readonly kind: 'extras'; readonly extras: Extras }
    /** A save's tail, once its file is made (`Game.saveWritten`). */
    | { readonly kind: 'saveWritten' }
    /** A game read over the running one: told, not applied, since the read has done it (`readGame`). */
    | { readonly kind: 'read' }
    /** The boot's `DM_rules`, forced once the game is read (`Game.forceDMRulesAtBoot`). */
    | { readonly kind: 'forceDMRules' }
    /** `?dev`'s move a level down (1) or up (-1) (`Game.devChangeLevel`). */
    | { readonly kind: 'devLevel'; readonly delta: 1 | -1 }
    /** `?dev`'s move to a square, the map dialog's long press (`Game.devMoveParty`). */
    | { readonly kind: 'devMove'; readonly map: number; readonly x: number; readonly y: number };

/**
 * What holds the clock: a dialog the page opens (`openDialog`), whose stop it logs, or
 * what the game opens in a VBL, the disk menu and the Hint Oracle.
 */
export type ClockHolder = 'settings' | 'map' | 'champions' | 'saveMenu' | 'hintOracle';

/** Every `ClockHolder`, for a reader checking one. */
export const CLOCK_HOLDERS: readonly ClockHolder[] = ['settings', 'map', 'champions', 'saveMenu', 'hintOracle'];

/** The changes the interface applies. */
type ScreenChange = Extract<InputChange, { kind: 'panelKey' | 'reincarnateKey' | 'reincarnateClick' }>;

/** The changes the engine applies. */
export type GameChange = Exclude<InputChange, ScreenChange>;

/** What the interface applies of the changes (`ScreenChange`). */
export interface ScreenInput {
    panelKey(action: string): void;
    reincarnateKey(key: string): void;
    reincarnateClick(x: number, y: number): void;
}

/** Told every change the page makes, before it is applied, with the VBLs run before it. */
export type InputListener = (change: InputChange, vbl: number) => void;

/** What a recording played back is told (`RecordingPlayer`, `play`). */
export interface PlayFeed {
    /** After every VBL, outside it: what was logged before the next applied. */
    afterVbl(): void;
    /** A save's file made inside a VBL and written nowhere: the Sleepsave's (`GameSaves.sleepSave`). */
    savedInVbl(file: Uint8Array): void;
    /** The game's end inside a VBL, with `d.Word11694` (`InputBoundary.ended`). */
    ended(word11694: boolean): void;
}

/** Told the game's end, inside the VBL that ended it, with `d.Word11694`. */
export type EndListener = (word11694: boolean) => void;

export class InputBoundary {
    /**
     * The VBLs run (`Game.runFrame`), every one: the frozen game's and the stopped
     * clock's too, unlike the play time's count (`Game.playTime`), and across reads.
     */
    private vblsRun = 0;
    /** A VBL is running: a change now is the game's own. */
    private running = false;
    private listener: InputListener | null = null;
    private endListener: EndListener | null = null;
    private screen: ScreenInput | null = null;
    /** The player's feed (`play`), or `null` while no recording plays. */
    private feed: PlayFeed | null = null;
    /** What the last stop of the clock named (`holder`). */
    private heldBy: ClockHolder | null = null;

    /** `applyToGame` applies the engine's changes, and returns what its door returns. */
    constructor(private readonly applyToGame: (change: GameChange) => boolean) {}

    /** The VBLs run so far. */
    get vbls(): number {
        return this.vblsRun;
    }

    /** Whether a VBL is running: a save made now is made inside it (`Recorder.point`). */
    get inVbl(): boolean {
        return this.running;
    }

    /**
     * Run one VBL: counted, and the changes made in it the game's own. Then, while a
     * recording plays, its feed applies what was logged before the next.
     */
    runVbl(frame: () => void): void {
        this.vblsRun++;
        this.running = true;
        try {
            frame();
        } finally {
            this.running = false;
        }
        this.feed?.afterVbl();
    }

    /**
     * A recording played back (`RecordingPlayer`): `feed` is told after every VBL,
     * outside it, to apply what was logged before the next, and each file a VBL saves.
     * `null` when it stops.
     */
    play(feed: PlayFeed | null): void {
        this.feed = feed;
    }

    /** A save's file made inside a VBL while a recording plays, told to its player. */
    savedInVbl(file: Uint8Array): void {
        this.feed?.savedInVbl(file);
    }

    /**
     * Whether a recording is playing: what the game opens in a VBL then does its game
     * half alone, and shows nothing (`openSaveMenu`, `GameScreen.handleMouseButton`).
     */
    get playing(): boolean {
        return this.feed !== null;
    }

    /**
     * What holds the clock, as the last `pause` that stopped it named it, the page's or
     * a VBL's; `null` where it named nothing, or before any.
     */
    get holder(): ClockHolder | null {
        return this.heldBy;
    }

    /** Tell `listener` every change from now on, or nobody (`null`). */
    listen(listener: InputListener | null): void {
        this.listener = listener;
    }

    /** Tell `listener` the game's end from now on, or nobody (`null`). */
    listenEnd(listener: EndListener | null): void {
        this.endListener = listener;
    }

    /**
     * The game's end (`Game.mainLoopReturns`), with `d.Word11694`: told to the end's
     * listener, the recorder, and to the player of a recording being played back.
     */
    ended(word11694: boolean): void {
        this.endListener?.(word11694);
        this.feed?.ended(word11694);
    }

    /** Who applies the interface's changes: the page's input path, or nobody headless. */
    setScreen(screen: ScreenInput | null): void {
        this.screen = screen;
    }

    /**
     * Apply `change`, told first to the listener unless a VBL is making it. Returns what
     * its door does: whether a click or a key was queued, whether a `?dev` move went; true
     * for the rest.
     */
    apply(change: InputChange): boolean {
        if (!this.running) this.listener?.(change, this.vblsRun);
        if (change.kind === 'pause' && change.paused) this.heldBy = change.dialog ?? null;
        switch (change.kind) {
            case 'panelKey': this.screen?.panelKey(change.action); return true;
            case 'reincarnateKey': this.screen?.reincarnateKey(change.key); return true;
            case 'reincarnateClick': this.screen?.reincarnateClick(change.x, change.y); return true;
            default: return this.applyToGame(change);
        }
    }
}

/**
 * The extras into the game, and the mouse queue made the length they choose: CSBWin's
 * `MOUSEQLEN`, or `LONG_MOUSEQLEN` with UNLIMITED KEY QUEUE.
 */
export function applyExtras(ctx: Pick<GameContext, 'extras' | 'mouseQueue'>, extras: Extras): void {
    ctx.extras = extras;
    ctx.mouseQueue.setLength(extras.unlimitedKeyQueue ? LONG_MOUSEQLEN : MOUSEQLEN);
}
