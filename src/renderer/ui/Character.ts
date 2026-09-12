/**
 * Champion panels: the party status bar and the character half of the inventory screen.
 *
 * Mirrors CSBWin `doc/CSBwin-src/Character.cpp` — portraits, hand icons, shield dots,
 * life/stamina/mana bars, the attribute and food/water panels, carried load, and the
 * possession slots those panels read and write.
 */
import { ImageFormat } from '../../core/imageDecoder';
import { OBJNI_ILLUMULET_A, OBJNI_ILLUMULET_B, OBJNI_TORCH_A } from '../../core/objectNameIndex';
import { ObjectID } from '../../core/types';
import { Champion } from '../../engine/gameTypes';
import { AttributeIndex, attributeCurrent, attributeMaximum } from '../../engine/attributes';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { IndexedBitmap, fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import { blitBasicGraphicToViewport, computeBarHeight, drawFoodWaterBar, drawMaskedBarRow, drawObjectIcon } from './Draw';
import { descIndexForObject, getBaseObjectNameIndex, getDescIndexForObjectType, getInventoryPlaceholderIndex, getRoleMastery, isBaseObjectNameIndex, isLikelyObjectRecord, normalizeObjectValue, normalizeWord6, resolveObjectNameIndex } from './Objects';
import { UIState } from './UIState';
const ROLE_LABELS = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
const CHAR_COLORS = [7, 11, 8, 14];
/**
 * `d.Pointer16770` (`doc/CSBwin-src/CSBCode.cpp:370-384`), indexed by the mastery
 * `DetermineMastery` returns, so slots 0 and 1 are never read (CSBWin leaves 1 out of the
 * panel and dies on 0). The six master ranks begin with the characters `` ` `` and `a`..`e`,
 * which in the DM font (graphic `0x22d`) are the rune glyphs for Lo, Um, On, Ee, Ux and
 * Mon — they must reach the font as those exact codes, hence `drawTextLineIndexRaw`.
 */
export const MASTERY_LABELS: string[] = [
  '',
  '',
  'NEOPHYTE',
  'NOVICE',
  'APPRENTICE',
  'JOURNEYMAN',
  'CRAFTSMAN',
  'ARTISAN',
  'ADEPT',
  'EXPERT',
  '` MASTER',
  'a MASTER',
  'b MASTER',
  'c MASTER',
  'd MASTER',
  'e MASTER',
  'ARCHMASTER',
];
const ATTRIBUTE_LABELS = ['STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];

export function drawFoodWaterPanel(ui: UIState, champion: Champion): void {
  if (!ui.uiTables || !ui.screenIndexBuffer) return;
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);
  blitBasicGraphicToViewport(ui, 30, g232.wRectPos950, 48, 12);
  blitBasicGraphicToViewport(ui, 31, g232.wRectPos958, 48, 12);
  if ((champion.poisonCount ?? 0) !== 0) {
    blitBasicGraphicToViewport(ui, 32, g232.wRectPos966, 96, 12);
  }

  drawFoodWaterBar(ui, champion.food ?? 0, 69, 5);
  drawFoodWaterBar(ui, champion.water ?? 0, 92, 14);
}

export function drawAttributePanel(ui: UIState, champion: Champion): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData) return;
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);

  // `for (D7W=0; D7W<=3; D7W++)` — one line per role, `Smaller(16, mastery)` capped and
  // mastery 1 (no experience at all) left off the panel entirely
  // (`doc/CSBwin-src/Character.cpp:4590-4605`).
  let lineY = 58;
  for (let role = 0; role < ROLE_LABELS.length; role++) {
    const mastery = Math.min(16, getRoleMastery(ui, champion, role));
    if (mastery <= 1) continue;
    const masteryLabel = MASTERY_LABELS[mastery] ?? '';
    if (!masteryLabel) continue;
    drawTextLineIndexRaw(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 107,
      VIEWPORT_Y + lineY,
      13,
      null,
      `${masteryLabel} ${ROLE_LABELS[role]}`
    );
    lineY += 7;
  }

  // `for (D7W=1; D7W<=6; D7W++)` — the panel lists attributes 1..6 and never Luck
  // (`doc/CSBwin-src/Character.cpp:4609`). Red when Current has fallen below Maximum,
  // green when a potion has pushed it above.
  const stats = champion.attributes?.stats ?? [];
  const attrValues: number[] = [];
  const attrMax: number[] = [];
  for (let i = AttributeIndex.Strength; i <= AttributeIndex.AntiFire; i++) {
    const attr = stats[i];
    attrValues.push(attr ? attributeCurrent(attr) : 0);
    attrMax.push(attr ? attributeMaximum(attr) : 0);
  }
  lineY = 86;
  for (let i = 0; i < ATTRIBUTE_LABELS.length; i++) {
    const current = attrValues[i] ?? 0;
    const max = attrMax[i] ?? 0;
    let valueColor = 13;
    if (current < max) valueColor = 8;
    else if (current > max) valueColor = 7;

    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 107,
      VIEWPORT_Y + lineY,
      13,
      null,
      ATTRIBUTE_LABELS[i] ?? ''
    );
    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 173,
      VIEWPORT_Y + lineY,
      valueColor,
      null,
      formatLifeValue(current)
    );
    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 191,
      VIEWPORT_Y + lineY,
      13,
      null,
      `/${formatLifeValue(max)}`
    );
    lineY += 7;
  }
}

