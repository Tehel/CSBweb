/**
 * A path cut at a save on its way (`doc/RECORDING.md` → "A path cut at a save"): what a
 * player plays and shares of part of a recording, from a save the path passes, not from
 * its root.
 *
 * A save's file read into a fresh game is not the game that made it at an arbitrary VBL:
 * the read detaches and re-attaches every monster, which re-makes their timers. At a save's
 * point, once its tail has run (`saveWritten`, `MonsterSystem.reattachAfterSave`), the
 * world, the monsters and the timers are a fresh read's, and what the read loses is little
 * (`CutState`, `src/engine/CutState.ts`): the attack menu, the champion selected, the champions' load, SmartDiscard's
 * statics, the watchdog timer, the mouse queue and the tick its last entry was taken at,
 * and a `dungeon.dat`'s want of game information. A cut there starts from the save's file,
 * what its read left (`CarriedState`) and that state, and plays the changes after the
 * save's tail, which the read stands in for. A save whose tail is not a change of its own,
 * the Sleepsave's, made inside a VBL, cannot be cut at so.
 *
 * Where the path passes the save at a join, a branch that read it, the cut is that
 * branch's own start, which plays alone (`doc/RECORDING.md` → "The tree").
 *
 * The state at the save is the game's, played there: the path replayed headless up to it
 * (`cutAtSave`), in a page of the set's that draws nothing it need not (`CutPage`), the
 * file made there checked against the save's. Then the cut is played to its end, as its
 * package will be, before it is shared (`playCut`).
 *
 * **Nothing in this file touches the DOM.**
 */
import { cutStateOf } from './CutState';
import type { Extras, RulesOptions } from './GameContext';
import type { Game } from './Game';
import { saveFileOf } from './GameSaves';
import { carriedStateOf, type CarriedState, type Recording, type RecordingPoint } from './Recorder';
import { RecordingPlayer, type Drift, type SavedAtEnd } from './RecordingPlayer';

/** A cut refused: why. */
export class RecordingCutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RecordingCutError';
    }
}

/**
 * Where a path can start at a save it passes: at a join, the branch `index` of the path,
 * which read it; or in the recording `index`, after the save's tail, its change `change`.
 */
export type CutPlace =
    | { readonly kind: 'join'; readonly index: number }
    | { readonly kind: 'tail'; readonly index: number; readonly change: number };

/**
 * Where `path`, as a package holds it or `pointPath` gives it, each recording cut at its
 * child's join and the last at its point, can start at the save made at `save`: at the
 * join of a branch that read it, or after its tail where that is the next change, inside
 * the path, not its last, at the save's VBL or, the disk menu's, some VBLs after it under
 * the menu's held clock; `null` where it cannot. A save taken inside a VBL, the
 * Sleepsave's, has no tail of its own, and starts a path at a join alone.
 */
export function cutPlace(path: readonly Recording[], save: RecordingPoint): CutPlace | null {
    for (let index = 1; index < path.length; index++) {
        const join = path[index]!.parent;
        if (join && join.recording === save.recording && join.changes === save.changes && join.vbls === save.vbls
            && (join.inVbl === true) === (save.inVbl === true)) return { kind: 'join', index };
    }
    const index = path.findIndex((recording) => recording.id === save.recording);
    if (index < 0 || save.inVbl) return null;
    const tail = path[index]!.changes[save.changes];
    // The disk menu's SAVE runs the tail once the store has written the file, VBLs later
    // in a browser, under the menu's held clock (`GameSaves.save`).
    if (tail?.change.kind !== 'saveWritten' || tail.vbl < save.vbls) return null;
    // The tail ends the path: the cut would hold nothing to play.
    if (index === path.length - 1 && save.changes === path[index]!.changes.length - 1 && tail.vbl === path[index]!.vbls) return null;
    return { kind: 'tail', index, change: save.changes };
}

/** What a cut starts from: the save's file, what its read is to carry, and the rules and the extras at the save. */
export interface CutStart {
    readonly bytes: Uint8Array;
    readonly carried: CarriedState;
    readonly rules: RulesOptions;
    readonly extras: Extras;
}

/**
 * `path` cut at `place` (`cutPlace`), started from `start`: its recording there a root that
 * starts from the save, its changes after the save's tail, its VBLs counted from it, and
 * the branches after it as they are, the first's join counted from it too.
 */
export function cutPathAt(path: readonly Recording[], place: CutPlace, start: CutStart): Recording[] {
    const at = path[place.index]!;
    const skipped = place.kind === 'tail' ? { changes: place.change + 1, vbls: at.changes[place.change]!.vbl } : { changes: 0, vbls: 0 };
    const root: Recording = {
        ...at,
        start: { kind: 'save', bytes: start.bytes, carried: start.carried },
        parent: null,
        rules: { ...start.rules },
        extras: { ...start.extras },
        changes: at.changes.slice(skipped.changes).map((entry) => ({ ...entry, vbl: entry.vbl - skipped.vbls })),
        vbls: at.vbls - skipped.vbls,
    };
    const rest = path.slice(place.index + 1).map((recording, n) => {
        const join = recording.parent;
        return n > 0 || !join ? recording
            : { ...recording, parent: { ...join, changes: join.changes - skipped.changes, vbls: join.vbls - skipped.vbls } };
    });
    return [root, ...rest];
}

/** A fresh page of the path's set, its loop on a clock the cut moves, that plays a path headless: the tools' `standPage`, the page's `standInPage`. */
export interface CutPage {
    readonly game: Game;
    readonly dungeonDat: Uint8Array;
    /** `ms` of the loop's clock on: whether the loop still runs. */
    advance(ms: number): boolean;
}

