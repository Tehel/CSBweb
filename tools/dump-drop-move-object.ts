/**
 * The two drops go through `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2796`).
 *
 * `DropObject` puts the cursor's object down with `MoveObject(objD4, -1, 0, x, y)`
 * (`doc/CSBwin-src/Mouse.cpp:882`), and a thrown object whose flight ends is put down with
 * `MoveObject(obj, -2, 0, x, y)` (`ProcessObjectFromMissile`, `Timer.cpp:151-159`).
 * `MouseSystem.dropObjectFromCursor` and `TimerSystem.dropMissileObject` hand-rolled it, and
 * differed from it in two ways:
 *
 *  1. They placed the object with `unchangedRoom` false. `MoveObject` places an object
 *     with `unchangedRoom` = "the party stands on this square" (`:3433-3448`), so an item
 *     dropped where the party stands does not press a type-1 pad the party is already on.
 *  2. The cursor drop turned the object's corner on a relative teleporter. `MoveObject`
 *     turns it only when `oldX != -1` (`:3000-3006`): a thrown object (`oldX` -2) turns,
 *     a dropped one keeps the corner it was dropped at.
 *
 * The teleporter is a real record from `dungeon.dat`, rigged by `tools/lib/teleporter.ts`.
 *
 * Run: `npx tsx tools/dump-drop-move-object.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { MovementAction } from '../src/engine/gameTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import type { Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { rigTeleporter } from './lib/teleporter';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i));
  return game;
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const isOpen = (game: Game, p: Position): boolean => {
  const map = game.ctx.dungeon.getMap(p.z);
  if (!map || p.x < 0 || p.y < 0 || p.x >= map.descriptor.width || p.y >= map.descriptor.height) return false;
  return ((game.ctx.dungeon.getCellFlag(p) >> 5) & 7) === RoomType.OPEN;
};

/**
 * Three open squares on level 0: the party's, the one north of it, and a far one. The
 * north one becomes a teleporter to the far one, turning objects by `rotation`.
 */
function stage(game: Game, rotation: number): { party: Position; front: Position; dest: Position } {
  const dungeon = game.ctx.dungeon;
  const map = dungeon.getMap(0)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 1; y < map.descriptor.height; y++) {
      const party = new Position(x, y, 0);
      const front = party.north;
      if (!isOpen(game, party) || !isOpen(game, front)) continue;
      for (let dx = 0; dx < map.descriptor.width; dx++) {
        for (let dy = 0; dy < map.descriptor.height; dy++) {
          const dest = new Position(dx, dy, 0);
          if (Math.abs(dx - x) + Math.abs(dy - y) < 3 || !isOpen(game, dest)) continue;
          rigTeleporter(game, front, dest);
          const records = dungeon.getData().databases.teleporters.records;
          for (let rn = dungeon.findFirstObject(front); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
            if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.TELEPORTER) records[game.ctx.dungeon.rnMaps.idx(rn)]!.rotation = rotation;
          }
          game.ctx.party.state.position = party;
          game.ctx.party.state.facing = 0;
          return { party, front, dest };
        }
      }
    }
  }
  throw new Error('no staging squares on level 0');
}

/** The last weapon record, lifted from wherever it lies, at corner 0. */
function takeWeapon(game: Game): ObjectID {
  const dungeon = game.ctx.dungeon;
  const index = dungeon.getData().databases.weapons.records.length - 1;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const found = find(game, new Position(x, y, z), index);
        if (found !== null) dungeon.removeObjectFromCell(new Position(x, y, z), found);
      }
    }
  }
  return game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, index);
}

function find(game: Game, at: Position, index: number): ObjectID | null {
  const dungeon = game.ctx.dungeon;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const decoded = game.ctx.dungeon.rnMaps.decode(rn);
    if (decoded.category === DBType.WEAPON && decoded.index === index) return rn;
  }
  return null;
}

type PadCall = { at: Position; place: boolean; unchangedRoom: boolean };
function spy(game: Game): PadCall[] {
  const calls: PadCall[] = [];
  const actuators = game.systems.actuators;
  const real = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    if (game.ctx.dungeon.rnMaps.dbType(object) === DBType.WEAPON) calls.push({ at: position, place, unchangedRoom });
    return real(position, object, place, unchangedRoom, facing);
  };
  return calls;
}

type Dropper = { dropMissileObject(projectile: number, position: Position, posInCell: number): void };
const throwLands = (game: Game, rn: ObjectID, at: Position, corner: number): void =>
  (game.systems.timer as unknown as Dropper).dropMissileObject(rn, at, corner);

