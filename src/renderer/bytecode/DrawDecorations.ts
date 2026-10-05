/**
 * The wall and floor decorations, as `CSBCode.cpp` draws them into the viewport:
 * `DrawWallDecoration`, which draws the wall text and the champion portrait too, and
 * `DrawFloorDecorations`, with the extended (CSB graphics) decorations each draws. The
 * bytecode's `StdDrawWallDecoration`, `StdDrawWallText` and `StdDrawFloorDecoration` pop
 * their arguments and call these, as CSBWin's `Interpret` does
 * (`doc/CSBwin-src/Viewport.cpp:2925-2949`).
 */

import { OBJECT_ID_EOF, type ObjectID } from '../../core/types';
import { getExternalPortraitAddress, type CSBGraphicsLoader, type ExtendedFloorDecoration } from '../../data/CSBGraphicsLoader';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import { bltShapeToViewportIndex, cropBitmap, tag0088b2Explicit, tag0088b2Index } from '../csbwin/CanvasBlitter';
import type { ViewportDraw } from './ViewportDraw';

/**
 * `DrawWallDecoration` (`doc/CSBwin-src/CSBCode.cpp:3133`) — the picture frame, and
 * then the champion portrait inside it.
 *
 * The two halves are independent: `PORTRAIT_HideGraphic` leaves `graphicOrdinal` at 0
 * with a portrait still to draw, and every other decoration has no portrait, so
 * CSBWin bails only when *both* are absent (`:3191`) and draws the frame only when
 * `graphicIndex >= 0` (`:3673`).
 */
export function DrawWallDecoration(
  draw: ViewportDraw,
  graphicOrdinal: number,
  relativePosition: number,
  championPortraitOrdinal = 0,
): boolean {
  if (graphicOrdinal === 0 && championPortraitOrdinal === 0) return false;

  const isAlcove = graphicOrdinal !== 0
    ? drawWallDecorationGraphic(draw, graphicOrdinal, relativePosition)
    : false;

  // `if (relativePosition == 12)` (`:3685`) — only the wall the party stands against
  // is close enough to show a face.
  if (relativePosition === 12) {
    drawChampionPortrait(draw, championPortraitOrdinal);
  }
  return isAlcove;
}

/**
 * The frame half of `DrawWallDecoration`: everything under CSBWin's
 * `if (graphicIndex >= 0)`.
 */
