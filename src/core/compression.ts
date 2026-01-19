/**
 * Compression algorithms for Dungeon Master data files
 *
 * Based on static/js/pack.js
 * Algorithms verified against CSBWin implementation
 */

import type { ui8, ui16 } from './types';

/**
 * LZW decompression
 *
 * Used in graphics.dat for compressed images.
 * Variable-length codes (9-12 bits) with dictionary reset.
 *
 * Reference: Graphics.cpp in CSBWin
 */
export function LZWexpand(compressedData: Uint8Array): Uint8Array {
    let dataPosition = 0;
    const out: ui8[] = [];

    // Mask to keep only the n rightmost bits
    const rightBits = [0, 1, 3, 7, 15, 31, 63, 127, 255];

    // Dictionary: wordArray stores chain of codes, byteArray stores bytes
    let wordArray = new Array<ui16>(512).fill(0);
    let byteArray = new Array<ui8>(256);
    for (let i = 0; i < 256; i++) byteArray[i] = i;

    let D4: ui16, D7: ui8 = 0;
    let prevCodeWord: ui16 = 0;
    let newCode: ui16;

    const stack: ui8[] = [];

    // Bit position tracking
    let LZWvar1 = 0;
    let LZWBitNumber = 0;
    let ioBuffer: ui8[] = [];

    // Start with 9-bit codes
    let LZWCodeSize = 9;
    let LZWMaxCode = (1 << LZWCodeSize) - 1;
    let LZWNextCode = 257; // Code 256 is reserved for dictionary reset
    let LZWresetDict = false;

    while (true) {
        // Check if we need to read more data or extend dictionary
        if (LZWresetDict || LZWBitNumber >= LZWvar1 || LZWNextCode > LZWMaxCode) {
            // Dictionary extension needed
            if (LZWNextCode > LZWMaxCode) {
                LZWCodeSize++;
                if (LZWCodeSize === 12) {
                    LZWMaxCode = 4096;
                } else {
                    LZWMaxCode = (1 << LZWCodeSize) - 1;
                }
            }

            // Dictionary reset requested
            if (LZWresetDict) {
                LZWCodeSize = 9;
                LZWMaxCode = (1 << LZWCodeSize) - 1;
                LZWresetDict = false;
            }

            // No more data, finished
            if (dataPosition >= compressedData.length) {
                break;
            }

            // Read next chunk
            const remain = compressedData.length - dataPosition;
            const nbToRead = remain < LZWCodeSize ? remain : LZWCodeSize;

            ioBuffer = Array.from(compressedData.subarray(dataPosition, dataPosition + nbToRead));
            dataPosition += nbToRead;

            LZWBitNumber = 0;
            LZWvar1 = (nbToRead << 3) - LZWCodeSize + 1;
        }

        // Read next code from bit stream
        let bitPosition = LZWBitNumber;
        let offset = bitPosition >> 3;
        bitPosition &= 7;

        newCode = ioBuffer[offset];
        offset += 1;
        newCode >>= bitPosition;
        let bitsWeHave = 8 - bitPosition;

        // Read more bytes if needed for full code
        if (LZWCodeSize - bitsWeHave >= 8) {
            newCode |= ioBuffer[offset] << bitsWeHave;
            offset += 1;
            bitsWeHave += 8;
        }

        newCode |= (ioBuffer[offset] & rightBits[LZWCodeSize - bitsWeHave]) << bitsWeHave;
        LZWBitNumber += LZWCodeSize;

        if (newCode === -1) {
            break;
        }

        // First code is always literal
        if (out.length === 0) {
            out.push(newCode);
            prevCodeWord = newCode;
            D7 = newCode;
            continue;
        }

        // Code 256 = dictionary reset
        if (newCode === 256) {
            wordArray.fill(0);
            LZWresetDict = true;
            LZWNextCode = 256;
            continue;
        }

        D4 = newCode;

        // Code not yet in dictionary
        if (newCode >= LZWNextCode) {
            stack.push(D7);
            newCode = prevCodeWord;
        }

        // Decode chain
        while (newCode >= 256) {
            stack.push(byteArray[newCode]);
            newCode = wordArray[newCode];
        }

        D7 = byteArray[newCode];
        stack.push(D7);

        // Output decoded bytes
        while (stack.length > 0) {
            out.push(stack.pop()!);
        }

        // Add new dictionary entry
        if (LZWNextCode < 4096) {
            wordArray[LZWNextCode] = prevCodeWord;
            byteArray[LZWNextCode] = D7;
            LZWNextCode += 1;
        }

        prevCodeWord = D4;
    }

    if (out.length === 0) throw new Error('LZW decompression produced no output');

    return new Uint8Array(out);
}

