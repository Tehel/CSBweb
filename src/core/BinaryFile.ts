/**
 * Binary file reader with support for big-endian data
 *
 * Based on static/js/file.js but with:
 * - TypeScript types
 * - Modern fetch API
 * - Explicit endianness handling
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

    /**
     * Check if we have enough bytes available
     */
    private checkAvailable(bytes: number): void {
        if (!this.data) {
            throw new Error('No data loaded');
        }
        if (this.pos + bytes > this.data.length) {
            throw new Error(
                `Read past end of file: position ${this.pos}, ` +
                `need ${bytes} bytes, only ${this.data.length - this.pos} available`
            );
        }
    }

    /**
     * Read bytes into a new Uint8Array
     * Can be called as:
     * - read(length) - read from current position
     * - read(position, length) - read from specific position
     */
    read(positionOrLength: number, length?: number): Uint8Array {
        const startPos = length !== undefined ? positionOrLength : this.pos;
        const numBytes = length !== undefined ? length : positionOrLength;

        if (!this.data) {
            throw new Error('No data loaded');
        }

        if (startPos < 0 || startPos + numBytes > this.data.length) {
            throw new Error(
                `Invalid read: position ${startPos}, length ${numBytes}, ` +
                `file size ${this.data.length}`
            );
        }

        const result = this.data.subarray(startPos, startPos + numBytes);

        // Only advance position if reading from current position
        if (length === undefined) {
            this.pos += numBytes;
        }

        return result;
    }

    /**
     * Read unsigned 8-bit integer
     */
    readU8(position?: number): ui8 {
        if (position !== undefined) {
            this.seek(position);
        }
        this.checkAvailable(1);
        const value = this.data![this.pos];
        this.pos += 1;
        return value;
    }

    /**
     * Read signed 8-bit integer
     */
    readI8(position?: number): i8 {
        const value = this.readU8(position);
        return value > 127 ? value - 256 : value;
    }

    /**
     * Read unsigned 16-bit integer
     */
    readU16(position?: number): ui16 {
        if (position !== undefined) {
            this.seek(position);
        }
        this.checkAvailable(2);

        let value: ui16;
        if (this.endianness === Endianness.BIG_ENDIAN) {
            value = (this.data![this.pos] << 8) | this.data![this.pos + 1];
        } else {
            value = this.data![this.pos] | (this.data![this.pos + 1] << 8);
        }

        this.pos += 2;
        return value;
    }

    /**
     * Read signed 16-bit integer
     */
    readI16(position?: number): i16 {
        const value = this.readU16(position);
        return value > 32767 ? value - 65536 : value;
    }

    /**
     * Read unsigned 32-bit integer
     */
    readU32(position?: number): ui32 {
        if (position !== undefined) {
            this.seek(position);
        }
        this.checkAvailable(4);

        let value: ui32;
        if (this.endianness === Endianness.BIG_ENDIAN) {
            value = (this.data![this.pos] << 24) |
                    (this.data![this.pos + 1] << 16) |
                    (this.data![this.pos + 2] << 8) |
                    this.data![this.pos + 3];
        } else {
            value = this.data![this.pos] |
                    (this.data![this.pos + 1] << 8) |
                    (this.data![this.pos + 2] << 16) |
                    (this.data![this.pos + 3] << 24);
        }

        this.pos += 4;
        return value >>> 0; // Ensure unsigned
    }

    /**
     * Read signed 32-bit integer
     */
    readI32(position?: number): i32 {
        return this.readU32(position) | 0; // Convert to signed
    }

    /**
     * Peek at next byte without advancing position
     */
    peek(): ui8 {
        this.checkAvailable(1);
        return this.data![this.pos];
    }

    /**
     * Check if at end of file
     */
    eof(): boolean {
        return this.data ? this.pos >= this.data.length : true;
    }

    /**
     * Get remaining bytes
     */
    remaining(): number {
        return this.data ? this.data.length - this.pos : 0;
    }

    /**
     * Set endianness
     */
    setEndianness(endianness: Endianness): void {
        this.endianness = endianness;
    }

    /**
     * Get endianness
     */
    getEndianness(): Endianness {
        return this.endianness;
    }
}

/**
 * Convenience aliases matching CSBWin and original JS naming
 */
export class RemoteBinaryFile extends BinaryFile {
    async get(url: string): Promise<void> {
        return this.load(url);
    }

    read8(position?: number): ui8 {
        return this.readU8(position);
    }

    read16(position?: number): ui16 {
        return this.readU16(position);
    }

    read32(position?: number): ui32 {
        return this.readU32(position);
    }
}
