/**
 * An extra (`DEBT.md` X), not CSBWin's: a mastery just gained, shown in green on the
 * attribute panel until the attributes its level gain raised have climbed back to their
 * new maximum.
 *
 * A level gain raises attribute maximums only (`levelUp`), and the current values climb
 * to them over time. The panel cannot tell such a drop below the maximum from one dealt by
 * damage or a potion, so the gain is noted here as it happens, per champion and per role.
 * The note sits beside the champion and is never saved: a save and a load forget it, and
 * the line goes back to colour 13. It is kept whether or not the extras are on; only the
 * panel reads it, and only with them on.
 */
import { AttributeIndex, attributeCurrent, attributeMaximum } from './attributes';
import type { Champion } from './gameTypes';

/** Per champion, per role: the attributes still short of the maximum a gain raised. */
const gains = new WeakMap<Champion, number[]>();

/** A level gain in `role` raised the maximum of `raised`, a bit per `AttributeIndex`. */
export function recordMasteryGain(champion: Champion, role: number, raised: number): void {
  if (raised === 0) return;
  let roles = gains.get(champion);
  if (!roles) gains.set(champion, roles = [0, 0, 0, 0]);
  roles[role] = (roles[role] ?? 0) | raised;
}

/**
 * Whether `role`'s mastery was gained and an attribute it raised is still below its
 * maximum. Once every one has reached it, the note is dropped.
 */
export function masteryGainPending(champion: Champion, role: number): boolean {
  const roles = gains.get(champion);
  const raised = roles?.[role] ?? 0;
  if (raised === 0) return false;
  const stats = champion.attributes.stats;
  for (let i = AttributeIndex.Luck; i <= AttributeIndex.AntiFire; i++) {
    if ((raised & (1 << i)) === 0) continue;
    const attr = stats[i];
    if (attr && attributeCurrent(attr) < attributeMaximum(attr)) return true;
  }
  roles![role] = 0;
  return false;
}