/**
 * RLE (Run-Length Encoding) expansion
 *
 * Simple RLE format:
 * - [byte][0x90][count] means "repeat [byte] [count] times"
 * - [0x90][0x0] means "literal 0x90"
 *
 * Reference: Graphics.cpp in CSBWin
 */
export function RLEexpand(compressedData: Uint8Array): Uint8Array {
    const out: ui8[] = [];
    let RLErepeatFlag = false;
    let RLErepeatChar: ui8 = 0;

    for (const byte of compressedData) {
        if (!RLErepeatFlag) {
            if (byte === 0x90) {
                // Enter repeat mode
                RLErepeatFlag = true;
            } else {
                // Normal byte
                RLErepeatChar = byte;
                out.push(byte);
            }
        } else {
            // In repeat mode, byte is count
            RLErepeatFlag = false;

            if (byte > 0) {
                // Repeat previous char (count-1) times
                // (we already output it once)
                for (let i = 0; i < byte - 1; i++) {
                    out.push(RLErepeatChar);
                }
            } else {
                // Count=0 means literal 0x90
                out.push(0x90);
            }
        }
    }

    return new Uint8Array(out);
}

/**
 * Sound decompression (nibble-based RLE)
 *
 * Format:
 * - First 2 bytes: size in samples (big-endian)
 * - Data: nibbles (4-bit values)
 *   - Non-zero nibble: sample value * 17
 *   - Zero nibble: repeat last sample N+3 times
 *     (N encoded in following nibbles with continuation bit)
 *
 * Reference: http://dmweb.free.fr/?q=node/220#toc133
 */
export function SNDexpand(compressedData: Uint8Array): Uint8Array {
    const size = (compressedData[0] << 8) | compressedData[1];
    const out: ui8[] = [];

    let offset = 2;
    let odd = false;

    function getNibble(): ui8 {
        const nib = odd
            ? compressedData[offset++] & 0xF
            : compressedData[offset] >> 4;
        odd = !odd;
        return nib;
    }

    let lastSample: ui8 = 0;

    while (offset < compressedData.length) {
        const nib = getNibble();

        if (nib !== 0) {
            // New sample value
            lastSample = nib * 17;
            out.push(lastSample);
        } else {
            // Repeat sequence
            let count = 0;

            while (true) {
                const nib2 = getNibble();
                count <<= 3;
                count += nib2 & 0x7;

                // Bit 3 is continuation flag
                if ((nib2 & 0x8) === 0) {
                    break;
                }
            }

            count += 3; // Minimum repeat is 3

            for (let i = 0; i < count; i++) {
                out.push(lastSample);
            }
        }
    }

    // Truncate to expected size (sometimes 1-2 samples off)
    const result = out.slice(0, size);

    return new Uint8Array(result);
}

/**
 * Check if data is LZW+RLE compressed
 * (based on size mismatch in graphics.dat)
 */
export function isCompressed(compressedSize: ui16, decompressedSize: ui16): boolean {
    return compressedSize !== decompressedSize;
}

/**
 * Decompress graphics data (LZW + RLE)
 *
 * If compressedSize !== decompressedSize, applies LZW then RLE.
 * Otherwise returns original data.
 */
export function decompressGraphics(
    data: Uint8Array,
    compressedSize: ui16,
    decompressedSize: ui16
): Uint8Array {
    if (!isCompressed(compressedSize, decompressedSize)) return data;

    const lzwExpanded = LZWexpand(data);
    const rleExpanded = RLEexpand(lzwExpanded);

    if (rleExpanded.length !== decompressedSize) {
        throw new Error(`Decompression size mismatch: expected ${decompressedSize}, got ${rleExpanded.length}`);
    }

    return rleExpanded;
}
