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
 *
 * The `csbwin-11.014` profile plays CSBWin 11.014's instead, behind
 * `smartDiscardDrawnPriority` (`src/engine/Behaviour.ts`): `smartDiscard11014`, below.
 */
import { getActuatorType } from '../data/actuatorHelpers';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import { databaseRecords, type ClothingRecord, type MiscRecord, type WeaponRecord } from '../data/dungeonTypes';
import { dbMax } from './DungeonState';
import type { GameContext } from './GameContext';
import type { GameTables } from './GameTables';

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
    /** 11.014's own statics, which the `csbwin-11.014` profile plays (`smartDiscard11014`). */
    readonly v11014: SmartDiscard11014State;
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
        v11014: createSmartDiscard11014State(),
    };
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
    if (ctx.behaviour.smartDiscardDrawnPriority) {
        smartDiscard11014(ctx, initialize);
        return;
    }
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
            const records = databaseRecords(ctx.dungeon.getData().databases, s.currentDBNum as DBType);
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

// ---------------------------------------------------------------------------

/**
 * CSBWin 11.014's `SmartDiscard` (`doc/CSBwin-src-11.014/SmartDiscard.cpp`), which the
 * `csbwin-11.014` profile plays behind `smartDiscardDrawnPriority`
 * (`src/engine/Behaviour.ts`, `doc/RECORDING.md` → "A recording's level") in the place
 * of 2023's, above.
 *
 * The same cycle through the three databases, but each object is ranked by
 * `ComputePriority`, which draws a random number every time it is called, and is called
 * again for each entry at every comparison the list makes: adding an entry, taking the
 * top one, and checking it before a discard. The count never stops the cycle: every
 * object not important of the database is scanned into the list, on every pass, and only
 * a count of 32000 (misc) or 7000 discards. So 11.014 draws in `SmartDiscard` all game
 * long, where 2023 draws nothing.
 *
 * Its priorities are `float`s, computed as `Math.fround` computes them; its table is
 * `SmartDiscards[]`, the built-in lines (`doc/CSBwin-src-11.014/CSBUI.cpp:695-712`):
 * 11.014's `config.txt` has no keyword that adds one (`ReadConfigFile`, `:733`).
 */

const fround = Math.fround;

/** `SDENT` (`doc/CSBwin-src-11.014/Data.h:257-263`). */
interface SDEnt {
    minimum: number;
    level: number;
    yIntercept: number;
    slope: number;
}

/**
 * `SmartDiscards[]` (`doc/CSBwin-src-11.014/CSBUI.cpp:695-712`), each line as
 * `AddSmartDiscard` reads it (`:609-639`): its name upper-cased, minimum, level,
 * y-intercept and slope.
 */
const SMART_DISCARDS: readonly (readonly [string, number, number, number, number])[] = [
    ['DEFAULT', 30, 50, 20.0, 1.0],
    ['WOODEN SHIELD', 10, 50, 20.0, 1.0],
    ['ROCK', 10, 50, 20.0, 1.0],
    ['SWORD', 10, 50, 20.0, 1.0],
    ['DAGGER', 10, 50, 20.0, 1.0],
    ['FALCHION', 10, 50, 20.0, 1.0],
    ['CLUB', 10, 50, 20.0, 1.0],
    ['STONE CLUB', 10, 50, 20.0, 1.0],
    ['ARMET', 10, 50, 20.0, 1.0],
    ['TORSO PLATE', 10, 50, 20.0, 1.0],
    ['LEG PLATE', 10, 50, 20.0, 1.0],
    ['FOOT PLATE', 10, 50, 20.0, 1.0],
    ['BOULDER', 20, 50, 70.0, 1.0],
    ['DRAGON STEAK', 150, 0, 20.0, 0.0],
];

