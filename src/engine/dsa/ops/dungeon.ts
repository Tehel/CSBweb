import {
  DBType,
  OBJECT_ID_EOF,
  Position,
  RoomType,
  getRoomType,
  locationRelFromInteger,
  locationRelToInteger,
  type LocationRel,
  type ObjectID,
} from '../../../core/types';
import { sw } from '../../../core/intCast';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_FLUX_CAGE, RN_MONSTER_DEATH, RN_POISON_CLOUD, RN_ZO_SPELL,
} from '../../../core/spellRn';
import type { TeleporterRecord } from '../../../data/dungeonTypes';
import {
  getActuatorDsaSelector,
  getActuatorDsaState,
  getActuatorDisableTime,
  getActuatorParameterA,
  getActuatorParameterB,
  getActuatorType,
  setActuatorDisableTime,
} from '../../../data/actuatorHelpers';
import { extendedCellFlagsKey, type DungeonState } from '../../DungeonState';
import type { GameContext } from '../../GameContext';
import { StkOp } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';

/** `teleporterBit` (`doc/CSBwin-src/DSA.cpp:2209`): `ExamineCell`'s bit for a teleporter's `what`. */
const TELEPORTER_BIT = [11, 15, 13, 17];

/** The square's flags set, cut to their byte; nothing off the level. */
export function updateCellFlag(dungeon: DungeonState, locr: LocationRel, cellFlag: number): void {
  const map = dungeon.getMap(locr.l);
  if (!map) return;
  if (locr.x < 0 || locr.y < 0) return;
  if (locr.x >= map.descriptor.width || locr.y >= map.descriptor.height) return;
  map.cellFlags[locr.x]![locr.y] = cellFlag & 0xff;
}

/** The square's first teleporter, or `RNeof`. */
export function findFirstTeleporter(dungeon: DungeonState, position: Position): ObjectID {
  for (let rn = dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (dungeon.rnMaps.dbType(rn) === DBType.TELEPORTER) return rn;
  }
  return OBJECT_ID_EOF;
}

function getFirstTeleporterRecord(dungeon: DungeonState, position: Position): {
  sound: boolean;
  scope: number;
  absoluteRotation: boolean;
  rotation: number;
  destX: number;
  destY: number;
  destMap: number;
} | null {
  const rn = findFirstTeleporter(dungeon, position);
  if (rn === OBJECT_ID_EOF) return null;
  return dungeon.getTeleporterRecord(rn);
}

function getFirstDoorRecord(dungeon: DungeonState, position: Position): {
  destructibleByChop: boolean;
  destructibleByFireball: boolean;
  hasButton: boolean;
  vertical: boolean;
  ornateNumber: number;
  doorType: number;
} | null {
  const rn = dungeon.findFirstDoor(position);
  if (rn === OBJECT_ID_EOF) return null;
  const { index } = dungeon.rnMaps.decode(rn);
  return dungeon.getDoorRecordByIndex(index);
}

/**
 * `STKOP_TeleportParty` (doc/CSBwin-src/DSA.cpp:4584): the party moved by a pretend
 * teleporter — `what(2)`, party and objects — through the world `MoveObject`, which
 * resolves whatever the destination does to them. Exported so that `tools/` can make one
 * without a program.
 */
export function teleportParty(ctx: GameContext, locr: LocationRel): void {
  const party = ctx.party.state;
  const pretendTeleporter: TeleporterRecord = {
    nextObject: OBJECT_ID_EOF,
    sound: false,
    scope: 2,
    absoluteRotation: false,
    rotation: locr.p & 0x3,
    destX: locr.x & 0x1f,
    destY: locr.y & 0x1f,
    destMap: locr.l & 0xff,
  };

  ctx.systems.worldMove.moveParty(
    party.position.x, party.position.y, party.position.x, party.position.y, pretendTeleporter,
  );
}

