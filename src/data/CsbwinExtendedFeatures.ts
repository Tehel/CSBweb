/**
 * Block 0 of a CSBWin save: the "Extended Features" prefix.
 *
 * It is 512 bytes of `EXTENDEDFEATURESBLOCK` (`doc/CSBwin-src/CSB.h:463-511`) followed
 * by four variable-length runs, in this order
 * (`SaveGame`, `doc/CSBwin-src/SaveGame.cpp:918-998`):
 *
 * ```
 *   512                      EXTENDEDFEATURESBLOCK
 *   dataMapLength            dataTypeMap
 *   2 * dataMapLength        dataIndexMap
 *   (only if numDSA != 0)    the DSA programs and their checksum
 *   gameInfoSize             the game-information string, without its terminator
 *   3 * n + 3                the DSA level index: (level, selector, dsa) triples,
 *                            closed by one triple of 0xff
 * ```
 *
 * `ReadExtendedFeatures` reads exactly that back (`:298-432`) and `LoadGame` then reads
 * GAMEBLOCK1 from wherever it left the file position, so the prefix's length is part of
 * the format rather than something either side may round.
 *
 * **The block is little-endian**, alone with the indirect text index in a big-endian
 * file: `SwapExtendedFeaturesBlock` has a body only `#ifdef _bigEndian`
 * (`doc/CSBwin-src/SaveGame.cpp:183-200`), so on the PC build CSBWin ships as it does
 * nothing and every field keeps native order.
 *
 * The three-byte terminator is easy to miss and not optional: `WriteDSALevelIndex` ends
 * with `triple[0] = triple[1] = triple[2] = 255;` and one more `WRITE`
 * (`doc/CSBwin-src/SaveGame.cpp:800-801`), and `ReadDSALevelIndex` loops until it reads a
 * triple whose first byte is above 63 (`:421-430`) — consuming it. Without those three
 * bytes the reader would eat the first three bytes of GAMEBLOCK1.
 */
import { formChecksum } from './CsbwinObjectIndex';
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from '../core/bytes';

/** `strcpy(efb.sentinel, " Extended Features ")` — 19 characters and a terminator. */
export const EXTENDED_SENTINEL = ' Extended Features ';

/** `sizeof(EXTENDEDFEATURESBLOCK)`, asserted by CSBWin itself (`SaveGame.cpp:917`). */
export const EXTENDED_FEATURES_SIZE = 512;

/** `EXTENDEDFEATURESBLOCK::FLAGS` (`doc/CSBwin-src/CSB.h:472-481`). */
export const EF_FLAGS = {
    LevelDSAInfoPresent: 0x01,
    SimpleEncryption: 0x04,
    IndirectText: 0x08,
    AutoRecord: 0x10,
    ExpandedPortraits: 0x20,
    DMRules: 0x40,
    BigActuators: 0x80,
} as const;

/** `EXTENDEDFEATURESBLOCK::EXTENDEDFLAGS` (`doc/CSBwin-src/CSB.h:491-501`). */
export const EF_EXTENDED_FLAGS = {
    OverlayActive: 0x00000001,
    InvisibleMonsters: 0x00000002,
    DrawAsSize4Monsters: 0x00000004,
    DMRulesOption: 0x00000008,
    ExtendedWallDecorations: 0x00000010,
    SequencedTimers: 0x00000020,
    DefaultDirectX: 0x00000040,
    ExtendedTimers: 0x00000080,
} as const;

/**
 * `ExtendedFeaturesVersion`. `'@'` (0x40) is "no extended features"
 * (`doc/CSBwin-src/data.cpp:248`); `'B'` and up store the new six-byte SCROLL
 * (`doc/CSBwin-src/SaveGame.cpp:2189-2200`), and every committed save is `'B'`.
 */
export const EF_VERSION_B = 0x42;

