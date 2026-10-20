/**
 * The party move filter (`CallPartyMoveFilter`, `doc/CSBwin-src/CSBCode.cpp:7875-7935`),
 * at its three sites, with two DSAs on its square, against a genuine save (`csbgame7.dat`).
 * Only the first DSA runs (`break`, `:7929`), on parameters of its own (`NEWDSAPARAMETERS`,
 * `:7892`), a count of 13 and `PARTYMOVEDATA`'s longwords (`:7922-7923`), and the move
 * obeys the block it leaves (`:7926`).
 *
 * 1. **A dungeon with no filter**: a step costs stamina and sets the move delay.
 * 2. **`PM_ATTEMPTMOVE`** (`:8191-8208`): the step's block, whose `toLocation` is the
 *    party's square, and four stamina adjustments, -1 past the party. The second DSA does
 *    not run, and the caller's parameters are as they were after it.
 * 3. **`PM_INHIBITMOVE`** refuses the step: the party stays, pays nothing, and the input
 *    is not discarded (`:8207`).
 * 4. **The stamina adjustments** the filter leaves are what each champion pays, and
 *    **`PM_SETDELAY`** sets the delay (`:8210-8222`, `:8431`), even for a step into a wall.
 * 5. **`PM_ADDDELAY`** adds its delay to the one the party had (`:8425-8428`).
 * 6. **`PM_BEGINTURN`** (`_TurnParty`, `:7957-7981`): either turn's `toLocation` faces left
 *    of the party, and a refusal turns nothing and flashes no arrow.
 * 7. **`PM_STAIRWAY`** (`TraverseStairway`, `:7838-7858`): a step into stairs runs the
 *    filter twice, and the stairway's block has the stairs and the square past them.
 * 8. A filter that refuses only the stairway leaves the party on the stairs.
 * 9. **A move down** (`0x1124`, `:8091-8093`, `:8255-8308`) from a pit: `PM_ATTEMPTMOVE`
 *    sees the button, `absDirection` 4 and a stone destination; then `PM_STAIRWAY` sees
 *    `UpOrDown + 2`, 2, and the party keeps its facing.
 * 10. **A gravity step** (`gravityMove` set, `:8128-8165`): `absDirection` stays -1 and the
 *    move history is left alone. A dungeon without `bGravityGame` never starts a slide.
 *
 * Run: `npm test -- --only=dump-party-move-filter.ts`
 */
import { readFileSync } from 'node:fs';

import { Position, RoomType, locationRelToInteger } from '../src/core/types';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { MovementAction, type MovementResult } from '../src/engine/gameTypes';
import { UNSET, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';
import { savePath } from './lib/saves';

/** `ESL_PARTYMOVEFILTER` (`doc/CSBwin-src/CSB.h:1552`). */
const ESL_PARTYMOVEFILTER = 14;
const WORDS = 13;

/** `GLOBALFETCH` (`doc/CSBwin-src/DSA.cpp`, `DsaCommand.GLOBALFETCH`). */
const globalFetch = (index: number): number => 19 | (index << 6);

/**
 * The count and the 13 parameters into globals `to` on, into variables 10-22, and one
 * more call counted in global 90.
 */
const report = (to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: WORDS }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
  globalFetch(90), op(StkOp.ONE_PLUS), globalStore(90),
];
/** Variable `v` set to `value`. */
const set = (v: number, value: number): number[] => [...int(value), varStore(v)];
/** The 13 variables back into the parameters. */
const store = [...int(WORDS), ...int(10), op(StkOp.PARAM_STORE)];

/**
 * A game on `csbgame7.dat`, or on `file`, whose filter's first DSA runs `program`; its
 * second reports into globals 50 on.
 */
function filtered(program: number[], file?: Uint8Array): Game {
  const game = withFilterDsas(ESL_PARTYMOVEFILTER, [program, report(50)], undefined, file);
  const g = game.systems.dsa.getGlobalVariables();
  g[90] = 0;
  game.systems.dsa.setGlobalVariables(g);
  return game;
}

