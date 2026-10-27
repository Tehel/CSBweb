import {
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  Position,
  TilePosition,
  locationRelFromInteger,
  rnEquals,
  type ObjectID,
} from '../../../core/types';
import type { CsbRandom } from '../../../core/random';
import { getChampionPossession } from '../../../core/charDesc';
import { getActuatorType, isActuatorAudible, isActuatorOnceOnly } from '../../../data/actuatorHelpers';
import type { CreatureRecord } from '../../../data/dungeonTypes';
import { monsterHorizontalSize, type MonsterDesc } from '../../../data/tables/MonsterDesc';
import type { Champion } from '../../gameTypes';
import type { MonsterSystem } from '../../MonsterSystem';
import type { WorldMove } from '../../WorldMove';
import { GetBasicObjectType } from '../../objectIndex';
import { CursorFilterType, StkOp } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';

/**
 * `DSADBANK::DeleteObject` (`doc/CSBwin-src/DSA.cpp:158-164`) — condemn a record by
 * pushing it on the run's delete list through its own link. Nothing is freed yet.
 */
function deleteObject(machine: DsaOperationMachine, bank: DsaBank, rn: ObjectID): void {
  machine.ctx.dungeon.setDBRecordLink(rn, bank.objectDeleteList);
  bank.objectDeleteList = rn;
}

function canDeleteFromCell(category: DBType): boolean {
  return (
    category === DBType.ACTUATOR ||
    category === DBType.MISC ||
    category === DBType.POTION ||
    category === DBType.WEAPON ||
    category === DBType.CLOTHING
  );
}

function deleteFromNegativeLocation(machine: DsaOperationMachine, location: number): ObjectID | null {
  const party = machine.ctx.party.state;
  if (!party) return null;
  if (location === -1) {
    if (party.objectInHand === OBJECT_ID_NULL) return null;
    // `CURSORFILTER_DSA_DEL`, which cannot cancel; `RemoveObjectFromHand` then takes
    // whatever the hand holds once it returns (`doc/CSBwin-src/DSA.cpp:1658-1666`).
    machine.filters.cursorFilter({ object: party.objectInHand, type: CursorFilterType.DSA_DEL, p1: 0, p2: 0, p3: 0, p4: 0 });
    const removed = party.objectInHand;
    if (removed === OBJECT_ID_NULL) return null;
    party.objectInHand = OBJECT_ID_NULL;
    return removed;
  }
  const loc = decodeCharacterLocation(location);
  if (!loc) return null;
  const champ = party.champions[loc.chIdx] ?? null;
  if (!champ) return null;
  const possessions = champ.possessions;
  if (loc.posIdx < 0 || loc.posIdx >= possessions.length) return null;
  const removed = possessions[loc.posIdx]!;
  if (removed === OBJECT_ID_NULL) return null;
  return machine.ctx.systems.character.removeCharacterPossession(loc.chIdx, loc.posIdx);
}

/** `EX_DEL`'s scroll arm (`doc/CSBwin-src/DSA.cpp:1716-1723`): its text goes first. */
function deleteLinkedScrollText(machine: DsaOperationMachine, rn: ObjectID, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  if (!machine.isValidObjectId(rn)) return;
  const { category } = dungeon.rnMaps.decode(rn);
  if (category !== DBType.SCROLL) return;
  const scroll = dungeon.getScrollRecord(rn);
  if (!scroll) return;
  // `pScroll->text()`, the six-byte scroll's RN.
  deleteObject(machine, bank, scroll.textObject ?? dungeon.rnMaps.rn(DBType.TEXT, scroll.textReference & 0x3ff));
}

function canAddToLocation(machine: DsaOperationMachine, location: number): boolean {
  const dungeon = machine.ctx.dungeon;
  if (location >= 0) {
    const locr = locationRelFromInteger(location);
    return dungeon.isValidLocation(locr);
  }
  const party = machine.ctx.party.state;
  if (!party) return false;
  if (location === -1) {
    return party.objectInHand === OBJECT_ID_NULL;
  }
  if (location > -1000) {
    const loc = decodeCharacterLocation(location);
    if (!loc) return false;
    const champ = party.champions[loc.chIdx] ?? null;
    if (!champ) return false;
    if (loc.posIdx < 0 || loc.posIdx >= 30) return false;
    return champ.possessions[loc.posIdx] === OBJECT_ID_NULL;
  }
  const monsterId = decodeMonsterLocation(machine, location);
  if (monsterId === null) return false;
  return dungeon.getCreatureRecord(monsterId) !== null;
}

