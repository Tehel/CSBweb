/**
 * The room's contents, as `Code51a4.cpp` draws them into the viewport: `DrawRoomObjects`
 * and everything under it — the objects on the floor and in an alcove, `DrawMonster`, the
 * missiles, `DrawClouds` with the cell under the party and `TAG005088` — and
 * `GetGraphicClass`, how a flying object is drawn. The bytecode's `StdDrawRoomObjects`
 * pops its arguments and calls `DrawRoomObjects`, as CSBWin's `Interpret` does
 * (`doc/CSBwin-src/Viewport.cpp:2909-2916`).
 */

import { DescIndex } from '../../engine/objectIndex';
import {
  RN_FIREBALL, RN_LIGHTNING, RN_POISON, RN_POISON_BOLT, RN_POISON_CLOUD, isMagicSpellRn,
} from '../../core/spellRn';
import {
  bltShapeToViewportIndex,
  IDENTITY_COLOR_MAP,
  shrinkBlt,
  type IndexedBitmap,
} from '../csbwin/CanvasBlitter';
import type { DungeonState } from '../../engine/DungeonState';
import type { CreatureRecord } from '../../data/dungeonTypes';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { RectPos } from '../../data/tables/UITables';
import {
  monsterHasAttackGraphic,
  monsterHasBackGraphic,
  monsterHasSideGraphic,
  monsterHorizontalSize,
  monsterNonAttackingMirrorOK,
  monsterWord4Bit7,
  monsterWord4Bit8,
} from '../../data/tables/MonsterDesc';
import { ordinalAtPositionBytes } from '../../engine/monsterPosition';
import { decodeObjectID, DBType, OBJECT_ID_EOF, type ObjectID } from '../../core/types';
import { applyLimits } from '../../core/intCast';
import { viewportRandom, type ViewportDraw } from './ViewportDraw';
import { DrawTeleporter } from './DrawDoor';

/**
 * `GetGraphicClass` (`doc/CSBwin-src/Code51a4.cpp:2838-2870`): how a flying object is
 * drawn. A negative class `-n` is `d.struct5688[n-1]`, a missile graphic: every spell,
 * and every weapon whose `WEAPONDESC.word4` holds one in `BITS8_12` (a dagger, an arrow,
 * a sword…), which flies as that graphic and not as the object lying on the floor. A
 * class of 0 or more is the object's own `d.ObjDesc` graphic class. `null` is not an
 * object at all, which CSBWin never draws (it would read `d.ObjDesc[-1]`).
 */
export function GetGraphicClass(
  dungeon: DungeonState,
  tables: Pick<ObjectTables, 'objDescGraphicClass' | 'weaponDesc'>,
  rn: ObjectID,
): number | null {
  const category = isMagicSpellRn(rn) ? DBType.CLOUD : decodeObjectID(rn).category;
  if (category === DBType.CLOUD) {
    if (rn === RN_FIREBALL) return -11;
    if (rn === RN_POISON) return -13;
    if (rn === RN_LIGHTNING) return -4;
    if (rn === RN_POISON_BOLT) return -14;
    if (rn === RN_POISON_CLOUD) return -14;
    return -12;
  }
  if (category === DBType.WEAPON) {
    const weapon = dungeon.getWeaponRecord(rn); // TAG0099d2
    const missileGraphic = ((tables.weaponDesc[weapon?.weaponType ?? -1]?.word4 ?? 0) >> 8) & 0x1f;
    if (missileGraphic !== 0) return -missileGraphic;
  }
  const descIndex = DescIndex(dungeon, rn);
  if (descIndex === -1) return null;
  return tables.objDescGraphicClass[descIndex] ?? null;
}

enum SideOfDoor {
  NotADoor = 0,
  FarSide = 1,
  NearSide = 2,
}

export function mapColorValue(colorMap: Uint8Array, index: number): number {
  // CSBWin ShrinkBLT expects color-map entries scaled by 10 (Graphics.cpp:406-476).
  const raw = colorMap[index] ?? index;
  return Math.floor(raw / 10);
}

