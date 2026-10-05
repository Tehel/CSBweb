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
 *
 * A `dungeon.dat` may open with the same prefix (`DungeonLoader.loadDungeonDat`). This
 * module is its one reader, `readExtendedFeatures`, and its one writer,
 * `buildExtendedFeaturesPrefix`.
 */
import { formChecksum, readObjectIndirectIndex } from './CsbwinObjectIndex';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import type { DsaDefinition, DsaIndex } from './dungeonTypes';
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
     * (`:265-270`). That is why this is carried rather than derived from the bytes — the
     * two are indistinguishable at zero.
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

/** `SIZE` (`doc/CSBwin-src/RC4.cpp:5`): the length of the stream, which then repeats. */
const RC4_SIZE = 8192;

/**
 * `RC4_prepare_key` (`doc/CSBwin-src/RC4.cpp:20-48`): the stream `RC4_encipher` XORs a
 * buffer with, which CSBWin keeps in a static `rc4_key` and this returns.
 *
 * It is not RC4, as the file's own first lines warn: only the key schedule is. The
 * stream is the state itself. Its first 256 bytes are the schedule's permutation, as the
 * second loop's swaps leave it, and each byte after them is `(unsigned char)counter`
 * XORed with one byte of RC4's output.
 *
 * `swap_byte` is the XOR swap (`:14`), so an entry swapped with itself becomes 0.
 */
export function rc4PrepareKey(keyData: Uint8Array, keyDataLen: number): Uint8Array {
    const state = new Uint8Array(RC4_SIZE);
    for (let counter = 0; counter < RC4_SIZE; counter++) state[counter] = counter & 0xff;
    const swapByte = (a: number, b: number): void => {
        state[a] ^= state[b];
        state[b] ^= state[a];
        state[a] ^= state[b];
    };
    let index1 = 0;
    let index2 = 0;
    for (let counter = 0; counter < 256; counter++) {
        index2 = (keyData[index1] + state[counter] + index2) % 256;
        swapByte(counter, index2);
        index1 = (index1 + 1) % keyDataLen;
    }
    // "Create a few more random numbers."
    let x = 0;
    let y = 0;
    for (let counter = 256; counter < RC4_SIZE; counter++) {
        x = (x + 1) % 256;
        y = (state[x] + y) % 256;
        swapByte(x, y);
        const xorIndex = (state[x] + state[y]) % 256;
        state[counter] ^= state[xorIndex];
    }
    return state;
}

/**
 * `RC4_encipher` (`doc/CSBwin-src/RC4.cpp:52-55`): XOR `buffer` in place with the stream
 * from `position`, the buffer's place in its file. Its own inverse.
 */
export function rc4Encipher(state: Uint8Array, buffer: Uint8Array, position: number): void {
    for (let i = 0; i < buffer.length; i++) buffer[i] ^= state[(position + i) % RC4_SIZE];
}

/**
 * The stream of the "simple" encipherment: `simple[0] = 1; simple[1] = 0;
 * RC4_prepare_key(simple, 1)`, a key of one byte
 * (`doc/CSBwin-src/SaveGame.cpp:326-329`, `:915-918`).
 */
export function simpleEncipherKey(): Uint8Array {
    return rc4PrepareKey(new Uint8Array([1, 0]), 1);
}

/**
 * A copy of a whole file put through the "simple" stream, every byte by its position:
 * what `READ` gives of a file whose table says `Enciphered()`
 * (`doc/CSBwin-src/system.cpp:301-313`), and what `WRITE` puts in one (`:315-329`). The
 * cipher is a XOR, so the one function does both.
 */
export function simpleEncipher(file: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(file);
    rc4Encipher(simpleEncipherKey(), out, 0);
    return out;
}

