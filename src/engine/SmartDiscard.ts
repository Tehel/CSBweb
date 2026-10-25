/**
 * `SmartDiscard` (`doc/CSBwin-src/SmartDiscard.cpp`): when a database of loose objects
 * (weapons, clothing, misc) has three quarters of its maximum in use, throw away the
 * objects least worth keeping, one per tick.
 *
 * The main loop calls it with `false` on every tick (`CSBCode.cpp:688`), and it does one
 * step of a cycle through the three databases: count fifty records a step; if the count
 * reaches `Max * 3/4` (6000, `CSB.h:1649`), scan the dungeon fifty objects a step into a
 * list of the 200 most discardable; then discard one a step, highest priority first,
 * until the count drops below the limit. A game read (`CSBCode.cpp:10760`) and the tail
 * of a save (`SaveGame.cpp:1343`) call it with `true`, which starts it over.
 *
 * The file's statics are CSBWin's module state, not `d.`, and no save carries them: they
 * are `ctx.smartDiscard` here.
 *
 * `tools/checks/watch-smart-discard.ts` pads a database past the limit.
 */
import { getActuatorType } from '../data/actuatorHelpers';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import type { Database, DatabaseRecord } from '../data/dungeonTypes';
import { dbMax } from './DungeonState';
import type { GameContext } from './GameContext';

/** `SDListSize` (`doc/CSBwin-src/SmartDiscard.cpp:11`). */
const SD_LIST_SIZE = 200;

/** `db.Max(currentDBNum)*FRACTION_LIMIT`, `FRACTION_LIMIT` being `3/4` (`SmartDiscard.cpp:14`). */
const discardLimit = (dbNum: DBType): number => (dbMax(dbNum) * 3) / 4;

/** The file's `currentMode` enum (`doc/CSBwin-src/SmartDiscard.cpp:22-28`). */
export const enum SmartDiscardMode {
    NotActive,
    NewDB,
    Count,
    Scan,
    Discard,
}

/**
 * `SDOBJ` (`doc/CSBwin-src/SmartDiscard.cpp:41-72`). CSBWin packs level, x, y and the
 * `RN` into `m_object`; the `RN` is a slot of the object indirect index, which keeps the
 * object's corner beside the record, so `m_object` names the object wherever it lies in
 * the cell. `object` is the RN as the scan found it.
 */
export interface SDObj {
    key: number;
    object: ObjectID;
    priority: number;
}

function sdObj(level: number, x: number, y: number, object: ObjectID, priority: number): SDObj {
    return { key: (((((level << 5) + x) << 5) + y) * 0x10000 + object) >>> 0, object, priority };
}

/** `SDOBJ::Get` (`:65-71`). */
function sdObjGet(sd: SDObj): { level: number; x: number; y: number; object: ObjectID } {
    return { level: (sd.key >>> 26) & 0x3f, x: (sd.key >>> 21) & 0x1f, y: (sd.key >>> 16) & 0x1f, object: sd.object };
}

/**
 * `SDOBJLIST` (`doc/CSBwin-src/SmartDiscard.cpp:127-356`): a binary heap of at most 200
 * entries, a min-heap while the scan fills it (`…Incr`) and a max-heap once `Reverse`
 * has turned it (`…Decr`).
 */
export class SDObjList {
    numEntry = 0;
    readonly sdobj: SDObj[] = [];

    clear(): void {
        this.numEntry = 0;
    }

    /** `AddObjectDecr` (`:153-171`). */
    addObjectDecr(p: SDObj): void {
        if (this.numEntry >= SD_LIST_SIZE) return;
        let index = this.numEntry;
        this.numEntry++;
        while (index !== 0) {
            const parent = Math.trunc((index - 1) / 2);
            if (this.sdobj[parent]!.priority >= p.priority) break;
            this.sdobj[index] = this.sdobj[parent]!;
            index = parent;
        }
        this.sdobj[index] = p;
    }