function drawWallDecorationGraphic(draw: ViewportDraw, graphicOrdinal: number, relativePosition: number): boolean {
  const tables = draw.context.objectTables;
  const dungeon = draw.context.dungeonState;
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  const csbGraphics = draw.context.csbGraphics;
  if (!tables || !dungeon || !viewport || !getGraphic) return false;

  if ((graphicOrdinal & 0x10000) !== 0) {
    if (!csbGraphics) return false;
    drawExtendedWallDecoration(draw, csbGraphics, graphicOrdinal, relativePosition);
    return false;
  }

  const map = dungeon.getMap(draw.context.frameMapIndex ?? 0);
  if (!map?.wallDecorationTOC) return false;

  // CSBWin: `graphicIndex = graphicOrdinal-1` (CSBCode.cpp:3179-3183)
  const graphicIndex = (graphicOrdinal - 1) | 0;
  const numWallDecoration = draw.context.numWallDecoration ?? 0;
  if (graphicIndex < 0 || graphicIndex > numWallDecoration) return false;

  const decorationIndex = graphicIndex === numWallDecoration ? 0 : (map.wallDecorationTOC[graphicIndex] ?? 0);
  const isAlcove = isAlcoveDecorationIndex(decorationIndex, tables);
  const rectSetId = tables.wallDecorationRectSetIndex[decorationIndex] ?? 0;
  const rectSetIndex = rectSetId & 0xff;
  if (rectSetIndex >= tables.wallDecorationRectSets.length) return isAlcove;

  const rectSet = tables.wallDecorationRectSets[rectSetIndex];
  const desc = rectSet?.[relativePosition];
  if (!desc) return isAlcove;

  const x1 = desc.x1 | 0;
  const y1 = desc.y1 | 0;
  const x2 = desc.x2 | 0;
  const y2 = desc.y2 | 0;
  const dstW = x2 - x1 + 1;
  const dstH = y2 - y1 + 1;
  if (dstW <= 0 || dstH <= 0) return isAlcove;

  // CSBWin: `relativePosition % 5 > 1` selects front view; otherwise side view (CSBCode.cpp:3171-3176).
  const frontView = (relativePosition % 5) > 1;
  const graphicNum = 121 + 2 * decorationIndex + (frontView ? 1 : 0);

  const src = getGraphic(graphicNum);
  if (!src) return isAlcove;

  const distanceBand = Math.floor(relativePosition / 5); // 0=F3, 1=F2, 2=F1
  const mirror = relativePosition === 11 || relativePosition === 6 || relativePosition === 1;
  if (relativePosition === 12) {
    if (draw.context.viewportObjectButtons?.[5]) {
      const button = draw.context.viewportObjectButtons[5];
      button.x1 = x1;
      button.x2 = x2;
      button.y1 = y1;
      button.y2 = y2;
    }
    if (draw.context.facingAlcove !== undefined) draw.context.facingAlcove = isAlcove;
    if (draw.context.facingViAltar !== undefined) draw.context.facingViAltar = decorationIndex === 2;
    if (draw.context.facingWaterFountain !== undefined) {
      const fountainIdx = tables.fountainDecorationIndex;
      draw.context.facingWaterFountain = decorationIndex === (fountainIdx | 0);
    }
  }

  if (relativePosition >= 10) {
    const bitmap = mirror ? draw.getMirroredBitmap(src) : src;
    bltShapeToViewportIndex(bitmap, viewport, { x1, y1, x2, y2 });
    return isAlcove;
  }

  const colorMap = distanceBand === 0 ? tables.floorColorMapFar : tables.floorColorMapMedium;
  let pWidthDescriptor = desc;
  let pSrcSizeDescriptor = rectSet?.[12];
  if (relativePosition === 6 || relativePosition === 1) {
    pSrcSizeDescriptor = rectSet?.[11];
  } else if (relativePosition === 5 || relativePosition === 0) {
    pSrcSizeDescriptor = rectSet?.[10];
  }
  if (relativePosition === 7 || relativePosition === 9) {
    pWidthDescriptor = rectSet?.[8] ?? desc;
  }
  const finalBitmapWidth = (pWidthDescriptor.x2 | 0) - (pWidthDescriptor.x1 | 0);
  let widthPixels = src.width | 0;
  let heightPixels = src.height | 0;
  widthPixels = (widthPixels + 15) & ~15;
  let widthBytes = widthPixels >> 1;
  if (pSrcSizeDescriptor) {
    if (widthBytes > (pSrcSizeDescriptor.widthBytes | 0)) widthBytes = pSrcSizeDescriptor.widthBytes | 0;
    if (heightPixels > (pSrcSizeDescriptor.height | 0)) heightPixels = pSrcSizeDescriptor.height | 0;
  }
  widthPixels = widthBytes * 2;
  const cropped = cropBitmap(src, widthPixels, heightPixels);

  const scaled = draw.scaleIndexedBitmap(cropped, finalBitmapWidth + 1, desc.height | 0, colorMap, mirror);

  // `srcOffsetX` (`doc/CSBwin-src/CSBCode.cpp:3538-3562`). Positions 7 and 9 scale the
  // decoration to the width of the F2 *centre* rectangle (`rectSet[8]`, chosen above),
  // which is wider than the slot they are drawn into, because a decoration at the edge
  // of the screen is only partly visible. Which part depends on the side:
  //
  //   - position 9 (F2 front-right) runs off the *right* edge, so it shows its left
  //     end and the offset is 0;
  //   - position 7 (F2 front-left) runs off the *left* edge, so it must show its
  //     **right** end — CSBWin's "Jst ahead to the left. Truncate graphic" (`:3551`).
  //
  // Without this, position 7 drew its left end into a slot flush against the left
  // border: cropped on the wrong side, and with the transparent margin that should
  // have been off-screen left as a visible gap.
  let srcOffsetX = 0;
  if (relativePosition === 7) {
    srcOffsetX = finalBitmapWidth - ((desc.x2 | 0) - (desc.x1 | 0));
  }
  // CSBWin also sets `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored
  // far-right sidewalls (positions 1 and 6, `:3536`). That is **not** ported, and
  // deliberately: it compensates for `MakeMirror` reversing a byte-aligned buffer of
  // `pWDP->width` bytes, which leaves the image `ceil16(w) - w` pixels from the left.
  // `getMirroredBitmap` reverses the exact `finalBitmapWidth + 1` bitmap, so ours is
  // already flush at 0 and the same offset would shift it wrongly.

  bltShapeToViewportIndex(scaled, viewport, { x1, y1, x2, y2, srcX: srcOffsetX });
  return isAlcove;
}