export function DrawRoomObjects(
  draw: ViewportDraw,
  firstObject: ObjectID,
  facing: number,
  mapX: number,
  mapY: number,
  relativeCellNumber: number,
  drawingOrder: number
): void {
  if (firstObject === OBJECT_ID_EOF) return;

  const dungeon = draw.context.dungeonState;
  const tables = draw.context.objectTables;
  if (!dungeon || !tables) {
    // (skip) missing dungeonState/objectTables
    return;
  }

  // Only the cells 0..9 draw objects, and missiles and clouds are left there too; but a
  // monster is drawn in cells 10 and 11 as well, beside the party
  // (`ProcessOnePosition`, `doc/CSBwin-src/Code51a4.cpp:2223-2224`, `:2254-2258`).
  // CSBWin draws the clouds of cells -3..-1, 10 and 11 as well (`:2769`): `DEBT.md` C94.
  if (relativeCellNumber < 0 || relativeCellNumber > 11) return;
  const objectsDrawn = relativeCellNumber <= 9;

  // CSBWin encodes door-side metadata in bit 3 (DrawRoomObjects, Code51a4.cpp:2655-2670).
  let positionList = drawingOrder & 0xffff;
  let sideOfDoor = SideOfDoor.NotADoor;
  if ((positionList & 0x8) !== 0) {
    sideOfDoor = (positionList & 1) !== 0 ? SideOfDoor.NearSide : SideOfDoor.FarSide;
    positionList = (positionList >> 4) & 0x0fff;
  }

  const drawingAlcoveObjects = positionList === 0;
  const middleLeftRight = ((relativeCellNumber + 3) % 3 + 3) % 3;
  let monsterRecord: CreatureRecord | null = null;
  let monsterState: { positions: number; facings: number; statuses: Uint8Array } | null = null;
  let missilePresent = false;
  let cloudPresent = false;

  for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category } = decodeObjectID(rn);
    // The last creature in the chain (`objMonster_54`, `Code51a4.cpp:2204-2210`).
    // `invisible()` is gated on `invisibleMonsters`, false in DM (`DEBT.md`, "The
    // monster design options"), so every creature is drawn.
    if (category === DBType.CREATURE) {
      const record = dungeon.getCreatureRecord(rn);
      if (record) {
        monsterRecord = record;
        monsterState = dungeon.getMonsterRenderState(record);
      }
    } else if (category === DBType.MISSILE) {
      missilePresent = true;
    } else if (category === DBType.CLOUD) {
      cloudPresent = true;
    }
  }

  let lastAbsPos = 0;
  if (drawingAlcoveObjects) {
    const relLoc = 4; // niche slot
    const curAbsPos = (facing + 2) & 3;
    lastAbsPos = curAbsPos;
    let currentSmallOffset = 2 + ((curAbsPos & 1) << 3);
    if (objectsDrawn) {
      drawObjectsAtPosition(draw, dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, true);
    }
    // No return: an alcove's clouds are drawn too, at `CurAbsPos = (facing+2)&3`
    // (`doc/CSBwin-src/Code51a4.cpp:2180`, `:2768-2773`). The Vi altar's lightning and
    // explosion (cloud types 100 and 101) are a cloud in the altar's alcove.
  }

  // `PositionListIndex`: which nibble is being processed, 1 for the first
  // (`Code51a4.cpp:2189`).
  let positionListIndex = 0;
  while (positionList !== 0) {
    const nibble = positionList & 0xf;
    positionList >>>= 4;
    positionListIndex++;
    if (nibble === 0) continue;

    const relLoc = (nibble - 1) & 0xf; // 0..3
    const curAbsPos = (relLoc + facing) & 3;
    lastAbsPos = curAbsPos;
    let currentSmallOffset = ((curAbsPos & 1) << 3) & 0xf;
    if (objectsDrawn) {
      drawObjectsAtPosition(draw, dungeon, tables, firstObject, relativeCellNumber, middleLeftRight, relLoc, curAbsPos, currentSmallOffset, false);
    }

    if (monsterRecord && monsterState) {
      DrawMonster(
        draw, monsterRecord, monsterState, facing, relativeCellNumber, curAbsPos, relLoc, sideOfDoor,
        middleLeftRight, positionList, positionListIndex,
      );
    }

    if (missilePresent && objectsDrawn) {
      drawMissilesAtPosition(
        draw,
        dungeon,
        tables,
        firstObject,
        curAbsPos,
        facing,
        mapX,
        mapY,
        relativeCellNumber,
        relLoc,
        middleLeftRight
      );
    }
  }

  if (cloudPresent && objectsDrawn) {
    const fluxcage = DrawClouds(draw, relativeCellNumber, firstObject, facing, lastAbsPos);
    // `if ((pdb_150!=NULL) && (sideOfDoor!=SOD_FarSideOfDoor) && (d.Word1868==0))`
    // (`doc/CSBwin-src/Code51a4.cpp:2774`).
    if (fluxcage && sideOfDoor !== SideOfDoor.FarSide && !draw.context.word1868) {
      const teleporter = draw.context.teleporterRectangles?.[relativeCellNumber];
      const wallRect = draw.context.wallRectangles[relativeCellNumber];
      if (teleporter && wallRect) {
        const shifted: RectPos = { ...teleporter, x1: (teleporter.x1 | 0) + 1 };
        DrawTeleporter(draw, shifted, wallRect);
      }
    }
  }
}

function drawObjectsAtPosition(
  draw: ViewportDraw,
  dungeon: DungeonState,
  tables: ObjectTables,
  firstObject: ObjectID,
  relativeCellNumber: number,
  middleLeftRight: number,
  relativeLocationWithinCell: number,
  curAbsPos: number,
  currentSmallOffset: number,
  drawingAlcoveObjects: boolean
): void {
  const viewportSetCount = tables.viewportPosition.length;

  for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category, position } = decodeObjectID(rn);
    if (position !== curAbsPos) continue;

    if (
      category === DBType.DOOR ||
      category === DBType.TELEPORTER ||
      category === DBType.TEXT ||
      category === DBType.ACTUATOR ||
      category === DBType.CREATURE ||
      category === DBType.MISSILE ||
      category === DBType.CLOUD
    ) {
      continue;
    }

    const descIndex = DescIndex(dungeon, rn);
    if (descIndex === -1) continue;
    const graphicClassIndex = tables.objDescGraphicClass[descIndex] ?? 0;
    const gc = tables.graphicClasses[graphicClassIndex];
    if (!gc) continue;

    let graphicNum = 360 + (gc.objectGraphicIndex & 0xff);
    const local34 = drawingAlcoveObjects && (gc.byte4 & 0x10) !== 0 && middleLeftRight === 0;
    if (local34) graphicNum++;

    const vpSet = gc.byte5;
    if (vpSet >= viewportSetCount) continue;
    const vp = tables.viewportPosition[vpSet]?.[relativeCellNumber]?.[relativeLocationWithinCell];
    if (!vp || vp.y === 0) continue;

    const rightSideOfCell = ((relativeLocationWithinCell + 1) & 2) !== 0;
    const local36 = (gc.byte4 & 1) !== 0 && !local34 && (middleLeftRight === 2 || (middleLeftRight === 0 && rightSideOfCell));

    const r = drawSingleObject(
      draw,
      tables,
      graphicNum,
      gc,
      relativeCellNumber,
      relativeLocationWithinCell,
      currentSmallOffset,
      local36,
      drawingAlcoveObjects,
      vp.x,
      vp.y,
      middleLeftRight,
      false,
      rn
    );
    currentSmallOffset = r.nextSmallOffset;
  }
}