function decodeCharacterLocation(location: number): { chIdx: number; posIdx: number } | null {
  if (location >= -1 || location <= -1000) return null;
  const value = -location;
  const chIdx = Math.floor(value / 100) - 1;
  const posIdx = value % 100;
  if (chIdx < 0 || posIdx < 0) return null;
  return { chIdx, posIdx };
}

function decodeMonsterLocation(machine: DsaOperationMachine, location: number): ObjectID | null {
  if (location > -1000) return null;
  const monsterId = Math.trunc(-location / 1000);
  if (!machine.isValidObjectId(monsterId)) return null;
  const decoded = machine.ctx.dungeon.rnMaps.decode(monsterId);
  if (decoded.category !== DBType.CREATURE) return null;
  return monsterId;
}

/** A corner of `mask`'s, drawn by `STRandom(n)` (`doc/CSBwin-src/DSA.cpp:2043`), or `fallback` for none. */
export function choosePositionFromMask(random: CsbRandom, mask: number, fallback: TilePosition = TilePosition.NORTH): TilePosition {
  const m = mask & 0xf;
  if (m === 0) return fallback;
  const positions: TilePosition[] = [];
  for (let p = 0; p < 4; p++) {
    if ((m & (1 << p)) !== 0) positions.push(p as TilePosition);
  }
  if (positions.length === 0) return fallback;
  const idx = random.below(positions.length); // STRandom(n), doc/CSBwin-src/DSA.cpp:2043
  return positions[idx] ?? fallback;
}

/** `groupIndex(0xd8)`, or `0xff` for a monster that fills the cell (`MoveObject.cpp:511-518`). */
export function detachedGroupIndex(monsterDesc: ArrayLike<MonsterDesc>, monster: CreatureRecord): number {
  const desc = monsterDesc[monster.creatureType];
  return desc && monsterHorizontalSize(desc) === 2 ? 0xff : 0xd8;
}

/**
 * The two halves of CSBWin's low-level `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2831`)
 * a DSA cell move, `&ADD` and `&DEL` go through: `WorldMove.moveObject`, and its monster
 * branch, `MonsterSystem.moveMonster`.
 */
export function objectMover(machine: DsaOperationMachine): { moveObject: WorldMove['moveObject']; moveMonster: MonsterSystem['moveMonster'] } {
  const { worldMove, monsters } = machine.ctx.systems;
  return {
    moveObject: (object, oldX, oldY, newX, newY, level) => worldMove.moveObject(object, oldX, oldY, newX, newY, level),
    moveMonster: (monster, oldX, oldY, newX, newY, level, cornerAfter) =>
      monsters.moveMonster(monster, oldX, oldY, newX, newY, level, cornerAfter),
  };
}

/**
 * `CopyItem` (`doc/CSBwin-src/DSA.cpp:1761-1946`): a copy of the record, from a free entry
 * of its database, or null. A monster group is not copied while the ITEM16 pool is full
 * and `loadedLevel`, the level the DSA runs on (`d.LoadedLevel`, the timer's), is the
 * party's (`:1866-1868`).
 */
