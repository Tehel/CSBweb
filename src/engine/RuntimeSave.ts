/**
 * The state a read installs beside its world, and its install. Every game read comes
 * through it, a save's (`CsbwinSaveGame.ts` builds one from the file) and a new game's
 * (`Game.readNewGame`), and the save writer takes the running game's as what to write
 * (`SaveGameFile.ts`). It is never a file: a save is `SaveGame.cpp`'s binary one. It has
 * no CSBWin home, so it is a module over the context rather than a system.
 *
 * The tools add the world to it, as one plain snapshot (`getRuntimeSaveState`), to take a
 * game back to a state they captured (`Game.applyRuntimeSaveState`). Which fields of the
 * dungeon the snapshot carries, and which it leaves to the file the world was built from,
 * is `DUNGEON_DATA_SOURCES` (`DungeonSnapshot.ts`).
 */
import type { DungeonData, Item16Record, TimerRecord } from '../data/dungeonTypes';
import type { ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import type { DungeonSnapshot } from './DungeonSnapshot';
import type { GameContext } from './GameContext';
import { VBL_PER_TICK } from './LoopState';
import type { Block1State, PartyState } from './gameTypes';
import { clonePartyState } from './Party';
import type { FootprintsSnapshot } from './PartyFootprints';
import type { TimerEntry, TimerQueue } from './TimerQueue';

/**
 * The runtime state but the world: what a read installs beside the world it reads
 * (`readGame`), and what a save file writes beside the world it reads for itself
 * (`toSaveFile`). Every part is a copy, both ways: a captured state shares
 * nothing with the game it came from, and a restored one nothing with the state it was
 * restored from.
 */
export interface RuntimeState {
    party: PartyState;
    game: {
        tickCount: number;
        /** `d.RandomNumber`, so a reload continues the same stream. */
        randomSeed: number;
        /** `d.Word11694`. */
        gameWon: boolean;
        /** `d.PartyFootprints` + `d.Byte13220` — the scent trail monsters follow. */
        footprints: FootprintsSnapshot;
        /** The DSA global variables, where a dungeon keeps its puzzle progress. */
        dsaGlobals: number[];
        /** `disableSaves`, which a DSA sets (`DsaSystem.disableSaves`). */
        disableSaves: boolean;
        /** The overlay palette (`GameContext.overlayPalette`). */
        overlayPalette: Uint8Array;
        /** What `GAMEBLOCK1` carries (`GameState.block1`). */
        block1: Block1State;
    };
    dungeon: RuntimeDungeonState;
}

/** What the state carries of the dungeon beside its world. */
interface RuntimeDungeonState {
    item16: Item16Record[];
    /** The timer table, by timer index — holes included, as CSBWin's array has them. */
    timers: TimerRecord[];
    /** Which of those timers are live, in the heap's array order (`GameTimers::TimerQueue`). */
    timerQueue: number[];
    /** `gameTimers.TimerSequence()` — the stamp the next queued timer will take. */
    timerSequence: number;
    /** `gameTimers.FirstAvailTimer()`, the free cursor. */
    firstAvailTimer: number;
}

/** The whole runtime state, its world with it (`getRuntimeSaveState`): the tools'. */
export interface RuntimeSaveState extends RuntimeState {
    dungeon: RuntimeDungeonState & {
        /** Everything play can change: cell flags, object chains, all DB records. */
        snapshot: DungeonSnapshot;
    };
}

/** The timer table and its queue as `RuntimeState` carries them (`buildTimerRecords`). */
export function timerQueueState(timers: TimerQueue): Pick<RuntimeDungeonState,
    'timers' | 'timerQueue' | 'timerSequence' | 'firstAvailTimer'> {
    const { records, queue } = buildTimerRecords(timers);
    return {
        timers: records,
        timerQueue: queue,
        timerSequence: timers.getNextSequence(),
        firstAvailTimer: timers.getFirstAvailTimer(),
    };
}

/** The runtime state, its world with it, for the tools. */
export function getRuntimeSaveState(ctx: GameContext): RuntimeSaveState {
    const state = getRuntimeState(ctx);
    return { ...state, dungeon: { ...state.dungeon, snapshot: ctx.dungeon.captureSnapshot() } };
}

/** The runtime state but the world, which a save file reads from the game itself. */
export function getRuntimeState(ctx: GameContext): RuntimeState {
    return {
        party: clonePartyState(ctx.party.state),
        game: {
            tickCount: ctx.state.tickCount,
            randomSeed: ctx.random.getSeed(),
            gameWon: ctx.state.gameWon,
            footprints: ctx.footprints.capture(),
            dsaGlobals: ctx.systems.dsa.getGlobalVariables(),
            disableSaves: ctx.systems.dsa.disableSaves,
            overlayPalette: ctx.overlayPalette.slice(),
            block1: { ...ctx.state.block1, byte22808: [...ctx.state.block1.byte22808] },
        },
        dungeon: {
            item16: cloneItem16(ctx.dungeon.getData().item16 ?? []),
            ...timerQueueState(ctx.timers),
        },
    };
}

function cloneItem16(item16: Item16Record[]): Item16Record[] {
    return item16.map((r) => ({ ...r, singleMonsterStatus: [...r.singleMonsterStatus] }));
}

/**
 * A read's state made ready to install (`prepareRuntimeState`): the timer queue's
 * entries built from its table, the rest as the state gives it.
 */
export interface PreparedState {
    save: RuntimeState;
    timers: TimerEntry[];
}

/**
 * The half of a restore that builds: the `ITEM16` pool the state carries beside its
 * world put into `world`, and the timer queue's entries. It touches nothing but `world`,
 * so a read builds it over a world not yet installed, and an error here leaves the
 * running game as it was (`readGame`). The pool is re-derived from the world's creature
 * records (`startRuntimeState`).
 */
export function prepareRuntimeState(world: DungeonData, save: RuntimeState): PreparedState {
    // `DUNGEON_DATA_SOURCES`' one `runtimeSave` field.
    world.item16 = cloneItem16(save.dungeon.item16);
    return { save, timers: timerEntriesOf(save.dungeon.timers, save.dungeon.timerQueue) };
}

/**
 * The half of a restore that installs, over the world `prepareRuntimeState` built,
 * once it is the running one: assignments that cannot throw. `startRuntimeState`
 * follows.
 */
export function installRuntimeState(ctx: GameContext, prepared: PreparedState): void {
    const { save } = prepared;
    // `d.PartySleeping = 0` wherever a game starts (doc/CSBwin-src/CSBCode.cpp:10603):
    // CSBWin never saves it. Loading over a sleeping party must hand the UI its
    // adventure button lists back, whatever the restored state says.
    const wasSleeping = ctx.party.state.sleeping;
    // `d.HandChar = b.gb2.handChar` (doc/CSBwin-src/SaveGame.cpp:1760): the cursor
    // owner is part of the state, as the party's.
    ctx.party.setState(save.party);
    ctx.party.state.sleeping = false;
    if (wasSleeping) ctx.host.sleepChanged(false);

    // `scrollingText.ResetTime(b.gb2.Time); d.Time = b.gb2.Time;`
    // (doc/CSBwin-src/SaveGame.cpp:1747-1748): CSBWin saves no message state, and the
    // rows on screen stay, their timeouts rebased onto the loaded clock.
    ctx.host.messages.resetTime(save.game.tickCount, ctx.state.tickCount);
    ctx.state.tickCount = save.game.tickCount;
    // `parameterMessageSequence = 0;` (doc/CSBwin-src/SaveGame.cpp:1749).
    ctx.systems.dsa.parameterMessageSequence = 0;
    // Asleep, `d.Speed` was 0. Awake again, the top of the next tick puts it back with
    // `SetNewSpeed(d.Speed, …)` (`CSBCode.cpp:622-626`).
    if (wasSleeping) ctx.host.messages.setNewSpeed(0, VBL_PER_TICK, ctx.state.tickCount);
    ctx.random.setSeed(save.game.randomSeed);
    ctx.state.gameWon = save.game.gameWon;
    ctx.state.block1 = { ...save.game.block1, byte22808: [...save.game.block1.byte22808] };
    ctx.systems.dsa.setGlobalVariables(save.game.dsaGlobals);
    ctx.systems.dsa.disableSaves = save.game.disableSaves;
    ctx.overlayPalette.set(save.game.overlayPalette);

    ctx.timers.restore(prepared.timers, save.dungeon.timerSequence,
        save.dungeon.timers.length, save.dungeon.firstAvailTimer);
    ctx.footprints.restore(save.game.footprints);
    // An extra's, never saved (`ThrownWeapons`).
    ctx.thrownWeapons.clear();
}

/**
 * The end of a restore, over the installed state: the `ITEM16` pool was replaced
 * wholesale, so which groups are active is re-derived, as CSBWin's game start does after
 * its own restore (`LoadPartyLevel(d.partyLevel)`, doc/CSBwin-src/CSBCode.cpp:10615).
 * It walks the world, so it is where a damaged one can still throw. The caller owes the
 * loop's own reset: `HandleMouseEvents`' `lastTime = 0` (`Game.startReadState`).
 */
export function startRuntimeState(ctx: GameContext): void {
    ctx.systems.monsters.reloadAfterSaveGame();
}

/**
 * Which byte pair of `TIMER` holds an object reference, by timer function.
 *
 * `timerObj6()` and `timerObj8()` (`doc/CSBwin-src/CSB.h:2083-2102`), by the functions
 * their `ASSERT`s allow: 48 and 49 — the missile in flight — keep it in bytes 6-7, and
 * 24, 25, 60, 61, 13 (the Vi altar's bones) and 65 (the generator) in bytes 8-9. Every
 * other function reads both pairs as plain numbers.
 */
function objectBytesOf(timerFunction: number): 6 | 8 | null {
    if (timerFunction === 48 || timerFunction === 49) return 6;
    if (timerFunction === 24 || timerFunction === 25 ||
        timerFunction === 60 || timerFunction === 61 ||
        timerFunction === 13 || timerFunction === 65) return 8;
    return null;
}

/**
 * Collapse a live timer's three representations into the four bytes a file has.
 *
 * `TIMER` has one pair of bytes at 6-7 and one at 8-9, and CSBWin reads each pair
 * either as two bytes or as a word depending on the timer function
 * (`timerObj6()`, `timerWord8()`, `doc/CSBwin-src/CSB.h:1881-1923`). This port's
 * live `TimerEntry` carries *both* readings side by side, plus an `object` field
 * that has no byte at all — convenient in the engine, and three things where the
 * file has one. So the collapse has to happen somewhere, and this is the boundary.
 *
 * Two rules, each with a source:
 *
 * - The **object** goes into the pair `objectBytesOf` names for that function.
 *   `MagicSystem.launchMissile` puts the RN on `TimerEntry.object` and the launch
 *   x,y in the bytes, so a missile written from its bytes alone would lose its object.
 * - For 48 and 49, **bytes 8-9 are `timerWord8`** — the packed
 *   `[x:5][y:5][direction:2][decay:4]` `processMissileTimer` reads back. Those two
 *   bytes are the word's when the missile is launched, but its flight rewrites the
 *   word alone, so they come from the word. Measured in
 *   `csbgame-flying-sword.dat`: function 49, bytes 6-7 = 0x079a (the object's slot)
 *   and bytes 8-9 = 0xa909 (the packed word).
 *
 * A word a timer is made with is in its bytes already (`newTimerEntry`).
 */
function collapseTimerBytes(record: TimerRecord, object: number | undefined): TimerRecord {
    const at = objectBytesOf(record.function);
    if (at === 6 && object !== undefined) {
        record.timerWord6 = object & 0xffff;
        record.uByte6 = (object >> 8) & 0xff;
        record.uByte7 = object & 0xff;
    } else if (at === 8 && object !== undefined) {
        record.timerWord8 = object & 0xffff;
        record.uByte8 = (object >> 8) & 0xff;
        record.uByte9 = object & 0xff;
    }
    if (at === 6) {
        record.uByte8 = (record.timerWord8 >> 8) & 0xff;
        record.uByte9 = record.timerWord8 & 0xff;
    }
    return record;
}

/**
 * The timer table, laid out by timer index as CSBWin's array is, plus the queue
 * order beside it. The whole `TIMER` is written, and `timerQueue` carries the heap's
 * array, which is what `TimerQueue.restore` puts back.
 *
 * The table is `m_maxTimers` records long, so its length is the `gb2.MaxTimers` a save
 * writes, and every slot with no live timer is an empty record — `TT_EMPTY` is
 * function 0 — as in CSBWin's array.
 */
function buildTimerRecords(timers: TimerQueue): { records: TimerRecord[]; queue: number[] } {
    const entries = timers.getTimers();
    const records: TimerRecord[] = Array.from({ length: timers.getMaxTimers() }, () => emptyTimerRecord());
    for (const entry of entries) {
        records[entry.index] = collapseTimerBytes({
            time: entry.time >>> 0,
            level: entry.level & 0xff,
            function: entry.function & 0xff,
            uByte5: entry.uByte5 & 0xff,
            uByte6: entry.uByte6 & 0xff,
            uByte7: entry.uByte7 & 0xff,
            uByte8: entry.uByte8 & 0xff,
            uByte9: entry.uByte9 & 0xff,
            sequence: entry.sequence & 0xffff,
            timerWord8: entry.timerWord8 & 0xffff,
            timerWord6: sw(entry.timerWord6),
        }, entry.object);
    }
    return { records, queue: entries.map((entry) => entry.index) };
}

/**
 * The live queue's entries, from a saved table and the heap's array order, for
 * `TimerQueue.restore`.
 *
 * The records are a table *by index*; the queue names which of them are live and in
 * what order. Both readings of bytes 6-9 come back, because which one a timer means
 * depends on its function and the queue entry carries both.
 */
function timerEntriesOf(records: TimerRecord[], order: number[]): TimerEntry[] {
    const entries: TimerEntry[] = [];
    for (const index of order) {
        const record = records[index];
        if (!record) continue;
        // The inverse of `collapseTimerBytes`: an object-carrying timer's RN comes
        // back off the byte pair `objectBytesOf` names and onto `TimerEntry.object`,
        // which is where every handler in this port looks for it
        // (`processMissileTimer`, `processTT_25`, `onMonsterAbeyance`). Without this
        // a restored missile has no object and vanishes on its next tick.
        const at = objectBytesOf(record.function & 0xff);
        const object =
            at === 6 ? (record.timerWord6 & 0xffff) as ObjectID :
            at === 8 ? (record.timerWord8 & 0xffff) as ObjectID : undefined;
        entries.push({
            index,
            time: record.time >>> 0,
            level: record.level & 0xff,
            function: record.function & 0xff,
            uByte5: record.uByte5 & 0xff,
            uByte6: record.uByte6 & 0xff,
            uByte7: record.uByte7 & 0xff,
            uByte8: record.uByte8 & 0xff,
            uByte9: record.uByte9 & 0xff,
            sequence: record.sequence & 0xffff,
            timerWord8: record.timerWord8 & 0xffff,
            timerWord6: sw(record.timerWord6),
            object,
        });
    }
    return entries;
}

/** A free slot in the timer table: `TT_EMPTY`, and nothing else set. */
function emptyTimerRecord(): TimerRecord {
    return {
        time: 0,
        level: 0,
        function: 0,
        uByte5: 0,
        uByte6: 0,
        uByte7: 0,
        uByte8: 0,
        uByte9: 0,
        sequence: 0,
        timerWord8: 0,
        timerWord6: 0,
    };
}