function main(): void {
  /* ------------------------------------- 1. a drop onto the party's own square ---- */
  {
    const game = makeGame();
    const { party } = stage(game, 0);
    const rn = takeWeapon(game);
    const calls = spy(game);
    game.ctx.party.state.cursorOwner = 0;
    game.ctx.party.state.objectInHand = rn;
    const dropped = game.systems.mouse.dropObjectFromCursor(1);
    const landed = find(game, party, game.ctx.dungeon.rnMaps.idx(rn));
    console.log(`1. cursor drop at (${party.x},${party.y}) where the party stands: accepted ${dropped}, `
      + `there ${landed !== null}, pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(dropped && landed !== null && game.ctx.dungeon.rnMaps.pos(landed) === 1, 'the item lies on the party square, corner 1');
    check(calls.length === 1 && calls[0]!.place && same(calls[0]!.at, party) && calls[0]!.unchangedRoom,
      'it is placed with unchangedRoom = the party stands there (Code11f52.cpp:3433-3448)');
  }

  /* ---------------------------- 2. a drop onto a relative teleporter in front ---- */
  {
    const game = makeGame();
    const { front, dest } = stage(game, 1);
    const rn = takeWeapon(game);
    const calls = spy(game);
    game.ctx.party.state.cursorOwner = 0;
    game.ctx.party.state.objectInHand = rn;
    game.systems.mouse.dropObjectFromCursor(2);
    const landed = find(game, dest, game.ctx.dungeon.rnMaps.idx(rn));
    console.log(`2. cursor drop onto the teleporter at (${front.x},${front.y}), rotation 1: at (${dest.x},${dest.y}) `
      + `${landed !== null}, corner ${landed !== null ? game.ctx.dungeon.rnMaps.pos(landed) : '-'}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(landed !== null, 'the item is carried to the destination');
    check(landed !== null && game.ctx.dungeon.rnMaps.pos(landed) === 2,
      'it keeps the corner it was dropped at: oldX is -1 (Code11f52.cpp:3000-3006)');
    check(calls.length === 1 && same(calls[0]!.at, dest) && !calls[0]!.unchangedRoom,
      'it is placed once, at the destination, with unchangedRoom false');
  }

  /* ------------------------------- 3. a thrown item landing where the party stands ---- */
  {
    const game = makeGame();
    const { party } = stage(game, 0);
    const rn = takeWeapon(game);
    const calls = spy(game);
    throwLands(game, rn, party, 3);
    const landed = find(game, party, game.ctx.dungeon.rnMaps.idx(rn));
    console.log(`3. thrown item lands at (${party.x},${party.y}) where the party stands: there ${landed !== null}, `
      + `pad calls ${JSON.stringify(calls.map((c) => [c.at.x, c.at.y, c.place, c.unchangedRoom]))}`);
    check(landed !== null && game.ctx.dungeon.rnMaps.pos(landed) === 3, 'the item lies on the party square, corner 3');
    check(calls.length === 1 && calls[0]!.place && calls[0]!.unchangedRoom,
      'it is placed with unchangedRoom = the party stands there (Code11f52.cpp:3433-3448)');
  }

  /* ----------------------------- 4. a thrown item landing on a relative teleporter ---- */
  {
    const game = makeGame();
    const { front, dest } = stage(game, 1);
    const rn = takeWeapon(game);
    throwLands(game, rn, front, 2);
    const landed = find(game, dest, game.ctx.dungeon.rnMaps.idx(rn));
    console.log(`4. thrown item lands on the teleporter at (${front.x},${front.y}), rotation 1: at (${dest.x},${dest.y}) `
      + `${landed !== null}, corner ${landed !== null ? game.ctx.dungeon.rnMaps.pos(landed) : '-'}`);
    check(landed !== null && game.ctx.dungeon.rnMaps.pos(landed) === 3,
      'it is carried to the destination and turned: oldX is -2, not -1 (Code11f52.cpp:3000-3006)');
  }

  /* ------------------- 5. a pad's timer due at once waits for the tick ---- */
  // `ProcessTimers` runs from the main loop's tick (`CSBCode.cpp:627`) and from
  // `_FusionSequence` (`Attack.cpp:2199`), nowhere else: not from `DropObject`
  // (`Mouse.cpp:860-890`), the pick-up's `MoveObject` (`:836`) or `MoveParty`. A pad
  // pressed by the object queues its action for `d.Time`, and it is still queued when
  // the handler returns.
  {
    const game = makeGame();
    const { party, front } = stage(game, 0);
    const rn = takeWeapon(game);
    const queue = game.ctx.timers;
    const actuators = game.systems.actuators;
    const real = actuators.triggerObjectMove.bind(actuators);
    let padTimer = -1;
    actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
      padTimer = queue.createTimer(TimerFunction.TT_DOOR, position.x, position.y, 0, 0, game.ctx.state.tickCount, position.z).index;
      return real(position, object, place, unchangedRoom, facing);
    };
    const queued = (): boolean => padTimer >= 0 && queue.getTimers().some((t) => t.index === padTimer);

    game.ctx.party.state.cursorOwner = 0;
    game.ctx.party.state.objectInHand = rn;
    game.systems.mouse.dropObjectFromCursor(2);
    const afterDrop = queued();

    padTimer = -1;
    const lying = find(game, front, game.ctx.dungeon.rnMaps.idx(rn))!;
    game.ctx.dungeon.removeObjectFromCell(front, lying);
    game.ctx.systems.mouse.triggerObjectMove(front, lying, false, false, 0);
    const afterPickUp = queued();

    padTimer = queue.createTimer(TimerFunction.TT_DOOR, party.x, party.y, 0, 0, game.ctx.state.tickCount, party.z).index;
    const turned = game.ctx.systems.movement.moveParty(MovementAction.TURN_RIGHT).success;
    const afterTurn = queued();

    console.log(`5. a timer due at d.Time ${game.ctx.state.tickCount} still queued after the drop ${afterDrop}, `
      + `the pick-up ${afterPickUp}, a turn ${afterTurn} (turned ${turned})`);
    check(afterDrop, 'a drop runs no timer pass: the pad\'s timer waits for the tick');
    check(afterPickUp, 'a pick-up runs no timer pass');
    check(turned && afterTurn, 'a turn that went through runs no timer pass');
  }

  finish();
}

main();
