/**
 * A new game in place: `Game.readNewGame`, then `Game.resumeMainLoop`.
 *
 * After a lost game, the dungeon entrance's "enter" starts a new game without the page
 * being reloaded. CSBWin reads `dungeon.dat` into the same `d` it has just
 * cleared (`doc/CSBwin-src/Code1f9e6.cpp:302-310`, `SaveGame.cpp:1579-1594`); the port
 * restores a fresh world into the running `Game` the way a load does. What that could get
 * wrong while still looking like a new game: a door left open, a bones object left on the
 * floor, a timer left in the queue, the clock left where the old game stopped, or the loop
 * left shut.
 *
 * So a game is played — champions walk, all of them die, which drops their possessions
 * and leaves bones in the dungeon — and rebuilt, and its whole runtime state
 * (`getRuntimeSaveState`: the party, the clock, every timer,
 * every cell and every database record) is compared with that of a `Game` that was never
 * played. Then both run 600 ticks and are compared again, which catches state the snapshot
 * does not carry but the game reads.
 *
 * Along the way, `d.CanRestartFromSavegame`, which decides whether the end of a lost game
 * offers "RESTART THIS GAME": clear in a new game, set by a save and by a load.
 *
 * `GAMEBLOCK1`'s fields (`GameState.block1`) are the one part a rebuilt game must *not*
 * share with a fresh one, so the whole-state comparison leaves them out and they are
 * checked on their own: `d.RandomGameID` is drawn again from the new game's stream
 * (`doc/CSBwin-src/SaveGame.cpp:1638-1647`), and `totalMoveCount`, a global outside `d`
 * (`data.cpp:254`), counts on from the lost game. A draw of 0 is drawn again, where
 * CSBWin keeps it (`DEBT.md` H): checked on a stream whose first pair of draws gives 0.
 *
 * And the page's boot, which builds its `Game` over the empty world and reads `dungeon.dat`
 * into it once ENTER is chosen: the empty world draws nothing from the random stream, so
 * the booted game is the one a `Game` built straight over the file would be.
 *
 * And a new game's databases: the file's records and `d.Byte7302`'s spares behind them,
 * which a save of the game declares and carries.
 *
 * Run: `npx tsx tools/dump-new-game.ts`
 */
import { createHash } from 'node:crypto';

import { CsbRandom } from '../src/core/random';
import { OBJECT_ID_NULL, Position } from '../src/core/types';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import type { Game } from '../src/engine/Game';
import { DATABASE_CATEGORY } from '../src/engine/DungeonState';
import { drawRandomGameID } from '../src/engine/GameContext';
import { MovementAction } from '../src/engine/gameTypes';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame, stockDungeon, stockGraphics, runVbl, TICK_DUE } from './lib/game';
import { testChampion } from './lib/champion';

const SEED = 0x2468ace0;

