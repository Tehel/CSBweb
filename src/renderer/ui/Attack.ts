/**
 * The attack menu.
 *
 * The UI half of the champion's attack, from `doc/CSBwin-src/Character.cpp`:
 * `ItemHasChargesLeft` (`:4762`), `GetLegalAttackTypes` (`:4789`), `DrawAttackButton`
 * (`:4832`), `PrepareAttack` (`:4929`), `_ExecuteAttack` (`:4969`) and `_TAG019fac`
 * (`:4678`), plus the drawing of `TAG01b1c0` (`:4904`), `DrawLegalAttackTypes`
 * (`doc/CSBwin-src/CSBCode.cpp:8823`) and `_FlashAttackDamage`
 * (`doc/CSBwin-src/Attack.cpp:949`), whose `d.` work, with `_TAG01b29a`'s, is the
 * engine's (`src/engine/AttackMenu.ts`).
 *
 * The area under the viewport is a two-state panel and `word20252` is the state:
 *
 *  - **1** — the four attack buttons, one per champion, each showing the weapon in its
 *    fighting hand. Clicking one calls `prepareAttack`.
 *  - **0** — that champion's legal attack options, up to three of them, named. Clicking
 *    one calls `executeAttack`, which is where the engine's `Attack` is entered.
 *
 * `word20250` is "the panel owes a redraw", and the engine's `tag01b29a` — called once per
 * game tick — is what acts on it. It is also where the damage figure is flashed over the
 * panel before the buttons come back.
 *
 * ⚠️ One deliberate divergence: CSBWin's `_FlashAttackDamage` ends in `VBLDelay(15)`, a
 * quarter-second in which the whole game is stopped, and the next tick, due by then,
 * draws the buttons over it. A browser cannot block the frame loop, so the flash is timed
 * instead — `attackFlashUntilMs`, which `attackFlashHeld` reads for the host — and
 * `tag01b29a` brings the buttons back no sooner than it runs out; the game keeps running
 * underneath, as it already does for the feeding
 * animation. The author's decision is a longer flash, `FLASH_MS`, for the text to be
 * read (`DEBT.md` H). The figure stays up after the flash, as CSBWin's does, until
 * `DrawLegalAttackTypes` draws over it.
 */
import { OBJNI_SPECIAL_C } from '../../core/objectNameIndex';
import { DBType, OBJECT_ID_NULL } from '../../core/types';
import { drawLegalAttackTypes, tag01b1c0 } from '../../engine/AttackMenu';
import type { AttackOptions } from '../../engine/GameHost';
import { ATTACK_TYPE_NONE, ATTACK_CLASS_EMPTY_HAND } from '../../engine/monsterTypes';
import { getPartyChampion } from '../../engine/Party';
import { CHARFLAG_ATTACK_DISABLE, getChampionPossession, SLOT_WEAPON_HAND } from '../../core/charDesc';
import { isAlive, masteryOf } from '../../engine/rules';
import { flashButton, setClockTick } from '../../engine/LoopState';
import { fillRectIndex, shrinkBlt, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, textOutToScreenCentered } from '../csbwin/TextRenderer';
import { Rect } from '../../data/tables/UITables';
import { drawObjectIconMask, shadeRectIndex } from './Draw';
import { searchButtonList } from './HitTest';
import { getAttackClass, getBaseObjectNameIndex } from './Objects';
import { nowMs, UIState } from './UIState';

/**
 * How long the flash holds the buttons back. CSBWin's is `VBLDelay(15)`, a quarter of a
 * second; the author's choice is 400 ms, over one tick of 15 VBLs and under two, so the
 * damage is up for two ticks whatever the jitter of the wall clock against the VBLs.
 */
export const FLASH_MS = 400;

/** `DrawAttackButton`'s rectangle for champion `chIdx` (`Character.cpp:4837`). */
export function attackButtonRect(chIdx: number): Rect {
  const x1 = 22 * chIdx + 233;
  return { x1, y1: 86, x2: x1 + 19, y2: 120 };
}

