/**
 * The counts a condition reads from the set's own files (`doc/ACHIEVEMENTS.md` → "Counted
 * from the data"): its spells, the kinds of food its dungeon holds and the monster types it
 * places. They are the same for every game of the set, so the tracker works them out once,
 * from the set's `graphics.dat` tables, which the game holds, and its dungeon files, which
 * it is handed (`AchievementSetFiles`): `dungeon.dat`, and `mini.dat` where the set has one,
 * Chaos Strikes Back's adventure, read as the save it is. A save read in the game changes
 * nothing of them.
 *
 * Each count is that of the values the event it is compared with can take in a game of the
 * set, so that `distinct(…) >= count` means "every one of them": a spell cast is one of
 * the table's, a meal one of the foods, a monster killed by a blow one of the types. A
 * dungeon whose DSAs create a monster or a food, or make something else edible, can reach
 * the count with one of those instead.
 *
 * **Nothing in this file touches the DOM.**
 */
import { getActuatorType, getActuatorValue } from '../../data/actuatorHelpers';
import { loadCsbwinWorld } from '../../data/CsbwinDungeonImage';
import type { DataSetFiles } from '../../data/DataSetFiles';
import type { DataSet } from '../../data/DataSets';
import { DungeonLoader } from '../../data/DungeonLoader';
import { UTILITY_PORTRAITS_FILE } from '../../data/UtilityPortraits';
import type { CreatureRecord, DungeonData } from '../../data/dungeonTypes';
import { monsterInvincible, monsterLeavesDroppings } from '../../data/tables/MonsterDesc';
import { OBJNI_APPLE, OBJNI_DRAGON_STEAK } from '../../core/objectNameIndex';
import { DBType, getRoomType, RoomType } from '../../core/types';
import { forEachObject } from '../DungeonCensus';
import type { GameTables } from '../GameTables';
import { DROPPING_MISC_BASE, MONSTER_DROPPINGS_INDEX } from '../MonsterDamage';
import type { MonsterType } from '../monsterTypes';
import { GetBasicObjectType, OBJDI_COMPASS } from '../objectIndex';
import type { DataCounts } from './AchievementFile';

/** The set's files the counts are read from, besides the game's tables, and those a CSB adventure's start is read against. */
export interface AchievementSetFiles {
  readonly dungeonDat: Uint8Array;
  /** Chaos Strikes Back's adventure, a CSBWin save (`DataSet.miniDat`); `null` where the set has none. */
  readonly miniDat: Uint8Array | null;
  /**
   * The utility disk's portraits (`UTILITY_PORTRAITS_FILE`), which tell a champion raised
   * from Dungeon Master (`AchievementTracker`); absent or `null` where the set has none.
   */
  readonly utilityPortraits?: Uint8Array | null;
}

/**
 * `set`'s dungeon files, read from `files`, and beside a `mini.dat` the utility's portraits;
 * a `dungeon.dat` missing throws, as the boot's does.
 */
export async function readAchievementSetFiles(set: DataSet, files: DataSetFiles): Promise<AchievementSetFiles> {
  const dungeonDat = await files.read('dungeon.dat');
  if (!dungeonDat) throw new Error(`Cannot open dungeon file '${files.where('dungeon.dat')}'`);
  if (!set.miniDat) return { dungeonDat, miniDat: null };
  return { dungeonDat, miniDat: await files.read('mini.dat'), utilityPortraits: await files.read(UTILITY_PORTRAITS_FILE) };
}

/** The tables the counts read. */
type CountTables = Pick<GameTables, 'spells' | 'monsterDesc' | 'monsterDroppings' | 'objDescObjectType'>;

/** `files`' dungeons read, `dungeon.dat` as a new game reads it and `mini.dat` as a save. */
export function setDungeons(files: AchievementSetFiles): DungeonData[] {
  const dungeons = [new DungeonLoader().loadDungeonDat(files.dungeonDat)];
  if (files.miniDat) dungeons.push(loadCsbwinWorld(files.miniDat).dungeon);
  return dungeons;
}

