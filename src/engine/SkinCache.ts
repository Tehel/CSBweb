/**
 * `SKIN_CACHE` (`doc/CSBwin-src/CSB.h:181-195`, `doc/CSBwin-src/data.cpp:2062-2175`): a
 * cell's skin, read from its `EXPOOL` record, and the level's default skin.
 *
 * A record holds a column pair, two bytes a row: byte `(2 * y) + (x & 1)`. CSBWin copies
 * the record's native longwords into `m_columns` with `memcpy`, and `DB11::swap` reads
 * them little-endian (`data.cpp:1461-1470`), so byte `i` is bits `8 * (i & 3)` up of
 * longword `i >> 2` (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Skin cache").
 *
 * The cache forgets everything at `Cleanup` (`CSB.h:194`), which `Cleanup(false)` runs
 * through `CleanupGraphics` (`doc/CSBwin-src/Graphics.cpp:2231`) before every game CSBWin
 * reads. `DungeonState` builds a new one for each world it takes.
 */
import { Expool } from '../data/CsbwinExpool';
import type { DungeonData } from '../data/dungeonTypes';

/** `EDT_Skins` (`doc/CSBwin-src/CSB.h:1554`). */
const EDT_SKINS = 4;

/** `(EDT_Skins << 24) + (level << 4) + (x / 2)`, the key of a column pair's record. */
function skinsKey(level: number, x: number): number {
    return ((EDT_SKINS << 24) + (level << 4) + Math.trunc(x / 2)) >>> 0;
}

/** `(EDT_Skins << 24) + 0x800000`, the key of the default skins' record, a byte a level. */
const DEFAULT_SKINS_KEY = ((EDT_SKINS << 24) + 0x800000) >>> 0;

/** The record's first `size` bytes, `memcpy`'d from its longwords. */
function copyBytes(dest: Int8Array | Uint8Array, record: readonly number[], size: number): void {
    for (let i = 0; i < size; i++) dest[i] = record[i >> 2]! >>> (8 * (i & 3));
}

export class SkinCache {
    /** -1 if the cache is empty. */
    private m_level = -1;
    /** Records from the pool, 64 bytes a column pair. */
    private readonly m_columns = Array.from({ length: 16 }, () => new Int8Array(64));
    /** Record sizes in bytes: -1 not looked at yet, 0 no record. */
    private readonly m_size = new Int8Array(16);
    private defaultSkins: Uint8Array | null = null;

    constructor(private readonly data: DungeonData) {}

    /** `SKIN_CACHE::Load` (`data.cpp:2065-2090`): the column pair of `x` on `level`, read. */
    private Load(level: number, x: number): number {
        if (level !== this.m_level) {
            this.m_level = level;
            this.m_size.fill(-1);
        }
        const column = Math.trunc(x / 2);
        if (this.m_size[column] === 0) return column;
        if (this.m_size[column] === -1) {
            const record = new Expool(this.data).locate(skinsKey(level, x));
            let recSize = 4 * (record ? record.length : -1);
            if (recSize <= 0) recSize = 0;
            this.m_size[column] = recSize;
            if (this.m_size[column] === 0) return column;
            if (this.m_size[column]! > 64) this.m_size[column] = 64;
            copyBytes(this.m_columns[column]!, record!, this.m_size[column]!);
        }
        return column;
    }

    /**
     * `SKIN_CACHE::GetSkin` (`data.cpp:2092-2116`): 0 off the level, for a column pair with
     * no record, and past the record's end. CSBWin reads a level past the dungeon's from
     * past the end of `d.pLevelDescriptors`, which is undefined; the port says 0.
     */
    GetSkin(level: number, x: number, y: number): number {
        if (level < 0) return 0;
        if (x < 0) return 0;
        if (y < 0) return 0;
        const map = this.data.maps[level];
        if (!map) return 0;
        if (x > map.descriptor.width - 1) return 0;
        if (y > map.descriptor.height - 1) return 0;
        const column = this.Load(level, x);
        if (this.m_size[column] === 0) return 0;
        const index = (2 * y) + (x & 1);
        if (index >= this.m_size[column]!) return 0;
        return this.m_columns[column]![index]! & 0xff;
    }

    /**
     * `SKIN_CACHE::GetDefaultSkin` (`data.cpp:2119-2138`): byte `level` of the default
     * skins' record, read once. Its `expool.IsOpen()` holds in a game: CSBWin's pool is set
     * up by the end of `ReadDatabases` (`src/data/CsbwinExpool.ts`).
     */
    GetDefaultSkin(level: number): number {
        if (this.defaultSkins === null) {
            this.defaultSkins = new Uint8Array(64);
            const record = new Expool(this.data).locate(DEFAULT_SKINS_KEY);
            let recSize = 4 * (record ? record.length : -1);
            if (recSize > 0) {
                if (recSize > 64) recSize = 64;
                copyBytes(this.defaultSkins, record!, recSize);
            }
        }
        return this.defaultSkins[level] ?? 0;
    }

    /**
     * `SKIN_CACHE::SetSkin` (`data.cpp:2142-2175`): nothing when the byte holds the skin
     * already, or lies past the record and the skin is 0. Otherwise the record is taken
     * out of the pool, widened to 64 bytes of zeros, given the skin, and written back
     * trimmed of its trailing zero bytes to whole longwords, or not at all when every byte
     * is 0, which leaves `m_size` as it was. `Read` copies at most 64 longwords into the
     * column's 64 bytes, so a record longer than sixteen would run into the next column's;
     * `SetSkin` writes none, and the port copies the first 64 bytes.
     */
    SetSkin(level: number, x: number, y: number, skinNum: number): void {
        const skin = (skinNum << 24) >> 24;
        const column = this.Load(level, x);
        const index = (2 * y) + (x & 1);
        const bytes = this.m_columns[column]!;
        if (index < this.m_size[column]!) {
            if (skin === bytes[index]) return;
        } else {
            if (skin === 0) return;
        }
        const recId = skinsKey(level, x);
        const expool = new Expool(this.data);
        const record = expool.read(recId);
        let recSize = 4 * (record ? record.length : -1);
        if (recSize < 0) recSize = 0;
        if (recSize > 64) recSize = 64;
        copyBytes(bytes, record ?? [], recSize);
        bytes.fill(0, recSize);
        bytes[index] = skin;
        let i: number;
        for (i = 63; i >= 0; i--) {
            if (bytes[i] !== 0) break;
        }
        if (i < 0) return;
        const longwords: number[] = [];
        for (let w = 0; w < Math.trunc((i + 4) / 4); w++) {
            longwords.push(((bytes[4 * w]! & 0xff) | ((bytes[4 * w + 1]! & 0xff) << 8)
                | ((bytes[4 * w + 2]! & 0xff) << 16) | ((bytes[4 * w + 3]! & 0xff) << 24)) >>> 0);
        }
        expool.write(recId, longwords);
        this.m_size[column] = i + 1;
    }
}
