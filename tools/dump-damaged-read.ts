/**
 * A game read is built off the running game, installed at once, then started
 * (`readGame`, `src/engine/ReadGame.ts`).
 *
 * 1. **An error while it builds leaves the running game as it was.** A save whose object
 *    index is cut to a quarter of its slots reads its blocks, then fails in
 *    `CheckMonsters`, the first walk of its world (`RnMaps.check`'s "Illegal object
 *    Indirect Index"). The running game, DM's stock dungeon, which names no graphics
 *    signatures where the save names 0, is held against a twin that never saw the damaged
 *    file: the menu's `SaveFileError`, and the same state, the same world object, rules,
 *    signatures, graphics signatures named, overlay and `deleteDuplicateTimers`, then the
 *    same state after 200 VBLs of play.
 * 2. **An error once it is installed ends the game.** The party's level loaded
 *    (`reloadAfterSaveGame`) is made to throw: the read is `die(0xbad)`, "SAVED GAME
 *    DAMAGED!" and the error, not a message over a game half read.
 *
 * Run: `npm test -- --only=dump-damaged-read.ts`
 */
import { readFileSync } from 'node:fs';

import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { buildDungeonImage } from '../src/data/CsbwinDungeonImageWriter';
import { objectIndexOf } from '../src/data/CsbwinObjectIndex';
import { saveSaveGameState } from '../src/data/SaveGameLoader';
import { Die } from '../src/engine/Die';
import type { Game } from '../src/engine/Game';
import { SaveFileError, applySaveBytes } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { TICK_DUE, runVbl, stockGame } from './lib/game';
import { savePath } from './lib/saves';

const DAMAGED_FROM = savePath('csbgame7.dat');

/** `csbgame7.dat` written again with its object index cut to a quarter of its slots. */
function cutObjectIndex(): Uint8Array {
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(DAMAGED_FROM)));
  const save = world.save;
  const index = objectIndexOf(world.dungeon.rnMaps);
  const length = index.length >> 2;
  return saveSaveGameState({
    ...save,
    objectIndex: { length, typeMap: index.typeMap.slice(0, length), indexMap: index.indexMap.slice(0, length) },
    dungeonImage: buildDungeonImage(world.dungeon, {
      indirectText: save.indirectText ?? false,
      bigActuators: save.bigActuators ?? false,
      newScrolls: (save.version ?? 0) >= 0x42,
    }),
  });
}

/** DM's stock dungeon, its random stream and its game id pinned, 100 VBLs into play. */
function runningGame(): Game {
  const game = stockGame();
  game.setRandomSeed(1234);
  game.ctx.state.block1.randomGameID = 0x1234;
  play(game, 100);
  return game;
}

const bytesAsArrays = (_key: string, value: unknown): unknown => (value instanceof Uint8Array ? Array.from(value) : value);

/** Everything a read installs, as one string. */
function installed(game: Game): string {
  const { ctx } = game;
  return JSON.stringify({
    state: game.getRuntimeSaveState(),
    rules: ctx.rules,
    signatures: ctx.signatures,
    runtimeFileSignatures: ctx.runtimeFileSignatures,
    overlay: ctx.overlay.toExtendedFeatures(),
    deleteDuplicateTimers: ctx.timers.deleteDuplicateTimers,
  }, bytesAsArrays);
}

function play(game: Game, vbls: number): void {
  for (let i = 0; i < vbls; i++) runVbl(game, TICK_DUE);
}

/* ------------------------------------------- 1. an error while it builds ---- */

function checkBuildError(): void {
  console.log('=== an error while the read builds leaves the running game as it was ===');
  const damaged = cutObjectIndex();
  const game = runningGame();
  const twin = runningGame();
  const world = game.ctx.dungeon.getData();
  check(installed(game) === installed(twin), 'the twin starts as the running game');

  let error: unknown = null;
  try {
    applySaveBytes(game, damaged);
  } catch (caught) {
    error = caught;
  }
  console.log(`  the read: ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : error}`);
  check(error instanceof SaveFileError, 'the read fails with the menu\'s SaveFileError');
  check(error instanceof Error && /ILLEGAL OBJECT INDIRECT INDEX/.test(error.message),
    'it fails on the cut index, in CheckMonsters\' walk of the world');
  check(game.ctx.dungeon.getData() === world, 'the running world is the same object');
  check(installed(game) === installed(twin), 'state, rules, signatures, overlay and deleteDuplicateTimers are unchanged');
  check(!game.isDead(), 'the game is not dead');

  play(game, 200);
  play(twin, 200);
  check(installed(game) === installed(twin), 'after 200 VBLs the game is still the twin\'s');
}

/* --------------------------------------------- 2. an error once installed ---- */

function checkStartError(): void {
  console.log('=== an error once the read is installed is die(0xbad) ===');
  const game = runningGame();
  const dies: unknown[] = [];
  Object.assign(game.ctx.host, { die: (error: unknown) => dies.push(error) });
  game.systems.monsters.reloadAfterSaveGame = () => {
    throw new Error('the level would not load');
  };

  let error: unknown = null;
  try {
    applySaveBytes(game, new Uint8Array(readFileSync(DAMAGED_FROM)));
  } catch (caught) {
    error = caught;
  }
  console.log(`  the read: ${error instanceof Error ? `${error.constructor.name}: ${error.message.replace(/\n/g, ' / ')}` : error}`);
  check(error instanceof Die && error.errorNum === 0xbad, 'the read throws die(0xbad)');
  check(error instanceof Die && error.message.includes('SAVED GAME DAMAGED!') && error.message.includes('the level would not load'),
    'its message is "SAVED GAME DAMAGED!" and the error');
  check(dies.length === 1 && dies[0] === error, 'the host is told once');
}

checkBuildError();
checkStartError();
finish();