/** `interimTable` (`doc/CSBwin-src-11.014/SmartDiscard.cpp:601-616`): a name's object type. */
const INTERIM_TABLE: readonly (readonly [string, number])[] = [
    ['DRAGON STEAK', 0xaf],
    ['BOULDER', 0x80],
    ['FOOT PLATE', 0x74],
    ['LEG PLATE', 0x5d],
    ['TORSO PLATE', 0x4d],
    ['ARMET', 0x64],
    ['STONE CLUB', 0x30],
    ['CLUB', 0x2f],
    ['DAGGER', 0x20],
    ['SWORD', 0x22],
    ['ROCK', 0x36],
    ['WOODEN SHIELD', 0x6c],
    ['FALCHION', 0x21],
];

const sdTables = new WeakMap<GameTables, readonly SDEnt[]>();

/**
 * `sdTable[199]`, as `BuildSmartDiscardTable` fills it from `sdList`
 * (`doc/CSBwin-src-11.014/SmartDiscard.cpp:618-680`), indexed as `ObjDesc`. `newSD`
 * puts each line at the list's head (`data.cpp:337-354`), so the list runs from the last
 * line to `DEFAULT`, which fills what the named lines left.
 */
function sdTableOf(tables: GameTables): readonly SDEnt[] {
    let table = sdTables.get(tables);
    if (table !== undefined) return table;
    const built: SDEnt[] = Array.from({ length: 199 }, () => ({ minimum: -1, level: 0, yIntercept: 0, slope: 0 }));
    for (const [name, minimum, level, yIntercept, slope] of [...SMART_DISCARDS].reverse()) {
        const set = (ent: SDEnt): void => {
            ent.minimum = minimum;
            ent.level = fround(level);
            ent.yIntercept = fround(yIntercept);
            ent.slope = fround(slope);
        };
        const interim = INTERIM_TABLE.find(([known]) => known === name);
        if (interim !== undefined) {
            let j = 0;
            for (; j < 180; j++) {
                if (tables.objDescObjectType[j] === interim[1]) break;
            }
            if (j === 180) j = 0; // "scroll...we don't use it"
            set(built[j]!);
            continue;
        }
        if (name === 'DEFAULT') {
            for (const ent of built) {
                if (ent.minimum === -1) set(ent);
            }
        }
    }
    table = built;
    sdTables.set(tables, table);
    return table;
}

/** `SDOBJ(level, x, y, objIndex)`'s `m_object` (`doc/CSBwin-src-11.014/SmartDiscard.cpp:39-42`). */
const sdObj11014 = (level: number, x: number, y: number, objIndex: number): number => (((((level << 6) + x) << 6) + y) << 8) + objIndex;

/** `SDOBJ::Get` (`:45-51`). */
function sdObjGet11014(sd: number): { level: number; x: number; y: number; objIndex: number } {
    return { level: (sd >> 20) & 0x3f, x: (sd >> 14) & 0x3f, y: (sd >> 8) & 0x3f, objIndex: sd & 0xff };
}

/** The file's own statics that 2023's dropped: `objcount` and `objlist` (`:25`, `:189`). */
interface SmartDiscard11014State {
    /** `objcount[180]`: how many of each `ObjDesc` index the count found. */
    readonly objcount: Int32Array;
    readonly objlist: SDObjList11014;
}

function createSmartDiscard11014State(): SmartDiscard11014State {
    return { objcount: new Int32Array(180), objlist: new SDObjList11014() };
}

/** `ComputePriority` (`:53-101`): a draw, then the object's standing; -1 never discards it. */
function computePriority(ctx: GameContext, s: SmartDiscardState, sd: number): number {
    const { level, objIndex } = sdObjGet11014(sd);
    const psdEnt = sdTableOf(ctx.tables)[objIndex]!;
    const partyLevel = ctx.party.state.position.z | 0;
    const objcount = s.v11014.objcount[objIndex]!;
    let priority = psdEnt.yIntercept;
    priority = fround(priority + fround(fround(ctx.random.below(100000)) / 100000)); // 0.0 to 0.99999
    if (Math.abs(level - partyLevel) > 1) {
        priority = fround(priority + psdEnt.level);
    }
    if (objcount > psdEnt.minimum) {
        priority = fround(priority + fround(psdEnt.slope * (objcount - psdEnt.minimum)));
    } else {
        priority = -1.0;
    }
    if (level === partyLevel) priority = -1.0;
    return priority;
}

