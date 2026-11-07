/**
 * A checkpoint of a recording played back (`doc/RECORDING.md` → "The port's player"): the
 * game between two VBLs, kept in memory, which a fresh page reads to play on from there
 * as the game played on (`RecordingPlayer.resume`). What the viewer's back goes back to
 * (`seekBack`, `src/renderer/ui/RecordingStrip.ts`), one a minute of the game, the latest
 * 21 (`KeptCheckpoints`).
 *
 * It starts from what a path cut at a save starts from (`src/engine/RecordingCut.ts`): a
 * save's file made at the point, what its read leaves beside it (`CarriedState`) and what
 * it loses (`CutState`). At an arbitrary VBL that is not enough: the read re-attaches the
 * monsters of the party's level (`reloadAfterSaveGame`), which draws and makes timers, and
 * some state outlives a tick in no file. So the runtime state taken beside the file
 * (`getRuntimeSaveState`) is installed over the read, its world, its pool, its stream and
 * its timers, as the game holds them (a file's form collapses bytes 8-9,
 * `buildTimerRecords`), and then what no file holds, each system's own and the screen's,
 * which the page keeps (`GameHost.keptView`): `doc/RECORDING.md` → "Checkpoints" lists them.
 * `tools/checks/checkpoints.ts` proves the engine read equal to the one that took it, all
 * but the start's flag, and its play on the uninterrupted play's.
 *
 * Making the file writes the world's `EXPOOL`, and makes one where the dungeon has none
 * (`buildSaveFile`): the take puts the pool back, so that taking a checkpoint changes
 * nothing, and the read puts it back over the file's.
 *
 * Port-only and never written: the saves' compatibility with CSBWin does not reach it.
 *
 * **Nothing in this file touches the DOM.**
 */
import { VBL_FREQUENCY } from '../core/constants';
import type { ObjectID } from '../core/types';
import type { DungeonData } from '../data/dungeonTypes';
import type { HeroText } from '../data/HeroExtractor';
import type { KeptSkinCache } from './SkinCache';
import type { AttackParameters } from './filterParameters';
import type { DsaCheckpointState } from './DsaSystem';
import type { AiCheckpointState } from './MonsterAI';
import { cutStateOf, setCutState } from './CutState';
import type { Game, GameCheckpointState } from './Game';
import type { Extras, RulesOptions } from './GameContext';
import { saveFileOf } from './GameSaves';
import { applyExtras } from './InputBoundary';
import type { MonsterCheckpointState } from './MonsterSystem';
import { carriedStateOf, setCarriedState, type CarriedState } from './Recorder';
import { getRuntimeSaveState, installRuntimeState, prepareRuntimeState, type RuntimeSaveState } from './RuntimeSave';
import { applySaveBytes } from './SaveGameFile';
import type { TimerEntry } from './TimerQueue';
import type { ClockHolder } from './InputBoundary';

/** Where the player stood in its path (`RecordingPlayer.cursor`), which it resumes at. */
export interface PlayerCursor {
    /** The recording of the path it played, its index. */
    readonly segment: number;
    /** Its changes applied. */
    readonly changes: number;
    /** Its VBLs run, since the recording began. */
    readonly vbls: number;
    /** The VBLs run since the path's start (`RecordingPlayer.vbls`). */
    readonly played: number;
    /** The joins played (`RecordingPlayer.joins`). */
    readonly joins: number;
    /** The file the last check was made against (`RecordingPlayer.lastMade`). */
    readonly lastMade: Uint8Array | null;
    /** Under a held clock, the VBLs it has been held, and what held it (`RecordingPlayer.onSkipped`); else `null`. */
    readonly held: { readonly vbls: number; readonly holder: ClockHolder | null } | null;
}