export function drawVitalsAndLoad(ui: UIState, champion: Champion): void {
  if (!ui.fontData || !ui.screenIndexBuffer) return;

  const attrs = champion.attributes;
  const health = attrs?.health ?? 0;
  const maxHealth = attrs?.maxHealth ?? 0;
  const stamina = Math.floor((attrs?.stamina ?? 0) / 10);
  const maxStamina = Math.floor((attrs?.maxStamina ?? 0) / 10);
  const mana = attrs?.mana ?? 0;
  const maxMana = attrs?.maxMana ?? 0;

  const baseX = VIEWPORT_X + 54;
  const slashX = VIEWPORT_X + 72;
  const maxX = VIEWPORT_X + 78;
  const labelX = VIEWPORT_X + 4;
  const lineHealth = VIEWPORT_Y + 116;
  const lineStamina = VIEWPORT_Y + 124;
  const lineMana = VIEWPORT_Y + 132;
  const vitalsColor = 13;

  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, labelX, lineHealth, vitalsColor, null, 'HEALTH');
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, labelX, lineStamina, vitalsColor, null, 'STAMINA');
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, labelX, lineMana, vitalsColor, null, 'MANA');

  drawLifeForceLine(ui, baseX, slashX, maxX, lineHealth, health, maxHealth, vitalsColor);
  drawLifeForceLine(ui, baseX, slashX, maxX, lineStamina, stamina, maxStamina, vitalsColor);
  drawLifeForceLine(ui, baseX, slashX, maxX, lineMana, mana, maxMana, vitalsColor);

  const loadInfo = computeChampionLoad(ui, champion);
  if (!loadInfo) return;
  const { load, maxLoad, color } = loadInfo;
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    VIEWPORT_X + 103,
    lineMana,
    color,
    null,
    'LOAD'
  );
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    VIEWPORT_X + 147,
    lineMana,
    color,
    null,
    `${formatLoad(load)}/${formatMaxLoad(maxLoad)} KG`
  );
}

export function drawLifeForceLine(ui: UIState, 
  xCurrent: number,
  xSlash: number,
  xMax: number,
  y: number,
  current: number,
  max: number,
  color: number
): void {
  if (!ui.fontData || !ui.screenIndexBuffer) return;
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    xCurrent,
    y,
    color,
    null,
    formatLifeValue(current)
  );
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, xSlash, y, color, null, '/');
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    xMax,
    y,
    color,
    null,
    formatLifeValue(max)
  );
}

export function formatLifeValue(value: number): string {
  const clamped = Math.max(0, Math.min(9999, Math.floor(value)));
  return String(clamped).padStart(3, ' ');
}