function drawSingleObject(
  draw: ViewportDraw,
  tables: ObjectTables,
  graphicNum: number,
  gc: ObjectTables['graphicClasses'][number],
  relativeCellNumber: number,
  relativeLocationWithinCell: number,
  currentSmallOffset: number,
  mirror: boolean,
  drawingAlcoveObjects: boolean,
  baseX: number,
  baseY2: number,
  middleLeftRight: number,
  drawingMissiles: boolean,
  objRn: ObjectID
): { nextSmallOffset: number } {
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!viewport || !getGraphic) return { nextSmallOffset: currentSmallOffset };

  const nearSideOfCell = relativeLocationWithinCell >= 2;

  let distanceFromUs = 0;
  if (relativeCellNumber === 9 || (relativeCellNumber >= 6 && nearSideOfCell)) distanceFromUs = 0;
  else if (relativeCellNumber >= 6 || (relativeCellNumber >= 3 && nearSideOfCell)) distanceFromUs = 1;
  else distanceFromUs = 2;
  const touchable = distanceFromUs === 0 && middleLeftRight === 0 && !drawingMissiles;

  const src = getGraphic(graphicNum);
  if (!src) return { nextSmallOffset: currentSmallOffset };

  const scaled = getDerivedObjectBitmap(draw, tables, graphicNum, src, gc, distanceFromUs, mirror);
  if (!scaled) return { nextSmallOffset: currentSmallOffset };

  const widthBytes =
    distanceFromUs === 0
      ? gc.widthBytes
      : distanceFromUs === 1
        ? ((gc.widthBytes * 20 + 10) >> 5)
        : ((gc.widthBytes * 16 + 8) >> 5);
  const height =
    distanceFromUs === 0
      ? gc.height
      : distanceFromUs === 1
        ? ((gc.height * 20 + 10) >> 5)
        : ((gc.height * 16 + 8) >> 5);

  let xCenter = baseX;
  let y2 = baseY2;

  // Apply CSBWin "small offsets" to shift items slightly based on distance and position.
  const idxBase = ((distanceFromUs & 0xffff) << 3) & 0xff;
  const oi = currentSmallOffset & 0xf;
  const offXIndex = tables.smallOffsetIndices[oi * 2 + 0] ?? 0;
  const offYIndex = tables.smallOffsetIndices[oi * 2 + 1] ?? 0;
  xCenter += tables.smallOffsets[idxBase + offXIndex] ?? 0;
  y2 += tables.smallOffsets[idxBase + offYIndex] ?? 0;

  // Advance small-offset state (DrawSingleObject, Code51a4.cpp:1925-1940).
  currentSmallOffset = (currentSmallOffset + 1) | 0;
  if (drawingAlcoveObjects) {
    if (currentSmallOffset >= 14) currentSmallOffset = 2;
  } else {
    currentSmallOffset &= 15;
  }

  let x1 = xCenter - widthBytes + 1;
  let x2 = xCenter + widthBytes;
  let y1 = y2 - (height - 1);
  if (y2 > 135) y2 = 135;

  let srcX = 0;
  let srcY = 0;
  if (x1 < 0) {
    srcX = -x1;
    x1 = 0;
  }
  if (y1 < 0) {
    srcY = -y1;
    y1 = 0;
  }
  if (x2 > 223) x2 = 223;
  if (y2 > 135) y2 = 135;

  if (touchable && draw.context.viewportObjectButtons && draw.context.viewportObjectRNs) {
    const button = draw.context.viewportObjectButtons[relativeLocationWithinCell];
    if (button) {
      if (button.x1 === 255) {
        button.x1 = x1;
        button.x2 = x2;
        button.y1 = y1;
        button.y2 = y2;

        let height32 = button.y2 - button.y1;
        if (height32 < 14) {
          height32 >>= 1;
          button.y1 += height - 7;
          if (height32 < 4) {
            button.y2 -= height32 - 3;
          }
        }
      } else {
        button.x1 = Math.min(button.x1, x1);
        button.x2 = Math.max(button.x2, x2);
        button.y1 = Math.min(button.y1, y1);
        button.y2 = Math.max(button.y2, y2);
      }
      if (relativeLocationWithinCell < draw.context.viewportObjectRNs.length) {
        draw.context.viewportObjectRNs[relativeLocationWithinCell] = objRn;
      }
    }
  }

  bltShapeToViewportIndex(scaled, viewport, { x1, y1, x2, y2, srcX, srcY });
  return { nextSmallOffset: currentSmallOffset };
}

function decodeMonsterStatus(status: number): { attacking: boolean; mirror: boolean; nibble0: number; nibble3: number } {
  return {
    attacking: (status & 0x80) !== 0,
    mirror: (status & 0x40) !== 0,
    nibble0: status & 0x7,
    nibble3: (status >> 3) & 0x7,
  };
}

