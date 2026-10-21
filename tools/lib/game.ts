/**
 * How a tool builds a `Game`: over the whole `GameTables` set, as `main.ts` does.
 *
 * Every tool gets every table, never the subset it thinks it needs, so no tool passes
 * while the code it exercises reads a table it left out. The tables are extracted once per `GraphicsLoader`
 * (`graphicsTablesOf`), and the tool's `GameTables` is built from that one extraction, as
 * `main.ts` builds the game's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../../src/data/DungeonLoader';
import type { DungeonData } from '../../src/data/dungeonTypes';
import { extractPresetHeroes, type PresetHero } from '../../src/data/HeroExtractor';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { Game } from '../../src/engine/Game';
import { createGameContext, type GameContext } from '../../src/engine/GameContext';
import type { GameHost } from '../../src/engine/GameHost';
import { buildGameTables, type GameTables } from '../../src/engine/GameTables';
import { VBL_PER_TICK } from '../../src/engine/LoopState';
import { extractGraphicsTables, type GraphicsTables } from '../../src/data/tables/GraphicsTables';

const extracted = new WeakMap<GraphicsLoader, GraphicsTables>();
const built = new WeakMap<GraphicsLoader, GameTables>();
let stock: GraphicsLoader | null = null;

/** The folder of the stock data set, the default dungeon. */
export const STOCK_DIR = 'static/gamefiles/dm-atari';

/** The stock DM `graphics.dat`, loaded once. */
export function stockGraphics(): GraphicsLoader {
  if (!stock) {
    stock = new GraphicsLoader();
    stock.loadFromArray(new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/graphics.dat`))));
  }
  return stock;
}

/**
 * The stock DM `dungeon.dat`, read as a new game reads it (`loadDungeonDat`). A fresh copy
 * every call: a game plays on the data it is given, so two games never share one.
 */
export function stockDungeon(): DungeonData {
  return new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(`${STOCK_DIR}/dungeon.dat`))));
}

/** `newGame` over a fresh `stockDungeon()` and `stockGraphics()`. */
export function stockGame(host?: Partial<GameHost>): Game {
  return newGame(stockDungeon(), stockGraphics(), host);
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

/** The heroes behind `data`'s mirrors, read with `graphics`' escape and direction tables. */
export function presetHeroesOf(data: DungeonData, graphics: GraphicsLoader): PresetHero[] {
  const tables = gameTablesOf(graphics);
  return extractPresetHeroes(data, tables.textDecode, tables);
}

/** The heroes behind the mirrors of `game`'s dungeon as it stands, read with its own tables. */
export function presetHeroesOfGame(game: Game): PresetHero[] {
  return extractPresetHeroes(game.ctx.dungeon.getData(), game.ctx.tables.textDecode, game.ctx.tables);
}

/** A `Game` over `data` with every table from `graphics`, and the parts of `host` the tool listens to. */
export function newGame(data: DungeonData, graphics: GraphicsLoader, host?: Partial<GameHost>): Game {
  return new Game(data, gameTablesOf(graphics), host);
}

/**
 * A `GameContext` over `data` with every table from `graphics`, for a tool that stands a
 * subsystem up without a whole `Game`. `parts` replaces members, so the tool can keep its
 * own party, dungeon or seeded random. (The replaced members are not rewired: the sound
 * queue keeps following the context's own party.) No read installs its world, so the timer
 * queue keeps `deleteDuplicateTimers`' default, `true`, whatever the world's `EXPOOL` says.
 */
export function newContext(data: DungeonData, graphics: GraphicsLoader, parts: Partial<GameContext> = {}): GameContext {
  return { ...createGameContext(data, gameTablesOf(graphics)), ...parts };
}

/**
 * One VBL of the loop (`Game.runFrame`). `sinceTick`, when given, is the VBLs since the
 * last tick's top, this one included: `d.vblCount` is set to the count before it, so at
 * `TICK_DUE` or more this VBL's `vblInterrupt` raises `d.clockTick` and the pass ticks.
 * Left out, the count runs on from the VBLs the tool has stepped.
 */
export function runVbl(game: Game, sinceTick?: number): void {
  if (sinceTick !== undefined) game.ctx.loop.vblCount = sinceTick - 1;
  game.runFrame();
}

/** `runVbl`'s `sinceTick` that makes a tick due: `d.Speed` awake, `VBL_PER_TICK`. */
export const TICK_DUE = VBL_PER_TICK;

/**
 * A timer pass at `time`: the clock set to it, then `ProcessTimers`, which reads `d.Time`
 * (`doc/CSBwin-src/CSBCode.cpp:6442`) as `processTimers` reads `ctx.state.tickCount`.
 * For a tool that steps the timers on a clock of its own rather than through `Game`'s tick.
 * The tick's `DisplayCharacterDamage` (`:667`) follows, so the damage the timers dealt
 * comes off the HP as it would in play.
 */
export function processTimersAt(game: Game, time: number): boolean {
  game.ctx.state.tickCount = time;
  const won = game.systems.timer.processTimers();
  game.systems.monsterAttack.displayCharacterDamage();
  return won;
}