export function computeChampionLoad(ui: UIState, champion: Champion): { load: number; maxLoad: number; color: number } | null {
  if (!ui.objectTables) return null;
  const load = computeLoadWeight(ui, champion);
  const maxLoad = computeMaxLoad(ui, champion);
  const color = getLoadColor(load, maxLoad);
  return { load, maxLoad, color };
}

/**
 * `CHARDESC.load`. Delegated to the engine so the figure the eye panel prints is the
 * one `Quickness` and `DetermineThrowingDistance` act on.
 */
export function computeLoadWeight(ui: UIState, champion: Champion): number {
  return ui.characterStats?.characterLoad(champion) ?? 0;
}

/** `MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4280`), in the engine. */
export function computeMaxLoad(ui: UIState, champion: Champion): number {
  return ui.characterStats?.maxLoad(champion) ?? 0;
}

export function getLoadColor(load: number, maxLoad: number): number {
  if (maxLoad <= 0) return 13;
  if (load > maxLoad) return 8;
  if (load * 8 > maxLoad * 5) return 11;
  return 13;
}

export function formatLoad(value: number): string {
  const whole = Math.floor(value / 10);
  const frac = Math.abs(value % 10);
  return `${String(whole).padStart(3, ' ')}.${frac}`;
}

export function formatMaxLoad(value: number): string {
  return String(Math.floor((value + 5) / 10)).padStart(3, ' ');
}

export function drawPartyStatus(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.partyState || !ui.fontData) return;

  const g232 = ui.uiTables.graphic232;
  const party = ui.partyState;
  const facing = party.facing | 0;
  const selected = party.selectedCharacterIndex | 0;

  for (let chIdx = 0; chIdx < 4; chIdx++) {
    const baseX = 69 * chIdx;
    fillRectIndex(
      ui.screenIndexBuffer,
      { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 },
      12
    );

    // `&d.CH16482[chIdx]` — the champion *index*, which is what indexes the four
    // portrait boxes. Not `charPosition`: that is the corner of the cell they stand in,
    // and it rotates when the party turns while the boxes do not.
    const champion = party.champions[chIdx] ?? null;

    if (selected !== chIdx) {
      const nameRect = { x1: baseX, y1: 0, x2: baseX + 42, y2: 6 };
      fillRectIndex(ui.screenIndexBuffer, nameRect, 1);
      if (champion) {
        const nameColor = ui.partyState.cursorOwner === chIdx ? 9 : 13;
        drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, baseX + 1, 5, nameColor, 1, champion.name);
      }
    }

    if (champion && champion.alive === false) {
      const deadGraphic = ui.getGraphicBitmap(8);
      if (deadGraphic) {
        tag0088b2Index(
          deadGraphic,
          ui.screenIndexBuffer,
          {
            x1: baseX,
            y1: 0,
            x2: baseX + 66,
            y2: 28,
            srcX: 0,
            srcY: 0,
            srcStride: deadGraphic.width,
            srcWidth: deadGraphic.width,
            srcHeight: deadGraphic.height,
          },
          -1
        );
      }
    }

    if (champion) {
      drawLifeBars(ui, chIdx, champion);
    }

    if (champion && typeof champion.portraitGraphic === 'number' && selected === chIdx) {
      const portraitGraphic = getPortraitBitmap(ui, champion.portraitGraphic);
      if (portraitGraphic) {
        const portraitRect = { x1: baseX + 7, y1: 0, x2: baseX + 38, y2: 28 };
        fillRectIndex(ui.screenIndexBuffer, portraitRect, 1);
        tag0088b2Index(
          portraitGraphic,
          ui.screenIndexBuffer,
          {
            x1: portraitRect.x1,
            y1: portraitRect.y1,
            x2: portraitRect.x2,
            y2: portraitRect.y2,
            srcX: 0,
            srcY: 0,
            srcStride: portraitGraphic.width,
            srcWidth: portraitGraphic.width,
            srcHeight: portraitGraphic.height,
          },
          1
        );
      }
    }

    if (champion && champion.alive !== false) {
      drawShieldDots(ui, baseX, champion);
    }

    const charPos = champion?.partyPosition ?? chIdx;
    const dir = (charPos + 4 - facing) & 3;
    const posRect = g232.wRectPos1454[dir];
    const color = g232.byte1386[chIdx] ?? 13;
    fillRectIndex(ui.screenIndexBuffer, posRect, color);

    const indicator = ui.getGraphicBitmap(28);
    if (indicator) {
      const champFacing = champion?.facing ?? facing;
      const srcX = ((champFacing + 4 - facing) & 3) * 19;
      tag0088b2Index(
        indicator,
        ui.screenIndexBuffer,
        {
          x1: posRect.x1,
          y1: posRect.y1,
          x2: posRect.x2,
          y2: posRect.y2,
          srcX,
          srcY: 0,
          srcStride: indicator.width,
          srcWidth: 19,
          srcHeight: indicator.height,
        },
        12
      );
    }
  }

  drawTopBarHandIcons(ui);
}