/** What a cut tells as it plays: the VBLs played of those it has to, and a pause the page may take to draw it. */
export interface CutProgress {
    readonly played: (vbls: number, of: number) => void;
    readonly breathe: () => Promise<void>;
}

/** A VBL of the clock, rounded up, as the loop is woken. */
const VBL_MS = 17;

/** The VBLs played between two breaths (`CutProgress.breathe`): a few hundredths of a second's work. */
const BREATH_VBLS = 1000;

/** The VBLs `path` runs, its recordings', which a play of it to its end runs. */
export function pathVbls(path: readonly Recording[]): number {
    return path.reduce((sum, recording) => sum + recording.vbls, 0);
}

/**
 * `path` played in `page` to its end, or to its first drift, `savedAtEnd` the save it ends
 * at; told as it goes, the VBLs played of the path's.
 */
async function playIn(page: CutPage, path: readonly Recording[], savedAtEnd: SavedAtEnd | null, progress: CutProgress | null): Promise<RecordingPlayer> {
    const of = pathVbls(path);
    const { game } = page;
    const player = new RecordingPlayer(game, path, page.dungeonDat, savedAtEnd);
    player.onEnd(() => game.stop());
    game.runAtOnceWhile(() => player.held);
    player.start();
    if (player.playing) game.start(true);
    let breath = player.vbls + BREATH_VBLS;
    while (player.playing) {
        if (!page.advance(VBL_MS)) throw new Error('the loop stopped while the player plays');
        if (progress && player.vbls >= breath) {
            breath = player.vbls + BREATH_VBLS;
            progress.played(player.vbls, of);
            await progress.breathe();
        }
    }
    return player;
}

/** What a drift says to a player, who chose where the path starts and ends. */
function driftReason(drift: Drift): string {
    switch (drift.kind) {
        case 'change': return 'the game drifts from the recording';
        case 'join': return 'a saved game read on the way is not the one the game makes';
        case 'save': return 'the saved game is not the one the game makes';
        case 'end': return 'the game does not end where the recording does';
    }
}

/**
 * `path`, as `pointPath` gives it or a package holds it, cut at the save made at `save`
 * (`cutPlace`), whose file is `file` where it is known: played headless in a page `stand`
 * stands up, to the save, the file made there checked against `file` or a join's MD5, and
 * the state there taken (`CutState`, after the save's tail), unless the save starts a
 * branch whose file the path holds. Refused, `RecordingCutError`, where the path cannot
 * start there or drifts before it. `progress` is told the VBLs played.
 */
export async function cutAtSave(
    path: readonly Recording[], save: RecordingPoint, file: Uint8Array | null, stand: () => Promise<CutPage>,
    progress: CutProgress | null = null,
): Promise<Recording[]> {
    const place = cutPlace(path, save);
    if (!place) throw new RecordingCutError('the recording cannot start at that saved game');
    const at = path[place.index]!;
    if (place.kind === 'join') {
        const { start } = at;
        if (start.kind === 'new' || !start.carried) throw new RecordingCutError('the branch that read the saved game starts from no save');
        if (start.kind === 'save') return cutPathAt(path, place, { bytes: start.bytes, carried: start.carried, rules: at.rules, extras: at.extras });
        // A package's branch names its file by its MD5: the parent made it there.
        const page = await stand();
        const player = await playIn(page, path.slice(0, place.index), { md5: start.md5, inVbl: at.parent?.inVbl === true }, progress);
        if (player.drift) throw new RecordingCutError(`it cannot start there: ${driftReason(player.drift)} before it`);
        const bytes = player.lastMade;
        if (!bytes) throw new Error('the path made no file at its end');
        return cutPathAt(path, place, { bytes, carried: start.carried, rules: at.rules, extras: at.extras });
    }
    // Up to the tail's VBL: where it comes VBLs after the save, the clock held through them,
    // the file made there is still the save's, which the play checks.
    const upTo: Recording = { ...at, changes: at.changes.slice(0, save.changes), vbls: at.changes[save.changes]!.vbl, ended: true, end: null };
    const page = await stand();
    const { game } = page;
    const player = await playIn(page, [...path.slice(0, place.index), upTo], file ? { file, inVbl: false } : null, progress);
    if (player.drift) throw new RecordingCutError(`it cannot start there: ${driftReason(player.drift)} before it`);
    const { ctx } = game;
    // Checked against the save's file, the file made there is the player's; else it is made here.
    const bytes = file ? player.lastMade : saveFileOf(game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion));
    if (!bytes) throw new Error('the path made no file at its end');
    const carried = carriedStateOf(game);
    const rules = { ...ctx.rules };
    const extras = { ...ctx.extras };
    // The save's tail, which the read stands in for: the state is the game's after it.
    game.input.apply({ kind: 'saveWritten' });
    return cutPathAt(path, place, { bytes, carried: { ...carried, cut: cutStateOf(game) }, rules, extras });
}

/**
 * `path` played in a page `stand` stands up to its end, `savedAtEnd` the save it ends at:
 * the drift that stops it, or `null`. A cut is played so before it is shared.
 */
export async function playCut(
    path: readonly Recording[], savedAtEnd: SavedAtEnd | null, stand: () => Promise<CutPage>,
    progress: CutProgress | null = null,
): Promise<Drift | null> {
    return (await playIn(await stand(), path, savedAtEnd, progress)).drift;
}

/** Why a cut's play drifted, as the page says it. */
export function cutDriftReason(drift: Drift): string {
    return driftReason(drift);
}
