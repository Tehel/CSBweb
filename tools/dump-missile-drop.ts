/**
 * A thrown item landing on an active teleporter, or on a pressure plate.
 *
 * `ProcessObjectFromMissile`'s no-monster arm (`doc/CSBwin-src/Timer.cpp:151-159`) —
 * what runs when a thrown object's flight ends — is `MoveObject(objD6.pos(missile
 * .pos()), -2, 0, mapX, mapY, NULL, NULL)`, the exact same teleporter/pit-resolution
 * loop `DropObject` uses (see `tools/dump-teleporter-drop.ts`), which in turn places
 * the object through `PlaceOrRemoveObjectInRoom`
 * (`doc/CSBwin-src/Code11f52.cpp:3438-3446`) — the function that fires a pressure
 * plate under whatever just arrived. `TimerSystem.dropMissileObject` used to skip
 * both: a thrown object landing at the end of its flight went straight into
 * `DungeonState.addObjectToCell` at the raw landing cell, with no teleporter
 * resolution and no actuator trigger at all. Two puzzle shapes need this: throwing
 * an item across a pit onto a teleporter cell you cannot walk to, and throwing an
 * item onto a pressure plate you cannot stand on yourself.
 *
 * This finds a real active, item-scoped teleporter in `dungeon.dat`, throws a floor
 * item at it from the adjacent cell with a short enough range that the throw ends
 * exactly on the teleporter, and checks it arrives at the destination — then does the
 * same for a plain floor-level actuator, throwing an item onto it and checking the
 * actuator actually saw the object arrive.
 *
 * A third scenario covers "a thrown object landing on a door" fell half a cell too
 * far, on the far corner of the door's cell rather than the near one. `MissileTimer`
 * computes two different positions on the tick a closed door blocks the flight
 * (`doc/CSBwin-src/Timer.cpp:370-377`): the advanced `curPos` it threads through
 * `ProcessMissileEncounter` as `objectPos` (used for cloud placement and filtering),
 * and the missile RN's own `.pos()` bits, which the `leavingThisCell` write that would
 * normally advance them never runs for this path — so `ProcessObjectFromMissile`
 * (`Timer.cpp:156-157`) drops the object at the corner the missile was already resting
 * at, one hop short of `objectPos`. `TimerSystem.processObjectFromMissile` used to drop
 * at the threaded-through `objectPos`, landing every door-blocked item on the wrong
 * corner. This throws an item at a real closed door in `dungeon.dat`, records the
 * missile's own resting corner the tick before the door blocks it, and checks the
 * landed item sits at that exact corner — not the one `objectPos` would have used.
 *
 * A fourth scenario covers the sound that plays on that same impact.
 * `ProcessMissileEncounter`'s shared ending (`doc/CSBwin-src/Code11f52.cpp:2101-2121`)
 * calls `QueueSound` with an *ordinal* into the sound table — 0 for a weapon, 4 for
 * anything else physical (food, a scroll, …) — not a raw SND item number.
 * `playMissileImpactSound` used to skip that table and call `playSound`
 * with a hand-picked `SoundIndex` constant instead, and got the non-weapon case wrong:
 * `SoundIndex.FIREBALL_EXPLODE` is ordinal 5's sample, not ordinal 4's, so a dropped
 * scroll or piece of food played an explosion. This throws a weapon and a misc item at
 * the same closed door and checks the ordinal `queueSound` actually receives.
 *
 * Run: `npx tsx tools/dump-missile-drop.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, rnEquals } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { Game } from '../src/engine/Game';
import { SoundQueue } from '../src/engine/SoundQueue';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

function champion(i: number, name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
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

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** An active teleporter, open to plain items, whose destination is a different cell. */
function findItemTeleporter(game: Game): { at: Position; dest: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.TELEPORTER) continue;
        if ((flag & 0x08) === 0) continue; // inactive
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.TELEPORTER) continue;
          const rec = dungeon.getTeleporterRecord(rn);
          if (!rec) continue;
          if ((rec.scope & 0x3) === 1) continue; // creatures only
          for (let dz = 0; dz < dungeon.getMapCount(); dz++) {
            const destMap = dungeon.getMap(dz);
            if (!destMap || destMap.descriptor.level !== rec.destMap) continue;
            const dest = new Position(rec.destX, rec.destY, dz);
            if (dest.x === at.x && dest.y === at.y && dest.z === at.z) break; // teleports to itself
            // The throw needs a walkable cell immediately south to stand on.
            const south = at.south;
            const southFlag = map.cellFlags[south.x]?.[south.y];
            if (southFlag === undefined) continue;
            if (((southFlag >> 5) & 0x7) === RoomType.STONE) continue;
            return { at, dest };
          }
        }
      }
    }
  }
  return null;
}

