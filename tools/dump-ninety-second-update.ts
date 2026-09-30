/**
 * `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7339-7387`) — torches burning down.
 *
 *   1. Cadence: whenever `(d.Time & 511) == 0` (`doc/CSBwin-src/CSBCode.cpp:680-683`),
 *      every 512 ticks — about 85 seconds, not 90.
 *   2. Each torch in either hand loses one charge; one that reaches 0 loses its
 *      `important` flag.
 *   3. A provisional Hall of Champions recruit is not counted: the loop runs over
 *      `d.NumCharacter`, less one while `d.PotentialCharacterOrdinal != 0`.
 *
 * Run: `npx tsx tools/dump-ninety-second-update.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, encodeObjectID } from '../src/core/types';
import type { WeaponRecord } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { isNinetySecondTick, ninetySecondUpdate } from '../src/engine/PeriodicUpdates';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

const WEAPON_TORCH = 2;

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
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
  game.addChampion(champion(0));
  game.party.state.position = new Position(6, 14, 2);
  return game;
}

/** Run `NinetySecondUpdate`'s gate at every tick in `[from, to]`, as the game tick does. */
function runTicks(game: Game, from: number, to: number, onTick?: (t: number) => void): void {
  for (let t = from; t <= to; t++) {
    game.state.tickCount = t;
    if (isNinetySecondTick(t)) ninetySecondUpdate(game.ctx);
    onTick?.(t);
  }
}

/** A lit torch with `charges` left, put in the champion's action hand. */
function giveTorch(game: Game, chIdx: number, charges: number): WeaponRecord {
  const db = game.dungeonState.getData().databases.weapons;
  const torch: WeaponRecord = {
    nextObject: OBJECT_ID_EOF, broken: false, charges, litTorch: true, poisoned: false,
    cursed: false, important: true, weaponType: WEAPON_TORCH,
  };
  db.records.push(torch);
  db.count++;
  const rn = encodeObjectID(0, DBType.WEAPON, db.records.length - 1);
  const champ = game.party.state.champions[chIdx]!;
  champ.possessions![1] = rn;
  return torch;
}

function main(): void {
  console.log('=== 1. cadence ===');
  {
    const game = makeGame();
    const torch = giveTorch(game, 0, 15);
    const burns: number[] = [];
    let last = torch.charges;
    runTicks(game, 1, 1100, (t) => {
      if (torch.charges !== last) burns.push(t);
      last = torch.charges;
    });
    console.log(`the torch burned down at ticks [${burns}]`);
    check(burns.length === 2 && burns[0] === 512 && burns[1] === 1024,
      'a torch burns down at d.Time 512 and 1024 — (d.Time & 511) == 0 — and never between');
    check(torch.charges === 13, 'one charge each time');
  }

  console.log('');
  console.log('=== 2. the last charge ===');
  {
    const game = makeGame();
    const torch = giveTorch(game, 0, 1);
    runTicks(game, 512, 512);
    console.log(`charges ${torch.charges}, important ${torch.important}`);
    check(torch.charges === 0 && torch.important === false, 'a torch burnt out loses its important flag');
    runTicks(game, 1024, 1024);
    check(torch.charges === 0, 'and a dead torch stays at 0');
  }

  console.log('');
  console.log('=== 3. a Hall of Champions recruit ===');
  {
    const game = makeGame();
    game.addChampion(champion(1));
    const own = giveTorch(game, 0, 8);
    const recruits = giveTorch(game, 1, 8);
    game.party.state.potentialChampionIndex = 1;
    runTicks(game, 512, 512);
    console.log(`party torch ${own.charges}, recruit's torch ${recruits.charges}`);
    check(own.charges === 7, "the party's torch burns");
    check(recruits.charges === 8, "the recruit's does not: NumCharacter - 1 while PotentialCharacterOrdinal != 0");
  }

  finish();
}

main();
