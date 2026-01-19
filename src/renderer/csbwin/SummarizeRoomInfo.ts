import { decodeObjectID, DBType, OBJECT_ID_EOF, type ObjectID, type ui8 } from '../../core/types';
import { GraphicRoomType, RoomType, type SummarizeRoomData } from '../bytecode/Types';
import type { DungeonState } from '../../engine/DungeonState';
import type { ObjectTables } from './ObjectTables';

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
  map[RoomType.DOOR_EDGE] = GraphicRoomType.DOOR_EDGE;
  map[RoomType.DOOR_FACING] = GraphicRoomType.DOOR_FACING;
  map[RoomType.STAIR_EDGE] = GraphicRoomType.STAIR_EDGE;
  map[RoomType.STAIR_FACING] = GraphicRoomType.STAIR_FACING;
  return map;
})();

function dbTypeOf(rn: ObjectID): number {
  return decodeObjectID(rn).category;
}

function posOf(rn: ObjectID): number {
  return decodeObjectID(rn).position;
}

function idxOf(rn: ObjectID): number {
  return decodeObjectID(rn).index;
}

// Port of `GetCellFlags()` boundary behavior used by viewport rendering (CSBCode.cpp:4609-4662).
function getCellFlagsViewport(dungeon: DungeonState, mapIndex: ui8, x: number, y: number): number {
  const map = dungeon.getMap(mapIndex);
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

function getDsaSelector(data: number): number {
  return data & 0x1f;
}

function getDsaParameters(word4: number, word6: number): { paramA: number; paramB: number } {
  let w4 = word4 & 0xffff;
  let w6 = word6 & 0xffff;
  const word8 = ((w6 >> 12) & 0xc0) | ((w4 >> 14) & 0x03);
  w4 &= 0x3fff;
  w6 &= 0x3fff;
  const paramA = (w4 | ((word8 & 0x03) << 16)) >>> 0;
  const paramB = (w6 | ((word8 & 0x0c) << 14)) >>> 0;
  return { paramA, paramB };
}

function summarizeStoneRoom(
  rslt: SummarizeRoomData,
  dungeon: DungeonState,
  mapIndex: ui8,
  partyX: number,
  partyY: number,
  facing: number,
  falseStoneWall: boolean,
  tables?: ObjectTables
): void {
  const map = dungeon.getMap(mapIndex);
  const sentinel = dungeon.getData().header.randomSeed ?? 0;
  const mapWidth = map?.descriptor.width ?? 0;
  const mapHeight = map?.descriptor.height ?? 0;
  const numWallDecoration = map?.descriptor.wallGraphicsCount ?? 0;
  const numRandomWallDecoration = map?.descriptor.wallDecorationCount ?? 0;
  const levelNumber = map?.descriptor.level ?? mapIndex;
  const cellFlags = getCellFlagsViewport(dungeon, mapIndex, rslt.x, rslt.y);

  let local = dungeon.findFirstObject(mapIndex, rslt.x, rslt.y);

  rslt.roomType = RoomType.STONE;
  rslt.championPortraitOrdinal = 0;

  // Port of CSBWin TAG00a4a2 random wall decorations (Codea59a.cpp:76, CSBCode.cpp:5714+).
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
      mapIndex
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
      mapIndex
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
      mapIndex
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
  while (local !== RN_EOF && dbTypeOf(local) <= DBType.ACTUATOR) {
    const dbType = dbTypeOf(local);

    // CSBWin tolerates bad dungeons that put doors/teleporters in stone (Codea59a.cpp:89-93).
    if (dbType === DBType.DOOR || dbType === DBType.TELEPORTER) {
      local = dungeon.getDBRecordLink(local);
      continue;
    }

    const relativePosition = (posOf(local) - (facing & 3)) & 3;
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
          if (rec.sensorType === 47) {
            const selector = getDsaSelector(rec.data);
            const absIndex = dungeon.getDsaLevelIndex(levelNumber, selector);
            if (absIndex === 255) {
              const { paramA } = getDsaParameters(rec.rawBehavior, rec.rawTarget);
              rslt.decorations[(relativePosition - 1) as 0 | 1 | 2] = 0x10000 | (paramA & 0xffff);
              realDecoration[(relativePosition - 1) as 0 | 1 | 2] = true;
            }
          } else if (rec.sensorType !== 127 || (rec.portraitState & PORTRAIT_HIDE_GRAPHIC) === 0) {
            const ord = rec.decorationOrdinal | 0;
            if (ord > 0 && ord <= numWallDecoration) {
              rslt.decorations[(relativePosition - 1) as 0 | 1 | 2] = ord;
              realDecoration[(relativePosition - 1) as 0 | 1 | 2] = true;
            }
          }
          if (rec.sensorType === 127 && relativePosition === 2) {
            if ((rec.portraitState & PORTRAIT_HIDE_PORTRAIT) === 0) {
              rslt.championPortraitOrdinal = (rec.data & 0x1ff) + 1;
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
    if (partyX !== rslt.x && partyY !== rslt.y) {
      rslt.rn2 = RN_EOF;
      return;
    }
  }

  rslt.rn2 = local;
}

export function summarizeRoomInfoCsbwin(
  rslt: SummarizeRoomData,
  dungeon: DungeonState,
  mapIndex: ui8,
  partyX: number,
  partyY: number,
  facing: number,
  tables?: ObjectTables
): void {
  rslt.text = [RN_EOF, RN_EOF, RN_EOF];
  rslt.decorations = [0, 0, 0];
  rslt.rn2 = RN_EOF;
  rslt.championPortraitOrdinal = 0;

  const map = dungeon.getMap(mapIndex);
  const sentinel = dungeon.getData().header.randomSeed ?? 0;
  const mapWidth = map?.descriptor.width ?? 0;
  const mapHeight = map?.descriptor.height ?? 0;
  const numFloorDecorations = map?.descriptor.floorGraphicsCount ?? 0;
  const numRandomFloorDecorations = map?.descriptor.floorDecorationCount ?? 0;
  const levelNumber = map?.descriptor.level ?? mapIndex;

  let cellFlags = getCellFlagsViewport(dungeon, mapIndex, rslt.x, rslt.y);
  const baseRoomType = ((cellFlags >> 5) & 7) as RoomType;
  rslt.roomType = baseRoomType;

  const firstObject = dungeon.findFirstObject(mapIndex, rslt.x, rslt.y);
  let local = firstObject;
  let skipLowDbForRn2 = true;
  let scanFloorDecorations = false;

  switch (baseRoomType) {
    case RoomType.STONE: {
      summarizeStoneRoom(rslt, dungeon, mapIndex, partyX, partyY, facing, false, tables);
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
        summarizeStoneRoom(rslt, dungeon, mapIndex, partyX, partyY, facing, true, tables);
        rslt.graphicRoomType = graphicRoomTypes[rslt.roomType] as GraphicRoomType;
        return;
      }
      rslt.roomType = RoomType.OPEN;
      cellFlags = (cellFlags & 8) !== 0 ? 8 : 0;
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
          mapIndex
        );
      }
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
          mapIndex
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
      rslt.roomType = (facingIsNS === nsTravel ? RoomType.STAIR_EDGE : RoomType.STAIR_FACING) as RoomType;
      rslt.decorations[0] = cellFlags & 4;
      cellFlags = 0;
      break;
    }

    case RoomType.DOOR: {
      // Codea59a.cpp:376-390
      const nsDoor = (cellFlags & 8) >> 3;
      const facingIsNS = facing & 1;
      if (nsDoor === facingIsNS) {
        rslt.roomType = RoomType.DOOR_EDGE;
      } else {
        rslt.roomType = RoomType.DOOR_FACING;
        rslt.decorations[0] = cellFlags & 7; // door state
        const doorRN = dungeon.findFirstDoor(mapIndex, rslt.x, rslt.y);
        rslt.decorations[1] = doorRN === RN_EOF ? 0 : idxOf(doorRN);
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
    while (local !== RN_EOF && dbTypeOf(local) <= DBType.ACTUATOR) {
      local = dungeon.getDBRecordLink(local);
    }
  }

  if (scanFloorDecorations && numFloorDecorations > 0) {
    for (let rn = firstObject; rn !== RN_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (dbTypeOf(rn) !== DBType.ACTUATOR) continue;
      const rec = dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (rec.sensorType === 47) {
        const selector = getDsaSelector(rec.data);
        const absIndex = dungeon.getDsaLevelIndex(levelNumber, selector);
        if (absIndex === 255) {
          const { paramB } = getDsaParameters(rec.rawBehavior, rec.rawTarget);
          rslt.decorations[2] = 0x4000 | (paramB & 0xffff);
        }
        continue;
      }
      const decoration = rec.decorationOrdinal | 0;
      if (decoration > 0 && decoration <= numFloorDecorations) {
        rslt.decorations[2] = decoration;
      }
    }
  }

  // Codea59a.cpp:400+: footprints/ext flags omitted for now.
  rslt.rn2 = local;
  rslt.graphicRoomType = graphicRoomTypes[rslt.roomType] as GraphicRoomType;
}
