/**
 * The inventory screen: slot layout, the open chest, the eye's object-info panel and
 * scroll reading.
 *
 * Mirrors CSBWin `doc/CSBwin-src/CSBUI.cpp`. The chest is not a separate screen in DM —
 * an opened chest borrows the inventory's item grid, which is why `openChest` /
 * `repackOpenChest` live next to the slot rectangles.
 */
import { OBJNI_OPEN_CHEST, OBJNI_SPECIAL_D, OBJNI_SPECIAL_E } from '../../core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, ObjectID, decodeObjectID } from '../../core/types';
import { TextDecodeTables } from '../../engine/DungeonState';
import { Champion } from '../../engine/gameTypes';
import { AttributeIndex, attributeCurrent, attributeMaximum } from '../../engine/attributes';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import { Rect } from '../csbwin/UITables';
import { drawAttributePanel, drawFoodWaterPanel, drawVitalsAndLoad, getChampionPossession, getInventoryItemIndex } from './Character';
import { blitBasicGraphicToViewport, drawObjectIcon, drawWoundedOutline } from './Draw';
import { drawMouthChewAnimation } from './Feeding';
import { applyViewingFilter, drawItemDescriptionLine, getInventoryPlaceholderIndex, getObjectDescriptionLines, getObjectDisplayName, isChestRecord, resolveObjectNameIndex } from './Objects';
import { UIState, emptyChestContents } from './UIState';

const MAX_LINES_IN_SCROLL = 9;
const MAX_SCROLL_LINE_LENGTH = 16;

type ChestViewSource =
  | { id: ObjectID; source: 'cursor' }
  | { id: ObjectID; source: 'hand'; slot: number };

export function drawInventoryScreen(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.partyState) return;
  const selected = ui.partyState.selectedCharacterIndex | 0;
  if (selected < 0) return;

  const champion = ui.partyState.champions[selected] ?? null;
  if (!champion || champion.alive === false) return;

  const iconSlots = ui.uiTables.graphic232.iconDisplay;
  const word612 = ui.uiTables.graphic232.word612;
  const chestView = getActiveChestView(ui, champion);
  syncOpenChest(ui, chestView);

  if (ui.fontData) {
    const nameColor = ui.partyState.cursorOwner === selected ? 9 : 13;
    const nameBaseX = VIEWPORT_X + 2;
    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      nameBaseX,
      VIEWPORT_Y + 7,
      nameColor,
      12,
      champion.name
    );
    const title = champion.title ?? '';
    if (title.length > 0) {
      let titleX = nameBaseX + champion.name.length * 6;
      const firstChar = title.charCodeAt(0);
      if (firstChar !== 44 && firstChar !== 59 && firstChar !== 45) {
        titleX += 6;
      }
      drawTextLineIndex(
        ui.screenIndexBuffer,
        ui.fontData,
        titleX,
        VIEWPORT_Y + 7,
        nameColor,
        12,
        title
      );
    }
  }

  for (let slot = 0; slot < 30; slot++) {
    let objectIndex = getInventoryItemIndex(ui, champion, slot);
    if (chestView?.source === 'hand' && chestView.slot === slot) {
      objectIndex = getOpenChestIconIndex(ui);
    }
    const rect = getInventorySlotRect(iconSlots, slot);
    if (!rect) continue;
    const wounds = champion.wounds ?? 0;
    if (slot <= 5 && (wounds & (1 << slot)) !== 0) {
      drawWoundedOutline(ui, rect);
    }
    if (objectIndex >= 0) {
      drawObjectIcon(ui, rect, objectIndex, word612);
      continue;
    }
    const placeholder = getInventoryPlaceholderIndex(champion, slot);
    if (placeholder >= 0) {
      drawObjectIcon(ui, rect, placeholder, word612);
    }
  }

  // `TAG0189d4` (`doc/CSBwin-src/Character.cpp:3847`). The branch also decides what a
  // click in this area means, which is why it leaves `displayResurrectChestOrScroll`
  // behind for `tag01a6ea` exactly as CSBWin does.
  if (ui.partyState.potentialChampionIndex >= 0) {
    drawResurrectMenu(ui);
  } else if (chestView) {
    ui.displayResurrectChestOrScroll = chestView.source === 'hand' ? 4 : 0;
    drawChestPanel(ui, chestView);
  } else if (ui.pressingEye) {
    ui.displayResurrectChestOrScroll = 0;
    const cursorObject = ui.partyState?.objectInHand ?? OBJECT_ID_NULL;
    if (cursorObject !== OBJECT_ID_NULL) {
      drawObjectInfoPanel(ui, cursorObject);
    } else {
      drawAttributePanel(ui, champion);
    }
  } else {
    ui.displayResurrectChestOrScroll = 0;
    drawFoodWaterPanel(ui, champion);
  }
  drawMouthChewAnimation(ui);
  drawEyeIcon(ui);
  drawVitalsAndLoad(ui, champion);
  drawMouthAndEyeBoxes(ui, champion);
}

