/**
 * How a tool builds a `Game`: over the whole `GameTables` set, as `main.ts` does.
 *
 * Tools used to hand `Game` the subset of tables they thought they needed, so a tool could
 * pass while the code it exercised read a table the tool had left out (`DEBT.md` E1a).
 * Now every tool gets every table. The set is built once per `GraphicsLoader`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DungeonData } from '../../src/data/dungeonTypes';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { Game, type GameOptions } from '../../src/engine/Game';
import { createGameContext, type GameContext } from '../../src/engine/GameContext';
import { buildGameTables, type GameTables } from '../../src/engine/GameTables';

const built = new WeakMap<GraphicsLoader, GameTables>();
let stock: GraphicsLoader | null = null;

/** The stock DM `graphics.dat`, loaded once. */
export function stockGraphics(): GraphicsLoader {
  if (!stock) {
    stock = new GraphicsLoader();
    stock.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  }
  return stock;
}

/** `buildGameTables(graphics)`, remembered per loader. */
export function gameTablesOf(graphics: GraphicsLoader): GameTables {
  let tables = built.get(graphics);
  if (!tables) {
    tables = buildGameTables(graphics);
    built.set(graphics, tables);
  }
  return tables;
}

/** A `Game` over `data` with every table from `graphics`. */
export function newGame(data: DungeonData, graphics: GraphicsLoader, options?: GameOptions): Game {
  return new Game(data, gameTablesOf(graphics), options);
}

/**
 * A `GameContext` over `data` with every table from `graphics`, for a tool that stands a
 * subsystem up without a whole `Game`. `parts` replaces members, so the tool can keep its
 * own party, dungeon or seeded random. (The replaced members are not rewired: the sound
 * queue keeps following the context's own party.)
 */
export function newContext(data: DungeonData, graphics: GraphicsLoader, parts: Partial<GameContext> = {}): GameContext {
  return { ...createGameContext(data, gameTablesOf(graphics)), ...parts };
}
