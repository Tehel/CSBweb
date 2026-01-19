/**
 * Minimal save-game loader focused on Item16 and timer tables.
 *
 * This follows CSBWin `ReadUnscrambleBlock` and `UnscrambleStream` logic
 * and expects the standard (non-extended-features) save-game layout.
 */

import type { DungeonData, Item16Record, TimerRecord } from './dungeonTypes';

export interface SaveGameState {
  item16: Item16Record[];
  timers: TimerRecord[];
  maxItem16: number;
  maxTimers: number;
  sequencedTimers: boolean;
  extendedTimers: boolean;
  dsaLevelIndex?: number[][];
  extendedWallDecorations?: boolean;
}

interface Block1 {
  block2Hash: number;
  item16Hash: number;
  characterHash: number;
  timersHash: number;
  timerQueueHash: number;
  block2Checksum: number;
  item16Checksum: number;
  characterChecksum: number;
  timersChecksum: number;
  timerQueueChecksum: number;
}

interface Block2 {
  maxTimers: number;
  maxItem16: number;
}

const BLOCK1_SIZE = 512;
const BLOCK2_SIZE = 128;
const CHARACTER_SIZE = 3328;
const EXTENDED_FEATURES_SIZE = 512;
const EXTENDED_SENTINEL = ' Extended Features ';

function readU16LE(buf: Uint8Array, off: number): number {
  const lo = buf[off] ?? 0;
  const hi = buf[off + 1] ?? 0;
  return lo | (hi << 8);
}

function readU32LE(buf: Uint8Array, off: number): number {
  const b0 = buf[off] ?? 0;
  const b1 = buf[off + 1] ?? 0;
  const b2 = buf[off + 2] ?? 0;
  const b3 = buf[off + 3] ?? 0;
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

function rc4Simple(buf: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length);
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  let i = 0;
  j = 0;
  for (let k = 0; k < buf.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    const idx = (s[i] + s[j]) & 0xff;
    out[k] = buf[k] ^ s[idx];
  }
  return out;
}

