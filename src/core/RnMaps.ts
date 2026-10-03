/**
 * What an `RN` names: CSBWin's `dataTypeMap` and `dataIndexMap`, and the accessors of
 * `class RN` that read and write them (`doc/CSBwin-src/CSBTypes.h:268-370`).
 *
 * CSBWin's `RN` is a slot number. The slot's database and the corner of its cell are in
 * `dataTypeMap[slot]` (`(pos << 4) | dbNum`), its record index in `dataIndexMap[slot]`;
 * `dbType()`, `pos()` and `idx()` read them, and `pos(p)` writes the corner in place
 * and keeps the RN. Slot 0 is never used, and a free slot is `0xff`/`0xffff`. Every RN
 * the engine holds is such a slot, read through one world's `RnMaps`
 * (`DungeonData.rnMaps`, reached as `DungeonState.rnMaps`). Only `dungeon.dat` stores
 * an RN packed, `[pos:2][db:4][idx:10]`, and its reader numbers them into slots as
 * CSBWin does (`ConvertListOfObjects`, `src/data/CsbwinDungeonConversions.ts`); a save
 * carries its maps, and its slots are kept as they are.
 *
 * An `RNVAL` (0xff00 and up: the spells, `RNeof`, `RNnul`) is a literal, not a slot: the
 * maps stop growing short of 0xff00 slots, so `checkIndirectIndex` refuses one, as it
 * refuses 0 (`doc/PROVEN_FACTS.md` -> "An `RNVAL` read as a slot is `dbUNKNOWN`").
 * For such an RN `dbType()` is `dbUNKNOWN`, as in CSBWin. `pos()` and `idx()` throw,
 * where CSBWin's read outside the maps once its message box is dismissed, and its debug
 * build dies (`doc/CSBwin-src/data.cpp:518-527`): a caller asks only for a slot.
 */
import { DBType, OBJECT_ID_NULL, type ObjectID, type TilePosition } from './types';

/**
 * A record's link, which `RN(DBTYPE, dbIndex)` reads to tell a free record (`RNnul`) from
 * a live one: `undefined` for a record its database does not hold.
 */
export type RecordLink = (db: DBType, dbIndex: number) => number | undefined;

export class RnMaps {
    private typeMap: Uint8Array;
    private indexMap: Uint16Array;
    /** `dataMapLength`, slot 0 included. */
    private dataMapLength: number;

    /**
     * Empty maps, or a file's (`typeMap` and `indexMap` of one length, slot 0 included).
     * `link` reads the world's records, for `RN(DBTYPE, dbIndex)`.
     */
    constructor(private readonly link: RecordLink, typeMap?: ArrayLike<number>, indexMap?: ArrayLike<number>) {
        this.dataMapLength = typeMap?.length ?? 0;
        this.typeMap = new Uint8Array(Math.max(this.dataMapLength, 32));
        this.indexMap = new Uint16Array(this.typeMap.length);
        if (typeMap && indexMap) this.restore(typeMap, indexMap);
    }

    /** `dataMapLength`. */
    get length(): number {
        return this.dataMapLength;
    }

    /** `dataTypeMap`, a copy of its `dataMapLength` bytes. */
    typeMapBytes(): Uint8Array {
        return this.typeMap.slice(0, this.dataMapLength);
    }

    /** `dataIndexMap`, a copy of its `dataMapLength` words. */
    indexMapWords(): Uint16Array {
        return this.indexMap.slice(0, this.dataMapLength);
    }

    /** The two maps, `dataMapLength` long, for a `JSON.stringify` of the world. */
    toJSON(): { typeMap: number[]; indexMap: number[] } {
        return { typeMap: Array.from(this.typeMapBytes()), indexMap: Array.from(this.indexMapWords()) };
    }

    /** Put back two maps `typeMapBytes` and `indexMapWords` gave. */
    restore(typeMap: ArrayLike<number>, indexMap: ArrayLike<number>): void {
        if (typeMap.length !== indexMap.length) throw new Error('dataTypeMap and dataIndexMap differ in length');
        this.dataMapLength = 0;
        this.reserve(typeMap.length);
        this.typeMap.set(typeMap);
        this.indexMap.set(indexMap);
        this.dataMapLength = typeMap.length;
    }

    /** `RN::checkIndirectIndex(i)` (`doc/CSBwin-src/data.cpp:529-534`). */
    checkIndirectIndex(i: number): boolean {
        return i < this.dataMapLength && i > 0;
    }

