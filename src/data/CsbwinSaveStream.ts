/**
 * What blocks 1 to 6 of a CSBWin save are wrapped in: each is XORed word by word with a
 * running hash and carries a checksum, and `GAMEBLOCK1` holds the hashes and checksums
 * of the other five (`doc/CSBWIN_SAVEGAME_REFERENCE.md`). Nothing here knows a block's
 * fields: those are `SaveFile.ts`'s.
 *
 * Every word is big-endian, as CSBWin's `LE16()` reads it on the little-endian build
 * (`doc/CSBwin-src/CSBTypes.h:151`).
 */
import { readU16BE, writeU16BE } from '../core/bytes';

/** `sizeof(GAMEBLOCK1)`: 256 bytes of fold and 256 scrambled. */
export const BLOCK1_SIZE = 512;

/** `GenChecksum` (`doc/CSBwin-src/SaveGame.cpp:650-664`). */
export function genChecksum(buf: Uint8Array, initialHash: number, numWords: number): number {
    let result = initialHash & 0xffff;
    let hash = initialHash & 0xffff;
    let count = numWords & 0xffff;
    let off = 0;
    while (count !== 0) {
        const word = readU16BE(buf, off);
        result = (result + word) & 0xffff;
        result = (result + (word ^ hash)) & 0xffff;
        hash = (hash + count) & 0xffff;
        off += 2;
        count = (count - 1) & 0xffff;
    }
    return result & 0xffff;
}

/**
 * A block scrambled in place, as `WriteScrambled` scrambles it before the write
 * (`doc/CSBwin-src/SaveGame.cpp:670-685`).
 */
export function scramble(buf: Uint8Array, initialHash: number, numWords: number): number {
    let d7 = initialHash & 0xffff;
    let d6 = numWords & 0xffff;
    let d5 = initialHash & 0xffff;
    let off = 0;
    while (d6 !== 0) {
        const plain = readU16BE(buf, off);
        const word = plain ^ d7;
        d5 = (d5 + word) & 0xffff;
        buf[off] = (word >> 8) & 0xff;
        buf[off + 1] = word & 0xff;
        d5 = (d5 + plain) & 0xffff;
        off += 2;
        d7 = (d7 + d6) & 0xffff;
        d6 = (d6 - 1) & 0xffff;
    }
    return d5 & 0xffff;
}

/** `Unscramble` (`doc/CSBwin-src/CSBCode.cpp:9152-9172`), in place; the block's checksum. */
function unscramble(buf: Uint8Array, initialHash: number, numWords: number): number {
    let d7 = initialHash & 0xffff;
    let d6 = numWords & 0xffff;
    let d5 = initialHash & 0xffff;
    let off = 0;
    while (d6 !== 0) {
        const word = readU16BE(buf, off);
        d5 = (d5 + word) & 0xffff;
        const xored = word ^ d7;
        buf[off] = (xored >> 8) & 0xff;
        buf[off + 1] = xored & 0xff;
        d5 = (d5 + xored) & 0xffff;
        off += 2;
        d7 = (d7 + d6) & 0xffff;
        d6 = (d6 - 1) & 0xffff;
    }
    return d5 & 0xffff;
}

/**
 * `GAMEBLOCK1`'s first half folded as `ReadUnscrambleBlock` folds it, its 128 words by
 * turns of add, xor, subtract and xor (`doc/CSBwin-src/CSBCode.cpp:9272-9301`).
 */
function foldBlock1(buf: Uint8Array): number {
    let d6 = 0;
    let pos = 0;
    for (let i = 0; i < 32; i++) {
        d6 = (d6 + readU16BE(buf, pos)) & 0xffff;
        pos += 2;
        d6 ^= readU16BE(buf, pos);
        pos += 2;
        d6 = (d6 - readU16BE(buf, pos)) & 0xffff;
        pos += 2;
        d6 ^= readU16BE(buf, pos);
        pos += 2;
    }
    return d6 & 0xffff;
}

