/**
 * Reads and writes on a byte buffer: free ones at an offset, where a read past the end
 * yields 0, and a {@link ByteCursor} for a file read front to back, where it throws.
 *
 * The game files and the save blocks are big-endian (Atari heritage); the little-endian
 * ones are for the PC-era additions — CSB's graphics.dat sections and a save's
 * "Extended Features" header.
 */

export function readU8(buf: Uint8Array, off: number): number {
  return buf[off] ?? 0;
}

export function readI8(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 24) >> 24;
}

export function readU16BE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}

export function readI16BE(buf: Uint8Array, off: number): number {
  return (readU16BE(buf, off) << 16) >> 16;
}

export function readI32BE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 24) | ((buf[off + 1] ?? 0) << 16) | ((buf[off + 2] ?? 0) << 8) | (buf[off + 3] ?? 0);
}

export function readU32BE(buf: Uint8Array, off: number): number {
  return readI32BE(buf, off) >>> 0;
}

/** `count` signed big-endian words from `off`. */
export function readI16BEArray(buf: Uint8Array, off: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(readI16BE(buf, off + i * 2));
  return out;
}

export function readU16LE(buf: Uint8Array, off: number): number {
  return (buf[off] ?? 0) | ((buf[off + 1] ?? 0) << 8);
}

export function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) | ((buf[off + 1] ?? 0) << 8) | ((buf[off + 2] ?? 0) << 16) | ((buf[off + 3] ?? 0) << 24)) >>> 0;
}

export function writeU16BE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >> 8) & 0xff;
  buf[off + 1] = value & 0xff;
}

export function writeU32BE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 24) & 0xff;
  buf[off + 1] = (value >>> 16) & 0xff;
  buf[off + 2] = (value >>> 8) & 0xff;
  buf[off + 3] = value & 0xff;
}

export function writeU16LE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
}

export function writeU32LE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >>> 8) & 0xff;
  buf[off + 2] = (value >>> 16) & 0xff;
  buf[off + 3] = (value >>> 24) & 0xff;
}

/**
 * A read head over a big-endian file, `dungeon.dat`'s and `graphics.dat`'s. A seek or a
 * read past the end throws.
 */
export class ByteCursor {
  private at = 0;

  constructor(readonly bytes: Uint8Array) {}

  seek(position: number): void {
    if (position < 0 || position > this.bytes.length) throw new Error(`Invalid seek position: ${position}`);
    this.at = position;
  }

  readU8(): number {
    this.need(1);
    return this.bytes[this.at++]!;
  }

  readU16(): number {
    this.need(2);
    const value = readU16BE(this.bytes, this.at);
    this.at += 2;
    return value;
  }

  /** `length` bytes from `position`, the head left where it is. */
  read(position: number, length: number): Uint8Array {
    if (position < 0 || position + length > this.bytes.length) {
      throw new Error(`Invalid read: position ${position}, length ${length}, file size ${this.bytes.length}`);
    }
    return this.bytes.subarray(position, position + length);
  }

  private need(bytes: number): void {
    if (this.at + bytes > this.bytes.length) {
      throw new Error(
        `Read past end of file: position ${this.at}, ` +
        `need ${bytes} bytes, only ${this.bytes.length - this.at} available`
      );
    }
  }
}
