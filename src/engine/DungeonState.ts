/**
 * Dungeon state management
 *
 * Provides access to dungeon data (maps, tiles, objects)
 * Based on CSBWin's dungeon data access
 */

import { ui8, ui16, Position, CellFlag, ObjectID, Direction, cellHasObjects, type LocationRel, getRoomType } from '../core/types';
import type {
    ClothingRecord,
    ContainerRecord,
    CreatureRecord,
    CloudRecord,
    DungeonData,
    DoorRecord,
    Item16Record,
    MapData,
    MissileRecord,
    MiscRecord,
    PotionRecord,
    ScrollRecord,
    TeleporterRecord,
    WeaponRecord,
    ActuatorRecord,
    DatabaseRecord,
    Databases,
} from '../data/dungeonTypes';
import { DATABASE_CATEGORY, databaseOf } from '../data/dungeonTypes';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType, rnEquals } from '../core/types';
import type { TextRecord } from '../data/dungeonTypes';
import type { TextDecodeTables } from '../data/tables/ObjectTables';
import type { DirectionTables } from './RelativeXY';
import { DecodeText, SubstituteCharacterNames, type TextSubstitution } from '../data/DecodeText';
import { Expool } from '../data/CsbwinExpool';
import { SkinCache } from './SkinCache';
import { groupFacingsByte } from './monsterPosition';
import { clearedRecords } from '../data/DatabaseCodecs';
import type { DungeonSnapshot } from './DungeonSnapshot';
import { applyDungeonSnapshot, captureDungeonSnapshot } from './DungeonSnapshot';
import type { RnMaps } from '../core/RnMaps';

/**
 * DungeonState - manages dungeon data and queries
 */

/**
 * `DATABASES::Max` (`doc/CSBwin-src/CSB.h:1649`): the most records `Enlarge` grows
 * database `dbNum` to.
 */
/** `EDT_ExtendedCellFlags` (`doc/CSBwin-src/CSB.h:1535`): eight longwords, a bit a row. */
const EDT_EXTENDED_CELL_FLAGS = 2;
/** `ECF_FOOTPRINTS` (`doc/CSBwin-src/CSB.h:1536`): the extended cell flag that shows footprints. */
export const ECF_FOOTPRINTS = 0;

/** `(EDT_ExtendedCellFlags << 24) + (level << 5) + x`: a column's record of extended cell flags. */
export function extendedCellFlagsKey(locr: LocationRel): number {
  return ((EDT_EXTENDED_CELL_FLAGS << 24) | (locr.l << 5) | locr.x) >>> 0;
}

export function dbMax(dbNum: DBType): number {
    return dbNum === DBType.CLOUD ? 768 : dbNum === DBType.ACTUATOR ? 16000 : 8000;
}

export class DungeonState {
    private data: DungeonData;

    /**
     * `MakeMoreRoomInDB`, which `Game` supplies because it needs the systems
     * (`engine/MakeMoreRoomInDB`). Without it a full database refuses the record.
     */
    makeMoreRoomInDB: ((db: DBType) => ObjectID) | null = null;
    /**
     * What `DecodeText`'s `SubstituteCharacterNames` reads of the game, which `Game`
     * supplies. Without it a text is decoded as it stands.
     */
    textSubstitution: TextSubstitution | null = null;
    private timerWord8Lookup?: (index: number) => ui16 | null;
    /**
     * `skinCache`, new with every world taken and every state restored, where CSBWin's
     * `Cleanup` empties it before a game is read (`src/engine/SkinCache.ts`).
     */
    skinCache: SkinCache;

    constructor(data: DungeonData) {
        this.data = data;
        this.skinCache = new SkinCache(data);
    }

    /**
     * Take `data` as the world, as `_ReadEntireGame` reads a whole one, structure included
     * (`Game.installWorld`).
     */
    install(data: DungeonData): void {
        this.data = data;
        this.skinCache = new SkinCache(data);
    }

    /** The world, the one route to it, which play writes through. */
    getData(): DungeonData {
        return this.data;
    }

    /** What each RN of this world names (`RN::dbType`, `pos`, `idx`). */
    get rnMaps(): RnMaps {
        return this.data.rnMaps;
    }

