/**
 * The mouse: CSBWin's click ring buffer, the button dispatcher, and the cursor.
 *
 * Mirrors `doc/CSBwin-src/Mouse.cpp`. Clicks are not handled where they arrive: the host
 * turns one into a button with `searchMouseButtons` and queues it on the game's one mouse
 * queue (`Game.onMouseClick`), where it waits its turn behind keys and other clicks.
 * `Game.handleMouseEvents` handles the turns and steps itself and hands every other button
 * to `handleMouseButton`, the dispatcher on the `word0` ids `searchButtonList` returns.
 */
import { IndexedBitmap } from '../csbwin/CanvasBlitter';
import { decodeCursorBitmap } from '../csbwin/UITables';
import { canPlaceInSlot, setChampionPossession } from './Character';
import { drawObjectIconAt } from './Draw';
import { handleMouthPress } from './Feeding';
import { pointInRect, searchButtonList } from './HitTest';
import { getActiveChestView, getEyeRect, syncOpenChest } from './Inventory';
import { handleMagicClick } from './MagicPanel';
import { handleAttackAreaClick } from './Attack';
import { resolveObjectNameIndex } from './Objects';
import { OBJECT_ID_NULL } from '../../core/types';
import { UIMode, UIState } from './UIState';
import { getPartyChampion, setHandOwner } from '../../engine/Party';
import { updateHover } from '@/ui';

export { decodeCursorBitmap };

/**
 * `OnMouseClick`'s button search (doc/CSBwin-src/CSBCode.cpp:7631-7676): the primary list,
 * then the secondary. 0 for a click that hit no button, which is never queued.
 */
export function searchMouseButtons(ui: UIState, x: number, y: number, buttons: number): number {
  const id = searchButtonList(ui.primaryButtons, x, y, buttons);
  if (id !== 0) return id;
  return searchButtonList(ui.secondaryButtons, x, y, buttons);
}

export function handleMouseButton(ui: UIState, id: number, x: number, y: number): void {
  // updateDebug(`handling click on ${id}`)
  if (id === 80 && isEyeClick(ui, x, y)) {
    handleEyePress(ui);
    return;
  }
  if (id === 70) {
    handleMouthPress(ui);
    return;
  }
  // `d.PotentialCharacterOrdinal` makes the Hall of Champions menu modal: while a
  // champion is only provisionally in the party, the portrait boxes, the inventory
  // buttons, the magic panel and the attack panel are all inert
  // (`doc/CSBwin-src/Mouse.cpp:1578-1650`).
  const potential = (ui.partyState?.potentialChampionIndex ?? -1) >= 0;
  const numChampions = ui.partyState?.champions.length ?? 0;
  if (id === 100) {
    if (!potential && (ui.partyState?.magicCasterIndex ?? -1) !== -1) {
      handleMagicClick(ui, x, y);
    }
    return;
  }
  if (id === 81) {
    tag01a6ea(ui, x, y);
    return;
  }
  if (id === 111) {
    if (!potential) handleAttackAreaClick(ui, x, y);
    return;
  }
  if (id === 83) {
    if (!ui.partyState) return;
    const owner = ui.partyState.cursorOwner;
    if (owner >= 0) handleInventoryToggle(ui, owner);
    return;
  }
  if (id >= 7 && id <= 11) {
    const button = id - 7;
    if ((button === 4 || button < numChampions) && !potential) {
      handleInventoryToggle(ui, button);
    }
    return;
  }
  if (id >= 12 && id <= 15) {
    const button = id - 12;
    if (button < numChampions && !potential) {
      handlePartyBlockClick(ui, button, x, y);
    }
    return;
  }
  if (id >= 28 && id <= 65) {
    if ((ui.partyState?.cursorOwner ?? -1) >= 0) {
      handleClothingClick(ui, id - 20);
    }
    return;
  }
  if (id === 71) {
    handleEyePress(ui);
    return;
  }
  // `if (d.PressingEye!=0) {lastTime=d.Time; RETURN_int(result);};` and the same for
  // the mouth (doc/CSBwin-src/Mouse.cpp:1679-1680): every button after 81 is swallowed
  // until the button-up lets go. The port has no pressed mouth — `handleMouthPress`
  // feeds on the press — so only the eye is tested.
  if (ui.pressingEye) return;
  if (id === 145) {
    // The sleep icon, `buttons17760` beside the disk (`doc/CSBWIN_MENU_REFERENCE.md`), so
    // it is only ever clicked with an inventory open. `ShowHideInventory(4)` closes it
    // before anything else (`doc/CSBwin-src/Mouse.cpp:1683-1691`); the rest is the
    // engine's. Refused, like the disk, while a champion is only provisionally joined.
    if (!potential) {
      if ((ui.partyState?.selectedCharacterIndex ?? -1) >= 0) handleInventoryToggle(ui, 4);
      ui.onSleep?.();
    }
    return;
  }
  if (id === 146) {
    // `WakeUp()` (`doc/CSBwin-src/Mouse.cpp:1709-1714`): `Buttons17796`, a click anywhere
    // in the viewport while the party sleeps.
    ui.onWakeUp?.();
    return;
  }
  if (id === 140) {
    // The disk icon, `buttons17760[1]` (`doc/CSBWIN_MENU_REFERENCE.md`). Both guards are
    // CSBWin's (`doc/CSBwin-src/Mouse.cpp:1708-1727`): an empty party, or a champion
    // only provisionally in it, and the icon does nothing. The menu is not opened here —
    // `DiskMenuNeeded` is raised and whoever drained the queue acts on it.
    if (numChampions > 0 && !potential) ui.diskMenuNeeded = true;
    return;
  }
}