    /** `AddObjectIncr` (`:173-201`): a full list drops its lowest for a higher one. */
    addObjectIncr(p: SDObj): void {
        if (this.numEntry >= SD_LIST_SIZE) {
            if (p.priority > this.sdobj[0]!.priority) {
                this.deleteObjectIncr(null);
            } else {
                return;
            }
        }
        let index = this.numEntry;
        this.numEntry++;
        while (index !== 0) {
            const parent = Math.trunc((index - 1) / 2);
            if (this.sdobj[parent]!.priority <= p.priority) break;
            this.sdobj[index] = this.sdobj[parent]!;
            index = parent;
        }
        this.sdobj[index] = p;
    }

    /** `DeleteObjectIncr` (`:203-260`): take the lowest. */
    deleteObjectIncr(out: { sd?: SDObj } | null): boolean {
        return this.deleteTop(out, (a, b) => a < b, (parent, priority) => parent <= priority);
    }

    /** `DeleteObjectDecr` (`:262-319`): take the highest. */
    deleteObjectDecr(out: { sd?: SDObj } | null): boolean {
        return this.deleteTop(out, (a, b) => a > b, (parent, priority) => parent >= priority);
    }

    /**
     * The body `DeleteObjectIncr` and `DeleteObjectDecr` share, but for their two
     * comparisons: which child moves up, and where the last entry stops.
     */
    private deleteTop(
        out: { sd?: SDObj } | null,
        c1First: (c1: number, c2: number) => boolean,
        stopAt: (parent: number, priority: number) => boolean,
    ): boolean {
        if (this.numEntry === 0) return false;
        if (out !== null) out.sd = this.sdobj[0];
        let index = 0;
        while (index < this.numEntry) {
            const c1Index = 2 * index + 1;
            const c2Index = c1Index + 1;
            if (c1Index >= this.numEntry) break;
            if (c2Index >= this.numEntry) {
                this.sdobj[index] = this.sdobj[c1Index]!;
                this.numEntry--;
                return true;
            }
            if (c1First(this.sdobj[c1Index]!.priority, this.sdobj[c2Index]!.priority)) {
                this.sdobj[index] = this.sdobj[c1Index]!;
                index = c1Index;
            } else {
                this.sdobj[index] = this.sdobj[c2Index]!;
                index = c2Index;
            }
        }
        this.numEntry--;
        if (index === this.numEntry) return true;
        const priority = this.sdobj[this.numEntry]!.priority;
        while (index !== 0) {
            const parent = Math.trunc((index - 1) / 2);
            if (stopAt(this.sdobj[parent]!.priority, priority)) break;
            this.sdobj[index] = this.sdobj[parent]!;
            index = parent;
        }
        this.sdobj[index] = this.sdobj[this.numEntry]!;
        return true;
    }

    /** `Reverse` (`:321-343`): rebuild as a max-heap, so the highest comes first. */
    reverse(): void {
        const num = this.numEntry;
        let high = num - 1;
        let low = 0;
        this.numEntry = 0;
        while (high > low) {
            const temp = this.sdobj[low]!;
            this.addObjectDecr(this.sdobj[high]!);
            this.sdobj[high] = temp;
            high--;
            low++;
        }
        while (low < num) {
            const temp = this.sdobj[low]!;
            this.addObjectDecr(temp);
            low++;
        }
    }

    /**
     * `SearchStillAvailable` (`:345-356`): whether the object is still listed at a
     * priority no lower. The port returns the ID as this list found it, or `null`,
     * because the corner the discard moves the object from is the one it lies at now
     * (see `SDObj`).
     */
    searchStillAvailable(p: SDObj): ObjectID | null {
        for (let i = 0; i < this.numEntry; i++) {
            const entry = this.sdobj[i]!;
            if (entry.key === p.key) {
                return entry.priority >= p.priority ? entry.object : null;
            }
        }
        return null;
    }
}

/** The file's statics (`doc/CSBwin-src/SmartDiscard.cpp:16-37`, `:358`). */
export interface SmartDiscardState {
    currentDBNum: number;
    currentLevel: number;
    currentX: number;
    currentY: number;
    currentIndex: number;
    /** `discardFailure`: consecutive discards that failed. Nothing reads it. */
    discardFailure: number;
    currentMode: SmartDiscardMode;
    totalCount: number;
    objlist: SDObjList;
}

export function createSmartDiscardState(): SmartDiscardState {
    return {
        currentDBNum: 0,
        currentLevel: 0,
        currentX: 0,
        currentY: 0,
        currentIndex: 0,
        discardFailure: 0,
        currentMode: SmartDiscardMode.NotActive,
        totalCount: 0,
        objlist: new SDObjList(),
    };
}