/**
 * The portrait half of `DrawWallDecoration` (`doc/CSBwin-src/CSBCode.cpp:3686-3716`).
 *
 * `championPortraitOrdinal` is 1-based, so 0 means "no portrait" and the ordinal is
 * decremented to CSBWin's `charID` before use. Graphic 26 is a 256x87 sheet of 32x29
 * cells, 8 per row: `srcX = (charID & 7) << 5`, `srcY = 29 * (charID >> 3)`; past 23,
 * the portrait is `CSBgraphics.dat`'s (`:3700-3709`). The transparent colour is **1**,
 * not the 10 that `BltShapeToViewport` uses, so the mirror's glass shows around the head.
 */
function drawChampionPortrait(draw: ViewportDraw, championPortraitOrdinal: number): void {
  if (championPortraitOrdinal === 0) return;
  const charID = (championPortraitOrdinal - 1) | 0;

  const viewport = draw.context.viewportIndexBuffer;
  const rect = draw.context.championPortraitRect;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!viewport || !rect || !getGraphic) return;

  if (charID > 23) {
    // `GetExternalPortraitAddress` (`:3706`): the 32x29 portrait itself, from its corner.
    const portrait = getExternalPortraitAddress(draw.context.csbGraphics, charID);
    tag0088b2Index(
      portrait,
      viewport,
      {
        x1: rect.x1 | 0,
        y1: rect.y1 | 0,
        x2: rect.x2 | 0,
        y2: rect.y2 | 0,
        srcX: 0,
        srcY: 0,
        srcStride: portrait.width,
      },
      1,
    );
    return;
  }

  const sheet = getGraphic(26);
  if (!sheet) return;

  tag0088b2Index(
    sheet,
    viewport,
    {
      x1: rect.x1 | 0,
      y1: rect.y1 | 0,
      x2: rect.x2 | 0,
      y2: rect.y2 | 0,
      srcX: (charID & 7) << 5,
      srcY: 29 * (charID >> 3),
      srcStride: sheet.width,
    },
    1,
  );
}

function isAlcoveDecorationIndex(decorationIndex: number, tables: ObjectTables): boolean {
  const alcoves = tables.alcoveDecorationIndices;
  for (let i = 0; i < alcoves.length; i++) {
    if ((alcoves[i] ?? 0xff) === decorationIndex) return true;
  }
  return false;
}

