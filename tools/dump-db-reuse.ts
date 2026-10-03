/**
 * A new object takes a freed record (`DATABASES::FindEmptyDBEntry`,
 * `doc/CSBwin-src/data.cpp:919-993`).
 *
 *  1. The lowest record from index 1 whose link is `RNnul` (`:954-966`). `dungeon.dat`
 *     ships a few: weapon 105, misc 8 and 116, and a new game's spares follow the
 *     file's records, cleared (`ReadDatabases`, `SaveGame.cpp:2556-2564`): weapons from
 *     107, misc from 280. So the first arrow a wall shoots is weapon 105, the next 107.
 *  2. The walk of the records starts at 1. A new game's missiles are all spares, handed
 *     out from record 1, and record 0, free all along, is never reached.
 *  3. A new monster group takes the first spare, and the database, already sized for
 *     it, does not grow: `count` and the header's `objectCounts` — what the image writer
 *     declares — stay the number of records. A full database's `Enlarge` is
 *     `tools/dump-make-more-room.ts`'s.
 *  4. The indirect index. `DeleteDBEntry` frees the record's slot with it, `0xff`/`0xffff`
 *     (`:993-1015`), and the next new object, of any database, takes the lowest free
 *     slot (`:933-953`, `:986-988`). A slot that names a free record of the database is
 *     taken with its record, first, record 0 included. A record two slots name, or
 *     whose slot carries bit 0x80, is "Cloned!!!": deleting it changes nothing. Slot 0
 *     names door 0, so door 0 is such a record as soon as a cell's chain holds it.
 *
 * Run: `npx tsx tools/dump-db-reuse.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import type { DungeonState } from '../src/engine/DungeonState';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { constructPredefinedMissile } from '../src/engine/missileHelpers';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { RN_POISON_BOLT } from '../src/core/spellRn';

const MISSILE_TYPE_ARROW = 51;
const MISSILE_TYPE_BOULDER = 128;
const WEAPON_ARROW = 27;

async function main(): Promise<void> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    const game = newGame(data, graphics);
    game.setRandomSeed(0x12345678);
    return game;
  };

  const index = (dungeon: DungeonState, rn: ObjectID | null): number => (rn === null ? -1 : dungeon.rnMaps.idx(rn));

  /* --------------------------------------------- 1. the file's free records ---- */
  {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    const weapons = dungeon.getData().databases.weapons;
    const misc = dungeon.getData().databases.misc;
    const freeWeapons = weapons.records.flatMap((r, i) => (r.nextObject === OBJECT_ID_NULL ? [i] : []));
    const freeMisc = misc.records.flatMap((r, i) => (r.nextObject === OBJECT_ID_NULL ? [i] : []));
    const weaponCount = weapons.records.length;
    const fileWeapons = weaponCount - game.ctx.tables.byte7302[DBType.WEAPON]!;
    const fileMisc = misc.records.length - game.ctx.tables.byte7302[DBType.MISC]!;
    const arrows = [0, 1].map(() => index(dungeon, constructPredefinedMissile(dungeon, MISSILE_TYPE_ARROW)));
    const boulders = [0, 1, 2].map(() => index(dungeon, constructPredefinedMissile(dungeon, MISSILE_TYPE_BOULDER)));
    const below = (free: number[], file: number): number[] => free.filter((i) => i < file);
    console.log(`1. free in dungeon.dat: weapons [${below(freeWeapons, fileWeapons)}] of ${fileWeapons}, `
      + `misc [${below(freeMisc, fileMisc)}] of ${fileMisc}; spares from weapon ${fileWeapons}, misc ${fileMisc}`);
    console.log(`   two arrows -> weapons ${arrows.join(', ')}; three boulders -> misc ${boulders.join(', ')}`);
    check(below(freeWeapons, fileWeapons).length === 1 && arrows[0] === freeWeapons[0],
      "the first arrow takes the file's free weapon record");
    check(weapons.records[arrows[0]!]?.nextObject === OBJECT_ID_EOF
      && (weapons.records[arrows[0]!] as { weaponType?: number }).weaponType === WEAPON_ARROW,
      'and the record holds the arrow, link RNeof');
    check(arrows[1] === fileWeapons, "the next one takes the first spare, behind the file's records");
    check(below(freeMisc, fileMisc).length === 2 && boulders[0] === freeMisc[0] && boulders[1] === freeMisc[1],
      'boulders take misc records in index order, lowest first');
    check(boulders[2] === fileMisc, 'then the first spare');
    check(weapons.records.length === weaponCount && dungeon.getData().header.objectCounts[DBType.WEAPON] === weaponCount
      && weapons.count === weaponCount, 'nothing grows: count and the header are the records, spares included');
  }

  /* ------------------------------- 2. the walk of the records starts at 1 ---- */
  {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    const start = dungeon.getStartPosition();
    const at = new Position(start.x, start.y, start.z);
    const missilesHere = (): ObjectID[] => {
      const out: ObjectID[] = [];
      for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.MISSILE) out.push(rn);
      }
      return out;
    };
    /** Launch a poison bolt from the start square; the index of its missile record. */
    const launch = (): ObjectID => {
      const before = new Set(missilesHere().map((rn) => index(dungeon, rn)));
      game.systems.magic.launchThrownMissile(RN_POISON_BOLT, at, 1, 3, 100, 100, 1, 1000);
      const rn = missilesHere().find((r) => !before.has(index(dungeon, r)));
      if (rn === undefined) throw new Error('no missile launched');
      return rn;
    };
    /** Take a missile out of the world and free its record, as its end does. */
    const free = (rn: ObjectID): void => {
      dungeon.removeObjectFromCell(at, rn);
      dungeon.deleteDBEntry(rn);
    };
    // Each index is read as the record is handed out: a slot whose record is freed is
    // the one `RN(DBTYPE, dbIndex)` reuses (`doc/CSBwin-src/data.cpp:476-480`), so a
    // freed missile's RN may name another record afterwards.
    const m0 = launch();
    const i0 = index(dungeon, m0);
    const m1 = launch();
    const i1 = index(dungeon, m1);
    const m2 = launch();
    const i2 = index(dungeon, m2);
    free(m1);
    const again1 = launch();
    free(m0);
    const after0 = launch();
    console.log(`2. missiles ${i0}, ${i1}, ${i2}; free ${i1} -> next ${index(dungeon, again1)}; `
      + `free ${i0} -> next ${index(dungeon, after0)}`);
    check(i0 === 1 && i1 === 2 && i2 === 3, "a new game's spare missiles are handed out from 1: the walk of the records starts there");
    check(index(dungeon, again1) === 2, 'a freed record is taken again');
    check(index(dungeon, after0) === 1, 'the lowest free one first');
    check(dungeon.getData().databases.missiles.records[0]!.nextObject === OBJECT_ID_NULL,
      'and record 0, free all along, is never handed out');
  }

  /* --------------------------------------------- 3. the header counts ---------- */
  {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    let level = -1;
    let type = -1;
    for (let z = 0; z < dungeon.getMapCount() && level < 0; z++) {
      for (let t = 0; t < 27; t++) if (dungeon.monsterAllowedOnLevel(t, z)) { level = z; type = t; break; }
    }
    const creatures = dungeon.getData().databases.creatures;
    const before = creatures.records.length;
    const rn = createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: 0, mapY: 0, level, invisible: false, drawAsSize4: false,
    });
    const header = dungeon.getData().header.objectCounts[DBType.CREATURE];
    console.log(`3. a monster on L${level}: creature ${index(dungeon, rn)} of ${creatures.records.length} (was ${before}), header ${header}, count ${creatures.count}`);
    const firstSpare = before - game.ctx.tables.byte7302[DBType.CREATURE]!;
    check(rn !== null && index(dungeon, rn) === firstSpare && creatures.records.length === before,
      'the new group takes the first spare, and the database does not grow');
    check(header === before && creatures.count === before, 'the header declares every record, for the image writer');
  }

  /* --------------------------------------------- 4. the indirect index -------- */
  {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    const maps = dungeon.rnMaps;
    const missiles = dungeon.getData().databases.missiles.records;
    const freeSlots = (): number[] => {
      const words = maps.indexMapWords();
      return [...words.keys()].filter((i) => i > 0 && words[i] === 0xffff);
    };
    check(freeSlots().length === 0, 'a new game has no free slot');
    const arrow = (): ObjectID => constructPredefinedMissile(dungeon, MISSILE_TYPE_ARROW)!;

    // a. A deleted object's slot is freed.
    const a1 = arrow();
    const a1Index = maps.idx(a1);
    const length = maps.length;
    dungeon.deleteDBEntry(a1);
    console.log(`4a. arrow: slot ${a1}, weapon ${a1Index}; deleted: dbType ${maps.dbType(a1)}, `
      + `maps ${maps.typeMapBytes()[a1].toString(16)}/${maps.indexMapWords()[a1].toString(16)}, free slots [${freeSlots()}]`);
    check(maps.dbType(a1) === DBType.UNKNOWN && maps.typeMapBytes()[a1] === 0xff && maps.indexMapWords()[a1] === 0xffff,
      'DeleteDBEntry frees the slot: 0xff/0xffff, dbUNKNOWN');
    check(dungeon.getData().databases.weapons.records[a1Index]!.nextObject === OBJECT_ID_NULL, 'and the record, link RNnul');

    // b. The next new object, of another database, takes that slot.
    const m = constructPredefinedMissile(dungeon, MISSILE_TYPE_BOULDER)!;
    console.log(`4b. a boulder next: slot ${m}, ${maps.dbType(m) === DBType.MISC ? 'misc' : maps.dbType(m)} ${maps.idx(m)}; maps ${maps.length} long (was ${length})`);
    check(m === a1 && maps.dbType(m) === DBType.MISC && maps.length === length,
      'a misc object takes the free slot, and the maps do not grow');

    // c. A slot naming a free record is taken with it, ahead of a lower free slot: here
    //    record 0 of the missiles, which the walk of the records never reaches. The bolt
    //    takes record 1.
    const at = dungeon.getStartPosition();
    game.systems.magic.launchThrownMissile(RN_POISON_BOLT, at, 1, 3, 100, 100, 1, 1000);
    let bolt: ObjectID = OBJECT_ID_EOF;
    for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      if (maps.dbType(rn) === DBType.MISSILE) bolt = rn;
    }
    const boltIndex = maps.idx(bolt);
    dungeon.removeObjectFromCell(at, bolt);
    dungeon.deleteDBEntry(bolt);
    const named = maps.rn(DBType.MISSILE, 0);
    dungeon.deleteDBEntry(m);
    const lower = freeSlots();
    const zeroFree = missiles[0]!.nextObject === OBJECT_ID_NULL;
    const takes = dungeon.findEmptyDBEntry('missiles', { ...missiles[0]!, nextObject: OBJECT_ID_EOF });
    console.log(`4c. bolt: missile ${boltIndex}, freed; slot ${named} made to name it; the boulder's slot freed, free slots [${lower}]; `
      + `the next missile: slot ${takes}, missile ${maps.idx(takes)}`);
    check(boltIndex === 1 && zeroFree && lower.length === 1 && lower[0]! < named,
      'missile 0 is free, a slot names it, and a lower slot is free');
    check(takes === named && maps.idx(takes) === 0, 'the next missile takes the slot naming free record 0, not the lower free slot');
    const blocker = arrow();
    check(blocker === lower[0], 'the next object takes the free slot');

    // d. Two slots naming one record: "Cloned!!!".
    const typeMap = Array.from(maps.typeMapBytes());
    const indexMap = Array.from(maps.indexMapWords());
    const twin = typeMap.length;
    typeMap.push(typeMap[blocker]!);
    indexMap.push(indexMap[blocker]!);
    maps.restore(typeMap, indexMap);
    const blockerRecord = dungeon.getWeaponRecord(blocker)!;
    const blockerLink = blockerRecord.nextObject;
    dungeon.deleteDBEntry(blocker);
    console.log(`4d. slot ${twin} names weapon ${maps.idx(blocker)} too; deleting slot ${blocker}: link ${blockerRecord.nextObject.toString(16)}, dbType ${maps.dbType(blocker)}`);
    check(blockerRecord.nextObject === blockerLink && maps.dbType(blocker) === DBType.WEAPON && maps.dbType(twin as ObjectID) === DBType.WEAPON,
      'a record two slots name is not freed, nor either slot');

    // e. Slot 0 names door 0.
    let door0: ObjectID = OBJECT_ID_NULL;
    for (let i = 1; i < maps.length && door0 === OBJECT_ID_NULL; i++) {
      if (maps.dbType(i as ObjectID) === DBType.DOOR && maps.idx(i as ObjectID) === 0) door0 = i as ObjectID;
    }
    const doorRecord = dungeon.getDoorRecordByIndex(0)!;
    const doorLink = doorRecord.nextObject;
    dungeon.deleteDBEntry(door0);
    console.log(`4e. door 0 is slot ${door0}, and slot 0 is ${maps.typeMapBytes()[0]}/${maps.indexMapWords()[0]}; deleted: link ${doorRecord.nextObject.toString(16)}`);
    check(door0 !== OBJECT_ID_NULL && doorRecord.nextObject === doorLink && maps.dbType(door0) === DBType.DOOR,
      'deleting door 0 changes nothing: slot 0 names it too');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