/** The runtime state, hashed without `GAMEBLOCK1`. */
function stateHash(game: Game): string {
  const json = JSON.stringify(game.getRuntimeSaveState(), (key, value) =>
    key === 'block1' ? 0 : value);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/** The top-level parts of the runtime state that differ, to say where a mismatch is. */
function differingParts(a: Game, b: Game): string[] {
  const sa = a.getRuntimeSaveState();
  const sb = b.getRuntimeSaveState();
  const out: string[] = [];
  for (const part of ['party', 'game', 'dungeon'] as const) {
    // The part's fields by name, to compare every one of them without naming it.
    const pa: Record<string, unknown> = { ...sa[part] };
    const pb: Record<string, unknown> = { ...sb[part] };
    for (const key of Object.keys({ ...pa, ...pb })) {
      if (key === 'block1') continue;
      if (JSON.stringify(pa[key]) !== JSON.stringify(pb[key])) out.push(`${part}.${key}`);
    }
  }
  return out;
}

/**
 * `d.RandomGameID` for a stream that is now at `seed` after the two draws: step the LCG
 * back twice (`0xbb40e62d` is odd, so it has an inverse mod 2^32) and redo them.
 */
function expectedGameID(seed: number): number {
  const s0 = lcgBack(lcgBack(seed >>> 0));
  const s1 = lcgNext(s0);
  const s2 = lcgNext(s1);
  return (lowWord(s1) * lowWord(s2)) >>> 0;
}

/** `d.RandomNumber`'s step (`doc/CSBwin-src/CSBCode.cpp:1192-1227`), and the step back. */
function lcgNext(seed: number): number {
  return (Math.imul(seed, 0xbb40e62d) + 11) >>> 0;
}

function lcgBack(seed: number): number {
  let inverse = 1;
  for (let i = 0; i < 32; i++) inverse = Math.imul(inverse, 2 - Math.imul(0xbb40e62d, inverse));
  return Math.imul((seed - 11) >>> 0, inverse) >>> 0;
}

/** The word a draw gives `RandomGameID`: `STRandom() & 0xffff`, bits 8-23 of the seed. */
function lowWord(seed: number): number {
  return (seed >>> 8) & 0xffff;
}

/**
 * A new game's databases: `ReadDatabases` sizes each at the file's records and
 * `d.Byte7302[db]` spares, cleared to link `RNnul` behind the file's
 * (`doc/CSBwin-src/SaveGame.cpp:2768-2776`, `data.cpp:774-802`), and the header says so.
 * A save of it declares and carries them; a load reads them as they are, with none added.
 */
function checkSpares(): void {
  console.log('=== a new game\'s databases: the file\'s records and Byte7302\'s spares ===');
  const file = stockDungeon().header.objectCounts;
  const { byte7302 } = gameTablesOf(stockGraphics());
  const game = newGame(stockDungeon(), stockGraphics());
  const data = game.ctx.dungeon.getData();
  const loaded = newGame(stockDungeon(), stockGraphics());
  applySaveBytes(loaded, buildSaveFile(game));
  const reloaded = loaded.ctx.dungeon.getData();
  for (const [key, database] of Object.entries(data.databases)) {
    const db = DATABASE_CATEGORY[key as keyof typeof data.databases];
    const want = file[db] + byte7302[db];
    const records = database.records as { nextObject: number }[];
    const spares = records.slice(file[db]);
    const reread = reloaded.databases[key as keyof typeof data.databases].records.length;
    console.log([key, 'file', file[db], 'spares', byte7302[db], 'new game', records.length,
      'header', data.header.objectCounts[db], 'saved and loaded', reread].join('\t'));
    check(records.length === want && data.header.objectCounts[db] === want && database.count === want,
      `${key}: ${want} records in the new game and its header`);
    check(spares.every((record) => record.nextObject === OBJECT_ID_NULL), `${key}: the spares are cleared`);
    check(reread === want && reloaded.header.objectCounts[db] === want, `${key}: its save declares them all`);
  }
  console.log('');
}

/**
 * A stream whose first pair of draws multiplies to 0: the seed before 0, whose two
 * draws are the low words of seeds 0 and 11. CSBWin would keep that 0; the port draws
 * the next pair (`drawRandomGameID`, `DEBT.md` H).
 */
function checkZeroDraw(): void {
  console.log('');
  console.log('=== a RandomGameID of 0 is drawn again ===');
  const seed = lcgBack(0);
  const s1 = lcgNext(seed);
  const s2 = lcgNext(s1);
  const s3 = lcgNext(s2);
  const s4 = lcgNext(s3);
  const second = (lowWord(s3) * lowWord(s4)) >>> 0;
  const stream = new CsbRandom(seed);
  const id = drawRandomGameID(stream);
  console.log(['seed', seed.toString(16), 'first pair', lowWord(s1), lowWord(s2), 'second pair', lowWord(s3), lowWord(s4),
    'id', id.toString(16), 'stream at', stream.getSeed().toString(16)].join('\t'));
  check(lowWord(s1) * lowWord(s2) === 0 && second !== 0, 'the stream\'s first pair of draws gives 0, and its second does not');
  check(id === second && stream.getSeed() === s4, 'the id is the second pair\'s product, four draws on');

  // And a new game on that stream, the host's `rand()` pinned to its seed.
  const random = Math.random;
  Math.random = () => seed / 0x100000000;
  const game = newGame(stockDungeon(), stockGraphics());
  Math.random = random;
  check(game.ctx.state.block1.randomGameID === second, 'a new game whose first two draws give 0 takes the next two');
}

/** `count` VBLs, a tick due in each. */
function runFrames(game: Game, count: number): void {
  for (let n = 1; n <= count; n++) runVbl(game, TICK_DUE);
}

function main(): void {
  const fresh = newGame(stockDungeon(), stockGraphics());
  fresh.setRandomSeed(SEED);

  const played = newGame(stockDungeon(), stockGraphics());
  played.setRandomSeed(0x13579bdf);
  played.systems.hallOfChampions.addChampion(testChampion(0));
  played.systems.hallOfChampions.addChampion(testChampion(1));
  played.ctx.party.state.position = new Position(6, 14, 2);
  for (let n = 0; n < 40; n++) {
    if (n % 8 === 0) played.enqueueMovement(n % 16 === 0 ? MovementAction.TURN_LEFT : MovementAction.MOVE_FORWARD);
    runVbl(played, TICK_DUE);
  }

  // `d.CanRestartFromSavegame`: cleared by a new game, set by a save and by a load
  // (doc/CSBwin-src/SaveGame.cpp:1594, :1358, :2087).
  console.log('=== d.CanRestartFromSavegame ===');
  const newAtFirst = played.canRestartFromSavegame();
  const bytes = buildSaveFile(played);
  played.saveWritten();
  const loaded = newGame(stockDungeon(), stockGraphics());
  applySaveBytes(loaded, bytes);
  console.log(['new', newAtFirst, 'saved', played.canRestartFromSavegame(), 'loaded', loaded.canRestartFromSavegame()].join('\t'));
  check(!newAtFirst, 'a new game cannot be restarted');
  check(played.canRestartFromSavegame(), 'a saved one can');
  check(loaded.canRestartFromSavegame(), 'and so can a loaded one');
  loaded.readNewGame(stockDungeon());
  check(!loaded.canRestartFromSavegame(), 'until a new game is read into it');
  console.log('');

  played.systems.monsterAttack.killCharacter(0);
  played.systems.monsterAttack.killCharacter(1);
  runFrames(played, 4);

  console.log('=== the game that was played ===');
  console.log(['tick', played.ctx.state.tickCount, 'returned', played.mainLoopHasReturned(), 'hash', stateHash(played)].join('\t'));
  check(played.mainLoopHasReturned(), 'the played game is lost, and its MainLoop has returned');
  check(stateHash(played) !== stateHash(fresh), 'and its world is not a new one');

  const lostBlock1 = { ...played.ctx.state.block1 };
  // The stream the rebuilt game's `d.RandomGameID` came from: the fresh parse's own
  // `Game`, whose seed `readNewGame` restores along with the rest.
  played.readNewGame(stockDungeon());
  const rebuiltSeed = played.getRuntimeSaveState().game.randomSeed;
  played.resumeMainLoop();
  played.setRandomSeed(SEED);

  console.log('');
  console.log('=== GAMEBLOCK1, lost game and rebuilt ===');
  const rebuilt = played.ctx.state.block1;
  console.log(['lost', `id ${lostBlock1.randomGameID.toString(16)}`, `moves ${lostBlock1.totalMoveCount}`,
    'rebuilt', `id ${rebuilt.randomGameID.toString(16)}`, `moves ${rebuilt.totalMoveCount}`].join('\t'));
  check(lostBlock1.totalMoveCount === 5,
    `the lost game counted its five dequeued moves (${lostBlock1.totalMoveCount})`);
  check(rebuilt.totalMoveCount === lostBlock1.totalMoveCount, 'and the new game counts on from them');
  check(rebuilt.word22592 === 13 && rebuilt.word22594 === 1 && rebuilt.word22596 === 2 &&
    rebuilt.word22598 === 1 && rebuilt.byte22808.every((b) => b === 0),
    'its four words are _ReadEntireGame\'s 13, 1, 2, 1 and Byte22808 is zero');
  check(rebuilt.randomGameID === expectedGameID(rebuiltSeed),
    'its RandomGameID is the product of two draws of its stream');

  console.log('');
  console.log('=== rebuilt, against a Game never played ===');
  const diff = differingParts(fresh, played);
  console.log(['fresh', stateHash(fresh), 'rebuilt', stateHash(played), 'differ', diff.join(',') || '-'].join('\t'));
  check(stateHash(fresh) === stateHash(played), 'the rebuilt game is a new game: the whole runtime state matches');
  check(!played.mainLoopHasReturned(), 'and its MainLoop runs again');

  // The page's boot: a `Game` over the empty world, `d.Initialize()`'s, which draws
  // nothing from the stream, and `dungeon.dat` read into it after ENTER. With the host's
  // `rand()` pinned, as `tools/probe-frames.mjs` pins it, its first draw is the one a
  // `Game` built straight over the file takes.
  console.log('');
  console.log('=== the boot: the empty world, then dungeon.dat ===');
  const random = Math.random;
  let draws = 0;
  Math.random = () => (++draws, 0.6180339887);
  const direct = newGame(stockDungeon(), stockGraphics());
  const directDraws = draws;
  draws = 0;
  const booted = newGame(emptyDungeonData(), stockGraphics());
  const emptyDraws = draws;
  const emptyID = booted.ctx.state.block1.randomGameID;
  booted.readNewGame(stockDungeon());
  const bootDraws = draws;
  Math.random = random;
  const bootDiff = differingParts(direct, booted);
  console.log(['host rand() draws', 'direct', directDraws, 'empty world', emptyDraws, 'then read', bootDraws,
    'RandomGameID', direct.ctx.state.block1.randomGameID.toString(16), booted.ctx.state.block1.randomGameID.toString(16),
    'differ', bootDiff.join(',') || '-'].join('\t'));
  check(emptyDraws === 0 && emptyID === 0, 'the empty world draws nothing: no RandomGameID before a read');
  check(directDraws === 1 && bootDraws === 1, 'the read seeds the stream once, as a Game built over the file does');
  check(booted.ctx.state.block1.randomGameID === direct.ctx.state.block1.randomGameID && stateHash(booted) === stateHash(direct),
    'and the booted game is that game, RandomGameID and the whole runtime state');

  // Later than any frame the played game ran, so both take a tick on every frame.
  runFrames(fresh, 600);
  runFrames(played, 600);
  const later = differingParts(fresh, played);
  console.log(['600 ticks on', 'fresh', stateHash(fresh), 'rebuilt', stateHash(played), 'differ', later.join(',') || '-'].join('\t'));
  check(fresh.ctx.state.tickCount === 600 && played.ctx.state.tickCount === 600, `both ran 600 ticks (${fresh.ctx.state.tickCount}, ${played.ctx.state.tickCount})`);
  check(stateHash(fresh) === stateHash(played), 'and are still the same game');

  checkSpares();
  checkZeroDraw();
  finish();
}

main();
