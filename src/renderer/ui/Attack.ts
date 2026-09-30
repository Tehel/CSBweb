/**
 * The attack menu.
 *
 * The UI half of the champion's attack, from `doc/CSBwin-src/Character.cpp`:
 * `ItemHasChargesLeft` (`:4745`), `GetLegalAttackTypes` (`:4772`), `DrawAttackButton`
 * (`:4815`), `TAG01b1c0` (`:4886`), `PrepareAttack` (`:4904`), `_ExecuteAttack`
 * (`:4944`), plus `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8718`),
 * `_TAG019fac` (`doc/CSBwin-src/Character.cpp:4661`), `_TAG01b29a`
 * (`doc/CSBwin-src/CSBCode.cpp:8799`) and `_FlashAttackDamage`
 * (`doc/CSBwin-src/Attack.cpp:949`).
 *
 * The area under the viewport is a two-state panel and `word20252` is the state:
 *
 *  - **1** — the four attack buttons, one per champion, each showing the weapon in its
 *    fighting hand. Clicking one calls `prepareAttack`.
 *  - **0** — that champion's legal attack options, up to three of them, named. Clicking
 *    one calls `executeAttack`, which is where the engine's `Attack` is entered.
 *
 * `word20250` is "the panel owes a redraw", and `tag01b29a` — called once per game tick
 * — is what acts on it. It is also where the damage figure is flashed over the panel
 * before the buttons come back.
 *
 * ⚠️ One deliberate divergence: CSBWin's `_FlashAttackDamage` ends in `VBLDelay(15)`, a
 * quarter-second in which the whole game is stopped. A browser cannot block the frame
 * loop, so the flash is timed instead — `attackFlashUntilMs` — and `tag01b29a` brings
 * the buttons back no sooner than it runs out. Same duration, same appearance; the game
 * simply keeps running underneath, as it already does for the feeding animation. The
 * figure stays up after the flash, as CSBWin's does, until `DrawLegalAttackTypes`
 * draws over it.
 */
