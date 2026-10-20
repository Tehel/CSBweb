import { DBType, OBJECT_ID_EOF, type ui8, Position, RoomType } from '../../core/types';
import { GraphicRoomType, ViewRoomType, type SummarizeRoomData } from '../bytecode/Types';
import { ECF_FOOTPRINTS, type DungeonState } from '../../engine/DungeonState';
import type { PartyFootprints } from '../../engine/PartyFootprints';
import {
  getActuatorDsaParameters,
  getActuatorDsaSelector,
  getActuatorState,
  getActuatorType,
  getActuatorValue,
  getActuatorWallGraphicOrdinal,
} from '../../data/actuatorHelpers';
import type { ObjectTables } from '../../data/tables/ObjectTables';

const RN_EOF = OBJECT_ID_EOF;
const PORTRAIT_HIDE_PORTRAIT = 2;
const PORTRAIT_HIDE_GRAPHIC = 4;

// Port of `graphicRoomTypes[]` table in `doc/CSBwin-src/Codea59a.cpp:197-219`.
const graphicRoomTypes: number[] = (() => {
  const map = new Array<number>(21).fill(255);
  map[RoomType.STONE] = GraphicRoomType.STONE;
  map[RoomType.OPEN] = GraphicRoomType.OPEN;
  map[RoomType.PIT] = GraphicRoomType.PIT;
  map[RoomType.TELEPORTER] = GraphicRoomType.TELEPORTER;
  map[ViewRoomType.DOOR_EDGE] = GraphicRoomType.DOOR_EDGE;
  map[ViewRoomType.DOOR_FACING] = GraphicRoomType.DOOR_FACING;
  map[ViewRoomType.STAIR_EDGE] = GraphicRoomType.STAIR_EDGE;
  map[ViewRoomType.STAIR_FACING] = GraphicRoomType.STAIR_FACING;
  return map;
})();

// Port of `GetCellFlags()` boundary behavior used by viewport rendering (CSBCode.cpp:4674-4727).
function getCellFlagsViewport(dungeon: DungeonState, position: Position): number {
  const { x, y, z } = position;
  const map = dungeon.getMap(z);
  if (!map) return 0;
  const w = map.descriptor.width;
  const h = map.descriptor.height;
  const legalX = x >= 0 && x < w;
  const legalY = y >= 0 && y < h;

  if (legalX && legalY) return map.cellFlags[x][y];

  // For illegal coordinates, CSBWin returns a "stone" CELLFLAG with a single side-bit set
  // (1/2/4/8) when the adjacent in-bounds cell is OPEN or PIT, so exterior walls can host random decorations.
  if (legalY) {
    if (x === -1) {
      const rt = (map.cellFlags[0][y] >> 5) & 7;
      if (rt === RoomType.OPEN || rt === RoomType.PIT) return 4;
      return 0;
    }
    if (x === w) {
      const rt = (map.cellFlags[w - 1][y] >> 5) & 7;
      if (rt === RoomType.OPEN || rt === RoomType.PIT) return 1;
      return 0;
    }
    return 0;
  }

  if (legalX) {
    if (y === -1) {
      const rt = (map.cellFlags[x][0] >> 5) & 7;
      if (rt === RoomType.OPEN || rt === RoomType.PIT) return 2;
      return 0;
    }
    if (y === h) {
      const rt = (map.cellFlags[x][h - 1] >> 5) & 7;
      if (rt === RoomType.OPEN || rt === RoomType.PIT) return 8;
      return 0;
    }
    return 0;
  }

  return 0;
}

function hashDecoration(p1: number, p2: number, probability: number, sentinel: number): number {
  let d0w = ((p1 & 0xffff) * 31417) & 0xffff;
  d0w = (d0w >> 1) & 0x7fff;
  const d1w = ((p2 & 0xffff) * 11) & 0xffff;
  d0w = (d0w + d1w + (sentinel & 0xffff)) & 0xffff;
  d0w = (d0w >> 2) & 0x3fff;
  if ((probability & 0xffff) === 0) return 0;
  return d0w % (probability & 0xffff);
}

