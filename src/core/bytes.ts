/**
 * Free-standing reads and writes on a byte buffer, for code that indexes a `Uint8Array`
 * directly rather than walking it with a {@link BinaryFile} cursor. A read past the end
 * yields 0.
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
