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
import { isAlive } from '../../engine/rules';
import { IndexedBitmap, createPaletteIndexViewportBuffer, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { decodeCursorBitmap } from '../../data/tables/UITables';
import { canPlaceInSlot, drawPositionSquare } from './Character';
import { objectIconBitmap } from './Draw';
import { drinkAtWaterFountain, handleMouthPress } from './Feeding';
import { HINT_ORACLE_BUTTON, inventoryButtonList } from './HintOracleButton';
import type { HintSquare } from '../intro/HintOracle';
import { searchButtonList } from './HitTest';
import { describeObject, describeWeaponHandScroll, getActiveChestView, getEyeRect, tag0189d4, tag019036 } from './Inventory';
import { handleMagicClick } from './MagicPanel';
import { handleAttackAreaClick } from './Attack';
import { isChestRecord, resolveObjectNameIndex } from './Objects';
import { OBJECT_ID_NULL } from '../../core/types';
import { UIMode, UIState, stHideCursor, stShowCursor, tag002572 } from './UIState';
import { getPartyChampion, setHandOwner } from '../../engine/Party';
import { getChampionPossession } from '../../core/charDesc';
import { characterAtPosition } from '../../engine/AddCharacter';
import { describeObject as describeObjectInterface, repackChest, tag019036 as tag019036Interface } from '../../engine/OpenChest';
import { CursorFilterType } from '../../engine/dsa/DsaTypes';
import { freeze, thaw } from '../../engine/LoopState';
import { wakeUp } from '../../engine/MouseSystem';
import { showHideInventory, tag02076e, tag0207cc } from '../../engine/ShowHideInventory';
import {
  hasCursorObject,
  resolveEmptyHandedViewportClick,
  resolveViewportCursorAction,
  tryPickViewportObject,
  fillAtWaterFountain,
} from './ViewportPicking';

export { decodeCursorBitmap };

/**
 * `TranslateMouseClick`'s button search (doc/CSBwin-src/Mouse.cpp:1393-1404): the
 * primary list, then the secondary. 0 for a click that hit no button, which the queue drops.
 *
 * Then the port's own last chance (`DEBT.md` H): a left click that hit no button, on a
 * portrait box, is that box's right click, `buttons17196`'s 7-10, which opens or closes
 * the champion's inventory. Only the bars right of the name and hands are left without a
 * left button, and a pointer with no right button (a finger, a stylus) opens an
 * inventory there. Asleep or frozen the primary list has no 7-10, so nothing changes.
 */
export function searchMouseButtons(ui: UIState, x: number, y: number, buttons: number): number {
  const id = searchButtonList(ui.primaryButtons, x, y, buttons);
  if (id !== 0) return id;
  const secondary = searchButtonList(ui.secondaryButtons, x, y, buttons);
  if (secondary !== 0 || (buttons & 2) === 0) return secondary;
  const portrait = searchButtonList(ui.primaryButtons, x, y, 1);
  return portrait >= 7 && portrait <= 10 ? portrait : 0;
}

/**
 * Button 80, `HandleClickInViewport` (doc/CSBwin-src/Mouse.cpp:1032), reached through
 * `HandleMouseEvents` (`:1804-1809`): a drop, a throw, a wall, a door switch, an object
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
      fillAtWaterFountain(ui);
      mouse.handleWallClick();
    }
  } else if (!hasCursorObject(ui)) {
    const target = resolveEmptyHandedViewportClick(ui, x, y);
    if (target === 'doorSwitch') mouse.handleDoorSwitchClick();
    else if (target === 'wall') {
      if (ui.ctx.extras.drinkAtFountain) drinkAtWaterFountain(ui);
      mouse.handleWallClick();
    }
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
  // (`doc/CSBwin-src/Mouse.cpp:1717-1789`).
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
    if (owner >= 0) showHideInventory(ui.ctx, owner);
    return;
  }
  if (id >= 7 && id <= 11) {
    const button = id - 7;
    if ((button === 4 || button < numChampions) && !potential) {
      showHideInventory(ui.ctx, button);
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
    // The four squares of the top view of positions (`doc/CSBwin-src/Mouse.cpp:1725-1736`),
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
  // the mouth (doc/CSBwin-src/Mouse.cpp:1818-1819): every button after 81 is swallowed
  // until the button-up lets go.
  if (ui.ctx.interface.pressingEye) return;
  if (ui.ctx.interface.pressingMouth) return;
  if (id === 145) {
    // The sleep icon, `buttons17760` beside the disk (`doc/CSBWIN_MENU_REFERENCE.md`), so
    // it is only ever clicked with an inventory open. `ShowHideInventory(4)` closes it
    // and `TAG02076e` shades the interface before anything else
    // (`doc/CSBwin-src/Mouse.cpp:1822-1830`); the rest is the engine's. Refused, like the
    // disk, while a champion is only provisionally joined. The party lying down asks
    // for the Sleepsave, the port's own (`UIState.sleepSaveNeeded`).
    if (!potential) {
      if (ui.partyState.selectedCharacterIndex >= 0) showHideInventory(ui.ctx, 4);
      tag02076e(ui.ctx);
      if (ui.ctx.systems.mouse.sleep()) ui.sleepSaveNeeded = true;
    }
    return;
  }
  if (id === 146) {
    // `WakeUp()` (`doc/CSBwin-src/Mouse.cpp:1848-1853`): `Buttons17796`, a click anywhere
    // in the viewport while the party sleeps. The player waking it asks for the
    // Sleepsave; a blow's `WakeUp` does not come here.
    wakeUp(ui.ctx);
    ui.sleepSaveNeeded = true;
    return;
  }
  if (id === 140) {
    // The disk icon, `buttons17760[1]` (`doc/CSBWIN_MENU_REFERENCE.md`). Both guards are
    // CSBWin's (`doc/CSBwin-src/Mouse.cpp:1847-1866`): an empty party, or a champion
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
    // The freeze (`doc/CSBwin-src/Mouse.cpp:1870-1898`): Esc, or a left click on the
    // pixel x 0, y 198 of the adventure list `Buttons17196`. `d.ClockRunning = 0`,
    // `gameFrozen = true` and `DiscardAllInput()` are the engine's; `TAG02076e`, the
    // lists and key tables saved and replaced by `Buttons17832` and `Byte18448`, and
    // "GAME FROZEN" in the viewport (`GameScreen.presentViewport`) are the screen's.
    freeze(ui.ctx);
    tag02076e(ui.ctx);
    ui.modeBeforeFreeze = ui.uiMode;
    ui.uiMode = UIMode.Frozen;
    updateButtonLists(ui);
    return;
  }
  if (id === 148) {
    // The thaw (`doc/CSBwin-src/Mouse.cpp:1899-1912`): a click anywhere, or Esc.
    // `TAG0207cc`, then the saved lists and key tables back.
    thaw(ui.ctx);
    ui.uiMode = ui.modeBeforeFreeze;
    tag0207cc(ui.ctx);
    updateButtonLists(ui);
    syncInventoryButtons(ui);
    return;
  }
}

/**
 * The button let go (`doc/CSBwin-src/Mouse.cpp:1669-1683`). With the eye held,
 * `QuitPressingEye` (`doc/CSBwin-src/CSBCode.cpp:7458-7473`), which first repacks a chest
 * in hand the eye opened (`:7464`); otherwise, with the mouth held, `QuitPressingMouth`
 * (`:7449-7454`). Either way the panel goes back to what `TAG0189d4` draws, which opens
 * the weapon hand's chest again or describes its scroll.
 */
export function handleMouseUnclick(ui: UIState): void {
  if (ui.ctx.interface.pressingEye) {
    ui.ctx.interface.pressingEye = false;
    ui.describedObject = null;
    if (ui.partyState.objectInHand === ui.ctx.interface.openChestId) repackChest(ui.ctx);
    tag0189d4(ui);
    stShowCursor(ui);
  } else if (ui.ctx.interface.pressingMouth) {
    ui.ctx.interface.pressingMouth = false;
    tag0189d4(ui);
    stShowCursor(ui);
  }
}

/**
 * `KillCharacter`'s release of a held eye (`eye`) or mouth, its drawing
 * (`doc/CSBwin-src/Character.cpp:2603-2625`, `RemoveCharacter`'s `:5292-5314`), the host's
 * `releaseEyeOrMouth`, once the engine has let it go (`releaseEyeOrMouth`,
 * `src/engine/ShowHideInventory.ts`). Each sets the hide count to 1 before it shows the
 * pointer, so it is back whatever the count was; the eye's description goes with it.
 */
export function releaseEyeOrMouthDrawing(ui: UIState, eye: boolean): void {
  if (eye) ui.describedObject = null;
  ui.word23118 = 1;
  stShowCursor(ui);
}

function isEyeClick(ui: UIState, x: number, y: number): boolean {
  if (ui.partyState.selectedCharacterIndex < 0) return false;
  const rect = getEyeRect(ui);
  if (!rect) return false;
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

/**
 * `_ClickOnEye` (`doc/CSBwin-src/Viewport.cpp:7264-7297`): a press while the eye is
 * held does nothing. With an empty hand, `TAG019036` runs the viewing filter before it
 * draws the attributes (`doc/CSBwin-src/Character.cpp:4541-4595`); with an object,
 * `DescribeObject` runs it as it describes the object (`describeObject`), and the
 * composes until the release draw what it left. Either repacks the open chest, and
 * `DescribeObject` opens a chest in hand (the engine's `tag019036` and `describeObject`).
 * The panel itself is drawn from `ctx.interface.pressingEye` (`drawInventoryScreen`).
 */
export function handleEyePress(ui: UIState): void {
  if (ui.partyState.selectedCharacterIndex < 0) return;
  if (ui.ctx.interface.pressingEye) return;
  ui.ctx.interface.pressingEye = true;
  stHideCursor(ui);
  const inHand = ui.partyState.objectInHand;
  if (inHand === OBJECT_ID_NULL) {
    tag019036Interface(ui.ctx);
    tag019036(ui);
  } else {
    describeObjectInterface(ui.ctx, inHand);
    if (!isChestRecord(ui, inHand)) ui.describedObject = describeObject(ui, inHand);
  }
}

function handlePartyBlockClick(ui: UIState, button: number, x: number, y: number): void {
  if (ui.partyState.selectedCharacterIndex === button) {
    setHandOwner(ui.ctx, button);
    return;
  }
  const sub = searchButtonList(ui.uiTables.graphic231.buttons.buttons18216, x, y, 2);
  if (sub >= 16 && sub <= 19) {
    setHandOwner(ui.ctx, sub - 16);
    return;
  }
  if (sub >= 20 && sub <= 27) {
    // No cursor-owner test here: `TAG019c34` reaches `HandleClothingClick` directly
    // (doc/CSBwin-src/CSBCode.cpp:8463-8468). Only the id 28-65 dispatcher path
    // (doc/CSBwin-src/Mouse.cpp:1739-1745) and the chest area
    // (doc/CSBwin-src/CSBCode.cpp:8614-8616) require one.
    handleClothingClick(ui, sub - 20);
  }
}

/**
 * `_TAG01a6ea` (`doc/CSBwin-src/CSBCode.cpp:8605`) — a click in the eye panel, routed
 * by whatever `TAG0189d4` last drew there. Button id 81.
 */
export function tag01a6ea(ui: UIState, clickX: number, clickY: number): void {
  const buttons = ui.uiTables.graphic231.buttons;

  if (ui.ctx.interface.displayResurrectChestOrScroll === 4) {
    // An open chest in the weapon hand: the grid takes clothing clicks, but only from
    // someone holding the cursor (`d.HandChar != -1`).
    if (ui.partyState.cursorOwner < 0) return;
    const selected = ui.partyState.selectedCharacterIndex;
    if (selected < 0) return;
    const champ = getPartyChampion(ui.partyState, selected);
    if (!champ || !isAlive(champ)) return;
    const chestView = getActiveChestView(ui, champ);
    if (!chestView || chestView.source !== 'hand') return;
    const button = searchButtonList(buttons.buttons18324, clickX, clickY, 2);
    if (button !== 0) handleClothingClick(ui, button - 20);
    return;
  }

  if (ui.ctx.interface.displayResurrectChestOrScroll === 5) {
    // The Hall of Champions menu, and only with an empty cursor (`d.EmptyHanded`).
    if (ui.partyState.objectInHand !== OBJECT_ID_NULL) return;
    const button = searchButtonList(buttons.buttons18372, clickX, clickY, 2);
    if (button !== 0) ui.ctx.systems.hallOfChampions.resurrectReincarnateCancel(button);
  }
}

/**
 * `ShowHideInventory`'s drawing (`doc/CSBwin-src/CSBCode.cpp:7478-7582`), the host's
 * `showHideInventory`, once the engine has shown or hidden the inventory
 * (`showHideInventory`, `src/engine/ShowHideInventory.ts`): the secondary button list,
 * `d.Buttons17760` or `d.Buttons17304` (`:7538`, `:7577`), and for an inventory shown,
 * `TAG0189d4`'s description of a scroll in the weapon hand (`:7563-7573`).
 */
export function showHideInventoryDrawing(ui: UIState): void {
  syncInventoryButtons(ui);
  if (ui.partyState.selectedCharacterIndex >= 0) describeWeaponHandScroll(ui);
}

/**
 * `TAG02076e`'s drawing (`doc/CSBwin-src/Character.cpp:5151-5158`), the host's
 * `tag02076e`, once the engine has repacked the open chest (`tag02076e`,
 * `src/engine/ShowHideInventory.ts`): `shadedByTag02076e`, which
 * `GameScreen.presentViewport` reads for the three shaded areas, and `arrowCursorShape`,
 * which `drawCursorItem` reads for the arrow cursor of `SetCursorShape(0)`.
 */
export function tag02076eDrawing(ui: UIState): void {
  ui.shadedByTag02076e = true;
  ui.arrowCursorShape = true;
}

/**
 * `TAG0207cc`'s drawing (`doc/CSBwin-src/CSBCode.cpp:10058-10092`), the host's
 * `tag0207cc`, once the engine has selected the magic caster again and run
 * `DrawLegalAttackTypes` (`tag0207cc`, `src/engine/ShowHideInventory.ts`): the shading
 * lifted, which the port's every frame redraws, and `TAG002572`'s cursor (`:10089`).
 */
export function tag0207ccDrawing(ui: UIState): void {
  ui.shadedByTag02076e = false;
  tag002572(ui);
}

/**
 * `ShowHideInventory`'s lists, awake: an inventory shown installs `d.Buttons17760` and
 * empties `d.pKeyXlate1`, so the move keys are nothing (`doc/CSBwin-src/CSBCode.cpp:7577-7578`);
 * hidden, `d.Buttons17304` and `d.Byte18428` again (`:7537-7538`).
 */
export function syncInventoryButtons(ui: UIState): void {
  if (ui.uiMode !== UIMode.Adventure) return;
  const buttons = ui.uiTables.graphic231.buttons;
  const inventoryOpen = ui.partyState.selectedCharacterIndex >= 0;
  ui.secondaryButtons = inventoryOpen ? inventoryButtonList(ui) : buttons.buttons17304;
  ui.keyXlate1 = inventoryOpen ? null : ui.uiTables.graphic231.keys.byte18428;
}

export function handleClothingClick(ui: UIState, button: number): void {
  // `HandleClothingClick` itself does not care who owns the cursor
  // (doc/CSBwin-src/CSBCode.cpp:6987); its callers decide.
  let chIdx = -1;
  let slot = -1;
  if (button < 8) {
    chIdx = Math.floor(button / 2);
    if (chIdx >= ui.partyState.champions.length) return;
    if (ui.partyState.selectedCharacterIndex === chIdx) return;
    const champ = getPartyChampion(ui.partyState, chIdx);
    // `if (d.CH16482[D7W].HP() == 0) return;` (`doc/CSBwin-src/CSBCode.cpp:6999`).
    if (!champ || !isAlive(champ)) return;
    slot = button & 1;
  } else {
    chIdx = ui.partyState.selectedCharacterIndex;
    if (chIdx < 0) return;
    slot = button - 8;
  }

  if (slot < 0 || slot >= 38) return;
  const champ = getPartyChampion(ui.partyState, chIdx);
  if (!champ || !isAlive(champ)) return;

  const isChestSlot = slot >= 30;
  if (isChestSlot && !getActiveChestView(ui, champ)) return;

  const objectInHand = ui.partyState.objectInHand;
  const slotObject = isChestSlot
    ? ui.ctx.interface.openChestContents[slot - 30] ?? OBJECT_ID_NULL
    : getChampionPossession(champ, slot);
  if (objectInHand === OBJECT_ID_NULL && slotObject === OBJECT_ID_NULL) return;

  if (objectInHand !== OBJECT_ID_NULL && !canPlaceInSlot(ui, objectInHand, slot)) return;

  // `CURSORFILTER_PlaceOnCharacter`, sent even with an empty cursor, which may cancel the
  // click (`doc/CSBwin-src/CSBCode.cpp:7025-7031`).
  const dsa = ui.ctx.systems.dsa;
  const place = { object: objectInHand, type: CursorFilterType.PlaceOnCharacter, p1: chIdx, p2: slot, p3: 0, p4: 0 };
  dsa.filters.cursorFilter(place);
  if (place.type === CursorFilterType.Cancel) return;

  // `RemoveCharacterPossession` and `AddCharacterPossession` are the engine's; a chest
  // slot is `d.rnChestContents`, which is ours, and all the pair does past slot 29 is
  // write it (`CharacterSystem.removeCharacterPossession`).
  const character = ui.ctx.systems.character;
  // `RemoveObjectFromHand` and `ObjectToCursor(objD4, 0)` each set the cursor from the hand
  // (`:7035-7051`), whichever runs.
  tag002572(ui);
  if (objectInHand !== OBJECT_ID_NULL) {
    ui.partyState.objectInHand = OBJECT_ID_NULL;
  }
  if (slotObject !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.ctx.interface.openChestContents[slot - 30] = OBJECT_ID_NULL;
    } else {
      character.removeCharacterPossession(chIdx, slot);
    }
    // `CURSORFILTER_PickFromCharacter`, whose cancel nothing reads (`:7041-7050`).
    dsa.filters.cursorFilter({ object: slotObject, type: CursorFilterType.PickFromCharacter, p1: chIdx, p2: slot, p3: 0, p4: 0 });
    ui.partyState.objectInHand = slotObject;
  }
  if (objectInHand !== OBJECT_ID_NULL) {
    if (isChestSlot) {
      ui.ctx.interface.openChestContents[slot - 30] = objectInHand;
    } else {
      character.addCharacterPossession(chIdx, objectInHand, slot);
    }
  }
}

/**
 * The button lists and key tables of the mode: asleep `Buttons17796` and `Byte18440`
 * (`doc/CSBwin-src/Mouse.cpp:1837-1840`), frozen `Buttons17832` and `Byte18448`
 * (`:1891-1894`), and adventuring `Buttons17196` / `Buttons17304` and `Byte18400` /
 * `Byte18428` (`CSBCode.cpp:7115-7118`).
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

/** `d.wRectPos23214` (`doc/CSBwin-src/CSBCode.cpp:459-462`): the shadow, two pixels down and right. */
const W_RECT_POS_23214 = { x1: 2, x2: 20, y1: 2, y2: 15 };
/** `d.wRectPos23222` (`doc/CSBwin-src/CSBCode.cpp:463-466`): the square itself, 19x14. */
const W_RECT_POS_23222 = { x1: 0, x2: 18, y1: 0, y2: 13 };

/**
 * `ShrinkBLT` from a buffer to itself at the same size (`doc/CSBwin-src/Graphics.cpp:381`),
 * which moves no pixel and only recolours the first `rows` rows: a pixel of colour `c`
 * becomes `pColorMap[c] / 10` (`:466-488`).
 */
function recolourRows(buffer: IndexedBitmap, rows: number, colorMap: number[]): void {
  for (let i = 0; i < rows * buffer.width; i++) {
    buffer.pixels[i] = Math.floor(colorMap[buffer.pixels[i]! & 0x0f]! / 10);
  }
}

/**
 * `TAG0025a6` (`doc/CSBwin-src/CSBCode.cpp:2082-2181`): a click on square `p1` of the top
 * view of positions, counted from the party's facing. With no champion in hand it picks
 * up the one standing there: the square becomes the cursor, and a black hole on screen
 * (`Character.drawPartyStatus`). With one in hand it puts them down there, facing the
 * party's way, and whoever stood there takes the square they left.
 *
 * The cursor is made of the square as `DrawCharacterState` last drew it, which the port
 * draws again rather than reads back, since its screen holds the cursor on top. Over a
 * black shadow two pixels down and right, `d.Pointer23178` is the square and
 * `d.Pointer23182` its silhouette in colour 4, for the rows below the palette split
 * (`drawMarchingOrderCursor`). Colour 0 is transparent in both copies (`:2100-2136`).
 *
 * `KillCharacter` does not let go of a champion who dies in hand: it clears
 * `d.Word23244`, not `d.Word23144` (`doc/CSBwin-src/Character.cpp:2658-2663`). Put down,
 * such a champion is `CharacterAtPosition`'s -1, and CSBWin writes the facing and the
 * position to `d.CH16482[-1]` (`CSBCode.cpp:2149-2151`, `:2176`); the port writes them to
 * nobody (`DEBT.md` H).
 */
function tag0025a6(ui: UIState, p1: number): void {
  const party = ui.partyState;
  const g232 = ui.uiTables.graphic232;
  const d7 = p1;
  if (ui.word23144 === 0) {
    const chIdx = characterAtPosition(party.champions, (party.facing + d7) & 3);
    if (chIdx === -1) return;
    const square = createPaletteIndexViewportBuffer(19, 14);
    drawPositionSquare(ui, square, W_RECT_POS_23222, chIdx, party.champions[chIdx]!, party.facing);

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
  if (d4 >= 0) party.champions[d4]!.facing = party.facing;
  // Put down where they were picked up, `CHARFLAG_positionChanged` redraws the square,
  // which the port does every frame.
  if (d6 === d7) return;
  const d5 = characterAtPosition(party.champions, (d7 + party.facing) & 3);
  if (d5 >= 0) party.champions[d5]!.partyPosition = (d6 + party.facing) & 3;
  if (d4 >= 0) party.champions[d4]!.partyPosition = (d7 + party.facing) & 3;
}

/**
 * The VBL's test while a champion is in hand (`doc/CSBwin-src/CSBCode.cpp:948-955`): a
 * pointer outside the top view of positions, left of x 274 or below y 28, lets go of them
 * through `TAG002818` (`:2184`), which puts the square back as it was. CSBWin asks at
 * every VBL; the port asks when the pointer moves, which is when the answer can change.
 * `TAG002818` also records button -1 for a replay, which the port does not make.
 */
export function marchingOrderPointerMoved(ui: UIState, x: number, y: number): void {
  if (ui.word23144 === 0) return;
  if (x < 274 || y > 28) ui.word23144 = 0;
}

/**
 * `CreateCursorBitmap`'s arm for a champion in hand (`doc/CSBwin-src/CSBCode.cpp:2341-2421`):
 * 21 columns and 16 rows of `d.Pointer23178`, drawn with the pointer 9 pixels in and 7
 * down (`d.Word23156`, `d.Word23158`). With `d.DynamicPaletteSwitching`, which is on while
 * the dungeon view is shown, the rows that fall on screen row 29 or below come from
 * `d.Pointer23182` instead (`:2358-2419`).
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
      const pixel = src.pixels[row * src.width + col]!;
      if (pixel === 12) continue;
      dst.pixels[dy * dst.width + dx] = pixel;
    }
  }
}

/**
 * The cursor, drawn where the pointer is. Where it is is CSBWin's screen, which picks its
 * shape; `placeX` moves the column it is drawn at, the left-handed screen's
 * (`src/renderer/LeftHanded.ts`), whose regions are moved before the cursor goes on.
 *
 * Over a dialog it is the arrow, whatever is in hand. Every dialog takes the whole screen,
 * where CSBWin's zones would show the hand or the object over a viewport and portraits it
 * covers. `_DoMenu` sets no shape (`doc/CSBwin-src/Menu.cpp`), as its menu covers the
 * viewport alone; a dialog of the whole screen is the port's.
 */
export function drawCursorItem(
  ui: UIState,
  dynamicPaletteSwitching: boolean,
  placeX: (x: number, y: number) => number = (x) => x,
): void {
  ui.objectCursorFootprint = null;
  if (!ui.hoverPoint) return;
  const x = Math.floor(ui.hoverPoint.x);
  const y = Math.floor(ui.hoverPoint.y);
  const drawnX = placeX(x, y);
  if (ui.dialog) {
    const arrow = getCursorArrowBitmap(ui);
    if (arrow) drawCursorBitmap(ui, arrow, drawnX, y, 12);
    return;
  }
  // The held eye or mouth has hidden it (`stHideCursor`).
  if (ui.word23118 > 0) return;
  if (ui.word23144 !== 0) {
    // `CreateCursorBitmap` asks before anything else (`doc/CSBwin-src/CSBCode.cpp:2267`).
    drawMarchingOrderCursor(ui, drawnX, y, dynamicPaletteSwitching);
    return;
  }
  if (ui.arrowCursorShape) {
    // `tag02076e`'s `SetCursorShape(0)`: the arrow, and no object, until a `TAG002572`
    // (`doc/CSBwin-src/CSBCode.cpp:2059`) sets the cursor from the hand again.
    const arrow = getCursorArrowBitmap(ui);
    if (arrow) drawCursorBitmap(ui, arrow, drawnX, y, 12);
    return;
  }
  const objectId = ui.partyState.objectInHand;
  if (objectId === OBJECT_ID_NULL) {
    drawEmptyCursor(ui, placeX);
    return;
  }
  if (!inCursorShapeZone(ui, x, y)) {
    // Outside the zone the cursor is the arrow, object in hand or not (`tag0029f8`).
    const arrow = getCursorArrowBitmap(ui);
    if (arrow) drawCursorBitmap(ui, arrow, drawnX, y, 12);
    return;
  }
  const cursor = createObjectCursor(ui, resolveObjectNameIndex(ui, objectId));
  if (!cursor) return;
  if (ui.colouredObjectCursor && dynamicPaletteSwitching) {
    // The extra (`DEBT.md` H): the icon throughout, which the screen shows through the
    // interface palette, so the viewport's light and monster colours do not reach it.
    drawObjectCursor(ui, cursor, drawnX, y, false);
    ui.objectCursorFootprint = { x: drawnX - 8, y: y - 8, bitmap: cursor.pointer23186 };
    return;
  }
  drawObjectCursor(ui, cursor, drawnX, y, dynamicPaletteSwitching);
}

/** `d.Byte23202` (`doc/CSBwin-src/CSBCode.cpp:451-454`): the object's shadow, two pixels down and right. */
const BYTE_23202 = { x1: 2, x2: 17, y1: 2, y2: 17 };
/** `d.Byte23206` (`doc/CSBwin-src/CSBCode.cpp:455-458`): the object itself. */
const BYTE_23206 = { x1: 0, x2: 15, y1: 0, y2: 15 };

interface ObjectCursor {
  pointer23186: IndexedBitmap;
  pointer23190: IndexedBitmap;
}

/**
 * `CreateObjectCursor` (`doc/CSBwin-src/CSBCode.cpp:2005-2056`): the two 32x18 cursors of an
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
 * `CreateCursorBitmap`'s arm for an object in hand (`doc/CSBwin-src/CSBCode.cpp:2323-2341`,
 * `:2352-2421`): 18 rows of `d.Pointer23186`, drawn with the pointer 8 pixels in and 8 down
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
      const pixel = src.pixels[row * src.width + col]!;
      if (pixel === 12) continue;
      dst.pixels[dy * dst.width + dx] = pixel;
    }
  }
}

function drawEmptyCursor(ui: UIState, placeX: (x: number, y: number) => number = (x) => x): void {
  if (!ui.hoverPoint) return;
  const x = Math.floor(ui.hoverPoint.x);
  const y = Math.floor(ui.hoverPoint.y);
  const useHand = shouldUseHandCursor(ui, x, y);
  const bitmap = useHand ? getCursorHandBitmap(ui) : getCursorArrowBitmap(ui);
  if (!bitmap) return;

  drawCursorBitmap(ui, bitmap, placeX(x, y), y, 12);
}

function shouldUseHandCursor(ui: UIState, x: number, y: number): boolean {
  const cursorOwner = ui.partyState.cursorOwner;
  if (cursorOwner < 0) return false;
  return inCursorShapeZone(ui, x, y);
}

/**
 * Whether `CreateCursorBitmap` reaches `tag0029e0`, where the cursor is the object in hand
 * or the hand (`doc/CSBwin-src/CSBCode.cpp:2266-2285`): the viewport and the portraits,
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

function getCursorHandBitmap(ui: UIState): IndexedBitmap | null {
  if (ui.cursorHandBitmap) return ui.cursorHandBitmap;
  ui.cursorHandBitmap = decodeCursorBitmap(ui.uiTables.graphic232.cursorHand);
  return ui.cursorHandBitmap;
}


function drawCursorBitmap(ui: UIState, bitmap: IndexedBitmap, x: number, y: number, transparentColor: number): void {
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
      const pixel = bitmap.pixels[srcRow + col]! & 0x0f;
      if (pixel === tc) continue;
      dst.pixels[dstRow + dx] = pixel;
    }
  }
}

/** The square the Oracle answers for: the party's, which a save writes as `partyLevel`, `partyX` and `partyY`. */
function hintSquareOf(ui: UIState): HintSquare {
  const { x, y, z } = ui.partyState.position;
  return { level: z, x, y };
}

/**
 * The flag acted on: `TAG02076e`, the clock stopped, and the screen's paint held for the
 * Oracle's (`hintOracleUp`). Returns the square to open the Oracle on.
 */
export function openHintOracle(ui: UIState): HintSquare {
  tag02076e(ui.ctx);
  ui.ctx.state.paused = true;
  ui.hintOracleUp = true;
  return hintSquareOf(ui);
}

/** The Oracle closed: the clock runs again, and `TAG0207cc` shows the inventory again. */
export function closeHintOracle(ui: UIState): void {
  if (!ui.hintOracleUp) return;
  ui.hintOracleUp = false;
  ui.ctx.state.paused = false;
  tag0207cc(ui.ctx);
}
