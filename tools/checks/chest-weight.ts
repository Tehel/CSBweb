/**
 * A chest's own weight (`GetObjectWeight`, `doc/CSBwin-src/Mouse.cpp:63-81`): the first
 * longword of the dungeon's `(EDT_Database << 24) + (EDBT_ObjectWeights << 16) + 0` record,
 * where `Locate` finds one of a longword or more, else 50; then each object inside.
 *
 * 1. **The FTL dungeon** has no such record: an empty chest weighs 50, and 50 more than
 *    what it holds.
 * 2. **Conflux** has one of 10: its chest weighs 1.0 kg, which is what its partial game
 *    (`DEBT.md` F24) needs, a chest in hand making each step cost CSBWin's stamina. At
 *    level 5, before the fix, it weighed 50 (`chestWeighsFifty`).
 * 3. **A record of no longword** leaves the 50 (`if (size < 1) chestWeight = 50`).
 *
 * Run: `npm test -- --only=chest-weight.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, type ObjectID } from '../../src/core/types';
import { CHEST_WEIGHT_KEY } from '../../src/data/CsbwinExpool';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { behaviourAt } from '../../src/engine/Behaviour';
import type { Game } from '../../src/engine/Game';
import { dataSetNamed } from '../lib/dataSets';
import { newGame, stockGame } from '../lib/game';
import { check, finish } from '../lib/check';

/** The game's first chest record, emptied, and a weapon of the dungeon to put in it. */
function emptyChest(game: Game): { chest: ObjectID; weapon: ObjectID } {
  const { dungeon } = game.ctx;
  const data = dungeon.getData();
  const chestIndex = data.databases.containers.records.findIndex((rec) => rec !== undefined);
  const weaponIndex = data.databases.weapons.records.findIndex((rec) => rec !== undefined);
  if (chestIndex < 0 || weaponIndex < 0) throw new Error('no chest or no weapon record');
  const chest = dungeon.rnMaps.rn(DBType.CHEST, chestIndex);
  dungeon.getContainerRecord(chest)!.containedObject = OBJECT_ID_EOF;
  return { chest, weapon: dungeon.rnMaps.rn(DBType.WEAPON, weaponIndex) };
}

/** The empty chest's weight, and with the weapon in it, less the weapon's own. */
function weights(game: Game): { empty: number; holding: number } {
  const { chest, weapon } = emptyChest(game);
  const stats = game.ctx.systems.characterStats;
  const empty = stats.getObjectWeight(chest);
  game.ctx.dungeon.setDBRecordLink(weapon, OBJECT_ID_EOF);
  game.ctx.dungeon.getContainerRecord(chest)!.containedObject = weapon;
  const holding = stats.getObjectWeight(chest) - stats.getObjectWeight(weapon);
  return { empty, holding };
}

function setGame(id: string): Game {
  const dir = dataSetNamed(id).dir;
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(`${dir}/graphics.dat`)));
  return newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${dir}/dungeon.dat`))), graphics);
}

/* ----------------------------------------------------- 1. the FTL dungeon ---- */
{
  const game = stockGame();
  const record = game.ctx.dungeon.locateExpoolWord(CHEST_WEIGHT_KEY, 0);
  const { empty, holding } = weights(game);
  console.log(`dm-atari: record ${JSON.stringify(record)}; an empty chest ${empty}, holding a weapon ${holding} beside it`);
  check(record === null, "dm-atari's pool has no chest weight record");
  check(empty === 50 && holding === 50, 'an empty chest weighs 50, and 50 beside what it holds');
}

/* ---------------------------------------------------------- 2. Conflux ---- */
{
  const game = setGame('conflux-3.5');
  const record = game.ctx.dungeon.locateExpoolWord(CHEST_WEIGHT_KEY, 0);
  const now = weights(game);
  const old = setGame('conflux-3.5');
  old.ctx.behaviour = behaviourAt(5);
  const before = weights(old);
  console.log(`conflux-3.5: record ${JSON.stringify(record)}; an empty chest ${now.empty}, holding a weapon ${now.holding} beside it; at level 5, ${before.empty} and ${before.holding}`);
  check(record?.size === 1 && record.value === 10, "Conflux's pool sets a chest's weight to 10");
  check(now.empty === 10 && now.holding === 10, 'its chest weighs 10, and 10 beside what it holds');
  check(before.empty === 50 && before.holding === 50, 'at level 5 it weighed 50 (chestWeighsFifty)');
}

/* ------------------------------------------------- 3. a record of nothing ---- */
{
  const game = stockGame();
  game.ctx.dungeon.writeExpoolRecord(CHEST_WEIGHT_KEY, []);
  const record = game.ctx.dungeon.locateExpoolWord(CHEST_WEIGHT_KEY, 0);
  const { empty } = weights(game);
  console.log(`a record of no longword: ${JSON.stringify(record)}; an empty chest ${empty}`);
  check(record?.size === 0 && empty === 50, 'a record of no longword leaves a chest at 50');
  game.ctx.dungeon.readExpoolRecord(CHEST_WEIGHT_KEY);
  game.ctx.dungeon.writeExpoolRecord(CHEST_WEIGHT_KEY, [37]);
  check(weights(game).empty === 37, 'one of 37 makes it 37');
}

finish();
