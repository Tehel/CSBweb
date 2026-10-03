/**
 * A new object takes a freed record (`DATABASES::FindEmptyDBEntry`,
 * `doc/CSBwin-src/data.cpp:919-993`).
 *
 *  1. The lowest record from index 1 whose link is `RNnul` (`:954-966`). `dungeon.dat`
 *     ships a few: weapon 105, misc 8 and 116. The port appended every new record, so
 *     the first arrow a wall shoots was weapon 107 where CSBWin's is 105.
 *  2. Record 0 is never reused. An empty database — missiles, clouds — is `Enlarge`d,
 *     which hands out the old length, 0 (`:967-972`, `data.cpp:813-876`); once freed,
 *     that record stays free while the loop starts at 1.
 *  3. Appending keeps `count` and the header's `objectCounts` — what the image writer
 *     declares — equal to the number of records. `MonsterSystem`'s allocator bumped
 *     neither the header nor anything but `count`.
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
    const miscCount = misc.records.length;
    const arrows = [0, 1].map(() => index(dungeon, constructPredefinedMissile(dungeon, MISSILE_TYPE_ARROW)));
    const boulders = [0, 1, 2].map(() => index(dungeon, constructPredefinedMissile(dungeon, MISSILE_TYPE_BOULDER)));
    console.log(`1. free in dungeon.dat: weapons [${freeWeapons}] of ${weaponCount}, misc [${freeMisc}] of ${miscCount}`);
    console.log(`   two arrows -> weapons ${arrows.join(', ')}; three boulders -> misc ${boulders.join(', ')}`);
    check(freeWeapons.length === 1 && arrows[0] === freeWeapons[0], "the first arrow takes the file's free weapon record");
    check(weapons.records[arrows[0]!]?.nextObject === OBJECT_ID_EOF
      && (weapons.records[arrows[0]!] as { weaponType?: number }).weaponType === WEAPON_ARROW,
      'and the record holds the arrow, link RNeof');
    check(arrows[1] === weaponCount, 'the next one, with none free, is appended');
    check(freeMisc.length === 2 && boulders[0] === freeMisc[0] && boulders[1] === freeMisc[1],
      'boulders take misc records in index order, lowest first');
    check(boulders[2] === miscCount, 'then append');
    check(dungeon.getData().header.objectCounts[DBType.WEAPON] === weapons.records.length
      && weapons.count === weapons.records.length, 'an append keeps count and the header equal to the records');
  }

  /* ------------------------------------------- 2. record 0 is never reused ---- */
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
    check(i0 === 0 && i1 === 1 && i2 === 2, 'an empty database hands out 0, 1, 2');
    check(index(dungeon, again1) === 1, 'a freed record is taken again');
    check(index(dungeon, after0) === 3, 'but record 0 is not: the search starts at 1');
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
    check(rn !== null && index(dungeon, rn) === before, 'with no free creature record it is appended');
    check(header === creatures.records.length && creatures.count === creatures.records.length,
      'and the header declares it, for the image writer');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