/**
 * The 512-byte header, field for field. Names are CSBWin's.
 *
 * `dataMapLength` and the two map checksums are **not** here: they describe the two runs
 * that follow the block and are computed by `buildExtendedFeaturesPrefix` from the maps
 * it is given, so they cannot drift from the bytes actually written.
 */
export interface ExtendedFeaturesBlock {
    /** `efb.version` — `ExtendedFeaturesVersion`. */
    version: number;
    /** `efb.flags` — see `EF_FLAGS`. */
    flags: number;
    /** `efb.numDSA` — `countDSAs()`. */
    numDSA: number;
    editingOptions: number;
    /**
     * `efb.gameInfoSize`, **signed**, and not the same thing as the number of bytes
     * written: `SaveGame` stores 0 when there is no game information at all and
     * `gameInfoSize - 1` when there is (`doc/CSBwin-src/SaveGame.cpp:977-978`), so an
     * allocated-but-empty one stores **-1** and `WriteGameInfo` then writes nothing
     * (`:265-270`). `csbgame3.dat` is exactly that case, and it is why this is carried
     * rather than derived from the bytes — the two are indistinguishable at zero.
     */
    gameInfoSize: number;
    /** `efb.cellFlagArraySize` — the length of block 14. */
    cellFlagArraySize: number;
    graphicsSignature1: number;
    graphicsSignature2: number;
    /** `spellFilterLocation`; bit 31 set when the location is valid. */
    spellFilterLocation: number;
    /** `efb.extendedFlags` — see `EF_EXTENDED_FLAGS`. */
    extendedFlags: number;
    /** `overlayOrdinal` is the overlay number **plus one**; 0 means none. */
    overlayOrdinal: number;
    overlayP1: number;
    overlayP2: number;
    overlayP3: number;
    overlayP4: number;
    csbGraphicsSignature1: number;
    csbGraphicsSignature2: number;
    /** `efb.hintKey[8]`, as bytes. */
    hintKey: Uint8Array;
}

/** Read the 512-byte header. The caller has already verified its checksum. */
export function parseExtendedFeaturesBlock(block: Uint8Array): ExtendedFeaturesBlock {
    return {
        version: block[36] ?? 0,
        flags: block[37] ?? 0,
        numDSA: readU16LE(block, 38),
        editingOptions: readU32LE(block, 40),
        gameInfoSize: readU32LE(block, 44) | 0,
        cellFlagArraySize: readU32LE(block, 48),
        graphicsSignature1: readU32LE(block, 52),
        graphicsSignature2: readU32LE(block, 56),
        spellFilterLocation: readU32LE(block, 60),
        extendedFlags: readU32LE(block, 64),
        overlayOrdinal: readU32LE(block, 68) | 0,
        overlayP1: readU32LE(block, 72) | 0,
        overlayP2: readU32LE(block, 76) | 0,
        overlayP3: readU32LE(block, 80) | 0,
        overlayP4: readU32LE(block, 84) | 0,
        csbGraphicsSignature1: readU32LE(block, 88),
        csbGraphicsSignature2: readU32LE(block, 92),
        hintKey: block.slice(96, 104),
    };
}

/** What `buildExtendedFeaturesPrefix` needs beyond the header. */
export interface ExtendedFeaturesPrefix {
    header: ExtendedFeaturesBlock;
    /** `dataTypeMap`: one byte per slot, `(pos << 4) | dbNum`, 0xff when free. */
    typeMap: Uint8Array;
    /** `dataIndexMap`: one **little-endian** word per slot, 0xffff when free. */
    indexMap: Uint16Array;
    /**
     * The DSA section verbatim, from `WriteDSAs` to its four-byte checksum, or absent
     * when `header.numDSA` is 0.
     *
     * ⏳ This port does not re-serialize DSA programs; it carries the bytes a save was
     * read with. A DSA whose state machine has moved since is therefore written back
     * where it stood, which is wrong — but no dungeon this project loads defines a DSA
     * at all (`numDSA` is 0 in every committed save), so nothing exercises it. Recorded
     * in `PLAN.md` Phase 10.
     */
    dsaBlock?: Uint8Array;
    /**
     * `gameInfo`, without the terminator `ReadGameInfo` appends
     * (`doc/CSBwin-src/SaveGame.cpp:390-397`). Must be exactly `max(0,
     * header.gameInfoSize)` bytes long, since that field is what tells the reader how
     * many to consume.
     */
    gameInfo?: Uint8Array;
    /**
     * `DSALevelIndex[level][selector]`, 64 x 32, 0xffff where unset. Only entries below
     * 256 are written (`doc/CSBwin-src/SaveGame.cpp:792`).
     */
    dsaLevelIndex?: number[][];
}

