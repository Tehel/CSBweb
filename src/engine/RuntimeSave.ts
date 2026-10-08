/**
 * The state a read restores: the whole mutable world as one plain snapshot, and its
 * restore. Every game read comes through it, a save's (`CsbwinSaveGame.ts` builds one
 * from the file) and a new game's (`Game.readNewGame`), and the save writer takes the
 * running game's as what to write (`SaveGameFile.ts`). It is never a file: a save is
 * `SaveGame.cpp`'s binary one. It has no CSBWin home, so it is a module over the context
 * rather than a system. Which fields of the dungeon it carries, and which it leaves to
 * the file the world was built from, is `DUNGEON_DATA_SOURCES` (`DungeonSnapshot.ts`).
 */
import type { DungeonData, Item16Record, MissileRecord, TimerRecord } from '../data/dungeonTypes';
import { DBType, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import type { DungeonSnapshot } from './DungeonSnapshot';
import type { GameContext } from './GameContext';
import { VBL_PER_TICK } from './LoopState';
import type { Block1State, PartyState } from './gameTypes';
import { ensureHandOwner } from './Party';
import type { FootprintsSnapshot } from './PartyFootprints';
import type { TimerEntry } from './TimerQueue';

export interface RuntimeSaveState {
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
    dungeon: {
        item16?: Item16Record[];
        /** The timer table, by timer index — holes included, as CSBWin's array has them. */
        timers?: TimerRecord[];
        /** Which of those timers are live, in the heap's array order (`GameTimers::TimerQueue`). */
        timerQueue?: number[];
        /** `gameTimers.TimerSequence()` — the stamp the next queued timer will take. */
        timerSequence?: number;
        /** `gameTimers.FirstAvailTimer()`, the free cursor; absent, the lowest free slot. */
        firstAvailTimer?: number;
        missiles?: MissileRecord[];
        /** Everything play can change: cell flags, object chains, all DB records. */
        snapshot: DungeonSnapshot;
    };
}

/** Snapshot the runtime state. */
export function getRuntimeSaveState(ctx: GameContext): RuntimeSaveState {
    const item16 = ctx.state.dungeon.item16
        ? ctx.state.dungeon.item16.map((r) => ({
              ...r,
              singleMonsterStatus: [...r.singleMonsterStatus],
          }))
        : undefined;
    const { records: timers, queue: timerQueue } = buildTimerRecords(ctx);
    const missiles = ctx.state.dungeon.databases.missiles.records.map((rec) => ({
        nextObject: rec.nextObject,
        projectileObject: rec.projectileObject,
        rangeRemaining: rec.rangeRemaining,
        damageRemaining: rec.damageRemaining,
        timerIndex: rec.timerIndex,
    }));
    return {
        party: ctx.party.state,
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
            item16,
            timers,
            timerQueue,
            timerSequence: ctx.timers.getNextSequence(),
            firstAvailTimer: ctx.timers.getFirstAvailTimer(),
            missiles,
            snapshot: ctx.dungeon.captureSnapshot(),
        },
    };
}

/**
 * Restore the runtime state. The caller owes the loop's own reset:
 * `HandleMouseEvents`' `lastTime = 0` (`Game.applyRuntimeSaveState`).
 */
export function applyRuntimeSaveState(ctx: GameContext, save: RuntimeSaveState): void {
    // `d.PartySleeping = 0` wherever a game starts (doc/CSBwin-src/CSBCode.cpp:10603):
    // CSBWin never saves it. Loading over a sleeping party must hand the UI its
    // adventure button lists back, whatever the restored state says.
    const wasSleeping = ctx.party.state.sleeping;
    ctx.party.setState(save.party);
    ctx.party.state.sleeping = false;
    if (wasSleeping) ctx.host.sleepChanged(false);
    // `d.HandChar = b.gb2.handChar` (doc/CSBwin-src/SaveGame.cpp:1760): the cursor
    // owner is part of the saved state. `setState` carries it, and this repairs the
    // states written before it was ever set.
    ensureHandOwner(ctx.party.state, ctx.host);

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

    // The world first: cell flags, object chains and every database record. This
    // has to land before the ITEM16/timer restore below, because the monster pool
    // is re-derived from the creature records it puts back.
    ctx.dungeon.applySnapshot(save.dungeon.snapshot);

    const item16 = save.dungeon.item16 ?? [];
    const timers = save.dungeon.timers ?? [];
    const missiles = save.dungeon.missiles ?? [];
    restoreTimerQueue(
        ctx,
        timers,
        save.dungeon.timerQueue ?? [],
        save.dungeon.timerSequence ?? 0,
        save.dungeon.firstAvailTimer,
    );
    applySaveGameState(ctx.state.dungeon, item16, missiles);
    // The restore replaced the ITEM16 pool wholesale; re-derive which groups are
    // active, as CSBWin's game start does after its own restore
    // (`LoadPartyLevel(d.partyLevel)`, doc/CSBwin-src/CSBCode.cpp:10615).
    ctx.footprints.restore(save.game.footprints);
    ctx.systems.monsters.reloadAfterSaveGame();
}