/** `STKOP_GeneratorDelayStore` (`doc/CSBwin-src/DSA.cpp:2877-2916`). */
function generatorDelayStore(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const location = bank.stack.pop();
  const delay = bank.stack.pop();
  const locr = locationRelFromInteger(location);
  if (!dungeon.isValidLocation(locr)) return;
  const map = dungeon.getMap(locr.l);
  if (!map) return;
  const cellFlag = map.cellFlags[locr.x]![locr.y]!;
  if (getRoomType(cellFlag) === RoomType.STONE) return;
  let firstDisabled: ObjectID | null = null;
  const pos = new Position(locr.x, locr.y, locr.l);
  for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = dungeon.rnMaps.decode(rn);
    if (decoded.category !== DBType.ACTUATOR) continue;
    const rec = dungeon.getActuatorRecord(rn);
    if (!rec) continue;
    const type = getActuatorType(rec);
    if (type === 6) {
      setActuatorDisableTime(rec, delay);
      return;
    }
    if (type === 0 && firstDisabled === null) {
      firstDisabled = rn;
    }
  }
  if (firstDisabled !== null) {
    const rec = dungeon.getActuatorRecord(firstDisabled);
    if (rec) setActuatorDisableTime(rec, delay);
  }
}

/** `STKOP_GeneratorDelayFetch` (`doc/CSBwin-src/DSA.cpp:4725-4737`). */
function generatorDelayFetch(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const loc = bank.stack.pop();
  const locr = locationRelFromInteger(loc);
  if (!dungeon.isValidLocation(locr)) {
    bank.stack.push(-1);
    return;
  }
  const map = dungeon.getMap(locr.l);
  if (!map) {
    bank.stack.push(-1);
    return;
  }
  if (getRoomType(map.cellFlags[locr.x]![locr.y]!) === RoomType.STONE) {
    bank.stack.push(-1);
    return;
  }
  const pos = new Position(locr.x, locr.y, locr.l);
  let found: ObjectID | null = null;
  for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = dungeon.rnMaps.decode(rn);
    if (decoded.category !== DBType.ACTUATOR) continue;
    const rec = dungeon.getActuatorRecord(rn);
    if (!rec) continue;
    if (getActuatorType(rec) === 6) {
      found = rn;
      break;
    }
  }
  if (found === null) {
    bank.stack.push(-1);
    return;
  }
  const rec = dungeon.getActuatorRecord(found);
  bank.stack.push(rec ? getActuatorDisableTime(rec) : -1);
}

