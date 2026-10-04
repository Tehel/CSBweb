/**
 * `EXPOOL`, database 11: CSBWin's expandable pool of keyed records
 * (`class EXPOOL`, `doc/CSBwin-src/CSB.h:1581`; `doc/CSBwin-src/data.cpp:1507-1675`).
 *
 * The database is an array of 256-byte blocks (`DB11`, `CSB.h:1280-1288`: the link word,
 * `size`, and 63 longwords), which CSBWin addresses as one array of longwords, `m`, 64 to
 * a block. Here `m` is read and written in place in the file's bytes, big-endian, so a
 * block's first longword holds its link in the high word and its `size` in the low one
 * (`DB11::swap`, `data.cpp:1458-1467`).
 *
 * - **Block 0** is the directory (`EXPOOL::Setup`, `:1507-1522`): `m[2]` to `m[31]` head
 *   the free lists, one for each record length, and `m[32]` to `m[63]` the hash chains.
 * - **Every other block** holds records of one length, its `size`: the link to the next
 *   record of its chain or free list, the key, then `size - 2` longwords of data
 *   (`EXPOOL::enlarge`, `:1610-1633`).
 *
 * A key's top byte is its `EXPOOL_DATA_TYPE` (`CSB.h:1529`). Two records may share a key:
 * `Write` puts the new one at the head of its chain, and `Read` and `Locate` take the
 * first they meet.
 *
 * `Setup` runs at the first `Write`, where CSBWin's runs at the end of `ReadDatabases`
 * (`doc/CSBwin-src/SaveGame.cpp:2773`). The pool is the same from that record on; a world
 * nothing has written a record to has no block, as `dungeon.dat` has none.
 */
import { readU32BE, writeU32BE } from '../core/bytes';
import { DBType } from '../core/types';

/** `sizeof(DB11)`, an `EXPOOL` block (`doc/CSBwin-src/CSB.h:1280-1288`). */
export const EXPOOL_RECORD_SIZE = 256;
/** The longwords of one block. */
const EXPOOL_WORDS_PER_BLOCK = 64;
/** `RNeof`, every block's link (`doc/CSBwin-src/data.cpp:1514`, `:1623`). */
const RN_EOF = 0xfffe;
/** `EDT_MessageParameters` (`doc/CSBwin-src/CSB.h:1531`). */
const EDT_MESSAGE_PARAMETERS = 1;
/** `EDT_SpecialLocations` (`doc/CSBwin-src/CSB.h:1534`). */
const EDT_SPECIAL_LOCATIONS = 3;
/** The last `ESL_*`, `ESL_DAMAGECHARFILTER` (`doc/CSBwin-src/CSB.h:1550`). */
const ESL_SPECIAL_LOCATION_MAX = 15;
/** `EDT_Database` (`doc/CSBwin-src/CSB.h:1552`). */
const EDT_DATABASE = 5;
/** `EDBT_GlobalVariables` (`doc/CSBwin-src/CSB.h:1557`). */
const EDBT_GLOBAL_VARIABLES = 4;
/** `EDT_ChampionBones` (`doc/CSBwin-src/CSB.h:1571`). */
const EDT_CHAMPION_BONES = 9;

/**
 * What `EXPOOL` reaches of CSBWin's `DATABASES`: database 11's blocks
 * (`db.GetCommonAddress(dbEXPOOL, 0)`) and their number (`db.NumEntry(dbEXPOOL)`). A
 * `DungeonData` is one.
 */
export interface ExpoolDatabase {
    expool?: Uint8Array;
    header: { objectCounts: number[] };
}

/** `(EDT_ChampionBones << 24) | rn`, the key of a bones object's record. */
function championBonesKey(rn: number): number {
    return ((EDT_CHAMPION_BONES << 24) | (rn & 0xffff)) >>> 0;
}

/**
 * `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i`, the key of the `i`th record
 * of sixteen DSA global variables.
 */
function globalVariablesKey(i: number): number {
    return ((EDT_DATABASE << 24) | (EDBT_GLOBAL_VARIABLES << 16) | i) >>> 0;
}

/**
 * `(EDT_MessageParameters << 24) + timerID`, the key of the parameters a DSA's `&MESSAGE`
 * gives the timer it sets (`doc/CSBwin-src/DSA.cpp:3087`), which the timer reads back
 * (`doc/CSBwin-src/Timer.cpp:1401`, `:1701`, `:2180`).
 */
export function messageParametersKey(timerIndex: number): number {
    return ((EDT_MESSAGE_PARAMETERS << 24) + timerIndex) >>> 0;
}

export class Expool {
    constructor(private readonly db: ExpoolDatabase) {}

