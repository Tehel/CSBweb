/**
 * Binary file reader with support for big-endian data
 *
 * All game data is big-endian (Atari ST heritage).
 * - Error checking
 */

import type { i8, ui8, i16, ui16, i32, ui32 } from './types';

export enum Endianness {
    BIG_ENDIAN,    // Atari ST, Amiga, Mac
    LITTLE_ENDIAN  // PC, Apple IIGS
}

/**
 * Binary file reader
 * Defaults to big-endian (Atari ST format) as per CSBWin
 */
export class BinaryFile {
    private data: Uint8Array | null = null;
    private pos: number = 0;
    private endianness: Endianness;

    constructor(endianness: Endianness = Endianness.BIG_ENDIAN) {
        this.endianness = endianness;
    }

    /**
     * Load file from URL
     */
    async load(url: string): Promise<void> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            this.data = new Uint8Array(arrayBuffer);
            this.pos = 0;
        } catch (error) {
            throw new Error(`Failed to load file ${url}: ${error}`);
        }
    }

    /**
     * Load from Uint8Array (for testing or pre-loaded data)
     */
    loadFromArray(data: Uint8Array): void {
        this.data = data;
        this.pos = 0;
    }

    /**
     * Get file length
     */
    length(): number {
        if (!this.data) {
            throw new Error('No data loaded');
        }
        return this.data.length;
    }

    /**
     * Get current position
     */
    tell(): number {
        return this.pos;
    }

    /**
     * Seek to absolute position
     */
    seek(position: number): void {
        if (position < 0 || (this.data && position > this.data.length)) {
            throw new Error(`Invalid seek position: ${position}`);
        }
        this.pos = position;
    }

    /**
     * Skip bytes (relative seek)
     */
    skip(bytes: number): void {
        this.seek(this.pos + bytes);
    }

    /** The data, once it is checked to hold `bytes` more bytes from the read head. */
    private checkAvailable(bytes: number): Uint8Array {
        if (!this.data) {
            throw new Error('No data loaded');
        }
        if (this.pos + bytes > this.data.length) {
            throw new Error(
                `Read past end of file: position ${this.pos}, ` +
                `need ${bytes} bytes, only ${this.data.length - this.pos} available`
            );
        }
        return this.data;
    }

    read(position: number, length: number): Uint8Array {
        if (!this.data) throw new Error('No data loaded');
        if (position < 0 || position + length > this.data.length) {
            throw new Error(`Invalid read: position ${position}, length ${length}, file size ${this.data.length}`);
        }
        return this.data.subarray(position, position + length);
    }

    readU8(position?: number): ui8 {
        if (position !== undefined) {
            this.seek(position);
        }
        const value = this.checkAvailable(1)[this.pos]!;
        this.pos += 1;
        return value;
    }

    readU16(position?: number): ui16 {
        if (position !== undefined) {
            this.seek(position);
        }
        const d = this.checkAvailable(2);

        let value: ui16;
        if (this.endianness === Endianness.BIG_ENDIAN) {
            value = (d[this.pos]! << 8) | d[this.pos + 1]!;
        } else {
            value = d[this.pos]! | (d[this.pos + 1]! << 8);
        }

        this.pos += 2;
        return value;
    }

    readU32(position?: number): ui32 {
        if (position !== undefined) {
            this.seek(position);
        }
        const d = this.checkAvailable(4);

        let value: ui32;
        if (this.endianness === Endianness.BIG_ENDIAN) {
            value = (d[this.pos]! << 24) |
                    (d[this.pos + 1]! << 16) |
                    (d[this.pos + 2]! << 8) |
                    d[this.pos + 3]!;
        } else {
            value = d[this.pos]! |
                    (d[this.pos + 1]! << 8) |
                    (d[this.pos + 2]! << 16) |
                    (d[this.pos + 3]! << 24);
        }

        this.pos += 4;
        return value >>> 0; // Ensure unsigned
    }

    /**
     * A little-endian 32-bit word at `position`, without moving the read head or
     * touching `endianness`.
     *
     * The one place this is needed is the indirect-text block of a CSBWin save, which
     * is little-endian inside an otherwise big-endian image: its swap helper is a no-op
     * on the shipping build, exactly like the Extended Features header
     * (`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file").
     */
    peekU32LE(position: number): ui32 {
        const d = this.data;
        if (!d || position < 0 || position + 4 > d.length) {
            throw new Error(`peekU32LE out of range at ${position}`);
        }
        return (d[position]! | (d[position + 1]! << 8) | (d[position + 2]! << 16) | (d[position + 3]! << 24)) >>> 0;
    }

    readI8(position?: number): i8 {
        const value = this.readU8(position);
        return value > 127 ? value - 256 : value;
    }

    readI16(position?: number): i16 {
        const value = this.readU16(position);
        return value > 32767 ? value - 65536 : value;
    }

    readI32(position?: number): i32 {
        return this.readU32(position) | 0; // Convert to signed
    }

    // Peek at next byte without advancing position
    peek(): ui8 { return this.checkAvailable(1)[this.pos]!; }
    eof(): boolean { return this.data ? this.pos >= this.data.length : true; }
    remaining(): number { return this.data ? this.data.length - this.pos : 0; }
    setEndianness(endianness: Endianness): void { this.endianness = endianness; }
    getEndianness(): Endianness { return this.endianness; }
}

// Convenience aliases matching CSBWin and original JS naming