/** `strcmp(efb.sentinel, " Extended Features ") == 0`: the nineteen characters and the terminator. */
function hasExtendedSentinel(buf: Uint8Array): boolean {
    if (buf.length <= EXTENDED_SENTINEL.length) return false;
    for (let i = 0; i < EXTENDED_SENTINEL.length; i++) {
        if (buf[i] !== EXTENDED_SENTINEL.charCodeAt(i)) return false;
    }
    return buf[EXTENDED_SENTINEL.length] === 0;
}

class RcsReader {
    private checksum = 0xffff;
    private offset: number;

    constructor(private data: Uint8Array, startOffset: number) {
        this.offset = startOffset;
    }

    getOffset(): number {
        return this.offset;
    }

    resetChecksum(): void {
        this.checksum = 0xffff;
    }

    finalizeChecksum(): number {
        const out = this.checksum >>> 0;
        this.checksum = 0xffff;
        return out;
    }

    readBytes(count: number): Uint8Array {
        const end = this.offset + count;
        if (end > this.data.length) throw new Error('savegame truncated while reading DSA data');
        const buf = this.data.subarray(this.offset, end);
        for (let i = 0; i < buf.length; i++) {
            // Plain `*` loses precision here (see `GraphicRandom`'s
            // comment for why): `Math.imul` gives the exact 32-bit-wraparound product
            // `ui32(0xbb40e62d)` means in C.
            this.checksum = (Math.imul(this.checksum, 0xbb40e62d) + 11 + buf[i]) >>> 0;
        }
        this.offset = end;
        return buf;
    }

    readU8(): number {
        return this.readBytes(1)[0] ?? 0;
    }

    readU16(): number {
        const b = this.readBytes(2);
        return (b[0] ?? 0) | ((b[1] ?? 0) << 8);
    }

    readU32(): number {
        const b = this.readBytes(4);
        return ((b[0] ?? 0) | ((b[1] ?? 0) << 8) | ((b[2] ?? 0) << 16) | ((b[3] ?? 0) << 24)) >>> 0;
    }
}

function decodeCString(bytes: Uint8Array): string {
    let end = bytes.length;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) {
            end = i;
            break;
        }
    }
    let out = '';
    for (let i = 0; i < end; i++) {
        out += String.fromCharCode(bytes[i] ?? 0);
    }
    return out;
}

function readU16Array(bytes: Uint8Array, count: number): number[] {
    const out: number[] = new Array(count);
    let off = 0;
    for (let i = 0; i < count; i++) {
        out[i] = (bytes[off] ?? 0) | ((bytes[off + 1] ?? 0) << 8);
        off += 2;
    }
    return out;
}

function readDsa(rcs: RcsReader): DsaDefinition {
    const description = decodeCString(rcs.readBytes(80));
    const state = rcs.readU16();
    const localState = rcs.readU8();
    const groupId = rcs.readU8();
    const numStates = rcs.readU32();
    const firstDisplayedState = rcs.readU32();
    const numNonEmptyStates = rcs.readU32();
    const states: Array<{ actions: Array<{ column: number; program: Uint16Array }> } | null> =
        Array.from({ length: numStates }, () => null);

    for (let i = 0; i < numNonEmptyStates; i++) {
        const stateNum = rcs.readU32();
        if (stateNum >= numStates) throw new Error('savegame DSA state out of range');
        const numActions = rcs.readU32();
        if (numActions > 12) throw new Error('savegame DSA actions > 12');
        const actions: Array<{ column: number; program: Uint16Array }> = [];
        for (let j = 0; j < numActions; j++) {
            const column = rcs.readU32();
            const numPgmWords = rcs.readU32();
            let program = new Uint16Array();
            if (numPgmWords > 0) {
                const bytes = rcs.readBytes(numPgmWords * 2);
                program = Uint16Array.from(readU16Array(bytes, numPgmWords));
            }
            actions.push({ column, program });
        }
        states[stateNum] = { actions };
    }

    return {
        description,
        state,
        localState,
        groupId,
        numStates,
        firstDisplayedState,
        states,
    };
}

