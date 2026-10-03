/**
 * `CheckMonsters` and `CheckMonster` (`doc/CSBwin-src/SaveGame.cpp:1279-1365`): cut every
 * group to what its creatures' size lets share a cell.
 *
 * `_ReadEntireGame` calls `CheckMonsters` once the whole file is read (`:1826`), a new
 * game's and a save's alike, with no gate, between `CheckCelltypes` and `ExtendPortraits`
 * (both in `src/data/CsbwinDungeonConversions.ts`, run by `DungeonLoader`). It needs
 * `MonsterDescriptor`'s sizes, so it runs where the tables are: `Game`'s constructor, for
 * a new game, and `applyCsbwinSave`, for a save, each before anything attaches a group to
 * an `ITEM16`.
 *
 * It reads `groupIndex` as the packed positions, but in a save a group on the party's
 * level holds its `ITEM16` index there: CSBWin writes the file before it detaches them
 * (`:1243`), and reads the pool back before this runs (`:1668-1675`). So a fix to such a
 * group writes a position byte over the index. The game's start undoes it:
 * `LoadPartyLevel` detaches every slot first (`CSBCode.cpp:795`), and `DetachItem16`
 * writes `groupIndex` and `facing` back from the slot (`CSBCode.cpp:6127-6131`);
 * `reloadAfterSaveGame` is that call here. What stays is the cut `numMonM1`.
 */
import { DBType, OBJECT_ID_EOF, Position } from '../core/types';
import type { ObjectID } from '../core/types';
import type { MonsterDesc } from '../data/tables/MonsterDesc';
import { monsterHorizontalSize } from '../data/tables/MonsterDesc';
import type { DungeonState } from './DungeonState';

/** `UI_MessageBox(title, text, MESSAGE_OK)`'s two strings, as one line. */
export type MessageBox = (line: string) => void;

// CSBWin's two `static bool`s: each warning is shown once per process.
let warning4Issued = false;
let warning2Issued = false;

/** `FindNextMonster` (`doc/CSBwin-src/Code11f52.cpp:544-550`). */
function FindNextMonster(dungeon: DungeonState, obj: ObjectID): ObjectID {
  for (obj = dungeon.getDBRecordLink(obj);
       obj !== OBJECT_ID_EOF && dungeon.rnMaps.dbType(obj) !== DBType.CREATURE;
       obj = dungeon.getDBRecordLink(obj));
  return obj;
}

/** `CheckMonster` (`doc/CSBwin-src/SaveGame.cpp:1279-1340`). */
export function CheckMonster(
  dungeon: DungeonState, monsterDesc: ArrayLike<MonsterDesc>, obj: ObjectID, messageBox: MessageBox,
): void {
  const pMonster = dungeon.getCreatureRecord(obj);
  if (!pMonster) return;
  const numMonster = pMonster.numMonM1 + 1;
  const monsterType = pMonster.creatureType;
  const desc = monsterDesc[monsterType];
  const monsterSize = desc ? monsterHorizontalSize(desc) : 0;
  switch (monsterSize) {
    case 0: // Any number of monsters is OK.
      break;
    case 1: {
      if (numMonster > 2) {
        if (!warning4Issued) messageBox('Too many monsters of size 2: Fixing...');
        warning4Issued = true;
        pMonster.numMonM1 = 1;
        pMonster.groupIndex = 2;
        pMonster.facing = 0;
      }
      const pos1 = pMonster.groupIndex & 3;
      const pos2 = (pMonster.groupIndex >> 2) & 3;
      if (numMonster === 2 && (pos1 ^ pos2) !== 2) {
        pMonster.groupIndex = 2;
        pMonster.facing = 0;
      }
      break;
    }
    case 2: {
      if (numMonster > 1) {
        if (!warning2Issued) messageBox('Too many monsters of size 4: Fixing...');
        warning2Issued = true;
        pMonster.numMonM1 = 0;
        pMonster.groupIndex = 255;
        pMonster.facing = 0;
      }
      const pos1 = pMonster.groupIndex;
      // It appears that position is not important for size 4 monsters
      if (pos1 !== 255) {
        pMonster.groupIndex = 255;
        pMonster.facing = 0;
      }
      break;
    }
    default:
      break;
  }
  for (let poss = pMonster.possession; poss !== OBJECT_ID_EOF; poss = FindNextMonster(dungeon, poss)) {
    if (dungeon.rnMaps.dbType(poss) !== DBType.CREATURE) continue;
    CheckMonster(dungeon, monsterDesc, poss, messageBox);
  }
}

/** `CheckMonsters` (`doc/CSBwin-src/SaveGame.cpp:1342-1365`): every group on every level. */
export function CheckMonsters(dungeon: DungeonState, monsterDesc: ArrayLike<MonsterDesc>, messageBox: MessageBox): void {
  const numLevel = dungeon.getData().maps.length;
  for (let level = 0; level < numLevel; level++) {
    const { width, height } = dungeon.getData().maps[level].descriptor;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const position = new Position(x, y, level);
        for (let obj = dungeon.findFirstMonster(position); obj !== OBJECT_ID_EOF; obj = FindNextMonster(dungeon, obj)) {
          CheckMonster(dungeon, monsterDesc, obj, messageBox);
        }
      }
    }
  }
}