export function drawShieldDots(ui: UIState, baseX: number, champion: Champion): void {
  if (!ui.screenIndexBuffer || !ui.partyState) return;
  const shields: number[] = [];
  const fireShield = ui.partyState.fireShield ?? 0;
  const spellShield = ui.partyState.spellShield ?? 0;
  const partyShield = ui.partyState.partyShield ?? 0;
  const personalShield = champion.shieldStrength ?? 0;

  if (fireShield > 0) shields.push(38);
  if (spellShield > 0) shields.push(39);
  if (partyShield > 0 || personalShield > 0) shields.push(37);
  if (shields.length === 0) return;

  const rect = { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 };
  for (let i = shields.length - 1; i >= 0; i--) {
    const graphic = ui.getGraphicBitmap(shields[i] ?? -1);
    if (!graphic) continue;
    tag0088b2Index(
      graphic,
      ui.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 0,
        srcStride: graphic.width,
        srcWidth: graphic.width,
        srcHeight: graphic.height,
      },
      10
    );
  }
}

export function getPortraitBitmap(ui: UIState, portraitIndex: number): IndexedBitmap | null {
  if (portraitIndex < 0) return null;
  const cached = ui.portraitCache.get(portraitIndex);
  if (cached) return cached;

  const sheet = getPortraitSheet(ui);
  if (!sheet) return null;

  const w = 32;
  const h = 29;
  const cols = Math.floor(sheet.width / w);
  const rows = Math.floor(sheet.height / h);
  if (cols <= 0 || rows <= 0) return null;

  const count = cols * rows;
  if (portraitIndex >= count) return null;

  const sx = (portraitIndex % cols) * w;
  const sy = Math.floor(portraitIndex / cols) * h;
  const outPixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const srcRow = (sy + y) * sheet.width + sx;
    const dstRow = y * w;
    outPixels.set(sheet.pixels.subarray(srcRow, srcRow + w), dstRow);
  }

  const bmp: IndexedBitmap = { width: w, height: h, pixels: outPixels };
  ui.portraitCache.set(portraitIndex, bmp);
  return bmp;
}

export function getPortraitSheet(ui: UIState): IndexedBitmap | null {
  if (ui.portraitSheet !== undefined) return ui.portraitSheet;
  const img1 = ui.getGraphicBitmap(26, ImageFormat.IMG1);
  if (img1 && img1.width >= 32 && img1.height >= 29) {
    ui.portraitSheet = img1;
    return img1;
  }
  const img2 = ui.getGraphicBitmap(26, ImageFormat.IMG2);
  if (img2 && img2.width >= 32 && img2.height >= 29) {
    ui.portraitSheet = img2;
    return img2;
  }
  ui.portraitSheet = null;
  return null;
}