/** The party's `LOCATIONREL` integer. */
function here(game: Game, facing = game.ctx.party.state.facing): number {
  const p = game.ctx.party.state.position;
  return locationRelToInteger({ l: p.z, x: p.x, y: p.y, p: facing });
}

const at = (p: Position): string => `(${p.x}, ${p.y}) on level ${p.z}`;
const DELTA = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const roomAt = (game: Game, p: Position): number => (game.ctx.dungeon.getCellFlag(p) >> 5) & 7;

/** The party turned to face an open square (or a stone one), a step ahead. */
function face(game: Game, room: RoomType): void {
  const p = game.ctx.party.state.position;
  for (let facing = 0; facing < 4; facing++) {
    if (roomAt(game, new Position(p.x + DELTA[facing]![0]!, p.y + DELTA[facing]![1]!, p.z)) === room) {
      game.ctx.party.setFacing(facing);
      return;
    }
  }
  throw new Error(`no ${room} square beside the party`);
}

/** The party moved beside stairs on its level, facing them. */
function besideStairs(game: Game): Position {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  const map = dungeon.getMap(z)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const stairs = new Position(x, y, z);
      if (roomAt(game, stairs) !== RoomType.STAIRS) continue;
      for (let facing = 0; facing < 4; facing++) {
        const from = new Position(x - DELTA[facing]![0]!, y - DELTA[facing]![1]!, z);
        if (roomAt(game, from) !== RoomType.OPEN) continue;
        game.ctx.party.state.position = from;
        game.ctx.party.setFacing(facing);
        return stairs;
      }
    }
  }
  throw new Error('no stairs with an open square beside them');
}

function stamina(game: Game): number[] {
  return game.ctx.party.state.champions.map((c) => c.attributes.stamina);
}

/** `game.move(action)`, and the result `onMove` was given. */
function move(game: Game, action: MovementAction): MovementResult {
  let result: MovementResult | undefined;
  game.onMove((_, r) => { result = r; });
  game.move(action);
  return result!;
}

/* ------------------------------- 1. no filter ----------------------------------- */
{
  const game = withFilterDsas(ESL_PARTYMOVEFILTER, []);
  face(game, RoomType.OPEN);
  const before = stamina(game);
  const result = move(game, MovementAction.MOVE_FORWARD);
  const after = stamina(game);
  const delay = game.ctx.party.state.partyMoveDisableTimer;
  console.log(`1. no filter: stepped ${result.success}, stamina [${before.join(', ')}] -> [${after.join(', ')}], delay ${delay}`);
  check(result.success && after.every((s, i) => s < before[i]!) && delay > 0, 'the step costs stamina and sets the delay');
}

/* ------------------------------- 2. PM_ATTEMPTMOVE ------------------------------ */
for (const file of [undefined, new Uint8Array(readFileSync(savePath('csbgame-early-1hero.dat')))]) {
  const game = filtered(report(0), file);
  face(game, RoomType.OPEN);
  const party = game.ctx.party.state;
  const from = here(game);
  const flags = game.ctx.dungeon.getCellFlag(party.position);
  const dsa = game.systems.dsa;
  dsa.setParameters(2, [111, 222]);
  const result = move(game, MovementAction.STRAFE_RIGHT);
  const g = dsa.getGlobalVariables();
  const block = g.slice(0, 1 + WORDS);
  const champions = party.champions.length;
  console.log(`2. strafe right: the filter saw [${block.join(', ')}], ${champions} champions; stepped ${result.success}`);
  check(block[0] === WORDS && block[1] === 3 && block[2] === 0 && block[3] === 0,
    'a count of 13, PM_ATTEMPTMOVE, flags 0, delay 0');
  check(block.slice(4, 8).every((s, i) => (i < champions ? s > 0 : s === -1)),
    `a stamina adjustment for each of ${champions} champions, -1 past the party`);
  check(block[8] === 4 && block[9] === ((1 + (from >> 16)) & 3), 'relDirection the button, 4, absDirection the facing plus 1 (CSBCode.cpp:8197-8198)');
  check(block[10] === from && block[11] === from, 'fromLocation and toLocation are both the party\'s square');
  check(block[12] === ((flags >> 5) & 7), 'fromLocationType is the party\'s room type');
  check(g[50] === UNSET && g[90] === 1, 'only the first DSA runs, once');
  check(dsa.getParameter(0) === 111 && dsa.getParameter(1) === 222, 'the caller\'s parameters are as they were');
}