/**
 * Build the whole prefix — header, both maps, the DSA section, the game info and the
 * DSA level index with its terminator.
 *
 * The header's `dataMapLength`, its two map checksums and `gameInfoSize` are computed
 * here from the arrays actually being written, exactly as `SaveGame` computes them from
 * the live arrays (`doc/CSBwin-src/SaveGame.cpp:921-931`, `:977`). Its own checksum goes
 * in last, over all 512 bytes with the field zeroed (`:981-983`).
 */
export function buildExtendedFeaturesPrefix(prefix: ExtendedFeaturesPrefix): Uint8Array {
    const { header, typeMap, indexMap } = prefix;
    if (typeMap.length !== indexMap.length) {
        throw new Error(
            `object index maps disagree: ${typeMap.length} types, ${indexMap.length} indices`,
        );
    }
    const dataMapLength = typeMap.length;

    const indexBytes = new Uint8Array(dataMapLength * 2);
    for (let i = 0; i < dataMapLength; i++) writeU16LE(indexBytes, i * 2, indexMap[i]);

    const block = new Uint8Array(EXTENDED_FEATURES_SIZE);
    for (let i = 0; i < EXTENDED_SENTINEL.length; i++) {
        block[i] = EXTENDED_SENTINEL.charCodeAt(i);
    }
    writeU32LE(block, 20, dataMapLength);
    writeU32LE(block, 24, formChecksum(typeMap));
    writeU32LE(block, 28, formChecksum(indexBytes));
    // 32: extendedFeaturesChecksum, filled in below.
    block[36] = header.version & 0xff;
    block[37] = header.flags & 0xff;
    writeU16LE(block, 38, header.numDSA);
    writeU32LE(block, 40, header.editingOptions);
    const written = Math.max(0, header.gameInfoSize);
    const gameInfo = written > 0 ? (prefix.gameInfo ?? new Uint8Array(written)) : undefined;
    if (gameInfo && gameInfo.length !== written) {
        throw new Error(
            `gameInfoSize is ${header.gameInfoSize} but ${gameInfo.length} bytes were given`,
        );
    }
    writeU32LE(block, 44, header.gameInfoSize);
    writeU32LE(block, 48, header.cellFlagArraySize);
    writeU32LE(block, 52, header.graphicsSignature1);
    writeU32LE(block, 56, header.graphicsSignature2);
    writeU32LE(block, 60, header.spellFilterLocation);
    writeU32LE(block, 64, header.extendedFlags);
    writeU32LE(block, 68, header.overlayOrdinal);
    writeU32LE(block, 72, header.overlayP1);
    writeU32LE(block, 76, header.overlayP2);
    writeU32LE(block, 80, header.overlayP3);
    writeU32LE(block, 84, header.overlayP4);
    writeU32LE(block, 88, header.csbGraphicsSignature1);
    writeU32LE(block, 92, header.csbGraphicsSignature2);
    block.set(header.hintKey.subarray(0, 8), 96);
    writeU32LE(block, 32, formChecksum(block));

    const levelIndex = buildDsaLevelIndex(prefix.dsaLevelIndex);
    const dsaBlock = header.numDSA !== 0 ? (prefix.dsaBlock ?? new Uint8Array(0)) : new Uint8Array(0);
    if (header.numDSA !== 0 && !prefix.dsaBlock) {
        throw new Error(`extended features declare ${header.numDSA} DSAs but carry none`);
    }

    const out = new Uint8Array(
        EXTENDED_FEATURES_SIZE + dataMapLength * 3 + dsaBlock.length +
        (gameInfo?.length ?? 0) + levelIndex.length,
    );
    let at = 0;
    out.set(block, at); at += block.length;
    out.set(typeMap, at); at += typeMap.length;
    out.set(indexBytes, at); at += indexBytes.length;
    out.set(dsaBlock, at); at += dsaBlock.length;
    if (gameInfo) { out.set(gameInfo, at); at += gameInfo.length; }
    out.set(levelIndex, at);
    return out;
}

