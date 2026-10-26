/**
 * The rules several systems read of the party, one helper each, so that no system keeps
 * a copy of its own: a champion alive, a skill's mastery as play reads it, the party's
 * level's difficulty, and a skill gained on that level.
 */
import type { ObjectID } from '../core/types';
import type { GameContext } from './GameContext';
import type { Champion } from './gameTypes';
import { NameIndex } from './objectIndex';
import { adjustSkills, determineMastery, type AdjustSkillsWhy } from './skills';

/**
 * `HP() != 0`, and no champion in an empty slot. CSBWin asks it as `!= 0`, `> 0` and
 * `<= 0` alike, which agree: `CHARDESC::HP` holds 0 to `MAXHP`
 * (`doc/CSBwin-src/data.cpp:1879-1883`).
 */
export function isAlive(champion: Champion | null | undefined): boolean {
  return !!champion && champion.attributes.health !== 0;
}

/**
 * `DetermineMastery(chIdx, skill)` (`doc/CSBwin-src/Code17818.cpp:29`) as play reads it:
 * 1 for every skill while the party sleeps, and the weapon hand's and the neck's objects
 * by their name index, unless `skill`'s `0x4000` flag leaves them out.
 */
export function masteryOf(ctx: GameContext, champion: Champion, skill: number): number {
  return determineMastery(champion, skill, {
    partySleeping: ctx.party.state.sleeping,
    getObjectNameIndex: (rn: ObjectID) => NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, rn),
  });
}

/** `d.pCurLevelDesc->experienceMultiplier()`: the party's level's difficulty. */
export function levelDifficulty(ctx: GameContext): number {
  return ctx.dungeon.levelDifficulty(ctx.party.state.position.z);
}

/**
 * `AdjustSkills` on the party's level, whatever the gain: a gain of 0 still runs the
 * Adjust Skills Filter, whose answer may give some (`doc/CSBwin-src/Magic.cpp:255-322`).
 */
export function adjustSkillsOnPartyLevel(
  ctx: GameContext,
  chIdx: number,
  skillNumber: number,
  experience: number,
  why: AdjustSkillsWhy,
): void {
  adjustSkills(ctx, chIdx, skillNumber, experience, why, levelDifficulty(ctx));
}