/**
 * `DrawMonster` (`doc/CSBwin-src/Code51a4.cpp:352-961`), called once per position of the
 * drawing order by `ProcessOnePosition` (`:2259-2295`).
 *
 * The first half decides *where* in the cell the group is drawn — `positionWithinCell`,
 * an index into the monster's `d.s6982` set (`MonsterXYonScreen`) — and it is not the
 * corner a member stands on. For a two-corner monster (`horizontalSize() == 1`, a rat
 * or a worm) the set is 0/1 = the cell's left/right half, 2 = the far middle (seen from
 * the side), 3 = the middle (a lone one seen from the side), 4 = the near middle. Such
 * a monster is drawn only at the position list's last far position or its end, and
 * a pair seen from the front or back is drawn both at once, the second sprite in the
 * other half (`w_94`, `:946-958`).
 *
 * `drawAsSize4()` is gated on `drawAsSize4Monsters`, false in DM (`DEBT.md`, "The
 * monster design options"), so `DrawSize4Index` is never reached.
 */
function DrawMonster(
  draw: ViewportDraw,
  monster: CreatureRecord,
  monsterState: { positions: number; facings: number; statuses: Uint8Array },
  facing: number,
  relativeCellNumber: number,
  curAbsPos: number,
  positionWithinCell: number,
  sideOfDoor: SideOfDoor,
  middleLeftRight: number,
  positionList: number,
  positionListIndex: number,
): void {
  const tables = draw.context.objectTables;
  if (!tables) return;

  // "LOCAL_96 means working on last of far positions."
  const local96 =
    (positionWithinCell <= 1 || positionListIndex === 1) &&
    (positionList === 0 || (positionList & 15) >= 3);

  const pmtDesc = tables.monsterDesc[monster.creatureType];
  if (!pmtDesc) return;
  const monsterSize = monsterHorizontalSize(pmtDesc);

  let rootIndexOfMonsterInGroup = ordinalAtPositionBytes({
    positions: monsterState.positions,
    facings: monsterState.facings,
    numMonM1: monster.numMonM1,
    horizontalSize: monsterSize,
    position: curAbsPos,
  });
  let indexWithinGroup: number;
  if (rootIndexOfMonsterInGroup !== 0) {
    // At least part of a monster is here!
    rootIndexOfMonsterInGroup--;
    indexWithinGroup = rootIndexOfMonsterInGroup;
  } else if (monsterSize === 1) {
    indexWithinGroup = -1;
  } else {
    return;
  }

  const monsterAbsFacing = (monsterState.facings >> (2 * rootIndexOfMonsterInGroup)) & 3;
  const monsterRelFacing = (facing - monsterAbsFacing) & 3; // 0=away, 1=right, 2=toward, 3=left
  let w94 = 0;
  let d4 = monsterState.positions & 0xff;
  // Several monsters that each fill the cell are invisible: "People have taken
  // advantage of this ... uh .. feature." (`:471-484`).
  if (monsterSize === 2 && d4 !== 255) return;
  if (d4 === 255) {
    // Wait until the last minute to draw a centred monster.
    if (positionList !== 0 || sideOfDoor === SideOfDoor.FarSide) return;
    positionWithinCell = monsterSize === 1 && (monsterRelFacing & 1) !== 0 ? 3 : 4;
  } else if (monsterSize === 1 && (local96 || positionList === 0 || indexWithinGroup < 0)) {
    if (local96 && sideOfDoor !== SideOfDoor.NearSide) {
      if (indexWithinGroup >= 0 && (monsterRelFacing & 1) !== 0) positionWithinCell = 2;
      else return;
    } else if (sideOfDoor !== SideOfDoor.FarSide && positionList === 0) {
      if ((monsterRelFacing & 1) !== 0) {
        if (indexWithinGroup >= 0) positionWithinCell = 4;
        else return;
      } else {
        if (indexWithinGroup < 0) indexWithinGroup = 0;
        w94 = monster.numMonM1 & 3;
        d4 = (d4 >> (2 * rootIndexOfMonsterInGroup)) & 3; // position of this monster
        positionWithinCell = d4 === facing || d4 === ((facing - 1) & 3) ? 0 : 1;
      }
    } else {
      return;
    }
  } else if (monsterSize !== 0) {
    return;
  }

  let sms = decodeMonsterStatus(monsterState.statuses[indexWithinGroup] ?? 0);
  // To our immediate left or right: our right becomes our left, our left our current cell.
  if (relativeCellNumber > 9) relativeCellNumber--;

  for (;;) {
    drawMonsterAt(draw, pmtDesc, sms, monsterRelFacing, relativeCellNumber, positionWithinCell, middleLeftRight);
    if (w94 === 0) break;
    w94 = 0;
    sms = decodeMonsterStatus(monsterState.statuses[indexWithinGroup === 0 ? 1 : 0] ?? 0);
    positionWithinCell = positionWithinCell === 1 ? 0 : 1;
  }
}