function databaseOf(ctx: GameContext, dbNum: number): Database<DatabaseRecord> {
    const dbs = ctx.dungeon.getData().databases;
    switch (dbNum) {
        case DBType.WEAPON: return dbs.weapons as Database<DatabaseRecord>;
        case DBType.CLOTHING: return dbs.clothing as Database<DatabaseRecord>;
        default: return dbs.misc as Database<DatabaseRecord>;
    }
}

/**
 * `ScanOneCell` (`doc/CSBwin-src/SmartDiscard.cpp:454-619`): list the current cell's
 * objects of the current database, each at its priority, and return how many objects
 * the cell holds.
 *
 * The priority is the distance from the party: 20 plus the level difference off its
 * level, the square distance on it. The Nth object of a type on a corner adds N, and
 * past twenty more (ten times more for clothing). An important object is never listed,
 * and on a cell whose chain has an object-triggered actuator (types 1-9 and 16) before
 * it, neither is the first of each type on each corner.
 */
export function scanOneCell(ctx: GameContext, s: SmartDiscardState, list: SDObjList): number {
    const party = ctx.party.state.position;
    const partyLevel = party.z | 0;
    // `ui16 pileSize[max numTypes][4]`: the type fields are seven bits.
    let pileSize: Uint16Array | null = null;
    let isTriggered = false;
    let result = 0;
    for (let obj = ctx.dungeon.findFirstObject(new Position(s.currentX, s.currentY, s.currentLevel));
        obj !== OBJECT_ID_EOF;
        obj = ctx.dungeon.getDBRecordLink(obj)) {
        result++;
        const { category, position: pos } = ctx.dungeon.rnMaps.decode(obj);
        if (!isTriggered && category === DBType.ACTUATOR) {
            const actuator = ctx.dungeon.getActuatorRecord(obj);
            switch (actuator ? getActuatorType(actuator) : 0) {
                case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9:
                case 16:
                    isTriggered = true;
                    break;
            }
        }
        if (category !== s.currentDBNum) continue;
        if (pileSize === null) pileSize = new Uint16Array(128 * 4);
        let priority = s.currentLevel !== partyLevel
            ? 20 + Math.abs(s.currentLevel - partyLevel)
            : Math.abs(s.currentX - (party.x | 0)) + Math.abs(s.currentY - (party.y | 0));
        let idx: number;
        let important: boolean;
        let excessFactor: number;
        switch (s.currentDBNum) {
            case DBType.CLOTHING: {
                const rec = ctx.dungeon.getClothingRecord(obj)!;
                idx = rec.clothingType;
                important = rec.important;
                excessFactor = 10;
                break;
            }
            case DBType.WEAPON: {
                const rec = ctx.dungeon.getWeaponRecord(obj)!;
                idx = rec.weaponType;
                important = rec.important;
                excessFactor = 1;
                break;
            }
            default: {
                const rec = ctx.dungeon.getMiscRecord(obj)!;
                idx = rec.miscType;
                important = rec.important;
                excessFactor = 1;
                break;
            }
        }
        const pile = ++pileSize[idx * 4 + pos]!;
        priority += pile;
        if (pile > 20) priority += excessFactor * (pile - 20);
        if (isTriggered && pile === 1) continue;
        if (important) continue;
        list.addObjectIncr(sdObj(s.currentLevel, s.currentX, s.currentY, obj, priority));
    }
    return result;
}

/**
 * `ScanDungeon` (`doc/CSBwin-src/SmartDiscard.cpp:622-660`): one cell, or one step to
 * the next column or level. Returns the objects examined, and 99999 once the last
 * level is done, when it turns the list round and starts discarding.
 */
function scanDungeon(ctx: GameContext, s: SmartDiscardState): number {
    const numLevel = ctx.dungeon.getMapCount();
    if (s.currentLevel >= numLevel) {
        s.currentMode = SmartDiscardMode.Discard;
        s.objlist.reverse();
        s.discardFailure = 0;
        return 99999;
    }
    const size = ctx.dungeon.getMapDimensions(s.currentLevel)!;
    if (s.currentX >= size.width) {
        s.currentX = 0;
        s.currentLevel++;
        return 0;
    }
    if (s.currentY >= size.height) {
        s.currentX++;
        s.currentY = 0;
        return 0;
    }
    const result = scanOneCell(ctx, s, s.objlist);
    s.currentY++;
    return result;
}