function randomWallDecorationCsbwin(
  sideMask: number,
  numDecoration: number,
  mapX: number,
  mapY: number,
  facing: number,
  rotate: number,
  sentinel: number,
  mapWidth: number,
  mapHeight: number,
  probability: number,
  loadedLevel: number
): number {
  if (sideMask === 0) return 0;
  const hash = hashDecoration(
    2000 + (mapX << 5) + (mapY + 1) * (((facing + rotate) & 3) + 1),
    3000 + ((loadedLevel << 6) & 0xffff) + mapWidth + mapHeight,
    probability,
    sentinel
  );
  if (hash < numDecoration) return (hash + 1) | 0;
  return 0;
}

function randomFloorDecorationCsbwin(
  sideMask: number,
  numDecoration: number,
  mapX: number,
  mapY: number,
  sentinel: number,
  mapWidth: number,
  mapHeight: number,
  probability: number,
  loadedLevel: number
): number {
  if (sideMask === 0) return 0;
  const hash = hashDecoration(
    2000 + (mapX << 5) + mapY,
    3000 + ((loadedLevel << 6) & 0xffff) + mapWidth + mapHeight,
    probability,
    sentinel
  );
  if (hash < numDecoration) return (hash + 1) | 0;
  return 0;
}

function isAlcoveDecorationOrdinal(
  tables: ObjectTables | undefined,
  mapWallDecorationTOC: ui8[] | undefined,
  decorationOrdinal: number
): boolean {
  if (!tables || !mapWallDecorationTOC) return false;
  if (decorationOrdinal <= 0) return false;
  const index = decorationOrdinal - 1;
  if (index < 0 || index >= mapWallDecorationTOC.length) return false;
  const decorationIndex = mapWallDecorationTOC[index] ?? 0xff;
  for (let i = 0; i < tables.alcoveDecorationIndices.length; i++) {
    const alcoveIndex = tables.alcoveDecorationIndices[i] ?? 0xff;
    if (decorationIndex === alcoveIndex) return true;
  }
  return false;
}


