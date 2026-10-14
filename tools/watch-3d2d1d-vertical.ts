/**
 * 3D2D1D's moves down and up, on the real dungeon: buttons
 * `0x1124` and `0x1125` queued as the `-` and `=` keys queue them (`TAG0196da`,
 * `doc/CSBwin-src/CSBCode.cpp:8575-8595`), taken by `HandleMouseEvents` with the other
 * moves (`Mouse.cpp:1695-1709`) and played by `MoveParty`'s `direction > 3` arm
 * (`CSBCode.cpp:8255-8308`). Gravity is off here (`bGravityGame`), so each move is
 * one move: `tools/watch-3d2d1d-gravity.ts` has the slides.
 *
 * 1. **Down a shaft**: from map 1's fake pit (1,1) to (1,1) on map 2, the facing kept
 *    (`TraverseStairway(0, false)`), the step's stamina paid and nobody hurt. The new
 *    level throws the input away, as stairs do (`tag0006a4`, `:634`).
 * 2. **Up a shaft**: from map 2 (1,1) into the fake pit above, where the party stands
 *    without falling (`Code11f52.cpp:3050-3055`).
 * 3. **Up into stone**, map 0 (1,1): the wall bump, `DamageCharacter(ch, 1, 24, 2)` on
 *    one or two champions, 2 HP each with no armour (`Character.cpp:2785-2794`), sound
 *    18, and the input discarded (`:8309-8401`).
 * 4. **Down from a floor**: only a pit under the party lets it down (`:8269-8284`).
 * 5. **Up from the top level**: no level above is stone (`:8262-8268`).
 * 6. **A monster below**: the move is refused, silently, the input kept (`:8286-8291`).
 * 7. **No champion**: stone refuses the move and keeps the input (`:8392-8395`).
 * 8. **The route's first shaft**, map 0 (7,7) down to map 1.
 *
 * Run: `npx tsx tools/watch-3d2d1d-vertical.ts`
 */
import { readFileSync } from 'node:fs';

import { emptyDungeonData } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Position, RoomType } from '../src/core/types';
import type { Game } from '../src/engine/Game';
import { MovementAction } from '../src/engine/gameTypes';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { createMonsterAt } from './lib/createMonster';
import { newGame, runVbl, TICK_DUE } from './lib/game';
import { wrapMember } from './lib/standIn';

const DIR = 'static/gamefiles/3D2D1D';
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(`${DIR}/${name}`));
const graphics = new GraphicsLoader();
graphics.loadFromArray(read('graphics.dat'));

const at = (p: Position): string => `map ${p.z} (${p.x},${p.y})`;
const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

interface Scene {
  game: Game;
  sounds: number[];
}

/** A new 3D2D1D game with `champions` test heroes and gravity off. */
function fresh(champions: number): Scene {
  const game = newGame(emptyDungeonData(), graphics);
  game.readDungeonDat(read('dungeon.dat'));
  game.setRandomSeed(0x3d2d1d);
  game.ctx.rules.bGravityGame = false;
  game.ctx.party.state.champions = Array.from({ length: champions }, (_, i) => testChampion(i));
  const sounds: number[] = [];
  wrapMember(game.ctx.sounds, 'queueSound', (queueSound) => (ordinal, mapX, mapY, deltaTime, soundLevel) => {
    sounds.push(ordinal);
    queueSound(ordinal, mapX, mapY, deltaTime, soundLevel);
  });
  return { game, sounds };
}

/** The party put on `p`, its level loaded, facing `facing`, with nothing queued. */
function stand(game: Game, p: Position, facing: number): void {
  game.ctx.party.state.position = p;
  game.systems.monsters.loadPartyLevel(p.z);
  game.ctx.party.setFacing(facing);
  game.ctx.loop.newPartyLevel = -1;
  game.ctx.party.state.partyMoveDisableTimer = 0;
  game.lastInputTime = 0;
  game.discardAllInput();
}

const hp = (game: Game): number[] => game.ctx.party.state.champions.map((c) => c.attributes.health);
const stamina = (game: Game): number[] => game.ctx.party.state.champions.map((c) => c.attributes.stamina);
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * `action` queued with a turn behind it, and one VBL with a tick due, which takes the
 * move: how many entries are left. Then the turn is thrown away and two more ticks run,
 * the first of which puts the party on its new level (`Game.loadNewPartyLevel`).
 */
function press(game: Game, action: MovementAction): number {
  game.enqueueMovement(action);
  game.enqueueMovement(MovementAction.TURN_LEFT);
  runVbl(game, TICK_DUE);
  const left = game.ctx.mouseQueue.count();
  game.discardAllInput();
  runVbl(game, TICK_DUE);
  runVbl(game, TICK_DUE);
  return left;
}

/** A facing that `ExitStairsDirection` would change, so keeping it proves `setFacing` false. */
function facingNotExit(game: Game, target: Position): number {
  for (let facing = 0; facing < 4; facing++) {
    if (game.ctx.dungeon.getExitStairsDirection(target, facing, game.ctx.tables) !== facing) return facing;
  }
  throw new Error(`every facing is the exit direction at ${at(target)}`);
}

check(fresh(0).game.ctx.rules.bThreeDMovements, '3D2D1D sets bThreeDMovements');

