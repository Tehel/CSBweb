/**
 * The mouse: CSBWin's click ring buffer, the button dispatcher, and the cursor.
 *
 * Mirrors `doc/CSBwin-src/Mouse.cpp`. Clicks are not handled where they arrive: the host
 * queues one on the game's one mouse queue (`Game.onMouseClick`), where it waits its turn
 * behind keys and other clicks. `Game.handleMouseEvents` turns it into a button with
 * `searchMouseButtons` when it comes to it, handles the turns and steps itself, and hands
 * every other button to `handleMouseButton`, the dispatcher on the `word0` ids
 * `searchButtonList` returns.
 */
import { IndexedBitmap, createPaletteIndexViewportBuffer, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { decodeCursorBitmap } from '../../data/tables/UITables';
import { canPlaceInSlot, drawPositionSquare } from './Character';
import { objectIconBitmap } from './Draw';
import { handleMouthPress } from './Feeding';
import { HINT_ORACLE_BUTTON, inventoryButtonList } from './HintOracleButton';
import { searchButtonList } from './HitTest';
import { describeObject, getActiveChestView, getEyeRect, repackOpenChest, syncOpenChest, tag0189d4, tag019036 } from './Inventory';
import { handleMagicClick } from './MagicPanel';
import { drawLegalAttackTypes, handleAttackAreaClick } from './Attack';
import { isChestRecord, resolveObjectNameIndex } from './Objects';
import { OBJECT_ID_NULL } from '../../core/types';
import { UIMode, UIState, stHideCursor, stShowCursor } from './UIState';
import { getPartyChampion, selectMagicCaster, setHandOwner } from '../../engine/Party';
import { getChampionPossession } from '../../engine/gameTypes';
import { characterAtPosition } from '../../engine/AddCharacter';
import { CursorFilterType } from '../../engine/DsaSystem';
import { freeze, setClockTick, thaw, waitForButtonFlash, wakeUp } from '../../engine/LoopState';
import {
  hasCursorObject,
  resolveEmptyHandedViewportClick,
  resolveViewportCursorAction,
  tryPickViewportObject,
  tryUseFrontWallItem,
} from './ViewportPicking';

export { decodeCursorBitmap };

/**
 * `TranslateMouseClick`'s button search (doc/CSBwin-src-20230608/Mouse.cpp:1393-1404): the
 * primary list, then the secondary. 0 for a click that hit no button, which the queue drops.
 */
export function searchMouseButtons(ui: UIState, x: number, y: number, buttons: number): number {
  const id = searchButtonList(ui.primaryButtons, x, y, buttons);
  if (id !== 0) return id;
  return searchButtonList(ui.secondaryButtons, x, y, buttons);
}

/**
 * Button 80, `HandleClickInViewport` (doc/CSBwin-src/Mouse.cpp:1031), reached through
 * `HandleMouseEvents` (`:1665-1670`): a drop, a throw, a wall, a door switch, an object
 * picked up, or the sound of a hand on bare stone. The eye, when the inventory hides the
 * viewport, is `handleMouseButton`'s.
 */
function handleClickInViewport(ui: UIState, x: number, y: number): void {
  if (ui.partyState.selectedCharacterIndex >= 0) return;
  const mouse = ui.ctx.systems.mouse;
  const cursorAction = resolveViewportCursorAction(ui, x, y);
  if (cursorAction) {
    if (cursorAction.kind === 'drop') mouse.dropObjectFromCursor(cursorAction.pos, { viAltar: cursorAction.viAltar });
    else if (cursorAction.kind === 'throw') mouse.throwObjectFromCursor(cursorAction.side);
    else if (cursorAction.kind === 'wall') {
      if (!tryUseFrontWallItem(ui, x, y)) {
        mouse.handleWallClick();
      }
    }
  } else if (!hasCursorObject(ui)) {
    const target = resolveEmptyHandedViewportClick(ui, x, y);
    if (target === 'doorSwitch') mouse.handleDoorSwitchClick();
    else if (target === 'wall') mouse.handleWallClick();
    else if (target === 'object') tryPickViewportObject(ui, x, y);
    else if (target === 'stone') mouse.handleStoneClick();
  }
}

/**
 * Every button `Game.handleMouseEvents` does not handle itself: the turns and steps are
 * the engine's, the rest are the interface's.
 */
export function handleMouseButton(ui: UIState, id: number, x: number, y: number): void {
  if (id === 80) handleClickInViewport(ui, x, y);
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
  const potential = ui.partyState.potentialChampionIndex >= 0;
  const numChampions = ui.partyState.champions.length;
  if (id === 100) {
    if (!potential && ui.partyState.magicCasterIndex !== -1) {
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
  if (id >= 125 && id <= 128) {
    // The four squares of the top view of positions (`doc/CSBwin-src/Mouse.cpp:1586-1597`),
    // with no guard: the marching order changes even in the Hall of Champions.
    tag0025a6(ui, id - 125);
    return;
  }
  if (id >= 28 && id <= 65) {
    if (ui.partyState.cursorOwner >= 0) {
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
  // until the button-up lets go.
  if (ui.pressingEye) return;
  if (ui.pressingMouth) return;
  if (id === 145) {
    // The sleep icon, `buttons17760` beside the disk (`doc/CSBWIN_MENU_REFERENCE.md`), so
    // it is only ever clicked with an inventory open. `ShowHideInventory(4)` closes it
    // and `TAG02076e` shades the interface before anything else
    // (`doc/CSBwin-src/Mouse.cpp:1683-1691`); the rest is the engine's. Refused, like the
    // disk, while a champion is only provisionally joined. The party lying down asks
    // for the Sleepsave, the port's own (`UIState.sleepSaveNeeded`).
    if (!potential) {
      if (ui.partyState.selectedCharacterIndex >= 0) handleInventoryToggle(ui, 4);
      tag02076e(ui);
      if (ui.ctx.systems.mouse.sleep()) ui.sleepSaveNeeded = true;
    }
    return;
  }
  if (id === 146) {
    // `WakeUp()` (`doc/CSBwin-src/Mouse.cpp:1709-1714`): `Buttons17796`, a click anywhere
    // in the viewport while the party sleeps. The player waking it asks for the
    // Sleepsave; a blow's `WakeUp` does not come here.
    wakeUp(ui.ctx);
    ui.sleepSaveNeeded = true;
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
  if (id === HINT_ORACLE_BUTTON) {
    // The close box, where the data set has the Hint Oracle (`inventoryButtonList`):
    // guarded as the disk icon is, and like it raising a flag for whoever drained the
    // queue (`src/renderer/ui/HintOracleButton.ts`).
    if (numChampions > 0 && !potential) ui.hintOracleNeeded = true;
    return;
  }
  if (id === 147) {
    // The freeze (`doc/CSBwin-src/Mouse.cpp:1731-1759`): Esc, or a left click on the
    // pixel x 0, y 198 of the adventure list `Buttons17196`. `d.ClockRunning = 0`,
    // `gameFrozen = true` and `DiscardAllInput()` are the engine's; `TAG02076e`, the
    // lists and key tables saved and replaced by `Buttons17832` and `Byte18448`, and
    // "GAME FROZEN" in the viewport (`GameScreen.presentViewport`) are the screen's.
    freeze(ui.ctx);
    tag02076e(ui);
    ui.modeBeforeFreeze = ui.uiMode;
    ui.uiMode = UIMode.Frozen;
    updateButtonLists(ui);
    return;
  }
  if (id === 148) {
    // The thaw (`doc/CSBwin-src/Mouse.cpp:1760-1773`): a click anywhere, or Esc.
    // `TAG0207cc`, then the saved lists and key tables back.
    thaw(ui.ctx);
    ui.uiMode = ui.modeBeforeFreeze;
    tag0207cc(ui);
    updateButtonLists(ui);
    syncInventoryButtons(ui);
    return;
  }
}

/**
 * The button let go (`doc/CSBwin-src/Mouse.cpp:1530-1544`). With the eye held,
 * `QuitPressingEye` (`doc/CSBwin-src/CSBCode.cpp:7399-7414`); otherwise, with the mouth
 * held, `QuitPressingMouth` (`:7390-7395`). Either way the panel goes back to what
 * `TAG0189d4` draws, which describes the weapon hand's scroll again.
 */
export function handleMouseUnclick(ui: UIState): void {
  if (ui.pressingEye) {
    ui.pressingEye = false;
    ui.describedObject = null;
    tag0189d4(ui);
    stShowCursor(ui);
  } else if (ui.pressingMouth) {
    ui.pressingMouth = false;
    tag0189d4(ui);
    stShowCursor(ui);
  }
}

/**
 * `KillCharacter`'s release of a held eye, or else a held mouth, before it hides the
 * dead champion's inventory (`doc/CSBwin-src/Character.cpp:2598-2620`), so that
 * `ShowHideInventory(4)` does not return on it; `RemoveCharacter` has the same
 * (`:5267-5289`). Each sets the hide count to 1 before it shows the pointer, so it is
 * back whatever the count was. No `TAG0189d4`: the inventory is closing.
 */
export function releaseEyeOrMouth(ui: UIState): void {
  if (ui.pressingEye) {
    ui.pressingEye = false;
    ui.describedObject = null;
    ui.word23118 = 1;
    stShowCursor(ui);
  } else if (ui.pressingMouth) {
    ui.pressingMouth = false;
    ui.word23118 = 1;
    stShowCursor(ui);
  }
}

export function isEyeClick(ui: UIState, x: number, y: number): boolean {
  if (ui.partyState.selectedCharacterIndex < 0) return false;
  const rect = getEyeRect(ui);
  if (!rect) return false;
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

/**
 * `_ClickOnEye` (`doc/CSBwin-src/Viewport.cpp:7257-7290`): a press while the eye is
 * held does nothing. With an empty hand, `TAG019036` runs the viewing filter before it
 * draws the attributes (`doc/CSBwin-src/Character.cpp:4524-4578`); with an object,
 * `DescribeObject` runs it as it describes the object (`describeObject`), and the
 * composes until the release draw what it left. The panel itself is drawn from
 * `pressingEye` (`drawInventoryScreen`).
 */
export function handleEyePress(ui: UIState): void {
  if (ui.partyState.selectedCharacterIndex < 0) return;
  if (ui.pressingEye) return;
  ui.pressingEye = true;
  stHideCursor(ui);
  const inHand = ui.partyState.objectInHand;
  if (inHand === OBJECT_ID_NULL) {
    tag019036(ui);
  } else if (!isChestRecord(ui, inHand)) {
    ui.describedObject = describeObject(ui, inHand);
  }
}

export function handlePartyBlockClick(ui: UIState, button: number, x: number, y: number): void {
  if (ui.partyState.selectedCharacterIndex === button) {
    setHandOwner(ui.partyState, button, ui.ctx.host);
    return;
  }
  const sub = searchButtonList(ui.uiTables.graphic231.buttons.buttons18216, x, y, 2);
  if (sub >= 16 && sub <= 19) {
    setHandOwner(ui.partyState, sub - 16, ui.ctx.host);
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
  const buttons = ui.uiTables.graphic231.buttons;

  if (ui.displayResurrectChestOrScroll === 4) {
    // An open chest in the weapon hand: the grid takes clothing clicks, but only from
    // someone holding the cursor (`d.HandChar != -1`).
    if (ui.partyState.cursorOwner < 0) return;
    const selected = ui.partyState.selectedCharacterIndex;
    if (selected < 0) return;
    const champ = getPartyChampion(ui.partyState, selected);
    if (!champ || (champ.attributes.health | 0) === 0) return;
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
    if (button !== 0) ui.ctx.systems.hallOfChampions.resurrectReincarnateCancel(button);
  }
}

export function handleInventoryToggle(ui: UIState, button: number): void {
  if (button !== 4) {
    if (button < 0 || button > 3) return;
    const champ = getPartyChampion(ui.partyState, button);
    if (!champ || (champ.attributes.health | 0) === 0) return;
  }
  // `if (d.PressingMouth != 0) return; if (d.PressingEye != 0) return; d.clockTick = 1;`
  // (`doc/CSBwin-src/CSBCode.cpp:7439-7441`).
  if (ui.pressingMouth) return;
  if (ui.pressingEye) return;
  setClockTick(ui.ctx, 1);
  // `videoMode = VM_ADVENTURE` as an open inventory closes (`:7453`), and
  // `VM_INVENTORY` as one opens (`:7487`).
  if (ui.partyState.selectedCharacterIndex >= 0) ui.ctx.loop.videoMode = 'VM_ADVENTURE';
  if (button === 4) {
    syncOpenChest(ui, null);
    ui.partyState.selectedCharacterIndex = -1;
    syncInventoryButtons(ui);
    // `DiscardAllInput()` once the adventure's list is back (`:7480`), but not for a
    // sleeping party, which returns before it (`:7468-7472`).
    if (!ui.partyState.sleeping) ui.ctx.mouseQueue.discardAllInput();
    return;
  }
  const previous = ui.partyState.selectedCharacterIndex;
  ui.partyState.selectedCharacterIndex =
    ui.partyState.selectedCharacterIndex === button ? -1 : button;
  if (ui.partyState.selectedCharacterIndex !== previous) {
    syncOpenChest(ui, null);
  }
  if (ui.partyState.selectedCharacterIndex >= 0) ui.ctx.loop.videoMode = 'VM_INVENTORY';
  syncInventoryButtons(ui);
  // `ShowHideInventory`'s `CHARFLAG_chestOrScroll` and `DrawCharacterState`
  // (`doc/CSBwin-src/CSBCode.cpp:7504-7514`), which never runs with the eye held (`:7440`).
  if (ui.partyState.selectedCharacterIndex >= 0) tag0189d4(ui);
  // `DiscardAllInput()` once the new secondary list is set, as the inventory closes
  // (`:7480`) or opens (`:7520`): a key or a click queued behind the portrait is lost.
  ui.ctx.mouseQueue.discardAllInput();
}

/**
 * `TAG02076e` (`doc/CSBwin-src/Character.cpp:5108-5135`), before the disk menu goes up
 * (`SaveGame.cpp:860`), at the freeze (`Mouse.cpp:1736`), on the way to sleep (`:1691`),
 * and once a Hall of Champions candidate's inventory is shown (the host's `tag02076e`,
 * `Character.cpp:797`). The main loop's call, with `TAG0207cc`, is dead in CSBWin
 * (`doc/PROVEN_FACTS.md` → "`d.Word11722` is always zero"). Its state half: an open inventory showing a chest
 * (`d.DisplayResurrectChestOrScroll == 4`) has it repacked (`:5116-5125`), so the save
 * finds the chest's objects in the chest. Asleep, it does nothing (`:5111`). The drawing
 * half is `shadedByTag02076e`, which `GameScreen.presentViewport` reads for the three
 * shaded areas and `drawCursorItem` for the arrow cursor of `SetCursorShape(0)` (`:5133`).
 */
export function tag02076e(ui: UIState): void {
  const party = ui.partyState;
  if (party.sleeping) return;
  // `WaitForButtonFlash(); //If any are active` (`:5113`).
  waitForButtonFlash(ui.ctx);
  if (party.selectedCharacterIndex >= 0 && ui.displayResurrectChestOrScroll === 4) repackOpenChest(ui);
  ui.shadedByTag02076e = true;
}

/**
 * `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:9934-9968`), once the disk menu has gone
 * (`SaveGame.cpp:1274`), at the thaw (`Mouse.cpp:1765`), and through the host's
 * `tag0207cc` from `WakeUp` (`CSBCode.cpp:7061`) and `_ResurrectReincarnateCancel`
 * (`:6657`, `:6808`). Its state half: the magic caster is selected again, which a
 * dead one does not survive (`:9945-9947`); the attack buttons come back unless an
 * attack menu is open (`d.Word20252 = 1`, `:9948-9951`); and an open inventory is shut
 * without a repack and shown again through `ShowHideInventory` (`:9953-9958`), which
 * opens the chest again on the next draw. The redraws, and `TAG002572`'s cursor, the
 * port does every frame once `shadedByTag02076e` is clear; `d.Word11750 = 0` is the dead
 * countdown in `DEBT.md` H. Asleep, it only redraws the sleep screen (`:9938-9942`),
 * which `GameScreen.presentViewport` draws every time it composes the screen.
 */
export function tag0207cc(ui: UIState): void {
  const party = ui.partyState;
  if (party.sleeping) return;
  ui.shadedByTag02076e = false;
  const caster = party.magicCasterIndex;
  party.magicCasterIndex = -1;
  selectMagicCaster(party, caster);
  if (ui.attackingCharacterOrdinal === 0) ui.word20252 = 1;
  drawLegalAttackTypes(ui);
  const selected = party.selectedCharacterIndex;
  if (selected >= 0) {
    party.selectedCharacterIndex = -1;
    ui.ctx.loop.videoMode = 'VM_ADVENTURE';
    handleInventoryToggle(ui, selected);
  }
}

export function syncInventoryButtons(ui: UIState): void {
  if (ui.uiMode !== UIMode.Adventure) return;
  const buttons = ui.uiTables.graphic231.buttons;
  const inventoryOpen = ui.partyState.selectedCharacterIndex >= 0;
  ui.secondaryButtons = inventoryOpen ? inventoryButtonList(ui) : buttons.buttons17304;
}

export function handleClothingClick(ui: UIState, button: number): void {
  // `HandleClothingClick` itself does not care who owns the cursor
  // (doc/CSBwin-src/CSBCode.cpp:6928); its callers decide.
  let chIdx = -1;
  let slot = -1;
  if (button < 8) {
    chIdx = Math.floor(button / 2);
    if (chIdx >= ui.partyState.champions.length) return;
    if (ui.partyState.selectedCharacterIndex === chIdx) return;
    const champ = getPartyChampion(ui.partyState, chIdx);
    // `if (d.CH16482[D7W].HP() == 0) return;` (`doc/CSBwin-src/CSBCode.cpp:6940`).
    if (!champ || (champ.attributes.health | 0) === 0) return;
    slot = button & 1;
  } else {
    chIdx = ui.partyState.selectedCharacterIndex;
    if (chIdx < 0) return;
    slot = button - 8;
  }

  if (slot < 0 || slot >= 38) return;
  const champ = getPartyChampion(ui.partyState, chIdx);
  if (!champ || (champ.attributes.health | 0) === 0) return;

  const chestView = getActiveChestView(ui, champ);
  const isChestSlot = slot >= 30;
  if (isChestSlot) {
    if (!chestView) return;
    syncOpenChest(ui, chestView);
  }

  const objectInHand = ui.partyState.objectInHand;
  const slotObject = isChestSlot
    ? ui.openChestContents[slot - 30] ?? OBJECT_ID_NULL
    : getChampionPossession(champ, slot);
  if (objectInHand === OBJECT_ID_NULL && slotObject === OBJECT_ID_NULL) return;

  if (objectInHand !== OBJECT_ID_NULL && !canPlaceInSlot(ui, objectInHand, slot)) return;

  // `CURSORFILTER_PlaceOnCharacter`, sent even with an empty cursor, which may cancel the
  // click (`doc/CSBwin-src/CSBCode.cpp:6966-6972`).
  const dsa = ui.ctx.systems.dsa;
  const place = { object: objectInHand, type: CursorFilterType.PlaceOnCharacter, p1: chIdx, p2: slot, p3: 0, p4: 0 };
  dsa.cursorFilter(place);
  if (place.type === CursorFilterType.Cancel) return;

  // `RemoveCharacterPossession` and `AddCharacterPossession` are the engine's; a chest
  // slot is `d.rnChestContents`, which is ours, and all the pair does past slot 29 is
  // write it (`CharacterSystem.removeCharacterPossession`).
  const character = ui.ctx.systems.character;
  if (objectInHand !== OBJECT_ID_NULL) {
    ui.partyState.objectInHand = OBJECT_ID_NULL;
  }
  if (slotObject !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.openChestContents[slot - 30] = OBJECT_ID_NULL;
    } else {
      character.removeCharacterPossession(chIdx, slot);
    }
    // `CURSORFILTER_PickFromCharacter`, whose cancel nothing reads (`:6982-6991`).
    dsa.cursorFilter({ object: slotObject, type: CursorFilterType.PickFromCharacter, p1: chIdx, p2: slot, p3: 0, p4: 0 });
    ui.partyState.objectInHand = slotObject;
  }
  if (objectInHand !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.openChestContents[slot - 30] = objectInHand;
    } else {
      character.addCharacterPossession(chIdx, objectInHand, slot);
    }
  }
}

/**
 * The button lists and key tables of the mode: asleep `Buttons17796` and `Byte18440`
 * (`doc/CSBwin-src/Mouse.cpp:1698-1701`), frozen `Buttons17832` and `Byte18448`
 * (`:1752-1755`), and adventuring `Buttons17196` / `Buttons17304` and `Byte18400` /
 * `Byte18428` (`CSBCode.cpp:7056-7059`).
 */
export function updateButtonLists(ui: UIState): void {
  const buttons = ui.uiTables.graphic231.buttons;
  const keys = ui.uiTables.graphic231.keys;
  switch (ui.uiMode) {
    case UIMode.Sleeping:
      ui.primaryButtons = buttons.buttons17796;
      ui.secondaryButtons = null;
      ui.keyXlate2 = keys.byte18440;
      ui.keyXlate1 = null;
      break;
    case UIMode.Frozen:
      ui.primaryButtons = buttons.buttons17832;
      ui.secondaryButtons = null;
      ui.keyXlate2 = keys.byte18448;
      ui.keyXlate1 = null;
      break;
    case UIMode.Adventure:
    default:
      ui.primaryButtons = buttons.buttons17196;
      ui.secondaryButtons = buttons.buttons17304;
      ui.keyXlate2 = keys.byte18400;
      ui.keyXlate1 = keys.byte18428;
      break;
  }
}

/** `d.wRectPos23214` (`doc/CSBwin-src/CSBCode.cpp:449-452`): the shadow, two pixels down and right. */
const W_RECT_POS_23214 = { x1: 2, x2: 20, y1: 2, y2: 15 };
/** `d.wRectPos23222` (`doc/CSBwin-src/CSBCode.cpp:453-456`): the square itself, 19x14. */
const W_RECT_POS_23222 = { x1: 0, x2: 18, y1: 0, y2: 13 };

/**
 * `ShrinkBLT` from a buffer to itself at the same size (`doc/CSBwin-src/Graphics.cpp:380`),
 * which moves no pixel and only recolours the first `rows` rows: a pixel of colour `c`
 * becomes `pColorMap[c] / 10` (`:457-479`).
 */
function recolourRows(buffer: IndexedBitmap, rows: number, colorMap: number[]): void {
  for (let i = 0; i < rows * buffer.width; i++) {
    buffer.pixels[i] = Math.floor(colorMap[buffer.pixels[i] & 0x0f] / 10);
  }
}

/**
 * `TAG0025a6` (`doc/CSBwin-src/CSBCode.cpp:2053-2152`): a click on square `p1` of the top
 * view of positions, counted from the party's facing. With no champion in hand it picks
 * up the one standing there: the square becomes the cursor, and a black hole on screen
 * (`Character.drawPartyStatus`). With one in hand it puts them down there, facing the
 * party's way, and whoever stood there takes the square they left.
 *
 * The cursor is made of the square as `DrawCharacterState` last drew it, which the port
 * draws again rather than reads back, since its screen holds the cursor on top. Over a
 * black shadow two pixels down and right, `d.Pointer23178` is the square and
 * `d.Pointer23182` its silhouette in colour 4, for the rows below the palette split
 * (`drawMarchingOrderCursor`). Colour 0 is transparent in both copies (`:2071-2107`).
 *
 * `KillCharacter` does not let go of a champion who dies in hand: it clears
 * `d.Word23244`, not `d.Word23144` (`doc/CSBwin-src/Character.cpp:2653-2658`). Put down,
 * such a champion is `CharacterAtPosition`'s -1, and CSBWin writes the facing and the
 * position to `d.CH16482[-1]` (`CSBCode.cpp:2120-2122`, `:2147`); the port writes them to
 * nobody (`DEBT.md` H).
 */
export function tag0025a6(ui: UIState, p1: number): void {
  const party = ui.partyState;
  const g232 = ui.uiTables.graphic232;
  const d7 = p1;
  if (ui.word23144 === 0) {
    const chIdx = characterAtPosition(party.champions, (party.facing + d7) & 3);
    if (chIdx === -1) return;
    const square = createPaletteIndexViewportBuffer(19, 14);
    drawPositionSquare(ui, square, W_RECT_POS_23222, chIdx, party.champions[chIdx], party.facing);

    const a2 = createPaletteIndexViewportBuffer(32, 16, 12);
    tag0088b2Index(square, a2, W_RECT_POS_23214, 0);
    recolourRows(a2, 16, g232.cursorColorMapLight);
    const pointer23178 = { width: 32, height: 16, pixels: a2.pixels.slice() };
    tag0088b2Index(square, pointer23178, W_RECT_POS_23222, 0);

    const saved = createPaletteIndexViewportBuffer(32, 16, 12);
    tag0088b2Index(square, saved, W_RECT_POS_23222, 0);
    recolourRows(saved, 14, g232.cursorColorMapDark);
    tag0088b2Index(saved, a2, W_RECT_POS_23222, 12);

    ui.pointer23178 = pointer23178;
    ui.pointer23182 = a2;
    ui.word23144 = d7 + 1;
    return;
  }
  const d6 = ui.word23144 - 1;
  ui.word23144 = 0;
  const d4 = characterAtPosition(party.champions, (party.facing + d6) & 3);
  if (d4 >= 0) party.champions[d4].facing = party.facing;
  // Put down where they were picked up, `CHARFLAG_positionChanged` redraws the square,
  // which the port does every frame.
  if (d6 === d7) return;
  const d5 = characterAtPosition(party.champions, (d7 + party.facing) & 3);
  if (d5 >= 0) party.champions[d5].partyPosition = (d6 + party.facing) & 3;
  if (d4 >= 0) party.champions[d4].partyPosition = (d7 + party.facing) & 3;
}

/**
 * The VBL's test while a champion is in hand (`doc/CSBwin-src/CSBCode.cpp:938-945`): a
 * pointer outside the top view of positions, left of x 274 or below y 28, lets go of them
 * through `TAG002818` (`:2155`), which puts the square back as it was. CSBWin asks at
 * every VBL; the port asks when the pointer moves, which is when the answer can change.
 * `TAG002818` also records button -1 for a replay, which the port does not make.
 */
export function marchingOrderPointerMoved(ui: UIState, x: number, y: number): void {
  if (ui.word23144 === 0) return;
  if (x < 274 || y > 28) ui.word23144 = 0;
}

/**
 * `CreateCursorBitmap`'s arm for a champion in hand (`doc/CSBwin-src/CSBCode.cpp:2308-2388`):
 * 21 columns and 16 rows of `d.Pointer23178`, drawn with the pointer 9 pixels in and 7
 * down (`d.Word23156`, `d.Word23158`). With `d.DynamicPaletteSwitching`, which is on while
 * the dungeon view is shown, the rows that fall on screen row 29 or below come from
 * `d.Pointer23182` instead (`:2325-2386`).
 */
function drawMarchingOrderCursor(ui: UIState, x: number, y: number, dynamicPaletteSwitching: boolean): void {
  const upper = ui.pointer23178;
  const lower = ui.pointer23182;
  if (!upper || !lower) return;
  const d6 = y - 20;
  const split = dynamicPaletteSwitching && d6 > 0 ? 16 - d6 : 16;
  const dst = ui.screenIndexBuffer;
  for (let row = 0; row < 16; row++) {
    const dy = y - 7 + row;
    if (dy < 0 || dy >= dst.height) continue;
    const src = row < split ? upper : lower;
    for (let col = 0; col <= 20; col++) {
      const dx = x - 9 + col;
      if (dx < 0 || dx >= dst.width) continue;
      const pixel = src.pixels[row * src.width + col];
      if (pixel === 12) continue;
      dst.pixels[dy * dst.width + dx] = pixel;
    }
  }
}

export function drawCursorItem(ui: UIState, dynamicPaletteSwitching: boolean): void {
  ui.objectCursorFootprint = null;
  if (!ui.hoverPoint) return;
  // The held eye or mouth has hidden it (`stHideCursor`).
  if (ui.word23118 > 0) return;
  if (ui.word23144 !== 0) {
    // `CreateCursorBitmap` asks before anything else (`doc/CSBwin-src/CSBCode.cpp:2234`).
    drawMarchingOrderCursor(ui, Math.floor(ui.hoverPoint.x), Math.floor(ui.hoverPoint.y), dynamicPaletteSwitching);
    return;
  }
  if (ui.shadedByTag02076e) {
    // `tag02076e`'s `SetCursorShape(0)`: the arrow, and no object, until `TAG0207cc`'s
    // `TAG002572` (`doc/CSBwin-src/CSBCode.cpp:2030`) sets the cursor from the hand again.
    const arrow = getCursorArrowBitmap(ui);
    if (arrow) drawCursorBitmap(ui, arrow, Math.floor(ui.hoverPoint.x), Math.floor(ui.hoverPoint.y), 12);
    return;
  }
  const objectId = ui.partyState.objectInHand;
  if (objectId === OBJECT_ID_NULL) {
    drawEmptyCursor(ui);
    return;
  }
  const x = Math.floor(ui.hoverPoint.x);
  const y = Math.floor(ui.hoverPoint.y);
  if (!inCursorShapeZone(ui, x, y)) {
    // Outside the zone the cursor is the arrow, object in hand or not (`tag0029f8`).
    const arrow = getCursorArrowBitmap(ui);
    if (arrow) drawCursorBitmap(ui, arrow, x, y, 12);
    return;
  }
  const cursor = createObjectCursor(ui, resolveObjectNameIndex(ui, objectId));
  if (!cursor) return;
  if (ui.colouredObjectCursor && dynamicPaletteSwitching) {
    // The extra (`DEBT.md` H): the icon throughout, which the screen shows through the
    // interface palette, so the viewport's light and monster colours do not reach it.
    drawObjectCursor(ui, cursor, x, y, false);
    ui.objectCursorFootprint = { x: x - 8, y: y - 8, bitmap: cursor.pointer23186 };
    return;
  }
  drawObjectCursor(ui, cursor, x, y, dynamicPaletteSwitching);
}

/** `d.Byte23202` (`doc/CSBwin-src/CSBCode.cpp:441-444`): the object's shadow, two pixels down and right. */
const BYTE_23202 = { x1: 2, x2: 17, y1: 2, y2: 17 };
/** `d.Byte23206` (`doc/CSBwin-src/CSBCode.cpp:445-448`): the object itself. */
const BYTE_23206 = { x1: 0, x2: 15, y1: 0, y2: 15 };

interface ObjectCursor {
  pointer23186: IndexedBitmap;
  pointer23190: IndexedBitmap;
}

/**
 * `CreateObjectCursor` (`doc/CSBwin-src/CSBCode.cpp:1976-2027`): the two 32x18 cursors of an
 * object in hand. `d.Pointer23186` is the icon over its shadow, recoloured through
 * `d.Byte1382` to colour 0. `d.Pointer23190` has the same shadow under the icon's
 * silhouette, recoloured through `d.Byte1366` to colour 4, the one colour every light
 * level's viewport palette keeps: it is the cursor over the rows that palette shows.
 */
function createObjectCursor(ui: UIState, objectNameIndex: number): ObjectCursor | null {
  const g232 = ui.uiTables.graphic232;
  const icon = objectIconBitmap(ui, objectNameIndex, g232.word612);
  if (!icon) return null;
  const a2 = createPaletteIndexViewportBuffer(32, 18, 12);
  const saved = { width: 16, height: 16, pixels: icon.pixels.slice() };
  recolourRows(saved, 16, g232.cursorColorMapLight);
  tag0088b2Index(saved, a2, BYTE_23202, -1);
  const pointer23186 = { width: 32, height: 18, pixels: a2.pixels.slice() };
  saved.pixels.set(icon.pixels);
  recolourRows(saved, 16, g232.cursorColorMapDark);
  tag0088b2Index(saved, a2, BYTE_23206, 12);
  tag0088b2Index(icon, pointer23186, BYTE_23206, 12);
  return { pointer23186, pointer23190: a2 };
}

/**
 * `CreateCursorBitmap`'s arm for an object in hand (`doc/CSBwin-src/CSBCode.cpp:2290-2308`,
 * `:2319-2388`): 18 rows of `d.Pointer23186`, drawn with the pointer 8 pixels in and 8 down
 * (`d.Word23156`, `d.Word23158`). With `d.DynamicPaletteSwitching` the rows that fall on
 * screen row 29 or below come from `d.Pointer23190` instead.
 */
function drawObjectCursor(ui: UIState, cursor: ObjectCursor, x: number, y: number, dynamicPaletteSwitching: boolean): void {
  const d6 = y - 19;
  const split = dynamicPaletteSwitching && d6 > 0 ? 18 - d6 : 18;
  const dst = ui.screenIndexBuffer;
  for (let row = 0; row < 18; row++) {
    const dy = y - 8 + row;
    if (dy < 0 || dy >= dst.height) continue;
    const src = row < split ? cursor.pointer23186 : cursor.pointer23190;
    for (let col = 0; col < 32; col++) {
      const dx = x - 8 + col;
      if (dx < 0 || dx >= dst.width) continue;
      const pixel = src.pixels[row * src.width + col];
      if (pixel === 12) continue;
      dst.pixels[dy * dst.width + dx] = pixel;
    }
  }
}

export function drawEmptyCursor(ui: UIState): void {
  if (!ui.hoverPoint) return;
  const x = Math.floor(ui.hoverPoint.x);
  const y = Math.floor(ui.hoverPoint.y);
  const useHand = shouldUseHandCursor(ui, x, y);
  const bitmap = useHand ? getCursorHandBitmap(ui) : getCursorArrowBitmap(ui);
  if (!bitmap) return;

  drawCursorBitmap(ui, bitmap, x, y, 12);
}

export function shouldUseHandCursor(ui: UIState, x: number, y: number): boolean {
  const cursorOwner = ui.partyState.cursorOwner;
  if (cursorOwner < 0) return false;
  return inCursorShapeZone(ui, x, y);
}

/**
 * Whether `CreateCursorBitmap` reaches `tag0029e0`, where the cursor is the object in hand
 * or the hand (`doc/CSBwin-src/CSBCode.cpp:2233-2252`): the viewport and the portraits,
 * less the name strip and the selected champion's portrait. Everywhere else it is the arrow.
 */
function inCursorShapeZone(ui: UIState, x: number, y: number): boolean {
  if (y >= 169) return false;
  if (x >= 274) return false;

  if (y <= 28) {
    const numChar = ui.partyState.champions.length;
    const selectedOrdinal = ui.partyState.selectedCharacterIndex + 1;
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
  if (ui.cursorArrowBitmap) return ui.cursorArrowBitmap;
  ui.cursorArrowBitmap = decodeCursorBitmap(ui.uiTables.graphic232.cursorArrow);
  return ui.cursorArrowBitmap;
}

export function getCursorHandBitmap(ui: UIState): IndexedBitmap | null {
  if (ui.cursorHandBitmap) return ui.cursorHandBitmap;
  ui.cursorHandBitmap = decodeCursorBitmap(ui.uiTables.graphic232.cursorHand);
  return ui.cursorHandBitmap;
}


export function drawCursorBitmap(ui: UIState, bitmap: IndexedBitmap, x: number, y: number, transparentColor: number): void {
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