    getSpecialLocation(key: number): number | null {
        const locations = this.data.specialLocations;
        if (!locations) return null;
        const value = locations[key];
        return value === undefined ? null : value;
    }

    getSpellFilterLocation(): number {
        return this.data.spellFilterLocation ?? 0;
    }

    setTimerWord8Lookup(getWord8: (index: number) => ui16 | null): void {
        this.timerWord8Lookup = getWord8;
    }

    /**
     * The three below are `expool`'s (`src/data/CsbwinExpool.ts`). The record's key is the
     * bones' RN, its slot in the object indirect index, which a move within the cell does
     * not change (`RN::pos`, `doc/CSBwin-src/CSBTypes.h:342-348`).
     */
    addChampionBonesRecord(bones: ObjectID, fingerprint: number): void {
        new Expool(this.data).addChampionBonesRecord(bones, fingerprint);
    }

    copyChampionBonesRecord(bones: ObjectID): number | null {
        return new Expool(this.data).copyChampionBonesRecord(bones);
    }

    getChampionBonesRecord(bones: ObjectID): number | null {
        return new Expool(this.data).getChampionBonesRecord(bones);
    }

    /** `expool.Write(key, record, size)`. */
    writeExpoolRecord(key: number, record: readonly number[]): void {
        new Expool(this.data).write(key, record);
    }

    /** `expool.Read(key, …)`: `key`'s first record, which leaves the pool, or null. */
    readExpoolRecord(key: number): number[] | null {
        return new Expool(this.data).read(key);
    }

    /** `expool.Locate(key)`: a copy of `key`'s first record, or null. */
    locateExpoolRecord(key: number): number[] | null {
        return new Expool(this.data).locate(key);
    }

    /** `Locate`'s pointer written through: longword `index` of `key`'s first record. */
    writeLocatedExpoolWord(key: number, index: number, value: number): void {
        new Expool(this.data).writeLocated(key, index, value);
    }

    /**
     * `GetExtendedCellFlag` (`doc/CSBwin-src/data.cpp:1682-1692`): the cell's bit of flag
     * `ftype`, clear without a record of at least eight longwords.
     */
    getExtendedCellFlag(level: number, x: number, y: number, ftype: number): boolean {
        const record = this.locateExpoolRecord(extendedCellFlagsKey({ l: level, x, y, p: 0 }));
        if (!record || record.length < 8) return false;
        return ((record[ftype]! & (1 << y)) >>> 0) !== 0;
    }

    /**
     * Snapshot everything play can change, for the tools' whole state (`RuntimeSave.ts`).
     * See `src/engine/DungeonSnapshot.ts` for what counts as mutable and why.
     */
    captureSnapshot(): DungeonSnapshot {
        return captureDungeonSnapshot(this.data);
    }

    applySnapshot(snapshot: DungeonSnapshot): void {
        applyDungeonSnapshot(this.data, snapshot);
        this.skinCache = new SkinCache(this.data);
    }

    /**
     * Get number of maps
     */
    getMapCount(): ui8 {
        return this.data.maps.length;
    }

    /**
     * Get a map by index
     */
    getMap(index: ui8): MapData | null {
        if (index < 0 || index >= this.data.maps.length) {
            return null;
        }
        return this.data.maps[index]!;
    }

    /** `experienceMultiplier()` of level `level`'s descriptor, its difficulty: 0 past the last level. */
    levelDifficulty(level: number): number {
        return this.getMap(level)?.descriptor.difficulty ?? 0;
    }

    /**
     * Find the map index and coordinates for a level delta using CSBWin's IncrementLevel logic.
     *
     * Ported from CSBWin `IncrementLevel()` (doc/CSBwin-src/CSBCode.cpp:4774-4824).
     */
    incrementLevel(position: Position, delta: number): Position | null {
        const map = this.getMap(position.z);
        if (!map) return null;

        const absX = map.descriptor.offsetX + position.x;
        const absY = map.descriptor.offsetY + position.y;
        const targetLevel = map.descriptor.level + delta;

        for (let idx = 0; idx < this.data.maps.length; idx++) {
            const candidate = this.data.maps[idx]!;
            const desc = candidate.descriptor;
            if (desc.level !== targetLevel) continue;

            const minX = desc.offsetX;
            const maxX = desc.offsetX + desc.width - 1;
            const minY = desc.offsetY;
            const maxY = desc.offsetY + desc.height - 1;

            if (absX < minX || absX > maxX || absY < minY || absY > maxY) continue;

            return new Position(absX - desc.offsetX, absY - desc.offsetY, idx);
        }

        return null;
    }