/* ---------------------------------- 1, 2. a shaft, down and up ------------------------ */
{
  const { game, sounds } = fresh(4);
  const dungeon = game.ctx.dungeon;
  const shaft = new Position(1, 1, 1);
  const below = new Position(1, 1, 2);
  const flags = dungeon.getCellFlag(shaft);
  check(((flags >> 5) & 7) === RoomType.PIT && (flags & 0x09) === 0x09, `${at(shaft)} is a fake pit, open with bit 0 set`);
  const facing = facingNotExit(game, below);
  stand(game, shaft, facing);
  const hp0 = hp(game);
  const stamina0 = stamina(game);
  const left = press(game, MovementAction.MOVE_DOWN);
  const p = game.ctx.party.state.position;
  console.log(`1. down from ${at(shaft)} facing ${facing}: at ${at(p)} facing ${game.ctx.party.state.facing}, `
    + `stamina [${stamina0.join(', ')}] -> [${stamina(game).join(', ')}], queue ${left}, sounds [${sounds.join(', ')}]`);
  check(same(p, below), 'the party goes down the shaft to the square below');
  check(game.ctx.party.state.facing === facing, 'facing as it was: TraverseStairway(0, false)');
  check(stamina(game).every((s, i) => s < stamina0[i]!), 'each champion pays a step\'s stamina');
  check(hp(game).join() === hp0.join() && !sounds.includes(18), 'nobody hurt, no bump');
  check(left === 0, 'the new level throws the input away');

  sounds.length = 0;
  stand(game, below, facing);
  press(game, MovementAction.MOVE_UP);
  const up = game.ctx.party.state.position;
  console.log(`2. up from ${at(below)}: at ${at(up)} facing ${game.ctx.party.state.facing}, sounds [${sounds.join(', ')}]`);
  check(same(up, shaft), 'the party goes up into the pit above');
  check(game.ctx.party.state.facing === facing, 'facing as it was: TraverseStairway(1, false)');
  runVbl(game, TICK_DUE);
  runVbl(game, TICK_DUE);
  check(same(game.ctx.party.state.position, shaft) && game.ctx.loop.newPartyLevel === -1,
    'a fake pit holds the party: it does not fall back down');
}

/* ---------------------------------- 3, 4, 5. stone ------------------------------------ */
const bumps: Array<[string, Position, MovementAction]> = [
  ['3. up into the stone of map 0', new Position(1, 1, 1), MovementAction.MOVE_UP],
  ['4. down from a floor', new Position(1, 1, 2), MovementAction.MOVE_DOWN],
  ['5. up from the top level', new Position(3, 2, 0), MovementAction.MOVE_UP],
];
for (const [label, from, action] of bumps) {
  const { game, sounds } = fresh(4);
  stand(game, from, 0);
  const hp0 = hp(game);
  const left = press(game, action);
  const hurt = sum(hp0) - sum(hp(game));
  console.log(`${label}, ${at(from)}: at ${at(game.ctx.party.state.position)}, HP [${hp0.join(', ')}] -> [${hp(game).join(', ')}], `
    + `queue ${left}, sounds [${sounds.join(', ')}]`);
  check(same(game.ctx.party.state.position, from) && game.ctx.loop.newPartyLevel === -1, `${label}: the party stays`);
  check((hurt === 2 || hurt === 4) && hp(game).every((h, i) => hp0[i]! - h === 0 || hp0[i]! - h === 2),
    `${label}: 2 HP off one or two champions`);
  check(sounds.includes(18), `${label}: the bump's sound 18`);
  check(left === 0, `${label}: the input is discarded`);
}

/* ---------------------------------- 6. a monster below -------------------------------- */
{
  const { game, sounds } = fresh(4);
  const shaft = new Position(1, 1, 1);
  stand(game, shaft, 0);
  const rn = createMonsterAt(game, {
    value: 6, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
    mapX: 1, mapY: 1, level: 2, invisible: false, drawAsSize4: false,
  });
  check(rn !== null, 'a Screamer is made on map 2 (1,1)');
  stand(game, shaft, 0);
  const hp0 = hp(game);
  const left = press(game, MovementAction.MOVE_DOWN);
  console.log(`6. down onto a Screamer: at ${at(game.ctx.party.state.position)}, HP [${hp(game).join(', ')}], queue ${left}, sounds [${sounds.join(', ')}]`);
  check(same(game.ctx.party.state.position, shaft) && game.ctx.loop.newPartyLevel === -1, 'the party stays');
  check(hp(game).join() === hp0.join() && !sounds.includes(18), 'silently: no bump, nobody hurt');
  check(left === 1, 'the input is kept');
}

/* ---------------------------------- 7. no champion ------------------------------------ */
{
  const { game, sounds } = fresh(0);
  const shaft = new Position(1, 1, 1);
  stand(game, shaft, 0);
  const left = press(game, MovementAction.MOVE_UP);
  console.log(`7. no champion, up into stone: at ${at(game.ctx.party.state.position)}, queue ${left}, sounds [${sounds.join(', ')}]`);
  check(same(game.ctx.party.state.position, shaft) && !sounds.includes(18), 'the party stays, with no bump');
  check(left === 1, 'the input is kept');
}

/* ---------------------------------- 8. the route's first shaft ------------------------ */
{
  const { game } = fresh(1);
  stand(game, new Position(7, 7, 0), 0);
  press(game, MovementAction.MOVE_DOWN);
  const p = game.ctx.party.state.position;
  console.log(`8. down from map 0 (7,7): at ${at(p)}`);
  check(same(p, new Position(7, 7, 1)), 'the shaft below the 3D maze\'s door leads to map 1 (7,7)');
}

finish();
