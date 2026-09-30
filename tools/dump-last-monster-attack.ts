/**
 * Only a monster's attack sets `d.LastMonsterAttackTime`.
 *
 * CSBWin has exactly one writer outside the save code: `MonsterAttacks`
 * (`doc/CSBwin-src/Monster.cpp:982`), `d.LastMonsterAttackTime = d.Time`, before it
 * decides what the attack is. A missile reaching the party goes through
 * `ProcessMissileEncounter`'s party arm and `DamageCharacter`, and neither touches it.
 * The port used to stamp it from the missile path as well — a stand-in from before
 * monster AI existed — so any missile, even a champion's own spell bouncing back, told
 * `AdjustSkills` (`Magic.cpp:222`, `:245`) and the facing reset (`Code17818.cpp:420`)
 * that a monster had just attacked.
 *
 * Run: `npx tsx tools/dump-last-monster-attack.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { RN_FIREBALL } from '../src/core/spellRn';

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
  for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`));
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

  finish();
}

main();