function copyItem(machine: DsaOperationMachine, objectId: number, loadedLevel: number): ObjectID | null {
  const { ctx } = machine;
  const dungeon = ctx.dungeon;
  if (!machine.isValidObjectId(objectId)) return null;
  const { category, index, position } = dungeon.rnMaps.decode(objectId);
  const data = dungeon.getData();
  // Each copy takes a record through `FindEmptyDB<n>Entry(true)` (`DSA.cpp:1774-1869`,
  // `DungeonState.findEmptyDBEntry`).
  const placed = (rn: ObjectID): ObjectID | null =>
    rn === OBJECT_ID_NULL ? null : dungeon.rnMaps.setPos(rn, position);

  switch (category) {
    case DBType.ACTUATOR: {
      const rec = data.databases.actuators.records[index];
      if (!rec) return null;
      return placed(dungeon.findEmptyDBEntry('actuators', { ...rec, nextObject: OBJECT_ID_EOF }, true));
    }
    case DBType.MISC: {
      const rec = data.databases.misc.records[index];
      if (!rec) return null;
      return placed(dungeon.findEmptyDBEntry('misc', { ...rec, nextObject: OBJECT_ID_EOF }, true));
    }
    case DBType.WEAPON: {
      const rec = data.databases.weapons.records[index];
      if (!rec) return null;
      return placed(dungeon.findEmptyDBEntry('weapons', { ...rec, nextObject: OBJECT_ID_EOF }, true));
    }
    case DBType.CLOTHING: {
      const rec = data.databases.clothing.records[index];
      if (!rec) return null;
      return placed(dungeon.findEmptyDBEntry('clothing', { ...rec, nextObject: OBJECT_ID_EOF }, true));
    }
    case DBType.POTION: {
      const rec = data.databases.potions.records[index];
      if (!rec) return null;
      return placed(dungeon.findEmptyDBEntry('potions', { ...rec, nextObject: OBJECT_ID_EOF }, true));
    }
    case DBType.CREATURE: {
      const monsters = ctx.systems.monsters;
      monsters.ensureItem16Available(loadedLevel);
      if (monsters.isItem16PoolFull(loadedLevel)) return null;
      const rec = data.databases.creatures.records[index];
      if (!rec) return null;
      const copiedPossessions = copyItemList(machine, rec.possession, loadedLevel);
      // The copy must not inherit the original's ITEM16 slot. CSBWin parks it at
      // 0xd8, or 0xff for a monster that fills the whole cell, so that every
      // `groupIndex() < d.MaxITEM16` test reads it as unattached
      // (doc/CSBwin-src/DSA.cpp:1885-1888).
      return placed(dungeon.findEmptyDBEntry('creatures', {
        ...rec,
        // The record byte by byte (`DSA.cpp:1879-1882`): the copy's hit points its own.
        hp: [...rec.hp],
        nextObject: OBJECT_ID_EOF,
        possession: copiedPossessions,
        groupIndex: detachedGroupIndex(ctx.tables.monsterDesc, rec),
      }, true));
    }
    default:
      ctx.host.trace(`DSA &ADD unsupported object type ${category}`);
      return null;
  }
}

function copyItemList(machine: DsaOperationMachine, head: ObjectID, loadedLevel: number): ObjectID {
  const dungeon = machine.ctx.dungeon;
  let result = OBJECT_ID_EOF;
  let last = OBJECT_ID_EOF;
  for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = dungeon.getDBRecordLink(rn)) {
    const copied = copyItem(machine, rn, loadedLevel);
    if (copied === null) return OBJECT_ID_EOF;
    if (result === OBJECT_ID_EOF) {
      result = copied;
    } else {
      dungeon.setDBRecordLink(last, copied);
    }
    last = copied;
  }
  return result;
}

function getTypeId(machine: DsaOperationMachine, objectId: number): number {
  const dungeon = machine.ctx.dungeon;
  if (!machine.isValidObjectId(objectId)) return -1;
  const { category, index } = dungeon.rnMaps.decode(objectId);
  const data = dungeon.getData().databases;
  let id = 0;
  switch (category) {
    case DBType.DOOR: {
      const rec = data.doors.records[index];
      if (!rec) return -1;
      id = (rec.hasButton ? 1 : 0);
      if (rec.destructibleByChop) id |= 0x02;
      if (rec.destructibleByFireball) id |= 0x04;
      if (rec.vertical) id |= 0x08;
      id |= (rec.ornateNumber & 0xf) << 4;
      id |= (rec.doorType & 0x1) << 8;
      break;
    }
    case DBType.TELEPORTER: {
      const rec = data.teleporters.records[index];
      if (!rec) return -1;
      id = rec.rotation & 0x3;
      if (rec.absoluteRotation) id |= 0x04;
      id |= (rec.scope & 0x3) << 3;
      if (rec.sound) id |= 0x20;
      break;
    }
    case DBType.TEXT: {
      const rec = data.texts.records[index];
      if (!rec) return -1;
      id = rec.visible ? 1 : 0;
      break;
    }
    case DBType.ACTUATOR: {
      const rec = data.actuators.records[index];
      if (!rec) return -1;
      id = 0;
      if (isActuatorAudible(rec)) id |= 0x01;
      if (isActuatorOnceOnly(rec)) id |= 0x02;
      id |= (getActuatorType(rec) & 0x7f) << 2;
      break;
    }
    case DBType.CREATURE: {
      const rec = data.creatures.records[index];
      if (!rec) return -1;
      id = rec.creatureType & 0xff;
      break;
    }
    case DBType.WEAPON: {
      const rec = data.weapons.records[index];
      if (!rec) return -1;
      id = rec.weaponType & 0x7f;
      break;
    }
    case DBType.CLOTHING: {
      const rec = data.clothing.records[index];
      if (!rec) return -1;
      id = rec.clothingType & 0x7f;
      break;
    }
    case DBType.SCROLL:
      id = 0;
      break;
    case DBType.POTION: {
      const rec = data.potions.records[index];
      if (!rec) return -1;
      id = ((rec.potionType & 0x7f) << 8) | (rec.power & 0xff);
      break;
    }
    case DBType.CHEST: {
      const rec = data.containers.records[index];
      if (!rec) return -1;
      let count = 0;
      for (
        let rn = rec.containedObject;
        rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
        rn = dungeon.getDBRecordLink(rn)
      ) {
        count += 1;
      }
      id = count;
      break;
    }
    case DBType.MISC: {
      const rec = data.misc.records[index];
      if (!rec) return -1;
      id = rec.miscType & 0x7f;
      break;
    }
    case DBType.CLOUD: {
      const rec = data.clouds.records[index];
      if (!rec) return -1;
      id = rec.cloudType & 0x7f;
      break;
    }
    default:
      id = 0;
      break;
  }
  return category * 10000 + id;
}

