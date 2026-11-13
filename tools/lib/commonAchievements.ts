/**
 * The common achievements as the build holds them (`commonAchievementsText`,
 * `src/ui/achievementFiles.ts`), read from the source, since `tsx` cannot glob: what the
 * tools check a set's own achievements against (`AchievementsCheck`,
 * `src/engine/LocalDataSetCheck.ts`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AchievementsCheck } from '../../src/engine/LocalDataSetCheck';

/** `src/engine/achievements/defs/common.txt`'s text. */
export const COMMON_ACHIEVEMENTS_TEXT = readFileSync(resolve(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8');

/** A set's achievements checked against the common file, no family reserved: a moderator's check, or a tool's that tests none. */
export const ANY_FAMILY: AchievementsCheck = { common: COMMON_ACHIEVEMENTS_TEXT, reservedFamilies: new Set() };

/** `ANY_FAMILY` as the API takes it (`SetAchievements.achievementsCheck`). */
export const anyFamily = (): AchievementsCheck => ANY_FAMILY;