function summarizeStoneRoom(
  rslt: SummarizeRoomData,
  dungeon: DungeonState,
  position: Position,
  facing: number,
  falseStoneWall: boolean,
  tables?: ObjectTables
): void {
  const { x, y, z } = position;
  const map = dungeon.getMap(z);
  const sentinel = dungeon.getData().header.randomSeed ?? 0;
  const mapWidth = map?.descriptor.width ?? 0;
  const mapHeight = map?.descriptor.height ?? 0;
  const numWallDecoration = map?.descriptor.wallGraphicsCount ?? 0;
  const numRandomWallDecoration = map?.descriptor.wallDecorationCount ?? 0;
  const levelNumber = map?.descriptor.level ?? z;
  const pos = new Position(rslt.x, rslt.y, z)
  const cellFlags = getCellFlagsViewport(dungeon, pos);

  let local = dungeon.findFirstObject(pos);

  rslt.roomType = RoomType.STONE;
  rslt.championPortraitOrdinal = 0;

  // Port of CSBWin TAG00a4a2 random wall decorations (Codea59a.cpp:76, CSBCode.cpp:5779+).
  let rightCFmask = cellFlags & 8;
  let rearCFmask = cellFlags & 8;
  let leftCFmask = cellFlags & 8;
  if (!falseStoneWall) {
    switch (facing & 3) {
      case 0:
        rightCFmask = cellFlags & 4;
        rearCFmask = cellFlags & 2;
        leftCFmask = cellFlags & 1;
        break;
      case 1:
        rightCFmask = cellFlags & 2;
        rearCFmask = cellFlags & 1;
        leftCFmask = cellFlags & 8;
        break;
      case 2:
        rightCFmask = cellFlags & 1;
        rearCFmask = cellFlags & 8;
        leftCFmask = cellFlags & 4;
        break;
      case 3:
        rightCFmask = cellFlags & 8;
        rearCFmask = cellFlags & 4;
        leftCFmask = cellFlags & 2;
        break;
      default:
        break;
    }
  }

  if (map && numRandomWallDecoration > 0) {
    rslt.decorations[0] = randomWallDecorationCsbwin(
      rightCFmask,
      numRandomWallDecoration,
      rslt.x,
      rslt.y,
      facing,
      1,
      sentinel,
      mapWidth,
      mapHeight,
      30,
      z
    );
    rslt.decorations[1] = randomWallDecorationCsbwin(
      rearCFmask,
      numRandomWallDecoration,
      rslt.x,
      rslt.y,
      facing,
      2,
      sentinel,
      mapWidth,
      mapHeight,
      30,
      z
    );
    rslt.decorations[2] = randomWallDecorationCsbwin(
      leftCFmask,
      numRandomWallDecoration,
      rslt.x,
      rslt.y,
      facing,
      3,
      sentinel,
      mapWidth,
      mapHeight,
      30,
      z
    );

    if (
      falseStoneWall ||
      rslt.x < 0 ||
      rslt.x >= mapWidth ||
      rslt.y < 0 ||
      rslt.y >= mapHeight
    ) {
      for (let i = 0; i < 3; i++) {
        if (isAlcoveDecorationOrdinal(tables, map.wallDecorationTOC, rslt.decorations[i] ?? 0)) {
          rslt.decorations[i] = 0;
        }
      }
    }
  }

  const realDecoration = [false, false, false];

  // Detect wall text objects and actuator-driven wall decorations.
  while (local !== RN_EOF && dungeon.rnMaps.dbType(local) <= DBType.ACTUATOR) {
    const dbType = dungeon.rnMaps.dbType(local);

    // CSBWin tolerates bad dungeons that put doors/teleporters in stone (Codea59a.cpp:89-93).
    if (dbType === DBType.DOOR || dbType === DBType.TELEPORTER) {
      local = dungeon.getDBRecordLink(local);
      continue;
    }

    const relativePosition = (dungeon.rnMaps.pos(local) - (facing & 3)) & 3;
    if (relativePosition !== 0) {
      if (dbType === DBType.TEXT) {
        const rec = dungeon.getTextRecord(local);
        if (rec?.visible) {
          // relativePosition: 1=right, 2=front, 3=left
          rslt.text[(relativePosition - 1) as 0 | 1 | 2] = local;
        }
      } else if (dbType === DBType.ACTUATOR) {
        const rec = dungeon.getActuatorRecord(local);
        if (rec) {
          if (getActuatorType(rec) === 47) {
            const selector = getActuatorDsaSelector(rec);
            const absIndex = dungeon.getDsaLevelIndex(levelNumber, selector);
            if (absIndex === 255) {
              const { paramA } = getActuatorDsaParameters(rec);
              rslt.decorations[(relativePosition - 1) as 0 | 1 | 2] = 0x10000 | (paramA & 0xffff);
              realDecoration[(relativePosition - 1) as 0 | 1 | 2] = true;
            }
          } else if (getActuatorType(rec) !== 127 || (getActuatorState(rec) & PORTRAIT_HIDE_GRAPHIC) === 0) {
            // Every actuator on the face writes its ordinal, 0 included, so the last one
            // wins: an ornament-less actuator after an alcove hides it until
            // `RotateActuatorList` moves the alcove behind it. One past the level's wall
            // decorations is written as 0 (doc/CSBwin-src/Codea59a.cpp:134-153).
            const ord = getActuatorWallGraphicOrdinal(rec) | 0;
            rslt.decorations[(relativePosition - 1) as 0 | 1 | 2] = ord > numWallDecoration ? 0 : ord;
            realDecoration[(relativePosition - 1) as 0 | 1 | 2] = true;
          }
          if (getActuatorType(rec) === 127 && relativePosition === 2) {
            if ((getActuatorState(rec) & PORTRAIT_HIDE_PORTRAIT) === 0) {
              rslt.championPortraitOrdinal = (getActuatorValue(rec) & 0x1ff) + 1;
            }
          }
        }
      }
    }

    local = dungeon.getDBRecordLink(local);
  }

  for (let i = 0; i < 3; i++) {
    if (rslt.text[i] !== RN_EOF && !realDecoration[i]) {
      rslt.decorations[i] = 0;
    }
  }

  if (falseStoneWall) {
    // Port of CSBWin's visibility restriction for fake stone (Codea59a.cpp:181-193).
    if (x !== rslt.x && y !== rslt.y) {
      rslt.rn2 = RN_EOF;
      return;
    }
  }

  rslt.rn2 = local;
}