/* ------------------------------- 3. PM_INHIBITMOVE ------------------------------ */
{
  const game = filtered([...report(0), ...set(11, 1), ...store]);
  face(game, RoomType.OPEN);
  const party = game.ctx.party.state;
  const position = party.position;
  const before = stamina(game);
  party.partyMoveDisableTimer = 0;
  game.ctx.mouseQueue.enqueueUnClick();
  const result = move(game, MovementAction.MOVE_FORWARD);
  console.log(`3. refused: stepped ${result.success}, refused ${result.refused}, at ${at(party.position)}, stamina [${stamina(game).join(', ')}], delay ${party.partyMoveDisableTimer}, queue ${game.ctx.mouseQueue.count()}, clockTick ${game.ctx.loop.clockTick}`);
  check(!result.success && result.refused === true && !result.inhibited, 'the step is refused, not inhibited');
  check(party.position === position, 'the party stays');
  check(stamina(game).join() === before.join() && party.partyMoveDisableTimer === 0, 'nobody pays, and no delay');
  check(game.ctx.mouseQueue.count() === 1 && game.ctx.loop.clockTick, 'the input is kept, and the tick comes on');
}

/* ------------------------------- 4. stamina and PM_SETDELAY --------------------- */
for (const room of [RoomType.OPEN, RoomType.STONE]) {
  const game = filtered([...report(0), ...set(11, 2), ...set(12, 17), ...set(13, 5), ...set(14, -3), ...store]);
  face(game, room);
  const before = stamina(game);
  const result = move(game, MovementAction.MOVE_FORWARD);
  const after = stamina(game);
  const delay = game.ctx.party.state.partyMoveDisableTimer;
  console.log(`4. set delay 17, champion 0 pays 5, champion 1 -3, ${room === RoomType.OPEN ? 'a step' : 'into a wall'}: stepped ${result.success}, stamina [${before.join(', ')}] -> [${after.join(', ')}], delay ${delay}`);
  check(after[0] === before[0]! - 5 && after[1] === Math.min(before[1]! + 3, game.ctx.party.state.champions[1]!.attributes.maxStamina),
    'each champion pays what the filter left');
  check(delay === 17, 'the delay is the filter\'s');
  check(result.success === (room === RoomType.OPEN), room === RoomType.OPEN ? 'the party steps' : 'the wall stops the party');
}

/* ------------------------------- 5. PM_ADDDELAY --------------------------------- */
{
  const reference = withFilterDsas(ESL_PARTYMOVEFILTER, []);
  face(reference, RoomType.OPEN);
  reference.move(MovementAction.MOVE_FORWARD);
  const time2move = reference.ctx.party.state.partyMoveDisableTimer;

  const game = filtered([...report(0), ...set(11, 4), ...set(12, 5), ...store]);
  face(game, RoomType.OPEN);
  game.ctx.party.state.partyMoveDisableTimer = 3;
  move(game, MovementAction.MOVE_FORWARD);
  const delay = game.ctx.party.state.partyMoveDisableTimer;
  console.log(`5. add delay 5 to 3: delay ${delay} (without the filter, ${time2move})`);
  check(delay === 8, 'the filter\'s delay is added to the party\'s');
}