export function handleMouseUnclick(ui: UIState): void {
  if (ui.pressingEye) {
    ui.pressingEye = false;
  }
}

export function isEyeClick(ui: UIState, x: number, y: number): boolean {
  if (!ui.partyState || ui.partyState.selectedCharacterIndex < 0) return false;
  const rect = getEyeRect(ui);
  if (!rect) return false;
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

export function handleEyePress(ui: UIState): void {
  if (!ui.partyState) return;
  if (ui.partyState.selectedCharacterIndex < 0) return;
  ui.pressingEye = true;
}

export function handlePartyBlockClick(ui: UIState, button: number, x: number, y: number): void {
  if (!ui.uiTables || !ui.partyState) return;
  if (ui.partyState.selectedCharacterIndex === button) {
    setHandOwner(ui.partyState, button);
    return;
  }
  const sub = searchButtonList(ui.uiTables.graphic231.buttons.buttons18216, x, y, 2);
  if (sub >= 16 && sub <= 19) {
    setHandOwner(ui.partyState, sub - 16);
    return;
  }
  if (sub >= 20 && sub <= 27) {
    // No cursor-owner test here: `TAG019c34` reaches `HandleClothingClick` directly
    // (doc/CSBwin-src/CSBCode.cpp:8376-8381). Only the id 28-65 dispatcher path
    // (doc/CSBwin-src/Mouse.cpp:1600-1606) and the chest area
    // (doc/CSBwin-src/CSBCode.cpp:8509-8511) require one.
    handleClothingClick(ui, sub - 20);
  }
}

/**
 * `_TAG01a6ea` (`doc/CSBwin-src/CSBCode.cpp:8500`) — a click in the eye panel, routed
 * by whatever `TAG0189d4` last drew there. Button id 81.
 */
export function tag01a6ea(ui: UIState, clickX: number, clickY: number): void {
  if (!ui.uiTables || !ui.partyState) return;
  const buttons = ui.uiTables.graphic231.buttons;

  if (ui.displayResurrectChestOrScroll === 4) {
    // An open chest in the weapon hand: the grid takes clothing clicks, but only from
    // someone holding the cursor (`d.HandChar != -1`).
    if ((ui.partyState.cursorOwner ?? -1) < 0) return;
    const selected = ui.partyState.selectedCharacterIndex ?? -1;
    if (selected < 0) return;
    const champ = getPartyChampion(ui.partyState, selected);
    if (!champ || champ.alive === false) return;
    const chestView = getActiveChestView(ui, champ);
    if (!chestView || chestView.source !== 'hand') return;
    const button = searchButtonList(buttons.buttons18324, clickX, clickY, 2);
    if (button !== 0) handleClothingClick(ui, button - 20);
    return;
  }

  if (ui.displayResurrectChestOrScroll === 5) {
    // The Hall of Champions menu, and only with an empty cursor (`d.EmptyHanded`).
    if (ui.partyState.objectInHand !== OBJECT_ID_NULL) return;
    const button = searchButtonList(buttons.buttons18372, clickX, clickY, 2);
    if (button !== 0) ui.onResurrectReincarnateCancel?.(button);
  }
}

export function handleInventoryToggle(ui: UIState, button: number): void {
  if (!ui.partyState) return;
  if (button === 4) {
    syncOpenChest(ui, null);
    ui.partyState.selectedCharacterIndex = -1;
    ui.pressingEye = false;
    syncInventoryButtons(ui);
    return;
  }
  if (button < 0 || button > 3) return;
  const champ = getPartyChampion(ui.partyState, button);
  if (!champ || champ.alive === false) return;
  const previous = ui.partyState.selectedCharacterIndex;
  ui.partyState.selectedCharacterIndex =
    ui.partyState.selectedCharacterIndex === button ? -1 : button;
  if (ui.partyState.selectedCharacterIndex !== previous) {
    syncOpenChest(ui, null);
  }
  if (ui.partyState.selectedCharacterIndex < 0) {
    ui.pressingEye = false;
  }
  syncInventoryButtons(ui);
}

export function syncInventoryButtons(ui: UIState): void {
  if (!ui.uiTables || ui.uiMode !== UIMode.Adventure) return;
  const buttons = ui.uiTables.graphic231.buttons;
  const inventoryOpen = (ui.partyState?.selectedCharacterIndex ?? -1) >= 0;
  ui.secondaryButtons = inventoryOpen ? buttons.buttons17760 : buttons.buttons17304;
}

export function handleClothingClick(ui: UIState, button: number): void {
  if (!ui.partyState || !ui.uiTables) return;
  // `HandleClothingClick` itself does not care who owns the cursor
  // (doc/CSBwin-src/CSBCode.cpp:6928); its callers decide.
  let chIdx = -1;
  let slot = -1;
  if (button < 8) {
    chIdx = Math.floor(button / 2);
    if (chIdx >= ui.partyState.champions.length) return;
    if (ui.partyState.selectedCharacterIndex === chIdx) return;
    const champ = getPartyChampion(ui.partyState, chIdx);
    if (!champ || champ.alive === false) return;
    slot = button & 1;
  } else {
    chIdx = ui.partyState.selectedCharacterIndex ?? -1;
    if (chIdx < 0) return;
    slot = button - 8;
  }

  if (slot < 0 || slot >= 38) return;
  const champ = getPartyChampion(ui.partyState, chIdx);
  if (!champ || champ.alive === false) return;

  const chestView = getActiveChestView(ui, champ);
  const isChestSlot = slot >= 30;
  if (isChestSlot) {
    if (!chestView) return;
    syncOpenChest(ui, chestView);
  }

  const objectInHand = ui.partyState.objectInHand;
  const slotObject = isChestSlot
    ? ui.openChestContents[slot - 30] ?? OBJECT_ID_NULL
    : champ.possessions[slot] ?? OBJECT_ID_NULL;
  if (objectInHand === OBJECT_ID_NULL && slotObject === OBJECT_ID_NULL) return;

  if (objectInHand !== OBJECT_ID_NULL && !canPlaceInSlot(ui, objectInHand, slot)) return;

  if (objectInHand !== OBJECT_ID_NULL) {
    ui.partyState.objectInHand = OBJECT_ID_NULL;
  }
  if (slotObject !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.openChestContents[slot - 30] = OBJECT_ID_NULL;
    } else {
      setChampionPossession(ui, champ, slot, OBJECT_ID_NULL);
    }
    ui.partyState.objectInHand = slotObject;
  }
  if (objectInHand !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.openChestContents[slot - 30] = objectInHand;
    } else {
      setChampionPossession(ui, champ, slot, objectInHand);
    }
  }
}

