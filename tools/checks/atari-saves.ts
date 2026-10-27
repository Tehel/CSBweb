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
 *   form, whose place `tools/checks/data-sets.ts` proves.)
 *
 * Then a party that carries something, which neither file has: `csbgame2.dat` with three
 * objects taken off the end of their chains (a link set to `RNeof`, the image's checksum
 * made again), a group put in a `TT_60` timer, an item in the first champion's action
 * hand and one in the hand, all three packed as the file's RNs are. Such a file's read
 * numbers them after the chains, the timer first, then the champions, then the hand,
 * and before the scrolls' texts (`convertHeldObjects`, `doc/CSBwin-src/SaveGame.cpp:2958-2983`),
 * so in the running game each names its own record, in that order of slots.
 *
 * And the control: a save CSBWin wrote carries its own size in the block, which the
 * fallback must not replace.
 *
 * Run: `npm test -- --only=atari-saves.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE, writeU16BE } from '../../src/core/bytes';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../../src/core/types';
import { loadCsbwinWorld } from '../../src/data/CsbwinDungeonImage';
import { cellFlagArraySize } from '../../src/data/CsbwinDungeonImageWriter';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { applyCsbwinSave, fromSaveFile } from '../../src/engine/CsbwinSaveGame';
import { databaseRecords, type DungeonData } from '../../src/data/dungeonTypes';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { readSaveFile } from '../../src/data/SaveFile';
import { newGame, stockDungeon } from '../lib/game';
import { check, finish } from '../lib/check';
import { savePath } from '../lib/saves';

const CSB = 'tools/fixtures/gamefiles/csb';
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

  const state = readSaveFile(bytes);
  const image = state.imageOffset ?? 0;
  const word2 = readU16BE(bytes, image + 2);
  console.log(`  Extended Features: ${state.extended.header ? 'present' : 'absent'}, ` +
    `image at ${image}, header word 2 = ${word2}, cell flag size = ${state.cellFlagArraySize}`);
  check(state.extended.header === undefined, `${name}: has no Extended Features block`);
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
  const installed = game.ctx.dungeon.getData();
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
  const gb2 = world.save.block2;
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

// A party that carries something, from `csbgame2.dat`.
{
  const save = readSaveFile(new Uint8Array(readFileSync(resolve(CSB, 'csbgame2.dat'))));
  const data = save.extended.data;
  const layout = save.imageLayout!;
  const packed = new DungeonLoader().loadFromArray(data.subarray(save.imageOffset), {
    noConvert: true, cellFlagArraySize: save.cellFlagArraySize,
  });
  const recordOf = (rn: number) => databaseRecords(packed.databases, (rn >> 10) & 15)[rn & 0x3ff] as { nextObject: number };
  // Every chain's head with its square, as `convertObjectReferences` walks them.
  const chains: { level: number; x: number; y: number; rns: number[] }[] = [];
  packed.maps.forEach((map, level) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      let column = packed.columnIndex[packed.levelIndex[level]! + x]!;
      for (let y = 0; y < map.descriptor.height; y++) {
        if ((map.cellFlags[x]![y]! & 0x10) === 0) continue;
        const rns: number[] = [];
        for (let rn = packed.objectList[column++]! as number; rn !== OBJECT_ID_EOF; rn = recordOf(rn).nextObject) rns.push(rn);
        chains.push({ level, x, y, rns });
      }
    }
  });
  // The last object of a chain of two or more, of one of `dbs`, taken off it.
  const taken = new Set<number>();
  const take = (dbs: number[]) => {
    const chain = chains.find((c) => c.rns.length >= 2 && dbs.includes((c.rns.at(-1)! >> 10) & 15) && !taken.has(c.rns.at(-1)!))!;
    const rn = chain.rns.at(-1)!;
    const before = chain.rns.at(-2)!;
    const db = (before >> 10) & 15;
    writeU16BE(data, layout.databases[db]! + (before & 0x3ff) * layout.recordSizes[db]!, OBJECT_ID_EOF);
    taken.add(rn);
    return { ...chain, rn };
  };
  const group = take([4]);
  const carried = take([5, 6, 8, 10]);
  const held = take([5, 6, 8, 10]);
  const end = layout.cellFlags + save.cellFlagArraySize;
  let sum = 0;
  for (let i = save.imageOffset; i < end; i++) sum = (sum + data[i]!) & 0xffff;
  writeU16BE(data, end, sum);

  const free = save.timers.findIndex((t, i) => t.function === 0 && !save.timerQueue.includes(i));
  Object.assign(save.timers[free]!, {
    time: save.block2.time + 0x100000, level: group.level, function: 60,
    uByte6: group.x, uByte7: group.y, uByte8: group.rn >> 8, uByte9: group.rn & 0xff,
    timerWord6: (group.x << 8) | group.y, timerWord8: group.rn,
  });
  save.timerQueue.push(free);
  save.block2.numTimer++;
  const ACTION_HAND = 1;
  writeU16BE(save.blocks.characters, 212 + ACTION_HAND * 2, carried.rn);
  save.block2.objectInHand = held.rn;
  const name = (rn: number) => `${DB_OF_CATEGORY[(rn >> 10) & 15]} ${rn & 0x3ff}`;
  console.log(`\n=== csbgame2.dat, carrying: timer ${free} TT_60 with ${name(group.rn)} at ${group.level}(${group.x},${group.y}), ` +
    `action hand ${name(carried.rn)}, hand ${name(held.rn)} ===`);
  check(packed.header.objectCounts[11] === 0, 'csbgame2.dat: no EXPOOL record, so no equip filter runs at the read');

  const game = newGame(stockDungeon(), csbGraphics);
  try {
    fromSaveFile(game, save);
  } catch (error) {
    check(false, `csbgame2.dat, carrying: the game should take the save — ${(error as Error).message}`);
    finish();
  }
  const { rnMaps, databases } = game.ctx.dungeon.getData();
  const names = (slot: ObjectID | undefined, rn: number) => slot !== undefined && slot !== OBJECT_ID_NULL
    && rnMaps.dbType(slot) === ((rn >> 10) & 15) && rnMaps.idx(slot) === (rn & 0x3ff);
  const party = game.ctx.party.state;
  const timer = game.ctx.timers.getTimers().find((t) => t.index === free);
  const slots = { group: timer?.object, carried: party.champions[0]!.possessions[ACTION_HAND], held: party.objectInHand };
  const textSlots = databases.scrolls.records.flatMap((r) => r.textObject === undefined ? [] : [r.textObject as number]);
  let chainMax = 0;
  for (const head of game.ctx.dungeon.getData().objectList) {
    for (let id = head; id !== OBJECT_ID_EOF && id !== OBJECT_ID_NULL; id = databaseRecords(databases, rnMaps.dbType(id))[rnMaps.idx(id)]!.nextObject) {
      chainMax = Math.max(chainMax, id);
    }
  }
  console.log(`  slots: chains up to ${chainMax}, timer ${slots.group}, action hand ${slots.carried}, hand ${slots.held}, ` +
    `scrolls' texts from ${Math.min(...textSlots)}`);
  check(names(slots.group, group.rn), 'csbgame2.dat, carrying: the TT_60 timer names its group');
  check(names(slots.carried, carried.rn), 'csbgame2.dat, carrying: the action hand names its item');
  check(names(slots.held, held.rn), 'csbgame2.dat, carrying: the hand names its item');
  check(chainMax < slots.group! && slots.group! < slots.carried && slots.carried < slots.held
      && slots.held < Math.min(...textSlots),
    'csbgame2.dat, carrying: numbered after the chains, the timer, the champions, the hand, then the scrolls\' texts');
  let ran = 0;
  try {
    for (; ran < TICKS && !party.gameIsLost; ran++) game.gameTick();
  } catch (error) {
    check(false, `csbgame2.dat, carrying: the game should run — ${(error as Error).message}`);
  }
  console.log(`  ran ${ran} ticks${party.gameIsLost ? ', the game lost' : ''}`);
}

// The control: the block's own size stands.
const control = readSaveFile(new Uint8Array(readFileSync(savePath(CONTROL))));
const declared = control.extended.header?.cellFlagArraySize ?? 0;
console.log(`\ncontrol ${CONTROL}: block declares ${declared}, taken ${control.cellFlagArraySize}`);
check(declared > 0 && control.cellFlagArraySize === declared, 'a CSBWin save keeps its block\'s cell flag size');

finish();