/**
 * `WCS` (`doc/CSBwin-src/data.cpp:1796-1869`): the bytes `WriteDSAs` writes, little-endian
 * as the PC build's memory holds them, and the checksum `RcsReader` checks them against.
 */
class WcsWriter {
    private checksum = 0xffff;
    private readonly bytes: number[] = [];

    /** `WCS(handle)`: the checksum so far, and a new one started. */
    finalizeChecksum(): number {
        const out = this.checksum >>> 0;
        this.checksum = 0xffff;
        return out;
    }

    writeBytes(buf: ArrayLike<number>): void {
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i] & 0xff;
            this.checksum = (Math.imul(this.checksum, 0xbb40e62d) + 11 + b) >>> 0;
            this.bytes.push(b);
        }
    }

    writeU8(value: number): void {
        this.writeBytes([value]);
    }

    writeU16(value: number): void {
        this.writeBytes([value, value >>> 8]);
    }

    writeU32(value: number): void {
        this.writeBytes([value, value >>> 8, value >>> 16, value >>> 24]);
    }

    /** A `WRITE` beside the checksum, as `WriteDSAs` writes the checksum itself. */
    writeU32Unsummed(value: number): void {
        this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    }

    result(): Uint8Array {
        return Uint8Array.from(this.bytes);
    }
}

/**
 * `DSA::Write` (`doc/CSBwin-src/DSA.cpp:5672-5695`), with `DSAState::Write` and
 * `DSAAction::Write` (`:5764-5771`, `:5800-5805`): `readDsa`'s fields in its order.
 * `m_description` is a `char[80]` (`doc/CSBwin-src/Data.h:2444`), written whole: the
 * string, then zeros.
 */
function writeDsa(wcs: WcsWriter, dsa: DsaDefinition): void {
    const description = new Uint8Array(80);
    for (let i = 0; i < Math.min(dsa.description.length, 79); i++) {
        description[i] = dsa.description.charCodeAt(i);
    }
    wcs.writeBytes(description);
    wcs.writeU16(dsa.state);
    wcs.writeU8(dsa.localState);
    wcs.writeU8(dsa.groupId);
    wcs.writeU32(dsa.numStates);
    wcs.writeU32(dsa.firstDisplayedState);
    const states = Array.from({ length: dsa.numStates }, (_, i) => dsa.states[i] ?? null);
    wcs.writeU32(states.filter((s) => s !== null).length);
    states.forEach((state, stateNum) => {
        if (!state) return;
        wcs.writeU32(stateNum);
        wcs.writeU32(state.actions.length);
        for (const action of state.actions) {
            wcs.writeU32(action.column);
            wcs.writeU32(action.program.length);
            for (const word of action.program) wcs.writeU16(word);
        }
    });
}

/** `countDSAs` (`doc/CSBwin-src/SaveGame.cpp:755-765`): the DSAs the index holds. */
export function countDSAs(index: DsaIndex | undefined): number {
    return (index?.entries ?? []).slice(0, 256).filter((dsa) => dsa).length;
}

/**
 * `WriteDSAs` (`doc/CSBwin-src/SaveGame.cpp:767-780`): each DSA of the index, in number
 * order, behind its number, then the checksum of them all. What `readExtendedFeatures`
 * reads back.
 */
export function buildDsaSection(index: DsaIndex): Uint8Array {
    const wcs = new WcsWriter();
    wcs.finalizeChecksum();
    index.entries.slice(0, 256).forEach((dsa, dsaNum) => {
        if (!dsa) return;
        wcs.writeU32(dsaNum);
        writeDsa(wcs, dsa);
    });
    wcs.writeU32Unsummed(wcs.finalizeChecksum());
    return wcs.result();
}