/**
 * `WriteDSALevelIndex` (`doc/CSBwin-src/SaveGame.cpp:782-802`): a `(level, selector,
 * dsaIndex)` triple for every entry below 256, in level-then-selector order, closed by
 * `ff ff ff`.
 */
function buildDsaLevelIndex(index: number[][] | undefined): Uint8Array {
    const triples: number[] = [];
    if (index) {
        for (let level = 0; level < 64; level++) {
            for (let selector = 0; selector < 32; selector++) {
                const dsa = index[level]?.[selector] ?? 0xffff;
                if (dsa < 256) triples.push(level, selector, dsa);
            }
        }
    }
    triples.push(0xff, 0xff, 0xff);
    return Uint8Array.from(triples);
}

/** What a live game has to supply for its own Extended Features header. */
export interface LiveExtendedFeatures {
    /** `cellflagArraySize` — `cellFlagArraySize(dungeon.maps)`, the length of block 14. */
    cellFlagArraySize: number;
    /** `extendedWallDecorations`, as the world carries it. */
    extendedWallDecorations?: boolean;
    /** `spellFilterLocation`; 0, and bit 31 clear, means "no filter". */
    spellFilterLocation?: number;
    /** `DM_rules`, written as `DMRulesOption`. */
    dmRules?: boolean;
    /** `DMRulesDesignOption`, written as `DMRules`. */
    dmRulesDesignOption?: boolean;
}

/**
 * `ReadExtendedFeatures`' two rule flags (`doc/CSBwin-src/SaveGame.cpp:392-398`):
 * `DMRulesDesignOption` from `flags & DMRules`, `DM_rules` from
 * `extendedFlags & DMRulesOption`. A file with no block (`header` undefined) assigns
 * neither, as CSBWin, which never reaches that function for it.
 */
export function readRulesOptions(
    rules: { dmRules: boolean; dmRulesDesignOption: boolean },
    header: ExtendedFeaturesBlock | undefined,
): void {
    if (!header) return;
    rules.dmRulesDesignOption = (header.flags & EF_FLAGS.DMRules) !== 0;
    rules.dmRules = (header.extendedFlags & EF_EXTENDED_FLAGS.DMRulesOption) !== 0;
}

