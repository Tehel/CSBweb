/**
 * Clicking inside the 3D viewport: what the point under the cursor refers to.
 *
 * The bytecode renderer records, for every object and wall feature it blits, the screen
 * rectangle it occupied plus the object's RN (`ViewportPicking.viewportObjectButtons` /
 * `viewportObjectRNs`). Picking is therefore a reverse lookup over that frame's output —
 * CSBWin does the same thing (`doc/CSBwin-src/Mouse.cpp`, `doc/CSBwin-src/Viewport.cpp`)
 * rather than projecting the click back into the dungeon.
 */
import { OBJNI_BONES_A, OBJNI_EMPTY_FLASK, OBJNI_WATER, OBJNI_WATERSKIN } from '../../core/objectNameIndex';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, ObjectID, Position, RoomType, getRoomType } from '../../core/types';
import { CreatureRecord } from '../../data/dungeonTypes';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { ViewRoomType } from '../bytecode/Types';
import { resolveObjectNameIndex } from './Objects';
import { UIState } from './UIState';
import { setClockTick } from '../../engine/LoopState';
import { CursorFilterType } from '../../engine/dsa/DsaTypes';
import { forgetThrownWeapon } from '../../engine/ThrownWeapons';

const POTION_WATER_FLASK = 15;

type ViewportCursorAction =
  | { kind: 'throw'; side: 0 | 1 }
  | { kind: 'drop'; pos: number; viAltar?: boolean }
  | { kind: 'wall' };

function isDoorSwitchHit(ui: UIState, x: number, y: number): boolean {
  const rects = ui.picking.doorSwitchRects;
  if (rects.length === 0) return false;
  const vx = x - VIEWPORT_X;
  const vy = y - VIEWPORT_Y;
  for (const rect of rects) {
    if (vx >= rect.x1 && vx <= rect.x2 && vy >= rect.y1 && vy <= rect.y2) return true;
  }
  return false;
}

/** What an empty-handed click in the viewport touches (`resolveEmptyHandedViewportClick`). */
type EmptyHandedViewportTarget = 'doorSwitch' | 'wall' | 'object' | 'stone';

/**
 * What an empty-handed click in the viewport touches, in `HandleClickInViewport`'s order
 * (`doc/CSBwin-src/Mouse.cpp:1054-1158`): the door switch first, then the six viewport
 * buttons 0..5, the first hit winning. 0-4 are the objects drawn in the cells ahead and 5
 * is the front wall's decoration (`CSBCode.cpp:3360`), so an object lying in an alcove is
 * picked up rather than the alcove touched. Button 5 of an alcove touches nothing at all
 * — `TouchWallF1` only runs `if (d.FacingAlcove == 0)` (`Mouse.cpp:1124-1129`).
 *
 * A click that hit no button is `'stone'`, which makes a sound, when it lands on the bare
 * stone ahead (`:1139-1158`): the party is not facing an alcove, `d.CellTypeJustAhead`
 * (`ViewportPicking.cellTypeJustAhead`, `Viewport.cpp:6789-6792`) is stone, the cell's own flags are
 * stone or a false wall neither open nor imaginary (`(cf & 5) == 0`), and the click is
 * within x 33-189, y 44-150. A closed imaginary false wall passes the first test and fails
 * the second.
 *
 * Returns `null` for any other click that hit no button, and for an alcove's own wall.
 */
export function resolveEmptyHandedViewportClick(ui: UIState, x: number, y: number): EmptyHandedViewportTarget | null {
  if (isDoorSwitchHit(ui, x, y)) return 'doorSwitch';
  for (let button = 0; button < 6; button++) {
    if (!isViewportButtonHit(ui, button, x, y)) continue;
    if (button < 5) return 'object';
    return ui.picking.facingAlcove ? null : 'wall';
  }
  if (ui.picking.facingAlcove) return null;
  if (ui.picking.cellTypeJustAhead !== RoomType.STONE) return null;
  if (!isFrontCellStoneOrVisibleFalseWall(ui)) return null;
  if (x < 33 || x > 189 || y < 44 || y > 150) return null;
  return 'stone';
}