/** `STKOP_CellFetch` (`doc/CSBwin-src/DSA.cpp:3677-3837`). */
function cellFetch(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const arraySize = bank.stack.pop();
  const arrayIndex = bank.stack.pop();
  if (arrayIndex < 0 || arrayIndex + arraySize > 100) return;
  // `Var(arrayIndex+j, 0)` (doc/CSBwin-src/DSA.cpp:3691-3694): every variable of the
  // array is well defined from here, so `SetVarBit` below never zeroes one.
  for (let i = 0; i < arraySize; i++) {
    bank.setVar(arrayIndex + i, 0);
  }
  const loc = bank.stack.pop();
  const locr = locationRelFromInteger(loc);
  if (!dungeon.isValidLocation(locr)) return;
  const map = dungeon.getMap(locr.l);
  if (!map) return;
  const cellFlag = map.cellFlags[locr.x]![locr.y]!;
  const roomType = getRoomType(cellFlag);
  if (arraySize === 0) return;
  bank.setVar(arrayIndex, roomType);
  if (arraySize < 2) return;
  switch (roomType) {
    // `Var(arrayIndex+1, Var(arrayIndex+1) | bit)` for these four; `SetVarBit` for a
    // pit, a false wall and a door (doc/CSBwin-src/DSA.cpp:3705-3811).
    case RoomType.STONE:
      if (cellFlag & 0x8) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x01);
      if (cellFlag & 0x4) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x02);
      if (cellFlag & 0x2) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
      if (cellFlag & 0x1) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
      break;
    case RoomType.OPEN:
      if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x01);
      break;
    case RoomType.TELEPORTER: {
      if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
      if (cellFlag & 0x04) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
      if (arraySize < 3) break;
      const tp = getFirstTeleporterRecord(dungeon, new Position(locr.x, locr.y, locr.l));
      if (!tp) break;
      bank.setVar(arrayIndex + 2, (tp.rotation & 0x3) | ((tp.absoluteRotation ? 1 : 0) << 2));
      if (arraySize < 4) break;
      bank.setVar(arrayIndex + 3, tp.scope & 0x3);
      if (arraySize < 5) break;
      const destLoc = locationRelToInteger({
        l: tp.destMap & 0x3f,
        x: tp.destX & 0x1f,
        y: tp.destY & 0x1f,
        p: 0,
      });
      bank.setVar(arrayIndex + 4, destLoc);
      break;
    }
    case RoomType.STAIRS:
      if (cellFlag & 0x04) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x04);
      if (cellFlag & 0x08) bank.setVar(arrayIndex + 1, bank.getVar(arrayIndex + 1) | 0x08);
      break;
    case RoomType.PIT:
      if (cellFlag & 0x01) bank.setVarBit(arrayIndex + 1, 0x01);
      if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
      if (cellFlag & 0x08) bank.setVarBit(arrayIndex + 1, 0x08);
      break;
    case RoomType.FALSEWALL:
      if (cellFlag & 0x01) bank.setVarBit(arrayIndex + 1, 0x01);
      if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x04);
      break;
    case RoomType.DOOR: {
      const door = getFirstDoorRecord(dungeon, new Position(locr.x, locr.y, locr.l));
      if (!door) break;
      bank.setVar(arrayIndex + 1, 0);
      if (cellFlag & 0x04) bank.setVarBit(arrayIndex + 1, 0x01);
      if (door.vertical) bank.setVarBit(arrayIndex + 1, 0x02);
      if (door.hasButton) bank.setVarBit(arrayIndex + 1, 0x04);
      if (door.destructibleByFireball) bank.setVarBit(arrayIndex + 1, 0x08);
      if (door.destructibleByChop) bank.setVarBit(arrayIndex + 1, 0x10);
      if (arraySize < 3) break;
      bank.setVar(arrayIndex + 2, cellFlag & 0x7);
      if (arraySize < 4) break;
      bank.setVar(arrayIndex + 3, door.doorType & 0x1);
      if (arraySize < 5) break;
      bank.setVar(arrayIndex + 4, door.ornateNumber & 0xf);
      break;
    }
    default:
      break;
  }
}

