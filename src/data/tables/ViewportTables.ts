import type { GraphicsLoader } from '../GraphicsLoader';
import type { RectPos } from './UITables';

export interface ViewportTables {
  // Core wall rectangles (CSBWin `d.wallRectangles[14]`)
  wallRectangles: RectPos[];
  wallRectanglesOffset: number; // offset within decompressed 0x22e blob
  mirrorWallRectF2: RectPos; // d.Byte2962 (byte RectPos for mirrored F2)
  mirrorWallRectF3: RectPos; // d.Byte2958 (byte RectPos for mirrored F3)

  // Additional CSBWin viewport tables in `graphic 0x22e` (Data.h:1184+)
  teleporterRectangles: RectPos[]; // `d.teleporterRectangles[12]`
  doorRects: {
    F1R1: RectPos[]; // `d.DoorRectsF1R1[10]`
    F1: RectPos[]; // `d.DoorRectsF1[10]`
    F1L1: RectPos[]; // `d.DoorRectsF1L1[10]`
    F2R1: RectPos[]; // `d.DoorRectsF2R1[10]`
    F2: RectPos[]; // `d.DoorRectsF2[10]`
    F2L1: RectPos[]; // `d.DoorRectsF2L1[10]`
    F3R1: RectPos[]; // `d.DoorRectsF3R1[10]`
    F3: RectPos[]; // `d.DoorRectsF3[10]`
    F3L1: RectPos[]; // `d.DoorRectsF3L1[10]`
  };
  doorTrackTopRect: RectPos[]; // `d.DoorTrackTopRect[7]`
  doorFrameRect: RectPos[]; // `d.DoorFrameRect[8]`

  ceilingPit: RectPos[]; // `d.CeilingPit[9]`
  floorPitRect: RectPos[]; // `d.FloorPitRect[12]`
  stairEdgeRect: RectPos[]; // `d.StairEdgeRect[8]`
  stairFacingDownRect: RectPos[]; // `d.StairFacingDownRect[11]`
  stairFacingUpRect: RectPos[]; // `d.StairFacingUpRect[11]`

  // See-through door edge helpers (Viewport.cpp:2576+)
  seeThruWallsRect: RectPos; // `d.SeeThruWallsRect`
  seeThruWallsRect2: RectPos; // `(RectPos *)&d.SeeThruWallsRect.b.uByte4`
  /** `d.SeeThruWallsRect.b.uByte4` / `.uByte6`: where in the viewport the F1 wall's hole starts (`Viewport.cpp:2961-2962`). */
  seeThruWallsRectUByte4: number;
  seeThruWallsRectUByte6: number;
  seeThruDoorEdgeRect: RectPos; // `(RectPos *)d.uByte2542`
  /**
   * `(RectPos *)d.Byte2546` — where the Hall of Champions portrait goes in the
   * viewport, used only by the `relativePosition == 12` arm of `DrawWallDecoration`
   * (`doc/CSBwin-src/CSBCode.cpp:3693-3700`). Byte-form: 32x29 pixels, the size of one
   * cell of the graphic-26 portrait sheet.
   */
  championPortraitRect: RectPos;
}

const GRAPHIC_22E_INDEX = 0x22e; // 558