    /**
     * Find a valid facing when exiting stairs on a level.
     *
     * Ported from CSBWin `ExitStairsDirection()` (doc/CSBwin-src/Code11f52.cpp:325-360).
     */
    getExitStairsDirection(position: Position, fallback: Direction, tables: DirectionTables): Direction {
        const { x, y, z } = position;
        const map = this.getMap(position.z);
        if (!map) return fallback;

        for (let direction = 0; direction < 4; direction++) {
            const newX = x + tables.deltaX[direction]!;
            const newY = y + tables.deltaY[direction]!;
            if (newX < 0 || newY < 0 || newX >= map.descriptor.width || newY >= map.descriptor.height) continue;

            const cellFlag = this.getCellFlag(new Position(newX, newY, z));
            const roomType = getRoomType(cellFlag);

            if (roomType === RoomType.STONE || roomType === RoomType.STAIRS) continue;
            if (roomType === RoomType.FALSEWALL && (cellFlag & 0x05) === 0) continue;

            return direction as Direction;
        }
        return fallback;
    }

    /**
     * Get cell flag at position
     * @returns Cell flag or 0 if out of bounds
     */
    getCellFlag(position: Position): CellFlag {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return 0;

        // Check bounds
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return 0;

        return map.cellFlags[x]![y]!;
    }

    /**
     * Index within `data.objectList` for the first object in (map,x,y), or -1 if none/out of bounds.
     *
     * Ported from CSBWin `GetObjectListIndex()` (doc/CSBwin-src/CSBCode.cpp:5168-5192).
     */
    getObjectListIndex(position: Position): number {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return -1;
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return -1;

        const cellFlag = map.cellFlags[x]![y]!;
        if ((cellFlag & 0x10) === 0) return -1;

        const baseCol = this.data.levelIndex[z]! + x;
        const colBase = this.data.columnIndex[baseCol]!;
        let idx = colBase;

        for (let yy = 0; yy < y; yy++) {
            if ((map.cellFlags[x]![yy]! & 0x10) !== 0) idx++;
        }

        return idx;
    }

    /**
     * Find first object RN in a cell, or `OBJECT_ID_EOF` if none.
     *
     * Ported from CSBWin `FindFirstObject()` (doc/CSBwin-src/CSBCode.cpp:5195-5202).
     */
    findFirstObject(position: Position): ObjectID {
        const idx = this.getObjectListIndex(position);
        if (idx < 0) return OBJECT_ID_EOF;
        return this.data.objectList[idx] ?? OBJECT_ID_EOF;
    }

    /**
     * Update the head object RN for a cell's object list.
     */
    setFirstObject(position: Position, rn: ObjectID): void {
        const idx = this.getObjectListIndex(position);
        if (idx < 0) return;
        this.data.objectList[idx] = rn;
    }

    /**
     * `AddObjectToRoom(newObj, RNnul, mapX, mapY, NULL)` (`doc/CSBwin-src/Code11f52.cpp:427`):
     * clear the new object's link (`:463`), then make it the cell's first object or hang it
     * off the last one. Returns false if the cell is out of bounds.
     */
    addObjectToCell(position: Position, rn: ObjectID): boolean {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return false;
        if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;

        this.setDBRecordLink(rn, OBJECT_ID_EOF);
        const cellFlag = map.cellFlags[x]![y]!;
        const hasObjects = (cellFlag & 0x10) !== 0;
        const baseCol = this.data.levelIndex[z]! + x;

        if (!hasObjects) {
            if (baseCol < 0 || baseCol >= this.data.columnIndex.length) return false;
            let idx = this.data.columnIndex[baseCol] ?? 0;
            for (let yy = 0; yy < y; yy++) {
                if ((map.cellFlags[x]![yy]! & 0x10) !== 0) idx++;
            }
            this.data.objectList.splice(idx, 0, rn);
            for (let col = baseCol + 1; col < this.data.columnIndex.length; col++) {
                this.data.columnIndex[col] = (this.data.columnIndex[col]! + 1) & 0xffff;
            }
            this.setCellHasObjects(map, x, y, true);
            this.data.header.objectListSize = this.data.objectList.length;
            return true;
        }

        const idx = this.getObjectListIndex(position);
        if (idx < 0) return false;
        let current = this.data.objectList[idx] ?? OBJECT_ID_EOF;
        if (current === OBJECT_ID_EOF) {
            this.data.objectList[idx] = rn;
            return true;
        }
        for (;;) {
            const next = this.getDBRecordLink(current);
            if (next === OBJECT_ID_EOF) break;
            current = next;
        }
        this.setDBRecordLink(current, rn);
        return true;
    }