    /** `m[i]`. A longword past the pool reads as 0, which ends a chain. */
    private m(i: number): number {
        const bytes = this.db.expool;
        if (!bytes || i < 0 || i * 4 + 4 > bytes.length) return 0;
        return readU32BE(bytes, i * 4);
    }

    private setM(i: number, value: number): void {
        const bytes = this.db.expool;
        if (!bytes || i < 0 || i * 4 + 4 > bytes.length) {
            throw new Error(`EXPOOL: longword ${i} is outside the pool`);
        }
        writeU32BE(bytes, i * 4, value >>> 0);
    }

    /** `db.NumEntry(dbEXPOOL)`. */
    private numBlock(): number {
        return (this.db.expool?.length ?? 0) / EXPOOL_RECORD_SIZE;
    }

    /** `EXPOOL::Setup` (`doc/CSBwin-src/data.cpp:1507-1522`): the directory block. */
    private setup(): void {
        if (this.numBlock() !== 0) return;
        this.db.expool = new Uint8Array(EXPOOL_RECORD_SIZE);
        // `link(RNeof)`, `size = 0`.
        this.setM(0, (RN_EOF << 16) >>> 0);
        this.db.header.objectCounts[DBType.EXPOOL] = 1;
    }

    /** The slot that heads `key`'s chain: the first lines of `Write`, `Read` and `Locate`. */
    private chainHead(key: number): number {
        const hash = Math.imul(key, 0xbb40e62d) >>> 0;
        let hashi = 32 + (hash >>> 27);
        if ((this.m(hashi) & 0x80000000) !== 0) {
            hashi = ((this.m(hashi) & 0x7fffffff) + ((hash >>> 21) & 0x3f)) >>> 0;
        }
        return hashi;
    }

    /**
     * The slot whose longword points at `key`'s first record, or -1: the `while` of `Read`
     * and `Locate`. A chain longer than the pool is a damaged one, and holds no record.
     */
    private find(key: number): number {
        let hashi = this.chainHead(key);
        const words = this.numBlock() * EXPOOL_WORDS_PER_BLOCK;
        for (let guard = 0; guard <= words && this.m(hashi) !== 0; guard++) {
            const p = this.m(hashi);
            if (this.m(p + 1) === (key >>> 0)) return hashi;
            hashi = p;
        }
        return -1;
    }

    /** `((DB11 *)(m+(p & 0xffffffc0)))->size`: the length of the records of `p`'s block. */
    private blockSize(p: number): number {
        return this.m((p & 0xffffffc0) >>> 0) & 0xffff;
    }

    /** `EXPOOL::Write` (`doc/CSBwin-src/data.cpp:1530-1547`). */
    write(key: number, record: readonly number[]): void {
        const size = record.length;
        if (size > 29) throw new Error(`EXPOOL: a record of ${size} longwords (29 at most)`);
        this.setup();
        if (this.m(size + 2) === 0) this.enlarge(size + 2);
        const result = this.m(size + 2);
        this.setM(size + 2, this.m(result));
        const hashi = this.chainHead(key);
        this.setM(result, this.m(hashi));
        this.setM(hashi, result);
        this.setM(result + 1, key);
        for (let i = 0; i < size; i++) this.setM(result + 2 + i, record[i]);
    }

    /**
     * `EXPOOL::Read` (`doc/CSBwin-src/data.cpp:1549-1575`): `key`'s first record, taken
     * out of the pool, or null where CSBWin returns -1. The array's length is the size
     * CSBWin returns; its `max` bounds the caller's buffer, which an array does not need.
     */
    read(key: number): number[] | null {
        const hashi = this.find(key);
        if (hashi === -1) return null;
        const p = this.m(hashi);
        const size = this.blockSize(p);
        const record: number[] = [];
        for (let i = 2; i < size; i++) record.push(this.m(p + i));
        this.setM(hashi, this.m(p));
        this.setM(p, this.m(size));
        this.setM(size, p);
        return record;
    }

    /**
     * `EXPOOL::Locate` (`doc/CSBwin-src/data.cpp:1582-1608`): a copy of `key`'s first
     * record, which stays in the pool, or null where CSBWin returns -1.
     */
    locate(key: number): number[] | null {
        const hashi = this.find(key);
        if (hashi === -1) return null;
        const p = this.m(hashi);
        const size = this.blockSize(p);
        const record: number[] = [];
        for (let i = 2; i < size; i++) record.push(this.m(p + i));
        return record;
    }