function hasExtendedSentinel(buf: Uint8Array): boolean {
  if (buf.length < EXTENDED_SENTINEL.length) return false;
  for (let i = 0; i < EXTENDED_SENTINEL.length; i++) {
    if (buf[i] !== EXTENDED_SENTINEL.charCodeAt(i)) return false;
  }
  return true;
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
      this.checksum = (this.checksum * 0xbb40e62d + 11 + buf[i]) >>> 0;
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

function skipDSA(rcs: RcsReader): void {
  rcs.readBytes(80); // description
  rcs.readU16(); // m_state
  rcs.readU8(); // m_localState
  rcs.readU8(); // m_groupID
  const numStates = rcs.readU32();
  rcs.readU32(); // m_firstDisplayedState
  const numNonEmptyStates = rcs.readU32();

  for (let i = 0; i < numNonEmptyStates; i++) {
    const stateNum = rcs.readU32();
    if (stateNum >= numStates) throw new Error('savegame DSA state out of range');
    const numActions = rcs.readU32();
    for (let j = 0; j < numActions; j++) {
      rcs.readU32(); // column
      const numPgmWords = rcs.readU32();
      if (numPgmWords > 0) {
        rcs.readBytes(numPgmWords * 2);
      }
    }
  }
}

function readExtendedFeatures(data: Uint8Array): {
  offset: number;
  sequencedTimers: boolean;
  extendedTimers: boolean;
  extendedWallDecorations: boolean;
  dsaLevelIndex?: number[][];
} {
  if (data.length < EXTENDED_FEATURES_SIZE) {
    return { offset: 0, sequencedTimers: false, extendedTimers: false, extendedWallDecorations: false };
  }

  let block = data.subarray(0, EXTENDED_FEATURES_SIZE);
  let parsed = block;

  if (!hasExtendedSentinel(block)) {
    const decoded = rc4Simple(block, new Uint8Array([1, 0]));
    if (hasExtendedSentinel(decoded)) {
      parsed = decoded;
    } else {
      return { offset: 0, sequencedTimers: false, extendedTimers: false, extendedWallDecorations: false };
    }
  }

  const dataMapLength = readU32LE(parsed, 20);
  const flags = parsed[37] ?? 0;
  const numDSA = readU16LE(parsed, 38);
  const gameInfoSize = readU32LE(parsed, 44);
  const extendedFlags = readU32LE(parsed, 64);

  const sequencedTimers = (extendedFlags & 0x20) !== 0;
  const extendedTimers = (extendedFlags & 0x80) !== 0;
  const extendedWallDecorations = (extendedFlags & 0x10) !== 0;

  let offset = EXTENDED_FEATURES_SIZE + dataMapLength + dataMapLength * 2;

  let dsaLevelIndex: number[][] | undefined;

  if (numDSA > 0) {
    const rcs = new RcsReader(data, offset);
    rcs.resetChecksum();
    for (let i = 0; i < numDSA; i++) {
      rcs.readU32(); // dsaNum
      skipDSA(rcs);
    }
    const computed = rcs.finalizeChecksum();
    const fileChecksum = readU32LE(data, rcs.getOffset());
    rcs.readBytes(4);
    if ((computed >>> 0) !== (fileChecksum >>> 0)) {
      throw new Error('savegame DSA checksum mismatch');
    }
    offset = rcs.getOffset();
  }

  offset += gameInfoSize;

  if ((flags & 0x01) !== 0) {
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

  return { offset, sequencedTimers, extendedTimers, extendedWallDecorations, dsaLevelIndex };
}
function unscramble(buf: Uint8Array, initialHash: number, numWords: number): number {
  let d7 = initialHash & 0xffff;
  let d6 = numWords & 0xffff;
  let d5 = initialHash & 0xffff;
  let off = 0;
  while (d6 !== 0) {
    const word = readU16LE(buf, off);
    d5 = (d5 + word) & 0xffff;
    const xored = word ^ d7;
    buf[off] = xored & 0xff;
    buf[off + 1] = (xored >> 8) & 0xff;
    d5 = (d5 + xored) & 0xffff;
    off += 2;
    d7 = (d7 + d6) & 0xffff;
    d6 = (d6 - 1) & 0xffff;
  }
  return d5 & 0xffff;
}

function readUnscrambleBlock(data: Uint8Array, offset: number): { buf: Uint8Array; next: number } {
  const end = offset + BLOCK1_SIZE;
  if (end > data.length) throw new Error('savegame block1 truncated');
  const buf = data.slice(offset, end);

  let d6 = 0;
  let pos = 0;
  for (let i = 0; i < 32; i++) {
    d6 = (d6 + readU16LE(buf, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16LE(buf, pos);
    pos += 2;
    d6 = (d6 - readU16LE(buf, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16LE(buf, pos);
    pos += 2;
  }

  const hash = readU16LE(buf, 58);
  unscramble(buf.subarray(256), hash, 128);

  let d5 = 0;
  pos = 256;
  for (let i = 0; i < 128; i++) {
    d5 = (d5 + readU16LE(buf, pos)) & 0xffff;
    pos += 2;
  }

  if ((d6 & 0xffff) !== (d5 & 0xffff)) {
    throw new Error('savegame block1 checksum mismatch');
  }

  return { buf, next: end };
}

function unscrambleStream(
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

function parseBlock1(buf: Uint8Array): Block1 {
  return {
    block2Hash: readU16LE(buf, 312),
    item16Hash: readU16LE(buf, 314),
    characterHash: readU16LE(buf, 316),
    timersHash: readU16LE(buf, 318),
    timerQueueHash: readU16LE(buf, 320),
    block2Checksum: readU16LE(buf, 344),
    item16Checksum: readU16LE(buf, 346),
    characterChecksum: readU16LE(buf, 348),
    timersChecksum: readU16LE(buf, 350),
    timerQueueChecksum: readU16LE(buf, 352),
  };
}

function parseBlock2(buf: Uint8Array): Block2 {
  return {
    maxTimers: readU16LE(buf, 28),
    maxItem16: readU16LE(buf, 46),
  };
}

function parseItem16(buf: Uint8Array, maxItem16: number): Item16Record[] {
  const out: Item16Record[] = [];
  for (let i = 0; i < maxItem16; i++) {
    const base = i * 16;
    out.push({
      facings: buf[base + 2] ?? 0,
      positions: buf[base + 3] ?? 0,
      singleMonsterStatus: [
        buf[base + 12] ?? 0,
        buf[base + 13] ?? 0,
        buf[base + 14] ?? 0,
        buf[base + 15] ?? 0,
      ],
    });
  }
  return out;
}

function parseTimers(buf: Uint8Array, maxTimers: number, timerSize: number): TimerRecord[] {
  const out: TimerRecord[] = [];
  for (let i = 0; i < maxTimers; i++) {
    const base = i * timerSize;
    out.push({
      timerWord8: readU16LE(buf, base + 8),
    });
  }
  return out;
}

export function loadSaveGameState(saveData: Uint8Array): SaveGameState {
  const extended = readExtendedFeatures(saveData);
  let offset = extended.offset;
  const { buf: block1Buf, next: afterBlock1 } = readUnscrambleBlock(saveData, offset);
  offset = afterBlock1;

  const block1 = parseBlock1(block1Buf);

  const { buf: block2Buf, next: afterBlock2 } = unscrambleStream(
    saveData,
    offset,
    BLOCK2_SIZE,
    block1.block2Hash,
    block1.block2Checksum
  );
  offset = afterBlock2;

  const block2 = parseBlock2(block2Buf);

  let item16: Item16Record[] = [];
  if (block2.maxItem16 > 0) {
    const { buf, next } = unscrambleStream(
      saveData,
      offset,
      block2.maxItem16 * 16,
      block1.item16Hash,
      block1.item16Checksum
    );
    offset = next;
    item16 = parseItem16(buf, block2.maxItem16);
  }

  if (block2.maxItem16 === 0) {
    offset = offset;
  }

  const { next: afterCharacters } = unscrambleStream(
    saveData,
    offset,
    CHARACTER_SIZE,
    block1.characterHash,
    block1.characterChecksum
  );
  offset = afterCharacters;

  const sequencedTimers = extended.sequencedTimers;
  const extendedTimers = extended.extendedTimers;
  const timerSize = extendedTimers ? 16 : sequencedTimers ? 12 : 10;

  const { buf: timersBuf, next: afterTimers } = unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * timerSize,
    block1.timersHash,
    block1.timersChecksum
  );
  offset = afterTimers;

  const timers = parseTimers(timersBuf, block2.maxTimers, timerSize);

  unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * 2,
    block1.timerQueueHash,
    block1.timerQueueChecksum
  );

  return {
    item16,
    timers,
    maxItem16: block2.maxItem16,
    maxTimers: block2.maxTimers,
    sequencedTimers,
    extendedTimers,
    dsaLevelIndex: extended.dsaLevelIndex,
    extendedWallDecorations: extended.extendedWallDecorations,
  };
}

export function applySaveGameState(dungeon: DungeonData, save: SaveGameState): void {
  dungeon.item16 = save.item16;
  dungeon.timers = save.timers;
  if (save.dsaLevelIndex) {
    dungeon.dsaLevelIndex = save.dsaLevelIndex;
  }
  if (save.extendedWallDecorations !== undefined) {
    dungeon.extendedWallDecorations = save.extendedWallDecorations;
  }
}