/**
 * The boxes around the mouth and the eye (`doc/CSBwin-src/Character.cpp:1363-1392`).
 *
 * Two blits of the same shape from the `CHARFLAG_statsChanged` block, differing only
 * in which graphic each picks. Graphic **33** is the plain box and **34** the marked
 * one, and each says one thing about the champion:
 *
 * - the **mouth** is marked when `food < 0`, `water < 0` or the champion is poisoned —
 *   starving, parched or ill;
 * - the **eye** is marked when any of attributes **1..6** has Current below Maximum.
 *   Luck (index 0) is deliberately outside the loop.
 *
 * The second one is what a player reads as "the red square after a level gain": a
 * level raises the *maxima* (`doc/CSBwin-src/Magic.cpp:98-148`) and leaves Current
 * where it was, so the gap opens and the box changes. Nothing about it is
 * level-specific — a drained champion shows the same box.
 *
 * Both are drawn last and over the icons, as CSBWin draws them, with transparent
 * colour 12 so the eye or mouth shows through the frame.
 */
export function drawMouthAndEyeBoxes(ui: UIState, champion: Champion): void {
  if (!ui.uiTables || !ui.screenIndexBuffer) return;
  const g232 = ui.uiTables.graphic232;
  // `BLT2Viewport(…, 16, 12)`: 16 *bytes* per source line, which is 32 pixels, and 12
  // is the transparent colour, not a height.
  blitBasicGraphicToViewport(ui, mouthBoxGraphic(champion), g232.word1398, 32, 12);
  blitBasicGraphicToViewport(ui, eyeBoxGraphic(champion), g232.word1406, 32, 12);
}

/** The plain box, and the one that marks something wrong. */
export const BOX_GRAPHIC_PLAIN = 33;
export const BOX_GRAPHIC_MARKED = 34;

/**
 * `if (food < 0 || water < 0 || poisonCount != 0)` (`doc/CSBwin-src/Character.cpp:1363`).
 *
 * Note `< 0`, not `<= 0`: a champion at exactly zero food is not yet starving.
 */
export function mouthBoxGraphic(champion: Champion): number {
  const hungry = (champion.food ?? 0) < 0;
  const thirsty = (champion.water ?? 0) < 0;
  const poisoned = (champion.poisonCount ?? 0) !== 0;
  return hungry || thirsty || poisoned ? BOX_GRAPHIC_MARKED : BOX_GRAPHIC_PLAIN;
}

/**
 * `for (D4W=1; D4W<=6; D4W++)` over Current vs Maximum
 * (`doc/CSBwin-src/Character.cpp:1379-1392`).
 *
 * The loop starts at **1**, so Luck can never mark the eye however far it has fallen.
 */
export function eyeBoxGraphic(champion: Champion): number {
  for (let i = AttributeIndex.Strength; i <= AttributeIndex.AntiFire; i++) {
    const attr = champion.attributes?.stats?.[i];
    if (!attr) continue;
    if (attributeCurrent(attr) < attributeMaximum(attr)) return BOX_GRAPHIC_MARKED;
  }
  return BOX_GRAPHIC_PLAIN;
}

/**
 * `TAG0189a8` (`doc/CSBwin-src/Character.cpp:3837`) — graphic 40, the
 * Resurrect / Reincarnate / Cancel menu a provisionally added champion is waiting on.
 */