/**
 * The 512-byte header a running game writes, field for field against `SaveGame`
 * (`doc/CSBwin-src/SaveGame.cpp:915-980`).
 *
 * Nothing here is a guess. Each field is either assigned by that function from something
 * this port holds, or measured to be zero in all fourteen committed saves and named
 * below as such — `memset(&efb,0,512)` runs first, so a field `SaveGame` never touches
 * is genuinely zero rather than merely unknown.
 *
 * **`flags`.** `SaveGame` sets four unconditionally: `LevelDSAInfoPresent` (`:940`),
 * because it always writes the DSA level index and `ReadExtendedFeatures` only reads it
 * back when the bit is on (`:387-390`); `IndirectText`, `ExpandedPortraits` and
 * `BigActuators` (`:961-963`), which are the shapes of blocks 11-13 and of `CHARDESC`.
 * They must agree with the image actually written, which is what
 * `convertOriginalDungeon` guarantees. `DMRules` is `DMRulesDesignOption` (`:952-953`).
 * The other two are options this port does not model and writes off: `SimpleEncryption`
 * (the whole file behind RC4) and `AutoRecord`. Measured: eleven saves carry 0xe9 — the
 * four plus `DMRules` — and the three older ones 0xa9, which is exactly the four alone.
 *
 * **`extendedFlags`.** Three unconditional (`:964-966`): `SequencedTimers` and
 * `ExtendedTimers`, which together select the 16-byte `TIMER` this port writes, and
 * `DefaultDirectX`, which is a UI preference CSBWin sets on every save. Plus
 * `ExtendedWallDecorations` from the world and `DMRulesOption` from `DM_rules`
 * (`:950-951`). `InvisibleMonsters` and `DrawAsSize4Monsters` are global design options
 * with no equivalent here. Measured: 0xe0
 * in `csbgame3.dat`, which is the three unconditional ones; 0xf8 in the newest saves,
 * adding the wall decorations and DM rules; and **0** in `csbgame.dat` and
 * `csbgame2.dat`, which an older CSBWin wrote with 10-byte timers.
 *
 * **Zero, and measured zero rather than assumed.** `editingOptions` is never assigned by
 * `SaveGame` at all. `graphicsSignature1/2` and `csbGraphicsSignature1/2` are
 * `expectedGraphicSignature*`, which `Graphics.cpp:1786-1796` treats as "no expectation"
 * when both halves are zero — this port computes no signature. `hintKey` is `Hint.cpp`'s
 * key, and `hintKey[0] == 0` is its own "no key" test (`doc/CSBwin-src/Hint.cpp:5508`).
 * `overlayOrdinal` is the overlay number **plus one**, so 0 is "no overlay", and the four
 * parameters go with it. All eight are zero in every committed save.
 *
 * **`gameInfoSize` is 0**, meaning `gameInfo == NULL` (`:977-978`) — this port has no
 * game-information string. Note that 0 and -1 are different things here; -1 is an
 * allocated-but-empty one, which `csbgame3.dat` carries.
 *
 * **`numDSA` is 0.** `DSA::Write` is unported, so a world with DSA programs cannot be
 * written; no dungeon this project loads defines one. `buildSavePayload` refuses rather
 * than writing a file that silently lost them.
 */
export function buildLiveExtendedFeatures(live: LiveExtendedFeatures): ExtendedFeaturesBlock {
    let flags =
        EF_FLAGS.LevelDSAInfoPresent | EF_FLAGS.IndirectText |
        EF_FLAGS.ExpandedPortraits | EF_FLAGS.BigActuators;
    if (live.dmRulesDesignOption) flags |= EF_FLAGS.DMRules;
    let extendedFlags =
        EF_EXTENDED_FLAGS.SequencedTimers | EF_EXTENDED_FLAGS.ExtendedTimers |
        EF_EXTENDED_FLAGS.DefaultDirectX;
    if (live.dmRules) extendedFlags |= EF_EXTENDED_FLAGS.DMRulesOption;
    if (live.extendedWallDecorations) extendedFlags |= EF_EXTENDED_FLAGS.ExtendedWallDecorations;

    return {
        version: EF_VERSION_B,
        flags,
        numDSA: 0,
        editingOptions: 0,
        gameInfoSize: 0,
        cellFlagArraySize: live.cellFlagArraySize,
        graphicsSignature1: 0,
        graphicsSignature2: 0,
        spellFilterLocation: (live.spellFilterLocation ?? 0) >>> 0,
        extendedFlags: extendedFlags >>> 0,
        overlayOrdinal: 0,
        overlayP1: 0,
        overlayP2: 0,
        overlayP3: 0,
        overlayP4: 0,
        csbGraphicsSignature1: 0,
        csbGraphicsSignature2: 0,
        hintKey: new Uint8Array(8),
    };
}