/** The body of `DrawMonster`'s drawing loop (`Code51a4.cpp:569-945`): one sprite. */
function drawMonsterAt(
  draw: ViewportDraw,
  pmtDesc: ObjectTables['monsterDesc'][number],
  sms: { attacking: boolean; mirror: boolean; nibble0: number; nibble3: number },
  monsterRelFacing: number,
  relativeCellNumber: number,
  positionWithinCell: number,
  middleLeftRight: number,
): void {
  const tables = draw.context.objectTables;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!tables || !draw.context.viewportIndexBuffer || !getGraphic) return;

  const pI12 = tables.monsterGraphics[pmtDesc.type];
  if (!pI12) return;
  const monsterXYonScreen = tables.monsterPositions[(pI12.uByte10 >> 4) & 15]?.[relativeCellNumber]?.[positionWithinCell];
  if (!monsterXYonScreen || monsterXYonScreen.y === 0) return;

  const hasSide = monsterHasSideGraphic(pmtDesc);
  const hasBack = monsterHasBackGraphic(pmtDesc);
  const hasAttack = monsterHasAttackGraphic(pmtDesc);

  let graphicNum0 = 446 + (pI12.word0 | 0);
  let showBackView = false;
  let showAttackView = false;
  let frontViewMirror = false;
  let srcByteWidth: number;
  let srcHeight: number;
  const showSideView = hasSide && (monsterRelFacing & 1) !== 0;
  if (showSideView) {
    graphicNum0++;
    srcByteWidth = pI12.sideByteWidth;
    srcHeight = pI12.sideHeight;
  } else {
    showBackView = hasBack && monsterRelFacing === 0;
    // The attacking flag is set by the AI, in `NextMonsterUpdateTime`; the renderer
    // only reads it.
    showAttackView = !showBackView && sms.attacking && hasAttack;
    if (showAttackView) {
      srcByteWidth = pI12.attackByteWidth;
      srcHeight = pI12.attackHeight;
      graphicNum0++;
      if (hasSide) graphicNum0++;
      if (hasBack) graphicNum0++;
    } else {
      srcByteWidth = pI12.frontRearByteWidth;
      srcHeight = pI12.frontRearHeight;
      if (showBackView) graphicNum0 += hasSide ? 2 : 1;
      else frontViewMirror = monsterNonAttackingMirrorOK(pmtDesc) && sms.mirror;
    }
  }

  const base = getGraphic(graphicNum0);
  if (!base) return;

  let src = base;
  let dstByteWidth = srcByteWidth;
  let dstHeight = srcHeight;
  let distanceFromUs: number;
  let transparentColor: number;
  let mirror: boolean;
  if (relativeCellNumber >= 6) {
    // Within one cell of us.
    distanceFromUs = 0;
    transparentColor = pI12.uByte10 & 15;
    mirror =
      (showSideView && monsterRelFacing === 1) ||
      (showAttackView && sms.mirror) ||
      (!showSideView && !showBackView && !showAttackView && frontViewMirror);
  } else {
    let b102: boolean;
    let scaleFactor: number;
    let distancePalette: Uint8Array;
    if (relativeCellNumber >= 3) {
      // Exactly two rows ahead.
      distanceFromUs = 1;
      b102 = monsterWord4Bit7(pmtDesc) && !showSideView && !showBackView && !showAttackView;
      distancePalette = tables.monsterColorMapMedium;
      scaleFactor = 20; // 20/32 = 0.625
    } else {
      // Three or more rows ahead.
      b102 = false;
      distanceFromUs = 2;
      frontViewMirror = false;
      distancePalette = tables.monsterColorMapFar;
      scaleFactor = 16; // 16/32 = 0.5
    }
    dstByteWidth = (srcByteWidth * scaleFactor + (scaleFactor >> 1)) >> 5;
    dstHeight = (srcHeight * scaleFactor + (scaleFactor >> 1)) >> 5;
    transparentColor = mapColorValue(distancePalette, pI12.uByte10 & 15);
    src = shrinkBlt(base, base.width, base.height, Math.max(1, dstByteWidth * 2), Math.max(1, dstHeight), distancePalette);
    // The last term can never hold, since `frontViewMirror` needs
    // `NonAttackingMirrorOK()`: a front view is not mirrored beyond the first row
    // (`:859-864`). The 68000 code in the comment above it tests `(word4 & 4) != 0`.
    mirror =
      (showSideView && monsterRelFacing === 1) ||
      (showAttackView && sms.mirror) ||
      (b102 && monsterWord4Bit8(pmtDesc)) ||
      (frontViewMirror && !monsterNonAttackingMirrorOK(pmtDesc));
  }
  // CSBWin's `Mirror` moves the row padding to the left and reads past it (`w_90`); the
  // port's bitmaps are unpadded, so there is nothing to skip.
  if (mirror) src = draw.getMirroredBitmap(src);

  let d4 = monsterXYonScreen.y + (tables.smallOffsets[sms.nibble3] ?? 0);
  const y2 = Math.min(d4, 135);
  const y1 = Math.max(0, d4 - dstHeight + 1);
  d4 = monsterXYonScreen.x + (tables.smallOffsets[(distanceFromUs << 3) + sms.nibble0] ?? 0);
  if (middleLeftRight === 1) d4 -= 100; // Left side
  else if (middleLeftRight !== 0) d4 += 100; // Right side
  const x2 = applyLimits(0, d4 + dstByteWidth, 223);
  if (x2 === 0) return;
  const x1 = applyLimits(0, d4 - dstByteWidth + 1, 223);
  if (x1 === 223) return;
  const srcX = x1 !== 0 ? 0 : dstByteWidth - d4 - 1;
  // `TAG0088b2(..., srcOffsetX, 0, ...)`: a sprite cut at the top loses its bottom rows.
  draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX, srcY: 0 }, transparentColor);
}