/**
 * `SDOBJLIST` (`:105-187`): a max-heap of at most 1050 entries whose every comparison
 * computes both priorities afresh. `Clear` keeps the entries, which `TopPriority` reads
 * even of an empty list, the last one taken.
 */
class SDObjList11014 {
    numEntry = 0;
    /** `SDOBJ m_sdobj[65536]`, each `m_object` 0 until written (`SDOBJ(void)`). */
    readonly sdobj = new Int32Array(65536);

    clear(): void {
        this.numEntry = 0;
    }

    /** `AddObject` (`:123-140`). */
    addObject(ctx: GameContext, s: SmartDiscardState, p: number): void {
        if (this.numEntry > 1049) return; // ignore it.
        const priority = computePriority(ctx, s, p);
        let index = this.numEntry;
        this.numEntry++;
        while (index !== 0) {
            const parent = Math.trunc((index - 1) / 2);
            const parentPriority = computePriority(ctx, s, this.sdobj[parent]!);
            if (parentPriority >= priority) break;
            this.sdobj[index] = this.sdobj[parent]!;
            index = parent;
        }
        this.sdobj[index] = p;
    }

    /** `DeleteObject` (`:142-187`): take the topmost. */
    deleteObject(ctx: GameContext, s: SmartDiscardState, out: { sd?: number }): boolean {
        if (this.numEntry === 0) return false;
        out.sd = this.sdobj[0]!;
        let index = 0; // entry to be replaced.
        while (index < this.numEntry) {
            const c1Index = 2 * index + 1;
            const c2Index = c1Index + 1;
            if (c1Index >= this.numEntry) break;
            if (c2Index >= this.numEntry) {
                this.sdobj[index] = this.sdobj[c1Index]!;
                this.numEntry--;
                return true;
            }
            const c1Priority = computePriority(ctx, s, this.sdobj[c1Index]!);
            const c2Priority = computePriority(ctx, s, this.sdobj[c2Index]!);
            if (c1Priority > c2Priority) {
                this.sdobj[index] = this.sdobj[c1Index]!;
                index = c1Index;
            } else {
                this.sdobj[index] = this.sdobj[c2Index]!;
                index = c2Index;
            }
        }
        this.numEntry--;
        if (index === this.numEntry) return true;
        const priority = computePriority(ctx, s, this.sdobj[this.numEntry]!);
        while (index !== 0) {
            const parent = Math.trunc((index - 1) / 2);
            const parentPriority = computePriority(ctx, s, this.sdobj[parent]!);
            if (parentPriority >= priority) break;
            this.sdobj[index] = this.sdobj[parent]!;
            index = parent;
        }
        this.sdobj[index] = this.sdobj[this.numEntry]!;
        return true;
    }

    /** `TopPriority` (`:120`). */
    topPriority(ctx: GameContext, s: SmartDiscardState): number {
        return computePriority(ctx, s, this.sdobj[0]!);
    }
}

/** The `ObjDesc` index of an object of the database being processed: its type plus the database's first index. */
function objDescIndex(ctx: GameContext, dbNum: number, obj: ObjectID): { index: number; important: boolean } | null {
    switch (dbNum) {
        case DBType.MISC: {
            const rec = ctx.dungeon.getMiscRecord(obj)!;
            return { index: rec.miscType + 127, important: rec.important };
        }
        case DBType.WEAPON: {
            const rec = ctx.dungeon.getWeaponRecord(obj)!;
            return { index: rec.weaponType + 23, important: rec.important };
        }
        case DBType.CLOTHING: {
            const rec = ctx.dungeon.getClothingRecord(obj)!;
            return { index: rec.clothingType + 69, important: rec.important };
        }
    }
    return null;
}

/**
 * `ScanDungeon` (`:283-380`): one cell, or one step to the next column or level. Returns
 * the objects examined, and 99999 once the last level is done. A cell's chain is read up
 * to its first actuator of a type other than 0; each object of the database not important
 * is listed.
 */