/* ------------------------------- 6. PM_BEGINTURN -------------------------------- */
for (const [action, direction] of [[MovementAction.TURN_LEFT, 1], [MovementAction.TURN_RIGHT, 2]] as const) {
  const game = filtered(report(0));
  const party = game.ctx.party.state;
  const facing = party.facing;
  const room = roomAt(game, party.position);
  const result = move(game, action);
  const block = game.systems.dsa.getGlobalVariables().slice(0, 1 + WORDS);
  console.log(`6. turn ${direction === 1 ? 'left' : 'right'} from ${facing}: the filter saw [${block.join(', ')}]; facing ${party.facing}`);
  check(block[0] === WORDS && block[1] === 1 && block[2] === 0, 'a count of 13, PM_BEGINTURN, flags 0');
  check(block[8] === direction && block[9] === direction, `both directions ${direction}`);
  check(block[10] === here(game, facing) && block[11] === here(game, (facing + 3) & 3),
    'fromLocation faces the party\'s way, toLocation the way to its left');
  check(block[12] === room && block[13] === room, 'both room types are the party\'s');
  check(result.success && party.facing === (facing + (direction === 1 ? 3 : 1)) % 4, 'the party turns');
}
{
  const game = filtered([...report(0), ...set(11, 1), ...store]);
  const party = game.ctx.party.state;
  const facing = party.facing;
  game.ctx.loop.flashChanged = false;
  const result = move(game, MovementAction.TURN_RIGHT);
  console.log(`6. refused turn: refused ${result.refused}, facing ${facing} -> ${party.facing}, flashed ${game.ctx.loop.flashChanged}`);
  check(result.refused === true && party.facing === facing, 'the party does not turn');
  check(!game.ctx.loop.flashChanged, 'no arrow flashes');
}

/* ------------------------------- 7, 8. PM_STAIRWAY ------------------------------ */
{
  const game = filtered(report(0));
  const stairs = besideStairs(game);
  const party = game.ctx.party.state;
  const facing = party.facing;
  const up = (game.ctx.dungeon.getCellFlag(stairs) & 4) !== 0;
  const result = move(game, MovementAction.MOVE_FORWARD);
  const g = game.systems.dsa.getGlobalVariables();
  const block = g.slice(0, 1 + WORDS);
  const next = result.newPosition!;
  const to = locationRelToInteger({ l: next.z, x: next.x, y: next.y, p: facing });
  const from = locationRelToInteger({ l: stairs.z, x: stairs.x, y: stairs.y, p: facing });
  console.log(`7. a step into stairs ${up ? 'up' : 'down'} at ${at(stairs)}: ${g[90]} filter calls, the last saw [${block.join(', ')}]; to level ${game.ctx.loop.newPartyLevel}`);
  check(g[90] === 2, 'the filter runs for the step, then for the stairway');
  check(block[0] === WORDS && block[1] === 2 && block[2] === 0, 'a count of 13, PM_STAIRWAY, flags 0');
  check(block[8] === (up ? 6 : 2) && block[9] === block[8], 'both directions are UpOrDown + 2: 6 up, 2 down');
  check(block[10] === from && block[11] === to, 'fromLocation is the stairs, toLocation the square past them, both facing the party\'s way');
  check(block[12] === RoomType.STAIRS && block[13] === RoomType.STAIRS, 'both room types are the stairs\'');
  check(result.success && game.ctx.loop.newPartyLevel === next.z && next.z !== stairs.z, 'the party takes the stairs');
}
{
  // Flags `moveType + 1`: 4 for the step, which a stairway ignores, and 3 for the stairway,
  // `PM_INHIBITMOVE | PM_SETDELAY`.
  const game = filtered([...report(0), varFetch(10), op(StkOp.ONE_PLUS), varStore(11), ...store]);
  const stairs = besideStairs(game);
  const party = game.ctx.party.state;
  const before = stamina(game);
  const result = move(game, MovementAction.MOVE_FORWARD);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`8. the stairway refused: ${g[90]} filter calls, the party at ${at(party.position)}, to level ${game.ctx.loop.newPartyLevel}; stamina [${before.join(', ')}] -> [${stamina(game).join(', ')}]`);
  check(g[90] === 2 && g[1] === 2, 'the stairway\'s filter call refuses');
  check(!result.success && !result.refused, 'the step is not refused, the stairway is');
  check(party.position.x === stairs.x && party.position.y === stairs.y && party.position.z === stairs.z, 'the party is left on the stairs');
  check(game.ctx.loop.newPartyLevel === -1, 'no new level');
  check(stamina(game).every((s, i) => s < before[i]!), 'the step was paid for');
}

