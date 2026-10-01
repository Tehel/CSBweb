/**
 * `EXPOOL`, database 11: CSBWin's expandable pool of keyed records
 * (`class EXPOOL`, `doc/CSBwin-src/CSB.h:1581`; `doc/CSBwin-src/data.cpp:1507-1675`).
 *
 * The database is an array of 256-byte blocks (`DB11`, `CSB.h:1280-1288`: the link word,
 * `size`, and 63 longwords), read here as one array of big-endian longwords, 64 to a
 * block, so a block's first holds its `size` in the low word (`DB11::swap`,
 * `data.cpp:1458-1467`). A record is found from its key through a hash chain
 * (`EXPOOL::Locate`, `data.cpp:1582-1608`), and a key's top byte is its
 * `EXPOOL_DATA_TYPE` (`CSB.h:1529`).
 */
import { readU32BE } from '../core/bytes';

/** `sizeof(DB11)`, an `EXPOOL` block (`doc/CSBwin-src/CSB.h:1280-1288`). */
export const EXPOOL_RECORD_SIZE = 256;
/** The longwords of one block. */
const EXPOOL_WORDS_PER_BLOCK = 64;
/** `EDT_SpecialLocations` (`doc/CSBwin-src/CSB.h:1534`). */
const EDT_SPECIAL_LOCATIONS = 3;
/** The last `ESL_*`, `ESL_DAMAGECHARFILTER` (`doc/CSBwin-src/CSB.h:1550`). */
const ESL_SPECIAL_LOCATION_MAX = 15;

/** The `EDT_SpecialLocations` entries of an `EXPOOL` database, given as its raw blocks. */
export function specialLocationsFromExpool(bytes: Uint8Array): Record<number, number> | null {
    const expool = new Uint32Array((bytes.length / EXPOOL_RECORD_SIZE) * EXPOOL_WORDS_PER_BLOCK);
    if (expool.length === 0) return null;
    for (let i = 0; i < expool.length; i++) expool[i] = readU32BE(bytes, i * 4);

    const locations: Record<number, number> = {};
    for (let esl = 0; esl <= ESL_SPECIAL_LOCATION_MAX; esl++) {
        const key = ((EDT_SPECIAL_LOCATIONS << 24) | esl) >>> 0;
        const record = locateExpoolRecord(expool, key);
        if (record !== null) locations[key] = record;
    }
    return Object.keys(locations).length === 0 ? null : locations;
}

/** `EXPOOL::Locate` (`doc/CSBwin-src/data.cpp:1582-1608`): the first word of `key`'s record. */
function locateExpoolRecord(expool: Uint32Array, key: number): number | null {
    const hash = Math.imul(key, 0xbb40e62d) >>> 0;
    let hashi = 32 + (hash >>> 27);
    if ((expool[hashi] & 0x80000000) !== 0) {
        hashi = ((expool[hashi] & 0x7fffffff) + ((hash >>> 21) & 0x3f)) >>> 0;
    }

    let guard = 0;
    while (expool[hashi] !== 0) {
        if (guard++ > expool.length) break;
        const p = expool[hashi] >>> 0;
        if (p + 1 >= expool.length) return null;
        if ((expool[p + 1] >>> 0) === (key >>> 0)) {
            const blockStart = p & 0xffffffc0;
            if (blockStart >= expool.length) return null;
            const size = expool[blockStart] & 0xffff;
            if (size < 3) return null;
            if (p + 2 >= expool.length) return null;
            return expool[p + 2] >>> 0;
        }
        hashi = expool[hashi] >>> 0;
        if (hashi >= expool.length) return null;
    }

    return null;
}
