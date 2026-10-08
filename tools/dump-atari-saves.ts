/**
 * The Atari-era saves: files with no Extended Features block, as Chaos Strikes Back ships
 * them. `mini.dat` is the eleven-level dungeon a CSB game is made from (`Chaos.cpp:2837`),
 * `csbgame2.dat` a party in it.
 *
 * Such a file declares no cell flag array size, and `ReadDatabases` then takes the image
 * header's `LegacyCellFlagArraySize`, its word 2 (`doc/CSBwin-src/SaveGame.cpp:2624-2627`,
 * `CSB.h:2135`). The image's last section is the cell flags, so a wrong size either fails
 * `loadCsbwinWorld`'s closure check or parses on into the wrong bytes.
 *
 * For each file, asked of the loader and then of a running `Game`:
 *
 * - it has no Extended Features block, so the fallback is what is being tested;
 * - the size is the header's word 2, and the layout closes on the file's last word with it;
 * - the world is CSB's: eleven maps, the header's object list, every chain walks to `RNeof`;
 * - a `Game` on CSB's own `graphics.dat`, built over `dm-atari`'s fourteen-level
 *   `dungeon.dat`, takes the save: the save's world replaces the one the game was built
 *   over, as `_ReadEntireGame` reads it whole (`Game.installWorld`), the party stands where
 *   `GAMEBLOCK2` says with its champions, and the game runs for 600 ticks, or until the
 *   game is lost. Both files put the party at (22,18) on level 4 between two groups of
 *   creature type 15, and with nobody at the controls they kill it in 142 and 408 ticks. That
 *   is play, not the load, so a lost game ends the run and is reported, not failed.
 *   (`tables.monsterDesc` and the rest are CSB's own here, through item 0x231's long
 *   form, whose place `tools/dump-data-sets.ts` proves.)
 *
 * And the control: a save CSBWin wrote carries its own size in the block, which the
 * fallback must not replace.
 *
 * Run: `npx tsx tools/dump-atari-saves.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE } from '../src/core/bytes';
import { OBJECT_ID_EOF, OBJECT_ID_NULL } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { cellFlagArraySize } from '../src/data/CsbwinDungeonImageWriter';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import type { DungeonData } from '../src/data/dungeonTypes';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { newGame, stockDungeon } from './lib/game';
import { check, finish } from './lib/check';
import { savePath } from './lib/saves';

const CSB = 'static/gamefiles/csb';
const ATARI_SAVES = ['mini.dat', 'csbgame2.dat'];
/** A save CSBWin wrote of DM, with an Extended Features block. */
const CONTROL = 'csbgame7.dat';
const TICKS = 600;

const DB_OF_CATEGORY: Record<number, keyof DungeonData['databases']> = {
  0: 'doors', 1: 'teleporters', 2: 'texts', 3: 'actuators', 4: 'creatures',
  5: 'weapons', 6: 'clothing', 7: 'scrolls', 8: 'potions', 9: 'containers',
  10: 'misc', 14: 'missiles', 15: 'clouds',
};

const csbGraphics = new GraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve(CSB, 'graphics.dat'))));