/** `STKOP_CellStore` (`doc/CSBwin-src/DSA.cpp:3838-3958`). */
function cellStore(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const arraySize = bank.stack.pop();
  const arrayIndex = bank.stack.pop();
  const loc = bank.stack.pop();
  bank.noFilter();
  const locr = locationRelFromInteger(loc);
  if (!dungeon.isValidLocation(locr)) return;
  if (arrayIndex < 0 || arrayIndex + arraySize > 100) return;
  const map = dungeon.getMap(locr.l);
  if (!map) return;
  let cellFlag = map.cellFlags[locr.x]![locr.y]!;
  const roomType = getRoomType(cellFlag);
  if (arraySize === 0) return;
  if (bank.getVar(arrayIndex) !== roomType) return;
  if (arraySize < 2) return;
  switch (roomType) {
    case RoomType.STONE: {
      cellFlag &= 0xe0;
      if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x8;
      if (bank.getVar(arrayIndex + 1) & 0x02) cellFlag |= 0x4;
      if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x2;
      if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x1;
      break;
    }
    case RoomType.OPEN:
      cellFlag &= 0xf7;
      if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x08;
      break;
    case RoomType.TELEPORTER: {
      const tp = getFirstTeleporterRecord(dungeon, new Position(locr.x, locr.y, locr.l));
      if (!tp) break;
      if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x08;
      else cellFlag &= 0xf7;
      if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
      else cellFlag &= 0xfb;
      if (arraySize < 3) break;
      tp.rotation = bank.getVar(arrayIndex + 2) & 0x3;
      tp.absoluteRotation = ((bank.getVar(arrayIndex + 2) >> 2) & 0x1) !== 0;
      if (arraySize < 4) break;
      tp.scope = bank.getVar(arrayIndex + 3) & 0x3;
      break;
    }
    case RoomType.PIT:
      cellFlag &= 0xf2;
      if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x01;
      if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
      if (bank.getVar(arrayIndex + 1) & 0x08) cellFlag |= 0x08;
      break;
    case RoomType.FALSEWALL:
      cellFlag &= 0xfa;
      if (bank.getVar(arrayIndex + 1) & 0x01) cellFlag |= 0x01;
      if (bank.getVar(arrayIndex + 1) & 0x04) cellFlag |= 0x04;
      break;
    case RoomType.DOOR: {
      const door = getFirstDoorRecord(dungeon, new Position(locr.x, locr.y, locr.l));
      if (!door) break;
      door.vertical = (bank.getVar(arrayIndex + 1) & 0x02) !== 0;
      door.hasButton = (bank.getVar(arrayIndex + 1) & 0x04) !== 0;
      door.destructibleByFireball = (bank.getVar(arrayIndex + 1) & 0x08) !== 0;
      door.destructibleByChop = (bank.getVar(arrayIndex + 1) & 0x10) !== 0;
      if (arraySize < 3) break;
      let oldState = cellFlag & 0x7;
      const newState = bank.getVar(arrayIndex + 2) & 0x7;
      if (oldState === 5) {
        if (newState === 0) oldState = newState;
      } else if (oldState === 4) {
        if (newState === 5) oldState = newState;
      }
      cellFlag = (cellFlag & ~0x7) | oldState;
      if (arraySize < 4) break;
      door.doorType = bank.getVar(arrayIndex + 3) & 0x1;
      if (arraySize < 5) break;
      door.ornateNumber = bank.getVar(arrayIndex + 4) & 0xf;
      break;
    }
    default:
      break;
  }
  updateCellFlag(dungeon, locr, cellFlag);
}

/**
 * `STKOP_CreateCloud` (`doc/CSBwin-src/DSA.cpp:2741-2788`): a cloud of one of five
 * spells, or a Fluxcage, made at a location of any level, as a missile's would be. A
 * type with no spell is "Illegal cloud type", and makes nothing. CSBWin does not check
 * the location, and runs `LoadLevel` and `AddObjectToRoom` off their tables for one
 * past the dungeon; the port makes nothing there.
 */
function createCloud(machine: DsaOperationMachine, bank: DsaBank): void {
  const ctx = machine.ctx;
  const size = bank.stack.pop();
  const type = bank.stack.pop();
  const locr = locationRelFromInteger(bank.stack.pop());
  bank.noFilter();
  let spellObj: ObjectID = OBJECT_ID_EOF;
  switch (type) {
    case 0: spellObj = RN_FIREBALL; break;
    case 3: spellObj = RN_DISPELL_MISSILE; break;
    case 4: spellObj = RN_ZO_SPELL; break;
    case 7: spellObj = RN_POISON_CLOUD; break;
    case 40: spellObj = RN_MONSTER_DEATH; break;
    case 50: spellObj = RN_FLUX_CAGE; break;
    default:
      ctx.host.trace(`Illegal cloud type ${type}`);
      break;
  }
  if (spellObj === OBJECT_ID_EOF) return;
  if (!ctx.dungeon.isValidLocation(locr)) return;
  const at = new Position(locr.x, locr.y, locr.l);
  if (spellObj === RN_FLUX_CAGE) {
    ctx.systems.missileEncounter.createFluxcage(at, ctx.state.tickCount);
  } else {
    ctx.systems.missileEncounter.createCloud(spellObj, sw(size), locr.x, locr.y, at, locr.p);
  }
}

/**
 * `STKOP_MissileInfoFetch` (`doc/CSBwin-src/DSA.cpp:2796-2824`): a missile's contents,
 * range, damage and direction, the last from its timer's `timerWord8` bits 10-11; -1 for
 * each when the slot is not a missile. CSBWin reads the timer slot the missile names
 * whatever it holds; the port finds no timer there only for a record no launch made,
 * and leaves the direction -1.
 */
