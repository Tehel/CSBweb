/**
 * The spell panel.
 *
 * The UI half of CSBWin `doc/CSBwin-src/Magic.cpp`: the rune keypad, the incantation being
 * assembled, and its running mana cost. Casting itself lives in the engine —
 * `applyMagicSelection` only assembles the incantation and hands it to `ui.onSpellCast`.
 * The attack buttons and the attack menu live in `ui/Attack.ts`, beside the rest of the
 * `Character.cpp` port.
 */
import { fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import { Rect } from '../csbwin/UITables';
import { pointInRect, searchButtonList } from './HitTest';
import { UIState } from './UIState';

export function spellControlGetRect(base: Rect, chIdx: number, casterIdx: number): Rect {
    const isCaster = chIdx === casterIdx;
    const isAfterCaster = chIdx > casterIdx;
    const x = base.x1 + chIdx * 14 + (isAfterCaster ? 33 : 0);
    return {
      x1: x,
      x2: x + (isCaster ? 44 : 11),
      y1: base.y1,
      y2: base.y2 - (isCaster ? 0 : 1)
    };
}

export function drawSpellControls(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.partyState) return;

  const rect = ui.uiTables.graphic230.word20242;
  const screen = ui.screenIndexBuffer;
  const font = ui.fontData;
  const casterIdx = ui.partyState.magicCasterIndex;
  fillRectIndex(screen, rect, 0);

  ui.partyState.champions.forEach((champion, chIdx) => {
    if (!champion || !champion.alive || champion.attributes.maxMana === 0) return;
    const rct = spellControlGetRect(rect, chIdx, casterIdx);
    fillRectIndex(screen, rct, 4);
    if (chIdx === casterIdx) {
      drawTextLineIndex(screen, font, rct.x1 + 2, rect.y2 - 1, 0, 4, champion.name);
    }
  });
}

export function drawSpellPanel(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.partyState) return;

  const rect = ui.uiTables.graphic232.word12;

  fillRectIndex(ui.screenIndexBuffer, rect, 0);
  if (ui.partyState.magicCasterIndex < 0) return;

  let panelGraphic = ui.getGraphicBitmap(9);
  if (panelGraphic) {
    tag0088b2Index(
      panelGraphic,
      ui.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 0,
        srcStride: panelGraphic.width,
        srcWidth: panelGraphic.width,
        srcHeight: panelGraphic.height,
      },
      -1
    );
  }

  const panelOverlay = ui.getGraphicBitmap(11);
  if (panelOverlay) {
    tag0088b2Index(
      panelOverlay,
      ui.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 4,
        srcStride: panelOverlay.width,
        srcWidth: panelOverlay.width,
        srcHeight: panelOverlay.height,
      },
      0
    );
  }

  const caster = ui.partyState.champions[ui.partyState.magicCasterIndex];
  if (!caster || caster.alive === false) return;

  drawSpellMenuCharacters(ui, caster.incantation.length);
  drawMagicIncantation(ui, caster.incantation);
}

export function drawSpellMenuCharacters(ui: UIState, step: number): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  const y = 58;
  for (let i=0; i<6; i++) {
    const x = 224 + 14 * (i + 1);
    const ch = String.fromCharCode(96 + 6 * Math.min(step, 3) + i);
    drawTextLineIndexRaw(ui.screenIndexBuffer, ui.fontData, x, y, 4, 0, ch);
  }
}

export function drawMagicIncantation(ui: UIState, incantation: number[]): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  const y = 70;
  for (let i=0; i<4; i++) {
    const x = 231 + 9 * (i + 1);
    const ch = (i >= incantation.length) ? ' ' : String.fromCharCode(incantation[i]);
    drawTextLineIndexRaw(ui.screenIndexBuffer, ui.fontData, x, y, 4, 0, ch);
  }
}

export function applyMagicSelection(ui: UIState, buttonId: number): void {
  if (!ui.partyState || !ui.uiTables) return;
  if (buttonId < 101 || buttonId > 108) return;

  const casterIdx = ui.partyState.magicCasterIndex;
  if (casterIdx < 0) return;

  const champion = ui.partyState.champions[casterIdx];
  if (!champion || champion.alive === false) return;

  // buttons: magic runes (101-106), back (107), cast (108)

  // Back
  if (buttonId === 107) {
    if (champion.incantation.length === 0) return;
    champion.incantation.pop();
    return;
  }

  // Cast
  if (buttonId === 108) {
    if (champion.incantation.length === 0) return;
    const totalManaCost = computeIncantationManaCost(
      champion.incantation,
      ui.uiTables.graphic230.spellBaseMana,
      ui.uiTables.graphic230.spellFirstRuneScale,
    );
    const chIdx = ui.partyState.champions.indexOf(champion);
    let result: number | void = undefined;
    if (chIdx >= 0) {
      result = ui.onSpellCast?.(chIdx, [...champion.incantation], totalManaCost);
    }
    if (result !== 3) {
      champion.incantation = [];
    }
    return;
  }

  // baseMana: [ 1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7, 7, 9, 2, 2, 3, 4, 6, 7 ]
  // scaleMana: [ 8, 12, 16, 20, 24, 28 ] ( = [ x1, x1.5, x2, x2.5, x3, x3.5 ])

  // Add rune
  const step = champion.incantation.length;
  if (step > 3) return;

  const runeId = buttonId - 101;
  const baseMana = ui.uiTables.graphic230.spellBaseMana; // number[24]
  const scaleMana = ui.uiTables.graphic230.spellFirstRuneScale; // number[6]

  // compute mana cost: rune base cost * [1, 1.5, 2, 2.5, 3, 3.5][firstRune]
  let manaCost = baseMana[step * 6 + runeId];
  if (step > 0) manaCost = (manaCost * scaleMana[(champion.incantation[0] - 96)]) / 8;
  if (champion.attributes.mana < manaCost) return;

  // apply cost en enqueue rune
  champion.attributes.mana -= manaCost;
  champion.incantation.push(96 + step * 6 + runeId);
}

export function computeIncantationManaCost(incantation: number[], baseMana: number[], scaleMana: number[]): number {
  if (incantation.length === 0) return 0;
  const powerIndex = Math.max(0, Math.min(5, (incantation[0] ?? 96) - 96));
  let total = 0;
  for (let step = 0; step < incantation.length; step++) {
    const value = incantation[step] ?? 96;
    const runeId = value - 96 - step * 6;
    if (runeId < 0 || runeId > 5) continue;
    let cost = baseMana[step * 6 + runeId] ?? 0;
    if (step > 0) {
      cost = Math.floor((cost * (scaleMana[powerIndex] ?? 0)) / 8);
    }
    total += cost;
  }
  return total;
}

export function handleMagicClick(ui: UIState, clickX: number, clickY: number): void {
  if (!ui.uiTables || !ui.partyState) return;

  const rect = ui.uiTables.graphic230.word20242;
  for (const champion of ui.partyState.champions) {
    if (!champion || !champion.alive || champion.attributes?.maxMana === 0) continue;
    const rct = spellControlGetRect(rect, champion.partyPosition, ui.partyState.magicCasterIndex);
    if (pointInRect(clickX, clickY, rct)) {
      ui.partyState.magicCasterIndex = champion.partyPosition;
      break;
    }
  }

  const magicButton = searchButtonList(ui.uiTables.graphic231.buttons.buttons18060, clickX, clickY, 2);
  if (magicButton !== 0) {
    applyMagicSelection(ui, magicButton);
  }
}