export function drawMissilesAtPosition(
  draw: ViewportDraw,
  dungeon: DungeonState,
  tables: ObjectTables,
  firstObject: ObjectID,
  curAbsPos: number,
  facing: number,
  mapX: number,
  mapY: number,
  relativeCellNumber: number,
  relativeLocation: number,
  middleLeftRight: number,
): void {
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!viewport || !getGraphic) return;

  const vp = tables.viewportPosition[0]?.[relativeCellNumber]?.[relativeLocation];
  const centerX = vp?.x ?? 0;
  if (centerX === 0) return;

  for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category, position } = decodeObjectID(rn);
    if (category !== DBType.MISSILE || position !== curAbsPos) continue;
    const missile = dungeon.getMissileRecord(rn);
    if (!missile) continue;

    const graphicClass = GetGraphicClass(dungeon, tables, missile.projectileObject);
    if (graphicClass === null) continue;
    if (graphicClass >= 0) {
      const gc = tables.graphicClasses[graphicClass];
      if (!gc) continue;
      const graphicNum = 360 + (gc.objectGraphicIndex & 0xff);
      drawSingleObject(
        draw,
        tables,
        graphicNum,
        gc,
        relativeCellNumber,
        relativeLocation,
        0,
        false,
        false,
        centerX,
        47,
        middleLeftRight,
        true,
        rn
      );
      continue;
    }

    const idx = -graphicClass - 1;
    const md = tables.missileGraphics[idx];
    if (!md) continue;

    const word4 = md.word4 & 0xffff;
    const w126 = word4 & 0x3;
    const w130 = (word4 & 0x100) === 0;
    const w140 = w126 === 0;
    const w138 = w140 ? ((mapX + mapY) & 1) : 0;

    const timerWord8 = dungeon.getTimerWord8(missile.timerIndex);
    if (timerWord8 === null) continue;
    const w124 = (timerWord8 >> 10) & 0x3;

    let w128 = 0;
    let mirror = false;
    let flip = false;

    if (w126 === 3) {
      w128 = 0;
      mirror = false;
      flip = false;
    } else if (((w124 & 1) !== (facing & 1))) {
      w128 = w126 === 2 ? 1 : 2;
      if (w140) {
        mirror = relativeLocation === 0 || relativeLocation === 3;
        flip = w138 !== 0;
        if (!flip) mirror = !mirror;
      } else {
        flip = false;
        mirror = ((facing + 1) & 3) === w124;
      }
    } else {
      if (w126 >= 2 || (w126 === 1 && w124 !== facing) || (w140 && w138 !== 0)) w128 = 0;
      else w128 = 1;

      flip = w140 && relativeLocation < 2;
      if (word4 !== 0) {
        let cond = false;
        if (middleLeftRight === 2) cond = true;
        else if (middleLeftRight === 0) cond = relativeLocation === 1 || relativeLocation === 2;
        mirror = !cond;
      }
    }

    // w_112: a missile in the party's own cell is drawn at full size when its size does
    // not follow its range, or when it has just been launched (`Code51a4.cpp:2327-2336`).
    const distanceFromUs = 2 * Math.floor(relativeCellNumber / 3) + Math.floor(relativeLocation / 2);
    let scale = 0;
    if (!((w130 || (missile.rangeRemaining & 0xff) === 255) && relativeCellNumber === 9)) {
      scale = tables.missileScale[distanceFromUs] ?? 0;
      if (!w130) {
        const range = missile.rangeRemaining & 0xff;
        const w192 = Math.max(96, range + 1);
        scale = Math.floor((scale * w192) >> 8);
      }
    }

    const baseGraphicNum = 316 + (md.uByte0 & 0xff) + w128;
    const base = getGraphic(baseGraphicNum);
    if (!base) continue;

    let widthBytes = md.widthBytes;
    let height = md.height;
    let src = base;

    if (scale > 0) {
      widthBytes = Math.max(1, (md.widthBytes * scale + (scale >> 1)) >> 5);
      height = Math.max(1, (md.height * scale + (scale >> 1)) >> 5);
      const dstWidth = widthBytes * 2;
      const colorMap = distanceFromUs >= 2 ? tables.colorMapFar : tables.colorMapMedium;
      src = shrinkBlt(base, base.width, base.height, dstWidth, height, colorMap);
    }

    if (mirror) src = draw.getMirroredBitmap(src);
    if (flip) src = draw.getFlippedBitmapVertical(src);
    // LOCAL_30, set only for a shrunk missile (`Code51a4.cpp:2470-2473`): CSBWin's rows
    // are padded to 16 pixels and `Mirror` moves the padding to the left, so the blit
    // skips it. Our bitmaps are unpadded: we read LOCAL_30 fewer, as `DrawClouds` does.
    const mirrorPad = mirror && scale !== 0 ? 2 * (7 - ((widthBytes - 1) & 7)) : 0;

    // `Code51a4.cpp:2536-2555`.
    const y2 = 47 + (height >> 1);
    const y1 = 47 - (height >> 1) + ((height & 1) === 0 ? 1 : 0);
    const x2 = Math.min(223, centerX + widthBytes);
    const x1 = Math.max(0, centerX - widthBytes + 1);
    const srcX = x1 !== 0 ? mirrorPad : Math.max(mirrorPad, widthBytes - centerX - 1);

    draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
  }
}

/**
 * `DrawClouds` (`doc/CSBwin-src/Code51a4.cpp:76-321`). Returns whether a Fluxcage stands
 * in the cell (CSBWin returns its record, `pdb_150`).
 */