export function drawResurrectMenu(ui: UIState): void {
  if (!ui.uiTables) return;
  ui.displayResurrectChestOrScroll = 5;
  // CSBWin passes a *byte* width of 72 (`BLT2Viewport(…, 72, 6)`); this helper takes
  // pixels, as every other call here does.
  blitBasicGraphicToViewport(ui, 40, ui.uiTables.graphic232.wRectPos926, 144, 6);
}

export function drawInventoryBackground(ui: UIState): void {
  if (!ui.screenIndexBuffer) return;
  const bg = ui.getGraphicBitmap(17);
  if (!bg) return;
  tag0088b2Index(
    bg,
    ui.screenIndexBuffer,
    {
      x1: VIEWPORT_X,
      y1: VIEWPORT_Y,
      x2: VIEWPORT_X + bg.width - 1,
      y2: VIEWPORT_Y + bg.height - 1,
      srcX: 0,
      srcY: 0,
      srcStride: bg.width,
      srcWidth: bg.width,
      srcHeight: bg.height,
    },
    -1
  );
}

export function getInventorySlotRect(iconSlots: { pixelX: number; pixelY: number }[], slot: number): Rect | null {
  const icon = iconSlots[8 + slot];
  if (!icon) return null;
  return {
    x1: icon.pixelX + VIEWPORT_X,
    y1: icon.pixelY + VIEWPORT_Y,
    x2: icon.pixelX + VIEWPORT_X + 15,
    y2: icon.pixelY + VIEWPORT_Y + 15,
  };
}

export function getChestSlotRect(iconSlots: { pixelX: number; pixelY: number }[], slot: number): Rect | null {
  const icon = iconSlots[38 + slot];
  if (!icon) return null;
  return {
    x1: icon.pixelX + VIEWPORT_X,
    y1: icon.pixelY + VIEWPORT_Y,
    x2: icon.pixelX + VIEWPORT_X + 15,
    y2: icon.pixelY + VIEWPORT_Y + 15,
  };
}

export function getOpenChestIconIndex(ui: UIState): number {
  if (ui.openChestIconIndex !== null) return ui.openChestIconIndex;
  const names = ui.objectTables?.objectNames ?? [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] ?? '').trim().toUpperCase();
    if (name === 'OPEN CHEST') {
      ui.openChestIconIndex = i;
      return i;
    }
  }
  ui.openChestIconIndex = OBJNI_OPEN_CHEST;
  return ui.openChestIconIndex;
}

export function getActiveChestView(ui: UIState, champion: Champion): ChestViewSource | null {
  if (!ui.partyState) return null;

  const cursorObject = ui.partyState.objectInHand;
  if (ui.pressingEye && cursorObject !== OBJECT_ID_NULL && isChestRecord(cursorObject)) {
    return { id: cursorObject, source: 'cursor' };
  }

  if (ui.pressingEye) return null;
  const handSlot = 1; // CSBWin uses weapon hand for chest display.
  const handObject = getChampionPossession(champion, handSlot);
  if (handObject !== OBJECT_ID_NULL && isChestRecord(handObject)) {
    return { id: handObject, source: 'hand', slot: handSlot };
  }
  return null;
}

export function syncOpenChest(ui: UIState, chestView: ChestViewSource | null): void {
  if (!chestView) {
    if (ui.openChestId !== null) {
      repackOpenChest(ui);
    }
    return;
  }

  if (ui.openChestId !== null && ui.openChestId === chestView.id) return;
  if (ui.openChestId !== null) repackOpenChest(ui);
  openChest(ui, chestView.id);
}

export function openChest(ui: UIState, chestId: ObjectID): void {
  const chest = ui.dungeonState.getContainerRecord(chestId);
  if (!chest) {
    ui.openChestId = null;
    ui.openChestContents = emptyChestContents();
    return;
  }

  ui.openChestId = chestId;
  const contents = emptyChestContents();
  let cursor = chest.containedObject;
  let index = 0;
  while (cursor !== OBJECT_ID_EOF && cursor !== OBJECT_ID_NULL && index < contents.length) {
    contents[index++] = cursor;
    cursor = ui.dungeonState.getDBRecordLink(cursor);
  }
  ui.openChestContents = contents;

  for (const item of contents) {
    if (item !== OBJECT_ID_NULL) {
      ui.dungeonState.setDBRecordLink(item, OBJECT_ID_EOF);
    }
  }
  chest.containedObject = OBJECT_ID_EOF;
}

