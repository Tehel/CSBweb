/**
 * Make a monster group for a scenario and return its record.
 *
 * `MonsterSystem.createMonster` returns what CSBWin's `CreateMonster` does, which is
 * `RNnul` for every group placed on the party's level: `MoveObject` attaches its
 * `ITEM16` there and returns 1 (`doc/CSBwin-src/Code11f52.cpp:3376`,
 * `Monster.cpp:222-231`). A scenario wants the group either way, so this looks for it
 * on the square it was asked for.
 */
import { OBJECT_ID_EOF, Position, type ObjectID } from '../../src/core/types';
import type { Game } from '../../src/engine/Game';

export function createMonsterAt(
  game: Game,
  options: Parameters<Game['systems']['monsters']['createMonster']>[0],
): ObjectID | null {
  const made = game.systems.monsters.createMonster(options);
  if (made !== null) return made;
  const rn = game.ctx.dungeon.findFirstMonster(new Position(options.mapX, options.mapY, options.level));
  return rn === OBJECT_ID_EOF ? null : rn;
}