/** A game kept between two VBLs, as a recording played it (`takeCheckpoint`). */
export interface Checkpoint {
    readonly cursor: PlayerCursor;
    /** The save's file made at the point, its `EXPOOL` written as a save writes it. */
    readonly file: Uint8Array;
    /** What a read leaves beside the file, and what it loses, as a cut carries them. */
    readonly carried: CarriedState;
    readonly rules: RulesOptions;
    readonly extras: Extras;
    /** The runtime state and the world, taken before the file was made. */
    readonly runtime: RuntimeSaveState;
    /** The world's `EXPOOL` before the file wrote it, `null` where it had none, and its count (`header.objectCounts[11]`). */
    readonly expool: Uint8Array | null;
    readonly expoolCount: number;
    /** The live timers, as the game holds them, and the missile filter's. */
    readonly timers: readonly TimerEntry[];
    readonly missileFilterObject: ObjectID;
    readonly missileFilterTimer: TimerEntry | null;
    readonly ai: AiCheckpointState;
    /** `MissileEncounter`'s last `monsterDamageResult`. */
    readonly monsterDamageResult: number;
    /** The world's Extended Features block, a new game's, which a save's read leaves off the world. */
    readonly extendedFeatures: DungeonData['extendedFeatures'];
    readonly attackParameters: AttackParameters;
    readonly dsa: DsaCheckpointState;
    /** The actuators' delayed action and its square. */
    readonly delayedAction: readonly number[];
    readonly skins: KeptSkinCache;
    readonly monsterUnderAttack: ObjectID;
    readonly reincarnationSource: HeroText | null;
    readonly monsters: MonsterCheckpointState;
    /** `Party.generation`. */
    readonly generation: number;
    readonly game: GameCheckpointState;
    /** What the screen keeps from one `DrawViewport` to the next (`GameHost.keptView`). */
    readonly view: unknown;
}

/**
 * `game`'s checkpoint now, between two VBLs, the player at `cursor`; `null` where a
 * `LoopScript` holds the loop (`Game.isRunningScript`), whose generator cannot be kept. Taking
 * it changes nothing of the game.
 */
export function takeCheckpoint(game: Game, cursor: PlayerCursor): Checkpoint | null {
    if (game.isRunningScript()) return null;
    const { ctx } = game;
    const world = ctx.dungeon.getData();
    const expool = world.expool?.slice() ?? null;
    const expoolCount = world.header.objectCounts[11]!;
    const runtime = getRuntimeSaveState(ctx);
    const file = saveFileOf(game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion));
    putPoolBack(game, expool, expoolCount);
    const { timers, systems } = ctx;
    return {
        cursor,
        file,
        carried: { ...carriedStateOf(game), cut: cutStateOf(game) },
        rules: { ...ctx.rules },
        extras: { ...ctx.extras },
        runtime,
        expool,
        expoolCount,
        timers: structuredClone(timers.getTimers()),
        missileFilterObject: timers.missileFilterObject,
        missileFilterTimer: structuredClone(timers.missileFilterTimer),
        ai: systems.monsterAI.checkpointState(),
        monsterDamageResult: systems.missileEncounter.monsterDamageResult,
        extendedFeatures: structuredClone(world.extendedFeatures),
        attackParameters: systems.monsterAttack.checkpointState(),
        dsa: systems.dsa.checkpointState(),
        delayedAction: systems.actuators.checkpointState(),
        skins: ctx.dungeon.skinCache.kept(),
        monsterUnderAttack: systems.attack.checkpointState(),
        reincarnationSource: systems.hallOfChampions.checkpointState(),
        monsters: systems.monsters.checkpointState(),
        generation: ctx.party.generation,
        game: game.checkpointState(),
        view: ctx.host.keptView(),
    };
}

/**
 * `checkpoint` read into `game`, whose behaviour its player has set: its file read, the
 * runtime state installed over the read and what no read restores set, and the next start
 * made to resume the loop there (`Game.resumeAtSavePoint`). Nothing of `checkpoint` is
 * shared with the game, which may read it again.
 */
export function readCheckpoint(game: Game, checkpoint: Checkpoint): void {
    const { ctx } = game;
    applySaveBytes(game, checkpoint.file);
    // The runtime state over the read, its re-attach undone: the world, the pool, the
    // stream, the timers.
    const world = ctx.dungeon.getData();
    ctx.dungeon.applySnapshot(checkpoint.runtime.dungeon.snapshot);
    const prepared = prepareRuntimeState(world, checkpoint.runtime);
    ctx.dungeon.install(world);
    installRuntimeState(ctx, prepared);
    // A party asleep, which a read wakes (`installRuntimeState`), as CSBWin saves no sleep.
    if (checkpoint.runtime.party.sleeping) {
        ctx.party.state.sleeping = true;
        ctx.host.sleepChanged(true);
    }
    putPoolBack(game, checkpoint.expool, checkpoint.expoolCount);
    const { timers, systems } = ctx;
    timers.restore(structuredClone(checkpoint.timers), timers.getNextSequence(), timers.getMaxTimers(), timers.getFirstAvailTimer());
    timers.missileFilterObject = checkpoint.missileFilterObject;
    timers.missileFilterTimer = structuredClone(checkpoint.missileFilterTimer);
    systems.monsterAI.setCheckpointState(checkpoint.ai);
    systems.missileEncounter.monsterDamageResult = checkpoint.monsterDamageResult;
    if (checkpoint.extendedFeatures) world.extendedFeatures = structuredClone(checkpoint.extendedFeatures);
    else delete world.extendedFeatures;
    systems.monsterAttack.setCheckpointState(checkpoint.attackParameters);
    systems.dsa.setCheckpointState(checkpoint.dsa);
    systems.actuators.setCheckpointState(checkpoint.delayedAction);
    ctx.dungeon.skinCache.setKept(checkpoint.skins);
    systems.attack.setCheckpointState(checkpoint.monsterUnderAttack);
    systems.hallOfChampions.setCheckpointState(checkpoint.reincarnationSource);
    systems.monsters.setCheckpointState(checkpoint.monsters);
    ctx.party.generation = checkpoint.generation;
    game.setCheckpointState(checkpoint.game);
    Object.assign(ctx.rules, checkpoint.rules);
    applyExtras(ctx, { ...checkpoint.extras });
    setCarriedState(game, checkpoint.carried);
    // The champions' load, the champion selected and the interface over the runtime
    // party; and the start made to resume at the point.
    setCutState(game, checkpoint.carried.cut!);
    // The screen's, over the read's (`GameHost.savedGameRead`), once the party's is set.
    if (checkpoint.view !== null) ctx.host.setKeptView(checkpoint.view);
}

