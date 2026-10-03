/**
 * Dropping an object onto an active teleporter.
 *
 * `DropObject` (`doc/CSBwin-src/Mouse.cpp:882`) does not just link the dropped
 * object into the target cell — it calls `MoveObject(objD4, -1, 0, D6W, D5W, NULL,
 * NULL)`, the same function a walking party or monster goes through, so an object
 * landing on an active teleporter is immediately carried to the teleporter's
 * destination. `MouseSystem.dropObjectFromCursor` used to skip straight to
 * `DungeonState.addObjectToCell` on the drop target, with no teleporter/pit
 * resolution at all — the classic "put the item on the plate and nothing happens"
 * bug, since a puzzle's payoff is exactly an object appearing somewhere else after
 * being dropped on (or moved onto) a teleported cell.
 *
 * This finds a real, active, item-capable teleporter in the shipped dungeon, drops
 * an object taken from the floor directly onto it, and checks it lands at the
 * teleporter's destination rather than staying put.
 *
 * Run: `npx tsx tools/dump-teleporter-drop.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
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
            return { at, dest };
          }
        }
      }
    }
  }
  return null;
}

/** Any plain item already sitting on the dungeon floor, lifted off it. */
function findFloorItem(game: Game, avoid: Position): { rn: ObjectID; at: Position } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (x === avoid.x && y === avoid.y && z === avoid.z) continue;
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

function main(): void {
  const game = makeGame();
  const teleporter = findItemTeleporter(game);
  if (!teleporter) {
    console.log('No active, item-capable teleporter found in dungeon.dat — cannot test the drop.');
    finish();
    return;
  }
  console.log(`=== teleporter at level ${teleporter.at.z} (${teleporter.at.x},${teleporter.at.y}) -> ` +
    `level ${teleporter.dest.z} (${teleporter.dest.x},${teleporter.dest.y}) ===`);

  const item = findFloorItem(game, teleporter.at);
  if (!item) {
    console.log('No spare floor item found — cannot test the drop.');
    finish();
    return;
  }
  console.log(`item ${item.rn.toString(16)} lifted from level ${item.at.z} (${item.at.x},${item.at.y})`);

  game.ctx.dungeon.removeObjectFromCell(item.at, item.rn);

  const party = game.ctx.party.state;
  party.position = teleporter.at.south; // so "in front, facing north" is the teleporter cell
  party.facing = 0;
  party.cursorOwner = 0;
  party.objectInHand = item.rn;

  const dropped = game.systems.mouse.dropObjectFromCursor(2); // "in front" of the party
  check(dropped, 'the drop is accepted');
  check(party.objectInHand === OBJECT_ID_NULL, 'the cursor is empty afterwards');

  let atTeleporter = false;
  for (let rn = game.ctx.dungeon.findFirstObject(teleporter.at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.idx(rn) === game.ctx.dungeon.rnMaps.idx(item.rn) &&
        game.ctx.dungeon.rnMaps.dbType(rn) === game.ctx.dungeon.rnMaps.dbType(item.rn)) atTeleporter = true;
  }
  check(!atTeleporter, 'the object does not stay sitting on the teleporter cell');

  let atDestination = false;
  for (let rn = game.ctx.dungeon.findFirstObject(teleporter.dest); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.idx(rn) === game.ctx.dungeon.rnMaps.idx(item.rn) &&
        game.ctx.dungeon.rnMaps.dbType(rn) === game.ctx.dungeon.rnMaps.dbType(item.rn)) atDestination = true;
  }
  check(atDestination, 'the object is teleported straight to the destination cell on drop');

  finish();
}

main();
