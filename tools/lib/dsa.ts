/**
 * Running a DSA program in a tool: the program words, and a test DSA that runs one
 * program against a game on a genuine save (`DEBT.md` G1's family tools).
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, Position, RoomType, locationRelToInteger, type ObjectID } from '../../src/core/types';
import type { DsaDefinition, DungeonData } from '../../src/data/dungeonTypes';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import type { GameHost } from '../../src/engine/GameHost';
import type { TimerEntry } from '../../src/engine/TimerQueue';
import { newGame, stockGraphics } from './game';
import { savePath } from './saves';

const LOAD = 6;
const AMPERSAND = 11;
const VARIABLEFETCH = 17;
const VARIABLESTORE = 18;
const GLOBALSTORE = 20;
const AMPERSAND2 = 21;

/** `LOAD_INTEGER32` (`DSA.cpp:1125-1137`): any 32-bit value, low word first. */
export const int = (value: number): number[] => [LOAD | (30 << 6), value & 0xffff, (value >>> 16) & 0xffff];
export const op = (subcode: number): number =>
  subcode < 128 ? AMPERSAND | (subcode << 6) : AMPERSAND2 | ((subcode - 128) << 6);
export const varFetch = (index: number): number => VARIABLEFETCH | (index << 6);
export const varStore = (index: number): number => VARIABLESTORE | (index << 6);
export const globalStore = (index: number): number => GLOBALSTORE | (index << 6);
/** Variables `from` to `from + n - 1` into globals 0 to `n - 1`. */
export const report = (from: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => [varFetch(from + i), globalStore(i)]).flat();

const graphics = stockGraphics();
const stock = readFileSync('static/gamefiles/dm-atari/dungeon.dat');
export const save = new Uint8Array(readFileSync(savePath('csbgame7.dat')));

/** What the global variables start at in a test game: no DSA stored into one. */
export const UNSET = 0x5a5a;

/** A game on `csbgame7.dat`'s world, or another save's, with the parts of `host` given. */
export function freshGame(file: Uint8Array = save, host?: Partial<GameHost>): Game {
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(stock)), graphics, host);
  applyCsbwinSave(game, file);
  return game;
}

/** A test DSA's programs: one, its column 0, or one per column, from 0. */
export type FilterDsa = number[] | { columns: number[][] };

/**
 * A game on `csbgame7.dat`, or on `file`, whose filter at special location `esl` is set
 * (`placeFilterDsas`).
 */
export function withFilterDsas(esl: number, programs: FilterDsa[], host?: Partial<GameHost>, file: Uint8Array = save): Game {
  return placeFilterDsas(freshGame(file, host), esl, programs);
}

/**
 * Make the filter at special location `esl` of `game`'s world
 * (`doc/CSBwin-src/CSB.h:1535-1550`) the first empty open square of the party's level,
 * holding one type-47 actuator per DSA, in order, each with the programs of a DSA of its
 * own, and the world's only DSAs and special location. The globals are `UNSET`.
 */
export function placeFilterDsas(game: Game, esl: number, programs: FilterDsa[]): Game {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  const map = dungeon.getMap(z)!;
  let at: Position | null = null;
  for (let x = 0; x < map.descriptor.width && !at; x++) {
    for (let y = 0; y < map.descriptor.height && !at; y++) {
      const p = new Position(x, y, z);
      if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      at = p;
    }
  }
  if (!at) throw new Error('no empty open square');
  const data: DungeonData = dungeon.getData();
  const entries: DsaDefinition[] = programs.map((program, i) => ({
    description: `test ${i}`, state: 0, localState: 1, groupId: 0, numStates: 1, firstDisplayedState: 0,
    states: [{
      actions: (Array.isArray(program) ? [program] : program.columns)
        .map((words, column) => ({ column, program: Uint16Array.from(words) })),
    }],
  }));
  programs.forEach((_, i) => {
    data.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: 47 | (i << 7), word4: 0, word6: 0 });
    dungeon.addObjectToCell(at, dungeon.rnMaps.rn(DBType.ACTUATOR, data.databases.actuators.records.length - 1));
  });
  data.dsaIndex = { entries };
  data.dsaLevelIndex = [];
  data.dsaLevelIndex[z] = programs.map((_, i) => i);
  data.specialLocations = { [(3 << 24) | esl]: locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 }) };
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(UNSET));
  return game;
}

/**
 * A filter for `run`: `program` is the test DSA's column 0, which a filter runs, and
 * `place` makes the test square, as a `LOCATIONREL` integer, the filter's location.
 */
export interface TestFilter {
  program: number[];
  place: (game: Game, locr: number) => void;
}

/**
 * Run `program` as the one program of a test DSA on an empty open square of the party's
 * level, and return the 100 global variables, which start at 0x5a5a. With a `filter`,
 * the program is column 1, run by a timer whose `uByte9` is 1. `again` runs it once more,
 * on the globals as they stand. `prepare` runs once the square `at` is chosen, before the
 * DSA is set on it, and a `program` given as a function is built after it.
 */
export function run(
  program: number[] | ((game: Game, at: Position) => number[]),
  prepare: (game: Game, at: Position) => void = () => {},
  file: Uint8Array = save,
  filter?: TestFilter,
): { game: Game; g: number[]; again: () => number[]; at: Position } {
  const game = freshGame(file);
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  const map = dungeon.getMap(z)!;
  let at: Position | null = null;
  for (let x = 0; x < map.descriptor.width && !at; x++) {
    for (let y = 0; y < map.descriptor.height && !at; y++) {
      const p = new Position(x, y, z);
      if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      at = p;
    }
  }
  if (!at) throw new Error('no empty open square');
  prepare(game, at);
  const words = typeof program === 'function' ? program(game, at) : program;
  const data: DungeonData = dungeon.getData();
  data.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: 47, word4: 0, word6: 0 });
  const rn: ObjectID = dungeon.rnMaps.rn(DBType.ACTUATOR, data.databases.actuators.records.length - 1);
  dungeon.addObjectToCell(at, rn);
  const dsa: DsaDefinition = {
    description: 'test', state: 0, localState: 1, groupId: 0, numStates: 1, firstDisplayedState: 0,
    states: [{
      actions: filter
        ? [{ column: 0, program: Uint16Array.from(filter.program) }, { column: 1, program: Uint16Array.from(words) }]
        : [{ column: 0, program: Uint16Array.from(words) }],
    }],
  };
  data.dsaIndex = { entries: [dsa] };
  data.dsaLevelIndex = [];
  data.dsaLevelIndex[at.z] = [0];
  filter?.place(game, locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 }));
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(UNSET));
  const timer = {
    uByte5: 0, uByte6: at.x, uByte7: at.y, uByte8: 0, uByte9: filter ? 1 : 0, level: at.z, time: 0,
  } as TimerEntry;
  const again = (): number[] => {
    game.systems.dsa.processTimer5(rn, timer, at);
    return game.systems.dsa.getGlobalVariables();
  };
  return { game, g: again(), again, at };
}