export function DrawClouds(draw: ViewportDraw, relativeCellNumber: number, firstObject: ObjectID, facing: number, curAbsPos: number): boolean {
  const tables = draw.context.objectTables;
  const dungeon = draw.context.dungeonState;
  const viewport = draw.context.viewportIndexBuffer;
  const getGraphic = draw.context.getGraphicBitmap;
  if (!tables || !dungeon || !viewport || !getGraphic) return false;

  const relCell = relativeCellNumber + 3; // RelativeCellNumber
  const relCellGroup = Math.floor(relCell / 3); // RelativeCell_46
  let fluxcage = false;

  for (let rn = firstObject; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category, position } = decodeObjectID(rn);
    if (category !== DBType.CLOUD) continue;
    const cloud = dungeon.getCloudRecord(rn);
    if (!cloud) continue;

    let d4 = cloud.cloudType | 0; // D4W
    const isSpecial = d4 >= 100; // w_160
    if (isSpecial && (relCell < 3 || relCell > 9 || position !== curAbsPos)) continue;
    let poison = false; // w_162

    let base: IndexedBitmap | null;
    let halfWidth: number; // LOCAL_22
    let height: number; // LOCAL_24
    let px: number; // pw_154[0]
    let py: number; // pw_154[1]

    if (d4 === 100) {
      // Lightning: graphic, size and position all from d.Word7246 (`:139-170`).
      const gc = GetGraphicClass(dungeon, tables, RN_LIGHTNING)!;
      const md = tables.missileGraphics[-gc - 1];
      if (!md) continue;
      base = getGraphic((md.uByte0 & 0xff) + 317);
      if (!base) continue;
      const pw = 3 * (relCell - 3);
      const scale = tables.cloudPositions7246[pw + 2] ?? 0;
      halfWidth = (md.widthBytes * scale + (scale >> 1)) >> 5;
      height = (md.height * scale + (scale >> 1)) >> 5;
      if (relCell !== 9) base = shrinkBlt(base, base.width, base.height, 2 * halfWidth, height, IDENTITY_COLOR_MAP);
      px = tables.cloudPositions7246[pw] ?? 0;
      py = tables.cloudPositions7246[pw + 1] ?? 0;
    } else {
      if (d4 === 0 || d4 === 2 || d4 === 101) {
        d4 = 0;
      } else if (d4 === 6 || d4 === 7) {
        d4 = 2;
      } else if (d4 === 40) {
        poison = true;
        d4 = 3;
      } else if (d4 === 50) {
        if (relCell >= 4) fluxcage = true;
        continue;
      } else {
        d4 = 1;
      }

      // tag006774
      if (relCell === 12) {
        drawCloudUnderParty(draw, d4, poison, cloud.value, tables, getGraphic);
        continue;
      }

      let scale: number; // w_156
      if (isSpecial) {
        const pw = 3 * relCell;
        px = tables.cloudPositions7222[pw] ?? 0;
        py = tables.cloudPositions7222[pw + 1] ?? 0;
        scale = tables.cloudPositions7222[pw + 2] ?? 0;
      } else {
        if (cloud.bit7) {
          px = tables.cloudPositions7042[2 * relCell] ?? 0;
          py = tables.cloudPositions7042[2 * relCell + 1] ?? 0;
        } else {
          const side = position === facing || position === ((facing - 1) & 3) ? 0 : 1;
          const pw = 4 * relCell + 2 * side;
          px = tables.cloudPositions7162[pw] ?? 0;
          py = tables.cloudPositions7162[pw + 1] ?? 0;
        }
        const d0 = Math.max(48, cloud.value + 1);
        const d1 = tables.cloudScale[relCellGroup] ?? 0;
        scale = Math.max(4, (d1 * d0) >> 8) & 0xfffe;
      }

      const shape = TAG005088(draw, d4, scale, tables, getGraphic);
      if (!shape) continue;
      ({ base, halfWidth, height } = shape);
    }

    // tag006932 (`doc/CSBwin-src/Code51a4.cpp:257-313`). Both coin flips come from
    // the viewport's stream, the flip first; `GraphicRandom` is DrawTeleporter's alone.
    const flip = viewportRandom.bool() !== 0; // w_142 → TAG008840
    const mirror = viewportRandom.bool() !== 0; // LOCAL_36 → Mirror
    // LOCAL_30: CSBWin's rows are padded to 16 pixels and `Mirror` moves the padding to
    // the left, so the blit skips it. Our bitmaps are unpadded: we read LOCAL_30 fewer.
    const mirrorPad = mirror ? 2 * (7 - ((halfWidth - 1) & 7)) : 0;

    const y2 = Math.min(135, py + (height >> 1));
    const y1 = Math.max(0, py - (height >> 1) + ((height & 1) === 0 ? 1 : 0));
    if (y1 >= 136) continue;
    const x2 = Math.min(223, px + halfWidth);
    if (x2 < 0) continue;
    const x1 = applyLimits(0, px - halfWidth + 1, 223);
    const srcX = x1 !== 0 ? mirrorPad : Math.max(mirrorPad, halfWidth - px - 1);
    if (!(x2 > x1)) continue;

    let src = base;
    if (mirror) src = draw.getMirroredBitmap(src);
    if (flip) src = draw.getFlippedBitmapVertical(src);
    draw.blitShapeToViewportIndexWithTransparent(src, { x1, y1, x2, y2, srcX: srcX - mirrorPad }, 10);
  }

  return fluxcage;
}

/**
 * `TAG005088` (`doc/CSBwin-src/Code51a4.cpp:21-74`): cloud graphic `type` at `scale`/32.
 * The scale is clamped to 32, not the size; full size is the graphic itself, except
 * for type 3 (poison), which is always recoloured through `d.Byte5712`. Types 0-2 are
 * shrunk through `d.IdentityColorMap`, and type 3 borrows type 2's graphic (350).
 */