function drawExtendedWallDecoration(
  draw: ViewportDraw,
  csbGraphics: CSBGraphicsLoader,
  graphicOrdinal: number,
  relativePosition: number
): void {
  const tables = draw.context.objectTables;
  const viewport = draw.context.viewportIndexBuffer;
  if (!tables || !viewport) return;

  const id = graphicOrdinal & 0xffff;
  if (id === 0) return;

  const ext = csbGraphics.getWallDecoration(id);
  if (!ext) return;

  const desc = ext.desc[relativePosition];
  if (!desc) return;

  const dstW = (desc.x2 | 0) - (desc.x1 | 0) + 1;
  const dstH = (desc.y2 | 0) - (desc.y1 | 0) + 1;
  if (dstW <= 0 || dstH <= 0) return;

  const frontView = (relativePosition % 5) > 1;
  const srcBitmap = frontView ? ext.frontBitmap : ext.sideBitmap;

  if (relativePosition >= 10) {
    const mirror = relativePosition === 11;
    const bitmap = mirror ? draw.getMirroredBitmap(srcBitmap) : srcBitmap;
    bltShapeToViewportIndex(bitmap, viewport, { x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });
    return;
  }

  const farRightSidewall = relativePosition === 6 || relativePosition === 1;
  const pWDP = desc;
  let pWidthDescriptor = pWDP;
  let pSrcSizeDescriptor = ext.desc[12];
  if (farRightSidewall) {
    pSrcSizeDescriptor = ext.desc[11];
  } else if (relativePosition === 5 || relativePosition === 0) {
    pSrcSizeDescriptor = ext.desc[10];
  }
  if (relativePosition === 7 || relativePosition === 9) {
    pWidthDescriptor = ext.desc[8];
  }

  const finalBitmapWidth = (pWidthDescriptor.x2 | 0) - (pWidthDescriptor.x1 | 0);
  const sourceRect = frontView ? ext.desc[12] : ext.desc[11];
  let widthPixels = (sourceRect.x2 | 0) - (sourceRect.x1 | 0) + 1;
  let heightPixels = sourceRect.height | 0;
  widthPixels = (widthPixels + 15) & ~15;
  let widthBytes = widthPixels >> 1;
  if (widthBytes > (pSrcSizeDescriptor.widthBytes | 0)) widthBytes = pSrcSizeDescriptor.widthBytes | 0;
  if (heightPixels > (pSrcSizeDescriptor.height | 0)) heightPixels = pSrcSizeDescriptor.height | 0;
  widthPixels = widthBytes * 2;

  const cropped = cropBitmap(srcBitmap, widthPixels, heightPixels);
  const distanceBand = relativePosition <= 4 ? 0 : 1;
  const colorMap = distanceBand === 0 ? tables.floorColorMapFar : tables.floorColorMapMedium;
  let derived = draw.scaleIndexedBitmap(cropped, finalBitmapWidth + 1, pWDP.height | 0, colorMap);

  let srcOffsetX = 0;
  if (farRightSidewall) {
    derived = draw.getMirroredBitmap(derived);
    srcOffsetX = 15 - (finalBitmapWidth & 15);
  } else if (relativePosition === 7) {
    const w = (pWDP.x2 | 0) - (pWDP.x1 | 0);
    srcOffsetX = finalBitmapWidth - w;
  }

  const rect: RectPos = {
    x1: pWDP.x1,
    y1: pWDP.y1,
    x2: pWDP.x2,
    y2: pWDP.y2,
    srcX: srcOffsetX,
    srcY: 0,
  };
  bltShapeToViewportIndex(derived, viewport, rect);
}

/**
 * The text half of `DrawWallDecoration`: CSBWin's `StdDrawWallText` calls it with
 * `d.NumWallDecoration+1` and the text's RN (`doc/CSBwin-src/Viewport.cpp:2925-2937`).
 * Only the wall the party stands against shows the words; farther walls show the
 * inscription's graphic.
 */