export function tryPickViewportObject(ui: UIState, x: number, y: number): boolean {
  if (ui.partyState.objectInHand !== OBJECT_ID_NULL) return false;
  if (ui.partyState.cursorOwner < 0) return false;

  const hit = findViewportObjectHit(ui, x, y);
  if (!hit) return false;

  const target = getPickupCellForRelativePos(ui, hit.relativeLocation);
  if (!target) return false;
  if (isMonsterBlockingPickup(ui, hit.relativeLocation, target)) return false;
  // `CURSORFILTER_PickFromFloor`, which may cancel the pick-up (`doc/CSBwin-src/Mouse.cpp:828-836`).
  const cfp = { object: hit.rn, type: CursorFilterType.PickFromFloor, p1: target.z, p2: target.x, p3: target.y, p4: hit.relativeLocation };
  ui.ctx.systems.dsa.filters.cursorFilter(cfp);
  if (cfp.type === CursorFilterType.Cancel) return false;
  // `TAG01a148` ends with `d.clockTick = 1` (`doc/CSBwin-src/Mouse.cpp:841`), which only
  // its returns for no cursor owner, a monster in the way and a cancel skip.
  setClockTick(ui.ctx, 1);
  if (!ui.ctx.dungeon.removeObjectFromCell(target, hit.rn)) return false;
  ui.ctx.systems.mouse.triggerObjectMove(target, hit.rn, false, false, ui.partyState.facing & 0x3);

  ui.partyState.objectInHand = hit.rn;
  forgetThrownWeapon(ui.ctx, hit.rn);
  return true;
}

export function hasCursorObject(ui: UIState): boolean {
  return ui.partyState.objectInHand !== OBJECT_ID_NULL;
}

export function resolveViewportCursorAction(ui: UIState, x: number, y: number): ViewportCursorAction | null {
  const objectId = ui.partyState.objectInHand;
  if (objectId === OBJECT_ID_NULL) return null;
  if (ui.partyState.cursorOwner < 0) return null;

  // `d.CellTypeJustAhead == 0` (`doc/CSBwin-src/Mouse.cpp:1166`), which is all this arm
  // tests: a false wall that is not open summarises as stone, imaginary or not
  // (`Codea59a.cpp:278-279`), unlike the bare-stone sound's `(cf & 5) == 0`.
  const stoneAhead = ui.picking.cellTypeJustAhead === RoomType.STONE;
  const doorFacingAhead = isFrontCellDoorFacing(ui);

  if (stoneAhead) {
    const dropPos = findDropAreaHit(ui, x, y, 2);
    if (dropPos !== null) return { kind: 'drop', pos: dropPos };

    if (isViewportButtonHit(ui, 5, x, y)) {
      if (ui.picking.facingAlcove) {
        let viAltar = false;
        if (ui.picking.facingViAltar) {
          const objectNameIndex = resolveObjectNameIndex(ui, objectId);
          viAltar = objectNameIndex === OBJNI_BONES_A;
        }
        return { kind: 'drop', pos: 4, viAltar };
      }
      return { kind: 'wall' };
    }
    return null;
  }

  const throwSide = testThrow(x, y, doorFacingAhead);
  if (throwSide !== null) return { kind: 'throw', side: throwSide };

  const dropPos = findDropAreaHit(ui, x, y, 4);
  if (dropPos !== null) return { kind: 'drop', pos: dropPos };
  return null;
}

/**
 * `HandleClickInViewport`'s fountain (`doc/CSBwin-src/Mouse.cpp:1195-1227`): button 5 of a
 * wall that is no alcove, with a waterskin or an empty flask in hand, before a fountain
 * fills it. The caller touches the wall afterwards either way (`TouchWallF1`, `:1228-1229`).
 */
export function fillAtWaterFountain(ui: UIState): void {
  if (!ui.picking.facingWaterFountain) return;

  const objectId = ui.partyState.objectInHand;
  const objectNameIndex = resolveObjectNameIndex(ui, objectId);

  if (objectNameIndex >= OBJNI_WATERSKIN && objectNameIndex <= OBJNI_WATER) {
    const misc = ui.ctx.dungeon.getMiscRecord(objectId);
    if (misc) misc.specialState = 3;
  } else if (objectNameIndex === OBJNI_EMPTY_FLASK) {
    const potion = ui.ctx.dungeon.getPotionRecord(objectId);
    if (potion) potion.potionType = POTION_WATER_FLASK;
  }
}

export function findDropAreaHit(ui: UIState, x: number, y: number, count: number): number | null {
  const areas = ui.uiTables.graphic231.dropAreas;
  if (!areas || areas.length === 0) return null;
  const max = Math.min(count, areas.length);
  for (let i = 0; i < max; i++) {
    const rect = areas[i];
    if (!rect) continue;
    if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) return i;
  }
  return null;
}

function isViewportButtonHit(ui: UIState, index: number, x: number, y: number): boolean {
  const buttons = ui.picking.viewportObjectButtons;
  if (index < 0 || index >= buttons.length) return false;
  const rect = buttons[index];
  if (!rect || rect.x1 === 255) return false;
  const vx = x - VIEWPORT_X;
  const vy = y - VIEWPORT_Y;
  return vx >= rect.x1 && vx <= rect.x2 && vy >= rect.y1 && vy <= rect.y2;
}