function missileInfoFetch(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  let contents = -1;
  let range = -1;
  let damage = -1;
  let direction = -1;
  const k = bank.stack.pop();
  if (machine.isValidObjectId(k) && dungeon.rnMaps.dbType(k) === DBType.MISSILE) {
    const missile = dungeon.getMissileRecord(k);
    if (missile) {
      contents = missile.projectileObject & 0xffff;
      range = missile.rangeRemaining;
      damage = missile.damageRemaining;
      const word8 = machine.ctx.timers.getTimerWord8(missile.timerIndex);
      if (word8 !== null) direction = (word8 >> 10) & 3;
    }
  }
  bank.stack.push(contents);
  bank.stack.push(range);
  bank.stack.push(damage);
  bank.stack.push(direction);
}

/**
 * `STKOP_MissileInfoStore` (`doc/CSBwin-src/DSA.cpp:2825-2852`): a missile's range and
 * damage, cut to their bytes, and its timer's direction. The three values are popped
 * only when the slot is valid, so an invalid one leaves them on the stack.
 */
function missileInfoStore(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const k = bank.stack.pop();
  if (!machine.isValidObjectId(k)) return;
  const direction = bank.stack.pop();
  const damage = bank.stack.pop();
  const range = bank.stack.pop();
  if (dungeon.rnMaps.dbType(k) !== DBType.MISSILE) return;
  const missile = dungeon.getMissileRecord(k);
  if (!missile) return;
  missile.rangeRemaining = range & 0xff;
  missile.damageRemaining = damage & 0xff;
  const timer = machine.ctx.timers.getTimer(missile.timerIndex);
  if (timer) timer.timerWord8 = ((timer.timerWord8 & ~(0x3 << 10)) | ((direction & 3) << 10)) & 0xffff;
}

/**
 * `ExamineCell` (`doc/CSBwin-src/DSA.cpp:2211-2321`), `&THISCELL` and `&NEIGHBORS`:
 * a result bit for each cell from `first` to `last` (0 to 3 the four neighbours, north
 * first and clockwise; 4 the cell itself) that has one of the mask's bits of what it is
 * (0 to 24) and one of what is on it (29 to 31).
 */
function examineCell(machine: DsaOperationMachine, first: number, last: number, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  const criteriaMask = bank.stack.pop() >>> 0;
  const locr = locationRelFromInteger(bank.stack.pop());
  let resultBit = 1;
  let result = 0;
  for (let i = first; i <= last; i++) {
    const cellLocr = { ...locr };
    let cellBits = 0;
    switch (i) {
      case 0: cellLocr.y--; break;
      case 1: cellLocr.x++; break;
      case 2: cellLocr.y++; break;
      case 3: cellLocr.x--; break;
    }
    if (!dungeon.isValidLocation(cellLocr)) {
      cellBits |= (1 << 0) | (1 << 31);
    } else {
      const cellPos = new Position(cellLocr.x, cellLocr.y, cellLocr.l);
      const cf = dungeon.getCellFlag(cellPos);
      switch (getRoomType(cf)) {
        case RoomType.STONE:
          cellBits |= (1 << 1) | (1 << 31);
          break;
        case RoomType.OPEN:
          cellBits |= 1 << 19;
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
        case RoomType.PIT:
          if (cf & 1) cellBits |= 1 << 4; // a false pit
          else if (cf & 0x8) cellBits |= 1 << 2; // open
          else cellBits |= 1 << 3;
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
        case RoomType.DOOR:
          cellBits = 1 << ((cf & 7) > 5 ? 9 : (cf & 7) + 5);
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
        case RoomType.TELEPORTER: {
          const rn = findFirstTeleporter(dungeon, cellPos);
          if (rn !== OBJECT_ID_EOF) {
            const what = dungeon.getTeleporterRecord(rn)?.scope ?? 0;
            const bit = TELEPORTER_BIT[what & 3]! + ((cf & 8) !== 0 ? 0 : 1);
            cellBits |= 1 << bit;
          }
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
        }
        case RoomType.FALSEWALL:
          if (cf & 0x04) cellBits |= 1 << 22;
          else if (cf & 0x01) cellBits |= 1 << 20;
          else cellBits |= 1 << 21;
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
        case RoomType.STAIRS:
          if (cf & 0x04) cellBits |= 1 << 23;
          else cellBits |= 1 << 24;
          cellBits |= cellContents(machine.ctx, cellLocr);
          break;
      }
    }
    if ((criteriaMask & cellBits & 0x01ffffff) !== 0 && (criteriaMask & cellBits & 0xe0000000) !== 0) {
      result |= resultBit;
    }
    resultBit <<= 1;
  }
  bank.stack.push(result);
}