    /**
     * `EXPOOL::enlarge` (`doc/CSBwin-src/data.cpp:1610-1633`): one more block, cut into
     * records of `size` longwords and put at the head of that length's free list.
     */
    private enlarge(size: number): void {
        const numBlock = this.numBlock() + 1;
        const m = new Uint8Array(EXPOOL_RECORD_SIZE * numBlock);
        m.set(this.db.expool ?? []);
        this.db.expool = m;
        let p = EXPOOL_WORDS_PER_BLOCK * (numBlock - 1) + 1;
        const n = Math.floor(63 / size);
        // `pDB11->link(RNeof)`, `pDB11->Size(size)`.
        this.setM(EXPOOL_WORDS_PER_BLOCK * (numBlock - 1), ((RN_EOF << 16) | size) >>> 0);
        for (let i = 0; i < n; i++, p += size) this.setM(p, p + size);
        this.setM(p - size, this.m(size));
        this.setM(size, EXPOOL_WORDS_PER_BLOCK * (numBlock - 1) + 1);
        this.db.header.objectCounts[DBType.EXPOOL] = numBlock;
    }

    /** Every record's key, chain by chain, each chain from its newest record. */
    keys(): number[] {
        const words = this.numBlock() * EXPOOL_WORDS_PER_BLOCK;
        const heads: number[] = [];
        for (let slot = 32; slot < Math.min(64, words); slot++) {
            const head = this.m(slot);
            if ((head & 0x80000000) === 0) {
                heads.push(slot);
            } else {
                // A second table of 64 chains, which `Write`, `Read` and `Locate` follow.
                for (let i = 0; i < 64; i++) heads.push((head & 0x7fffffff) + i);
            }
        }
        const keys: number[] = [];
        for (const head of heads) {
            let slot = head;
            for (let guard = 0; guard <= words && this.m(slot) !== 0; guard++) {
                slot = this.m(slot);
                keys.push(this.m(slot + 1));
            }
        }
        return keys;
    }

    /**
     * `SaveGame`'s copy of the DSA global variables into their records
     * (`doc/CSBwin-src/SaveGame.cpp:1141-1148`): sixteen to a record, each written
     * through `Locate`'s pointer, so it keeps its place in the pool. False, where CSBWin
     * says "Error saving global variables", for a record missing or shorter than
     * sixteen; that one is left as it was.
     */
    storeGlobalVariables(values: readonly number[]): boolean {
        let saved = true;
        for (let i = 0; i < Math.floor(values.length / 16); i++) {
            const hashi = this.find(globalVariablesKey(i));
            const p = hashi === -1 ? 0 : this.m(hashi);
            if (hashi === -1 || this.blockSize(p) - 2 < 16) {
                saved = false;
                continue;
            }
            for (let j = 0; j < 16; j++) this.setM(p + 2 + j, values[16 * i + j]);
        }
        return saved;
    }

    /** `EXPOOL::AddChampionBonesRecord` (`doc/CSBwin-src/data.cpp:1636-1643`). */
    addChampionBonesRecord(bonesObject: number, fingerprint: number): void {
        this.write(championBonesKey(bonesObject), [fingerprint & 0xffff]);
    }

    /** `EXPOOL::CopyChampionBonesRecord` (`doc/CSBwin-src/data.cpp:1655-1665`), or null. */
    copyChampionBonesRecord(bonesObject: number): number | null {
        const record = this.locate(championBonesKey(bonesObject));
        return record?.length === 1 ? record[0] : null;
    }

    /**
     * `EXPOOL::GetChampionBonesRecord` (`doc/CSBwin-src/data.cpp:1667-1675`), or null.
     * The record leaves the pool.
     */
    getChampionBonesRecord(bonesObject: number): number | null {
        const record = this.read(championBonesKey(bonesObject));
        return record?.length === 1 ? record[0] : null;
    }
}

/**
 * `LoadGame`'s read of the DSA global variables (`doc/CSBwin-src/SaveGame.cpp:1746-1760`):
 * sixteen from each record, from the first up to one missing or shorter than sixteen.
 * Their number is `numGlobalVariables`, 0 for a pool with none.
 */
export function readGlobalVariables(db: ExpoolDatabase): number[] {
    const expool = new Expool(db);
    const values: number[] = [];
    for (let i = 0; i < 999; i++) {
        const record = expool.locate(globalVariablesKey(i));
        if (!record || record.length < 16) break;
        values.push(...record.slice(0, 16));
    }
    return values;
}

/** The `EDT_SpecialLocations` entries of an `EXPOOL` database, given as its raw blocks. */
export function specialLocationsFromExpool(bytes: Uint8Array): Record<number, number> | null {
    const expool = new Expool({ expool: bytes, header: { objectCounts: [] } });
    const locations: Record<number, number> = {};
    for (let esl = 0; esl <= ESL_SPECIAL_LOCATION_MAX; esl++) {
        const key = ((EDT_SPECIAL_LOCATIONS << 24) | esl) >>> 0;
        const record = expool.locate(key);
        if (record && record.length >= 1) locations[key] = record[0];
    }
    return Object.keys(locations).length === 0 ? null : locations;
}
