/**
 * The port's own quick-save: the whole mutable world as one JSON-able snapshot, and its
 * restore. It has no CSBWin home — CSBWin's save is `SaveGame.cpp`'s binary file, which
 * `SaveGamePayload` writes beside this — so it is a module over the context rather than
 * a system. Which fields of the dungeon it carries, and which it leaves to the file the
 * world was built from, is `DUNGEON_DATA_SOURCES` (`DungeonSnapshot.ts`).
 */
import type { Item16Record, MissileRecord, TimerRecord } from '../data/dungeonTypes';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import type { ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import type { DungeonSnapshot } from './DungeonSnapshot';
import type { GameContext } from './GameContext';
import type { PartyState } from './gameTypes';
import { ensureHandOwner } from './Party';
import type { FootprintsSnapshot } from './PartyFootprints';
import type { TimerEntry } from './TimerQueue';

/**
 * The quick-save payload.
 *
 * Version 2 added `dungeon.snapshot` and the `game` fields below it. Version 1
 * carried only the party, the tick count, the `ITEM16` pool, the timers and the
 * missile records, so restoring one reset the whole world — doors, moved objects,
 * fired actuators — while leaving the party's inventory alone.
 *
 * Version 3 replaced the champions' seven flat attribute numbers with CSBWin's
 * `(maximum, current, minimum)` triples (`ChampionAttributes.stats`).
 *
 * Version 4 is not a change to this structure at all — it is the *binary* half beside
 * it. `SaveGameLoader` used to read and write GAMEBLOCK1/2, `ITEM16` and the timers as
 * little-endian words, a self-consistent format that was not CSBWin's; those blocks are
 * big-endian in the file (`doc/CSBwin-src/CSBCode.cpp:9057`). Fixing that makes every
 * v3 payload unreadable, so the version moves with it.
 *
 * Version 5 adds `dungeon.snapshot.columnIndex` and the two header fields beside it.
 * Their absence was not a missing feature but a live corruption: `columnIndex` is
 * rewritten by every drop into an empty cell and every pick-up of a cell's last object
 * (`DungeonState.addObjectToCell`), so a v4 payload restored `objectList` against
 * whatever offsets play had left behind, and every cell's object chain was read from
 * the wrong place. A v4 save cannot be repaired — the index it needed was never
 * written — so it is refused like any other older format.
 *
 * Version 6 stores the timer table as CSBWin's array has it — by timer index, holes
 * included — and adds `timerQueue` (which of those timers are live, in firing order)
 * and `timerSequence` (the stamp the next queued timer takes), so a restored queue
 * fires in the same order it would have. It came with loading genuine CSBWin save
 * files, whose timer blocks have that shape.
 *
 * Version 7 moves a timer's object reference into the byte pair `ConvertTimers` names
 * for its function (`doc/CSBwin-src/SaveGame.cpp:2027-2050`; see
 * `collapseTimerBytes`). A v6 payload kept the RN only on the live `TimerEntry.object`,
 * which has no byte in the file, so a restored missile came back without its object.
 *
 * Version 8 drops `Champion`'s `shieldHand` / `weaponHand` / `quiver`, which mirrored
 * possession slots 0, 1 and 8 (`DEBT.md` D1).
 *
 * Version 9 stores an empty possession slot as `RNnul` (0xffff), as CSBWin and the
 * save file do, where it had been `null` (`DEBT.md` D2a).
 *
 * Version 10 does the same for `PartyState.objectInHand`, now required (`DEBT.md` D2b).
 *
 * No bump has an upgrade path: `quickLoad` refuses an older save rather than
 * restoring a half-state.
 */
export const RUNTIME_SAVE_VERSION = 10;

export interface RuntimeSaveState {
    version: typeof RUNTIME_SAVE_VERSION;
    savedAt: number;
    party: PartyState;
    game: {
        tickCount: number;
        paused: boolean;
        elapsedTimeMs: number;
        /** `d.RandomNumber`, so a reload continues the same stream. */
        randomSeed: number;
        /** `d.Word11694`. */
        gameWon: boolean;
        /** `d.PartyFootprints` + `d.Byte13220` — the scent trail monsters follow. */
        footprints: FootprintsSnapshot;
        /** The DSA global variables, where a dungeon keeps its puzzle progress. */
        dsaGlobals: number[];
    };
    dungeon: {
        item16?: Item16Record[];
        /** The timer table, by timer index — holes included, as CSBWin's array has them. */
        timers?: TimerRecord[];
        /** Which of those timers are live, in firing order (`GameTimers::TimerQueue`). */
        timerQueue?: number[];
        /** `gameTimers.TimerSequence()` — the stamp the next queued timer will take. */
        timerSequence?: number;
        missiles?: MissileRecord[];
        /** Everything play can change: cell flags, object chains, all DB records. */
        snapshot: DungeonSnapshot;
    };
}

/** Snapshot the runtime state for the quick-save. */
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
        version: RUNTIME_SAVE_VERSION,
        savedAt: Date.now(),
        party: ctx.party.state,
        game: {
            tickCount: ctx.state.tickCount,
            paused: ctx.state.paused,
            elapsedTimeMs: ctx.state.currentTime - ctx.state.startTime,
            randomSeed: ctx.random.getSeed(),
            gameWon: ctx.state.gameWon,
            footprints: ctx.footprints.capture(),
            dsaGlobals: ctx.systems.dsa.getGlobalVariables(),
        },
        dungeon: {
            item16,
            timers,
            timerQueue,
            timerSequence: ctx.timers.getNextSequence(),
            missiles,
            snapshot: ctx.dungeon.captureSnapshot(),
        },
    };
}