/**
 * `EX_IsCarried` (`doc/CSBwin-src/DSA.cpp:1614-1642`). An object ID asks where that
 * object is: `256 * chIdx` plus its slot, 255 for the hand, or -1. A negative one is a
 * basic object type, -1 for type 0, and asks how many such objects are carried. A chest
 * is searched, and so is what it holds. Champion 4 is the hand's owner, 5 every
 * champion.
 */
function isCarried(machine: DsaOperationMachine, bank: DsaBank): void {
  const party = machine.ctx.party.state;
  const objid = bank.stack.pop();
  const charnum = bank.stack.pop();
  bank.stack.push(0);
  for (let chidx = 0; chidx < party.champions.length; chidx++) {
    if (charnum === chidx || (charnum === 4 && chidx === party.cursorOwner) || charnum === 5) {
      if (forEach(machine, bank, -chidx - 1, objid)) {
        bank.stack.push(bank.stack.pop() + 256 * chidx);
        return;
      }
    }
  }
  if (objid >= 0) {
    bank.stack.pop();
    bank.stack.push(-1);
  }
}

/**
 * `ForEach` with `IsCarriedCallback` (`doc/CSBwin-src/DSA.cpp:1521-1612`), true to end the
 * search. `thisObj` below 0 is champion `-thisObj - 1`: a find replaces the count on the
 * stack with the slot.
 */
function forEach(machine: DsaOperationMachine, bank: DsaBank, thisObj: number, srcObj: number): boolean {
  const { ctx } = machine;
  const dungeon = ctx.dungeon;
  if (thisObj === OBJECT_ID_NULL) return false;
  if (thisObj < 0) {
    const chIdx = -thisObj - 1;
    const champ = ctx.party.state.champions[chIdx]!;
    for (let i = 0; i < 30; i++) {
      if (forEach(machine, bank, getChampionPossession(champ, i), srcObj)) {
        bank.stack.pop();
        bank.stack.push(i);
        return true;
      }
    }
    if (chIdx === ctx.party.state.cursorOwner) {
      if (forEach(machine, bank, ctx.party.state.objectInHand, srcObj)) {
        bank.stack.pop();
        bank.stack.push(255);
        return true;
      }
    }
    return false;
  }
  const obj = thisObj as ObjectID;
  // `IsCarriedCallback`.
  if (srcObj < 0) {
    const type = -srcObj === 1 ? 0 : -srcObj;
    if (type === GetBasicObjectType(dungeon, ctx.tables.objDescObjectType, obj)) {
      bank.stack.push(bank.stack.pop() + 1);
    }
  } else if (srcObj === thisObj) {
    bank.stack.push(bank.stack.pop() + 1);
    return true;
  }
  switch (dungeon.rnMaps.decode(obj).category) {
    case DBType.SCROLL:
    case DBType.POTION:
    case DBType.MISC:
    case DBType.CLOTHING:
    case DBType.WEAPON:
      break;
    case DBType.CHEST: {
      const chest = dungeon.getContainerRecord(obj);
      for (let contents = chest?.containedObject ?? OBJECT_ID_EOF; contents !== OBJECT_ID_EOF;
        contents = dungeon.getDBRecordLink(contents)) {
        if (forEach(machine, bank, contents, srcObj)) return true;
      }
      break;
    }
    default:
      // `NotImplemented(0xdd6a)`.
      ctx.host.trace('DSA &ISCARRIED: not implemented 0xdd6a');
      break;
  }
  return false;
}

