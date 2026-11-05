/**
 * What a read of a save's file loses of the game that made it (`CutState`), which a path
 * cut at the save carries (`src/engine/RecordingCut.ts`, `doc/RECORDING.md` → "A path cut
 * at a save"): taken from the game at the save's point, once its tail has run, and set over
 * a fresh read of the file.
 *
 * **Nothing in this file touches the DOM.**
 */
import type { ObjectID } from '../core/types';
import type { Game } from './Game';
import type { InterfaceState } from './InterfaceState';
import type { MouseQueueState } from './MouseQueue';
import { setSmartDiscardSnapshot, smartDiscardSnapshot, type SmartDiscardSnapshot } from './SmartDiscard';

/** `ctx.interface` as plain data: each typed array an array, the open chest's object a number or `null`. */
export type InterfaceSnapshot = {
    readonly [K in keyof InterfaceState]: InterfaceState[K] extends Int8Array | Uint8Array | readonly ObjectID[] ? readonly number[]
        : InterfaceState[K] extends ObjectID | null ? number | null : InterfaceState[K];
};

/**
 * What a read of a save's file loses of the game that made it, at the save's point once
 * its tail has run, which a path cut there carries beside its `CarriedState`
 * (`CarriedState.cut`). None is in the file, in CSBWin or here.
 */
export interface CutState {
    /** `ctx.interface`: the attack menu, the eye and the mouth held, the open chest. */
    readonly interface: InterfaceSnapshot;
    /** `party.state.selectedCharacterIndex`, -1 for none. */
    readonly selected: number;
    /** Each champion's `load`, in the party's order, which this port keeps of its own. */
    readonly loads: readonly number[];
    /** `ctx.smartDiscard`, the file's statics. */
    readonly smartDiscard: SmartDiscardSnapshot;
    /** `d.watchdogTime`. */
    readonly watchdogTime: number;
    /** The mouse queue, its ring and its indices. */
    readonly mouseQueue: MouseQueueState;
    /**
     * The tick the last entry was taken at (`Game.lastInputTime`), which holds the next
     * till the tick after (`HandleMouseEvents`), and a read sets to 0.
     */
    readonly lastInputTime: number;
    /**
     * The game has no game information (`data.gameInfo`): a game read from a
     * `dungeon.dat` without it, whose saves write a size of 0, which a read of one turns
     * into "No game information was provided" (`readGameInfo`), so that its saves would
     * write that.
     */
    readonly noGameInfo: boolean;
}

/** `game`'s `CutState` now. */
export function cutStateOf(game: Game): CutState {
    const { ctx } = game;
    const face = ctx.interface;
    return {
        interface: {
            ...face,
            openChestContents: [...face.openChestContents],
            possibleAttackTypes: [...face.possibleAttackTypes],
            byte20256: [...face.byte20256],
        },
        selected: ctx.party.state.selectedCharacterIndex,
        loads: ctx.party.state.champions.map((champion) => champion.load),
        smartDiscard: smartDiscardSnapshot(ctx.smartDiscard),
        watchdogTime: ctx.state.watchdogTime,
        mouseQueue: ctx.mouseQueue.state(),
        lastInputTime: game.lastInputTime,
        noGameInfo: ctx.dungeon.getData().gameInfo === undefined,
    };
}

/**
 * `cut` set over `game`, read from the save's file, whose party must be the cut's; and its
 * next start made to resume the loop there (`Game.resumeAtSavePoint`).
 */
export function setCutState(game: Game, cut: CutState): void {
    const { ctx } = game;
    const { champions } = ctx.party.state;
    if (champions.length !== cut.loads.length) throw new Error('the save\'s party is not the cut\'s');
    const face = ctx.interface;
    const { openChestId, openChestContents, possibleAttackTypes, byte20256, ...rest } = cut.interface;
    Object.assign(face, rest);
    face.openChestId = openChestId === null ? null : openChestId as ObjectID;
    face.openChestContents = openChestContents.map((object) => object as ObjectID);
    face.possibleAttackTypes.set(possibleAttackTypes);
    face.byte20256.set(byte20256);
    ctx.party.state.selectedCharacterIndex = cut.selected;
    champions.forEach((champion, n) => { champion.load = cut.loads[n]!; });
    setSmartDiscardSnapshot(ctx.smartDiscard, cut.smartDiscard);
    ctx.state.watchdogTime = cut.watchdogTime;
    ctx.mouseQueue.setState(cut.mouseQueue);
    game.lastInputTime = cut.lastInputTime;
    if (cut.noGameInfo) delete ctx.dungeon.getData().gameInfo;
    // The game that made the save was in the middle of its loop.
    game.resumeAtSavePoint();
}