/**
 * Restore the runtime state from a quick-save. The caller owes the loop's own reset:
 * `HandleMouseEvents`' `lastTime = 0` (`Game.applyRuntimeSaveState`).
 */
export function applyRuntimeSaveState(ctx: GameContext, save: RuntimeSaveState): void {
    // `d.PartySleeping = 0` wherever a game starts (doc/CSBwin-src/CSBCode.cpp:10479):
    // CSBWin never saves it. Loading over a sleeping party must hand the UI its
    // adventure button lists back, whatever the restored state says.
    const wasSleeping = ctx.party.state.sleeping;
    ctx.party.setState(save.party);
    ctx.party.state.sleeping = false;
    if (wasSleeping) ctx.host.sleepChanged(false);
    // `d.HandChar = b.gb2.handChar` (doc/CSBwin-src/SaveGame.cpp:1636): the cursor
    // owner is part of the saved state. `setState` carries it, and this repairs the
    // states written before it was ever set.
    ensureHandOwner(ctx.party.state);

    ctx.state.paused = save.game.paused;
    ctx.state.tickCount = save.game.tickCount;
    const now = Date.now();
    ctx.state.currentTime = now;
    ctx.state.startTime = now - save.game.elapsedTimeMs;
    ctx.random.setSeed(save.game.randomSeed);
    ctx.state.gameWon = save.game.gameWon;
    ctx.systems.dsa.setGlobalVariables(save.game.dsaGlobals);

    // The world first: cell flags, object chains and every database record. This
    // has to land before the ITEM16/timer restore below, because the monster pool
    // is re-derived from the creature records it puts back.
    ctx.dungeon.applySnapshot(save.dungeon.snapshot);

    const item16 = save.dungeon.item16 ?? [];
    const timers = save.dungeon.timers ?? [];
    const missiles = save.dungeon.missiles ?? [];
    // The queue before `applySaveGameState`, which reads `timerWord8` back out of
    // it through `DungeonState`'s lookup.
    restoreTimerQueue(
        ctx,
        timers,
        save.dungeon.timerQueue ?? [],
        save.dungeon.timerSequence ?? 0,
    );
    const saveGameState: SaveGameState = {
        item16,
        timers,
        missiles,
        maxItem16: item16.length,
        maxTimers: timers.length,
        sequencedTimers: false,
        extendedTimers: false,
    };
    applySaveGameState(ctx.state.dungeon, saveGameState);
    // The restore replaced the ITEM16 pool wholesale; re-derive which groups are
    // active, as CSBWin does after its own restore
    // (doc/CSBwin-src/SaveGame.cpp:1240-1244).
    ctx.footprints.restore(save.game.footprints);
    ctx.systems.monsters.reloadAfterSaveGame();
}

/**
 * Which byte pair of `TIMER` holds an object reference, by timer function.
 *
 * `ConvertTimers` (`doc/CSBwin-src/SaveGame.cpp:2027-2050`): 48 and 49 — the missile
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
 * (`timerObj6()`, `timerWord8()`, `doc/CSBwin-src/CSB.h:1818-1860`). This port's
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
 * order beside it.
 *
 * This used to write a single field per timer, `timerWord8`, so no save of any kind
 * restored *when* anything was due: a door caught mid-close stayed put, a fuse
 * stopped burning. The whole `TIMER` is written now, and `timerQueue` carries the
 * firing order, which is what `TimerQueue.restore` puts back.
 *
 * An index with no live timer is filled with an empty record — `TT_EMPTY` is
 * function 0 — exactly as CSBWin's array has holes wherever `m_firstAvailTimer`'s
 * free list has slots.
 */
function buildTimerRecords(ctx: GameContext): { records: TimerRecord[]; queue: number[] } {
    const entries = ctx.timers.getTimers();
    let maxIndex = -1;
    for (const entry of entries) {
        if (entry.index > maxIndex) maxIndex = entry.index;
    }
    if (maxIndex < 0) return { records: [], queue: [] };
    const records: TimerRecord[] = Array.from({ length: maxIndex + 1 }, () => emptyTimerRecord());
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
 * Rebuild the live queue from a saved table and firing order.
 *
 * The records are a table *by index*; the queue names which of them are live and in
 * what order. Both readings of bytes 6-9 come back, because which one a timer means
 * depends on its function and the queue entry carries both.
 */
function restoreTimerQueue(ctx: GameContext, records: TimerRecord[], order: number[], nextSequence: number): void {
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
    ctx.timers.restore(entries, nextSequence);
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