export function updateButtonLists(ui: UIState): void {
  if (!ui.uiTables) return;
  const buttons = ui.uiTables.graphic231.buttons;
  switch (ui.uiMode) {
    case UIMode.Sleeping:
      ui.primaryButtons = buttons.buttons17796;
      ui.secondaryButtons = null;
      break;
    case UIMode.Frozen:
      ui.primaryButtons = buttons.buttons17832;
      ui.secondaryButtons = null;
      break;
    case UIMode.Adventure:
    default:
      ui.primaryButtons = buttons.buttons17196;
      ui.secondaryButtons = buttons.buttons17304;
      break;
  }
}

export function drawCursorItem(ui: UIState): void {
  if (!ui.screenIndexBuffer || !ui.uiTables || !ui.partyState || !ui.hoverPoint) return;
  const objectId = ui.partyState.objectInHand;
  if (objectId === OBJECT_ID_NULL) {
    drawEmptyCursor(ui);
    return;
  }

  const word612 = ui.uiTables.graphic232.word612;
  const objectNameIndex = resolveObjectNameIndex(ui, objectId | 0);
  if (objectNameIndex < 0) return;

  const baseX = Math.floor(ui.hoverPoint.x) - 8;
  const baseY = Math.floor(ui.hoverPoint.y) - 8;
  drawObjectIconAt(ui, baseX + 2, baseY + 2, objectNameIndex, word612, 12, 0);
  drawObjectIconAt(ui, baseX, baseY, objectNameIndex, word612, 12);
}