    /**
     * `AddObjectToRoom(newObj, prevObj, -1, 0, NULL)` — the arm with no cell
     * (`doc/CSBwin-src/Code11f52.cpp:463`, `:526-534`): clear the new object's link,
     * then hang it off the last object of the chain `prevObj` is in.
     */
    addObjectToChain(newObj: ObjectID, prevObj: ObjectID): void {
        if (newObj === OBJECT_ID_EOF) return;
        this.setDBRecordLink(newObj, OBJECT_ID_EOF);
        let last = prevObj;
        for (let next = this.getDBRecordLink(last); next !== OBJECT_ID_EOF; next = this.getDBRecordLink(next)) {
            last = next;
        }
        this.setDBRecordLink(last, newObj);
    }

    /**
     * Remove an object RN from the cell's object list.
     * Returns true if removed.
     */
    removeObjectFromCell(position: Position, rn: ObjectID): boolean {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return false;
        if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;

        const idx = this.getObjectListIndex(position);
        if (idx < 0) return false;
        let head = this.data.objectList[idx] ?? OBJECT_ID_EOF;
        if (head === OBJECT_ID_EOF) return false;

        if (rnEquals(head, rn)) {
            const next = this.getDBRecordLink(head);
            if (next === OBJECT_ID_EOF) {
                this.data.objectList.splice(idx, 1);
                const baseCol = this.data.levelIndex[z]! + x;
                for (let col = baseCol + 1; col < this.data.columnIndex.length; col++) {
                    this.data.columnIndex[col] = (this.data.columnIndex[col]! - 1) & 0xffff;
                }
                this.setCellHasObjects(map, x, y, false);
                this.data.header.objectListSize = this.data.objectList.length;
            } else {
                this.data.objectList[idx] = next;
            }
            this.setDBRecordLink(rn, OBJECT_ID_EOF);
            return true;
        }

        let prev = head;
        let current = this.getDBRecordLink(prev);
        while (current !== OBJECT_ID_EOF) {
            if (rnEquals(current, rn)) {
                const next = this.getDBRecordLink(current);
                this.setDBRecordLink(prev, next);
                this.setDBRecordLink(current, OBJECT_ID_EOF);
                return true;
            }
            prev = current;
            current = this.getDBRecordLink(current);
        }

        return false;
    }

    private setCellHasObjects(map: MapData, x: number, y: number, hasObjects: boolean): void {
        let cellFlag = map.cellFlags[x]![y]!;
        if (hasObjects) cellFlag |= 0x10;
        else cellFlag &= 0xef;
        map.cellFlags[x]![y] = cellFlag;
    }

    /**
     * Return the linked-list next pointer for a record RN, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `GetDBRecordLink()` (doc/CSBwin-src/CSBCode.cpp:5155-5165).
     */
    getDBRecordLink(rn: ObjectID): ObjectID {
        return this.getRecord(rn)?.nextObject ?? OBJECT_ID_EOF;
    }

    /**
     * Update the next link pointer for a database record.
     */
    setDBRecordLink(rn: ObjectID, next: ObjectID): void {
        const record = this.getRecord(rn);
        if (record) record.nextObject = next;
    }

