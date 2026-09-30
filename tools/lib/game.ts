/**
 * How a tool builds a `Game`: over the whole `GameTables` set, as `main.ts` does.
 *
 * Tools used to hand `Game` the subset of tables they thought they needed, so a tool could
 * pass while the code it exercised read a table the tool had left out (`DEBT.md` E1a).
 * Now every tool gets every table. The tables are extracted once per `GraphicsLoader`
 * (`graphicsTablesOf`), and the tool's `GameTables` is built from that one extraction, as
 * `main.ts` builds the game's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DungeonData } from '../../src/data/dungeonTypes';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { Game } from '../../src/engine/Game';
import { createGameContext, type GameContext } from '../../src/engine/GameContext';
import type { GameHost } from '../../src/engine/GameHost';
import { buildGameTables, type GameTables } from '../../src/engine/GameTables';
import { extractGraphicsTables, type GraphicsTables } from '../../src/data/tables/GraphicsTables';

const extracted = new WeakMap<GraphicsLoader, GraphicsTables>();
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

/** `extractGraphicsTables(graphics)`, remembered per loader. */
export function graphicsTablesOf(graphics: GraphicsLoader): GraphicsTables {
  let tables = extracted.get(graphics);
  if (!tables) {
    tables = extractGraphicsTables(graphics);
    extracted.set(graphics, tables);
  }
  return tables;
}

/** `buildGameTables` over `graphicsTablesOf(graphics)`, remembered per loader. */
export function gameTablesOf(graphics: GraphicsLoader): GameTables {
  let tables = built.get(graphics);
  if (!tables) {
    tables = buildGameTables(graphicsTablesOf(graphics));
    built.set(graphics, tables);
  }
  return tables;
}

/** A `Game` over `data` with every table from `graphics`, and the parts of `host` the tool listens to. */
export function newGame(data: DungeonData, graphics: GraphicsLoader, host?: Partial<GameHost>): Game {
  return new Game(data, gameTablesOf(graphics), host);
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

/**
 * A timer pass at `time`: the clock set to it, then `ProcessTimers`, which reads `d.Time`
 * (`doc/CSBwin-src/CSBCode.cpp:6383`) as `processTimers` reads `ctx.state.tickCount`.
 * For a tool that steps the timers on a clock of its own rather than through `Game`'s tick.
 * The tick's `DisplayCharacterDamage` (`:657`) follows, so the damage the timers dealt
 * comes off the HP as it would in play.
 */
export function processTimersAt(game: Game, time: number): boolean {
  game.ctx.state.tickCount = time;
  const won = game.systems.timer.processTimers();
  game.systems.monsterAttack.displayCharacterDamage();
  return won;
}
