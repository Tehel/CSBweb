/**
 * Dungeon state management
 *
 * Provides access to dungeon data (maps, tiles, objects)
 * Based on CSBWin's dungeon data access
 */

import { ui8, ui16, Position, CellFlag, ObjectID, Direction, cellHasObjects, type LocationRel } from '../core/types';
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
    Database,
    DatabaseRecord,
    Databases,
} from '../data/dungeonTypes';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType, rnEquals } from '../core/types';
import type { TextRecord } from '../data/dungeonTypes';
import type { TextDecodeTables } from '../data/tables/ObjectTables';
import { DecodeText, SubstituteCharacterNames, type TextSubstitution } from '../data/DecodeText';
import { Expool } from '../data/CsbwinExpool';
import { SkinCache } from './SkinCache';
import { DungeonLoader } from '../data/DungeonLoader';
import type { DungeonSnapshot } from './DungeonSnapshot';
import { applyDungeonSnapshot, captureDungeonSnapshot } from './DungeonSnapshot';
import type { RnMaps } from '../core/RnMaps';

/**
 * DungeonState - manages dungeon data and queries
 */
/** The database each `Databases` key holds. */
export const DATABASE_CATEGORY: Record<keyof Databases, DBType> = {
    doors: DBType.DOOR,
    teleporters: DBType.TELEPORTER,
    texts: DBType.TEXT,
    actuators: DBType.ACTUATOR,
    creatures: DBType.CREATURE,
    weapons: DBType.WEAPON,
    clothing: DBType.CLOTHING,
    scrolls: DBType.SCROLL,
    potions: DBType.POTION,
    containers: DBType.CHEST,
    misc: DBType.MISC,
    missiles: DBType.MISSILE,
    clouds: DBType.CLOUD,
};

/** The `Databases` key of each database the port holds records for. */
const DATABASE_KEY: Partial<Record<DBType, keyof Databases>> = Object.fromEntries(
    Object.entries(DATABASE_CATEGORY).map(([key, db]) => [db, key])) as Partial<Record<DBType, keyof Databases>>;

/**
 * `DATABASES::Max` (`doc/CSBwin-src/CSB.h:1646`): the most records `Enlarge` grows
 * database `dbNum` to.
 */
