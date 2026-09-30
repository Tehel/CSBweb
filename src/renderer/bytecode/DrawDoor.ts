/**
 * The door and the teleporter, as `CSBCode.cpp` draws them into the viewport: `DrawDoor`
 * with its ornament (`TAG004b26`), `DrawDoorSwitch`, and `DrawTeleporter` with
 * `GraphicRandom`, the stream its shimmer reads. The bytecode's `StdDrawDoor`,
 * `StdDrawDoorSwitch` and `StdDrawTeleporter` pop their arguments and call these, as
 * CSBWin's `Interpret` does (`doc/CSBwin-src/Viewport.cpp:2589-2610`, `:2886-2896`).
 */

import type { RectPos } from '../../data/tables/UITables';
import {
  bltShapeToViewportIndex,
  cropBitmap,
  shrinkBlt,
  tag0088b2Index,
  tag008c98Index,
  type IndexedBitmap,
} from '../csbwin/CanvasBlitter';
import { viewportRandom, type ViewportDraw } from './ViewportDraw';

/**
 * `DrawDoor` (`doc/CSBwin-src/CSBCode.cpp:4134`): door record `db0Index` in `doorState`
 * (0 open … 4 closed, 5 bashed), from `graphicNum`, the two door-type graphics of
 * `d.DoorGraphic` at this distance, `nearness` 0 F3, 1 F2, 2 F1, into `rect`, the door's
 * ten rectangles.
 */
export function DrawDoor(
  draw: ViewportDraw,
  db0Index: number,
  doorState: number,
  graphicNum: number[] | undefined,
  nearness: number,
  rect: RectPos[],
): void {
  const dungeon = draw.context.dungeonState;
  if (!dungeon) return;

  const record = dungeon.getDoorRecordByIndex(db0Index);
  if (!record) return;

  const doorType = record.doorType & 1;
  const doorGraphicNum = graphicNum?.[doorType] ?? -1;
  if (doorGraphicNum < 0) return;

  const getGraphic = draw.context.getGraphicBitmap;
  const viewport = draw.context.viewportIndexBuffer;
  if (!getGraphic || !viewport) return;

  const graphic = getGraphic(doorGraphicNum);
  if (!graphic) return;

  const s = doorState;
  if (s === 0) return; // fully open

  // `DrawDoor` copies the door's graphic into `tempBitmap` and draws on the copy
  // (`doc/CSBwin-src/CSBCode.cpp:4151-4154`). The port copies only when an ornament is
  // drawn, and again after a mirror or a flip, whose result is cached and shared.
  let bitmap: IndexedBitmap = graphic;
  let ownBitmap = false;
  const drawOrnament = (ornament: number, near: number) => {
    if (ornament === 0) return; // `TAG004b26` returns at once (`:4002`)
    if (!ownBitmap) {
      bitmap = { width: bitmap.width, height: bitmap.height, pixels: bitmap.pixels.slice() };
      ownBitmap = true;
    }
    TAG004b26(draw, bitmap, ornament, near);
  };

  drawOrnament(record.ornateNumber, nearness); // `:4155`

  // A "lightning door" (`d.DoorTOC[doorType] & 0x400`) redraws with a random
  // mirror and a random vertical flip every frame it isn't bashed
  // (`doc/CSBwin-src/CSBCode.cpp:4156-4166`) — CSBWin's cheap energy-field
  // shimmer. `STRandomBool()` there reads whatever stream is currently swapped
  // into `d.RandomNumber`, which `DrawViewport` sets to a viewport-only stream for
  // exactly this reason (`doc/CSBwin-src/Viewport.cpp:6706-6707`) — rendering must
  // never perturb the game's own RNG, so this draws from a dedicated instance.
  const isLightningDoor = ((draw.context.doorTOC?.[doorType] ?? 0) & 0x400) !== 0;
  if (isLightningDoor && s !== 5) {
    if (viewportRandom.bool()) {
      bitmap = draw.getMirroredBitmap(bitmap);
      ownBitmap = false;
    }
    if (viewportRandom.bool()) {
      bitmap = draw.getFlippedBitmapVertical(bitmap);
      ownBitmap = false;
    }
  }

  // The near door under See-Thru-Walls (`:4168-4174`).
  if (rect === draw.context.doorRects?.F1 && draw.context.seeThroughWalls) drawOrnament(17, 2);

  const blit = (r: RectPos | undefined) => {
    if (!r) return;
    bltShapeToViewportIndex(bitmap, viewport, r);
  };

  if (s === 4 || s === 5) {
    if (s === 5) drawOrnament(16, nearness); // bashed (`:4184`)
    blit(rect[0]);
    return;
  }

  // 1..3: opening/closing
  const modeUp = record.vertical; // CSBWin DB0.mode(): 1=up, 0=sideways
  if (modeUp) {
    blit(rect[s]);
  } else {
    blit(rect[3 + s]); // left half
    blit(rect[6 + s]); // right half
  }
}