/** A floor actuator (pressure plate / wall switch style) with an open cell south of it to throw from. */
function findFloorActuator(game: Game): Position | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        const roomType = (flag >> 5) & 0x7;
        if (roomType === RoomType.STONE) continue;
        const at = new Position(x, y, z);
        let hasActuator = false;
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR) hasActuator = true;
        }
        if (!hasActuator) continue;
        const south = at.south;
        const southFlag = map.cellFlags[south.x]?.[south.y];
        if (southFlag === undefined) continue;
        if (((southFlag >> 5) & 0x7) === RoomType.STONE) continue;
        return at;
      }
    }
  }
  return null;
}

/** Any plain item already sitting on the dungeon floor, lifted off it. */
function findFloorItem(game: Game, avoid: Position[]): { rn: ObjectID; at: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (avoid.some((p) => p.x === x && p.y === y && p.z === z)) continue;
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          const category = game.ctx.dungeon.rnMaps.dbType(rn);
          if (category < DBType.WEAPON || category > DBType.MISC) continue;
          return { rn, at };
        }
      }
    }
  }
  return null;
}

/** A closed (state 2-4) door with an open cell south of it to throw from, straight north. */
function findClosedDoor(game: Game): { at: Position; south: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.DOOR) continue;
        const doorState = flag & 0x7;
        if (doorState < 2 || doorState > 4) continue; // must be blocking
        const at = new Position(x, y, z);
        const south = at.south;
        const southFlag = map.cellFlags[south.x]?.[south.y];
        if (southFlag === undefined) continue;
        if (((southFlag >> 5) & 0x7) === RoomType.STONE) continue;
        return { at, south };
      }
    }
  }
  return null;
}

/** Any floor item of a specific DB category, lifted off it. */
function findFloorItemOfCategory(game: Game, category: DBType, avoid: Position[]): { rn: ObjectID; at: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (avoid.some((p) => p.x === x && p.y === y && p.z === z)) continue;
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (game.ctx.dungeon.rnMaps.dbType(rn) !== category) continue;
          return { rn, at };
        }
      }
    }
  }
  return null;
}

function sameObject(a: ObjectID, b: ObjectID): boolean {
  return rnEquals(a, b);
}

function findsObjectAt(game: Game, position: Position, target: ObjectID): boolean {
  for (let rn = game.ctx.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (sameObject(rn as ObjectID, target)) return true;
  }
  return false;
}