/**
 * `ItemHasChargesLeft` (`doc/CSBwin-src/Character.cpp:4762`).
 *
 * Whether the thing in the fighting hand still has a charge to spend. Anything that is
 * not a weapon, a garment or a misc object counts as ready — CSBWin's `default: return
 * 1` — so an attack option gated on charges is never hidden by an object that has no
 * charge field at all.
 */
function itemHasChargesLeft(ui: UIState, chIdx: number): boolean {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  if (!champ) return true;
  const rn = getChampionPossession(champ, SLOT_WEAPON_HAND);
  if (rn === OBJECT_ID_NULL) return true;
  switch (ui.ctx.dungeon.rnMaps.dbType(rn)) {
    case DBType.WEAPON:
      return (ui.ctx.dungeon.getWeaponRecord(rn)?.charges ?? 0) !== 0;
    case DBType.CLOTHING:
      return (ui.ctx.dungeon.getClothingRecord(rn)?.charges ?? 0) !== 0;
    case DBType.MISC:
      return (ui.ctx.dungeon.getMiscRecord(rn)?.specialState ?? 0) !== 0;
    default:
      return true;
  }
}

/**
 * `GetLegalAttackTypes` (`doc/CSBwin-src/Character.cpp:4789`).
 *
 * An object's `legalAttacks` row holds three attack types and, for the second and
 * third, the mastery they demand. The first is *always* offered — that is what makes
 * every weapon usable by anybody — and the other two appear only if the champion is
 * good enough with the relevant skill, and if bit 7 of the requirement is set, only
 * while the object still has charges.
 */
export function getLegalAttackTypes(ui: UIState, chIdx: number, row: ArrayLike<number>): void {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  ui.ctx.interface.possibleAttackTypes[0] = row[0] ?? 0;
  ui.ctx.interface.byte20256[0] = 1;

  let count = 1;
  for (let i = 1; i < 3; i++) {
    const attackType = row[i] ?? 255;
    if (attackType === 255) continue;
    let required = row[i + 3] ?? 0;
    if ((required & 128) !== 0) {
      if (!itemHasChargesLeft(ui, chIdx)) continue;
    }
    required &= 0x7f;
    const skill = (ui.uiTables.graphic230.skillNumber[attackType] ?? 0) & 0xff;
    const mastery = champ ? masteryOf(ui.ctx, champ, skill) : 0;
    if (mastery < required) continue;
    ui.ctx.interface.possibleAttackTypes[count] = attackType;
    ui.ctx.interface.byte20256[count] = required;
    count++;
  }
  ui.ctx.interface.word20248 = count;
  for (let i = count; i < 3; i++) ui.ctx.interface.possibleAttackTypes[i] = -1;
}

/**
 * `PrepareAttack` (`doc/CSBwin-src/Character.cpp:4929`) — open the attack menu for one
 * champion, unless they are busy or dead (`:4941`).
 *
 * An empty fighting hand still has attacks: attack class 2, which is the bare-handed
 * row. A held object whose attack class is 0 has none at all and the click is ignored.
 */