/**
 * `&CURSE@`, `&BROKEN@`, `&POISONED@`, `&CHARGES@` and `&SUBTYPE@`
 * (`doc/CSBwin-src/DSA.cpp:3412-3440`, `:3459-3484`, `:3512-3537`, `:3565-3596`,
 * `:3630-3652`): the field of the object at slot `objIndex`, 0 for an invalid slot or a
 * database without it. A potion's charges are its strength, a misc object's its
 * `value()`; only a weapon has a poison bit, and only a misc object a subtype.
 */
function getObjectField(machine: DsaOperationMachine, subcode: number, objIndex: number): number {
  const dungeon = machine.ctx.dungeon;
  if (!machine.isValidObjectId(objIndex)) return 0;
  const dbType = dungeon.rnMaps.dbType(objIndex);
  const weapon = dbType === DBType.WEAPON ? dungeon.getWeaponRecord(objIndex) : null;
  const clothing = dbType === DBType.CLOTHING ? dungeon.getClothingRecord(objIndex) : null;
  const potion = dbType === DBType.POTION ? dungeon.getPotionRecord(objIndex) : null;
  const misc = dbType === DBType.MISC ? dungeon.getMiscRecord(objIndex) : null;
  const bit = (b: boolean | undefined): number => (b ? 1 : 0);
  switch (subcode) {
    case StkOp.GET_CURSE:
      return weapon ? bit(weapon.cursed) : clothing ? bit(clothing.cursed) : misc ? bit(misc.cursed) : 0;
    case StkOp.GET_BROKEN:
      return weapon ? bit(weapon.broken) : clothing ? bit(clothing.broken) : 0;
    case StkOp.GET_POISONED:
      return weapon ? bit(weapon.poisoned) : 0;
    case StkOp.GET_CHARGES:
      return weapon ? weapon.charges : clothing ? clothing.charges
        : potion ? potion.power : misc ? misc.specialState : 0;
    default:
      return misc ? misc.subType ?? 0 : 0;
  }
}

/**
 * `&CURSE!`, `&BROKEN!`, `&POISONED!`, `&CHARGES!` and `&SUBTYPE!`
 * (`doc/CSBwin-src/DSA.cpp:3441-3458`, `:3485-3511`, `:3538-3564`, `:3597-3629`,
 * `:3653-3676`): the setters of `getObjectField`'s fields, each value cut to its
 * field's width by `SETWBITS` (`CSB.h:749-777`), a flag set by any non-zero value.
 * A curse goes through `SetCursed`.
 */
function setObjectField(machine: DsaOperationMachine, subcode: number, objIndex: number, value: number): void {
  const dungeon = machine.ctx.dungeon;
  if (!machine.isValidObjectId(objIndex)) return;
  const dbType = dungeon.rnMaps.dbType(objIndex);
  if (subcode === StkOp.SET_CURSE) {
    setCursed(machine, objIndex, value !== 0);
    return;
  }
  const weapon = dbType === DBType.WEAPON ? dungeon.getWeaponRecord(objIndex) : null;
  const clothing = dbType === DBType.CLOTHING ? dungeon.getClothingRecord(objIndex) : null;
  const potion = dbType === DBType.POTION ? dungeon.getPotionRecord(objIndex) : null;
  const misc = dbType === DBType.MISC ? dungeon.getMiscRecord(objIndex) : null;
  switch (subcode) {
    case StkOp.SET_BROKEN:
      if (weapon) weapon.broken = value !== 0;
      else if (clothing) clothing.broken = value !== 0;
      break;
    case StkOp.SET_POISONED:
      if (weapon) weapon.poisoned = value !== 0;
      break;
    case StkOp.SET_CHARGES:
      if (weapon) weapon.charges = value & 0xf;
      else if (clothing) clothing.charges = value & 0xf;
      else if (potion) potion.power = value & 0xff;
      else if (misc) misc.specialState = value & 3;
      break;
    default:
      if (misc) misc.subType = value & 0x1f;
  }
}

