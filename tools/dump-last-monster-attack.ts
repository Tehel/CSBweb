/**
 * Only a monster's attack sets `d.LastMonsterAttackTime`.
 *
 * CSBWin has exactly one writer outside the save code: `MonsterAttacks`
 * (`doc/CSBwin-src/Monster.cpp:986`), `d.LastMonsterAttackTime = d.Time`, before it
 * decides what the attack is. A missile reaching the party goes through
 * `ProcessMissileEncounter`'s party arm and `DamageCharacter`, and neither touches it.
 * The port used to stamp it from the missile path as well — a stand-in from before
 * monster AI existed — so any missile, even a champion's own spell bouncing back, told
 * `AdjustSkills` (`Magic.cpp:225`, `:248`) and the facing reset (`Code17818.cpp:420`)
 * that a monster had just attacked.
 *
 * And a save carries it signed. `GAMEBLOCK2.LastMonsterAttackTime` is an `i32`
 * (`doc/CSBwin-src/SaveGame.cpp:126`), and a game no monster has attacked holds the
 * start value, -200 (`CSBCode.cpp:363`), which the file writes as `ff ff ff 38`. Read
 * unsigned it is 4294967096, later than any `d.Time`, and `AdjustSkills` then takes
 * every skill gain for one made under attack: doubled, and never halved.
 *
 * Run: `npm test -- --only=dump-last-monster-attack.ts`
 */
import { readFileSync } from 'node:fs';

import { Position, RoomType } from '../src/core/types';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { Game } from '../src/engine/Game';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import type { Champion } from '../src/engine/gameTypes';
import { processTimersAt, stockGame } from './lib/game';
import { check, finish } from './lib/check';
import { savePath } from './lib/saves';
import { RN_FIREBALL } from '../src/core/spellRn';
import { testChampion } from './lib/champion';

function champion(i: number, name: string): Champion {
  return testChampion(i, { name, attributes: { mana: 0, maxMana: 0 } });
}

function makeGame(): Game {
  const game = stockGame();
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i, `HERO${i}`));
  return game;
}


function main(): void {
  const game = makeGame();
  const dungeon = game.ctx.dungeon;

  // A floor cell with two more floor cells straight north of it, on level 0.
  const map = dungeon.getMap(0)!;
  const floor = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.descriptor.width && y < map.descriptor.height
    && (((map.cellFlags[x]?.[y] ?? 0) >> 5) & 7) === RoomType.OPEN;
  let at: Position | null = null;
  for (let x = 0; x < map.descriptor.width && at === null; x++) {
    for (let y = 2; y < map.descriptor.height; y++) {
      if (floor(x, y) && floor(x, y - 1) && floor(x, y - 2)) { at = new Position(x, y, 0); break; }
    }
  }
  if (at === null) { check(false, 'level 0 has a three-cell corridor'); finish(); return; }

  const party = game.ctx.party.state;
  party.position = at;
  party.facing = 0;
  const before = party.lastMonsterAttackTime;
  const health = () => party.champions.reduce((sum, c) => sum + c.attributes.health, 0);
  const health0 = health();
  console.log(`party at (${at.x},${at.y}); lastMonsterAttackTime ${before}; health ${health0}`);

  // A fireball (the spell RN itself, as `CharacterThrowsSpell` launches it), two cells
  // north, flying south at the party.
  game.systems.magic.launchThrownMissile(RN_FIREBALL, new Position(at.x, at.y - 2, 0), 2, 2, 100, 100, 1, 0);
  for (let t = 1; t <= 20; t++) processTimersAt(game, t);
  console.log(`after the fireball: health ${health()}; lastMonsterAttackTime ${party.lastMonsterAttackTime}`);

  check(health() < health0, 'the fireball reached the party and hurt it');
  check(party.lastMonsterAttackTime === before,
    `a missile does not stamp LastMonsterAttackTime (${before} -> ${party.lastMonsterAttackTime})`);

  // A genuine CSBWin save of a game no monster has attacked, and the port's own file of
  // one: both hold -200, and both read it back.
  const saved = makeGame();
  applyCsbwinSave(saved, new Uint8Array(readFileSync(savePath('csbgame4-door-opening.dat'))));
  const fromSave = saved.ctx.party.state.lastMonsterAttackTime;
  const own = makeGame();
  applyCsbwinSave(own, buildSaveFile(game));
  const fromOwn = own.ctx.party.state.lastMonsterAttackTime;
  console.log(`csbgame4-door-opening.dat: d.Time ${saved.ctx.state.tickCount}, lastMonsterAttackTime ${fromSave}; ` +
    `the port's own file: ${fromOwn}`);
  check(fromSave === -200, `a CSBWin save of a game no monster has attacked reads -200 (${fromSave})`);
  check(fromSave < saved.ctx.state.tickCount - 150,
    'so AdjustSkills takes its last attack for more than 150 ticks old');
  check(before === -200 && fromOwn === -200, `and the port's own file gives -200 back (${fromOwn})`);

  finish();
}

main();