/* ------------------------------- 9. a move down --------------------------------- */
/** The party on the first pit with a level below, its level loaded, facing north. */
function onPit(game: Game): Position {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; dungeon.getMap(z); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const pit = new Position(x, y, z);
        if (roomAt(game, pit) !== RoomType.PIT || dungeon.incrementLevel(pit, 1) === null) continue;
        game.ctx.party.state.position = pit;
        game.systems.monsters.loadPartyLevel(z);
        game.ctx.party.setFacing(0);
        return pit;
      }
    }
  }
  throw new Error('no pit with a level below');
}
{
  const game = filtered([...report(0), ...set(11, 1), ...store]);
  const pit = onPit(game);
  const from = here(game);
  const result = move(game, MovementAction.MOVE_DOWN);
  const g = game.systems.dsa.getGlobalVariables();
  const block = g.slice(0, 1 + WORDS);
  console.log(`9. a move down from the pit at ${at(pit)}, refused: ${g[90]} filter call, it saw [${block.join(', ')}]`);
  check(g[90] === 1 && block[1] === 3 && result.refused === true, 'one call, PM_ATTEMPTMOVE, which refuses');
  check(block[8] === 0x1124 && block[9] === 4, 'relDirection the button, 0x1124, absDirection 4 (CSBCode.cpp:8143, :8198)');
  check(block[10] === from && block[11] === from && block[12] === RoomType.PIT && block[13] === RoomType.STONE,
    'both locations the party\'s square, from a pit to stone (:8118-8122)');
}
{
  const game = filtered(report(0));
  const pit = onPit(game);
  const below = game.ctx.dungeon.incrementLevel(pit, 1)!;
  const result = move(game, MovementAction.MOVE_DOWN);
  const g = game.systems.dsa.getGlobalVariables();
  const block = g.slice(0, 1 + WORDS);
  const from = locationRelToInteger({ l: pit.z, x: pit.x, y: pit.y, p: 0 });
  const to = locationRelToInteger({ l: below.z, x: below.x, y: below.y, p: 0 });
  console.log(`   let through: ${g[90]} filter calls, the last saw [${block.join(', ')}]; to level ${game.ctx.loop.newPartyLevel}, facing ${game.ctx.party.state.facing}`);
  check(g[90] === 2 && block[1] === 2, 'the filter runs for the move, then PM_STAIRWAY');
  check(block[8] === 2 && block[9] === 2, 'both directions are UpOrDown + 2: 2, down');
  check(block[10] === from && block[11] === to && block[12] === RoomType.PIT && block[13] === RoomType.STAIRS,
    'from the pit to the square below, a stairway\'s 3');
  check(result.success && game.ctx.loop.newPartyLevel === below.z && game.ctx.party.state.facing === 0,
    'the party goes down, still facing north (TraverseStairway(0, false))');
}

/* ------------------------------- 10. a gravity step ----------------------------- */
{
  const game = filtered(report(0));
  face(game, RoomType.OPEN);
  game.ctx.loop.gravityMove = true;
  const history = [...game.ctx.loop.moveHistory];
  move(game, MovementAction.MOVE_FORWARD);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`10. a step while gravityMove is set: relDirection ${g[8]}, absDirection ${g[9]}, history {${game.ctx.loop.moveHistory.join(',')}}`);
  check(g[8] === 3 && g[9] === -1, 'relDirection the button, 3, absDirection -1 (CSBCode.cpp:8061)');
  check(game.ctx.loop.moveHistory.join() === history.join(), 'the history is left alone');

  const plain = filtered(report(0));
  face(plain, RoomType.OPEN);
  move(plain, MovementAction.MOVE_FORWARD);
  console.log(`    the same step in csbgame7.dat: gravityMove ${plain.ctx.loop.gravityMove}, history {${plain.ctx.loop.moveHistory.join(',')}}`);
  check(!plain.ctx.rules.bGravityGame && !plain.ctx.loop.gravityMove, 'without bGravityGame, a step starts no slide');
}

finish();