function main(): void {
  /* ---------------------------------------------- 1. thrown onto a teleporter --- */
  {
    const game = makeGame();
    const teleporter = findItemTeleporter(game);
    if (!teleporter) {
      console.log('No active, item-capable teleporter with a throwable approach found — skipping.');
    } else {
      console.log(`=== throwing onto the teleporter at level ${teleporter.at.z} (${teleporter.at.x},${teleporter.at.y}) -> ` +
        `level ${teleporter.dest.z} (${teleporter.dest.x},${teleporter.dest.y}) ===`);

      const item = findFloorItem(game, [teleporter.at]);
      if (!item) {
        console.log('No spare floor item found — skipping.');
      } else {
        console.log(`item ${item.rn.toString(16)} lifted from level ${item.at.z} (${item.at.x},${item.at.y})`);
        game.ctx.dungeon.removeObjectFromCell(item.at, item.rn);

        const party = game.ctx.party.state;
        party.position = teleporter.at.south;
        party.facing = 0; // north, straight at the teleporter

        // range == decayRate == 5: the throw exhausts its range on the tick right
        // after it enters the teleporter's cell, so it lands there rather than flying
        // past it — see the deltaEnergy/rangeRemaining accounting in `processMissileTimer`.
        const launched = game.systems.magic.launchThrownMissile(item.rn, party.position, 0, 0, 5, 100, 5, 0);
        check(launched, 'the throw launches');

        for (let t = 1; t <= 6; t++) processTimersAt(game, t);

        check(!findsObjectAt(game, teleporter.at, item.rn), 'the thrown object does not stay sitting on the teleporter cell');
        check(findsObjectAt(game, teleporter.dest, item.rn), 'the thrown object is teleported to the destination on landing');
      }
    }
  }

  /* ------------------------------------------------ 2. thrown onto a plate ------ */
  {
    const game = makeGame();
    const plate = findFloorActuator(game);
    if (!plate) {
      console.log('No floor actuator with a throwable approach found — skipping.');
    } else {
      console.log(`=== throwing onto the actuator at level ${plate.z} (${plate.x},${plate.y}) ===`);

      const item = findFloorItem(game, [plate]);
      if (!item) {
        console.log('No spare floor item found — skipping.');
      } else {
        console.log(`item ${item.rn.toString(16)} lifted from level ${item.at.z} (${item.at.x},${item.at.y})`);
        game.ctx.dungeon.removeObjectFromCell(item.at, item.rn);

        const party = game.ctx.party.state;
        party.position = plate.south;
        party.facing = 0;

        let triggerSeen = false;
        const originalTrigger = ActuatorSystem.prototype.triggerObjectMove;
        ActuatorSystem.prototype.triggerObjectMove = function (position, object, place, unchangedRoom, facing) {
          if (place && position.x === plate.x && position.y === plate.y && position.z === plate.z) triggerSeen = true;
          return originalTrigger.call(this, position, object, place, unchangedRoom, facing);
        };

        const launched = game.systems.magic.launchThrownMissile(item.rn, party.position, 0, 0, 5, 100, 5, 0);
        check(launched, 'the throw launches');

        for (let t = 1; t <= 6; t++) processTimersAt(game, t);

        ActuatorSystem.prototype.triggerObjectMove = originalTrigger;

        check(findsObjectAt(game, plate, item.rn), 'the thrown object lands on the actuator cell');
        check(triggerSeen, 'landing on the actuator cell fires the pressure-plate trigger');
      }
    }
  }

  /* -------------------------------------------- 3. thrown onto a closed door ---- */
  {
    const game = makeGame();
    const door = findClosedDoor(game);
    if (!door) {
      console.log('No closed door with a throwable approach found — skipping.');
    } else {
      console.log(`=== throwing onto the closed door at level ${door.at.z} (${door.at.x},${door.at.y}) ===`);

      const item = findFloorItem(game, [door.at, door.south]);
      if (!item) {
        console.log('No spare floor item found — skipping.');
      } else {
        console.log(`item ${item.rn.toString(16)} lifted from level ${item.at.z} (${item.at.x},${item.at.y})`);
        game.ctx.dungeon.removeObjectFromCell(item.at, item.rn);

        const party = game.ctx.party.state;
        party.position = door.south;
        party.facing = 0; // north, straight at the door

        const launched = game.systems.magic.launchThrownMissile(item.rn, party.position, 0, 0, 40, 100, 5, 0);
        check(launched, 'the throw launches');

        // The missile RN's own `.pos()` bits — not the `objectPos` `ProcessMissileEncounter`
        // is threaded — are what the door-blocked drop should land on
        // (`doc/CSBwin-src/Timer.cpp:156-157`). Capture that corner on the last tick a
        // missile is still present at the door, right before it becomes the dropped item.
        let restingCorner: number | null = null;
        for (let t = 1; t <= 20; t++) {
          for (let rn = game.ctx.dungeon.findFirstObject(door.at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
            if (game.ctx.dungeon.rnMaps.dbType(rn as ObjectID) === DBType.MISSILE) restingCorner = game.ctx.dungeon.rnMaps.pos(rn as ObjectID);
          }
          processTimersAt(game, t);
        }

        check(restingCorner !== null, 'the missile is seen resting at the door before it lands');
        check(findsObjectAt(game, door.at, item.rn), 'the thrown object lands on the door cell, not past it');

        let landedCorner: number | null = null;
        for (let rn = game.ctx.dungeon.findFirstObject(door.at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
          if (sameObject(rn as ObjectID, item.rn)) landedCorner = game.ctx.dungeon.rnMaps.pos(rn as ObjectID);
        }
        check(
          landedCorner === restingCorner,
          `the landed object sits at the missile's resting corner (${restingCorner}), not the far corner (got ${landedCorner})`,
        );
      }
    }
  }

  /* ---------------------------------- 4. the sound a door-blocked item plays ---- */
  {
    const soundOrdinal = (category: DBType): number | null => {
      const game = makeGame();
      const door = findClosedDoor(game);
      if (!door) return null;
      const item = findFloorItemOfCategory(game, category, [door.at, door.south]);
      if (!item) return null;
      game.ctx.dungeon.removeObjectFromCell(item.at, item.rn);

      const party = game.ctx.party.state;
      party.position = door.south;
      party.facing = 0;

      let ordinal: number | null = null;
      const original = SoundQueue.prototype.queueSound;
      SoundQueue.prototype.queueSound = function (this: SoundQueue, o, mapX, mapY, deltaTime, level) {
        if (mapX === door.at.x && mapY === door.at.y) ordinal = o;
        return original.call(this, o, mapX, mapY, deltaTime, level);
      };
      game.systems.magic.launchThrownMissile(item.rn, party.position, 0, 0, 40, 100, 5, 0);
      for (let t = 1; t <= 20; t++) processTimersAt(game, t);
      SoundQueue.prototype.queueSound = original;
      return ordinal;
    };

    console.log('=== the sound ordinal a closed door plays for what hits it ===');
    const weaponOrdinal = soundOrdinal(DBType.WEAPON);
    const miscOrdinal = soundOrdinal(DBType.MISC);
    console.log(`weapon: ordinal ${weaponOrdinal}; misc item: ordinal ${miscOrdinal}`);

    check(weaponOrdinal === 0, `a thrown weapon plays ordinal 0, the falling-item sound (got ${weaponOrdinal})`);
    check(miscOrdinal === 4, `a thrown misc item plays ordinal 4, not the explosion ordinal (got ${miscOrdinal})`);
  }

  finish();
}

main();