export function testThrow(clickX: number, clickY: number, doorFacing: boolean): 0 | 1 | null {
  if (clickY < 47 || clickY > 102) return null;
  if (clickX <= 111) {
    if (clickX < 32) return null;
    if (clickX < 64 && doorFacing) return null;
    return 0;
  }
  if (clickX > 191) return null;
  if (clickX > 163 && doorFacing) return null;
  return 1;
}

function isFrontCellStoneOrVisibleFalseWall(ui: UIState): boolean {
  const facing = ui.partyState.facing & 0x3;
  const pos = ui.partyState.position;
  const target = new Position(pos.x + ui.ctx.tables.deltaX[facing]!, pos.y + ui.ctx.tables.deltaY[facing]!, pos.z);
  const map = ui.ctx.dungeon.getMap(target.z);
  if (!map) return true;
  if (target.x < 0 || target.y < 0 || target.x >= map.descriptor.width || target.y >= map.descriptor.height) return true;
  const cellFlag = map.cellFlags[target.x]?.[target.y];
  if (cellFlag === undefined) return true;
  const roomType = getRoomType(cellFlag);
  if (roomType === RoomType.STONE) return true;
  if (roomType === RoomType.FALSEWALL && (cellFlag & 0x5) === 0) return true;
  return false;
}

/** `d.CellTypeJustAhead == roomDOORFACING` (`doc/CSBwin-src/Mouse.cpp:1054`). */
function isFrontCellDoorFacing(ui: UIState): boolean {
  return ui.picking.cellTypeJustAhead === ViewRoomType.DOOR_FACING;
}

function findViewportObjectHit(ui: UIState, x: number, y: number): { relativeLocation: number; rn: ObjectID } | null {
  const { viewportObjectButtons: buttons, viewportObjectRNs: rns } = ui.picking;

  const vx = x - VIEWPORT_X;
  const vy = y - VIEWPORT_Y;
  if (vx < 0 || vy < 0 || vx >= VIEWPORT_WIDTH || vy >= VIEWPORT_HEIGHT) return null;

  const max = Math.min(5, buttons.length, rns.length);
  for (let i = 0; i < max; i++) {
    const rect = buttons[i];
    if (!rect || rect.x1 === 255) continue;
    if (vx < rect.x1 || vx > rect.x2 || vy < rect.y1 || vy > rect.y2) continue;
    const rn = rns[i];
    // A frame's picking starts the five at `RNeof` (`emptyViewportPicking`), before the
    // interpreter writes the objects it drew.
    if (rn === undefined || rn === OBJECT_ID_EOF) continue;
    return { relativeLocation: i, rn };
  }
  return null;
}

function getPickupCellForRelativePos(ui: UIState, relativeLocation: number): Position | null {
  const facing = ui.partyState.facing & 0x3;
  let target = ui.partyState.position;
  if (relativeLocation >= 2) {
    target = new Position(target.x + ui.ctx.tables.deltaX[facing]!, target.y + ui.ctx.tables.deltaY[facing]!, target.z);
  }
  return target;
}

function isMonsterBlockingPickup(ui: UIState, relativeLocation: number, position: Position): boolean {
  if (relativeLocation < 2) return false;
  const rn = ui.ctx.dungeon.findFirstMonster(position);
  if (rn === OBJECT_ID_EOF) return false;
  const creature = ui.ctx.dungeon.getCreatureRecord(rn);
  if (!creature || isMonsterLevitating(ui, creature)) return false;
  const monsterCount = (creature.numMonM1 & 0x3) + 1;
  const absPos = (ui.partyState.facing + relativeLocation) & 0x3;
  // Take the positions from the render state, not from DB4 directly: once an ITEM16
  // is attached the live positions live there and `groupIndex` is the slot number.
  const positions = ui.ctx.dungeon.getMonsterRenderState(creature).positions;
  return monsterOccupiesPosition(positions, absPos, monsterCount);
}

export function isMonsterLevitating(ui: UIState, creature: CreatureRecord): boolean {
  const desc = ui.objectTables.monsterDesc[creature.creatureType];
  if (!desc) return false;
  return (desc.word2 & 0x20) !== 0;
}

function monsterOccupiesPosition(positions: number, curAbsPos: number, count: number): boolean {
  return monsterIndexAtPosition(positions, curAbsPos, count) >= 0;
}

function monsterIndexAtPosition(positions: number, curAbsPos: number, count: number): number {
  if (isCenteredPositions(positions)) return 0;
  for (let i = 0; i < count; i++) {
    if (((positions >> (2 * i)) & 0x3) === curAbsPos) return i;
  }
  return -1;
}

function isCenteredPositions(positions: number): boolean {
  return (positions & 0xff) === 0xff;
}
