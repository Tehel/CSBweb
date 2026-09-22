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
 * Run: `npx tsx tools/dump-missile-drop.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

function champion(i: number, name: string): Champion {
  return {
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
    possessions: new Array(30).fill(null),
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
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** An active teleporter, open to plain items, whose destination is a different cell. */
function findItemTeleporter(game: Game): { at: Position; dest: Position } | null {
  const dungeon = game.dungeonState;
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
          if (decodeObjectID(rn).category !== DBType.TELEPORTER) continue;
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
  const dungeon = game.dungeonState;
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
          if (decodeObjectID(rn).category === DBType.ACTUATOR) hasActuator = true;
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
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (avoid.some((p) => p.x === x && p.y === y && p.z === z)) continue;
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          const category = decodeObjectID(rn).category;
          if (category < DBType.WEAPON || category > DBType.MISC) continue;
          return { rn, at };
        }
      }
    }
  }
  return null;
}

function sameObject(a: ObjectID, b: ObjectID): boolean {
  return decodeObjectID(a).category === decodeObjectID(b).category && decodeObjectID(a).index === decodeObjectID(b).index;
}

function findsObjectAt(game: Game, position: Position, target: ObjectID): boolean {
  for (let rn = game.dungeonState.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
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
        game.dungeonState.removeObjectFromCell(item.at, item.rn);

        const party = game.party.state;
        party.position = teleporter.at.south;
        party.facing = 0; // north, straight at the teleporter

        // range == decayRate == 5: the throw exhausts its range on the tick right
        // after it enters the teleporter's cell, so it lands there rather than flying
        // past it — see the deltaEnergy/rangeRemaining accounting in `processMissileTimer`.
        const launched = game.timerSystem.throwObjectFromHand(item.rn, party.position, 0, 0, 5, 100, 5, 0);
        check(launched, 'the throw launches');

        for (let t = 1; t <= 6; t++) game.timerSystem.processTimers(t);

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
        game.dungeonState.removeObjectFromCell(item.at, item.rn);

        const party = game.party.state;
        party.position = plate.south;
        party.facing = 0;

        let triggerSeen = false;
        const originalTrigger = ActuatorSystem.prototype.triggerObjectMove;
        ActuatorSystem.prototype.triggerObjectMove = function (position, object, place, unchangedRoom, facing) {
          if (place && position.x === plate.x && position.y === plate.y && position.z === plate.z) triggerSeen = true;
          return originalTrigger.call(this, position, object, place, unchangedRoom, facing);
        };

        const launched = game.timerSystem.throwObjectFromHand(item.rn, party.position, 0, 0, 5, 100, 5, 0);
        check(launched, 'the throw launches');

        for (let t = 1; t <= 6; t++) game.timerSystem.processTimers(t);

        ActuatorSystem.prototype.triggerObjectMove = originalTrigger;

        check(findsObjectAt(game, plate, item.rn), 'the thrown object lands on the actuator cell');
        check(triggerSeen, 'landing on the actuator cell fires the pressure-plate trigger');
      }
    }
  }

  finish();
}

main();