function readRectPosBytes(buf: Uint8Array, off: number) {
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

function readRectPosByte4(buf: Uint8Array, off: number): RectPos {
  return {
    x1: buf[off + 0],
    x2: buf[off + 1],
    y1: buf[off + 2],
    y2: buf[off + 3],
  };
}

function hasExactRecord(buf: Uint8Array, off: number, record: number[]): boolean {
  for (let i = 0; i < record.length; i++) {
    if (buf[off + i] !== record[i]) return false;
  }
  return true;
}

function toRectPos(buf: Uint8Array, off: number): RectPos {
  const r = readRectPosBytes(buf, off);
  return {
    x1: r.x1,
    y1: r.y1,
    x2: r.x2,
    y2: r.y2,
    srcX: r.u6,
    srcY: r.u7,
    srcStride: r.u4 * 2,
    // CSBWin TAG0088b2 uses `SrcByteWidth` (bytes/line). Atari ST packed pixels: 1 byte = 2 pixels.
    srcWidth: r.u4 * 2,
    srcHeight: r.u5,
  };
}

function readRectPosArray(buf: Uint8Array, off: number, count: number): RectPos[] {
  const out: RectPos[] = [];
  for (let i = 0; i < count; i++) out.push(toRectPos(buf, off + i * 8));
  return out;
}

function parseGraphic22eTailOffsets(raw: Uint8Array): {
  teleporterRectanglesOffset: number;
  doorRectsF1R1Offset: number;
  doorRectsF1Offset: number;
  doorRectsF1L1Offset: number;
  doorRectsF2R1Offset: number;
  doorRectsF2Offset: number;
  doorRectsF2L1Offset: number;
  doorRectsF3R1Offset: number;
  doorRectsF3Offset: number;
  doorRectsF3L1Offset: number;
  doorTrackTopRectOffset: number;
  doorFrameRectOffset: number;
  wallRectanglesOffset: number;
  mirrorWallRectF2Offset: number;
  mirrorWallRectF3Offset: number;
  ceilingPitOffset: number;
  floorPitRectOffset: number;
  stairEdgeRectOffset: number;
  stairFacingDownRectOffset: number;
  stairFacingUpRectOffset: number;
  byte2546Offset: number;
  uByte2542Offset: number;
  seeThruWallsRectOffset: number;
} {
  // This parses the fixed-size tail of graphic 0x22e as declared in `doc/CSBwin-src/Data.h`:
  // teleporterRectangles → DoorRects* → DoorTrackTopRect → DoorFrameRect → wallRectangles →
  // CeilingPit → FloorPitRect → Stair*Rect → uByte2542 → SeeThruWallsRect → Word2530.
  //
  // We intentionally do *not* try to parse the entire 0x22e struct here: only the viewport tables
  // needed by opcodes live at the tail end.
  let off = raw.length;

  // i16 Word2530[2]
  off -= 4;

  // RectPos SeeThruWallsRect
  const seeThruWallsRectOffset = off - 8;
  off = seeThruWallsRectOffset;

  // ui8 uByte2542[4]
  const uByte2542Offset = off - 4;
  off = uByte2542Offset;

  // i8 Byte2546[4] — the champion portrait rectangle
  const byte2546Offset = off - 4;
  off = byte2546Offset;

  // RectPos StairFacingUpRect[11]
  const stairFacingUpRectOffset = off - 11 * 8;
  off = stairFacingUpRectOffset;

  // RectPos StairFacingDownRect[11]
  const stairFacingDownRectOffset = off - 11 * 8;
  off = stairFacingDownRectOffset;

  // RectPos StairEdgeRect[8]
  const stairEdgeRectOffset = off - 8 * 8;
  off = stairEdgeRectOffset;

  // RectPos FloorPitRect[12]
  const floorPitRectOffset = off - 12 * 8;
  off = floorPitRectOffset;

  // RectPos CeilingPit[9]
  const ceilingPitOffset = off - 9 * 8;
  off = ceilingPitOffset;

  // i8 Byte2962[4] + i8 Byte2958[4]
  const mirrorWallRectF2Offset = off - 8;
  const mirrorWallRectF3Offset = off - 4;
  off -= 8;

  // RectPos wallRectangles[14]
  const wallRectanglesOffset = off - 14 * 8;
  off = wallRectanglesOffset;

  // RectPos DoorFrameRect[8]
  const doorFrameRectOffset = off - 8 * 8;
  off = doorFrameRectOffset;

  // RectPos DoorTrackTopRect[7]
  const doorTrackTopRectOffset = off - 7 * 8;
  off = doorTrackTopRectOffset;

  // Door rect arrays, each 10×RectPos (80 bytes)
  const doorRectsF3L1Offset = off - 10 * 8;
  off = doorRectsF3L1Offset;
  const doorRectsF3Offset = off - 10 * 8;
  off = doorRectsF3Offset;
  const doorRectsF3R1Offset = off - 10 * 8;
  off = doorRectsF3R1Offset;

  const doorRectsF2L1Offset = off - 10 * 8;
  off = doorRectsF2L1Offset;
  const doorRectsF2Offset = off - 10 * 8;
  off = doorRectsF2Offset;
  const doorRectsF2R1Offset = off - 10 * 8;
  off = doorRectsF2R1Offset;

  const doorRectsF1L1Offset = off - 10 * 8;
  off = doorRectsF1L1Offset;
  const doorRectsF1Offset = off - 10 * 8;
  off = doorRectsF1Offset;
  const doorRectsF1R1Offset = off - 10 * 8;
  off = doorRectsF1R1Offset;

  // RectPos teleporterRectangles[12]
  const teleporterRectanglesOffset = off - 12 * 8;
  off = teleporterRectanglesOffset;

  if (teleporterRectanglesOffset < 0) {
    throw new Error('graphics.dat item 0x22e too small to contain viewport table tail');
  }

  return {
    teleporterRectanglesOffset,
    doorRectsF1R1Offset,
    doorRectsF1Offset,
    doorRectsF1L1Offset,
    doorRectsF2R1Offset,
    doorRectsF2Offset,
    doorRectsF2L1Offset,
    doorRectsF3R1Offset,
    doorRectsF3Offset,
    doorRectsF3L1Offset,
    doorTrackTopRectOffset,
    doorFrameRectOffset,
    wallRectanglesOffset,
    mirrorWallRectF2Offset,
    mirrorWallRectF3Offset,
    ceilingPitOffset,
    floorPitRectOffset,
    stairEdgeRectOffset,
    stairFacingDownRectOffset,
    stairFacingUpRectOffset,
    byte2546Offset,
    uByte2542Offset,
    seeThruWallsRectOffset,
  };
}

export function extractViewportTables(graphics: GraphicsLoader): ViewportTables {
  const raw = graphics.getRawGraphic(GRAPHIC_22E_INDEX);
  const tail = parseGraphic22eTailOffsets(raw);

  // A canary, not a search: `wallRectangles[10]` and `[11]` are F0L1 and F0R1, the
  // 32x136 side walls, in every graphics.dat the project has. A file whose tail does not
  // put them there has another layout, and the tables would be read from the wrong bytes.
  const F0L1 = [0, 31, 0, 135, 16, 136, 0, 0];
  const F0R1 = [192, 223, 0, 135, 16, 136, 0, 0];
  const wallRectanglesOffset = tail.wallRectanglesOffset;
  if (
    !hasExactRecord(raw, wallRectanglesOffset + 10 * 8, F0L1) ||
    !hasExactRecord(raw, wallRectanglesOffset + 11 * 8, F0R1)
  ) {
    throw new Error(`graphics.dat item 0x22e: no F0L1/F0R1 wall rectangles at 0x${wallRectanglesOffset.toString(16)}, where its tail puts them`);
  }

  const wallRectangles = readRectPosArray(raw, wallRectanglesOffset, 14);
  const teleporterRectangles = readRectPosArray(raw, tail.teleporterRectanglesOffset, 12);
  const doorRects = {
    F1R1: readRectPosArray(raw, tail.doorRectsF1R1Offset, 10),
    F1: readRectPosArray(raw, tail.doorRectsF1Offset, 10),
    F1L1: readRectPosArray(raw, tail.doorRectsF1L1Offset, 10),
    F2R1: readRectPosArray(raw, tail.doorRectsF2R1Offset, 10),
    F2: readRectPosArray(raw, tail.doorRectsF2Offset, 10),
    F2L1: readRectPosArray(raw, tail.doorRectsF2L1Offset, 10),
    F3R1: readRectPosArray(raw, tail.doorRectsF3R1Offset, 10),
    F3: readRectPosArray(raw, tail.doorRectsF3Offset, 10),
    F3L1: readRectPosArray(raw, tail.doorRectsF3L1Offset, 10),
  };

  const doorTrackTopRect = readRectPosArray(raw, tail.doorTrackTopRectOffset, 7);
  const doorFrameRect = readRectPosArray(raw, tail.doorFrameRectOffset, 8);
  const ceilingPit = readRectPosArray(raw, tail.ceilingPitOffset, 9);
  const floorPitRect = readRectPosArray(raw, tail.floorPitRectOffset, 12);
  const stairEdgeRect = readRectPosArray(raw, tail.stairEdgeRectOffset, 8);
  const stairFacingDownRect = readRectPosArray(raw, tail.stairFacingDownRectOffset, 11);
  const stairFacingUpRect = readRectPosArray(raw, tail.stairFacingUpRectOffset, 11);
  const mirrorWallRectF2 = readRectPosByte4(raw, tail.mirrorWallRectF2Offset);
  const mirrorWallRectF3 = readRectPosByte4(raw, tail.mirrorWallRectF3Offset);

  const seeThruWallsRect = toRectPos(raw, tail.seeThruWallsRectOffset);
  const seeThruWallsRect2 = toRectPos(raw, tail.seeThruWallsRectOffset + 4);
  const seeThruWallsRectUByte4 = raw[tail.seeThruWallsRectOffset + 4];
  const seeThruWallsRectUByte6 = raw[tail.seeThruWallsRectOffset + 6];
  const seeThruDoorEdgeRect = toRectPos(raw, tail.uByte2542Offset);
  const championPortraitRect = readRectPosByte4(raw, tail.byte2546Offset);

  return {
    wallRectangles,
    wallRectanglesOffset,
    mirrorWallRectF2,
    mirrorWallRectF3,
    teleporterRectangles,
    doorRects,
    doorTrackTopRect,
    doorFrameRect,
    ceilingPit,
    floorPitRect,
    stairEdgeRect,
    stairFacingDownRect,
    stairFacingUpRect,
    seeThruWallsRect,
    seeThruWallsRect2,
    seeThruWallsRectUByte4,
    seeThruWallsRectUByte6,
    seeThruDoorEdgeRect,
    championPortraitRect,
  };
}