/**
 * `TAG004b26` (`doc/CSBwin-src/CSBCode.cpp:3993-4059`): draws door ornament `ornament`,
 * slot `ornament - 1` of `d.Word2514`, onto `door`, a copy of the door's graphic at
 * `nearness` (0 F3, 1 F2, 2 F1), with colour 9 transparent. At F1 the ornament is its
 * graphic; nearer than that it is shrunk from its F1 size to the rectangle's through
 * `d.Byte4172` (F3) or `d.Byte4188` (F2), the derived graphic `68 + 2*slot + nearness`.
 */
function TAG004b26(draw: ViewportDraw, door: IndexedBitmap, ornament: number, nearness: number): void {
  const tables = draw.context.objectTables;
  const getGraphic = draw.context.getGraphicBitmap;
  const slot = draw.context.doorOrnaments?.[ornament - 1];
  if (!tables || !getGraphic || !slot) return;
  const [graphicNum, set] = slot;
  const rect = tables.doorOrnamentRectSets[set][nearness];
  const graphic = getGraphic(graphicNum);
  if (!graphic) return;

  let ornamentBitmap = graphic;
  if (nearness !== 2) {
    const cache = draw.context.graphicCache;
    const key = `doorOrnament:${graphicNum}:${set}:${nearness}`;
    const cached = cache?.get(key);
    if (cached) {
      ornamentBitmap = cached;
    } else {
      const size = tables.doorOrnamentRectSets[set][2]; // `Byte5058[18*set]`
      const colorMap = nearness === 0 ? tables.doorOrnamentColorMapF3 : tables.doorOrnamentColorMapF2;
      const cropped = cropBitmap(graphic, 2 * size.widthBytes, size.height);
      ornamentBitmap = shrinkBlt(
        cropped,
        cropped.width,
        cropped.height,
        rect.x2 - rect.x1 + 1,
        rect.height,
        colorMap
      );
      cache?.set(key, ornamentBitmap);
    }
  }

  tag0088b2Index(ornamentBitmap, door, { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, 9);
}

/**
 * `DrawDoorSwitch` (`doc/CSBwin-src/CSBCode.cpp:4065`): door switch `doorSwitchId` (0 none)
 * at `distance` (3 the nearest), graphic `315 + doorSwitchId - 1`. The nearest is
 * recorded in `doorSwitchRects`, where a click finds it.
 */
export function DrawDoorSwitch(draw: ViewportDraw, doorSwitchId: number, distance: number): void {
  if (doorSwitchId === 0) return;

  const tables = draw.context.objectTables;
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!tables || !viewport || !getGraphic) return;

  const setIndex = tables.doorSwitchRectIndex[doorSwitchId - 1] ?? 0;
  const rectSet = tables.doorSwitchRectSets[setIndex];
  const srcSet = tables.doorSwitchSourceDescSets[setIndex];
  if (distance < 0 || distance > 3) return;
  const desc = rectSet?.[distance];
  if (!desc) return;

  const graphicNum = 315 + (doorSwitchId - 1);
  const base = getGraphic(graphicNum);
  if (!base) return;

  const srcDesc = srcSet?.[0] ?? desc;
  const srcWidthBytes = srcDesc.widthBytes | 0;
  const srcWidth = srcWidthBytes > 0 ? srcWidthBytes * 2 : base.width;
  const srcHeight = (srcDesc.height | 0) > 0 ? (srcDesc.height | 0) : base.height;
  const destWidth = (desc.x2 | 0) - (desc.x1 | 0) + 1;
  const rawDestHeight = desc.height | 0;
  const destHeight = rawDestHeight > 0 ? rawDestHeight : (desc.y2 | 0) - (desc.y1 | 0) + 1;
  if (destWidth <= 0 || destHeight <= 0) return;

  let bitmap = cropBitmap(base, srcWidth, srcHeight);
  if (distance !== 3) {
    const colorMap = distance === 2 ? tables.colorMapMedium : tables.colorMapFar;
    bitmap = draw.scaleIndexedBitmap(bitmap, destWidth, destHeight, colorMap);
  }

  bltShapeToViewportIndex(bitmap, viewport, { x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });

  if (distance === 3 && draw.context.doorSwitchRects) {
    draw.context.doorSwitchRects.push({ x1: desc.x1, y1: desc.y1, x2: desc.x2, y2: desc.y2 });
  }
}