/** The world's `EXPOOL` put back as `expool` was, a copy, or taken away where it was `null`, with its count. */
function putPoolBack(game: Game, expool: Uint8Array | null, count: number): void {
    const world = game.ctx.dungeon.getData();
    if (expool) world.expool = expool.slice();
    else delete world.expool;
    world.header.objectCounts[11] = count;
}

/** A minute of the game, in VBLs: the player keeps a checkpoint each (`KeptCheckpoints`). */
export const CHECKPOINT_VBLS = 60 * VBL_FREQUENCY;

/** The checkpoints kept, a minute apart: twenty minutes back from any VBL. */
export const KEPT_CHECKPOINTS = 21;

/**
 * The checkpoints a page keeps of the path it plays (`RecordingPlayer`'s `kept`), across
 * its players: one taken at the first feed at or past each mark `every` VBLs of the path
 * after the latest kept (`RecordingPlayer.vbls`), playing or forwarding, where it can be
 * taken, and the latest `most` kept. A seek back reads the latest at or before its target
 * (`before`) and drops those after it, which the play from there takes again as it passes
 * their marks. A drift in that play drops the checkpoint read (`drifted`), which misled it,
 * and those its play took.
 */
export class KeptCheckpoints {
    private kept: Checkpoint[] = [];
    /** The checkpoint the play was read from (`before`), or `null`: the path's start. */
    private read: Checkpoint | null = null;

    constructor(readonly every = CHECKPOINT_VBLS, readonly most = KEPT_CHECKPOINTS) {}

    /** The checkpoints kept, oldest first. */
    get checkpoints(): readonly Checkpoint[] {
        return this.kept;
    }

    /**
     * After a VBL's feed, `vbls` into the path: a checkpoint taken (`take`) where a mark
     * has been reached since the latest kept, and the oldest dropped past `most`. `take`
     * gives `null` where none can be taken here, and the next feed tries again.
     */
    passed(vbls: number, take: () => Checkpoint | null): void {
        const latest = this.kept[this.kept.length - 1];
        const due = latest ? (Math.floor(latest.cursor.played / this.every) + 1) * this.every : this.every;
        if (vbls < due) return;
        const checkpoint = take();
        if (!checkpoint) return;
        this.kept.push(checkpoint);
        if (this.kept.length > this.most) this.kept.shift();
    }

    /**
     * The latest checkpoint at or before `vbls` of the path, which a seek back there reads
     * (`RecordingPlayer.resume`), those after it dropped; `null` where none is, the path's
     * start, every checkpoint then dropped.
     */
    before(vbls: number): Checkpoint | null {
        const keep = this.kept.filter((checkpoint) => checkpoint.cursor.played <= vbls);
        this.kept = keep;
        this.read = keep[keep.length - 1] ?? null;
        return this.read;
    }

    /** The play read from a checkpoint drifted: that checkpoint dropped, and those its play took after it. */
    drifted(): void {
        if (!this.read) return;
        this.kept = this.kept.filter((checkpoint) => checkpoint.cursor.played < this.read!.cursor.played);
        this.read = null;
    }

    /** Every checkpoint dropped: the path played again from its start. */
    clear(): void {
        this.kept = [];
        this.read = null;
    }
}