export function repackOpenChest(ui: UIState): void {
  if (ui.openChestId === null) return;
  const chest = ui.dungeonState.getContainerRecord(ui.openChestId);
  if (!chest) {
    ui.openChestId = null;
    ui.openChestContents = emptyChestContents();
    return;
  }

  chest.containedObject = OBJECT_ID_EOF;
  let previous: ObjectID | null = null;
  for (const item of ui.openChestContents) {
    if (item === OBJECT_ID_NULL) continue;
    ui.dungeonState.setDBRecordLink(item, OBJECT_ID_EOF);
    if (previous === null) {
      chest.containedObject = item;
    } else {
      ui.dungeonState.setDBRecordLink(previous, item);
    }
    previous = item;
  }

  ui.openChestId = null;
  ui.openChestContents = emptyChestContents();
}

export function drawChestPanel(ui: UIState, chestView: ChestViewSource): void {
  if (!ui.uiTables || !ui.screenIndexBuffer) return;
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 25, g232.wRectPos926, 144, 8);
  drawInspectArrow(ui, chestView.source === 'cursor');

  const word612 = g232.word612;
  const iconSlots = g232.iconDisplay;
  for (let slot = 0; slot < 8; slot++) {
    const rect = getChestSlotRect(iconSlots, slot);
    if (!rect) continue;
    const item = ui.openChestContents[slot] ?? OBJECT_ID_NULL;
    if (item === OBJECT_ID_NULL) continue;
    const objectIndex = resolveObjectNameIndex(ui, item | 0);
    if (objectIndex >= 0) drawObjectIcon(ui, rect, objectIndex, word612);
  }
}

export function drawInspectArrow(ui: UIState, fromEye: boolean): void {
  if (!ui.uiTables || !ui.screenIndexBuffer) return;
  const g232 = ui.uiTables.graphic232;
  const graphicIndex = fromEye ? 19 : 18;
  blitBasicGraphicToViewport(ui, graphicIndex, g232.wRectPos934, 16, 8);
}

export function drawObjectInfoPanel(ui: UIState, objectId: ObjectID): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.objectTables) return;
  if (decodeObjectID(objectId).category === DBType.SCROLL) {
    drawScrollPanel(ui, objectId);
    return;
  }
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);
  blitBasicGraphicToViewport(ui, 29, g232.wRectPos942, 32, 12);

  const objectNameIndex = resolveObjectNameIndex(ui, objectId | 0);
  if (objectNameIndex >= 0) {
    const iconRect = {
      x1: VIEWPORT_X + 111,
      y1: VIEWPORT_Y + 59,
      x2: VIEWPORT_X + 126,
      y2: VIEWPORT_Y + 74,
    };
    drawObjectIcon(ui, iconRect, objectNameIndex, g232.word612);
    const name = getObjectDisplayName(ui, objectId, objectNameIndex);
    if (name) {
      drawTextLineIndex(
        ui.screenIndexBuffer,
        ui.fontData,
        VIEWPORT_X + 133,
        VIEWPORT_Y + 68,
        13,
        null,
        name
      );
    }
  }

  const lines = getObjectDescriptionLines(ui, objectId, objectNameIndex);
  const textState = { x: VIEWPORT_X + 108, y: VIEWPORT_Y + 87 };
  for (const line of lines) {
    drawItemDescriptionLine(ui, line.text, line.color, textState);
  }
  drawInspectArrow(ui, ui.pressingEye);
}

export function drawEyeIcon(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer) return;
  const word612 = ui.uiTables.graphic232.word612;
  const icon = ui.pressingEye ? OBJNI_SPECIAL_E : OBJNI_SPECIAL_D;
  const rect = getEyeRect(ui);
  if (!rect) return;
  drawObjectIcon(ui, rect, icon, word612);
}

