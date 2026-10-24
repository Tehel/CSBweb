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
 * 2. **A save is held against its world** (`validateCsbwinWorld`) before the read builds:
 *    `csbgame7.dat` rewritten with the party on level 40, or at x 32, five champions, the
 *    hand or the magic caster on a fifth, the object in hand past the object index, more
 *    timers than the table, the first free timer or a queued one past it. CSBWin checks
 *    none of them; each is refused, and the running game is still its twin's. A slot inside
 *    `numCharacter` that holds no champion is read as one, as CSBWin plays it: with slot 1
 *    cleared, the party is still four, the hand's champion, 2, the file's third, and it plays.
 * 3. **An error once it is installed ends the game.** The party's level loaded
 *    (`reloadAfterSaveGame`) is made to throw: the read is `die(0xbad)`, "SAVED GAME
 *    DAMAGED!" and the error, not a message over a game half read.
 * 4. **A read in play starts clean**, as CSBWin's every read, at the boot or the restart,
 *    ends in `DiscardAllInput` (`doc/CSBwin-src/CSBCode.cpp:10808`, `Code1f9e6.cpp:321`):
 *    a game holding a script, its first `VBLDelay` a hundred VBLs long, and a key, a
 *    click and its button-up queued, reads `csbgame7.dat`. No script holds the loop, the
 *    queue is empty, and the read game plays 200 VBLs, the script's step never run.
 *
 * Run: `npm test -- --only=damaged-read.ts`
 */
import { readFileSync } from 'node:fs';

import { readCsbwinCharacter } from '../../src/data/CsbwinCharacters';
import { loadCsbwinWorld, type CsbwinWorld } from '../../src/data/CsbwinDungeonImage';
import { buildDungeonImage } from '../../src/data/CsbwinDungeonImageWriter';
import { objectIndexOf } from '../../src/data/CsbwinObjectIndex';
import { CHARDESC_SIZE } from '../../src/data/CsbwinSaveInfo';
import { saveSaveGameState, type Block2, type SaveGameState } from '../../src/data/SaveGameLoader';
import { Die } from '../../src/core/Die';
import type { Game } from '../../src/engine/Game';
import type { LoopScript } from '../../src/engine/LoopState';
import { SaveFileError, applySaveBytes } from '../../src/engine/SaveGameFile';
import { check, finish } from '../lib/check';
import { TICK_DUE, runVbl, stockGame } from '../lib/game';
import { savePath } from '../lib/saves';

const DAMAGED_FROM = savePath('csbgame7.dat');

/** `csbgame7.dat` written again, its state as `edit` makes it. */
function rewritten(edit: (save: SaveGameState, world: CsbwinWorld) => SaveGameState): Uint8Array {
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(DAMAGED_FROM)));
  const save = world.save;
  return saveSaveGameState(edit({
    ...save,
    objectIndex: objectIndexOf(world.dungeon.rnMaps),
    dungeonImage: buildDungeonImage(world.dungeon, {
      indirectText: save.indirectText ?? false,
      bigActuators: save.bigActuators ?? false,
      newScrolls: (save.version ?? 0) >= 0x42,
    }),
  }, world));
}

/** `csbgame7.dat` written again with its object index cut to a quarter of its slots. */
function cutObjectIndex(): Uint8Array {
  return rewritten((save) => {
    const index = save.objectIndex!;
    const length = index.length >> 2;
    return { ...save, objectIndex: { length, typeMap: index.typeMap.slice(0, length), indexMap: index.indexMap.slice(0, length) } };
  });
}