/**
 * `SetCursed` (`doc/CSBwin-src/Character.cpp:1787-1821`): the curse bracketed by
 * `AdjustStatsForItemCarried`'s -1 and +1 on the champion carrying the object, at the
 * slot it is in. CSBWin's search leaves only its inner loop, so it passes that slot
 * only when the bearer is the last champion, and slot 30 for any other; the port's
 * leaves both (`DEBT.md` H).
 */
function setCursed(machine: DsaOperationMachine, obj: ObjectID, curse: boolean): void {
  const { ctx } = machine;
  const dungeon = ctx.dungeon;
  const champions = ctx.party.state.champions;
  let pCH: Champion | null = null;
  let loc = -1;
  search: for (let ch = 0; ch < champions.length; ch++) {
    for (loc = 0; loc < 30; loc++) {
      if (obj === getChampionPossession(champions[ch]!, loc)) {
        pCH = champions[ch]!;
        break search;
      }
    }
  }
  const character = ctx.systems.character;
  if (pCH) character.adjustStatsForItemCarried(pCH, loc, -1, obj);
  let record: { cursed?: boolean } | null = null;
  switch (dungeon.rnMaps.dbType(obj)) {
    case DBType.WEAPON: record = dungeon.getWeaponRecord(obj); break;
    case DBType.CLOTHING: record = dungeon.getClothingRecord(obj); break;
    case DBType.MISC: record = dungeon.getMiscRecord(obj); break;
    default: break;
  }
  if (record) record.cursed = curse;
  if (pCH) character.adjustStatsForItemCarried(pCH, loc, +1, obj);
}

const GETTERS = [StkOp.GET_CURSE, StkOp.GET_BROKEN, StkOp.GET_POISONED, StkOp.GET_CHARGES, StkOp.GET_SUB_TYPE];
const SETTERS = [StkOp.SET_CURSE, StkOp.SET_BROKEN, StkOp.SET_POISONED, StkOp.SET_CHARGES, StkOp.SET_SUB_TYPE];

/**
 * The objects: `EX_AMPERSAND`'s cases (`doc/CSBwin-src/DSA.cpp:2490`, `&ADD` at `:2520`,
 * `&OBJECTID` at `:2734`, `&TYPE` at `:2789`, the fields at `:3412-3676`, `&COPY` at
 * `:4697` and `&ISCARRIED` at `:4792`), in the order the port's switch had them.
 */