export function drawWallText(draw: ViewportDraw, textRN: ObjectID, relativePosition: number, removeMortarJoint: boolean): void {
  if (textRN === OBJECT_ID_EOF) return;

  const tables = draw.context.objectTables;
  const dungeon = draw.context.dungeonState;
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!tables || !dungeon || !viewport || !getGraphic) return;

  // CSBWin draws real text only on the front wall immediately in front of the party (relativePosition==12).
  if (relativePosition !== 12) {
    const numWallDecoration = draw.context.numWallDecoration ?? 0;
    DrawWallDecoration(draw, numWallDecoration + 1, relativePosition);
    return;
  }

  const rec = dungeon.getTextRecord(textRN);
  if (!rec) return;

  const textBytes = dungeon.decodeWallTextBytes(rec, tables.textDecode);
  if (!textBytes) return;

  const font = getGraphic(120);
  if (!font) return;

  if (removeMortarJoint) {
    const wall = draw.context.wallBitmaps?.[2];
    const wallRect = draw.context.wallRectangles?.[6];
    const wallTextRect = tables.wallTextRect;
    if (wall && wallRect && wallTextRect) {
      const rect: RectPos = {
        x1: wallTextRect.x1,
        x2: wallTextRect.x2,
        y1: wallTextRect.y1,
        y2: wallTextRect.y2,
        srcX: 94,
        srcY: 28,
        srcStride: wallRect.srcStride,
        srcWidth: wallRect.srcWidth,
        srcHeight: wallRect.srcHeight,
      };
      tag0088b2Index(wall, viewport, rect, -1);
    }
  }

  let idx = 0;
  let lineIdx = 0;
  while (idx < textBytes.length && lineIdx < tables.wallTextLineY2.length) {
    let lineStart = idx;
    let lineLen = 0;
    while (idx < textBytes.length && textBytes[idx] < 0x80) {
      lineLen++;
      idx++;
    }
    if (lineLen === 0) {
      const term = textBytes[idx] ?? 0x81;
      idx++;
      lineIdx++;
      if (term === 0x81) break;
      continue;
    }

    if (lineLen > 18) lineLen = 18;
    const y2 = tables.wallTextLineY2[lineIdx] ?? 60;
    let x = 112 - 4 * lineLen;

    // `TAG0088b2(font, viewport, &rect, 8*code, 0, 144, 112, 10)`
    // (`doc/CSBwin-src/CSBCode.cpp:3278-3285`), with no check of `code` against the
    // font's 36 glyphs: a code past them reads on into the rows below.
    for (let i = 0; i < lineLen; i++) {
      const code = textBytes[lineStart + i] ?? 0;
      tag0088b2Explicit(font.pixels, viewport.pixels, { x1: x, y1: y2 - 7, x2: x + 7, y2 }, 8 * code, 0, 144, 112, 10);
      x += 8;
    }

    const term = textBytes[idx] ?? 0x81;
    idx++;
    lineIdx++;
    if (term === 0x81) break;
  }
}