export function drawTopBarHandIcons(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.partyState) return;
  const iconSlots = ui.uiTables.graphic232.iconDisplay;
  const word612 = ui.uiTables.graphic232.word612;
  const selected = ui.partyState.selectedCharacterIndex | 0;

  for (let chIdx = 0; chIdx < 4; chIdx++) {
    const champion = ui.partyState.champions[chIdx] ?? null;
    const alive = champion ? champion.alive !== false : false;
    if (!alive) continue;
    if (selected === chIdx) continue;

    for (let hand = 0; hand <= 1; hand++) {
      const slot = 2 * chIdx + hand;
      const icon = iconSlots[slot];
      if (!icon) continue;

      const rect = { x1: icon.pixelX, y1: icon.pixelY, x2: icon.pixelX + 15, y2: icon.pixelY + 15 };
      const frame = ui.getGraphicBitmap(33);
      if (frame) {
        tag0088b2Index(
          frame,
          ui.screenIndexBuffer,
          {
            x1: rect.x1 - 1,
            y1: rect.y1 - 1,
            x2: rect.x2 + 1,
            y2: rect.y2 + 1,
            srcX: 0,
            srcY: 0,
            srcStride: frame.width,
            srcHeight: frame.height,
          },
          12
        );
      }
      const objectId =
        hand === 1
          ? typeof champion?.weaponHand === 'number'
            ? (champion.weaponHand | 0)
            : -1
          : typeof champion?.shieldHand === 'number'
            ? (champion.shieldHand | 0)
            : -1;
      const objectNameIndex = objectId >= 0 ? resolveObjectNameIndex(ui, objectId) : -1;

      if (objectNameIndex >= 0) {
        drawObjectIcon(ui, rect, objectNameIndex, word612);
      } else if (champion) {
        const placeholder = getInventoryPlaceholderIndex(champion, hand);
        drawObjectIcon(ui, rect, placeholder, word612);
      }
    }
  }
}

export function drawLifeBars(ui: UIState, chIdx: number, champion: Champion): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !champion.alive) return;
  const offsets = ui.uiTables.graphic232.word1526[chIdx];
  const masks = ui.uiTables.graphic232.word1502[chIdx];
  if (!offsets || !masks) return;

  const heights = [
    computeBarHeight(champion.attributes?.health ?? 0, champion.attributes?.maxHealth ?? 0, false),
    computeBarHeight(champion.attributes?.stamina ?? 0, champion.attributes?.maxStamina ?? 0, false),
    computeBarHeight(champion.attributes?.mana ?? 0, champion.attributes?.maxMana ?? 0, true),
  ];

  for (let bar = 0; bar < 3; bar++) {
    const offsetBytes = offsets[bar] ?? 0;
    const startX = Math.floor(offsetBytes / 8) * 16;
    const mask1 = masks[bar * 2] ?? 0;
    const mask2 = masks[bar * 2 + 1] ?? 0;
    const height = heights[bar] ?? 0;

    for (let row = 0; row <= 24; row++) {
      const filled = height > (24 - row);
      const color = filled ? CHAR_COLORS[chIdx] : 12;
      const y = 2 + row;
      drawMaskedBarRow(ui, startX, y, mask1, color);
      drawMaskedBarRow(ui, startX + 16, y, mask2, color);
    }
  }
}

export function drawHeldObjectName(ui: UIState): void {
  if (!ui.uiTables || !ui.fontData || !ui.screenIndexBuffer) return;

  const objectNames = ui.objectTables?.objectNames;
  if (!objectNames || objectNames.length === 0) return;

  const objectId = normalizeObjectValue(ui.partyState?.objectInHand);
  let label = '';
  if (objectId !== null) {
    const nameIndex = getBaseObjectNameIndex(ui, objectId);
    label = objectNames[nameIndex] ?? '';
  }

  const padded = (label || '').padEnd(14, ' ').slice(0, 14);
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 0xe9, 0x25, 4, 0, padded);
}

export function getChampionPossession(champion: Champion, slot: number): number | null {
  if (champion.possessions && slot >= 0 && slot < champion.possessions.length) {
    const value = champion.possessions[slot];
    if (typeof value === 'number') return value;
  }
  if (slot === 0 && typeof champion.shieldHand === 'number') return champion.shieldHand;
  if (slot === 1 && typeof champion.weaponHand === 'number') return champion.weaponHand;
  if (slot === 8 && typeof champion.quiver === 'number') return champion.quiver;
  return null;
}

