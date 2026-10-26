/**
 * CSBWin's **object indirect index** as a file carries it: the two maps behind every RN.
 *
 * CSBWin's `class RN` holds a single `ui16 indirectIndex`, and every accessor goes
 * through two global arrays (`doc/CSBwin-src/CSBTypes.h:274-376`):
 *
 * ```c
 * DBTYPE dbType(void) const { return DBTYPE(dataTypeMap[indirectIndex] & 0xf); };
 * ui8    pos   (void) const { return (dataTypeMap[indirectIndex] >> 4) & 3; };
 * ui16   idx   (void) const { return dataIndexMap[indirectIndex]; };
 * ```
 *
 * The port's RN is the same slot, and the maps are the world's `RnMaps`
 * (`src/core/RnMaps.ts`). `dungeon.dat` stores RNs packed, `[position:2][category:4]
 * [index:10]`, and its reader numbers them into slots as CSBWin does
 * (`ConvertListOfObjects`, `src/data/CsbwinDungeonConversions.ts`). A save's RNs are
 * slots already, and its maps travel in its Extended Features block
 * (`ReadExtendedFeatures`, `doc/CSBwin-src/SaveGame.cpp:369-370`), so a save is read and
 * written with the slots it holds.
 *
 * **Byte order.** `dataTypeMap` is bytes. `dataIndexMap` is 16-bit and little-endian:
 * `SwapDataIndexMap` applies `BE16` (`:168-173`), which is a **no-op on a little-endian
 * host** (`doc/CSBwin-src/CSBTypes.h:161-166`) — CSBWin's `BE16` means "this value is
 * stored in PC order", exactly as in the Extended Features header and the indirect text
 * index. Measured: read little-endian the largest index in every committed save is 682,
 * read big-endian it is 0xff01.
 *
 * **Free slots** are `dataTypeMap[i] == 0xff`, `dataIndexMap[i] == 0xffff`, left behind
 * when an object is destroyed (`DeleteDBEntry`, `doc/CSBwin-src/data.cpp:995-1017`;
 * `AllocateIndirectIndex` reuses them, `SaveGame.cpp:2332-2352`). Slot 0 is never used:
 * "Don't use entry zero" (`:2180-2185`).
 *
 * Two slots may name the same `(db, idx)`: `convertScrolls` gives a scroll's text a slot
 * of its own (`AllocateIndirectIndex`, `:2371`) beside the one `ConvertListOfObjects`
 * gave the record if it lies in a chain.
 */
import { RnMaps } from '../core/RnMaps';
import { databaseRecords, type Databases } from './dungeonTypes';

export interface CsbwinObjectIndex {
    /** `dataMapLength` — slot 0 included, though it is never referenced. */
    readonly length: number;
    /** `dataTypeMap`: `(pos << 4) | dbNum`, or 0xff for a free slot. */
    readonly typeMap: Uint8Array;
    /** `dataIndexMap`: the record index within that database, or 0xffff when free. */
    readonly indexMap: Uint16Array;
}

/**
 * `FormChecksum` (`doc/CSBwin-src/SaveGame.cpp:202-212`), byte by byte:
 * `result = result * 0xbb40e62d + 11 + buf[i]`, unsigned 32-bit throughout.
 */
export function formChecksum(buf: Uint8Array): number {
    let result = 0;
    for (let i = 0; i < buf.length; i++) {
        result = (Math.imul(result, 0xbb40e62d) + 11 + buf[i]!) >>> 0;
    }
    return result >>> 0;
}

/**
 * Read the two maps that follow the 512-byte Extended Features block.
 *
 * `ReadExtendedFeatures` reads them as one `dataMapLength`-byte run and one
 * `2*dataMapLength`-byte run and dies if either checksum misses
 * (`doc/CSBwin-src/SaveGame.cpp:369-378`). Both checksums are verified here for the
 * same reason: they are the only proof that `dataMapLength` was read from the right
 * offset, and a map read one byte out would resolve every object to a plausible wrong
 * one rather than fail.
 */
export function readObjectIndirectIndex(
    data: Uint8Array,
    offset: number,
    dataMapLength: number,
    typeMapChecksum: number,
    indexMapChecksum: number,
): CsbwinObjectIndex {
    const typeEnd = offset + dataMapLength;
    const indexEnd = typeEnd + dataMapLength * 2;
    if (dataMapLength < 0 || indexEnd > data.length) {
        throw new Error(`object indirect index runs past the file (length ${dataMapLength})`);
    }

    const typeMap = data.slice(offset, typeEnd);
    const indexBytes = data.subarray(typeEnd, indexEnd);
    if (formChecksum(typeMap) !== (typeMapChecksum >>> 0)) {
        throw new Error('dataTypeMap checksum mismatch');
    }
    if (formChecksum(indexBytes) !== (indexMapChecksum >>> 0)) {
        throw new Error('dataIndexMap checksum mismatch');
    }

    const indexMap = new Uint16Array(dataMapLength);
    for (let i = 0; i < dataMapLength; i++) {
        indexMap[i] = (indexBytes[i * 2] ?? 0) | ((indexBytes[i * 2 + 1] ?? 0) << 8);
    }

    return { length: dataMapLength, typeMap, indexMap };
}

/**
 * The maps of a world, whose databases `databases` gives: empty, or a file's. Their
 * `RN(DBTYPE, dbIndex)` reads the world's records.
 */
export function rnMapsOf(databases: () => Databases, index?: CsbwinObjectIndex): RnMaps {
    return new RnMaps(
        (db, dbIndex) => databaseRecords(databases(), db)[dbIndex]?.nextObject,
        index?.typeMap,
        index?.indexMap,
    );
}

/** The maps `rnMaps` holds, as a file carries them. */
export function objectIndexOf(rnMaps: RnMaps): CsbwinObjectIndex {
    return { length: rnMaps.length, typeMap: rnMaps.typeMapBytes(), indexMap: rnMaps.indexMapWords() };
}