export function summarizeRoomInfoCsbwin(
  rslt: SummarizeRoomData,
  dungeon: DungeonState,
  position: Position,
  facing: number,
  tables?: ObjectTables,
  footprints?: PartyFootprints,
  time = 0,
): void {
  const { z } = position;
  rslt.text = [RN_EOF, RN_EOF, RN_EOF];
  rslt.decorations = [0, 0, 0];
  rslt.rn2 = RN_EOF;
  rslt.championPortraitOrdinal = 0;

  const map = dungeon.getMap(z);
  const sentinel = dungeon.getData().header.randomSeed ?? 0;
  const mapWidth = map?.descriptor.width ?? 0;
  const mapHeight = map?.descriptor.height ?? 0;
  const numFloorDecorations = map?.descriptor.floorGraphicsCount ?? 0;
  const numRandomFloorDecorations = map?.descriptor.floorDecorationCount ?? 0;
  const levelNumber = map?.descriptor.level ?? z;
  const pos = new Position(rslt.x, rslt.y, z)

  let cellFlags = getCellFlagsViewport(dungeon, pos);
  const baseRoomType = ((cellFlags >> 5) & 7) as RoomType;
  rslt.roomType = baseRoomType;

  const firstObject = dungeon.findFirstObject(pos);
  let local = firstObject;
  let skipLowDbForRn2 = true;
  let scanFloorDecorations = false;

  switch (baseRoomType) {
    case RoomType.STONE: {
      summarizeStoneRoom(rslt, dungeon, position, facing, false, tables);
      rslt.graphicRoomType = graphicRoomTypes[rslt.roomType] as GraphicRoomType;
      return;
    }

    case RoomType.PIT: {
      // Codea59a.cpp:263-276
      if ((cellFlags & 8) !== 0) {
        rslt.decorations[0] = cellFlags & 4;
        cellFlags &= 1;
      } else {
        rslt.roomType = RoomType.OPEN;
        cellFlags = 1;
      }
      skipLowDbForRn2 = false;
      scanFloorDecorations = true;
      break;
    }

    case RoomType.FALSEWALL: {
      // Codea59a.cpp:278-297
      if ((cellFlags & 4) === 0) {
        summarizeStoneRoom(rslt, dungeon, position, facing, true, tables);
        rslt.graphicRoomType = graphicRoomTypes[rslt.roomType] as GraphicRoomType;
        return;
      }
      rslt.roomType = RoomType.OPEN;
      cellFlags = (cellFlags & 8) !== 0 ? 8 : 0;
      // Falls through into `roomOPEN`, and on to `tag00a85c`'s `cfD4 = 1`.
      if (map && numRandomFloorDecorations > 0) {
        rslt.decorations[2] = randomFloorDecorationCsbwin(
          cellFlags & 8,
          numRandomFloorDecorations,
          rslt.x,
          rslt.y,
          sentinel,
          mapWidth,
          mapHeight,
          30,
          z
        );
      }
      cellFlags = 1;
      skipLowDbForRn2 = false;
      scanFloorDecorations = true;
      break;
    }

    case RoomType.OPEN: {
      // Codea59a.cpp:299-351
      if (map && numRandomFloorDecorations > 0) {
        rslt.decorations[2] = randomFloorDecorationCsbwin(
          cellFlags & 8,
          numRandomFloorDecorations,
          rslt.x,
          rslt.y,
          sentinel,
          mapWidth,
          mapHeight,
          30,
          z
        );
      }
      cellFlags = 1;
      local = firstObject;
      skipLowDbForRn2 = false;
      scanFloorDecorations = true;
      break;
    }

    case RoomType.TELEPORTER: {
      // Codea59a.cpp:354-358
      rslt.decorations[0] = (cellFlags & 0x0c) === 0x0c ? 1 : 0;
      cellFlags = 1;
      local = firstObject;
      skipLowDbForRn2 = false;
      scanFloorDecorations = true;
      break;
    }

    case RoomType.STAIRS: {
      // Codea59a.cpp:359-374
      const nsTravel = (cellFlags & 8) >> 3;
      const facingIsNS = facing & 1;
      rslt.roomType = facingIsNS === nsTravel ? ViewRoomType.STAIR_EDGE : ViewRoomType.STAIR_FACING;
      rslt.decorations[0] = cellFlags & 4;
      cellFlags = 0;
      break;
    }

    case RoomType.DOOR: {
      // Codea59a.cpp:376-390
      const nsDoor = (cellFlags & 8) >> 3;
      const facingIsNS = facing & 1;
      if (nsDoor === facingIsNS) {
        rslt.roomType = ViewRoomType.DOOR_EDGE;
      } else {
        rslt.roomType = ViewRoomType.DOOR_FACING;
        rslt.decorations[0] = cellFlags & 7; // door state
        const doorRN = dungeon.findFirstDoor(new Position(rslt.x, rslt.y, z));
        rslt.decorations[1] = doorRN === RN_EOF ? 0 : dungeon.rnMaps.idx(doorRN);
      }
      cellFlags = 1;
      local = firstObject;
      skipLowDbForRn2 = false;
      break;
    }

    default: {
      cellFlags = 1;
      break;
    }
  }

  // Codea59a.cpp:394-399: skip db<=ACTUATOR for rn2 only in the "break" path (stairs, etc).
  // For open-like rooms CSBWin sets `rn2` to `firstObject` (tag00a984).
  if (skipLowDbForRn2) {
    while (local !== RN_EOF && dungeon.rnMaps.dbType(local) <= DBType.ACTUATOR) {
      local = dungeon.getDBRecordLink(local);
    }
  }

  if (scanFloorDecorations && numFloorDecorations > 0) {
    for (let rn = firstObject; rn !== RN_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) === 47) {
        const selector = getActuatorDsaSelector(rec);
        const absIndex = dungeon.getDsaLevelIndex(levelNumber, selector);
        if (absIndex === 255) {
          const { paramB } = getActuatorDsaParameters(rec);
          rslt.decorations[2] = 0x4000 | (paramB & 0xffff);
        }
        continue;
      }
      const decoration = getActuatorWallGraphicOrdinal(rec) | 0;
      if (decoration > 0 && decoration <= numFloorDecorations) {
        rslt.decorations[2] = decoration;
      }
    }
  }

  // `tag00a984` (Codea59a.cpp:401-426): where footprints can show, the newest print on the
  // cell, if it is one of the trail's magic ones, sets the footprint bit, and so does the
  // cell's `ECF_FOOTPRINTS` once `d.Time` is past 0.
  if (cellFlags !== 0) {
    if (footprints) {
      let found = footprints.searchFootprints(z, rslt.x, rslt.y) & 0xff;
      if (found !== 0) {
        found = (found - 1) & 0xff;
        if (found >= (footprints.getIndexOfFirstMagicFootprint() & 0xff)
          && found < (footprints.getIndexOfLastMagicFootprint() & 0xff)) {
          rslt.decorations[2] |= 0x8000;
        }
      }
    }
    if (time > 0 && dungeon.getExtendedCellFlag(z, rslt.x, rslt.y, ECF_FOOTPRINTS)) {
      rslt.decorations[2] |= 0x8000;
    }
  }
  rslt.rn2 = local;
  rslt.graphicRoomType = graphicRoomTypes[rslt.roomType] as GraphicRoomType;
}