export function DrawFloorDecorations(draw: ViewportDraw, graphicOrdinal: number, relativeCell: number): void {
  const tables = draw.context.objectTables;
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  const csbGraphics = draw.context.csbGraphics;
  const loaded = draw.context.loadedFloorDecorations;
  if (!tables || !viewport || !getGraphic || !loaded) return;

  const drawFootprints = (graphicOrdinal & 0x8000) !== 0;
  const extFloorDecoration = (graphicOrdinal & 0x4000) !== 0;
  let ordinal = graphicOrdinal & 0x7fff;

  if (extFloorDecoration) {
    if (csbGraphics) {
      const ext = csbGraphics.getFloorDecoration(ordinal & 0x7fff);
      if (ext) {
        drawExtendedFloorDecoration(draw, ext, relativeCell);
        if (drawFootprints) DrawFloorDecorations(draw, 16, relativeCell);
        return;
      }
    }
    ordinal = 0;
  }

  if (ordinal === 0 && !drawFootprints) return;

  const drawSingle = (ord: number) => {
    if (ord === 0) return;
    const graphicIndex = (ord - 1) | 0;
    // `d.LoadedFloorDecorations[graphicIndex]` (`doc/CSBwin-src/CSBCode.cpp:3871-3892`).
    const slot = loaded[graphicIndex];
    if (!slot) return;
    if (relativeCell < 0 || relativeCell >= tables.floorDecorationDescSets[0].length) return;

    const [baseGraphic, rectSetIndex] = slot;
    const rectSet = tables.floorDecorationDescSets[rectSetIndex];
    const desc = rectSet?.[relativeCell];
    if (!desc) return;

    const cellIncrement = tables.relativeCellGraphicIncrement[relativeCell] ?? 0;
    const graphicNum = baseGraphic + cellIncrement;
    const bitmap = getGraphic(graphicNum);
    if (!bitmap) return;

    const srcWidth = (desc.widthBytes | 0) * 2;
    const srcHeight = desc.height | 0;
    if (srcWidth <= 0 || srcHeight <= 0) return;

    let mirror = relativeCell === 8 || relativeCell === 5 || relativeCell === 2;
    if (
      graphicIndex === 15 &&
      (draw.context.useMirrorImages ?? false) &&
      (relativeCell === 7 || relativeCell === 4 || relativeCell !== 1)
    ) {
      mirror = true;
    }

    const rect: RectPos = {
      x1: desc.x1,
      y1: desc.y1,
      x2: desc.x2,
      y2: desc.y2,
      srcX: 0,
      srcY: 0,
      srcWidth,
      srcHeight,
    };
    draw.blitShapeBitmapToViewport(bitmap, rect, mirror);
  };

  if (ordinal !== 0) drawSingle(ordinal);
  if (drawFootprints) drawSingle(16);
}

function drawExtendedFloorDecoration(draw: ViewportDraw, ext: ExtendedFloorDecoration, relativeCell: number): void {
  const tables = draw.context.objectTables;
  const viewport = draw.context.viewportIndexBuffer;
  if (!tables || !viewport) return;

  if (relativeCell < 0 || relativeCell >= ext.desc.length) return;

  const desc = ext.desc;
  const displayDesc = desc[relativeCell];
  if (!displayDesc) return;

  const baseBitmap = ext.bitmap;
  let bitmap = baseBitmap;
  const map = relativeCell < 3 ? tables.floorColorMapFar : tables.floorColorMapMedium;

  if (relativeCell < 6) {
    if (relativeCell < 3) {
      const target = displayDesc;
      const targetWidth = (target.x2 | 0) - (target.x1 | 0) + 1;
      bitmap = draw.scaleIndexedBitmap(baseBitmap, targetWidth, target.height | 0, map);
    } else {
      const target = desc[4];
      const targetWidth = (target.x2 | 0) - (target.x1 | 0) + 1;
      bitmap = draw.scaleIndexedBitmap(baseBitmap, targetWidth, target.height | 0, map);
    }
  }

  const facing = draw.context.frameFacing ?? 0;
  const mirrorFlags = ext.mirrorFlags & 0xffff;
  const useMirror = (((mirrorFlags >>> (facing + 9)) ^ (mirrorFlags >>> relativeCell)) & 1) !== 0;
  if (useMirror) bitmap = draw.getMirroredBitmap(bitmap);

  let srcOffsetX = 0;
  if (relativeCell === 6) {
    const fullWidth = (desc[7].x2 | 0) - (desc[7].x1 | 0) + 1;
    const partialWidth = (displayDesc.x2 | 0) - (displayDesc.x1 | 0) + 1;
    srcOffsetX = fullWidth - partialWidth;
  } else if (relativeCell === 3) {
    const fullWidth = (desc[4].x2 | 0) - (desc[4].x1 | 0) + 1;
    const partialWidth = (desc[3].x2 | 0) - (desc[3].x1 | 0) + 1;
    srcOffsetX = fullWidth - partialWidth;
  }

  const rect: RectPos = {
    x1: displayDesc.x1,
    y1: displayDesc.y1,
    x2: displayDesc.x2,
    y2: displayDesc.y2,
    srcX: srcOffsetX,
    srcY: 0,
  };
  bltShapeToViewportIndex(bitmap, viewport, rect);
}