export function getEyeRect(ui: UIState): Rect | null {
  if (!ui.uiTables) return null;
  const rect = ui.uiTables.graphic232.word1406;
  return {
    x1: rect.x1 + VIEWPORT_X + 1,
    y1: rect.y1 + VIEWPORT_Y + 1,
    x2: rect.x2 + VIEWPORT_X - 1,
    y2: rect.y2 + VIEWPORT_Y - 1,
  };
}

export function drawScrollPanel(ui: UIState, objectId: ObjectID): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.objectTables) return;
  let scrollId = objectId;
  const filter = applyViewingFilter(ui, objectId, 0);
  if (filter) {
    // `obj.checkIndirectIndex(pDSAparameters[2])`, then `dbType() == dbSCROLL`
    // (`doc/CSBwin-src/Character.cpp:3510-3514`): the DSA's answer counts only if it
    // names a scroll that exists.
    const candidate = filter.objectId | 0;
    if (candidate >= 0 && ui.dungeonState.getScrollRecord(candidate as ObjectID)) {
      scrollId = candidate as ObjectID;
    }
  }

  const scroll = ui.dungeonState.getScrollRecord(scrollId);
  if (!scroll) return;
  const textTables: TextDecodeTables = {
    escape1: ui.objectTables.textEscape1,
    escape2Wall: ui.objectTables.textEscape2Wall,
    escape2Other: ui.objectTables.textEscape2Other,
  };
  const text = ui.dungeonState.decodeScrollText(scroll, textTables) ?? '';

  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 23, g232.wRectPos926, 144, 8);

  const { lines, startY } = splitScrollLines(text);
  let y = startY;
  for (const line of lines) {
    drawScrollLine(ui, y, line);
    y += 7;
  }
  drawInspectArrow(ui, ui.pressingEye);
}

export function splitScrollLines(text: string): { lines: string[]; startY: number } {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
  bytes.push(0, 0);

  let cursor = 0;
  while (bytes[cursor] !== 0 && bytes[cursor] !== 10) cursor++;
  const firstLine = bytesToString(bytes, 0, cursor);
  bytes[cursor] = 0;
  cursor++;

  let numLines = 1;
  let scan = cursor;
  while (bytes[scan] !== 0) {
    if (bytes[scan] === 10) numLines++;
    scan++;
  }

  const lastIndex = scan - 1;
  if (lastIndex >= 0) {
    if (bytes[lastIndex] !== 10) {
      numLines++;
    } else if (lastIndex - 1 >= 0 && bytes[lastIndex - 1] === 10) {
      numLines--;
    }
  }

  if (numLines > MAX_LINES_IN_SCROLL) numLines = MAX_LINES_IN_SCROLL;
  const startY = 92 - Math.floor((7 * numLines) / 2);

  const lines: string[] = [];
  lines.push(firstLine);
  numLines -= 1;
  if (numLines <= 0) return { lines, startY };

  let lineStart = cursor;
  for (let remaining = numLines; remaining > 0; remaining--) {
    while (bytes[cursor] !== 0 && bytes[cursor] !== 10) cursor++;
    if (bytes[cursor] === 0) {
      bytes[cursor + 1] = 0;
    }
    bytes[cursor] = 0;
    lines.push(bytesToString(bytes, lineStart, cursor));
    cursor++;
    lineStart = cursor;
  }

  return { lines, startY };
}

export function bytesToString(bytes: number[], start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

export function drawScrollLine(ui: UIState, y: number, text: string): void {
  if (!ui.fontData || !ui.screenIndexBuffer) return;
  const line = text.length > MAX_SCROLL_LINE_LENGTH ? text.slice(0, MAX_SCROLL_LINE_LENGTH) : text;
  const encoded = encodeScrollFontText(line);
  const x = VIEWPORT_X + 162 - Math.floor((line.length * 6) / 2);
  drawTextLineIndexRaw(ui.screenIndexBuffer, ui.fontData, x, VIEWPORT_Y + y, 0, 15, encoded);
}

export function encodeScrollFontText(text: string): string {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i) & 0xff;
    if (code >= 65 && code <= 90) {
      code -= 64;
    } else if (code >= 0x7b) {
      code -= 0x60;
    }
    out.push(code);
  }
  return String.fromCharCode(...out);
}