/**
 * `DiscardObject` (`doc/CSBwin-src/SmartDiscard.cpp:662-732`): take the highest entry;
 * if its cell, scanned again, still lists it at a priority no lower, lift it out of the
 * cell (`MoveObject(obj, x, y, -1, 0)` on its level) and free its record. Either way the
 * count drops by one. An empty list goes on to the next database.
 */
function discardObject(ctx: GameContext, s: SmartDiscardState): void {
    const out: { sd?: SDObj } = {};
    if (!s.objlist.deleteObjectDecr(out)) {
        s.currentMode = SmartDiscardMode.NewDB;
        return;
    }
    const sd = out.sd!;
    const where = sdObjGet(sd);
    s.currentLevel = where.level;
    s.currentX = where.x;
    s.currentY = where.y;
    const checkList = new SDObjList();
    scanOneCell(ctx, s, checkList);
    const discardObj = checkList.searchStillAvailable(sd);
    if (discardObj !== null) {
        // `LoadLevel(currentLevel)` … `LoadLevel(oldLevel)`: the level is `moveObject`'s argument.
        ctx.systems.worldMove.moveObject(discardObj, s.currentX, s.currentY, -1, 0, s.currentLevel);
        ctx.dungeon.deleteDBEntry(discardObj);
        s.discardFailure = 0;
        s.totalCount--;
        return;
    }
    s.discardFailure++;
    s.totalCount--;
}

/** `SmartDiscard(Initialize)` (`doc/CSBwin-src/SmartDiscard.cpp:734-906`). */
export function smartDiscard(ctx: GameContext, initialize: boolean): void {
    const s = ctx.smartDiscard;
    if (initialize) {
        s.currentDBNum = DBType.MISC;
        s.currentMode = SmartDiscardMode.NewDB;
        return;
    }
    switch (s.currentMode) {
        case SmartDiscardMode.NotActive:
            return;
        case SmartDiscardMode.NewDB: {
            // The loop over `currentDBNum+1 … 15` looks for `i == currentDBNum` and so
            // always runs out (`:769-773`): the next database is the cycle's.
            switch (s.currentDBNum) {
                case DBType.MISC: s.currentDBNum = DBType.WEAPON; break;
                case DBType.WEAPON: s.currentDBNum = DBType.CLOTHING; break;
                case DBType.CLOTHING: s.currentDBNum = DBType.MISC; break;
                default:
                    s.currentMode = SmartDiscardMode.NotActive;
                    return;
            }
            s.totalCount = 0;
            s.currentIndex = 0;
            s.currentMode = SmartDiscardMode.Count;
            return;
        }
        case SmartDiscardMode.Count: {
            // Each record's type index and `important()` are read only for commented-out
            // statistics and an `ASSERT` (`:825-875`); the count is all that is kept.
            const records = databaseOf(ctx, s.currentDBNum).records;
            for (let repeat = 0; repeat < 50; repeat++) {
                if (s.currentIndex >= records.length) {
                    if (s.totalCount < discardLimit(s.currentDBNum)) {
                        s.currentMode = SmartDiscardMode.NewDB;
                        return;
                    }
                    s.currentLevel = 0;
                    s.currentX = 0;
                    s.currentY = 0;
                    s.objlist.clear();
                    s.currentMode = SmartDiscardMode.Scan;
                    return;
                }
                const record = records[s.currentIndex]!;
                s.currentIndex++;
                if (record.nextObject === OBJECT_ID_NULL) continue;
                s.totalCount++;
            }
            return;
        }
        case SmartDiscardMode.Scan:
            for (let repeat = 50; repeat > 0; repeat -= scanDungeon(ctx, s));
            return;
        case SmartDiscardMode.Discard:
            if (s.totalCount < discardLimit(s.currentDBNum)) {
                s.currentMode = SmartDiscardMode.NewDB;
                return;
            }
            discardObject(ctx, s);
            return;
    }
}
