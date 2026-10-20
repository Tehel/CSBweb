/**
 * The dungeon's game information, kept through every save.
 *
 * `ReadExtendedFeatures` ends with `ReadGameInfo(handle, efb.gameInfoSize)`
 * (`doc/CSBwin-src/SaveGame.cpp:388`), which keeps the block's string in the global
 * `gameInfo`, or "No game information was provided" for a size of 0 (`:247-264`), and
 * `SaveGame` writes `gameInfoSize - 1` and the string back into every save
 * (`:1002-1003`, `:1020`). So a game read from Conflux's `dungeon.dat` carries its 541
 * bytes of credits into its saves, and a save of a game read from DM's `dungeon.dat`,
 * which has no block, writes none.
 *
 * 1. Each set whose `dungeon.dat` has a block: the size its header declares, the world's
 *    `gameInfo` read from it, and a save of a new game carrying it, byte for byte, then a
 *    second save of that save's game.
 * 2. DM's `dungeon.dat`, no block: no game information, a save that writes a size of 0,
 *    and its read giving "No game information was provided", which the next save
 *    writes as 32.
 * 3. `readGameInfo` alone: 0 and -1, the allocated-but-empty one, kept as -1.
 *
 * Run: `npm test -- --only=dump-game-info.ts`
 */
import { readFileSync } from 'node:fs';
import { readGameInfo } from '../src/data/CsbwinExtendedFeatures';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import type { Game } from '../src/engine/Game';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { newGame, stockDungeon, stockGraphics } from './lib/game';

const graphics = stockGraphics();
const NO_GAME_INFO = 'No game information was provided';
const ascii = (bytes: Uint8Array | undefined): string => String.fromCharCode(...(bytes ?? []));

/** The game information a save of `game` writes: its block's size and the bytes after the DSAs. */
function saved(game: Game): { size: number; text: string; bytes: Uint8Array } {
  const bytes = buildSaveFile(game);
  const state = loadSaveGameState(bytes);
  return { size: state.extendedFeatures?.gameInfoSize ?? NaN, text: ascii(state.gameInfo), bytes };
}

/** A new game on the stock graphics, with `bytes` read in, as F9 reads a save. */
function loaded(bytes: Uint8Array): Game {
  const game = newGame(stockDungeon(), graphics);
  applyCsbwinSave(game, bytes);
  return game;
}

console.log('1. The sets whose dungeon.dat has a block');
for (const [dir, size] of [['conflux-3.5-b8', 541], ['towers-of-chaos-3.3', 89], ['3D2D1D', 40], ['dm-windows', 32]] as const) {
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`static/gamefiles/${dir}/dungeon.dat`)));
  const declared = data.extendedFeatures?.gameInfoSize;
  const text = ascii(data.gameInfo?.text);
  console.log(`  ${dir}: gameInfoSize ${declared}, read ${data.gameInfo?.size} ${JSON.stringify(text.slice(0, 40))}…`);
  check(declared === size && data.gameInfo?.size === size && text.length === size, `${dir}: the world keeps its ${size} bytes`);
  const first = saved(newGame(data, graphics));
  console.log(`    saved: ${first.size} bytes`);
  check(first.size === size && first.text === text, `${dir}: a save writes them back, byte for byte`);
  const second = saved(loaded(first.bytes));
  check(second.size === size && second.text === text, `${dir}: and so does a save of that save's game`);
}

console.log('\n2. DM\'s dungeon.dat, no block');
{
  const game = newGame(stockDungeon(), graphics);
  check(game.ctx.state.dungeon.gameInfo === undefined, 'the world has no game information');
  const first = saved(game);
  console.log(`  saved: ${first.size}, read back ${JSON.stringify(ascii(loaded(first.bytes).ctx.state.dungeon.gameInfo?.text))}`);
  check(first.size === 0 && first.text === '', 'its save writes a size of 0 and no byte');
  const second = saved(loaded(first.bytes));
  console.log(`  its save's game saved: ${second.size} ${JSON.stringify(second.text)}`);
  check(second.size === 32 && second.text === NO_GAME_INFO, 'that save\'s game writes "No game information was provided", 32 bytes');
}

console.log('\n3. readGameInfo');
{
  const none = readGameInfo(0, new Uint8Array(0));
  const empty = readGameInfo(-1, new Uint8Array(0));
  console.log(`  0 -> ${none.size} ${JSON.stringify(ascii(none.text))}; -1 -> ${empty.size}, ${empty.text.length} bytes`);
  check(none.size === 32 && ascii(none.text) === NO_GAME_INFO, 'a size of 0 reads as CSBWin\'s own string');
  check(empty.size === -1 && empty.text.length === 0, 'a size of -1 is kept, with no byte');
}

finish();