    /**
     * `FindEmptyDB<n>Entry` (`doc/CSBwin-src/CSBCode.cpp:5007-5149`) over
     * `DATABASES::FindEmptyDBEntry` (`doc/CSBwin-src/data.cpp:920-992`): the RN of a new
     * object of database `db`, whose record then holds `record`; `RNnul` when there is
     * no room.
     *
     * `FindEmptyDBEntry` walks the index for a slot whose record is free, noting the
     * lowest free slot on the way (`RnMaps.findEmptyIndexEntry`), then the records from
     * 1 for a free one (`:956-968`), and gives the record that slot, or a new one, at
     * corner 0 (`RnMaps.assignIndexEntry`). `important`, CSBWin's own argument, lets it
     * make a new slot when the index is all but full: a DSA's copy and a champion's
     * bones pass it (`DSA.cpp:1774-1869`, `Character.cpp:2630`).
     *
     * With no free record it `Enlarge`s the database (`enlarge`) and names the first new
     * record through `RN(dbType, index)` (`:969-974`). When the database is at `db.Max`
     * already, or `FindEmptyDBEntry` gives `RNnul`, it falls back on `MakeMoreRoomInDB`
     * (`makeMoreRoomInDB`) and stores `record` over the record of the RN that gives.
     */
    findEmptyDBEntry<K extends keyof Databases>(db: K, record: Databases[K]['records'][number], important = false): ObjectID {
        const dbType = DATABASE_CATEGORY[db];
        const database = databaseOf(this.data.databases, dbType)!;
        let { emptyIndexEntry, emptyDBEntry } = this.rnMaps.findEmptyIndexEntry(dbType);
        if (emptyDBEntry === -1) {
            for (let i = 1; i < database.records.length; i++) {
                if (database.records[i]!.nextObject !== OBJECT_ID_NULL) continue;
                emptyDBEntry = i;
                break;
            }
        }
        let result: ObjectID = OBJECT_ID_NULL;
        if (emptyDBEntry === -1) {
            const index = this.enlarge(dbType);
            if (index !== -1) {
                database.records[index] = record;
                return this.rnMaps.rn(dbType, index);
            }
        } else {
            result = this.rnMaps.assignIndexEntry(emptyIndexEntry, dbType, emptyDBEntry, important);
        }
        if (result === OBJECT_ID_NULL) {
            result = this.makeMoreRoomInDB?.(dbType) ?? OBJECT_ID_NULL;
            if (result === OBJECT_ID_NULL) return OBJECT_ID_NULL;
            database.records[this.rnMaps.idx(result)] = record;
            return result;
        }
        database.records[emptyDBEntry] = record;
        return result;
    }

    /**
     * `ReadDatabases`' sizes for a new game (`doc/CSBwin-src/SaveGame.cpp:2768-2776`): each
     * database holds the file's records and `d.Byte7302[db]` more, which
     * `DATABASES::Allocate` clears to link `RNnul` behind the file's (`data.cpp:774-802`).
     * The header's `DBSize`, `objectCounts` here, says so, and a save then declares it.
     * Every `graphics.dat` the port reads gives the expool and the two unused databases
     * none.
     */
    addNewGameSpares(byte7302: ArrayLike<number>): void {
        for (let db = 0; db < 16; db++) {
            const spares = byte7302[db] ?? 0;
            const database = databaseOf(this.data.databases, db as DBType);
            if (spares === 0) continue;
            if (database === undefined) throw new Error(`Byte7302 gives database ${db} ${spares} spare records`);
            database.records.push(...clearedRecords(db as DBType, spares, this.data));
            database.count = database.records.length & 0xffff;
            this.data.header.objectCounts[db] = database.count;
        }
    }

    /**
     * `DATABASES::Enlarge` (`doc/CSBwin-src/data.cpp:814-877`): database `dbType` grows by
     * 100 cleared records, their link `RNnul` and the first's `RNeof`, and the index of
     * that first record, the old size, is returned. -1 once the database holds `db.Max`
     * records (`dbMax`). The header's `DBSize`, `objectCounts` here, becomes the new
     * size, which a save then declares. CSBWin asks the player first unless
     * `AutoEnlarge`, which it sets on the line before (`:844`), and nothing sets
     * `m_noEnlarge`, so it always goes ahead.
     */
    enlarge(dbType: DBType): number {
        const database = databaseOf(this.data.databases, dbType);
        if (database === undefined) return -1;
        const records = database.records;
        if (records.length >= dbMax(dbType)) return -1;
        const iNew = records.length;
        const newSize = iNew + 100;
        records.push(...clearedRecords(dbType, 100, this.data));
        database.count = newSize & 0xffff;
        this.data.header.objectCounts[dbType] = newSize & 0xffff;
        records[iNew]!.nextObject = OBJECT_ID_EOF;
        return iNew;
    }