function scanDungeon11014(ctx: GameContext, s: SmartDiscardState): number {
    let result = 0;
    const numLevel = ctx.dungeon.getMapCount();
    if (s.currentLevel >= numLevel) {
        s.currentMode = SmartDiscardMode.Discard;
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
    for (let obj = ctx.dungeon.findFirstObject(new Position(s.currentX, s.currentY, s.currentLevel));
        obj !== OBJECT_ID_EOF;
        obj = ctx.dungeon.getDBRecordLink(obj)) {
        result++;
        const category = ctx.dungeon.rnMaps.decode(obj).category;
        if (category === DBType.ACTUATOR) {
            const actuator = ctx.dungeon.getActuatorRecord(obj);
            if ((actuator ? getActuatorType(actuator) : 0) !== 0) break;
        }
        if (category !== s.currentDBNum) continue;
        const desc = objDescIndex(ctx, s.currentDBNum, obj)!;
        if (desc.important) continue;
        s.v11014.objlist.addObject(ctx, s, sdObj11014(s.currentLevel, s.currentX, s.currentY, desc.index));
    }
    s.currentY++;
    return result;
}

/**
 * `DiscardObject` (`:382-443`): take the top entry; unless its priority, computed again,
 * is negative or below the next one's, which puts it back, discard the first object of
 * its index in its cell (`MoveObject(obj, x, y, -1, 0)` on its level) and free its
 * record. The count drops by one either way.
 */
function discardObject11014(ctx: GameContext, s: SmartDiscardState): void {
    const list = s.v11014.objlist;
    const out: { sd?: number } = {};
    if (!list.deleteObject(ctx, s, out)) {
        s.currentMode = SmartDiscardMode.NewDB;
        return;
    }
    const sd = out.sd!;
    const priority = computePriority(ctx, s, sd);
    if (priority < 0 || priority < list.topPriority(ctx, s)) {
        s.discardFailure++;
        list.addObject(ctx, s, sd);
        if (s.discardFailure > 500) s.currentMode = SmartDiscardMode.NewDB;
        return;
    }
    const { level, x, y, objIndex } = sdObjGet11014(sd);
    for (let obj = ctx.dungeon.findFirstObject(new Position(x, y, level));
        obj !== OBJECT_ID_EOF;
        obj = ctx.dungeon.getDBRecordLink(obj)) {
        if (ctx.dungeon.rnMaps.decode(obj).category !== s.currentDBNum) continue;
        const desc = objDescIndex(ctx, s.currentDBNum, obj);
        if (desc === null) {
            // "Unknown DB type in SD"
            s.currentMode = SmartDiscardMode.NotActive;
            return;
        }
        if (objIndex !== desc.index) continue;
        // It appears we can discard this object. `LoadLevel(level)` … `LoadLevel(oldLevel)`:
        // the level is `moveObject`'s argument.
        ctx.systems.worldMove.moveObject(obj, x, y, -1, 0, level);
        ctx.dungeon.deleteDBEntry(obj);
        s.discardFailure = 0;
        s.totalCount--;
        return;
    }
    s.discardFailure++;
    s.totalCount--;
}

/** `SmartDiscard(Initialize)` (`doc/CSBwin-src-11.014/SmartDiscard.cpp:445-593`). */
function smartDiscard11014(ctx: GameContext, initialize: boolean): void {
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
            // always runs out (`:481-485`): the next database is the cycle's.
            switch (s.currentDBNum) {
                case DBType.MISC: s.currentDBNum = DBType.WEAPON; break;
                case DBType.WEAPON: s.currentDBNum = DBType.CLOTHING; break;
                case DBType.CLOTHING: s.currentDBNum = DBType.MISC; break;
                default:
                    s.currentMode = SmartDiscardMode.NotActive;
                    return;
            }
            s.v11014.objcount.fill(0);
            s.totalCount = 0;
            s.currentIndex = 0;
            s.currentMode = SmartDiscardMode.Count;
            return;
        }
        case SmartDiscardMode.Count: {
            const records = databaseRecords(ctx.dungeon.getData().databases, s.currentDBNum as DBType);
            for (let repeat = 0; repeat < 50; repeat++) {
                if (s.currentIndex >= records.length) {
                    // We have finished counting
                    s.currentLevel = 0;
                    s.currentX = 0;
                    s.currentY = 0;
                    s.v11014.objlist.clear(); // Clear list of prioritized objects
                    s.currentMode = SmartDiscardMode.Scan;
                    return;
                }
                const record = records[s.currentIndex]!;
                s.currentIndex++;
                // A free record ends the step, where 2023's goes on to the next.
                if (record.nextObject === OBJECT_ID_NULL) return;
                let objIndex: number;
                switch (s.currentDBNum) {
                    case DBType.MISC: objIndex = (record as MiscRecord).miscType + 127; break;
                    case DBType.WEAPON: objIndex = (record as WeaponRecord).weaponType + 23; break;
                    case DBType.CLOTHING: objIndex = (record as ClothingRecord).clothingType + 69; break;
                    default:
                        // "SmartDiscard Unknown DB Type"
                        s.currentMode = SmartDiscardMode.NotActive;
                        return;
                }
                s.v11014.objcount[objIndex]!++;
                s.totalCount++;
            }
            return;
        }
        case SmartDiscardMode.Scan:
            for (let repeat = 50; repeat > 0; repeat -= scanDungeon11014(ctx, s));
            return;
        case SmartDiscardMode.Discard:
            if (s.totalCount < (s.currentDBNum === DBType.MISC ? 32000 : 7000)) {
                s.currentMode = SmartDiscardMode.NewDB;
                return;
            }
            discardObject11014(ctx, s);
            return;
    }
}

