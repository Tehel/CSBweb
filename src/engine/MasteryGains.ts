/**
 * An extra (`DEBT.md` X), not CSBWin's: a mastery just gained, shown in green on the
 * attribute panel until the attributes its level gain raised have climbed back to the
 * maximum that gain gave them.
 *
 * A level gain raises attribute maximums only (`levelUp`), and the current values climb
 * to them over time. The panel cannot tell such a drop below the maximum from one dealt by
 * damage or a potion, so the gain is noted here as it happens, per champion and per role,
 * with the maximum it left each attribute it raised. The roles share attributes (every
 * level may raise Vitality and Anti-fire, a fighter's and a ninja's both Strength and
 * Dexterity), so a role's note is held to its own maximums, never to the current one: a
 * later fighter level raising Dexterity again does not light the ninja line whose
 * Dexterity had already got back. A note is dropped as soon as it is met, whether or not
 * the panel is showing (`settleMasteryGains`), so a later drop cannot light it again.
 *
 * The note sits beside the champion and is never saved: a save and a load forget it, and
 * the line goes back to colour 13. It is kept whether or not the extra is on; only the
 * panel reads it, and only with it on.
 */
import { AttributeIndex, attributeCurrent, attributeMaximum } from './attributes';
import type { Champion } from './gameTypes';

/** Per champion, per role, per `AttributeIndex`: the maximum a gain raised it to, or 0. */
const gains = new WeakMap<Champion, number[][]>();

/** A level gain in `role` raised the maximum of `raised`, a bit per `AttributeIndex`. */
export function recordMasteryGain(champion: Champion, role: number, raised: number): void {
  if (raised === 0) return;
  let roles = gains.get(champion);
  if (!roles) gains.set(champion, roles = [[], [], [], []]);
  const targets = roles[role]!;
  const stats = champion.attributes.stats;
  for (let i = AttributeIndex.Luck; i <= AttributeIndex.AntiFire; i++) {
    const attr = stats[i];
    if ((raised & (1 << i)) !== 0 && attr) targets[i] = attributeMaximum(attr);
  }
}

/** Whether `role`'s note has an attribute still below the maximum its gain gave it. */
function pending(champion: Champion, targets: number[]): boolean {
  const stats = champion.attributes.stats;
  return targets.some((target, i) => {
    const attr = stats[i];
    return target !== undefined && target > 0 && !!attr && attributeCurrent(attr) < target;
  });
}

/** Drops every note of `champion` that has been met. */
export function settleMasteryGains(champion: Champion): void {
  const roles = gains.get(champion);
  if (!roles) return;
  for (let role = 0; role < roles.length; role++) {
    if (!pending(champion, roles[role]!)) roles[role] = [];
  }
}

/** Whether `role`'s mastery was gained and an attribute it raised is still short. */
export function masteryGainPending(champion: Champion, role: number): boolean {
  settleMasteryGains(champion);
  const targets = gains.get(champion)?.[role];
  return !!targets && pending(champion, targets);
}