    /** `RN::dbType` (`CSBTypes.h:324-330`): `dbUNKNOWN` for a free slot or no slot at all. */
    dbType(rn: ObjectID): DBType {
        if (!this.checkIndirectIndex(rn)) return DBType.UNKNOWN;
        if (this.indexMap[rn] === 0xffff) return DBType.UNKNOWN;
        return (this.typeMap[rn] & 0x0f) as DBType;
    }

    /** `RN::pos()` (`CSBTypes.h:331-335`): the corner of its cell. */
    pos(rn: ObjectID): TilePosition {
        this.check(rn);
        return ((this.typeMap[rn] >> 4) & 3) as TilePosition;
    }

    /** `RN::idx` (`CSBTypes.h:343-347`): the record within its database. */
    idx(rn: ObjectID): number {
        this.check(rn);
        return this.indexMap[rn];
    }

    /** `dbType()`, `pos()` and `idx()` at once. */
    decode(rn: ObjectID): { position: TilePosition; category: DBType; index: number } {
        return { position: this.pos(rn), category: this.dbType(rn), index: this.idx(rn) };
    }

    /**
     * `RN::pos(p)` (`CSBTypes.h:336-342`): moves the object to corner `p`, in the map, and
     * gives back the same RN. Every copy of the RN sees the new corner.
     */
    setPos(rn: ObjectID, p: number): ObjectID {
        this.check(rn);
        this.typeMap[rn] = (this.typeMap[rn] & 0xcf) | ((p & 3) << 4);
        return rn;
    }

    /**
     * `RN(DBTYPE dbType, ui32 dbIndex)` (`doc/CSBwin-src/data.cpp:455-504`): the slot that
     * names the record, if one does; else the lowest free slot, or one whose record of
     * the same database is free; else a new one.
     */
    rn(db: DBType, dbIndex: number): ObjectID {
        let emptyIndexEntry = -1;
        for (let i = this.dataMapLength - 1; i > 0; i--) {
            if (this.indexMap[i] === 0xffff) {
                emptyIndexEntry = i;
                continue;
            }
            if ((this.typeMap[i] & 15) !== db) continue;
            if (this.indexMap[i] === dbIndex) return i as ObjectID; // Already exists
            if (this.link(db, this.indexMap[i]) === 0xffff) {
                emptyIndexEntry = i;
                continue;
            }
        }
        if (emptyIndexEntry === -1) {
            if (this.dataMapLength > 64000) throw new Error('Object Indirect Index Overflow');
            emptyIndexEntry = this.append();
        }
        this.indexMap[emptyIndexEntry] = dbIndex;
        this.typeMap[emptyIndexEntry] = db;
        return emptyIndexEntry as ObjectID;
    }

    /**
     * `AllocateIndirectIndex` (`doc/CSBwin-src/SaveGame.cpp:2120-2140`): the lowest free
     * slot, or the first one whose record of the same database is free, or a new one; -1
     * when the maps are full.
     */
    AllocateIndirectIndex(db: DBType, dbIndex: number): number {
        let emptyIndexEntry = -1;
        for (let i = 1; i < this.dataMapLength; i++) {
            if (this.indexMap[i] === 0xffff) {
                if (emptyIndexEntry < 0) emptyIndexEntry = i;
                continue;
            }
            if ((this.typeMap[i] & 15) !== db) continue;
            if (this.link(db, this.indexMap[i]) === 0xffff) {
                emptyIndexEntry = i;
                break;
            }
        }
        if (emptyIndexEntry === -1) {
            if (this.dataMapLength > 0xff00 - 100) return -1;
            emptyIndexEntry = this.append();
        }
        this.indexMap[emptyIndexEntry] = dbIndex;
        this.typeMap[emptyIndexEntry] = db;
        return emptyIndexEntry;
    }

    /**
     * `FindEmptyDBEntry`'s walk of the index (`doc/CSBwin-src/data.cpp:933-953`): the
     * first slot of database `db` whose record is free, and that record, which may be
     * record 0; else the lowest free slot, or -1, and -1 for the record.
     */
    findEmptyIndexEntry(db: DBType): { emptyIndexEntry: number; emptyDBEntry: number } {
        let emptyIndexEntry = -1;
        for (let i = 1; i < this.dataMapLength; i++) {
            if (this.indexMap[i] === 0xffff) {
                if (emptyIndexEntry < 0) emptyIndexEntry = i;
                continue;
            }
            if ((this.typeMap[i] & 15) !== db) continue;
            if (this.link(db, this.indexMap[i]) === 0xffff) {
                return { emptyIndexEntry: i, emptyDBEntry: this.indexMap[i] };
            }
        }
        return { emptyIndexEntry, emptyDBEntry: -1 };
    }

