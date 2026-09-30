/**
 * A new game in place: `Game.readNewGame`, then `Game.resumeMainLoop`.
 *
 * After a lost game, the dungeon entrance's "enter" starts a new game without the page
 * being reloaded. CSBWin reads `dungeon.dat` into the same `d` it has just
 * cleared (`doc/CSBwin-src/Code1f9e6.cpp:302-310`, `SaveGame.cpp:1480-1494`); the port
 * restores a fresh world into the running `Game` the way a load does. What that could get
 * wrong while still looking like a new game: a door left open, a bones object left on the
 * floor, a timer left in the queue, the clock left where the old game stopped, or the loop
 * left shut.
 *
 * So a game is played — champions walk, all of them die, which drops their possessions
 * and leaves bones in the dungeon — and rebuilt, and its whole runtime state
 * (`getRuntimeSaveState`, the quick-save's snapshot: the party, the clock, every timer,
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
 * (`doc/CSBwin-src/SaveGame.cpp:1523-1532`), and `totalMoveCount`, a global outside `d`
 * (`data.cpp:253`), counts on from the lost game.
 *
 * And the page's boot, which builds its `Game` over the empty world and reads `dungeon.dat`
 * into it once ENTER is chosen: the empty world draws nothing from the random stream, so
 * the booted game is the one a `Game` built straight over the file would be.
 *
 * Run: `npx tsx tools/dump-new-game.ts`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader, emptyDungeonData } from '../src/data/DungeonLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { MovementAction } from '../src/engine';
import { applySaveBytes, buildSavePayload, encodeSavePayload } from '../src/engine/SaveGamePayload';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

const DUNGEON = readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'));
const SEED = 0x2468ace0;

/** A fresh parse: play writes into the `DungeonData` it runs on. */
function parse(): DungeonData {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(DUNGEON));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return data;
}

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

/** The runtime state, hashed without its wall-clock `savedAt` and `GAMEBLOCK1`. */
function stateHash(game: Game): string {
  const json = JSON.stringify(game.getRuntimeSaveState(), (key, value) =>
    key === 'savedAt' || key === 'block1' ? 0 : value);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/** The top-level parts of the runtime state that differ, to say where a mismatch is. */
function differingParts(a: Game, b: Game): string[] {
  const sa = a.getRuntimeSaveState() as unknown as Record<string, Record<string, unknown>>;
  const sb = b.getRuntimeSaveState() as unknown as Record<string, Record<string, unknown>>;
  const out: string[] = [];
  for (const part of ['party', 'game', 'dungeon']) {
    for (const key of Object.keys({ ...sa[part], ...sb[part] })) {
      if (key === 'block1') continue;
      if (JSON.stringify(sa[part]?.[key]) !== JSON.stringify(sb[part]?.[key])) out.push(`${part}.${key}`);
    }
  }
  return out;
}

/**
 * `d.RandomGameID` for a stream that is now at `seed` after the two draws: step the LCG
 * back twice (`0xbb40e62d` is odd, so it has an inverse mod 2^32) and redo them.
 */
function expectedGameID(seed: number): number {
  let inverse = 1;
  for (let i = 0; i < 32; i++) inverse = Math.imul(inverse, 2 - Math.imul(0xbb40e62d, inverse));
  const back = (s: number) => Math.imul((s - 11) >>> 0, inverse) >>> 0;
  const s0 = back(back(seed >>> 0));
  const s1 = (Math.imul(s0, 0xbb40e62d) + 11) >>> 0;
  const s2 = (Math.imul(s1, 0xbb40e62d) + 11) >>> 0;
  return ((((s1 >>> 8) & 0xffff)) * ((s2 >>> 8) & 0xffff)) >>> 0;
}

function runFrames(game: Game, from: number, count: number): void {
  for (let n = 1; n <= count; n++) game.runFrame(from + n * 250);
}

function main(): void {
  const fresh = newGame(parse(), stockGraphics());
  fresh.setRandomSeed(SEED);

  const played = newGame(parse(), stockGraphics());
  played.setRandomSeed(0x13579bdf);
  played.systems.hallOfChampions.addChampion(champion(0));
  played.systems.hallOfChampions.addChampion(champion(1));
  played.ctx.party.state.position = new Position(6, 14, 2);
  const t0 = 1_000_000;
  for (let n = 0; n < 40; n++) {
    if (n % 8 === 0) played.enqueueMovement(n % 16 === 0 ? MovementAction.TURN_LEFT : MovementAction.MOVE_FORWARD);
    played.runFrame(t0 + n * 250);
  }

  // `d.CanRestartFromSavegame`: cleared by a new game, set by a save and by a load
  // (doc/CSBwin-src/SaveGame.cpp:1494, :1260, :1883).
  console.log('=== d.CanRestartFromSavegame ===');
  const newAtFirst = played.canRestartFromSavegame();
  const bytes = encodeSavePayload(buildSavePayload(played));
  played.saveWritten();
  const loaded = newGame(parse(), stockGraphics());
  applySaveBytes(loaded, bytes);
  console.log(['new', newAtFirst, 'saved', played.canRestartFromSavegame(), 'loaded', loaded.canRestartFromSavegame()].join('\t'));
  check(!newAtFirst, 'a new game cannot be restarted');
  check(played.canRestartFromSavegame(), 'a saved one can');
  check(loaded.canRestartFromSavegame(), 'and so can a loaded one');
  loaded.readNewGame(parse());
  check(!loaded.canRestartFromSavegame(), 'until a new game is read into it');
  console.log('');

  played.systems.monsterAttack.killCharacter(0);
  played.systems.monsterAttack.killCharacter(1);
  runFrames(played, t0 + 40 * 250, 4);

  console.log('=== the game that was played ===');
  console.log(['tick', played.ctx.state.tickCount, 'returned', played.mainLoopHasReturned(), 'hash', stateHash(played)].join('\t'));
  check(played.mainLoopHasReturned(), 'the played game is lost, and its MainLoop has returned');
  check(stateHash(played) !== stateHash(fresh), 'and its world is not a new one');

  const lostBlock1 = { ...played.ctx.state.block1 };
  // The stream the rebuilt game's `d.RandomGameID` came from: the fresh parse's own
  // `Game`, whose seed `readNewGame` restores along with the rest.
  played.readNewGame(parse());
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
  const direct = newGame(parse(), stockGraphics());
  const directDraws = draws;
  draws = 0;
  const booted = newGame(emptyDungeonData(), stockGraphics());
  const emptyDraws = draws;
  const emptyID = booted.ctx.state.block1.randomGameID;
  booted.readNewGame(parse());
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
  const t1 = Date.now() + 1_000_000_000;
  runFrames(fresh, t1, 600);
  runFrames(played, t1, 600);
  const later = differingParts(fresh, played);
  console.log(['600 ticks on', 'fresh', stateHash(fresh), 'rebuilt', stateHash(played), 'differ', later.join(',') || '-'].join('\t'));
  check(fresh.ctx.state.tickCount === 600 && played.ctx.state.tickCount === 600, `both ran 600 ticks (${fresh.ctx.state.tickCount}, ${played.ctx.state.tickCount})`);
  check(stateHash(fresh) === stateHash(played), 'and are still the same game');

  finish();
}

main();