/** `Contents` (`doc/CSBwin-src/DSA.cpp:2201-2206`): the party, else a monster, else nothing. */
function cellContents(ctx: GameContext, locr: LocationRel): number {
  const party = ctx.party.state.position;
  if (party.z === locr.l && party.x === locr.x && party.y === locr.y) return 1 << 29;
  if (ctx.dungeon.findFirstMonster(new Position(locr.x, locr.y, locr.l)) !== OBJECT_ID_EOF) return 1 << 30;
  return 0x80000000 | 0;
}

/**
 * `STKOP_DSAInfoFetch` (`doc/CSBwin-src/DSA.cpp:2440-2471`): a type-47 actuator's
 * selector, state and parameters, -1 for each otherwise.
 */
function dsaInfoFetch(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  let dsaType = -1;
  let dsaState = -1;
  let dsaPA = -1;
  let dsaPB = -1;
  const n = bank.stack.pop();
  if (machine.isValidObjectId(n) && dungeon.rnMaps.dbType(n) === DBType.ACTUATOR) {
    const rec = dungeon.getActuatorRecord(n);
    if (rec && getActuatorType(rec) === 47) {
      dsaType = getActuatorDsaSelector(rec);
      dsaState = getActuatorDsaState(rec);
      dsaPA = getActuatorParameterA(rec);
      dsaPB = getActuatorParameterB(rec);
    }
  }
  bank.stack.push(dsaType);
  bank.stack.push(dsaState);
  bank.stack.push(dsaPA);
  bank.stack.push(dsaPB);
}

/**
 * The dungeon, the party's place in it, what flies through it and how it is shown:
 * `EX_AMPERSAND`'s cases (`doc/CSBwin-src/DSA.cpp:2440`, `:2513`, `:2741-2956`,
 * `:3092-3136`, `:3254-3328`, `:3677-3991`, `:4058`, `:4559-4584`, `:4725`, `:4820-4830`
 * and `:4899`), in the order the port's switch had them.
 */
