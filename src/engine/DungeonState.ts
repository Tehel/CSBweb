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
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType, rnEquals } from '../core/types';
import type { TextRecord } from '../data/dungeonTypes';
import type { TextDecodeTables } from '../data/tables/ObjectTables';
import { textStart } from '../data/CsbwinDungeonConversions';
import type { DungeonSnapshot } from './DungeonSnapshot';
import { applyDungeonSnapshot, captureDungeonSnapshot } from './DungeonSnapshot';

/**
 * DungeonState - manages dungeon data and queries
 */
/** The database each `Databases` key holds. */
const DATABASE_CATEGORY: Record<keyof Databases, DBType> = {
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

export class DungeonState {
    private data: DungeonData;

    /**
     * `MakeMoreRoomInDB`, which `Game` supplies because it needs the systems
     * (`engine/MakeMoreRoomInDB`). Without it a full database refuses the record.
     */
    makeMoreRoomInDB: ((db: DBType) => ObjectID) | null = null;
    private championBonesRecords = new Map<number, number>();
    private timerWord8Lookup?: (index: number) => ui16 | null;

    constructor(data: DungeonData) {
        this.data = data;
    }

    /**
     * Take `data` as the world, as `_ReadEntireGame` reads a whole one, structure included
     * (`Game.installWorld`). The bones records were the old world's.
     */
    install(data: DungeonData): void {
        this.data = data;
        this.championBonesRecords.clear();
    }

    /**
     * Get dungeon data
     */
    getData(): Readonly<DungeonData> {
        return this.data;
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

    addChampionBonesRecord(bones: ObjectID, fingerprint: number): void {
        const key = this.getBonesRecordKey(bones);
        if (key === null) return;
        this.championBonesRecords.set(key, fingerprint & 0xffff);
    }

    checkChampionBonesRecord(bones: ObjectID): boolean {
        const key = this.getBonesRecordKey(bones);
        if (key === null) return false;
        return this.championBonesRecords.has(key);
    }

    copyChampionBonesRecord(bones: ObjectID): number | null {
        const key = this.getBonesRecordKey(bones);
        if (key === null) return null;
        const value = this.championBonesRecords.get(key);
        return value === undefined ? null : value;
    }

    getChampionBonesRecord(bones: ObjectID): number | null {
        const key = this.getBonesRecordKey(bones);
        if (key === null) return null;
        const value = this.championBonesRecords.get(key);
        if (value === undefined) return null;
        this.championBonesRecords.delete(key);
        return value;
    }

    clearChampionBonesRecord(bones: ObjectID): void {
        const key = this.getBonesRecordKey(bones);
        if (key === null) return;
        this.championBonesRecords.delete(key);
    }

    private getBonesRecordKey(bones: ObjectID): number | null {
        if (bones === OBJECT_ID_EOF || bones === OBJECT_ID_NULL) return null;
        return bones & 0x3fff;
    }

    /**
     * Snapshot everything play can change, for the quick-save.
     * See `src/engine/DungeonSnapshot.ts` for what counts as mutable and why.
     */
    captureSnapshot(): DungeonSnapshot {
        const snapshot = captureDungeonSnapshot(this.data);
        snapshot.championBones = [...this.championBonesRecords.entries()];
        return snapshot;
    }

    applySnapshot(snapshot: DungeonSnapshot): void {
        applyDungeonSnapshot(this.data, snapshot);
        this.championBonesRecords.clear();
        for (const [key, fingerprint] of snapshot.championBones ?? []) {
            this.championBonesRecords.set(key, fingerprint & 0xffff);
        }
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
        const { category, index } = decodeObjectID(rn);

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
        const { category, index } = decodeObjectID(rn);

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
     * `DATABASES::FindEmptyDBEntry` (`doc/CSBwin-src/data.cpp:919-993`): store `record`
     * in the record a new object of database `db` goes into, and return that index.
     *
     * CSBWin takes the lowest record from index 1 whose link is `RNnul` (`:954-966`) —
     * record 0 is never reused — and only when there is none `Enlarge`s the database by
     * 100 cleared records and takes the first, the old length (`:967-972`,
     * `data.cpp:813-876`). Appending gives that index, and the next append is CSBWin's
     * next free record. The loop over the indirect index before it (`:934-953`) can only
     * find a slot still naming a record whose link is `RNnul`, and `DeleteDBEntry` frees
     * the slot with the record (`:1011-1015`); this port has no live indirect index, and
     * only `deleteDBEntry` writes `RNnul` into a link.
     *
     * Appending keeps `count` and the header's `objectCounts` — the size the image
     * writer declares — equal to the number of records. At 1024 records, the ten-bit
     * index and the port's `db.Max` (`DEBT.md` H, "Databases stop at 1024 records"), it
     * falls back on `MakeMoreRoomInDB` (`makeMoreRoomInDB`), as `FindEmptyDB<n>Entry` does
     * (`CSBCode.cpp:4942-5084`), and stores `record` over the one that frees. `null` when
     * that frees none.
     */
    findEmptyDBEntry<K extends keyof Databases>(db: K, record: Databases[K]['records'][number]): number | null {
        const database = this.data.databases[db] as Database<DatabaseRecord>;
        for (let i = 1; i < database.records.length; i++) {
            if (database.records[i].nextObject !== OBJECT_ID_NULL) continue;
            database.records[i] = record;
            return i;
        }
        if (database.records.length >= 1024) {
            const freed = this.makeMoreRoomInDB?.(DATABASE_CATEGORY[db]) ?? OBJECT_ID_NULL;
            if (freed === OBJECT_ID_NULL) return null;
            const index = decodeObjectID(freed).index;
            database.records[index] = record;
            return index;
        }
        database.records.push(record);
        database.count = database.records.length;
        const category = DATABASE_CATEGORY[db];
        this.data.header.objectCounts[category] = database.records.length & 0xffff;
        return database.records.length - 1;
    }

    /**
     * Delete a database record by marking its link as RNnul (CSBWin DeleteDBEntry).
     *
     * Ported from CSBWin `DeleteDBEntry()` (doc/CSBwin-src/data.cpp:995-1017).
     */
    deleteDBEntry(rn: ObjectID): boolean {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return false;
        const { category, index } = decodeObjectID(rn);

        switch (category) {
            case DBType.DOOR: {
                const rec = this.data.databases.doors.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.TELEPORTER: {
                const rec = this.data.databases.teleporters.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.TEXT: {
                const rec = this.data.databases.texts.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.ACTUATOR: {
                const rec = this.data.databases.actuators.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.CREATURE: {
                const rec = this.data.databases.creatures.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.WEAPON: {
                const rec = this.data.databases.weapons.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.CLOTHING: {
                const rec = this.data.databases.clothing.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.SCROLL: {
                const rec = this.data.databases.scrolls.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.POTION: {
                const rec = this.data.databases.potions.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.CHEST: {
                const rec = this.data.databases.containers.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.MISC: {
                const rec = this.data.databases.misc.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.MISSILE: {
                const rec = this.data.databases.missiles.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            case DBType.CLOUD: {
                const rec = this.data.databases.clouds.records[index];
                if (!rec) return false;
                rec.nextObject = OBJECT_ID_NULL;
                return true;
            }
            default:
                return false;
        }
    }

    /**
     * Find the first DOOR record RN in a cell, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `FindFirstDoor()` semantics (doc/CSBwin-src/Code11f52.cpp:579+).
     */
    findFirstDoor(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (decodeObjectID(rn).category === DBType.DOOR) return rn;
        }
        return OBJECT_ID_EOF;
    }

    /**
     * `FindFirstMonster` (doc/CSBwin-src/Code11f52.cpp:533, :604) — the first creature in
     * the cell's object chain, or `OBJECT_ID_EOF`.
     */
    findFirstMonster(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (decodeObjectID(rn).category === DBType.CREATURE) return rn;
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
        const { category, index } = decodeObjectID(rn);
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
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.ACTUATOR) return null;
        return this.data.databases.actuators.records[index] ?? null;
    }

    getDoorRecordByIndex(index: number): DoorRecord | null {
        return this.data.databases.doors.records[index] ?? null;
    }

    getTeleporterRecord(rn: ObjectID): TeleporterRecord | null {
        const { category, index } = decodeObjectID(rn);
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
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.WEAPON) return null;
        return this.data.databases.weapons.records[index] ?? null;
    }

    getClothingRecord(rn: ObjectID): ClothingRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CLOTHING) return null;
        return this.data.databases.clothing.records[index] ?? null;
    }

    getScrollRecord(rn: ObjectID): ScrollRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.SCROLL) return null;
        return this.data.databases.scrolls.records[index] ?? null;
    }

    getPotionRecord(rn: ObjectID): PotionRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.POTION) return null;
        return this.data.databases.potions.records[index] ?? null;
    }

    getContainerRecord(rn: ObjectID): ContainerRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CHEST) return null;
        return this.data.databases.containers.records[index] ?? null;
    }

    getMiscRecord(rn: ObjectID): MiscRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.MISC) return null;
        return this.data.databases.misc.records[index] ?? null;
    }

    getCreatureRecord(rn: ObjectID): CreatureRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CREATURE) return null;
        return this.data.databases.creatures.records[index] ?? null;
    }

    getMissileRecord(rn: ObjectID): MissileRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.MISSILE) return null;
        return this.data.databases.missiles.records[index] ?? null;
    }

    getCloudRecord(rn: ObjectID): CloudRecord | null {
        const { category, index } = decodeObjectID(rn);
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
        const force = (typeOfText & 0x8000) !== 0;
        if (!record.visible && !force) return null;

        // `DB2::index()` means different things either side of `ConvertToIndirectText`,
        // and `textStart` is the one place that knows which.
        const start = textStart(this.data, record.textOffset);
        if (!start) return null;
        return this.decodeTextFromWords(start.words, start.at, typeOfText, max, tables);
    }

    decodeTextString(record: TextRecord, typeOfText: number, tables: TextDecodeTables, max = 990): string | null {
        const bytes = this.decodeTextBytes(record, typeOfText, max, tables);
        if (!bytes) return null;
        return typeOfText === 0
            ? this.wallTextBytesToString(bytes)
            : this.textBytesToString(bytes);
    }

    decodeMessageText(record: TextRecord, tables: TextDecodeTables): string | null {
        return this.decodeTextString(record, 1, tables);
    }

    decodeScrollText(scroll: ScrollRecord, tables: TextDecodeTables): string | null {
        const rec = this.getTextRecordByIndex(scroll.textReference);
        if (!rec) return null;
        return this.decodeTextString(rec, 0x8002, tables);
    }

    private decodeTextFromWords(
        words: readonly ui16[],
        startWord: number,
        typeOfText: number,
        max: number,
        tables: TextDecodeTables
    ): Uint8Array | null {
        if (startWord < 0 || startWord >= words.length) return null;

        const out: number[] = [];
        let wordIndex = startWord;
        let word = 0;
        let bitPos = 0;
        let slashCount = 0;
        let escapeCode = 0;

        let separator = 0;
        if ((typeOfText & 0x7fff) === 1) {
            out.push(10);
            separator = 32;
        } else if (typeOfText === 0) {
            separator = 0x80;
        } else {
            separator = 10;
        }

        while (out.length < max - 2) {
            if (bitPos === 0) {
                word = words[wordIndex++] ?? 0;
            }

            let code: number;
            if (bitPos === 0) code = (word >> 10) & 0x1f;
            else if (bitPos === 1) code = (word >> 5) & 0x1f;
            else code = word & 0x1f;
            bitPos = (bitPos + 1) % 3;

            if (code === 28) slashCount++;
            else slashCount = 0;

            if (escapeCode !== 0) {
                if (escapeCode === 30) {
                    const table = typeOfText === 0 ? tables.byte10336 : tables.byte10016;
                    this.appendEscapeString(out, table, 8, code, max);
                } else {
                    this.appendEscapeString(out, tables.byte10080, 2, code, max);
                }
                escapeCode = 0;
                continue;
            }

            if (code < 28) {
                let outCode = code;
                if (typeOfText !== 0) {
                    if (code === 26) outCode = 32;
                    else if (code === 27) outCode = 46;
                    else outCode = code + 65;
                }
                out.push(outCode);
                continue;
            }

            if (code === 28) {
                if (separator === 32 && slashCount === 2 && out.length > 0) {
                    out[out.length - 1] = 10;
                } else {
                    out.push(separator);
                }
                continue;
            }

            if (code <= 30) {
                escapeCode = code;
                continue;
            }

            break; // 31 end of text
        }

        out.push(typeOfText === 0 ? 0x81 : 0);
        return Uint8Array.from(out);
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

    private appendEscapeString(out: number[], table: Uint8Array, entrySize: number, index: number, max: number): void {
        const base = index * entrySize;
        for (let i = 0; i < entrySize && base + i < table.length; i++) {
            const value = table[base + i] ?? 0;
            if (value === 0) break;
            if (out.length >= max - 2) return;
            out.push(value);
        }
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
