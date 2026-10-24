/**
 * A dungeon's `EDBT_DeleteDuplicateTimers` record, which turns `SetTimer`'s merge of map
 * timers off.
 *
 * `_ReadEntireGame` sets the global `deleteDuplicateTimers` from the world's `EXPOOL` once
 * the databases are read, for a new game and a saved one alike: 1 when the pool holds no
 * `(EDT_Database << 24) + (EDBT_DeleteDuplicateTimers << 16)` record, else the record's
 * first longword (`doc/CSBwin-src/SaveGame.cpp:1965-1975`). `SetTimer` merges a new map
 * timer into a matching one only while it is not 0 (`doc/CSBwin-src/Timer.cpp:1014`).
 *
 * The census: 3D2D1D's `dungeon.dat` holds a record of 0, Conflux 3.5's one of 1, and no
 * other data set one. Then two map timers at the same time, level and square: a new game
 * on 3D2D1D keeps both, read or built at the boot, one on DM merges them, and so does a new game read after 3D2D1D's.
 * And a save of the 3D2D1D game, which writes the pool as it is, loads with the merge off.
 *
 * Run: `npm test -- --only=delete-duplicate-timers.ts`
 */
import { readFileSync } from 'node:fs';

import { Expool, readDeleteDuplicateTimers } from '../../src/data/CsbwinExpool';
import { DungeonLoader, emptyDungeonData } from '../../src/data/DungeonLoader';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { check, finish } from '../lib/check';
import { newGame, stockGraphics } from '../lib/game';

/** `(EDT_Database << 24) + (EDBT_DeleteDuplicateTimers << 16)` (`doc/CSBwin-src/CSB.h:1555-1557`). */
const KEY = ((5 << 24) + (1 << 16)) >>> 0;

const SETS = [
  '3D2D1D', 'conflux-3.5-b8', 'csb', 'dm-atari', 'dm-atari-1.2', 'dm-atari-1.3-fr', 'dm-windows',
  'kids-dungeon-24', 'towers-of-chaos-3.3',
];

const dungeonDat = (set: string): Uint8Array => new Uint8Array(readFileSync(`tools/fixtures/gamefiles/${set}/dungeon.dat`));

console.log('== The census ==');
const records = new Map<string, number | null>();
for (const set of SETS) {
  const data = new DungeonLoader().loadDungeonDat(dungeonDat(set));
  const record = new Expool(data).locateAt(KEY, 0);
  records.set(set, record?.value ?? null);
  console.log(`  ${set}: ${record ? `a record of ${record.size} longword(s), the first ${record.value}` : 'no record'}`
    + `, deleteDuplicateTimers ${readDeleteDuplicateTimers(data)}`);
}
check(records.get('3D2D1D') === 0, "3D2D1D's record is 0");
check(records.get('conflux-3.5-b8') === 1, "Conflux 3.5's record is 1");
check(SETS.filter((set) => records.get(set) !== null).length === 2, 'no other data set has one');

/**
 * Two `TT_PIT`s at the same time, level and square, and how many of them are left. Each
 * call takes a time of its own, so a game loaded from a save is not handed the pits it
 * already queued.
 */
let delay = 50;
function mapTimersAfterTwo(game: Game): number {
  const timers = game.ctx.timers;
  const isPit = (fn: number): boolean => fn === TimerFunction.TT_PIT;
  const before = timers.getTimers().filter((t) => isPit(t.function)).length;
  const time = game.ctx.state.tickCount + delay++;
  timers.createTimer(TimerFunction.TT_PIT, 3, 4, 0, 0, time, 1);
  timers.createTimer(TimerFunction.TT_PIT, 3, 4, 0, 1, time, 1);
  return timers.getTimers().filter((t) => isPit(t.function)).length - before;
}

console.log('== Two matching map timers ==');
const graphics = stockGraphics();
const maze = newGame(emptyDungeonData(), graphics);
maze.readDungeonDat(dungeonDat('3D2D1D'));
const mazeKept = mapTimersAfterTwo(maze);
console.log(`  a new game on 3D2D1D keeps ${mazeKept}`);
check(!maze.ctx.timers.deleteDuplicateTimers && mazeKept === 2, '3D2D1D keeps both (Timer.cpp:1014)');

const booted = newGame(new DungeonLoader().loadDungeonDat(dungeonDat('3D2D1D')), graphics);
const bootedKept = mapTimersAfterTwo(booted);
console.log(`  a game built on 3D2D1D, as the boot builds one, keeps ${bootedKept}`);
check(bootedKept === 2, 'so does the boot\'s game');

const dm = newGame(new DungeonLoader().loadDungeonDat(dungeonDat('dm-atari')), graphics);
const dmKept = mapTimersAfterTwo(dm);
console.log(`  a game on DM keeps ${dmKept}`);
check(dm.ctx.timers.deleteDuplicateTimers && dmKept === 1, 'DM merges them: no record is "the old way"');

const saved = buildSaveFile(maze);
maze.readDungeonDat(dungeonDat('dm-atari'));
const afterKept = mapTimersAfterTwo(maze);
console.log(`  DM read after 3D2D1D keeps ${afterKept}`);
check(maze.ctx.timers.deleteDuplicateTimers && afterKept === 1, 'every read sets the global again');

console.log('== The 3D2D1D game saved, and loaded over DM ==');
applyCsbwinSave(dm, saved);
const loadedKept = mapTimersAfterTwo(dm);
console.log(`  keeps ${loadedKept}`);
check(!dm.ctx.timers.deleteDuplicateTimers && loadedKept === 2, 'the save carries the record, and a load reads it');

finish();