export function setChampionPossession(ui: UIState, champion: Champion, slot: number, value: number | null): void {
  const previous = normalizeObjectValue(getChampionPossession(champion, slot));
  const next = normalizeObjectValue(value);
  if (!champion.possessions || champion.possessions.length < 30) {
    const slots = new Array(30).fill(null) as Array<number | null>;
    if (champion.possessions) {
      for (let i = 0; i < champion.possessions.length && i < slots.length; i++) {
        slots[i] = normalizeObjectValue(champion.possessions[i]);
      }
    }
    champion.possessions = slots;
  }
  champion.possessions[slot] = next;
  if (slot === 0) champion.shieldHand = next;
  if (slot === 1) champion.weaponHand = next;
  if (slot === 8) champion.quiver = next;
  updateLightForPossessionChange(ui, slot, previous, next);
}

export function canPlaceInSlot(ui: UIState, objectId: number, slot: number): boolean {
  if (!ui.objectTables || !ui.uiTables) return true;
  const descIndex = isLikelyObjectRecord(ui, objectId)
    ? descIndexForObject(ui, objectId as ObjectID)
    : getDescIndexForObjectType(ui, objectId | 0);
  if (descIndex === null) return true;
  const carryMask = ui.objectTables.objDescCarryMask[descIndex] ?? 0;
  const slotMask = ui.uiTables.graphic232.carryLocation[slot] ?? 0;
  return (carryMask & slotMask) !== 0;
}

export function getInventoryItemIndex(ui: UIState, champion: Champion, slot: number): number {
  const possessions = champion.possessions;
  if (possessions && slot >= 0 && slot < possessions.length) {
    const value = possessions[slot];
    if (typeof value === 'number') return resolveObjectNameIndex(ui, value | 0);
  }
  if (slot === 0 && typeof champion.shieldHand === 'number') {
    return resolveObjectNameIndex(ui, champion.shieldHand | 0);
  }
  if (slot === 1 && typeof champion.weaponHand === 'number') {
    return resolveObjectNameIndex(ui, champion.weaponHand | 0);
  }
  return -1;
}

export function updateLightForPossessionChange(ui: UIState, slot: number, previous: number | null, next: number | null): void {
  if (!ui.partyState || !ui.uiTables) return;
  if (slot !== 0 && slot !== 1 && slot !== 10) return;

  if (slot === 10) {
    const word1074 = ui.uiTables.graphic232.word1074;
    const stepValue = word1074[2] ?? 0;
    if (stepValue !== 0) {
      const prevIsIllumulet = previous !== null
        && isBaseObjectNameIndex(ui, previous, OBJNI_ILLUMULET_A, OBJNI_ILLUMULET_B);
      const nextIsIllumulet = next !== null
        && isBaseObjectNameIndex(ui, next, OBJNI_ILLUMULET_A, OBJNI_ILLUMULET_B);
      const delta = (nextIsIllumulet ? stepValue : 0) - (prevIsIllumulet ? stepValue : 0);
      if (delta !== 0) {
        const current = ui.partyState.brightness ?? 0;
        ui.partyState.brightness = normalizeWord6(current + delta);
      }
    }
  }

  if (slot === 0 || slot === 1) {
    setTorchLitState(ui, previous, false);
    setTorchLitState(ui, next, true);
  }
}

export function setTorchLitState(ui: UIState, objectId: number | null, lit: boolean): void {
  if (objectId === null) return;
  if (!isLikelyObjectRecord(ui, objectId)) return;
  if (!isBaseObjectNameIndex(ui, objectId, OBJNI_TORCH_A, OBJNI_TORCH_A)) return;
  const weapon = ui.dungeonState.getWeaponRecord(objectId as ObjectID);
  if (!weapon) return;
  weapon.litTorch = lit;
}