function TAG005088(
  draw: ViewportDraw,
  type: number,
  scale: number,
  tables: ObjectTables,
  getGraphic: (graphicNum: number) => IndexedBitmap | null
): { base: IndexedBitmap; halfWidth: number; height: number } | null {
  const p2 = Math.min(32, scale);
  const a0 = tables.cloudScaleBase[2 * type] ?? 0; // d.Byte5696[2*type]
  const a1 = tables.cloudScaleBase[2 * type + 1] ?? 0;
  const halfWidth = Math.trunc((p2 * a0 + Math.trunc(p2 / 2)) / 32); // D6W
  const height = Math.trunc((p2 * a1 + Math.trunc(p2 / 2)) / 32); // D5W
  if (p2 === 32 && type !== 3) {
    const base = getGraphic(type + 348);
    return base ? { base, halfWidth, height } : null;
  }
  // The derived graphic's number, `14*type + P2/2 + 436`, keys our cache.
  const key = `derived:${14 * type + Math.trunc(p2 / 2) + 436}`;
  const cache = draw.context.graphicCache;
  let base = cache?.get(key) ?? null;
  if (!base) {
    const src = getGraphic(Math.min(type, 2) + 348);
    if (!src) return null;
    const colorMap = type === 3 ? tables.cloudColorMap : IDENTITY_COLOR_MAP;
    base = shrinkBlt(src, src.width, src.height, 2 * halfWidth, height, colorMap);
    cache?.set(key, base);
  }
  return { base, halfWidth, height };
}

/**
 * `DrawClouds`' cell under the party (`doc/CSBwin-src/Code51a4.cpp:178-218`): one of
 * graphics 351-359 (48×31), picked by type and `value >> 5`, the poison one recoloured
 * through `d.Byte5712`, laid over `d.Word2530` by `TAG008c98`
 * (`doc/CSBwin-src/Graphics.cpp:1169`), transparent colour 10.
 *
 * `TAG008c98` fills the rectangle 16 pixels at a time, row by row, from the graphic
 * read as one run of 16-pixel groups: it starts at group `STRandom() & 63` and wraps
 * back to group 0 on reaching group `STRandom0_3() + 87`. Both draws are from the
 * viewport's stream. C++ leaves argument evaluation order unspecified; the port takes
 * right to left, the 68000 original's and the x86 compilers' order, so `STRandom()`
 * is drawn first.
 */
function drawCloudUnderParty(
  draw: ViewportDraw,
  d4: number,
  poison: boolean,
  value: number,
  tables: ObjectTables,
  getGraphic: (graphicNum: number) => IndexedBitmap | null
): void {
  if (poison) d4--;
  d4 *= 3;
  const d5 = value >> 5;
  if (d5 !== 0) {
    d4++;
    if (d5 > 3) d4++;
  }
  let src = getGraphic(d4 + 351);
  if (!src) return;
  // CSBWin shrinks 48×32 to 48×32 — a pure recolour. The graphics are 48×31, and
  // `GetBasicGraphicAddress(n, 48, 32)` pads the buffer with a garbage row
  // (`doc/CSBwin-src/Graphics.cpp:2560-2570`), which the tiling never reaches: it wraps
  // within 90 groups, 30 rows. Recolouring at the graphic's own size keeps every row.
  if (poison) src = shrinkBlt(src, src.width, src.height, src.width, src.height, tables.cloudColorMap);

  const start = viewportRandom.next() & 63; // P7
  const wrap = viewportRandom.zeroTo3() + 87; // P6

  const rect = tables.cloudUnderPartyRect; // d.Word2530
  const groupsPerRow = Math.trunc((rect.x2 - rect.x1) / 16) + 1; // w_2
  const rows = rect.y2 - rect.y1 + 1;
  const srcGroupsPerRow = (src.width + 15) >> 4;
  const out = new Uint8Array(groupsPerRow * 16 * rows);
  let group = start;
  for (let k = 0; k < groupsPerRow * rows; k++) {
    const srcRow = Math.floor(group / srcGroupsPerRow);
    const srcCol = (group % srcGroupsPerRow) * 16;
    const dstOff = Math.floor(k / groupsPerRow) * groupsPerRow * 16 + (k % groupsPerRow) * 16;
    for (let i = 0; i < 16; i++) {
      const x = srcCol + i;
      out[dstOff + i] = x < src.width && srcRow < src.height ? src.pixels[srcRow * src.width + x] : 0;
    }
    if (++group === wrap) group = 0;
  }
  const derived: IndexedBitmap = { width: groupsPerRow * 16, height: rows, pixels: out };
  draw.blitShapeToViewportIndexWithTransparent(derived, { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, 10);
}

function getDerivedObjectBitmap(
  draw: ViewportDraw,
  tables: ObjectTables,
  graphicNum: number,
  src: IndexedBitmap,
  gc: ObjectTables['graphicClasses'][number],
  distanceFromUs: number,
  mirror: boolean
): IndexedBitmap | null {
  const cache = draw.context.graphicCache;
  const key = `obj:${graphicNum}:${distanceFromUs}:${mirror ? 1 : 0}`;
  if (cache) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  let out: IndexedBitmap;
  if (distanceFromUs === 0) {
    out = mirror ? draw.getMirroredBitmap(src) : src;
  } else {
    const dstWidthBytes = distanceFromUs === 1 ? ((gc.widthBytes * 20 + 10) >> 5) : ((gc.widthBytes * 16 + 8) >> 5);
    const dstHeight = distanceFromUs === 1 ? ((gc.height * 20 + 10) >> 5) : ((gc.height * 16 + 8) >> 5);
    const dstWidth = dstWidthBytes * 2;
    const colorMap = distanceFromUs === 1 ? tables.colorMapMedium : tables.colorMapFar;
    const scaled = shrinkBlt(src, src.width, src.height, dstWidth, dstHeight, colorMap);
    out = mirror ? draw.getMirroredBitmap(scaled) : scaled;
  }

  cache?.set(key, out);
  return out;
}
