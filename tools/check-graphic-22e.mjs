#!/usr/bin/env node
/**
 * Quick sanity check that we can extract CSBWin "graphic 0x22e" (index 558)
 * from `static/gamefiles/graphics.dat` and that it contains plausible viewport
 * rectangle records.
 *
 * This does NOT attempt to fully parse the CSBWin DATA layout. It:
 * - reads the entry table from graphics.dat
 * - extracts and (if needed) decompresses entry 0x22e using LZW then RLE
 * - scans the decompressed blob for a plausible 14×RectPos wallRectangles block
 *
 * Run: `node tools/check-graphic-22e.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

const GRAPHICS_DAT = path.resolve('static/gamefiles/graphics.dat');
const INDEX_22E = 0x22e; // 558

function be16(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

function parseGraphicsHeader(fileBuf) {
  const itemCount = be16(fileBuf, 0);
  const compSizesOff = 2;
  const decompSizesOff = 2 + itemCount * 2;
  const dataStart = 2 + itemCount * 4;

  const compressedSizes = new Uint16Array(itemCount);
  const decompressedSizes = new Uint16Array(itemCount);

  for (let i = 0; i < itemCount; i++) {
    compressedSizes[i] = be16(fileBuf, compSizesOff + i * 2);
    decompressedSizes[i] = be16(fileBuf, decompSizesOff + i * 2);
  }

  return { itemCount, compressedSizes, decompressedSizes, dataStart };
}

function computeEntryOffset(dataStart, compressedSizes, index) {
  let off = dataStart;
  for (let i = 0; i < index; i++) off += compressedSizes[i];
  return off;
}

// Ported from src/core/compression.ts (LZWexpand) with minimal changes.
function lzwExpand(compressedData) {
  let dataPosition = 0;
  const out = [];
  const rightBits = [0, 1, 3, 7, 15, 31, 63, 127, 255];

  const wordArray = new Array(512).fill(0);
  const byteArray = new Array(4096).fill(0);
  for (let i = 0; i < 256; i++) byteArray[i] = i;

  let D4;
  let D7 = 0;
  let prevCodeWord = 0;
  let newCode;
  const stack = [];

  let LZWvar1 = 0;
  let LZWBitNumber = 0;
  let ioBuffer = [];

  let LZWCodeSize = 9;
  let LZWMaxCode = (1 << LZWCodeSize) - 1;
  let LZWNextCode = 257;
  let LZWresetDict = false;

  while (true) {
    if (LZWresetDict || LZWBitNumber >= LZWvar1 || LZWNextCode > LZWMaxCode) {
      if (LZWNextCode > LZWMaxCode) {
        LZWCodeSize++;
        if (LZWCodeSize === 12) LZWMaxCode = 4096;
        else LZWMaxCode = (1 << LZWCodeSize) - 1;
      }

      if (LZWresetDict) {
        LZWCodeSize = 9;
        LZWMaxCode = (1 << LZWCodeSize) - 1;
        LZWresetDict = false;
      }

      if (dataPosition >= compressedData.length) break;

      const remain = compressedData.length - dataPosition;
      const nbToRead = remain < LZWCodeSize ? remain : LZWCodeSize;
      ioBuffer = Array.from(compressedData.subarray(dataPosition, dataPosition + nbToRead));
      dataPosition += nbToRead;

      LZWBitNumber = 0;
      LZWvar1 = (nbToRead << 3) - LZWCodeSize + 1;
    }

    let bitPosition = LZWBitNumber;
    let offset = bitPosition >> 3;
    bitPosition &= 7;

    newCode = ioBuffer[offset];
    offset += 1;
    newCode >>= bitPosition;
    let bitsWeHave = 8 - bitPosition;

    if (LZWCodeSize - bitsWeHave >= 8) {
      newCode |= ioBuffer[offset] << bitsWeHave;
      offset += 1;
      bitsWeHave += 8;
    }

    newCode |= (ioBuffer[offset] & rightBits[LZWCodeSize - bitsWeHave]) << bitsWeHave;
    LZWBitNumber += LZWCodeSize;

    if (newCode === -1) break;

    if (out.length === 0) {
      out.push(newCode & 0xff);
      prevCodeWord = newCode;
      D7 = newCode & 0xff;
      continue;
    }

    if (newCode === 256) {
      wordArray.fill(0);
      LZWresetDict = true;
      LZWNextCode = 256;
      continue;
    }

    D4 = newCode;

    if (newCode >= LZWNextCode) {
      stack.push(D7);
      newCode = prevCodeWord;
    }

    while (newCode >= 256) {
      stack.push(byteArray[newCode] & 0xff);
      newCode = wordArray[newCode];
    }

    D7 = byteArray[newCode] & 0xff;
    stack.push(D7);

    while (stack.length > 0) out.push(stack.pop());

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

// Ported from src/core/compression.ts (RLEexpand).
function rleExpand(compressedData) {
  const out = [];
  let repeatFlag = false;
  let repeatChar = 0;

  for (const byte of compressedData) {
    if (!repeatFlag) {
      if (byte === 0x90) repeatFlag = true;
      else {
        repeatChar = byte;
        out.push(byte);
      }
    } else {
      repeatFlag = false;
      if (byte > 0) {
        for (let i = 0; i < byte - 1; i++) out.push(repeatChar);
      } else {
        out.push(0x90);
      }
    }
  }

  return new Uint8Array(out);
}

function decompressGraphicsIfNeeded(raw, compressedSize, decompressedSize) {
  if (compressedSize === decompressedSize) return raw;
  const lzw = lzwExpand(raw);
  const rle = rleExpand(lzw);
  if (rle.length !== decompressedSize) {
    throw new Error(`Decompression size mismatch: expected ${decompressedSize}, got ${rle.length}`);
  }
  return rle;
}

function parseRectPos(buf, off) {
  return {
    x1: buf[off + 0],
    x2: buf[off + 1],
    y1: buf[off + 2],
    y2: buf[off + 3],
    u4: buf[off + 4],
    u5: buf[off + 5],
    u6: buf[off + 6],
    u7: buf[off + 7],
  };
}

function findExactRecord(buf, record) {
  const hits = [];
  for (let off = 0; off <= buf.length - 8; off++) {
    let ok = true;
    for (let i = 0; i < 8; i++) {
      if (buf[off + i] !== record[i]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(off);
  }
  return hits;
}

function scoreWallRectanglesCandidate(buf, off) {
  const W = 320;
  const H = 200;
  const needStride = new Set([8, 16, 64, 72, 128]);
  const needHeights = new Set([49, 51, 71, 111, 136]);

  const strideCount = new Map();
  const heightCount = new Map();

  let score = 0;
  for (let i = 0; i < 14; i++) {
    const r = parseRectPos(buf, off + i * 8);
    if (r.x1 >= W || r.x2 >= W || r.y1 >= H || r.y2 >= H) return -1;
    if (r.x2 < r.x1 || r.y2 < r.y1) return -1;
    if (r.u4 === 0 || r.u5 === 0) return -1;

    if (needStride.has(r.u4)) score += 2;
    if (needHeights.has(r.u5)) score += 2;

    strideCount.set(r.u4, (strideCount.get(r.u4) ?? 0) + 1);
    heightCount.set(r.u5, (heightCount.get(r.u5) ?? 0) + 1);

    // Prefer srcX/srcY reasonably small (sprite-sheet offsets in pixels).
    if (r.u6 <= 255 && r.u7 <= 255) score += 1;
  }

  // Heuristic: wallRectangles should include multiple 16×136 entries (near walls).
  if ((strideCount.get(16) ?? 0) >= 2 && (heightCount.get(136) ?? 0) >= 2) score += 20;
  if ((strideCount.get(8) ?? 0) >= 1 && (heightCount.get(49) ?? 0) >= 1) score += 10;
  if ((strideCount.get(64) ?? 0) >= 1 && (heightCount.get(51) ?? 0) >= 1) score += 10;
  if ((strideCount.get(72) ?? 0) >= 1 && (heightCount.get(71) ?? 0) >= 1) score += 10;
  if ((strideCount.get(128) ?? 0) >= 1 && (heightCount.get(111) ?? 0) >= 1) score += 10;

  return score;
}

function findBestWallRectangles(buf) {
  const blockSize = 14 * 8;
  let best = { off: -1, score: -1 };

  for (let off = 0; off <= buf.length - blockSize; off++) {
    const score = scoreWallRectanglesCandidate(buf, off);
    if (score > best.score) best = { off, score };
  }
  return best;
}

function findWallRectanglesStrict(buf) {
  const blockSize = 14 * 8;
  const required = [
    { u4: 8, u5: 49, count: 1 }, // pWallBitmaps[5] stride/height
    { u4: 16, u5: 136, count: 2 }, // pWallBitmaps[0]/[1] stride/height (F0 sides)
    { u4: 64, u5: 51, count: 1 }, // pWallBitmaps[4]
    { u4: 72, u5: 71, count: 1 }, // pWallBitmaps[3]
    { u4: 128, u5: 111, count: 1 }, // pWallBitmaps[2]
  ];

  const W = 320;
  const H = 200;

  for (let off = 0; off <= buf.length - blockSize; off++) {
    const counts = new Map();
    let ok = true;
    for (let i = 0; i < 14; i++) {
      const r = parseRectPos(buf, off + i * 8);
      if (r.x1 >= W || r.x2 >= W || r.y1 >= H || r.y2 >= H) {
        ok = false;
        break;
      }
      if (r.x2 < r.x1 || r.y2 < r.y1) {
        ok = false;
        break;
      }
      const key = `${r.u4},${r.u5}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (!ok) continue;

    for (const req of required) {
      const key = `${req.u4},${req.u5}`;
      if ((counts.get(key) ?? 0) < req.count) {
        ok = false;
        break;
      }
    }
    if (ok) return off;
  }
  return -1;
}

function findWallRectanglesStrictViewport(buf) {
  const blockSize = 14 * 8;
  const W = 320;
  const H = 200;
  for (let off = 0; off <= buf.length - blockSize; off++) {
    let hasF0L1 = false;
    let hasF0R1 = false;
    let hasF3CornerLeft = false;
    let hasF3CornerRight = false;

    for (let i = 0; i < 14; i++) {
      const r = parseRectPos(buf, off + i * 8);
      if (r.x1 >= W || r.x2 >= W || r.y1 >= H || r.y2 >= H) {
        hasF0L1 = false;
        hasF0R1 = false;
        hasF3CornerLeft = false;
        hasF3CornerRight = false;
        break;
      }
      if (r.x2 < r.x1 || r.y2 < r.y1) {
        hasF0L1 = false;
        hasF0R1 = false;
        hasF3CornerLeft = false;
        hasF3CornerRight = false;
        break;
      }

      // Expect the two distance-0 side walls to be full viewport height in 32px-wide strips.
      if (r.x1 === 0 && r.x2 === 31 && r.y1 === 0 && r.y2 === 135 && r.u4 === 16 && r.u5 === 136) {
        hasF0L1 = true;
      }
      if (r.x1 === 192 && r.x2 === 223 && r.y1 === 0 && r.y2 === 135 && r.u4 === 16 && r.u5 === 136) {
        hasF0R1 = true;
      }

      // Expect both far corners 16×49 (src stride 8, height 49).
      if (r.x1 === 0 && r.x2 === 15 && r.y1 === 25 && r.y2 === 73 && r.u4 === 8 && r.u5 === 49) {
        hasF3CornerLeft = true;
      }
      if (r.x1 === 208 && r.x2 === 223 && r.y1 === 25 && r.y2 === 73 && r.u4 === 8 && r.u5 === 49) {
        hasF3CornerRight = true;
      }
    }

    if (hasF0L1 && hasF0R1 && hasF3CornerLeft && hasF3CornerRight) return off;
  }

  return -1;
}

function main() {
  if (!fs.existsSync(GRAPHICS_DAT)) {
    console.error(`Missing ${GRAPHICS_DAT}`);
    process.exit(1);
  }

  const fileBuf = fs.readFileSync(GRAPHICS_DAT);
  const { itemCount, compressedSizes, decompressedSizes, dataStart } = parseGraphicsHeader(fileBuf);

  if (INDEX_22E >= itemCount) {
    console.error(`graphics.dat itemCount=${itemCount} < 0x22e (${INDEX_22E})`);
    process.exit(1);
  }

  const compSize = compressedSizes[INDEX_22E];
  const decompSize = decompressedSizes[INDEX_22E];
  const off = computeEntryOffset(dataStart, compressedSizes, INDEX_22E);

  const raw = fileBuf.subarray(off, off + compSize);
  const decomp = decompressGraphicsIfNeeded(raw, compSize, decompSize);

  console.log(`graphics.dat itemCount=${itemCount}`);
  console.log(`graphic 0x22e index=${INDEX_22E} compSize=${compSize} decompSize=${decompSize} (${decompSize.toString(16)})`);
  console.log(`dataStart=0x${dataStart.toString(16)} entryOff=0x${off.toString(16)}`);
  console.log(`first16=${Buffer.from(decomp.subarray(0, 16)).toString('hex')}`);

  // Try to locate the exact F0L1/F0R1 records anywhere in the blob.
  const f0l1 = findExactRecord(decomp, [0, 31, 0, 135, 16, 136, 0, 0]);
  const f0r1 = findExactRecord(decomp, [192, 223, 0, 135, 16, 136, 0, 0]);
  console.log(`exact record hits: F0L1=${f0l1.length} F0R1=${f0r1.length}`);
  if (f0l1.length) console.log(`  F0L1 offs: ${f0l1.slice(0, 8).map((x) => `0x${x.toString(16)}`).join(', ')}${f0l1.length > 8 ? '…' : ''}`);
  if (f0r1.length) console.log(`  F0R1 offs: ${f0r1.slice(0, 8).map((x) => `0x${x.toString(16)}`).join(', ')}${f0r1.length > 8 ? '…' : ''}`);

  // Scan for potential 16×49 corner records (u4=8,u5=49) anywhere.
  const cornerHits = [];
  for (let off = 0; off <= decomp.length - 8; off += 1) {
    if (decomp[off + 4] === 8 && decomp[off + 5] === 49) cornerHits.push(off);
  }
  console.log(`records with u4=8,u5=49: ${cornerHits.length}`);
  for (const off of cornerHits.slice(0, 12)) {
    const r = parseRectPos(decomp, off);
    console.log(`  0x${off.toString(16)}: x1=${r.x1} x2=${r.x2} y1=${r.y1} y2=${r.y2} u6=${r.u6} u7=${r.u7}`);
  }
  if (cornerHits.length > 12) console.log('  …');

  const strictViewportOff = findWallRectanglesStrictViewport(decomp);
  if (strictViewportOff >= 0) {
    console.log(`strict viewport wallRectangles match at off=0x${strictViewportOff.toString(16)}`);
    for (let i = 0; i < 14; i++) {
      const r = parseRectPos(decomp, strictViewportOff + i * 8);
      console.log(
        `${String(i).padStart(2, '0')}: ` +
          `x1=${r.x1} x2=${r.x2} y1=${r.y1} y2=${r.y2} ` +
          `u4=${r.u4} u5=${r.u5} u6=${r.u6} u7=${r.u7}`
      );
    }
    return;
  }

  const strictOff = findWallRectanglesStrict(decomp);
  if (strictOff >= 0) {
    console.log(`strict wallRectangles match at off=0x${strictOff.toString(16)}`);
    for (let i = 0; i < 14; i++) {
      const r = parseRectPos(decomp, strictOff + i * 8);
      console.log(
        `${String(i).padStart(2, '0')}: ` +
          `x1=${r.x1} x2=${r.x2} y1=${r.y1} y2=${r.y2} ` +
          `u4=${r.u4} u5=${r.u5} u6=${r.u6} u7=${r.u7}`
      );
    }
    return;
  }

  const best = findBestWallRectangles(decomp);
  if (best.off < 0) {
    console.log('No plausible 14×RectPos block found.');
    process.exit(2);
  }

  console.log(`best wallRectangles candidate at off=0x${best.off.toString(16)} score=${best.score}`);
  for (let i = 0; i < 14; i++) {
    const r = parseRectPos(decomp, best.off + i * 8);
    console.log(
      `${String(i).padStart(2, '0')}: ` +
        `x1=${r.x1} x2=${r.x2} y1=${r.y1} y2=${r.y2} ` +
        `u4=${r.u4} u5=${r.u5} u6=${r.u6} u7=${r.u7}`
    );
  }
}

main();