/** The sum of `GAMEBLOCK1`'s second half, plain, word by word: what the fold must end at. */
function sumBlock1(buf: Uint8Array): number {
    let d5 = 0;
    for (let pos = 256; pos < BLOCK1_SIZE; pos += 2) d5 = (d5 + readU16BE(buf, pos)) & 0xffff;
    return d5;
}

/** `ReadUnscrambleBlock` (`doc/CSBwin-src/CSBCode.cpp:9272-9301`): `GAMEBLOCK1`, checked and plain. */
export function readUnscrambleBlock(data: Uint8Array, offset: number): { buf: Uint8Array; next: number } {
    const end = offset + BLOCK1_SIZE;
    if (end > data.length) throw new Error('savegame block1 truncated');
    const buf = data.slice(offset, end);

    const d6 = foldBlock1(buf);

    const hash = readU16BE(buf, 58);
    unscramble(buf.subarray(256), hash, 128);

    if (d6 !== sumBlock1(buf)) {
        throw new Error('savegame block1 checksum mismatch');
    }

    return { buf, next: end };
}

/**
 * `GAMEBLOCK1` as `readUnscrambleBlock` gives it, put back as its file holds it, in
 * place, once a field of its second half has been written. Word 127 takes what makes
 * the fold of the first half end at the second half's new sum, and the second half is
 * scrambled again with word 29.
 *
 * The other 127 words of the first half stay the file's own, where `scrambleAndWrite`
 * zeroes them: this rewrites a file, and changes of it only what the field changed.
 */
export function rescrambleBlock1(block1: Uint8Array): void {
    writeU16BE(block1, 254, 0);
    // The fold ends on an xor with word 127, so with that word 0 it is the fold of the rest.
    writeU16BE(block1, 254, sumBlock1(block1) ^ foldBlock1(block1));
    scramble(block1.subarray(256), readU16BE(block1, 58), 128);
}

/** `UnscrambleStream` (`doc/CSBwin-src/CSBCode.cpp:9175-9184`): one of blocks 2 to 6, checked and plain. */
export function unscrambleStream(
    data: Uint8Array,
    offset: number,
    size: number,
    initialHash: number,
    checksum: number
): { buf: Uint8Array; next: number } {
    const end = offset + size;
    if (end > data.length) throw new Error('savegame stream truncated');
    const buf = data.slice(offset, end);
    const computed = unscramble(buf, initialHash, size / 2);
    if (computed !== (checksum & 0xffff)) {
        throw new Error('savegame stream checksum mismatch');
    }
    return { buf, next: end };
}

/**
 * `ScrambleAndWrite` (`doc/CSBwin-src/SaveGame.cpp:714-759`), over `GAMEBLOCK1` in place:
 * `D5` sums the second half's words, the first 127 words are zeroed and folded into `D6`
 * by turns of add, xor, subtract and xor, and word 127 is `D5 ^ D6`, so the reader's
 * fold over all 128 words ends at `D5`. The second half is then scrambled with word 29
 * as its hash.
 */
export function scrambleAndWrite(block1Plain: Uint8Array): void {
    let d5 = 0;
    for (let i = 256; i < BLOCK1_SIZE; i += 2) d5 = (d5 + readU16BE(block1Plain, i)) & 0xffff;
    let d6 = 0;
    let pos = 0;
    for (let d7 = 32; ; ) {
        writeU16BE(block1Plain, pos, 0);
        d6 = (d6 + readU16BE(block1Plain, pos)) & 0xffff;
        pos += 2;
        writeU16BE(block1Plain, pos, 0);
        d6 ^= readU16BE(block1Plain, pos);
        pos += 2;
        writeU16BE(block1Plain, pos, 0);
        d6 = (d6 - readU16BE(block1Plain, pos)) & 0xffff;
        pos += 2;
        d7--;
        if (d7 !== 0) {
            writeU16BE(block1Plain, pos, 0);
            d6 ^= readU16BE(block1Plain, pos);
            pos += 2;
            continue;
        }
        writeU16BE(block1Plain, pos, d5 ^ d6);
        break;
    }
    scramble(block1Plain.subarray(256), readU16BE(block1Plain, 58), 128);
}