export function prepareAttack(ui: UIState, chIdx: number): void {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  if (!champ) return;
  if ((champ.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0) return;
  if (!isAlive(champ)) return;

  const weapon = getChampionPossession(champ, SLOT_WEAPON_HAND);
  let attackClass: number;
  if (weapon === OBJECT_ID_NULL) {
    attackClass = ATTACK_CLASS_EMPTY_HAND;
  } else {
    attackClass = getAttackClass(ui, weapon) & 0xff;
    if (attackClass === 0) return;
  }

  const row = ui.uiTables.graphic230.legalAttacks[attackClass];
  if (!row) return;

  ui.ctx.interface.attackingCharacterOrdinal = chIdx + 1;
  getLegalAttackTypes(ui, chIdx, row);
  ui.ctx.interface.word20252 = 0;
  drawLegalAttackTypes(ui.ctx);
}

/**
 * `DrawLegalAttackTypes`'s drawing (`doc/CSBwin-src/CSBCode.cpp:8823`), the host's
 * `drawLegalAttackTypes`, once the engine has named the options (`drawLegalAttackTypes`,
 * `src/engine/AttackMenu.ts`): the panel shows what `word20252` and the ordinal say,
 * which `drawAttackPanel` composes each frame, so a menu `TAG01b1c0` closed and the
 * damage figure are off the screen. The option list's names are kept as CSBWin draws
 * them, once (`:8848-8894`).
 */
export function drawLegalAttackTypesDrawing(ui: UIState, options: AttackOptions | null): void {
  ui.closedAttackMenuOrdinal = 0;
  ui.attackFlashValue = 0;
  ui.attackFlashUntilMs = 0;
  if (!options) return;
  ui.attackOptionCount = options.count;
  for (let i = 0; i < 3; i++) ui.attackOptionNames[i] = options.names[i]!;
}

/**
 * `TAG01b1c0`'s drawing (`doc/CSBwin-src/Character.cpp:4904`), the host's `tag01b1c0`,
 * before the engine closes champion `chIdx`'s menu (`tag01b1c0`,
 * `src/engine/AttackMenu.ts`). It draws nothing on the panel, so the menu stays on the
 * screen until `TAG01b29a` draws the damage or the buttons over it. Its redraw of the
 * attacker's hands is the frame's, which no longer boxes the weapon hand in cyan
 * (`possessionBoxGraphic`).
 */
export function tag01b1c0Drawing(ui: UIState, chIdx: number): void {
  ui.closedAttackMenuOrdinal = chIdx + 1;
}

/**
 * `_ExecuteAttack` (`doc/CSBwin-src/Character.cpp:4969`).
 *
 * `option` is 0-2 for one of the listed attacks, or -1 for the PASS button, which
 * closes the menu without attacking and returns CSBWin's -1.
 */
export function executeAttack(ui: UIState, option: number): number {
  if (ui.ctx.interface.attackingCharacterOrdinal === 0) return 0;
  const chIdx = ui.ctx.interface.attackingCharacterOrdinal - 1;
  let result: number;
  if (option === -1) {
    result = -1;
  } else {
    const attackType = ui.ctx.interface.possibleAttackTypes[option]! & 0xff;
    if (attackType === ATTACK_TYPE_NONE) return 0;
    result = ui.ctx.systems.character.executeAttack(chIdx, attackType);
    // The fusion's `Attack(_1_, …)` never returns (`Character.cpp:4997`): `_FusionSequence`
    // ends in `ShowCredits` (`Attack.cpp:2431`), so `TAG01b1c0` does not run and the menu
    // stays on the panel to the end of the game.
    if (ui.ctx.systems.mainLoop.isRunningScript()) return result;
  }
  tag01b1c0(ui.ctx);
  return result;
}

/**
 * One of the listed attacks (0-2) taken, by a click or its key: `ExecuteAttack`, then
 * `d.clockTick = (i16)intResult` (`doc/CSBwin-src/Character.cpp:4733-4734`), so an attack
 * makes a tick due and a 0 puts one off. The fusion's `ExecuteAttack(_6_, …)` does not
 * return to set it.
 */
export function takeAttackOption(ui: UIState, option: number): void {
  const result = executeAttack(ui, option);
  if (!ui.ctx.systems.mainLoop.isRunningScript()) setClockTick(ui.ctx, result);
}

/**
 * `_TAG019fac`'s half with the menu open (`doc/CSBwin-src/Character.cpp:4694-4734`): button
 * `id` of `d.Buttons17892`, 112 for PASS and 113-115 for the options. Each is flashed
 * before its `ExecuteAttack`.
 */
export function attackMenuButton(ui: UIState, id: number): void {
  if (id === 112) {
    flashButton(ui.ctx, 0x11d, 0x13f, 0x4d, 0x53);
    executeAttack(ui, -1); // PASS, which leaves `d.clockTick` alone
    return;
  }
  // Only the options actually offered are live; the rows below `word20248` are dead
  // even though the button list covers them.
  if (id - 112 > ui.ctx.interface.word20248) return;
  if (id === 113) flashButton(ui.ctx, 0xea, 0x13e, 0x56, 0x60);
  else if (id === 114) flashButton(ui.ctx, 0xea, 0x13e, 0x62, 0x6c);
  else flashButton(ui.ctx, 0xea, 0x13e, 0x6e, 0x78);
  takeAttackOption(ui, id - 113);
}

/**
 * `_TAG019fac` (`doc/CSBwin-src/Character.cpp:4678`) — button 111, the panel area.
 *
 * Which button list is consulted depends on the panel's state, so the same screen
 * region means "pick a champion" or "pick an attack" at different moments.
 */
export function handleAttackAreaClick(ui: UIState, x: number, y: number): void {
  const numCharacter = ui.partyState.champions.length;

  if (ui.ctx.interface.attackingCharacterOrdinal !== 0) {
    const id = searchButtonList(ui.uiTables.graphic231.buttons.buttons17892, x, y, 2);
    if (id !== 0) attackMenuButton(ui, id);
    return;
  }

  if (ui.ctx.interface.word20252 !== 0) {
    const id = searchButtonList(ui.uiTables.graphic231.buttons.buttons17952, x, y, 2);
    if (id === 0) return;
    const chIdx = id - 116;
    if (chIdx >= 0 && chIdx < numCharacter) prepareAttack(ui, chIdx);
  }
}

/**
 * `FlashAttackDamage`'s drawing (`doc/CSBwin-src/Attack.cpp:949`), the host's
 * `flashAttackDamage`, from the engine's `tag01b29a`: the figure up, and the buttons held
 * back for `FLASH_MS` (`attackFlashHeld`).
 */
export function flashAttackDamageDrawing(ui: UIState, damage: number): void {
  ui.attackFlashValue = damage;
  ui.attackFlashUntilMs = nowMs() + FLASH_MS;
  ui.closedAttackMenuOrdinal = 0;
}

/** Whether the flash still holds the buttons back: the host's `attackFlashHeld`. */
export function attackFlashHeld(ui: UIState): boolean {
  return ui.attackFlashUntilMs > nowMs();
}

/**
 * `DrawAttackButton` (`doc/CSBwin-src/Character.cpp:4832`).
 *
 * A dead champion's button is a black hole rather than a blue box; a living one shows
 * the icon of whatever it is fighting with, or the bare-fist icon for an empty hand. An
 * object that *is* held but has no attacks leaves the box empty. The box is shaded when
 * the champion is mid-action, while a champion at a Hall of Champions mirror has not yet
 * been resurrected, reincarnated or cancelled, or while the party sleeps.
 */
export function drawAttackButton(ui: UIState, chIdx: number): void {
  const rect = attackButtonRect(chIdx);
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  const alive = !!champ && isAlive(champ);

  if (!alive) {
    fillRectIndex(ui.screenIndexBuffer, rect, 0);
    return;
  }

  fillRectIndex(ui.screenIndexBuffer, rect, 4);
  const weapon = getChampionPossession(champ, SLOT_WEAPON_HAND);
  let iconIndex = -1;
  if (weapon === OBJECT_ID_NULL) {
    iconIndex = OBJNI_SPECIAL_C; // the empty fist
  } else if (getAttackClass(ui, weapon) !== 0) {
    iconIndex = getBaseObjectNameIndex(ui, weapon);
  }
  if (iconIndex >= 0) {
    drawObjectIconMask(
      ui,
      { x1: rect.x1 + 2, y1: 95, x2: rect.x2 - 2, y2: 110 },
      iconIndex,
      ui.uiTables.graphic232.word612,
      ui.uiTables.graphic230.shrinkColorMap,
    );
  }

  // `Character.cpp:4892-4897`: busy, a candidate in the party, or asleep.
  const busy = (champ.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0;
  const candidate = ui.partyState.potentialChampionIndex >= 0;
  if (busy || candidate || (ui.partyState.sleeping)) {
    shadeRectIndex(ui, rect, 0);
  }
}

/**
 * `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8823`) — the whole panel, either
 * state.
 *
 * The backdrop rectangle for the option list depends on how many options there are, so
 * a weapon with one attack gets a short box and one with three a tall one.
 */
export function drawAttackPanel(ui: UIState): void {

  fillRectIndex(ui.screenIndexBuffer, ui.uiTables.graphic232.word20, 0);

  // The damage stays up after its flash, until `DrawLegalAttackTypes` draws over it.
  if (ui.attackFlashValue !== 0) {
    drawAttackDamageFlash(ui);
    return;
  }

  if (ui.ctx.interface.word20252 !== 0) {
    for (let chIdx = 0; chIdx < ui.partyState.champions.length; chIdx++) {
      drawAttackButton(ui, chIdx);
    }
    return;
  }

  // A closed menu is still what CSBWin's screen shows (`tag01b1c0Drawing`).
  const ordinal = ui.ctx.interface.attackingCharacterOrdinal || ui.closedAttackMenuOrdinal;
  if (ordinal === 0) return;
  const champ = getPartyChampion(ui.partyState, ordinal - 1);
  if (!champ) return;

  const backdrop = ui.attackOptionCount === 3 ? ui.uiTables.graphic230.wRectPos20202
    : ui.attackOptionCount === 2 ? ui.uiTables.graphic230.wRectPos20210
      : ui.uiTables.graphic230.wRectPos20218;

  const panelGraphic = ui.getGraphicBitmap(10);
  if (panelGraphic) {
    tag0088b2Index(
      panelGraphic,
      ui.screenIndexBuffer,
      {
        x1: backdrop.x1,
        y1: backdrop.y1,
        x2: backdrop.x2,
        y2: backdrop.y2,
        srcX: 0,
        srcY: 0,
        srcStride: panelGraphic.width,
        srcWidth: panelGraphic.width,
        srcHeight: panelGraphic.height,
      },
      -1,
    );
  }

  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 235, 83, 0, 4, champ.name);
  // CSBWin draws all three rows regardless; the ones past `numAttackOption` come out
  // blank because `GetAttackTypeName(-1)` is the empty string.
  for (let i = 0; i < 3; i++) {
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 241, 12 * i + 93, 4, 0, ui.attackOptionNames[i]!);
  }
}