/** `EDT_ExtendedCellFlags` (`doc/CSBwin-src/CSB.h:1532`): eight longwords, a bit a row. */
const EDT_EXTENDED_CELL_FLAGS = 2;
/** `ECF_FOOTPRINTS` (`doc/CSBwin-src/CSB.h:1533`): the extended cell flag that shows footprints. */
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

    /**
     * Get dungeon data
     */
    getData(): Readonly<DungeonData> {
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
     * not change (`RN::pos`, `doc/CSBwin-src/CSBTypes.h:336-342`).
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
     * `GetExtendedCellFlag` (`doc/CSBwin-src/data.cpp:1679-1689`): the cell's bit of flag
     * `ftype`, clear without a record of at least eight longwords.
     */
    getExtendedCellFlag(level: number, x: number, y: number, ftype: number): boolean {
        const record = this.locateExpoolRecord(extendedCellFlagsKey({ l: level, x, y, p: 0 }));
        if (!record || record.length < 8) return false;
        return ((record[ftype]! & (1 << y)) >>> 0) !== 0;
    }

    /**
     * Snapshot everything play can change, for the state a read restores (`RuntimeSave.ts`).
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
        return this.data.maps[index];
    }

    /**
     * Find the map index and coordinates for a level delta using CSBWin's IncrementLevel logic.
     *
     * Ported from CSBWin `IncrementLevel()` (doc/CSBwin-src/CSBCode.cpp:4709-4759).
     */
    incrementLevel(position: Position, delta: number): Position | null {
        const map = this.getMap(position.z);
        if (!map) return null;

        const absX = map.descriptor.offsetX + position.x;
        const absY = map.descriptor.offsetY + position.y;
        const targetLevel = map.descriptor.level + delta;

        for (let idx = 0; idx < this.data.maps.length; idx++) {
            const candidate = this.data.maps[idx];
            const desc = candidate.descriptor;
            if (desc.level !== targetLevel) continue;

            const minX = desc.offsetX;
            const maxX = desc.offsetX + desc.width - 1;
            const minY = desc.offsetY;
            const maxY = desc.offsetY + desc.height - 1;

            if (absX < minX || absX > maxX || absY < minY || absY > maxY) continue;

            return new Position(absX - desc.offsetX, absY - desc.offsetY, idx as ui8);
        }

        return null;
    }

    /**
     * Find a valid facing when exiting stairs on a level.
     *
     * Ported from CSBWin `ExitStairsDirection()` (doc/CSBwin-src/Code11f52.cpp:290-325).
     */
    getExitStairsDirection(position: Position, fallback: Direction): Direction {
        const { x, y, z } = position;
        const map = this.getMap(position.z);
        if (!map) return fallback;

        const deltaX = [0, 1, 0, -1];
        const deltaY = [-1, 0, 1, 0];

        for (let direction = 0; direction < 4; direction++) {
            const newX = x + deltaX[direction];
            const newY = y + deltaY[direction];
            if (newX < 0 || newY < 0 || newX >= map.descriptor.width || newY >= map.descriptor.height) continue;

            const cellFlag = this.getCellFlag(new Position(newX, newY, z));
            const roomType = (cellFlag >> 5) & 0x7;

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

        return map.cellFlags[x][y];
    }

    /**
     * Index within `data.objectList` for the first object in (map,x,y), or -1 if none/out of bounds.
     *
     * Ported from CSBWin `GetObjectListIndex()` (doc/CSBwin-src/CSBCode.cpp:5103-5127).
     */
    getObjectListIndex(position: Position): number {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return -1;
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return -1;

        const cellFlag = map.cellFlags[x][y];
        if ((cellFlag & 0x10) === 0) return -1;

        const baseCol = this.data.levelIndex[z] + x;
        const colBase = this.data.columnIndex[baseCol];
        let idx = colBase;

        for (let yy = 0; yy < y; yy++) {
            if ((map.cellFlags[x][yy] & 0x10) !== 0) idx++;
        }

        return idx;
    }

    /**
     * Find first object RN in a cell, or `OBJECT_ID_EOF` if none.
     *
     * Ported from CSBWin `FindFirstObject()` (doc/CSBwin-src/CSBCode.cpp:5130-5137).
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
     * `AddObjectToRoom(newObj, RNnul, mapX, mapY, NULL)` (`doc/CSBwin-src/Code11f52.cpp:392`):
     * clear the new object's link (`:428`), then make it the cell's first object or hang it
     * off the last one. Returns false if the cell is out of bounds.
     */
    addObjectToCell(position: Position, rn: ObjectID): boolean {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return false;
        if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;

        this.setDBRecordLink(rn, OBJECT_ID_EOF);
        const cellFlag = map.cellFlags[x][y];
        const hasObjects = (cellFlag & 0x10) !== 0;
        const baseCol = this.data.levelIndex[z] + x;

        if (!hasObjects) {
            if (baseCol < 0 || baseCol >= this.data.columnIndex.length) return false;
            let idx = this.data.columnIndex[baseCol] ?? 0;
            for (let yy = 0; yy < y; yy++) {
                if ((map.cellFlags[x][yy] & 0x10) !== 0) idx++;
            }
            this.data.objectList.splice(idx, 0, rn);
            for (let col = baseCol + 1; col < this.data.columnIndex.length; col++) {
                this.data.columnIndex[col] = (this.data.columnIndex[col] + 1) & 0xffff;
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
     * (`doc/CSBwin-src/Code11f52.cpp:428`, `:491-499`): clear the new object's link,
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
                const baseCol = this.data.levelIndex[z] + x;
                for (let col = baseCol + 1; col < this.data.columnIndex.length; col++) {
                    this.data.columnIndex[col] = (this.data.columnIndex[col] - 1) & 0xffff;
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
        let cellFlag = map.cellFlags[x][y];
        if (hasObjects) cellFlag |= 0x10;
        else cellFlag &= 0xef;
        map.cellFlags[x][y] = cellFlag;
    }

    /**
     * Return the linked-list next pointer for a record RN, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `GetDBRecordLink()` (doc/CSBwin-src/CSBCode.cpp:5090-5100).
     */
    getDBRecordLink(rn: ObjectID): ObjectID {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return OBJECT_ID_EOF;
        const { category, index } = this.rnMaps.decode(rn);

        switch (category) {
            case DBType.DOOR:
                return this.data.databases.doors.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.TELEPORTER:
                return this.data.databases.teleporters.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.TEXT:
                return this.data.databases.texts.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.ACTUATOR:
                return this.data.databases.actuators.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CREATURE:
                return this.data.databases.creatures.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.WEAPON:
                return this.data.databases.weapons.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CLOTHING:
                return this.data.databases.clothing.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.SCROLL:
                return this.data.databases.scrolls.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.POTION:
                return this.data.databases.potions.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CHEST:
                return this.data.databases.containers.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.MISC:
                return this.data.databases.misc.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.MISSILE:
                return this.data.databases.missiles.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CLOUD:
                return this.data.databases.clouds.records[index]?.nextObject ?? OBJECT_ID_EOF;
            default:
                return OBJECT_ID_EOF;
        }
    }

    /**
     * Update the next link pointer for a database record.
     */
    setDBRecordLink(rn: ObjectID, next: ObjectID): void {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return;
        const { category, index } = this.rnMaps.decode(rn);

        switch (category) {
            case DBType.DOOR:
                if (this.data.databases.doors.records[index]) {
                    this.data.databases.doors.records[index].nextObject = next;
                }
                break;
            case DBType.TELEPORTER:
                if (this.data.databases.teleporters.records[index]) {
                    this.data.databases.teleporters.records[index].nextObject = next;
                }
                break;
            case DBType.TEXT:
                if (this.data.databases.texts.records[index]) {
                    this.data.databases.texts.records[index].nextObject = next;
                }
                break;
            case DBType.ACTUATOR:
                if (this.data.databases.actuators.records[index]) {
                    this.data.databases.actuators.records[index].nextObject = next;
                }
                break;
            case DBType.CREATURE:
                if (this.data.databases.creatures.records[index]) {
                    this.data.databases.creatures.records[index].nextObject = next;
                }
                break;
            case DBType.WEAPON:
                if (this.data.databases.weapons.records[index]) {
                    this.data.databases.weapons.records[index].nextObject = next;
                }
                break;
            case DBType.CLOTHING:
                if (this.data.databases.clothing.records[index]) {
                    this.data.databases.clothing.records[index].nextObject = next;
                }
                break;
            case DBType.SCROLL:
                if (this.data.databases.scrolls.records[index]) {
                    this.data.databases.scrolls.records[index].nextObject = next;
                }
                break;
            case DBType.POTION:
                if (this.data.databases.potions.records[index]) {
                    this.data.databases.potions.records[index].nextObject = next;
                }
                break;
            case DBType.CHEST:
                if (this.data.databases.containers.records[index]) {
                    this.data.databases.containers.records[index].nextObject = next;
                }
                break;
            case DBType.MISC:
                if (this.data.databases.misc.records[index]) {
                    this.data.databases.misc.records[index].nextObject = next;
                }
                break;
            case DBType.MISSILE:
                if (this.data.databases.missiles.records[index]) {
                    this.data.databases.missiles.records[index].nextObject = next;
                }
                break;
            case DBType.CLOUD:
                if (this.data.databases.clouds.records[index]) {
                    this.data.databases.clouds.records[index].nextObject = next;
                }
                break;
            default:
                break;
        }
    }

    /**
     * `FindEmptyDB<n>Entry` (`doc/CSBwin-src/CSBCode.cpp:4942-5084`) over
     * `DATABASES::FindEmptyDBEntry` (`doc/CSBwin-src/data.cpp:918-990`): the RN of a new
     * object of database `db`, whose record then holds `record`; `RNnul` when there is
     * no room.
     *
     * `FindEmptyDBEntry` walks the index for a slot whose record is free, noting the
     * lowest free slot on the way (`RnMaps.findEmptyIndexEntry`), then the records from
     * 1 for a free one (`:954-966`), and gives the record that slot, or a new one, at
     * corner 0 (`RnMaps.assignIndexEntry`). `important`, CSBWin's own argument, lets it
     * make a new slot when the index is all but full: a DSA's copy and a champion's
     * bones pass it (`DSA.cpp:1773-1868`, `Character.cpp:2625`).
     *
     * With no free record it `Enlarge`s the database (`enlarge`) and names the first new
     * record through `RN(dbType, index)` (`:967-972`). When the database is at `db.Max`
     * already, or `FindEmptyDBEntry` gives `RNnul`, it falls back on `MakeMoreRoomInDB`
     * (`makeMoreRoomInDB`) and stores `record` over the record of the RN that gives.
     */
    findEmptyDBEntry<K extends keyof Databases>(db: K, record: Databases[K]['records'][number], important = false): ObjectID {
        const database = this.data.databases[db] as Database<DatabaseRecord>;
        const dbType = DATABASE_CATEGORY[db];
        let { emptyIndexEntry, emptyDBEntry } = this.rnMaps.findEmptyIndexEntry(dbType);
        if (emptyDBEntry === -1) {
            for (let i = 1; i < database.records.length; i++) {
                if (database.records[i].nextObject !== OBJECT_ID_NULL) continue;
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
     * `ReadDatabases`' sizes for a new game (`doc/CSBwin-src/SaveGame.cpp:2556-2564`): each
     * database holds the file's records and `d.Byte7302[db]` more, which
     * `DATABASES::Allocate` clears to link `RNnul` behind the file's (`data.cpp:773-801`).
     * The header's `DBSize`, `objectCounts` here, says so, and a save then declares it.
     * Every `graphics.dat` the port reads gives the expool and the two unused databases
     * none.
     */
    addNewGameSpares(byte7302: ArrayLike<number>): void {
        for (let db = 0; db < 16; db++) {
            const spares = byte7302[db] ?? 0;
            const key = DATABASE_KEY[db as DBType];
            if (spares === 0) continue;
            if (key === undefined) throw new Error(`Byte7302 gives database ${db} ${spares} spare records`);
            const database = this.data.databases[key] as Database<DatabaseRecord>;
            database.records.push(...new DungeonLoader().clearedRecords(db as DBType, spares, this.data));
            database.count = database.records.length & 0xffff;
            this.data.header.objectCounts[db] = database.count;
        }
    }

    /**
     * `DATABASES::Enlarge` (`doc/CSBwin-src/data.cpp:813-876`): database `dbType` grows by
     * 100 cleared records, their link `RNnul` and the first's `RNeof`, and the index of
     * that first record, the old size, is returned. -1 once the database holds `db.Max`
     * records (`dbMax`). The header's `DBSize`, `objectCounts` here, becomes the new
     * size, which a save then declares. CSBWin asks the player first unless
     * `AutoEnlarge`, which it sets on the line before (`:843`), and nothing sets
     * `m_noEnlarge`, so it always goes ahead.
     */
    enlarge(dbType: DBType): number {
        const key = DATABASE_KEY[dbType];
        if (key === undefined) return -1;
        const database = this.data.databases[key] as Database<DatabaseRecord>;
        const records = database.records;
        if (records.length >= dbMax(dbType)) return -1;
        const iNew = records.length;
        const newSize = iNew + 100;
        records.push(...new DungeonLoader().clearedRecords(dbType, 100, this.data));
        database.count = newSize & 0xffff;
        this.data.header.objectCounts[dbType] = newSize & 0xffff;
        records[iNew].nextObject = OBJECT_ID_EOF;
        return iNew;
    }

    /**
     * `DeleteDBEntry` (`doc/CSBwin-src/data.cpp:993-1015`): the record's link becomes
     * `RNnul` and the slot naming it is freed (`RnMaps.deleteIndexEntry`), unless it is
     * "Cloned!!!", when nothing changes. An RN whose slot is free names no record.
     */
    deleteDBEntry(rn: ObjectID): void {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return;
        const { category, index } = this.rnMaps.decode(rn);
        const key = DATABASE_KEY[category];
        if (key === undefined) return;
        const rec = (this.data.databases[key] as Database<DatabaseRecord>).records[index];
        if (!rec) return;
        if (!this.rnMaps.deleteIndexEntry(category, index)) return;
        rec.nextObject = OBJECT_ID_NULL;
    }

    /**
     * Find the first DOOR record RN in a cell, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `FindFirstDoor()` semantics (doc/CSBwin-src/Code11f52.cpp:579+).
     */
    findFirstDoor(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (this.rnMaps.dbType(rn) === DBType.DOOR) return rn;
        }
        return OBJECT_ID_EOF;
    }

    /**
     * `FindFirstMonster` (doc/CSBwin-src/Code11f52.cpp:533, :604) — the first creature in
     * the cell's object chain, or `OBJECT_ID_EOF`.
     */
    findFirstMonster(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (this.rnMaps.dbType(rn) === DBType.CREATURE) return rn;
        }
        return OBJECT_ID_EOF;
    }

    /**
     * `MonsterAllowedOnLevel` (doc/CSBwin-src/Code11f52.cpp:120) — is `monsterType` among
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
     * `LOCATIONREL::IsValid` (doc/CSBwin-src/DSA.cpp:310) — a level that exists and a
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
     * (doc/CSBwin-src/CSBCode.cpp:5780-5783). The low byte is the force needed to bash
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

    getTextRecord(rn: ObjectID): TextRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.TEXT) return null;
        return this.data.databases.texts.records[index] ?? null;
    }

    getDsaLevelIndex(level: number, selector: number): number | null {
        const table = this.data.dsaLevelIndex;
        if (!table) return null;
        const row = table[level];
        if (!row) return null;
        return row[selector] ?? null;
    }

    getActuatorRecord(rn: ObjectID): ActuatorRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.ACTUATOR) return null;
        return this.data.databases.actuators.records[index] ?? null;
    }

    getDoorRecordByIndex(index: number): DoorRecord | null {
        return this.data.databases.doors.records[index] ?? null;
    }

    getTeleporterRecord(rn: ObjectID): TeleporterRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.TELEPORTER) return null;
        return this.data.databases.teleporters.records[index] ?? null;
    }

    /**
     * Apply a door action at a specific map coordinate.
     */
    applyDoorActionAtPosition(level: number, x: number, y: number, action: number): boolean {
        const map = this.getMap(level);
        if (!map) return false;
        if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;
        const cellFlag = map.cellFlags[x][y];
        if (((cellFlag >> 5) & 0x7) !== RoomType.DOOR) return false;
        return this.applyDoorActionAt(map, x, y, cellFlag, action);
    }


    getWeaponRecord(rn: ObjectID): WeaponRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.WEAPON) return null;
        return this.data.databases.weapons.records[index] ?? null;
    }

    getClothingRecord(rn: ObjectID): ClothingRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.CLOTHING) return null;
        return this.data.databases.clothing.records[index] ?? null;
    }

    getScrollRecord(rn: ObjectID): ScrollRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.SCROLL) return null;
        return this.data.databases.scrolls.records[index] ?? null;
    }

    getPotionRecord(rn: ObjectID): PotionRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.POTION) return null;
        return this.data.databases.potions.records[index] ?? null;
    }

    getContainerRecord(rn: ObjectID): ContainerRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.CHEST) return null;
        return this.data.databases.containers.records[index] ?? null;
    }

    getMiscRecord(rn: ObjectID): MiscRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.MISC) return null;
        return this.data.databases.misc.records[index] ?? null;
    }

    getCreatureRecord(rn: ObjectID): CreatureRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.CREATURE) return null;
        return this.data.databases.creatures.records[index] ?? null;
    }

    getMissileRecord(rn: ObjectID): MissileRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.MISSILE) return null;
        return this.data.databases.missiles.records[index] ?? null;
    }

    getCloudRecord(rn: ObjectID): CloudRecord | null {
        const { category, index } = this.rnMaps.decode(rn);
        if (category !== DBType.CLOUD) return null;
        return this.data.databases.clouds.records[index] ?? null;
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
        const face = creature.facing & 0x3;
        const facings = (face | (face << 2) | (face << 4) | (face << 6)) & 0xff;
        return {
            positions: creature.groupIndex,
            facings,
            statuses: new Uint8Array(4)
        };
    }


    private applyDoorActionAt(map: MapData, x: number, y: number, cellFlag: CellFlag, action: number): boolean {
        const doorState = cellFlag & 0x7;
        if (doorState === 5) return false;

        let nextState = doorState;
        if (action === 0) {
            if (doorState === 0) return false;
            nextState = 0;
        } else if (action === 1) {
            if (doorState === 4) return false;
            nextState = 4;
        } else if (action === 2) {
            nextState = doorState === 0 ? 4 : 0;
        } else {
            return false;
        }

        if (nextState === doorState) return false;

        const newAttr = (cellFlag & 0x8) | (nextState & 0x7);
        const newCellFlag = (cellFlag & 0xf0) | newAttr;
        map.cellFlags[x][y] = newCellFlag;
        return true;
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
     * `DecodeText` (`doc/CSBwin-src/CSBCode.cpp:5487-5668`) with its substitution: `ok` is
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
     * `DecodeText` returns -1 (`doc/CSBwin-src/Code11f52.cpp:3960-3964`).
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