export const dungeonOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.FALSE_PIT, (bank, _exPkt, machine) => {
    // `DSA.cpp:2860-2876`.
    const dungeon = machine.ctx.dungeon;
    const value = bank.stack.pop();
    const loc = bank.stack.pop();
    const locr = locationRelFromInteger(loc);
    if (!dungeon.isValidLocation(locr)) return;
    const map = dungeon.getMap(locr.l);
    if (!map) return;
    const cellFlag = map.cellFlags[locr.x]![locr.y]!;
    if (getRoomType(cellFlag) !== RoomType.PIT) return;
    const next = value !== 0 ? (cellFlag | 0x01) : (cellFlag & 0xfe);
    updateCellFlag(dungeon, locr, next);
  }],
  [StkOp.GENERATOR_DELAY_STORE, (bank, _exPkt, machine) => {
    generatorDelayStore(machine, bank);
  }],
  [StkOp.TELEPORT_PARTY, (bank, _exPkt, machine) => {
    const location = bank.stack.pop();
    bank.noFilter();
    const locr = locationRelFromInteger(location);
    if (!machine.ctx.dungeon.isValidLocation(locr)) return;
    teleportParty(machine.ctx, locr);
  }],
  [StkOp.TIME_FETCH, (bank, _exPkt, machine) => {
    bank.stack.push(machine.ctx.state.tickCount);
  }],
  [StkOp.GENERATOR_DELAY_FETCH, (bank, _exPkt, machine) => {
    generatorDelayFetch(machine, bank);
  }],
  [StkOp.CELL_FETCH, (bank, _exPkt, machine) => {
    cellFetch(machine, bank);
  }],
  [StkOp.CELL_STORE, (bank, _exPkt, machine) => {
    cellStore(machine, bank);
  }],
  [StkOp.GLOBAL_FETCH, (bank, _exPkt, machine) => {
    // `DSA.cpp:3959-3974`.
    const which = bank.stack.pop();
    let result = 0;
    if (which === 1) {
      const party = machine.ctx.party.state;
      result = locationRelToInteger({
        l: party.position.z,
        x: party.position.x,
        y: party.position.y,
        p: party.facing & 3,
      });
    }
    bank.stack.push(result);
  }],
  [StkOp.THROW, (bank, _exPkt, machine) => {
    // `DSA.cpp:4559-4583`.
    const ctx = machine.ctx;
    const delta = bank.stack.pop();
    const damage = bank.stack.pop();
    const range = bank.stack.pop();
    const direction = bank.stack.pop();
    const launchLocation = locationRelFromInteger(bank.stack.pop());
    const objectLocation = locationRelFromInteger(bank.stack.pop());
    const objectType = bank.stack.pop();
    bank.noFilter();
    ctx.systems.timer.throwMissile(objectType, launchLocation, direction, objectLocation, range, damage,
      delta, ctx.state.tickCount);
  }],
  [StkOp.CAST, (bank, _exPkt, machine) => {
    // `DSA.cpp:3092-3099`.
    bank.noFilter();
    machine.ctx.systems.magic.dsaCastSpell(false);
  }],
  [StkOp.FILTERED_CAST, (bank, _exPkt, machine) => {
    // `DSA.cpp:3100-3107`.
    bank.noFilter();
    machine.ctx.systems.magic.dsaCastSpell(true);
  }],
  [StkOp.GET_SKIN, (bank, _exPkt, machine) => {
    // `DSA.cpp:3108-3122`: `y` in bits 0-4, `x` in 5-9, the level in 10-15.
    const loc = bank.stack.pop();
    bank.stack.push(machine.ctx.dungeon.skinCache.GetSkin((loc >> 10) & 63, (loc >> 5) & 31, loc & 31));
  }],
  [StkOp.SET_SKIN, (bank, _exPkt, machine) => {
    // `DSA.cpp:3123-3136`: the location, then the skin, of which `SetSkin` takes the
    // low byte.
    const loc = bank.stack.pop();
    const skin = bank.stack.pop();
    machine.ctx.dungeon.skinCache.SetSkin((loc >> 10) & 63, (loc >> 5) & 31, loc & 31, skin & 0xff);
  }],
  [StkOp.CREATE_CLOUD, (bank, _exPkt, machine) => {
    createCloud(machine, bank);
  }],
  [StkOp.MISSILE_INFO_FETCH, (bank, _exPkt, machine) => {
    missileInfoFetch(machine, bank);
  }],
  [StkOp.MISSILE_INFO_STORE, (bank, _exPkt, machine) => {
    missileInfoStore(machine, bank);
  }],
  [StkOp.LOC_TO_ABS_COORD, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3254-3270`, `LOCATIONABS::operator =` (`:321-328`): the
    // level's offsets added, read past the descriptors for a level that is not there.
    const locr = locationRelFromInteger(bank.stack.pop());
    const descriptor = machine.ctx.dungeon.getMap(locr.l)?.descriptor;
    bank.stack.push(locr.l);
    bank.stack.push(locr.x + (descriptor?.offsetX ?? 0));
    bank.stack.push(locr.y + (descriptor?.offsetY ?? 0));
    bank.stack.push(locr.p);
  }],
  [StkOp.FETCH_EX_CELL_FLG, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3271-3298`: the cell's bit of each of the eight flags,
    // flag 0 in bit 0, all clear without a record of eight.
    const locr = locationRelFromInteger(bank.stack.pop());
    const record = machine.ctx.dungeon.locateExpoolRecord(extendedCellFlagsKey(locr));
    let flags = 0;
    if (record && record.length >= 8) {
      const mask = (1 << locr.y) >>> 0;
      for (let i = 0; i < 8; i++) {
        if (((record[i]! & mask) >>> 0) !== 0) flags |= 0x100;
        flags >>>= 1;
      }
    }
    bank.stack.push(flags);
  }],
  [StkOp.STORE_EX_CELL_FLG, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3299-3328`: the record is taken out, its cell's bits
    // set from the low eight of `flags`, and written back; a missing or short record
    // starts at zero.
    const dungeon = machine.ctx.dungeon;
    const loc = bank.stack.pop();
    let flags = bank.stack.pop() >>> 0;
    const locr = locationRelFromInteger(loc);
    const key = extendedCellFlagsKey(locr);
    const read = dungeon.readExpoolRecord(key);
    const record = read && read.length >= 8 ? read.slice(0, 8) : new Array<number>(8).fill(0);
    const mask = (1 << locr.y) >>> 0;
    for (let i = 0; i < 8; i++) {
      record[i] = (record[i]! & ~mask) >>> 0;
      if (flags & 1) record[i] = (record[i]! | mask) >>> 0;
      flags >>>= 1;
    }
    dungeon.writeExpoolRecord(key, record);
  }],
  [StkOp.MULTIPLIER_FETCH, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3975-3991`: `level` is signed, so a negative one reads
    // before the descriptors, and 1 past the last.
    const dungeon = machine.ctx.dungeon;
    const level = bank.stack.pop();
    if (level < dungeon.getMapCount()) {
      bank.stack.push(dungeon.levelDifficulty(level));
    } else {
      bank.stack.push(1);
    }
  }],
  [StkOp.PARTY_DISTANCE, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:4058-4074`: steps on the party's level, minus the levels
    // between otherwise.
    const locr = locationRelFromInteger(bank.stack.pop());
    const party = machine.ctx.party.state.position;
    if (party.z === locr.l) {
      bank.stack.push(Math.abs(party.x - locr.x) + Math.abs(party.y - locr.y));
    } else {
      bank.stack.push(-Math.abs(party.z - locr.l));
    }
  }],
  [StkOp.THIS_CELL, (bank, _exPkt, machine) => {
    examineCell(machine, 4, 4, bank);
  }],
  [StkOp.NEIGHBORS, (bank, _exPkt, machine) => {
    examineCell(machine, 0, 3, bank);
  }],
  [StkOp.OVERLAY, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:2920-2931`.
    const onum = bank.stack.pop();
    const p4 = bank.stack.pop();
    const p3 = bank.stack.pop();
    const p2 = bank.stack.pop();
    const p1 = bank.stack.pop();
    machine.ctx.overlay.SelectOverlay(onum, p1, p2, p3, p4, machine.ctx.state.tickCount);
  }],
  [StkOp.PALETTE, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:2933-2945`.
    const density = bank.stack.pop();
    const onum = bank.stack.pop();
    bank.stack.pop(); // p2, which `SetOverlayPalette` does not read
    bank.stack.pop(); // p1, nor this
    machine.ctx.overlay.SetOverlayPalette(onum, density);
  }],
  [StkOp.JITTER, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:4904-4931`.
    const yOverlay = bank.stack.pop();
    const xOverlay = bank.stack.pop();
    const yGraphic = bank.stack.pop();
    const xGraphic = bank.stack.pop();
    machine.ctx.overlay.Jitter(xGraphic, yGraphic, xOverlay, yOverlay);
  }],
  [StkOp.DISABLE_SAVES, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:2946-2956`.
    machine.setDisableSaves(bank.stack.pop() !== 0);
  }],
  [StkOp.DSA_INFO_FETCH, (bank, _exPkt, machine) => {
    dsaInfoFetch(machine, bank);
  }],
]);