export const objectOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.DEL, (bank, _exPkt, machine) => {
    const { ctx } = machine;
    const dungeon = ctx.dungeon;
    const location = bank.stack.pop();
    const objId = bank.stack.pop();
    bank.noFilter();
    if (location < 0) {
      const removed = deleteFromNegativeLocation(machine, location);
      if (removed !== null && removed !== undefined) {
        deleteLinkedScrollText(machine, removed, bank);
        deleteObject(machine, bank, removed);
      }
      return;
    }
    const locr = locationRelFromInteger(location);
    if (!dungeon.isValidLocation(locr)) {
      ctx.host.trace('Illegal location in DSA &DEL');
      return;
    }
    const pos = new Position(locr.x, locr.y, locr.l);
    for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (!machine.isValidObjectId(objId) || !rnEquals(rn, objId)) continue;
      const { category } = dungeon.rnMaps.decode(rn);
      if (!canDeleteFromCell(category)) break;
      // `MoveObject(thisObj, x, y, -1, 0)` on the square's level (`DSA.cpp:1700-1704`).
      objectMover(machine).moveObject(rn, pos.x, pos.y, -1, 0, pos.z);
      deleteLinkedScrollText(machine, rn, bank);
      deleteObject(machine, bank, rn);
      break;
    }
  }],
  [StkOp.ADD, (bank, exPkt, machine) => {
    const { ctx } = machine;
    const dungeon = ctx.dungeon;
    const objId = bank.stack.pop();
    const location = bank.stack.pop();
    const posMask = bank.stack.pop() & 0xf;
    bank.noFilter();
    if (!canAddToLocation(machine, location)) return;
    if (!machine.isValidObjectId(objId)) return;
    const cloned = copyItem(machine, objId, exPkt.locrSlave.l);
    bank.mostRecentInterestingObjectID = cloned ?? OBJECT_ID_EOF;
    if (cloned === null) return;
    if (location >= 0) {
      const locr = locationRelFromInteger(location);
      if (!dungeon.isValidLocation(locr)) return;
      const pos = choosePositionFromMask(ctx.random, posMask);
      // `MoveObject(newObj, -1, 0, x, y)` on the square's level, then `newObj.pos(p)`
      // (`DSA.cpp:2055-2059`): the pads see the copy's corner, and it lies in corner `p`.
      const mover = objectMover(machine);
      if (dungeon.rnMaps.dbType(cloned) === DBType.CREATURE) {
        mover.moveMonster(cloned, -1, 0, locr.x, locr.y, locr.l, pos);
      } else {
        mover.moveObject(cloned, -1, 0, locr.x, locr.y, locr.l);
        dungeon.rnMaps.setPos(cloned, pos);
      }
    } else if (location === -1) {
      const party = ctx.party.state;
      if (!party) return;
      // `CURSORFILTER_DSA_ADD` for the copy, which cannot cancel; `ObjectToCursor`
      // then fills the hand, whatever the filter put there (`DSA.cpp:2063-2072`).
      machine.filters.cursorFilter({ object: cloned, type: CursorFilterType.DSA_ADD, p1: 0, p2: 0, p3: 0, p4: 0 });
      party.objectInHand = cloned;
    } else if (location > -1000) {
      const party = ctx.party.state;
      if (!party) return;
      const loc = decodeCharacterLocation(location);
      if (!loc) return;
      const champ = party.champions[loc.chIdx] ?? null;
      if (!champ) return;
      ctx.systems.character.addCharacterPossession(loc.chIdx, cloned, loc.posIdx);
    } else {
      const monsterId = decodeMonsterLocation(machine, location);
      if (monsterId === null) return;
      const monster = dungeon.getCreatureRecord(monsterId);
      if (!monster) return;
      // `doc/CSBwin-src/DSA.cpp:2084-2086`: the copy, its link already `RNeof`,
      // heads an empty chain, else `AddObjectToRoom(newObj, *pDest, -1, 0, NULL)`.
      if (monster.possession === OBJECT_ID_EOF) monster.possession = cloned;
      else dungeon.addObjectToChain(cloned, monster.possession);
    }
  }],
  [StkOp.OBJECT_ID, (bank) => {
    bank.stack.push(bank.mostRecentInterestingObjectID);
  }],
  [StkOp.TYPE, (bank, _exPkt, machine) => {
    bank.stack.push(getTypeId(machine, bank.stack.pop()));
  }],
  [StkOp.COPY, (bank, _exPkt, machine) => {
    const dungeon = machine.ctx.dungeon;
    const dstId = bank.stack.pop();
    const srcId = bank.stack.pop();
    if (!machine.isValidObjectId(srcId) || !machine.isValidObjectId(dstId)) return;
    const srcDecoded = dungeon.rnMaps.decode(srcId);
    const dstDecoded = dungeon.rnMaps.decode(dstId);
    if (srcDecoded.category !== dstDecoded.category) return;
    bank.noFilter();
    if (srcDecoded.category === DBType.ACTUATOR) {
      const src = dungeon.getActuatorRecord(srcId);
      const dst = dungeon.getActuatorRecord(dstId);
      if (!src || !dst) return;
      // `memcpy(((ui8 *)pDst)+2, ((ui8 *)pSrc)+2, sizeof(*pSrc)-2)` (`DSA.cpp:4717`): the
      // whole record past its link, a big actuator's `word8` with it.
      dst.word2 = src.word2;
      dst.word4 = src.word4;
      dst.word6 = src.word6;
      if (src.word8 !== undefined) dst.word8 = src.word8;
    }
  }],
  [StkOp.IS_CARRIED, (bank, _exPkt, machine) => {
    isCarried(machine, bank);
  }],
  ...GETTERS.map((op): [StkOp, DsaOperation] => [op, (bank, _exPkt, machine) => {
    bank.stack.push(getObjectField(machine, op, bank.stack.pop()));
  }]),
  ...SETTERS.map((op): [StkOp, DsaOperation] => [op, (bank, _exPkt, machine) => {
    const value = bank.stack.pop();
    setObjectField(machine, op, bank.stack.pop(), value);
  }]),
]);