    /**
     * The end of `FindEmptyDBEntry` (`doc/CSBwin-src/data.cpp:973-988`): slot
     * `emptyIndexEntry`, or a new one when it is -1, names record `dbIndex` of `db` at
     * corner 0. `RNnul` when a new slot is wanted and the index is all but full, unless
     * the object is `important`.
     */
    assignIndexEntry(emptyIndexEntry: number, db: DBType, dbIndex: number, important: boolean): ObjectID {
        if (emptyIndexEntry === -1) {
            if (this.dataMapLength > 0xff00 - 100 && !important) return OBJECT_ID_NULL;
            emptyIndexEntry = this.append();
        }
        this.indexMap[emptyIndexEntry] = dbIndex;
        this.typeMap[emptyIndexEntry] = db;
        return emptyIndexEntry as ObjectID;
    }

    /**
     * `DeleteDBEntry`'s walk of the index (`doc/CSBwin-src/data.cpp:993-1015`): frees the
     * slot naming record `dbIndex` of `db`, if one does, and says whether the record is
     * to be freed. It is not, and no slot is freed, when two slots name it or its slot
     * carries bit 0x80, "Cloned!!!". The walk starts at slot 0, which names door 0.
     */
    deleteIndexEntry(db: DBType, dbIndex: number): boolean {
        let j = -1;
        for (let i = 0; i < this.dataMapLength; i++) {
            if ((this.typeMap[i] & 0xf) !== db) continue;
            if (this.indexMap[i] !== dbIndex) continue;
            if (j !== -1) return false; // Cloned!!!
            j = i;
            if ((this.typeMap[i] & 0x80) !== 0) return false; // Cloned!!!
        }
        if (j !== -1) {
            this.typeMap[j] = 0xff;
            this.indexMap[j] = 0xffff;
        }
        return true;
    }

    /**
     * `ConvertListOfObjects`' slot for one packed RN (`doc/CSBwin-src/SaveGame.cpp:1947-1981`):
     * the first slot already naming the record when `duplicateOK`, else a new one carrying
     * the packed RN's corner. Slot 0 is left unused. Returns the slot and whether it was
     * already there.
     */
    convertPacked(packed: number, duplicateOK: boolean): { slot: ObjectID; duplicate: boolean } {
        const dbNum = (packed >> 10) & 15;
        const pos = (packed >> 14) & 3;
        const idx = packed & 0x3ff;
        for (let i = 1; i < this.dataMapLength; i++) {
            if ((this.typeMap[i] & 15) !== dbNum) continue;
            if (this.indexMap[i] !== idx) continue;
            if (!duplicateOK) throw new Error('Duplicated Object');
            return { slot: i as ObjectID, duplicate: true };
        }
        const slot = this.append();
        this.typeMap[slot] = (pos << 4) | dbNum;
        this.indexMap[slot] = idx;
        return { slot: slot as ObjectID, duplicate: false };
    }

    private check(rn: number): void {
        if (!this.checkIndirectIndex(rn)) throw new Error(`Illegal object Indirect Index ${rn}`);
    }

    /** One more slot at the end, free, and its number. Never slot 0. */
    private append(): number {
        this.reserve(this.dataMapLength + 2);
        if (this.dataMapLength === 0) {
            // "Don't use entry zero." (`doc/CSBwin-src/SaveGame.cpp:1968-1973`)
            this.typeMap[0] = 0;
            this.indexMap[0] = 0;
            this.dataMapLength = 1;
        }
        const slot = this.dataMapLength++;
        this.typeMap[slot] = 0xff;
        this.indexMap[slot] = 0xffff;
        return slot;
    }

    private reserve(length: number): void {
        if (length <= this.typeMap.length) return;
        const capacity = Math.max(length, this.typeMap.length * 2);
        const typeMap = new Uint8Array(capacity);
        const indexMap = new Uint16Array(capacity);
        typeMap.set(this.typeMap.subarray(0, this.dataMapLength));
        indexMap.set(this.indexMap.subarray(0, this.dataMapLength));
        this.typeMap = typeMap;
        this.indexMap = indexMap;
    }
}