import { OBJNI_SPECIAL_C } from '../../core/objectNameIndex';
import { DBType, decodeObjectID, OBJECT_ID_NULL, type ObjectID } from '../../core/types';
import { AttackType, ATTACK_TYPE_NONE, ATTACK_CLASS_EMPTY_HAND } from '../../engine/monsterTypes';
import { getPartyChampion } from '../../engine/Party';
import { getChampionPossession, SLOT_WEAPON_HAND, type Champion } from '../../engine/gameTypes';
import { CHARFLAG_ATTACK_DISABLE } from '../../data/CsbwinCharacters';
import { determineMastery } from '../../engine/skills';
import { fillRectIndex, shrinkBlt, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { Rect } from '../csbwin/UITables';
import { drawObjectIconMask, shadeRectIndex } from './Draw';
import { searchButtonList } from './HitTest';
import { getAttackClass, getBaseObjectNameIndex, resolveObjectNameIndex } from './Objects';
import { nowMs, UIState } from './UIState';

/** `VBLDelay(15)` at 60 Hz — a quarter of a second. */
const FLASH_MS = 250;

/** `DrawAttackButton`'s rectangle for champion `chIdx` (`Character.cpp:4820`). */
export function attackButtonRect(chIdx: number): Rect {
  const x1 = 22 * chIdx + 233;
  return { x1, y1: 86, x2: x1 + 19, y2: 120 };
}

/**
 * `ItemHasChargesLeft` (`doc/CSBwin-src/Character.cpp:4745`).
 *
 * Whether the thing in the fighting hand still has a charge to spend. Anything that is
 * not a weapon, a garment or a misc object counts as ready — CSBWin's `default: return
 * 1` — so an attack option gated on charges is never hidden by an object that has no
 * charge field at all.
 */
export function itemHasChargesLeft(ui: UIState, chIdx: number): boolean {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  if (!champ) return true;
  const rn = getChampionPossession(champ, SLOT_WEAPON_HAND);
  if (rn === OBJECT_ID_NULL) return true;
  switch (decodeObjectID(rn).category) {
    case DBType.WEAPON:
      return (ui.dungeonState.getWeaponRecord(rn)?.charges ?? 0) !== 0;
    case DBType.CLOTHING:
      return (ui.dungeonState.getClothingRecord(rn)?.charges ?? 0) !== 0;
    case DBType.MISC:
      return (ui.dungeonState.getMiscRecord(rn)?.specialState ?? 0) !== 0;
    default:
      return true;
  }
}

/**
 * `GetLegalAttackTypes` (`doc/CSBwin-src/Character.cpp:4772`).
 *
 * An object's `legalAttacks` row holds three attack types and, for the second and
 * third, the mastery they demand. The first is *always* offered — that is what makes
 * every weapon usable by anybody — and the other two appear only if the champion is
 * good enough with the relevant skill, and if bit 7 of the requirement is set, only
 * while the object still has charges.
 */
export function getLegalAttackTypes(ui: UIState, chIdx: number, row: ArrayLike<number>): void {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  ui.possibleAttackTypes[0] = row[0] ?? 0;
  ui.byte20256[0] = 1;

  let count = 1;
  for (let i = 1; i < 3; i++) {
    const attackType = row[i] ?? 255;
    if (attackType === 255) continue;
    let required = row[i + 3] ?? 0;
    if ((required & 128) !== 0) {
      if (!itemHasChargesLeft(ui, chIdx)) continue;
    }
    required &= 0x7f;
    const skill = (ui.uiTables?.graphic230.skillNumber[attackType] ?? 0) & 0xff;
    const mastery = champ ? masteryOf(ui, champ, skill) : 0;
    if (mastery < required) continue;
    ui.possibleAttackTypes[count] = attackType;
    ui.byte20256[count] = required;
    count++;
  }
  ui.word20248 = count;
  for (let i = count; i < 3; i++) ui.possibleAttackTypes[i] = -1;
}

function masteryOf(ui: UIState, champ: Champion, skill: number): number {
  return determineMastery(champ, skill, {
    partySleeping: ui.partyState?.sleeping ?? false,
    getObjectNameIndex: (objectId: ObjectID) => {
      const value = resolveObjectNameIndex(ui, objectId);
      return value >= 0 ? value : null;
    },
  });
}

/**
 * `PrepareAttack` (`doc/CSBwin-src/Character.cpp:4904`) — open the attack menu for one
 * champion, unless they are busy or dead (`:4916`).
 *
 * An empty fighting hand still has attacks: attack class 2, which is the bare-handed
 * row. A held object whose attack class is 0 has none at all and the click is ignored.
 */
export function prepareAttack(ui: UIState, chIdx: number): void {
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  if (!champ) return;
  if ((champ.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0) return;
  if ((champ.attributes.health | 0) === 0) return;

  const weapon = getChampionPossession(champ, SLOT_WEAPON_HAND);
  let attackClass: number;
  if (weapon === OBJECT_ID_NULL) {
    attackClass = ATTACK_CLASS_EMPTY_HAND;
  } else {
    attackClass = getAttackClass(ui, weapon) & 0xff;
    if (attackClass === 0) return;
  }

  const row = ui.uiTables?.graphic230.legalAttacks[attackClass];
  if (!row) return;

  ui.attackingCharacterOrdinal = chIdx + 1;
  getLegalAttackTypes(ui, chIdx, row);
  ui.word20252 = 0;
  drawLegalAttackTypes(ui);
}

/**
 * `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8718`), the state it leaves: the
 * panel shows what `word20252` and the ordinal say, which `drawAttackPanel` composes each
 * frame, so a menu `TAG01b1c0` closed and the damage figure are off the screen.
 */
export function drawLegalAttackTypes(ui: UIState): void {
  ui.closedAttackMenuOrdinal = 0;
  ui.attackFlashValue = 0;
  ui.attackFlashUntilMs = 0;
  ui.word20250 = 0;
}

/**
 * `TAG01b1c0` (`doc/CSBwin-src/Character.cpp:4886`) — close the menu again, and ask for
 * the panel to be redrawn on the next tick. It draws nothing there, so the menu stays on
 * the screen until `TAG01b29a` draws the damage or the buttons over it.
 */
export function closeAttackMenu(ui: UIState): void {
  if (ui.attackingCharacterOrdinal === 0) return;
  ui.closedAttackMenuOrdinal = ui.attackingCharacterOrdinal;
  ui.attackingCharacterOrdinal = 0;
  ui.word20250 = 1;
}

/**
 * `_ExecuteAttack` (`doc/CSBwin-src/Character.cpp:4944`).
 *
 * `option` is 0-2 for one of the listed attacks, or -1 for the PASS button, which
 * closes the menu without attacking and returns CSBWin's -1.
 */
export function executeAttack(ui: UIState, option: number): number {
  if (ui.attackingCharacterOrdinal === 0) return 0;
  const chIdx = ui.attackingCharacterOrdinal - 1;
  let result: number;
  if (option === -1) {
    result = -1;
  } else {
    const attackType = ui.possibleAttackTypes[option] & 0xff;
    if (attackType === ATTACK_TYPE_NONE) return 0;
    result = ui.onChampionAttack?.(chIdx, attackType) ?? 0;
    // The fusion's `Attack(_1_, …)` never returns (`Character.cpp:4972`): `_FusionSequence`
    // ends in `ShowCredits` (`Attack.cpp:2429`), so `TAG01b1c0` does not run and the menu
    // stays on the panel to the end of the game.
    if (ui.isRunningScript?.()) return result;
  }
  closeAttackMenu(ui);
  return result;
}

/**
 * One of the listed attacks (0-2) taken, by a click or its key: `ExecuteAttack`, then
 * `d.clockTick = (i16)intResult` (`doc/CSBwin-src/Character.cpp:4716-4717`), so an attack
 * makes a tick due and a 0 puts one off. The fusion's `ExecuteAttack(_6_, …)` does not
 * return to set it.
 */
export function takeAttackOption(ui: UIState, option: number): void {
  const result = executeAttack(ui, option);
  if (!ui.isRunningScript?.()) ui.setClockTick?.(result);
}

/**
 * `_TAG019fac`'s half with the menu open (`doc/CSBwin-src/Character.cpp:4677-4717`): button
 * `id` of `d.Buttons17892`, 112 for PASS and 113-115 for the options. Each is flashed
 * before its `ExecuteAttack`.
 */
export function attackMenuButton(ui: UIState, id: number): void {
  if (id === 112) {
    ui.flashButton?.(0x11d, 0x13f, 0x4d, 0x53);
    executeAttack(ui, -1); // PASS, which leaves `d.clockTick` alone
    return;
  }
  // Only the options actually offered are live; the rows below `word20248` are dead
  // even though the button list covers them.
  if (id - 112 > ui.word20248) return;
  if (id === 113) ui.flashButton?.(0xea, 0x13e, 0x56, 0x60);
  else if (id === 114) ui.flashButton?.(0xea, 0x13e, 0x62, 0x6c);
  else ui.flashButton?.(0xea, 0x13e, 0x6e, 0x78);
  takeAttackOption(ui, id - 113);
}

/**
 * `_TAG019fac` (`doc/CSBwin-src/Character.cpp:4661`) — button 111, the panel area.
 *
 * Which button list is consulted depends on the panel's state, so the same screen
 * region means "pick a champion" or "pick an attack" at different moments.
 */
export function handleAttackAreaClick(ui: UIState, x: number, y: number): void {
  if (!ui.partyState) return;
  const numCharacter = ui.partyState.champions.length;

  if (ui.attackingCharacterOrdinal !== 0) {
    const id = searchButtonList(ui.uiTables?.graphic231.buttons.buttons17892 ?? null, x, y, 2);
    if (id !== 0) attackMenuButton(ui, id);
    return;
  }

  if (ui.word20252 !== 0) {
    const id = searchButtonList(ui.uiTables?.graphic231.buttons.buttons17952 ?? null, x, y, 2);
    if (id === 0) return;
    const chIdx = id - 116;
    if (chIdx >= 0 && chIdx < numCharacter) prepareAttack(ui, chIdx);
  }
}

/**
 * `_TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8799`) — once per game tick.
 *
 * Two jobs. It turns each champion to face whatever hit them hardest since the last
 * tick, which is the flinch you see in play; and it services `word20250` by flashing
 * the damage figure and then bringing the attack buttons back.
 */
export function attackPanelTick(ui: UIState): void {
  const party = ui.partyState;
  if (!party || party.champions.length === 0) return;

  // Asleep, or with a candidate at the mirror, nobody turns and the damage is kept for
  // the first tick after (`CSBCode.cpp:8808-8816`).
  const candidate = party.potentialChampionIndex >= 0;
  if (party.sleeping || candidate) {
    if (ui.attackingCharacterOrdinal !== 0) {
      closeAttackMenu(ui);
      return;
    }
    if (!candidate) return;
  } else {
    const cursorOwner = party.cursorOwner ?? -1;
    party.champions.forEach((champ, idx) => {
      if (!champ) return;
      // Not the champion holding the cursor, and not the one with the menu open: those
      // two keep facing the way the player left them.
      if (idx !== cursorOwner && idx + 1 !== ui.attackingCharacterOrdinal && champ.maxRecentDamage) {
        const from = champ.damageFromDirection;
        if (champ.facing !== from) champ.facing = from;
      }
      champ.maxRecentDamage = 0;
    });
  }

  if (ui.word20250 === 0) return;

  if (ui.attackingCharacterOrdinal === 0) {
    // The flash is a timed overlay rather than CSBWin's blocking delay; the panel stays
    // owed a redraw until it has run its course.
    if (ui.attackFlashUntilMs > nowMs()) return;
    const damage = ui.onConsumeAttackDamage?.() ?? 0;
    if (damage !== 0) {
      ui.attackFlashValue = damage;
      ui.attackFlashUntilMs = nowMs() + FLASH_MS;
      ui.closedAttackMenuOrdinal = 0;
      return;
    }
    ui.word20252 = 1;
    drawLegalAttackTypes(ui);
    return;
  }

  ui.word20252 = 0;
  drawLegalAttackTypes(ui);
}

/**
 * `DrawAttackButton` (`doc/CSBwin-src/Character.cpp:4815`).
 *
 * A dead champion's button is a black hole rather than a blue box; a living one shows
 * the icon of whatever it is fighting with, or the bare-fist icon for an empty hand. An
 * object that *is* held but has no attacks leaves the box empty. The box is shaded when
 * the champion is mid-action, while a champion at a Hall of Champions mirror has not yet
 * been resurrected, reincarnated or cancelled, or while the party sleeps.
 */
export function drawAttackButton(ui: UIState, chIdx: number): void {
  if (!ui.screenIndexBuffer || !ui.uiTables) return;
  const rect = attackButtonRect(chIdx);
  const champ = ui.partyState && getPartyChampion(ui.partyState, chIdx);
  const alive = !!champ && (champ.attributes.health | 0) !== 0;

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

  // `Character.cpp:4875-4880`: busy, a candidate in the party, or asleep.
  const busy = (champ.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0;
  const candidate = (ui.partyState?.potentialChampionIndex ?? -1) >= 0;
  if (busy || candidate || (ui.partyState?.sleeping ?? false)) {
    shadeRectIndex(ui, rect, 0);
  }
}

/**
 * `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8718`) — the whole panel, either
 * state.
 *
 * The backdrop rectangle for the option list depends on how many options there are, so
 * a weapon with one attack gets a short box and one with three a tall one.
 */
export function drawAttackPanel(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.partyState) return;

  fillRectIndex(ui.screenIndexBuffer, ui.uiTables.graphic232.word20, 0);

  // The damage stays up after its flash, until `DrawLegalAttackTypes` draws over it.
  if (ui.attackFlashValue !== 0) {
    drawAttackDamageFlash(ui);
    return;
  }

  if (ui.word20252 !== 0) {
    for (let chIdx = 0; chIdx < ui.partyState.champions.length; chIdx++) {
      drawAttackButton(ui, chIdx);
    }
    return;
  }

  // A closed menu is still what CSBWin's screen shows (`closeAttackMenu`).
  const ordinal = ui.attackingCharacterOrdinal || ui.closedAttackMenuOrdinal;
  if (ordinal === 0) return;
  const champ = getPartyChampion(ui.partyState, ordinal - 1);
  if (!champ) return;

  let numAttackOption = 3;
  let backdrop = ui.uiTables.graphic230.wRectPos20202;
  if (ui.possibleAttackTypes[2] === -1) {
    backdrop = ui.uiTables.graphic230.wRectPos20210;
    numAttackOption = 2;
  }
  if (ui.possibleAttackTypes[1] === -1) {
    backdrop = ui.uiTables.graphic230.wRectPos20218;
    numAttackOption = 1;
  }

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
  for (let i = 0; i < 3; i++) {
    const name = attackTypeName(ui, ui.possibleAttackTypes[i]);
    // CSBWin draws all three rows regardless; the ones past `numAttackOption` come out
    // blank because `GetAttackTypeName(-1)` is the empty string.
    void numAttackOption;
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, 241, 12 * i + 93, 4, 0, name);
  }
}

/** `GetAttackTypeName` — index -1/255 has no name. */
function attackTypeName(ui: UIState, attackType: number): string {
  if (attackType < 0 || attackType === ATTACK_TYPE_NONE) return '';
  return ui.uiTables?.graphic230.attackNames[attackType] ?? '';
}

/**
 * `_FlashAttackDamage` (`doc/CSBwin-src/Attack.cpp:949`).
 *
 * Three sizes of starburst by how hard the blow landed — over 40, over 15, and the
 * rest — with the number written across it. Two negative values are messages instead:
 * -1 could not reach, -2 had no ammunition.
 */
function drawAttackDamageFlash(ui: UIState): void {
  if (!ui.screenIndexBuffer || !ui.fontData || !ui.uiTables) return;
  const damage = ui.attackFlashValue;

  if (damage < 0) {
    const [x, text] = damage === -1 ? [242, "CAN'T REACH"] : [248, 'NEED AMMO'];
    drawTextLineIndex(ui.screenIndexBuffer, ui.fontData, x, 100, 4, 0, text);
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

/** Which attack types the champion is currently offered — for tools and the trace. */
export function possibleAttackTypeNames(ui: UIState): string[] {
  const names: string[] = [];
  for (let i = 0; i < ui.word20248; i++) {
    const type = ui.possibleAttackTypes[i];
    if (type < 0) continue;
    names.push(attackTypeName(ui, type) || AttackType[type] || String(type));
  }
  return names;
}