/**
 * The counts of a set whose tables are `tables` and whose dungeons are `dungeons`:
 *
 * - `spells`: the table's spells (`d.Spells`, graphic `0x230`) by the runes after the power
 *   rune, the ones `cast.spell` names, each once: a spell that asks for a power rune
 *   (`MagicSystem.incantationToSpell`) is the same spell as one that does not.
 * - `monsterTypes`: the types of the groups the dungeons place, carried ones among them,
 *   and of those their generators make (an actuator of type 6 on an open square,
 *   `doc/CSBwin-src/Timer.cpp:1771-1820`, its value's low five bits the type,
 *   `doc/CSBwin-src/Monster.cpp:130`), less the types a blow cannot kill (`monsterInvincible`):
 *   Dungeon Master's Lord Chaos, whom only the Firestaff fuses.
 * - `foods`: the kinds of food (`OBJNI_APPLE` to `OBJNI_DRAGON_STEAK`, the objects
 *   `_FeedCharacter` chews) among the objects the dungeons hold, and among the droppings
 *   of those monster types (`CreateAndDropObject`, `doc/CSBwin-src/Code11f52.cpp:735-788`):
 *   a worm's worm rounds, a dragon's steaks.
 * - `levels`: the maps of the dungeon the game is played in, the last of `dungeons`, that
 *   hold a floor square (`floorSquares`): Chaos Strikes Back's adventure has eleven maps,
 *   and the last is a single square of stone.
 */
export function dataCounts(tables: CountTables, dungeons: readonly DungeonData[]): DataCounts {
  const spells = new Set(tables.spells.filter((spell) => spell.spellId !== 0).map((spell) => spell.spellId & 0xffffff));
  const types = new Set<number>();
  const foods = new Set<number>();
  const isFood = (nameIndex: number): boolean => nameIndex >= OBJNI_APPLE && nameIndex <= OBJNI_DRAGON_STEAK;
  for (const data of dungeons) {
    forEachObject(data, (rn, dungeon, room) => {
      const category = data.rnMaps.decode(rn).category;
      if (category === DBType.CREATURE) {
        const creature = dungeon.getRecord(rn) as CreatureRecord | null;
        if (creature) types.add(creature.creatureType);
      } else if (category === DBType.ACTUATOR) {
        const actuator = room === RoomType.OPEN ? dungeon.getActuatorRecord(rn) : null;
        if (actuator && getActuatorType(actuator) === 6) types.add(getActuatorValue(actuator) & 0x1f);
      } else {
        const nameIndex = GetBasicObjectType(dungeon, tables.objDescObjectType, rn);
        if (isFood(nameIndex)) foods.add(nameIndex);
      }
    });
  }
  for (const type of types) {
    const desc = tables.monsterDesc[type];
    if (!desc || monsterInvincible(desc)) {
      types.delete(type);
      continue;
    }
    const start = MONSTER_DROPPINGS_INDEX[type as MonsterType];
    if (start === undefined || !monsterLeavesDroppings(desc)) continue;
    for (let i = start; i < tables.monsterDroppings.length; i++) {
      const word = tables.monsterDroppings[i] ?? 0;
      if (word === 0) break;
      const value = word & 0x7fff;
      if (value < DROPPING_MISC_BASE) continue;
      const nameIndex = tables.objDescObjectType[OBJDI_COMPASS + value - DROPPING_MISC_BASE] ?? -1;
      if (isFood(nameIndex)) foods.add(nameIndex);
    }
  }
  const played = dungeons[dungeons.length - 1];
  const levels = played ? new Set(floorSquares(played).map((square) => square.z)).size : 0;
  return { spells: spells.size, foods: foods.size, monsterTypes: types.size, levels };
}

/** A square of a map: its map, its column and its row. */
export interface Square {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The floor squares of `data`, map by map, column by column: those of type `OPEN`, a
 * corridor, as the dungeon begins. The other squares the party may stand on are left out:
 * a door's, a closed pit, a teleporter switched off and a false wall open.
 */
export function floorSquares(data: DungeonData): Square[] {
  const out: Square[] = [];
  data.maps.forEach((map, z) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (getRoomType(map.cellFlags[x]?.[y] ?? 0) === RoomType.OPEN) out.push({ z, x, y });
      }
    }
  });
  return out;
}