    /**
     * `DeleteDBEntry` (`doc/CSBwin-src/data.cpp:995-1017`): the record's link becomes
     * `RNnul` and the slot naming it is freed (`RnMaps.deleteIndexEntry`), unless it is
     * "Cloned!!!", when nothing changes. An RN whose slot is free names no record.
     */
    deleteDBEntry(rn: ObjectID): void {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return;
        const { category, index } = this.rnMaps.decode(rn);
        const rec = databaseOf(this.data.databases, category)?.records[index];
        if (!rec) return;
        if (!this.rnMaps.deleteIndexEntry(category, index)) return;
        rec.nextObject = OBJECT_ID_NULL;
    }

    /**
     * The record `rn` names, of whatever database, or null. Only `findEmptyDBEntry` puts a
     * new record object in a slot, so the same object means the same record.
     */
    getRecord(rn: ObjectID): DatabaseRecord | null {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return null;
        const { category, index } = this.rnMaps.decode(rn);
        return databaseOf(this.data.databases, category)?.records[index] ?? null;
    }

    /**
     * Find the first DOOR record RN in a cell, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `FindFirstDoor()` semantics (doc/CSBwin-src/Code11f52.cpp:614+).
     */
    findFirstDoor(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (this.rnMaps.dbType(rn) === DBType.DOOR) return rn;
        }
        return OBJECT_ID_EOF;
    }

    /**
     * `FindFirstMonster` (doc/CSBwin-src/Code11f52.cpp:568, :639) — the first creature in
     * the cell's object chain, or `OBJECT_ID_EOF`.
     */
    findFirstMonster(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (this.rnMaps.dbType(rn) === DBType.CREATURE) return rn;
        }
        return OBJECT_ID_EOF;
    }

    /**
     * `MonsterAllowedOnLevel` (doc/CSBwin-src/Code11f52.cpp:155) — is `monsterType` among
     * the creature types the level's descriptor lists. CSBWin also accepts an RN and
     * reads the type from its record; callers here resolve the record first.
     */
    monsterAllowedOnLevel(monsterType: number, level: number): boolean {
        const map = this.getMap(level);
        if (!map) return false;
        for (const entry of map.monsterTypes ?? []) {
            if ((entry & 0xff) === (monsterType & 0xff)) return true;
        }
        return false;
    }

    /**
     * `LOCATIONREL::IsValid` (doc/CSBwin-src/DSA.cpp:311) — a level that exists and a
     * cell inside its bounds.
     */
    isValidLocation(locr: LocationRel): boolean {
        const map = this.getMap(locr.l);
        if (!map) return false;
        if (locr.x < 0 || locr.y < 0) return false;
        if (locr.x >= map.descriptor.width || locr.y >= map.descriptor.height) return false;
        return true;
    }

    /**
     * `d.DoorTOC[doorType]` for `level` — built at level load from the level descriptor's
     * two door type indices into `DoorCharacteristics[4]`
     * (doc/CSBwin-src/CSBCode.cpp:5845-5848). The low byte is the force needed to bash
     * the door; bit 8 marks a door monsters may walk through.
     */
    doorTOC(level: number, doorType: number, doorCharacteristics: ArrayLike<number> | null | undefined): number {
        if (!doorCharacteristics) return 0;
        const map = this.getMap(level);
        if (!map) return 0;
        const index = (doorType & 0x1) === 0
            ? map.descriptor.doorType0Index
            : map.descriptor.doorType1Index;
        return doorCharacteristics[index & 0x3] ?? 0;
    }

    /** The record `rn` names in database `key`, or null when it names another database's. */
    private recordIn<K extends keyof Databases>(rn: ObjectID, key: K): Databases[K]['records'][number] | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DATABASE_CATEGORY[key]) return null;
        return this.data.databases[key].records[index] ?? null;
    }

    getTextRecord(rn: ObjectID): TextRecord | null {
        return this.recordIn(rn, 'texts');
    }

    getDsaLevelIndex(level: number, selector: number): number | null {
        const table = this.data.dsaLevelIndex;
        if (!table) return null;
        const row = table[level];
        if (!row) return null;
        return row[selector] ?? null;
    }

    getActuatorRecord(rn: ObjectID): ActuatorRecord | null {
        return this.recordIn(rn, 'actuators');
    }

    getDoorRecordByIndex(index: number): DoorRecord | null {
        return this.data.databases.doors.records[index] ?? null;
    }

    getTeleporterRecord(rn: ObjectID): TeleporterRecord | null {
        return this.recordIn(rn, 'teleporters');
    }


    getWeaponRecord(rn: ObjectID): WeaponRecord | null {
        return this.recordIn(rn, 'weapons');
    }

    getClothingRecord(rn: ObjectID): ClothingRecord | null {
        return this.recordIn(rn, 'clothing');
    }

    getScrollRecord(rn: ObjectID): ScrollRecord | null {
        return this.recordIn(rn, 'scrolls');
    }

    getPotionRecord(rn: ObjectID): PotionRecord | null {
        return this.recordIn(rn, 'potions');
    }

    getContainerRecord(rn: ObjectID): ContainerRecord | null {
        return this.recordIn(rn, 'containers');
    }

    getMiscRecord(rn: ObjectID): MiscRecord | null {
        return this.recordIn(rn, 'misc');
    }

    getCreatureRecord(rn: ObjectID): CreatureRecord | null {
        return this.recordIn(rn, 'creatures');
    }

    getMissileRecord(rn: ObjectID): MissileRecord | null {
        return this.recordIn(rn, 'missiles');
    }

    getCloudRecord(rn: ObjectID): CloudRecord | null {
        return this.recordIn(rn, 'clouds');
    }

    getItem16Record(index: number): Item16Record | null {
        const items = this.data.item16;
        if (!items || index < 0 || index >= items.length) return null;
        return items[index] ?? null;
    }

    /**
     * The mutable `ITEM16` pool, created empty if the dungeon had none.
     *
     * `MonsterSystem` owns the pool's contents — CSBWin allocates and reallocates
     * `d.Item16` as monsters come and go — so it needs the array itself, not a
     * read-only view of the surrounding `DungeonData`.
     */
    getItem16Pool(): Item16Record[] {
        if (!this.data.item16) this.data.item16 = [];
        return this.data.item16;
    }

    /**
     * A creature record by bare DB4 index, as CSBWin's
     * `GetRecordAddressDB4(pi16A3->word0)` does — `ITEM16.word0` stores the index
     * alone, with no position or category bits.
     */
    getCreatureRecordByIndex(index: number): CreatureRecord | null {
        if (index < 0) return null;
        return this.data.databases.creatures.records[index] ?? null;
    }

    /**
     * Word 8 of timer `index`, a missile's flight direction, read from the live queue as
     * CSBWin reads `d.Timers[missile.timerIndex()]`. `null` for a slot the queue does not
     * hold, where CSBWin would read what the slot kept; a missile in a cell always has its
     * timer queued, so the renderer never asks for one.
     */
    getTimerWord8(index: number): ui16 | null {
        return this.timerWord8Lookup?.(index) ?? null;
    }

    /**
     * The `ITEM16` attached to a monster group, or null when it has none.
     *
     * Mirrors CSBWin's test, which is the bare bound check `groupIndex() <
     * d.MaxITEM16` (doc/CSBwin-src/Monster.cpp:531). That works in CSBWin because a
     * monster not on the party's level has its index parked at 0xd8 or 0xff by
     * `MoveObject` (doc/CSBwin-src/MoveObject.cpp:517-518), and because the array is
     * only ever as long as the slots that exist. On a freshly loaded dungeon the
     * array is empty and every monster correctly reads as unattached, which is the
     * state `ProcessMonstersOnLevel` then fixes.
     */
    getAttachedItem16(creature: CreatureRecord): Item16Record | null {
        const items = this.data.item16;
        if (!items || creature.groupIndex >= items.length) return null;
        return items[creature.groupIndex] ?? null;
    }

    getMonsterRenderState(creature: CreatureRecord): { positions: ui8; facings: ui8; statuses: Uint8Array } {
        const item16 = this.getAttachedItem16(creature);
        if (item16) {
            const statuses = new Uint8Array(4);
            for (let i = 0; i < 4; i++) statuses[i] = item16.singleMonsterStatus[i] ?? 0;
            return {
                positions: item16.positions,
                facings: item16.facings,
                statuses
            };
        }

        // No ITEM16: `groupIndex` is itself the packed positions byte, and the whole
        // group faces whichever way DB4.word14 says.
        return {
            positions: creature.groupIndex,
            facings: groupFacingsByte(creature.facing),
            statuses: new Uint8Array(4)
        };
    }


    /**
     * Check if a position has objects
     * @returns True if position has objects
     */
    hasObjects(position: Position): boolean {
        return cellHasObjects(this.getCellFlag(position));
    }

    // Get start position from dungeon header
    getStartPosition(): Position {
        return new Position(this.data.header.startPosition.x, this.data.header.startPosition.y, this.data.header.startPosition.z);
    }

    // Get start facing direction
    getStartFacing(): number {
        return this.data.header.facing;
    }

    decodeWallTextBytes(record: TextRecord, tables: TextDecodeTables): Uint8Array | null {
        return this.decodeTextBytes(record, 0, 990, tables);
    }

    decodeTextBytes(record: TextRecord, typeOfText: number, max: number, tables: TextDecodeTables): Uint8Array | null {
        return this.decodeText(record, typeOfText, max, tables)?.text ?? null;
    }

    /**
     * `DecodeText` (`doc/CSBwin-src/CSBCode.cpp:5552-5733`) with its substitution: `ok` is
     * false where CSBWin returns -1, a name or text to substitute that is not there.
     */
    decodeText(
        record: TextRecord, typeOfText: number, max: number, tables: TextDecodeTables,
    ): { text: Uint8Array; ok: boolean } | null {
        const text = DecodeText(this.data, record, typeOfText, max, tables);
        if (!text) return null;
        if (!this.textSubstitution) return { text, ok: true };
        return SubstituteCharacterNames(text, max, typeOfText === 0, this.textSubstitution);
    }

    decodeTextString(record: TextRecord, typeOfText: number, tables: TextDecodeTables, max = 990): string | null {
        const bytes = this.decodeTextBytes(record, typeOfText, max, tables);
        if (!bytes) return null;
        return typeOfText === 0
            ? this.wallTextBytesToString(bytes)
            : this.textBytesToString(bytes);
    }

    /**
     * The text a party arriving on its square reads, or null when it is hidden or
     * `DecodeText` returns -1 (`doc/CSBwin-src/Code11f52.cpp:3995-4002`).
     */
    decodeMessageText(record: TextRecord, tables: TextDecodeTables): string | null {
        const decoded = this.decodeText(record, 1, 990, tables);
        return decoded?.ok ? this.textBytesToString(decoded.text) : null;
    }

    decodeScrollText(scroll: ScrollRecord, tables: TextDecodeTables): string | null {
        const rec = this.getTextRecordByIndex(scroll.textReference);
        if (!rec) return null;
        return this.decodeTextString(rec, 0x8002, tables);
    }

    private wallTextBytesToString(bytes: Uint8Array): string {
        let out = '';
        for (const b of bytes) {
            if (b === 0x81) break;
            if (b === 0x80) {
                out += '\n';
                continue;
            }
            if (b >= 0 && b <= 25) out += String.fromCharCode(65 + b);
            else if (b === 26) out += ' ';
            else if (b === 27) out += '.';
        }
        return out;
    }

    private textBytesToString(bytes: Uint8Array): string {
        let out = '';
        for (const b of bytes) {
            if (b === 0) break;
            if (b === 10) {
                out += '\n';
                continue;
            }
            out += String.fromCharCode(b);
        }
        return out;
    }

    private getTextRecordByIndex(index: number): TextRecord | null {
        if (index < 0 || index >= this.data.databases.texts.records.length) return null;
        return this.data.databases.texts.records[index] ?? null;
    }

    /**
     * Get map dimensions
     */
    getMapDimensions(mapIndex: ui8): { width: ui8; height: ui8 } | null {
        const map = this.getMap(mapIndex);
        if (!map) {
            return null;
        }
        return {
            width: map.descriptor.width,
            height: map.descriptor.height,
        };
    }
}
