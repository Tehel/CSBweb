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
import { DBType as DBTypeEnum, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL } from '../core/types';
import type { DBType, TilePosition, ui16 } from '../core/types';
import type { Databases, DungeonData } from './dungeonTypes';

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

    return makeObjectIndirectIndex(typeMap, indexMap);
}

/**
 * The read half of an index, over two maps that are already in hand — whether they were
 * read from a file or built by `buildObjectIndirectIndex`.
 */
function makeObjectIndirectIndex(
    typeMap: Uint8Array,
    indexMap: Uint16Array,
): CsbwinObjectIndex {
    const dataMapLength = typeMap.length;
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

/**
 * The map slot of one record, and a slot's contents. `buildObjectIndirectIndex`'s output.
 */
export interface CsbwinObjectIndexWriter extends CsbwinObjectIndex {
    /**
     * One packed RN as the slot number a file wants. `RNVAL`s (0xff00 and up — the spell
     * literals, `RNeof`, `RNnul`) and `RNempty` pass through untouched, exactly as
     * `CsbwinObjectIndex.resolve` passes them the other way.
     *
     * Throws for a reference to a record no database holds, which is a corrupt world
     * rather than an encodable one.
     */
    encode(rn: ui16): ui16;
}

/** Which databases this port carries records for, in `DBType` order. */
const WRITABLE_DATABASES: ReadonlyArray<{ db: DBType; key: keyof Databases }> = [
    { db: DBTypeEnum.DOOR, key: 'doors' },
    { db: DBTypeEnum.TELEPORTER, key: 'teleporters' },
    { db: DBTypeEnum.TEXT, key: 'texts' },
    { db: DBTypeEnum.ACTUATOR, key: 'actuators' },
    { db: DBTypeEnum.CREATURE, key: 'creatures' },
    { db: DBTypeEnum.WEAPON, key: 'weapons' },
    { db: DBTypeEnum.CLOTHING, key: 'clothing' },
    { db: DBTypeEnum.SCROLL, key: 'scrolls' },
    { db: DBTypeEnum.POTION, key: 'potions' },
    { db: DBTypeEnum.CHEST, key: 'containers' },
    { db: DBTypeEnum.MISC, key: 'misc' },
    { db: DBTypeEnum.MISSILE, key: 'missiles' },
    { db: DBTypeEnum.CLOUD, key: 'clouds' },
];

/**
 * Build the two maps a save's Extended Features block carries, for a world this port
 * holds in memory.
 *
 * CSBWin builds them once, when an *original* dungeon is read: `ConvertListOfObjects`
 * walks every chain, appends `(pos, db, idx)` to the maps and overwrites each packed RN
 * with the slot number (`doc/CSBwin-src/SaveGame.cpp:1916-2018`). After that the maps are
 * the authority and `AllocateIndirectIndex` extends them one slot at a time
 * (`:2100-2140`). This port keeps packed RNs instead and so has to produce the maps at
 * write time; the numbering it chooses is its own, which is allowed — nothing outside
 * the file refers to a slot number, so a save only has to agree with itself.
 *
 * The scheme, and why:
 *
 * - **Slot 0 is left free.** `ConvertListOfObjects` starts at 1 with the comment "Don't
 *   use entry zero" (`:1968-1973`), because `RNempty` is 0 and would otherwise name a
 *   real object.
 * - **Every record of every database gets a slot**, live or free, in `DBType` then index
 *   order. CSBWin allocates only for objects it can reach and leaves 0xff/0xffff holes
 *   where one has since been destroyed; both shapes read identically, and giving each
 *   record a slot makes `encode` a pure function of `(db, idx)` — which is what lets a
 *   reference be written without first walking every chain to discover it.
 * - **The position rides in `dataTypeMap`, not in the slot number.** `RN::pos(p)` writes
 *   `dataTypeMap[indirectIndex]` in place (`doc/CSBwin-src/CSBTypes.h:336-342`), so a
 *   record has exactly one slot however often it moves within its cell, and
 *   `ConvertListOfObjects` forbids two slots naming one `(db, idx)` except for a
 *   missile's flying object. A pre-pass over every reference in the world therefore
 *   fixes each record's position; a record nothing refers to keeps 0.
 *
 * `heldReferences` is the rest of that pre-pass, and it is not optional for a file that
 * has to load: CSBWin converts the cell chains first (`:2736`), then the object-carrying
 * timers (`ConvertTimers`, `:2745`), then the thirty possession slots of every champion
 * (`ConvertCharacters`, `:2746`), and finally `d.objectInHand` (`:2760`) — and each of
 * those records the reference's **position** into `dataTypeMap` exactly as a cell chain
 * does. An object a champion is carrying is in no chain at all, so without this pass its
 * slot keeps position 0 and the possession slot comes back naming the same record in the
 * wrong corner of its cell. Pass the references in CSBWin's order; the last writer wins,
 * which matches because no object is reachable from two of them.
 */
export function buildObjectIndirectIndex(
    dungeon: DungeonData,
    heldReferences: Iterable<number> = [],
): CsbwinObjectIndexWriter {
    // Slot numbers, by (db, idx). One pass to lay them out.
    const slotOf = new Map<number, number>();
    const key = (db: number, idx: number) => (db << 16) | idx;

    let slots = 1; // slot 0 stays free
    for (const { db, key: dbKey } of WRITABLE_DATABASES) {
        const records = dungeon.databases[dbKey]?.records ?? [];
        for (let i = 0; i < records.length; i++) slotOf.set(key(db, i), slots++);
    }

    const typeMap = new Uint8Array(slots).fill(0xff);
    const indexMap = new Uint16Array(slots).fill(0xffff);
    for (const { db, key: dbKey } of WRITABLE_DATABASES) {
        const records = dungeon.databases[dbKey]?.records ?? [];
        for (let i = 0; i < records.length; i++) {
            const slot = slotOf.get(key(db, i))!;
            typeMap[slot] = db & 0x0f;
            indexMap[slot] = i & 0xffff;
        }
    }

    // The pre-pass: every reference in the world, so each record's `pos` is the one its
    // own RN carries. `notePosition` is deliberately last-writer-wins — an object appears
    // in exactly one chain, and a free record's stale references are ignored below.
    const notePosition = (rn: number): void => {
        if (rn === RN_EMPTY || rn >= RN_LITERAL_FLOOR) return;
        const { position, category, index } = decodeObjectID(rn);
        const slot = slotOf.get(key(category, index));
        if (slot === undefined) return;
        typeMap[slot] = ((position & 3) << 4) | (category & 0x0f);
    };
    for (const rn of dungeon.objectList) notePosition(rn);
    for (const { key: dbKey } of WRITABLE_DATABASES) {
        for (const record of dungeon.databases[dbKey]?.records ?? []) {
            const link = (record as { nextObject?: number }).nextObject;
            if (link === undefined) continue;
            notePosition(link);
            // A free record's other references are stale by design — `DeleteDBEntry`
            // writes `RNnul` over the link and leaves the rest (`data.cpp:993-1015`) —
            // so they must not move a live record's position.
            if (link === OBJECT_ID_NULL) continue;
            const other = record as { containedObject?: number; possession?: number; projectileObject?: number };
            if (other.containedObject !== undefined) notePosition(other.containedObject);
            if (other.possession !== undefined) notePosition(other.possession);
            if (other.projectileObject !== undefined) notePosition(other.projectileObject);
        }
    }
    for (const rn of heldReferences) notePosition(rn);

    return {
        ...makeObjectIndirectIndex(typeMap, indexMap),
        encode(rn: ui16): ui16 {
            const value = rn & 0xffff;
            if (value === RN_EMPTY) return RN_EMPTY;
            if (value >= RN_LITERAL_FLOOR) return value;
            const { category, index } = decodeObjectID(value);
            const slot = slotOf.get(key(category, index));
            if (slot === undefined) {
                throw new Error(
                    `object reference ${value} names ${DBTypeEnum[category] ?? category}[${index}], ` +
                    'which no database holds',
                );
            }
            return slot;
        },
    };
}
