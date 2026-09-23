/**
 * Where a group's members sit inside a cell.
 *
 * `OrdinalOfMonsterAtPosition` (`doc/CSBwin-src/Code11f52.cpp:619`) answers "which
 * member of this group, 1-based, is standing in that corner", and 0 for nobody. It is
 * asked by three unrelated systems — a missile arriving (`TimerSystem`), a monster
 * shuffling within its cell (`MonsterAI`) and a champion swinging a sword
 * (`AttackSystem`) — which is why it lives here rather than as a private method on any
 * one of them.
 *
 * Two details are easy to get wrong and both matter:
 *
 *  - The loop counts **down** from the last member, so when two members overlap the
 *    *higher* ordinal wins.
 *  - A `horizontalSize == 1` monster occupies two adjacent corners, so the query is
 *    first walked back to the counter-clockwise-most end of the pair — but only when
 *    the corner's parity matches the group's facing.
 */

import type { CreatureRecord } from '../data/dungeonTypes';
import { monsterHorizontalSize, type MonsterDesc } from '../renderer/csbwin/ObjectTables';
import type { DungeonState } from './DungeonState';

/**
 * `OrdinalOfMonsterAtPosition(pDB4, pos)` (`doc/CSBwin-src/Code11f52.cpp:619`): reads the
 * group's position and facing bytes and its descriptor's `horizontalSize`, then asks
 * {@link ordinalAtPositionBytes}.
 */
export function ordinalOfMonsterAtPosition(
  dungeon: DungeonState,
  monsterDesc: ArrayLike<MonsterDesc> | null | undefined,
  monster: CreatureRecord,
  position: number,
): number {
  const render = dungeon.getMonsterRenderState(monster);
  const desc = monsterDesc?.[monster.creatureType];
  return ordinalAtPositionBytes({
    positions: render.positions,
    facings: render.facings,
    numMonM1: monster.numMonM1,
    horizontalSize: desc ? monsterHorizontalSize(desc) : 0,
    position,
  });
}

/** The body of `OrdinalOfMonsterAtPosition`, over the bytes it reads. */
export function ordinalAtPositionBytes(options: {
  /** `MonsterPositionByte` — four 2-bit corners, one per member. */
  positions: number;
  /** `MonsterFacingByte` — only bit 0 is read, and only for a wide monster. */
  facings: number;
  /** `DB4.numMonM1` — group size minus one. */
  numMonM1: number;
  /** `MONSTERDESC.horizontalSize()` — 1 means the monster spans two corners. */
  horizontalSize: number;
  /** The corner being asked about, absolute within the cell. */
  position: number;
}): number {
  const positions = options.positions & 0xff;
  // 0xff is CSBWin's "position not tracked" marker: everything answers member 1.
  if (positions === 0xff) return 1;

  const numMonM1 = options.numMonM1 & 0x3;
  let check = options.position & 0x3;

  if (options.horizontalSize === 1) {
    if ((options.facings & 1) === (check & 1)) check = (check - 1) & 0x3;
    for (let idx = numMonM1; idx >= 0; idx--) {
      const at = (positions >> (2 * idx)) & 0x3;
      if (at === check || at === ((check + 1) & 0x3)) return idx + 1;
    }
    return 0;
  }

  for (let idx = numMonM1; idx >= 0; idx--) {
    if (((positions >> (2 * idx)) & 0x3) === check) return idx + 1;
  }
  return 0;
}
