/**
 * What an `RN` names: CSBWin's `dataTypeMap` and `dataIndexMap`, and the accessors of
 * `class RN` that read and write them (`doc/CSBwin-src/CSBTypes.h:268-370`).
 *
 * CSBWin's `RN` is a slot number. The slot's database and the corner of its cell are in
 * `dataTypeMap[slot]` (`(pos << 4) | dbNum`), its record index in `dataIndexMap[slot]`;
 * `dbType()`, `pos()` and `idx()` read them, and `pos(p)` writes the corner in place
 * and keeps the RN. Every RN the engine holds is read through one world's `RnMaps`
 * (`DungeonData.rnMaps`, reached as `DungeonState.rnMaps`), and only the file readers and
 * writers see an RN's packed form, `[pos:2][db:4][idx:10]` (`decodeObjectID`).
 *
 * This port's RN is still that packed form, so the maps are not yet kept and each
 * accessor reads the bits (`DEBT.md` D16).
 */
import { decodeObjectID, encodeObjectID, type DBType, type ObjectID, type TilePosition } from './types';

export class RnMaps {
    /** `RN::dbType` (`CSBTypes.h:324-330`). */
    dbType(rn: ObjectID): DBType {
        return decodeObjectID(rn).category;
    }

    /** `RN::pos()` (`CSBTypes.h:331-335`): the corner of its cell. */
    pos(rn: ObjectID): TilePosition {
        return decodeObjectID(rn).position;
    }

    /** `RN::idx` (`CSBTypes.h:343-347`): the record within its database. */
    idx(rn: ObjectID): number {
        return decodeObjectID(rn).index;
    }

    /** `dbType()`, `pos()` and `idx()` at once. */
    decode(rn: ObjectID): { position: TilePosition; category: DBType; index: number } {
        return decodeObjectID(rn);
    }

    /** `RN::pos(p)` (`CSBTypes.h:336-342`): the same object in corner `p`. */
    setPos(rn: ObjectID, p: number): ObjectID {
        return encodeObjectID((p & 3) as TilePosition, this.dbType(rn), this.idx(rn));
    }

    /** `RN(DBTYPE dbType, ui32 dbIndex)` (`doc/CSBwin-src/data.cpp:455-504`). */
    rn(db: DBType, dbIndex: number): ObjectID {
        return encodeObjectID(0, db, dbIndex);
    }
}
