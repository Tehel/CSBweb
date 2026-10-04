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

/** A game on `csbgame7.dat`'s world, or another save's. */
export function freshGame(file: Uint8Array = save): Game {
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(stock)), graphics);
  applyCsbwinSave(game, file);
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
 * on the globals as they stand.
 */
export function run(
  program: number[],
  prepare: (game: Game) => void = () => {},
  file: Uint8Array = save,
  filter?: TestFilter,
): { game: Game; g: number[]; again: () => number[] } {
  const game = freshGame(file);
  prepare(game);
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
  data.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: 47, word4: 0, word6: 0 });
  const rn: ObjectID = dungeon.rnMaps.rn(DBType.ACTUATOR, data.databases.actuators.records.length - 1);
  dungeon.addObjectToCell(at, rn);
  const dsa: DsaDefinition = {
    description: 'test', state: 0, localState: 1, groupId: 0, numStates: 1, firstDisplayedState: 0,
    states: [{
      actions: filter
        ? [{ column: 0, program: Uint16Array.from(filter.program) }, { column: 1, program: Uint16Array.from(program) }]
        : [{ column: 0, program: Uint16Array.from(program) }],
    }],
  };
  data.dsaIndex = { entries: [dsa] };
  data.dsaLevelIndex = [];
  data.dsaLevelIndex[at.z] = [0];
  filter?.place(game, locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 }));
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(0x5a5a));
  const timer = {
    uByte5: 0, uByte6: at.x, uByte7: at.y, uByte8: 0, uByte9: filter ? 1 : 0, level: at.z, time: 0,
  } as TimerEntry;
  const again = (): number[] => {
    game.systems.dsa.processTimer5(rn, timer, at);
    return game.systems.dsa.getGlobalVariables();
  };
  return { game, g: again(), again };
}
