/**
 * The attack menu's `d.` work: `TAG01b1c0` (`doc/CSBwin-src/Character.cpp:4904`), which
 * closes it, `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8823`), whose action name
 * filter rewrites `d.PossibleAttackTypes`, and `_TAG01b29a` (`CSBCode.cpp:8904`), once a
 * tick, which turns the champions to face their blows and services `d.Word20250`. What
 * they draw is the screen's, which the host is asked for under the same names
 * (`GameHost.tag01b1c0`, `drawLegalAttackTypes`, `flashAttackDamage`). The menu opened
 * and its options taken are the attack panel's clicks (`src/renderer/ui/Attack.ts`).
 */
import type { GameContext } from './GameContext';
import type { AttackOptions } from './GameHost';
import { ATTACK_TYPE_NONE } from './monsterTypes';

/**
 * How long the damage's flash holds the buttons back, in VBLs. CSBWin's is `VBLDelay(15)`,
 * a tick, in which the whole game stops (`doc/CSBwin-src/Attack.cpp:1039`); the port's
 * game runs on under it, and the author's choice is 24 VBLs, 400 ms, over one tick and
 * under two, so the damage is up for two ticks (`DEBT.md` H).
 */
export const ATTACK_FLASH_VBLS = 24;

/**
 * `TAG01b1c0` (`doc/CSBwin-src/Character.cpp:4904-4922`): the menu closed, and the panel
 * owed a redraw on the next tick. Its `DrawCharacterState` of the attacker's hands is the
 * screen's (`GameHost.tag01b1c0`), which leaves the menu on the panel until `TAG01b29a`
 * draws the damage or the buttons over it.
 */
export function tag01b1c0(ctx: GameContext): void {
  const face = ctx.interface;
  if (face.attackingCharacterOrdinal === 0) return;
  ctx.host.tag01b1c0(face.attackingCharacterOrdinal - 1);
  face.attackingCharacterOrdinal = 0;
  face.word20250 = 1;
}

/**
 * `DrawLegalAttackTypes` (`doc/CSBwin-src/CSBCode.cpp:8823-8899`): the panel drawn as
 * `d.Word20252` and the ordinal say (`GameHost.drawLegalAttackTypes`), the option list
 * named first, and `d.Word20250 = 0`. Drawn over the damage, by a key that opens a menu
 * under the flash, it ends the flash too.
 */
export function drawLegalAttackTypes(ctx: GameContext): void {
  const face = ctx.interface;
  ctx.host.drawLegalAttackTypes(face.word20252 === 0 && face.attackingCharacterOrdinal !== 0 ? nameAttackOptions(ctx) : null);
  face.word20250 = 0;
  face.attackFlashVbls = 0;
}

/**
 * `DrawLegalAttackTypes`'s option list (`doc/CSBwin-src/CSBCode.cpp:8850-8894`): one option
 * unless `PossibleAttackTypes[1]` is set, two unless `[2]` is too, and three rows named by
 * `GetAttackTypeName`. Each row offered goes through the action name filter after its
 * default name is read (`ActionNameFilter`, `:8879-8882`), which may name it otherwise and
 * changes the attack it is.
 */
function nameAttackOptions(ctx: GameContext): AttackOptions {
  const face = ctx.interface;
  const chIdx = face.attackingCharacterOrdinal - 1;
  let count = 3;
  if (face.possibleAttackTypes[2] === -1) count = 2;
  if (face.possibleAttackTypes[1] === -1) count = 1;
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    let name = attackTypeName(ctx, face.possibleAttackTypes[i]!);
    if (i < count) {
      const filtered = ctx.systems.dsa.filters.actionNameFilter(chIdx, i, count, face.possibleAttackTypes[i]!);
      if (filtered) {
        face.possibleAttackTypes[i] = filtered.attackType;
        if (filtered.name !== null) name = filtered.name;
      }
    }
    names.push(name);
  }
  return { count, names };
}

/**
 * `GetAttackTypeName` (`doc/CSBwin-src/CSBCode.cpp:8714-8732`): the low byte names the
 * attack, and 255 (-1) nothing.
 */
function attackTypeName(ctx: GameContext, attackType: number): string {
  const index = attackType & 0xff;
  if (index === ATTACK_TYPE_NONE) return '';
  return ctx.tables.attackNames[index] ?? '';
}

/**
 * `_TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8904-8967`), from the main loop's tick after
 * `d.Time++` (`:695`).
 *
 * Two jobs. It turns each champion to face whatever hit them hardest since the last
 * tick, which is the flinch you see in play; and it services `d.Word20250` by flashing
 * the damage figure and then bringing the attack buttons back. The flinch's
 * `DrawCharacterState` is the frame's, which draws every box.
 */
export function tag01b29a(ctx: GameContext): void {
  const party = ctx.party.state;
  const face = ctx.interface;
  if (party.champions.length === 0) return;

  // Asleep, or with a candidate at the mirror, nobody turns and the damage is kept for
  // the first tick after (`CSBCode.cpp:8913-8921`).
  const candidate = party.potentialChampionIndex >= 0;
  if (party.sleeping || candidate) {
    if (face.attackingCharacterOrdinal !== 0) {
      tag01b1c0(ctx);
      return;
    }
    if (!candidate) return;
  } else {
    const cursorOwner = party.cursorOwner;
    party.champions.forEach((champ, idx) => {
      if (!champ) return;
      // Not the champion holding the cursor, and not the one with the menu open: those
      // two keep facing the way the player left them.
      if (idx !== cursorOwner && idx + 1 !== face.attackingCharacterOrdinal && champ.maxRecentDamage) {
        const from = champ.damageFromDirection;
        if (champ.facing !== from) champ.facing = from;
      }
      champ.maxRecentDamage = 0;
    });
  }

  if (face.word20250 === 0) return;

  if (face.attackingCharacterOrdinal === 0) {
    // The flash is counted in VBLs, where CSBWin's `VBLDelay(15)` stops the game (`DEBT.md`
    // H): the panel stays owed its redraw until the flash has run its course.
    if (face.attackFlashVbls !== 0) return;
    const damage = ctx.systems.attack.consumeAttackDamageToDisplay();
    if (damage !== 0) {
      face.attackFlashVbls = ATTACK_FLASH_VBLS;
      ctx.host.flashAttackDamage(damage);
      return;
    }
    face.word20252 = 1;
    drawLegalAttackTypes(ctx);
    return;
  }

  face.word20252 = 0;
  drawLegalAttackTypes(ctx);
}