/**
 * `GraphicRandom`'s state (`doc/CSBwin-src/CSBCode.cpp:566`): a C function-static, which
 * lives for the whole process rather than one call. The teleporter's shimmer is this
 * counter advancing frame over frame, not the caller re-seeding it, so it lives at module
 * level, past the one `BytecodeInterpreter` each redraw builds, or every frame would
 * replay the same jitter and the effect would render frozen. A tool seeds it here.
 */
export const graphicRandomState = { r: 12345 };

/**
 * `GraphicRandom` (`doc/CSBwin-src/CSBCode.cpp:564`).
 *
 * `r = r * ui32(0xbb40e62d) + 11;` is a 32-bit-wraparound multiply in C — free.
 * JS's `*` operator is not: `r` and `0xbb40e62d` are each up to ~2^32, so their
 * exact product needs up to 64 bits, and a float64 mantissa only holds 53. The
 * plain multiply silently rounds away exactly the low bits `>>> 7 % n` reads: every
 * state reached is a multiple of 4096 after the previous rounding, canceling the
 * `% 32` and `% 2` of the shimmer's jitter. `Math.imul` truncates to 32 bits *before*
 * rounding, matching the C `ui32` multiply exactly (`tools/dump-graphic-random.ts`).
 * `DrawTeleporter` is its only caller in CSBWin; clouds use `viewportRandom`.
 */
export function GraphicRandom(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  graphicRandomState.r = (Math.imul(graphicRandomState.r, 0xbb40e62d) + 11) >>> 0;
  return ((graphicRandomState.r >>> 7) % maxExclusive) >>> 0;
}

/**
 * `DrawTeleporter` (`doc/CSBwin-src/CSBCode.cpp:4266`): the shimmer over `wallRect`, from
 * the overlay and mask `teleporterRect` names, jittered by `GraphicRandom`.
 */
export function DrawTeleporter(draw: ViewportDraw, teleporterRect: RectPos, wallRect: RectPos): void {
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!viewport || !getGraphic) return;

  const overlayGraphic = getGraphic((teleporterRect.x1 | 0) + 73);
  if (!overlayGraphic) return;

  let mask: IndexedBitmap | null = null;
  if (teleporterRect.y2 !== 0xff) {
    const maskGraphic = getGraphic(((teleporterRect.y2 | 0) & 0x7f) + 69);
    if (maskGraphic) {
      const widthBytes = Math.max(0, Math.floor((teleporterRect.srcWidth ?? 0) / 2));
      const height = teleporterRect.srcHeight ?? maskGraphic.height;
      const width = widthBytes * 2;
      const cropped = cropBitmap(maskGraphic, width, height);
      mask = (teleporterRect.y2 & 0x80) !== 0 ? draw.getMirroredBitmap(cropped) : cropped;
    }
  }

  const jitterX = (teleporterRect.x2 | 0) + GraphicRandom(2);
  const jitterY = GraphicRandom(32);
  const srcOffsetX = teleporterRect.srcX ?? 0;
  const srcOffsetY = teleporterRect.srcY ?? 0;

  tag008c98Index(
    overlayGraphic,
    viewport,
    mask,
    wallRect,
    jitterX,
    jitterY,
    teleporterRect.y1 | 0,
    srcOffsetX,
    srcOffsetY
  );
}