/**
 * `_FlashAttackDamage` (`doc/CSBwin-src/Attack.cpp:949`).
 *
 * Three sizes of starburst by how hard the blow landed — over 40, over 15, and the
 * rest — with the number written across it. Two negative values are messages instead:
 * -1 could not reach, -2 had no ammunition.
 */
function drawAttackDamageFlash(ui: UIState): void {
  const damage = ui.attackFlashValue;

  if (damage < 0) {
    // `D5W = 224+48` for both (`doc/CSBwin-src/Attack.cpp:972-980`).
    const text = damage === -1 ? "CAN'T REACH" : 'NEED AMMO';
    textOutToScreenCentered(ui.screenIndexBuffer, ui.fontData, 224 + 48, 100, 4, 0, text);
    return;
  }

  // The big burst is graphic 14 as it is; the two smaller ones are it shrunk to 64x37
  // and 42x37 (`ShrinkBLT(A2, A3, 96, 45, D5W, 37, …)`, `:1011`), each blitted whole
  // into a rectangle of its own width.
  const source = ui.getGraphicBitmap(14);
  const [rect, graphic] = damage > 40
    ? [ui.uiTables.graphic230.wRectPos20202, source]
    : damage > 15
      ? [ui.uiTables.graphic230.wRectPos20226, source && shrinkBlt(source, 96, 45, 64, 37)]
      : [ui.uiTables.graphic230.wRectPos20234, source && shrinkBlt(source, 96, 45, 42, 37)];
  if (graphic) {
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
      -1,
    );
  }

  // CSBWin writes the digits right to left from x=274, stepping 3 pixels a digit, so
  // the number ends up centred on the burst whatever its width.
  const digits = String(damage);
  const x = 274 - 3 * digits.length;
  drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x, 100, 4, 0, digits);
}