/**
 * `ReadExtendedFeatures` (`doc/CSBwin-src/SaveGame.cpp:298-432`) over the front of a file,
 * a save's or a `dungeon.dat`'s: the block, the object maps, the DSAs, the game
 * information and the DSA level index. `offset` is `ExtendedFeaturesSize`, 0 when the
 * file opens with no block: one shorter than 512 bytes, one without the sentinel plain or
 * enciphered, or one whose block fails its checksum (`:320-353`). The file is then read
 * from its first byte.
 *
 * A block found only once deciphered, with `SimpleEncryption` in its `flags`, marks the
 * whole file enciphered (`:324-338`): `simpleEncipher` is then set, and `data` is the
 * file deciphered, as every later `READ` of it gives it (`simpleEncipher`). The maps and
 * whatever follows them are read from `data`, and so is the rest of the file by every
 * caller. For any other file `data` is the file as given.
 */
export function readExtendedFeatures(file: Uint8Array): {
    offset: number;
    /** The file as `READ` gives it: deciphered when `simpleEncipher`, else as given. */
    data: Uint8Array;
    /**
     * CSBWin's `simpleEncipher`, set when the block was found by deciphering and carries
     * `SimpleEncryption` (`doc/CSBwin-src/SaveGame.cpp:333-338`).
     */
    simpleEncipher: boolean;
    sequencedTimers: boolean;
    extendedTimers: boolean;
    extendedWallDecorations: boolean;
    bigActuators: boolean;
    expandedPortraits: boolean;
    indirectText: boolean;
    /** `EXTENDEDFEATURESBLOCK.version`. `'B'` and up store new-style scrolls. */
    version: number;
    /** `EXTENDEDFEATURESBLOCK.cellFlagArraySize`. */
    cellFlagArraySize: number;
    /**
     * The object indirect index, present whenever the block is (`dataMapLength` is 0 in
     * a file written before the feature existed, and then there is nothing to resolve).
     */
    objectIndex?: CsbwinObjectIndex;
    spellFilterLocation?: number;
    dsaLevelIndex?: number[][];
    dsaIndex?: DsaIndex;
    /** The parsed 512-byte header, absent when the file carries no prefix. */
    header?: ExtendedFeaturesBlock;
    /** The game-information bytes, as written. */
    gameInfo?: Uint8Array;
} {
    const noBlock = { offset: 0, data: file, simpleEncipher: false, sequencedTimers: false, extendedTimers: false, extendedWallDecorations: false, bigActuators: false, expandedPortraits: false, indirectText: false, version: 0, cellFlagArraySize: 0 };
    if (file.length < EXTENDED_FEATURES_SIZE) return noBlock;

    let data = file;
    let enciphered = false;

    // Without the sentinel the block may be an enciphered one: deciphered, it must open
    // with the sentinel and carry `SimpleEncryption` in its `flags`
    // (`doc/CSBwin-src/SaveGame.cpp:324-343`). The file is then enciphered from its
    // first byte to its last.
    if (!hasExtendedSentinel(file)) {
        const decoded = file.slice(0, EXTENDED_FEATURES_SIZE);
        rc4Encipher(simpleEncipherKey(), decoded, 0);
        if (!hasExtendedSentinel(decoded) || ((decoded[37] ?? 0) & EF_FLAGS.SimpleEncryption) === 0) {
            return noBlock;
        }
        data = simpleEncipher(file);
        enciphered = true;
    }
    const parsed = data.subarray(0, EXTENDED_FEATURES_SIZE);

    // `ReadExtendedFeatures` verifies the block against its own checksum before it
    // believes a single field of it (`doc/CSBwin-src/SaveGame.cpp:345-353`): the stored
    // value is lifted out, the field zeroed, and `FormChecksum` run over all 512 bytes.
    // A block that fails is no block: CSBWin seeks back and returns 0, and its caller
    // reads GAMEBLOCK1, or the dungeon's header, from the file's first byte.
    const checked = parsed.slice();
    const storedChecksum = readU32LE(checked, 32);
    checked[32] = checked[33] = checked[34] = checked[35] = 0;
    if (formChecksum(checked) !== (storedChecksum >>> 0)) return noBlock;

    const header = parseExtendedFeaturesBlock(parsed);
    // The three fields `ExtendedFeaturesBlock` leaves out, which describe the two maps
    // behind the block: `dataMapLength` at 20, and the maps' checksums at 24 and 28.
    const dataMapLength = readU32LE(parsed, 20);
    const typeMapChecksum = readU32LE(parsed, 24);
    const indexMapChecksum = readU32LE(parsed, 28);
    // A `gameInfoSize` of -1 is a game information allocated but empty, which
    // `WriteGameInfo` writes no byte of (`doc/CSBwin-src/SaveGame.cpp:265-270`): it
    // advances nothing.
    const gameInfoSize = Math.max(0, header.gameInfoSize);
    const { flags, extendedFlags, numDSA } = header;

    // The two maps that make every object reference in the file meaningful. See
    // `CsbwinObjectIndex.ts`: an RN in a CSBWin save is a slot number in this index, not
    // the packed `[pos:2][db:4][idx:10]` of `dungeon.dat`.
    const objectIndex =
        dataMapLength > 0
            ? readObjectIndirectIndex(
                data,
                EXTENDED_FEATURES_SIZE,
                dataMapLength,
                typeMapChecksum,
                indexMapChecksum,
            )
            : undefined;

    let offset = EXTENDED_FEATURES_SIZE + dataMapLength + dataMapLength * 2;

    let dsaLevelIndex: number[][] | undefined;
    let dsaIndex: DsaIndex | undefined;

    if (numDSA > 0) {
        const rcs = new RcsReader(data, offset);
        rcs.resetChecksum();
        dsaIndex = { entries: new Array<DsaDefinition | null>(256).fill(null) };
        for (let i = 0; i < numDSA; i++) {
            const dsaNum = rcs.readU32();
            if (dsaNum > 255) throw new Error('savegame DSA number > 255');
            if (dsaIndex.entries[dsaNum]) throw new Error('savegame duplicate DSA');
            dsaIndex.entries[dsaNum] = readDsa(rcs);
        }
        const computed = rcs.finalizeChecksum();
        const fileChecksum = readU32LE(data, rcs.getOffset());
        rcs.readBytes(4);
        if ((computed >>> 0) !== (fileChecksum >>> 0)) {
            throw new Error('savegame DSA checksum mismatch');
        }
        offset = rcs.getOffset();
    }

    const gameInfo = data.slice(offset, offset + gameInfoSize);
    offset += gameInfoSize;

    if ((flags & EF_FLAGS.LevelDSAInfoPresent) !== 0) {
        dsaLevelIndex = Array.from({ length: 64 }, () => new Array<number>(32).fill(0xffff));
        while (offset + 3 <= data.length) {
            const level = data[offset] ?? 0;
            const selector = data[offset + 1] ?? 0;
            const index = data[offset + 2] ?? 0;
            offset += 3;
            if (level > 63) break;
            if (selector < 32) {
                dsaLevelIndex[level][selector] = index;
            }
        }
    }

    return {
        offset,
        data,
        simpleEncipher: enciphered,
        sequencedTimers: (extendedFlags & EF_EXTENDED_FLAGS.SequencedTimers) !== 0,
        extendedTimers: (extendedFlags & EF_EXTENDED_FLAGS.ExtendedTimers) !== 0,
        extendedWallDecorations: (extendedFlags & EF_EXTENDED_FLAGS.ExtendedWallDecorations) !== 0,
        bigActuators: (flags & EF_FLAGS.BigActuators) !== 0,
        expandedPortraits: (flags & EF_FLAGS.ExpandedPortraits) !== 0,
        indirectText: (flags & EF_FLAGS.IndirectText) !== 0,
        version: header.version,
        cellFlagArraySize: header.cellFlagArraySize,
        objectIndex,
        spellFilterLocation: header.spellFilterLocation,
        dsaLevelIndex,
        dsaIndex,
        header,
        gameInfo,
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
     * The DSAs, which `buildDsaSection` writes when `header.numDSA` is not 0. The header
     * must count them (`countDSAs`).
     */
    dsaIndex?: DsaIndex;
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
    if (header.numDSA !== countDSAs(prefix.dsaIndex)) {
        throw new Error(
            `extended features declare ${header.numDSA} DSAs but carry ${countDSAs(prefix.dsaIndex)}`,
        );
    }
    // `if (efb.numDSA != 0) WriteDSAs(...)` (`doc/CSBwin-src/SaveGame.cpp:989-992`).
    const dsaBlock = header.numDSA !== 0 && prefix.dsaIndex
        ? buildDsaSection(prefix.dsaIndex)
        : new Uint8Array(0);

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
/** The overlay as the Extended Features block carries it (`src/engine/Overlay.ts`). */
export interface SavedOverlay {
    /** `overlayActive`, written as `OverlayActive`. */
    active: boolean;
    overlayOrdinal: number;
    overlayP1: number;
    overlayP2: number;
    overlayP3: number;
    overlayP4: number;
}

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
    /** `invisibleMonsters`, written as `InvisibleMonsters`. */
    invisibleMonsters?: boolean;
    /** `drawAsSize4Monsters`, written as `DrawAsSize4Monsters`. */
    drawAsSize4Monsters?: boolean;
    /** `simpleEncipher`, written as `SimpleEncryption`: the file is enciphered whole. */
    simpleEncipher?: boolean;
    /** `DSAIndex`, whose DSAs `numDSA` counts. */
    dsaIndex?: DsaIndex;
    /** The four `expected…Signature`s, as the last block read gave them. */
    signatures?: ExpectedSignatures;
    /** `hintKey`, as the world's file gave it; absent, eight zeros. */
    hintKey?: Uint8Array;
    /** `overlayActive` and `currentOverlay` (`Overlay.toExtendedFeatures`); absent, none. */
    overlay?: SavedOverlay;
}

/**
 * `expectedGraphicSignature1/2` and `expectedCSBgraphicSignature1/2`, process-wide globals,
 * 0 at start (`doc/CSBwin-src/data.cpp:47-49`). `ReadExtendedFeatures` assigns them from a
 * file's block (`SaveGame.cpp:378-381`) and `SaveGame` writes them back (`:936-939`). It
 * never clears them, where it zeroes `hintKey` before it looks for a block (`:314`), so a
 * file without one leaves them as they were. `Graphics.cpp:1786-1796` and `:1852-1881`
 * check them against the graphics files' own, a comparison that can never fail
 * (`src/engine/FileSignatures.ts`): only `OpenCSBgraphicsFile`'s "Cannot find" reads them.
 */
export interface ExpectedSignatures {
    expectedGraphicSignature1: number;
    expectedGraphicSignature2: number;
    expectedCSBgraphicSignature1: number;
    expectedCSBgraphicSignature2: number;
}

/** The four signatures as they are at start (`doc/CSBwin-src/data.cpp:47-49`). */
export function noExpectedSignatures(): ExpectedSignatures {
    return {
        expectedGraphicSignature1: 0, expectedGraphicSignature2: 0,
        expectedCSBgraphicSignature1: 0, expectedCSBgraphicSignature2: 0,
    };
}

/**
 * `ReadExtendedFeatures`' four signatures (`doc/CSBwin-src/SaveGame.cpp:378-381`), from a
 * file's block. A file with none (`header` undefined) assigns none.
 */
export function readExpectedSignatures(signatures: ExpectedSignatures, header: ExtendedFeaturesBlock | undefined): void {
    if (!header) return;
    signatures.expectedGraphicSignature1 = header.graphicsSignature1;
    signatures.expectedGraphicSignature2 = header.graphicsSignature2;
    signatures.expectedCSBgraphicSignature1 = header.csbGraphicsSignature1;
    signatures.expectedCSBgraphicSignature2 = header.csbGraphicsSignature2;
}

/**
 * `ReadExtendedFeatures`' rule flags and monster design options
 * (`doc/CSBwin-src/SaveGame.cpp:392-400`): `DMRulesDesignOption` from `flags & DMRules`,
 * `DM_rules`, `invisibleMonsters` and `drawAsSize4Monsters` from `extendedFlags`'
 * `DMRulesOption`, `InvisibleMonsters` and `DrawAsSize4Monsters`. A file with no block
 * (`header` undefined) assigns none, as CSBWin, which never reaches that function for it.
 *
 * And `simpleEncipher`, which the function sets for an enciphered file and nothing ever
 * clears (`:333-338`): `enciphered` is `readExtendedFeatures`' `simpleEncipher`.
 */
export function readRulesOptions(
    rules: {
        dmRules: boolean; dmRulesDesignOption: boolean;
        invisibleMonsters: boolean; drawAsSize4Monsters: boolean; simpleEncipher: boolean;
    },
    header: ExtendedFeaturesBlock | undefined,
    enciphered: boolean | undefined,
): void {
    if (!header) return;
    if (enciphered) rules.simpleEncipher = true;
    rules.dmRulesDesignOption = (header.flags & EF_FLAGS.DMRules) !== 0;
    rules.invisibleMonsters = (header.extendedFlags & EF_EXTENDED_FLAGS.InvisibleMonsters) !== 0;
    rules.dmRules = (header.extendedFlags & EF_EXTENDED_FLAGS.DMRulesOption) !== 0;
    rules.drawAsSize4Monsters = (header.extendedFlags & EF_EXTENDED_FLAGS.DrawAsSize4Monsters) !== 0;
}

/**
 * The 512-byte header a running game writes, field for field against `SaveGame`
 * (`doc/CSBwin-src/SaveGame.cpp:915-980`).
 *
 * Nothing here is a guess. Each field is either assigned by that function from something
 * this port holds, or measured to be zero in all eight committed saves and named
 * below as such — `memset(&efb,0,512)` runs first, so a field `SaveGame` never touches
 * is genuinely zero rather than merely unknown.
 *
 * **`flags`.** `SaveGame` sets four unconditionally: `LevelDSAInfoPresent` (`:940`),
 * because it always writes the DSA level index and `ReadExtendedFeatures` only reads it
 * back when the bit is on (`:387-390`); `IndirectText`, `ExpandedPortraits` and
 * `BigActuators` (`:961-963`), which are the shapes of blocks 11-13 and of `CHARDESC`.
 * They must agree with the image actually written, which is what
 * `convertOriginalDungeon` guarantees. `DMRules` is `DMRulesDesignOption` (`:952-953`).
 * `SimpleEncryption` is `simpleEncipher` (`:943-946`), and `saveSaveGameState` then
 * enciphers the whole file (`:914-920`). `AutoRecord` is an option this port does not
 * model and writes off. Measured: every committed save carries 0xe9, the four (0xa9)
 * plus `DMRules`.
 *
 * **`extendedFlags`.** Three unconditional (`:964-966`): `SequencedTimers` and
 * `ExtendedTimers`, which together select the 16-byte `TIMER` this port writes, and
 * `DefaultDirectX`, which is a UI preference CSBWin sets on every save. Plus
 * `ExtendedWallDecorations` from the world, `DMRulesOption` from `DM_rules` (`:950-951`),
 * the monster design options `InvisibleMonsters` and `DrawAsSize4Monsters` from
 * `invisibleMonsters` and `drawAsSize4Monsters` (`:947-948`, `:958-959`), and
 * `OverlayActive` from `overlayActive` (`:968-971`). Measured: 0xf8 in every committed
 * save, which is the three unconditional ones (0xe0) plus the wall decorations and DM
 * rules.
 *
 * **The overlay.** `overlayOrdinal` is `currentOverlay.m_overlayNumber` **plus one**, so 0
 * is "no overlay ever read", and `overlayP1`-`P4` are its `m_p1`-`m_p4` (`:972-976`),
 * `m_p3` the `d.Time` it ends after. All are zero in every committed save.
 *
 * **What a read gave.** `graphicsSignature1/2` and `csbGraphicsSignature1/2` are
 * `expectedGraphicSignature*` (`:936-939`), the last block read's (`ExpectedSignatures`),
 * which `Graphics.cpp:1786-1796` treats as "no expectation" when both halves are zero.
 * `hintKey` is the world's file's (`:941`), `Hint.cpp`'s key, and `hintKey[0] == 0` is
 * its own "no key" test (`doc/CSBwin-src/Hint.cpp:5508`). All five are zero in every
 * committed save.
 *
 * **Zero, and measured zero rather than assumed.** `editingOptions` is never assigned by
 * `SaveGame` at all.
 *
 * **`gameInfoSize` is 0**, meaning `gameInfo == NULL` (`:977-978`) — this port has no
 * game-information string. Note that 0 and -1 are different things here; -1 is an
 * allocated-but-empty one.
 *
 * **`numDSA`** is `countDSAs()` (`:935`), the DSAs `buildExtendedFeaturesPrefix` then
 * writes.
 */
export function buildLiveExtendedFeatures(live: LiveExtendedFeatures): ExtendedFeaturesBlock {
    let flags =
        EF_FLAGS.LevelDSAInfoPresent | EF_FLAGS.IndirectText |
        EF_FLAGS.ExpandedPortraits | EF_FLAGS.BigActuators;
    if (live.dmRulesDesignOption) flags |= EF_FLAGS.DMRules;
    if (live.simpleEncipher) flags |= EF_FLAGS.SimpleEncryption;
    let extendedFlags =
        EF_EXTENDED_FLAGS.SequencedTimers | EF_EXTENDED_FLAGS.ExtendedTimers |
        EF_EXTENDED_FLAGS.DefaultDirectX;
    if (live.invisibleMonsters) extendedFlags |= EF_EXTENDED_FLAGS.InvisibleMonsters;
    if (live.dmRules) extendedFlags |= EF_EXTENDED_FLAGS.DMRulesOption;
    if (live.extendedWallDecorations) extendedFlags |= EF_EXTENDED_FLAGS.ExtendedWallDecorations;
    if (live.drawAsSize4Monsters) extendedFlags |= EF_EXTENDED_FLAGS.DrawAsSize4Monsters;
    if (live.overlay?.active) extendedFlags |= EF_EXTENDED_FLAGS.OverlayActive;

    return {
        version: EF_VERSION_B,
        flags,
        numDSA: countDSAs(live.dsaIndex),
        editingOptions: 0,
        gameInfoSize: 0,
        cellFlagArraySize: live.cellFlagArraySize,
        graphicsSignature1: (live.signatures?.expectedGraphicSignature1 ?? 0) >>> 0,
        graphicsSignature2: (live.signatures?.expectedGraphicSignature2 ?? 0) >>> 0,
        spellFilterLocation: (live.spellFilterLocation ?? 0) >>> 0,
        extendedFlags: extendedFlags >>> 0,
        overlayOrdinal: (live.overlay?.overlayOrdinal ?? 0) >>> 0,
        overlayP1: (live.overlay?.overlayP1 ?? 0) >>> 0,
        overlayP2: (live.overlay?.overlayP2 ?? 0) >>> 0,
        overlayP3: (live.overlay?.overlayP3 ?? 0) >>> 0,
        overlayP4: (live.overlay?.overlayP4 ?? 0) >>> 0,
        csbGraphicsSignature1: (live.signatures?.expectedCSBgraphicSignature1 ?? 0) >>> 0,
        csbGraphicsSignature2: (live.signatures?.expectedCSBgraphicSignature2 ?? 0) >>> 0,
        hintKey: live.hintKey ? live.hintKey.slice(0, 8) : new Uint8Array(8),
    };
}