/**
 * `ctx.smartDiscard` as plain data, which a path cut at a save carries (`CutState`,
 * `src/engine/RecordingCut.ts`): the file's statics, which no save holds and a read starts
 * over, so a game read from the save's file has others than the game that made it. The
 * lists keep every entry, those past `numEntry` too, which 11.014's `TopPriority` reads;
 * 11.014's, 65,536 entries most of them 0, as `[index, m_object]` for each not 0.
 */
export interface SmartDiscardSnapshot {
    readonly currentDBNum: number;
    readonly currentLevel: number;
    readonly currentX: number;
    readonly currentY: number;
    readonly currentIndex: number;
    readonly discardFailure: number;
    readonly currentMode: number;
    readonly totalCount: number;
    readonly objlist: { readonly numEntry: number; readonly sdobj: readonly (readonly [key: number, object: number, priority: number])[] };
    readonly v11014: { readonly objcount: readonly number[]; readonly numEntry: number; readonly sdobj: readonly (readonly [index: number, object: number])[] };
}

/** `s` as plain data (`SmartDiscardSnapshot`). */
export function smartDiscardSnapshot(s: SmartDiscardState): SmartDiscardSnapshot {
    const { currentDBNum, currentLevel, currentX, currentY, currentIndex, discardFailure, currentMode, totalCount, objlist, v11014 } = s;
    const sparse: [number, number][] = [];
    v11014.objlist.sdobj.forEach((object, index) => { if (object !== 0) sparse.push([index, object]); });
    return {
        currentDBNum, currentLevel, currentX, currentY, currentIndex, discardFailure, currentMode, totalCount,
        objlist: { numEntry: objlist.numEntry, sdobj: objlist.sdobj.map((sd) => [sd.key, sd.object, sd.priority] as const) },
        v11014: { objcount: [...v11014.objcount], numEntry: v11014.objlist.numEntry, sdobj: sparse },
    };
}

/** `s` set as `snapshot` holds it (`smartDiscardSnapshot`). */
export function setSmartDiscardSnapshot(s: SmartDiscardState, snapshot: SmartDiscardSnapshot): void {
    const { objlist, v11014, ...fields } = snapshot;
    Object.assign(s, fields);
    s.objlist.numEntry = objlist.numEntry;
    s.objlist.sdobj.length = 0;
    for (const [key, object, priority] of objlist.sdobj) s.objlist.sdobj.push({ key, object: object as ObjectID, priority });
    s.v11014.objcount.set(v11014.objcount);
    s.v11014.objlist.numEntry = v11014.numEntry;
    s.v11014.objlist.sdobj.fill(0);
    for (const [index, object] of v11014.sdobj) s.v11014.objlist.sdobj[index] = object;
}
