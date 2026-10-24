/**
 * `DoesPartyHave` — actuator type 8's test — looks inside carried chests and at the cursor.
 *
 * `doc/CSBwin-src/Code11f52.cpp:3657-3715`: for every champion with `HP() != 0`, each of
 * the 30 possessions is compared by `GetBasicObjectType` with the actuator's value, and a
 * possession that is a chest (`objNI_Chest`, 0x90) has its `contents()` chain compared too.
 * Then a `goto` back into the loop does the same for `d.objectInHand`, whoever holds it.
 *
 * Run: `npm test -- --only=does-party-have.ts`
 */
import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../../src/core/types';
import { CsbRandom } from '../../src/core/random';
import { getActuatorType } from '../../src/data/actuatorHelpers';
import { ActuatorSystem } from '../../src/engine/ActuatorSystem';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../../src/engine/AddCharacter';
import type { AddCharacterTables } from '../../src/engine/AddCharacter';
import { DungeonState } from '../../src/engine/DungeonState';
import { GetBasicObjectType } from '../../src/engine/objectIndex';
import { Party } from '../../src/engine/Party';
import { graphicsTablesOf, newContext, presetHeroesOf, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';

const OBJNI_CHEST = 0x90;

async function main(): Promise<void> {
  const data = stockDungeon();
  const graphics = stockGraphics();
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescWord4: objectTables.objDescWord4,
  };
  const heroes = presetHeroesOf(data, graphics);
  if (heroes.length < 2) throw new Error('dungeon.dat carries fewer than two preset heroes');

  const dungeon = new DungeonState(data);
  const basic = (rn: ObjectID): number => GetBasicObjectType(dungeon, objectTables.objDescObjectType, rn);

  // For the record: how many type-8 sensors the shipped dungeon has.
  const type8 = data.databases.actuators.records.filter((rec) => getActuatorType(rec) === 8).length;
  console.log(`dungeon.dat has ${type8} type-8 (party-has) actuator(s)`);

  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i], i, assignPresetHeroPossessions(heroes[i].inventory, addTables)));
  }
  const ctx = newContext(data, graphics, { dungeon, party, random: new CsbRandom(0x1234) });
  ctx.state.tickCount = 1000;
  const actuators = new ActuatorSystem(ctx);
  const has = (value: number): boolean => actuators.doesPartyHave(value);

  // A floor object the party does not already carry, and a chest to carry it in.
  const carried = new Set<number>();
  for (const champ of party.state.champions) for (const p of champ.possessions) if (p !== OBJECT_ID_NULL) carried.add(basic(p));
  let item: ObjectID | null = null;
  let itemAt: Position | null = null;
  for (let z = 0; z < dungeon.getMapCount() && item === null; z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width && item === null; x++) {
      for (let y = 0; y < map.descriptor.height && item === null; y++) {
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (ctx.dungeon.rnMaps.dbType(rn) !== DBType.MISC) continue;
          const objNI = basic(rn);
          if (carried.has(objNI) || objNI === OBJNI_CHEST) continue;
          item = rn; itemAt = at; break;
        }
      }
    }
  }
  const chestIndex = data.databases.containers.records.findIndex((rec) => rec !== undefined);
  if (item === null || itemAt === null || chestIndex < 0) {
    check(false, 'dungeon.dat has a spare floor item and a chest record');
    finish();
    return;
  }
  const chest = ctx.dungeon.rnMaps.rn(DBType.CHEST, chestIndex);
  check(basic(chest) === OBJNI_CHEST, `the chest record's basic type is objNI_Chest (${basic(chest)})`);
  const value = basic(item);
  console.log(`item 0x${item.toString(16)} (basic type ${value}) from level ${itemAt.z} (${itemAt.x},${itemAt.y}); chest 0x${chest.toString(16)}`);

  check(!has(value), 'the party does not have it to begin with');

  // Into the chest, the chest into champion 0's pack.
  dungeon.removeObjectFromCell(itemAt, item);
  dungeon.setDBRecordLink(item, OBJECT_ID_EOF);
  dungeon.getContainerRecord(chest)!.containedObject = item;
  const champ0 = party.state.champions[0]!;
  const pack = champ0.possessions!;
  pack[13] = chest;
  check(has(value), 'an object in a carried chest counts');

  // The chest on the cursor instead.
  pack[13] = OBJECT_ID_NULL;
  party.state.objectInHand = chest;
  check(has(value), 'an object in a chest on the cursor counts');

  // The object itself on the cursor.
  dungeon.getContainerRecord(chest)!.containedObject = OBJECT_ID_EOF;
  party.state.objectInHand = item;
  check(has(value), 'an object on the cursor counts');

  // A champion with no hit points does not.
  party.state.objectInHand = OBJECT_ID_NULL;
  pack[13] = item;
  champ0.attributes.health = 0;
  check(!has(value), 'an object carried by a champion with 0 HP does not count');
  champ0.attributes.health = 10;
  check(has(value), 'and it counts again once the champion has hit points');

  finish();
}

main();
