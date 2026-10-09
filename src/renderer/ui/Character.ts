/**
 * Champion panels: the party status bar and the character half of the inventory screen.
 *
 * Mirrors CSBWin `doc/CSBwin-src/Character.cpp` — portraits, hand icons, shield dots,
 * life/stamina/mana bars, the attribute and food/water panels, carried load, and the
 * possession slots those panels read. Writing a slot is the engine's
 * (`CharacterSystem.addCharacterPossession` / `removeCharacterPossession`).
 */
import { ImageFormat } from '../../core/imageDecoder';
import { OBJECT_ID_NULL, ObjectID } from '../../core/types';
import { getExternalPortraitAddress } from '../../data/CSBGraphicsLoader';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from '../../data/CsbwinCharacters';
import { CHARFLAG_CURSOR, CHARFLAG_PORTRAIT_CHANGED, getChampionPossession, Champion } from '../../engine/gameTypes';
import { AttributeIndex, attributeCurrent, attributeMaximum } from '../../engine/attributes';
import { masteryGainPending } from '../../engine/MasteryGains';
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { IndexedBitmap, PaletteIndexViewportBuffer, fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import { blitBasicGraphicToViewport, computeBarHeight, drawFoodWaterBar, drawMaskedBarRow, drawObjectIcon, drawPossessionBox, possessionBoxGraphic } from './Draw';
import { descIndexForObject, describeChampionBones, getBonesChampion, getInventoryPlaceholderIndex, getRoleMastery, resolveObjectNameIndex } from './Objects';
import { UIState } from './UIState';
import type { Rect } from '../../data/tables/UITables';
/** `d.Pointer16596` (`doc/CSBwin-src/CSBCode.cpp:373-376`), the four base skills. */
export const ROLE_LABELS = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
const CHAR_COLORS = [7, 11, 8, 14];
/**
 * `d.Pointer16770` (`doc/CSBwin-src/CSBCode.cpp:380-394`), indexed by the mastery
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
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);
  // CSBWin's widths, 24, 24 and 48 bytes (doc/CSBwin-src/Viewport.cpp:7250-7254), are
  // the English words' 48, 48 and 96 pixels. The French 1.3 "NOURRITURE" is 96 wide, as
  // its `wRectPos950` is, so each word is read at its own width
  // (doc/PROVEN_FACTS.md → "The French 1.3 `graphics.dat`: longer words").
  const blitWord = (index: number, rect: Rect): void =>
    blitBasicGraphicToViewport(ui, index, rect, ui.getGraphicBitmap(index)?.width ?? 0, 12);
  blitWord(30, g232.wRectPos950);
  blitWord(31, g232.wRectPos958);
  if (champion.poisonCount !== 0) {
    blitWord(32, g232.wRectPos966);
  }

  drawFoodWaterBar(ui, champion.food ?? 0, 69, 5);
  drawFoodWaterBar(ui, champion.water ?? 0, 92, 14);
}

export function drawAttributePanel(ui: UIState, champion: Champion): void {
  const g232 = ui.uiTables.graphic232;
  blitBasicGraphicToViewport(ui, 20, g232.wRectPos926, 144, 8);

  // `for (D7W=0; D7W<=3; D7W++)` — one line per role, `Smaller(16, mastery)` capped and
  // mastery 1 (no experience at all) left off the panel entirely
  // (`doc/CSBwin-src/Character.cpp:4607-4622`).
  let lineY = 58;
  for (let role = 0; role < ROLE_LABELS.length; role++) {
    const mastery = Math.min(16, getRoleMastery(ui, champion, role));
    if (mastery <= 1) continue;
    const masteryLabel = MASTERY_LABELS[mastery] ?? '';
    if (!masteryLabel) continue;
    drawTextLineIndexRaw(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 108,
      VIEWPORT_Y + lineY,
      // An extra (`DEBT.md` X): a mastery just gained, in the green of an attribute
      // above its maximum, until what it raised has climbed back (`MasteryGains.ts`).
      ui.ctx.extras && masteryGainPending(champion, role) ? 7 : 13,
      null,
      `${masteryLabel} ${ROLE_LABELS[role]}`
    );
    lineY += 7;
  }

  // `for (D7W=1; D7W<=6; D7W++)` — the panel lists attributes 1..6 and never Luck
  // (`doc/CSBwin-src/Character.cpp:4626`). Red when Current has fallen below Maximum,
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
      VIEWPORT_X + 108,
      VIEWPORT_Y + lineY,
      13,
      null,
      ATTRIBUTE_LABELS[i] ?? ''
    );
    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 174,
      VIEWPORT_Y + lineY,
      valueColor,
      null,
      formatLifeValue(current)
    );
    drawTextLineIndex(
      ui.screenIndexBuffer,
      ui.fontData,
      VIEWPORT_X + 192,
      VIEWPORT_Y + lineY,
      13,
      null,
      `/${formatLifeValue(max)}`
    );
    lineY += 7;
  }
}

export function drawVitalsAndLoad(ui: UIState, champion: Champion): void {

  const attrs = champion.attributes;
  const health = attrs?.health ?? 0;
  const maxHealth = attrs?.maxHealth ?? 0;
  const stamina = Math.floor((attrs?.stamina ?? 0) / 10);
  const maxStamina = Math.floor((attrs?.maxStamina ?? 0) / 10);
  const mana = attrs?.mana ?? 0;
  const maxMana = attrs?.maxMana ?? 0;

  const baseX = VIEWPORT_X + 55;
  const slashX = VIEWPORT_X + 73;
  const maxX = VIEWPORT_X + 79;
  const labelX = VIEWPORT_X + 5;
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
    VIEWPORT_X + 104,
    lineMana,
    color,
    null,
    'LOAD'
  );
  drawTextLineIndex(
    ui.screenIndexBuffer,
    ui.fontData,
    VIEWPORT_X + 148,
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
  return ui.ctx.systems.characterStats.characterLoad(champion);
}

/** `MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4318`), in the engine. */
export function computeMaxLoad(ui: UIState, champion: Champion): number {
  return ui.ctx.systems.characterStats.maxLoad(champion);
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

/**
 * A champion's square in the top view of positions: `DrawCharacterState` fills it with
 * the champion's colour and lays the facing arrow, graphic 28, over it
 * (`doc/CSBwin-src/Character.cpp:1463-1481`). `TAG0025a6` makes its cursor of it too.
 */
export function drawPositionSquare(
  ui: UIState,
  dst: PaletteIndexViewportBuffer,
  rect: Rect,
  chIdx: number,
  champion: Champion | null,
  facing: number,
): void {
  fillRectIndex(dst, rect, ui.uiTables.graphic232.byte1386[chIdx] ?? 13);
  const indicator = ui.getGraphicBitmap(28);
  if (!indicator) return;
  const champFacing = champion?.facing ?? facing;
  const srcX = ((champFacing + 4 - facing) & 3) * 19;
  tag0088b2Index(
    indicator,
    dst,
    {
      x1: rect.x1,
      y1: rect.y1,
      x2: rect.x2,
      y2: rect.y2,
      srcX,
      srcY: 0,
      srcStride: indicator.width,
      srcWidth: 19,
      srcHeight: indicator.height,
    },
    12
  );
}

export function drawPartyStatus(ui: UIState): void {

  const g232 = ui.uiTables.graphic232;
  const party = ui.partyState;
  const facing = party.facing | 0;
  const selected = party.selectedCharacterIndex | 0;

  for (let chIdx = 0; chIdx < 4; chIdx++) {
    const baseX = 69 * chIdx;
    // `&d.CH16482[chIdx]` — the champion *index*, which is what indexes the four
    // portrait boxes. Not `charPosition`: that is the corner of the cell they stand in,
    // and it rotates when the party turns while the boxes do not.
    const champion = party.champions[chIdx] ?? null;
    // `DrawAllCharacterState` draws boxes 0..d.NumCharacter-1 only
    // (`doc/CSBwin-src/CSBCode.cpp:6890-6893`), and a box emptied is filled with colour 0
    // (`:6700-6708`, `Character.cpp:5412-5423`): a box with nobody in it stays as black as
    // the cleared screen.
    if (!champion) continue;
    fillRectIndex(
      ui.screenIndexBuffer,
      { x1: baseX, y1: 0, x2: baseX + 66, y2: 28 },
      12
    );

    if (selected !== chIdx) {
      const nameRect = { x1: baseX, y1: 0, x2: baseX + 42, y2: 6 };
      fillRectIndex(ui.screenIndexBuffer, nameRect, 1);
      if (champion) {
        const nameColor = ui.partyState.cursorOwner === chIdx ? 9 : 13;
        drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, baseX + 1, 5, nameColor, 1, champion.name);
      }
      // Under the life bars: `DisplayCharacterDamage` calls `DrawCharacterState`, whose
      // `DrawLifeBars` goes over graphic 15's right edge (`doc/CSBwin-src/CSBCode.cpp:7262`).
      if (champion) drawCharacterDamage(ui, chIdx, champion, false);
    }

    // `if (pcA3->HP() != 0)`, and graphic 8 otherwise (`doc/CSBwin-src/Character.cpp:1266`).
    if (champion && (champion.attributes.health | 0) === 0) {
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

    if (champion && selected === chIdx) {
      const portraitGraphic = getChampionPortrait(ui, champion);
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
      drawCharacterDamage(ui, chIdx, champion, true);
    }

    if (champion && (champion.attributes.health | 0) !== 0) {
      drawShieldDots(ui, baseX, champion);
    }

    // `DrawCharacterState` draws the square inside `if (pcA3->HP() != 0)`, and only for a
    // champion in the party (`doc/CSBwin-src/Character.cpp:1313`, `:1462-1480`): an empty
    // box has none, and `KillCharacter` blanks a dead champion's (`:2669-2672`).
    if (champion && champion.attributes.health !== 0) {
      const dir = (champion.partyPosition + 4 - facing) & 3;
      drawPositionSquare(ui, ui.screenIndexBuffer, g232.wRectPos1454[dir], chIdx, champion, facing);
    }
  }

  // `TAG0025a6` blanks the square it picks a champion up from, and `DrawCharacterState`
  // leaves that square alone until the champion is put down
  // (`doc/CSBwin-src/CSBCode.cpp:2137-2140`, `Character.cpp:1463-1466`).
  if (ui.word23144 !== 0) fillRectIndex(ui.screenIndexBuffer, g232.wRectPos1454[ui.word23144 - 1], 0);

  drawTopBarHandIcons(ui);
}

/**
 * What `DisplayCharacterDamage` blits for a champion who lost HP this tick
 * (`doc/CSBwin-src/CSBCode.cpp:7180-7230`), for as long as it stays on CSBWin's screen.
 * With the champion's inventory open it is graphic 16 over the portrait, at `69*chIdx+7`,
 * and the figure at y 16; otherwise graphic 15 over the name, at `69*chIdx`, and the
 * figure at y 5. Both are masked with colour 10, and the figure is `TAG014af6(damage, 0,
 * 3)` — no leading blanks, at most 9999 — in colour 15 on 8, moved left by three
 * pixels for each digit past the first.
 *
 * Anything that redraws the name or the portrait takes it away before its `TT_12`:
 * death (`KillCharacter` blits graphic 8 over the box), and opening or closing the
 * inventory, whose `CHARFLAG_portraitChanged` fills the box afresh. Those two are why a
 * readout drawn in the other mode, or on a dead champion, is dropped here. CSBWin's other
 * redraws of the name or the box are `drawCharacterState`'s.
 */
function drawCharacterDamage(ui: UIState, chIdx: number, champion: Champion, inventoryOpen: boolean): void {
  const shown = ui.characterDamage[chIdx];
  if (!shown) return;
  if ((champion.attributes.health | 0) === 0 || shown.inventoryOpen !== inventoryOpen) {
    ui.characterDamage[chIdx] = null;
    return;
  }
  const damage = shown.damage;
  let x = 69 * chIdx;
  let y: number;
  let rect: { x1: number; y1: number; x2: number; y2: number };
  let graphicNum: number;
  if (inventoryOpen) {
    rect = { x1: x + 7, y1: 0, x2: x + 7 + 31, y2: 28 };
    graphicNum = 16;
    x += damage < 10 ? 21 : damage < 100 ? 18 : 15;
    y = 16;
  } else {
    rect = { x1: x, y1: 0, x2: x + 47, y2: 6 };
    graphicNum = 15;
    x += damage < 10 ? 19 : damage < 100 ? 16 : 13;
    y = 5;
  }
  const graphic = ui.getGraphicBitmap(graphicNum);
  if (graphic) {
    tag0088b2Index(
      graphic,
      ui.screenIndexBuffer,
      {
        ...rect,
        srcX: 0,
        srcY: 0,
        srcStride: graphic.width,
        srcWidth: graphic.width,
        srcHeight: graphic.height,
      },
      10
    );
  }
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x, y, 15, 8, String(Math.min(damage, 9999)));
}

/**
 * What `DrawCharacterState` (`doc/CSBwin-src/Character.cpp:1234`) draws over the damage
 * shown, for the flags the engine hands the host. `CHARFLAG_portraitChanged` fills the
 * whole box, x `69*chIdx` to +66 by y 0 to 28, and draws the portrait or the name back
 * (`:1260-1312`). `CHARFLAG_cursor` fills the name's rectangle, x to +42 by y 0 to 6,
 * when the champion's inventory is closed (`:1348-1360`); the five columns of graphic 15
 * to its right are colour 10, which the blit leaves out. With the inventory open the
 * name goes into the viewport (`:1327-1344`) and the figure over the portrait stays.
 * Everything else those flags draw, the screen draws on every frame.
 */
export function drawCharacterState(ui: UIState, chIdx: number, charFlags: number): void {
  const inventoryOpen = ui.partyState.selectedCharacterIndex === chIdx;
  if ((charFlags & CHARFLAG_PORTRAIT_CHANGED) !== 0
    || ((charFlags & CHARFLAG_CURSOR) !== 0 && !inventoryOpen)) {
    ui.characterDamage[chIdx] = null;
  }
}

export function drawShieldDots(ui: UIState, baseX: number, champion: Champion): void {
  const shields: number[] = [];
  const fireShield = ui.partyState.fireShield;
  const spellShield = ui.partyState.spellShield;
  const partyShield = ui.partyState.partyShield;
  const personalShield = champion.shieldStrength;

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

/**
 * `&d.CH16482[chIdx].portrait` — the picture `CharacterPortraitToStatusBox` blits
 * (`doc/CSBwin-src/Character.cpp:4661`).
 *
 * A champion read from a genuine CSBWin save carries the pixels themselves, because
 * that is all `CHARDESC` holds; one this engine created carries the `charID`
 * `AddCharacter` would have blitted from, because the engine has no graphics of its
 * own. Prefer the pixels: they are the faithful field.
 */
export function getChampionPortrait(ui: UIState, champion: Champion): IndexedBitmap | null {
  const pixels = champion.portrait;
  if (pixels && pixels.length === PORTRAIT_WIDTH * PORTRAIT_HEIGHT) {
    const cached = ui.championPortraitCache.get(pixels);
    if (cached) return cached;
    const bmp: IndexedBitmap = {
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      pixels: Uint8Array.from(pixels),
    };
    ui.championPortraitCache.set(pixels, bmp);
    return bmp;
  }
  if (typeof champion.portraitGraphic === 'number') {
    return getPortraitBitmap(ui, champion.portraitGraphic);
  }
  return null;
}

/**
 * The portrait `AddCharacter` copies for `charID` (`doc/CSBwin-src/Character.cpp:485-509`):
 * a cell of basic graphic 26 up to 23, and `GetExternalPortraitAddress`'s past it.
 */
export function getPortraitBitmap(ui: UIState, portraitIndex: number): IndexedBitmap | null {
  if (portraitIndex < 0) return null;
  if (portraitIndex > 23) return getExternalPortraitAddress(ui.context.csbGraphics, portraitIndex);
  const cached = ui.portraitCache.get(portraitIndex);
  if (cached) return cached;

  const sheet = getPortraitSheet(ui);
  if (!sheet) return null;

  const w = PORTRAIT_WIDTH;
  const h = PORTRAIT_HEIGHT;
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
  if (img1 && img1.width >= PORTRAIT_WIDTH && img1.height >= PORTRAIT_HEIGHT) {
    ui.portraitSheet = img1;
    return img1;
  }
  const img2 = ui.getGraphicBitmap(26, ImageFormat.IMG2);
  if (img2 && img2.width >= PORTRAIT_WIDTH && img2.height >= PORTRAIT_HEIGHT) {
    ui.portraitSheet = img2;
    return img2;
  }
  ui.portraitSheet = null;
  return null;
}

export function drawTopBarHandIcons(ui: UIState): void {
  const iconSlots = ui.uiTables.graphic232.iconDisplay;
  const word612 = ui.uiTables.graphic232.word612;
  const selected = ui.partyState.selectedCharacterIndex | 0;

  for (let chIdx = 0; chIdx < 4; chIdx++) {
    const champion = ui.partyState.champions[chIdx] ?? null;
    if (!champion || (champion.attributes.health | 0) === 0) continue;
    if (selected === chIdx) continue;

    for (let hand = 0; hand <= 1; hand++) {
      const slot = 2 * chIdx + hand;
      const icon = iconSlots[slot];
      if (!icon) continue;

      const rect = { x1: icon.pixelX, y1: icon.pixelY, x2: icon.pixelX + 15, y2: icon.pixelY + 15 };
      drawPossessionBox(ui, rect, possessionBoxGraphic(ui, chIdx, champion, hand));
      const held = champion ? getChampionPossession(champion, hand) : OBJECT_ID_NULL;
      const objectNameIndex = held === OBJECT_ID_NULL ? -1 : resolveObjectNameIndex(ui, held);

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
  // `if (pcA3->HP() > 0)` (`doc/CSBwin-src/Character.cpp:921`).
  if ((champion.attributes.health | 0) <= 0) return;
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

/**
 * `DrawNameOfHeldObject` (`doc/CSBwin-src/Code11f52.cpp:65`) — the 14-character line
 * above the action area naming whatever the cursor is carrying.
 *
 * Two details are the function, not decoration. The index is `RN::NameIndex()`, the
 * *resolved* one, so a compass reads the way the party faces and a lit torch reads its
 * burn state. And bones carry the dead champion's name in front, "NAME BONES", through
 * the same lookup and `DescribeChampionBones` the eye's object panel uses
 * (`heldObjectName`) — which is the only place a player ever learns whose remains they
 * picked up.
 */
export function drawHeldObjectName(ui: UIState): void {
  if (ui.pressingEye && ui.partyState.objectInHand !== OBJECT_ID_NULL) {
    // `_ClickOnEye`'s `ClearHeldObjectName` (`doc/CSBwin-src/Viewport.cpp:7291`), until
    // the release's `DrawNameOfHeldObject` (`doc/CSBwin-src/CSBCode.cpp:7468-7471`).
    fillRectIndex(ui.screenIndexBuffer, ui.uiTables.graphic232.wRectPos624, 0);
    return;
  }
  const objectNames = ui.objectTables.objectNames;
  if (!objectNames || objectNames.length === 0) return;

  const objectId = ui.partyState.objectInHand;
  const label = objectId !== OBJECT_ID_NULL ? heldObjectName(ui, objectId as ObjectID) : '';

  const padded = (label || '').padEnd(14, ' ').slice(0, 14);
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 0xe9, 0x25, 4, 0, padded);
}

/**
 * The name `DrawNameOfHeldObject` prints for `objectId`: its resolved name, and for a
 * champion's bones `DescribeChampionBones` over it
 * (`doc/CSBwin-src/Code11f52.cpp:72-100`).
 */
export function heldObjectName(ui: UIState, objectId: ObjectID): string {
  const nameIndex = resolveObjectNameIndex(ui, objectId);
  const name = ui.objectTables.objectNames[nameIndex] ?? '';
  const owner = getBonesChampion(ui, objectId, nameIndex);
  return owner?.name ? describeChampionBones(owner.name, name) : name;
}

export function canPlaceInSlot(ui: UIState, objectId: number, slot: number): boolean {
  const descIndex = descIndexForObject(ui, objectId as ObjectID);
  if (descIndex === null) return true;
  const carryMask = ui.objectTables.objDescWord4[descIndex] ?? 0;
  const slotMask = ui.uiTables.graphic232.carryLocation[slot] ?? 0;
  return (carryMask & slotMask) !== 0;
}

export function getInventoryItemIndex(ui: UIState, champion: Champion, slot: number): number {
  const value = getChampionPossession(champion, slot);
  return value === OBJECT_ID_NULL ? -1 : resolveObjectNameIndex(ui, value);
}

