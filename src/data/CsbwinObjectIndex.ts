/**
 * CSBWin's **object indirect index**, and the translation back to a packed RN.
 *
 * This is the piece that made every object reference inside a genuine save file
 * unreadable, and it is not a detail of the file format — it is how `RN` works in
 * CSBWin at all. `dungeon.dat` stores an object reference as the Atari ST bitfield this
 * port uses everywhere, `[position:2][category:4][index:10]`. CSBWin does **not** keep
 * them that way. `class RN` holds a single `ui16 indirectIndex` and nothing else
 * (`doc/CSBwin-src/CSBTypes.h:268-370`); every accessor goes through two global arrays:
 *
 * ```c
 * DBTYPE dbType(void) const { return DBTYPE(dataTypeMap[indirectIndex] & 0xf); };
 * ui8    pos   (void) const { return (dataTypeMap[indirectIndex] >> 4) & 3; };
 * ui16   idx   (void) const { return dataIndexMap[indirectIndex]; };
 * ```
 *
 * The conversion happens once, when an original dungeon is read:
 * `ConvertListOfObjects` walks every chain, splits each packed RN into `(pos, db, idx)`,
 * appends the pair to the two maps and overwrites the RN with the map slot number
 * (`doc/CSBwin-src/SaveGame.cpp:1916-2018`). `ConvertCharacters` (`:2046`) and
 * `ConvertTimers` (`:2021`) do the same for the possessions and the object-carrying
 * timers. From then on *every* RN in memory — and therefore every RN written into a
 * save — is a slot number, and the maps travel in the save's Extended Features block so
 * that the numbering survives (`ReadExtendedFeatures`, `:367-368`).
 *
 * That is why a save's possession slots "came out as category 0/1 with indices far past
 * those databases" and topped out near 2000: they were never packed RNs. They are slot
 * numbers into a map with about 2000 entries.
 *
 * This port keeps the packed form, so a save is read by translating each slot number
 * back — `(pos << 14) | (db << 10) | idx` — at the moment it is parsed. Going the other
 * way, a *writer* will have to build the maps; the translation is not information-losing
 * in the direction that matters, but it is not free either (see "Two ways this can
 * legitimately fail" below).
 *
 * **Byte order.** `dataTypeMap` is bytes. `dataIndexMap` is 16-bit and little-endian:
 * `SwapDataIndexMap` applies `BE16` (`:167-172`), which is a **no-op on a little-endian
 * host** (`doc/CSBwin-src/CSBTypes.h:156-161`) — CSBWin's `BE16` means "this value is
 * stored in PC order", exactly as in the Extended Features header and the indirect text
 * index. Measured: read little-endian the largest index in every committed save is 682,
 * read big-endian it is 0xff01.
 *
 * **Free slots** are `dataTypeMap[i] == 0xff`, `dataIndexMap[i] == 0xffff`, left behind
 * when an object is destroyed (`AllocateIndirectIndex` reuses them, `:2100-2140`). Slot
 * 0 is never used: "Don't use entry zero" (`:1968-1973`). A reference to either is a
 * corrupt file, not an empty slot — the empty markers are the `RNVAL`s below.
 *
 * **Two ways this can legitimately fail**, both checked rather than assumed:
 *
 * - `dataIndexMap` is 16 bits wide and a packed RN's index field is 10. CSBWin allows a
 *   database of up to 64000 records; this port cannot express one past 1023. No shipped
 *   DM dungeon comes close (the largest index in any committed save is 682), but a
 *   third-party dungeon could, and it must say so rather than silently alias.
 * - Two slots may name the same `(db, idx)`. `ConvertListOfObjects` permits it for a
 *   missile's flying object (`DuplicateOK`, `:1918`) and forbids it everywhere else, so
 *   it is rare — but where it happens, two RNs that CSBWin tells apart become one RN
 *   here. `countAliases` reports it; nothing in the shipped dungeon triggers it.
 */
import { encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL } from '../core/types';
import type { DBType, TilePosition, ui16 } from '../core/types';

/**
 * The lowest `RNVAL`. Everything from here up is a literal, not a slot number:
 * `RNFireball` (0xff80) and the other spell RNs, `RNMonsterDeath`, `RNeof` (0xfffe) and
 * `RNnul` (0xffff) — `doc/CSBwin-src/CSBTypes.h:236-250`. `RN::CreateSpell` writes
 * `0xff80 + n` straight into `indirectIndex` (`doc/CSBwin-src/data.cpp:533-537`) and
 * `checkIndirectIndex` is never consulted for them, so they pass through untouched.
 */
const RN_LITERAL_FLOOR = 0xff00;

/** `RNempty` (`doc/CSBwin-src/CSBTypes.h:249`). Not a slot; means "no object". */
const RN_EMPTY = 0x0000;

export interface CsbwinObjectIndex {
    /** `dataMapLength` — slot 0 included, though it is never referenced. */
    readonly length: number;
    /** `dataTypeMap`: `(pos << 4) | dbNum`, or 0xff for a free slot. */
    readonly typeMap: Uint8Array;
    /** `dataIndexMap`: the record index within that database, or 0xffff when free. */
    readonly indexMap: Uint16Array;
    /**
     * One slot number as this port's packed RN. `RNVAL`s and `RNempty` pass through.
     * Throws on a reference to slot 0, to a slot past the end of the map, to a free
     * slot, or to a record index this port's 10-bit field cannot hold.
     */
    resolve(raw: number): ui16;
    /** How many slots share a `(db, idx)` pair with an earlier slot. Normally 0. */
    countAliases(): number;
}

/**
 * `FormChecksum` (`doc/CSBwin-src/SaveGame.cpp:201-211`), byte by byte:
 * `result = result * 0xbb40e62d + 11 + buf[i]`, unsigned 32-bit throughout.
 */
export function formChecksum(buf: Uint8Array): number {
    let result = 0;
    for (let i = 0; i < buf.length; i++) {
        result = (Math.imul(result, 0xbb40e62d) + 11 + buf[i]) >>> 0;
    }
    return result >>> 0;
}

/**
 * Read the two maps that follow the 512-byte Extended Features block.
 *
 * `ReadExtendedFeatures` reads them as one `dataMapLength`-byte run and one
 * `2*dataMapLength`-byte run and dies if either checksum misses
 * (`doc/CSBwin-src/SaveGame.cpp:367-376`). Both checksums are verified here for the
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

    return {
        length: dataMapLength,
        typeMap,
        indexMap,
        resolve(raw: number): ui16 {
            const value = raw & 0xffff;
            if (value === RN_EMPTY) return RN_EMPTY;
            if (value >= RN_LITERAL_FLOOR) return value;
            if (value >= dataMapLength) {
                throw new Error(`object reference ${value} past the indirect index (${dataMapLength})`);
            }
            const index = indexMap[value];
            if (index === 0xffff) {
                throw new Error(`object reference ${value} names a freed indirect slot`);
            }
            if (index > 0x3ff) {
                throw new Error(
                    `record index ${index} does not fit this port's 10-bit RN (slot ${value})`,
                );
            }
            const type = typeMap[value] ?? 0;
            return encodeObjectID(((type >> 4) & 3) as TilePosition, (type & 0xf) as DBType, index);
        },
        countAliases(): number {
            const seen = new Set<number>();
            let aliases = 0;
            for (let i = 1; i < dataMapLength; i++) {
                if (indexMap[i] === 0xffff) continue;
                const key = ((typeMap[i] & 0xf) << 16) | indexMap[i];
                if (seen.has(key)) aliases++;
                else seen.add(key);
            }
            return aliases;
        },
    };
}

/** The two values a chain or a possession slot uses for "nothing here". */
export function isEmptyObjectReference(rn: number): boolean {
    return rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF;
}