export function drawEmptyCursor(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.hoverPoint) return;
  const x = Math.floor(ui.hoverPoint.x);
  const y = Math.floor(ui.hoverPoint.y);
  const useHand = shouldUseHandCursor(ui, x, y);
  const bitmap = useHand ? getCursorHandBitmap(ui) : getCursorArrowBitmap(ui);
  if (!bitmap) return;

  drawCursorBitmap(ui, bitmap, x, y, 12);
}

export function shouldUseHandCursor(ui: UIState, x: number, y: number): boolean {
  const cursorOwner = ui.partyState?.cursorOwner ?? -1;
  if (cursorOwner < 0) return false;

  if (y >= 169) return false;
  if (x >= 274) return false;

  if (y <= 28) {
    const numChar = ui.partyState?.champions.length ?? 0;
    const selectedOrdinal = (ui.partyState?.selectedCharacterIndex ?? -1) + 1;
    const charIndex = Math.floor(x / 69);
    const pixelWithin = x - charIndex * 69;
    if (charIndex < numChar && pixelWithin <= 42) {
      if (charIndex + 1 === selectedOrdinal) return false;
      if (y <= 6) return false;
    }
  } else if (x >= 224) {
    return false;
  }

  return true;
}

export function getCursorArrowBitmap(ui: UIState): IndexedBitmap | null {
  if (!ui.uiTables) return null;
  if (ui.cursorArrowBitmap) return ui.cursorArrowBitmap;
  ui.cursorArrowBitmap = decodeCursorBitmap(ui.uiTables.graphic232.cursorArrow);
  return ui.cursorArrowBitmap;
}

export function getCursorHandBitmap(ui: UIState): IndexedBitmap | null {
  if (!ui.uiTables) return null;
  if (ui.cursorHandBitmap) return ui.cursorHandBitmap;
  ui.cursorHandBitmap = decodeCursorBitmap(ui.uiTables.graphic232.cursorHand);
  return ui.cursorHandBitmap;
}


export function drawCursorBitmap(ui: UIState, bitmap: IndexedBitmap, x: number, y: number, transparentColor: number): void {
  if (!ui.screenIndexBuffer) return;
  const dst = ui.screenIndexBuffer;
  const maxW = bitmap.width;
  const maxH = bitmap.height;
  const tc = transparentColor & 0x0f;

  for (let row = 0; row < maxH; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dst.height) continue;
    const dstRow = dy * dst.width;
    const srcRow = row * bitmap.width;
    for (let col = 0; col < maxW; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= dst.width) continue;
      const pixel = bitmap.pixels[srcRow + col] & 0x0f;
      if (pixel === tc) continue;
      dst.pixels[dstRow + dx] = pixel;
    }
  }
}

export function drawHoverHighlights(ui: UIState) {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.hoverPoint) return;
  const { x, y } = ui.hoverPoint;

  const hovered: string[] = [];
  for (const btn of ui.uiTables.graphic231.moveButtons) {
    if (pointInRect(x, y, btn)) {
      // drawRectOutlineIndex(ui.screenIndexBuffer, btn, 15);
    }
  }

  const buttonGroups = Object.values(ui.uiTables.graphic231.buttons);
  for (const group of buttonGroups) {
    for (const btn of group) {
      if (pointInRect(x, y, btn)) {
        hovered.push(`231: ${btn.name ?? '?'} - ${btn.button} - ${btn.word0}`);
        // drawRectOutlineIndex(ui.screenIndexBuffer, btn, 9);
      }
    }
  }
  updateHover(hovered.join("<br>"));
}