for (const name of ATARI_SAVES) {
  const bytes = new Uint8Array(readFileSync(resolve(CSB, name)));
  console.log(`\n=== ${name} — ${bytes.length} bytes ===`);

  const state = loadSaveGameState(bytes);
  const image = state.dungeonImageOffset ?? 0;
  const word2 = readU16BE(bytes, image + 2);
  console.log(`  Extended Features: ${state.extendedFeatures ? 'present' : 'absent'}, ` +
    `image at ${image}, header word 2 = ${word2}, cell flag size = ${state.cellFlagArraySize}`);
  check(state.extendedFeatures === undefined, `${name}: has no Extended Features block`);
  check(state.cellFlagArraySize === word2 && word2 > 0,
    `${name}: the cell flag size is the image header's word 2 (${word2})`);

  let world;
  try {
    world = loadCsbwinWorld(bytes);
  } catch (error) {
    check(false, `${name}: the world should load — ${(error as Error).message}`);
    continue;
  }
  const d = world.dungeon;
  // The cells and the four tables after each level's (`cellFlagArraySize`), as the
  // levels' descriptors place them: word 2 is their extent, not a count of cells.
  const extent = cellFlagArraySize(d.maps);
  console.log(`  world: ${d.maps.length} maps, cell flag extent ${extent}, objectList ${d.objectList.length}`);
  check(d.maps.length === 11, `${name}: eleven maps, CSB's dungeon`);
  check(extent === word2, `${name}: the levels' descriptors span word 2's ${word2} bytes`);
  check(d.objectList.length === d.header.objectListSize, `${name}: the object list is the header's length`);

  // Every chain from the object list, followed to `RNeof`.
  let objects = 0;
  const problems: string[] = [];
  for (const head of d.objectList) {
    let id = head;
    for (let steps = 0; id !== OBJECT_ID_EOF && id !== OBJECT_ID_NULL; steps++) {
      if (steps > 1000) { problems.push(`chain from 0x${head.toString(16)} loops`); break; }
      const { category, index } = d.rnMaps.decode(id);
      const db = DB_OF_CATEGORY[category];
      const record = db ? d.databases[db].records[index] : undefined;
      if (!record) { problems.push(`0x${id.toString(16)} names no record`); break; }
      objects++;
      id = record.nextObject;
    }
  }
  console.log(`  chains: ${objects} objects${problems.length ? `, ${problems.length} problems: ${problems.slice(0, 3).join('; ')}` : ''}`);
  check(objects > 0 && problems.length === 0, `${name}: every object chain walks to RNeof`);

  // A running game built over DM's world, fourteen levels, which the save's replaces.
  const game = newGame(stockDungeon(), csbGraphics);
  const builtOver = game.ctx.dungeon.getMapCount();
  try {
    applyCsbwinSave(game, bytes);
  } catch (error) {
    check(false, `${name}: a game built over DM's world should take the save — ${(error as Error).message}`);
    continue;
  }
  const installed = game.ctx.state.dungeon;
  console.log(`  game built over ${builtOver} maps, now ${game.ctx.dungeon.getMapCount()} maps, ` +
    `start (${installed.header.startPosition?.x},${installed.header.startPosition?.y}), ` +
    `level 0 ${installed.maps[0].descriptor.width}x${installed.maps[0].descriptor.height}`);
  check(builtOver === 14 && installed === game.ctx.dungeon.getData() && game.ctx.dungeon.getMapCount() === 11,
    `${name}: the save's eleven-level world replaces DM's fourteen, in state and DungeonState both`);
  check(installed.maps.every((map, i) => map.descriptor.width === d.maps[i].descriptor.width
      && map.descriptor.height === d.maps[i].descriptor.height && map.descriptor.level === d.maps[i].descriptor.level)
    && installed.levelIndex.join() === d.levelIndex.join()
    && installed.header.randomSeed === d.header.randomSeed,
    `${name}: the levels' descriptors, levelIndex and the header are the save's`);
  const gb2 = world.save.block2!;
  const party = game.ctx.party.state;
  console.log(`  party at (${party.position.x},${party.position.y}) level ${party.position.z}, ` +
    `${party.champions.map((c) => c.name).join(', ')}`);
  check(party.position.x === gb2.partyX && party.position.y === gb2.partyY && party.position.z === gb2.partyLevel,
    `${name}: the party stands where GAMEBLOCK2 says`);
  check(party.champions.length === gb2.numCharacter, `${name}: GAMEBLOCK2's ${gb2.numCharacter} champions`);

  const start = game.getTickCount();
  let ran = 0;
  try {
    while (ran < TICKS && !party.gameIsLost) {
      game.gameTick();
      ran++;
    }
  } catch (error) {
    check(false, `${name}: the game should run — ${(error as Error).message}`);
    continue;
  }
  // The tick that finds the game lost returns before `d.Time++` (`CSBCode.cpp:668`).
  const completed = party.gameIsLost ? ran - 1 : ran;
  console.log(`  clock ${start} -> ${game.getTickCount()}, ${ran} ticks` +
    (party.gameIsLost ? ', the game lost' : ''));
  check(ran > 100 && game.getTickCount() === start + completed, `${name}: the clock ran with the ticks`);
}

// The control: the block's own size stands.
const control = loadSaveGameState(new Uint8Array(readFileSync(savePath(CONTROL))));
const declared = control.extendedFeatures?.cellFlagArraySize ?? 0;
console.log(`\ncontrol ${CONTROL}: block declares ${declared}, taken ${control.cellFlagArraySize}`);
check(declared > 0 && control.cellFlagArraySize === declared, 'a CSBWin save keeps its block\'s cell flag size');

finish();