/**
 * The two tables the save carries beside the snapshot, put back into the world: the
 * `ITEM16` pool and the missile records (`DUNGEON_DATA_SOURCES`' `runtimeSave` fields).
 */
function applySaveGameState(dungeon: DungeonData, item16: Item16Record[], missiles: MissileRecord[]): void {
    dungeon.item16 = item16;
    dungeon.databases.missiles.records = missiles.map((rec) => ({
        nextObject: rec.nextObject,
        projectileObject: rec.projectileObject,
        rangeRemaining: rec.rangeRemaining,
        damageRemaining: rec.damageRemaining,
        timerIndex: rec.timerIndex,
    }));
    dungeon.databases.missiles.count = missiles.length & 0xffff;
    dungeon.header.objectCounts[DBType.MISSILE] = missiles.length & 0xffff;
}

/**
 * Which byte pair of `TIMER` holds an object reference, by timer function.
 *
 * `ConvertTimers` (`doc/CSBwin-src/SaveGame.cpp:2239-2262`): 48 and 49 — the missile
 * in flight — keep it in bytes 6-7, and 24, 25, 60 and 61 in bytes 8-9. Every other
 * function reads both pairs as plain numbers.
 */
function objectBytesOf(timerFunction: number): 6 | 8 | null {
    if (timerFunction === 48 || timerFunction === 49) return 6;
    if (timerFunction === 24 || timerFunction === 25 ||
        timerFunction === 60 || timerFunction === 61) return 8;
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
 * Three rules, each with a source:
 *
 * - The **object** goes into the pair `ConvertTimers` names for that function.
 *   Without this a thrown sword was written with its launch square in bytes 6-7 and
 *   the object nowhere, so the file lost it: `MagicSystem.launchMissile` puts the
 *   RN on `TimerEntry.object` and passes the launch x,y as the bytes.
 * - For 48 and 49, **bytes 8-9 are `timerWord8`** — the packed
 *   `[x:5][y:5][direction:2][decay:4]` `processMissileTimer` reads back. Those two
 *   bytes are passed as `pos` and `action`, which a missile timer leaves at zero,
 *   so they have to come from the word instead. Measured in
 *   `csbgame-flying-sword.dat`: function 49, bytes 6-7 = 0x079a (the object's slot)
 *   and bytes 8-9 = 0xa909 (the packed word).
 * - Where a **count** lives in `timerWord6` and nothing lives in the bytes — the
 *   magic shield and poison timers, which `MagicSystem.queueUtilityTimer` creates with
 *   x = y = 0 — the count is written into them. The two representations can only
 *   ever conflict when one is zero, because no creator sets both; the guard says
 *   exactly that rather than assuming it.
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
    const word6 = record.timerWord6 & 0xffff;
    if (at === null && word6 !== 0 && record.uByte6 === 0 && record.uByte7 === 0) {
        record.uByte6 = (word6 >> 8) & 0xff;
        record.uByte7 = word6 & 0xff;
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
 * function 0 — as in CSBWin's array. A save written before the table had a size is
 * as long as its highest live slot, and the table it restores fills at once.
 */
function buildTimerRecords(ctx: GameContext): { records: TimerRecord[]; queue: number[] } {
    const entries = ctx.timers.getTimers();
    const records: TimerRecord[] = Array.from({ length: ctx.timers.getMaxTimers() }, () => emptyTimerRecord());
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
 * Rebuild the live queue from a saved table and the heap's array order.
 *
 * The records are a table *by index*; the queue names which of them are live and in
 * what order. Both readings of bytes 6-9 come back, because which one a timer means
 * depends on its function and the queue entry carries both.
 */
function restoreTimerQueue(
    ctx: GameContext,
    records: TimerRecord[],
    order: number[],
    nextSequence: number,
    firstAvailTimer: number | undefined,
): void {
    const entries: TimerEntry[] = [];
    for (const index of order) {
        const record = records[index];
        if (!record) continue;
        // The inverse of `collapseTimerBytes`: an object-carrying timer's RN comes
        // back off the byte pair `ConvertTimers` names and onto `TimerEntry.object`,
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
    ctx.timers.restore(entries, nextSequence, records.length, firstAvailTimer);
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