/** `csbgame7.dat` written again with these fields of `GAMEBLOCK2`. */
function withBlock2(fields: Partial<Block2>): Uint8Array {
  return rewritten((save) => ({ ...save, ...fields, block2: { ...save.block2!, ...fields } }));
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

/* ------------------------------------- 2. a save held against its world ---- */

function checkWorldHeld(): void {
  console.log('=== a save is held against its world before the read builds ===');
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(DAMAGED_FROM)));
  const { maxTimers } = world.save.block2!;
  const queue = world.save.timerQueue!;
  const cases: Array<{ what: string; bytes: Uint8Array; refused: RegExp }> = [
    { what: 'the party on level 40', bytes: withBlock2({ partyLevel: 40 }), refused: /ON LEVEL 40, OF LEVELS 0 TO 13/ },
    { what: 'the party at x 32', bytes: withBlock2({ partyX: 32 }), refused: /AT 32,23, ON A LEVEL OF/ },
    { what: 'five champions', bytes: withBlock2({ numCharacter: 5 }), refused: /THE PARTY IS 5 CHAMPIONS/ },
    { what: 'the hand on champion 4', bytes: withBlock2({ handChar: 4 }), refused: /THE HAND IS CHAMPION 4, OF 4/ },
    { what: 'the magic caster on champion 4', bytes: withBlock2({ magicCaster: 4 }), refused: /THE MAGIC CASTER IS CHAMPION 4, OF 4/ },
    {
      what: 'the object in hand past the object index',
      bytes: withBlock2({ objectInHand: world.dungeon.rnMaps.length }),
      refused: new RegExp(`THE OBJECT IN HAND, ${world.dungeon.rnMaps.length}, NAMES NO RECORD`),
    },
    {
      what: 'more timers than the table',
      bytes: rewritten((save) => ({ ...save, timerQueue: [...queue, ...Array.from({ length: maxTimers + 1 - queue.length }, () => 0)] })),
      refused: new RegExp(`THE TIMER QUEUE IS ${maxTimers + 1} TIMERS, OF ${maxTimers}`),
    },
    { what: 'the first free timer past the table', bytes: withBlock2({ firstAvailTimer: maxTimers + 1 }), refused: /THE FIRST FREE TIMER IS/ },
    {
      what: 'a queued timer past the table',
      bytes: rewritten((save) => ({ ...save, timerQueue: [maxTimers, ...queue.slice(1)] })),
      refused: new RegExp(`THE TIMER QUEUE NAMES TIMER ${maxTimers}, OF ${maxTimers}`),
    },
  ];

  const game = runningGame();
  const twin = installed(runningGame());
  for (const { what, bytes, refused } of cases) {
    let error: unknown = null;
    try {
      applySaveBytes(game, bytes);
    } catch (caught) {
      error = caught;
    }
    console.log(`  ${what}: ${error instanceof Error ? error.message : error}`);
    check(error instanceof SaveFileError && refused.test(error.message), `${what} is refused, and says so`);
    check(installed(game) === twin && !game.isDead(), `${what} leaves the running game as it was`);
  }

  // Slot 1 cleared, as `AddCharacter` leaves a slot it has not filled (`Character.cpp:479`).
  const block = world.save.characterBlock!;
  const names = [0, 1, 2, 3].map((i) => readCsbwinCharacter(block, i).champion.name);
  const cleared = rewritten((save) => {
    const characters = save.characterBlock!.slice();
    characters.fill(0, CHARDESC_SIZE, 2 * CHARDESC_SIZE);
    return { ...save, characterBlock: characters, handChar: 2, block2: { ...save.block2!, handChar: 2 } };
  });
  const read = stockGame();
  applySaveBytes(read, cleared);
  const party = read.ctx.party.state;
  console.log(`  slot 1 cleared: ${party.champions.map((c) => JSON.stringify(c.name)).join(', ')}, the hand ${party.cursorOwner}`);
  check(party.champions.length === 4 && party.champions[1].name === '', 'the cleared slot is still a champion of the party');
  check(party.cursorOwner === 2 && party.champions[2].name === names[2], `the hand is still ${names[2]}, the file's third`);
  play(read, 200);
  check(!read.isDead() && read.ctx.party.state.champions.length === 4, 'and it plays 200 VBLs, four champions still');
}

/* --------------------------------------------- 3. an error once installed ---- */

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

/* ------------------------------------------- 4. a read in play starts clean ---- */

function checkStartsClean(): void {
  console.log('=== a read in play starts clean: no script, no input ===');
  const game = runningGame();
  let scriptRanOn = false;
  function* held(): LoopScript {
    yield 100;
    scriptRanOn = true;
  }
  game.runScript(held());
  game.enqueueKeyButton(1);
  game.onMouseClick(100, 100, 1);
  game.onMouseUnClick();
  console.log(`  before the read: a script ${game.isRunningScript() ? 'holds' : 'does not hold'} the loop, ${game.ctx.mouseQueue.count()} entries queued`);
  check(game.isRunningScript() && game.ctx.mouseQueue.count() === 3, 'the script holds the loop, and three entries wait');

  applySaveBytes(game, new Uint8Array(readFileSync(DAMAGED_FROM)));
  console.log(`  after the read: a script ${game.isRunningScript() ? 'holds' : 'does not hold'} the loop, ${game.ctx.mouseQueue.count()} entries queued`);
  check(!game.isRunningScript(), 'no script holds the loop');
  check(game.ctx.mouseQueue.count() === 0, 'the queue is empty');

  play(game, 200);
  check(!game.isDead() && !scriptRanOn, 'the read game plays 200 VBLs, the dropped script never resumed');
}

checkBuildError();
checkWorldHeld();
checkStartError();
checkStartsClean();
finish();
