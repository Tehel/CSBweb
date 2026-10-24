/**
 * `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7398-7446`) — torches burning down.
 *
 *   1. Cadence: whenever `(d.Time & 511) == 0` (`doc/CSBwin-src/CSBCode.cpp:690-693`),
 *      every 512 ticks — about 85 seconds, not 90.
 *   2. Each torch in either hand loses one charge; one that reaches 0 loses its
 *      `important` flag.
 *   3. A provisional Hall of Champions recruit is not counted: the loop runs over
 *      `d.NumCharacter`, less one while `d.PotentialCharacterOrdinal != 0`.
 *
 * Run: `npm test -- --only=ninety-second-update.ts`
 */
import { DBType, OBJECT_ID_EOF, Position } from '../../src/core/types';
import type { WeaponRecord } from '../../src/data/dungeonTypes';
import { Game } from '../../src/engine/Game';
import { isNinetySecondTick, ninetySecondUpdate } from '../../src/engine/PeriodicUpdates';
import { newGame, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';

const WEAPON_TORCH = 2;

function makeGame(): Game {
  const data = stockDungeon();

  const graphics = stockGraphics();

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.systems.hallOfChampions.addChampion(testChampion(0));
  game.ctx.party.state.position = new Position(6, 14, 2);
  return game;
}

/** Run `NinetySecondUpdate`'s gate at every tick in `[from, to]`, as the game tick does. */
function runTicks(game: Game, from: number, to: number, onTick?: (t: number) => void): void {
  for (let t = from; t <= to; t++) {
    game.ctx.state.tickCount = t;
    if (isNinetySecondTick(t)) ninetySecondUpdate(game.ctx);
    onTick?.(t);
  }
}

/** A lit torch with `charges` left, put in the champion's action hand. */
function giveTorch(game: Game, chIdx: number, charges: number): WeaponRecord {
  const db = game.ctx.dungeon.getData().databases.weapons;
  const torch: WeaponRecord = {
    nextObject: OBJECT_ID_EOF, broken: false, charges, litTorch: true, poisoned: false,
    cursed: false, important: true, weaponType: WEAPON_TORCH,
  };
  db.records.push(torch);
  db.count++;
  const rn = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
  const champ = game.ctx.party.state.champions[chIdx]!;
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
    game.systems.hallOfChampions.addChampion(testChampion(1));
    const own = giveTorch(game, 0, 8);
    const recruits = giveTorch(game, 1, 8);
    game.ctx.party.state.potentialChampionIndex = 1;
    runTicks(game, 512, 512);
    console.log(`party torch ${own.charges}, recruit's torch ${recruits.charges}`);
    check(own.charges === 7, "the party's torch burns");
    check(recruits.charges === 8, "the recruit's does not: NumCharacter - 1 while PotentialCharacterOrdinal != 0");
  }

  finish();
}

main();
