/**
 * A giggler robs the party.
 *
 * `MonsterAttacks` sends a giggler's blow to `StealFromCharacter`
 * (`doc/CSBwin-src/Monster.cpp:1231-1234`, `:239`) instead of `MonsterDamagesCharacter`.
 * The steal empties the slot `d.uByte13126` names into the group's possession chain: the
 * first object becomes the chain's head, the next ones go on its end (`AddObjectToRoom`
 * with no cell, `Code11f52.cpp:491-499`). CSBWin never writes `d.uByte13126`, so it is all
 * zeroes and only ever names slot 0, the ready hand.
 *
 * The party stands next to the retail dungeon's first giggler, every champion holding a
 * dagger in each hand and one in the backpack, and the giggler's own possession set aside.
 * The checks, over sixty ticks of its attacks: more than one object is stolen; all of it
 * came out of a ready hand; and the giggler's chain is exactly those objects, in the
 * order they were taken.
 *
 * Run: `npx tsx tools/dump-giggler-steal.ts [ticks]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { MonsterType, StateOfFear } from '../src/engine/monsterTypes';
import { newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';

const HELD_SLOTS = [0, 1, 13];

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 500, maxHealth: 500, stamina: 200, maxStamina: 200, mana: 0, maxMana: 0,
      // Low dexterity and luck, so the steal gets its tries.
      stats: makeAddCharacterAttributes([10, 60, 10, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function newDagger(game: Game): ObjectID {
  const db = game.dungeonState.getData().databases.weapons;
  db.records.push({
    nextObject: OBJECT_ID_EOF,
    broken: false, charges: 0, litTorch: false, poisoned: false, cursed: false,
    important: false, weaponType: 8, // a dagger
  });
  db.count++;
  return encodeObjectID(0, DBType.WEAPON, db.records.length - 1);
}

function main(): void {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const ticks = Number(process.argv[2] ?? 60);

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  const dungeon = game.dungeonState;

  // The first giggler group in the dungeon, and an open cell beside it.
  let giggler: ObjectID | null = null;
  let at: Position | null = null;
  for (let z = 0; z < data.maps.length && giggler === null; z++) {
    const map = dungeon.getMap(z)!;
    const open = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < map.descriptor.width && y < map.descriptor.height
      && (((map.cellFlags[x]?.[y] ?? 0) >> 5) & 7) === RoomType.OPEN;
    for (let x = 0; x < map.descriptor.width && giggler === null; x++) {
      for (let y = 0; y < map.descriptor.height && giggler === null; y++) {
        for (let rn = dungeon.findFirstObject(new Position(x, y, z)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (decodeObjectID(rn).category !== DBType.CREATURE) continue;
          if (dungeon.getCreatureRecord(rn)?.creatureType !== MonsterType.mon_Giggler) continue;
          const beside = [[0, -1], [1, 0], [0, 1], [-1, 0]].find(([dx, dy]) => open(x + dx!, y + dy!));
          if (!beside) continue;
          giggler = rn;
          at = new Position(x + beside[0]!, y + beside[1]!, z);
          console.log(`giggler ${rn.toString(16)} at (${x},${y}) on level ${z}; party at (${at.x},${at.y})`);
          break;
        }
      }
    }
  }
  if (giggler === null || at === null) { check(false, 'the retail dungeon has a giggler with an open cell beside it'); finish(); return; }
  const monster = dungeon.getCreatureRecord(giggler)!;
  // It carries something already. Empty its hands, so the first steal takes the arm
  // that makes the object the chain's head, and the next ones the arm that appends.
  console.log(`it carries ${monster.possession.toString(16)}, set aside`);
  monster.possession = OBJECT_ID_EOF;

  const held = new Map<ObjectID, { chIdx: number; slot: number }>();
  for (let i = 0; i < 4; i++) {
    const champ = champion(i);
    for (const slot of HELD_SLOTS) {
      const rn = newDagger(game);
      champ.possessions[slot] = rn;
      held.set(rn, { chIdx: i, slot });
    }
    game.addChampion(champ);
  }
  game.party.state.position = at;
  game.monsterSystem.loadPartyLevel(at.z);

  // Each object in the order it left its champion.
  const gone: ObjectID[] = [];
  let afraid = false;
  for (let t = 0; t < ticks; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    processTimersAt(game, t);
    for (const [rn, { chIdx, slot }] of held) {
      if (gone.includes(rn) || game.party.state.champions[chIdx]!.possessions[slot] === rn) continue;
      gone.push(rn);
      console.log(`tick ${t}: ${rn.toString(16)} taken from champion ${chIdx}, slot ${slot}; fear ${monster.fear}`);
    }
    if (monster.fear === StateOfFear.StateOfFear5) afraid = true;
  }

  // The giggler's chain, from its head.
  const chain: ObjectID[] = [];
  for (let rn = monster.possession; rn !== OBJECT_ID_EOF && chain.length < 100; rn = dungeon.getDBRecordLink(rn)) chain.push(rn);
  console.log(`after ${ticks} ticks: chain ${chain.map((rn) => rn.toString(16)).join(' ')}; fear state 5 seen: ${afraid}`);

  check(gone.length > 1, `the giggler steals, more than once, so both arms of the chain run (${gone.length})`);
  check(gone.every((rn) => held.get(rn)!.slot === 0), 'every stolen object came out of a ready hand (d.uByte13126 is all zeroes)');
  check(chain.join() === gone.join(),
    'the chain is the stolen objects, once each, in the order they were taken, and nothing else');
  check(game.party.state.champions.every((c) => c.alive), 'nothing else touched the party in the meantime');
  finish();
}

main();
